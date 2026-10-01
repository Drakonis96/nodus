// Verify the real header, native view and page preload with a silent WebAudio
// reader. Run after npm run build. Optional macOS volume verification restores
// the original output setting: NODUS_VERIFY_SYSTEM_VOLUME=1 node scripts/verify-browser-media-live.mjs
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const profile = await mkdtemp(path.join(os.tmpdir(), 'nodus-browser-media-'));
const library = path.join(profile, 'library');
await mkdir(library);
await writeFile(path.join(profile, 'app-prefs.json'), JSON.stringify({
  recoverySetupVersion: 1, firstVaultVersion: 1, basicsTutorialVersion: 999,
  mascotEnabled: false, mascotStyleChosen: true, uiLanguage: 'es',
  autoBackupFolder: library, autoBackupEnabled: false, libraryGlobalEnabled: true,
}));

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><title>WebAudio reader</title>
    <h1>Reader</h1><button aria-label="Play">Another book</button>
    ${url.searchParams.has('standby') ? '<audio preload="none"></audio>'.repeat(8) : ''}
    <section id="player"><input aria-label="Progress" type="range"><button id="toggle" aria-label="Play">Play</button></section>
    <script>
      const context = new AudioContext();
      const gain = context.createGain(); gain.gain.value = 0;
      const tone = context.createOscillator(); tone.connect(gain); gain.connect(context.destination); tone.start();
      context.suspend();
      window.__clicks = 0; window.__refusePause = false;
      function render() {
        const playing = context.state === 'running';
        const button = document.createElement('button');
        button.id = 'toggle'; button.setAttribute('aria-label', playing ? 'Pause' : 'Play');
        button.textContent = playing ? 'Pause' : 'Play';
        button.onclick = async () => {
          window.__clicks++;
          if (context.state === 'running' && window.__refusePause) return;
          await (context.state === 'running' ? context.suspend() : context.resume());
          render();
        };
        document.getElementById('toggle').replaceWith(button);
      }
      context.onstatechange = render;
      window.__reader = () => ({ state: context.state, clicks: window.__clicks });
      render();
    </script>`);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let app, page, originalVolume, originalMute;
const systemScript = (script) => new Promise((resolve, reject) => {
  execFile('osascript', ['-e', script], { timeout: 2_000 }, (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
});
const waitFor = async (read, predicate, label) => {
  const until = Date.now() + 10_000;
  let last;
  while (Date.now() < until) {
    last = await read();
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`Timed out: ${label}; last=${JSON.stringify(last)}`);
};
try {
  const env = { ...process.env, NODUS_USERDATA: profile, NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available' };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: require('electron'), args: [repo], env });
  await app.evaluate(({ app }) => {
    globalThis.__mediaPreloadErrors = [];
    app.on('web-contents-created', (_, contents) => {
      contents.on('preload-error', (_, file, error) => globalThis.__mediaPreloadErrors.push({ file, error: String(error) }));
    });
  });
  page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(window.nodus));
  await page.evaluate(async (version) => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    localStorage.setItem('nodus.mobileTeaserSeen.3.2.4', '1');
    localStorage.setItem('nodus.platformHighlightsSeen.2026-07', '1');
    localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
    localStorage.setItem('nodus.toolkitBetaGuideSeen.2.4.0', '1');
    localStorage.setItem('nodus.pdfPresenterTutorialSeen.e2js_u-05OA', '1');
    await window.nodus.updateSettings({ onboardingComplete: true, tourComplete: true, advancedTourComplete: true, basicsTutorialVersion: 999, mascotStyleChosen: true });
    await window.nodus.setResearchPreparationPolicy({ welcomeVersion: 1, decision: 'declined' });
  }, require(path.join(repo, 'package.json')).version);
  await page.reload();
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
  const modal = page.getByTestId('startup-update-modal');
  await modal.waitFor({ state: 'visible', timeout: 6_000 }).catch(() => {});
  if (await modal.count()) await modal.getByRole('button', { name: 'Entendido', exact: false }).click();
  await page.locator('[data-tour="nav-browser"]').click();
  console.log('Isolated Nodus browser ready');
  const call = (method, ...args) => page.evaluate(([name, rest]) => window.nodus[name](...rest), [method, args]);
  const media = () => call('getBrowserMedia');
  await waitFor(() => call('getBrowserState'), (state) => state.tabs.length > 0, 'initial browser tab');
  const player = (script) => app.evaluate(async ({ webContents }, { origin, script }) => {
    const target = webContents.getAllWebContents().find((wc) => wc.getURL().startsWith(origin));
    if (!target) throw new Error('reader view missing');
    return target.executeJavaScript(script, true);
  }, { origin, script });

  for (const standby of [false, true]) {
    await call('submitBrowserOmnibox', `${origin}/reader${standby ? '?standby=1' : ''}`);
    await waitFor(() => call('getBrowserState'), (state) => state.tabs.some((tab) => tab.url.startsWith(origin) && !tab.loading), 'reader navigation');
    await player('document.getElementById("toggle").click()');
    await waitFor(media, (states) => states[0]?.playing === true, 'page-side WebAudio play reaches header');
    await page.getByTestId('browser-media-header-action').getByRole('button', { name: 'Medios', exact: true }).click();
    const panel = page.getByTestId('browser-media-popover');
    await panel.waitFor({ state: 'visible' });
    await panel.getByRole('button', { name: 'Pausar', exact: true }).click();
    await waitFor(() => player('window.__reader()'), (state) => state.state === 'suspended', 'header pauses actual WebAudio');
    await waitFor(media, (states) => states[0]?.playing === false, 'header reports paused');
    await panel.getByRole('button', { name: 'Reproducir', exact: true }).click();
    await waitFor(() => player('window.__reader()'), (state) => state.state === 'running' && state.clicks === 3, 'header resumes same player exactly once');
    await waitFor(media, (states) => states[0]?.playing === true, 'header reports resumed');

    await player('window.__refusePause = true');
    await panel.getByRole('button', { name: 'Pausar', exact: true }).click();
    await waitFor(() => player('window.__reader()'), (state) => state.clicks === 4, 'refused pause received');
    await page.waitForTimeout(300);
    assert.equal((await media())[0].playing, true, 'a refused click must never claim paused');
    await player('window.__refusePause = false');
    await panel.getByRole('button', { name: 'Pausar', exact: true }).click();
    await waitFor(media, (states) => states[0]?.playing === false, 'pause after refusal');
    await page.keyboard.press('Escape');
    await panel.waitFor({ state: 'detached' });
    console.log(`PASS actual WebAudio pause/resume, refused pause and hidden view (${standby ? '8 standby audio tags' : 'no audio tags'})`);
  }

  if (process.platform === 'darwin' && process.env.NODUS_VERIFY_SYSTEM_VOLUME === '1') {
    originalVolume = await call('getBrowserDeviceVolume');
    originalMute = await systemScript('output muted of (get volume settings)');
    await page.getByTestId('browser-media-header-action').getByRole('button', { name: 'Medios', exact: true }).click();
    const slider = page.getByTestId('browser-device-volume').getByRole('slider');
    await waitFor(() => slider.isEnabled(), Boolean, 'volume is ready');
    const started = Date.now();
    await page.evaluate(async () => {
      await Promise.all([40, 41, 45, 50, 55, 60].map((v) => window.nodus.setBrowserDeviceVolume(v)));
    });
    const writeMs = Date.now() - started;
    assert.equal(await call('getBrowserDeviceVolume'), 60);
    assert.equal(await systemScript('output volume of (get volume settings)'), '60');
    await waitFor(() => slider.inputValue(), (value) => value === '60', 'slider follows computer');
    console.log(`PASS rapid 40 → 60 reaches actual macOS output (${writeMs} ms for the writes; verified independently through AppleScript)`);
    await systemScript('set volume output volume 43');
    await waitFor(() => slider.inputValue(), (value) => value === '43', 'external system change reaches open slider');
    console.log('PASS open slider follows external macOS volume change');
  }
} catch (error) {
  console.error(error);
  if (app) console.error('Reader at failure:', JSON.stringify(await app.evaluate(async ({ webContents }, origin) => ({
    errors: globalThis.__mediaPreloadErrors,
    pages: await Promise.all(webContents.getAllWebContents().filter((wc) => wc.getURL().startsWith(origin)).map(async (wc) => ({
      url: wc.getURL(), state: await wc.executeJavaScript('({reader: window.__reader?.(), ready: document.readyState, buttons: [...document.querySelectorAll("button")].map(b => ({label:b.getAttribute("aria-label"),rects:b.getClientRects().length})), html:document.getElementById("player")?.outerHTML})'),
    }))),
  }), origin)));
  if (page) console.error('Visible page at failure:', (await page.locator('body').innerText()).slice(-3_000));
  throw error;
} finally {
  try {
    if (app && originalVolume !== undefined) {
      await page.evaluate((value) => window.nodus.setBrowserDeviceVolume(value), originalVolume);
      if (originalMute !== undefined) await systemScript(`set volume output muted ${originalMute === 'true' ? 'true' : 'false'}`);
      console.log(`Restored original system output: ${originalVolume}%, muted=${originalMute}`);
    }
  } finally {
    if (app) await app.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(profile, { recursive: true, force: true });
  }
}
