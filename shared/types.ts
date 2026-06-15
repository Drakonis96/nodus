// Shared domain types used by both the Electron main process and the React renderer.
// Keep this file free of any runtime imports from either side.

export type IdeaType = 'claim' | 'finding' | 'construct' | 'method' | 'framework';
export type GraphNodeType = IdeaType | 'theme' | 'author';

export type EdgeType =
  | 'extends'
  | 'contradicts'
  | 'applies_to'
  | 'shares_method'
  | 'precondition_of'
  | 'measures_same'
  | 'supports'
  | 'refutes'
  | 'contains';

export type EdgeBasis = 'explicit' | 'inferred';
export type EvidenceKind = 'explicit' | 'paraphrased';

export type LightStatus = 'none' | 'pending' | 'done' | 'failed';
export type DeepStatus = 'none' | 'pending' | 'done' | 'failed' | 'skipped_no_text';
export type DeepTrigger = 'tag' | 'manual' | 'both' | null;
export type SourceType = 'pdf' | 'markdown' | 'upload' | 'abstract_only' | 'none';

export type GapKind =
  | 'future_work'
  | 'limitation'
  | 'open_question'
  | 'unresolved_contradiction';

export interface Work {
  nodus_id: string;
  zotero_key: string;
  zotero_version: number | null;
  title: string;
  authors_json: string; // JSON-encoded string[]
  year: number | null;
  item_type: string;
  doi: string | null;
  read_tag: number; // 0|1
  manual_deep: number; // 0|1
  deep_trigger: DeepTrigger;
  source_type: SourceType | null;
  light_status: LightStatus;
  light_at: string | null;
  light_hash: string | null;
  deep_status: DeepStatus;
  deep_at: string | null;
  deep_hash: string | null;
  archived: number; // 0|1
  notes: string | null;
}

/** Work with parsed authors + theme labels, as the renderer prefers it. */
export interface WorkView extends Omit<Work, 'authors_json'> {
  authors: string[];
  themes: string[];
}

export interface Theme {
  theme_id: string;
  label: string;
  created_at: string;
}

export interface Idea {
  global_id: string;
  type: IdeaType;
  label: string;
  statement: string;
  embedding?: number[] | null;
  created_at: string;
}

export interface IdeaOccurrence {
  global_id: string;
  nodus_id: string;
  role: 'principal' | 'secondary';
  development: string;
  confidence: number;
}

export interface Evidence {
  id: string;
  global_id: string;
  nodus_id: string;
  quote: string;
  location: string | null;
  kind: EvidenceKind;
}

export interface Edge {
  id: string;
  from_id: string;
  to_id: string;
  type: EdgeType;
  basis: EdgeBasis;
  confidence: number;
  source_work: string | null;
}

export interface Author {
  author_id: string;
  name: string;
  affiliation: string | null;
}

export interface AuthorRelation {
  from_author: string;
  to_author: string;
  type: string;
  weight: number;
}

export interface Gap {
  id: string;
  nodus_id: string;
  related_idea: string | null;
  kind: GapKind;
  statement: string;
  confidence: number;
  evidence_id: string | null;
}

export interface ExternalRef {
  id: string;
  nodus_id: string;
  from_idea: string;
  cited_work: string;
  type: EdgeType;
  basis: EdgeBasis;
  confidence: number;
  evidence_id: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────────────────────

export type AiProvider = 'anthropic' | 'openai' | 'openrouter' | 'deepseek' | 'gemini';
export type SyncMode = 'realtime' | 'manual';
export type ThemeMode = 'dark' | 'light';
export type DeepContextMode = 'standard' | 'long';

/** A concrete model selection: which provider + which model id. */
export interface ModelRef {
  provider: AiProvider;
  model: string;
}

/** One model as returned by a provider's model-list endpoint. */
export interface ModelInfo {
  id: string;
  name?: string;
  /** For OpenRouter: the upstream provider segment of the id (e.g. "anthropic"). */
  group?: string;
}

export interface AppSettings {
  embeddingModel: string;
  // Per-provider key presence (the keys themselves never cross IPC).
  providerKeys: Record<AiProvider, boolean>;
  // Favorite models the user pinned, and the one used by default for scans.
  favorites: ModelRef[];
  defaultModel: ModelRef | null;
  extractionModel: ModelRef | null;
  synthesisModel: ModelRef | null;
  syncMode: SyncMode;
  readTag: string; // Zotero tag that can be used by the opt-in deep-scan automation.
  // All automatic analysis is opt-in. Manual sync can ingest Zotero metadata without spending tokens.
  autoLightScan: boolean;
  autoDeepScanOnReadTag: boolean;
  autoResumeQueue: boolean;
  zoteroUserId: string;
  zoteroStoragePath: string;
  monitoredCollections: string[]; // collection keys
  theme: ThemeMode;
  animationSpeed: number; // 0..1
  concurrency: number;
  unpaywallEmail: string;
  onboardingComplete: boolean;
  // First-run usage tour (distinct from the setup onboarding above).
  tourComplete: boolean;
  // Large-PDF / extraction strategy
  preferZoteroFulltext: boolean;
  ocrEnabled: boolean;
  ocrLanguages: string;
  ocrMaxPages: number;
  // Deep scan chunking strategy. Standard preserves the legacy chunk size.
  deepContextMode: DeepContextMode;
  deepStandardChunkWords: number;
  deepLongChunkWords: number;
}

export type ExtractStrategy = 'zotero_fulltext' | 'digital' | 'hybrid' | 'scanned' | 'empty';

export interface PdfAnalysis {
  pageCount: number;
  sampledPages: number;
  textPages: number;
  textCoverage: number; // 0..1 ratio of sampled pages with a usable text layer
  avgCharsPerTextPage: number;
  strategy: ExtractStrategy;
}

// ─────────────────────────────────────────────────────────────────────────────
// Zotero
// ─────────────────────────────────────────────────────────────────────────────

export interface ZoteroCollection {
  key: string;
  name: string;
  parentCollection: string | false;
  itemCount: number; // direct items only (Zotero meta.numItems)
  subCount: number; // number of subcollections (Zotero meta.numCollections)
}

/** Rich bibliographic metadata for one work, read live from Zotero for the detail panel. */
export interface WorkMeta {
  itemType: string;
  authors: string[];
  year: number | null;
  container: string | null; // journal / book / proceedings the item appears in
  publisher: string | null;
  pages: string | null; // page range, e.g. "12-34"
  numPages: number | null;
  volume: string | null;
  issue: string | null;
  edition: string | null;
  place: string | null;
  doi: string | null;
  url: string | null;
  language: string | null;
}

export interface ZoteroItem {
  key: string;
  version: number;
  title: string;
  creators: { lastName: string; firstName?: string; name?: string }[];
  year: number | null;
  itemType: string;
  doi: string | null;
  abstract: string | null;
  tags: string[];
  collections: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Queue / pipeline
// ─────────────────────────────────────────────────────────────────────────────

export type QueueKind = 'light' | 'deep';
export type QueueState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'paused';

export interface QueueItem {
  id: string;
  nodus_id: string;
  title: string;
  kind: QueueKind;
  state: QueueState;
  error: string | null;
  enqueued_at: string;
  /** Sub-step detail for the running item, e.g. "OCR p. 12/340" or "Extrayendo p. 8/22". */
  detail?: string | null;
  /** 0..1 progress within the current item (extraction/OCR), when known. */
  subPct?: number | null;
  /** Optional model override for this job; falls back to the default model when null. */
  model?: ModelRef | null;
}

export interface QueueProgress {
  paused: boolean;
  /** When the queue auto-paused on a misconfiguration (no model / invalid key), why. */
  pausedReason: string | null;
  total: number;
  done: number;
  failed: number;
  current: { title: string; kind: QueueKind } | null;
  items: QueueItem[];
}

export interface SyncLogEntry {
  id: number;
  at: string;
  mode: string;
  summary: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Graph payloads (renderer consumes these directly)
// ─────────────────────────────────────────────────────────────────────────────

export interface GraphNode {
  id: string; // global_id (idea) or author_id (author lens)
  label: string;
  type: GraphNodeType;
  statement?: string;
  workCount: number;
  read: boolean; // true if any developing work is deep-scanned
  themes: string[];
  years: number[];
  authors: string[];
  maxConfidence: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType | string;
  basis: EdgeBasis;
  confidence: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface IdeaDetail {
  idea: Idea;
  occurrences: (IdeaOccurrence & { work: WorkView })[];
  evidence: Evidence[];
}

export interface EdgeDetail {
  edge: Edge;
  fromLabel: string;
  toLabel: string;
  explanation?: string | null;
  evidence: Evidence[];
}

export interface GapAggregate {
  kind: GapKind;
  statement: string;
  count: number;
  works: { nodus_id: string; title: string; zotero_key: string }[];
}

export type ReadingPathStrategy =
  | 'research_relevance'
  | 'gaps'
  | 'foundational'
  | 'recent'
  | 'connected_authors'
  | 'bridges';

export interface ReadingPathRequest {
  strategy?: ReadingPathStrategy;
  researchBrief?: string;
  limit?: number;
  includeRead?: boolean;
}

export interface ReadingAnalysisStatus {
  lightStatus: LightStatus;
  deepStatus: DeepStatus;
  hasThemes: boolean;
  hasIdeas: boolean;
  hasContradictions: boolean;
  hasGaps: boolean;
  hasExternalRefs: boolean;
  themeCount: number;
  ideaCount: number;
  relationCount: number;
  contradictionCount: number;
  gapCount: number;
  externalRefCount: number;
}

export interface ReadingPathEntry {
  nodus_id: string;
  title: string;
  authors: string[];
  year: number | null;
  themes: string[];
  readTag: boolean;
  read: boolean;
  analysis: ReadingAnalysisStatus;
  score: number;
  priority: number;
  phase: string;
  strategyScore: number;
  gapScore: number;
  foundationalScore: number;
  recencyScore: number;
  authorConnectivityScore: number;
  bridgeScore: number;
  interestScore: number;
  diversityKey: string | null;
  relatedGaps: string[];
  relatedIdeas: string[];
  connectedAuthors: string[];
  reason: string;
}

export interface ReadingPathPhase {
  id: string;
  title: string;
  objective: string;
  entries: ReadingPathEntry[];
  totalCandidates: number;
  omitted: number;
}

export interface ReadingPathPlan {
  strategy: ReadingPathStrategy;
  researchBrief: string;
  generatedAt: string;
  totalWorks: number;
  shownWorks: number;
  readCount: number;
  unreadCount: number;
  analyzedCount: number;
  pendingAnalysisCount: number;
  summary: string;
  phases: ReadingPathPhase[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Research assistant
// ─────────────────────────────────────────────────────────────────────────────

export interface ResearchGraphPartsSelection {
  ideaNodes: boolean;
  themeNodes: boolean;
  ideaEdges: boolean;
  authorGraph: boolean;
}

export interface ResearchContextSelection {
  ideas: boolean;
  themes: boolean;
  contradictions: boolean;
  gaps: boolean;
  readingPath: boolean;
  authors: boolean;
  documents: boolean;
  graph: boolean;
  graphParts: ResearchGraphPartsSelection;
}

export interface ResearchChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ResearchChatRequest {
  messages: ResearchChatMessage[];
  selection: ResearchContextSelection;
  model?: ModelRef | null;
}

export interface ResearchContextStats {
  sections: string[];
  works: number;
  documents: number;
  contextChars: number;
  truncated: boolean;
}

export interface ResearchChatResponse {
  answer: string;
  stats: ResearchContextStats;
}

export interface ResearchChatStreamHandlers {
  onDelta(delta: string): void;
  onStats?(stats: ResearchContextStats): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// IPC API surface exposed on window.nodus via the preload bridge.
// ─────────────────────────────────────────────────────────────────────────────

export interface NodusApi {
  // settings + secrets
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  setApiKey(provider: AiProvider, key: string): Promise<void>;
  clearApiKey(provider: AiProvider): Promise<void>;

  // AI model discovery
  listModels(provider: AiProvider): Promise<ModelInfo[]>;

  // zotero
  zoteroPing(): Promise<{ ok: boolean; userId?: string; message?: string }>;
  zoteroCollections(): Promise<ZoteroCollection[]>;
  zoteroChildCollections(parentKey: string): Promise<ZoteroCollection[]>;
  zoteroCollectionItems(
    collectionKey: string,
    opts?: { query?: string; recursive?: boolean }
  ): Promise<ZoteroItem[]>;

  // works / library
  listWorks(filter?: WorkFilter): Promise<WorkView[]>;
  getWork(nodusId: string): Promise<WorkView | null>;
  ingestZoteroItems(items: ZoteroItem[]): Promise<WorkView[]>;
  setManualDeep(nodusId: string, value: boolean, model?: ModelRef | null): Promise<void>;
  setManualDeepBulk(nodusIds: string[], value: boolean, model?: ModelRef | null): Promise<void>;
  /** Analyse themes (light) and then ideas (deep) for one work, as two queue jobs. */
  analyzeBoth(nodusId: string, model?: ModelRef | null): Promise<void>;
  analyzeBothBulk(nodusIds: string[], model?: ModelRef | null): Promise<void>;
  /** Re-run the cheap theme scan over the whole library to backfill broad parent themes. */
  reassignThemes(model?: ModelRef | null): Promise<number>;
  rescan(nodusId: string, kind: QueueKind, model?: ModelRef | null): Promise<void>;
  /** Live bibliographic metadata for a work (journal/book, pages, publisher, …). */
  getWorkMeta(nodusId: string): Promise<WorkMeta | null>;
  openInZotero(zoteroKey: string): Promise<void>;
  uploadText(nodusId: string, filePath: string): Promise<void>;

  // sync
  syncNow(): Promise<SyncLogEntry>;
  getSyncLog(): Promise<SyncLogEntry[]>;

  // queue
  getQueue(): Promise<QueueProgress>;
  pauseQueue(): Promise<void>;
  resumeQueue(): Promise<void>;
  cancelQueueItem(id: string): Promise<void>;
  moveQueueItemToTop(id: string): Promise<void>;
  clearQueue(): Promise<void>;
  retryFailed(): Promise<void>;
  onQueueProgress(cb: (p: QueueProgress) => void): () => void;

  // graph
  getGraph(lens: 'ideas' | 'authors'): Promise<GraphData>;
  getIdeaDetail(globalId: string): Promise<IdeaDetail | null>;
  getEdgeDetail(edgeId: string): Promise<EdgeDetail | null>;
  getThemes(): Promise<Theme[]>;

  // gaps + reading path
  getGaps(): Promise<GapAggregate[]>;
  getContradictions(): Promise<EdgeDetail[]>;
  getReadingPath(request?: ReadingPathRequest): Promise<ReadingPathPlan>;

  // research assistant
  researchChat(request: ResearchChatRequest): Promise<ResearchChatResponse>;
  researchChatStream(request: ResearchChatRequest, handlers: ResearchChatStreamHandlers): Promise<ResearchChatResponse>;

  // export / import
  exportData(): Promise<{ path: string } | null>;
  importData(): Promise<{ ok: boolean; message: string }>;
  /** Wipe all derived graph data (ideas, themes, edges, authors, gaps) and reset scan
   *  status on every work. The library and settings are kept. */
  resetGraph(): Promise<void>;
}

export interface WorkFilter {
  search?: string;
  lightStatus?: LightStatus | 'all';
  deepStatus?: DeepStatus | 'all';
  theme?: string;
  yearMin?: number;
  yearMax?: number;
  includeArchived?: boolean;
}
