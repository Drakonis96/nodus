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
  LibraryExtractionEnqueueResult,
  LibraryExtractionJob,
  LibraryExtractionOptions,
  LibraryExtractionProgress,
  LibraryCollectionView,
  LibraryItemCollectionPatch,
  LibraryItemRecord,
  LibraryLocalImportReport,
  LibraryBibliographyImportReport,
  LibraryDuplicateGroup,
  LibraryItemMetadata,
  LibraryMetadataIdentifierKind,
  LibraryMetadataLookupResult,
  LibraryVaultLink,
  LibraryVaultLinkReport,
} from '../libraryTypes';
import type { VaultSummary } from '../types';

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
  enqueueLibraryExtraction(itemIds: string[], options?: Partial<LibraryExtractionOptions>, priority?: number): Promise<LibraryExtractionEnqueueResult>;
  listLibraryExtractionJobs(): Promise<LibraryExtractionJob[]>;
  cancelLibraryExtraction(jobId: string): Promise<boolean>;
  retryLibraryExtraction(jobId: string): Promise<boolean>;
  onLibraryExtractionProgress(cb: (progress: LibraryExtractionProgress) => void): () => void;
  listGlobalLibraryCollections(): Promise<LibraryCollectionView[]>;
  getGlobalLibraryItem(itemId: string): Promise<LibraryItemRecord | null>;
  createGlobalLibraryCollection(name: string, parentId: string | null): Promise<LibraryCollectionView>;
  updateGlobalLibraryCollection(id: string, patch: { name?: string; parentId?: string | null; position?: number }): Promise<LibraryCollectionView>;
  deleteGlobalLibraryCollection(id: string, deleteItems?: boolean): Promise<number>;
  patchGlobalLibraryItemCollections(itemIds: string[], patch: LibraryItemCollectionPatch): Promise<number>;
  setGlobalLibraryItemsDeleted(itemIds: string[], deleted: boolean): Promise<number>;
  importGlobalLibraryFiles(collectionId?: string | null): Promise<LibraryLocalImportReport>;
  importGlobalBibliographyFiles(collectionId?: string | null): Promise<LibraryBibliographyImportReport>;
  updateGlobalLibraryItemMetadata(itemId: string, patch: Partial<LibraryItemMetadata>): Promise<LibraryItemRecord>;
  resolveGlobalLibraryMetadata(kind: LibraryMetadataIdentifierKind, value: string): Promise<LibraryMetadataLookupResult>;
  listGlobalLibraryDuplicates(): Promise<LibraryDuplicateGroup[]>;
  mergeGlobalLibraryItems(canonicalId: string, duplicateIds: string[]): Promise<LibraryItemRecord>;
  listGlobalLibraryVaults(): Promise<VaultSummary[]>;
  listGlobalLibraryVaultLinks(itemId?: string): Promise<LibraryVaultLink[]>;
  linkGlobalLibraryItemsToVault(itemIds: string[], vaultId: string): Promise<LibraryVaultLinkReport>;
  onLibraryMigrationProgress(cb: (progress: LibraryMigrationProgress) => void): () => void;
  onGlobalLibraryChanged(cb: (status: LibraryStatus) => void): () => void;
}
