import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-library-storage-suite')) process.exit(0);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-global-library-'));
const userData = path.join(scratch, 'user-data');
const root = path.join(scratch, 'backups', 'nodus-library');
installRuntimeHooks(userData);
const require = createRequire(import.meta.url);

try {
  const { LibraryDiskStore } = require(path.join(repoRoot, 'electron/library/libraryStorage.ts'));
  const { LibraryCatalog, validateCollectionForest } = require(path.join(repoRoot, 'electron/library/libraryCatalog.ts'));
  const { recordContentHash } = require(path.join(repoRoot, 'electron/library/libraryRecord.ts'));
  const { safeLibraryFolderName } = require(path.join(repoRoot, 'electron/library/libraryPaths.ts'));

  const storeA = new LibraryDiskStore(root, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  storeA.initialize();
  const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(root, 'library.json'), 'utf8'));
  assert.equal(manifest.format, 'nodus.library');
  assert.equal(manifest.storage.localCatalog, false, 'the synchronized folder never carries live SQLite');
  assert.equal(manifest.sync.strategy, 'immutable-records');

  const parent = storeA.upsertCollection({
    id: 'zotero:personal:history', name: 'Historia', parentId: null, position: 0,
    source: 'zotero', sourceLibraryId: 'users/0', sourceKey: 'HISTORY',
  }, undefined, '2026-08-10T10:00:00.000Z');
  const child = storeA.upsertCollection({
    id: 'zotero:personal:postwar', name: 'Posguerra', parentId: parent.id, position: 0,
    source: 'zotero', sourceLibraryId: 'users/0', sourceKey: 'POSTWAR',
  }, undefined, '2026-08-10T10:00:01.000Z');
  assert.deepEqual(validateCollectionForest([parent, child]), []);

  const storageId = 'groups:42:E7FGXJFE';
  const folder = storeA.itemFolder(storageId);
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, 'reader.md'), '# Mujeres solas\n\nTexto limpio de la posguerra.\n');
  await writeFile(path.join(folder, 'original.pdf'), '%PDF-1.4\n% immutable fixture\n');
  const pdfHash = createHash('sha256').update('%PDF-1.4\n% immutable fixture\n').digest('hex');
  const initial = storeA.upsertItem({
    id: 'zotero:groups:42:E7FGXJFE',
    storageId,
    source: 'zotero',
    sourceLibraryId: 'groups/42',
    sourceKey: 'E7FGXJFE',
    citationKey: 'aliamirandaMujeresSolasPosguerra2017',
    metadata: {
      title: 'Mujeres solas en la posguerra española',
      itemType: 'article-journal',
      creators: [{ creatorType: 'author', firstName: 'Noelia', lastName: 'de la Cruz' }],
      year: 2017,
      doi: '10.0000/example',
      isbn: [], issn: ['0000-0000'], tags: ['posguerra'],
    },
    collectionIds: [child.id],
    attachments: [{
      id: 'attachment:E7FGXJFE', title: 'PDF', fileName: 'original.pdf', relativePath: 'original.pdf',
      mimeType: 'application/pdf', byteSize: 31, sha256: pdfHash, role: 'original', sourceKey: 'ATTACH01',
    }],
    files: { reader: 'reader.md', original: 'original.pdf', annotations: 'annotations.json' },
    extraction: { status: 'ready', progress: 1, engine: 'fixture' },
  }, undefined, '2026-08-10T10:00:02.000Z');
  assert.equal(initial.clock.revision, 1);
  assert.ok(existsSync(path.join(root, safeLibraryFolderName(storageId), 'metadata.json')));

  // Two offline devices edit revision 1 independently. Both immutable records survive;
  // reconciliation chooses deterministically and exposes a conflict for review.
  function divergent(deviceId, title) {
    const base = {
      ...initial,
      metadata: { ...initial.metadata, title },
    };
    delete base.clock;
    return {
      ...base,
      clock: {
        deviceId, revision: 2, baseRevision: 1, updatedAt: '2026-08-10T11:00:00.000Z',
        contentHash: recordContentHash(base),
      },
    };
  }
  const editA = divergent('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Mujeres solas — edición A');
  const editB = divergent('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Mujeres solas — edición B');
  storeA.mergeItem(editA);
  const storeB = new LibraryDiskStore(root, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  storeB.mergeItem(editB);
  const reconciled = storeA.reconcile();
  assert.equal(reconciled.conflicts, 1);
  assert.equal(storeA.readMaterializedItem(storageId).metadata.title, 'Mujeres solas — edición B');
  assert.ok(existsSync(path.join(root, '.nodus', 'conflicts', safeLibraryFolderName(initial.id))), 'losing edit is retained');

  // Invalid cloud debris is counted, ignored and never allowed into the catalog.
  const corruptFolder = path.join(root, '.nodus', 'records', 'items', 'corrupt');
  await mkdir(corruptFolder, { recursive: true });
  await writeFile(path.join(corruptFolder, 'broken.json'), '{not json');

  const catalogPath = path.join(userData, 'library', 'catalog.sqlite');
  let catalog = new LibraryCatalog(catalogPath);
  const rebuilt = catalog.rebuild(storeA);
  assert.equal(rebuilt.items, 1);
  assert.equal(rebuilt.collections, 2);
  assert.equal(rebuilt.attachments, 1);
  assert.equal(rebuilt.conflicts, 1);
  assert.equal(rebuilt.invalidRecords, 1);
  assert.equal(catalog.status(root, storeA.deviceId).items, 1);
  assert.equal(catalog.list({ search: 'posguerra', collectionId: child.id }).total, 1);
  assert.equal(catalog.list({ search: '10.0000/example' }).items[0].id, initial.id);
  assert.equal(catalog.list({ source: 'zotero' }).items[0].readerAvailable, true);
  catalog.close();

  // The catalog is disposable: removing only the local cache and rebuilding from the
  // synchronized manifests restores the exact query surface.
  await rm(path.dirname(catalogPath), { recursive: true, force: true });
  catalog = new LibraryCatalog(catalogPath);
  assert.equal(catalog.status(root, storeA.deviceId).lastRebuiltAt, null);
  assert.equal(catalog.rebuild(storeA).items, 1);
  assert.equal(catalog.list({ search: 'edición' }).total, 1);
  catalog.close();

  const cloudFiles = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(file);
      else cloudFiles.push(file);
    }
  }
  await walk(root);
  assert.ok(!cloudFiles.some((file) => /\.sqlite(?:-|$)/.test(file)), 'SQLite remains local and rebuildable');
  assert.deepEqual(validateCollectionForest([
    { ...parent, parentId: child.id }, child,
  ]), [child.id, parent.id].sort(), 'collection cycles are rejected before publication');

  console.log('Global library storage, sync-conflict and rebuild tests passed!');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
