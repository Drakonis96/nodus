/** Documentary retrieval contracts. No credentials or model-generated permissions. */
export interface ResearchSourceReference {
  kind: 'work' | 'library-item' | 'library-collection' | 'zotero-collection' | 'note' | 'conversation-attachment';
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
  conversationSettings?: { systemPromptId?: string | null; thinkingEffort?: import('./researchReasoning').ResearchEffort };
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
  noteId?: string;
  conversationAttachment?: { conversationId: string; attachmentId: string };
  sourceWarning?: string;
  authoredKind?: 'user-note' | 'generated-report';
  origin: { kind: 'zotero'; libraryType: 'user' | 'group'; libraryId: string; itemKey: string } | { kind: 'nodus'; id: string };
  revision: string;
  attachmentId: string | null;
  attachments?: Array<{ id: string; revision: string }>;
  coverage: 'metadata' | 'abstract' | 'fulltext';
  permissionRevision: string;
  /** Backend-pinned published content; source revision above remains the live identity. */
  indexedSource?: { revision: string; attachmentId: string | null; attachments?: Array<{ id: string; revision: string }>; indexKeys: string[] };
}

export interface ResolvedResearchScope {
  conversationAttachments?: Array<{ conversationId: string; attachmentId: string; revision: string }>;
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
  coverage?: 'fulltext' | 'abstract' | 'metadata';
  documentId: string;
  attachmentId: string | null;
  attachmentRevision?: string;
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
  attachmentRevision?: string;
  revision: string;
  text: string;
  locator: { sourceRef: string | null; pageNumber: number | null; pageLabel: string | null; charStart?: number; charEnd?: number };
  provenance: 'source' | 'abstract' | 'idea-evidence' | 'profile-support' | 'user-note' | 'generated-report';
  limitations: string[];
}

export interface ResearchTraversal {
  decisionTokens?: number;
  matchedDocumentIds?: string[];
  readDocumentIds?: string[];
  limitations?: string[];
  scopeId: string;
  sourceCount: number;
  rounds: number;
  evidenceTokens: number;
  partial: boolean;
  queries: Array<{ query: string; sources: string[]; candidates: number; partial: boolean }>;
}

export type ResearchDocumentRead =
  | { kind: 'search'; query: string }
  | { kind: 'pages'; from: number; to?: number; attachmentId?: string }
  | { kind: 'context'; passageId: string; radius?: number }
  | { kind: 'references'; query?: string };

export function validateResearchDocumentRead(input: ResearchDocumentRead): ResearchDocumentRead {
  if (!input || !['search', 'pages', 'context', 'references'].includes(input.kind)) throw new Error('Invalid document operation');
  if ((input.kind === 'search' && (typeof input.query !== 'string' || !input.query.trim()))
    || ((input.kind === 'search' || input.kind === 'references') && input.query !== undefined && (typeof input.query !== 'string' || input.query.length > 1000))) throw new Error('Invalid document query');
  if (input.kind === 'pages' && (!Number.isSafeInteger(input.from) || input.from < 1 || input.from > 1000000
    || (input.to !== undefined && (!Number.isSafeInteger(input.to) || input.to < input.from || input.to - input.from > 3))
    || (input.attachmentId !== undefined && (typeof input.attachmentId !== 'string' || input.attachmentId.length > 256)))) throw new Error('Invalid physical page range');
  if (input.kind === 'context' && (typeof input.passageId !== 'string' || !/^[a-f0-9]{64}:\d+$/.test(input.passageId)
    || (input.radius !== undefined && (!Number.isInteger(input.radius) || input.radius < 0 || input.radius > 3)))) throw new Error('Invalid context locator');
  return { ...input };
}

/** A partial or merged derivative cannot prove coverage of independent files. */
export function unpreparedResearchAttachmentIds(document: ResearchCorpusDocument, indexes: DocumentaryIndexIdentity[]): string[] {
  const expected = document.indexedSource?.attachments ?? document.attachments ?? [];
  const revision = document.indexedSource?.revision ?? document.revision;
  return expected.filter(attachment => !indexes.some(index => index.revision === revision
    && index.attachmentId === attachment.id && index.attachmentRevision === attachment.revision
    && (index.coverage ?? document.coverage) === 'fulltext')).map(attachment => attachment.id);
}

export interface DocumentPreparationState {
  documentId: string;
  revision: string;
  text: 'missing' | 'available' | 'abstract';
  lexical: 'missing' | 'ready' | 'stale';
  embeddings: 'missing' | 'queued' | 'running' | 'ready' | 'partial' | 'stale' | 'failed';
  status: 'blocked' | 'catalogued' | 'queued' | 'running' | 'paused' | 'ready' | 'failed' | 'cancelled';
  reason: 'no_attachment' | 'not_downloaded' | 'inaccessible' | 'extraction_failed' | 'ocr_required' | 'no_model' | 'provider_failed' | null;
  error: string | null;
  passages: number;
  embedded: number;
  /** Known source files lacking a complete compatible text index. */
  unpreparedAttachmentIds?: string[];
}

export interface ZoteroMcpStatus {
  automatic?: boolean;
  sessionId?: string | null;
  activeSessions?: number;
  notebookId?: string | null;
  scopeId?: string | null;
  installed: boolean;
  mode: 'managed' | 'external';
  state: 'disabled' | 'stopped' | 'starting' | 'connected' | 'zotero_unavailable' | 'incompatible' | 'startup_error' | 'endpoint_error';
  version: string | null;
  transport: 'stdio' | 'streamable-http';
  error: string | null;
}

export interface ResearchPreparationInventory {
  enabled: boolean;
  embeddingSpaces?: Array<{ id: string; provider: string; model: string; dimensions: number; metric: 'cosine' }>;
  documents: Array<ResearchCorpusDocument & { preparation: DocumentPreparationState }>;
}

export interface ResearchCorpusApi {
  getResearchPreparationPolicy(): Promise<ResearchPreparationPolicy>;
  setResearchPreparationPolicy(input: { welcomeVersion?: number; decision?: ResearchPreparationPolicy['decision']; futureAdditions?: boolean }): Promise<ResearchPreparationPolicy>;
  previewResearchPreparation(input: { scope: 'vault' | 'selection'; documentIds?: string[] }): Promise<ResearchPreparationPreview>;
  startResearchPreparationCampaign(input: { previewId: string; mode: 'embeddings' | 'text'; documentIds?: string[] }): Promise<string>;
  getResearchPreparationProgress(): Promise<ResearchPreparationProgress>;
  onResearchPreparationProgress(listener: (progress: ResearchPreparationProgress) => void): () => void;
  controlResearchPreparationCampaign(input: { campaignId: string; action: ResearchPreparationAction; documentId?: string }): Promise<void>;
  getResearchCorpusSources(): Promise<{ documents: ResearchCorpusDocument[]; collections: ResearchCorpusCollection[] }>;
  listResearchNotebooks(): Promise<ResearchNotebook[]>;
  saveResearchNotebook(input: ResearchNotebookInput): Promise<ResearchNotebook>;
  deleteResearchNotebook(id: string): Promise<void>;
  resolveResearchNotebook(id: string): Promise<ResolvedResearchScope>;
  searchResearchNotebook(id: string, query: string): Promise<{ evidence: ResearchEvidence[]; scopeId: string; partial: boolean }>;
  readResearchDocument(input: { notebookId?: string | null; documentId: string; operation: ResearchDocumentRead }): Promise<{ evidence: ResearchEvidence[]; scopeId: string; partial: boolean }>;
  getResearchPreparationInventory(): Promise<ResearchPreparationInventory>;
  prepareResearchDocuments(documentIds: string[]): Promise<void>;
  cancelResearchDocuments(documentIds: string[]): Promise<void>;
  setResearchPreparationEnabled(enabled: boolean): Promise<void>;
  setResearchPreparationPaused(paused: boolean): Promise<void>;
  setResearchZoteroAutomatic(enabled: boolean): Promise<ZoteroMcpStatus>;
  getZoteroMcpStatus(): Promise<ZoteroMcpStatus>;
  connectResearchZotero(input: { notebookId?: string | null; mode: 'managed' | 'external'; externalUrl?: string }): Promise<ZoteroMcpStatus>;
  disconnectResearchZotero(): Promise<void>;
  readResearchZotero(input: { notebookId?: string | null; documentId: string; operation: 'metadata' | 'fulltext'; attachmentKey?: string }): Promise<unknown>;
}

/** User-visible preparation contracts contain no credentials or provider URLs. */
export interface ResearchPreparationPolicy {
  vaultId: string;
  welcomeVersion: number;
  decision: 'pending' | 'accepted' | 'declined';
  futureAdditions: boolean;
}
export interface ResearchPreparationPreview {
  id: string;
  vaultId: string;
  createdAt: number;
  documents: ResearchPreparationInventory['documents'];
  embedding: { provider: string; model: string; external: boolean } | null;
  embeddingAvailable: boolean;
  block: 'no_model' | null;
}
export type ResearchPreparationAction = 'pause' | 'resume' | 'cancel' | 'retry';
export interface ResearchPreparationJob {
  id: string;
  documentId: string;
  title: string;
  state: 'queued' | 'running' | 'paused' | 'complete' | 'failed' | 'cancelled' | 'blocked';
  stage: 'ocr' | 'extraction' | 'lexical' | 'embeddings' | 'complete';
  completedPassages: number;
  totalPassages: number | null;
  unknownRequests: number;
  currentPage?: number | null;
  totalPages?: number | null;
  error: string | null;
}
export interface ResearchPreparationCampaign {
  id: string;
  vaultId: string;
  vaultName: string;
  createdAt: number;
  updatedAt: number;
  state: 'active' | 'paused' | 'cancelled';
  embedding: ResearchPreparationPreview['embedding'];
  jobs: ResearchPreparationJob[];
}
export interface ResearchPreparationProgress {
  paused: boolean;
  campaigns: ResearchPreparationCampaign[];
}
