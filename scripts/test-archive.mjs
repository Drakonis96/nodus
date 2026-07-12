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
  const ent = require(path.join(repoRoot, 'electron/db/entitiesRepo.ts'));
  const { ingestArchiveFile } = require(path.join(repoRoot, 'electron/archive/archiveIngest.ts'));
  const { getDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const { SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));

  const version = getDb().pragma('user_version', { simple: true });
  assert.equal(version, SCHEMA_VERSION, `DB migrated to schema v${SCHEMA_VERSION}`);
  assert.ok(version >= 34, 'archive tables present');

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
    description: 'Fotografía de una hoja de padrón manuscrita en buen estado',
    tags: ['censo', 'Sevilla', 'censo'], // duplicate tag ignored
  });
  const fetched = repo.getItem(item.itemId);
  assert.equal(fetched.hasBlob, true, 'item reports it has a blob');
  assert.equal(fetched.description, 'Fotografía de una hoja de padrón manuscrita en buen estado', 'visual description stored');
  assert.equal(repo.listItems({ search: 'manuscrita' }).length, 1, 'search hits the visual description');
  assert.equal(fetched.bytes, Buffer.from('PNGDATA').length, 'byte count derived from blob');
  assert.deepEqual(fetched.tags, ['Sevilla', 'censo'], 'tags de-duplicated and sorted');
  assert.equal(repo.getItemBlob(item.itemId).toString(), 'PNGDATA', 'blob fetched on demand');

  // List queries never carry the blob but do carry hasBlob.
  assert.equal(repo.listItems({ folderId: sub.folderId }).length, 1);
  assert.equal(repo.listItems({ tags: ['censo'] }).length, 1);
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

  // ── Document type + metadata form ─────────────────────────────────────────
  const partida = repo.createItem({
    title: 'Partida de Juan',
    kind: 'image',
    docType: 'birth_record',
    metadata: { persona: 'Juan Pérez', padre: 'Pedro Pérez', inventado: 'x' }, // unknown key dropped
  });
  const gotPartida = repo.getItem(partida.itemId);
  assert.equal(gotPartida.docType, 'birth_record');
  assert.deepEqual(gotPartida.metadata, { persona: 'Juan Pérez', padre: 'Pedro Pérez' }, 'metadata sanitised to the type');
  assert.equal(repo.listItems({ search: 'Pedro Pérez' }).length, 1, 'search hits a metadata value');
  // Changing the type re-sanitises the metadata against the new field set.
  repo.updateItem(partida.itemId, { docType: 'photograph' });
  assert.equal(repo.getItem(partida.itemId).docType, 'photograph');

  const counts = repo.archiveCounts();
  assert.equal(counts.items, 3, 'image + CSV + partida (dedupe prevented a 4th)');

  // ── Document ↔ person links ───────────────────────────────────────────────
  const juan = ent.createPerson({ displayName: 'Juan Pérez' });
  repo.linkItemPerson(partida.itemId, juan.personId);
  assert.deepEqual(
    repo.getItem(partida.itemId).linkedPersons.map((p) => p.displayName),
    ['Juan Pérez'],
    'linked person surfaces on the item'
  );
  assert.deepEqual(
    repo.listItemsForPerson(juan.personId).map((i) => i.itemId),
    [partida.itemId],
    'the document is found from the person'
  );
  repo.linkItemPerson(partida.itemId, juan.personId); // idempotent
  assert.equal(repo.getItem(partida.itemId).linkedPersons.length, 1, 'linking is idempotent');
  repo.unlinkItemPerson(partida.itemId, juan.personId);
  assert.equal(repo.getItem(partida.itemId).linkedPersons.length, 0, 'unlink removes the link');

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
