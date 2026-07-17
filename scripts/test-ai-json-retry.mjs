// completeJson's retry/repair budget. This is the JSON path behind 28 AI modules
// (scans, idea extraction, question generation, deep research), so every wasted
// attempt here is a billed provider call multiplied across the whole app.
//
// Drives the real aiClient against a fake OpenAI-compatible server (lmstudio's base
// URL is settings-driven) and counts the requests that actually reach the wire.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-ai-json-retry-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-ai-json-retry.mjs'), '--electron-ai-json-retry-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-ai-json-retry-'));
installRuntimeHooks(root);

/**
 * Replies for /v1/chat/completions, consumed in order; every hit is recorded.
 * A reply may be a bare string, or `{ content, finish_reason }` to model truncation.
 */
let queue = [];
let seen = [];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    if (!req.url.includes('/chat/completions')) { res.writeHead(404).end('{}'); return; }
    seen.push({ url: req.url, body: JSON.parse(body || '{}') });
    const next = queue.shift() ?? '{}';
    const reply = typeof next === 'string' ? { content: next, finish_reason: 'stop' } : next;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: reply.content }, finish_reason: reply.finish_reason }] }));
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

let closeDb = () => undefined;
try {
  const settingsRepo = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const aiClient = require(path.join(repoRoot, 'electron/ai/aiClient.ts'));
  ({ closeDb } = require(path.join(repoRoot, 'electron/db/database.ts')));

  settingsRepo.updateSettings({ localProviders: { lmstudio: { baseUrl } } });
  const model = { provider: 'lmstudio', model: 'fake-json-model' };
  const opts = { system: 'system', user: 'user', maxTokens: 256 };
  /** Demands a field the model may omit — the realistic schema-mismatch shape. */
  const guard = (v) => !!v && typeof v === 'object' && Array.isArray(v.ideas);
  const run = (replies) => { queue = replies; seen = []; };

  // 1. Happy path: one well-formed, schema-valid response costs exactly one call.
  run(['{"ideas":["a"]}']);
  assert.deepEqual((await aiClient.completeJson(opts, guard, model)).ideas, ['a']);
  assert.equal(seen.length, 1, 'a valid first response costs a single provider call');

  /** The repair prompt ships the bad text back under this key; a plain retry never does. */
  const isRepairCall = (hit) => JSON.stringify(hit.body).includes('invalid_json');

  // 2. Schema mismatch: the response parses cleanly but misses `ideas`. The repair prompt
  //    is explicitly forbidden from adding fields or inventing data, so it can only echo
  //    the same object back and fail the guard again. Retrying the ORIGINAL prompt at a
  //    lower temperature is the only thing that recovers, so the second call must be that
  //    retry — never a repair round-trip that cannot succeed by construction.
  run(['{"wrong":true}', '{"ideas":["b"]}']);
  assert.deepEqual((await aiClient.completeJson(opts, guard, model)).ideas, ['b']);
  assert.equal(seen.length, 2, 'well-formed JSON that misses the schema costs attempt + retry only');
  assert.ok(!isRepairCall(seen[1]), 'no futile repair call for a schema mismatch');
  assert.equal(seen[1].body.temperature, 0, 'the retry drops temperature to 0');

  // 3. Genuinely unparseable output (two objects run together — jsonrepair bails on this
  //    where it recovers truncation and fences locally). A repair pass CAN pick the right
  //    object here, so it must still run.
  run(['uno {"ideas":["a"]} dos {"ideas":["b"]}', '{"ideas":["c"]}']);
  assert.deepEqual((await aiClient.completeJson(opts, guard, model)).ideas, ['c']);
  assert.equal(seen.length, 2, 'unparseable JSON still gets exactly one repair call');
  assert.ok(isRepairCall(seen[1]), 'the second call is the repair prompt, not a blind retry');

  // 4. Exhaustion: three schema-mismatched replies burn the three attempts and no more.
  run(['{"wrong":1}', '{"wrong":2}', '{"wrong":3}']);
  await assert.rejects(() => aiClient.completeJson(opts, guard, model), /esquema/i);
  assert.equal(seen.length, 3, 'a persistently mismatched model costs three calls, not six');
  assert.ok(seen.every((hit) => !isRepairCall(hit)), 'none of the three attempts pay for a repair');

  // 5. Truncation. The JSON is cut off at the output ceiling, and jsonrepair WOULD close
  //    the dangling braces and hand back a plausible-looking partial object. That silent
  //    data loss is the failure mode this guard exists to prevent, so the call must refuse
  //    with an actionable message naming the limit — and must not retry, because an
  //    identical request truncates identically.
  run([{ content: '{"ideas":[{"a":1},{"b":', finish_reason: 'length' }, '{"ideas":["never reached"]}']);
  await assert.rejects(() => aiClient.completeJson(opts, guard, model), (e) => {
    assert.match(e.message, /se cortó/i, 'the error names truncation, not a schema mismatch');
    assert.match(e.message, /256/, 'the error names the actual output limit');
    // On a local server the only lever is the context window; "analyse a smaller
    // fragment" would be advice the reader cannot act on, since chunk sizes are fixed
    // in code. LM Studio's knob is Context Length, Ollama's is num_ctx.
    assert.match(e.message, /Context Length/, 'a local truncation points at the context window knob');
    return true;
  });
  assert.equal(seen.length, 1, 'a truncated response fails fast instead of burning all three attempts');

  // 6. Prose is not JSON: a clipped sentence is still usable, so plain text must survive
  //    truncation untouched rather than inheriting the JSON guard.
  run([{ content: 'una frase cortada por la mitad', finish_reason: 'length' }]);
  assert.equal(await aiClient.completeText(opts, model), 'una frase cortada por la mitad');

  console.log('AI JSON retry budget verified.');
} finally {
  try { closeDb(); } catch { /* database may not have opened */ }
  server.close();
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: { getPath: () => userDataPath, getVersion: () => '0.0.0-test', getAppPath: () => repoRoot, isPackaged: false },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: (value) => Buffer.from(String(value)), decryptString: (value) => Buffer.from(value).toString() },
    dialog: {}, shell: {}, BrowserWindow: class {}, ipcMain: { handle: () => undefined, on: () => undefined },
  };
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true, skipLibCheck: true },
    }).outputText;
    module._compile(output, filename);
  };
}
