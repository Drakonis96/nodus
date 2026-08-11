import type {
  LibraryCatalogPage,
  LibraryCatalogQuery,
  LibraryRebuildResult,
  LibraryMigrationProgress,
  LibraryMigrationReport,
  LibraryMigrationPreview,
  LibraryMigrationSession,
  LibraryMigrationStartRequest,
  LibraryStatus,
  ZoteroImportProgress,
  ZoteroImportReport,
  ZoteroImportSelection,
  ZoteroLibraryPreview,
  ZoteroSyncSession,
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
  LibraryAttachmentPatch,
  LibraryNoteRecord,
  LibraryItemRelationType,
  LibraryTagPatch,
  LibraryTagRecord,
  LibrarySavedSearchRecord,
  LibrarySmartSearchGroup,
  LibraryViewPreferences,
  LibraryBibliographyExportRequest,
  LibraryBibliographyExportReport,
  LibraryCitationResult,
  LibraryCitationStyle,
  LibraryMetadataBatchProgress,
  LibraryMetadataBatchResult,
  LibraryTrashImpact,
  LibraryPurgeReport,
  LibraryMergeImpact,
  LibraryRecoveryReport,
} from '../libraryTypes';
import type { VaultSummary } from '../types';

/** Global bibliography. It deliberately has no vault id in any method. */
export interface LibraryApi {
  getGlobalLibraryStatus(): Promise<LibraryStatus>;
  rebuildGlobalLibrary(): Promise<LibraryRebuildResult>;
  listGlobalLibraryItems(query?: LibraryCatalogQuery): Promise<LibraryCatalogPage>;
  migrateExistingVaultLibraries(): Promise<LibraryMigrationReport>;
  previewLibraryMigration(): Promise<LibraryMigrationPreview>;
  startLibraryMigration(request: LibraryMigrationStartRequest): Promise<LibraryMigrationSession>;
  resumeLibraryMigration(sessionId: string): Promise<LibraryMigrationSession>;
  cancelLibraryMigration(sessionId: string): Promise<boolean>;
  rollbackLibraryMigration(sessionId: string): Promise<LibraryMigrationSession>;
  listLibraryMigrationSessions(): Promise<LibraryMigrationSession[]>;
  listZoteroImportLibraries(): Promise<ZoteroLibraryPreview[]>;
  importZoteroLibrary(requestId: string, selection?: ZoteroImportSelection): Promise<ZoteroImportReport>;
  listZoteroSyncSessions(): Promise<ZoteroSyncSession[]>;
  resumeZoteroLibraryImport(requestId: string): Promise<ZoteroImportReport>;
  cancelZoteroLibraryImport(requestId: string): Promise<boolean>;
  onZoteroImportProgress(cb: (progress: ZoteroImportProgress) => void): () => void;
  enqueueLibraryExtraction(itemIds: string[], options?: Partial<LibraryExtractionOptions>, priority?: number): Promise<LibraryExtractionEnqueueResult>;
  listLibraryExtractionJobs(): Promise<LibraryExtractionJob[]>;
  cancelLibraryExtraction(jobId: string): Promise<boolean>;
  retryLibraryExtraction(jobId: string): Promise<boolean>;
  onLibraryExtractionProgress(cb: (progress: LibraryExtractionProgress) => void): () => void;
  listGlobalLibraryCollections(): Promise<LibraryCollectionView[]>;
  listGlobalLibrarySavedSearches(): Promise<LibrarySavedSearchRecord[]>;
  saveGlobalLibrarySavedSearch(input: { id?: string; name: string; query: LibrarySmartSearchGroup }): Promise<LibrarySavedSearchRecord>;
  deleteGlobalLibrarySavedSearch(id: string): Promise<boolean>;
  getGlobalLibraryViewPreferences(): Promise<LibraryViewPreferences>;
  setGlobalLibraryViewPreferences(preferences: LibraryViewPreferences): Promise<LibraryViewPreferences>;
  getGlobalLibraryItem(itemId: string): Promise<LibraryItemRecord | null>;
  createGlobalLibraryCollection(name: string, parentId: string | null): Promise<LibraryCollectionView>;
  updateGlobalLibraryCollection(id: string, patch: { name?: string; parentId?: string | null; position?: number }): Promise<LibraryCollectionView>;
  deleteGlobalLibraryCollection(id: string, deleteItems?: boolean): Promise<number>;
  patchGlobalLibraryItemCollections(itemIds: string[], patch: LibraryItemCollectionPatch): Promise<number>;
  setGlobalLibraryItemsDeleted(itemIds: string[], deleted: boolean): Promise<number>;
  previewGlobalLibraryTrash(itemIds: string[]): Promise<LibraryTrashImpact>;
  purgeGlobalLibraryTrash(itemIds: string[]): Promise<LibraryPurgeReport>;
  auditGlobalLibraryRecovery(): Promise<LibraryRecoveryReport>;
  importGlobalLibraryFiles(collectionId?: string | null): Promise<LibraryLocalImportReport>;
  importGlobalBibliographyFiles(collectionId?: string | null): Promise<LibraryBibliographyImportReport>;
  createGlobalLibraryItem(metadata: LibraryItemMetadata, collectionIds?: string[]): Promise<LibraryItemRecord>;
  duplicateGlobalLibraryItem(itemId: string): Promise<LibraryItemRecord>;
  convertGlobalLibraryItemToNodus(itemId: string): Promise<LibraryItemRecord>;
  updateGlobalLibraryItemMetadata(itemId: string, patch: Partial<LibraryItemMetadata>): Promise<LibraryItemRecord>;
  addGlobalLibraryAttachments(itemId: string): Promise<LibraryItemRecord>;
  updateGlobalLibraryAttachment(itemId: string, attachmentId: string, patch: LibraryAttachmentPatch): Promise<LibraryItemRecord>;
  replaceGlobalLibraryAttachment(itemId: string, attachmentId: string): Promise<LibraryItemRecord>;
  removeGlobalLibraryAttachment(itemId: string, attachmentId: string): Promise<LibraryItemRecord>;
  openGlobalLibraryAttachment(itemId: string, attachmentId: string): Promise<boolean>;
  revealGlobalLibraryAttachment(itemId: string, attachmentId: string): Promise<boolean>;
  upsertGlobalLibraryNote(itemId: string, note: Partial<LibraryNoteRecord> & Pick<LibraryNoteRecord, 'title' | 'markdown'>): Promise<LibraryItemRecord>;
  deleteGlobalLibraryNote(itemId: string, noteId: string): Promise<LibraryItemRecord>;
  setGlobalLibraryItemRelation(itemId: string, targetItemId: string, relationType: LibraryItemRelationType, enabled: boolean): Promise<LibraryItemRecord>;
  patchGlobalLibraryItemTags(itemIds: string[], patch: LibraryTagPatch): Promise<number>;
  listGlobalLibraryTags(): Promise<LibraryTagRecord[]>;
  setGlobalLibraryTagColor(tag: string, color: string | null): Promise<LibraryTagRecord[]>;
  resolveGlobalLibraryMetadata(kind: LibraryMetadataIdentifierKind, value: string): Promise<LibraryMetadataLookupResult>;
  startGlobalLibraryMetadataBatch(requestId: string, itemIds: string[]): Promise<LibraryMetadataBatchResult>;
  applyGlobalLibraryMetadataBatch(requestId: string, itemIds: string[]): Promise<LibraryMetadataBatchResult>;
  cancelGlobalLibraryMetadataBatch(requestId: string): Promise<boolean>;
  onGlobalLibraryMetadataBatchProgress(cb: (progress: LibraryMetadataBatchProgress) => void): () => void;
  updateGlobalLibraryCitationKey(itemId: string, citationKey: string): Promise<LibraryItemRecord>;
  formatGlobalLibraryCitation(itemIds: string[], style: LibraryCitationStyle, kind: 'citation' | 'bibliography'): Promise<LibraryCitationResult>;
  exportGlobalLibraryBibliography(request: LibraryBibliographyExportRequest): Promise<LibraryBibliographyExportReport>;
  listGlobalLibraryDuplicates(): Promise<LibraryDuplicateGroup[]>;
  previewGlobalLibraryMerge(canonicalId: string, duplicateIds: string[]): Promise<LibraryMergeImpact>;
  mergeGlobalLibraryItems(canonicalId: string, duplicateIds: string[]): Promise<LibraryItemRecord>;
  listGlobalLibraryVaults(): Promise<VaultSummary[]>;
  listGlobalLibraryVaultLinks(itemId?: string): Promise<LibraryVaultLink[]>;
  linkGlobalLibraryItemsToVault(itemIds: string[], vaultId: string): Promise<LibraryVaultLinkReport>;
  onLibraryMigrationProgress(cb: (progress: LibraryMigrationProgress) => void): () => void;
  onGlobalLibraryChanged(cb: (status: LibraryStatus) => void): () => void;
}
