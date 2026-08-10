import type { IpcContext } from './context';
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
}
