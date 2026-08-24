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
  const { normalizeDeepResult, isDeepResult } = require(path.join(repoRoot, 'electron/ai/deepScan.ts'));
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
  }, new Map([['s1', 'zotero:user:0:ATTACH']]), 's1');

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
