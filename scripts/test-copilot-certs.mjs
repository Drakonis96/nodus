// Contract test for electron/copilot/certs.ts: in-process CA + leaf generation
// (mkcert), per-platform trust commands, idempotency, trust-failure retry and
// silent leaf renewal. Pure Node — certs.ts does not import electron.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { X509Certificate } from 'node:crypto';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

installTsHook();

const certs = require(path.join(repoRoot, 'electron/copilot/certs.ts'));
const mkcert = require('mkcert');

const dirs = [];
async function freshDir(label) {
  const dir = await mkdtemp(path.join(os.tmpdir(), `nodus-copilot-certs-${label}-`));
  dirs.push(dir);
  return dir;
}

try {
  // ── Trust commands per platform ─────────────────────────────────────────────
  const mac = certs.trustCommand('darwin', '/x/ca.crt');
  assert.equal(mac.cmd, 'security');
  assert.ok(mac.args.includes('trustRoot'), 'mac command adds a trusted root');
  assert.ok(mac.args.includes('/x/ca.crt'), 'mac command points at the CA file');
  assert.ok(!mac.args.includes('-d'), 'user-level trust, no admin domain');

  const win = certs.trustCommand('win32', 'C:\\certs\\ca.crt');
  assert.equal(win.cmd, 'powershell');
  assert.match(win.args.join(' '), /Import-Certificate/, 'windows uses Import-Certificate');
  assert.match(win.args.join(' '), /CurrentUser\\Root/, 'windows targets the user Root store');

  assert.equal(certs.trustCommand('linux', '/x/ca.crt'), null, 'no desktop Word on linux');

  // ── Generation + trust (mocked runner) ──────────────────────────────────────
  const dir = await freshDir('main');
  const trustCalls = [];
  const first = await certs.ensureNodusCert(dir, 'darwin', async (cmd, args) => {
    trustCalls.push([cmd, args]);
  });
  assert.equal(first.ok, true, first.message);
  assert.equal(trustCalls.length, 1, 'trust command ran once');
  for (const f of ['ca.crt', 'ca.key', 'localhost.crt', 'localhost.key', 'ca-trusted.json']) {
    assert.ok(fs.existsSync(path.join(dir, f)), `${f} written`);
  }
  const caPem = fs.readFileSync(path.join(dir, 'ca.crt'), 'utf8');
  const leafPem = fs.readFileSync(path.join(dir, 'localhost.crt'), 'utf8');
  const ca = new X509Certificate(caPem);
  const leaf = new X509Certificate(leafPem);
  assert.ok(leaf.checkIssued(ca), 'leaf signed by the Nodus CA');
  assert.match(leaf.subjectAltName ?? '', /localhost/, 'SAN covers localhost');
  assert.match(leaf.subjectAltName ?? '', /127\.0\.0\.1/, 'SAN covers 127.0.0.1');
  assert.ok(certs.daysUntilExpiry(leafPem) > 300, 'leaf lives ~a year');
  assert.ok(certs.daysUntilExpiry(caPem) > 3000, 'CA lives ~10 years');
  const marker = JSON.parse(fs.readFileSync(path.join(dir, 'ca-trusted.json'), 'utf8'));
  assert.equal(marker.fingerprint, ca.fingerprint256, 'marker pinned to the CA fingerprint');

  // ── Idempotency: trusted material short-circuits, no second prompt ──────────
  const second = await certs.ensureNodusCert(dir, 'darwin', async () => {
    trustCalls.push('unexpected');
  });
  assert.equal(second.ok, true);
  assert.equal(trustCalls.length, 1, 'no re-trust for valid trusted material');

  // ── Trust failure surfaces and is retried on the next attempt ───────────────
  const dir2 = await freshDir('retry');
  let attempts = 0;
  const denied = await certs.ensureNodusCert(dir2, 'darwin', async () => {
    attempts++;
    throw new Error('user cancelled the keychain dialog');
  });
  assert.equal(denied.ok, false, 'denied trust reported as failure');
  assert.ok(!fs.existsSync(path.join(dir2, 'ca-trusted.json')), 'no marker on failure');
  const retried = await certs.ensureNodusCert(dir2, 'darwin', async () => {
    attempts++;
  });
  assert.equal(retried.ok, true, 'retry succeeds');
  assert.equal(attempts, 2, 'trust attempted again after a failure');

  // ── Silent leaf renewal from the stored CA (no new trust prompt) ────────────
  const shortLeaf = await mkcert.createCert({
    ca: { cert: caPem, key: fs.readFileSync(path.join(dir, 'ca.key'), 'utf8') },
    domains: ['localhost', '127.0.0.1'],
    validity: 5,
  });
  fs.writeFileSync(path.join(dir, 'localhost.crt'), shortLeaf.cert);
  fs.writeFileSync(path.join(dir, 'localhost.key'), shortLeaf.key);
  assert.ok(certs.daysUntilExpiry(shortLeaf.cert) < 30, 'test leaf is near expiry');
  await certs.renewLeafIfNeeded(dir);
  const renewed = fs.readFileSync(path.join(dir, 'localhost.crt'), 'utf8');
  assert.ok(certs.daysUntilExpiry(renewed) > 300, 'near-expiry leaf silently re-issued');
  assert.ok(new X509Certificate(renewed).checkIssued(ca), 'renewed leaf still signed by the same CA');

  // ── Platforms without desktop Word get a clear answer ───────────────────────
  const dir3 = await freshDir('linux');
  const unsupported = await certs.ensureNodusCert(dir3, 'linux', async () => {});
  assert.equal(unsupported.ok, false);

  console.log('copilot certs (generation + trust + renewal) test passed');
} finally {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
}

function installTsHook() {
  const ts = require('typescript');
  require.extensions['.ts'] = function loadTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        esModuleInterop: true,
        resolveJsonModule: true,
        skipLibCheck: true,
      },
    }).outputText;
    module._compile(output, filename);
  };
}
