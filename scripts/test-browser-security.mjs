// The security properties of Nodus Browser, asserted against the source.
//
// These are static scans rather than behavioural tests on purpose. Every
// property here is one that, if it regressed, would still compile, still boot,
// still browse, and simply be insecure — the failure mode is silence. A test
// that reads the source is the only thing that turns "someone deleted
// sandbox: true" into a red build.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(repoRoot, file), 'utf8');

/** Source with comments removed, so prose about a pattern never satisfies a scan. */
function code(file) {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('the page preload hands a website no bridge at all', () => {
  // The single most important property in the feature: a loaded page must have
  // no window.nodus, no ipcRenderer, no require. Checked against comment-free
  // source, because this file DESCRIBES contextBridge at length in its header
  // and a naive grep would match the prose and pass while the code exposed one.
  const preload = code('electron/preload/browserPage.ts');
  assert.doesNotMatch(preload, /contextBridge/, 'the page preload must never call contextBridge');
  assert.doesNotMatch(preload, /exposeInMainWorld/, 'the page preload must expose nothing');
  assert.doesNotMatch(preload, /exposeInIsolatedWorld/, 'the page preload must expose nothing');
});

test('every browser tab is created with the hardened webPreferences', () => {
  const tabs = code('electron/browser/tabs.ts');
  const required = [
    /sandbox:\s*true/,
    /contextIsolation:\s*true/,
    /nodeIntegration:\s*false/,
    /nodeIntegrationInSubFrames:\s*false/,
    /webSecurity:\s*true/,
    /allowRunningInsecureContent:\s*false/,
    /experimentalFeatures:\s*false/,
    /webviewTag:\s*false/,
  ];
  for (const pattern of required) {
    assert.match(tabs, pattern, `browser tabs must set ${pattern}`);
  }
});

test('nothing in the browser weakens a webPreferences default', () => {
  for (const file of ['electron/browser/tabs.ts', 'electron/browser/session.ts', 'electron/ipc/browser.ts']) {
    const source = code(file);
    assert.doesNotMatch(source, /sandbox:\s*false/, `${file} must not disable the sandbox`);
    assert.doesNotMatch(source, /contextIsolation:\s*false/, `${file} must not disable context isolation`);
    assert.doesNotMatch(source, /nodeIntegration:\s*true/, `${file} must not enable node integration`);
    assert.doesNotMatch(source, /webSecurity:\s*false/, `${file} must not disable web security`);
    assert.doesNotMatch(source, /allowRunningInsecureContent:\s*true/, `${file} must not allow mixed content`);
  }
});

test('a page can never dictate the options of a window it opens', () => {
  // action: 'allow' would hand the site control of the new window's
  // webPreferences. Popups become Nodus tabs that WE construct instead.
  const tabs = code('electron/browser/tabs.ts');
  assert.match(tabs, /setWindowOpenHandler/, 'tabs must install a window-open handler');
  assert.match(tabs, /action:\s*'deny'/, 'the window-open handler must deny');
  assert.doesNotMatch(tabs, /action:\s*'allow'/, "the window-open handler must never return 'allow'");
});

test('navigation is filtered in both the main frame and subframes', () => {
  const tabs = code('electron/browser/tabs.ts');
  assert.match(tabs, /'will-navigate'/, 'main-frame navigation must be guarded');
  assert.match(tabs, /'will-frame-navigate'/, 'subframe navigation must be guarded');
  assert.match(tabs, /decideNavigation/, 'both guards must use the shared policy');
});

test('certificate errors are never overridden', () => {
  // Chromium validates; Nodus only reflects. Calling preventDefault() on this
  // event is what "proceed anyway" would be, and v1 has no such path.
  const tabs = code('electron/browser/tabs.ts');
  const handler = tabs.slice(tabs.indexOf("'certificate-error'"));
  const body = handler.slice(0, handler.indexOf('});'));
  assert.doesNotMatch(body, /preventDefault/, 'a certificate error must never be bypassed');
});

test('nothing in the browser offers a way past a certificate verdict', () => {
  // preventDefault() plus callback(true) is exactly how an Electron app says
  // "trust this certificate anyway". Both are absent on purpose, and both are
  // easy to add back by accident — a callback(true) reads like an
  // acknowledgement rather than like a decision to trust an invalid cert.
  const tabs = code('electron/browser/tabs.ts');
  const handler = tabs.slice(tabs.indexOf("'certificate-error'"));
  const body = handler.slice(0, handler.indexOf('as never);'));
  assert.doesNotMatch(body, /preventDefault/, 'a certificate error must never be bypassed');
  assert.doesNotMatch(body, /callback\s*\(\s*true\s*\)/, 'a certificate must never be trusted manually');

  // And the UI must not grow one either.
  const view = code('src/views/NodusBrowserView.tsx');
  const interstitial = view.slice(view.indexOf('function CertificateInterstitial'));
  const uiBody = interstitial.slice(0, interstitial.indexOf('\n}'));
  assert.doesNotMatch(uiBody, /browserReload|continuar de todos modos["']|proceed/i,
    'the interstitial must not offer a way through');
});

test('every browser IPC channel validates its sender', () => {
  // With one trusted renderer, ipcMain.handle needed no sender check. Adding
  // WebContents that load arbitrary websites ends that assumption, so each
  // channel must refuse anything that is not the main Nodus window.
  const source = code('electron/ipc/browser.ts');
  const handlers = [...source.matchAll(/h\('(browser:[^']+)'/g)].map((m) => m[1]);
  assert.ok(handlers.length >= 8, `expected the browser channels, found ${handlers.length}`);

  // Split on each registration and require the guard inside every one.
  const blocks = source.split(/h\('browser:[^']+'/).slice(1);
  assert.equal(blocks.length, handlers.length);
  blocks.forEach((block, index) => {
    const body = block.slice(0, block.indexOf('\n  });') + 1 || block.length);
    assert.match(body, /assertUiSender/, `${handlers[index]} must validate its sender`);
  });
});

test('both permission handlers are installed, not just the request one', () => {
  // permissions.query() goes through the check handler, and the two unions
  // differ. Installing only the request handler leaves that path unguarded.
  const perms = code('electron/browser/permissions.ts');
  assert.match(perms, /setPermissionRequestHandler/);
  assert.match(perms, /setPermissionCheckHandler/);
});

test('the permission policy is actually installed on the session', () => {
  // Writing the handlers is not the same as installing them, and a policy that
  // is never wired compiles, boots and browses exactly like one that is.
  const session = code('electron/browser/session.ts');
  assert.match(session, /installBrowserPermissions\s*\(/, 'the session must install the permission policy');
});

test('hardware access is refused through the handlers that actually govern it', () => {
  // USB, Serial, HID and Bluetooth never reach the permission handlers.
  const perms = code('electron/browser/permissions.ts');
  assert.match(perms, /setDevicePermissionHandler/, 'device access must be handled');
  assert.match(perms, /setDisplayMediaRequestHandler/, 'screen capture must be handled');
  assert.match(perms, /setUSBProtectedClassesHandler/, 'USB classes must stay protected');
  assert.match(perms, /setBluetoothPairingHandler/, 'bluetooth pairing must be refused');
});

test('the vault protocols can never be reached from a page', () => {
  // nodus-image, nodus-archive and nodus-library are registered on the DEFAULT
  // session and serve vault bytes. They must be refused by the shared policy,
  // which both the address bar and the navigation guard consult.
  const omnibox = code('shared/browserOmnibox.ts');
  for (const scheme of ['nodus-image', 'nodus-archive', 'nodus-library', 'file']) {
    assert.match(omnibox, new RegExp(`'${scheme}'`), `${scheme} must be in the blocklist`);
  }
});

test('the browser session is separate from the one Nodus itself uses', () => {
  const session = code('electron/browser/session.ts');
  assert.match(session, /persist:nodus-browser/, 'the browser needs its own persistent partition');
  assert.doesNotMatch(session, /defaultSession/, 'the browser must never touch the default session');
});

test('the browser never opens a URL externally without scheme validation', () => {
  for (const file of ['electron/browser/tabs.ts', 'electron/browser/session.ts', 'electron/ipc/browser.ts']) {
    assert.doesNotMatch(code(file), /shell\.openExternal/, `${file} must not call openExternal directly`);
  }
});

test('every icon the browser view names actually exists', () => {
  // Icon renders `null` for a name it does not know, silently. A typo therefore
  // produces an invisible control rather than an error: a close button that is
  // an empty clickable area, or a Stop button that vanishes exactly while a page
  // is loading. Both of those shipped in a draft of this view.
  const view = read('src/views/NodusBrowserView.tsx');
  const ui = read('src/components/ui.tsx');
  const known = new Set([...ui.matchAll(/^ {2}([a-zA-Z]+): '/gm)].map((m) => m[1]));
  assert.ok(known.size > 50, `the icon catalogue looked wrong (${known.size} entries)`);

  const used = new Set([
    ...[...view.matchAll(/<Icon\s+name="([a-zA-Z]+)"/g)].map((m) => m[1]),
    ...[...view.matchAll(/icon=\{[^}]*?'([a-zA-Z]+)'/g)].map((m) => m[1]),
    ...[...view.matchAll(/icon="([a-zA-Z]+)"/g)].map((m) => m[1]),
  ]);
  assert.ok(used.size > 5, `expected the view to use icons, found ${used.size}`);

  const missing = [...used].filter((name) => !known.has(name));
  assert.deepEqual(missing, [], `icons named but absent from ICON_PATHS: ${missing.join(', ')}`);
});

test('the first-party Atlas is the default home and new-tab destination', () => {
  const contract = code('shared/browser.ts');
  const ipc = code('electron/ipc/browser.ts');
  const view = code('src/views/NodusBrowserView.tsx');

  assert.match(contract, /NODUS_RESEARCH_ATLAS_URL\s*=\s*'https:\/\/nodusresearch\.com\/research-atlas\/'/);
  assert.match(contract, /homeMode:\s*'start'/);
  assert.match(contract, /newTabMode:\s*'home'/);
  assert.match(ipc, /browserHomeMode === 'start' \? NODUS_RESEARCH_ATLAS_URL : 'about:blank'/);
  assert.match(view, /onNew=\{\(\) => void window\.nodus\.openBrowserTab\(''\)\}/,
    'the tab-strip button must ask main to apply the new-tab preference');
});
