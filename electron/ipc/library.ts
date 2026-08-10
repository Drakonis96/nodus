import type { IpcContext } from './context';
import {
  getGlobalLibraryStatus,
  listGlobalLibraryItems,
  migrateExistingVaultLibraries,
  rebuildGlobalLibrary,
} from '../library/libraryService';

export function registerLibraryIpc({ h }: IpcContext): void {
  h('library:status', async () => getGlobalLibraryStatus());
  h('library:rebuild', async () => rebuildGlobalLibrary());
  h('library:list', async (_event, query) => listGlobalLibraryItems(query));
  h('library:migrateVaults', async () => migrateExistingVaultLibraries());
}
