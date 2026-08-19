// What a website loaded in Nodus Browser may ask the machine for.
//
// The load-bearing test here is the totality one: it reads the permission unions
// out of the INSTALLED electron.d.ts rather than repeating them, so an Electron
// upgrade that adds a permission fails this suite instead of silently falling
// through the policy table. That is not hypothetical — the check handler gained
// `fileSystem` between Electron 33 and 43, which is the upgrade this branch did.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(path.join(tmpdir(), 'nodus-perms-'));
const bundle = path.join(dir, 'perms.cjs');

execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'shared/browserPermissions.ts'),
    '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);

const require = createRequire(import.meta.url);
const {
  BROWSER_PERMISSION_POLICY, resolveBrowserPermission, checkBrowserPermission, permissionOriginOf,
} = require(bundle);

/** Pull a permission union straight out of the Electron typings we ship against. */
function electronPermissions(handler) {
  const dts = readFileSync(path.join(repoRoot, 'node_modules/electron/electron.d.ts'), 'utf8');
  const marker = `${handler}(handler: ((webContents`;
  const start = dts.indexOf(marker);
  assert.ok(start > 0, `${handler} not found in electron.d.ts`);
  const slice = dts.slice(start, dts.indexOf('\n', start));
  const after = slice.slice(slice.indexOf('permission:') + 'permission:'.length);
  const union = after.slice(0, after.indexOf(','));
  const names = [...union.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(names.length > 5, `${handler} union looked wrong: ${union}`);
  return names;
}

test('the policy table covers every permission Electron can request', () => {
  const missing = electronPermissions('setPermissionRequestHandler')
    .filter((name) => !(name in BROWSER_PERMISSION_POLICY));
  assert.deepEqual(missing, [], `unlisted request permissions: ${missing.join(', ')}`);
});

test('the policy table covers every permission Electron can check', () => {
  // A different union from the request handler, and both handlers must be
  // installed: permissions.query() goes through the check side.
  const missing = electronPermissions('setPermissionCheckHandler')
    .filter((name) => !(name in BROWSER_PERMISSION_POLICY));
  assert.deepEqual(missing, [], `unlisted check permissions: ${missing.join(', ')}`);
});

test('anything unknown denies rather than falls through', () => {
  for (const invented of ['teleportation', 'nfc', '', 'proto', 'constructor', '__proto__', 'prototype']) {
    assert.equal(resolveBrowserPermission(invented, 'https://x.org', null).policy, 'deny', invented);
  }
});

test('the sensitive permissions are denied outright', () => {
  const denied = [
    'notifications', 'clipboard-read', 'deprecated-sync-clipboard-read', 'pointerLock',
    'keyboardLock', 'display-capture', 'fileSystem', 'midi', 'midiSysex', 'usb', 'serial',
    'hid', 'bluetooth', 'idle-detection', 'window-management', 'speaker-selection',
    'storage-access', 'top-level-storage-access', 'openExternal', 'geolocation', 'unknown',
  ];
  for (const name of denied) {
    assert.equal(BROWSER_PERMISSION_POLICY[name], 'deny', `${name} must be denied`);
  }
});

test('camera and microphone ask rather than resolve silently either way', () => {
  // There is no 'camera'/'microphone' permission in Electron; both arrive as
  // 'media' and the prompt reads details.mediaTypes to say which.
  assert.equal(BROWSER_PERMISSION_POLICY.media, 'ask');
  assert.equal(BROWSER_PERMISSION_POLICY.geolocation, 'deny');
  assert.equal(BROWSER_PERMISSION_POLICY.camera, undefined);
  assert.equal(BROWSER_PERMISSION_POLICY.microphone, undefined);
});

test('normal playback is allowed so ordinary sites work', () => {
  assert.equal(BROWSER_PERMISSION_POLICY.fullscreen, 'allow');
  assert.equal(BROWSER_PERMISSION_POLICY.mediaKeySystem, 'allow');
  assert.equal(BROWSER_PERMISSION_POLICY['clipboard-sanitized-write'], 'allow');
});

test('a remembered decision only applies to an explicitly promptable permission', () => {
  const stored = {
    'https://jstor.org': { media: 'allow', fullscreen: 'deny', geolocation: 'allow', fileSystem: 'allow' },
  };
  assert.deepEqual(
    resolveBrowserPermission('media', 'https://jstor.org', stored),
    { policy: 'allow', remembered: true },
  );
  assert.deepEqual(resolveBrowserPermission('fullscreen', 'https://jstor.org', stored),
    { policy: 'allow', remembered: false });
  assert.deepEqual(resolveBrowserPermission('geolocation', 'https://jstor.org', stored),
    { policy: 'deny', remembered: false });
  assert.deepEqual(resolveBrowserPermission('fileSystem', 'https://jstor.org', stored),
    { policy: 'deny', remembered: false });
});

test('a decision is scoped to its own origin and does not leak to another', () => {
  const stored = { 'https://jstor.org': { media: 'allow' } };
  assert.equal(resolveBrowserPermission('media', 'https://evil.example', stored).policy, 'ask');
  // Scheme and port are part of the origin, so these are all different sites.
  assert.equal(resolveBrowserPermission('media', 'http://jstor.org', stored).policy, 'ask');
  assert.equal(resolveBrowserPermission('media', 'https://jstor.org:8443', stored).policy, 'ask');
});

test('a check never reports true for something that would merely prompt', () => {
  // permissions.query() must not be a way to discover a prompt would appear, and
  // must never be a way to open one.
  assert.equal(checkBrowserPermission('media', 'https://x.org', null), false);
  assert.equal(checkBrowserPermission('geolocation', 'https://x.org', null), false);
  assert.equal(checkBrowserPermission('fullscreen', 'https://x.org', null), true);
  assert.equal(checkBrowserPermission('notifications', 'https://x.org', null), false);
  // Once granted for that origin, the check agrees.
  assert.equal(checkBrowserPermission('media', 'https://x.org', { 'https://x.org': { media: 'allow' } }), true);
});

test('origins are derived safely, and opaque ones key on nothing', () => {
  assert.equal(permissionOriginOf('https://www.jstor.org/stable/1?x=2'), 'https://www.jstor.org');
  assert.equal(permissionOriginOf('http://localhost:5173/a'), 'http://localhost:5173');
  assert.equal(permissionOriginOf('data:text/html,<p>'), '');
  assert.equal(permissionOriginOf('not a url'), '');
  assert.equal(permissionOriginOf(''), '');
});

test('a missing or malformed store behaves like no decision at all', () => {
  for (const store of [null, undefined, {}, { 'https://x.org': {} }]) {
    assert.equal(resolveBrowserPermission('media', 'https://x.org', store).policy, 'ask');
  }
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
