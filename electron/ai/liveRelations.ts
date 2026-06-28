// "Writing copilot" engine: given an arbitrary paragraph (coming from Word), find
// how it relates to the whole library — typed (supports/contradicts/refines/…),
// with a verifiable citation and the Zotero item to cite. This is the ad-hoc,
// symmetric counterpart of the per-chapter relation analysis, reusing the same
// candidate retrieval + relation typing as electron/ai/chapterIdeas.ts.
import type { EdgeDetail, Idea, LiveRelation, LiveRelationsResult, ModelRef } from '@shared/types';
import { completeText, embed } from './aiClient';
import {
  clamp01,
  gatherCandidates,
  normalizeRelationType,
  resolveTarget,
  typeRelations,
  type Candidate,
} from './chapterIdeas';
import { getSettings } from '../db/settingsRepo';
import { findSimilarIdeas, getIdeaDetail, getIdeaEdges, getIdeaSummary } from '../db/ideasRepo';
import { getPassageDetail } from '../db/passagesRepo';
import { getWork } from '../db/worksRepo';
import { getDb } from '../db/database';

const PSEUDO_ID = 'paragraph';
const LIVE_IDEA_LIMIT = 36;
const LIVE_IDEA_MIN_SIMILARITY = 0.25;

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trim()}…`;
}

/** "Surname, Year" from a Zotero-style "Surname, Given" author plus a year. */
function authorYearLabel(authors: string[] | undefined, year: number | null | undefined): string | null {
  const raw = authors?.[0]?.trim();
  if (!raw && !year) return null;
  const surname = raw ? (raw.includes(',') ? raw.split(',')[0] : raw.split(/\s+/).slice(-1)[0]).trim() : 'Autor';
  return year ? `${surname}, ${year}` : surname;
}

/** A precise Zotero quick-search string: first author + year + a few title words. */
function searchString(authors: string[] | undefined, year: number | null | undefined, title: string): string {
  const author = authors?.[0]?.trim();
  const surname = author ? (author.includes(',') ? author.split(',')[0] : author.split(/\s+/).slice(-1)[0]).trim() : '';
  return [surname, year ? String(year) : '', title].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface CitationMeta {
  zoteroKey: string | null;
  authorYear: string | null;
  searchString: string | null;
}

/** Resolve the underlying work (for the Zotero bridge) behind a relation target. */
function citationMeta(kind: Candidate['kind'], id: string): CitationMeta {
  try {
    if (kind === 'work') {
      const work = getWork(id);
      if (!work) return { zoteroKey: null, authorYear: null, searchString: null };
      return {
        zoteroKey: work.zotero_key || null,
        authorYear: authorYearLabel(work.authors, work.year),
        searchString: searchString(work.authors, work.year, work.title),
      };
    }
    if (kind === 'idea') {
      const work = getIdeaDetail(id)?.occurrences[0]?.work;
      if (!work) return { zoteroKey: null, authorYear: null, searchString: null };
      return {
        zoteroKey: work.zotero_key || null,
        authorYear: authorYearLabel(work.authors, work.year),
        searchString: searchString(work.authors, work.year, work.title),
      };
    }
    if (kind === 'passage') {
      const detail = getPassageDetail(id);
      if (!detail) return { zoteroKey: null, authorYear: null, searchString: null };
      const { authors, year, title, zotero_key } = detail.work;
      return {
        zoteroKey: zotero_key || null,
        authorYear: authorYearLabel(authors, year),
        searchString: searchString(authors, year, title),
      };
    }
  } catch {
    /* fall through to empty meta */
  }
  // Notes (and unresolved targets) have no Zotero item to cite.
  return { zoteroKey: null, authorYear: null, searchString: null };
}

export interface CopilotIdeaSearchResult {
  globalId: string;
  type: Idea['type'];
  label: string;
  statement: string;
  workCount: number;
  authors: string[];
  years: number[];
  sourceLabel: string | null;
  authorYear: string | null;
  zoteroKey: string | null;
  searchString: string | null;
  similarity: number | null;
}

export interface CopilotIdeaConnection {
  edgeId: string;
  type: string;
  basis: string;
  confidence: number;
  direction: 'out' | 'in';
  otherId: string;
  otherLabel: string;
  otherStatement: string | null;
  rationale: string | null;
  citation: string;
}

export interface CopilotIdeaDetail {
  idea: {
    globalId: string;
    type: Idea['type'];
    label: string;
    statement: string;
  };
  citation: string;
  authorYear: string | null;
  zoteroKey: string | null;
  searchString: string | null;
  occurrences: {
    nodusId: string;
    role: string;
    development: string;
    confidence: number;
    workTitle: string;
    authors: string[];
    year: number | null;
    authorYear: string | null;
    zoteroKey: string | null;
    searchString: string | null;
  }[];
  evidence: {
    id: string;
    quote: string;
    location: string | null;
    kind: string;
  }[];
  connections: CopilotIdeaConnection[];
}

export interface CopilotInsertionResult {
  text: string;
  citation: string;
  authorYear: string | null;
}

function gatherLiveCandidates(vector: number[]): Candidate[] {
  const byKey = new Map<string, Candidate>();

  for (const hit of findSimilarIdeas(vector, LIVE_IDEA_MIN_SIMILARITY, LIVE_IDEA_LIMIT)) {
    const key = `idea:${hit.global_id}`;
    byKey.set(key, {
      kind: 'idea',
      id: hit.global_id,
      similarity: hit.similarity,
      text: `${hit.label}: ${hit.statement}`,
    });
  }

  for (const candidate of gatherCandidates(vector)) {
    const key = `${candidate.kind}:${candidate.id}`;
    if (!byKey.has(key)) byKey.set(key, candidate);
  }

  return [...byKey.values()].sort((a, b) => b.similarity - a.similarity).slice(0, LIVE_IDEA_LIMIT);
}

function detailForSearchResult(globalId: string, similarity: number | null = null): CopilotIdeaSearchResult | null {
  const detail = getIdeaDetail(globalId);
  if (!detail) return null;
  const authors = new Set<string>();
  const years = new Set<number>();
  for (const occurrence of detail.occurrences) {
    occurrence.work.authors.forEach((author) => {
      if (author) authors.add(author);
    });
    if (occurrence.work.year) years.add(occurrence.work.year);
  }
  const firstWork = detail.occurrences[0]?.work;
  const meta = citationMeta('idea', globalId);
  return {
    globalId,
    type: detail.idea.type,
    label: detail.idea.label,
    statement: detail.idea.statement,
    workCount: detail.occurrences.length,
    authors: [...authors].slice(0, 6),
    years: [...years].sort((a, b) => a - b),
    sourceLabel: firstWork ? [firstWork.title, firstWork.year ? String(firstWork.year) : null].filter(Boolean).join(' · ') : null,
    authorYear: meta.authorYear,
    zoteroKey: meta.zoteroKey,
    searchString: meta.searchString,
    similarity,
  };
}

function lexicalIdeaIds(query: string, limit: number): string[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return (getDb()
      .prepare(
        `SELECT i.global_id
           FROM ideas i
           LEFT JOIN idea_occurrences o ON o.global_id = i.global_id
           LEFT JOIN works w ON w.nodus_id = o.nodus_id AND w.archived = 0
          GROUP BY i.global_id
          ORDER BY COUNT(DISTINCT o.nodus_id) DESC, i.created_at DESC
          LIMIT ?`
      )
      .all(limit) as { global_id: string }[]).map((row) => row.global_id);
  }

  const like = `%${q}%`;
  return (getDb()
    .prepare(
      `SELECT i.global_id,
              MAX(
                CASE
                  WHEN lower(i.label) = ? THEN 80
                  WHEN lower(i.label) LIKE ? THEN 60
                  WHEN lower(i.statement) LIKE ? THEN 44
                  WHEN lower(o.development) LIKE ? THEN 32
                  WHEN lower(w.authors_json) LIKE ? THEN 28
                  WHEN lower(w.title) LIKE ? THEN 22
                  ELSE 1
                END
              ) AS rank,
              COUNT(DISTINCT o.nodus_id) AS work_count
         FROM ideas i
         LEFT JOIN idea_occurrences o ON o.global_id = i.global_id
         LEFT JOIN works w ON w.nodus_id = o.nodus_id AND w.archived = 0
        WHERE lower(i.label) LIKE ?
           OR lower(i.statement) LIKE ?
           OR lower(o.development) LIKE ?
           OR lower(w.authors_json) LIKE ?
           OR lower(w.title) LIKE ?
        GROUP BY i.global_id
        ORDER BY rank DESC, work_count DESC, lower(i.label)
        LIMIT ?`
    )
    .all(q, like, like, like, like, like, like, like, like, like, like, limit) as {
    global_id: string;
  }[]).map((row) => row.global_id);
}

export async function searchCopilotIdeas(query: string, limit = 30): Promise<CopilotIdeaSearchResult[]> {
  const cleanLimit = Math.max(1, Math.min(60, Math.floor(limit)));
  const ids = lexicalIdeaIds(query, cleanLimit);
  const similarity = new Map<string, number | null>();

  const trimmed = query.trim();
  if (trimmed.length >= 8) {
    const vector = await embed(trimmed);
    if (vector) {
      for (const hit of findSimilarIdeas(vector, LIVE_IDEA_MIN_SIMILARITY, cleanLimit)) {
        if (!ids.includes(hit.global_id)) ids.push(hit.global_id);
        similarity.set(hit.global_id, hit.similarity);
      }
    }
  }

  return ids
    .slice(0, cleanLimit)
    .map((id) => detailForSearchResult(id, similarity.get(id) ?? null))
    .filter((item): item is CopilotIdeaSearchResult => item !== null);
}

function connectionSummary(edgeDetail: EdgeDetail, globalId: string): CopilotIdeaConnection | null {
  const isFrom = edgeDetail.edge.from_id === globalId;
  const otherId = isFrom ? edgeDetail.edge.to_id : edgeDetail.edge.from_id;
  if (!otherId || otherId === globalId) return null;
  const other = getIdeaSummary(otherId);
  return {
    edgeId: edgeDetail.edge.id,
    type: edgeDetail.edge.type,
    basis: edgeDetail.edge.basis,
    confidence: edgeDetail.edge.confidence,
    direction: isFrom ? 'out' : 'in',
    otherId,
    otherLabel: isFrom ? edgeDetail.toLabel : edgeDetail.fromLabel,
    otherStatement: other?.statement ?? null,
    rationale: edgeDetail.explanation ?? edgeDetail.trace?.rationale ?? null,
    citation: `nodus://idea/${otherId}`,
  };
}

export function getCopilotIdeaDetail(globalId: string): CopilotIdeaDetail | null {
  const detail = getIdeaDetail(globalId);
  if (!detail) return null;
  const meta = citationMeta('idea', globalId);
  return {
    idea: {
      globalId: detail.idea.global_id,
      type: detail.idea.type,
      label: detail.idea.label,
      statement: detail.idea.statement,
    },
    citation: `nodus://idea/${globalId}`,
    authorYear: meta.authorYear,
    zoteroKey: meta.zoteroKey,
    searchString: meta.searchString,
    occurrences: detail.occurrences.map((occurrence) => ({
      nodusId: occurrence.nodus_id,
      role: occurrence.role,
      development: occurrence.development,
      confidence: occurrence.confidence,
      workTitle: occurrence.work.title,
      authors: occurrence.work.authors,
      year: occurrence.work.year,
      authorYear: authorYearLabel(occurrence.work.authors, occurrence.work.year),
      zoteroKey: occurrence.work.zotero_key || null,
      searchString: searchString(occurrence.work.authors, occurrence.work.year, occurrence.work.title),
    })),
    evidence: detail.evidence.map((evidence) => ({
      id: evidence.id,
      quote: evidence.quote,
      location: evidence.location,
      kind: evidence.kind,
    })),
    connections: getIdeaEdges(globalId)
      .map((edge) => connectionSummary(edge, globalId))
      .filter((item): item is CopilotIdeaConnection => item !== null),
  };
}

function normalizeAiInsertion(raw: string, authorYear: string | null): string {
  let clean = raw
    .replace(/\[([^\]]+)\]\(nodus:\/\/[^)]+\)/g, '$1')
    .replace(/[`*_#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  clean = clean.replace(/^["“”]+|["“”]+$/g, '').trim();
  if (authorYear && !new RegExp(`\\(${escapeRegExp(authorYear)}\\)`).test(clean) && !clean.includes(authorYear)) {
    clean = `${clean.replace(/[.;:,\s]+$/g, '')} (${authorYear})`;
  }
  if (clean && !/[.!?)]$/.test(clean)) clean += '.';
  return clean;
}

export async function composeCopilotIdeaInsertion(input: {
  ideaId: string;
  paragraphText: string;
  selectionText?: string;
}): Promise<CopilotInsertionResult> {
  const detail = getCopilotIdeaDetail(input.ideaId);
  if (!detail) throw new Error('No se encontró la idea en Nodus.');
  const settings = getSettings();
  const model = settings.synthesisModel ?? settings.defaultModel;
  const authorYear = detail.authorYear ?? detail.occurrences[0]?.authorYear ?? null;
  const source = detail.occurrences[0] ?? null;
  const text = await completeText(
    {
      system: [
        'Eres Nodus Copilot dentro de Microsoft Word.',
        'Inserta UNA idea de la biblioteca en el párrafo del usuario con estilo académico natural.',
        'Parafrasea: no copies evidencia literal salvo fragmentos mínimos inevitables.',
        'Usa solo la idea, sus desarrollos, evidencias y conexiones recibidas. No inventes autores, años, páginas ni obras.',
        authorYear ? `La respuesta debe incluir exactamente esta cita parentética en texto plano: (${authorYear}).` : 'Si no hay autor-año, no inventes cita bibliográfica.',
        'Devuelve solo el texto que se insertará, sin Markdown, sin viñetas, sin explicación.',
      ].join('\n'),
      user: JSON.stringify(
        {
          parrafo_actual: clip(input.paragraphText, 2200),
          seleccion_actual: clip(input.selectionText ?? '', 600),
          idea: detail.idea,
          cita_requerida: authorYear ? `(${authorYear})` : null,
          fuente_principal: source
            ? {
                titulo: source.workTitle,
                autores: source.authors,
                ano: source.year,
                desarrollo: clip(source.development, 900),
              }
            : null,
          evidencias: detail.evidence.slice(0, 3).map((evidence) => ({
            tipo: evidence.kind,
            ubicacion: evidence.location,
            cita_o_parafrasis: clip(evidence.quote, 500),
          })),
          conexiones: detail.connections.slice(0, 6).map((connection) => ({
            tipo: connection.type,
            otra_idea: connection.otherLabel,
            enunciado: clip(connection.otherStatement ?? '', 320),
          })),
          salida: {
            extension: '1-2 frases, maximo 90 palabras',
            tono: 'continua el parrafo actual sin sonar a nota al margen',
          },
        },
        null,
        2
      ),
      temperature: 0.2,
      maxTokens: 320,
    },
    model
  );
  const normalized = normalizeAiInsertion(text, authorYear);
  if (!normalized) throw new Error('La IA no devolvió texto insertable.');
  return {
    text: normalized,
    citation: detail.citation,
    authorYear,
  };
}

/**
 * Analyze an arbitrary paragraph and return its typed relations with the library.
 * Returns `available:false` when no embedding provider/key is configured.
 */
export async function analyzeText(text: string, model?: ModelRef | null): Promise<LiveRelationsResult> {
  const trimmed = text.trim();
  if (trimmed.length < 12) return { available: true, relations: [] };

  const vector = await embed(trimmed);
  if (!vector) return { available: false, relations: [] };

  const candidates = gatherLiveCandidates(vector);
  if (candidates.length === 0) return { available: true, relations: [] };

  // One LLM pass to type the paragraph↔candidate relations (degrades to 'related'
  // by similarity if the model/typing is unavailable).
  const typed = await typeRelations(
    [{ id: PSEUDO_ID, label: clip(trimmed, 80), statement: trimmed }],
    new Map([[PSEUDO_ID, candidates]]),
    model
  );

  const relations: LiveRelation[] = candidates.map((candidate) => {
    const hit = typed.get(`${PSEUDO_ID}|${candidate.kind}:${candidate.id}`);
    const target = resolveTarget(candidate.kind, candidate.id);
    const meta = citationMeta(candidate.kind, candidate.id);
    return {
      relation: normalizeRelationType(hit?.relation),
      targetKind: candidate.kind,
      targetId: candidate.id,
      targetLabel: target.label,
      targetSubtitle: target.subtitle,
      similarity: candidate.similarity,
      confidence: hit ? clamp01(hit.confidence) : candidate.similarity,
      rationale: clip(hit?.rationale ?? '', 300),
      zoteroKey: meta.zoteroKey,
      authorYear: meta.authorYear,
      searchString: meta.searchString,
      citation: `nodus://${candidate.kind}/${candidate.id}`,
      proposedText: null,
    };
  });

  return { available: true, relations };
}
