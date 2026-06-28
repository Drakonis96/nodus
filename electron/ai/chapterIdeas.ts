// Phase 1 + 2 of "chapter relations": distil the uploaded chapter into its own
// ideas (kept apart from the curated graph), embed them, and discover TYPED
// relations with the whole library (corpus ideas, the user's notes, full-text
// passages and work summaries). Symmetric idea↔idea matching is far sharper than
// matching raw prose chunks, and the typed relations drive both a relations view
// and better insertion suggestions.
import crypto from 'node:crypto';
import type {
  AnalyzeChapterRelationsRequest,
  ChapterIdeaRelation,
  ChapterIdeaType,
  ChapterRelationsProgress,
  ChapterRelationsResult,
  ChapterRelationTargetKind,
  ChapterRelationType,
  ModelRef,
  ProjectChapterIdea,
} from '@shared/types';
import { completeJson, embedMany } from './aiClient';
import { getChapter, listChapterChunks } from '../db/projectsRepo';
import {
  chapterIdeaEmbeddings,
  chapterIdeasSourceHash,
  listChapterIdeaRelations,
  listChapterIdeas,
  replaceChapterIdeaRelations,
  replaceChapterIdeas,
  type NewChapterIdea,
  type NewChapterIdeaRelation,
} from '../db/projectChapterIdeasRepo';
import { findSimilarIdeas, getIdeaSummary } from '../db/ideasRepo';
import { findSimilarNotes, getNote, noteEmbeddingText, notesNeedingEmbedding, updateNoteEmbedding } from '../db/notesRepo';
import { findSimilarPassages, getPassageDetail } from '../db/passagesRepo';
import { findSimilarWorks } from '../db/workSummariesRepo';
import { getWork } from '../db/worksRepo';

const EXTRACT_MAX_CHUNKS = 48;
const EXTRACT_CHUNK_BATCH = 6;
const MAX_CHAPTER_IDEAS = 40;
const CANDIDATES_PER_IDEA = 6;
const RELATION_MIN_SIMILARITY = 0.3;
const TYPING_IDEA_BATCH = 6;
const RELATION_TYPES: ChapterRelationType[] = ['supports', 'contradicts', 'refines', 'extends', 'related'];
const IDEA_TYPES: ChapterIdeaType[] = ['claim', 'finding', 'construct', 'method', 'framework'];

// ── Progress fan-out ─────────────────────────────────────────────────────────
type ProgressListener = (p: ChapterRelationsProgress) => void;
const listeners = new Set<ProgressListener>();
export function onChapterRelationsProgress(cb: ProgressListener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function emit(p: ChapterRelationsProgress): void {
  for (const listener of listeners) listener(p);
}

function chapterText(currentMarkdown: string): string {
  return currentMarkdown.replace(/\r\n/g, '\n').trim();
}
function hashText(text: string): string {
  return crypto.createHash('sha1').update(text).digest('hex');
}
function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trim()}…`;
}
function sampleEvenly<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;
  const step = items.length / count;
  const out: T[] = [];
  for (let i = 0; i < count; i++) out.push(items[Math.floor(i * step)]);
  return out;
}
function ideaEmbeddingText(idea: { type: string; label: string; statement: string }): string {
  return `tipo: ${idea.type}\netiqueta: ${idea.label}\nenunciado: ${idea.statement}`;
}

// ── Extraction ───────────────────────────────────────────────────────────────
interface RawIdea {
  type?: string;
  label?: string;
  statement?: string;
}
interface ExtractResponse {
  ideas: RawIdea[];
}
function isExtractResponse(v: unknown): v is ExtractResponse {
  return Boolean(v && typeof v === 'object' && Array.isArray((v as ExtractResponse).ideas));
}

async function extractChapterIdeas(
  chunks: { headingPath: string; text: string }[],
  model: ModelRef | null | undefined
): Promise<RawIdea[]> {
  const sampled = sampleEvenly(chunks, EXTRACT_MAX_CHUNKS);
  const batches: { headingPath: string; text: string }[][] = [];
  for (let i = 0; i < sampled.length; i += EXTRACT_CHUNK_BATCH) batches.push(sampled.slice(i, i + EXTRACT_CHUNK_BATCH));

  const collected: RawIdea[] = [];
  for (const batch of batches) {
    try {
      const res = await completeJson<ExtractResponse>(
        {
          system: [
            'Eres un analista academico dentro de Nodus.',
            'Extrae las ideas ATOMICAS del fragmento de manuscrito que recibes: afirmaciones, hallazgos, constructos, metodos o marcos.',
            'Cada idea es una unidad autocontenida y parafraseada (no copies frases largas literales).',
            'No inventes nada que no este en el texto. Si el fragmento es puro relato o transicion, devuelve pocas o ninguna idea.',
            'Devuelve solo JSON {"ideas":[{"type":"claim|finding|construct|method|framework","label":"titulo breve","statement":"1-2 frases"}]}',
          ].join('\n'),
          user: JSON.stringify(
            { fragmentos: batch.map((chunk) => ({ heading: chunk.headingPath, text: clip(chunk.text, 2200) })) },
            null,
            2
          ),
          temperature: 0.1,
          maxTokens: 3000,
        },
        isExtractResponse,
        model
      );
      collected.push(...res.ideas);
    } catch {
      // A failed batch shouldn't abort the whole extraction; skip it.
    }
  }
  return dedupeIdeas(collected).slice(0, MAX_CHAPTER_IDEAS);
}

function normalizeIdeaType(value: unknown): ChapterIdeaType {
  return IDEA_TYPES.includes(String(value) as ChapterIdeaType) ? (value as ChapterIdeaType) : 'claim';
}
function dedupeIdeas(ideas: RawIdea[]): RawIdea[] {
  const seen = new Set<string>();
  const out: RawIdea[] = [];
  for (const idea of ideas) {
    const label = (idea.label ?? '').trim();
    const statement = (idea.statement ?? '').trim();
    if (!statement) continue;
    const key = (label || statement).toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type: normalizeIdeaType(idea.type), label: label || clip(statement, 60), statement });
  }
  return out;
}

// ── Candidate retrieval across the library ───────────────────────────────────
export interface Candidate {
  kind: ChapterRelationTargetKind;
  id: string;
  similarity: number;
  text: string; // short text shown to the typing model
}

export function gatherCandidates(vector: number[]): Candidate[] {
  const candidates: Candidate[] = [];
  for (const hit of findSimilarIdeas(vector, RELATION_MIN_SIMILARITY, CANDIDATES_PER_IDEA)) {
    candidates.push({ kind: 'idea', id: hit.global_id, similarity: hit.similarity, text: `${hit.label}: ${hit.statement}` });
  }
  for (const hit of findSimilarNotes(vector, RELATION_MIN_SIMILARITY, CANDIDATES_PER_IDEA)) {
    candidates.push({ kind: 'note', id: hit.id, similarity: hit.similarity, text: `${hit.title}: ${hit.content}` });
  }
  for (const hit of findSimilarPassages(vector, RELATION_MIN_SIMILARITY, CANDIDATES_PER_IDEA)) {
    candidates.push({ kind: 'passage', id: hit.passage_id, similarity: hit.similarity, text: `${hit.title}: ${hit.text}` });
  }
  for (const hit of findSimilarWorks(vector, RELATION_MIN_SIMILARITY, CANDIDATES_PER_IDEA)) {
    candidates.push({ kind: 'work', id: hit.nodus_id, similarity: hit.similarity, text: hit.summary });
  }
  return candidates.sort((a, b) => b.similarity - a.similarity).slice(0, CANDIDATES_PER_IDEA);
}

// ── Typing ───────────────────────────────────────────────────────────────────
export interface RawRelation {
  chapterIdeaId?: string;
  targetKind?: string;
  targetId?: string;
  relation?: string;
  confidence?: number;
  rationale?: string;
}
interface TypeResponse {
  relations: RawRelation[];
}
function isTypeResponse(v: unknown): v is TypeResponse {
  return Boolean(v && typeof v === 'object' && Array.isArray((v as TypeResponse).relations));
}
export function normalizeRelationType(value: unknown): ChapterRelationType {
  return RELATION_TYPES.includes(String(value) as ChapterRelationType) ? (value as ChapterRelationType) : 'related';
}
export function clamp01(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

export async function typeRelations(
  ideas: { id: string; label: string; statement: string }[],
  candidatesByIdea: Map<string, Candidate[]>,
  model: ModelRef | null | undefined
): Promise<Map<string, RawRelation>> {
  // keyed by `${chapterIdeaId}|${targetKind}:${targetId}`
  const typed = new Map<string, RawRelation>();
  const withCandidates = ideas.filter((idea) => (candidatesByIdea.get(idea.id)?.length ?? 0) > 0);
  for (let i = 0; i < withCandidates.length; i += TYPING_IDEA_BATCH) {
    const batch = withCandidates.slice(i, i + TYPING_IDEA_BATCH);
    try {
      const res = await completeJson<TypeResponse>(
        {
          system: [
            'Eres un analista academico dentro de Nodus.',
            'Para cada idea del manuscrito y cada candidato de la biblioteca, clasifica la relacion.',
            'relation: "supports" (el candidato respalda la idea), "contradicts" (la contradice/tensiona), "refines" (la matiza), "extends" (la amplia) o "related" (relacion tematica sin direccion clara).',
            'Usa exactamente los ids (chapterIdeaId, targetKind, targetId) que recibes. No inventes pares nuevos.',
            'Devuelve solo JSON {"relations":[{"chapterIdeaId","targetKind","targetId","relation","confidence":0..1,"rationale":"breve"}]}',
          ].join('\n'),
          user: JSON.stringify(
            {
              ideas_manuscrito: batch.map((idea) => ({
                chapterIdeaId: idea.id,
                label: idea.label,
                statement: clip(idea.statement, 400),
                candidatos: (candidatesByIdea.get(idea.id) ?? []).map((c) => ({
                  targetKind: c.kind,
                  targetId: c.id,
                  texto: clip(c.text, 400),
                })),
              })),
            },
            null,
            2
          ),
          temperature: 0.1,
          maxTokens: 4000,
        },
        isTypeResponse,
        model
      );
      for (const rel of res.relations) {
        if (!rel.chapterIdeaId || !rel.targetKind || !rel.targetId) continue;
        typed.set(`${rel.chapterIdeaId}|${rel.targetKind}:${rel.targetId}`, rel);
      }
    } catch {
      // Fall back to untyped 'related' for this batch (handled by the caller).
    }
  }
  return typed;
}

// ── Embedding notes on demand ────────────────────────────────────────────────
async function ensureNotesEmbedded(): Promise<void> {
  const pending = notesNeedingEmbedding();
  if (pending.length === 0) return;
  const texts = pending.map((note) => noteEmbeddingText(note));
  const vectors = await embedMany(texts);
  pending.forEach((note, index) => {
    const vector = vectors[index];
    if (vector) updateNoteEmbedding(note.id, texts[index], vector);
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Resolve display metadata for a relation target. */
export function resolveTarget(kind: ChapterRelationTargetKind, id: string): { label: string; subtitle: string | null } {
  try {
    if (kind === 'idea') {
      const idea = getIdeaSummary(id);
      return { label: idea?.label ?? id, subtitle: idea?.type ?? null };
    }
    if (kind === 'note') {
      const note = getNote(id);
      return { label: note?.title || '(nota sin título)', subtitle: 'nota' };
    }
    if (kind === 'work') {
      const work = getWork(id);
      const author = work?.authors?.[0];
      const sub = [author, work?.year ? String(work.year) : null].filter(Boolean).join(' · ') || null;
      return { label: work?.title ?? id, subtitle: sub };
    }
    if (kind === 'passage') {
      const passage = getPassageDetail(id);
      if (!passage) return { label: id, subtitle: 'pasaje' };
      const sub = [passage.work.authors[0], passage.page_label ? `p. ${passage.page_label}` : null].filter(Boolean).join(' · ');
      return { label: passage.work.title, subtitle: sub || 'pasaje' };
    }
  } catch {
    /* fall through */
  }
  return { label: id, subtitle: null };
}

/** Build the result view from whatever is currently stored (no AI). */
export function getChapterRelations(chapterId: string): ChapterRelationsResult {
  const ideas = listChapterIdeas(chapterId);
  const relRows = listChapterIdeaRelations(chapterId);
  const byIdea = new Map<string, ChapterIdeaRelation[]>();
  for (const row of relRows) {
    const target = resolveTarget(row.target_kind, row.target_id);
    const rel: ChapterIdeaRelation = {
      id: row.id,
      chapterIdeaId: row.chapter_idea_id,
      targetKind: row.target_kind,
      targetId: row.target_id,
      relation: row.relation,
      similarity: row.similarity,
      confidence: row.confidence,
      rationale: row.rationale,
      targetLabel: target.label,
      targetSubtitle: target.subtitle,
    };
    const list = byIdea.get(row.chapter_idea_id) ?? [];
    list.push(rel);
    byIdea.set(row.chapter_idea_id, list);
  }
  return {
    chapterId,
    analyzed: ideas.length > 0,
    available: true,
    ideas: ideas.map((idea: ProjectChapterIdea) => ({ idea, relations: byIdea.get(idea.id) ?? [] })),
  };
}

export async function analyzeChapterRelations(
  request: AnalyzeChapterRelationsRequest
): Promise<ChapterRelationsResult> {
  const chapter = getChapter(request.chapterId);
  if (!chapter) return { chapterId: request.chapterId, analyzed: false, available: true, ideas: [] };
  const model = request.model ?? null;
  const text = chapterText(chapter.currentMarkdown);
  const hash = hashText(text);

  // Cache: reuse stored ideas+relations when the text hasn't changed.
  if (!request.force && chapterIdeasSourceHash(request.chapterId) === hash) {
    return getChapterRelations(request.chapterId);
  }

  emit({ chapterId: request.chapterId, phase: 'extracting', current: 0, total: 0, message: 'Extrayendo ideas del capítulo…' });
  const chunks = listChapterChunks(request.chapterId);
  if (chunks.length === 0) return { chapterId: request.chapterId, analyzed: false, available: true, ideas: [] };

  const rawIdeas = await extractChapterIdeas(chunks, model);
  if (rawIdeas.length === 0) {
    replaceChapterIdeas(request.chapterId, chapter.projectId, hash, []);
    replaceChapterIdeaRelations(request.chapterId, []);
    emit({ chapterId: request.chapterId, phase: 'done', current: 0, total: 0, message: 'Sin ideas extraíbles.' });
    return getChapterRelations(request.chapterId);
  }

  emit({ chapterId: request.chapterId, phase: 'embedding', current: 0, total: rawIdeas.length, message: 'Indexando ideas…' });
  const embedTexts = rawIdeas.map((idea) => ideaEmbeddingText({ type: idea.type!, label: idea.label!, statement: idea.statement! }));
  const vectors = await embedMany(embedTexts);
  const available = vectors.some(Boolean);

  const newIdeas: NewChapterIdea[] = rawIdeas.map((idea, index) => ({
    type: normalizeIdeaType(idea.type),
    label: idea.label!,
    statement: idea.statement!,
    embedding: vectors[index] ?? null,
    embeddingText: embedTexts[index],
  }));
  const stored = replaceChapterIdeas(request.chapterId, chapter.projectId, hash, newIdeas);

  if (!available) {
    replaceChapterIdeaRelations(request.chapterId, []);
    emit({ chapterId: request.chapterId, phase: 'error', current: 0, total: 0, message: 'No hay proveedor de embeddings configurado.' });
    return { ...getChapterRelations(request.chapterId), available: false };
  }

  // Notes must be embedded before they can be matched.
  emit({ chapterId: request.chapterId, phase: 'relating', current: 0, total: stored.length, message: 'Buscando relaciones…' });
  await ensureNotesEmbedded();

  const embedded = chapterIdeaEmbeddings(request.chapterId);
  const embeddingById = new Map(embedded.map((row) => [row.id, row.embedding]));
  const candidatesByIdea = new Map<string, Candidate[]>();
  let done = 0;
  for (const idea of stored) {
    const vector = embeddingById.get(idea.id);
    if (vector) candidatesByIdea.set(idea.id, gatherCandidates(vector));
    done += 1;
    if (done % 5 === 0) emit({ chapterId: request.chapterId, phase: 'relating', current: done, total: stored.length, message: 'Buscando relaciones…' });
  }

  const typed = await typeRelations(
    stored.map((idea) => ({ id: idea.id, label: idea.label, statement: idea.statement })),
    candidatesByIdea,
    model
  );

  const relations: NewChapterIdeaRelation[] = [];
  for (const [chapterIdeaId, candidates] of candidatesByIdea) {
    for (const candidate of candidates) {
      const hit = typed.get(`${chapterIdeaId}|${candidate.kind}:${candidate.id}`);
      relations.push({
        chapterIdeaId,
        targetKind: candidate.kind,
        targetId: candidate.id,
        relation: normalizeRelationType(hit?.relation),
        similarity: candidate.similarity,
        confidence: hit ? clamp01(hit.confidence) : candidate.similarity,
        rationale: clip(hit?.rationale ?? '', 400),
      });
    }
  }
  replaceChapterIdeaRelations(request.chapterId, relations);

  emit({ chapterId: request.chapterId, phase: 'done', current: stored.length, total: stored.length, message: 'Análisis completado.' });
  return getChapterRelations(request.chapterId);
}
