import crypto from 'node:crypto';
import { completeJson } from './aiClient';
import { PROMPT_DEEP } from './prompts';
import { fuseIdea, ExtractedIdea } from './fusion';
import {
  upsertOccurrence,
  addEvidence,
  addEdge,
  purgeDeepData,
} from '../db/ideasRepo';
import { addGap, addExternalRef } from '../db/gapsRepo';
import { getOrCreateAuthor, linkWorkAuthor, recomputeAuthorRelations } from '../db/authorsRepo';
import { setDeepResult } from '../db/worksRepo';
import type { Work, IdeaType, EdgeType, EdgeBasis, EvidenceKind, GapKind } from '@shared/types';
import { chunkText, ExtractedDoc } from '../extraction/textExtractor';

// ── Prompt 1 output shapes ────────────────────────────────────────────────────

interface EvidenceObj {
  quote: string;
  location: string | null;
  kind: EvidenceKind;
}
interface DeepIdea {
  id: string;
  type: IdeaType;
  label: string;
  statement: string;
  role: 'principal' | 'secondary';
  development: string;
  evidence: EvidenceObj[];
  confidence: number;
  uncertainty_reason: string | null;
}
interface DeepResult {
  document: { processing_status: string; type: string; language: string; notes: string | null };
  ideas: DeepIdea[];
  internal_relations: { from: string; to: string; type: EdgeType; basis: EdgeBasis; evidence: EvidenceObj; confidence: number }[];
  external_references: { from: string; cited_work: string; type: EdgeType; basis: EdgeBasis; evidence: EvidenceObj; confidence: number }[];
  gaps: { kind: GapKind; statement: string; related_idea: string | null; evidence: EvidenceObj; confidence: number }[];
  authors_detail: { name: string; affiliation: string | null; stance_notes: string | null }[];
}

function isDeepResult(v: unknown): v is DeepResult {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return Array.isArray(o.ideas) && typeof o.document === 'object';
}

/** Merge ideas sharing the same canonical label across chunks of the same work. */
function mergeByLabel(results: DeepResult[]): {
  ideas: Map<string, DeepIdea>;
  internal: DeepResult['internal_relations'];
  external: DeepResult['external_references'];
  gaps: DeepResult['gaps'];
  authors: DeepResult['authors_detail'];
} {
  const ideas = new Map<string, DeepIdea>();
  const localToLabel = new Map<string, string>();
  const internal: DeepResult['internal_relations'] = [];
  const external: DeepResult['external_references'] = [];
  const gaps: DeepResult['gaps'] = [];
  const authors: DeepResult['authors_detail'] = [];

  for (const r of results) {
    for (const idea of r.ideas) {
      const key = idea.label.trim().toLowerCase();
      localToLabel.set(idea.id, key);
      const existing = ideas.get(key);
      if (existing) {
        existing.evidence.push(...idea.evidence);
        if (idea.role === 'principal') existing.role = 'principal';
        existing.confidence = Math.max(existing.confidence, idea.confidence);
      } else {
        ideas.set(key, { ...idea, evidence: [...idea.evidence] });
      }
    }
    internal.push(...r.internal_relations);
    external.push(...r.external_references);
    gaps.push(...r.gaps);
    authors.push(...r.authors_detail);
  }

  // Rewrite internal relation endpoints from local ids to label keys.
  const remap = (id: string) => localToLabel.get(id) ?? id;
  for (const rel of internal) {
    rel.from = remap(rel.from);
    rel.to = remap(rel.to);
  }
  for (const ref of external) ref.from = remap(ref.from);
  for (const g of gaps) if (g.related_idea) g.related_idea = remap(g.related_idea);

  return { ideas, internal, external, gaps, authors };
}

/**
 * Deep scan: extract ideas per chunk, merge within the work, fuse against the
 * global graph, and persist all derived data with traceable evidence.
 */
export async function runDeepScan(work: Work, doc: ExtractedDoc): Promise<void> {
  const text = doc.text;
  const hash = crypto.createHash('sha1').update(text).digest('hex');

  if (work.deep_status === 'done' && work.deep_hash === hash) return; // unchanged

  if (!text.trim()) {
    setDeepResult(work.nodus_id, 'skipped_no_text', hash, doc.sourceType, doc.notes ?? 'Sin texto disponible.');
    return;
  }

  const chunks = chunkText(text);
  const authors: string[] = JSON.parse(work.authors_json || '[]');
  const results: DeepResult[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const input = {
      zotero_key: work.zotero_key,
      title: work.title,
      authors,
      year: work.year,
      container: null,
      item_type: work.item_type,
      has_fulltext: doc.sourceType !== 'abstract_only',
      language_hint: 'unknown',
      // The extractor prefixes each page with a [[p. N]] marker; use it for `location`.
      format_note: 'El texto puede incluir marcadores [[p. N]] con el número de página; úsalos en el campo location (p. ej. "p. 12"). No inventes páginas si no hay marcador.',
      chunk: { index: i, total: chunks.length, text: chunks[i] },
    };
    const result = await completeJson<DeepResult>(
      { system: PROMPT_DEEP, user: JSON.stringify(input), temperature: 0.15, maxTokens: 8000 },
      isDeepResult
    );
    results.push(result);
  }

  // Re-scan from a clean slate so re-tying connections is idempotent.
  purgeDeepData(work.nodus_id);

  const merged = mergeByLabel(results);

  // Resolve each merged idea against the global graph (Prompt 2 / fusion).
  const labelToGlobal = new Map<string, string>();
  for (const [labelKey, idea] of merged.ideas) {
    const ext: ExtractedIdea = {
      localId: labelKey,
      type: idea.type,
      label: idea.label,
      statement: idea.statement,
    };
    const globalId = await fuseIdea(ext, work.nodus_id);
    labelToGlobal.set(labelKey, globalId);

    upsertOccurrence(globalId, work.nodus_id, idea.role, idea.development, idea.confidence);
    for (const ev of idea.evidence) {
      addEvidence(globalId, work.nodus_id, ev.quote, ev.location, ev.kind);
    }
  }

  // Internal relations → edges between this work's ideas.
  for (const rel of merged.internal) {
    const from = labelToGlobal.get(rel.from);
    const to = labelToGlobal.get(rel.to);
    if (!from || !to) continue;
    addEdge({ from_id: from, to_id: to, type: rel.type, basis: rel.basis, confidence: rel.confidence, source_work: work.nodus_id });
  }

  // External references → stored for the gaps/author layers and as cited-work edges.
  for (const ref of merged.external) {
    const from = labelToGlobal.get(ref.from);
    if (!from) continue;
    const evId = ref.evidence?.quote
      ? addEvidence(from, work.nodus_id, ref.evidence.quote, ref.evidence.location, ref.evidence.kind)
      : null;
    addExternalRef(work.nodus_id, from, ref.cited_work, ref.type, ref.basis, ref.confidence, evId);
  }

  // Gaps.
  for (const g of merged.gaps) {
    const related = g.related_idea ? labelToGlobal.get(g.related_idea) ?? null : null;
    const evId = g.evidence?.quote
      ? addEvidence(related ?? labelToGlobal.values().next().value ?? '', work.nodus_id, g.evidence.quote, g.evidence.location, g.evidence.kind)
      : null;
    addGap(work.nodus_id, g.kind, g.statement, related, g.confidence, evId);
  }

  // Authors.
  for (const a of merged.authors) {
    const authorId = getOrCreateAuthor(a.name, a.affiliation);
    linkWorkAuthor(work.nodus_id, authorId);
  }
  // Also link the Zotero-listed authors so the author lens is complete.
  for (const name of authors) {
    const authorId = getOrCreateAuthor(name, null);
    linkWorkAuthor(work.nodus_id, authorId);
  }

  setDeepResult(work.nodus_id, 'done', hash, doc.sourceType, merged.ideas.size === 0 ? doc.notes ?? null : null);

  // Author-relations layer is derived; recompute after each deep scan.
  recomputeAuthorRelations();
}
