/**
 * "Guía de estudio completa": a Study-vault Deep Research mode that reads every
 * selected source in full, in several passes, and writes a didactic guide whose
 * last chapter is a review sheet. This file holds the request contract and the
 * frozen-selection vocabulary shared by the composer, the queue and the engine.
 */
import type { StudySearchScope } from '../studySearch';

/** Readable study sources. Questions and exams are study aids, not course content. */
export type CompleteGuideSourceKind = 'material' | 'document' | 'transcript';
export const COMPLETE_GUIDE_SOURCE_KINDS: readonly CompleteGuideSourceKind[] = ['material', 'document', 'transcript'];

/** One ticked node in the source tree. A group node expands to every readable
 * source placed below it (nested folders and subtopics included). */
export interface CompleteGuideSelectionNode {
  kind: 'course' | 'subject' | 'folder' | 'topic' | 'source';
  /** Entity id, or the `${kind}:${id}` source key for `source` nodes. */
  id: string;
}

export interface CompleteGuideSelection {
  nodes: CompleteGuideSelectionNode[];
  /** Sources the user unticked inside a ticked group. Always wins over a group. */
  excludedSourceKeys: string[];
}

export type CompleteGuideVerification = 'standard' | 'exhaustive';

export interface CompleteGuideConfig {
  version: 1;
  /** Stable across restarts of the same job, so a re-queued report resumes its passes. */
  runId: string;
  selection: CompleteGuideSelection;
  /** Free instructions from the student. Composed below the app's grounding rules. */
  instructions: string;
  /** Labelled examples and analogies written by the AI. On by default. */
  aiExamples: boolean;
  /** Complement the materials with web passages. Off by default, always labelled. */
  webText: boolean;
  /** Illustrate with attributed web images. Off by default. */
  webImages: boolean;
  /** Ignore cached reading passes and read every source again. */
  rereadAll?: boolean;
  verification?: CompleteGuideVerification;
  /** Stop cleanly before spending more than this (USD). Null/absent: no ceiling. */
  maxCostUsd?: number | null;
}

export const COMPLETE_GUIDE_INSTRUCTIONS_MAX = 12_000;
const NODE_KINDS = new Set<CompleteGuideSelectionNode['kind']>(['course', 'subject', 'folder', 'topic', 'source']);
const SOURCE_KEY = /^(material|document|transcript):.+$/;

export class CompleteGuideConfigError extends Error {
  constructor(public readonly code: 'empty_selection' | 'invalid_selection' | 'invalid_config', message: string) {
    super(message);
    this.name = 'CompleteGuideConfigError';
  }
}

function newRunId(): string {
  const random = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `cg-${random}`;
}

function uniqueNodes(nodes: CompleteGuideSelectionNode[]): CompleteGuideSelectionNode[] {
  const seen = new Set<string>();
  return nodes.filter((node) => {
    const key = `${node.kind}\0${node.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Validate a config received over IPC, from the durable queue or from MCP. Fails
 * closed: an empty or malformed selection never silently widens to the vault.
 */
export function normalizeCompleteGuideConfig(raw: unknown): CompleteGuideConfig {
  if (!raw || typeof raw !== 'object') throw new CompleteGuideConfigError('invalid_config', 'Configuración de guía no válida.');
  const input = raw as Partial<CompleteGuideConfig> & { selection?: Partial<CompleteGuideSelection> };
  const rawNodes = Array.isArray(input.selection?.nodes) ? input.selection!.nodes : [];
  const nodes: CompleteGuideSelectionNode[] = [];
  for (const node of rawNodes) {
    if (!node || typeof node !== 'object' || !NODE_KINDS.has(node.kind) || typeof node.id !== 'string' || !node.id.trim()) {
      throw new CompleteGuideConfigError('invalid_selection', 'La selección de fuentes contiene un elemento no válido.');
    }
    if (node.kind === 'source' && !SOURCE_KEY.test(node.id)) {
      throw new CompleteGuideConfigError('invalid_selection', `Fuente no admitida en una guía: ${node.id}`);
    }
    nodes.push({ kind: node.kind, id: node.id.trim() });
  }
  if (!nodes.length) throw new CompleteGuideConfigError('empty_selection', 'Selecciona al menos una fuente para crear la guía.');
  const excluded = Array.isArray(input.selection?.excludedSourceKeys)
    ? [...new Set(input.selection!.excludedSourceKeys.filter((key): key is string => typeof key === 'string' && SOURCE_KEY.test(key)))]
    : [];
  const instructions = typeof input.instructions === 'string' ? input.instructions.trim().slice(0, COMPLETE_GUIDE_INSTRUCTIONS_MAX) : '';
  const maxCost = typeof input.maxCostUsd === 'number' && Number.isFinite(input.maxCostUsd) && input.maxCostUsd > 0 ? input.maxCostUsd : null;
  return {
    version: 1,
    runId: typeof input.runId === 'string' && /^[\w.-]{6,80}$/.test(input.runId) ? input.runId : newRunId(),
    selection: { nodes: uniqueNodes(nodes), excludedSourceKeys: excluded },
    instructions,
    aiExamples: input.aiExamples !== false,
    webText: input.webText === true,
    webImages: input.webImages === true,
    ...(input.rereadAll === true ? { rereadAll: true } : {}),
    verification: input.verification === 'exhaustive' ? 'exhaustive' : 'standard',
    maxCostUsd: maxCost,
  };
}

/** A readable source as the selection resolver sees it (no text yet). */
export interface CompleteGuideCatalogSource {
  sourceKey: string;
  kind: CompleteGuideSourceKind;
  sourceId: string;
  title: string;
  /** Every current location. Recordings carry the recording's course/subject/topic. */
  placements: StudySearchScope[];
  available: boolean;
  unavailableReason?: CompleteGuideUnavailableReason;
  /** Transcripts only: several transcripts of one recording are one lecture. */
  recordingId?: string;
  transcriptKind?: 'literal' | 'corrected' | 'notes';
  fileName?: string;
  indexStatus?: string;
}

export type CompleteGuideUnavailableReason = 'no_content' | 'excluded' | 'not_indexed' | 'missing';

export interface CompleteGuideResolvedSource extends CompleteGuideCatalogSource {
  /** The placements that brought the source into the selection (first = reading order). */
  matchedPlacements: StudySearchScope[];
}

export interface CompleteGuideResolvedSelection {
  sources: CompleteGuideResolvedSource[];
  /** Selected but unreadable: shown to the user, never dropped silently. */
  unavailable: Array<{ sourceKey: string; title: string; reason: CompleteGuideUnavailableReason }>;
  /** Alternative transcripts of an already selected recording. */
  superseded: Array<{ sourceKey: string; title: string; keptSourceKey: string }>;
  subjectIds: string[];
  courseIds: string[];
}

/** Per-source accounting shown in the reader's coverage panel. */
export interface CompleteGuideSourceSummary {
  sourceKey: string;
  kind: CompleteGuideSourceKind;
  alias: string;
  title: string;
  path: string;
  passagesTotal: number;
  passagesRead: number;
  pages?: { total: number; withText: number; empty: number[] };
  itemsExtracted: number;
  itemsUsed: number;
  duplicates: number;
  unreadRanges: string[];
}

/**
 * Small metadata stored on the saved draft (the gallery loads every draft and drafts
 * sync between devices): configuration to create another version, coverage and
 * verification counts, and the review sheet for its separate export. Items, blocks
 * and quotes live in the local evidence sidecar.
 */
export interface CompleteGuideDraftMeta {
  version: 1;
  runId: string;
  config: Omit<CompleteGuideConfig, 'runId'>;
  snapshotAt: string;
  promptVersion: string;
  sources: CompleteGuideSourceSummary[];
  units: Array<{ unitKey: string; title: string; sections: number; items: number }>;
  counts: {
    items: number; itemsUsed: number; blocks: number; aiBlocks: number; windows: number; failedWindows: number;
    auditedBlocks: number; removedSentences: number; repairedBlocks: number; invalidLatex: number; conflicts: number; cacheHits: number;
    /** Figures taken from the materials (missing on guides from before figures). */
    figures?: number;
  };
  usage: { calls: number; inputTokens: number; outputTokens: number; usd: number | null };
  warnings: string[];
  cheatSheetMarkdown: string;
}

/** Exact quote behind one citation, read from the local sidecar for the reader popover. */
export interface CompleteGuideEvidenceView {
  itemId: string;
  title: string;
  statement: string;
  evidence: Array<{ alias: string; sourceTitle: string; location: string; quote: string; anchor: 'exact' | 'fuzzy' | 'missing' }>;
}
