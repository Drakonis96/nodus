// Opt-in QA against the user's running Zotero. It never writes to Zotero and uses
// an isolated Nodus database/cache. Not part of `npm test` because CI has no Zotero.
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
if (!process.argv.includes('--electron-real-resolution')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/qa-real-text-resolution.mjs'), '--electron-real-resolution'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-real-resolution-'));
installRuntimeHooks(root);
let closeDb = () => undefined;
try {
  const { extractFromPath, resolveWorkText, resolvedTextStateFromDoc } = require(path.join(repoRoot, 'electron/extraction/textExtractor.ts'));
  ({ closeDb } = require(path.join(repoRoot, 'electron/db/database.ts')));
  const specs = [
    { key: 'HQ2KY8DY', title: 'Historia del turismo en España en el siglo XX', expectedPages: 368, fallbackPath: process.env.NODUS_QA_HISTORIA_PDF ?? '' },
    { key: 'TQK7GK7Y', title: 'Touring Cultures', expectedPages: null },
  ];
  const output = [];
  for (const spec of specs) {
    let doc = await resolveWorkText('0', spec.key, '', null, null, {
      unpaywallEmail: '', preferZoteroFulltext: true,
      ocr: { enabled: false, languages: 'spa+eng', maxPages: 0 },
    }, 'book');
    let mode = 'zotero-resolver';
    if (!doc.text.trim() && spec.fallbackPath && fs.existsSync(spec.fallbackPath)) {
      doc = await extractFromPath(spec.fallbackPath, { ocr: { enabled: false, languages: 'spa+eng', maxPages: 0 } });
      mode = 'direct-local-fallback';
    }
    if (!doc.text.trim() && !spec.expectedPages) {
      output.push({ title: spec.title, skipped: true, reason: doc.notes ?? 'Zotero local API unavailable' });
      continue;
    }
    const state = resolvedTextStateFromDoc(doc);
    assert.ok(doc.text.length > 200, `${spec.title}: usable text`);
    if (mode === 'zotero-resolver') {
      assert.ok((doc.segments ?? []).length > 0, `${spec.title}: source inventory`);
      assert.ok((doc.segments ?? []).every((segment) => segment.origin === 'local_attachment'), `${spec.title}: local files win over Zotero fulltext`);
      assert.match(doc.text, /\[\[src:s1(?:\s+p\.\d+)?\]\]/, `${spec.title}: attachment marker`);
    }
    if (spec.expectedPages) {
      assert.equal(doc.segments?.[0]?.pageCount ?? doc.analysis?.pageCount, spec.expectedPages);
      assert.match(doc.text, /\[\[(?:src:s\d+\s+)?p\.\s*368\]\]/);
    }
    output.push({ title: spec.title, mode, chars: doc.text.length, sourceType: state.sourceType, sources: state.sourceCount, pages: (doc.segments ?? []).map((segment) => segment.pageCount), origins: (doc.segments ?? []).map((segment) => segment.origin), pageMarkers: (doc.segments ?? []).map((segment) => segment.hasPageMarkers) });
  }
  console.log(JSON.stringify(output, null, 2));
} finally {
  try { closeDb(); } catch {}
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
