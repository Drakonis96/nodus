import { ipcRenderer } from 'electron';
import type { LibraryApi } from '@shared/api/library';

export const libraryApi: LibraryApi = {
  getGlobalLibraryStatus: () => ipcRenderer.invoke('library:status'),
  rebuildGlobalLibrary: () => ipcRenderer.invoke('library:rebuild'),
  listGlobalLibraryItems: (query) => ipcRenderer.invoke('library:list', query),
  onGlobalLibraryChanged: (cb) => {
    const listener = (_event: unknown, status: Parameters<typeof cb>[0]) => cb(status);
    ipcRenderer.on('library:changed', listener);
    return () => ipcRenderer.removeListener('library:changed', listener);
  },
};
