import type {
  ChapterSuggestionKind,
  ChapterSuggestionOperation,
  CitationRef,
  GenerateProjectSuggestionsRequest,
  ProjectChapterChunk,
  ProjectInsertionSuggestion,
  ProjectLink,
} from '@shared/types';
import { completeJson } from './aiClient';
import {
  citationUrl,
  dedupeRefs,
  extractCitationRefs,
  normalizeRefs,
  stripDisallowedCitations,
} from './citationSanitize';
import { verifyCitations } from '../citations/verifyCitations';
import * as projects from '../db/projectsRepo';
import { getIdeaDetail, getEdgeDetail, getIdeaEdges } from '../db/ideasRepo';
import { getGapDetail } from '../db/gapsRepo';
import { getNote, getNotesTree } from '../db/notesRepo';
import { getWork } from '../db/worksRepo';

const MATERIAL_LIMIT = 36;
const SHORT_CHAPTER_WORDS = 3200;
const FULL_CONTEXT_CHUNK_LIMIT = 30;
const LONG_CONTEXT_CHUNK_LIMIT = 16;

interface SourceMaterial {
  kind: ChapterSuggestionKind;
  refId: string;
  label: string;
  summary: string;
  /** Primary citation(s) for this material (the idea/work/gap/contradiction itself). */
  citationRefs: CitationRef[];
  /** Ideas this one connects to in the graph — citable so a suggestion can link them too. */
  relatedRefs: CitationRef[];
  citationMarkdown: string;
  strong: boolean;
  role: ProjectLink['role'] | 'section_note';
}

const RELATION_VERB: Record<string, string> = {
  supports: 'apoya a',
  refutes: 'refuta a',
  contradicts: 'contradice a',
  refines: 'matiza a',
  extends: 'extiende a',
  contains: 'engloba a',
};

interface AiSuggestion {
  targetChunkId?: string | null;
  kind?: ChapterSuggestionKind;
  refId?: string;
  operation?: ChapterSuggestionOperation;
  proposedText?: string;
  citationRefs?: CitationRef[];
  rationale?: string;
  confidence?: number;
}

interface AiResponse {
  suggestions: AiSuggestion[];
}

function isAiResponse(value: unknown): value is AiResponse {
  if (!value || typeof value !== 'object') return false;
  const suggestions = (value as AiResponse).suggestions;
  return Array.isArray(suggestions);
}

export async function generateProjectSuggestions(
  request: GenerateProjectSuggestionsRequest
): Promise<ProjectInsertionSuggestion[]> {
  const detail = projects.getProjectDetail(request.projectId);
  const chapter = projects.getChapter(request.chapterId);
  if (!detail || !chapter || chapter.projectId !== request.projectId) return [];

  const allChunks = projects.listChapterChunks(chapter.id);
  const materials = gatherMaterials(detail.links, request.sectionId ?? chapter.sectionId).slice(0, MATERIAL_LIMIT);
  if (materials.length === 0 || allChunks.length === 0) return [];

  const selectedChunks = selectRelevantChunks(chapter.wordCount, allChunks, materials);
  // Aim high so a single pass surfaces every well-grounded insertion at once
  // instead of dribbling them out one click at a time.
  const limit = Math.max(1, Math.min(request.limit ?? 16, 24));
  let raw: AiSuggestion[] = [];
  try {
    const ai = await completeJson<AiResponse>(
      {
        system: [
          'Eres un asistente academico dentro de Nodus.',
          'Tu tarea es proponer inserciones puntuales para un capitulo de manuscrito usando SOLO los materiales del proyecto que recibes.',
          'Se EXHAUSTIVO: genera todas las inserciones bien fundamentadas que encuentres, idealmente una por material relevante para el capitulo. No te limites a una sola sugerencia.',
          'No copies literalmente evidencia ni texto de las fuentes. Parafrasea siempre, salvo que se pida una cita textual, que aqui no se pide.',
          'Cada texto propuesto debe incluir al menos una cita Markdown nodus:// verificable.',
          'Cita SOLO con los ids exactos que aparecen en "citationRefs" y "relatedRefs" de cada material. Tipos de cita validos: idea, work, gap, contradiction. NO cites pasajes ni uses ids de chunk.',
          'Cuando un material conecta con otras ideas (relatedRefs), enlaza tambien esas ideas en el texto con su cita nodus:// para mostrar la conexion.',
          'Nunca inventes ids, autores, anos, obras ni fuentes. Si no puedes sostener una propuesta con una fuente disponible, no la incluyas.',
          'Devuelve solo JSON valido con la forma {"suggestions":[...]}',
        ].join('\n'),
        user: JSON.stringify(
          {
            proyecto: {
              titulo: detail.project.title,
              brief: detail.project.brief,
              modo: request.mode,
            },
            capitulo: {
              titulo: chapter.title,
              wordCount: chapter.wordCount,
              estrategia: chapter.wordCount > SHORT_CHAPTER_WORDS ? 'retrieval_por_chunks' : 'texto_acotado',
              chunks: selectedChunks.map((chunk) => ({
                id: chunk.id,
                heading: chunk.headingPath,
                text: clip(chunk.text, 1800),
              })),
            },
            materiales: materials.map((material) => ({
              kind: material.kind,
              refId: material.refId,
              label: material.label,
              role: material.role,
              summary: clip(material.summary, 1400),
              citationRefs: material.citationRefs,
              relatedRefs: material.relatedRefs,
              citationMarkdown: material.citationMarkdown,
              autoApplicable: material.strong,
            })),
            salida_esperada: {
              suggestions: [
                {
                  targetChunkId: 'id exacto de chunk',
                  kind: 'idea|gap|debate|work|note',
                  refId: 'id exacto del material usado',
                  operation: 'insert_after',
                  proposedText: '1 parrafo breve, parafraseado, con una o varias citas Markdown nodus:// (incluye las ideas conectadas cuando aporten)',
                  citationRefs: [{ kind: 'idea|work|gap|contradiction', id: 'id exacto de citationRefs/relatedRefs' }],
                  rationale: 'por que encaja aqui',
                  confidence: 0.72,
                },
              ],
            },
          },
          null,
          2
        ),
        temperature: 0.1,
        maxTokens: 8000,
      },
      isAiResponse,
      request.model ?? detail.project.model
    );
    raw = ai.suggestions.slice(0, limit * 2);
  } catch {
    raw = fallbackSuggestions(selectedChunks, materials, limit);
  }

  // Accumulate across clicks: skip suggestions already stored for the same
  // chunk+material so repeated runs add only what's new, then return the full set.
  const existing = projects.listSuggestions(chapter.id);
  const existingKeys = new Set(existing.map((s) => `${s.targetChunkId ?? ''}:${s.kind}:${s.refId}`));
  const normalized = normalizeSuggestions(raw, {
    projectId: request.projectId,
    chapterId: chapter.id,
    chunks: allChunks,
    materials,
    limit,
  }).filter((s) => !existingKeys.has(`${s.targetChunkId ?? ''}:${s.kind}:${s.refId}`));
  if (normalized.length > 0) projects.saveSuggestions(normalized);
  return projects.listSuggestions(chapter.id);
}

function gatherMaterials(links: ProjectLink[], sectionId: string | null | undefined): SourceMaterial[] {
  const materials: SourceMaterial[] = [];
  const includeLink = (link: ProjectLink) => !sectionId || !link.sectionId || link.sectionId === sectionId;
  for (const link of links.filter(includeLink)) {
    materials.push(...materialFromLink(link));
    if (link.kind === 'folder') materials.push(...materialsFromFolder(link.refId));
  }

  if (sectionId) {
    const section = projects.getSection(sectionId);
    if (section?.folderId) materials.push(...materialsFromFolder(section.folderId));
  }

  const seen = new Set<string>();
  return materials.filter((material) => {
    const key = `${material.kind}:${material.refId}:${material.citationRefs.map((ref) => `${ref.kind}:${ref.id}`).join(',')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return Boolean(material.summary.trim());
  });
}

function materialFromLink(link: ProjectLink): SourceMaterial[] {
  switch (link.kind) {
    case 'idea':
      return materialFromIdea(link.refId, link.label, link.role);
    case 'work':
      return materialFromWork(link.refId, link.label, link.role);
    case 'gap':
      return materialFromGap(link.refId, link.label, link.role);
    case 'debate':
      return materialFromDebate(link.refId, link.label, link.role);
    case 'note':
      return materialFromNote(link.refId, link.role);
    default:
      return [];
  }
}

function materialsFromFolder(folderId: string): SourceMaterial[] {
  const tree = getNotesTree();
  const folderIds = new Set<string>([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of tree.folders) {
      if (folder.parentId && folderIds.has(folder.parentId) && !folderIds.has(folder.id)) {
        folderIds.add(folder.id);
        changed = true;
      }
    }
  }
  return tree.notes
    .filter((note) => note.folderId && folderIds.has(note.folderId))
    .flatMap((note) => {
      if (note.source?.ref && note.kind === 'idea') {
        return materialFromIdea(note.source.ref, note.title, 'section_note');
      }
      return note.content.trim() ? materialFromNote(note.id, 'section_note') : [];
    });
}

function materialFromIdea(refId: string, fallbackLabel: string, role: SourceMaterial['role']): SourceMaterial[] {
  const detail = getIdeaDetail(refId);
  if (!detail) return [];
  const firstWork = detail.occurrences[0]?.work;
  const citation: CitationRef = { kind: 'idea', id: refId };
  const evidence = detail.evidence.slice(0, 2).map((e) => `Evidencia: ${e.quote}`).join('\n');
  const occurrences = detail.occurrences
    .slice(0, 3)
    .map((o) => `${authorYear(o.work.authors, o.work.year)}: ${o.development}`)
    .join('\n');

  // Surface the idea's graph connections so a suggestion can mention and link
  // the ideas it relates to (idea↔idea edges), not just the idea in isolation.
  const relatedRefs: CitationRef[] = [];
  const connectionLines: string[] = [];
  for (const edgeDetail of getIdeaEdges(refId).slice(0, 6)) {
    const isFrom = edgeDetail.edge.from_id === refId;
    const otherId = isFrom ? edgeDetail.edge.to_id : edgeDetail.edge.from_id;
    const otherLabel = isFrom ? edgeDetail.toLabel : edgeDetail.fromLabel;
    if (!otherId || otherId === refId) continue;
    relatedRefs.push({ kind: 'idea', id: otherId });
    const verb = RELATION_VERB[edgeDetail.edge.type] ?? `se relaciona (${edgeDetail.edge.type}) con`;
    connectionLines.push(`${verb} ${otherLabel} (nodus://idea/${encodeURIComponent(otherId)})`);
  }

  return [
    {
      kind: 'idea',
      refId,
      label: detail.idea.label || fallbackLabel || refId,
      summary: [
        detail.idea.statement,
        occurrences,
        evidence,
        connectionLines.length ? `Conexiones: ${connectionLines.join('; ')}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      citationRefs: [citation],
      relatedRefs: dedupeRefs(relatedRefs),
      citationMarkdown: citationMarkdown(citation, sourceLabel(firstWork?.authors, firstWork?.year)),
      strong: detail.occurrences.length > 0 || detail.evidence.length > 0,
      role,
    },
  ];
}

function materialFromWork(refId: string, fallbackLabel: string, role: SourceMaterial['role']): SourceMaterial[] {
  const work = getWork(refId);
  if (!work) return [];
  const citation: CitationRef = { kind: 'work', id: refId };
  return [
    {
      kind: 'work',
      refId,
      label: work.title || fallbackLabel || refId,
      summary: [work.title, work.notes ?? '', work.themes.join(', ')].filter(Boolean).join('\n'),
      citationRefs: [citation],
      relatedRefs: [],
      citationMarkdown: citationMarkdown(citation, sourceLabel(work.authors, work.year)),
      strong: true,
      role,
    },
  ];
}

function materialFromGap(refId: string, fallbackLabel: string, role: SourceMaterial['role']): SourceMaterial[] {
  const detail = getGapDetail(refId);
  if (!detail) return [];
  const citation: CitationRef = { kind: 'gap', id: refId };
  return [
    {
      kind: 'gap',
      refId,
      label: fallbackLabel || detail.gap.statement,
      summary: [
        detail.gap.statement,
        detail.relatedIdea ? `Idea relacionada: ${detail.relatedIdea.label} - ${detail.relatedIdea.statement}` : '',
        detail.evidence ? `Evidencia: ${detail.evidence.quote}` : '',
      ].filter(Boolean).join('\n'),
      citationRefs: [citation],
      relatedRefs: [],
      citationMarkdown: citationMarkdown(citation, sourceLabel(detail.work.authors, detail.work.year, 'hueco')),
      strong: true,
      role,
    },
  ];
}

function materialFromDebate(refId: string, fallbackLabel: string, role: SourceMaterial['role']): SourceMaterial[] {
  const detail = getEdgeDetail(refId);
  if (!detail) return [];
  const citation: CitationRef = { kind: 'contradiction', id: refId };
  const source = detail.edge.source_work ? getWork(detail.edge.source_work) : null;
  return [
    {
      kind: 'debate',
      refId,
      label: fallbackLabel || `${detail.fromLabel} / ${detail.toLabel}`,
      summary: [
        detail.explanation ?? `${detail.fromLabel} entra en tension con ${detail.toLabel}.`,
        ...detail.evidence.slice(0, 2).map((e) => `Evidencia: ${e.quote}`),
      ].join('\n'),
      citationRefs: [citation],
      relatedRefs: [],
      citationMarkdown: citationMarkdown(citation, sourceLabel(source?.authors, source?.year, 'contradiccion')),
      strong: true,
      role,
    },
  ];
}

function materialFromNote(refId: string, role: SourceMaterial['role']): SourceMaterial[] {
  const note = getNote(refId);
  if (!note) return [];
  const refs = extractCitationRefs(note.content);
  const strong = refs.length > 0 && Object.values(verifyCitations(refs)).every(Boolean);
  return [
    {
      kind: 'note',
      refId,
      label: note.title,
      summary: note.content,
      citationRefs: refs,
      relatedRefs: [],
      citationMarkdown: refs[0] ? citationMarkdown(refs[0], labelForCitation(refs[0])) : '',
      strong,
      role,
    },
  ];
}

function selectRelevantChunks(
  chapterWords: number,
  chunks: ProjectChapterChunk[],
  materials: SourceMaterial[]
): ProjectChapterChunk[] {
  if (chapterWords <= SHORT_CHAPTER_WORDS && chunks.length <= FULL_CONTEXT_CHUNK_LIMIT) return chunks;
  const scored = chunks.map((chunk) => ({
    chunk,
    score: Math.max(...materials.map((material) => lexicalOverlap(chunk.text, `${material.label}\n${material.summary}`))),
  }));
  return scored
    .sort((a, b) => b.score - a.score || a.chunk.orderIdx - b.chunk.orderIdx)
    .slice(0, LONG_CONTEXT_CHUNK_LIMIT)
    .sort((a, b) => a.chunk.orderIdx - b.chunk.orderIdx)
    .map((item) => item.chunk);
}

function fallbackSuggestions(
  chunks: ProjectChapterChunk[],
  materials: SourceMaterial[],
  limit: number
): AiSuggestion[] {
  return materials
    .filter((material) => material.strong)
    .slice(0, limit)
    .map((material) => {
      const target = bestChunkForMaterial(chunks, material);
      return {
        targetChunkId: target?.id ?? null,
        kind: material.kind,
        refId: material.refId,
        operation: 'insert_after',
        proposedText: fallbackText(material),
        citationRefs: material.citationRefs,
        rationale: 'Coincidencia lexica con el fragmento del capitulo y material vinculado al proyecto.',
        confidence: target ? Math.max(0.45, Math.min(0.72, lexicalOverlap(target.text, material.summary))) : 0.42,
      };
    });
}

function normalizeSuggestions(
  raw: AiSuggestion[],
  context: {
    projectId: string;
    chapterId: string;
    chunks: ProjectChapterChunk[];
    materials: SourceMaterial[];
    limit: number;
  }
): Omit<ProjectInsertionSuggestion, 'id' | 'createdAt' | 'updatedAt'>[] {
  const chunkIds = new Set(context.chunks.map((chunk) => chunk.id));
  const materialMap = new Map(context.materials.map((material) => [`${material.kind}:${material.refId}`, material]));
  // A ref may be cited if it's either the material itself or one of its graph
  // connections (relatedRefs) — anything else is treated as invented.
  const allowedRefs = new Set(
    context.materials.flatMap((material) =>
      [...material.citationRefs, ...material.relatedRefs].map((ref) => `${ref.kind}:${ref.id}`)
    )
  );
  const out: Omit<ProjectInsertionSuggestion, 'id' | 'createdAt' | 'updatedAt'>[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (out.length >= context.limit) break;
    const kind = normalizeKind(item.kind);
    const refId = item.refId?.trim();
    if (!refId) continue;
    const material = materialMap.get(`${kind}:${refId}`) ?? context.materials.find((m) => m.refId === refId);
    if (!material) continue;

    let proposed = cleanProposedText(item.proposedText || fallbackText(material));

    // Keep only citations the model is allowed to use AND that resolve locally.
    // The candidate set spans the model's declared refs, the material's own
    // citation and every nodus:// link present in the text (so connected-idea
    // links survive even if the model forgot to declare them). Everything else —
    // hallucinated passages, invented ids, stale refs — is dropped so it never
    // reaches the rendered text as a broken "⚠" link.
    const candidateRefs = dedupeRefs([
      ...normalizeRefs(item.citationRefs ?? []),
      ...normalizeRefs(extractCitationRefs(proposed)),
      ...material.citationRefs,
    ]);
    const verified = verifyCitations(candidateRefs);
    const validRefs = dedupeRefs(
      candidateRefs.filter((ref) => allowedRefs.has(`${ref.kind}:${ref.id}`) && verified[`${ref.kind}:${ref.id}`])
    );
    const allowedKeys = new Set(validRefs.map((ref) => `${ref.kind}:${ref.id}`));

    const targetChunkId =
      item.targetChunkId && chunkIds.has(item.targetChunkId)
        ? item.targetChunkId
        : bestChunkForMaterial(context.chunks, material)?.id ?? null;

    proposed = stripDisallowedCitations(proposed, allowedKeys);
    proposed = ensureCitation(proposed, validRefs);
    proposed = normalizeCitationLabels(proposed, validRefs);

    // The refs that genuinely remain in the sanitised text.
    const finalRefs = dedupeRefs(
      extractCitationRefs(proposed).filter((ref) => allowedKeys.has(`${ref.kind}:${ref.id}`))
    );
    const blockedReason = !material.strong
      ? 'El material no contiene una fuente nodus:// verificable.'
      : finalRefs.length === 0
        ? 'No se pudo anclar la propuesta a una fuente verificable.'
        : null;

    const key = `${targetChunkId}:${kind}:${refId}:${proposed}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      projectId: context.projectId,
      chapterId: context.chapterId,
      targetChunkId,
      kind: material.kind,
      refId: material.refId,
      refLabel: material.label,
      operation: normalizeOperation(item.operation),
      proposedText: proposed,
      citationRefs: finalRefs.length ? finalRefs : validRefs,
      rationale: clip(item.rationale || 'Sugerencia generada a partir de materiales vinculados al proyecto.', 600),
      confidence: clamp01(item.confidence),
      status: blockedReason ? 'blocked' : 'suggested',
      blockedReason,
    });
  }
  return out;
}

function bestChunkForMaterial(chunks: ProjectChapterChunk[], material: SourceMaterial): ProjectChapterChunk | null {
  let best: { chunk: ProjectChapterChunk; score: number } | null = null;
  for (const chunk of chunks) {
    const score = lexicalOverlap(chunk.text, `${material.label}\n${material.summary}`);
    if (!best || score > best.score) best = { chunk, score };
  }
  return best?.chunk ?? chunks[0] ?? null;
}

function fallbackText(material: SourceMaterial): string {
  const sentence = firstSentence(material.summary) || material.label;
  const lead =
    material.kind === 'gap'
      ? 'Este punto tambien puede formularse como un hueco de investigacion:'
      : material.kind === 'debate'
        ? 'Conviene matizar este argumento incorporando la tension detectada en la literatura:'
        : 'La literatura vinculada al proyecto permite precisar este argumento:';
  return `${lead} ${sentence} ${material.citationMarkdown}`.replace(/\s+/g, ' ').trim();
}

function cleanProposedText(text: string): string {
  return text.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function ensureCitation(text: string, refs: CitationRef[]): string {
  if (refs.length === 0) return text;
  if (refs.some((ref) => text.includes(citationUrl(ref)))) return text;
  const citation = citationMarkdown(refs[0], labelForCitation(refs[0]));
  return `${text.replace(/[.。]\s*$/, '')} ${citation}.`;
}

function normalizeCitationLabels(text: string, refs: CitationRef[]): string {
  let out = text;
  for (const ref of refs) {
    const url = citationUrl(ref).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\[[^\\]]*\\]\\(${url}\\)`, 'g');
    out = out.replace(re, citationMarkdown(ref, labelForCitation(ref)));
  }
  return out;
}

function normalizeKind(value: unknown): ChapterSuggestionKind {
  return ['idea', 'gap', 'debate', 'work', 'note'].includes(String(value))
    ? (value as ChapterSuggestionKind)
    : 'idea';
}

function normalizeOperation(value: unknown): ChapterSuggestionOperation {
  return ['insert_after', 'insert_before', 'replace', 'comment'].includes(String(value))
    ? (value as ChapterSuggestionOperation)
    : 'insert_after';
}

function citationMarkdown(ref: CitationRef, label: string): string {
  return `[${label || labelForCitation(ref)}](${citationUrl(ref)})`;
}

function labelForCitation(ref: CitationRef): string {
  if (ref.kind === 'work') {
    const work = getWork(ref.id);
    return sourceLabel(work?.authors, work?.year);
  }
  if (ref.kind === 'idea') {
    const detail = getIdeaDetail(ref.id);
    const work = detail?.occurrences[0]?.work;
    return sourceLabel(work?.authors, work?.year);
  }
  if (ref.kind === 'gap') {
    const detail = getGapDetail(ref.id);
    return sourceLabel(detail?.work.authors, detail?.work.year, 'hueco');
  }
  if (ref.kind === 'contradiction') {
    const detail = getEdgeDetail(ref.id);
    const work = detail?.edge.source_work ? getWork(detail.edge.source_work) : null;
    return sourceLabel(work?.authors, work?.year, 'contradiccion');
  }
  return 'pasaje';
}

function sourceLabel(authors: string[] | undefined, year: number | null | undefined, fallback = 'fuente'): string {
  const author = authors?.[0]?.trim();
  if (!author && !year) return fallback;
  const surname = author ? author.split(/\s+/).slice(-1)[0] : fallback;
  return year ? `${surname}, ${year}` : surname;
}

function authorYear(authors: string[] | undefined, year: number | null | undefined): string {
  return sourceLabel(authors, year);
}

function lexicalOverlap(a: string, b: string): number {
  const aa = tokenSet(a);
  const bb = tokenSet(b);
  if (aa.size === 0 || bb.size === 0) return 0;
  let hits = 0;
  for (const token of aa) if (bb.has(token)) hits += 1;
  return hits / Math.sqrt(aa.size * bb.size);
}

function tokenSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 3)
  );
}

function firstSentence(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const match = clean.match(/^(.{40,260}?[.!?])\s/);
  return (match?.[1] ?? clean.slice(0, 240)).trim();
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trim()}...`;
}

function clamp01(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}
