import type {
  LibraryCatalogPage,
  LibraryCatalogQuery,
  LibraryRebuildResult,
  LibraryMigrationProgress,
  LibraryMigrationReport,
  LibraryStatus,
} from '../libraryTypes';

/** Global bibliography. It deliberately has no vault id in any method. */
export interface LibraryApi {
  getGlobalLibraryStatus(): Promise<LibraryStatus>;
  rebuildGlobalLibrary(): Promise<LibraryRebuildResult>;
  listGlobalLibraryItems(query?: LibraryCatalogQuery): Promise<LibraryCatalogPage>;
  migrateExistingVaultLibraries(): Promise<LibraryMigrationReport>;
  onLibraryMigrationProgress(cb: (progress: LibraryMigrationProgress) => void): () => void;
  onGlobalLibraryChanged(cb: (status: LibraryStatus) => void): () => void;
}
