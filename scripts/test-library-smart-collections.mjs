import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-library-smart-collections-suite')) process.exit(0);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-library-smart-'));
installRuntimeHooks(path.join(scratch, 'profile'));
const require = createRequire(import.meta.url);

const condition = (id, field, operator, value) => ({ id, field, operator, value });
const group = (id, mode, rules) => ({ id, mode, rules });

try {
  const { LibraryDiskStore } = require(path.join(repoRoot, 'electron/library/libraryStorage.ts'));
  const { LibraryCatalog } = require(path.join(repoRoot, 'electron/library/libraryCatalog.ts'));
  const { LibraryOperations } = require(path.join(repoRoot, 'electron/library/libraryOperations.ts'));
  const root = path.join(scratch, 'backups', 'nodus-library');
  const store = new LibraryDiskStore(root, 'smart-collections-device');
  const catalog = new LibraryCatalog(path.join(scratch, 'profile', 'library', 'catalog.sqlite'));
  const operations = new LibraryOperations(store, catalog);

  const history = operations.createCollection('History', null);
  const archives = operations.createCollection('Archives', history.id);
  const reading = operations.createCollection('Reading', null);
  const later = operations.createCollection('Later', null);
  operations.updateCollection(later.id, { parentId: history.id, position: 0 });
  let collections = operations.listCollections();
  assert.deepEqual(collections.filter((entry) => entry.parentId === history.id).map((entry) => [entry.name, entry.position]), [['Later', 0], ['Archives', 1]]);
  assert.throws(() => operations.updateCollection(history.id, { parentId: archives.id }), /ciclo/);

  const zoteroCollection = store.upsertCollection({
    id: 'zotero:collection:LOCKED', name: 'Zotero mirror', parentId: null, position: 99,
    source: 'zotero', sourceLibraryId: 'users/1', sourceKey: 'LOCKED', deletedAt: null,
  });
  catalog.rebuild(store);
  assert.throws(() => operations.updateCollection(zoteroCollection.id, { name: 'Changed' }), /gestor/);

  const woman = operations.createItem({
    title: 'Women and reconstruction', abstract: 'Postwar labor and political change', itemType: 'journal-article',
    creators: [{ creatorType: 'author', firstName: 'María', lastName: 'Aliaga' }],
    date: '1947-05-01', year: 1947, isbn: [], issn: ['1234-5678'], tags: ['women', 'postwar'],
  }, [history.id]);
  const theory = operations.createItem({
    title: 'Desire and norms', abstract: 'Gender theory', itemType: 'book',
    creators: [{ creatorType: 'author', firstName: 'Elena', lastName: 'García' }],
    date: '2020', year: 2020, edition: '2', doi: '10.5555/desire', isbn: ['9780000000000'], issn: [], tags: ['gender', 'theory'],
  }, [reading.id]);
  const beforeOrganization = store.readMaterializedItem(woman.storageId).contentRevision;
  operations.patchItemCollections([woman.id], { add: [reading.id] });
  assert.deepEqual(store.readMaterializedItem(woman.storageId).collectionIds.sort(), [history.id, reading.id].sort(), 'copy keeps both memberships');
  operations.patchItemCollections([woman.id], { add: [archives.id], remove: [history.id] });
  assert.deepEqual(store.readMaterializedItem(woman.storageId).collectionIds.sort(), [archives.id, reading.id].sort(), 'move is one reversible membership edit');
  assert.deepEqual(store.readMaterializedItem(woman.storageId).contentRevision, beforeOrganization, 'organization never invalidates analysis');
  operations.patchItemCollections([woman.id], { add: [history.id], remove: [archives.id] });
  assert.throws(() => operations.patchItemCollections([woman.id], { add: [zoteroCollection.id] }), /solo lectura/);

  let currentTheory = store.readMaterializedItem(theory.storageId);
  currentTheory = store.upsertItem({
    ...currentTheory,
    contentRevision: {
      ...currentTheory.contentRevision,
      revision: currentTheory.contentRevision.revision + 1,
      components: { ...currentTheory.contentRevision.components, deep: { freshness: 'stale', fingerprint: 'old-deep' } },
    },
  }, currentTheory.clock.revision);
  operations.setItemsDeleted([theory.id], true);
  catalog.rebuild(store);
  catalog.upsertVaultLinks([{
    itemId: woman.id, vaultId: 'vault-academic', vaultName: 'Academic', vaultType: 'academic', workId: 'work-women',
    analysis: { lightStatus: 'done', deepStatus: 'done', summaryStatus: 'done', ideaCount: 0, passageCount: 0, evidenceCount: 0, gapCount: 0, hasSummary: true, hasNotes: false, archived: false },
  }]);

  const savedQuery = group('root', 'all', [
    condition('tag', 'tag', 'equals', 'women'),
    group('date-or-vault', 'any', [condition('before', 'year', 'before', 1950), condition('vault', 'vault', 'equals', 'vault-academic')]),
    group('not-failed', 'not', [condition('failed', 'extraction', 'equals', 'failed')]),
  ]);
  const saved = operations.saveSavedSearch({ name: 'Women before 1950', query: savedQuery });
  assert.equal(operations.listSavedSearches()[0].id, saved.id);
  assert.equal(catalog.list({ smartSearch: saved.query }).items[0].id, woman.id);
  assert.equal(catalog.list({ smartSearch: group('vault', 'all', [condition('v', 'vault', 'equals', 'vault-academic')]) }).total, 1);
  assert.equal(catalog.list({ smartSearch: group('not-trash', 'all', [condition('trash', 'trash', 'is-false')]) }).total, 1);
  assert.equal(catalog.list({ smartSearch: group('trash', 'all', [condition('trash', 'trash', 'is-true')]) }).items[0].id, theory.id);
  assert.equal(catalog.list({ includeDeleted: true, smartSearch: group('stale', 'all', [condition('deep', 'analysis', 'equals', 'deep:stale')]) }).items[0].id, theory.id);

  const sorted = catalog.list({ includeDeleted: true, sort: [{ field: 'year', direction: 'asc' }] });
  assert.deepEqual(sorted.items.map((item) => item.year), [1947, 2020]);
  assert.ok(sorted.facets.sources.some((facet) => facet.value === 'nodus' && facet.count === 2));
  assert.ok(sorted.facets.tags.some((facet) => facet.value === 'women'));
  assert.ok(sorted.facets.vaults.some((facet) => facet.value === 'vault-academic'));

  const preferences = operations.setViewPreferences({
    visibleColumns: ['doi', 'title', 'edition', 'creator', 'attachments'],
    columnWidths: { title: 320, doi: 180 },
    sort: [{ field: 'edition', direction: 'desc' }, { field: 'creator', direction: 'asc' }, { field: 'year', direction: 'desc' }],
  });
  assert.deepEqual(new LibraryOperations(store, catalog).getViewPreferences(), preferences, 'column and multi-sort preferences survive restart');
  assert.deepEqual(preferences.visibleColumns.slice(0, 3), ['doi', 'title', 'edition'], 'the user-defined column order is preserved');
  assert.deepEqual(preferences.columnWidths, { title: 320, doi: 180 }, 'column widths survive restart');
  const theoryCatalog = catalog.list({ includeDeleted: true, sort: [{ field: 'doi', direction: 'asc' }] }).items.find((entry) => entry.id === theory.id);
  assert.equal(theoryCatalog.metadata.edition, '2');
  assert.equal(theoryCatalog.createdAt, theory.createdAt);
  assert.equal(operations.deleteSavedSearch(saved.id), true);
  assert.equal(operations.listSavedSearches().length, 0);
  catalog.close();
  console.log('Editable collections, live smart searches, facets and table preference tests passed!');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
