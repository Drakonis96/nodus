/** Canonical, vault-independent bibliography stored in `nodus-library`. */
export type LibraryScope = 'global' | 'vault';

export type LibraryItemSource =
  | 'nodus' | 'zotero' | 'mendeley' | 'ris' | 'bibtex' | 'biblatex' | 'csl-json'
  | 'endnote-xml' | 'zotero-rdf' | 'csv' | 'markdown' | 'legacy';

/** External identity is never the Nodus item ID. All fields participate in equality. */
export interface LibrarySourceIdentity {
  source: Exclude<LibraryItemSource, 'nodus' | 'legacy'>;
  libraryType: 'user' | 'group' | 'personal' | 'shared' | 'import';
  libraryId: string;
  itemKey: string;
}

export type LibraryItemType =
  | 'article-journal'
  | 'journal-article'
  | 'magazine-article'
  | 'newspaper-article'
  | 'book'
  | 'book-chapter'
  | 'chapter'
  | 'book-section'
  | 'conference-paper'
  | 'thesis'
  | 'report'
  | 'manuscript'
  | 'presentation'
  | 'interview'
  | 'letter'
  | 'email'
  | 'instant-message'
  | 'encyclopedia-article'
  | 'dictionary-entry'
  | 'case'
  | 'hearing'
  | 'bill'
  | 'statute'
  | 'patent'
  | 'artwork'
  | 'map'
  | 'film'
  | 'audio-recording'
  | 'video-recording'
  | 'radio-broadcast'
  | 'tv-broadcast'
  | 'podcast'
  | 'blog-post'
  | 'forum-post'
  | 'computer-program'
  | 'webpage'
  | 'document'
  | 'dataset'
  | 'preprint'
  | 'standard'
  | 'other';

export type LibraryCreatorRole =
  | 'author' | 'contributor' | 'editor' | 'seriesEditor' | 'translator'
  | 'reviewedAuthor' | 'bookAuthor' | 'inventor' | 'director' | 'scriptwriter'
  | 'producer' | 'performer' | 'composer' | 'wordsBy' | 'cartographer'
  | 'programmer' | 'artist' | 'podcaster' | 'presenter' | 'interviewer'
  | 'interviewee' | 'recipient' | 'sponsor' | 'counsel' | 'castMember'
  | 'attorneyAgent' | 'commenter' | 'guest' | (string & {});

export interface LibraryCreator {
  creatorType: LibraryCreatorRole;
  firstName?: string;
  lastName?: string;
  name?: string;
  /** Zotero-compatible corporate-name mode. */
  fieldMode?: 0 | 1;
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
  pmid?: string;
  pmcid?: string;
  arxiv?: string;
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
  role: 'original' | 'supplement' | 'snapshot' | 'image' | 'dataset' | 'transcript' | 'other';
  position?: number;
  addedAt?: string;
  sourceKey?: string;
  sourceState?: 'available' | 'not-downloaded' | 'source-missing' | 'corrupt';
  /** True while Nodus owns the filename and may keep it aligned with item metadata. */
  autoRenamed?: boolean;
}

export interface LibraryAttachmentPatch {
  title?: string;
  fileName?: string;
  role?: LibraryAttachmentRecord['role'];
  position?: number;
  makePrimary?: boolean;
}

export interface LibraryNoteRecord {
  id: string;
  title: string;
  markdown: string;
  source: 'nodus' | 'zotero';
  sourceKey?: string;
  readOnly: boolean;
  createdAt: string;
  updatedAt: string;
}

export type LibraryItemRelationType = 'related' | 'cites' | 'is-cited-by' | 'corrects' | 'is-corrected-by';

export interface LibraryItemRelation {
  id: string;
  targetItemId: string;
  relationType: LibraryItemRelationType;
  createdAt: string;
}

export interface LibraryTagRecord {
  name: string;
  color: string | null;
  itemCount: number;
}

export interface LibraryTagPatch {
  add?: string[];
  remove?: string[];
}

export interface LibraryRecordClock {
  deviceId: string;
  revision: number;
  baseRevision: number;
  updatedAt: string;
  contentHash: string;
}

export type LibraryAnalysisFreshness = 'none' | 'queued' | 'running' | 'current' | 'stale' | 'failed' | 'unavailable';

export type LibraryAnalysisComponent = 'extraction' | 'light' | 'deep' | 'passages' | 'ideas' | 'embeddings' | 'summary';

export interface LibraryComponentRevision {
  freshness: LibraryAnalysisFreshness;
  fingerprint: string | null;
  reason: string | null;
  generatedAt: string | null;
  provider?: string | null;
  model?: string | null;
  dimension?: number | null;
  pipeline?: string | null;
  promptHash?: string | null;
}

export interface LibraryPendingInvalidation {
  vaultId: string;
  components: LibraryAnalysisComponent[];
  reason: 'bibliographic-change' | 'content-change' | 'primary-attachment-change' | 'embedding-config-change' | 'summary-config-change';
  requestedAt: string;
}

/** Provenance for every derived output visible in the Library or a linked vault. */
export interface LibraryContentRevision {
  format: 'nodus.library-content-revision';
  formatVersion: 1;
  revision: number;
  extractionFingerprint: string | null;
  bibliographicFingerprint: string;
  contentFingerprint: string | null;
  embeddingFingerprint: string | null;
  summaryFingerprint: string | null;
  components: Record<LibraryAnalysisComponent, LibraryComponentRevision>;
  previousReadable: {
    contentFingerprint: string;
    files: NonNullable<LibraryItemRecord['files']>;
    supersededAt: string;
  } | null;
  pendingInvalidations: LibraryPendingInvalidation[];
  updatedAt: string;
}

export interface LibraryItemRecord {
  format: 'nodus.library-item';
  formatVersion: 2;
  /** Immutable identifier owned by Nodus, independent from every manager. */
  id: string;
  /** Stable folder lookup. Existing folders are never renamed during migration. */
  storageId: string;
  /** Permanent former IDs, including IDs of records merged into this item. */
  aliases: string[];
  sourceIdentities: LibrarySourceIdentity[];
  source: LibraryItemSource;
  sourceLibraryId?: string;
  sourceKey?: string;
  sourceState?: 'current' | 'source-missing' | 'library-missing' | 'partial';
  sourceMissingAt?: string;
  lastSourceSyncAt?: string;
  sourceVersion?: number;
  citationKey?: string;
  metadata: LibraryItemMetadata;
  /** User-owned corrections layered over a mirrored manager record. */
  metadataOverrides?: LibraryMetadataOverrides;
  /** User-owned tags remain independent from the read-only source mirror. */
  localTags?: string[];
  /** Source tags explicitly hidden by the user remain hidden after refresh. */
  suppressedSourceTags?: string[];
  collectionIds: string[];
  attachments: LibraryAttachmentRecord[];
  notes?: LibraryNoteRecord[];
  relations?: LibraryItemRelation[];
  files?: {
    reader?: string;
    original?: string;
    sourceMap?: string;
    qualityReport?: string;
    annotations?: string;
    chat?: string;
    orphanedAnnotations?: string;
  };
  extraction?: {
    status: 'pending' | 'processing' | 'ready' | 'needs-review' | 'failed' | 'unsupported';
    progress?: number;
    engine?: string;
    updatedAt?: string;
    error?: string;
    lastSuccessfulAt?: string;
    lastSuccessfulFingerprint?: string;
  };
  contentRevision?: LibraryContentRevision;
  /** Original work IDs discovered in legacy vaults, used for idempotent relinking. */
  vaultWorkIds?: Record<string, string>;
  createdAt: string;
  deletedAt: string | null;
  clock: LibraryRecordClock;
}

export interface LibraryCollectionRecord {
  format: 'nodus.library-collection';
  formatVersion: 2;
  id: string;
  aliases: string[];
  name: string;
  /** Optional Nodus-owned presentation. Missing values use the standard folder style. */
  icon?: LibraryCollectionIcon;
  color?: string;
  parentId: string | null;
  position: number;
  source: LibraryItemSource;
  sourceLibraryId?: string;
  sourceKey?: string;
  sourceState?: 'current' | 'source-missing' | 'library-missing' | 'partial';
  sourceMissingAt?: string;
  createdAt: string;
  deletedAt: string | null;
  clock: LibraryRecordClock;
}

export type LibraryCollectionIcon =
  | 'folder' | 'book' | 'bookmark' | 'star' | 'archive' | 'notebook'
  | 'graduation' | 'flask' | 'globe' | 'map' | 'users' | 'tag';

export interface LibraryCollectionPatch {
  name?: string;
  parentId?: string | null;
  position?: number;
  icon?: LibraryCollectionIcon | null;
  color?: string | null;
}

export interface LibraryCatalogItem {
  id: string;
  storageId: string;
  source: LibraryItemSource;
  sourceLibraryId: string | null;
  sourceKey: string | null;
  sourceState: LibraryItemRecord['sourceState'] | null;
  citationKey: string | null;
  /** Complete normalized bibliography for configurable Zotero-style columns. */
  metadata: LibraryItemMetadata;
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
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
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
  phase: 'connecting' | 'collections' | 'catalog' | 'attachments' | 'rebuild' | 'complete' | 'canceled' | 'failed';
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
  itemsSourceMissing: number;
  collectionsCreated: number;
  collectionsUpdated: number;
  collectionsUnchanged: number;
  attachmentsCopied: number;
  attachmentsUnchanged: number;
  attachmentsUnavailable: number;
  attachmentsChanged: number;
  conflicts: number;
  librariesMissing: string[];
  failures: ZoteroSyncFailure[];
  partial: boolean;
  warnings: string[];
  canceled: boolean;
  durationMs: number;
}

export interface ZoteroSyncFailure {
  libraryId: string | null;
  code: 'zotero-closed' | 'credentials-expired' | 'rate-limited' | 'library-missing' | 'permission' | 'network' | 'invalid-response' | 'unknown';
  message: string;
  retryable: boolean;
}

export interface ZoteroSyncSession {
  format: 'nodus.zotero-sync';
  formatVersion: 1;
  id: string;
  status: 'running' | 'canceled' | 'failed' | 'completed';
  selection: ZoteroImportSelection;
  progress: ZoteroImportProgress;
  report: ZoteroImportReport | null;
  startedAt: string;
  updatedAt: string;
  error: string | null;
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
  footnoteReferences: number;
  footnoteDefinitions: number;
  unresolvedFootnotes: number;
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

export interface LibraryReadingPreparationPlan {
  itemId: string;
  action: 'open-clean' | 'prepare-before-open' | 'queue-and-open-original' | 'open-original' | 'unavailable';
  attachmentId: string | null;
  pageCount: number | null;
  byteSize: number;
  jobId: string | null;
  reason: 'ready' | 'short-document' | 'long-document' | 'original-only' | 'no-file';
}

export interface LibraryCatalogQuery {
  search?: string;
  collectionId?: string | null;
  savedSearchId?: string | null;
  smartSearch?: LibrarySmartSearchGroup | null;
  source?: LibraryItemSource | null;
  itemType?: LibraryItemType | null;
  tag?: string | null;
  vaultId?: string | null;
  limit?: number;
  offset?: number;
  includeDeleted?: boolean;
  extractionStatus?: NonNullable<LibraryItemRecord['extraction']>['status'] | null;
  yearFrom?: number | null;
  yearTo?: number | null;
  hasAttachments?: boolean | null;
  sort?: LibrarySortRule[];
  includeFacets?: boolean;
}

export type LibrarySortField =
  | 'title' | 'creator' | 'itemType' | 'publicationTitle' | 'publisher' | 'date' | 'year'
  | 'edition' | 'volume' | 'issue' | 'pages' | 'doi' | 'isbn' | 'issn' | 'language'
  | 'pmid' | 'pmcid' | 'arxiv' | 'url' | 'tags' | 'citationKey' | 'source' | 'createdAt'
  | 'updatedAt' | 'extraction' | 'attachments';

export interface LibrarySortRule {
  field: LibrarySortField;
  direction: 'asc' | 'desc';
}

export type LibrarySmartSearchField =
  | 'title' | 'abstract' | 'creator' | 'tag' | 'date' | 'year' | 'source' | 'itemType'
  | 'collection' | 'attachment' | 'extraction' | 'trash' | 'vault' | 'analysis';

export type LibrarySmartSearchOperator =
  | 'contains' | 'equals' | 'not-equals' | 'before' | 'after' | 'is-true' | 'is-false';

export interface LibrarySmartSearchCondition {
  id: string;
  field: LibrarySmartSearchField;
  operator: LibrarySmartSearchOperator;
  value?: string | number | boolean | null;
}

export interface LibrarySmartSearchGroup {
  id: string;
  mode: 'all' | 'any' | 'not';
  rules: Array<LibrarySmartSearchCondition | LibrarySmartSearchGroup>;
}

export interface LibrarySavedSearchRecord {
  format: 'nodus.library-saved-search';
  formatVersion: 1;
  id: string;
  name: string;
  query: LibrarySmartSearchGroup;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryFacetValue {
  value: string;
  count: number;
}

export interface LibraryCatalogFacets {
  sources: LibraryFacetValue[];
  itemTypes: LibraryFacetValue[];
  extraction: LibraryFacetValue[];
  attachments: LibraryFacetValue[];
  years: LibraryFacetValue[];
  tags: LibraryFacetValue[];
  vaults: LibraryFacetValue[];
}

export interface LibraryCatalogPage {
  items: LibraryCatalogItem[];
  total: number;
  limit: number;
  offset: number;
  facets: LibraryCatalogFacets;
}

export interface LibraryCollectionView {
  id: string;
  name: string;
  icon: LibraryCollectionIcon | null;
  color: string | null;
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

export type LibraryColumnId =
  | 'title' | 'creator' | 'itemType' | 'publicationTitle' | 'publisher' | 'date' | 'year'
  | 'edition' | 'volume' | 'issue' | 'pages' | 'doi' | 'isbn' | 'issn' | 'pmid'
  | 'pmcid' | 'arxiv' | 'url' | 'language' | 'citationKey' | 'tags' | 'source'
  | 'status' | 'attachments' | 'createdAt' | 'updatedAt';

export interface LibraryViewPreferences {
  visibleColumns: LibraryColumnId[];
  /** Optional user-selected widths in CSS pixels; omitted columns use responsive defaults. */
  columnWidths?: Partial<Record<LibraryColumnId, number>>;
  sort: LibrarySortRule[];
}

export type LibraryAttachmentRenameTemplate =
  | 'creator-year-title'
  | 'year-creator-title'
  | 'title-creator-year';

export type LibraryAttachmentRenameType = 'pdf' | 'epub' | 'other';

/** Cross-vault Library behavior stored alongside the global catalogue. */
export interface GlobalLibrarySettings {
  /** Rename newly managed files from their parent record metadata. */
  autoRenameAttachments: boolean;
  attachmentRenameTemplate: LibraryAttachmentRenameTemplate;
  /** Zotero-compatible defaults are PDF and EPUB. */
  autoRenameAttachmentTypes: LibraryAttachmentRenameType[];
  /** Off by default so supplementary-material filenames keep their meaning. */
  renameSupplementaryAttachments: boolean;
  /** Keep filenames owned by Nodus aligned after bibliographic edits. */
  keepAttachmentNamesInSync: boolean;
  /** Queue clean Markdown/OCR preparation as soon as a file is attached. */
  autoPrepareAttachments: boolean;
}

export interface LibraryLocalImportReport {
  created: number;
  skipped: number;
  itemIds: string[];
  warnings: string[];
}

export type LibraryMetadataIdentifierKind = 'doi' | 'isbn' | 'issn' | 'pmid' | 'pmcid' | 'arxiv';

export interface LibraryFullTextLink {
  url: string;
  mimeType: string | null;
  source: 'crossref' | 'arxiv' | 'pubmed' | 'landing-page';
}

export interface LibraryMetadataCandidate {
  id: string;
  source: 'crossref' | 'open-library' | 'pubmed' | 'arxiv';
  confidence: number;
  sourceUrl: string | null;
  fullTextLinks?: LibraryFullTextLink[];
  metadata: LibraryItemMetadata;
}

export interface LibraryMetadataLookupResult {
  kind: LibraryMetadataIdentifierKind;
  value: string;
  candidates: LibraryMetadataCandidate[];
  queriedAt: string;
}

export interface LibraryIdentifierImportResult {
  item: LibraryItemRecord;
  created: boolean;
  fullText: {
    status: 'downloaded' | 'already-present' | 'not-found' | 'failed';
    sourceUrl: string | null;
    message: string | null;
  };
}

export interface LibraryBibliographyImportReport {
  created: number;
  updated: number;
  duplicates: number;
  skipped: number;
  itemIds: string[];
  warnings: string[];
}

export type LibraryBibliographyFormat =
  | 'ris' | 'bibtex' | 'biblatex' | 'csl-json' | 'endnote-xml' | 'zotero-rdf' | 'csv' | 'markdown';

/** CSL style identifier. Built-in aliases remain stable, while imported styles keep their CSL id. */
export type LibraryCitationStyle = string;

export interface LibraryCitationStyleRecord {
  id: string;
  title: string;
  source: 'bundled' | 'zotero' | 'file' | 'repository';
  fileName: string | null;
  updatedAt: string | null;
  citationFormat: 'author' | 'author-date' | 'label' | 'note' | 'numeric' | null;
  dependentParent: string | null;
  rights: string | null;
  license: string | null;
  availableOffline: boolean;
  removable: boolean;
  warning: string | null;
}

export interface LibraryCitationStyleRepositoryEntry {
  id: string;
  title: string;
}

export interface LibraryCitationStyleImportReport {
  imported: number;
  updated: number;
  skipped: number;
  styles: LibraryCitationStyleRecord[];
  warnings: string[];
}

export interface LibraryBibliographyExportRequest {
  format: LibraryBibliographyFormat;
  itemIds?: string[];
  collectionId?: string | null;
  savedSearchId?: string | null;
  smartSearch?: LibrarySmartSearchGroup | null;
}

export interface LibraryBibliographyExportReport {
  format: LibraryBibliographyFormat;
  exported: number;
  filePath: string | null;
  canceled: boolean;
  warnings: string[];
}

export interface LibraryCitationResult {
  style: LibraryCitationStyle;
  styleTitle?: string;
  locale?: string;
  kind: 'citation' | 'bibliography';
  itemIds: string[];
  text: string;
}

export interface LibraryMetadataBatchProgress {
  requestId: string;
  phase: 'queued' | 'resolving' | 'ready' | 'applying' | 'complete' | 'canceled' | 'failed';
  completed: number;
  total: number;
  currentItemId: string | null;
  succeeded: number;
  failed: number;
  message: string;
}

export interface LibraryMetadataBatchEntry {
  itemId: string;
  kind: LibraryMetadataIdentifierKind | null;
  value: string | null;
  candidate: LibraryMetadataCandidate | null;
  error: string | null;
  applied: boolean;
}

export interface LibraryMetadataBatchResult {
  requestId: string;
  status: 'ready' | 'complete' | 'canceled' | 'failed';
  entries: LibraryMetadataBatchEntry[];
  startedAt: string;
  completedAt: string;
}

export interface LibraryDuplicateGroup {
  key: string;
  reason: 'doi' | 'isbn' | 'metadata';
  items: LibraryCatalogItem[];
}

export interface LibraryTrashItemImpact {
  itemId: string;
  title: string;
  attachmentCount: number;
  attachmentBytes: number;
  annotationCount: number;
  orphanedAnnotationCount: number;
  chatMessageCount: number;
  noteCount: number;
  aliasCount: number;
  relationCount: number;
  linkedVaults: Array<{ vaultId: string; vaultName: string; workId: string }>;
}

export interface LibraryTrashImpact {
  itemIds: string[];
  items: LibraryTrashItemImpact[];
  attachmentCount: number;
  attachmentBytes: number;
  annotationCount: number;
  orphanedAnnotationCount: number;
  chatMessageCount: number;
  noteCount: number;
  aliasCount: number;
  relationCount: number;
  linkedVaultCount: number;
  purgeBlocked: boolean;
  blockers: string[];
}

export interface LibraryPurgeReport {
  requested: number;
  purged: number;
  archivedRecoveryCopies: number;
  blocked: number;
  warnings: string[];
}

export interface LibraryMergeImpact {
  canonicalId: string;
  duplicateIds: string[];
  attachmentCount: number;
  annotationCount: number;
  orphanedAnnotationCount: number;
  chatMessageCount: number;
  noteCount: number;
  aliasCount: number;
  relationCount: number;
  linkedVaultCount: number;
  vaultWorksPreserved: number;
  warnings: string[];
}

export type LibraryRecoveryIssueCode =
  | 'conflict' | 'invalid-record' | 'missing-attachment' | 'corrupt-attachment'
  | 'missing-reader' | 'orphan-folder' | 'invalid-saved-search' | 'invalid-vault-link';

export interface LibraryRecoveryIssue {
  code: LibraryRecoveryIssueCode;
  itemId: string | null;
  path: string | null;
  message: string;
  recoverable: boolean;
}

export interface LibraryRecoveryReport {
  auditedAt: string;
  checkedItems: number;
  checkedAttachments: number;
  conflicts: number;
  invalidRecords: number;
  missingFiles: number;
  corruptFiles: number;
  orphanFolders: number;
  issues: LibraryRecoveryIssue[];
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

export type LibraryAnalysisReuseComponent = 'light' | 'deep' | 'summary' | 'ideas' | 'passages' | 'embeddings' | 'documentProfile';
export type LibraryAnalysisReuseState = 'current' | 'reused' | 'pending' | 'incompatible' | 'unavailable' | 'canceled';

export interface LibraryAnalysisReuseStatus {
  state: LibraryAnalysisReuseState;
  reason: string;
  sourceVaultId: string | null;
  sourceWorkId: string | null;
  reusedAt: string | null;
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
    reuse?: Record<LibraryAnalysisReuseComponent, LibraryAnalysisReuseStatus>;
  };
}

export interface LibraryVaultLinkReport {
  requested: number;
  linked: number;
  existing: number;
  vaultId: string;
  links: LibraryVaultLink[];
  reusedComponents: number;
  pendingComponents: number;
  canceled: boolean;
}

export interface LibraryMigrationProgress {
  sessionId?: string;
  phase: 'inventory' | 'collections' | 'items' | 'catalog' | 'verify' | 'rollback' | 'complete';
  vaultIndex: number;
  vaultCount: number;
  vaultId: string | null;
  vaultName: string | null;
  processedItems: number;
  totalItems: number;
  percent: number;
}

export type LibraryMigrationSessionStatus =
  | 'preview'
  | 'running'
  | 'canceled'
  | 'failed'
  | 'completed'
  | 'rolled-back';

export interface LibraryMigrationVaultPreview {
  id: string;
  name: string;
  path: string;
  type: string;
  origin: 'local' | 'connected';
  readOnly: boolean;
  available: boolean;
  defaultSelected: boolean;
  itemCount: number;
  collectionCount: number;
  sourceBytes: number;
  estimatedAdditionalBytes: number;
  duplicateItems: number;
  warnings: string[];
}

export interface LibraryMigrationPreview {
  format: 'nodus.library-migration-preview';
  formatVersion: 1;
  createdAt: string;
  vaults: LibraryMigrationVaultPreview[];
  selectedVaultIds: string[];
  totalItems: number;
  totalCollections: number;
  estimatedAdditionalBytes: number;
  expectedDuplicateItems: number;
  warnings: string[];
}

export interface LibraryMigrationCheckpoint {
  phase: LibraryMigrationProgress['phase'];
  vaultId: string | null;
  processedItems: number;
  totalItems: number;
  percent: number;
  recordedAt: string;
}

export interface LibraryMigrationCreatedRecord {
  kind: 'item' | 'collection';
  id: string;
  storageId?: string;
  revision: number;
  contentHash: string;
}

export interface LibraryMigrationCreatedLink {
  itemId: string;
  vaultId: string;
  workId: string;
}

export interface LibraryMigrationSession {
  format: 'nodus.library-migration-session';
  formatVersion: 1;
  id: string;
  status: LibraryMigrationSessionStatus;
  createdAt: string;
  updatedAt: string;
  selectedVaultIds: string[];
  preview: LibraryMigrationPreview;
  checkpoint: LibraryMigrationCheckpoint;
  createdRecords: LibraryMigrationCreatedRecord[];
  createdLinks: LibraryMigrationCreatedLink[];
  report: LibraryMigrationReport | null;
  verification: {
    catalogMatches: boolean;
    manifestsValid: boolean;
    filesPresent: boolean;
    linksValid: boolean;
    checkedAt: string | null;
  } | null;
  rollbackConflicts: string[];
  error: string | null;
}

export interface LibraryMigrationStartRequest {
  preview: LibraryMigrationPreview;
  selectedVaultIds: string[];
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
