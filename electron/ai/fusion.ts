import { completeJson, embed } from './aiClient';
import { PROMPT_FUSION } from './prompts';
import {
  createIdea,
  ideasWithEmbeddings,
  allIdeaCandidates,
  cosineSimilarity,
  addEdge,
  getIdea,
} from '../db/ideasRepo';
import type { IdeaType, EdgeType, EdgeBasis, ModelRef } from '@shared/types';

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

function isFusionResult(v: unknown): v is FusionResult {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return o.resolution === 'same_as' || o.resolution === 'variant_of' || o.resolution === 'new';
}

const SIM_THRESHOLD = 0.78;
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

function tokens(text: string): Set<string> {
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

function lexicalSimilarity(a: ExtractedIdea, b: { label: string; statement: string }): number {
  return 0.65 * jaccard(tokens(a.label), tokens(b.label)) + 0.35 * jaccard(tokens(a.statement), tokens(b.statement));
}

/**
 * Resolve one extracted idea against the global graph.
 * Returns the global_id this idea maps to (existing or newly created).
 */
export async function fuseIdea(idea: ExtractedIdea, sourceWork: string, model?: ModelRef | null): Promise<string> {
  const embedding = await embed(`${idea.label}. ${idea.statement}`);

  // Retrieve candidates by cosine similarity (in-memory fallback if no sqlite-vec).
  let candidates: { global_id: string; type: string; label: string; statement: string; similarity: number }[] = [];
  if (embedding) {
    candidates = ideasWithEmbeddings()
      .map((i) => ({
        global_id: i.global_id,
        type: i.type,
        label: i.label,
        statement: i.statement,
        similarity: cosineSimilarity(embedding, i.embedding),
      }))
      .filter((c) => c.similarity >= SIM_THRESHOLD)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, MAX_CANDIDATES);
  } else {
    candidates = allIdeaCandidates()
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
  }

  // No candidates → straight to a new idea, no model call needed.
  if (candidates.length === 0) {
    return createIdea({ type: idea.type, label: idea.label, statement: idea.statement, embedding }).global_id;
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
  try {
    result = await completeJson<FusionResult>(
      { system: PROMPT_FUSION, user: JSON.stringify(input), temperature: 0.1, maxTokens: 800 },
      isFusionResult,
      model
    );
  } catch {
    // On fusion failure, be conservative: treat as new (avoid wrong merges).
    return createIdea({ type: idea.type, label: idea.label, statement: idea.statement, embedding }).global_id;
  }

  if (result.resolution === 'same_as' && result.matched_id && getIdea(result.matched_id)) {
    return result.matched_id;
  }

  // variant_of or new → create a distinct node, optionally edge it to the matched candidate.
  const created = createIdea({
    type: idea.type,
    label: result.merged_label || idea.label,
    statement: idea.statement,
    embedding,
  });

  if (result.matched_id && result.edge_to_existing && getIdea(result.matched_id)) {
    addEdge({
      from_id: created.global_id,
      to_id: result.matched_id,
      type: result.edge_to_existing.type,
      basis: result.edge_to_existing.basis,
      confidence: result.edge_to_existing.confidence,
      source_work: sourceWork,
    });
  }

  return created.global_id;
}
