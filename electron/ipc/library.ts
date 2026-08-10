import type { IpcContext } from './context';
import { BrowserWindow } from 'electron';
import { showImportOpenDialog } from '../privacy';
import {
  getGlobalLibraryStatus,
  listGlobalLibraryItems,
  migrateExistingVaultLibraries,
  rebuildGlobalLibrary,
  cancelZoteroLibraryImport,
  listZoteroImportLibraries,
  startZoteroLibraryImport,
  enqueueLibraryExtraction,
  listLibraryExtractionJobs,
  cancelLibraryExtraction,
  retryLibraryExtraction,
  listGlobalLibraryCollections,
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
  listGlobalLibraryVaults,
  listGlobalLibraryVaultLinks,
  linkGlobalLibraryItemsToVault,
} from '../library/libraryService';

export function registerLibraryIpc({ h }: IpcContext): void {
  h('library:status', async () => getGlobalLibraryStatus());
  h('library:rebuild', async () => rebuildGlobalLibrary());
  h('library:list', async (_event, query) => listGlobalLibraryItems(query));
  h('library:migrateVaults', async () => migrateExistingVaultLibraries());
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
        extensions: ['pdf', 'epub', 'md', 'markdown', 'txt', 'html', 'htm', 'xml', 'jats', 'docx', 'csv', 'tsv', 'xlsx', 'xls', 'ods'],
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
  h('library:updateMetadata', async (_event, itemId, patch) => updateGlobalLibraryItemMetadata(itemId, patch));
  h('library:resolveMetadata', async (_event, kind, value) => resolveGlobalLibraryMetadata(kind, value));
  h('library:duplicates', async () => listGlobalLibraryDuplicates());
  h('library:mergeItems', async (_event, canonicalId, duplicateIds) => mergeGlobalLibraryItems(canonicalId, duplicateIds));
  h('library:vaults', async () => listGlobalLibraryVaults());
  h('library:vaultLinks', async (_event, itemId) => listGlobalLibraryVaultLinks(itemId));
  h('library:linkToVault', async (_event, itemIds, vaultId) => linkGlobalLibraryItemsToVault(itemIds, vaultId));
}
