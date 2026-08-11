import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-global-library-operations-suite')) process.exit(0);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-global-library-ops-'));
const userData = path.join(scratch, 'user-data');
const root = path.join(scratch, 'backups', 'nodus-library');
installRuntimeHooks(userData);
const require = createRequire(import.meta.url);

try {
  const { LibraryDiskStore } = require(path.join(repoRoot, 'electron/library/libraryStorage.ts'));
  const { LibraryCatalog } = require(path.join(repoRoot, 'electron/library/libraryCatalog.ts'));
  const { LibraryOperations } = require(path.join(repoRoot, 'electron/library/libraryOperations.ts'));
  const store = new LibraryDiskStore(root, 'operations-device-0001');
  const catalog = new LibraryCatalog(path.join(userData, 'library', 'catalog.sqlite'));
  const operations = new LibraryOperations(store, catalog);

  const history = operations.createCollection('Historia', null);
  const women = operations.createCollection('Mujeres', history.id);
  const postwar = operations.createCollection('Posguerra', women.id);
  assert.equal(postwar.parentId, women.id);
  const initialCollections = operations.listCollections();
  assert.equal(initialCollections.find((entry) => entry.id === history.id)?.parentId, null);
  assert.equal(initialCollections.find((entry) => entry.id === women.id)?.parentId, history.id);
  assert.equal(initialCollections.find((entry) => entry.id === postwar.id)?.parentId, women.id);
  assert.throws(() => operations.updateCollection(history.id, { parentId: postwar.id }), /ciclo/);
  assert.equal(operations.updateCollection(women.id, { name: 'Historia de las mujeres' }).name, 'Historia de las mujeres');

  // Imported collection names remain a read-only mirror; Nodus collections are independent.
  store.upsertCollection({ id: 'zotero:ROOT', name: 'Zotero', parentId: null, position: 0, source: 'zotero', sourceLibraryId: 'users/0', sourceKey: 'ROOT' });
  catalog.rebuild(store);
  assert.throws(() => operations.updateCollection('zotero:ROOT', { name: 'Cambio local' }), /gestor/);
  assert.throws(() => operations.deleteCollection('zotero:ROOT'), /gestor de origen/);

  const sourceDir = path.join(scratch, 'imports');
  await mkdir(sourceDir, { recursive: true });
  const firstFile = path.join(sourceDir, 'entre-norma-y-deseo.md');
  const secondFile = path.join(sourceDir, 'datos.csv');
  const unsupported = path.join(sourceDir, 'programa.exe');
  await writeFile(firstFile, '# Entre norma y deseo\n\nTexto limpio.\n');
  await writeFile(secondFile, 'a,b\n1,2\n');
  await writeFile(unsupported, 'not a document');
  const imported = operations.importLocalFiles([firstFile, secondFile, unsupported], postwar.id);
  assert.equal(imported.created, 2);
  assert.equal(imported.skipped, 1);
  assert.equal(imported.warnings.length, 1);
  assert.equal(catalog.list({ collectionId: postwar.id }).total, 2);
  assert.equal(catalog.list({ hasAttachments: true }).total, 2);
  assert.equal(catalog.list({ source: 'nodus' }).total, 2);
  const first = store.scanMaterializedItems().records.find((item) => item.metadata.title === 'entre norma y deseo');
  const second = store.scanMaterializedItems().records.find((item) => item.metadata.title === 'datos');
  assert.ok(first);
  assert.ok(second);
  assert.ok(existsSync(path.join(store.itemFolder(first.storageId), first.files.original)));
  const secondOriginal = path.join(store.itemFolder(second.storageId), second.files.original);
  assert.ok(existsSync(secondOriginal));
  assert.equal(operations.importLocalFiles([firstFile], postwar.id).skipped, 1, 'content hashes reject a duplicate import');

  assert.equal(operations.patchItemCollections([first.id], { add: [history.id], remove: [postwar.id] }), 1);
  assert.deepEqual(store.readMaterializedItem(first.storageId).collectionIds, [history.id]);
  assert.equal(catalog.list({ collectionId: history.id }).total, 1);

  // Zotero refresh membership and user-owned organization can coexist in one item.
  const zotero = store.upsertItem({
    id: 'zotero:ITEM01', storageId: 'ITEM01', source: 'zotero', sourceLibraryId: 'users/0', sourceKey: 'ITEM01',
    metadata: { title: 'Documento Zotero', itemType: 'book', creators: [], year: 2020, isbn: [], issn: [], tags: [] },
    collectionIds: ['zotero:ROOT', history.id], attachments: [], extraction: { status: 'pending' },
  });
  assert.deepEqual(new Set(zotero.collectionIds), new Set(['zotero:ROOT', history.id]));

  assert.equal(operations.setItemsDeleted([first.id], true), 1);
  assert.equal(catalog.list().total, 2);
  assert.equal(catalog.list({ includeDeleted: true }).total, 3);
  assert.equal(operations.setItemsDeleted([first.id], false), 1);
  assert.equal(catalog.list().total, 3);

  // Removing a local subtree only removes its memberships unless explicitly asked to delete items.
  assert.equal(operations.deleteCollection(women.id, false), 2);
  assert.equal(catalog.list().total, 3);
  assert.equal(operations.listCollections().some((entry) => entry.id === women.id), false);
  assert.equal(store.scanMaterializedItems().records.find((item) => item.metadata.title === 'datos').collectionIds.length, 0);
  assert.ok(existsSync(secondOriginal), 'deleting the collection tree preserves the original attachment');
  assert.equal(store.readMaterializedItem(second.storageId).deletedAt, null, 'deleting a grouping never trashes its items');
  assert.equal(catalog.listCollections().find((entry) => entry.id === history.id).directItemCount, 2);
  catalog.close();
  console.log('Global library collection tree, local import, duplicate safety, memberships and trash tests passed!');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
