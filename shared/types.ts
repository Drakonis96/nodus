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
  | 'variant_of'
  | 'refines'
  | 'contains';

export type EdgeBasis = 'explicit' | 'inferred';
export type EvidenceKind = 'explicit' | 'paraphrased';

export type LightStatus = 'none' | 'pending' | 'done' | 'failed';
export type DeepStatus = 'none' | 'pending' | 'done' | 'failed' | 'skipped_no_text';
export type SummaryStatus = 'none' | 'pending' | 'done' | 'failed' | 'skipped_no_text';
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
  summary_status: SummaryStatus;
  summary_at: string | null;
  summary_hash: string | null;
  archived: number; // 0|1
  notes: string | null;
}

/** Work with parsed authors + theme labels, as the renderer prefers it. */
export interface WorkView extends Omit<Work, 'authors_json'> {
  authors: string[];
  themes: string[];
  zoteroTags: string[];
}

/** One work inside a duplicate group, with enough metadata to choose a canonical. */
export interface DuplicateWorkMember {
  nodus_id: string;
  zotero_key: string | null;
  title: string;
  authors: string[];
  year: number | null;
  doi: string | null;
  light_status: LightStatus;
  deep_status: DeepStatus;
  /** How many ideas this work develops — a proxy for how much analysis it holds. */
  ideaCount: number;
  /** True for the richest member; pre-selected as the one to keep on merge. */
  suggestedCanonical: boolean;
}

/** A set of works that look like the same work, grouped for review-and-merge. */
export interface DuplicateWorkGroup {
  /** Why they were grouped: identical DOI, or identical title + year + authors. */
  reason: 'doi' | 'metadata';
  /** Stable group key, used as a React key in the review modal. */
  key: string;
  members: DuplicateWorkMember[];
}

/** A non-citable orientation summary derived from already extracted material. */
export interface WorkSummary {
  nodus_id: string;
  summary: string;
  source_level: 'deep' | 'light';
  created_at: string;
  updated_at: string;
}

/** A Zotero tag available in the local library, with its current work count. */
export interface ZoteroTag {
  label: string;
  workCount: number;
}

export interface Theme {
  theme_id: string;
  label: string;
  created_at: string;
  pinned?: number; // 0|1 — user-curated "main theme", protected from auto-pruning
}

/** A theme as shown in the "Temas principales" manager: label + usage counts + curated flag. */
export interface ManagedTheme {
  theme_id: string;
  label: string;
  created_at: string;
  pinned: boolean;
  work_count: number;
  idea_count: number;
}

/** Options for the graph-level reprocess of already-extracted ideas. */
export interface ReprocessConnectionsOptions {
  /** Also re-trace idea↔idea relations (stored as inferred edges) in addition to idea↔theme. */
  relations: boolean;
}

/** Progress event emitted during reprocessConnections. */
export interface ReprocessProgress {
  /** Current phase: 'themes' (idea→theme assignment) or 'relations' (idea↔idea). */
  phase: 'themes' | 'relations';
  /** Human-readable label for the current phase. */
  label: string;
  /** Batch index within the current phase (1-based). */
  current: number;
  /** Total batches in the current phase. */
  total: number;
}

export interface ReprocessConnectionsResult {
  /** Ideas considered (those occurring in at least one non-archived work). */
  ideas: number;
  /** How many of those ideas ended up assigned to at least one theme. */
  themedIdeas: number;
  /** New theme labels the model proposed (only possible when not locked). */
  newThemes: number;
  /** Inferred idea↔idea relations added (0 when the relations option is off). */
  relationsAdded: number;
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
export type EmbeddingProvider = Extract<AiProvider, 'openai' | 'openrouter' | 'gemini'>;
export type SyncMode = 'realtime' | 'manual';
export type ThemeMode = 'dark' | 'light';
export type DeepContextMode = 'standard' | 'long';
/** Languages Nodus can speak. `uiLanguage` localizes the interface; `promptLanguage`
 *  is injected into the AI prompts and so determines the language of generated content
 *  (ideas, themes, tutor narrative, drafts, assistant answers). */
export type AppLanguage = 'es' | 'en';

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
  embeddingProvider: EmbeddingProvider;
  embeddingModel: string;
  // Per-provider key presence (the keys themselves never cross IPC).
  providerKeys: Record<AiProvider, boolean>;
  // Favorite models the user pinned, and the one used by default for scans.
  favorites: ModelRef[];
  defaultModel: ModelRef | null;
  extractionModel: ModelRef | null;
  // Synthesis/tutor: long-form answers (research assistant, tutor narrative).
  synthesisModel: ModelRef | null;
  // Short orientation summaries of individual works. Falls back to synthesisModel.
  summaryModel: ModelRef | null;
  // Fusion: the many small dedup/relate calls during deep scan. Kept separate from
  // synthesisModel so a fast model can be used here without slowing long-form output.
  // Falls back to synthesisModel when unset.
  fusionModel: ModelRef | null;
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
  // Interface language (localizes all UI text).
  uiLanguage: AppLanguage;
  // Language injected into AI prompts → language of generated ideas/themes/answers.
  promptLanguage: AppLanguage;
  animationSpeed: number; // 0..1
  concurrency: number;
  unpaywallEmail: string;
  onboardingComplete: boolean;
  // First-run usage tour (distinct from the setup onboarding above).
  tourComplete: boolean;
  // Advanced research-workflow walkthrough. Opt-in (never auto-shown): defaults
  // to true so it only appears when the researcher launches it from Settings.
  advancedTourComplete: boolean;
  // Large-PDF / extraction strategy
  preferZoteroFulltext: boolean;
  ocrEnabled: boolean;
  ocrLanguages: string;
  ocrMaxPages: number;
  // Deep scan chunking strategy. Standard preserves the legacy chunk size.
  deepContextMode: DeepContextMode;
  deepStandardChunkWords: number;
  deepLongChunkWords: number;
  // When true, light/deep scans only assign works to the existing curated themes and
  // never invent new ones. Toggled from the "Temas principales" manager.
  themesLocked: boolean;
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

export type QueueKind = 'light' | 'deep' | 'summary' | 'bridge';
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
  /** When the underlying research object entered Nodus; drives graph history playback. */
  createdAt?: string | null;
  statement?: string;
  workCount: number;
  workIds?: string[];
  read: boolean; // true when every linked work has the user's read tag
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
  trace?: EdgeTrace | null;
}

export interface EdgeTrace {
  edgeId: string;
  method: 'deep' | 'fusion' | 'bridge' | 'reprocess' | string;
  model: ModelRef | null;
  embeddingProvider: string | null;
  embeddingModel: string | null;
  similarity: number | null;
  rationale: string | null;
  createdAt: string;
}

export interface GapAggregate {
  kind: GapKind;
  statement: string;
  count: number;
  works: { nodus_id: string; title: string; zotero_key: string }[];
}

export interface GapDetail {
  gap: Gap;
  work: {
    nodus_id: string;
    title: string;
    zotero_key: string;
    authors: string[];
    year: number | null;
    item_type: string;
  };
  relatedIdea: Pick<Idea, 'global_id' | 'type' | 'label' | 'statement'> | null;
  evidence: Evidence | null;
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
  summaryStatus: SummaryStatus;
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
  /** Orientation only; it must not be treated as evidence or a citation. */
  orientationSummary: string | null;
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
  summaries: number;
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
// Tutor mode — AI-guided, step-by-step walkthrough of the idea graph
// ─────────────────────────────────────────────────────────────────────────────

export type TutorMode = 'overview' | 'prompt';

/** What a tour stop is anchored to in the graph. */
export type TutorStopKind = 'theme' | 'idea' | 'connection';

export interface TutorStop {
  id: string;
  kind: TutorStopKind;
  title: string;
  /** One line: why we pause here / what to notice. */
  focus: string;
  /** Graph node ids to spotlight: an idea `global_id` or `theme:<id>`. A connection lists both endpoints. */
  nodeIds: string[];
  /** Edge id when the stop is a connection between two ideas. */
  edgeId: string | null;
}

export interface TutorRoute {
  id: string;
  title: string;
  description: string;
  /** 1..5 — relative weight/centrality of this route in the corpus. */
  weight: number;
  /** Short human label for the weight, e.g. "línea principal". */
  weightLabel: string;
  themes: string[];
  stops: TutorStop[];
}

export interface TutorPlan {
  generatedAt: string;
  mode: TutorMode;
  prompt: string;
  /** Map-level welcome that mentions everything important before the routes. */
  overview: string;
  totalThemes: number;
  totalIdeas: number;
  totalConnections: number;
  /** Distinct idea nodes referenced by at least one route stop. */
  coveredIdeas: number;
  routes: TutorRoute[];
  /** True when the graph was too large to send whole (some nodes/edges omitted). */
  truncated: boolean;
}

export interface TutorSavedRoute {
  id: string;
  planId: string;
  generatedAt: string;
  updatedAt: string;
  lastPlayedAt: string | null;
  mode: TutorMode;
  prompt: string;
  model: ModelRef | null;
  overview: string;
  totalThemes: number;
  totalIdeas: number;
  totalConnections: number;
  route: TutorRoute;
  rating: number | null;
}

export interface TutorPlanRequest {
  mode: TutorMode;
  prompt?: string;
  model?: ModelRef | null;
}

export interface TutorStepRequest {
  /** The route being toured (sent on each call so the backend stays stateless). */
  route: TutorRoute;
  stopIndex: number;
  overview: string;
  /** Titles of stops already visited, for narrative continuity. */
  history: string[];
  /** Tail of the immediately previous stop's narration, so the discourse continues without repeating. */
  previousText?: string;
  model?: ModelRef | null;
}

export interface TutorStepResponse {
  explanation: string;
}

export interface TutorStepStreamHandlers {
  onDelta(delta: string): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Argument map (AI-traced hierarchical block outline around a seed idea)
// ─────────────────────────────────────────────────────────────────────────────

/** One block in the argument map tree. Synthetic ids are assigned by the backend. */
export interface ArgumentBlock {
  id: string;
  /** global_id of the underlying idea, or null for a synthetic framing block. */
  ideaId: string | null;
  label: string;
  statement: string;
  type: IdeaType | 'framing';
  /** One-line gloss from the model explaining this block's role. */
  summary: string;
  /** How this block relates to its parent (a real edge type, or 'root'/'framing'). */
  relation: EdgeType | 'root' | 'framing' | 'related';
  children: ArgumentBlock[];
}

export interface ArgumentMap {
  seedIdeaId: string;
  seedLabel: string;
  overview: string;
  root: ArgumentBlock;
  generatedAt: string;
  /** True when the local subgraph sent to the model was capped. */
  truncated: boolean;
  ideaCount: number;
}

export interface ArgumentMapRequest {
  seedIdeaId: string;
  model?: ModelRef | null;
  /** 'ai' traces the tree with the model; 'auto' builds it structurally from the
   *  real graph edges (no model needed). Defaults to 'ai'. */
  mode?: 'ai' | 'auto';
}

/** A ranked seed candidate for the automatic argument-map mode. */
export interface ArgumentRouteSuggestion {
  ideaId: string;
  label: string;
  statement: string;
  type: IdeaType;
  /** Number of idea↔idea connections. */
  degree: number;
  /** Connections that are contradictions or refutations (debate hubs surface higher). */
  debateCount: number;
  /** Average confidence across the idea's connections. */
  avgConfidence: number;
  /** Relation-type breakdown, most frequent first. */
  topRelations: { type: EdgeType; count: number }[];
  /** Up to a few neighbour labels, for a quick preview of the route. */
  neighborLabels: string[];
}


// ─────────────────────────────────────────────────────────────────────────────
// Research chat history (persisted conversations)
// ─────────────────────────────────────────────────────────────────────────────

/** One persisted chat message. `stats`/`selectionKey`/`error` mirror the in-memory UI message. */
export interface ChatMessageRecord {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  selectionKey?: string | null;
  stats?: ResearchContextStats | null;
  error?: boolean;
}

/** Conversation list entry (no messages) for the history sidebar. */
export interface ChatConversationSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  archived: boolean;
  model: ModelRef | null;
  messageCount: number;
}

/** A full conversation with its messages and the context selection it was using. */
export interface ChatConversation extends ChatConversationSummary {
  selection: ResearchContextSelection | null;
  messages: ChatMessageRecord[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Writing workshop
// ─────────────────────────────────────────────────────────────────────────────

export type WritingWorkshopKind =
  | 'literature_review'
  | 'theoretical_framework'
  | 'debate'
  | 'gap_justification'
  | 'chapter_section'
  | 'research_question';

export interface WritingWorkshopBrief {
  kind: WritingWorkshopKind;
  objective: string;
  audience?: string;
  tone?: 'academic' | 'synthetic' | 'critical' | 'exploratory';
  language?: 'es' | 'en' | 'fr';
}

export interface WritingWorkshopSelection {
  ideaIds: string[];
  themeIds: string[];
  gapIds: string[];
  contradictionIds: string[];
  workIds: string[];
  tutorRouteIds: string[];
}

export interface WritingWorkshopCandidateBase {
  id: string;
  label: string;
  summary: string;
  score: number;
  reason: string;
}

export interface WritingWorkshopIdeaCandidate extends WritingWorkshopCandidateBase {
  type: IdeaType;
  statement: string;
  themes: string[];
  workCount: number;
  evidenceCount: number;
  works: { nodus_id: string; title: string; authors: string[]; year: number | null; zotero_key: string }[];
}

export interface WritingWorkshopThemeCandidate extends WritingWorkshopCandidateBase {
  workCount: number;
  ideaCount: number;
  pinned: boolean;
}

export interface WritingWorkshopGapCandidate extends WritingWorkshopCandidateBase {
  kind: GapKind;
  work: { nodus_id: string; title: string; authors: string[]; year: number | null; zotero_key: string };
  relatedIdea: string | null;
  confidence: number;
}

export interface WritingWorkshopContradictionCandidate extends WritingWorkshopCandidateBase {
  fromLabel: string;
  toLabel: string;
  type: EdgeType | string;
  basis: EdgeBasis;
  confidence: number;
}

export interface WritingWorkshopWorkCandidate extends WritingWorkshopCandidateBase {
  title: string;
  authors: string[];
  year: number | null;
  zotero_key: string;
  themes: string[];
  deepStatus: DeepStatus;
  /** Orientation only; never evidence or a citation target. */
  orientationSummary?: string | null;
  ideaCount: number;
  gapCount: number;
}

export interface WritingWorkshopRouteCandidate extends WritingWorkshopCandidateBase {
  routeTitle: string;
  mode: TutorMode;
  prompt: string;
  themes: string[];
  stops: number;
  rating: number | null;
}

export interface WritingWorkshopSnapshot {
  generatedAt: string;
  brief: WritingWorkshopBrief;
  stats: {
    ideas: number;
    themes: number;
    gaps: number;
    contradictions: number;
    works: number;
    tutorRoutes: number;
  };
  recommendedSelection: WritingWorkshopSelection;
  ideas: WritingWorkshopIdeaCandidate[];
  themes: WritingWorkshopThemeCandidate[];
  gaps: WritingWorkshopGapCandidate[];
  contradictions: WritingWorkshopContradictionCandidate[];
  works: WritingWorkshopWorkCandidate[];
  tutorRoutes: WritingWorkshopRouteCandidate[];
}

export interface WritingWorkshopSection {
  id: string;
  title: string;
  purpose: string;
  keyClaims: string[];
  sources: string[];
}

export interface WritingWorkshopMatrixRow {
  claim: string;
  role: 'support' | 'contrast' | 'gap' | 'method' | 'definition' | 'context';
  sourceLabel: string;
  citation: string;
  evidence: string;
  notes: string;
}

export interface WritingWorkshopDraft {
  generatedAt: string;
  brief: WritingWorkshopBrief;
  selection: WritingWorkshopSelection;
  title: string;
  abstract: string;
  outline: WritingWorkshopSection[];
  draftMarkdown: string;
  matrix: WritingWorkshopMatrixRow[];
  bibliography: string[];
  nextSteps: string[];
  limitations: string[];
  stats: {
    selectedIdeas: number;
    selectedThemes: number;
    selectedGaps: number;
    selectedContradictions: number;
    selectedWorks: number;
    selectedTutorRoutes: number;
    contextChars: number;
    truncated: boolean;
  };
}

export interface WritingWorkshopDraftRequest {
  brief: WritingWorkshopBrief;
  selection: WritingWorkshopSelection;
  model?: ModelRef | null;
}

export interface WritingWorkshopExportRequest {
  draft: WritingWorkshopDraft;
}

export interface WritingWorkshopStreamHandlers {
  onDelta(delta: string): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Updates
// ─────────────────────────────────────────────────────────────────────────────

export type UpdateCheckStatus =
  | 'disabled'
  | 'checking'
  | 'not-available'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error';

export interface UpdateCheckResponse {
  status: UpdateCheckStatus;
  message: string;
  version?: string;
  progress?: number | null;
  bytesPerSecond?: number | null;
  transferred?: number | null;
  total?: number | null;
}

export interface UpdateProgressEvent extends UpdateCheckResponse {
  at: string;
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
  listEmbeddingModels(provider: EmbeddingProvider): Promise<ModelInfo[]>;

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
  listZoteroTags(): Promise<ZoteroTag[]>;
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
  summarizeWork(nodusId: string, model?: ModelRef | null): Promise<void>;
  summarizeBulk(nodusIds: string[], model?: ModelRef | null): Promise<void>;
  summarizeAll(model?: ModelRef | null): Promise<void>;
  getWorkSummary(nodusId: string): Promise<WorkSummary | null>;
  /** Groups of works that look like the same work (same DOI, or same title+year+authors). */
  listDuplicateWorks(): Promise<DuplicateWorkGroup[]>;
  /** Merge duplicate works into the chosen canonical, re-pointing all derived data. */
  mergeWorks(canonicalId: string, duplicateIds: string[]): Promise<{ merged: number }>;
  /** Live bibliographic metadata for a work (journal/book, pages, publisher, …). */
  getWorkMeta(nodusId: string): Promise<WorkMeta | null>;
  openInZotero(zoteroKey: string): Promise<void>;
  /** Open an http(s)/mailto link in the user's default browser (used by rendered Markdown). */
  openExternal(url: string): Promise<void>;
  uploadText(nodusId: string, filePath: string): Promise<void>;

  // sync
  syncNow(): Promise<SyncLogEntry>;
  getSyncLog(): Promise<SyncLogEntry[]>;

  // queue
  getQueue(): Promise<QueueProgress>;
  pauseQueue(): Promise<void>;
  resumeQueue(): Promise<void>;
  cancelQueueItem(id: string): Promise<void>;
  removeQueueItem(id: string): Promise<void>;
  moveQueueItemToTop(id: string): Promise<void>;
  clearQueue(): Promise<void>;
  stopQueue(): Promise<void>;
  retryFailed(): Promise<void>;
  /** Enqueue a semantic bridge discovery job into the scan queue. */
  enqueueBridgeDiscovery(model?: ModelRef | null): Promise<void>;
  onQueueProgress(cb: (p: QueueProgress) => void): () => void;

  // graph
  getGraph(lens: 'ideas' | 'authors'): Promise<GraphData>;
  getIdeaDetail(globalId: string): Promise<IdeaDetail | null>;
  getEdgeDetail(edgeId: string): Promise<EdgeDetail | null>;
  getThemes(): Promise<Theme[]>;

  // main-theme management ("temas principales")
  listManagedThemes(): Promise<ManagedTheme[]>;
  addManualTheme(label: string): Promise<ManagedTheme[]>;
  renameTheme(themeId: string, label: string): Promise<ManagedTheme[]>;
  setThemePinned(themeId: string, pinned: boolean): Promise<ManagedTheme[]>;
  deleteTheme(themeId: string): Promise<ManagedTheme[]>;
  /**
   * Re-group the already-extracted ideas under the curated/existing themes using the
   * model (no document re-reading). Optionally also re-traces idea↔idea relations.
   */
  reprocessThemeConnections(
    options: ReprocessConnectionsOptions,
    model?: ModelRef | null,
    onProgress?: (p: ReprocessProgress) => void
  ): Promise<ReprocessConnectionsResult>;

  // gaps + reading path
  getGaps(): Promise<GapAggregate[]>;
  getGapDetail(gapId: string): Promise<GapDetail | null>;
  getContradictions(): Promise<EdgeDetail[]>;
  getReadingPath(request?: ReadingPathRequest): Promise<ReadingPathPlan>;

  // research assistant
  researchChat(request: ResearchChatRequest): Promise<ResearchChatResponse>;
  researchChatStream(request: ResearchChatRequest, handlers: ResearchChatStreamHandlers): Promise<ResearchChatResponse>;

  // writing workshop
  getWritingWorkshopSnapshot(brief: WritingWorkshopBrief): Promise<WritingWorkshopSnapshot>;
  generateWritingWorkshopDraft(request: WritingWorkshopDraftRequest): Promise<WritingWorkshopDraft>;
  exportWritingWorkshopDraft(request: WritingWorkshopExportRequest): Promise<{ path: string } | null>;

  // tutor mode (AI-guided graph walkthrough)
  /** Analyse the whole idea graph and propose weighted guided routes (overview or prompt-driven). */
  tutorPlan(request: TutorPlanRequest): Promise<TutorPlan>;
  listTutorRoutes(): Promise<TutorSavedRoute[]>;
  /** Save a completed route with the user's required 1–5 rating. */
  saveTutorRoute(plan: TutorPlan, route: TutorRoute, model: ModelRef | null, rating: number): Promise<TutorSavedRoute | null>;
  rateTutorRoute(routeId: string, rating: number | null): Promise<TutorSavedRoute | null>;
  markTutorRoutePlayed(routeId: string): Promise<TutorSavedRoute | null>;
  deleteTutorRoute(routeId: string): Promise<void>;
  /** Narrate one stop of a route, grounded in that node's ideas/evidence. */
  tutorStep(request: TutorStepRequest): Promise<TutorStepResponse>;
  tutorStepStream(request: TutorStepRequest, handlers: TutorStepStreamHandlers): Promise<TutorStepResponse>;

  // argument map (AI-traced hierarchical outline around a seed idea)
  /** Trace a hierarchical block outline of the ideas connected to a seed idea. */
  buildArgumentMap(request: ArgumentMapRequest): Promise<ArgumentMap>;
  /** Rank idea hubs by connectivity for the automatic mode (no AI, no model). */
  discoverArgumentRoutes(): Promise<ArgumentRouteSuggestion[]>;

  // research chat history
  listConversations(includeArchived?: boolean): Promise<ChatConversationSummary[]>;
  getConversation(id: string): Promise<ChatConversation | null>;
  createConversation(input: {
    model?: ModelRef | null;
    selection?: ResearchContextSelection | null;
  }): Promise<ChatConversation>;
  saveConversationMessages(
    id: string,
    messages: ChatMessageRecord[],
    meta?: { model?: ModelRef | null; selection?: ResearchContextSelection | null }
  ): Promise<void>;
  /** Ask the model for a short title from the conversation so far; persists + returns it. */
  generateConversationTitle(id: string, model?: ModelRef | null): Promise<string>;
  renameConversation(id: string, title: string): Promise<void>;
  archiveConversation(id: string, archived: boolean): Promise<void>;
  deleteConversation(id: string): Promise<void>;

  // export / import
  exportData(): Promise<{ path: string; password: string } | null>;
  importData(password: string): Promise<{ ok: boolean; message: string }>;
  /** Wipe all derived graph data (ideas, themes, edges, authors, gaps) and reset scan
   *  status on every work. The library and settings are kept. */
  resetGraph(): Promise<void>;

  // embedding pipeline
  /** Start embedding generation for the given works (or all deep-scanned works if empty). */
  startEmbedding(nodusIds?: string[]): Promise<void>;
  /** Clear all existing embeddings and regenerate from scratch. */
  reindexAll(): Promise<void>;
  pauseEmbedding(): Promise<void>;
  resumeEmbedding(): Promise<void>;
  stopEmbedding(): Promise<void>;
  /** Hide a completed/stopped embedding queue without deleting generated embeddings. */
  clearEmbeddingProgress(): Promise<void>;
  getEmbeddingStatus(): Promise<EmbeddingPipelineProgress>;
  /** Per-work embedding counts for the library table. */
  getWorkEmbeddingStatuses(nodusIds?: string[]): Promise<WorkEmbeddingStatus[]>;
  onEmbeddingProgress(cb: (p: EmbeddingPipelineProgress) => void): () => void;

  // semantic bridge discovery
  discoverSemanticBridges(model?: ModelRef | null): Promise<SemanticBridgeResult>;
  isSemanticBridgeRunning(): Promise<boolean>;
  onSemanticBridgeProgress(cb: (p: SemanticBridgeProgress) => void): () => void;

  // app updates
  checkForUpdates(): Promise<UpdateCheckResponse>;
  installUpdate(): Promise<UpdateCheckResponse>;
  onUpdateProgress(cb: (event: UpdateProgressEvent) => void): () => void;
}

export interface WorkFilter {
  search?: string;
  lightStatus?: LightStatus | 'all';
  deepStatus?: DeepStatus | 'all';
  summaryStatus?: SummaryStatus | 'all';
  theme?: string;
  /** Zotero tags to match. Multiple tags can use any-match (default) or all-match. */
  zoteroTags?: string[];
  zoteroTagMode?: 'any' | 'all';
  yearMin?: number;
  yearMax?: number;
  includeArchived?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Embedding pipeline
// ─────────────────────────────────────────────────────────────────────────────

export interface EmbeddingPipelineProgress {
  running: boolean;
  paused: boolean;
  /** Index of the work currently being processed (0-based). */
  currentWorkIndex: number;
  /** Total works queued for embedding. */
  totalWorks: number;
  /** Title of the work currently being processed. */
  currentWorkTitle: string | null;
  /** Number of ideas embedded so far across all works. */
  ideasEmbedded: number;
  /** Total ideas to embed across all works. */
  totalIdeas: number;
  /** Index of the idea being processed within the current work (0-based). */
  currentIdeaIndex: number;
  /** Total ideas in the current work. */
  currentWorkIdeas: number;
  /** Error message if the pipeline stopped on error. */
  error: string | null;
}

/** Per-work embedding status for display in the library table. */
export interface WorkEmbeddingStatus {
  nodus_id: string;
  totalIdeas: number;
  embeddedIdeas: number;
  /** true if all ideas have embeddings. */
  complete: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Semantic bridge discovery
// ─────────────────────────────────────────────────────────────────────────────

export interface SemanticBridgeProgress {
  phase: 'scan' | 'validation' | 'done';
  label: string;
  current: number;
  total: number;
  candidatesFound: number;
  bridgesAdded: number;
}

export interface SemanticBridgeResult {
  candidatesScanned: number;
  crossThemeCandidates: number;
  validated: number;
  added: number;
}
