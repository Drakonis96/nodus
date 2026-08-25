// SPDX-License-Identifier: AGPL-3.0-only

/** Shared, renderer-safe contracts for Nodus Compass.  Provider responses are
 * intentionally not represented here: only normalized records cross IPC. */

export type CompassProviderId =
  | 'openalex' | 'crossref' | 'openaire' | 'hal' | 'unpaywall' | 'opencitations'
  | 'doab' | 'oapen' | 'dialnet' | 'openedition' | 'scielo' | 'semanticscholar';

export type CompassPublicationType =
  | 'article' | 'book' | 'chapter' | 'thesis' | 'report' | 'dataset' | 'preprint' | 'other';
export type CompassProviderState = 'idle' | 'queued' | 'searching' | 'complete' | 'rate-limited' | 'error' | 'canceled';
export type CompassSearchState = 'interpreting' | 'searching' | 'partial' | 'complete' | 'empty' | 'canceled' | 'error';
export type CompassImportItemState = 'queued' | 'checking' | 'created' | 'linked-existing' | 'metadata-completed' | 'skipped-duplicate' | 'failed' | 'canceled';

export interface CompassFilters {
  fromYear?: number;
  toYear?: number;
  languages?: string[];
  types?: CompassPublicationType[];
  disciplines?: string[];
  providers?: CompassProviderId[];
  openAccessOnly?: boolean;
  sort?: 'relevance' | 'date' | 'citations';
}

export interface CompassQueryPlan {
  text: string;
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
  openAccessOnly: boolean;
  providers: CompassProviderId[];
}

export interface CompassIdentifier { scheme: string; value: string; }
export interface CompassAuthor { name: string; given?: string; family?: string; orcid?: string; }
export interface CompassOpenAccessEvidence { status: 'gold' | 'hybrid' | 'green' | 'bronze' | 'closed' | 'unknown'; url?: string; license?: string; provider?: CompassProviderId; verifiedAt?: string; }
export interface CompassProvenance { provider: CompassProviderId; providerId: string; retrievedAt: string; sourceUrl?: string; metadataLicense?: string; attribution?: string; }
export interface CompassRecommendationReason { code: 'matched-concept' | 'phrase-match' | 'author-match' | 'language-match' | 'type-match' | 'date-match' | 'open-access' | 'provider-route' | 'citation-related' | 'semantic-similarity'; value?: string; }

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
  disciplines: string[];
  topics: string[];
  venue?: string;
  publisher?: string;
  identifiers: CompassIdentifier[];
  landingUrl?: string;
  doiUrl?: string;
  openAccess?: CompassOpenAccessEvidence;
  citationCount?: number;
  provenance: CompassProvenance[];
  providerRanks: Partial<Record<CompassProviderId, number>>;
  lexicalScore: number;
  semanticScore?: number;
  finalScore: number;
  reasons: CompassRecommendationReason[];
  duplicateAliases?: string[];
  importedLibraryItemId?: string;
}

export type CompassResultSummary = Pick<CompassResult, 'canonicalKey' | 'title' | 'authors' | 'issuedYear' | 'type' | 'language' | 'openAccess' | 'citationCount' | 'provenance' | 'finalScore' | 'reasons' | 'landingUrl' | 'identifiers'>;

export interface CompassProviderStatus { provider: CompassProviderId; state: CompassProviderState; count: number; nextCursor?: string; retryAt?: number; error?: string; attribution?: string; }
export interface CompassSearchSession {
  searchId: string; requestId: string; generation: number; query: string; fingerprint: string;
  plan: CompassQueryPlan; filters: CompassFilters; state: CompassSearchState; revision: number;
  resultCount: number; selectedCount: number; providers: CompassProviderStatus[]; createdAt: number; updatedAt: number;
}
export interface CompassSearchProgress { searchId: string; requestId: string; generation: number; revision: number; state: CompassSearchState; summaries: CompassResultSummary[]; resultsOffset: number; providers: CompassProviderStatus[]; done: boolean; error?: string; }
export interface CompassSearchRequest {
  requestId: string;
  generation?: number;
  query: string;
  filters?: CompassFilters;
  /** Sends the query to the already configured Nodus synthesis provider. */
  interpretWithLlm?: boolean;
}
export interface CompassLoadMoreRequest { searchId: string; requestId: string; generation: number; }
export interface CompassSearchResponse {
  session: CompassSearchSession;
  results: CompassResultSummary[];
  resultsOffset?: number;
  hasMore?: boolean;
}

export interface CompassImportJob { jobId: string; searchId: string; selectionRevision: number; selectedKeys: string[]; collectionIds: string[]; state: 'queued' | 'running' | 'completed' | 'canceled' | 'failed'; total: number; completed: number; failed: number; createdAt: number; updatedAt: number; }
export interface CompassImportItemResult { jobId: string; canonicalKey: string; state: CompassImportItemState; libraryItemId?: string; error?: string; }
export interface CompassImportProgress { job: CompassImportJob; items: CompassImportItemResult[]; }
export interface CompassImportRequest { searchId: string; selectionRevision: number; canonicalKeys: string[]; collectionIds?: string[]; }

export interface CompassProviderPage { records: CompassResult[]; nextCursor?: string; hasMore: boolean; provider: CompassProviderId; attribution?: string; }
export interface CompassProviderContext { query: CompassQueryPlan; filters: CompassFilters; cursor?: string; signal: AbortSignal; apiKey?: string; email?: string; }
export interface CompassProviderAdapter { readonly id: CompassProviderId; readonly attribution: string; search(context: CompassProviderContext): Promise<CompassProviderPage>; }

export interface CompassSnapshot { searchId: string | null; query: string; filters: CompassFilters; providerCursors: Partial<Record<CompassProviderId, string>>; selectedCanonicalKeys: string[]; scrollAnchor?: { key: string; offset: number }; }

export const COMPASS_PROVIDERS: readonly CompassProviderId[] = ['openalex', 'crossref', 'openaire', 'semanticscholar', 'hal', 'doab', 'oapen', 'dialnet', 'openedition', 'scielo', 'unpaywall', 'opencitations'];
export const COMPASS_MAX_RESULTS_PER_PAGE = 25;
export const COMPASS_MAX_QUERY_LENGTH = 2_000;
export const COMPASS_MAX_SELECTED_KEYS = 10_000;
