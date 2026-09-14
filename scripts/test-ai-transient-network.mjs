// A dropped connection is not a permanent failure.
//
// The OpenAI SDK reports a socket-level failure as `APIConnectionError` with the
// message "Connection error." and no HTTP status. `wrapProviderError` mapped every
// error by status, so these fell to the generic catch-all, which marks them
// permanent: one gateway hiccup failed the whole work with no retry, while the
// subscription runtimes already treated "connection" as transient.
//
// The heuristic lives in providerErrors.ts so it can be asserted directly; the last
// test pins the wiring in aiClient.ts, which cannot be imported here because it
// pulls the database and the native SQLite driver.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const dir = mkdtempSync(path.join(tmpdir(), 'nodus-transient-network-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

function load(file) {
  const bundle = path.join(dir, `${path.basename(file, '.ts')}.cjs`);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [path.join(repoRoot, file), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`],
    { cwd: repoRoot, stdio: 'inherit' },
  );
  return require(bundle);
}

const { isTransientNetworkFailure } = load('electron/ai/providerErrors.ts');

/** The exact shape the OpenAI SDK throws for a lost socket. */
const connectionError = () => Object.assign(new Error('Connection error.'), { name: 'APIConnectionError' });

test('the OpenAI SDK connection error is transient', () => {
  assert.equal(isTransientNetworkFailure(connectionError()), true);
});

test('undici-style socket failures are transient', () => {
  assert.equal(isTransientNetworkFailure(new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) })), true);
  assert.equal(isTransientNetworkFailure(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })), true);
  assert.equal(isTransientNetworkFailure(new Error('other side closed')), true);
  assert.equal(isTransientNetworkFailure(new Error('network error')), true);
});

test('an abort, a timeout and a status-bearing error are NOT transient network failures', () => {
  // A cancelled or paused job asked for the abort; retrying would fight the user.
  assert.equal(isTransientNetworkFailure(Object.assign(new Error('Request was aborted.'), { name: 'APIUserAbortError' })), false);
  assert.equal(isTransientNetworkFailure(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })), false);
  // Timeouts are classified separately and must not be replayed blindly.
  assert.equal(isTransientNetworkFailure(Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' })), false);
  assert.equal(isTransientNetworkFailure(Object.assign(new Error('AI transport timed out after 180000 ms.'), { name: 'TimeoutError' })), false);
  assert.equal(isTransientNetworkFailure(Object.assign(new Error('timed out'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } })), false);
  // A status means another branch of wrapProviderError owns the decision.
  assert.equal(isTransientNetworkFailure(Object.assign(new Error('Connection error'), { status: 503 })), false);
  assert.equal(isTransientNetworkFailure(Object.assign(new Error('connection refused'), { response: { status: 502 } })), false);
});

test('an ordinary provider rejection is not transient', () => {
  assert.equal(isTransientNetworkFailure(new Error('El proveedor rechazó la solicitud (400). Detalle: bad model')), false);
  assert.equal(isTransientNetworkFailure(new Error('La respuesta JSON quedó truncada.')), false);
  assert.equal(isTransientNetworkFailure(null), false);
  assert.equal(isTransientNetworkFailure('Connection error.'), false, 'only error objects are classified');
});

test('wrapProviderError marks a transient network failure retriable', () => {
  // The heuristic is dead without this call site, and aiClient.ts cannot be imported
  // here (database + native driver), so the wiring is asserted on the source text.
  const source = readFileSync(path.join(repoRoot, 'electron/ai/aiClient.ts'), 'utf8');
  assert.match(source, /import \{ classifyProviderError, isTransientNetworkFailure \} from '\.\/providerErrors';/);
  assert.match(
    source,
    /if \(isTransientNetworkFailure\(e\)\) \{\s*return new AiError\(message \|\| 'Error de conexión con el proveedor de IA\.', true, false\);/,
    'the connection failure must reach AiError with retriable=true',
  );
});
