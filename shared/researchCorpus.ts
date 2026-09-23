/** Documentary retrieval contracts. No credentials or model-generated permissions. */
export interface ResearchSourceReference {
  kind: 'work' | 'library-item' | 'library-collection' | 'zotero-collection';
  id: string;
  libraryId?: string;
  libraryType?: 'user' | 'group';
  includeDescendants?: boolean;
}

export type RetrievalPreset = 'fast' | 'balanced' | 'deep' | 'custom';
export interface RetrievalSettings {
  preset: RetrievalPreset;
  candidates: number;
  passagesPerRound: number;
  evidenceTokens: number;
  rounds: number;
  autoExpand: boolean;
  threshold: { mode: 'automatic' } | { mode: 'manual'; value: number; embeddingSpace: string; metric: 'cosine' };
}
export const RETRIEVAL_PRESETS: Readonly<Record<Exclude<RetrievalPreset, 'custom'>, RetrievalSettings>> = {
  fast: { preset: 'fast', candidates: 24, passagesPerRound: 6, evidenceTokens: 4000, rounds: 1, autoExpand: true, threshold: { mode: 'automatic' } },
  balanced: { preset: 'balanced', candidates: 60, passagesPerRound: 12, evidenceTokens: 8000, rounds: 3, autoExpand: true, threshold: { mode: 'automatic' } },
  deep: { preset: 'deep', candidates: 120, passagesPerRound: 24, evidenceTokens: 16000, rounds: 8, autoExpand: true, threshold: { mode: 'automatic' } },
};

export function validateRetrievalSettings(input: RetrievalSettings): RetrievalSettings {
  if (!input || !['fast', 'balanced', 'deep', 'custom'].includes(input.preset)) throw new Error('Invalid retrieval preset');
  const bounds: Array<[keyof RetrievalSettings, number, number]> = [
    ['candidates', 1, 500], ['passagesPerRound', 1, 100], ['evidenceTokens', 256, 64000], ['rounds', 1, 16],
  ];
  for (const [key, min, max] of bounds) {
    const value = input[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid retrieval limit: ${key}`);
  }
  if (input.passagesPerRound > input.candidates || typeof input.autoExpand !== 'boolean') throw new Error('Invalid retrieval limits');
  if (!input.threshold || !['automatic', 'manual'].includes(input.threshold.mode)) throw new Error('Invalid retrieval threshold');
  if (input.threshold.mode === 'manual' && (!Number.isFinite(input.threshold.value) || input.threshold.value < -1
      || input.threshold.value > 1 || !input.threshold.embeddingSpace || input.threshold.metric !== 'cosine')) throw new Error('Invalid cosine threshold');
  return { ...input, threshold: { ...input.threshold } };
}

export interface ResearchNotebookInput {
  id?: string;
  name: string;
  description?: string;
  mode: 'fixed' | 'linked';
  sources: ResearchSourceReference[];
  exclusions: string[];
  settings?: RetrievalSettings;
  noteIds?: string[];
  conversationSettings?: { systemPromptId?: string | null; thinkingEffort?: 'low' | 'medium' | 'high' };
}
export interface ResearchNotebook extends ResearchNotebookInput {
  id: string;
  revision: number;
  resolvedDocumentIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ResearchCorpusDocument {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  workId: string | null;
  libraryItemId: string | null;
  origin: { kind: 'zotero'; libraryType: 'user' | 'group'; libraryId: string; itemKey: string } | { kind: 'nodus'; id: string };
  revision: string;
  attachmentId: string | null;
  coverage: 'metadata' | 'abstract' | 'fulltext';
  permissionRevision: string;
}

export interface ResolvedResearchScope {
  id: string;
  vaultId: string;
  notebookId: string | null;
  notebookRevision: number | null;
  documents: ResearchCorpusDocument[];
  resolvedAt: string;
  permissionFingerprint: string;
  changes: { added: string[]; removed: string[] };
}

export interface ResearchCorpusCollection {
  reference: ResearchSourceReference;
  name: string;
  parentId: string | null;
  documentIds: string[];
}

/** Every parameter affecting vector comparability belongs in this identity. */
export interface DocumentaryIndexIdentity {
  documentId: string;
  attachmentId: string | null;
  revision: string;
  textFingerprint: string;
  chunkerVersion: string;
  processingVersion: string;
  embedding: null | { provider: string; model: string; dimensions: number; metric: 'cosine'; parameters: Record<string, string | number | boolean> };
}

export interface ResearchEvidence {
  id: string;
  documentId: string;
  workId: string | null;
  attachmentId: string | null;
  revision: string;
  text: string;
  locator: { sourceRef: string | null; pageNumber: number | null; pageLabel: string | null; charStart?: number; charEnd?: number };
  provenance: 'source' | 'abstract' | 'idea-evidence' | 'profile-support';
  limitations: string[];
}

export interface DocumentPreparationState {
  documentId: string;
  revision: string;
  text: 'missing' | 'available' | 'abstract';
  lexical: 'missing' | 'ready' | 'stale';
  embeddings: 'missing' | 'queued' | 'running' | 'ready' | 'partial' | 'stale' | 'failed';
  status: 'catalogued' | 'queued' | 'running' | 'paused' | 'ready' | 'failed' | 'cancelled';
  reason: 'no_attachment' | 'not_downloaded' | 'inaccessible' | 'extraction_failed' | 'ocr_required' | 'no_model' | 'provider_failed' | null;
  error: string | null;
  passages: number;
  embedded: number;
}

export interface ZoteroMcpStatus {
  installed: boolean;
  mode: 'managed' | 'external';
  state: 'disabled' | 'stopped' | 'starting' | 'connected' | 'zotero_unavailable' | 'incompatible' | 'startup_error' | 'endpoint_error';
  version: string | null;
  transport: 'stdio' | 'streamable-http';
  error: string | null;
}

export interface ResearchPreparationInventory {
  enabled: boolean;
  documents: Array<ResearchCorpusDocument & { preparation: DocumentPreparationState }>;
}

export interface ResearchCorpusApi {
  getResearchCorpusSources(): Promise<{ documents: ResearchCorpusDocument[]; collections: ResearchCorpusCollection[] }>;
  listResearchNotebooks(): Promise<ResearchNotebook[]>;
  saveResearchNotebook(input: ResearchNotebookInput): Promise<ResearchNotebook>;
  deleteResearchNotebook(id: string): Promise<void>;
  resolveResearchNotebook(id: string): Promise<ResolvedResearchScope>;
  searchResearchNotebook(id: string, query: string): Promise<{ evidence: ResearchEvidence[]; scopeId: string; partial: boolean }>;
  getResearchPreparationInventory(): Promise<ResearchPreparationInventory>;
  prepareResearchDocuments(documentIds: string[]): Promise<void>;
  setResearchPreparationEnabled(enabled: boolean): Promise<void>;
  setResearchPreparationPaused(paused: boolean): Promise<void>;
  getZoteroMcpStatus(): Promise<ZoteroMcpStatus>;
}
