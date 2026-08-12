import type { IpcContext } from './context';
import { BrowserWindow, clipboard, dialog, shell } from 'electron';
import fs from 'node:fs';
import { showImportOpenDialog } from '../privacy';
import {
  getGlobalLibraryStatus,
  listGlobalLibraryItemsResponsive,
  migrateExistingVaultLibraries,
  previewLibraryMigration,
  startLibraryMigration,
  resumeLibraryMigration,
  cancelLibraryMigration,
  rollbackLibraryMigration,
  listLibraryMigrationSessions,
  rebuildGlobalLibraryInBackground,
  cancelZoteroLibraryImport,
  listZoteroImportLibraries,
  listZoteroSyncSessions,
  resumeZoteroLibraryImport,
  startZoteroLibraryImport,
  enqueueLibraryExtraction,
  listLibraryExtractionJobs,
  cancelLibraryExtraction,
  retryLibraryExtraction,
  prepareGlobalLibraryReading,
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
  previewGlobalLibraryTrash,
  purgeGlobalLibraryTrash,
  auditGlobalLibraryRecovery,
  importGlobalLibraryFiles,
  importGlobalBibliographyFiles,
  updateGlobalLibraryItemMetadata,
  resolveGlobalLibraryMetadata,
  listGlobalLibraryDuplicates,
  previewGlobalLibraryMerge,
  mergeGlobalLibraryItems,
  createGlobalLibraryItem,
  importGlobalLibraryIdentifier,
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
  startGlobalLibraryMetadataBatch,
  applyGlobalLibraryMetadataBatch,
  cancelGlobalLibraryMetadataBatch,
  updateGlobalLibraryCitationKey,
  formatGlobalLibraryCitation,
  listGlobalLibraryCitationStyles,
  importGlobalLibraryCitationStyleFiles,
  importGlobalLibraryZoteroCitationStyles,
  installGlobalLibraryRepositoryCitationStyle,
  removeGlobalLibraryCitationStyle,
  exportGlobalLibraryBibliography,
} from '../library/libraryService';

export function registerLibraryIpc({ h }: IpcContext): void {
  const existingItem = async (itemId: string) => {
    const item = await getGlobalLibraryItem(itemId);
    if (!item) throw new Error('El documento ya no existe.');
    return item;
  };
  h('library:status', async () => getGlobalLibraryStatus());
  h('library:rebuild', async () => rebuildGlobalLibraryInBackground());
  h('library:list', async (_event, query) => listGlobalLibraryItemsResponsive(query));
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
  h('library:zoteroSyncSessions', async () => listZoteroSyncSessions());
  h('library:resumeZoteroImport', async (event, requestId) => resumeZoteroLibraryImport(requestId, (progress) => {
    if (!event.sender.isDestroyed()) event.sender.send('library:zoteroImportProgress', progress);
  }));
  h('library:cancelZoteroImport', async (_event, requestId) => cancelZoteroLibraryImport(requestId));
  h('library:enqueueExtraction', async (_event, itemIds, options, priority) => enqueueLibraryExtraction(itemIds, options, priority));
  h('library:extractionJobs', async () => listLibraryExtractionJobs());
  h('library:cancelExtraction', async (_event, jobId) => cancelLibraryExtraction(jobId));
  h('library:retryExtraction', async (_event, jobId) => retryLibraryExtraction(jobId));
  h('library:prepareReading', async (_event, itemId) => prepareGlobalLibraryReading(itemId));
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
  h('library:trashImpact', async (_event, itemIds) => previewGlobalLibraryTrash(itemIds));
  h('library:purgeTrash', async (_event, itemIds) => purgeGlobalLibraryTrash(itemIds));
  h('library:auditRecovery', async () => auditGlobalLibraryRecovery());
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
  h('library:importDroppedFiles', async (_event, filePaths, collectionId) => {
    if (!Array.isArray(filePaths) || filePaths.length > 500 || filePaths.some((entry) => typeof entry !== 'string')) {
      throw new Error('La lista de archivos arrastrados no es válida.');
    }
    return importGlobalLibraryFiles(filePaths, collectionId);
  });
  h('library:importBibliography', async (event, collectionId) => {
    const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const options = {
      title: 'Importar referencias bibliográficas',
      properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
      filters: [{ name: 'RIS, BibTeX, BibLaTeX, CSL JSON, EndNote, Zotero RDF, CSV o Markdown', extensions: ['ris', 'bib', 'bibtex', 'biblatex', 'json', 'xml', 'rdf', 'csv', 'md', 'markdown'] }],
    };
    const selected = owner ? await showImportOpenDialog(owner, options) : await showImportOpenDialog(options);
    return selected.canceled
      ? { created: 0, updated: 0, duplicates: 0, skipped: 0, itemIds: [], warnings: [] }
      : importGlobalBibliographyFiles(selected.filePaths, collectionId);
  });
  h('library:createItem', async (_event, metadata, collectionIds) => createGlobalLibraryItem(metadata, collectionIds));
  h('library:importIdentifier', async (_event, kind, value, collectionIds) => importGlobalLibraryIdentifier(kind, value, collectionIds));
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
  h('library:startMetadataBatch', async (event, requestId, itemIds) => startGlobalLibraryMetadataBatch(requestId, itemIds, (progress) => {
    if (!event.sender.isDestroyed()) event.sender.send('library:metadataBatchProgress', progress);
  }));
  h('library:applyMetadataBatch', async (_event, requestId, itemIds) => applyGlobalLibraryMetadataBatch(requestId, itemIds));
  h('library:cancelMetadataBatch', async (_event, requestId) => cancelGlobalLibraryMetadataBatch(requestId));
  h('library:updateCitationKey', async (_event, itemId, citationKey) => updateGlobalLibraryCitationKey(itemId, citationKey));
  h('library:citationStyles', async () => listGlobalLibraryCitationStyles());
  h('library:importCitationStyles', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const options = { title: 'Importar estilos CSL', properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>, filters: [{ name: 'Citation Style Language', extensions: ['csl'] }] };
    const selected = owner ? await showImportOpenDialog(owner, options) : await showImportOpenDialog(options);
    return selected.canceled ? { imported: 0, updated: 0, skipped: 0, styles: listGlobalLibraryCitationStyles(), warnings: [] } : importGlobalLibraryCitationStyleFiles(selected.filePaths);
  });
  h('library:importZoteroCitationStyles', async (event) => {
    const automatic = importGlobalLibraryZoteroCitationStyles();
    if (automatic.imported || automatic.updated || !automatic.warnings.length) return automatic;
    const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const options = { title: 'Seleccionar la carpeta styles de Zotero', properties: ['openDirectory'] as Array<'openDirectory'> };
    const selected = owner ? await showImportOpenDialog(owner, options) : await showImportOpenDialog(options);
    return selected.canceled ? automatic : importGlobalLibraryZoteroCitationStyles(selected.filePaths);
  });
  h('library:installRepositoryCitationStyle', async (_event, styleId) => installGlobalLibraryRepositoryCitationStyle(styleId));
  h('library:removeCitationStyle', async (_event, styleId) => removeGlobalLibraryCitationStyle(styleId));
  h('library:formatCitation', async (_event, itemIds, style, kind, locale) => {
    const result = await formatGlobalLibraryCitation(itemIds, style, kind, locale); clipboard.writeText(result.text); return result;
  });
  h('library:exportBibliography', async (event, request) => {
    const extensions = { ris: 'ris', bibtex: 'bib', biblatex: 'biblatex', 'csl-json': 'json', 'endnote-xml': 'xml', 'zotero-rdf': 'rdf', csv: 'csv', markdown: 'md' } as const;
    const extension = extensions[request.format as keyof typeof extensions]; if (!extension) throw new Error('Formato de exportación no compatible.');
    const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const options = { title: 'Exportar referencias bibliográficas', defaultPath: `nodus-library.${extension}`, filters: [{ name: request.format, extensions: [extension] }] };
    const selected = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options);
    if (selected.canceled || !selected.filePath) return { format: request.format, exported: 0, filePath: null, canceled: true, warnings: [] };
    const report = await exportGlobalLibraryBibliography(request, selected.filePath);
    if (!fs.existsSync(selected.filePath)) throw new Error('No se pudo verificar el archivo exportado.');
    return report;
  });
  h('library:duplicates', async () => listGlobalLibraryDuplicates());
  h('library:mergeImpact', async (_event, canonicalId, duplicateIds) => previewGlobalLibraryMerge(canonicalId, duplicateIds));
  h('library:mergeItems', async (_event, canonicalId, duplicateIds) => mergeGlobalLibraryItems(canonicalId, duplicateIds));
  h('library:vaults', async () => listGlobalLibraryVaults());
  h('library:vaultLinks', async (_event, itemId) => listGlobalLibraryVaultLinks(itemId));
  h('library:linkToVault', async (_event, itemIds, vaultId) => linkGlobalLibraryItemsToVault(itemIds, vaultId));
}
