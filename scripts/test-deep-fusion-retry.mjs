// A single schema-invalid fusion reply used to kill an entire deep pass.
//
// On a big work there are thousands of fusion calls, so one transient provider hiccup
// (a hang or a stray JSON shape) marked the whole work failed even though all the
// extraction and most of the fusion had already succeeded. Fusion decisions are now
// checkpointed per idea: the failed ones are retried later and the rest are reused.
//
// Observed from the provider's side, which is the only place the resume is visible:
// the first pass asks the model about every idea and throws a RETRIABLE error when one
// fails; the second pass asks only about the idea that failed.
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

if (!process.argv.includes('--electron-deep-fusion-retry-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-deep-fusion-retry.mjs'), '--electron-deep-fusion-retry-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-deep-fusion-'));
installRuntimeHooks(root);

const LABELS = ['alpha', 'beta', 'gamma'];
const extractionReply = () => JSON.stringify({
  document: { type: 'article', summary: 'sintético' },
  ideas: LABELS.map((label) => ({ label, statement: `Afirmación de ${label}.`, confidence: 0.8 })),
  internal_relations: [], external_references: [], gaps: [], authors_detail: [], theme_nodes: [],
});
const fusionReply = (label) => JSON.stringify({
  resolution: 'new', matched_id: null, merged_label: label,
  edge_to_existing: null, rationale: 'sin relación', confidence: 0.5,
});

/** Fail every fusion call for this label until the test flips it back. */
let failLabel = 'alpha';
const fusionCalls = [];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const parsed = JSON.parse(body || '{}');
    const user = parsed.input ?? parsed.messages?.find((m) => m.role === 'user')?.content ?? '';
    let payload = null;
    try { payload = JSON.parse(user); } catch { /* embeddings and other shapes */ }
    if (payload?.new_idea) {
      const label = payload.new_idea.label;
      fusionCalls.push(label);
      res.writeHead(200, { 'content-type': 'application/json' });
      if (label === failLabel) {
        // Schema-invalid on purpose: no merged_label/rationale/confidence.
        res.end(JSON.stringify({ output_text: JSON.stringify({ resolution: 'new' }), finish_reason: 'stop' }));
      } else {
        res.end(JSON.stringify({ output_text: fusionReply(label), finish_reason: 'stop' }));
      }
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ output_text: extractionReply(), finish_reason: 'stop' }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

let closeDb = () => undefined;
try {
  const settingsRepo = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const worksRepo = require(path.join(repoRoot, 'electron/db/worksRepo.ts'));
  const ideasRepo = require(path.join(repoRoot, 'electron/db/ideasRepo.ts'));
  const { getDb, closeDb: close } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const deepScan = require(path.join(repoRoot, 'electron/ai/deepScan.ts'));
  closeDb = close;

  const model = { provider: 'lmstudio', model: 'fake-local-model' };
  settingsRepo.updateSettings({
    localProviders: { lmstudio: { baseUrl } },
    extractionModel: model, fusionModel: model, synthesisModel: model,
    modelSettingsMode: 'advanced', deepContextMode: 'standard', deepStandardChunkWords: 1800,
  });

  // A candidate per idea so every fusion reaches the model (lexical retrieval is
  // enough; no embedding provider is configured in this temp vault).
  for (const label of LABELS) {
    ideasRepo.createIdea({ type: 'claim', label, statement: `Afirmación de ${label}.`, embedding: null, themes: [] });
  }

  worksRepo.upsertWork({
    nodus_id: 'verify-fusion-1', zotero_key: 'VERIFYF1', zotero_version: 1,
    title: 'Obra sintética para el reintento de fusión', authors: ['Autora Sintética'],
    year: 2026, item_type: 'journalArticle', doi: null, read_tag: true, zoteroTags: [],
  });
  const work = worksRepo.getWork('verify-fusion-1');
  assert.ok(work, 'the synthetic work exists');

  const sentence = 'La transferencia de conocimiento entre disciplinas produce efectos que ninguna de ellas anticipa por separado. ';
  const text = sentence.repeat(80);

  // First pass: one idea's fusion is invalid, so the pass must fail RETRIABLY and
  // keep the decisions that did succeed.
  await assert.rejects(
    () => deepScan.runDeepScan(work, { text, sourceType: 'full_text', notes: null }, model),
    (error) => {
      assert.equal(error.retriable, true, 'a fusion miss must be retriable, not terminal');
      assert.match(error.message, /fusionar/i);
      return true;
    },
  );
  const checkpointed = getDb()
    .prepare("SELECT count(*) AS c FROM scan_checkpoints WHERE nodus_id = ? AND kind = 'deep_fusion'")
    .get('verify-fusion-1').c;
  console.log('[deep-fusion] checkpoints after the failed pass:', checkpointed, '| fusion calls:', JSON.stringify(fusionCalls));
  assert.ok(checkpointed >= 2, 'the decisions that did succeed must be checkpointed');
  assert.ok(fusionCalls.includes('alpha') && fusionCalls.includes('beta'), 'every idea was attempted once');

  // Second pass: alpha now answers. The checkpointed ideas must not be asked again.
  failLabel = null;
  fusionCalls.length = 0;
  await deepScan.runDeepScan(worksRepo.getWork('verify-fusion-1'), { text, sourceType: 'full_text', notes: null }, model);
  console.log('[deep-fusion] fusion calls on the resumed pass:', JSON.stringify(fusionCalls));
  assert.deepEqual([...fusionCalls].sort(), ['alpha'], 'only the previously failed idea is re-asked');
  const after = worksRepo.getWork('verify-fusion-1');
  assert.equal(after.deep_status, 'done', 'the resumed pass completes the work');

  console.log('\n✅ a bad fusion reply is retriable and the resume only redoes the idea that failed');
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
    safeStorage: { isEncryptionAvailable: () => false, encryptString: (v) => Buffer.from(String(v)), decryptString: (v) => Buffer.from(v).toString() },
    dialog: {}, shell: {}, BrowserWindow: class {}, ipcMain: { handle: () => undefined, on: () => undefined },
  };
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function (module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    module._compile(ts.transpileModule(source, { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true, skipLibCheck: true } }).outputText, filename);
  };
}
