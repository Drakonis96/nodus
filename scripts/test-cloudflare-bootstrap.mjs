// Regression coverage for a Nodus Cloud bootstrap that could never complete. Cloudflare
// Workers refuses PBKDF2 above 100_000 iterations, so hashing the administrator password
// threw NotSupportedError and POST /api/v3/bootstrap always answered HTTP 500. The
// open-source workerd behind `wrangler dev` does not enforce that ceiling, so local
// verification stayed green while every real deployment failed; these tests apply the
// ceiling themselves, against the real auth.mjs, so the gap cannot reopen.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const WORKERS_PBKDF2_CEILING = 100_000;

// The restriction the production runtime applies, reproduced over Node's WebCrypto.
const deriveBits = crypto.subtle.deriveBits.bind(crypto.subtle);
Object.defineProperty(crypto.subtle, 'deriveBits', {
  configurable: true,
  writable: true,
  value: async (algorithm, key, length) => {
    const iterations = Number(algorithm?.iterations);
    if (algorithm?.name === 'PBKDF2' && iterations > WORKERS_PBKDF2_CEILING) {
      const error = new Error(`Pbkdf2 failed: iteration counts above ${WORKERS_PBKDF2_CEILING} are not supported (requested ${iterations}).`);
      error.name = 'NotSupportedError';
      throw error;
    }
    return deriveBits(algorithm, key, length);
  },
});

const { hashPassword, verifyPassword } = await import('../cloudflare/src/auth.mjs');
const { errorResponse } = await import('../cloudflare/src/util.mjs');

const password = 'una contraseña de administrador';
const iterationsOf = (scheme) => Number(/^pbkdf2-sha256:(\d+)$/.exec(String(scheme))[1]);

test('hashing an administrator password survives the Workers PBKDF2 ceiling', async () => {
  const record = await hashPassword(password);
  const iterations = iterationsOf(record.scheme);
  assert.ok(iterations > 0 && iterations <= WORKERS_PBKDF2_CEILING,
    `PASSWORD_ITERATIONS is ${iterations}; Cloudflare Workers rejects anything above ${WORKERS_PBKDF2_CEILING} and bootstrap answers HTTP 500`);
  assert.match(record.salt, /^[0-9a-f]{32}$/);
  assert.match(record.hash, /^[0-9a-f]{64}$/);
});

test('a stored password verifies, a wrong one does not', async () => {
  const record = await hashPassword(password);
  const user = { password_hash: record.hash, password_salt: record.salt, password_scheme: record.scheme };
  assert.equal(await verifyPassword(password, user), true);
  assert.equal(await verifyPassword(`${password} `, user), false);
});

test('verification replays the iteration count recorded with each password', async () => {
  // Raising or lowering PASSWORD_ITERATIONS must not lock out passwords already on record.
  for (const iterations of [60_000, WORKERS_PBKDF2_CEILING]) {
    const record = await hashPassword(password, null, iterations);
    assert.equal(record.scheme, `pbkdf2-sha256:${iterations}`);
    assert.equal(await verifyPassword(password, {
      password_hash: record.hash, password_salt: record.salt, password_scheme: record.scheme,
    }), true, `a password hashed at ${iterations} iterations stopped verifying`);
  }
});

test('an unreadable password scheme fails closed instead of throwing', async () => {
  const record = await hashPassword(password);
  for (const scheme of [null, undefined, '', 'bcrypt:12', 'pbkdf2-sha256:', 'pbkdf2-sha256:0', 'pbkdf2-sha256:abc', 'pbkdf2-sha512:100000']) {
    assert.equal(await verifyPassword(password, {
      password_hash: record.hash, password_salt: record.salt, password_scheme: scheme,
    }), false, `scheme ${JSON.stringify(scheme)} was accepted`);
  }
});

test('desktop reads the field the Worker actually reports failures in', async () => {
  const body = await errorResponse(new Error('anything unexpected')).json();
  assert.equal(body.error, 'internal_error');
  assert.ok(body.error_description, 'the Worker reports failures as error_description');
  assert.equal(body.detail, undefined);
  // Reading only `detail` collapsed every Worker failure into a bare status code on screen,
  // which is what made this bootstrap bug take a live deployment to diagnose.
  const deployment = read('electron/cloudflare/deployment.ts');
  for (const match of deployment.matchAll(/throw new Error\(([^)]*HTTP \$\{response\.status\}[^)]*)\)/g)) {
    assert.match(match[1], /value\.error_description/, `a Worker failure is surfaced without reading error_description: ${match[1]}`);
  }
  assert.equal(deployment.match(/value\.error_description/g)?.length, 2);
});
