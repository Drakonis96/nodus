import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-deep-normalization-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-deep-result-normalization.mjs'), '--electron-deep-normalization-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-deep-normalization-'));
installRuntimeHooks(root);
try {
  const { normalizeDeepResult, isDeepResult, mergeByLabel } = require(path.join(repoRoot, 'electron/ai/deepScan.ts'));
  const normalized = normalizeDeepResult({
    document: { processing_status: 'ok' },
    theme_nodes: [{ id: 't1', statement: 'Historia cultural del turismo', role: 'primary', confidence: 2 }],
    ideas: [{
      id: 'i1', statement: 'El turismo articuló una nueva cultura de movilidad.', role: 'principal',
      type: 'unexpected-type', confidence: -3, evidence: [{ quote: 'cultura de movilidad', source: 's1', page: 12, kind: 'explicit' }],
    }],
    internal_relations: [{ from: '', to: 'i1', type: 'supports' }],
    external_references: null,
    gaps: [{ kind: 'limitation', statement: 'Faltan archivos regionales.', evidence: { quote: 'archivos regionales', location: 's1 p. 13' } }],
    authors_detail: [{ name: null }, { name: 'Ana Pérez', affiliation: 42 }],
  }, new Map([['s1', 'zotero:user:0:ATTACH']]), 's1', new Map([
    ['zotero:user:0:ATTACH', new Map([[12, 'El texto describe una cultura de movilidad.'], [13, 'Faltan archivos regionales.']])],
  ]));

  assert.equal(isDeepResult(normalized), true, 'normalizer must feed only strict results to merge/checkpoint');
  assert.equal(normalized.ideas[0].label, 'El turismo articuló una nueva cultura de movilidad.');
  assert.equal(normalized.ideas[0].type, 'claim');
  assert.equal(normalized.ideas[0].confidence, 0);
  assert.equal(normalized.ideas[0].evidence[0].source_ref, 'zotero:user:0:ATTACH');
  assert.equal(normalized.ideas[0].evidence[0].page_number, 12);
  assert.equal(normalized.theme_nodes[0].label, 'Historia cultural del turismo');
  assert.equal(normalized.theme_nodes[0].confidence, 1);
  assert.equal(normalized.internal_relations.length, 0, 'relations with missing endpoints are dropped');
  assert.equal(normalized.gaps[0].evidence.source_ref, 'zotero:user:0:ATTACH');
  assert.equal(normalized.gaps[0].evidence.page_number, 13);
  assert.deepEqual(normalized.authors_detail, [{ name: 'Ana Pérez', affiliation: null, stance_notes: null }]);

  const corpus = new Map([['zotero:user:0:ATTACH', new Map([[1, 'La cita literal está en la primera página.'], [2, 'Otro texto.']])]]);
  const corrected = normalizeDeepResult({
    document: {}, ideas: [{ id: 'i1', label: 'Idea', statement: 'Idea', evidence: [
      { quote: 'La cita literal está en la primera página.', source: 's1', page: 999, kind: 'explicit' },
      { quote: 'Cita inventada', source: 's1', page: 888, kind: 'explicit' },
    ] }],
  }, new Map([['s1', 'zotero:user:0:ATTACH']]), 's1', corpus);
  assert.equal(corrected.ideas[0].evidence[0].page_number, 1, 'a literal quote uniquely found elsewhere corrects the model page');
  assert.equal(corrected.ideas[0].evidence[0].kind, 'explicit');
  assert.equal(corrected.ideas[0].evidence[1].page_number, null, 'a page outside the extracted corpus is never retained');
  assert.equal(corrected.ideas[0].evidence[1].kind, 'paraphrased', 'an invented literal quote is downgraded');

  const relation = (from, to) => ({ from, to, type: 'supports', basis: 'explicit', evidence: { quote: '', location: null, source_ref: null, page_number: null, kind: 'paraphrased' }, confidence: 1 });
  const idea = (id, label) => ({ id, type: 'claim', label, statement: label, role: 'principal', development: label, evidence: [], theme_labels: [], confidence: 1, uncertainty_reason: null });
  const merged = mergeByLabel([
    { document: {}, theme_nodes: [], ideas: [idea('i1', 'Primera'), idea('i2', 'Segunda')], internal_relations: [relation('i1', 'i2')], external_references: [], gaps: [], authors_detail: [] },
    { document: {}, theme_nodes: [], ideas: [idea('i1', 'Tercera'), idea('i2', 'Cuarta')], internal_relations: [relation('i1', 'i2')], external_references: [], gaps: [], authors_detail: [] },
  ]);
  assert.deepEqual(merged.internal.map(({ from, to }) => [from, to]), [['primera', 'segunda'], ['tercera', 'cuarta']],
    'provider-local ids are scoped to their own chunk');
} finally {
  try { require(path.join(repoRoot, 'electron/db/database.ts')).closeDb(); } catch {}
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return {
      app: { getPath: () => userDataPath, getVersion: () => '0.0.0-test', getAppPath: () => repoRoot, isPackaged: false },
      safeStorage: { isEncryptionAvailable: () => false, encryptString: (value) => Buffer.from(String(value)), decryptString: (value) => Buffer.from(value).toString() },
      dialog: {}, shell: {}, BrowserWindow: class {}, ipcMain: { handle: () => undefined, on: () => undefined },
    };
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true, skipLibCheck: true },
    }).outputText;
    module._compile(output, filename);
  };
}
