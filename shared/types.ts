// Shared domain types used by both the Electron main process and the React renderer.
// Keep this file free of any runtime imports from either side.

export type IdeaType = 'claim' | 'finding' | 'construct' | 'method' | 'framework';

export type EdgeType =
  | 'extends'
  | 'contradicts'
  | 'applies_to'
  | 'shares_method'
  | 'precondition_of'
  | 'measures_same'
  | 'supports'
  | 'refutes';

export type EdgeBasis = 'explicit' | 'inferred';
export type EvidenceKind = 'explicit' | 'paraphrased';

export type LightStatus = 'pending' | 'done' | 'failed';
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

export type AiProvider = 'anthropic' | 'openai';
export type SyncMode = 'realtime' | 'manual';
export type ThemeMode = 'dark' | 'light';

export interface AppSettings {
  aiProvider: AiProvider;
  aiModel: string;
  embeddingModel: string;
  hasApiKey: boolean; // never expose the key itself to the renderer
  syncMode: SyncMode;
  readTag: string; // tag that triggers deep scan
  zoteroUserId: string;
  zoteroStoragePath: string;
  monitoredCollections: string[]; // collection keys
  theme: ThemeMode;
  animationSpeed: number; // 0..1
  concurrency: number;
  unpaywallEmail: string;
  onboardingComplete: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Zotero
// ─────────────────────────────────────────────────────────────────────────────

export interface ZoteroCollection {
  key: string;
  name: string;
  parentCollection: string | false;
  itemCount: number;
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
}

export interface QueueProgress {
  paused: boolean;
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
  type: IdeaType | 'author';
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
  evidence: Evidence[];
}

export interface GapAggregate {
  kind: GapKind;
  statement: string;
  count: number;
  works: { nodus_id: string; title: string; zotero_key: string }[];
}

export interface ReadingPathEntry {
  nodus_id: string;
  title: string;
  authors: string[];
  year: number | null;
  themes: string[];
  read: boolean;
  score: number;
  reason: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// IPC API surface exposed on window.nodus via the preload bridge.
// ─────────────────────────────────────────────────────────────────────────────

export interface NodusApi {
  // settings + secrets
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  setApiKey(key: string): Promise<void>;
  clearApiKey(): Promise<void>;

  // zotero
  zoteroPing(): Promise<{ ok: boolean; userId?: string; message?: string }>;
  zoteroCollections(): Promise<ZoteroCollection[]>;
  zoteroChildCollections(parentKey: string): Promise<ZoteroCollection[]>;
  zoteroCollectionItems(
    collectionKey: string,
    opts?: { query?: string }
  ): Promise<ZoteroItem[]>;

  // works / library
  listWorks(filter?: WorkFilter): Promise<WorkView[]>;
  getWork(nodusId: string): Promise<WorkView | null>;
  setManualDeep(nodusId: string, value: boolean): Promise<void>;
  setManualDeepBulk(nodusIds: string[], value: boolean): Promise<void>;
  rescan(nodusId: string, kind: QueueKind): Promise<void>;
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
  clearQueue(): Promise<void>;
  onQueueProgress(cb: (p: QueueProgress) => void): () => void;

  // graph
  getGraph(lens: 'ideas' | 'authors'): Promise<GraphData>;
  getIdeaDetail(globalId: string): Promise<IdeaDetail | null>;
  getEdgeDetail(edgeId: string): Promise<EdgeDetail | null>;
  getThemes(): Promise<Theme[]>;

  // gaps + reading path
  getGaps(): Promise<GapAggregate[]>;
  getContradictions(): Promise<EdgeDetail[]>;
  getReadingPath(): Promise<ReadingPathEntry[]>;

  // export / import
  exportData(): Promise<{ path: string } | null>;
  importData(): Promise<{ ok: boolean; message: string }>;
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
