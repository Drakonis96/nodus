// Render the basic-mode server panel. Actually render it.
//
// This is the screen that asks somebody to make their own computer reachable, so the states
// worth proving are the ones where a wrong word costs something real: the certificate
// fingerprint they are told to compare, the warning about the charger, and the fact that no
// state of this panel ever offers an unencrypted address.
//
// Bundled with esbuild and rendered through react-dom/server, exactly like
// scripts/test-connected-vaults-panel.mjs. No browser, no DOM, no Electron.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-local-server-panel-'));

const outfile = path.join(tmp, 'panel.mjs');
await build({
  entryPoints: [path.join(repoRoot, 'visual-tests/local-server-entry.tsx')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  alias: { '@shared': path.join(repoRoot, 'shared') },
  loader: { '.css': 'empty' },
  logLevel: 'silent',
});
const { renderPanel } = await import(pathToFileURL(outfile).href);

const FINGERPRINT = 'AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89';

function status(overrides = {}) {
  return {
    phase: 'running',
    enabled: true,
    port: 7443,
    access: 'loopback',
    localUrl: 'http://127.0.0.1:7443',
    shareUrl: null,
    adminEmail: 'admin@nodus.local',
    tailscale: { installed: false, connected: false, dnsName: null, httpsAvailable: false, servingOurPort: false, url: null },
    lan: { addresses: [], caFingerprint: null, caCertPath: null },
    error: null,
    ...overrides,
  };
}

function power(overrides = {}) {
  return { awake: false, lidOpenServing: false, lidSupported: true, onBattery: false, orphaned: false, error: null, ...overrides };
}

const render = (s = status(), p = power(), extra = {}) =>
  renderPanel({ status: s, power: p, busy: false, vaultConnected: false, adminPassword: null, ...extra });

/**
 * Whether the element carrying this test id is disabled.
 *
 * React emits attributes in the order the JSX declares them, so `disabled` lands before the
 * test id on one element and after it on the next. Matching a single tag and then looking
 * inside it asks the question that actually matters, rather than a question about prop order
 * that would break the next time somebody reorders two lines.
 */
function isDisabled(html, testId) {
  const tag = html.match(new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`));
  assert.ok(tag, `no element carries data-testid="${testId}"`);
  return / disabled(=|\s|\/|>)/.test(tag[0]);
}

test('a stopped server offers to start and shows no address', () => {
  const html = render(status({ phase: 'stopped', localUrl: null }));
  assert.match(html, /data-testid="local-server-panel"/);
  assert.match(html, /Servidor apagado/);
  assert.match(html, /Encender servidor/);
  assert.doesNotMatch(html, /127\.0\.0\.1/);
  assert.doesNotMatch(html, /undefined|NaN|\[object Object\]/);
});

test('a failed start shows the reason instead of pretending to be up', () => {
  const html = render(status({ phase: 'error', localUrl: null, error: 'El puerto 7443 ya está en uso.' }));
  assert.match(html, /El servidor no ha podido arrancar/);
  assert.match(html, /data-testid="local-server-error"/);
  assert.match(html, /El puerto 7443 ya está en uso/);
});

test('no access path ever renders an http:// address for another device', () => {
  // The single most important property of this screen. Loopback is the only place plain HTTP
  // is legitimate, and even there it is this machine talking to itself.
  const cases = [
    status({ access: 'loopback' }),
    status({ access: 'lan', shareUrl: 'https://192.168.1.4:7443', lan: { addresses: ['192.168.1.4'], caFingerprint: FINGERPRINT, caCertPath: '/tmp/ca.crt' } }),
    status({ access: 'tailscale', tailscale: { installed: true, connected: true, dnsName: 'laptop.tail1.ts.net', httpsAvailable: true, servingOurPort: true, url: 'https://laptop.tail1.ts.net' } }),
  ];
  for (const candidate of cases) {
    const html = render(candidate);
    const shared = html.match(/http:\/\/(?!127\.0\.0\.1|localhost)[^\s"<]+/g) ?? [];
    assert.deepEqual(shared, [], `${candidate.access} offered a cleartext address: ${shared.join(', ')}`);
  }
});

test('the local-network path makes the user compare a fingerprint', () => {
  const html = render(status({
    access: 'lan',
    shareUrl: 'https://192.168.1.4:7443',
    lan: { addresses: ['192.168.1.4', '10.0.0.9'], caFingerprint: FINGERPRINT, caCertPath: '/tmp/ca.crt' },
  }));
  assert.match(html, /data-testid="local-server-lan"/);
  assert.match(html, /https:\/\/192\.168\.1\.4:7443/);
  assert.match(html, /aviso de seguridad/);
  assert.match(html, new RegExp(FINGERPRINT.replaceAll(':', ':')));
  assert.match(html, /no continúes/);
  // The second address is offered too, because the first is not always the reachable one.
  assert.match(html, /https:\/\/10\.0\.0\.9:7443/);
});

test('with no network the local-network path says so instead of showing a broken address', () => {
  const html = render(status({ access: 'lan', shareUrl: null, lan: { addresses: [], caFingerprint: null, caCertPath: null } }));
  assert.match(html, /no está conectado a ninguna red local/);
  assert.doesNotMatch(html, /https:\/\/:\d+/);
  assert.doesNotMatch(html, /undefined/);
});

test('Tailscale walks through each state it can be in', () => {
  const absent = render(status({ access: 'tailscale' }));
  assert.match(absent, /Descargar Tailscale/);

  const signedOut = render(status({ access: 'tailscale', tailscale: { installed: true, connected: false, dnsName: null, httpsAvailable: false, servingOurPort: false, url: null } }));
  assert.match(signedOut, /no ha iniciado sesión/);

  const noCerts = render(status({ access: 'tailscale', tailscale: { installed: true, connected: true, dnsName: 'laptop.tail1.ts.net', httpsAvailable: false, servingOurPort: false, url: null } }));
  assert.match(noCerts, /certificados HTTPS/);

  const ready = render(status({ access: 'tailscale', tailscale: { installed: true, connected: true, dnsName: 'laptop.tail1.ts.net', httpsAvailable: true, servingOurPort: false, url: null } }));
  assert.match(ready, /data-testid="local-server-tailscale-serve"/);
  assert.match(ready, /https:\/\/laptop\.tail1\.ts\.net/);

  const serving = render(status({ access: 'tailscale', tailscale: { installed: true, connected: true, dnsName: 'laptop.tail1.ts.net', httpsAvailable: true, servingOurPort: true, url: 'https://laptop.tail1.ts.net' } }));
  assert.match(serving, /Abre esta dirección desde tus dispositivos/);
  assert.match(serving, /Dejar de compartir por Tailscale/);
});

test('the lid switch refuses on battery and explains why', () => {
  const html = render(status(), power({ onBattery: true }));
  assert.match(html, /data-testid="local-server-lid"/);
  assert.match(html, /Conecta el cargador antes de activarlo/);
  // Disabled, so it cannot be flipped into a state the main process would reject anyway.
  assert.ok(isDisabled(html, 'local-server-lid'));
});

test('an already-held lid switch stays operable on battery, so it can be turned off', () => {
  // The guard is about *engaging* it. Trapping somebody with a machine that cannot sleep
  // because they unplugged it would be the opposite of a safeguard.
  const html = render(status(), power({ onBattery: true, lidOpenServing: true }));
  assert.equal(isDisabled(html, 'local-server-lid'), false);
});

test('a lid setting orphaned by a crash is surfaced, not left silently on', () => {
  const html = render(status(), power({ orphaned: true }));
  assert.match(html, /data-testid="local-server-power-orphaned"/);
  assert.match(html, /sesión anterior de Nodus/);
});

test('Linux is told where the setting lives rather than offered a dead switch', () => {
  const html = render(status(), power({ lidSupported: false }));
  assert.match(html, /logind\.conf/);
  assert.ok(isDisabled(html, 'local-server-lid'));
});

test('a connected vault is not offered the connect button again', () => {
  const connected = render(status(), power(), { vaultConnected: true });
  assert.match(connected, /Este vault ya está conectado/);
  assert.doesNotMatch(connected, /data-testid="local-server-connect-vault"/);

  const unconnected = render(status(), power(), { vaultConnected: false });
  assert.match(unconnected, /data-testid="local-server-connect-vault"/);
  assert.match(unconnected, /No hace falta copiar ningún código/);
});

test('a stopped server offers nothing to connect to', () => {
  const html = render(status({ phase: 'stopped', localUrl: null }));
  assert.doesNotMatch(html, /data-testid="local-server-connect-vault"/);
});

/**
 * The panel tells the user "Nodus generated the password for you; you can see and copy it here".
 *
 * It has to actually be here. Without it the sentence is a promise the screen does not keep, and
 * somebody who wants to create reading accounts for their students cannot sign in to their own
 * server — there is no other copy of that password anywhere they can reach.
 */
test('the administration password it promises to show is really shown', () => {
  const secret = 'S3cret-Generada-Por-Nodus';
  const html = render(status(), power(), { adminPassword: secret });
  assert.match(html, /data-testid="local-server-admin-password"/);
  assert.ok(html.includes(secret), 'the password the panel offers to copy must appear in the markup');
  assert.match(html, /admin@nodus\.local/, 'and the account it belongs to alongside it');
});

test('with no password yet the block does not pretend there is one', () => {
  const html = render(status(), power(), { adminPassword: null });
  assert.doesNotMatch(html, /data-testid="local-server-admin-password"/);
});

test('every button is disabled while a request is in flight', () => {
  const html = renderPanel({ status: status(), power: power(), busy: true, vaultConnected: false, adminPassword: null });
  for (const id of ['local-server-toggle', 'local-server-access-lan', 'local-server-connect-vault', 'local-server-keep-awake']) {
    assert.ok(isDisabled(html, id), `${id} stayed clickable during a request`);
  }
});

test.after(() => rm(tmp, { recursive: true, force: true }));
