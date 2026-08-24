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
if (!process.argv.includes('--electron-deep-state-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-deep-state-persistence.mjs'), '--electron-deep-state-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-deep-state-'));
installRuntimeHooks(root);
let closeDb = () => undefined;
try {
  const database = require(path.join(repoRoot, 'electron/db/database.ts'));
  const works = require(path.join(repoRoot, 'electron/db/worksRepo.ts'));
  const ideas = require(path.join(repoRoot, 'electron/db/ideasRepo.ts'));
  closeDb = database.closeDb;
  const db = database.getDb();
  db.prepare(`INSERT INTO works (
    nodus_id,zotero_key,title,authors_json,item_type,source_type,light_status,deep_status,
    deep_hash,summary_status,archived,notes
  ) VALUES ('w1','Z1','Obra','[]','book','pdf','done','done','old-hash','none',0,'nota anterior')`).run();
  db.prepare("INSERT INTO ideas (global_id,type,label,statement,created_at) VALUES ('g-test','claim','idea','idea anterior',?)").run(new Date().toISOString());
  db.prepare("INSERT INTO idea_occurrences (global_id,nodus_id,role,development,confidence) VALUES ('g-test','w1','principal','anterior',1)").run();

  works.setResolvedTextState('w1', {
    sourceType: 'epub', textHash: 'new-hash', textChars: 500, sourceCount: 1,
    hasPageMarkers: false, blockReason: null, notes: null, resolvedAt: '2026-01-01T00:00:00.000Z',
    sources: [{ nodus_id: 'w1', source_ref: 'zotero:user:0:A', origin: 'local_attachment', source_type: 'epub', zotero_library_id: '0', attachment_key: 'A', display_name: 'a.epub', content_hash: 'a', char_count: 500, page_count: null, has_page_markers: 0, ordinal: 0, active: 1, resolved_at: '2026-01-01T00:00:00.000Z' }],
  });
  let row = db.prepare('SELECT * FROM works WHERE nodus_id=?').get('w1');
  assert.equal(row.source_type, 'pdf', 'resolution never rewrites the committed analysis source');
  assert.equal(row.deep_hash, 'old-hash');
  assert.equal(row.resolved_source_type, 'epub');

  works.setDeepPending('w1');
  works.setDeepResult('w1', 'failed', null, null, 'fallo nuevo');
  row = db.prepare('SELECT * FROM works WHERE nodus_id=?').get('w1');
  assert.equal(row.deep_hash, 'old-hash');
  assert.equal(row.source_type, 'pdf');
  assert.equal(row.notes, 'nota anterior');
  assert.equal(row.deep_error, 'fallo nuevo');
  assert.equal(db.prepare("SELECT COUNT(*) count FROM idea_occurrences WHERE nodus_id='w1'").get().count, 1);

  assert.throws(() => db.transaction(() => {
    ideas.purgeDeepData('w1');
    throw new Error('fault after purge');
  })());
  assert.equal(db.prepare("SELECT COUNT(*) count FROM idea_occurrences WHERE nodus_id='w1'").get().count, 1, 'transaction rollback restores the previous analysis');

  works.setDeepResult('w1', 'done', 'new-hash', 'epub', null);
  row = db.prepare('SELECT * FROM works WHERE nodus_id=?').get('w1');
  assert.equal(row.deep_hash, 'new-hash');
  assert.equal(row.source_type, 'epub');
  assert.equal(row.notes, null);
  assert.equal(row.deep_error, null);

  works.setResolvedTextState('w1', {
    sourceType: 'pdf', textHash: 'third-hash', textChars: 700, sourceCount: 1,
    hasPageMarkers: true, blockReason: null, notes: null, resolvedAt: '2026-01-02T00:00:00.000Z',
    sources: [{ nodus_id: 'w1', source_ref: 'zotero:user:0:B', origin: 'local_attachment', source_type: 'pdf', zotero_library_id: '0', attachment_key: 'B', display_name: 'b.pdf', content_hash: 'b', char_count: 700, page_count: 2, has_page_markers: 1, ordinal: 0, active: 1, resolved_at: '2026-01-02T00:00:00.000Z' }],
  });
  assert.equal(db.prepare("SELECT active FROM work_text_sources WHERE nodus_id='w1' AND source_ref='zotero:user:0:A'").get().active, 0, 'old evidence source remains addressable');
  assert.equal(db.prepare("SELECT active FROM work_text_sources WHERE nodus_id='w1' AND source_ref='zotero:user:0:B'").get().active, 1);
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
