import crypto from 'node:crypto';
import { completeJson, embedMany } from './aiClient';
import { PROMPT_DEEP } from './prompts';
import { fuseIdea, ExtractedIdea } from './fusion';
import {
  upsertOccurrence,
  addEvidence,
  addEdge,
  purgeDeepData,
  embeddingTextForIdea,
} from '../db/ideasRepo';
import { addGap, addExternalRef } from '../db/gapsRepo';
import { canonicalKeyFromDisplay, linkZoteroAuthors, recomputeAuthorRelations } from '../db/authorsRepo';
import { setDeepResult } from '../db/worksRepo';
import {
  getWorkThemeLabels,
  listThemeLabels,
  normalizeThemeLabel,
  setIdeaThemeLinks,
  unionWorkThemes,
} from '../db/themesRepo';
import { loadCheckpoints, saveCheckpoint, clearCheckpoints } from '../db/scanCheckpointRepo';
import { getSettings } from '../db/settingsRepo';
import type { Work, IdeaType, EdgeType, EdgeBasis, EvidenceKind, GapKind, ModelRef } from '@shared/types';
import { planTextChunks, ExtractedDoc } from '../extraction/textExtractor';
import { perfLog, startPerf } from '../perf';

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
  theme_labels?: string[];
  confidence: number;
  uncertainty_reason: string | null;
}
interface DeepTheme {
  id: string;
  label: string;
  statement: string;
  role: 'primary' | 'secondary';
  evidence: EvidenceObj[];
  confidence: number;
}
interface DeepResult {
  document: { processing_status: string; type: string; language: string; notes: string | null };
  theme_nodes?: DeepTheme[];
  ideas: DeepIdea[];
  internal_relations: { from: string; to: string; type: EdgeType; basis: EdgeBasis; evidence: EvidenceObj; confidence: number }[];
  external_references: { from: string; cited_work: string; type: EdgeType; basis: EdgeBasis; evidence: EvidenceObj; confidence: number }[];
  gaps: { kind: GapKind; statement: string; related_idea: string | null; evidence: EvidenceObj; confidence: number }[];
  authors_detail: { name: string; affiliation: string | null; stance_notes: string | null }[];
}

function themeScore(theme: DeepTheme): number {
  return theme.confidence + (theme.role === 'primary' ? 0.5 : 0) + Math.min(0.3, (theme.evidence?.length ?? 0) * 0.05);
}

export interface DeepScanProgress {
  detail: string;
  pct: number | null;
}

function isDeepResult(v: unknown): v is DeepResult {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return Array.isArray(o.ideas) && typeof o.document === 'object';
}

/** Merge ideas sharing the same canonical label across chunks of the same work. */
function mergeByLabel(results: DeepResult[]): {
  ideas: Map<string, DeepIdea>;
  themes: Map<string, DeepTheme>;
  internal: DeepResult['internal_relations'];
  external: DeepResult['external_references'];
  gaps: DeepResult['gaps'];
  authors: DeepResult['authors_detail'];
} {
  const ideas = new Map<string, DeepIdea>();
  const themes = new Map<string, DeepTheme>();
  const localToLabel = new Map<string, string>();
  const internal: DeepResult['internal_relations'] = [];
  const external: DeepResult['external_references'] = [];
  const gaps: DeepResult['gaps'] = [];
  const authors: DeepResult['authors_detail'] = [];

  for (const r of results) {
    for (const theme of r.theme_nodes ?? []) {
      const key = theme.label.trim().toLowerCase();
      if (!key) continue;
      const existing = themes.get(key);
      if (existing) {
        existing.evidence.push(...(theme.evidence ?? []));
        if (theme.role === 'primary') existing.role = 'primary';
        existing.confidence = Math.max(existing.confidence, theme.confidence);
      } else {
        themes.set(key, { ...theme, label: key, evidence: [...(theme.evidence ?? [])] });
      }
    }
    for (const idea of r.ideas) {
      const key = idea.label.trim().toLowerCase();
      localToLabel.set(idea.id, key);
      const existing = ideas.get(key);
      if (existing) {
        existing.evidence.push(...idea.evidence);
        existing.theme_labels = mergeThemeLabels(existing.theme_labels, idea.theme_labels);
        if (idea.role === 'principal') existing.role = 'principal';
        existing.confidence = Math.max(existing.confidence, idea.confidence);
      } else {
        ideas.set(key, { ...idea, evidence: [...idea.evidence], theme_labels: [...(idea.theme_labels ?? [])] });
      }
    }
    internal.push(...(r.internal_relations ?? []));
    external.push(...(r.external_references ?? []));
    gaps.push(...(r.gaps ?? []));
    authors.push(...(r.authors_detail ?? []));
  }

  // Rewrite internal relation endpoints from local ids to label keys.
  const remap = (id: string) => localToLabel.get(id) ?? id;
  for (const rel of internal) {
    rel.from = remap(rel.from);
    rel.to = remap(rel.to);
  }
  for (const ref of external) ref.from = remap(ref.from);
  for (const g of gaps) if (g.related_idea) g.related_idea = remap(g.related_idea);

  return { ideas, themes, internal, external, gaps, authors };
}

function mergeThemeLabels(a: string[] | undefined, b: string[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const label of [...(a ?? []), ...(b ?? [])]) {
    const norm = normalizeThemeLabel(label);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(label);
  }
  return out;
}

/**
 * Deep scan: extract ideas per chunk, merge within the work, fuse against the
 * global graph, and persist all derived data with traceable evidence.
 */
export async function runDeepScan(
  work: Work,
  doc: ExtractedDoc,
  model?: ModelRef | null,
  onProgress?: (p: DeepScanProgress) => void
): Promise<void> {
  const perf = { nodusId: work.nodus_id, title: work.title };
  const totalDone = startPerf('deep pipeline', perf, { sourceType: doc.sourceType, chars: doc.text.length });
  const text = doc.text;
  const hash = crypto.createHash('sha1').update(text).digest('hex');

  try {
    if (work.deep_status === 'done' && work.deep_hash === hash) {
      totalDone({ status: 'unchanged' });
      return;
    }

    if (!text.trim()) {
      setDeepResult(work.nodus_id, 'skipped_no_text', hash, doc.sourceType, doc.notes ?? 'Sin texto disponible.');
      totalDone({ status: 'skipped_no_text' });
      return;
    }

    const settings = getSettings();
    const extractionModel = model ?? settings.extractionModel ?? settings.synthesisModel ?? null;
    // Fusion runs many small dedup/relate calls; let it use a dedicated (often faster)
    // model, falling back to the synthesis model to preserve prior behavior.
    const fusionModel = model ?? settings.fusionModel ?? settings.synthesisModel ?? null;
    const chunkPlan = planTextChunks(text, {
      mode: settings.deepContextMode,
      standardChunkWords: settings.deepStandardChunkWords,
      longChunkWords: settings.deepLongChunkWords,
    });
    const chunks = chunkPlan.chunks;
    perfLog('chunking', 0, perf, {
      mode: chunkPlan.mode,
      words: chunkPlan.wordCount,
      chunks: chunks.length,
      chunkWords: chunkPlan.chunkWords,
      overlapWords: chunkPlan.overlapWords,
      maxIdeas: chunkPlan.maxIdeasPerChunk,
    });
    const authors: string[] = JSON.parse(work.authors_json || '[]');
    const existingThemeLabels = getWorkThemeLabels(work.nodus_id);
    const results: DeepResult[] = [];

    // Load any previously checkpointed chunk results so we can resume after a failure.
    const checkpoints = loadCheckpoints(work.nodus_id, hash, 'deep_chunk');

    const llmDone = startPerf('deep LLM extraction', perf, { chunks: chunks.length, mode: chunkPlan.mode });
    for (let i = 0; i < chunks.length; i++) {
      // Resume from checkpoint if available.
      const saved = checkpoints.get(i) as DeepResult | undefined;
      if (saved && isDeepResult(saved)) {
        results.push(saved);
        continue;
      }
      onProgress?.({ detail: `Analizando fragmento ${i + 1}/${chunks.length} con IA…`, pct: i / chunks.length });
      const chunkWordCount = chunks[i].split(/\s+/).filter(Boolean).length;
      // Heartbeat: the LLM call is non-streaming and can take a long time on slow
      // (e.g. reasoning) models, so tick the elapsed seconds to show it isn't frozen.
      const chunkStart = Date.now();
      const heartbeat = setInterval(() => {
        const secs = Math.round((Date.now() - chunkStart) / 1000);
        onProgress?.({ detail: `Analizando fragmento ${i + 1}/${chunks.length} con IA… (${secs}s)`, pct: i / chunks.length });
      }, 1000);
      const input = {
        zotero_key: work.zotero_key,
        title: work.title,
        authors,
        year: work.year,
        container: null,
        item_type: work.item_type,
        has_fulltext: doc.sourceType !== 'abstract_only',
        language_hint: 'unknown',
        available_theme_labels: existingThemeLabels,
        context_mode: chunkPlan.mode,
        analysis_limits: {
          max_ideas: chunkPlan.maxIdeasPerChunk,
          max_internal_relations: chunkPlan.maxRelationsPerChunk,
          max_gaps: chunkPlan.maxGapsPerChunk,
          target_chunk_words: chunkPlan.chunkWords,
          overlap_words: chunkPlan.overlapWords,
        },
        // The extractor prefixes each page with a [[p. N]] marker; use it for `location`.
        format_note: 'El texto puede incluir marcadores [[p. N]] con el número de página; úsalos en el campo location (p. ej. "p. 12"). No inventes páginas si no hay marcador.',
        chunk: { index: i, total: chunks.length, word_count: chunkWordCount, text: chunks[i] },
      };
      const chunkDone = startPerf('deep LLM chunk', perf, {
        chunk: `${i + 1}/${chunks.length}`,
        words: chunkWordCount,
        maxIdeas: chunkPlan.maxIdeasPerChunk,
      });
      try {
        const result = await completeJson<DeepResult>(
          {
            system: PROMPT_DEEP,
            user: JSON.stringify(input),
            temperature: 0.15,
            maxTokens: chunkPlan.mode === 'long' ? 12000 : 8000,
            perf,
          },
          isDeepResult,
          extractionModel
        );
        chunkDone({ ideas: result.ideas.length, themes: result.theme_nodes?.length ?? 0 });
        results.push(result);
        // Checkpoint this chunk so a later failure doesn't lose the work.
        saveCheckpoint(work.nodus_id, hash, 'deep_chunk', i, result);
      } catch (e) {
        chunkDone({ status: 'error', error: e instanceof Error ? e.message : String(e) });
        llmDone({ status: 'error', chunk: i + 1 });
        throw e;
      } finally {
        clearInterval(heartbeat);
      }
    }
    llmDone({ results: results.length });

    // Re-scan from a clean slate so re-tying connections is idempotent.
    purgeDeepData(work.nodus_id);

    const merged = mergeByLabel(results);
    // Keep only a small number of well-supported deep families. The prompt runs per
    // chunk, so accepting every family it mentions turns sections into graph hubs.
    let deepThemeLabels = Array.from(merged.themes.values())
      .filter((t) => t.confidence >= 0.65)
      .sort((a, b) => themeScore(b) - themeScore(a))
      .slice(0, 2)
      .map((t) => t.label);
    if (getSettings().themesLocked) {
      // Locked main themes: never coin new families; keep only matches of the curated set.
      const allowed = new Map(listThemeLabels().map((label) => [normalizeThemeLabel(label), label]));
      deepThemeLabels = deepThemeLabels
        .map((label) => allowed.get(normalizeThemeLabel(label)))
        .filter((label): label is string => Boolean(label));
    }
    unionWorkThemes(work.nodus_id, deepThemeLabels, 4);
    const allowedThemeLabels = new Map(getWorkThemeLabels(work.nodus_id).map((label) => [normalizeThemeLabel(label), label]));

    // Resolve each merged idea against the global graph (Prompt 2 / fusion).
    const labelToGlobal = new Map<string, string>();
    const ideaEntries = Array.from(merged.ideas);
    const preparedIdeas = ideaEntries.map(([labelKey, idea]) => {
      const ideaThemeLabels = mergeThemeLabels(idea.theme_labels, [])
        .map((label) => allowedThemeLabels.get(normalizeThemeLabel(label)))
        .filter((label): label is string => Boolean(label))
        .slice(0, 3);
      const embeddingText = embeddingTextForIdea({
        type: idea.type,
        label: idea.label,
        statement: idea.statement,
        themes: ideaThemeLabels,
      });
      return { labelKey, idea, ideaThemeLabels, embeddingText };
    });
    const fusionDone = startPerf('embeddings/fusion', perf, { ideas: ideaEntries.length });
    const embeddingDone = startPerf('embedding', perf, { mode: 'batch', ideas: ideaEntries.length });
    try {
      const embeddings = await embedMany(preparedIdeas.map((entry) => entry.embeddingText));
      embeddingDone({ available: embeddings.filter(Boolean).length });
      for (let i = 0; i < preparedIdeas.length; i++) {
        const { labelKey, idea, ideaThemeLabels, embeddingText } = preparedIdeas[i];
        onProgress?.({
          detail: `Fusionando idea ${i + 1}/${ideaEntries.length}…`,
          pct: ideaEntries.length ? i / ideaEntries.length : null,
        });
        const ext: ExtractedIdea = {
          localId: labelKey,
          type: idea.type,
          label: idea.label,
          statement: idea.statement,
        };
        const globalId = await fuseIdea(ext, work.nodus_id, {
          model: fusionModel,
          perf,
          embedding: embeddings[i] ?? null,
          embeddingText,
          themes: ideaThemeLabels,
        });
        labelToGlobal.set(labelKey, globalId);
        setIdeaThemeLinks(work.nodus_id, globalId, ideaThemeLabels, idea.confidence, 'explicit');

        upsertOccurrence(globalId, work.nodus_id, idea.role, idea.development, idea.confidence);
        for (const ev of idea.evidence) {
          addEvidence(globalId, work.nodus_id, ev.quote, ev.location, ev.kind);
        }
      }
      fusionDone({ mapped: labelToGlobal.size });
    } catch (e) {
      embeddingDone({ status: 'error', error: e instanceof Error ? e.message : String(e) });
      fusionDone({ status: 'error', error: e instanceof Error ? e.message : String(e) });
      throw e;
    }

    // Internal relations → edges between this work's ideas.
    for (const rel of merged.internal) {
      const from = labelToGlobal.get(rel.from);
      const to = labelToGlobal.get(rel.to);
      if (!from || !to) continue;
      addEdge({
        from_id: from,
        to_id: to,
        type: rel.type,
        basis: rel.basis,
        confidence: rel.confidence,
        source_work: work.nodus_id,
        trace: {
          method: 'deep',
          model: extractionModel,
          rationale: rel.evidence?.quote ? `Relación extraída con evidencia: "${rel.evidence.quote}"` : null,
        },
      });
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

    // Authors. Identity comes from Zotero (canonical), never from the free-text
    // names the model read off the page — those only fragmented one person into
    // several nodes. We still salvage the model's affiliations by matching them
    // to the canonical identity, since Zotero rarely carries affiliation.
    const affiliationByKey = new Map<string, string | null>();
    for (const a of merged.authors) {
      const key = canonicalKeyFromDisplay(a.name);
      if (key && a.affiliation && !affiliationByKey.get(key)) affiliationByKey.set(key, a.affiliation);
    }
    linkZoteroAuthors(work.nodus_id, { createIfMissing: true, affiliationByKey });

    setDeepResult(work.nodus_id, 'done', hash, doc.sourceType, merged.ideas.size === 0 ? doc.notes ?? null : null);

    // Author-relations layer is derived; recompute after each deep scan.
    const recomputeDone = startPerf('recomputeAuthorRelations', perf);
    recomputeAuthorRelations();
    recomputeDone();
    // All done — clear checkpoints so a future re-scan starts fresh.
    clearCheckpoints(work.nodus_id, hash, 'deep_chunk');
    totalDone({ status: 'done', ideas: merged.ideas.size });
  } catch (e) {
    totalDone({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}
