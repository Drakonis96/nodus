import { ipcRenderer } from 'electron';
import type { LibraryApi } from '@shared/api/library';

export const libraryApi: LibraryApi = {
  getGlobalLibraryStatus: () => ipcRenderer.invoke('library:status'),
  rebuildGlobalLibrary: () => ipcRenderer.invoke('library:rebuild'),
  listGlobalLibraryItems: (query) => ipcRenderer.invoke('library:list', query),
  migrateExistingVaultLibraries: () => ipcRenderer.invoke('library:migrateVaults'),
  listZoteroImportLibraries: () => ipcRenderer.invoke('library:zoteroLibraries'),
  importZoteroLibrary: (requestId, selection) => ipcRenderer.invoke('library:importZotero', requestId, selection),
  cancelZoteroLibraryImport: (requestId) => ipcRenderer.invoke('library:cancelZoteroImport', requestId),
  onZoteroImportProgress: (cb) => {
    const listener = (_event: unknown, progress: Parameters<typeof cb>[0]) => cb(progress);
    ipcRenderer.on('library:zoteroImportProgress', listener);
    return () => ipcRenderer.removeListener('library:zoteroImportProgress', listener);
  },
  enqueueLibraryExtraction: (itemIds, options, priority) => ipcRenderer.invoke('library:enqueueExtraction', itemIds, options, priority),
  listLibraryExtractionJobs: () => ipcRenderer.invoke('library:extractionJobs'),
  cancelLibraryExtraction: (jobId) => ipcRenderer.invoke('library:cancelExtraction', jobId),
  retryLibraryExtraction: (jobId) => ipcRenderer.invoke('library:retryExtraction', jobId),
  onLibraryExtractionProgress: (cb) => {
    const listener = (_event: unknown, progress: Parameters<typeof cb>[0]) => cb(progress);
    ipcRenderer.on('library:extractionProgress', listener);
    return () => ipcRenderer.removeListener('library:extractionProgress', listener);
  },
  onLibraryMigrationProgress: (cb) => {
    const listener = (_event: unknown, progress: Parameters<typeof cb>[0]) => cb(progress);
    ipcRenderer.on('library:migrationProgress', listener);
    return () => ipcRenderer.removeListener('library:migrationProgress', listener);
  },
  onGlobalLibraryChanged: (cb) => {
    const listener = (_event: unknown, status: Parameters<typeof cb>[0]) => cb(status);
    ipcRenderer.on('library:changed', listener);
    return () => ipcRenderer.removeListener('library:changed', listener);
  },
};
