import { completeJson, embed } from './aiClient';
import { PROMPT_FUSION } from './prompts';
import {
  createIdea,
  findSimilarIdeas,
  allIdeaCandidates,
  addEdge,
  getIdea,
  embeddingTextForIdea,
  currentEmbeddingConfig,
} from '../db/ideasRepo';
import { getSettings } from '../db/settingsRepo';
import type { IdeaType, EdgeType, EdgeBasis, ModelRef } from '@shared/types';
import { perfLog, startPerf, type PerfContext } from '../perf';

export interface ExtractedIdea {
  localId: string;
  type: IdeaType;
  label: string;
  statement: string;
}

interface FusionResult {
  resolution: 'same_as' | 'variant_of' | 'new';
  matched_id: string | null;
  merged_label: string;
  edge_to_existing: { type: EdgeType; basis: EdgeBasis; confidence: number } | null;
  rationale: string;
  confidence: number;
}

export interface FuseIdeaOptions {
  model?: ModelRef | null;
  perf?: PerfContext;
  embedding?: number[] | null;
  embeddingText?: string;
  themes?: string[];
}

export interface FusionPlan {
  idea: ExtractedIdea;
  embedding: number[] | null;
  embeddingText: string;
  themes: string[];
  model: ModelRef | null;
  existingId: string | null;
  label: string;
  edge: {
    to: string;
    type: EdgeType;
    basis: EdgeBasis;
    confidence: number;
    similarity: number | null;
    rationale: string;
  } | null;
}

function isFusionResult(v: unknown): v is FusionResult {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return o.resolution === 'same_as' || o.resolution === 'variant_of' || o.resolution === 'new';
}

const SIM_THRESHOLD = 0.7;
const LEXICAL_THRESHOLD = 0.18;
const MAX_CANDIDATES = 6;

const STOPWORDS = new Set([
  'a',
  'al',
  'ante',
  'bajo',
  'con',
  'contra',
  'de',
  'del',
  'desde',
  'el',
  'en',
  'entre',
  'es',
  'la',
  'las',
  'lo',
  'los',
  'para',
  'por',
  'que',
  'se',
  'sin',
  'sobre',
  'su',
  'sus',
  'un',
  'una',
  'y',
]);

function tokens(text: string | null | undefined): Set<string> {
  // The column is nullable and the corpus has rows to prove it: six ideas in a real
  // 14,612-idea vault carry a null statement. This path runs whenever no embedding is
  // available (no provider configured, missing key, exhausted quota), so a single such
  // row used to take down fusion — and with it the whole scan — for every work.
  if (!text) return new Set();
  return new Set(
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/[^a-z0-9]+/i)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t))
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const t of a) if (b.has(t)) overlap++;
  return overlap / (a.size + b.size - overlap);
}

function lexicalSimilarity(a: ExtractedIdea, b: { label: string | null; statement: string | null }): number {
  return 0.65 * jaccard(tokens(a.label), tokens(b.label)) + 0.35 * jaccard(tokens(a.statement), tokens(b.statement));
}

/**
 * Resolve one extracted idea against the global graph.
 * Returns the global_id this idea maps to (existing or newly created).
 */
export async function fuseIdea(
  idea: ExtractedIdea,
  sourceWork: string,
  optionsOrModel: FuseIdeaOptions | ModelRef | null = {}
): Promise<string> {
  return applyFusionPlan(await planIdeaFusion(idea, optionsOrModel), sourceWork);
}

/** Resolve a fusion decision without mutating the graph. */
export async function planIdeaFusion(
  idea: ExtractedIdea,
  optionsOrModel: FuseIdeaOptions | ModelRef | null = {}
): Promise<FusionPlan> {
  const opts: FuseIdeaOptions = optionsOrModel && 'provider' in optionsOrModel ? { model: optionsOrModel } : optionsOrModel ?? {};
  const settings = getSettings();
  const fusionModel = opts.model ?? settings.fusionModel ?? settings.synthesisModel ?? null;
  const embeddingText = opts.embeddingText ?? embeddingTextForIdea({ ...idea, themes: opts.themes });
  const embeddingDone = opts.embedding === undefined ? startPerf('embedding', opts.perf, { idea: idea.label }) : null;
  const embedding = opts.embedding === undefined ? await embed(embeddingText) : opts.embedding;
  embeddingDone?.({ hit: Boolean(embedding) });

  // Retrieve candidates by cosine similarity via SQLite vec_cosine() — no in-memory loading.
  let candidates: { global_id: string; type: string; label: string; statement: string; similarity: number }[] = [];
  const retrievalDone = startPerf('candidate retrieval', opts.perf, {
    idea: idea.label,
    mode: embedding ? 'embedding' : 'lexical',
  });
  if (embedding) {
    // includeDormant: matching a dormant idea revives it with its original
    // global_id — this is what keeps idea identity stable across rescans.
    candidates = findSimilarIdeas(embedding, SIM_THRESHOLD, MAX_CANDIDATES, { includeDormant: true });
    retrievalDone({ candidates: candidates.length });
  } else {
    const pool = allIdeaCandidates({ includeDormant: true });
    candidates = pool
      .map((i) => ({
        global_id: i.global_id,
        type: i.type,
        label: i.label,
        statement: i.statement,
        similarity: lexicalSimilarity(idea, i),
      }))
      .filter((c) => c.similarity >= LEXICAL_THRESHOLD)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, MAX_CANDIDATES);
    retrievalDone({ pool: pool.length, candidates: candidates.length });
  }

  // No candidates → straight to a new idea, no model call needed.
  if (candidates.length === 0) {
    perfLog('LLM fusion', 0, opts.perf, { idea: idea.label, status: 'skipped', candidates: 0 });
    return { idea, embedding, embeddingText, themes: opts.themes ?? [], model: fusionModel, existingId: null, label: idea.label, edge: null };
  }

  const input = {
    new_idea: { id: idea.localId, type: idea.type, label: idea.label, statement: idea.statement },
    candidates: candidates.map((c) => ({
      global_id: c.global_id,
      type: c.type,
      label: c.label,
      statement: c.statement,
      similarity: Number(c.similarity.toFixed(3)),
    })),
  };

  let result: FusionResult;
  const fusionDone = startPerf('LLM fusion', opts.perf, { idea: idea.label, candidates: candidates.length });
  try {
    result = await completeJson<FusionResult>(
      { system: PROMPT_FUSION, user: JSON.stringify(input), temperature: 0.1, maxTokens: 800, perf: opts.perf },
      isFusionResult,
      fusionModel
    );
    fusionDone({ resolution: result.resolution, matched: Boolean(result.matched_id) });
  } catch {
    // On fusion failure, be conservative: treat as new (avoid wrong merges).
    fusionDone({ status: 'error' });
    return { idea, embedding, embeddingText, themes: opts.themes ?? [], model: fusionModel, existingId: null, label: idea.label, edge: null };
  }

  if (result.resolution === 'same_as' && result.matched_id && getIdea(result.matched_id)) {
    return { idea, embedding, embeddingText, themes: opts.themes ?? [], model: fusionModel, existingId: result.matched_id, label: idea.label, edge: null };
  }

  const matched = result.matched_id && result.edge_to_existing && getIdea(result.matched_id)
    ? candidates.find((candidate) => candidate.global_id === result.matched_id)
    : null;
  return {
    idea,
    embedding,
    embeddingText,
    themes: opts.themes ?? [],
    model: fusionModel,
    existingId: null,
    label: result.merged_label || idea.label,
    edge: matched && result.edge_to_existing ? {
      to: matched.global_id,
      type: result.edge_to_existing.type,
      basis: result.edge_to_existing.basis,
      confidence: result.edge_to_existing.confidence,
      similarity: matched.similarity,
      rationale: result.rationale,
    } : null,
  };
}

/** Apply a previously planned decision. Callers may compose this inside a transaction. */
export function applyFusionPlan(plan: FusionPlan, sourceWork: string): string {
  if (plan.existingId && getIdea(plan.existingId)) return plan.existingId;
  const created = createIdea({
    type: plan.idea.type,
    label: plan.label,
    statement: plan.idea.statement,
    embedding: plan.embedding,
    embeddingText: plan.embeddingText,
    themes: plan.themes,
  });
  if (plan.edge && getIdea(plan.edge.to)) {
    const config = plan.embedding ? currentEmbeddingConfig() : { provider: null, model: null };
    addEdge({
      from_id: created.global_id,
      to_id: plan.edge.to,
      type: plan.edge.type,
      basis: plan.edge.basis,
      confidence: plan.edge.confidence,
      source_work: sourceWork,
      trace: {
        method: 'fusion',
        model: plan.model,
        embeddingProvider: config.provider,
        embeddingModel: config.model,
        similarity: plan.edge.similarity,
        rationale: plan.edge.rationale,
      },
    });
  }
  return created.global_id;
}
