// The Nodus Server that basic mode runs on this computer, exercised for real.
//
// This starts the actual server/server.mjs — the same file the Docker image runs — on a
// temporary data directory and a free port, and drives it over HTTP. Nothing here is mocked,
// because the properties worth proving are not properties of a mock:
//
//   1. A half-configured certificate stops the boot instead of quietly serving cleartext.
//   2. The local provisioning secret is written 0600 before anything can be asked of it.
//   3. That endpoint refuses a caller that did not arrive over loopback — even holding the
//      correct secret. This is the one that keeps basic mode's convenience from becoming a
//      hole in a server bound to the local network.
//   4. Provisioning is idempotent per vault, and the code it hands out pairs exactly once.
//   5. With TLS the loopback listener still speaks plain HTTP on the same port, which is how
//      the desktop publishes into a server whose certificate it cannot validate.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import https from 'node:https';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(repoRoot, 'server', 'server.mjs');
const require = createRequire(import.meta.url);

const ADMIN_EMAIL = 'admin@nodus.local';
const ADMIN_PASSWORD = 'una-clave-de-pruebas-larga';

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/**
 * One HTTPS request that validates against a specific certificate authority.
 *
 * node:https rather than fetch: global fetch has no supported way to be handed a CA, and the
 * alternative — turning certificate checking off — would make this test pass against exactly
 * the misconfiguration it exists to catch.
 */
function httpsRequest(url, { ca, method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, { method, headers, ca, timeout: 10_000 }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, text, json: () => JSON.parse(text) }));
    });
    request.once('error', reject);
    request.once('timeout', () => request.destroy(new Error('timeout')));
    if (body) request.write(body);
    request.end();
  });
}

/** Start the server and resolve once /healthz answers, or reject with what it printed. */
function start(env, { origin, ca } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { output += chunk.toString('utf8'); });
    child.once('exit', (code) => reject(new Error(`exited with ${code}\n${output}`)));

    const base = origin ?? `http://127.0.0.1:${env.NODUS_PORT}`;
    const deadline = Date.now() + 20_000;
    const poll = async () => {
      if (Date.now() > deadline) {
        child.kill('SIGKILL');
        reject(new Error(`never became healthy\n${output}`));
        return;
      }
      try {
        const response = ca
          ? await httpsRequest(`${base}/healthz`, { ca })
          : await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(1_000) });
        if (response.status === 200) {
          resolve({ child, output: () => output, base });
          return;
        }
      } catch { /* still binding */ }
      setTimeout(poll, 150);
    };
    void poll();
  });
}

function stop(server) {
  return new Promise((resolve) => {
    if (!server?.child || server.child.exitCode !== null) { resolve(); return; }
    server.child.removeAllListeners('exit');
    server.child.once('exit', () => resolve());
    server.child.kill('SIGKILL');
  });
}

function baseEnv(dir, port) {
  return {
    NODUS_DATA_DIR: path.join(dir, 'data'),
    NODUS_PORT: String(port),
    NODUS_HOST: '127.0.0.1',
    NODUS_ADMIN_EMAIL: ADMIN_EMAIL,
    NODUS_ADMIN_PASSWORD: ADMIN_PASSWORD,
    NODUS_LOCAL_PROVISION_FILE: path.join(dir, 'provision.key'),
    // A developer's exported NODUS_* variables must not decide what this test measures.
    NODUS_PUBLIC_URL: `http://localhost:${port}`,
    NODUS_SETUP_TOKEN: '',
    NODUS_TLS_CERT_FILE: '',
    NODUS_TLS_KEY_FILE: '',
    NODUS_LOOPBACK_PORT: '',
  };
}

test('half a certificate stops the boot rather than serving in cleartext', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nodus-local-tls-'));
  try {
    const env = { ...baseEnv(dir, await freePort()), NODUS_TLS_CERT_FILE: path.join(dir, 'nope.crt') };
    const failure = await start(env).then(() => null, (error) => error);
    assert.ok(failure, 'the server must not come up with only half a TLS pair');
    assert.match(failure.message, /NODUS_TLS_CERT_FILE and NODUS_TLS_KEY_FILE must be configured together/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a certificate whose file cannot be read stops the boot too', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nodus-local-tls-missing-'));
  try {
    const env = {
      ...baseEnv(dir, await freePort()),
      NODUS_TLS_CERT_FILE: path.join(dir, 'absent.crt'),
      NODUS_TLS_KEY_FILE: path.join(dir, 'absent.key'),
    };
    const failure = await start(env).then(() => null, (error) => error);
    assert.ok(failure);
    assert.match(failure.message, /Could not read the configured TLS material/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the provisioning secret is written 0600, and guards the endpoint', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nodus-local-provision-'));
  let server;
  try {
    const port = await freePort();
    server = await start(baseEnv(dir, port));
    const secretFile = path.join(dir, 'provision.key');

    const mode = fs.statSync(secretFile).mode & 0o777;
    assert.equal(mode, 0o600, 'the secret must not be readable by other users on the machine');
    const secret = fs.readFileSync(secretFile, 'utf8').trim();
    assert.ok(secret.length >= 32);

    const call = (headers) => fetch(`${server.base}/api/v1/local/provision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ vaultId: 'vault-1', vaultName: 'Tesis', vaultType: 'academic' }),
    });

    assert.equal((await call({})).status, 401, 'no secret must be refused');
    assert.equal((await call({ authorization: 'Bearer not-the-secret' })).status, 401);
    // A shorter wrong secret must fail on comparison, not on a length crash.
    assert.equal((await call({ authorization: 'Bearer x' })).status, 401);

    const granted = await call({ authorization: `Bearer ${secret}` });
    assert.equal(granted.status, 200);
    const first = await granted.json();
    assert.ok(first.spaceId);
    assert.match(first.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    assert.equal(first.spaceName, 'Tesis');
    let state = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'state.json'), 'utf8'));
    assert.equal(state.spaces[0].vaultType, 'academic', 'local provisioning records the vault type before its first publication');

    // Same vault, second call: the space is reused rather than duplicated.
    const again = await (await call({ authorization: `Bearer ${secret}` })).json();
    assert.equal(again.spaceId, first.spaceId, 'a vault must keep one space, not collect them');
    assert.notEqual(again.code, first.code, 'each call must mint a fresh code');

    // The code pairs exactly once.
    const pair = (code) => fetch(`${server.base}/api/v1/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, deviceName: 'Nodus Desktop' }),
    });
    const paired = await pair(again.code);
    assert.equal(paired.status, 200);
    const session = await paired.json();
    assert.ok(session.accessToken);
    assert.equal(session.space.id, first.spaceId);
    assert.equal((await pair(again.code)).status, 401, 'a pairing code must be single-use');

    // A different vault gets a different space.
    const other = await fetch(`${server.base}/api/v1/local/provision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
      body: JSON.stringify({ vaultId: 'vault-2', vaultName: 'Docencia', vaultType: 'docencia' }),
    });
    assert.notEqual((await other.json()).spaceId, first.spaceId);
    state = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'state.json'), 'utf8'));
    assert.equal(state.spaces.find((space) => space.localVaultId === 'vault-2')?.vaultType, 'docencia');
  } finally {
    await stop(server);
    await rm(dir, { recursive: true, force: true });
  }
});

test('a vault id is required, so a caller cannot claim an unnamed space', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nodus-local-novault-'));
  let server;
  try {
    server = await start(baseEnv(dir, await freePort()));
    const secret = fs.readFileSync(path.join(dir, 'provision.key'), 'utf8').trim();
    const response = await fetch(`${server.base}/api/v1/local/provision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
      body: JSON.stringify({ vaultName: 'Sin id' }),
    });
    assert.equal(response.status, 400);
  } finally {
    await stop(server);
    await rm(dir, { recursive: true, force: true });
  }
});

test('without the provisioning file the endpoint does not exist at all', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nodus-local-docker-'));
  let server;
  try {
    const env = { ...baseEnv(dir, await freePort()), NODUS_LOCAL_PROVISION_FILE: '' };
    server = await start(env);
    const response = await fetch(`${server.base}/api/v1/local/provision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer anything' },
      body: JSON.stringify({ vaultId: 'vault-1' }),
    });
    assert.equal(response.status, 404, 'a Docker deployment must not expose this route');
  } finally {
    await stop(server);
    await rm(dir, { recursive: true, force: true });
  }
});

test('TLS on the network, plain HTTP on loopback, and provisioning refused from the network', async (t) => {
  // The whole point of the LAN access path. Needs a private address to bind and a certificate
  // that names it; on a machine with no network there is nothing meaningful to measure.
  const address = Object.values(os.networkInterfaces()).flat()
    .find((entry) => entry && entry.family === 'IPv4' && !entry.internal
      && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address))?.address;
  if (!address) {
    t.skip('no private IPv4 address on this machine');
    return;
  }

  const dir = await mkdtemp(path.join(os.tmpdir(), 'nodus-local-lan-'));
  let server;
  try {
    const { createCA, createCert } = require('mkcert');
    const ca = await createCA({ organization: 'Nodus Test CA', countryCode: 'ES', state: 'Local', locality: 'Local', validity: 2 });
    const leaf = await createCert({ ca, domains: ['localhost', '127.0.0.1', address], validity: 1 });
    const certFile = path.join(dir, 'server.crt');
    const keyFile = path.join(dir, 'server.key');
    fs.writeFileSync(certFile, leaf.cert);
    fs.writeFileSync(keyFile, leaf.key);

    const port = await freePort();
    const env = {
      ...baseEnv(dir, port),
      // Bind the private address itself, leaving the same port free on loopback for the
      // plain-HTTP listener the desktop uses.
      NODUS_HOST: address,
      NODUS_TLS_CERT_FILE: certFile,
      NODUS_TLS_KEY_FILE: keyFile,
      NODUS_LOOPBACK_PORT: String(port),
      NODUS_PUBLIC_URL: `https://${address}:${port}`,
    };
    server = await start(env, { origin: `https://${address}:${port}`, ca: ca.cert });

    // HTTPS on the network address, validating against the CA that signed it.
    const secure = await httpsRequest(`https://${address}:${port}/healthz`, { ca: ca.cert });
    assert.equal(secure.status, 200);
    assert.equal(secure.json().ok, true);

    // Plain HTTP on loopback, same port. This is how the desktop publishes.
    const loopback = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(loopback.status, 200);

    // And the gate that matters: the correct secret, presented from the network, is a 404.
    const secret = fs.readFileSync(path.join(dir, 'provision.key'), 'utf8').trim();
    const body = JSON.stringify({ vaultId: 'vault-1', vaultName: 'Tesis' });
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${secret}` };
    const fromNetwork = await httpsRequest(`https://${address}:${port}/api/v1/local/provision`, { ca: ca.cert, method: 'POST', headers, body });
    assert.equal(fromNetwork.status, 404, 'provisioning must not be reachable from the local network');

    const fromLoopback = await fetch(`http://127.0.0.1:${port}/api/v1/local/provision`, { method: 'POST', headers, body });
    assert.equal(fromLoopback.status, 200, 'the same call over loopback must work');
  } finally {
    await stop(server);
    await rm(dir, { recursive: true, force: true });
  }
});

test('a loopback listener without TLS is a configuration error, not a silent no-op', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nodus-local-loopback-'));
  try {
    const port = await freePort();
    const env = { ...baseEnv(dir, port), NODUS_LOOPBACK_PORT: String(port + 1) };
    const failure = await start(env).then(() => null, (error) => error);
    assert.ok(failure);
    assert.match(failure.message, /only meaningful when TLS is configured/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
