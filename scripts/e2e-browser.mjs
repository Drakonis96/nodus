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
        <body><main><h1>Second</h1><a id="slow" href="/slow-page">slow page</a></main></body></html>`,

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
        </audio>
        <audio id="b" controls loop>
          <source src="/tone.wav" type="audio/wav">
        </audio></main></body></html>`,

  '/storage': `<!doctype html><html><head><title>Storage page</title></head><body><main>
        <script>
          document.cookie = 'nodus_e2e=1; path=/; max-age=3600';
          localStorage.setItem('nodus_e2e', 'yes');
        </script>
        <h1>Storage seeded</h1></main></body></html>`,

  '/download': `<!doctype html><html><head><title>Download page</title></head><body><main>
        <a id="slow-download" href="/slow-download.bin" download>Download slowly</a>
        </main></body></html>`,

  // Deliberately hostile. Every assertion below is observed from inside this
  // renderer, not inferred from WebPreferences in the main process.
  '/hostile': `<!doctype html><html><head><title>Hostile fixture</title></head><body><main>
        <h1>Hostile fixture</h1>
        <a id="normal-link" href="/second">normal link</a>
        <button id="popup" onclick="window.open('/second')">popup</button>
        <button id="external" onclick="window.open('shell://run/anything')">external</button>
        <iframe id="internal-frame" src="nodus-library://item/secret"></iframe>
        <script>
          window.hostileReport = (async () => {
            const timeout = (label) => new Promise((resolve) => setTimeout(() => resolve('timeout:' + label), 3000));
            const fails = (label, fn) => Promise.race([
              Promise.resolve().then(fn).then(() => false, () => true),
              timeout(label),
            ]);
            const geolocation = await Promise.race([
              navigator.permissions.query({ name: 'geolocation' })
                .then((value) => value.state).catch(() => 'denied'),
              timeout('geolocation'),
            ]);
            const notifications = typeof Notification === 'undefined'
              ? 'unavailable'
              : await Promise.race([Notification.requestPermission().catch(() => 'denied'), timeout('notifications')]);
            return {
              nodus: typeof window.nodus,
              require: typeof window.require,
              process: typeof window.process,
              ipcRenderer: typeof window.ipcRenderer,
              electron: typeof window.electron,
              fs: typeof window.fs,
              path: typeof window.path,
              childProcess: typeof window.child_process,
              fileFetchBlocked: await fails('file', () => fetch('file:///etc/passwd')),
              libraryFetchBlocked: await fails('library', () => fetch('nodus-library://item/secret')),
              imageFetchBlocked: await fails('image', () => fetch('nodus-image://vault/secret.png')),
              archiveFetchBlocked: await fails('archive', () => fetch('nodus-archive://vault/secret')),
              geolocation,
              notifications,
              displayCaptureBlocked: !navigator.mediaDevices?.getDisplayMedia
                || await fails('display', () => navigator.mediaDevices.getDisplayMedia({ video: true })),
            };
          })();
        </script></main></body></html>`,
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
    if (url.pathname === '/slow-download.bin') {
      // Long enough for the restart action to observe and warn about it.
      const total = 16 * 1024 * 1024;
      let sent = 0;
      response.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="restart-e2e.bin"',
        'Content-Length': total,
      });
      const timer = setInterval(() => {
        if (sent >= total || response.destroyed) {
          clearInterval(timer);
          if (!response.destroyed) response.end();
          return;
        }
        const size = Math.min(64 * 1024, total - sent);
        sent += size;
        response.write(Buffer.alloc(size, 0x5a));
      }, 50);
      response.once('close', () => clearInterval(timer));
      return;
    }
    if (url.pathname === '/slow-page') {
      // Keep the document loading long enough to prove that the trusted
      // address bar changes at navigation time, rather than at load completion.
      setTimeout(() => {
        if (response.destroyed) return;
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end('<!doctype html><html><head><title>Slow page</title></head><body><h1>Slow page</h1></body></html>');
      }, 1_500);
      return;
    }
    if (url.pathname === '/redirect-internal') {
      response.writeHead(302, { Location: 'nodus-library://item/secret' });
      response.end();
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
const libraryRoot = path.join(profile, 'library-root');
await mkdir(libraryRoot, { recursive: true });
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
    // The Library needs a durable root, but this suite must never run a backup.
    // Keeping the two settings explicit catches the same configuration used by
    // the manual no-backup browser profile.
    autoBackupFolder: libraryRoot,
    autoBackupEnabled: false,
    libraryGlobalEnabled: true,
    browserDownloadFolder: libraryRoot,
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

  await check('the address bar changes before a slow page finishes loading', async () => {
    await call('submitBrowserOmnibox', `${origin}/second`);
    await waitFor(
      (s) => s.tabs.find((tab) => tab.id === s.activeTabId)?.url === `${origin}/second`
        && !s.tabs.find((tab) => tab.id === s.activeTabId)?.loading,
      'the active fixture page before slow navigation',
    );

    await app.evaluate(async ({ webContents }, sourceUrl) => {
      const target = webContents.getAllWebContents().find((contents) => contents.getURL() === sourceUrl);
      if (!target) throw new Error(`the active browser fixture is missing at ${sourceUrl}`);
      await target.executeJavaScript("document.querySelector('#slow').click()", true);
    }, `${origin}/second`);

    const navigating = await waitFor((s) => {
      const active = s.tabs.find((tab) => tab.id === s.activeTabId);
      return active?.url === `${origin}/slow-page` && active.loading;
    }, 'the slow destination to reach state while still loading', 1_000);
    assert.equal(navigating.tabs.find((tab) => tab.id === navigating.activeTabId)?.url, `${origin}/slow-page`);
    await page.waitForFunction((url) => {
      const input = document.querySelector('[data-testid="browser-omnibox"]');
      return input instanceof HTMLInputElement && input.value === url;
    }, `${origin}/slow-page`);

    await waitFor(
      (s) => s.tabs.find((tab) => tab.id === s.activeTabId)?.url === `${origin}/slow-page`
        && !s.tabs.find((tab) => tab.id === s.activeTabId)?.loading,
      'the slow page to finish loading',
    );
  });

  await check('browser chrome and pages inherit light, dark and system themes', async () => {
    const originalTheme = (await call('getSettings')).theme;
    const pagePrefersDark = () => app.evaluate(async ({ webContents }) => {
      const target = webContents.getAllWebContents().find((wc) => wc.getURL().startsWith('http://127.0.0.1'));
      if (!target) throw new Error('the browser page is missing');
      return target.executeJavaScript("matchMedia('(prefers-color-scheme: dark)').matches");
    });
    const waitForPageTheme = async (dark) => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        if (await pagePrefersDark() === dark) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.equal(await pagePrefersDark(), dark, 'the page did not receive the effective theme');
    };
    const omniboxColor = () => page.getByTestId('browser-omnibox-shell')
      .evaluate((element) => getComputedStyle(element).backgroundColor);

    await call('updateSettings', { theme: 'light' });
    await page.waitForFunction(() => document.documentElement.classList.contains('light'));
    await waitForPageTheme(false);
    const lightColor = await omniboxColor();
    assert.equal(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource), 'light');

    await call('updateSettings', { theme: 'dark' });
    await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
    await waitForPageTheme(true);
    const darkColor = await omniboxColor();
    assert.equal(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource), 'dark');
    assert.notEqual(lightColor, darkColor, 'the browser chrome did not change theme');

    await call('updateSettings', { theme: 'system' });
    const systemDark = await app.evaluate(({ nativeTheme }) => ({
      source: nativeTheme.themeSource,
      dark: nativeTheme.shouldUseDarkColors,
    }));
    assert.equal(systemDark.source, 'system');
    await waitForPageTheme(systemDark.dark);

    await call('updateSettings', { theme: originalTheme });
    const restoredDark = await app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors);
    await waitForPageTheme(restoredDark);
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

  await check('a hostile page cannot reach Node, IPC, files, vault protocols or forbidden permissions', async () => {
    await call('submitBrowserOmnibox', `${origin}/hostile`);
    await waitFor((s) => s.tabs.some((t) => t.url.endsWith('/hostile') && !t.loading), 'the hostile fixture');
    const report = await app.evaluate(async ({ webContents }) => {
      const target = webContents.getAllWebContents().find((wc) => wc.getURL().endsWith('/hostile'));
      if (!target) throw new Error('hostile Browser renderer missing');
      return target.executeJavaScript('window.hostileReport', true);
    });
    for (const name of ['nodus', 'require', 'process', 'ipcRenderer', 'electron', 'fs', 'path', 'childProcess']) {
      assert.equal(report[name], 'undefined', `${name} leaked into untrusted content`);
    }
    for (const name of ['fileFetchBlocked', 'libraryFetchBlocked', 'imageFetchBlocked', 'archiveFetchBlocked']) {
      assert.equal(report[name], true, `${name} must be true`);
    }
    assert.equal(report.geolocation, 'denied', 'geolocation must fail closed without prompting');
    assert.notEqual(report.notifications, 'granted', 'notifications must never be granted');
    assert.notEqual(report.displayCaptureBlocked, false,
      `display capture acquired a stream: ${String(report.displayCaptureBlocked)}`);

    const frameUrls = await app.evaluate(({ webContents }) => {
      const target = webContents.getAllWebContents().find((wc) => wc.getURL().endsWith('/hostile'));
      return target?.mainFrame.frames.map((frame) => frame.url) ?? [];
    });
    assert.equal(frameUrls.some((url) => url.startsWith('nodus-library:')), false,
      `an iframe reached the Library protocol: ${JSON.stringify(frameUrls)}`);
  });

  await check('popups are controlled tabs with identical security settings and custom schemes are denied', async () => {
    const before = await state();
    await app.evaluate(async ({ webContents }) => {
      const target = webContents.getAllWebContents().find((wc) => wc.getURL().endsWith('/hostile'));
      if (!target) throw new Error('hostile Browser renderer missing');
      await target.executeJavaScript(`document.getElementById('external').click()`, true);
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal((await state()).tabs.length, before.tabs.length,
      'a privileged external/custom scheme must not create a tab or BrowserWindow');

    await app.evaluate(async ({ webContents }) => {
      const target = webContents.getAllWebContents().find((wc) => wc.getURL().endsWith('/hostile'));
      await target.executeJavaScript(`document.getElementById('popup').click()`, true);
    });
    await waitFor((s) => s.tabs.length === before.tabs.length + 1 && s.tabs.some((t) => t.url.endsWith('/second') && !t.loading),
      'a controlled popup tab');
    const popup = await app.evaluate(async ({ session, webContents }) => {
      const browserSession = session.fromPartition('persist:nodus-browser');
      const target = webContents.getAllWebContents().find((wc) => wc.session === browserSession && wc.getURL().endsWith('/second'));
      if (!target) return null;
      const prefs = target.getLastWebPreferences();
      const workerGlobals = await target.executeJavaScript(`new Promise((resolve) => {
        const worker = new Worker(URL.createObjectURL(new Blob([
          "postMessage({ process: typeof process, require: typeof require })"
        ], { type: 'text/javascript' })));
        worker.onmessage = (event) => { resolve(event.data); worker.terminate(); };
        worker.onerror = () => resolve({ process: 'unavailable', require: 'unavailable' });
      })`, true);
      target.openDevTools({ mode: 'detach' });
      await new Promise((resolve) => setTimeout(resolve, 100));
      return {
        sandbox: prefs.sandbox,
        contextIsolation: prefs.contextIsolation,
        nodeIntegration: prefs.nodeIntegration,
        webSecurity: prefs.webSecurity,
        devToolsOpened: target.isDevToolsOpened(),
        workerGlobals,
        browserSession: target.session === browserSession,
      };
    });
    assert.deepEqual(popup, {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      devToolsOpened: false,
      workerGlobals: { process: 'undefined', require: 'undefined' },
      browserSession: true,
    });
  });

  await check('an HTTP redirect cannot cross into a Nodus custom protocol', async () => {
    await call('submitBrowserOmnibox', `${origin}/redirect-internal`);
    const blocked = await waitFor(
      (s) => s.tabs.some((t) => t.error?.kind === 'blocked-scheme'),
      'the custom-protocol redirect to be refused',
    );
    const tab = blocked.tabs.find((entry) => entry.error?.kind === 'blocked-scheme');
    assert.ok(tab, 'the trusted chrome must show a blocked-scheme state');
    assert.equal(tab.url.startsWith('nodus-library:'), false, 'the tab must never commit the privileged URL');
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

  await check('Add to Library saves while automatic backups are disabled', async () => {
    await call('submitBrowserOmnibox', `${origin}/`);
    await waitFor((s) => {
      const active = s.tabs.find((t) => t.id === s.activeTabId);
      return active?.url === `${origin}/` && !active.loading;
    }, 'the active capturable page');
    const preview = await call('captureBrowserPage');
    const saved = await call('saveBrowserCapture', preview.request, false);
    assert.equal(saved.ok, true);
    assert.equal(saved.title, 'Fixture home');
    assert.ok(saved.itemId, 'the saved Library item must have an id');
    const settings = await page.evaluate(() => window.nodus.getSettings());
    assert.equal(settings.autoBackupEnabled, false, 'saving must not silently enable backups');
  });

  await check('toolbar panels keep the native page visible instead of blanking it', async () => {
    const inspectActiveView = () => app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      const view = window.contentView.children.find((child) =>
        'webContents' in child && child.webContents.getURL().startsWith('http://127.0.0.1'));
      return view ? { bounds: view.getBounds() } : null;
    });
    const initial = await inspectActiveView();
    assert.ok(initial, 'the active native page must be attached');

    for (const label of ['Descargas', 'Configuración del navegador', 'Acciones de Nodus']) {
      await page.getByRole('button', { name: label, exact: true }).click();
      // ResizeObserver publishes on the next animation frame; wait for the
      // native child view to receive the smaller rectangle.
      await new Promise((resolve) => setTimeout(resolve, 150));
      const opened = await inspectActiveView();
      assert.ok(opened, `${label} detached the native page`);
      assert.ok(opened.bounds.height < initial.bounds.height, `${label} did not reserve chrome space`);
      await page.getByRole('button', { name: label, exact: true }).click();
    }
  });

  await check('Notifications sits above the browser and a page click closes it', async () => {
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      const view = window.contentView.children.find((child) => 'webContents' in child);
      if (!view) throw new Error('the active browser view is not attached');
      const calls = [];
      const original = view.setVisible.bind(view);
      view.setVisible = (visible) => {
        calls.push(visible);
        original(visible);
      };
      globalThis.__nodusBrowserVisibilityCalls = calls;
    });

    await page.getByRole('button', { name: 'Notificaciones', exact: true }).click();
    await page.getByTestId('header-notifications-panel').waitFor({ state: 'visible' });
    const snapshot = page.getByTestId('header-notifications-browser-snapshot');
    await snapshot.waitFor({ state: 'visible' });
    assert.match(await snapshot.getAttribute('src'), /^data:image\/png;base64,/, 'Notifications must preserve the page underneath');
    let hidden = false;
    const hiddenDeadline = Date.now() + 5_000;
    while (!hidden && Date.now() < hiddenDeadline) {
      hidden = await app.evaluate(() => globalThis.__nodusBrowserVisibilityCalls?.includes(false));
      if (!hidden) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(hidden, true, 'opening Notifications must hide the native page behind it');

    const backdrop = page.getByTestId('header-notifications-backdrop');
    const box = await backdrop.boundingBox();
    assert.ok(box, 'the notification backdrop must cover the browser');
    await backdrop.click({ position: { x: 12, y: box.height - 12 } });
    await page.getByTestId('header-notifications-panel').waitFor({ state: 'detached' });
    const restored = await app.evaluate(() => globalThis.__nodusBrowserVisibilityCalls?.at(-1));
    assert.equal(restored, true, 'closing Notifications must restore the native page');
  });

  await check('leaving and returning to Browser preserves the active tab', async () => {
    const before = await state();
    const activeBefore = before.tabs.find((tab) => tab.id === before.activeTabId);
    assert.ok(activeBefore, 'an active tab must exist before leaving');
    await page.locator('[data-tour="nav-ideas"]').click();
    await page.locator('[data-tour="nav-browser"]').click();
    await page.locator('[data-browser-viewport]').waitFor({ state: 'visible' });
    const after = await state();
    assert.equal(after.tabs.length, before.tabs.length, 'returning must not create a tab');
    assert.equal(after.activeTabId, before.activeTabId, 'the active tab must be preserved');
    assert.equal(after.tabs.find((tab) => tab.id === after.activeTabId)?.url, activeBefore.url);
  });

  await check('Nodi automatically sees the real active browser page', async () => {
    await call('submitBrowserOmnibox', `${origin}/`);
    await waitFor((s) => s.tabs.some((t) => t.url === `${origin}/` && !t.loading), 'the fixture home page');
    const started = Date.now();
    let context = null;
    while (Date.now() - started < 8_000) {
      context = await page.evaluate(() => window.nodus.getNodiViewContext());
      if (context?.viewId === 'browser' && /Fixture home/.test(context.text)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(context.viewId, 'browser');
    assert.match(context.text, /Fixture home/, 'the captured text must be the page contents');
    assert.match(context.text, new RegExp(origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the active URL must be present');
  });

  await check('both browser Ask Nodi buttons open chat with the requested context', async () => {
    await page.getByRole('button', { name: 'Acciones de Nodus', exact: true }).click();
    await page.getByRole('button', { name: 'Preguntar a Nodi sobre esta página', exact: true }).click();
    const chat = page.locator('.nodi-chat-panel');
    await chat.waitFor({ state: 'visible' });
    assert.match(await chat.locator('.nodi-chat-quote').innerText(), /Fixture home/);
    assert.match(await chat.locator('.nodi-chat-quote').innerText(), new RegExp(origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    await chat.getByRole('button', { name: 'Cerrar', exact: true }).click();

    await app.evaluate(async ({ webContents }) => {
      const target = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('http://127.0.0.1'));
      if (!target) throw new Error('browser fixture missing');
      await target.executeJavaScript(`
        (() => {
          const range = document.createRange();
          range.selectNodeContents(document.querySelector('h1'));
          const selection = getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        })()
      `, true);
    });
    await page.getByRole('button', { name: 'Acciones de Nodus', exact: true }).click();
    await page.getByRole('button', { name: 'Preguntar a Nodi sobre la selección', exact: true }).click();
    await chat.waitFor({ state: 'visible' });
    assert.equal((await chat.locator('.nodi-chat-quote').innerText()).trim(), 'Fixture home');
    await chat.getByRole('button', { name: 'Cerrar', exact: true }).click();
  });

  await check('every browser context-menu action has a native icon', async () => {
    // Give both navigation rows a live state so this exercises the complete
    // native menu in the same state a user sees after navigating.
    await call('submitBrowserOmnibox', `${origin}/second`);
    await waitFor((s) => s.tabs.some((tab) => tab.url === `${origin}/second` && !tab.loading), 'the second fixture page');
    await call('browserGoBack');
    await waitFor((s) => s.tabs.some((tab) => tab.url === `${origin}/` && !tab.loading), 'the fixture home with forward history');
    const items = await app.evaluate(({ Menu, webContents }) => {
      const original = Menu.prototype.popup;
      try {
        let captured = [];
        Menu.prototype.popup = function popupProbe() {
          captured = this.items.map((item) => ({
            label: item.label,
            type: item.type,
            hasIcon: Boolean(item.icon && !item.icon.isEmpty()),
          }));
        };
        const target = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('http://127.0.0.1'));
        if (!target) throw new Error('browser fixture missing');
        target.emit('context-menu', {}, {
          isEditable: false,
          selectionText: 'Fixture home',
          linkURL: `${target.getURL()}second`,
        });
        return captured;
      } finally {
        Menu.prototype.popup = original;
      }
    });
    const actions = items.filter((item) => item.type !== 'separator' && item.label);
    assert.ok(actions.length >= 10, `expected the complete menu, got ${JSON.stringify(items)}`);
    assert.deepEqual(actions.filter((item) => !item.hasIcon), [], `missing native icons: ${JSON.stringify(actions)}`);
  });

  await check('cookies and localStorage written by a page really persist', async () => {
    await call('submitBrowserOmnibox', `${origin}/storage`);
    await waitFor((s) => s.tabs.some((t) => t.url.endsWith('/storage') && !t.loading), 'the storage page');
    const report = await waitFor(async () => true, 'noop').then(() => call('getBrowserStorage', true));
    assert.ok(report.cookieCount >= 1, `expected a cookie, got ${report.cookieCount}`);
    assert.ok(report.sites.some((site) => site.origin.includes('127.0.0.1')), 'the fixture host must appear');
  });

  await check('Browser cookies and storage are isolated from the trusted default session', async () => {
    const isolation = await app.evaluate(async ({ session, webContents }, fixtureOrigin) => {
      const browserSession = session.fromPartition('persist:nodus-browser');
      await session.defaultSession.cookies.set({
        url: fixtureOrigin,
        name: 'trusted_default_only',
        value: 'secret',
      });
      const browserCookies = await browserSession.cookies.get({ url: fixtureOrigin });
      const defaultCookies = await session.defaultSession.cookies.get({ url: fixtureOrigin });
      const target = webContents.getAllWebContents().find((wc) => wc.session === browserSession && wc.getURL().startsWith(fixtureOrigin));
      const pageStorage = target
        ? await target.executeJavaScript(`({ cookie: document.cookie, local: localStorage.getItem('nodus_e2e') })`)
        : null;
      return {
        browserNames: browserCookies.map((cookie) => cookie.name),
        defaultNames: defaultCookies.map((cookie) => cookie.name),
        pageStorage,
      };
    }, origin);
    assert.ok(isolation.browserNames.includes('nodus_e2e'), 'Browser session cookie is missing');
    assert.equal(isolation.browserNames.includes('trusted_default_only'), false,
      'a default-session cookie leaked into Browser');
    assert.equal(isolation.defaultNames.includes('nodus_e2e'), false,
      'a Browser cookie leaked into trusted Nodus');
    assert.ok(isolation.defaultNames.includes('trusted_default_only'));
    assert.equal(isolation.pageStorage.local, 'yes');
    assert.doesNotMatch(isolation.pageStorage.cookie, /trusted_default_only/);
  });

  await check('restart destroys every old Browser WebContents but preserves Nodus and its persistent session', async () => {
    await call('updateSettings', {
      browserHomeMode: 'custom',
      browserHomeUrl: `${origin}/`,
      browserNewTabMode: 'home',
      browserSearchEngine: 'duckduckgo',
    });
    await call('openBrowserTab', `${origin}/second`);
    await waitFor((s) => s.tabs.length >= 2, 'multiple tabs before restart');

    const beforeSettings = await call('getSettings');
    const before = await app.evaluate(({ BrowserWindow, session, webContents }) => {
      const main = BrowserWindow.getAllWindows()[0];
      const browserSession = session.fromPartition('persist:nodus-browser');
      globalThis.__restartE2eSession = browserSession;
      return {
        mainId: main.webContents.id,
        browserIds: webContents.getAllWebContents()
          .filter((contents) => contents.session === browserSession)
          .map((contents) => contents.id),
      };
    });
    assert.ok(before.browserIds.length >= 2, `expected old Browser renderers: ${JSON.stringify(before)}`);

    const result = await call('restartNodusBrowser', false);
    assert.equal(result.restarted, true);
    assert.equal(result.requiresConfirmation, false);
    const restarted = await waitFor(
      (s) => s.tabs.length === 1 && s.tabs[0].url === `${origin}/` && !s.tabs[0].loading,
      'one fresh configured home tab',
    );
    assert.equal(restarted.tabs.length, 1);

    const after = await app.evaluate(async ({ BrowserWindow, session, webContents }, oldIds) => {
      const main = BrowserWindow.getAllWindows()[0];
      const browserSession = session.fromPartition('persist:nodus-browser');
      const current = webContents.getAllWebContents().filter((contents) => contents.session === browserSession);
      return {
        mainId: main.webContents.id,
        oldDestroyed: oldIds.every((id) => {
          const contents = webContents.fromId(id);
          return !contents || contents.isDestroyed();
        }),
        browserCount: current.length,
        sameSessionObject: current[0]?.session === globalThis.__restartE2eSession,
        storage: current[0]
          ? await current[0].executeJavaScript(`({ cookie: document.cookie, local: localStorage.getItem('nodus_e2e') })`)
          : null,
      };
    }, before.browserIds);
    assert.equal(after.mainId, before.mainId, 'the main Nodus renderer must not restart');
    assert.equal(after.oldDestroyed, true, 'all old Browser WebContents must be destroyed');
    assert.equal(after.browserCount, 1, 'restart must own exactly one fresh Browser WebContents');
    assert.equal(after.sameSessionObject, true, 'the persistent Chromium session object must be reused');
    assert.match(after.storage.cookie, /nodus_e2e=1/, 'cookies must survive Browser restart');
    assert.equal(after.storage.local, 'yes', 'site localStorage must survive Browser restart');

    const afterSettings = await call('getSettings');
    for (const key of ['browserHomeMode', 'browserHomeUrl', 'browserNewTabMode', 'browserSearchEngine']) {
      assert.deepEqual(afterSettings[key], beforeSettings[key], `${key} must survive Browser restart`);
    }

    // Resource count must remain flat across repeated destroy-and-recreate
    // cycles; a normal reload cannot satisfy these destruction assertions.
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const old = await app.evaluate(({ session, webContents }) => {
        const browserSession = session.fromPartition('persist:nodus-browser');
        return webContents.getAllWebContents()
          .filter((contents) => contents.session === browserSession)
          .map((contents) => contents.id);
      });
      assert.equal(old.length, 1, `cycle ${cycle}: expected exactly one Browser renderer before restart`);
      await call('restartNodusBrowser', false);
      await waitFor((s) => s.tabs.length === 1 && s.tabs[0].url === `${origin}/` && !s.tabs[0].loading,
        `cycle ${cycle}: fresh home tab`);
      const resources = await app.evaluate(({ session, webContents }, oldIds) => {
        const browserSession = session.fromPartition('persist:nodus-browser');
        return {
          count: webContents.getAllWebContents().filter((contents) => contents.session === browserSession).length,
          oldDestroyed: oldIds.every((id) => !webContents.fromId(id) || webContents.fromId(id).isDestroyed()),
        };
      }, old);
      assert.equal(resources.oldDestroyed, true, `cycle ${cycle}: old WebContents leaked`);
      assert.equal(resources.count, 1, `cycle ${cycle}: Browser resource count grew`);
    }
  });

  await check('restart warns for an active download, then cancels it and clears transient state', async () => {
    await call('submitBrowserOmnibox', `${origin}/download`);
    await waitFor((s) => s.tabs.some((tab) => tab.url.endsWith('/download') && !tab.loading), 'the download fixture');
    await app.evaluate(async ({ webContents }) => {
      const target = webContents.getAllWebContents().find((contents) => contents.getURL().endsWith('/download'));
      if (!target) throw new Error('download fixture missing');
      await target.executeJavaScript(`document.getElementById('slow-download').click()`, true);
    });
    const deadline = Date.now() + 10_000;
    let activeDownloads = [];
    while (Date.now() < deadline) {
      activeDownloads = await call('getBrowserDownloads');
      if (activeDownloads.some((download) => download.state === 'progressing')) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(activeDownloads.some((download) => download.state === 'progressing'), 'the fixture download never became active');
    const tabBeforeWarning = (await state()).activeTabId;

    await page.getByTestId('browser-restart').click();
    const warning = page.getByTestId('browser-restart-warning');
    await warning.waitFor({ state: 'visible' });
    assert.match(await warning.innerText(), /descarga/i);
    assert.equal((await state()).activeTabId, tabBeforeWarning, 'warning request must not restart yet');
    await page.getByTestId('browser-restart-confirm').click();
    await warning.waitFor({ state: 'detached' });
    await waitFor((s) => s.tabs.length === 1 && s.tabs[0].url === `${origin}/` && !s.tabs[0].loading,
      'fresh home after confirmed download interruption');
    assert.deepEqual(await call('getBrowserDownloads'), [], 'transient download state must be cleared');
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

  await check('header media controls expose previous, next and device volume', async () => {
    await page.getByTestId('browser-media-header-action').getByRole('button', { name: 'Medios', exact: true }).click();
    const popover = page.getByTestId('browser-media-popover');
    await popover.waitFor({ state: 'visible' });
    const deviceVolume = page.getByTestId('browser-device-volume').getByRole('slider', { name: 'Volumen' });
    await deviceVolume.waitFor({ state: 'visible' });
    await deviceVolume.waitFor({ state: 'attached' });
    await page.waitForFunction(() => {
      const slider = document.querySelector('[data-testid="browser-device-volume"] input');
      return slider instanceof HTMLInputElement && !slider.disabled;
    });
    await deviceVolume.evaluate((slider) => {
      globalThis.__nodusVolumeSlider = slider;
      globalThis.__nodusVolumeDisabledTransitions = 0;
      globalThis.__nodusVolumeObserver?.disconnect();
      globalThis.__nodusVolumeObserver = new MutationObserver(() => {
        if (slider.disabled) globalThis.__nodusVolumeDisabledTransitions += 1;
      });
      globalThis.__nodusVolumeObserver.observe(slider, { attributes: true, attributeFilter: ['disabled'] });
    });
    const activeMediaTrack = () => app.evaluate(async ({ webContents }) => {
      const target = webContents.getAllWebContents().find((wc) => wc.getURL().endsWith('/media'));
      if (!target) throw new Error('media tab missing');
      return target.executeJavaScript('[...document.querySelectorAll("audio")].find((audio) => !audio.paused)?.id ?? ""');
    });
    const waitForTrack = async (id) => {
      const deadline = Date.now() + 5000;
      let active = '';
      while (Date.now() < deadline) {
        active = await activeMediaTrack();
        if (active === id) return active;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return active;
    };
    await popover.getByRole('button', { name: 'Siguiente', exact: true }).click();
    let activeTrack = await waitForTrack('b');
    assert.equal(activeTrack, 'b', 'Next must start the following real media element');
    await popover.getByRole('button', { name: 'Anterior', exact: true }).click();
    activeTrack = await waitForTrack('a');
    assert.equal(activeTrack, 'a', 'Previous must return to the preceding real media element');

    const mute = popover.getByTestId('browser-media-mute').first();
    await mute.click();
    await page.waitForFunction(() => document.querySelector('[data-testid="browser-media-mute"]')?.getAttribute('aria-pressed') === 'true');
    assert.equal(await mute.locator('svg line[x1="3"][y1="3"][x2="21"][y2="21"]').count(), 1,
      'Mute must replace the volume glyph with its crossed-out variant');
    await mute.click();
    await page.waitForFunction(() => document.querySelector('[data-testid="browser-media-mute"]')?.getAttribute('aria-pressed') === 'false');

    const sliderStability = await page.evaluate(() => {
      const current = document.querySelector('[data-testid="browser-device-volume"] input');
      const result = {
        sameElement: current === globalThis.__nodusVolumeSlider,
        disabledTransitions: globalThis.__nodusVolumeDisabledTransitions,
        disabled: !(current instanceof HTMLInputElement) || current.disabled,
      };
      globalThis.__nodusVolumeObserver?.disconnect();
      return result;
    });
    assert.deepEqual(sliderStability, { sameElement: true, disabledTransitions: 0, disabled: false },
      'Previous, Next and Mute must neither remount nor briefly disable the volume slider');
    const currentVolume = await deviceVolume.inputValue();
    await deviceVolume.fill(currentVolume);
    assert.equal(await deviceVolume.inputValue(), currentVolume);
    await page.keyboard.press('Escape');
    await popover.waitFor({ state: 'detached' });
  });

  await check('restart warns for media and stops the Browser media session', async () => {
    assert.ok((await call('getBrowserMedia')).length > 0, 'media session must exist before restart');
    await page.getByTestId('browser-restart').click();
    const warning = page.getByTestId('browser-restart-warning');
    await warning.waitFor({ state: 'visible' });
    assert.match(await warning.innerText(), /multimedia/i);
    await page.getByTestId('browser-restart-confirm').click();
    await warning.waitFor({ state: 'detached' });
    await waitFor((s) => s.tabs.length === 1 && s.tabs[0].url === `${origin}/` && !s.tabs[0].loading,
      'fresh home after confirmed media stop');
    assert.deepEqual(await call('getBrowserMedia'), [], 'all Browser media state must be cleared');
  });

  await check('a compromised Browser renderer can crash and recover without restarting Nodus', async () => {
    await call('restartNodusBrowser', false);
    await waitFor((s) => s.tabs.length === 1 && s.tabs[0].url === `${origin}/` && !s.tabs[0].loading,
      'one clean tab before the crash');
    const before = await app.evaluate(({ BrowserWindow, session, webContents }) => {
      const browserSession = session.fromPartition('persist:nodus-browser');
      const target = webContents.getAllWebContents().find((wc) => wc.session === browserSession);
      if (!target) throw new Error('Browser renderer missing before crash');
      return { mainId: BrowserWindow.getAllWindows()[0].webContents.id, browserId: target.id };
    });

    await app.evaluate(({ webContents }, id) => webContents.fromId(id)?.forcefullyCrashRenderer(), before.browserId);
    const crashed = await waitFor(
      (s) => s.tabs.length === 1 && s.tabs[0].error?.kind === 'crashed',
      'the controlled Page crashed state',
    );
    assert.match(crashed.tabs[0].error.description, /crash|kill|exit|process/i);
    const mainAfterCrash = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.id);
    assert.equal(mainAfterCrash, before.mainId, 'the trusted Nodus renderer must remain the same process endpoint');
    assert.ok(await page.evaluate(() => window.nodus.getSettings()), 'trusted Nodus IPC must still work after the crash');

    await call('browserReload');
    const recovered = await waitFor(
      (s) => s.tabs.length === 1 && s.tabs[0].url === `${origin}/` && !s.tabs[0].loading && !s.tabs[0].error,
      'the crashed tab to reload with a fresh Chromium renderer',
    );
    assert.equal(recovered.tabs[0].title, 'Fixture home');
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
