import type {
  LibraryCatalogPage,
  LibraryCatalogQuery,
  LibraryRebuildResult,
  LibraryStatus,
} from '../libraryTypes';

/** Global bibliography. It deliberately has no vault id in any method. */
export interface LibraryApi {
  getGlobalLibraryStatus(): Promise<LibraryStatus>;
  rebuildGlobalLibrary(): Promise<LibraryRebuildResult>;
  listGlobalLibraryItems(query?: LibraryCatalogQuery): Promise<LibraryCatalogPage>;
  onGlobalLibraryChanged(cb: (status: LibraryStatus) => void): () => void;
}
