// Issue #809: a reasoning model behind a custom OpenAI-compatible gateway spent the
// summary's 800-token output ceiling on its thinking trace, and the pipeline stored the
// clipped sentence as a finished summary. The ceiling is now 2,400 and a cut-off answer
// is retried once at 8,000 before the work is marked failed.
//
// Verified end to end: the real summary pipeline and the real aiClient run against a
// provider that only truncates when the ceiling it receives is too small, and the stored
// summary text is read back from the vault database.
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

if (!process.argv.includes('--electron-summary-thinking-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-summary-thinking-truncation.mjs'), '--electron-summary-thinking-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-summary-thinking-'));
installRuntimeHooks(root);

const TRUNCATED = '온도 의존 저항 특성은 세 단계로 구분되며, 318.';
const COMPLETE = '온도 의존 저항 특성은 세 단계로 구분된다. 첫 단계에서는 전도가 지배하고, 둘째 단계에서는 '
  + '전도와 전이가 겹치며, 셋째 단계에서는 전이만 남는다. 검출 시간도 60초에서 30초로 줄었다.';

/** A thinking model burns almost any ceiling below the app default on its trace. */
const TRUNCATION_THRESHOLD = 8000;
let alwaysTruncate = false;
const completions = [];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    if (!req.url.includes('/chat/completions')) { res.writeHead(404).end('{}'); return; }
    const parsed = JSON.parse(body || '{}');
    const maxTokens = Number(parsed.max_tokens ?? parsed.max_completion_tokens ?? 0);
    completions.push({ model: parsed.model, maxTokens });
    res.writeHead(200, { 'content-type': 'application/json' });
    if (alwaysTruncate || maxTokens < TRUNCATION_THRESHOLD) {
      res.end(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: TRUNCATED }, finish_reason: 'length' }],
        usage: {
          prompt_tokens: 120,
          completion_tokens: maxTokens,
          completion_tokens_details: { reasoning_tokens: Math.max(1, maxTokens - 24) },
        },
      }));
      return;
    }
    res.end(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: COMPLETE }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 120, completion_tokens: 420, completion_tokens_details: { reasoning_tokens: 180 } },
    }));
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

let closeDb = () => undefined;
try {
  const settingsRepo = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const worksRepo = require(path.join(repoRoot, 'electron/db/worksRepo.ts'));
  const { getWorkSummary } = require(path.join(repoRoot, 'electron/db/workSummariesRepo.ts'));
  const zoteroClient = require(path.join(repoRoot, 'electron/zotero/zoteroClient.ts'));
  const { closeDb: close } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const summaryScan = require(path.join(repoRoot, 'electron/ai/summaryScan.ts'));
  closeDb = close;

  // Keep the pipeline on already-extracted material: an abstract exists, so no Zotero
  // lookup and no PDF fallback are needed to reach the summary model.
  zoteroClient.getItem = async () => ({ abstract: 'Una obra sintética con resumen disponible.' });

  const model = { provider: 'custom', model: 'deepseek-v4.1-flash:thinking' };
  settingsRepo.updateSettings({
    customProvider: { baseUrl, models: [model.model] },
    summaryModel: model,
    synthesisModel: null,
    promptLanguage: 'ko',
  });

  worksRepo.upsertWork({
    nodus_id: 'verify-summary-1', zotero_key: 'VERIFYSUM1', zotero_version: 1,
    title: 'Obra sintética para el resumen', authors: ['Autora Sintética'],
    year: 2026, item_type: 'journalArticle', doi: null, read_tag: true, zoteroTags: [],
  });
  const work = worksRepo.getWork('verify-summary-1');
  assert.ok(work, 'the synthetic work exists');

  await summaryScan.runSummaryScan(work, model);
  assert.deepEqual(
    completions.map((call) => call.maxTokens),
    [2400, 8000],
    'a summary cut off at the first ceiling is retried once with the app default ceiling',
  );
  const stored = getWorkSummary('verify-summary-1');
  assert.equal(stored?.summary, COMPLETE, 'the complete summary is what the vault stores');
  assert.equal(worksRepo.getWork('verify-summary-1').summary_status, 'done');

  // A model that exhausts even the retry ceiling must fail loudly instead of storing
  // a clipped sentence as a finished summary, which was the silent half of issue #809.
  alwaysTruncate = true;
  completions.length = 0;
  worksRepo.upsertWork({
    nodus_id: 'verify-summary-2', zotero_key: 'VERIFYSUM2', zotero_version: 1,
    title: 'Obra sintética sin presupuesto suficiente', authors: ['Autora Sintética'],
    year: 2026, item_type: 'journalArticle', doi: null, read_tag: true, zoteroTags: [],
  });
  await assert.rejects(
    () => summaryScan.runSummaryScan(worksRepo.getWork('verify-summary-2'), model),
    (error) => {
      assert.equal(error.code, 'output_truncated');
      assert.match(error.message, /se cortó/i);
      return true;
    },
  );
  assert.deepEqual(completions.map((call) => call.maxTokens), [2400, 8000], 'only one retry is attempted');
  assert.equal(getWorkSummary('verify-summary-2'), null, 'a clipped summary is never stored');
  assert.equal(worksRepo.getWork('verify-summary-2').summary_status, 'failed');

  console.log('\n✅ the summary asks for real headroom, retries a thinking model once at 8,000 tokens and never stores a clipped sentence');
} finally {
  try { closeDb(); } catch { /* ignore */ }
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
