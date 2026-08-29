// A timed-out extraction chunk used to kill the whole deep pass.
//
// `completeAdaptive` only ever recovered from truncation, so the first slow chunk threw
// and the work was marked failed with "timed out waiting for the AI provider" — which on
// a local model meant every long work, every time. A timeout is now answered the way
// truncation is, by asking for less: the chunk is split and its halves are analysed on
// their own.
//
// Both halves of that policy are pinned here, because the dangerous version of this fix
// is the one that retries everything. Splitting costs a full transport budget per attempt
// on the user's own machine, so a failure that asking for less cannot fix — a rejected
// key — must still abort on the spot.
//
// Observed from the provider's side, which is the only place the recovery is visible: the
// first request carries the whole chunk, and after it times out the server sees smaller
// ones instead of nothing.
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

if (!process.argv.includes('--electron-deep-timeout-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-deep-scan-timeout-recovery.mjs'), '--electron-deep-timeout-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-deep-timeout-'));
installRuntimeHooks(root);

const deepReply = (label) => JSON.stringify({
  document: { type: 'article', summary: 'sintético' },
  ideas: [{ label, statement: `Afirmación de ${label}.`, confidence: 0.8 }],
  internal_relations: [], external_references: [], gaps: [], authors_detail: [], theme_nodes: [],
});

let hits = [];
/** The real phenomenon: the big chunk is more than the model can generate in time,
 *  its halves are not. (A 400 also costs two wire calls — the SDK path retries once
 *  without the optional params — so "fail the first request" would not model it.) */
const TOO_BIG_WORDS = 700;
/** Flipped for the second scenario: every request is refused with a bad key. */
let rejectAll = false;
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const parsed = JSON.parse(body || '{}');
    const user = parsed.messages?.find((m) => m.role === 'user')?.content ?? '';
    let words = 0;
    try { words = JSON.parse(user).chunk?.word_count ?? 0; } catch { /* fusion calls are not chunk-shaped */ }
    hits.push({ words, chars: user.length });
    if (rejectAll) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'invalid api key' } }));
      return;
    }
    if (words > TOO_BIG_WORDS) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'request timed out' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: deepReply(`idea-${hits.length}`) }, finish_reason: 'stop' }] }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

let closeDb = () => undefined;
try {
  const settingsRepo = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const worksRepo = require(path.join(repoRoot, 'electron/db/worksRepo.ts'));
  const deepScan = require(path.join(repoRoot, 'electron/ai/deepScan.ts'));
  ({ closeDb } = require(path.join(repoRoot, 'electron/db/database.ts')));

  const model = { provider: 'lmstudio', model: 'slow-local-model' };
  settingsRepo.updateSettings({
    localProviders: { lmstudio: { baseUrl } },
    extractionModel: model, fusionModel: model, synthesisModel: model,
    modelSettingsMode: 'advanced', deepContextMode: 'standard', deepStandardChunkWords: 1800,
  });

  worksRepo.upsertWork({
    nodus_id: 'verify-split-1', zotero_key: 'VERIFY1', zotero_version: 1,
    title: 'Obra sintética para el reparto por timeout', authors: ['Autora Sintética'],
    year: 2026, item_type: 'journalArticle', doi: null, read_tag: true, zoteroTags: [],
  });
  const work = worksRepo.getWork('verify-split-1');
  assert.ok(work, 'the synthetic work exists');

  // ~1.200 words: one chunk, comfortably over the 400-word floor the splitter needs.
  const sentence = 'La transferencia de conocimiento entre disciplinas produce efectos que ninguna de ellas anticipa por separado. ';
  const text = sentence.repeat(80);
  const words = text.split(/\s+/).filter(Boolean).length;
  console.log(`[deep-timeout] one chunk of ~${words} words`);

  await deepScan.runDeepScan(work, { text, sourceType: 'full_text', notes: null }, model);

  const chunkCalls = hits.filter((hit) => hit.words > 0);
  console.log('[deep-timeout] chunk requests the provider saw:', JSON.stringify(chunkCalls.map((h) => h.words)));
  assert.equal(chunkCalls[0].words, words, 'the first attempt carried the whole chunk');
  const smaller = chunkCalls.filter((hit) => hit.words < words);
  assert.ok(smaller.length >= 2, `the timed-out chunk must come back as smaller pieces, saw ${JSON.stringify(chunkCalls.map((h) => h.words))}`);
  assert.ok(smaller.every((hit) => hit.words <= TOO_BIG_WORDS), 'and the pieces must be small enough to finish');

  const after = worksRepo.getWork('verify-split-1');
  console.log(`[deep-timeout] deep_status=${after.deep_status} deep_error=${after.deep_error ?? 'null'}`);
  assert.equal(after.deep_status, 'done', 'the deep pass completed instead of dying on the slow chunk');
  assert.equal(after.deep_error, null, 'and recorded no failure');

  // --- The other half of the contract -----------------------------------------
  //
  // Splitting costs a full transport budget per attempt on the user's own machine, so it
  // is reserved for failures that asking for less can actually fix. A rejected key is not
  // one: it must abort on the spot, exactly as before.
  rejectAll = true;
  hits = [];
  worksRepo.upsertWork({
    nodus_id: 'verify-split-2', zotero_key: 'VERIFY2', zotero_version: 1,
    title: 'Obra sintética para el caso no recuperable', authors: ['Autora Sintética'],
    year: 2026, item_type: 'journalArticle', doi: null, read_tag: true, zoteroTags: [],
  });
  await assert.rejects(
    () => deepScan.runDeepScan(worksRepo.getWork('verify-split-2'), { text, sourceType: 'full_text', notes: null }, model),
    (error) => {
      assert.match(error.message, /Clave de IA inválida/, 'a rejected key is reported as itself');
      return true;
    },
  );
  const rejectedChunkCalls = hits.filter((hit) => hit.words > 0);
  console.log('[deep-timeout] chunk requests for the unrecoverable case:', JSON.stringify(rejectedChunkCalls.map((h) => h.words)));
  assert.ok(rejectedChunkCalls.every((hit) => hit.words === words),
    'a rejected key must never be answered by splitting the text: nothing smaller would help');

  console.log('\n✅ a timed-out chunk is split and recovered; an unrecoverable failure still aborts at once');
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
