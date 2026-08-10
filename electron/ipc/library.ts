import type { IpcContext } from './context';
import {
  getGlobalLibraryStatus,
  listGlobalLibraryItems,
  migrateExistingVaultLibraries,
  rebuildGlobalLibrary,
  cancelZoteroLibraryImport,
  listZoteroImportLibraries,
  startZoteroLibraryImport,
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
}
