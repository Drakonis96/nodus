/** Canonical, vault-independent bibliography stored in `nodus-library`. */
export type LibraryItemSource = 'nodus' | 'zotero' | 'mendeley' | 'ris' | 'bibtex' | 'csl-json' | 'legacy';

export type LibraryItemType =
  | 'article-journal'
  | 'book'
  | 'chapter'
  | 'conference-paper'
  | 'thesis'
  | 'report'
  | 'webpage'
  | 'document'
  | 'dataset'
  | 'other';

export interface LibraryCreator {
  creatorType: string;
  firstName?: string;
  lastName?: string;
  name?: string;
}

export interface LibraryItemMetadata {
  title: string;
  itemType: LibraryItemType;
  creators: LibraryCreator[];
  abstract?: string;
  date?: string;
  year?: number | null;
  language?: string;
  publisher?: string;
  publicationTitle?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  edition?: string;
  place?: string;
  rights?: string;
  url?: string;
  doi?: string;
  isbn?: string[];
  issn?: string[];
  tags?: string[];
  extra?: Record<string, string>;
}

/** A `null` override intentionally removes a field supplied by an external manager. */
export type LibraryMetadataOverrides = {
  [Key in keyof LibraryItemMetadata]?: LibraryItemMetadata[Key] | null;
};

export interface LibraryAttachmentRecord {
  id: string;
  title: string;
  fileName: string;
  relativePath: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  role: 'original' | 'supplement' | 'snapshot' | 'image' | 'other';
  sourceKey?: string;
}

export interface LibraryRecordClock {
  deviceId: string;
  revision: number;
  baseRevision: number;
  updatedAt: string;
  contentHash: string;
}

export interface LibraryItemRecord {
  format: 'nodus.library-item';
  formatVersion: 1;
  id: string;
  storageId: string;
  source: LibraryItemSource;
  sourceLibraryId?: string;
  sourceKey?: string;
  citationKey?: string;
  metadata: LibraryItemMetadata;
  /** User-owned corrections layered over a mirrored manager record. */
  metadataOverrides?: LibraryMetadataOverrides;
  collectionIds: string[];
  attachments: LibraryAttachmentRecord[];
  files?: {
    reader?: string;
    original?: string;
    sourceMap?: string;
    qualityReport?: string;
    annotations?: string;
  };
  extraction?: {
    status: 'pending' | 'processing' | 'ready' | 'needs-review' | 'failed' | 'unsupported';
    progress?: number;
    engine?: string;
    updatedAt?: string;
    error?: string;
  };
  createdAt: string;
  deletedAt: string | null;
  clock: LibraryRecordClock;
}

export interface LibraryCollectionRecord {
  format: 'nodus.library-collection';
  formatVersion: 1;
  id: string;
  name: string;
  parentId: string | null;
  position: number;
  source: LibraryItemSource;
  sourceLibraryId?: string;
  sourceKey?: string;
  createdAt: string;
  deletedAt: string | null;
  clock: LibraryRecordClock;
}

export interface LibraryCatalogItem {
  id: string;
  storageId: string;
  source: LibraryItemSource;
  sourceLibraryId: string | null;
  sourceKey: string | null;
  citationKey: string | null;
  title: string;
  itemType: LibraryItemType;
  creators: LibraryCreator[];
  year: number | null;
  date: string | null;
  doi: string | null;
  isbn: string[];
  issn: string[];
  tags: string[];
  collectionIds: string[];
  attachmentCount: number;
  readerAvailable: boolean;
  extractionStatus: NonNullable<LibraryItemRecord['extraction']>['status'];
  updatedAt: string;
}

export interface LibraryImportSourceState {
  sourceId: string;
  source: LibraryItemSource;
  libraryId: string;
  libraryName: string;
  version: number;
  importedAt: string;
  configuration: Record<string, unknown>;
}

export interface ZoteroLibraryPreview {
  id: string;
  type: 'user' | 'group';
  name: string;
  version: number;
  lastImportedVersion: number;
}

export interface ZoteroImportSelection {
  libraryIds?: string[];
  collectionIds?: string[];
  includeUnfiled?: boolean;
  copyAttachments?: boolean;
  /** Ignore the saved Zotero version and create a new full snapshot. */
  fullRefresh?: boolean;
}

export interface ZoteroImportProgress {
  requestId: string;
  phase: 'connecting' | 'collections' | 'catalog' | 'attachments' | 'rebuild' | 'complete' | 'canceled';
  libraryId: string | null;
  libraryName: string | null;
  processedItems: number;
  totalItems: number;
  processedAttachments: number;
  totalAttachments: number;
  percent: number;
  message: string;
}

export interface ZoteroImportReport {
  requestId: string;
  libraries: number;
  itemsDiscovered: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsUnchanged: number;
  itemsDeleted: number;
  collectionsCreated: number;
  collectionsUpdated: number;
  collectionsUnchanged: number;
  attachmentsCopied: number;
  attachmentsUnchanged: number;
  attachmentsUnavailable: number;
  warnings: string[];
  canceled: boolean;
  durationMs: number;
}

export interface LibraryExtractionOptions {
  ocrMode: 'off' | 'local' | 'remote';
  ocrLanguages: string;
  maxOcrPages: number;
  extractImages: boolean;
  detectTables: boolean;
  force: boolean;
}

export interface LibrarySourceAnchor {
  page: number;
  bbox: [number, number, number, number];
}

export interface LibrarySourceBlock {
  id: string;
  kind: 'title' | 'heading' | 'paragraph' | 'quote' | 'list' | 'table' | 'figure' | 'note' | 'code';
  markdown: { start: number; end: number };
  anchors: LibrarySourceAnchor[];
  textSha256: string;
}

export interface LibrarySourceMap {
  version: 1;
  source: { file: string; sha256: string };
  reader: { file: string; sha256: string };
  pages: Array<{ page: number; width: number; height: number }>;
  blocks: LibrarySourceBlock[];
}

export interface LibraryQualityReport {
  status: 'passed' | 'needs-review' | 'failed';
  characters: number;
  words: number;
  blocks: number;
  headings: number;
  figures: number;
  tables: number;
  ocrPages: number;
  blankPages: number;
  doubleSpaces: number;
  decomposedUnicodeMarks: number;
  softHyphens: number;
  brokenWordLineWraps: number;
  warnings: string[];
}

export interface LibraryExtractionJob {
  id: string;
  itemId: string;
  status: 'queued' | 'processing' | 'done' | 'failed' | 'canceled';
  phase: 'queued' | 'analyze' | 'extract' | 'ocr' | 'assets' | 'write' | 'done';
  progress: number;
  priority: number;
  options: LibraryExtractionOptions;
  attempts: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryExtractionProgress extends LibraryExtractionJob {
  message: string;
}

export interface LibraryExtractionEnqueueResult {
  queued: number;
  skipped: number;
  jobIds: string[];
}

export interface LibraryCatalogQuery {
  search?: string;
  collectionId?: string | null;
  source?: LibraryItemSource | null;
  limit?: number;
  offset?: number;
  includeDeleted?: boolean;
  extractionStatus?: NonNullable<LibraryItemRecord['extraction']>['status'] | null;
  yearFrom?: number | null;
  yearTo?: number | null;
  hasAttachments?: boolean | null;
}

export interface LibraryCatalogPage {
  items: LibraryCatalogItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface LibraryCollectionView {
  id: string;
  name: string;
  parentId: string | null;
  position: number;
  source: LibraryItemSource;
  sourceLibraryId: string | null;
  sourceKey: string | null;
  directItemCount: number;
  updatedAt: string;
}

export interface LibraryItemCollectionPatch {
  add?: string[];
  remove?: string[];
}

export interface LibraryLocalImportReport {
  created: number;
  skipped: number;
  itemIds: string[];
  warnings: string[];
}

export type LibraryMetadataIdentifierKind = 'doi' | 'isbn' | 'issn';

export interface LibraryMetadataCandidate {
  id: string;
  source: 'crossref' | 'open-library';
  confidence: number;
  sourceUrl: string | null;
  metadata: LibraryItemMetadata;
}

export interface LibraryMetadataLookupResult {
  kind: LibraryMetadataIdentifierKind;
  value: string;
  candidates: LibraryMetadataCandidate[];
  queriedAt: string;
}

export interface LibraryBibliographyImportReport {
  created: number;
  updated: number;
  duplicates: number;
  skipped: number;
  itemIds: string[];
  warnings: string[];
}

export interface LibraryDuplicateGroup {
  key: string;
  reason: 'doi' | 'isbn' | 'metadata';
  items: LibraryCatalogItem[];
}

export interface LibraryRebuildResult {
  items: number;
  collections: number;
  attachments: number;
  conflicts: number;
  invalidRecords: number;
  durationMs: number;
}

export interface LibraryStatus {
  configured: boolean;
  root: string | null;
  formatVersion: number;
  deviceId: string | null;
  items: number;
  collections: number;
  attachments: number;
  conflicts: number;
  invalidRecords: number;
  lastRebuiltAt: string | null;
}

export interface LibraryVaultLink {
  itemId: string;
  vaultId: string;
  vaultName: string;
  vaultType: string;
  workId: string;
  analysis: {
    lightStatus: string;
    deepStatus: string;
    summaryStatus: string;
    ideaCount: number;
    passageCount: number;
    evidenceCount: number;
    gapCount: number;
    hasSummary: boolean;
    hasNotes: boolean;
    archived: boolean;
  };
}

export interface LibraryMigrationProgress {
  phase: 'inventory' | 'collections' | 'items' | 'catalog' | 'complete';
  vaultIndex: number;
  vaultCount: number;
  vaultId: string | null;
  vaultName: string | null;
  processedItems: number;
  totalItems: number;
  percent: number;
}

export interface LibraryMigrationReport {
  vaultsScanned: number;
  itemsDiscovered: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsUnchanged: number;
  collectionsCreated: number;
  collectionsUpdated: number;
  collectionsUnchanged: number;
  vaultLinks: number;
  preservedAnalyses: number;
  warnings: string[];
  durationMs: number;
}
