import type { IpcContext } from './context';
import { BrowserWindow, shell } from 'electron';
import { showImportOpenDialog } from '../privacy';
import {
  getGlobalLibraryStatus,
  listGlobalLibraryItems,
  migrateExistingVaultLibraries,
  previewLibraryMigration,
  startLibraryMigration,
  resumeLibraryMigration,
  cancelLibraryMigration,
  rollbackLibraryMigration,
  listLibraryMigrationSessions,
  rebuildGlobalLibrary,
  cancelZoteroLibraryImport,
  listZoteroImportLibraries,
  startZoteroLibraryImport,
  enqueueLibraryExtraction,
  listLibraryExtractionJobs,
  cancelLibraryExtraction,
  retryLibraryExtraction,
  listGlobalLibraryCollections,
  listGlobalLibrarySavedSearches,
  saveGlobalLibrarySavedSearch,
  deleteGlobalLibrarySavedSearch,
  getGlobalLibraryViewPreferences,
  setGlobalLibraryViewPreferences,
  getGlobalLibraryItem,
  createGlobalLibraryCollection,
  updateGlobalLibraryCollection,
  deleteGlobalLibraryCollection,
  patchGlobalLibraryItemCollections,
  setGlobalLibraryItemsDeleted,
  importGlobalLibraryFiles,
  importGlobalBibliographyFiles,
  updateGlobalLibraryItemMetadata,
  resolveGlobalLibraryMetadata,
  listGlobalLibraryDuplicates,
  mergeGlobalLibraryItems,
  createGlobalLibraryItem,
  duplicateGlobalLibraryItem,
  convertGlobalLibraryItemToNodus,
  addGlobalLibraryAttachments,
  updateGlobalLibraryAttachment,
  replaceGlobalLibraryAttachment,
  removeGlobalLibraryAttachment,
  globalLibraryAttachmentPath,
  upsertGlobalLibraryNote,
  deleteGlobalLibraryNote,
  setGlobalLibraryItemRelation,
  patchGlobalLibraryItemTags,
  listGlobalLibraryTags,
  setGlobalLibraryTagColor,
  listGlobalLibraryVaults,
  listGlobalLibraryVaultLinks,
  linkGlobalLibraryItemsToVault,
} from '../library/libraryService';

export function registerLibraryIpc({ h }: IpcContext): void {
  const existingItem = async (itemId: string) => {
    const item = await getGlobalLibraryItem(itemId);
    if (!item) throw new Error('El documento ya no existe.');
    return item;
  };
  h('library:status', async () => getGlobalLibraryStatus());
  h('library:rebuild', async () => rebuildGlobalLibrary());
  h('library:list', async (_event, query) => listGlobalLibraryItems(query));
  h('library:migrateVaults', async () => migrateExistingVaultLibraries());
  h('library:migrationPreview', async () => previewLibraryMigration());
  h('library:startMigration', async (_event, request) => startLibraryMigration(request));
  h('library:resumeMigration', async (_event, sessionId) => resumeLibraryMigration(sessionId));
  h('library:cancelMigration', async (_event, sessionId) => cancelLibraryMigration(sessionId));
  h('library:rollbackMigration', async (_event, sessionId) => rollbackLibraryMigration(sessionId));
  h('library:migrationSessions', async () => listLibraryMigrationSessions());
  h('library:zoteroLibraries', async () => listZoteroImportLibraries());
  h('library:importZotero', async (event, requestId, selection) => startZoteroLibraryImport(
    requestId, selection, (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send('library:zoteroImportProgress', progress);
    },
  ));
  h('library:cancelZoteroImport', async (_event, requestId) => cancelZoteroLibraryImport(requestId));
  h('library:enqueueExtraction', async (_event, itemIds, options, priority) => enqueueLibraryExtraction(itemIds, options, priority));
  h('library:extractionJobs', async () => listLibraryExtractionJobs());
  h('library:cancelExtraction', async (_event, jobId) => cancelLibraryExtraction(jobId));
  h('library:retryExtraction', async (_event, jobId) => retryLibraryExtraction(jobId));
  h('library:collections', async () => listGlobalLibraryCollections());
  h('library:savedSearches', async () => listGlobalLibrarySavedSearches());
  h('library:saveSavedSearch', async (_event, input) => saveGlobalLibrarySavedSearch(input));
  h('library:deleteSavedSearch', async (_event, id) => deleteGlobalLibrarySavedSearch(id));
  h('library:viewPreferences', async () => getGlobalLibraryViewPreferences());
  h('library:setViewPreferences', async (_event, preferences) => setGlobalLibraryViewPreferences(preferences));
  h('library:item', async (_event, itemId) => getGlobalLibraryItem(itemId));
  h('library:createCollection', async (_event, name, parentId) => createGlobalLibraryCollection(name, parentId));
  h('library:updateCollection', async (_event, id, patch) => updateGlobalLibraryCollection(id, patch));
  h('library:deleteCollection', async (_event, id, deleteItems) => deleteGlobalLibraryCollection(id, deleteItems));
  h('library:patchItemCollections', async (_event, itemIds, patch) => patchGlobalLibraryItemCollections(itemIds, patch));
  h('library:setItemsDeleted', async (_event, itemIds, deleted) => setGlobalLibraryItemsDeleted(itemIds, deleted));
  h('library:importFiles', async (event, collectionId) => {
    const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const options = {
      title: 'Importar documentos en la Biblioteca',
      properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
      filters: [{
        name: 'Documentos compatibles',
        extensions: ['pdf', 'epub', 'md', 'markdown', 'txt', 'html', 'htm', 'xml', 'jats', 'doc', 'docx', 'odt', 'rtf', 'ppt', 'pptx', 'odp', 'csv', 'tsv', 'xlsx', 'xls', 'ods', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'tif', 'tiff'],
      }],
    };
    const selected = owner ? await showImportOpenDialog(owner, options) : await showImportOpenDialog(options);
    return selected.canceled ? { created: 0, skipped: 0, itemIds: [], warnings: [] } : importGlobalLibraryFiles(selected.filePaths, collectionId);
  });
  h('library:importBibliography', async (event, collectionId) => {
    const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const options = {
      title: 'Importar referencias bibliográficas',
      properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
      filters: [{ name: 'RIS, BibTeX, CSL JSON o Mendeley', extensions: ['ris', 'bib', 'bibtex', 'json'] }],
    };
    const selected = owner ? await showImportOpenDialog(owner, options) : await showImportOpenDialog(options);
    return selected.canceled
      ? { created: 0, updated: 0, duplicates: 0, skipped: 0, itemIds: [], warnings: [] }
      : importGlobalBibliographyFiles(selected.filePaths, collectionId);
  });
  h('library:createItem', async (_event, metadata, collectionIds) => createGlobalLibraryItem(metadata, collectionIds));
  h('library:duplicateItem', async (_event, itemId) => duplicateGlobalLibraryItem(itemId));
  h('library:convertItemToNodus', async (_event, itemId) => convertGlobalLibraryItemToNodus(itemId));
  h('library:addAttachments', async (event, itemId) => {
    const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const options = {
      title: 'Añadir adjuntos a la referencia', properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
      filters: [{ name: 'Documentos, datos e imágenes', extensions: ['pdf', 'epub', 'md', 'markdown', 'txt', 'html', 'htm', 'xml', 'jats', 'doc', 'docx', 'odt', 'rtf', 'ppt', 'pptx', 'odp', 'csv', 'tsv', 'xlsx', 'xls', 'ods', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'tif', 'tiff'] }],
    };
    const selected = owner ? await showImportOpenDialog(owner, options) : await showImportOpenDialog(options);
    return selected.canceled ? existingItem(itemId) : addGlobalLibraryAttachments(itemId, selected.filePaths);
  });
  h('library:updateAttachment', async (_event, itemId, attachmentId, patch) => updateGlobalLibraryAttachment(itemId, attachmentId, patch));
  h('library:replaceAttachment', async (event, itemId, attachmentId) => {
    const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const options = { title: 'Sustituir adjunto', properties: ['openFile'] as Array<'openFile'> };
    const selected = owner ? await showImportOpenDialog(owner, options) : await showImportOpenDialog(options);
    return selected.canceled ? existingItem(itemId) : replaceGlobalLibraryAttachment(itemId, attachmentId, selected.filePaths[0]);
  });
  h('library:removeAttachment', async (_event, itemId, attachmentId) => removeGlobalLibraryAttachment(itemId, attachmentId));
  h('library:openAttachment', async (_event, itemId, attachmentId) => (await shell.openPath(globalLibraryAttachmentPath(itemId, attachmentId))) === '');
  h('library:revealAttachment', async (_event, itemId, attachmentId) => { shell.showItemInFolder(globalLibraryAttachmentPath(itemId, attachmentId)); return true; });
  h('library:upsertNote', async (_event, itemId, note) => upsertGlobalLibraryNote(itemId, note));
  h('library:deleteNote', async (_event, itemId, noteId) => deleteGlobalLibraryNote(itemId, noteId));
  h('library:setRelation', async (_event, itemId, targetItemId, relationType, enabled) => setGlobalLibraryItemRelation(itemId, targetItemId, relationType, enabled));
  h('library:patchTags', async (_event, itemIds, patch) => patchGlobalLibraryItemTags(itemIds, patch));
  h('library:tags', async () => listGlobalLibraryTags());
  h('library:setTagColor', async (_event, tag, color) => setGlobalLibraryTagColor(tag, color));
  h('library:updateMetadata', async (_event, itemId, patch) => updateGlobalLibraryItemMetadata(itemId, patch));
  h('library:resolveMetadata', async (_event, kind, value) => resolveGlobalLibraryMetadata(kind, value));
  h('library:duplicates', async () => listGlobalLibraryDuplicates());
  h('library:mergeItems', async (_event, canonicalId, duplicateIds) => mergeGlobalLibraryItems(canonicalId, duplicateIds));
  h('library:vaults', async () => listGlobalLibraryVaults());
  h('library:vaultLinks', async (_event, itemId) => listGlobalLibraryVaultLinks(itemId));
  h('library:linkToVault', async (_event, itemIds, vaultId) => linkGlobalLibraryItemsToVault(itemIds, vaultId));
}
