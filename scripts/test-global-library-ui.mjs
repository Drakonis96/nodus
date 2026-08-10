import assert from 'node:assert/strict';
import test from 'node:test';
import { readSource, assertApiMethods, assertChannelsWired } from './ipc-channel-census.mjs';

test('the global Library is independent from the active vault and pinned in every sidebar', async () => {
  const [registry, app, vaultTypes] = await Promise.all([
    readSource('src/app/views/corpus.tsx'), readSource('@shell'), readSource('shared/vaultTypes.ts'),
  ]);
  assert.match(registry, /GlobalLibraryView onOpenSettings/);
  assert.doesNotMatch(registry, /library:[\s\S]{0,250}vaultId=/, 'the global Library receives no vault id');
  assert.match(app, /const libraryItem = NAV_ITEMS\.find/);
  assert.ok((app.match(/navButton\(libraryItem\)/g) ?? []).length >= 8, 'every dedicated and standard sidebar pins the Library');
  assert.match(vaultTypes, /'prosopSources', 'prosopAnalysis', 'prosopNetworks', 'library'/, 'prosopography allows the global Library route');
});

test('the Library UI exposes hierarchy, search, bulk operations, imports and background state', async () => {
  const view = await readSource('src/views/GlobalLibraryView.tsx');
  for (const marker of [
    'global-library-view', 'global-library-search', 'global-library-bulk-actions',
    'global-library-detail', 'zotero-global-import-dialog', 'open-zotero-global-import',
  ]) assert.match(view, new RegExp(`data-testid=(?:"|\{\`)[^\n]*${marker}`));
  for (const method of [
    'getGlobalLibraryStatus', 'listGlobalLibraryItems', 'listGlobalLibraryCollections',
    'importGlobalLibraryFiles', 'listZoteroImportLibraries', 'importZoteroLibrary',
    'enqueueLibraryExtraction', 'patchGlobalLibraryItemCollections', 'setGlobalLibraryItemsDeleted',
  ]) assert.match(view, new RegExp(String.raw`window\.nodus\.${method}\b`));
  assert.match(view, /CollectionBranch[\s\S]*<CollectionBranch/, 'collection rendering is recursively unbounded');
  assert.match(view, /La importación se canceló; el catálogo ya recuperado se conserva/);
  assert.match(view, /Copia de solo lectura: Nodus nunca modifica Zotero/);
});

test('the typed bridge covers every global management operation', async () => {
  const methods = [
    'listGlobalLibraryCollections', 'getGlobalLibraryItem', 'createGlobalLibraryCollection',
    'updateGlobalLibraryCollection', 'deleteGlobalLibraryCollection', 'patchGlobalLibraryItemCollections',
    'setGlobalLibraryItemsDeleted', 'importGlobalLibraryFiles',
  ];
  assertApiMethods(assert, methods);
  assertChannelsWired(assert, [
    'library:collections', 'library:item', 'library:createCollection', 'library:updateCollection',
    'library:deleteCollection', 'library:patchItemCollections', 'library:setItemsDeleted', 'library:importFiles',
  ]);
});
