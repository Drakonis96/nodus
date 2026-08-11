import assert from 'node:assert/strict';
import test from 'node:test';
import { readSource, assertApiMethods, assertChannelsWired } from './ipc-channel-census.mjs';

test('the unified Library keeps the global catalogue independent and the vault corpus available', async () => {
  const [registry, app, vaultTypes] = await Promise.all([
    readSource('src/app/views/corpus.tsx'), readSource('@shell'), readSource('shared/vaultTypes.ts'),
  ]);
  assert.match(registry, /GlobalLibraryView[\s\S]*onOpenSettings/);
  assert.match(registry, /vaultId=\{activeVault\?\.id \?\? null\}/, 'the same screen receives the active vault for its compatibility scope');
  assert.match(app, /const libraryItem = NAV_ITEMS\.find/);
  assert.ok((app.match(/navButton\(libraryItem\)/g) ?? []).length >= 8, 'every dedicated and standard sidebar pins the Library');
  assert.match(vaultTypes, /'prosopSources', 'prosopAnalysis', 'prosopNetworks', 'library'/, 'prosopography allows the global Library route');
});

test('the Library UI exposes hierarchy, search, bulk operations, imports and background state', async () => {
  const view = `${await readSource('src/views/GlobalLibraryView.tsx')}\n${await readSource('src/components/library/LibraryItemManager.tsx')}\n${await readSource('src/components/library/LibrarySmartSearchDialog.tsx')}\n${await readSource('src/components/library/LibraryMetadataDialogs.tsx')}\n${await readSource('src/components/library/LibraryRecoveryDialogs.tsx')}`;
  for (const marker of [
    'global-library-view', 'global-library-search', 'global-library-bulk-actions',
    'global-library-detail', 'zotero-global-import-dialog', 'open-zotero-global-import',
    'import-library-bibliography', 'open-library-duplicates', 'edit-library-metadata',
    'add-library-item-to-vault', 'global-library-vault-dialog',
    'global-library-integrity-warning',
    'create-library-reference', 'library-item-manager', 'library-attachments',
    'library-notes', 'library-relations', 'library-tag-manager',
    'open-library-migration', 'library-migration-dialog', 'start-library-migration',
    'library-smart-search-dialog', 'smart-search-preview', 'library-table-settings', 'library-table-preferences',
    'zotero-sync-resume', 'resume-zotero-sync',
    'library-source-missing',
    'library-metadata-batch-dialog', 'start-library-metadata-batch', 'apply-library-metadata-batch',
    'library-citation-export-dialog', 'copy-library-citation', 'export-library-bibliography',
    'open-library-trash', 'empty-library-trash', 'library-trash-impact-dialog', 'restore-library-trash', 'purge-library-trash',
    'open-library-recovery', 'library-recovery-dialog', 'rebuild-library-recovery', 'library-merge-impact',
  ]) assert.match(view, new RegExp(`data-testid=(?:"|\{\`)[^\n]*${marker}`));
  for (const method of [
    'getGlobalLibraryStatus', 'listGlobalLibraryItems', 'listGlobalLibraryCollections',
    'importGlobalLibraryFiles', 'listZoteroImportLibraries', 'importZoteroLibrary',
    'listZoteroSyncSessions', 'resumeZoteroLibraryImport',
    'enqueueLibraryExtraction', 'patchGlobalLibraryItemCollections', 'setGlobalLibraryItemsDeleted',
    'importGlobalBibliographyFiles',
    'createGlobalLibraryItem', 'duplicateGlobalLibraryItem', 'convertGlobalLibraryItemToNodus',
    'addGlobalLibraryAttachments', 'updateGlobalLibraryAttachment', 'replaceGlobalLibraryAttachment',
    'removeGlobalLibraryAttachment', 'openGlobalLibraryAttachment', 'revealGlobalLibraryAttachment',
    'upsertGlobalLibraryNote', 'deleteGlobalLibraryNote', 'setGlobalLibraryItemRelation',
    'patchGlobalLibraryItemTags', 'listGlobalLibraryTags', 'setGlobalLibraryTagColor',
    'listGlobalLibraryVaultLinks', 'linkGlobalLibraryItemsToVault',
    'previewLibraryMigration', 'startLibraryMigration', 'resumeLibraryMigration',
    'cancelLibraryMigration', 'rollbackLibraryMigration', 'listLibraryMigrationSessions',
    'listGlobalLibrarySavedSearches', 'saveGlobalLibrarySavedSearch', 'deleteGlobalLibrarySavedSearch',
    'getGlobalLibraryViewPreferences', 'setGlobalLibraryViewPreferences',
    'startGlobalLibraryMetadataBatch', 'applyGlobalLibraryMetadataBatch', 'cancelGlobalLibraryMetadataBatch',
    'updateGlobalLibraryCitationKey', 'formatGlobalLibraryCitation', 'exportGlobalLibraryBibliography',
    'listGlobalLibraryCitationStyles', 'importGlobalLibraryCitationStyles', 'importZoteroCitationStyles',
    'installGlobalLibraryRepositoryCitationStyle', 'removeGlobalLibraryCitationStyle',
    'previewGlobalLibraryTrash', 'purgeGlobalLibraryTrash', 'auditGlobalLibraryRecovery', 'rebuildGlobalLibrary',
    'previewGlobalLibraryMerge',
  ]) assert.match(view, new RegExp(String.raw`window\.nodus\.${method}\b`));
  assert.match(view, /CollectionBranch[\s\S]*<CollectionBranch/, 'collection rendering is recursively unbounded');
  assert.match(view, /La importación se canceló; el catálogo ya recuperado se conserva/);
  assert.match(view, /Copia de solo lectura: Nodus nunca modifica Zotero/);
  assert.match(view, /status\.conflicts > 0 \|\| status\.invalidRecords > 0/);
  assert.match(view, /LibraryDocumentReader/);
  assert.match(view, /onDoubleClick=\{\(\) => item\.readerAvailable/);
});

test('the global reader exposes annotations, metadata, chat and native attachment viewers', async () => {
  const [readerSource, attachmentViewer, store, protocol, main, html] = await Promise.all([
    readSource('src/views/LibraryDocumentReader.tsx'), readSource('src/components/library/LibraryAttachmentViewer.tsx'),
    readSource('electron/libraryReader/libraryReaderStore.ts'), readSource('electron/libraryProtocol.ts'), readSource('electron/main.ts'), readSource('index.html'),
  ]);
  const reader = `${readerSource}\n${attachmentViewer}`;
  for (const marker of [
    'library-reader-document', 'library-reader-outline-toggle', 'library-reader-sidebar-toggle',
    'library-reader-sidebar', 'library-reader-metadata', 'library-reader-chat', 'library-original-preview',
    'library-reader-source-picker', 'library-reader-pdf-viewer', 'library-reader-epub-viewer',
    'library-reader-image-viewer', 'library-reader-text-viewer', 'library-reader-open-external',
  ]) assert.match(reader, new RegExp(marker));
  assert.match(reader, /aria-expanded=\{outlineOpen\}/);
  assert.match(reader, /aria-expanded=\{notesOpen\}/);
  assert.match(reader, /data-testid="library-reader-bookmark-menu"/);
  assert.match(reader, /data-testid="library-reader-open-chat"/);
  assert.match(reader, /aria-haspopup="menu"/);
  assert.match(reader, /role="menuitem"/);
  assert.match(reader, /library-reader-sidebar-tab-/);
  assert.match(reader, /selected && <span/);
  assert.match(reader, /t\('Info'\)/);
  assert.match(reader, /OriginalPagePreview/);
  assert.match(reader, /TextLayer/);
  assert.match(reader, /attachment:/);
  assert.match(reader, /target:\s*\{\s*type:\s*'region'/);
  assert.match(reader, /ReaderSelectionActions/);
  assert.match(reader, /libraryReaderChatStream/);
  assert.match(reader, /sourceId: selectedSource/);
  assert.match(reader, /library-reader-chat-input/);
  assert.match(store, /function globalDocument/);
  assert.match(store, /nodus-library:\/\/original/);
  assert.match(store, /nodus-library:\/\/attachment/);
  assert.match(store, /application\/epub\+zip/);
  assert.match(store, /getLibraryReaderAttachmentContent/);
  const chat = await readSource('electron/ai/libraryReaderChat.ts');
  assert.match(chat, /getLibraryReaderAttachmentContent/);
  assert.match(chat, /extractFromPath/);
  assert.match(chat, /contextSourceId/);
  assert.match(protocol, /Accept-Ranges/);
  assert.match(main, /registerLibrarySchemePrivileges/);
  assert.match(main, /registerLibraryProtocol/);
  assert.match(html, /connect-src[^\"]*nodus-library:/);
});

test('citation UI loads, imports and removes real CSL styles including Zotero styles', async () => {
  const [dialogs, manager, api] = await Promise.all([
    readSource('src/components/library/LibraryMetadataDialogs.tsx'),
    readSource('electron/library/libraryCslStyles.ts'),
    readSource('shared/api/library.ts'),
  ]);
  for (const marker of [
    'library-citation-style-manager', 'library-citation-style-search',
    'import-library-csl', 'import-zotero-csl', 'install-repository-csl',
  ]) assert.match(dialogs, new RegExp(marker));
  assert.match(dialogs, /listGlobalLibraryCitationStyles/);
  assert.match(manager, /citationstyles\.org/);
  assert.match(manager, /CC BY-SA 3\.0/);
  assert.match(manager, /@citation-js\/plugin-csl/);
  assert.match(api, /importGlobalLibraryCitationStyles/);
  assert.match(api, /importZoteroCitationStyles/);
});

test('the typed bridge covers every global management operation', async () => {
  const methods = [
    'listGlobalLibraryCollections', 'getGlobalLibraryItem', 'createGlobalLibraryCollection',
    'updateGlobalLibraryCollection', 'deleteGlobalLibraryCollection', 'patchGlobalLibraryItemCollections',
    'setGlobalLibraryItemsDeleted', 'importGlobalLibraryFiles',
    'importGlobalBibliographyFiles', 'updateGlobalLibraryItemMetadata', 'resolveGlobalLibraryMetadata',
    'createGlobalLibraryItem', 'duplicateGlobalLibraryItem', 'convertGlobalLibraryItemToNodus',
    'addGlobalLibraryAttachments', 'updateGlobalLibraryAttachment', 'replaceGlobalLibraryAttachment',
    'removeGlobalLibraryAttachment', 'openGlobalLibraryAttachment', 'revealGlobalLibraryAttachment',
    'upsertGlobalLibraryNote', 'deleteGlobalLibraryNote', 'setGlobalLibraryItemRelation',
    'patchGlobalLibraryItemTags', 'listGlobalLibraryTags', 'setGlobalLibraryTagColor',
    'listGlobalLibraryDuplicates', 'mergeGlobalLibraryItems',
    'listGlobalLibraryVaults', 'listGlobalLibraryVaultLinks', 'linkGlobalLibraryItemsToVault',
    'previewLibraryMigration', 'startLibraryMigration', 'resumeLibraryMigration',
    'cancelLibraryMigration', 'rollbackLibraryMigration', 'listLibraryMigrationSessions',
    'listGlobalLibrarySavedSearches', 'saveGlobalLibrarySavedSearch', 'deleteGlobalLibrarySavedSearch',
    'getGlobalLibraryViewPreferences', 'setGlobalLibraryViewPreferences',
    'listZoteroSyncSessions', 'resumeZoteroLibraryImport',
    'startGlobalLibraryMetadataBatch', 'applyGlobalLibraryMetadataBatch', 'cancelGlobalLibraryMetadataBatch',
    'updateGlobalLibraryCitationKey', 'formatGlobalLibraryCitation', 'exportGlobalLibraryBibliography',
    'previewGlobalLibraryTrash', 'purgeGlobalLibraryTrash', 'auditGlobalLibraryRecovery',
    'previewGlobalLibraryMerge',
  ];
  assertApiMethods(assert, methods);
  assertChannelsWired(assert, [
    'library:collections', 'library:item', 'library:createCollection', 'library:updateCollection',
    'library:deleteCollection', 'library:patchItemCollections', 'library:setItemsDeleted', 'library:importFiles',
    'library:createItem', 'library:duplicateItem', 'library:convertItemToNodus',
    'library:addAttachments', 'library:updateAttachment', 'library:replaceAttachment', 'library:removeAttachment',
    'library:openAttachment', 'library:revealAttachment', 'library:upsertNote', 'library:deleteNote',
    'library:setRelation', 'library:patchTags', 'library:tags', 'library:setTagColor',
    'library:importBibliography', 'library:updateMetadata', 'library:resolveMetadata', 'library:duplicates', 'library:mergeItems',
    'library:vaults', 'library:vaultLinks', 'library:linkToVault',
    'library:migrationPreview', 'library:startMigration', 'library:resumeMigration',
    'library:cancelMigration', 'library:rollbackMigration', 'library:migrationSessions',
    'library:savedSearches', 'library:saveSavedSearch', 'library:deleteSavedSearch',
    'library:viewPreferences', 'library:setViewPreferences',
    'library:zoteroSyncSessions', 'library:resumeZoteroImport',
    'library:startMetadataBatch', 'library:applyMetadataBatch', 'library:cancelMetadataBatch',
    'library:updateCitationKey', 'library:formatCitation', 'library:exportBibliography',
    'library:citationStyles', 'library:importCitationStyles', 'library:importZoteroCitationStyles',
    'library:installRepositoryCitationStyle', 'library:removeCitationStyle',
    'library:trashImpact', 'library:purgeTrash', 'library:auditRecovery', 'library:mergeImpact',
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
  assert.match(server, /ZOTERO_PLUGIN_PROTOCOL_VERSION = 4/);
  assert.match(server, /minimumPluginProtocol/);
  assert.match(server, /librarySyncV2: true/);
  assert.match(server, /lastClientProtocol < ZOTERO_PLUGIN_PROTOCOL_VERSION/);
  assert.match(sidebar, /X-Nodus-Zotero-Protocol": "4"/);
  assert.match(sidebar, /serverInfo\.capabilities\.globalLibrary/,
    'plugin v4 hides global-Library actions when a v3 desktop does not advertise them');
});

test('metadata management previews candidates, supports bulk confirmation and requires an explicit duplicate merge', async () => {
  const dialogs = await readSource('src/components/library/LibraryMetadataDialogs.tsx');
  for (const marker of ['library-metadata-editor', 'library-metadata-batch-dialog', 'library-citation-export-dialog', 'library-duplicates-dialog']) assert.match(dialogs, new RegExp(marker));
  assert.match(dialogs, /Vista previa de cambios/);
  assert.match(dialogs, /Nada se aplica sin tu revisión/);
  assert.match(dialogs, /updateGlobalLibraryItemMetadata/);
  assert.match(dialogs, /resolveGlobalLibraryMetadata/);
  assert.match(dialogs, /onGlobalLibraryMetadataBatchProgress/);
  assert.match(dialogs, /formatGlobalLibraryCitation/);
  assert.match(dialogs, /styles\.map\(\(entry\)/, 'the citation chooser is populated by the installed CSL catalogue');
  assert.match(dialogs, /'endnote-xml'[^\n]*'zotero-rdf'[^\n]*'csv'[^\n]*'markdown'/);
  assert.match(dialogs, /mergeGlobalLibraryItems/);
  assert.match(dialogs, /Las obras de vault permanecen separadas/);
  assert.match(dialogs, /previewGlobalLibraryMerge/);
});
