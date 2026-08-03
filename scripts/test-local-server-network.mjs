// The desktop half of basic mode: what it decides to bind, and the certificate it binds with.
//
// scripts/test-local-server.mjs drives server.mjs and proves the server keeps its promises. This
// file measures the code that *tells* it what to promise, which until now had no coverage at all
// — including buildLaunchPlan, the single function that decides whether the listener leaves this
// machine. A mistake there is not a broken feature, it is a vault on the wifi.
//
// Bundled with esbuild against stubs for Electron, the settings store and the secret store, the
// same way scripts/test-local-server-power.mjs does it. Nothing here runs `tailscale serve` or
// touches the developer's own tailnet.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { X509Certificate } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-local-network-'));

// ── Stubs ──────────────────────────────────────────────────────────────────
// The real settings repository opens SQLite and the real secret store reaches into the vault
// registry. Neither has anything to say about which address a listener binds.

const stubDir = path.join(tmp, 'stubs');
mkdirSync(stubDir, { recursive: true });
writeFileSync(path.join(stubDir, 'settingsRepo.js'), `
const state = {
  localServerEnabled: true,
  localServerPort: 7443,
  localServerAccess: 'loopback',
  localServerAdminEmail: '',
  localServerKeepAwake: false,
  localServerKeepServingOnLidClose: false,
};
export function getSettings() { return { ...state }; }
export function updateSettings(patch) { Object.assign(state, patch); return { ...state }; }
`);
writeFileSync(path.join(stubDir, 'secretStore.js'), `
let password = null;
export function getLocalServerAdminPassword() { return password; }
export function setLocalServerAdminPassword(value) { password = value; }
`);

/** Redirect the two heavy imports to the stubs above, by the tail of their relative path. */
const stubPlugin = {
  name: 'nodus-local-server-stubs',
  setup(builder) {
    builder.onResolve({ filter: /(settingsRepo|secretStore)$/ }, (args) => ({
      path: path.join(stubDir, `${path.basename(args.path)}.js`),
    }));
  },
};

async function bundle(entry, outname) {
  const outfile = path.join(tmp, outname);
  await build({
    entryPoints: [path.join(repoRoot, entry)],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    external: ['electron'],
    alias: { '@shared': path.join(repoRoot, 'shared') },
    plugins: [stubPlugin],
    // mkcert reaches for `require` internally, which an ESM bundle has no answer for on its own.
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href);
}

const electronStub = path.join(tmp, 'node_modules', 'electron');
mkdirSync(electronStub, { recursive: true });
writeFileSync(path.join(electronStub, 'package.json'), JSON.stringify({ name: 'electron', type: 'module', main: 'index.js' }));
writeFileSync(path.join(electronStub, 'index.js'), `
const userData = ${JSON.stringify(path.join(tmp, 'userData'))};
export const app = { on: () => undefined, getPath: () => userData, getAppPath: () => ${JSON.stringify(repoRoot)} };
export const powerMonitor = { isOnBatteryPower: () => false };
export const powerSaveBlocker = { start: () => 1, stop: () => undefined, isStarted: () => false };
`);

const lanCert = await bundle('electron/localServer/lanCert.ts', 'lanCert.mjs');
const tailscale = await bundle('electron/localServer/tailscale.ts', 'tailscale.mjs');
const server = await bundle('electron/localServer/process.ts', 'process.mjs');

const PRIVATE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

// ── What the machine is allowed to call its own ────────────────────────────

test('only RFC1918 addresses are ever offered as this machine’s own', () => {
  for (const address of lanCert.lanAddresses()) {
    assert.match(address, PRIVATE, `${address} is not a private address and must not be published`);
    assert.doesNotMatch(address, /^169\.254\./, 'a link-local address means no network, not an address to share');
  }
});

// ── buildLaunchPlan: the decision that lets traffic off this computer ───────

test('the default path binds loopback and nothing else', async () => {
  const plan = await server.buildLaunchPlan('loopback', 7443, null);
  assert.equal(plan.env.NODUS_HOST, '127.0.0.1');
  assert.equal(plan.shareUrl, null, 'nothing may be offered to another device');
  assert.deepEqual(plan.addresses, []);
  assert.equal(plan.env.NODUS_TLS_CERT_FILE, undefined, 'no certificate is needed to talk to yourself');
  assert.equal(plan.env.NODUS_LOOPBACK_PORT, undefined);
});

test('Tailscale still binds loopback — the tunnel is what reaches the network', async () => {
  const plan = await server.buildLaunchPlan('tailscale', 7443, 'https://laptop.tail1234.ts.net');
  assert.equal(plan.env.NODUS_HOST, '127.0.0.1', 'the listener itself must never leave this machine');
  assert.equal(plan.env.NODUS_PUBLIC_URL, 'https://laptop.tail1234.ts.net');
  assert.equal(plan.shareUrl, 'https://laptop.tail1234.ts.net');
  assert.equal(plan.env.NODUS_TLS_CERT_FILE, undefined, 'Tailscale terminates TLS with a real certificate');
});

test('the local-network path binds named addresses, never 0.0.0.0, and always with TLS', async (t) => {
  const addresses = lanCert.lanAddresses();
  if (addresses.length === 0) {
    t.skip('no private IPv4 address on this machine');
    return;
  }
  const plan = await server.buildLaunchPlan('lan', 7443, null);
  assert.equal(plan.env.NODUS_HOST, addresses.join(','));
  assert.doesNotMatch(plan.env.NODUS_HOST, /0\.0\.0\.0/, 'a wildcard bind would shadow the loopback listener');
  for (const host of plan.env.NODUS_HOST.split(',')) assert.match(host, PRIVATE);
  assert.ok(plan.env.NODUS_TLS_CERT_FILE && plan.env.NODUS_TLS_KEY_FILE, 'the network path is never cleartext');
  assert.equal(plan.env.NODUS_LOOPBACK_PORT, '7443', 'the desktop needs its plain channel on the same port');
  assert.match(plan.shareUrl, /^https:\/\//);
  assert.deepEqual(plan.addresses, addresses);
});

/**
 * A developer with NODUS_* exported would otherwise inherit them into the child.
 *
 * NODUS_TLS_CERT_FILE is the one that matters: inherited into the loopback path it would make
 * the server present somebody else's certificate on a listener the desktop then fails to reach.
 */
test('inherited NODUS_ variables are cleared rather than obeyed', async () => {
  const saved = { ...process.env };
  process.env.NODUS_SETUP_TOKEN = 'inherited-token';
  process.env.NODUS_TLS_CERT_FILE = '/somewhere/else.crt';
  process.env.NODUS_TLS_KEY_FILE = '/somewhere/else.key';
  process.env.NODUS_LOOPBACK_PORT = '9999';
  try {
    const plan = await server.buildLaunchPlan('loopback', 7443, null);
    for (const name of ['NODUS_SETUP_TOKEN', 'NODUS_TLS_CERT_FILE', 'NODUS_TLS_KEY_FILE', 'NODUS_LOOPBACK_PORT']) {
      assert.equal(plan.env[name], undefined, `${name} leaked from the developer's own environment`);
    }
  } finally {
    process.env = saved;
  }
});

test('the administrator password is generated, not asked for, and is long enough to be worth it', async () => {
  const plan = await server.buildLaunchPlan('loopback', 7443, null);
  assert.ok(plan.env.NODUS_ADMIN_EMAIL, 'an account must exist for the web administration');
  assert.ok(plan.env.NODUS_ADMIN_PASSWORD.length >= 24, 'a generated password should not be guessable');
  const again = await server.buildLaunchPlan('loopback', 7443, null);
  assert.equal(again.env.NODUS_ADMIN_PASSWORD, plan.env.NODUS_ADMIN_PASSWORD, 'it must survive a restart');
});

// ── Noticing that this machine moved ───────────────────────────────────────

test('a bound address disappearing is what counts as a broken binding', () => {
  // The laptop walked out of the door: everything it was serving on is gone.
  assert.equal(server.bindingBroken(['192.168.1.5'], ['10.0.0.7']), true);
  // One of two survived — the other socket is still dead, so it still has to come back up.
  assert.equal(server.bindingBroken(['192.168.1.5', '10.0.0.7'], ['10.0.0.7']), true);
  // Nothing moved.
  assert.equal(server.bindingBroken(['192.168.1.5'], ['192.168.1.5']), false);
});

test('an address merely appearing does not interrupt anybody', () => {
  // A virtual machine, a Docker bridge or a cable plugged in beside the wifi. Every existing
  // socket still works, and relaunching would cut off a phone mid-request for no gain.
  assert.equal(server.bindingBroken(['192.168.1.5'], ['172.17.0.1', '192.168.1.5']), false);
  // And a server that bound nothing beyond loopback has nothing that can break this way.
  assert.equal(server.bindingBroken([], ['192.168.1.5']), false);
});

// ── The certificate, and the laptop that changes network ───────────────────

function leafAddresses(certPath) {
  return (new X509Certificate(readFileSync(certPath, 'utf8')).subjectAltName ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('IP Address:'))
    .map((part) => part.slice('IP Address:'.length).trim())
    .filter((address) => address !== '127.0.0.1')
    .sort();
}

test('nothing exists before basic mode has ever run', async () => {
  const dir = path.join(tmp, 'certs-empty');
  assert.equal(lanCert.readLanCert(dir), null);
});

test('a second call reuses the authority instead of minting a new one', async (t) => {
  if (lanCert.lanAddresses().length === 0) {
    t.skip('no private IPv4 address on this machine');
    return;
  }
  const dir = path.join(tmp, 'certs-stable');
  const first = await lanCert.ensureLanCert(dir);
  const second = await lanCert.ensureLanCert(dir);
  assert.equal(second.caFingerprint, first.caFingerprint);
  assert.equal(readFileSync(second.certPath, 'utf8'), readFileSync(first.certPath, 'utf8'), 'an unchanged network must not re-cut the leaf');
  assert.deepEqual(leafAddresses(first.certPath), lanCert.lanAddresses());
});

/**
 * The laptop carried from home to the office.
 *
 * Simulated by replacing the leaf with one naming an address this machine does not hold — which
 * is precisely the state the file is left in by walking out of the door. The leaf has to be
 * re-cut for the addresses that exist now, and the authority has to survive untouched: a phone
 * that trusted this CA once must not be asked to trust a new one every time its owner moves.
 */
test('changing network re-cuts the leaf and keeps the authority a phone already trusted', async (t) => {
  const addresses = lanCert.lanAddresses();
  if (addresses.length === 0) {
    t.skip('no private IPv4 address on this machine');
    return;
  }
  const dir = path.join(tmp, 'certs-moved');
  const before = await lanCert.ensureLanCert(dir);

  const { createCert } = require('mkcert');
  const elsewhere = await createCert({
    ca: { cert: readFileSync(before.caCertPath, 'utf8'), key: readFileSync(path.join(dir, 'ca.key'), 'utf8') },
    domains: ['localhost', '127.0.0.1', '10.99.99.99'],
    validity: 365,
  });
  writeFileSync(before.certPath, elsewhere.cert);
  writeFileSync(before.keyPath, elsewhere.key);
  assert.deepEqual(leafAddresses(before.certPath), ['10.99.99.99'], 'the setup itself must be the stale state');

  const after = await lanCert.ensureLanCert(dir);
  assert.deepEqual(leafAddresses(after.certPath), addresses, 'the leaf must name the network this machine is on now');
  assert.equal(after.caFingerprint, before.caFingerprint, 'reissuing the authority would break every device that already trusted it');
});

// ── Tailscale, read-only ───────────────────────────────────────────────────

test('a platform Tailscale does not ship for reports no binary rather than guessing', () => {
  assert.equal(tailscale.tailscaleBinary('aix'), null);
});

/**
 * The forward that outlives the setting that created it.
 *
 * `tailscale serve` is daemon configuration: it survives this process and a reboot. Getting this
 * predicate wrong does not break anything visibly — it leaves the vault published to the whole
 * tailnet while the panel says "nobody else can connect", which is the worst kind of wrong.
 */
test('choosing another access path leaves no Tailscale forward behind', () => {
  const on = { access: 'tailscale', port: 7443 };
  assert.equal(tailscale.forwardOutlivedSetting(on, { access: 'loopback', port: 7443 }), true);
  assert.equal(tailscale.forwardOutlivedSetting(on, { access: 'lan', port: 7443 }), true);
  // Same path, different port: the old forward now points at whatever else binds 7443.
  assert.equal(tailscale.forwardOutlivedSetting(on, { access: 'tailscale', port: 7444 }), true);
  // Still on Tailscale, still the same port — tearing it down here would break a working setup.
  assert.equal(tailscale.forwardOutlivedSetting(on, on), false);
  // Never on Tailscale, so there is nothing of ours to take down.
  assert.equal(tailscale.forwardOutlivedSetting({ access: 'lan', port: 7443 }, { access: 'loopback', port: 7443 }), false);
});

test('reading Tailscale state never throws, whatever this machine has installed', async () => {
  const status = await tailscale.tailscaleStatus(7443);
  for (const key of ['installed', 'connected', 'httpsAvailable', 'servingOurPort']) {
    assert.equal(typeof status[key], 'boolean', `${key} must always be answered`);
  }
  // A URL is only ever offered when it would actually work, and only over HTTPS.
  if (status.url !== null) {
    assert.match(status.url, /^https:\/\//);
    assert.ok(status.connected && status.servingOurPort, 'an address must not be advertised before it serves');
  }
});

test.after(() => rm(tmp, { recursive: true, force: true }));
