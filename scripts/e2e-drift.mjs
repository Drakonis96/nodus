// End-to-end: Nodus Drift in the REAL app.
//
// The unit suites prove each piece. What only a real window can show is the sum: the main
// process reading a recording off disk and the renderer decoding it, one AudioContext that
// outlives navigation, a header popover that never disturbs Nodus Browser, and a relaunch that
// restores a mix without making a sound. This script launches the app on a throw-away profile
// and checks each of those from the outside.
//
// * The recordings are the real ones: the 81 Moodist files, bundled unmodified and prepared by
//   scripts/prepare-drift-assets.mjs. On top of them, FIXTURES synthesised by
//   scripts/drift-fixtures.mjs and handed to the main process through NODUS_E2E_DRIFT_FIXTURES cover
//   what the real catalogue cannot: a file that was altered, one that is not audio, one that is not
//   there, and a mix that reaches the sixth voice. The noise and binaural generators are the real ones.
// * "Is there sound?" is answered without any hook in the product: an init script wraps
//   AudioContext and AudioNode.prototype.connect in the page, so whatever reaches the context's
//   destination also feeds an AnalyserNode that only listens.
// * The Browser's "device volume" slider moves the REAL system volume, so this script only ever
//   READS it (to prove Drift never writes it). It never moves it.
// * Browser pages come from a local fixture server, and every request the window makes while Drift
//   is in use is recorded: none may leave the machine.
//
//   node scripts/e2e-drift.mjs                              against the working tree (dist/ + dist-electron/)
//   NODUS_E2E_EXECUTABLE=<app binary> node scripts/e2e-drift.mjs   against a packaged build
//   NODUS_E2E_AUDIBLE=1 ...                                 let the speakers play the (quiet) mix
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { buildDriftFixtures } from './drift-fixtures.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const packagedExecutable = process.env.NODUS_E2E_EXECUTABLE || '';
const audible = process.env.NODUS_E2E_AUDIBLE === '1';

if (!packagedExecutable && (!existsSync(path.join(repoRoot, 'dist-electron/main.js')) || !existsSync(path.join(repoRoot, 'dist/index.html')))) {
  console.log('[e2e-drift] no build found, running npm run build first…');
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
}

// The recordings are not in Git: make sure this working tree has them (one already in place and intact is
// kept, so this costs nothing after the first run). A packaged build carries its own inside app.asar.
if (!packagedExecutable) {
  const prepared = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'prepare-drift-assets.mjs')], { cwd: repoRoot, encoding: 'utf8' });
  if (prepared.status !== 0) {
    console.error(`${prepared.stdout}${prepared.stderr}`);
    throw new Error('[e2e-drift] the Nodus Drift recordings could not be prepared (they are fetched from their pinned commit)');
  }
}

/* ------------------------------------------------------------- audio tap (page) */

/**
 * Runs in the page BEFORE any app code. It changes nothing the app can observe except that
 * a listener is attached beside the destination.
 */
function installAudioTap() {
  const records = [];
  const tap = { records, created: 0 };
  Object.defineProperty(window, '__driftTap', { value: tap });
  const NativeContext = window.AudioContext;
  const nativeConnect = AudioNode.prototype.connect;
  window.AudioContext = class TappedAudioContext extends NativeContext {
    constructor(...args) {
      super(...args);
      const analyser = this.createAnalyser();
      analyser.fftSize = 2048;
      records.push({ context: this, analyser });
      tap.created += 1;
    }
  };
  AudioNode.prototype.connect = function connect(destination, ...rest) {
    const result = nativeConnect.call(this, destination, ...rest);
    if (destination && destination.context && destination === destination.context.destination) {
      const record = records.find((entry) => entry.context === destination.context);
      if (record) nativeConnect.call(this, record.analyser);
    }
    return result;
  };
}

/** Hostile persisted state, planted before the app reads it (see the last check). */
function plantHostileState(serialised) {
  try { localStorage.setItem('nodus:drift:v1', serialised); } catch { /* the check reports it */ }
}

/* --------------------------------------------------------- Browser fixture site */

let server;
let origin = '';

async function startFixtures() {
  server = createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    if (url.pathname === '/tone.wav') {
      // One second of silence: enough for Chromium to report media playing.
      const samples = 8000;
      const header = Buffer.alloc(44);
      header.write('RIFF', 0); header.writeUInt32LE(36 + samples, 4); header.write('WAVE', 8);
      header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
      header.writeUInt16LE(1, 22); header.writeUInt32LE(8000, 24); header.writeUInt32LE(8000, 28);
      header.writeUInt16LE(1, 32); header.writeUInt16LE(8, 34);
      header.write('data', 36); header.writeUInt32LE(samples, 40);
      response.setHeader('Content-Type', 'audio/wav');
      response.end(Buffer.concat([header, Buffer.alloc(samples, 128)]));
      return;
    }
    if (url.pathname === '/media') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html><head><title>Drift e2e media page</title></head><body><main>
        <audio id="a" controls loop><source src="/tone.wav" type="audio/wav"></audio></main></body></html>`);
      return;
    }
    response.statusCode = 404;
    response.end('not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  console.log(`[e2e-drift] fixtures at ${origin}`);
}

/* ------------------------------------------------------------------- harness */

const failures = [];
let checks = 0;
async function check(name, fn) {
  try {
    await settleShell();
    await fn();
    checks += 1;
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`  FAIL ${name}: ${error?.stack?.split('\n').slice(0, 4).join('\n      ') ?? error}`);
  }
}

/** Poll `fn` until it returns something truthy; report the last value if it never does. */
async function until(fn, describe, timeoutMs = 10_000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    try {
      last = await fn();
      if (last) return last;
    } catch (error) {
      last = `threw ${error?.message ?? error}`;
    }
    if (Date.now() > deadline) {
      const description = typeof describe === 'function' ? describe() : describe;
      throw new Error(`timed out waiting for ${description}; last: ${JSON.stringify(last)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

const profile = await mkdtemp(path.join(os.tmpdir(), 'nodus-e2e-drift-'));
const libraryRoot = path.join(profile, 'library-root');
await mkdir(libraryRoot, { recursive: true });
const fixtures = buildDriftFixtures(path.join(profile, 'drift-fixtures'));
// Skip the walls that would otherwise cover the shell before a test can reach it.
await writeFile(
  path.join(profile, 'app-prefs.json'),
  JSON.stringify({
    recoverySetupVersion: 1,
    firstVaultVersion: 1,
    basicsTutorialVersion: 999,
    mascotEnabled: false,
    mascotStyleChosen: true,
    tutorialVideosWatched: [],
    uiLanguage: 'es',
    // No backup, ever: the profile is synthetic and this suite must not run one.
    autoBackupFolder: libraryRoot,
    autoBackupEnabled: false,
    libraryGlobalEnabled: true,
    browserDownloadFolder: libraryRoot,
  }),
  'utf8',
);
await startFixtures();

const appVersion = require(path.join(repoRoot, 'package.json')).version;
const childEnv = {
  ...process.env,
  NODUS_USERDATA: profile,
  NODUS_DISABLE_AUTO_UPDATE: '1',
  NODUS_E2E_UPDATE_STATUS: 'not-available',
  NODUS_E2E_DRIFT_FIXTURES: fixtures.directory,
};
// The launched app must be a real GUI process, not a headless Node one.
delete childEnv.ELECTRON_RUN_AS_NODE;

const pageErrors = [];
const requests = [];
let app;
let page;

/** Ids of the two vaults, known after the first launch. */
let vaults = null;

/** Start the app on the shared profile, install the tap, and get past the startup walls. */
async function launch({ secondVault = false } = {}) {
  app = await electron.launch({
    executablePath: packagedExecutable || require('electron'),
    args: [...(audible ? [] : ['--mute-audio']), ...(packagedExecutable ? [] : [repoRoot])],
    env: childEnv,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(20_000);
  page.on('pageerror', (error) => { pageErrors.push(String(error?.stack ?? error)); });
  page.on('request', (request) => {
    // Drift's code only ever runs in the window's main frame; a third-party iframe (an embedded tutorial
    // video, say) is another feature's traffic, so the frame is recorded to keep the two apart.
    let main = false;
    try { main = request.frame() === page.mainFrame(); } catch { /* a request without a frame */ }
    requests.push({ url: request.url(), at: Date.now(), main });
  });
  await page.waitForLoadState('domcontentloaded');
  await page.addInitScript(installAudioTap);
  const seeded = await page.evaluate(async ({ version, second }) => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    localStorage.setItem('nodus.mobileTeaserSeen.3.2.4', '1');
    localStorage.setItem('nodus.platformHighlightsSeen.2026-07', '1');
    localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
    localStorage.setItem('nodus.pdfPresenterTutorialSeen.e2js_u-05OA', '1');
    localStorage.setItem('nodus.toolkitBetaGuideSeen.2.4.0', '1');
    const onboarded = {
      onboardingComplete: true, basicsTutorialVersion: 999, firstVaultVersion: 1, recoverySetupVersion: 1,
      tourComplete: true, advancedTourComplete: true, mascotEnabled: false,
    };
    await window.nodus.updateSettings(onboarded);
    if (!second) return null;
    // Settings belong to a vault. Create a second one, give it the same "already onboarded" state through
    // the bridge and come back to the first, so that the switch under test (later, through the vault panel)
    // is the one a user makes and both vaults are in the list the renderer loads at start.
    const original = await window.nodus.getActiveVault();
    const created = await window.nodus.createVault({ name: second, type: 'academic' });
    await window.nodus.switchVault(created.vault.id);
    await window.nodus.updateSettings(onboarded);
    await window.nodus.switchVault(original.id);
    return { originalId: original.id, secondId: created.vault.id };
  }, { version: appVersion, second: secondVault ? 'QA Drift vault' : '' });
  if (seeded) vaults = seeded;
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  const updateModal = page.getByTestId('startup-update-modal');
  const modalDeadline = Date.now() + 5_000;
  while (Date.now() < modalDeadline && (await updateModal.count()) === 0) await page.waitForTimeout(100);
  if (await updateModal.count()) {
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="startup-update-modal"]')?.getAttribute('data-update-status') === 'not-available');
    await updateModal.getByRole('button', { name: 'Entendido', exact: false }).click();
    await updateModal.waitFor({ state: 'detached' });
  }
  await page.locator('[data-tour="nav-toolkit"]').waitFor();
  await page.waitForTimeout(600);
  await settleShell();
}

async function closeApp() {
  if (!app) return;
  const child = app.process();
  let timeout;
  const closed = app.close().then(() => true, () => false);
  const cleanly = await Promise.race([closed, new Promise((resolve) => { timeout = setTimeout(() => resolve(false), 8_000); })]);
  clearTimeout(timeout);
  if (!cleanly && child.exitCode === null && !child.killed) child.kill('SIGKILL');
  app = undefined;
}

/**
 * Close what a previous step may have left over the shell: the media popover (its backdrop swallows
 * every click) and the research-preparation welcome a new academic vault opens with.
 */
async function settleShell() {
  if (!page) return;
  for (let attempt = 0; attempt < 6; attempt++) {
    if (await page.getByTestId('browser-media-popover').count()) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
    } else if (await page.getByTestId('research-preparation-welcome').count()) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    } else {
      return;
    }
  }
}

/* --------------------------------------------------------------------- probes */

/** What the tap heard over `ms`: how many contexts exist, the state of the first, and its level. */
const signal = (ms = 500) => page.evaluate(async (windowMs) => {
  const tap = window.__driftTap;
  const record = tap?.records[0];
  if (!record) return { created: tap?.created ?? -1, contexts: 0, state: 'none', mean: 0, peak: 0, tail: 0 };
  const buffer = new Float32Array(record.analyser.fftSize);
  let sum = 0;
  let peak = 0;
  let samples = 0;
  const end = performance.now() + windowMs;
  do {
    record.analyser.getFloatTimeDomainData(buffer);
    let energy = 0;
    for (const value of buffer) energy += value * value;
    const rms = Math.sqrt(energy / buffer.length);
    sum += rms;
    peak = Math.max(peak, rms);
    samples += 1;
    await new Promise((resolve) => setTimeout(resolve, 25));
  } while (performance.now() < end);
  // The analyser of a suspended context keeps the last buffer it rendered. Its final samples are what
  // the speakers got just before the suspension: silence, if the fade had finished.
  let tail = 0;
  for (let index = buffer.length - 64; index < buffer.length; index++) tail = Math.max(tail, Math.abs(buffer[index]));
  return { created: tap.created, contexts: tap.records.length, state: record.context.state, mean: sum / samples, peak, tail };
}, ms);

const AUDIBLE = 0.004;
const SILENT = 0.0005;

const audibleNow = async (description, timeoutMs = 10_000) => {
  let heard;
  return until(async () => {
    heard = await signal(300);
    return heard.state === 'running' && heard.mean > AUDIBLE ? heard : false;
  }, () => `${description} (heard ${JSON.stringify(heard)})`, timeoutMs);
};

/** Faded out and suspended: the context stopped only once the fade had reached silence. */
const silentNow = async (description) => {
  let heard;
  return until(async () => {
    heard = await signal(200);
    return heard.state === 'suspended' && heard.tail < SILENT ? heard : false;
  }, () => `${description} (heard ${JSON.stringify(heard)})`, 8_000);
};

const stored = () => page.evaluate(() => {
  const raw = localStorage.getItem('nodus:drift:v1');
  return raw ? JSON.parse(raw) : null;
});

const card = (id) => page.locator(`[data-testid="drift-card-${id}"] > button:not([data-testid])`).first();
const mediaButton = () => page.getByTestId('browser-media-header-action').getByRole('button', { name: 'Medios', exact: true });
const call = (method, ...args) => page.evaluate(([name, rest]) => window.nodus[name](...rest), [method, args]);
const sliderValue = (testid) => page.getByTestId(testid).inputValue();
const setSlider = async (testid, value) => { await page.getByTestId(testid).fill(String(value)); };

/** Into the Drift page from wherever the app is: the Tools home is skipped if Tools remembers Drift. */
const openDrift = async () => {
  if (await page.getByTestId('toolkit-drift').count()) return;
  await page.locator('[data-tour="nav-toolkit"]').click();
  await until(async () => (await page.getByTestId('toolkit-home').count()) || (await page.getByTestId('toolkit-drift').count()), 'Tools to render');
  if (await page.getByTestId('toolkit-home').count()) await page.getByTestId('toolkit-card-drift').click();
  await page.getByTestId('toolkit-drift').waitFor();
};

const browserTarget = (fn, arg) => app.evaluate(async ({ webContents }, [source, argument]) => {
  const target = webContents.getAllWebContents().find((wc) => wc.getURL().endsWith('/media'));
  if (!target) throw new Error('the media page is not open');
  return target.executeJavaScript(`(${source})(${JSON.stringify(argument ?? null)})`, true);
}, [fn.toString(), arg]);

/* ------------------------------------------------------------------------ run */

let flowStartedAt = 0;
try {
  await launch({ secondVault: true });

  // ── 1. Nodus Tools ────────────────────────────────────────────────────────
  await check('Nodus Tools finds Nodus Drift by an accent-folded search and opens its own page', async () => {
    await page.locator('[data-tour="nav-toolkit"]').click();
    await page.getByTestId('toolkit-home').waitFor();
    const search = page.getByTestId('toolkit-search');
    await search.fill('AMBIÉNTE');
    await page.getByTestId('toolkit-card-drift').waitFor();
    await search.fill('drift');
    await page.getByTestId('toolkit-card-drift').waitFor();
    assert.equal(await page.getByTestId('toolkit-card-drift').count(), 1);
    assert.match(await page.getByTestId('toolkit-card-drift').innerText(), /Nodus Drift/);
    await search.fill('');
    assert.equal(await mediaButton().count(), 0, 'no header control before anything is selected');
    assert.equal((await signal(50)).created, 0, 'browsing Tools creates no AudioContext');

    flowStartedAt = Date.now();
    await page.getByTestId('toolkit-card-drift').click();
    await page.getByTestId('toolkit-drift').waitFor();
    assert.equal(await page.getByTestId('toolkit-drift-hero').count(), 1);
    await page.getByTestId('toolkit-drift-back').click();
    await page.getByTestId('toolkit-home').waitFor();
    await page.getByTestId('toolkit-card-drift').click();
    await page.getByTestId('toolkit-drift').waitFor();
  });

  await check('the tool can be pinned into the sidebar as toolkit:drift, and unpinned again', async () => {
    await page.getByTestId('toolkit-drift-back').click();
    await page.getByTestId('toolkit-home').waitFor();
    const pin = page.getByTestId('toolkit-card-drift-pin');
    assert.equal(await pin.getAttribute('aria-pressed'), 'false');
    await pin.click();
    await until(async () => (await call('getSettings')).toolkitPinnedPages?.includes('drift'), 'the pin to be saved');
    await page.locator('[data-tour="nav-toolkit:drift"]').waitFor();
    assert.equal(await pin.getAttribute('aria-pressed'), 'true');
    await page.locator('[data-tour="nav-toolkit:drift"]').click();
    await page.getByTestId('toolkit-drift').waitFor();
    await page.getByTestId('toolkit-drift-back').click();
    await page.getByTestId('toolkit-home').waitFor();
    await pin.click();
    await until(async () => !(await call('getSettings')).toolkitPinnedPages?.includes('drift'), 'the pin to be removed');
    await page.locator('[data-tour="nav-toolkit:drift"]').waitFor({ state: 'detached' });
    await page.getByTestId('toolkit-card-drift').click();
    await page.getByTestId('toolkit-drift').waitFor();
  });

  // ── 2. The catalogue and what merely browsing it does ───────────────────────
  await check('the catalogue offers the generators, the real recordings and the fixtures; only a file that is not there is unavailable', async () => {
    await page.getByTestId('drift-card-brown-noise').waitFor();
    for (const id of ['white-noise', 'pink-noise', 'brown-noise', 'binaural-delta', 'binaural-gamma', 'light-rain', 'rain-on-tent', 'airport', 'fixture-a', 'fixture-g']) {
      assert.equal(await page.locator(`[data-testid="drift-grid"] [data-testid="drift-card-${id}"]`).count(), 1, `${id} is playable`);
    }
    // 8 generators + 81 recordings + 7 good fixtures + the altered one + the one that is not audio
    assert.equal(await page.locator('[data-testid="drift-grid"] > li').count(), 98, 'every generator, recording and fixture that can be played is in the grid');
    assert.equal(await page.locator('[data-testid="drift-unavailable"] > ul > li').count(), 1, 'one card is unavailable');
    assert.equal(await page.locator('[data-testid="drift-unavailable"] [data-testid="drift-card-fixture-missing"]').count(), 1,
      'a declared file that is not on disk is unavailable');
    assert.equal(await page.getByTestId('drift-license-note').count(), 0, 'no recording waits for a licence, so the page does not say so');
    await page.getByTestId('drift-unavailable').locator('summary').click();
    const missing = page.getByTestId('drift-card-fixture-missing');
    assert.equal(await missing.locator('[aria-disabled="true"]').count(), 1);
    assert.match(await page.getByTestId('drift-card-fixture-missing-reason').innerText(), /archivo/i);
    assert.equal(await missing.locator(':scope > button:not([data-testid])').count(), 0, 'an unavailable sound has no play button');
    await missing.locator('[aria-disabled="true"]').click({ force: true });
    assert.equal(await page.getByTestId('drift-mix-empty').count(), 1, 'clicking an unavailable sound adds nothing');
  });

  await check('empty mix: Play and Clear are disabled; search, filters and favourites never start audio', async () => {
    assert.equal(await page.getByTestId('drift-play-toggle').isDisabled(), true);
    assert.equal(await page.getByTestId('drift-clear').isDisabled(), true);
    await page.getByTestId('drift-search').fill('MARRÓN');
    await page.getByTestId('drift-card-brown-noise').waitFor();
    assert.equal(await page.getByTestId('drift-card-white-noise').count(), 0, 'accent and case folded: only the brown noise matches');
    await page.getByTestId('drift-card-brown-noise-favorite').click();
    assert.equal(await page.getByTestId('drift-card-brown-noise-favorite').getAttribute('aria-pressed'), 'true');
    await page.getByTestId('drift-search').fill('');
    await page.getByTestId('drift-filter-favorites').click();
    await page.getByTestId('drift-card-brown-noise').waitFor();
    assert.equal(await page.getByTestId('drift-card-pink-noise').count(), 0);
    await page.getByTestId('drift-filter-all').click();
    await page.getByTestId('drift-card-pink-noise').waitFor();
    const heard = await signal(100);
    assert.equal(heard.created, 0, 'no AudioContext exists until the user plays something');
    assert.equal(await mediaButton().count(), 0, 'favourites and filters do not select anything');
  });

  // ── 3. Playing ────────────────────────────────────────────────────────────
  await check('the keyboard alone starts the mix: one AudioContext, a running graph, real signal', async () => {
    await card('brown-noise').focus();
    await page.keyboard.press('Space');
    await page.getByTestId('drift-mix-voice-brown-noise').waitFor();
    assert.equal(await card('brown-noise').getAttribute('aria-pressed'), 'true');
    const heard = await audibleNow('brown noise to reach the destination');
    assert.equal(heard.created, 1);
    assert.equal(heard.contexts, 1);
    await until(async () => /Reproduciendo/.test(await page.getByTestId('drift-mix-voice-brown-noise-status').innerText()), 'the voice to say it plays');
    await mediaButton().waitFor();
  });

  await check('a recording is read through the bridge, decoded and mixed with the generator', async () => {
    const before = await audibleNow('the generator alone');
    await card('fixture-a').click();
    await until(async () => /Reproduciendo/.test(await page.getByTestId('drift-mix-voice-fixture-a-status').innerText()), 'the fixture to play', 15_000);
    const after = await audibleNow('generator and fixture together');
    assert.equal(after.created, 1, 'still the same single context');
    assert.ok(after.mean > before.mean * 1.05, `two voices are louder than one (${before.mean} → ${after.mean})`);
    assert.equal(await page.getByTestId('drift-mix-count').innerText(), '2 de 6 sonidos');
    assert.equal(await page.getByTestId('drift-mix-voice-fixture-a-status').count(), 1);
  });

  await check('real recordings are read through the bridge, decoded and looped: one that needs no crossfade and one that does', async () => {
    await audibleNow('the mix before the real recordings');
    // light-rain loops as it is; rain-on-tent gets a circular crossfade of 1 s (shared/driftCatalog.ts).
    for (const id of ['light-rain', 'rain-on-tent']) {
      await card(id).click();
      await until(async () => /Reproduciendo/.test(await page.getByTestId(`drift-mix-voice-${id}-status`).innerText()), `${id} to play`, 30_000);
    }
    const heard = await audibleNow('the real recordings mixed in', 15_000);
    assert.equal(heard.created, 1, 'still the same single context');
    assert.equal(await page.getByTestId('drift-mix-count').innerText(), '4 de 6 sonidos');
    for (const id of ['rain-on-tent', 'light-rain']) await page.getByTestId(`drift-remove-${id}`).click();
    await page.getByTestId('drift-mix-voice-light-rain').waitFor({ state: 'detached' });
    assert.equal(await page.getByTestId('drift-mix-count').innerText(), '2 de 6 sonidos');
    await audibleNow('the first two voices, after the recordings were removed');
  });

  await check('volume sliders move the real signal and are saved, without ever restarting anything', async () => {
    const start = await audibleNow('baseline');
    await setSlider('drift-master', 10);
    await page.waitForTimeout(500);
    const quiet = await signal(600);
    assert.ok(quiet.mean < start.mean * 0.6, `master 35 → 10 lowers the level (${start.mean} → ${quiet.mean})`);
    await setSlider('drift-master', 35);
    await setSlider('drift-volume-brown-noise', 60);
    await setSlider('drift-volume-fixture-a', 40);
    await until(async () => {
      const state = await stored();
      return state && Math.abs(state.master - 0.35) < 0.011 && Math.abs(state.volumes?.['brown-noise'] - 0.6) < 0.011
        && Math.abs(state.volumes?.['fixture-a'] - 0.4) < 0.011 && state.selection?.length === 2;
    }, 'the mix to be persisted (debounced)');
    const state = await stored();
    assert.deepEqual(Object.keys(state).sort(), ['favorites', 'filter', 'master', 'selection', 'snapshot', 'version', 'volumes'].sort(),
      'only configuration is persisted');
    assert.ok(!('playing' in state) && !('paused' in state), 'nothing about playback is stored');
    assert.equal((await signal(50)).created, 1);
  });

  await check('the hero and the panel buttons pause and resume the same context', async () => {
    await page.getByTestId('drift-play-toggle').click();
    await silentNow('the mix to fade out and the context to suspend');
    assert.equal(await page.getByTestId('drift-mix-toggle').getAttribute('aria-pressed'), 'false');
    await page.getByTestId('drift-mix-toggle').click();
    const heard = await audibleNow('the mix to resume');
    assert.equal(heard.created, 1, 'resuming reuses the context');
  });

  // ── 4. Navigation, header, vault: one engine throughout ────────────────────
  await check('navigating away and back never stops or duplicates the engine', async () => {
    await page.locator('[data-tour="nav-home"]').click();
    await page.getByTestId('toolkit-drift').waitFor({ state: 'detached' });
    const away = await audibleNow('the mix to keep sounding on another page');
    assert.equal(away.created, 1);
    await mediaButton().waitFor();
    await openDrift();
    assert.equal((await audibleNow('the mix to keep sounding on return')).created, 1);
    assert.equal(await page.getByTestId('drift-mix-count').innerText(), '2 de 6 sonidos', 'the mix is still there');
  });

  await check('the header popover opens on Drift, pauses and resumes the mix and moves only the Drift master', async () => {
    const systemBefore = await call('getBrowserDeviceVolume');
    await mediaButton().click();
    await page.getByTestId('browser-media-popover').waitFor();
    assert.equal(await page.getByTestId('media-source-tab-drift').getAttribute('aria-selected'), 'true', 'only Drift exists, so Drift is shown');
    await page.getByTestId('drift-mini-player').waitFor();
    assert.match(await page.getByTestId('drift-mini-count').innerText(), /2 sonidos en la mezcla/);
    await page.getByTestId('drift-mini-toggle').click();
    await silentNow('the header pause to fade the mix out');
    assert.equal(await page.getByTestId('drift-mini-toggle').getAttribute('aria-pressed'), 'false');
    await page.getByTestId('drift-mini-toggle').click();
    assert.equal((await audibleNow('the header play to bring it back')).created, 1);
    await setSlider('drift-mini-master', 50);
    await until(async () => (await sliderValue('drift-master')) === '50', 'the page master to follow the popover');
    assert.equal(await call('getBrowserDeviceVolume'), systemBefore, 'Drift never writes the system volume');
    await setSlider('drift-mini-master', 35);
    await page.keyboard.press('Escape');
    await page.getByTestId('browser-media-popover').waitFor({ state: 'detached' });
    assert.equal((await signal(50)).created, 1, 'opening and closing the popover creates nothing');

    // "Abrir Nodus Drift" from anywhere: lands on the tool's page, closes the popover, leaves the mix alone.
    await page.locator('[data-tour="nav-home"]').click();
    await page.getByTestId('toolkit-drift').waitFor({ state: 'detached' });
    await mediaButton().click();
    await page.getByTestId('drift-mini-open').click();
    await page.getByTestId('toolkit-drift').waitFor();
    await page.getByTestId('browser-media-popover').waitFor({ state: 'detached' });
    assert.equal((await audibleNow('the mix to keep sounding after opening the tool from the header')).created, 1);
  });

  // ── 5. Nodus Browser next to Drift ─────────────────────────────────────────
  await check('Browser media and Drift are independent: tabs, pause, mute and the system volume', async () => {
    const systemBefore = await call('getBrowserDeviceVolume');
    await page.locator('[data-tour="nav-browser"]').click();
    await page.locator('[data-browser-viewport]').waitFor();
    await call('submitBrowserOmnibox', `${origin}/media`);
    await until(async () => (await call('getBrowserState')).tabs.some((tab) => tab.url.endsWith('/media') && !tab.loading), 'the media page');
    await browserTarget(() => document.getElementById('a').play());
    await until(async () => (await call('getBrowserMedia')).length > 0, 'the Browser media session', 15_000);
    assert.equal(await page.getByTestId('browser-media-header-action').locator('.header-action-badge').innerText(), '2', 'two sources: one Browser session and Drift');

    await mediaButton().click();
    await page.getByTestId('browser-media-popover').waitFor();
    assert.equal(await page.getByTestId('media-source-tab-browser').getAttribute('aria-selected'), 'true', 'Browser first when both exist and nothing was chosen');
    await page.getByTestId('browser-media-row').first().waitFor();

    const playing = () => browserTarget(() => !document.getElementById('a').paused);
    assert.equal(await playing(), true, 'the Browser page plays');
    await page.getByTestId('media-source-tab-drift').click();
    await page.getByTestId('drift-mini-player').waitFor();
    assert.equal(await playing(), true, 'choosing the Drift tab does not touch the Browser page');
    assert.equal((await audibleNow('Drift to keep sounding')).created, 1);

    await page.getByTestId('drift-mini-toggle').click();
    await silentNow('Drift to pause');
    assert.equal(await playing(), true, 'pausing Drift does not pause the Browser page');
    await page.getByTestId('drift-mini-toggle').click();
    await audibleNow('Drift to resume');

    await page.getByTestId('media-source-tab-browser').click();
    await page.getByTestId('browser-media-mute').first().click();
    await until(async () => (await call('getBrowserMedia')).some((state) => state.muted), 'the Browser tab to mute');
    const whileMuted = await audibleNow('Drift while the Browser tab is muted');
    assert.equal((await stored()).master, 0.35, 'muting a Browser tab does not move the Drift master');
    await page.getByTestId('browser-media-mute').first().click();
    await until(async () => !(await call('getBrowserMedia')).some((state) => state.muted), 'the Browser tab to unmute');

    await page.getByTestId('media-source-tab-drift').click();
    await setSlider('drift-mini-master', 20);
    await page.waitForTimeout(400);
    assert.equal(await call('getBrowserDeviceVolume'), systemBefore, 'moving the Drift master leaves the system volume alone');
    assert.equal(await playing(), true, 'and the Browser page keeps playing');
    const lowered = await signal(500);
    assert.ok(lowered.mean < whileMuted.mean * 0.75, 'the Drift master really lowers the Drift signal');
    await setSlider('drift-mini-master', 35);
    await page.keyboard.press('Escape');
    await page.getByTestId('browser-media-popover').waitFor({ state: 'detached' });

    // The tab chosen last is where the popover reopens when both exist.
    await mediaButton().click();
    assert.equal(await page.getByTestId('media-source-tab-drift').getAttribute('aria-selected'), 'true');
    await page.keyboard.press('Escape');
    await browserTarget(() => document.getElementById('a').pause());
    await openDrift();
  });

  // ── 6. Failures stay local to their voice ───────────────────────────────────
  await check('an altered file and a file that is not audio fail alone, with a reason and a retry', async () => {
    await openDrift();
    await card('fixture-corrupt').click();
    await page.getByTestId('drift-error-fixture-corrupt').waitFor({ timeout: 15_000 });
    await card('fixture-garbage').click();
    await page.getByTestId('drift-error-fixture-garbage').waitFor({ timeout: 15_000 });
    assert.equal(await page.getByTestId('drift-retry-fixture-corrupt').count(), 1);
    assert.equal(await page.getByTestId('drift-retry-fixture-garbage').count(), 1);
    await audibleNow('the healthy voices to keep sounding beside the failed ones');
    assert.match(await page.getByTestId('drift-mix-voice-brown-noise-status').innerText(), /Reproduciendo/);
    assert.match(await page.getByTestId('drift-mix-voice-fixture-a-status').innerText(), /Reproduciendo/);
    await page.getByTestId('drift-retry-fixture-corrupt').click();
    await page.getByTestId('drift-error-fixture-corrupt').waitFor();
    await page.getByTestId('drift-remove-fixture-corrupt').click();
    await page.getByTestId('drift-remove-fixture-garbage').click();
    await page.getByTestId('drift-mix-voice-fixture-corrupt').waitFor({ state: 'detached' });
    assert.equal(await page.getByTestId('drift-mix-count').innerText(), '2 de 6 sonidos');
  });

  await check('a file that disappears after the catalogue was read errors alone, and Retry brings it back', async () => {
    await openDrift();
    const audioFile = path.join(fixtures.directory, 'audio', 'fixtures', 'fixture-c.wav');
    await rename(audioFile, `${audioFile}.away`);
    try {
      await card('fixture-c').click();
      await page.getByTestId('drift-error-fixture-c').waitFor({ timeout: 15_000 });
      await audibleNow('the other voices while one is missing');
    } finally {
      await rename(`${audioFile}.away`, audioFile);
    }
    await page.getByTestId('drift-retry-fixture-c').click();
    await until(async () => /Reproduciendo/.test(await page.getByTestId('drift-mix-voice-fixture-c-status').innerText()), 'the restored file to play', 15_000);
    assert.equal(await page.getByTestId('drift-error-fixture-c').count(), 0);
  });

  await check('the seventh voice is refused with a notice; nothing else changes', async () => {
    await openDrift();
    for (const id of ['fixture-b', 'fixture-d', 'fixture-e']) {
      await card(id).click();
      await page.getByTestId(`drift-mix-voice-${id}`).waitFor();
    }
    assert.equal(await page.getByTestId('drift-mix-count').innerText(), '6 de 6 sonidos');
    await card('fixture-f').click();
    await page.getByTestId('drift-limit-notice').waitFor();
    assert.equal(await page.getByTestId('drift-mix-count').innerText(), '6 de 6 sonidos');
    assert.equal(await page.getByTestId('drift-mix-voice-fixture-f').count(), 0);
    assert.equal(await card('fixture-f').getAttribute('aria-pressed'), 'false');
    await audibleNow('six voices at once');
    assert.equal((await signal(50)).created, 1);
    await page.getByTestId('drift-remove-fixture-e').click();
    await page.getByTestId('drift-remove-fixture-d').click();
    await page.getByTestId('drift-mix-voice-fixture-d').waitFor({ state: 'detached' });
    assert.equal(await page.getByTestId('drift-mix-count').innerText(), '4 de 6 sonidos');
  });

  await check('a binaural preset replaces the previous one in place; the help asks for stereo headphones', async () => {
    await openDrift();
    await card('binaural-alpha').click();
    await page.getByTestId('drift-mix-voice-binaural-alpha').waitFor();
    assert.equal(await page.getByTestId('drift-binaural-help').count(), 1);
    assert.match(await page.getByTestId('drift-binaural-help').innerText(), /auriculares estéreo/);
    await card('binaural-theta').click();
    await page.getByTestId('drift-mix-voice-binaural-theta').waitFor();
    assert.equal(await page.getByTestId('drift-mix-voice-binaural-alpha').count(), 0, 'only one preset at a time');
    assert.equal(await page.getByTestId('drift-mix-count').innerText(), '5 de 6 sonidos', 'the replacement did not add a voice');
    await audibleNow('the mix with a binaural voice');
    await page.getByTestId('drift-remove-binaural-theta').click();
  });

  // ── 7. A vault switch is not a reason to stop ───────────────────────────────
  await check('switching vault through the real switcher leaves one running engine and the same mix', async () => {
    assert.ok(vaults?.secondId, 'a second vault exists');
    assert.equal((await call('getActiveVault')).id, vaults.originalId, 'starting on the first vault');

    await page.getByTestId('header-vault-badge').click();
    const load = page.locator('button[title="Cargar"]');
    await load.first().waitFor();
    await load.first().click();
    await until(async () => (await call('getActiveVault'))?.id === vaults.secondId, 'the vault to switch');
    await page.locator('[data-tour="nav-toolkit"]').waitFor();
    await page.waitForTimeout(600);
    await settleShell();
    const heard = await audibleNow('the mix to survive the vault switch');
    assert.equal(heard.created, 1, 'no second AudioContext');
    await mediaButton().waitFor();
    await openDrift();
    assert.equal(await page.getByTestId('drift-mix-count').innerText(), '4 de 6 sonidos');
  });

  // ── 8. Offline ─────────────────────────────────────────────────────────────
  await check('while Drift was in use the window made no request that left the machine, and none for audio', async () => {
    const isExternal = (request) => /^https?:\/\//i.test(request.url)
      && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/)/i.test(request.url);
    // The guard must be able to fail: it flags a remote URL, lets a local one through, and the recorder is live
    // (it saw the window load its own files).
    assert.equal(isExternal({ url: 'https://example.com/loop.mp3' }), true);
    assert.equal(isExternal({ url: 'http://127.0.0.1:1/loop.mp3' }), false);
    assert.ok(requests.filter((request) => request.main).some((request) => request.url.startsWith('file://')), 'the recorder saw the window load');

    const outside = requests.filter((request) => request.at >= flowStartedAt && request.main).filter(isExternal);
    assert.deepEqual(outside.map((request) => request.url), [], 'no external request from the window that runs Drift');
    const audioRequests = requests.filter((request) => /\.(wav|mp3|ogg|m4a|flac)(\?|$)/i.test(request.url));
    assert.deepEqual(audioRequests.map((request) => request.url), [], 'audio never travels over the network: it comes through the bridge');
  });

  // ── 9. Relaunch: restore paused, silent ─────────────────────────────────────
  let expected;
  await check('the mix is saved on quit', async () => {
    await until(async () => (await stored())?.selection?.length === 4, 'the final mix to be saved');
    const state = await stored();
    expected = {
      selection: state.selection,
      master: await sliderValue('drift-master'),
      volumes: Object.fromEntries(await Promise.all(state.selection.map(async (id) => [id, await sliderValue(`drift-volume-${id}`)]))),
    };
    assert.deepEqual(state.favorites, ['brown-noise']);
  });

  await closeApp();
  await launch();

  await check('after a relaunch the mix is back, paused and silent, and only an explicit Play makes sound', async () => {
    await mediaButton().waitFor();
    const before = await signal(100);
    assert.equal(before.created, 0, 'restoring created no AudioContext');
    await mediaButton().click();
    await page.getByTestId('drift-mini-player').waitFor();
    assert.equal(await page.getByTestId('drift-mini-toggle').getAttribute('aria-pressed'), 'false', 'restored paused');
    assert.match(await page.getByTestId('drift-mini-count').innerText(), /4 sonidos en la mezcla · En pausa/);
    await page.keyboard.press('Escape');
    await openDrift();
    assert.equal(await page.getByTestId('drift-mix-count').innerText(), '4 de 6 sonidos');
    assert.equal(await sliderValue('drift-master'), expected.master);
    for (const id of expected.selection) assert.equal(await sliderValue(`drift-volume-${id}`), expected.volumes[id], `${id} kept its volume`);
    assert.equal(await page.getByTestId('drift-card-brown-noise-favorite').getAttribute('aria-pressed'), 'true');
    assert.equal((await signal(300)).created, 0, 'still nothing after the page rendered');
    await page.getByTestId('drift-mix-toggle').click();
    const heard = await audibleNow('the explicit Play to start the restored mix', 15_000);
    assert.equal(heard.created, 1);
  });

  await check('a hostile stored value is normalised: known sounds only, at most six, volumes in range, silent', async () => {
    const hostile = JSON.stringify({
      version: 1,
      selection: ['brown-noise', 'no-such-sound', 'fixture-a', 'fixture-a', 'fixture-b', 'fixture-c', 'fixture-d', 'fixture-e', 'fixture-f', 'white-noise'],
      volumes: { 'brown-noise': 7, 'fixture-a': -3, 'fixture-b': 'loud', 'no-such-sound': 0.5 },
      master: 9,
      favorites: ['no-such-sound', 'pink-noise'],
      filter: 'nonsense',
    });
    await page.addInitScript(plantHostileState, hostile);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.locator('[data-tour="nav-toolkit"]').waitFor();
    const heard = await signal(200);
    assert.equal(heard.created, 0, 'a corrupt state must not start audio');
    await mediaButton().waitFor();
    await openDrift();
    // Ids the catalogue does not know are dropped when the catalogue arrives, which is when the grid can
    // first show a card: wait for that instead of racing it.
    await page.getByTestId('drift-card-brown-noise').waitFor();
    const count = await page.getByTestId('drift-mix-count').innerText();
    const [, n] = /^(\d+) de 6 sonidos$/.exec(count) ?? [];
    assert.ok(n !== undefined && Number(n) >= 1 && Number(n) <= 6, `between one and six voices, got "${count}"`);
    assert.equal(await page.getByTestId('drift-mix-voice-no-such-sound').count(), 0, 'an unknown id is dropped');
    for (const id of await page.locator('[data-testid^="drift-volume-"]').evaluateAll((inputs) => inputs.map((input) => input.getAttribute('data-testid').slice('drift-volume-'.length)))) {
      const value = Number(await sliderValue(`drift-volume-${id}`));
      assert.ok(Number.isFinite(value) && value >= 0 && value <= 100, `${id} volume ${value} is in range`);
    }
    const master = Number(await sliderValue('drift-master'));
    assert.ok(master >= 0 && master <= 100, `master ${master} is in range`);
    assert.equal(await page.getByTestId('drift-card-pink-noise-favorite').getAttribute('aria-pressed'), 'true', 'a known favourite survives');
    assert.equal(await page.getByTestId('drift-filter-all').getAttribute('aria-pressed'), 'true', 'an unknown filter falls back to All');
  });

  await check('the window raised no uncaught exception while Drift was used', async () => {
    assert.deepEqual(pageErrors, []);
  });
} finally {
  await closeApp();
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\n[e2e-drift] ${failures.length} check(s) failed, ${checks} passed:`);
  for (const name of failures) console.error(`  - ${name}`);
  process.exit(1);
}
console.log(`\n[e2e-drift] all ${checks} checks passed${packagedExecutable ? ` (packaged: ${packagedExecutable})` : ''}`);
