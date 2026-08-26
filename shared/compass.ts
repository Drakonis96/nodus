// SPDX-License-Identifier: AGPL-3.0-only

/** Renderer-safe contracts for Compass. Raw provider payloads and opaque cursors never cross IPC. */
export type CompassLane = "scholarly" | "primary";

export type CompassProviderId =
  | "openalex"
  | "core"
  | "doaj"
  | "openaire"
  | "openlibrary"
  | "doab"
  | "oapen"
  | "bnf"
  | "hal"
  | "datacite"
  | "zenodo"
  | "europepmc"
  | "arxiv"
  | "dblp"
  | "semanticscholar"
  | "internetarchive"
  | "loc"
  | "gallica"
  | "crossref"
  | "opencitations"
  /** Historical provenance only; these providers are never routed. */
  | "unpaywall"
  | "dialnet"
  | "openedition"
  | "scielo"
  | "europeana"
  | "googlebooks";

export type CompassPublicationType =
  | "article"
  | "book"
  | "chapter"
  | "thesis"
  | "report"
  | "dataset"
  | "preprint"
  | "photograph"
  | "newspaper"
  | "map"
  | "manuscript"
  | "audio"
  | "video"
  | "archive-item"
  | "other";
export type CompassProviderState =
  | "idle"
  | "queued"
  | "searching"
  | "complete"
  | "rate-limited"
  | "offline"
  | "budget-exhausted"
  | "temporarily-disabled"
  | "error"
  | "canceled";
export type CompassSearchState =
  | "interpreting"
  | "queued"
  | "searching"
  | "partial"
  | "complete"
  | "empty"
  | "offline"
  | "rate-limited"
  | "budget-exhausted"
  | "partial-error"
  | "canceled"
  | "error";
export type CompassImportItemState =
  | "queued"
  | "checking"
  | "created"
  | "linked-existing"
  | "metadata-completed"
  | "downloading"
  | "attached"
  | "no-file"
  | "skipped-limit"
  | "skipped-duplicate"
  | "failed"
  | "canceled";
export type CompassQueryStrategy =
  | "strict"
  | "balanced"
  | "semantic"
  | "concept-pair"
  | "identifier"
  | "similar";

export interface CompassFilters {
  lane?: CompassLane;
  fromYear?: number;
  toYear?: number;
  languages?: string[];
  types?: CompassPublicationType[];
  disciplines?: string[];
  providers?: CompassProviderId[];
  openAccessOnly?: boolean;
  digitallyAvailableOnly?: boolean;
  sort?: "relevance" | "date" | "citations";
}
export interface CompassQueryExpressions {
  strict: string;
  balanced: string;
  semantic: string;
  conceptPairs: string[];
}
export interface CompassQueryPlan {
  text: string;
  detectedLanguage?: string;
  exactPhrases: string[];
  excludedTerms: string[];
  authors: string[];
  venues: string[];
  identifiers: CompassIdentifier[];
  fromYear?: number;
  toYear?: number;
  languages: string[];
  types: CompassPublicationType[];
  disciplines: string[];
  concepts: string[][];
  expressions: CompassQueryExpressions;
  openAccessOnly: boolean;
  providers: CompassProviderId[];
  lane: CompassLane;
  mode?: "search" | "similar";
}

export interface CompassIdentifier {
  scheme: string;
  value: string;
}
export interface CompassAuthor {
  name: string;
  given?: string;
  family?: string;
  orcid?: string;
}
export interface CompassDownloadLink {
  url: string;
  mediaType?: string;
  format?: string;
  license?: string;
  rights?: string;
  open: boolean;
  verifiedAt: string;
  provider: CompassProviderId;
}
export interface CompassOpenAccessEvidence {
  status: "gold" | "hybrid" | "green" | "bronze" | "closed" | "unknown";
  url?: string;
  license?: string;
  provider?: CompassProviderId;
  verifiedAt?: string;
}
export interface CompassProvenance {
  provider: CompassProviderId;
  providerId: string;
  retrievedAt: string;
  sourceUrl?: string;
  metadataLicense?: string;
  attribution?: string;
}
export interface CompassRecommendationReason {
  code:
    | "matched-concept"
    | "phrase-match"
    | "author-match"
    | "language-match"
    | "type-match"
    | "date-match"
    | "open-access"
    | "provider-route"
    | "citation-related"
    | "semantic-similarity";
  value?: string;
}

export interface CompassResult {
  canonicalKey: string;
  title: string;
  subtitle?: string;
  abstract?: string;
  authors: CompassAuthor[];
  issuedDate?: string;
  issuedYear?: number;
  language?: string;
  type: CompassPublicationType;
  lane: CompassLane;
  disciplines: string[];
  topics: string[];
  venue?: string;
  publisher?: string;
  identifiers: CompassIdentifier[];
  landingUrl?: string;
  doiUrl?: string;
  rights?: string;
  digitallyAvailable?: boolean;
  hasDownloadableFile?: boolean;
  downloadLinks: CompassDownloadLink[];
  openAccess?: CompassOpenAccessEvidence;
  citationCount?: number;
  provenance: CompassProvenance[];
  providerRanks: Partial<Record<CompassProviderId, number>>;
  nativeScore?: number;
  nativeRank?: number;
  lexicalScore: number;
  semanticScore?: number;
  rrfScore?: number;
  exactScore?: number;
  finalScore: number;
  displayRank?: number;
  reasons: CompassRecommendationReason[];
  duplicateAliases?: string[];
  possibleDuplicateKeys?: string[];
  importedLibraryItemId?: string;
}

/** Deliberately small. Download URLs and long metadata require getCompassResultDetail. */
export type CompassResultSummary = Pick<
  CompassResult,
  | "canonicalKey"
  | "title"
  | "authors"
  | "issuedYear"
  | "type"
  | "lane"
  | "language"
  | "openAccess"
  | "citationCount"
  | "provenance"
  | "finalScore"
  | "displayRank"
  | "reasons"
  | "landingUrl"
  | "identifiers"
  | "rights"
  | "digitallyAvailable"
> & { hasDownloadableFile: boolean };

export interface CompassProviderCapabilities {
  lanes: CompassLane[];
  types: CompassPublicationType[];
  supportsSemantic: boolean;
  supportsCursor: boolean;
  supportsOpenAccessFilter: boolean;
  anonymous: true;
}
export interface CompassProviderDescriptor {
  id: CompassProviderId;
  label: string;
  attribution: string;
  metadataLicense?: string;
  capabilities: CompassProviderCapabilities;
}
export interface CompassProviderStatus {
  provider: CompassProviderId;
  state: CompassProviderState;
  count: number;
  hasMore: boolean;
  retryAt?: number;
  error?: string;
  attribution?: string;
  strategy?: CompassQueryStrategy;
  lane: CompassLane;
}
export interface CompassSearchSession {
  searchId: string;
  requestId: string;
  generation: number;
  queryRevision: number;
  viewRevision: number;
  query: string;
  fingerprint: string;
  plan: CompassQueryPlan;
  filters: CompassFilters;
  lane: CompassLane;
  state: CompassSearchState;
  revision: number;
  resultCount: number;
  selectedCount: number;
  providers: CompassProviderStatus[];
  createdAt: number;
  updatedAt: number;
}
export interface CompassSearchProgress {
  searchId: string;
  requestId: string;
  generation: number;
  queryRevision: number;
  viewRevision: number;
  revision: number;
  state: CompassSearchState;
  summaries: CompassResultSummary[];
  resultsOffset: number;
  providers: CompassProviderStatus[];
  done: boolean;
  error?: string;
}
export interface CompassSearchRequest {
  requestId: string;
  generation?: number;
  queryRevision?: number;
  query: string;
  lane?: CompassLane;
  filters?: CompassFilters;
  interpretWithLlm?: boolean;
  similarTo?: { searchId: string; canonicalKey: string };
}
export interface CompassSearchResponse {
  session: CompassSearchSession;
  results: CompassResultSummary[];
  resultsOffset?: number;
  hasMore: boolean;
}
export interface CompassViewRequest {
  searchId: string;
  requestId: string;
  generation: number;
  viewRevision: number;
  lane: CompassLane;
  filters: CompassFilters;
  offset?: number;
}
export interface CompassRangeSelectionRequest {
  searchId: string;
  from: number;
  to: number;
  selected: boolean;
  revision: number;
}

export interface CompassImportJob {
  jobId: string;
  searchId: string;
  selectionRevision: number;
  selectedKeys: string[];
  collectionIds: string[];
  state: "queued" | "running" | "completed" | "canceled" | "failed";
  total: number;
  completed: number;
  failed: number;
  createdAt: number;
  updatedAt: number;
}
export interface CompassImportItemResult {
  jobId: string;
  canonicalKey: string;
  state: CompassImportItemState;
  libraryItemId?: string;
  attachmentId?: string;
  bytes?: number;
  sha256?: string;
  error?: string;
}
export interface CompassImportProgress {
  job: CompassImportJob;
  items: CompassImportItemResult[];
}
export interface CompassImportRequest {
  searchId: string;
  selectionRevision: number;
  selection: "stored" | { canonicalKeys: string[] };
  collectionIds?: string[];
}

/** Main-only adapter contracts. They live here solely to keep provider modules typed. */
export interface CompassProviderPage {
  records: CompassResult[];
  nextCursor?: string;
  hasMore: boolean;
  provider: CompassProviderId;
  attribution?: string;
}
export interface CompassProviderContext {
  query: CompassQueryPlan;
  filters: CompassFilters;
  strategy: CompassQueryStrategy;
  lane: CompassLane;
  cursor?: string;
  signal: AbortSignal;
}
export interface CompassProviderAdapter {
  readonly id: CompassProviderId;
  readonly descriptor: CompassProviderDescriptor;
  search(context: CompassProviderContext): Promise<CompassProviderPage>;
}

export interface CompassSnapshot {
  searchId: string | null;
  draft: string;
  lane: CompassLane;
  filters: CompassFilters;
  sort: NonNullable<CompassFilters["sort"]>;
  scrollAnchors: Partial<Record<CompassLane, { key: string; offset: number }>>;
}

export const COMPASS_PROVIDERS = [
  "openalex",
  "core",
  "doaj",
  "openaire",
  "openlibrary",
  "doab",
  "oapen",
  "bnf",
  "hal",
  "datacite",
  "zenodo",
  "europepmc",
  "arxiv",
  "dblp",
  "semanticscholar",
  "internetarchive",
  "loc",
  "gallica",
  "crossref",
  "opencitations",
] as const satisfies readonly CompassProviderId[];
export const COMPASS_MAX_RESULTS_PER_PAGE = 25;
export const COMPASS_MAX_QUERY_LENGTH = 2_000;
export const COMPASS_MAX_SELECTED_KEYS = 10_000;
export const COMPASS_MAX_CANDIDATES = 2_000;
export const COMPASS_MAX_NORMALIZED_CANDIDATE_BYTES = 64 * 1024;
