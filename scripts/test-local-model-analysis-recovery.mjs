// What happens when the model runs on the user's own laptop and is slow.
//
// A cloud provider that has said nothing for three minutes is stuck. A local model that
// has been generating for three minutes is working: idea extraction asks for up to 8.000
// JSON tokens per chunk, and at the 15-40 tokens/s a quantized model reaches on an
// M-series that is 200-530 seconds of perfectly healthy generation. Under one shared
// 180s transport ceiling the deep pass died on every long work, which is why local users
// could produce Themes (one call, 1.500 tokens) and never Ideas — and the whole pass died
// with the first slow chunk, because a timeout was not something the adaptive retry knew
// how to answer.
//
// Drives the real aiClient against a fake OpenAI-compatible server (lmstudio's base URL
// is settings-driven), then pins the policies the transport alone cannot show.

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

if (!process.argv.includes('--electron-local-model-recovery-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-local-model-analysis-recovery.mjs'), '--electron-local-model-recovery-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-local-model-recovery-'));
installRuntimeHooks(root);

/** Replies for /v1/chat/completions, consumed in order. A `{ status, body }` entry
 *  models a provider-side failure instead of a completion. */
let queue = [];
let seen = [];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    if (!req.url.includes('/chat/completions')) { res.writeHead(404).end('{}'); return; }
    seen.push({ url: req.url, body: JSON.parse(body || '{}') });
    const next = queue.shift() ?? '{}';
    if (typeof next === 'object' && next.status) {
      res.writeHead(next.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(next.body));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: next }, finish_reason: 'stop' }] }));
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');

let closeDb = () => undefined;
try {
  const settingsRepo = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const aiClient = require(path.join(repoRoot, 'electron/ai/aiClient.ts'));
  ({ closeDb } = require(path.join(repoRoot, 'electron/db/database.ts')));

  settingsRepo.updateSettings({ localProviders: { lmstudio: { baseUrl } } });

  // --- 1. The transport budget follows where the model runs -------------------
  //
  // Nothing is billed by the second on the user's own machine and the deep scan ticks a
  // heartbeat while it waits, so a local model gets room to finish. It stays finite: a
  // wedged local server must not hold the scan queue open forever.
  const cloudBudget = aiClient.completionTimeoutMs({ provider: 'openai', model: 'gpt-4o' });
  assert.equal(cloudBudget, 180_000, 'cloud providers keep the three-minute ceiling');
  for (const provider of ['gemini', 'anthropic', 'openrouter', 'deepseek', 'groq']) {
    assert.equal(aiClient.completionTimeoutMs({ provider, model: 'x' }), cloudBudget,
      `${provider} runs on the provider's hardware and keeps the cloud ceiling`);
  }
  for (const provider of ['lmstudio', 'ollama', 'nodus']) {
    const budget = aiClient.completionTimeoutMs({ provider, model: 'x' });
    assert.ok(budget > cloudBudget, `${provider} runs on this machine and must get more room than the cloud`);
    // 8.000 output tokens at a pessimistic 15 tokens/s is ~530s; the budget has to clear
    // that with margin or the fix does not reach the case it was written for.
    assert.ok(budget >= 600_000, `${provider} must clear a full extraction chunk on slow hardware, got ${budget}ms`);
  }

  // --- 2. A timeout is tagged, not merely worded ------------------------------
  //
  // The deep scan answers a timeout by splitting the chunk, which it must not do for an
  // unrelated failure, so the classification has to survive as a code and not as prose
  // that a translation or a reword could silently change the meaning of.
  queue = [{ status: 400, body: { error: { message: 'request timed out' } } }];
  seen = [];
  await assert.rejects(
    () => aiClient.completeText({ system: 's', user: 'u', maxTokens: 64 }, { provider: 'lmstudio', model: 'slow-local' }),
    (error) => {
      assert.equal(error.code, 'timeout', 'the deep scan splits on this code');
      assert.match(error.message, /Tiempo agotado/, 'and the reader still gets the sentence');
      assert.equal(error.config, false, 'a slow model is not a misconfiguration: the queue must not pause');
      return true;
    },
  );
  assert.ok(seen.length >= 1, 'the request actually reached the wire');

  // --- 3. Both completion transports use the same budget ----------------------
  const client = read('electron/ai/aiClient.ts');
  assert.equal(
    (client.match(/timeout: (?:opts\.timeoutMs \?\? )?completionTimeoutMs\(model\)/g) ?? []).length, 2,
    'the buffered and the streaming OpenAI clients both size their timeout by provider',
  );
  assert.doesNotMatch(client, /timeout: opts\.timeoutMs \?\? 180_000/, 'no hard-coded ceiling survives');
  assert.match(client, /'Tiempo agotado esperando al proveedor de IA[^']*',\s*false,\s*false,\s*'timeout'/,
    'the timeout error carries its code');

  // --- 4. The deep scan answers a timeout by splitting, never by expanding -----
  const deepScan = read('electron/ai/deepScan.ts');
  assert.match(deepScan, /const timedOut = aiError\?\.code === 'timeout'/, 'the deep scan recognises a timeout');
  assert.match(deepScan, /const maxDepth = timedOut \? 1 : 4/,
    'a timeout gets one split, not four: each failed attempt costs the full local budget');
  assert.match(deepScan, /if \(!timedOut && depth === 0 && maxTokens < 16000\)/,
    'raising the output ceiling answers truncation only — after a timeout it just buys more rope');
  assert.match(deepScan, /\(!recoverableJson && !timedOut\) \|\| depth >= maxDepth/,
    'a timed-out chunk is recoverable, where it used to kill the whole deep pass');

  console.log('Local-model analysis recovery verified.');
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
