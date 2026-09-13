// HTTP authentication in Nodus Browser.
//
// Chromium's default is to cancel every challenge, so a site behind Basic auth
// used to answer with a bare 401 page and no way in. These tests hold the three
// parts together: the main-process queue that owns the challenge, the `login`
// wiring that answers it, and the trusted bar that collects the credentials.
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(path.join(tmpdir(), 'nodus-auth-'));
const bundle = path.join(dir, 'auth.cjs');

// The prompt module is deliberately free of Electron and of Nodus storage, so
// its queue can be exercised without a browser process.
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'electron/browser/authPrompt.ts'),
    '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' },
);

const require = createRequire(import.meta.url);
const prompt = require(bundle);

const read = (file) => readFileSync(path.join(repoRoot, file), 'utf8');
const tabs = read('electron/browser/tabs.ts');
const ipc = read('electron/ipc/browser.ts');
const preload = read('electron/preload/browser.ts');
const types = read('shared/types.ts');
const view = read('src/views/NodusBrowserView.tsx');
const pagePreload = read('electron/preload/browserPage.ts');

test.after(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => prompt.cancelAllBrowserAuthRequests());

test('credentials resolve the challenge that asked for them', async () => {
  const request = prompt.requestBrowserAuth('tab-1', {
    host: 'vpn.example:8443', realm: 'Intranet', url: 'https://vpn.example/vnc.html', isProxy: false,
  });
  const pending = prompt.pendingBrowserAuthRequest();
  assert.deepEqual(pending, {
    id: pending.id,
    host: 'vpn.example:8443',
    realm: 'Intranet',
    url: 'https://vpn.example/vnc.html',
    isProxy: false,
  });
  prompt.resolveBrowserAuthRequest(pending.id, 'ana', 's3cret');
  assert.deepEqual(await request, { username: 'ana', password: 's3cret' });
  assert.equal(prompt.pendingBrowserAuthRequest(), null);
  assert.equal(prompt.pendingBrowserAuthCount(), 0);
});

test('only the first challenge is shown; the rest wait', async () => {
  const first = prompt.requestBrowserAuth('tab-1', { host: 'a.example', realm: '', url: 'https://a.example', isProxy: false });
  const second = prompt.requestBrowserAuth('tab-2', { host: 'b.example', realm: '', url: 'https://b.example', isProxy: false });
  assert.equal(prompt.pendingBrowserAuthRequest().host, 'a.example', 'one prompt at a time, like permissions');
  const firstId = prompt.pendingBrowserAuthRequest().id;
  prompt.resolveBrowserAuthRequest(firstId, 'u', 'p');
  assert.equal(prompt.pendingBrowserAuthRequest().host, 'b.example', 'answering the first advances the queue');
  await first;
  prompt.cancelAllBrowserAuthRequests();
  assert.equal(await second, null);
});

test('cancelling answers null, so Chromium is never left hanging', async () => {
  const request = prompt.requestBrowserAuth('tab-1', { host: 'vpn.example', realm: '', url: 'https://vpn.example', isProxy: false });
  prompt.cancelBrowserAuthRequest(prompt.pendingBrowserAuthRequest().id);
  assert.equal(await request, null);
  assert.equal(prompt.pendingBrowserAuthCount(), 0);
});

test('a tab that navigates or closes cancels only its own challenges', async () => {
  const mine = prompt.requestBrowserAuth('tab-1', { host: 'a.example', realm: '', url: 'https://a.example', isProxy: false });
  const other = prompt.requestBrowserAuth('tab-2', { host: 'b.example', realm: '', url: 'https://b.example', isProxy: false });
  assert.equal(prompt.pendingBrowserAuthCount(), 2);
  prompt.cancelBrowserAuthRequestsForTab('tab-1');
  assert.equal(await mine, null, 'the leaving tab’s challenge is cancelled');
  assert.equal(prompt.pendingBrowserAuthCount(), 1, 'the other tab keeps waiting');
  assert.equal(prompt.pendingBrowserAuthRequest().host, 'b.example');
  prompt.cancelAllBrowserAuthRequests();
  assert.equal(await other, null);
});

test('the renderer is told whenever the pending challenge changes', () => {
  let calls = 0;
  prompt.setBrowserAuthNotifier(() => { calls += 1; });
  const request = prompt.requestBrowserAuth('tab-1', { host: 'a.example', realm: '', url: 'https://a.example', isProxy: false });
  assert.equal(calls, 1, 'asking must notify');
  prompt.resolveBrowserAuthRequest(prompt.pendingBrowserAuthRequest().id, 'u', 'p');
  assert.equal(calls, 2, 'answering must notify');
  prompt.requestBrowserAuth('tab-2', { host: 'b.example', realm: '', url: 'https://b.example', isProxy: false });
  prompt.cancelAllBrowserAuthRequests();
  assert.equal(calls, 4, 'cancelling must notify');
  void request;
  prompt.setBrowserAuthNotifier(null);
});

test('the login challenge is answered in main, with Chromium’s own authInfo', () => {
  const wire = tabs.slice(tabs.indexOf('function wire('), tabs.indexOf('export async function createTab'));
  assert.match(wire, /on\(tab, contents, 'login'/, 'the challenge must be claimed on the tab’s WebContents');
  const login = wire.slice(wire.indexOf("'login'"), wire.indexOf("'will-navigate'"));
  assert.match(login, /event\.preventDefault\(\)/, 'Chromium cancels the challenge unless this is prevented');
  assert.match(login, /requestBrowserAuth\(tab\.id/, 'the request must be owned by the tab that raised it');
  assert.match(login, /authHostLabel\(authInfo\)/, 'the host shown must come from Chromium, never from the page');
  assert.match(login, /callback\(credentials\.username, credentials\.password\)/);
  assert.match(login, /else callback\(\)/, 'a dismissed challenge must call the callback with no credentials');
});

test('a challenge cannot outlive its tab, navigation or renderer', () => {
  const destroy = tabs.slice(tabs.indexOf('function destroyTab'), tabs.indexOf('export function closeTab'));
  assert.match(destroy, /cancelBrowserAuthRequestsForTab\(id\)/);
  const nav = tabs.slice(tabs.indexOf("'did-start-navigation'"), tabs.indexOf("'did-fail-load'"));
  assert.match(nav, /cancelBrowserAuthRequestsForTab\(tab\.id\)/);
  const crash = tabs.slice(tabs.indexOf("'render-process-gone'"), tabs.indexOf("'unresponsive'"));
  assert.match(crash, /cancelBrowserAuthRequestsForTab\(tab\.id\)/);
  assert.match(tabs, /cancelAllBrowserAuthRequests\(\)/, 'shutdown and restart must drop every prompt');
});

test('credentials cross only the trusted-renderer boundary', () => {
  for (const channel of ['browser:pendingAuth', 'browser:resolveAuth', 'browser:cancelAuth']) {
    const at = ipc.indexOf(`'${channel}'`);
    assert.ok(at > 0, `${channel} handler missing`);
    const handler = ipc.slice(at, ipc.indexOf("h('browser:", at + 1));
    assert.match(handler, /assertUiSender\(event, getWindow\)/, `${channel} must refuse non-Nodus senders`);
  }
  assert.doesNotMatch(ipc, /console\.(log|info|warn|error)\([^)]*password/i, 'credentials must never be logged');
  assert.doesNotMatch(pagePreload, /browser:(resolveAuth|cancelAuth|pendingAuth|authRequest)/,
    'a website must have no way to read or answer a challenge');
});

test('the bridge and its contract expose the same authentication methods', () => {
  for (const method of ['getPendingBrowserAuth', 'resolveBrowserAuth', 'cancelBrowserAuth', 'onBrowserAuthRequest']) {
    assert.match(preload, new RegExp(`${method}\\s*:`), `${method} missing from the preload`);
    assert.match(types, new RegExp(`\\b${method}\\(`), `${method} missing from NodusApi`);
  }
  assert.match(preload, /'browser:authRequest'/, 'the pushed event must match the main-process channel');
});

test('the credential bar is trusted chrome with a masked password field', () => {
  assert.match(view, /data-testid="browser-auth-bar"/);
  assert.match(view, /data-testid="browser-auth-password"[\s\S]{0,220}type="password"/);
  assert.match(view, /t\('pide usuario y contraseña\.'\)/);
  assert.match(view, /window\.nodus\.resolveBrowserAuth\(auth\.id, username, password\)/);
  assert.match(view, /window\.nodus\.cancelBrowserAuth\(auth\.id\)/);
  // Leaving the Browser section must cancel, exactly like the permission bar.
  assert.match(view, /void window\.nodus\.cancelBrowserAuth\(\)/);
});

test('Nodus stores none of the credentials it relays', () => {
  const source = read('electron/browser/authPrompt.ts');
  assert.doesNotMatch(source, /node:fs|node:path|settingsRepo|db\//, 'the prompt must not persist anything');
  assert.doesNotMatch(source, /console\./, 'credentials must not be logged');
});
