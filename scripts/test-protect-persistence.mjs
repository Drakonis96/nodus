import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
if (!process.argv.includes('--electron-protect-persistence-test')) {
  execFileSync(path.join(root, 'node_modules/.bin/electron'), [path.join(root, 'scripts/test-protect-persistence.mjs'), '--electron-protect-persistence-test'],
    { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-protect-persistence-'));
installRuntimeHooks(userData);
let closeDb = () => undefined;
try {
  const { getDb, ...database } = require(path.join(root, 'electron/db/database.ts'));
  closeDb = database.closeDb;
  const { SCHEMA_VERSION, migrations } = require(path.join(root, 'electron/db/migrations.ts'));
  const copies = require(path.join(root, 'electron/db/protectCopiesRepo.ts'));
  const db = getDb();
  assert.equal(SCHEMA_VERSION, 90);
  assert.equal(Math.max(...migrations.map((migration) => migration.version)), 90);
  assert.equal(db.pragma('user_version', { simple: true }), 90);
  const columns = db.prepare('PRAGMA table_info(protect_copies)').all().map((column) => column.name);
  assert.deepEqual(columns, ['id', 'file_name', 'mime_type', 'bytes', 'sha256', 'blob', 'source_kind', 'source_label', 'created_at', 'updated_at', 'deleted_at']);
  assert.equal(columns.includes('path'), false, 'disk paths are never persisted');
  assert.equal(columns.includes('passphrase'), false, 'passphrases are never persisted');

  const bytes = new TextEncoder().encode('rasterised artifact');
  const saved = copies.saveProtectCopy({ fileName: 'documento-protegido.pdf', mimeType: 'application/pdf', format: 'pdf', pageCount: 2, bytes, sourceKind: 'mixed', sourceLabel: 'a.pdf, b.png' });
  assert.match(saved.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(saved.bytes, bytes.length);
  assert.match(saved.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(new Uint8Array(copies.getProtectCopyBlob(saved.id)), bytes);
  assert.equal(copies.listProtectCopies('documento').length, 1);
  assert.equal(copies.listProtectCopies('a.pdf').length, 1, 'source labels are searchable');

  copies.deleteProtectCopy(saved.id);
  assert.equal(copies.getProtectCopy(saved.id), null);
  assert.equal(copies.getProtectCopyBlob(saved.id), null);
  const tombstone = db.prepare('SELECT bytes, blob, deleted_at, updated_at FROM protect_copies WHERE id = ?').get(saved.id);
  assert.equal(tombstone.bytes, 0); assert.equal(tombstone.blob, null);
  assert.ok(tombstone.deleted_at && tombstone.updated_at === tombstone.deleted_at, 'delete leaves the minimum synchronisable tombstone');

  console.log('Nodus Protect persistence test passed');
} finally {
  closeDb();
  await rm(userData, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(root, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return { app: { getPath: () => userDataPath, getVersion: () => 'test', getAppPath: () => root, isPackaged: false }, safeStorage: { isEncryptionAvailable: () => false } };
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs,
      esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true, skipLibCheck: true,
    } }).outputText, filename);
  };
}
