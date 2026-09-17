import { AiError, completeJson, embed } from './aiClient';
import { coreStructuredPrompt } from './prompts';
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
import { modelRefSupportsCapability } from '@shared/localAiModels';

/**
 * The fusion decision itself is a few hundred tokens of JSON, but the ceiling also has
 * to survive a model that reasons before answering. 800 tokens was sized for models that
 * answer directly; a reasoning-capable one (Gemma 4 E2B on the integrated runtime, for
 * instance) spends part of that budget on its trace and stops with the JSON unfinished,
 * which the scan can only report as an unfinished fusion. The first attempt now asks for
 * real headroom and a cut-off answer gets exactly one retry at a larger ceiling, mirroring
 * the summary's truncation recovery.
 */
const FUSION_MAX_TOKENS = 2_000;
const FUSION_RETRY_MAX_TOKENS = 6_000;

export interface ExtractedIdea {
  localId: string;
  type: IdeaType;
  label: string;
  statement: string;
}

export interface FusionDecision {
  resolution: 'same_as' | 'variant_of' | 'new';
  matched_id: string | null;
  /**
   * Canonical formulation for the merged idea. Models that answer `new` routinely
   * send null instead of repeating the idea's own label, so it is optional here and
   * `buildFusionPlan` falls back to the label of the idea being fused.
   */
  merged_label: string | null;
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

const FUSION_EDGE_TYPES = new Set<EdgeType>([
  'extends',
  'contradicts',
  'applies_to',
  'shares_method',
  'precondition_of',
  'measures_same',
  'supports',
  'refutes',
  'variant_of',
  'refines',
]);

function isFusionResult(v: unknown): v is FusionDecision {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (o.resolution !== 'same_as' && o.resolution !== 'variant_of' && o.resolution !== 'new') return false;
  // A missing `merged_label` is not a broken decision: the only consumer falls back
  // to the fused idea's own label (`result.merged_label || idea.label`). Requiring a
  // non-empty string here rejected the very answer small local models give for a new
  // idea — {"resolution":"new","merged_label":null,…} — and every affected idea was
  // reported as "respuesta JSON inválida", which left whole works at deep_status=failed
  // long after their extraction had succeeded.
  if (o.merged_label != null && typeof o.merged_label !== 'string') return false;
  if (typeof o.rationale !== 'string' || !o.rationale.trim()) return false;
  if (typeof o.confidence !== 'number' || !Number.isFinite(o.confidence) || o.confidence < 0 || o.confidence > 1) return false;
  const matchedId = typeof o.matched_id === 'string' && o.matched_id.trim() ? o.matched_id : null;
  const edge = o.edge_to_existing;
  const hasValidEdge = edge !== null
    && typeof edge === 'object'
    && FUSION_EDGE_TYPES.has((edge as Record<string, unknown>).type as EdgeType)
    && ((edge as Record<string, unknown>).basis === 'explicit' || (edge as Record<string, unknown>).basis === 'inferred')
    && typeof (edge as Record<string, unknown>).confidence === 'number'
    && Number.isFinite((edge as Record<string, unknown>).confidence)
    && Number((edge as Record<string, unknown>).confidence) >= 0
    && Number((edge as Record<string, unknown>).confidence) <= 1;
  if (o.resolution === 'same_as') return Boolean(matchedId) && edge === null;
  if (o.resolution === 'variant_of') {
    const edgeType = hasValidEdge ? (edge as Record<string, unknown>).type : null;
    return Boolean(matchedId) && hasValidEdge && (edgeType === 'variant_of' || edgeType === 'refines' || edgeType === 'contradicts');
  }
  return edge === null ? o.matched_id === null : Boolean(matchedId) && hasValidEdge;
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

export interface FusionOutcome {
  plan: FusionPlan;
  /**
   * The validated model decision, or null when there was nothing to decide (a
   * fresh idea with no candidates needs no model call). Callers persist this so a
   * later retry can skip the model for ideas that already resolved.
   */
  decision: FusionDecision | null;
}

/** Resolve a fusion decision without mutating the graph. */
export async function planIdeaFusion(
  idea: ExtractedIdea,
  optionsOrModel: FuseIdeaOptions | ModelRef | null = {}
): Promise<FusionPlan> {
  return (await resolveIdeaFusion(idea, optionsOrModel)).plan;
}

/**
 * Resolve one extracted idea against the global graph, optionally reusing a
 * previously checkpointed decision. Returns the plan plus the raw decision so the
 * caller can checkpoint it and skip the model on a later retry.
 */
export async function resolveIdeaFusion(
  idea: ExtractedIdea,
  optionsOrModel: FuseIdeaOptions | ModelRef | null = {},
  cachedDecision: FusionDecision | null = null,
): Promise<FusionOutcome> {
  const opts: FuseIdeaOptions = optionsOrModel && 'provider' in optionsOrModel ? { model: optionsOrModel } : optionsOrModel ?? {};
  const settings = getSettings();
  const fusionModel = opts.model ?? settings.fusionModel ?? settings.synthesisModel ?? null;
  if (!modelRefSupportsCapability(fusionModel, 'fusion')) {
    throw new AiError(`El modelo local «${fusionModel?.model}» no está certificado para fusionar ideas; no se modificó el grafo.`, false, true);
  }
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
    return {
      plan: { idea, embedding, embeddingText, themes: opts.themes ?? [], model: fusionModel, existingId: null, label: idea.label, edge: null },
      decision: null,
    };
  }

  // A decision checkpointed by an earlier attempt is reused verbatim. Rebuilding the
  // plan against freshly retrieved candidates keeps `matched_id` honest if the graph
  // moved on between runs (a vanished target simply degrades to a new idea).
  if (cachedDecision && isFusionResult(cachedDecision)) {
    perfLog('LLM fusion', 0, opts.perf, { idea: idea.label, status: 'cached', candidates: candidates.length });
    return { plan: buildFusionPlan(idea, cachedDecision, candidates, embedding, embeddingText, opts, fusionModel), decision: cachedDecision };
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

  const fusionDone = startPerf('LLM fusion', opts.perf, { idea: idea.label, candidates: candidates.length });
  try {
    const request = {
      system: coreStructuredPrompt('fusion', getSettings().promptLanguage ?? 'es'),
      user: JSON.stringify(input),
      temperature: 0.1,
      perf: opts.perf,
      requestClass: 'fusion' as const,
      jobId: `fusion:${idea.localId}`,
    };
    let result: FusionDecision;
    try {
      result = await completeJson<FusionDecision>({ ...request, maxTokens: FUSION_MAX_TOKENS }, isFusionResult, fusionModel);
    } catch (error) {
      // Only a cut-off answer is worth one retry with more room; a schema miss or an
      // invalid reply would repeat with the same budget, and a transport failure must
      // not be replayed (it is already handled upstream).
      if (!(error instanceof AiError && error.code === 'output_truncated')) throw error;
      result = await completeJson<FusionDecision>({ ...request, maxTokens: FUSION_RETRY_MAX_TOKENS }, isFusionResult, fusionModel);
    }
    fusionDone({ resolution: result.resolution, matched: Boolean(result.matched_id) });
    return { plan: buildFusionPlan(idea, result, candidates, embedding, embeddingText, opts, fusionModel), decision: result };
  } catch (error) {
    // A failed semantic decision cannot be represented as "new": doing so mutates
    // the graph with a lower-quality answer. The caller checkpoints the successes
    // and retries only this idea, so the work resumes instead of restarting.
    fusionDone({ status: 'error' });
    // The caller aggregates these into "could not fuse N of M ideas", which is all a
    // report can quote. Name the idea, the candidates it was judged against and the
    // underlying failure so the cause (invalid JSON, schema miss, timeout, empty
    // reply) is readable instead of guessed.
    const detail = error instanceof Error ? `${(error as { code?: string }).code ?? error.name}: ${error.message}` : String(error);
    console.warn(`[fusion] "${idea.label}" (candidates=${candidates.length}) failed: ${detail.slice(0, 300)}`);
    throw error;
  }
}

function buildFusionPlan(
  idea: ExtractedIdea,
  result: FusionDecision,
  candidates: { global_id: string; type: string; label: string; statement: string; similarity: number }[],
  embedding: number[] | null,
  embeddingText: string,
  opts: FuseIdeaOptions,
  fusionModel: ModelRef | null,
): FusionPlan {
  const matchedCandidate = result.matched_id
    ? candidates.find((candidate) => candidate.global_id === result.matched_id)
    : null;
  if (result.resolution === 'same_as' && matchedCandidate && getIdea(matchedCandidate.global_id)) {
    return { idea, embedding, embeddingText, themes: opts.themes ?? [], model: fusionModel, existingId: matchedCandidate.global_id, label: idea.label, edge: null };
  }

  const matched = result.matched_id && result.edge_to_existing && getIdea(result.matched_id)
    ? matchedCandidate
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
