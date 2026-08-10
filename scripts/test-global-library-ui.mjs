import assert from 'node:assert/strict';
import test from 'node:test';
import { readSource, assertApiMethods, assertChannelsWired } from './ipc-channel-census.mjs';

test('the global Library is independent from the active vault and pinned in every sidebar', async () => {
  const [registry, app, vaultTypes] = await Promise.all([
    readSource('src/app/views/corpus.tsx'), readSource('@shell'), readSource('shared/vaultTypes.ts'),
  ]);
  assert.match(registry, /GlobalLibraryView[^>]*onOpenSettings/);
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
    'import-library-bibliography', 'open-library-duplicates', 'edit-library-metadata',
    'add-library-item-to-vault', 'global-library-vault-dialog',
    'global-library-integrity-warning',
  ]) assert.match(view, new RegExp(`data-testid=(?:"|\{\`)[^\n]*${marker}`));
  for (const method of [
    'getGlobalLibraryStatus', 'listGlobalLibraryItems', 'listGlobalLibraryCollections',
    'importGlobalLibraryFiles', 'listZoteroImportLibraries', 'importZoteroLibrary',
    'enqueueLibraryExtraction', 'patchGlobalLibraryItemCollections', 'setGlobalLibraryItemsDeleted',
    'importGlobalBibliographyFiles',
    'listGlobalLibraryVaultLinks', 'linkGlobalLibraryItemsToVault',
  ]) assert.match(view, new RegExp(String.raw`window\.nodus\.${method}\b`));
  assert.match(view, /CollectionBranch[\s\S]*<CollectionBranch/, 'collection rendering is recursively unbounded');
  assert.match(view, /La importación se canceló; el catálogo ya recuperado se conserva/);
  assert.match(view, /Copia de solo lectura: Nodus nunca modifica Zotero/);
  assert.match(view, /status\.conflicts > 0 \|\| status\.invalidRecords > 0/);
  assert.match(view, /LibraryDocumentReader/);
  assert.match(view, /onDoubleClick=\{\(\) => item\.readerAvailable/);
});

test('the global reader exposes annotations, metadata, chat and a temporary original-page viewer', async () => {
  const [reader, store, protocol, main, html] = await Promise.all([
    readSource('src/views/LibraryDocumentReader.tsx'), readSource('electron/libraryReader/libraryReaderStore.ts'),
    readSource('electron/libraryProtocol.ts'), readSource('electron/main.ts'), readSource('index.html'),
  ]);
  for (const marker of ['library-reader-document', 'library-reader-outline-toggle', 'library-reader-sidebar-toggle', 'library-reader-sidebar', 'library-reader-metadata', 'library-reader-chat', 'library-original-preview']) assert.match(reader, new RegExp(marker));
  assert.match(reader, /aria-expanded=\{outlineOpen\}/);
  assert.match(reader, /aria-expanded=\{notesOpen\}/);
  assert.match(reader, /OriginalPagePreview/);
  assert.match(reader, /ReaderSelectionActions/);
  assert.match(reader, /libraryReaderChatStream/);
  assert.match(reader, /library-reader-chat-input/);
  assert.match(store, /function globalDocument/);
  assert.match(store, /nodus-library:\/\/original/);
  assert.match(protocol, /Accept-Ranges/);
  assert.match(main, /registerLibrarySchemePrivileges/);
  assert.match(main, /registerLibraryProtocol/);
  assert.match(html, /connect-src[^\"]*nodus-library:/);
});

test('the typed bridge covers every global management operation', async () => {
  const methods = [
    'listGlobalLibraryCollections', 'getGlobalLibraryItem', 'createGlobalLibraryCollection',
    'updateGlobalLibraryCollection', 'deleteGlobalLibraryCollection', 'patchGlobalLibraryItemCollections',
    'setGlobalLibraryItemsDeleted', 'importGlobalLibraryFiles',
    'importGlobalBibliographyFiles', 'updateGlobalLibraryItemMetadata', 'resolveGlobalLibraryMetadata',
    'listGlobalLibraryDuplicates', 'mergeGlobalLibraryItems',
    'listGlobalLibraryVaults', 'listGlobalLibraryVaultLinks', 'linkGlobalLibraryItemsToVault',
  ];
  assertApiMethods(assert, methods);
  assertChannelsWired(assert, [
    'library:collections', 'library:item', 'library:createCollection', 'library:updateCollection',
    'library:deleteCollection', 'library:patchItemCollections', 'library:setItemsDeleted', 'library:importFiles',
    'library:importBibliography', 'library:updateMetadata', 'library:resolveMetadata', 'library:duplicates', 'library:mergeItems',
    'library:vaults', 'library:vaultLinks', 'library:linkToVault',
  ]);
});

test('reader chat uses the shared AI engine and persists beside the document', async () => {
  const [ai, ipc, preload, types, store] = await Promise.all([
    readSource('electron/ai/libraryReaderChat.ts'), readSource('electron/ipc/academic.ts'),
    readSource('electron/preload/academic.ts'), readSource('shared/api/academic.ts'),
    readSource('electron/libraryReader/libraryReaderStore.ts'),
  ]);
  assert.match(ai, /completeTextStream/);
  assert.match(ai, /settings\.chatModel \?\? settings\.nodiModel/);
  assert.match(ai, /listLibraryReaderAnnotations/);
  assert.match(ipc, /libraryReader:chat:stream/);
  assert.match(preload, /libraryReaderChatStream/);
  assert.match(types, /libraryReaderChatStream/);
  assert.match(store, /chat\.json/);
});

test('Zotero bridge exposes import, status and clean-reader navigation', async () => {
  const [server, sidebar] = await Promise.all([
    readSource('electron/zotero-plugin/server.ts'), readSource('zotero-plugin/content/sidebar.js'),
  ]);
  for (const route of ['/api/z/library/status', '/api/z/library/import', '/api/z/library/open']) assert.match(server, new RegExp(route));
  assert.match(server, /startZoteroLibraryImport/);
  assert.match(sidebar, /renderLibraryActions/);
  assert.match(sidebar, /library\.open/);
});

test('metadata management previews remote candidates and requires an explicit duplicate merge', async () => {
  const dialogs = await readSource('src/components/library/LibraryMetadataDialogs.tsx');
  for (const marker of ['library-metadata-editor', 'library-duplicates-dialog']) assert.match(dialogs, new RegExp(marker));
  assert.match(dialogs, /Vista previa de cambios/);
  assert.match(dialogs, /Nada se aplica sin tu revisión/);
  assert.match(dialogs, /updateGlobalLibraryItemMetadata/);
  assert.match(dialogs, /resolveGlobalLibraryMetadata/);
  assert.match(dialogs, /mergeGlobalLibraryItems/);
  assert.match(dialogs, /Los demás pasarán a la papelera/);
});
