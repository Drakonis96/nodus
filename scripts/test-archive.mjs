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

if (!process.argv.includes('--electron-archive-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-archive.mjs'), '--electron-archive-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-archive-test-'));
installRuntimeHooks(root);

try {
  const repo = require(path.join(repoRoot, 'electron/db/archiveRepo.ts'));
  const { ingestArchiveFile } = require(path.join(repoRoot, 'electron/archive/archiveIngest.ts'));
  const { getDb } = require(path.join(repoRoot, 'electron/db/database.ts'));

  assert.equal(getDb().pragma('user_version', { simple: true }), 34, 'DB migrated to schema v34');

  // ── Folders: nesting + cascade ────────────────────────────────────────────
  const censos = repo.createFolder('Censos');
  const sub = repo.createFolder('1875', censos.folderId);
  assert.equal(repo.listFolders().length, 2);
  assert.equal(sub.parentId, censos.folderId);

  // ── Items with blob + tags + extracted text ───────────────────────────────
  const item = repo.createItem({
    folderId: sub.folderId,
    title: 'Hoja censal',
    kind: 'image',
    fileName: 'hoja.png',
    mimeType: 'image/png',
    blob: Buffer.from('PNGDATA'),
    extractedText: 'Juan Pérez jornalero',
    tags: ['censo', 'Sevilla', 'censo'], // duplicate tag ignored
  });
  const fetched = repo.getItem(item.itemId);
  assert.equal(fetched.hasBlob, true, 'item reports it has a blob');
  assert.equal(fetched.bytes, Buffer.from('PNGDATA').length, 'byte count derived from blob');
  assert.deepEqual(fetched.tags, ['Sevilla', 'censo'], 'tags de-duplicated and sorted');
  assert.equal(repo.getItemBlob(item.itemId).toString(), 'PNGDATA', 'blob fetched on demand');

  // List queries never carry the blob but do carry hasBlob.
  assert.equal(repo.listItems({ folderId: sub.folderId }).length, 1);
  assert.equal(repo.listItems({ tag: 'censo' }).length, 1);
  assert.equal(repo.listItems({ search: 'jornalero' }).length, 1, 'search hits extracted text');
  assert.equal(repo.listItems({ search: 'inexistente' }).length, 0);

  // ── Tags + counts ─────────────────────────────────────────────────────────
  repo.addTag(item.itemId, 'padrón');
  repo.removeTag(item.itemId, 'Sevilla');
  assert.deepEqual(repo.getItem(item.itemId).tags, ['censo', 'padrón']);
  assert.ok(repo.listTags().some((t) => t.tag === 'censo' && t.count === 1));

  // ── Folder delete unfiles its items (SET NULL), subfolders cascade ────────
  repo.deleteFolder(censos.folderId);
  assert.equal(repo.getFolder(sub.folderId), null, 'subfolder cascades away');
  assert.equal(repo.getItem(item.itemId).folderId, null, 'item is unfiled, not deleted');

  // ── Ingestion: CSV → extracted records + hash de-dupe ─────────────────────
  const csvPath = path.join(root, 'padron.csv');
  fs.writeFileSync(csvPath, 'Nombre,Anio,Lugar\nJuan Perez,1850,Sevilla\n');
  const first = await ingestArchiveFile(csvPath, { title: 'Padrón 1850', tags: ['padrón'] });
  assert.equal(first.duplicate, false);
  assert.equal(first.item.kind, 'csv');
  assert.equal(first.item.mimeType, 'text/csv');
  assert.match(first.item.extractedText, /Campos: Nombre . Anio . Lugar/);
  assert.ok(first.item.hasBlob, 'ingested file bytes stored');

  const second = await ingestArchiveFile(csvPath);
  assert.equal(second.duplicate, true, 're-ingesting the same bytes de-dupes');
  assert.equal(second.item.itemId, first.item.itemId, 'returns the existing item');

  const counts = repo.archiveCounts();
  assert.equal(counts.items, 2, 'the image item + one CSV (dedupe prevented a third)');

  // ── Cleanup path ──────────────────────────────────────────────────────────
  repo.deleteItem(item.itemId);
  assert.equal(repo.getItem(item.itemId), null);

  console.log('Evidence archive test passed!');
} finally {
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: {
      getPath: () => userDataPath,
      getVersion: () => '0.0.0-test',
      getAppPath: () => repoRoot,
      isPackaged: false,
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (v) => Buffer.from(String(v), 'utf8'),
      decryptString: (v) => Buffer.from(v).toString('utf8'),
    },
    dialog: {},
    shell: {},
    BrowserWindow: class {},
  };
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) {
      return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    }
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
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        resolveJsonModule: true,
        skipLibCheck: true,
      },
    }).outputText;
    module._compile(output, filename);
  };
}
