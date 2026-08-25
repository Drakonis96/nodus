import crypto from 'node:crypto';
import { completeJson, embedMany, AiError } from './aiClient';
import { modelRefSupportsExtraction } from '@shared/localAiModels';
import { PROMPT_DEEP } from './prompts';
import { planIdeaFusion, applyFusionPlan, ExtractedIdea, type FusionPlan } from './fusion';
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
import { recordLinkedLibraryAnalysis } from '../library/libraryVaultProvenance';
import { getDb } from '../db/database';

// Fusion decisions depend on the current global graph. Serialize only that phase so
// concurrent scans can still extract chunks in parallel without planning against a
// graph that changes before their atomic commit.
let fusionTail: Promise<void> = Promise.resolve();
async function withFusionLock<T>(fn: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const previous = fusionTail;
  fusionTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

// ── Prompt 1 output shapes ────────────────────────────────────────────────────

interface EvidenceObj {
  quote: string;
  location: string | null;
  source_ref: string | null;
  page_number: number | null;
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

function isRawDeepResult(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null) return false;
  const raw = v as Record<string, unknown>;
  return Array.isArray(raw.ideas) && typeof raw.document === 'object' && raw.document !== null;
}

export function isDeepResult(v: unknown): v is DeepResult {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return Boolean(o.document && typeof o.document === 'object')
    && Array.isArray(o.ideas)
    && o.ideas.every((idea) => Boolean(idea && typeof idea === 'object' && typeof (idea as Record<string, unknown>).label === 'string' && (idea as Record<string, unknown>).label))
    && Array.isArray(o.internal_relations)
    && Array.isArray(o.external_references)
    && Array.isArray(o.gaps)
    && Array.isArray(o.authors_detail);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function cleanNullableString(value: unknown): string | null {
  return cleanString(value) || null;
}

function clampConfidence(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0.5;
}

function derivedLabel(...values: unknown[]): string {
  const text = values.map(cleanString).find(Boolean) ?? '';
  return text.split(/(?<=[.!?;:])\s+/u)[0].slice(0, 96).trim();
}

function normalizeEvidence(
  value: unknown,
  sourceMap: Map<string, string>,
  defaultSourceAlias: string | null,
  citationCorpus?: Map<string, Map<number | null, string>>,
): EvidenceObj | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const quote = cleanString(raw.quote);
  const rawLocation = cleanNullableString(raw.location);
  const rawSource = cleanString(raw.source_ref ?? raw.source ?? raw.attachment ?? raw.marker);
  const locationSource = rawLocation?.match(/(?:^|\b)(s\d+)(?:\b|\s)/i)?.[1] ?? '';
  const alias = rawSource || locationSource || defaultSourceAlias || '';
  const sourceRef = alias ? sourceMap.get(alias.replace(/^src:/i, '')) ?? (alias.startsWith('zotero:') ? alias : null) : null;
  const explicitPage = Number(raw.page_number ?? raw.page);
  const locationPage = rawLocation?.match(/(?:p(?:ág(?:ina)?)?\.?\s*)(\d+)/i)?.[1];
  let pageNumber = Number.isInteger(explicitPage) && explicitPage > 0
    ? explicitPage
    : locationPage ? Number(locationPage) : null;
  let kind: EvidenceKind = raw.kind === 'explicit' ? 'explicit' : 'paraphrased';
  if (!quote && !rawLocation) return null;
  const pages = sourceRef ? citationCorpus?.get(sourceRef) : null;
  // A page locator is durable only when that exact source/page was extracted.
  // Fulltext fallbacks without page markers deliberately cannot carry a page.
  if (pageNumber != null && !pages?.has(pageNumber)) pageNumber = null;
  if (kind === 'explicit' && quote) {
    const haystack = pageNumber != null ? pages?.get(pageNumber) : pages?.get(null);
    const normalize = (text: string) => text.normalize('NFKC').replace(/\p{L}-\s+(?=\p{Ll})/gu, (match) => match[0]).replace(/-\s+(?=\p{Ll})/gu, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
    if (!haystack || !normalize(haystack).includes(normalize(quote))) {
      const matches = [...(pages?.entries() ?? [])]
        .filter(([page, text]) => page != null && normalize(text).includes(normalize(quote)));
      if (matches.length === 1) pageNumber = matches[0][0];
      else {
        kind = 'paraphrased';
        pageNumber = null;
      }
    }
  }
  const nonPageLocation = rawLocation && !/(?:p(?:ág(?:ina)?)?\.?\s*)\d+/i.test(rawLocation) ? rawLocation : null;
  return {
    quote,
    location: pageNumber ? `p. ${pageNumber}` : nonPageLocation,
    source_ref: sourceRef,
    page_number: pageNumber,
    kind,
  };
}

export function normalizeDeepResult(
  value: unknown,
  sourceMap: Map<string, string>,
  defaultSourceAlias: string | null,
  citationCorpus?: Map<string, Map<number | null, string>>,
): DeepResult {
  const root = asRecord(value) ?? {};
  const rawDocument = asRecord(root.document) ?? {};
  const normalizeEvidenceList = (input: unknown): EvidenceObj[] => (Array.isArray(input) ? input : [])
    .map((item) => normalizeEvidence(item, sourceMap, defaultSourceAlias, citationCorpus))
    .filter((item): item is EvidenceObj => Boolean(item));
  const ideaTypes = new Set<IdeaType>(['claim', 'finding', 'construct', 'method', 'framework']);
  const edgeTypes = new Set<EdgeType>(['extends', 'contradicts', 'applies_to', 'shares_method', 'precondition_of', 'measures_same', 'supports', 'refutes', 'variant_of', 'refines', 'contains']);
  const gapKinds = new Set<GapKind>(['future_work', 'limitation', 'open_question', 'unresolved_contradiction']);

  const ideas: DeepIdea[] = [];
  for (const [index, candidate] of (Array.isArray(root.ideas) ? root.ideas : []).entries()) {
    const raw = asRecord(candidate);
    if (!raw) continue;
    const evidence = normalizeEvidenceList(raw.evidence);
    const statement = cleanString(raw.statement ?? raw.development);
    const label = cleanString(raw.label) || derivedLabel(statement, evidence[0]?.quote);
    if (!label || !statement) continue;
    const type = ideaTypes.has(raw.type as IdeaType) ? raw.type as IdeaType : 'claim';
    ideas.push({
      id: cleanString(raw.id) || `idea-${index + 1}`,
      type,
      label,
      statement,
      role: raw.role === 'principal' ? 'principal' : 'secondary',
      development: cleanString(raw.development) || statement,
      evidence,
      theme_labels: (Array.isArray(raw.theme_labels) ? raw.theme_labels : []).map(cleanString).filter(Boolean),
      confidence: clampConfidence(raw.confidence),
      uncertainty_reason: cleanNullableString(raw.uncertainty_reason),
    });
  }

  const theme_nodes: DeepTheme[] = [];
  for (const [index, candidate] of (Array.isArray(root.theme_nodes) ? root.theme_nodes : []).entries()) {
    const raw = asRecord(candidate);
    if (!raw) continue;
    const evidence = normalizeEvidenceList(raw.evidence);
    const statement = cleanString(raw.statement);
    const label = cleanString(raw.label) || derivedLabel(statement, evidence[0]?.quote);
    if (!label) continue;
    theme_nodes.push({
      id: cleanString(raw.id) || `theme-${index + 1}`,
      label,
      statement: statement || label,
      role: raw.role === 'primary' ? 'primary' : 'secondary',
      evidence,
      confidence: clampConfidence(raw.confidence),
    });
  }

  const internal_relations: DeepResult['internal_relations'] = [];
  for (const candidate of Array.isArray(root.internal_relations) ? root.internal_relations : []) {
    const raw = asRecord(candidate);
    const from = cleanString(raw?.from);
    const to = cleanString(raw?.to);
    if (!raw || !from || !to || !edgeTypes.has(raw.type as EdgeType)) continue;
    internal_relations.push({
      from,
      to,
      type: raw.type as EdgeType,
      basis: raw.basis === 'explicit' ? 'explicit' : 'inferred',
      evidence: normalizeEvidence(raw.evidence, sourceMap, defaultSourceAlias, citationCorpus) ?? { quote: '', location: null, source_ref: null, page_number: null, kind: 'paraphrased' },
      confidence: clampConfidence(raw.confidence),
    });
  }

  const external_references: DeepResult['external_references'] = [];
  for (const candidate of Array.isArray(root.external_references) ? root.external_references : []) {
    const raw = asRecord(candidate);
    const from = cleanString(raw?.from);
    const citedWork = cleanString(raw?.cited_work);
    if (!raw || !from || !citedWork || !edgeTypes.has(raw.type as EdgeType)) continue;
    external_references.push({
      from,
      cited_work: citedWork,
      type: raw.type as EdgeType,
      basis: raw.basis === 'explicit' ? 'explicit' : 'inferred',
      evidence: normalizeEvidence(raw.evidence, sourceMap, defaultSourceAlias, citationCorpus) ?? { quote: '', location: null, source_ref: null, page_number: null, kind: 'paraphrased' },
      confidence: clampConfidence(raw.confidence),
    });
  }

  const gaps: DeepResult['gaps'] = [];
  for (const candidate of Array.isArray(root.gaps) ? root.gaps : []) {
    const raw = asRecord(candidate);
    const statement = cleanString(raw?.statement);
    if (!raw || !statement || !gapKinds.has(raw.kind as GapKind)) continue;
    gaps.push({
      kind: raw.kind as GapKind,
      statement,
      related_idea: cleanNullableString(raw.related_idea),
      evidence: normalizeEvidence(raw.evidence, sourceMap, defaultSourceAlias, citationCorpus) ?? { quote: '', location: null, source_ref: null, page_number: null, kind: 'paraphrased' },
      confidence: clampConfidence(raw.confidence),
    });
  }

  const authors_detail = (Array.isArray(root.authors_detail) ? root.authors_detail : [])
    .map(asRecord)
    .filter((raw): raw is Record<string, unknown> => Boolean(raw && cleanString(raw.name)))
    .map((raw) => ({ name: cleanString(raw.name), affiliation: cleanNullableString(raw.affiliation), stance_notes: cleanNullableString(raw.stance_notes) }));

  return {
    document: {
      processing_status: cleanString(rawDocument.processing_status) || 'processed',
      type: cleanString(rawDocument.type) || 'unknown',
      language: cleanString(rawDocument.language) || 'unknown',
      notes: cleanNullableString(rawDocument.notes),
    },
    theme_nodes,
    ideas,
    internal_relations,
    external_references,
    gaps,
    authors_detail,
  };
}

/** Merge ideas sharing the same canonical label across chunks of the same work. */
/**
 * A checkpointed chunk result that is safe to reuse, or null to analyse the chunk again.
 *
 * normalizeDeepResult is TOTAL: it turns any input at all — `{}`, a number, a string, an
 * old schema — into a well-formed DeepResult. Feeding it a checkpoint the resume path had
 * only tested for truthiness therefore produced an EMPTY result that sailed through the
 * strict guard: the chunk was skipped, its ideas were lost, the emptied result was written
 * back over the checkpoint, and the work still finished as 'done' with no error anywhere.
 * So the RAW row is checked first: a checkpoint already shaped like a deep result is worth
 * repairing (that is how label-less ideas from older runs are rescued), and anything else
 * is not a result at all and must be re-analysed.
 */
export function usableCheckpoint(
  saved: unknown,
  sourceMap: Map<string, string>,
  defaultSourceAlias: string | null,
  citationCorpus?: Map<string, Map<number | null, string>>,
): DeepResult | null {
  if (!saved || !isRawDeepResult(saved)) return null;
  const normalized = normalizeDeepResult(saved, sourceMap, defaultSourceAlias, citationCorpus);
  return isDeepResult(normalized) ? normalized : null;
}

export function mergeByLabel(results: DeepResult[]): {
  ideas: Map<string, DeepIdea>;
  themes: Map<string, DeepTheme>;
  internal: DeepResult['internal_relations'];
  external: DeepResult['external_references'];
  gaps: DeepResult['gaps'];
  authors: DeepResult['authors_detail'];
} {
  const ideas = new Map<string, DeepIdea>();
  const themes = new Map<string, DeepTheme>();
  const internal: DeepResult['internal_relations'] = [];
  const external: DeepResult['external_references'] = [];
  const gaps: DeepResult['gaps'] = [];
  const authors: DeepResult['authors_detail'] = [];

  for (const r of results) {
    // Local ids are scoped to one model response. Providers routinely reuse i1,
    // i2, … in every chunk, so resolve endpoints before adding that chunk to the
    // aggregate instead of keeping one cross-chunk map that later entries overwrite.
    const localToLabel = new Map<string, string>();
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
    const remap = (id: string) => localToLabel.get(id) ?? id;
    internal.push(...(r.internal_relations ?? []).map((relation) => ({
      ...relation, from: remap(relation.from), to: remap(relation.to),
    })));
    external.push(...(r.external_references ?? []).map((reference) => ({
      ...reference, from: remap(reference.from),
    })));
    gaps.push(...(r.gaps ?? []).map((gap) => ({
      ...gap, related_idea: gap.related_idea ? remap(gap.related_idea) : gap.related_idea,
    })));
    authors.push(...(r.authors_detail ?? []));
  }

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

function combineDeepResults(results: DeepResult[]): DeepResult {
  const first = results[0];
  return {
    document: first?.document ?? { processing_status: 'processed', type: 'unknown', language: 'unknown', notes: null },
    theme_nodes: results.flatMap((result) => result.theme_nodes ?? []),
    ideas: results.flatMap((result) => result.ideas),
    internal_relations: results.flatMap((result) => result.internal_relations),
    external_references: results.flatMap((result) => result.external_references),
    gaps: results.flatMap((result) => result.gaps),
    authors_detail: results.flatMap((result) => result.authors_detail),
  };
}

function citationCorpusFor(doc: ExtractedDoc): Map<string, Map<number | null, string>> {
  const corpus = new Map<string, Map<number | null, string>>();
  for (const segment of doc.segments ?? []) {
    const pages = new Map<number | null, string>();
    const matches = [...segment.text.matchAll(/\[\[p\.\s*(\d+)\]\]/gi)];
    if (matches.length === 0) {
      pages.set(null, segment.text);
    } else {
      for (let index = 0; index < matches.length; index++) {
        const page = Number(matches[index][1]);
        const start = (matches[index].index ?? 0) + matches[index][0].length;
        const end = matches[index + 1]?.index ?? segment.text.length;
        pages.set(page, segment.text.slice(start, end));
      }
    }
    corpus.set(segment.sourceRef, pages);
  }
  return corpus;
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
    if (work.deep_hash === hash && work.source_type === doc.sourceType) {
      // Queueing marks the row pending before this function reads it. Restore the
      // committed status explicitly when the resolved corpus is byte-identical.
      setDeepResult(work.nodus_id, 'done', hash, work.source_type, work.notes);
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
    // A vision-only local model (Qwen3.5-0.8B, LFM2.5) loops inside the JSON and returns 0 ideas.
    // The UI blocks picking one for this role, but a value set before that guard existed could still
    // reach here — fail once with an actionable message (config error → the queue pauses) instead of
    // burning minutes per work to produce nothing.
    if (!modelRefSupportsExtraction(extractionModel)) {
      throw new AiError(
        `El modelo «${extractionModel?.model}» es de visión y no puede extraer ideas. Elige Gemma 4 E2B u otro modelo mayor como modelo de extracción en Ajustes → Modelos de IA.`,
        false,
        true,
      );
    }
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
    const sourceMap = new Map((doc.segments ?? []).map((segment) => [segment.marker, segment.sourceRef]));
    const citationCorpus = citationCorpusFor(doc);

    // Load any previously checkpointed chunk results so we can resume after a failure.
    const checkpoints = loadCheckpoints(work.nodus_id, hash, 'deep_chunk');

    const llmDone = startPerf('deep LLM extraction', perf, { chunks: chunks.length, mode: chunkPlan.mode });
    for (let i = 0; i < chunks.length; i++) {
      // Resume from checkpoint if available.
      const defaultSourceAlias = chunks[i].match(/\[\[src:([^\]\s]+)/i)?.[1] ?? null;
      const reusable = usableCheckpoint(checkpoints.get(i), sourceMap, defaultSourceAlias, citationCorpus);
      if (reusable) {
        results.push(reusable);
        // Upgrade legacy checkpoints in place so every later resume is strict.
        saveCheckpoint(work.nodus_id, hash, 'deep_chunk', i, reusable);
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
        available_sources: (doc.segments ?? []).map((segment) => ({
          marker: segment.marker,
          source_ref: segment.sourceRef,
          title: segment.displayName,
          has_page_markers: segment.hasPageMarkers,
        })),
        context_mode: chunkPlan.mode,
        analysis_limits: {
          max_ideas: chunkPlan.maxIdeasPerChunk,
          max_internal_relations: chunkPlan.maxRelationsPerChunk,
          max_gaps: chunkPlan.maxGapsPerChunk,
          target_chunk_words: chunkPlan.chunkWords,
          overlap_words: chunkPlan.overlapWords,
        },
        format_note: 'El texto usa marcadores [[src:sN p.N]]. Copia sN en source y N en page. Si el marcador no incluye página, no inventes page ni location.',
        chunk: { index: i, total: chunks.length, word_count: chunkWordCount, text: chunks[i] },
      };
      const chunkDone = startPerf('deep LLM chunk', perf, {
        chunk: `${i + 1}/${chunks.length}`,
        words: chunkWordCount,
        maxIdeas: chunkPlan.maxIdeasPerChunk,
      });
      try {
        const baseMaxTokens = chunkPlan.mode === 'long' ? 12000 : 8000;
        const adaptive = { leaves: 0 };
        const completeAdaptive = async (chunkText: string, depth: number, maxTokens: number): Promise<DeepResult> => {
          const requestInput = {
            ...input,
            chunk: {
              ...input.chunk,
              word_count: chunkText.split(/\s+/).filter(Boolean).length,
              text: chunkText,
            },
          };
          try {
            const rawResult = await completeJson<Record<string, unknown>>(
              {
                system: PROMPT_DEEP,
                user: JSON.stringify(requestInput),
                temperature: 0.15,
                maxTokens,
                perf,
              },
              isRawDeepResult,
              extractionModel
            );
            const alias = chunkText.match(/\[\[src:([^\]\s]+)/i)?.[1] ?? defaultSourceAlias;
            const normalized = normalizeDeepResult(rawResult, sourceMap, alias, citationCorpus);
            if (!isDeepResult(normalized)) throw new AiError('La respuesta normalizada no cumple el esquema profundo.', false);
            adaptive.leaves += 1;
            return normalized;
          } catch (error) {
            const aiError = error instanceof AiError ? error : null;
            const recoverableJson = aiError?.code === 'output_truncated' || /json|esquema|truncad|límite de salida/i.test(error instanceof Error ? error.message : String(error));
            const words = chunkText.split(/\s+/).filter(Boolean).length;
            if (!recoverableJson || depth >= 4 || words < 400 || adaptive.leaves >= 16) throw error;

            // First use any output headroom. If the provider still clips the object,
            // split on the marker-aware chunker and merge only strict child results.
            if (depth === 0 && maxTokens < 16000) {
              try {
                return await completeAdaptive(chunkText, depth + 1, Math.min(16000, maxTokens * 2));
              } catch (expandedError) {
                const expandedAi = expandedError instanceof AiError ? expandedError : null;
                if (expandedAi?.code !== 'output_truncated' && !/json|esquema|truncad|límite de salida/i.test(expandedError instanceof Error ? expandedError.message : String(expandedError))) throw expandedError;
              }
            }
            const childWords = Math.max(500, Math.min(5000, Math.ceil(words / 2)));
            const children = planTextChunks(chunkText, { mode: 'standard', standardChunkWords: childWords }).chunks;
            if (children.length < 2 || adaptive.leaves + children.length > 16) throw error;
            const childResults: DeepResult[] = [];
            for (const child of children) childResults.push(await completeAdaptive(child, depth + 1, baseMaxTokens));
            return combineDeepResults(childResults);
          }
        };
        const result = await completeAdaptive(chunks[i], 0, baseMaxTokens);
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
    const existingDeepThemeLabels = getWorkThemeLabels(work.nodus_id);
    const plannedThemeLabels: string[] = [];
    const plannedThemeKeys = new Set<string>();
    for (const label of [...deepThemeLabels, ...existingDeepThemeLabels]) {
      const key = normalizeThemeLabel(label);
      if (!key || plannedThemeKeys.has(key)) continue;
      plannedThemeKeys.add(key);
      plannedThemeLabels.push(label);
      if (plannedThemeLabels.length >= 4) break;
    }
    const allowedThemeLabels = new Map(plannedThemeLabels.map((label) => [normalizeThemeLabel(label), label]));

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
      await withFusionLock(async () => {
        const plans: FusionPlan[] = [];
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
          plans.push(await planIdeaFusion(ext, {
            model: fusionModel,
            perf,
            embedding: embeddings[i] ?? null,
            embeddingText,
            themes: ideaThemeLabels,
          }));
        }

        // No user-visible deep row is changed until every model/embedding decision is
        // ready. A write error rolls the whole replacement back to the previous result.
        getDb().transaction(() => {
          purgeDeepData(work.nodus_id);
          unionWorkThemes(work.nodus_id, deepThemeLabels, 4);
          for (let i = 0; i < preparedIdeas.length; i++) {
            const { labelKey, idea, ideaThemeLabels } = preparedIdeas[i];
            const globalId = applyFusionPlan(plans[i], work.nodus_id);
            labelToGlobal.set(labelKey, globalId);
            setIdeaThemeLinks(work.nodus_id, globalId, ideaThemeLabels, idea.confidence, 'explicit');
            upsertOccurrence(globalId, work.nodus_id, idea.role, idea.development, idea.confidence);
            for (const ev of idea.evidence) {
              addEvidence(globalId, work.nodus_id, ev.quote, ev.location, ev.kind, { sourceRef: ev.source_ref, pageNumber: ev.page_number });
            }
          }

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

          for (const ref of merged.external) {
            const from = labelToGlobal.get(ref.from);
            if (!from) continue;
            const evId = ref.evidence?.quote
              ? addEvidence(from, work.nodus_id, ref.evidence.quote, ref.evidence.location, ref.evidence.kind, { sourceRef: ref.evidence.source_ref, pageNumber: ref.evidence.page_number })
              : null;
            addExternalRef(work.nodus_id, from, ref.cited_work, ref.type, ref.basis, ref.confidence, evId);
          }

          for (const g of merged.gaps) {
            const related = g.related_idea ? labelToGlobal.get(g.related_idea) ?? null : null;
            const evId = g.evidence?.quote
              ? addEvidence(related ?? labelToGlobal.values().next().value ?? '', work.nodus_id, g.evidence.quote, g.evidence.location, g.evidence.kind, { sourceRef: g.evidence.source_ref, pageNumber: g.evidence.page_number })
              : null;
            addGap(work.nodus_id, g.kind, g.statement, related, g.confidence, evId);
          }

          const affiliationByKey = new Map<string, string | null>();
          for (const author of merged.authors) {
            const key = canonicalKeyFromDisplay(author.name);
            if (key && author.affiliation && !affiliationByKey.get(key)) affiliationByKey.set(key, author.affiliation);
          }
          linkZoteroAuthors(work.nodus_id, { createIfMissing: true, affiliationByKey });
          setDeepResult(work.nodus_id, 'done', hash, doc.sourceType, merged.ideas.size === 0 ? doc.notes ?? null : null);
          recordLinkedLibraryAnalysis({
            workId: work.nodus_id,
            components: ['deep', 'ideas', 'embeddings'],
            documentFingerprint: hash,
          });
          recomputeAuthorRelations();
          clearCheckpoints(work.nodus_id, hash, 'deep_chunk');
        })();
      });
      fusionDone({ mapped: labelToGlobal.size });
    } catch (e) {
      embeddingDone({ status: 'error', error: e instanceof Error ? e.message : String(e) });
      fusionDone({ status: 'error', error: e instanceof Error ? e.message : String(e) });
      throw e;
    }

    totalDone({ status: 'done', ideas: merged.ideas.size });
  } catch (e) {
    totalDone({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}
