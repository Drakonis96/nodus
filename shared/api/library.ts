import type {
  LibraryCatalogPage,
  LibraryCatalogQuery,
  LibraryRebuildResult,
  LibraryMigrationProgress,
  LibraryMigrationReport,
  LibraryStatus,
  ZoteroImportProgress,
  ZoteroImportReport,
  ZoteroImportSelection,
  ZoteroLibraryPreview,
} from '../libraryTypes';

/** Global bibliography. It deliberately has no vault id in any method. */
export interface LibraryApi {
  getGlobalLibraryStatus(): Promise<LibraryStatus>;
  rebuildGlobalLibrary(): Promise<LibraryRebuildResult>;
  listGlobalLibraryItems(query?: LibraryCatalogQuery): Promise<LibraryCatalogPage>;
  migrateExistingVaultLibraries(): Promise<LibraryMigrationReport>;
  listZoteroImportLibraries(): Promise<ZoteroLibraryPreview[]>;
  importZoteroLibrary(requestId: string, selection?: ZoteroImportSelection): Promise<ZoteroImportReport>;
  cancelZoteroLibraryImport(requestId: string): Promise<boolean>;
  onZoteroImportProgress(cb: (progress: ZoteroImportProgress) => void): () => void;
  onLibraryMigrationProgress(cb: (progress: LibraryMigrationProgress) => void): () => void;
  onGlobalLibraryChanged(cb: (status: LibraryStatus) => void): () => void;
}
