// End-to-end: Nodus Browser against REAL pages, in the REAL app.
//
// Everything else in this feature is unit tests and static scans over source.
// This is the first thing that actually loads a page into a WebContentsView, so
// it is where "it compiles" becomes "it works".
//
// Pages are served by a local fixture server started here — the same pattern
// e2e-smoke.mjs uses for its fake Zotero API — so the suite never touches the
// public internet and never depends on a third party being up.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// Re-exec under Electron-as-Node so better-sqlite3 matches the app ABI, exactly
// as every other script in this suite does.
if (!process.argv.includes('--run')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/e2e-browser.mjs'), '--run'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' },
  );
  process.exit(0);
}

if (!existsSync(path.join(repoRoot, 'dist-electron/main.js')) || !existsSync(path.join(repoRoot, 'dist/index.html'))) {
  console.log('[e2e-browser] no build found — running npm run build first…');
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
}

/* ------------------------------------------------------------------ fixtures */

const PAGES = {
  '/': `<!doctype html><html><head><title>Fixture home</title></head>
        <body><main><h1>Fixture home</h1><p>Plain page for navigation tests.</p>
        <a id="next" href="/second">second</a>
        <a id="blank" href="/second" target="_blank">new tab</a></main></body></html>`,

  '/second': `<!doctype html><html><head><title>Second page</title></head>
        <body><main><h1>Second</h1></main></body></html>`,

  // A publisher-shaped page: Highwire tags are the highest-precedence source.
  '/paper': `<!doctype html><html><head><title>Publisher page</title>
        <meta name="citation_title" content="Structures of the Longue Durée">
        <meta name="citation_author" content="Braudel, Fernand">
        <meta name="citation_journal_title" content="Annales">
        <meta name="citation_publication_date" content="1958/10/01">
        <meta name="citation_doi" content="10.1234/annales.1958.001">
        <meta name="citation_volume" content="13">
        </head><body><main><h1>Structures</h1></main></body></html>`,

  '/media': `<!doctype html><html><head><title>Media page</title></head><body><main>
        <audio id="a" controls loop>
          <source src="/tone.wav" type="audio/wav">
        </audio></main></body></html>`,

  '/storage': `<!doctype html><html><head><title>Storage page</title></head><body><main>
        <script>
          document.cookie = 'nodus_e2e=1; path=/; max-age=3600';
          localStorage.setItem('nodus_e2e', 'yes');
        </script>
        <h1>Storage seeded</h1></main></body></html>`,
};

let server;
let origin = '';

async function startFixtures() {
  server = createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    if (url.pathname === '/tone.wav') {
      // 1 second of silence: enough for Chromium to report media playing.
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
    const body = PAGES[url.pathname];
    if (!body) { response.statusCode = 404; response.end('not found'); return; }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  console.log(`[e2e-browser] fixtures at ${origin}`);
}

/* ---------------------------------------------------------------------- run */

const failures = [];
let checks = 0;
async function check(name, fn) {
  try {
    await fn();
    checks += 1;
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`  FAIL ${name}: ${error?.message ?? error}`);
  }
}

const profile = await mkdtemp(path.join(os.tmpdir(), 'nodus-e2e-browser-'));
await mkdir(profile, { recursive: true });
// Skip the "we detected a previous installation" recovery wall, which otherwise
// covers the app before any test can reach the browser section.
// recoverySetupVersion skips the "previous installation detected" wall;
// firstVaultVersion skips the first-vault wizard, which otherwise replaces the
// whole shell and makes the sidebar — and therefore the browser entry —
// unreachable.
await writeFile(
  path.join(profile, 'app-prefs.json'),
  JSON.stringify({
    recoverySetupVersion: 1,
    firstVaultVersion: 1,
    // The basics tutorial opens on a language picker that covers the shell.
    basicsTutorialVersion: 999,
    mascotEnabled: false,
    mascotStyleChosen: true,
    tutorialVideosWatched: [],
    uiLanguage: 'es',
  }),
  'utf8',
);

await startFixtures();

// The parent re-execs under ELECTRON_RUN_AS_NODE; the launched app must NOT
// inherit it, or Electron starts as a headless Node process, never opens a
// window, and Playwright waits for a DevTools line that never comes.
const childEnv = {
  ...process.env,
  NODUS_USERDATA: profile,
  NODUS_DISABLE_AUTO_UPDATE: '1',
  NODUS_E2E_UPDATE_STATUS: 'not-available',
};
delete childEnv.ELECTRON_RUN_AS_NODE;

let app;
try {
  app = await electron.launch({
    // Without executablePath Playwright resolves its own Electron and fails to
    // launch; every other e2e script in this suite passes it for the same reason.
    executablePath: require('electron'),
    args: [repoRoot],
    env: childEnv,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(async (version) => {
    // Onboarding and the in-app tours are vault settings, not global preferences,
    // so writing them to app-prefs.json above would be silently ignored. Seed the
    // active vault through the same IPC path the UI uses, then reload into the shell.
    localStorage.setItem('nodus.lastSeenVersion', version);
    localStorage.setItem('nodus.mobileTeaserSeen.3.2.4', '1');
    localStorage.setItem('nodus.platformHighlightsSeen.2026-07', '1');
    localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
    localStorage.setItem('nodus.toolkitBetaGuideSeen.2.4.0', '1');
    await window.nodus.updateSettings({
      onboardingComplete: true,
      tourComplete: true,
      advancedTourComplete: true,
    });
  }, require(path.join(repoRoot, 'package.json')).version);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  const updateModal = page.getByTestId('startup-update-modal');
  if (await updateModal.count()) {
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="startup-update-modal"]')?.getAttribute('data-update-status') === 'not-available');
    await updateModal.getByRole('button', { name: 'Entendido', exact: false }).click();
    await updateModal.waitFor({ state: 'detached' });
  }

  /** Drive the browser through the real bridge, exactly as the UI does. */
  const call = (method, ...args) =>
    page.evaluate(([name, rest]) => window.nodus[name](...rest), [method, args]);

  const state = async () => call('getBrowserState');
  const waitFor = async (predicate, description, timeoutMs = 15000) => {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
      last = await state();
      if (predicate(last)) return last;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`timed out waiting for ${description}; last state: ${JSON.stringify(last)}`);
  };

  await check('entering through the UI gives the page a non-zero viewport', async () => {
    await page.locator('[data-tour="nav-browser"]').click();
    const viewport = page.locator('[data-browser-viewport]');
    await viewport.waitFor({ state: 'visible' });
    await page.getByTestId('browser-omnibox').fill(`${origin}/`);
    await page.getByTestId('browser-omnibox').press('Enter');
    await waitFor(
      (s) => s.tabs.some((tab) => tab.url === `${origin}/` && !tab.loading),
      'the fixture home entered through the omnibox',
    );
    const rendererBounds = await viewport.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });

    const nativeViews = await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      return window.contentView.children.map((view) => ({
        url: 'webContents' in view ? view.webContents.getURL() : null,
        bounds: view.getBounds(),
      }));
    });
    const browserView = nativeViews.find((view) => view.url === `${origin}/`);

    assert.ok(rendererBounds.width > 0 && rendererBounds.height > 0,
      `renderer published ${JSON.stringify(rendererBounds)}`);
    assert.ok(browserView, `no browser WebContentsView found: ${JSON.stringify(nativeViews)}`);
    assert.deepEqual(browserView.bounds, {
      x: Math.round(rendererBounds.x),
      y: Math.round(rendererBounds.y),
      width: Math.round(rendererBounds.width),
      height: Math.round(rendererBounds.height),
    }, `native view did not receive the renderer rectangle ${JSON.stringify(rendererBounds)}`);
  });

  await check('a tab opens and loads a real page', async () => {
    await call('openBrowserTab', `${origin}/`);
    const loaded = await waitFor(
      (s) => s.tabs.some((tab) => tab.url.startsWith(origin) && !tab.loading),
      'the fixture home to finish loading',
    );
    const tab = loaded.tabs.find((entry) => entry.url.startsWith(origin));
    assert.equal(tab.title, 'Fixture home', 'the page title must reach the tab state');
    assert.equal(tab.error, null, 'a good page must report no error');
  });

  await check('a page gets no bridge, no ipcRenderer and no require', async () => {
    // The single most important property of the whole feature.
    const [browserView] = app.windows().length > 1 ? app.windows().slice(1) : [];
    // The page lives in a WebContentsView, not a window, so it is reached
    // through the main process rather than through Playwright's window list.
    const exposed = await app.evaluate(async ({ webContents }) => {
      const target = webContents.getAllWebContents().find((wc) => wc.getURL().startsWith('http://127.0.0.1'));
      if (!target) return null;
      return target.executeJavaScript(
        '({ nodus: typeof window.nodus, require: typeof window.require, process: typeof window.process, ipc: typeof window.ipcRenderer })',
      );
    });
    assert.ok(exposed, 'the fixture page must be running in a WebContents');
    assert.equal(exposed.nodus, 'undefined', 'a page must not see window.nodus');
    assert.equal(exposed.require, 'undefined', 'a page must not see require');
    assert.equal(exposed.process, 'undefined', 'a page must not see process');
    assert.equal(exposed.ipc, 'undefined', 'a page must not see ipcRenderer');
    void browserView;
  });

  await check('the address bar refuses file: and the nodus vault schemes', async () => {
    for (const blocked of ['file:///etc/passwd', 'nodus-library://item/1', 'javascript:alert(1)']) {
      const result = await call('submitBrowserOmnibox', blocked);
      assert.equal(result.kind, 'blocked', `${blocked} must be refused`);
    }
  });

  await check('a bare term searches instead of failing', async () => {
    const result = await call('submitBrowserOmnibox', 'braudel mediterranean');
    assert.equal(result.kind, 'search');
    assert.match(result.url, /^https:\/\//);
  });

  await check('back and forward move through real history', async () => {
    await call('submitBrowserOmnibox', `${origin}/second`);
    await waitFor((s) => s.tabs.some((t) => t.url.endsWith('/second') && !t.loading), 'the second page');
    await call('browserGoBack');
    await waitFor((s) => s.tabs.some((t) => t.url === `${origin}/` && !t.loading), 'going back home');
    await call('browserGoForward');
    await waitFor((s) => s.tabs.some((t) => t.url.endsWith('/second') && !t.loading), 'going forward again');
  });

  await check('a failed navigation produces a real error state', async () => {
    await call('submitBrowserOmnibox', 'http://127.0.0.1:1/nothing');
    const failed = await waitFor((s) => s.tabs.some((t) => t.error), 'a navigation failure');
    const tab = failed.tabs.find((entry) => entry.error);
    assert.ok(['refused', 'unknown', 'timeout', 'dns'].includes(tab.error.kind), `unexpected kind: ${tab.error.kind}`);
  });

  await check('Add to Library reads real publisher metadata off the page', async () => {
    await call('submitBrowserOmnibox', `${origin}/paper`);
    await waitFor((s) => s.tabs.some((t) => t.url.endsWith('/paper') && !t.loading), 'the publisher page');
    const preview = await call('captureBrowserPage');
    assert.ok(preview, 'the page must yield a capture');
    assert.equal(preview.request.metadataSource, 'highwire', 'Highwire tags must win');
    assert.equal(preview.request.metadata.title, 'Structures of the Longue Durée');
    assert.equal(preview.request.metadata.doi, '10.1234/annales.1958.001');
    assert.equal(preview.request.metadata.publicationTitle, 'Annales');
    const authors = preview.request.metadata.creators.map((c) => c.lastName);
    assert.ok(authors.includes('Braudel'), `expected Braudel, got ${JSON.stringify(authors)}`);
  });

  await check('Ask Nodi puts the real page text into the Nodi context', async () => {
    const ok = await call('askNodiAboutBrowserPage');
    assert.equal(ok, true, 'the page must yield text');
    const context = await page.evaluate(() => window.nodus.getNodiViewContext());
    assert.equal(context.viewId, 'browser');
    assert.match(context.text, /Structures/, 'the captured text must be the page contents');
  });

  await check('cookies and localStorage written by a page really persist', async () => {
    await call('submitBrowserOmnibox', `${origin}/storage`);
    await waitFor((s) => s.tabs.some((t) => t.url.endsWith('/storage') && !t.loading), 'the storage page');
    const report = await waitFor(async () => true, 'noop').then(() => call('getBrowserStorage', true));
    assert.ok(report.cookieCount >= 1, `expected a cookie, got ${report.cookieCount}`);
    assert.ok(report.sites.some((site) => site.origin.includes('127.0.0.1')), 'the fixture host must appear');
  });

  await check('clearing cookies actually removes them', async () => {
    const after = await call('clearBrowserData', ['cookies']);
    assert.equal(after.cookieCount, 0, 'no cookie may survive a cookie wipe');
  });

  await check('media playing raises a session, and PAUSING KEEPS IT', async () => {
    await call('submitBrowserOmnibox', `${origin}/media`);
    await waitFor((s) => s.tabs.some((t) => t.url.endsWith('/media') && !t.loading), 'the media page');
    await app.evaluate(async ({ webContents }) => {
      const target = webContents.getAllWebContents().find((wc) => wc.getURL().endsWith('/media'));
      await target.executeJavaScript('document.getElementById("a").play()', true);
    });

    const started = Date.now();
    let media = [];
    while (Date.now() - started < 15000) {
      media = await call('getBrowserMedia');
      if (media.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    assert.ok(media.length > 0, 'playing audio must create a media session');

    // The regression this feature is most likely to ship: the header control
    // must survive a pause, or the user loses the Play button they need.
    await app.evaluate(async ({ webContents }) => {
      const target = webContents.getAllWebContents().find((wc) => wc.getURL().endsWith('/media'));
      await target.executeJavaScript('document.getElementById("a").pause()', true);
    });
    await new Promise((resolve) => setTimeout(resolve, 800));
    const afterPause = await call('getBrowserMedia');
    assert.ok(afterPause.length > 0, 'the media session must survive a pause');
    assert.equal(afterPause[0].hasMedia, true);
  });

  await check('tabs close without leaking WebContents', async () => {
    const before = await app.evaluate(({ webContents }) => webContents.getAllWebContents().length);
    const ids = [];
    for (let index = 0; index < 4; index += 1) ids.push(await call('openBrowserTab', `${origin}/second`));
    await waitFor((s) => s.tabs.length >= 5, 'the extra tabs to exist');
    for (const id of ids) await call('closeBrowserTab', id);

    const deadline = Date.now() + 10000;
    let now = before;
    while (Date.now() < deadline) {
      now = await app.evaluate(({ webContents }) => webContents.getAllWebContents().length);
      if (now <= before) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.ok(now <= before, `WebContents leaked: ${before} before, ${now} after`);
  });

  await check('the tab cap cannot be exceeded', async () => {
    const opened = [];
    for (let index = 0; index < 20; index += 1) {
      const id = await call('openBrowserTab', `${origin}/second`);
      if (id) opened.push(id);
    }
    const current = await state();
    assert.ok(current.tabs.length <= 12, `the cap must hold, got ${current.tabs.length} tabs`);
  });

  await check('the main window is still responsive after all of that', async () => {
    const settings = await page.evaluate(() => window.nodus.getSettings());
    assert.ok(settings, 'IPC must still round-trip');
  });
} finally {
  if (app) await app.close().catch(() => undefined);
  server?.close();
  await rm(profile, { recursive: true, force: true }).catch(() => undefined);
}

console.log(`\n[e2e-browser] ${checks} checks passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error(`[e2e-browser] failures:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
