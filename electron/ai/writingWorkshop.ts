import type {
  GapKind,
  IdeaType,
  WritingWorkshopBrief,
  WritingWorkshopCandidateBase,
  WritingWorkshopContradictionCandidate,
  WritingWorkshopDraft,
  WritingWorkshopDraftRequest,
  WritingWorkshopGapCandidate,
  WritingWorkshopIdeaCandidate,
  WritingWorkshopMatrixRow,
  WritingWorkshopPassageCandidate,
  WritingWorkshopRouteCandidate,
  WritingWorkshopSection,
  WritingWorkshopSelection,
  WritingWorkshopSnapshot,
  WritingWorkshopThemeCandidate,
  WritingWorkshopWorkCandidate,
} from '@shared/types';
import { getDb } from '../db/database';
import { getContradictions } from '../graph/graphService';
import { listTutorRoutes } from '../db/tutorRepo';
import { completeJson } from './aiClient';
import { embed } from './aiClient';
import { findSimilarIdeas } from '../db/ideasRepo';
import { findSimilarWorks } from '../db/workSummariesRepo';
import { findSimilarPassages, type SimilarPassage } from '../db/passagesRepo';

const MAX_IDEAS = 120;
const MAX_THEMES = 30;
const MAX_GAPS = 36;
const MAX_CONTRADICTIONS = 30;
const MAX_WORKS = 80;
const MAX_PASSAGES = 24;
const MAX_ROUTES = 12;
const MAX_CONTEXT_CHARS = 420_000;
const MAX_PASSAGE_CONTEXT_CHARS = 30_000;

interface Scored<T> {
  item: T;
  score: number;
  reason: string;
}

interface IdeaRow {
  global_id: string;
  type: IdeaType;
  label: string;
  statement: string;
  themes: string | null;
  work_count: number;
  evidence_count: number;
  work_ids: string | null;
}

interface WorkLinkRow {
  nodus_id: string;
  title: string;
  authors_json: string;
  year: number | null;
  zotero_key: string;
}

interface ThemeRow {
  theme_id: string;
  label: string;
  pinned: number | null;
  work_count: number;
  idea_count: number;
  work_ids: string | null;
}

interface WorkshopSemanticRanking {
  active: boolean;
  ideaScores: Map<string, number>;
  workScores: Map<string, number>;
  passages: WritingWorkshopPassageCandidate[];
}

interface WorkshopContext {
  payload: Record<string, unknown>;
  stats: WritingWorkshopDraft['stats'];
}

interface GapRow {
  id: string;
  kind: GapKind;
  statement: string;
  related_idea: string | null;
  confidence: number;
  title: string;
  authors_json: string;
  year: number | null;
  zotero_key: string;
  nodus_id: string;
  idea_label: string | null;
}

interface WorkRow {
  nodus_id: string;
  zotero_key: string;
  title: string;
  authors_json: string;
  year: number | null;
  deep_status: WritingWorkshopWorkCandidate['deepStatus'];
  orientation_summary: string | null;
  themes: string | null;
  idea_count: number;
  gap_count: number;
}

interface AiWorkshopResult {
  title?: string;
  abstract?: string;
  outline?: Array<{
    id?: string;
    title?: string;
    purpose?: string;
    keyClaims?: string[];
    sources?: string[];
  }>;
  draftMarkdown?: string;
  matrix?: Array<{
    claim?: string;
    role?: string;
    sourceLabel?: string;
    citation?: string;
    evidence?: string;
    notes?: string;
  }>;
  bibliography?: string[];
  nextSteps?: string[];
  limitations?: string[];
}

function isAiWorkshopResult(value: unknown): value is AiWorkshopResult {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as AiWorkshopResult;
  return typeof v.title === 'string' && typeof v.draftMarkdown === 'string' && Array.isArray(v.outline);
}

export async function buildWritingWorkshopSnapshot(brief: WritingWorkshopBrief): Promise<WritingWorkshopSnapshot> {
  const tokens = tokenize(`${brief.objective} ${kindLabel(brief.kind)}`);
  const semantic = await buildSemanticRanking(brief.objective);
  const ideas = rankedIdeas(tokens, semantic);
  const themes = rankedThemes(tokens, semantic);
  const gaps = rankedGaps(tokens, brief.kind, semantic);
  const contradictions = rankedContradictions(tokens, semantic);
  const works = rankedWorks(tokens, semantic);
  const tutorRoutes = rankedTutorRoutes(tokens);

  return {
    generatedAt: new Date().toISOString(),
    brief,
    stats: {
      ideas: countTable('ideas'),
      themes: countTable('themes'),
      gaps: countTable('gaps'),
      contradictions: getContradictions().length,
      works: countTable('works'),
      passages: countTable('passages'),
      tutorRoutes: listTutorRoutes().length,
    },
    recommendedSelection: recommendSelection(brief, { ideas, themes, gaps, contradictions, works, tutorRoutes }),
    ideas,
    themes,
    gaps,
    contradictions,
    works,
    passages: semantic.passages,
    tutorRoutes,
  };
}

export async function generateWritingWorkshopDraft(request: WritingWorkshopDraftRequest): Promise<WritingWorkshopDraft> {
  citationLabelCache.clear();
  const snapshot = await buildWritingWorkshopSnapshot(request.brief);
  const selection = normalizeSelection(request.selection, snapshot.recommendedSelection);
  const context = await buildSelectedContext(request.brief, selection);
  const user = JSON.stringify(context.payload, null, 2);

  const system = [
    'Eres el Taller de escritura de Nodus. Ayudas a convertir un grafo academico local en un borrador verificable.',
    'Debes escribir en espanol salvo que el campo language pida otra lengua.',
    'Usa SOLO los materiales recibidos. No inventes obras, autores, citas, paginas ni relaciones.',
    'Los campos resumen_orientacion son solo para ubicar una obra: NUNCA son evidencia ni una fuente citable. Para afirmaciones sustantivas usa ideas, evidencias, huecos o contradicciones anclados.',
    'Cada afirmacion sustantiva del borrador debe ir ligada a una fuente mediante enlaces Markdown nodus://.',
    'El objetivo NO es una respuesta breve: entrega un borrador desarrollado, pegable en un capitulo o articulo.',
    'Integra de forma explicita todas las ideas seleccionadas que puedas sostener con el contexto. Si hay muchas, agrupalas en lineas argumentales, pero no las reduzcas a una lista.',
    'Relaciona las ideas entre si: muestra continuidad, diferencias, niveles de abstraccion, consecuencias metodologicas, contradicciones y huecos.',
    'Escribe en Markdown real: usa ## para secciones, ### para subsecciones, parrafos completos y listas solo para sintesis, pasos o matriz.',
    'Cada seccion sustantiva debe tener 2-4 parrafos desarrollados. Evita parrafos de una sola frase.',
    'Longitud orientativa del draftMarkdown: 700-1000 palabras si hay pocas ideas, 1200-1800 si hay 8-20 ideas, y 1800-3000 si hay mas de 20 ideas y el contexto lo permite.',
    'La matriz debe cubrir las ideas y tensiones principales; si una idea seleccionada no entra en el borrador, incluyela en matrix o limitations explicando por que.',
    'Formatos de cita permitidos:',
    '- Ideas: [Apellido, I. (año)](nodus://idea/<global_id>)',
    '- Obras: [Apellido, I. (año)](nodus://work/<nodus_id>)',
    '- Huecos: [hueco](nodus://gap/<gap_id>)',
    '- Contradicciones: [contradiccion](nodus://contradiction/<edge_id>)',
    '- Pasajes de texto completo: [Apellido, año, p. N](nodus://passage/<passage_id>)',
    'Los `pasajes_evidencia` son texto literal: úsalos para sostener afirmaciones verificables y cítalos con su campo `cita` exacto. No inventes páginas ni extiendas su sentido.',
    'Si no hay evidencia suficiente para una seccion, dilo como limitacion o siguiente paso; no rellenes.',
    '',
    'Devuelve EXCLUSIVAMENTE JSON valido con esta forma:',
    '{',
    '  "title": "titulo academico breve",',
    '  "abstract": "5-8 lineas que resumen la tesis del apartado",',
    '  "outline": [',
    '    {"id":"s1","title":"...","purpose":"...","keyClaims":["..."],"sources":["[Apellido, I. (año)](nodus://idea/g-0001)"]}',
    '  ],',
    '  "draftMarkdown": "borrador en Markdown con H2/H3, parrafos y citas nodus://",',
    '  "matrix": [',
    '    {"claim":"...","role":"support|contrast|gap|method|definition|context","sourceLabel":"Apellido, I. (año)","citation":"nodus://idea/g-0001","evidence":"cita o resumen anclado","notes":"uso en el argumento"}',
    '  ],',
    '  "bibliography": ["Apellido, I. (año). Titulo."],',
    '  "nextSteps": ["..."],',
    '  "limitations": ["..."]',
    '}',
  ].join('\n');

  let ai: AiWorkshopResult;
  try {
    ai = await completeJson<AiWorkshopResult>(
      {
        system,
        user,
        temperature: 0.18,
        maxTokens: 16000,
      },
      isAiWorkshopResult,
      request.model
    );
  } catch {
    return structuralFallback(request.brief, selection, context);
  }

  return sanitizeDraft(ai, request.brief, selection, context);
}

function countTable(table: string): number {
  const row = getDb().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return row.n;
}

/**
 * One query embedding drives the entire workshop table. We use the existing
 * idea/work vectors for broad ranking and the fine passage index for direct
 * evidence candidates; lexical matching remains only as an offline fallback.
 */
async function buildSemanticRanking(objective: string): Promise<WorkshopSemanticRanking> {
  const empty: WorkshopSemanticRanking = { active: false, ideaScores: new Map(), workScores: new Map(), passages: [] };
  if (!objective.trim()) return empty;
  try {
    const query = await embed(objective.trim());
    if (!query) return empty;
    const ideaScores = new Map(findSimilarIdeas(query, -1, MAX_IDEAS).map((hit) => [hit.global_id, semanticStrength(hit.similarity)]));
    const workScores = new Map(findSimilarWorks(query, -1, MAX_WORKS).map((hit) => [hit.nodus_id, semanticStrength(hit.similarity)]));
    const passageHits = findSimilarPassages(query, -1, MAX_PASSAGES);
    for (const hit of passageHits) {
      const current = workScores.get(hit.nodus_id) ?? 0;
      workScores.set(hit.nodus_id, Math.max(current, semanticStrength(hit.similarity)));
    }
    return {
      active: ideaScores.size > 0 || workScores.size > 0 || passageHits.length > 0,
      ideaScores,
      workScores,
      passages: passageHits.map(toPassageCandidate),
    };
  } catch (error) {
    console.warn('[writingWorkshop] semantic ranking unavailable:', error instanceof Error ? error.message : String(error));
    return empty;
  }
}

function semanticStrength(similarity: number): number {
  return Math.max(0, Math.min(0.65, similarity));
}

function scoreForIds(ids: string[], scores: Map<string, number>): number | null {
  let best: number | null = null;
  for (const id of ids) {
    const score = scores.get(id);
    if (score != null && (best == null || score > best)) best = score;
  }
  return best;
}

function semanticOrLexical(semantic: WorkshopSemanticRanking, semanticScore: number | null, lexicalScore: number): number {
  return semantic.active ? semanticScore ?? 0 : lexicalScore;
}

function semanticReason(semantic: WorkshopSemanticRanking, score: number, support: number): string {
  if (semantic.active && score > support) return 'Recuperado por similitud semántica con el objetivo.';
  return reasonFor(score, support, semantic.active ? 0 : score - support);
}

function toPassageCandidate(hit: SimilarPassage): WritingWorkshopPassageCandidate {
  return {
    id: hit.passage_id,
    label: `${hit.title}${hit.page_label ? ` · ${hit.page_label}` : ''}`,
    summary: clip(hit.text, 520),
    score: semanticStrength(hit.similarity),
    reason: 'Pasaje recuperado por similitud semántica con el objetivo.',
    nodus_id: hit.nodus_id,
    pageLabel: hit.page_label,
    authors: parseAuthors(hit.authors_json),
    year: hit.year,
    zotero_key: hit.zotero_key,
    citation: `nodus://passage/${encodeURIComponent(hit.passage_id)}`,
  };
}

function rankedIdeas(tokens: Set<string>, semanticIndex: WorkshopSemanticRanking): WritingWorkshopIdeaCandidate[] {
  const rows = getDb()
    .prepare(
      `SELECT i.global_id, i.type, i.label, i.statement,
              COALESCE(GROUP_CONCAT(DISTINCT t.label), '') AS themes,
              COUNT(DISTINCT io.nodus_id) AS work_count,
              COUNT(DISTINCT e.id) AS evidence_count,
              COALESCE(GROUP_CONCAT(DISTINCT io.nodus_id), '') AS work_ids
         FROM ideas i
         LEFT JOIN idea_occurrences io ON io.global_id = i.global_id
         LEFT JOIN evidence e ON e.global_id = i.global_id
         LEFT JOIN idea_theme_links itl ON itl.global_id = i.global_id
         LEFT JOIN themes t ON t.theme_id = itl.theme_id
        GROUP BY i.global_id
        ORDER BY work_count DESC, evidence_count DESC, i.created_at ASC`
    )
    .all() as IdeaRow[];

  return rows
    .map((row): Scored<WritingWorkshopIdeaCandidate> => {
      const themeList = splitList(row.themes);
      const baseText = [row.label, row.statement, themeList.join(' ')].join(' ');
      const lexical = relevance(tokens, baseText);
      const semantic = semanticOrLexical(semanticIndex, semanticIndex.ideaScores.get(row.global_id) ?? scoreForIds(splitList(row.work_ids), semanticIndex.workScores), lexical);
      const support = Math.min(0.22, row.work_count * 0.035) + Math.min(0.16, row.evidence_count * 0.018);
      const score = semantic + support;
      return {
        score,
        reason: semanticReason(semanticIndex, score, support),
        item: {
          id: row.global_id,
          label: row.label,
          summary: clip(row.statement, 240),
          score,
          reason: '',
          type: row.type,
          statement: row.statement,
          themes: themeList,
          workCount: row.work_count,
          evidenceCount: row.evidence_count,
          works: ideaWorks(row.global_id),
        },
      };
    })
    .sort(sortScored)
    .slice(0, MAX_IDEAS)
    .map(({ item, score, reason }) => ({ ...item, score, reason }));
}

function ideaWorks(globalId: string): WritingWorkshopIdeaCandidate['works'] {
  const rows = getDb()
    .prepare(
      `SELECT w.nodus_id, w.title, w.authors_json, w.year, w.zotero_key
         FROM idea_occurrences io
         JOIN works w ON w.nodus_id = io.nodus_id
        WHERE io.global_id = ?
        ORDER BY io.role = 'principal' DESC, io.confidence DESC, w.year DESC
        LIMIT 5`
    )
    .all(globalId) as WorkLinkRow[];
  return rows.map((row) => ({
    nodus_id: row.nodus_id,
    title: row.title,
    authors: parseAuthors(row.authors_json),
    year: row.year,
    zotero_key: row.zotero_key,
  }));
}

function rankedThemes(tokens: Set<string>, semanticIndex: WorkshopSemanticRanking): WritingWorkshopThemeCandidate[] {
  const rows = getDb()
    .prepare(
      `SELECT t.theme_id, t.label, t.pinned,
              COUNT(DISTINCT wt.nodus_id) AS work_count,
              COUNT(DISTINCT itl.global_id) AS idea_count,
              COALESCE(GROUP_CONCAT(DISTINCT wt.nodus_id), '') AS work_ids
         FROM themes t
         LEFT JOIN work_themes wt ON wt.theme_id = t.theme_id
         LEFT JOIN idea_theme_links itl ON itl.theme_id = t.theme_id
        GROUP BY t.theme_id
        ORDER BY t.pinned DESC, work_count DESC, idea_count DESC`
    )
    .all() as ThemeRow[];

  return rows
    .map((row): Scored<WritingWorkshopThemeCandidate> => {
      const lexical = relevance(tokens, row.label);
      const semantic = semanticOrLexical(semanticIndex, scoreForIds(splitList(row.work_ids), semanticIndex.workScores), lexical);
      const support = Math.min(0.22, row.work_count * 0.018) + Math.min(0.18, row.idea_count * 0.025) + (row.pinned ? 0.08 : 0);
      const score = semantic + support;
      return {
        score,
        reason: row.pinned ? 'Tema curado y con material conectado.' : semanticReason(semanticIndex, score, support),
        item: {
          id: row.theme_id,
          label: row.label,
          summary: `${row.work_count} obra(s), ${row.idea_count} idea(s) conectadas.`,
          score,
          reason: '',
          workCount: row.work_count,
          ideaCount: row.idea_count,
          pinned: !!row.pinned,
        },
      };
    })
    .sort(sortScored)
    .slice(0, MAX_THEMES)
    .map(({ item, score, reason }) => ({ ...item, score, reason }));
}

function rankedGaps(tokens: Set<string>, kind: WritingWorkshopBrief['kind'], semanticIndex: WorkshopSemanticRanking): WritingWorkshopGapCandidate[] {
  const rows = getDb()
    .prepare(
      `SELECT g.id, g.kind, g.statement, g.related_idea, g.confidence,
              w.nodus_id, w.title, w.authors_json, w.year, w.zotero_key,
              i.label AS idea_label
         FROM gaps g
         JOIN works w ON w.nodus_id = g.nodus_id
         LEFT JOIN ideas i ON i.global_id = g.related_idea
        ORDER BY g.confidence DESC`
    )
    .all() as GapRow[];

  return rows
    .map((row): Scored<WritingWorkshopGapCandidate> => {
      const lexical = relevance(tokens, [row.statement, row.idea_label ?? '', row.title].join(' '));
      const semantic = semanticOrLexical(
        semanticIndex,
        Math.max(semanticIndex.workScores.get(row.nodus_id) ?? 0, semanticIndex.ideaScores.get(row.related_idea ?? '') ?? 0) || null,
        lexical
      );
      const gapBoost = kind === 'gap_justification' || kind === 'research_question' ? 0.22 : 0.05;
      const support = gapBoost + Math.min(0.16, row.confidence * 0.16);
      const score = semantic + support;
      return {
        score,
        reason: kind === 'gap_justification' ? 'Hueco útil para justificar contribución.' : semanticReason(semanticIndex, score, support),
        item: {
          id: row.id,
          label: clip(row.statement, 90),
          summary: row.statement,
          score,
          reason: '',
          kind: row.kind,
          work: {
            nodus_id: row.nodus_id,
            title: row.title,
            authors: parseAuthors(row.authors_json),
            year: row.year,
            zotero_key: row.zotero_key,
          },
          relatedIdea: row.related_idea,
          confidence: row.confidence,
        },
      };
    })
    .sort(sortScored)
    .slice(0, MAX_GAPS)
    .map(({ item, score, reason }) => ({ ...item, score, reason }));
}

function rankedContradictions(tokens: Set<string>, semanticIndex: WorkshopSemanticRanking): WritingWorkshopContradictionCandidate[] {
  return getContradictions()
    .map((detail): Scored<WritingWorkshopContradictionCandidate> => {
      const lexical = relevance(tokens, [detail.fromLabel, detail.toLabel, detail.explanation ?? ''].join(' '));
      const semantic = semanticOrLexical(
        semanticIndex,
        scoreForIds(detail.evidence.map((e) => e.nodus_id), semanticIndex.workScores) ??
          scoreForIds([detail.edge.from_id, detail.edge.to_id], semanticIndex.ideaScores),
        lexical
      );
      const support = Math.min(0.22, detail.edge.confidence * 0.2) + (detail.evidence.length > 0 ? 0.06 : 0);
      const score = semantic + support;
      return {
        score,
        reason: 'Contraste útil para matizar el argumento.',
        item: {
          id: detail.edge.id,
          label: `${detail.fromLabel} / ${detail.toLabel}`,
          summary: detail.explanation ?? `${detail.fromLabel} ${detail.edge.type} ${detail.toLabel}`,
          score,
          reason: '',
          fromLabel: detail.fromLabel,
          toLabel: detail.toLabel,
          type: detail.edge.type,
          basis: detail.edge.basis,
          confidence: detail.edge.confidence,
        },
      };
    })
    .sort(sortScored)
    .slice(0, MAX_CONTRADICTIONS)
    .map(({ item, score, reason }) => ({ ...item, score, reason }));
}

function rankedWorks(tokens: Set<string>, semanticIndex: WorkshopSemanticRanking): WritingWorkshopWorkCandidate[] {
  const rows = getDb()
    .prepare(
      `SELECT w.nodus_id, w.zotero_key, w.title, w.authors_json, w.year, w.deep_status,
              CASE WHEN w.summary_status = 'done' THEN ws.summary ELSE NULL END AS orientation_summary,
              COALESCE(GROUP_CONCAT(DISTINCT t.label), '') AS themes,
              COUNT(DISTINCT io.global_id) AS idea_count,
              COUNT(DISTINCT g.id) AS gap_count
         FROM works w
         LEFT JOIN work_summaries ws ON ws.nodus_id = w.nodus_id
         LEFT JOIN work_themes wt ON wt.nodus_id = w.nodus_id
         LEFT JOIN themes t ON t.theme_id = wt.theme_id
         LEFT JOIN idea_occurrences io ON io.nodus_id = w.nodus_id
         LEFT JOIN gaps g ON g.nodus_id = w.nodus_id
        WHERE w.archived = 0
        GROUP BY w.nodus_id
        ORDER BY idea_count DESC, gap_count DESC, w.year DESC`
    )
    .all() as WorkRow[];

  return rows
    .map((row): Scored<WritingWorkshopWorkCandidate> => {
      const themes = splitList(row.themes);
      const lexical = relevance(tokens, [row.title, themes.join(' '), row.orientation_summary ?? ''].join(' '));
      const semantic = semanticOrLexical(semanticIndex, semanticIndex.workScores.get(row.nodus_id) ?? null, lexical);
      const support = Math.min(0.18, row.idea_count * 0.03) + Math.min(0.14, row.gap_count * 0.035) + (row.deep_status === 'done' ? 0.08 : 0);
      const score = semantic + support;
      return {
        score,
        reason: row.deep_status === 'done' ? (semanticIndex.active ? 'Obra recuperada semánticamente con evidencia indexada.' : 'Obra con ideas y evidencias extraídas.') : semanticReason(semanticIndex, score, support),
        item: {
          id: row.nodus_id,
          label: row.title,
          summary: row.orientation_summary ?? `${parseAuthors(row.authors_json)[0] ?? 'Autoría no disponible'}${row.year ? `, ${row.year}` : ''}`,
          score,
          reason: '',
          title: row.title,
          authors: parseAuthors(row.authors_json),
          year: row.year,
          zotero_key: row.zotero_key,
          themes,
          deepStatus: row.deep_status,
          orientationSummary: row.orientation_summary,
          ideaCount: row.idea_count,
          gapCount: row.gap_count,
        },
      };
    })
    .sort(sortScored)
    .slice(0, MAX_WORKS)
    .map(({ item, score, reason }) => ({ ...item, score, reason }));
}

function rankedTutorRoutes(tokens: Set<string>): WritingWorkshopRouteCandidate[] {
  return listTutorRoutes()
    .map((route): Scored<WritingWorkshopRouteCandidate> => {
      const routeText = [
        route.route.title,
        route.route.description,
        route.overview,
        route.prompt,
        route.route.themes.join(' '),
        route.route.stops.map((s) => `${s.title} ${s.focus}`).join(' '),
      ].join(' ');
      const semantic = relevance(tokens, routeText);
      const support = Math.min(0.2, route.route.weight * 0.04) + (route.rating ? route.rating * 0.02 : 0);
      const score = semantic + support;
      return {
        score,
        reason: route.rating ? 'Ruta guardada y valorada por el usuario.' : 'Ruta del Tutor que ordena una línea argumental.',
        item: {
          id: route.id,
          label: route.route.title,
          summary: route.route.description,
          score,
          reason: '',
          routeTitle: route.route.title,
          mode: route.mode,
          prompt: route.prompt,
          themes: route.route.themes,
          stops: route.route.stops.length,
          rating: route.rating,
        },
      };
    })
    .sort(sortScored)
    .slice(0, MAX_ROUTES)
    .map(({ item, score, reason }) => ({ ...item, score, reason }));
}

function recommendSelection(
  brief: WritingWorkshopBrief,
  candidates: {
    ideas: WritingWorkshopIdeaCandidate[];
    themes: WritingWorkshopThemeCandidate[];
    gaps: WritingWorkshopGapCandidate[];
    contradictions: WritingWorkshopContradictionCandidate[];
    works: WritingWorkshopWorkCandidate[];
    tutorRoutes: WritingWorkshopRouteCandidate[];
  }
): WritingWorkshopSelection {
  const gapHeavy = brief.kind === 'gap_justification' || brief.kind === 'research_question';
  const debateHeavy = brief.kind === 'debate';
  return {
    ideaIds: candidates.ideas.slice(0, brief.kind === 'chapter_section' ? 14 : 10).map((i) => i.id),
    themeIds: candidates.themes.slice(0, 5).map((t) => t.id),
    gapIds: candidates.gaps.slice(0, gapHeavy ? 8 : 4).map((g) => g.id),
    contradictionIds: candidates.contradictions.slice(0, debateHeavy ? 8 : 4).map((c) => c.id),
    workIds: candidates.works.slice(0, 10).map((w) => w.id),
    passageIds: [],
    tutorRouteIds: candidates.tutorRoutes.slice(0, 2).map((r) => r.id),
  };
}

function normalizeSelection(selection: WritingWorkshopSelection, fallback: WritingWorkshopSelection): WritingWorkshopSelection {
  const clean = (items: string[] | undefined, fb: string[]) => {
    const unique = Array.from(new Set((items ?? []).filter(Boolean)));
    return unique.length > 0 ? unique : fb;
  };
  const anySelected = [
    selection.ideaIds,
    selection.themeIds,
    selection.gapIds,
    selection.contradictionIds,
    selection.workIds,
    selection.passageIds,
    selection.tutorRouteIds,
  ].some((list) => list.length > 0);
  if (!anySelected) return fallback;
  return {
    ideaIds: clean(selection.ideaIds, []),
    themeIds: clean(selection.themeIds, []),
    gapIds: clean(selection.gapIds, []),
    contradictionIds: clean(selection.contradictionIds, []),
    workIds: clean(selection.workIds, []),
    passageIds: clean(selection.passageIds, []),
    tutorRouteIds: clean(selection.tutorRouteIds, []),
  };
}

async function buildSelectedContext(brief: WritingWorkshopBrief, selection: WritingWorkshopSelection): Promise<WorkshopContext> {
  const passages = await selectedPassagesForDraft(brief.objective, selection);
  const context = {
    brief: {
      tipo: kindLabel(brief.kind),
      objetivo: brief.objective,
      audiencia: brief.audience ?? null,
      tono: brief.tone ?? 'academic',
      lengua: brief.language ?? 'es',
    },
    ideas: selectedIdeas(selection.ideaIds),
    temas: selectedThemes(selection.themeIds),
    huecos: selectedGaps(selection.gapIds),
    contradicciones: selectedContradictions(selection.contradictionIds),
    obras: selectedWorks(selection.workIds),
    pasajes_evidencia: passages,
    rutas_tutor: selectedRoutes(selection.tutorRouteIds),
    regla: 'Cada id incluido aqui puede citarse con nodus://idea, nodus://work, nodus://gap, nodus://contradiction o nodus://passage. Los pasajes son evidencia literal y deben citarse de manera exacta.',
  };
  const raw = JSON.stringify(context);
  const truncated = raw.length > MAX_CONTEXT_CHARS;
  const payload = truncated ? trimContext(context) : context;
  const contextChars = JSON.stringify(payload).length;
  return {
    payload,
    stats: {
      selectedIdeas: context.ideas.length,
      selectedThemes: context.temas.length,
      selectedGaps: context.huecos.length,
      selectedContradictions: context.contradicciones.length,
      selectedWorks: context.obras.length,
      selectedPassages: context.pasajes_evidencia.length,
      selectedTutorRoutes: context.rutas_tutor.length,
      contextChars,
      truncated,
    },
  };
}

function selectedIdeas(ids: string[]) {
  if (ids.length === 0) return [];
  const rows = getDb()
    .prepare(
      `SELECT i.global_id, i.type, i.label, i.statement,
              COALESCE(GROUP_CONCAT(DISTINCT t.label), '') AS themes
         FROM ideas i
         LEFT JOIN idea_theme_links itl ON itl.global_id = i.global_id
         LEFT JOIN themes t ON t.theme_id = itl.theme_id
        WHERE i.global_id IN (${placeholders(ids)})
        GROUP BY i.global_id`
    )
    .all(...ids) as Array<IdeaRow>;

  return rows.map((row) => ({
    id: row.global_id,
    tipo: row.type,
    etiqueta: row.label,
    enunciado: row.statement,
    temas: splitList(row.themes),
    cita: `nodus://idea/${row.global_id}`,
    obras: ideaWorks(row.global_id).map((work) => ({
      id: work.nodus_id,
      titulo: work.title,
      autores: work.authors,
      ano: work.year,
      cita: `nodus://work/${work.nodus_id}`,
    })),
    evidencia: selectedEvidenceForIdea(row.global_id),
  }));
}

function selectedEvidenceForIdea(globalId: string) {
  const rows = getDb()
    .prepare(
      `SELECT e.quote, e.location, e.kind, w.nodus_id, w.title, w.authors_json, w.year
         FROM evidence e
         JOIN works w ON w.nodus_id = e.nodus_id
        WHERE e.global_id = ?
        ORDER BY e.kind = 'explicit' DESC, w.year DESC
        LIMIT 5`
    )
    .all(globalId) as Array<{
      quote: string;
      location: string | null;
      kind: string;
      nodus_id: string;
      title: string;
      authors_json: string;
      year: number | null;
    }>;
  return rows.map((row) => ({
    cita_textual: clip(row.quote, 600),
    localizacion: row.location,
    tipo: row.kind,
    obra: {
      id: row.nodus_id,
      titulo: row.title,
      autores: parseAuthors(row.authors_json),
      ano: row.year,
      cita: `nodus://work/${row.nodus_id}`,
    },
  }));
}

function selectedThemes(ids: string[]) {
  if (ids.length === 0) return [];
  const rows = getDb()
    .prepare(
      `SELECT t.theme_id, t.label, t.pinned,
              COUNT(DISTINCT wt.nodus_id) AS work_count,
              COUNT(DISTINCT itl.global_id) AS idea_count
         FROM themes t
         LEFT JOIN work_themes wt ON wt.theme_id = t.theme_id
         LEFT JOIN idea_theme_links itl ON itl.theme_id = t.theme_id
        WHERE t.theme_id IN (${placeholders(ids)})
        GROUP BY t.theme_id`
    )
    .all(...ids) as ThemeRow[];
  return rows.map((row) => ({
    id: row.theme_id,
    etiqueta: row.label,
    curado: !!row.pinned,
    obras: row.work_count,
    ideas: row.idea_count,
    ideas_muestra: themeIdeaSample(row.theme_id),
  }));
}

function themeIdeaSample(themeId: string) {
  const rows = getDb()
    .prepare(
      `SELECT i.global_id, i.label, i.statement, i.type
         FROM idea_theme_links itl
         JOIN ideas i ON i.global_id = itl.global_id
        WHERE itl.theme_id = ?
        LIMIT 12`
    )
    .all(themeId) as Array<{ global_id: string; label: string; statement: string; type: IdeaType }>;
  return rows.map((row) => ({
    id: row.global_id,
    tipo: row.type,
    etiqueta: row.label,
    enunciado: clip(row.statement, 220),
    cita: `nodus://idea/${row.global_id}`,
  }));
}

function selectedGaps(ids: string[]) {
  if (ids.length === 0) return [];
  const rows = getDb()
    .prepare(
      `SELECT g.id, g.kind, g.statement, g.related_idea, g.confidence,
              w.nodus_id, w.title, w.authors_json, w.year, w.zotero_key,
              i.label AS idea_label
         FROM gaps g
         JOIN works w ON w.nodus_id = g.nodus_id
         LEFT JOIN ideas i ON i.global_id = g.related_idea
        WHERE g.id IN (${placeholders(ids)})`
    )
    .all(...ids) as GapRow[];
  return rows.map((row) => ({
    id: row.id,
    tipo: row.kind,
    enunciado: row.statement,
    confianza: row.confidence,
    cita: `nodus://gap/${row.id}`,
    idea_relacionada: row.related_idea
      ? { id: row.related_idea, etiqueta: row.idea_label, cita: `nodus://idea/${row.related_idea}` }
      : null,
    obra: {
      id: row.nodus_id,
      titulo: row.title,
      autores: parseAuthors(row.authors_json),
      ano: row.year,
      cita: `nodus://work/${row.nodus_id}`,
    },
  }));
}

function selectedContradictions(ids: string[]) {
  const wanted = new Set(ids);
  return getContradictions()
    .filter((detail) => wanted.has(detail.edge.id))
    .map((detail) => ({
      id: detail.edge.id,
      tipo: detail.edge.type,
      base: detail.edge.basis,
      confianza: detail.edge.confidence,
      desde: detail.fromLabel,
      hacia: detail.toLabel,
      explicacion: detail.explanation,
      cita: `nodus://contradiction/${detail.edge.id}`,
      evidencia: detail.evidence.slice(0, 4).map((ev) => ({
        cita_textual: clip(ev.quote, 500),
        localizacion: ev.location,
        idea: ev.global_id,
        cita_idea: `nodus://idea/${ev.global_id}`,
      })),
    }));
}

function selectedWorks(ids: string[]) {
  if (ids.length === 0) return [];
  const rows = getDb()
    .prepare(
      `SELECT w.nodus_id, w.zotero_key, w.title, w.authors_json, w.year, w.deep_status,
              CASE WHEN w.summary_status = 'done' THEN ws.summary ELSE NULL END AS orientation_summary,
              COALESCE(GROUP_CONCAT(DISTINCT t.label), '') AS themes,
              COUNT(DISTINCT io.global_id) AS idea_count,
              COUNT(DISTINCT g.id) AS gap_count
         FROM works w
         LEFT JOIN work_summaries ws ON ws.nodus_id = w.nodus_id
         LEFT JOIN work_themes wt ON wt.nodus_id = w.nodus_id
         LEFT JOIN themes t ON t.theme_id = wt.theme_id
         LEFT JOIN idea_occurrences io ON io.nodus_id = w.nodus_id
         LEFT JOIN gaps g ON g.nodus_id = w.nodus_id
        WHERE w.nodus_id IN (${placeholders(ids)})
        GROUP BY w.nodus_id`
    )
    .all(...ids) as WorkRow[];
  return rows.map((row) => ({
    id: row.nodus_id,
    titulo: row.title,
    autores: parseAuthors(row.authors_json),
    ano: row.year,
    temas: splitList(row.themes),
    estado_profundo: row.deep_status,
    ideas: row.idea_count,
    huecos: row.gap_count,
    resumen_orientacion: row.orientation_summary,
    resumen_no_citable: row.orientation_summary ? true : undefined,
    cita: `nodus://work/${row.nodus_id}`,
  }));
}

/**
 * Passage evidence is fetched only when the writer explicitly generates a
 * draft. Selected passages are honored first; then the objective retrieves a
 * small semantic set constrained to the materials the writer chose.
 */
async function selectedPassagesForDraft(
  objective: string,
  selection: WritingWorkshopSelection
): Promise<Record<string, unknown>[]> {
  const selected = selectedPassages(selection.passageIds ?? []);
  const byId = new Map(selected.map((passage) => [String(passage.id), passage]));
  if (!objective.trim()) return capPassageContext([...byId.values()]);

  try {
    const query = await embed(objective.trim());
    if (!query) return capPassageContext([...byId.values()]);
    const scope = selectedWorkScope(selection);
    for (const passage of selected) {
      const work = passage.obra;
      if (work && typeof work === 'object' && 'id' in work && typeof work.id === 'string') scope.add(work.id);
    }
    const hits = findSimilarPassages(query, 0.18, 12, scope.size ? { nodusIds: [...scope] } : {});
    for (const hit of hits) {
      if (!byId.has(hit.passage_id)) byId.set(hit.passage_id, passageContext(hit));
    }
  } catch (error) {
    console.warn('[writingWorkshop] passage evidence unavailable:', error instanceof Error ? error.message : String(error));
  }
  return capPassageContext([...byId.values()]);
}

function selectedPassages(ids: string[]): Record<string, unknown>[] {
  if (ids.length === 0) return [];
  const rows = getDb()
    .prepare(
      `SELECT p.passage_id, p.nodus_id, p.text, p.page_label, w.title, w.authors_json, w.year, w.zotero_key
         FROM passages p
         JOIN works w ON w.nodus_id = p.nodus_id
        WHERE p.passage_id IN (${placeholders(ids)})
          AND w.archived = 0
          AND p.content_hash = w.deep_hash
        ORDER BY p.nodus_id, p.chunk_index`
    )
    .all(...ids) as Array<Omit<SimilarPassage, 'similarity'>>;
  return rows.map((row) => passageContext({ ...row, similarity: 0 }));
}

function selectedWorkScope(selection: WritingWorkshopSelection): Set<string> {
  const ids = new Set(selection.workIds ?? []);
  const db = getDb();
  const addRows = (sql: string, values: string[]) => {
    if (values.length === 0) return;
    const rows = db.prepare(sql.replace(':ids', placeholders(values))).all(...values) as { nodus_id: string }[];
    for (const row of rows) ids.add(row.nodus_id);
  };
  addRows('SELECT DISTINCT nodus_id FROM idea_occurrences WHERE global_id IN (:ids)', selection.ideaIds ?? []);
  addRows('SELECT DISTINCT nodus_id FROM gaps WHERE id IN (:ids)', selection.gapIds ?? []);
  addRows('SELECT DISTINCT nodus_id FROM work_themes WHERE theme_id IN (:ids)', selection.themeIds ?? []);
  const contradictionIds = new Set(selection.contradictionIds ?? []);
  for (const detail of getContradictions()) {
    if (!contradictionIds.has(detail.edge.id)) continue;
    for (const evidence of detail.evidence) ids.add(evidence.nodus_id);
  }
  return ids;
}

function passageContext(hit: SimilarPassage): Record<string, unknown> {
  return {
    id: hit.passage_id,
    texto: hit.text,
    localizacion: hit.page_label,
    obra: {
      id: hit.nodus_id,
      titulo: hit.title,
      autores: parseAuthors(hit.authors_json),
      ano: hit.year,
      zotero_key: hit.zotero_key,
    },
    cita: `nodus://passage/${encodeURIComponent(hit.passage_id)}`,
  };
}

function capPassageContext(passages: Record<string, unknown>[]): Record<string, unknown>[] {
  let chars = 0;
  const result: Record<string, unknown>[] = [];
  for (const passage of passages) {
    const text = typeof passage.texto === 'string' ? passage.texto : '';
    const remaining = MAX_PASSAGE_CONTEXT_CHARS - chars;
    if (remaining <= 0) break;
    const clipped = clip(text, remaining);
    if (!clipped) continue;
    chars += clipped.length;
    result.push({ ...passage, texto: clipped, recortado: clipped.length < text.length });
  }
  return result;
}

function selectedRoutes(ids: string[]) {
  const wanted = new Set(ids);
  return listTutorRoutes()
    .filter((route) => wanted.has(route.id))
    .map((route) => ({
      id: route.id,
      titulo: route.route.title,
      descripcion: route.route.description,
      modo: route.mode,
      objetivo: route.prompt,
      temas: route.route.themes,
      peso: route.route.weight,
      paradas: route.route.stops.map((stop) => ({
        titulo: stop.title,
        foco: stop.focus,
        tipo: stop.kind,
        nodos: stop.nodeIds,
        conexion: stop.edgeId,
      })),
    }));
}

function trimContext<T extends Record<string, any>>(context: T): T {
  return {
    ...context,
    ideas: context.ideas
      .slice(0, 96)
      .map((idea: any) => ({ ...idea, obras: idea.obras?.slice(0, 3) ?? [], evidencia: idea.evidencia?.slice(0, 2) ?? [] })),
    temas: context.temas.slice(0, 18).map((theme: any) => ({ ...theme, ideas_muestra: theme.ideas_muestra?.slice(0, 8) ?? [] })),
    huecos: context.huecos.slice(0, 20),
    contradicciones: context.contradicciones.slice(0, 16),
    obras: context.obras.slice(0, 42),
    pasajes_evidencia: context.pasajes_evidencia
      .slice(0, 12)
      .map((passage: any) => ({ ...passage, texto: clip(String(passage.texto ?? ''), 1800) })),
    rutas_tutor: context.rutas_tutor.slice(0, 4).map((route: any) => ({ ...route, paradas: route.paradas.slice(0, 22) })),
  };
}

function sanitizeDraft(
  ai: AiWorkshopResult,
  brief: WritingWorkshopBrief,
  selection: WritingWorkshopSelection,
  context: WorkshopContext
): WritingWorkshopDraft {
  const draftMarkdown = normalizeCitationLabels(ensureSubstantialMarkdown(cleanString(ai.draftMarkdown, ''), brief, context));
  const outline = sanitizeOutline(ai.outline).map((section) => ({
    ...section,
    sources: section.sources.map(normalizeCitationLabels),
  }));
  const matrix = sanitizeMatrix(ai.matrix).map((row) => ({
    ...row,
    sourceLabel: citationLabelForUrl(row.citation) ?? row.sourceLabel,
  }));
  return {
    generatedAt: new Date().toISOString(),
    brief,
    selection,
    title: cleanString(ai.title, 'Borrador de escritura'),
    abstract: cleanString(ai.abstract, ''),
    outline,
    draftMarkdown,
    matrix,
    bibliography: stringList(ai.bibliography),
    nextSteps: stringList(ai.nextSteps),
    limitations: stringList(ai.limitations),
    stats: context.stats,
  };
}

function structuralFallback(
  brief: WritingWorkshopBrief,
  selection: WritingWorkshopSelection,
  context: WorkshopContext
): WritingWorkshopDraft {
  const payload = context.payload as any;
  const title = `${kindLabel(brief.kind)}: ${brief.objective || 'borrador'}`;
  const ideas = (payload.ideas ?? []) as any[];
  const gaps = (payload.huecos ?? []) as any[];
  const contradictions = (payload.contradicciones ?? []) as any[];
  const works = (payload.obras ?? []) as any[];
  const passages = (payload.pasajes_evidencia ?? []) as any[];
  const outline: WritingWorkshopSection[] = [
    {
      id: 's0',
      title: 'Evidencia textual recuperada',
      purpose: 'Anclar el argumento en fragmentos verificables del texto completo.',
      keyClaims: passages.slice(0, 3).map((passage) => passage.texto),
      sources: passages.slice(0, 3).map((passage) => citationMarkdown(passage.obra, passage.cita)),
    },
    {
      id: 's1',
      title: 'Planteamiento',
      purpose: 'Delimitar el problema y situar las líneas principales del corpus.',
      keyClaims: ideas.slice(0, 3).map((i) => i.enunciado),
      sources: ideas.slice(0, 3).map((i) => citationMarkdown(i.obras?.[0], i.cita)),
    },
    {
      id: 's2',
      title: 'Debate y matices',
      purpose: 'Ordenar apoyos, contrastes y contradicciones relevantes.',
      keyClaims: contradictions.slice(0, 3).map((c) => c.explicacion ?? `${c.desde} / ${c.hacia}`),
      sources: contradictions.slice(0, 3).map((c) => `[contradicción](nodus://contradiction/${c.id})`),
    },
    {
      id: 's3',
      title: 'Hueco y contribución',
      purpose: 'Convertir huecos detectados en una contribución defendible.',
      keyClaims: gaps.slice(0, 3).map((g) => g.enunciado),
      sources: gaps.slice(0, 3).map((g) => `[hueco](nodus://gap/${g.id})`),
    },
  ];
  const matrix: WritingWorkshopMatrixRow[] = [
    ...ideas.slice(0, 8).map((idea): WritingWorkshopMatrixRow => ({
      claim: idea.enunciado,
      role: 'support',
      sourceLabel: sourceLabel(idea.obras?.[0]),
      citation: idea.cita,
      evidence: idea.evidencia?.[0]?.cita_textual ?? 'Idea extraída del corpus.',
      notes: 'Usar como apoyo central.',
    })),
    ...gaps.slice(0, 5).map((gap): WritingWorkshopMatrixRow => ({
      claim: gap.enunciado,
      role: 'gap',
      sourceLabel: sourceLabel(gap.obra),
      citation: gap.cita,
      evidence: 'Hueco minado de la obra indicada.',
      notes: 'Usar para justificar la contribución.',
    })),
    ...passages.slice(0, 10).map((passage): WritingWorkshopMatrixRow => ({
      claim: clip(passage.texto, 220),
      role: 'support',
      sourceLabel: sourceLabel(passage.obra),
      citation: passage.cita,
      evidence: passage.texto,
      notes: passage.localizacion ? `Evidencia literal (${passage.localizacion}).` : 'Evidencia literal del texto completo.',
    })),
  ];
  const draftMarkdown = [
    `## ${title}`,
    '',
    '## Planteamiento',
    ideas.length ? narrativeParagraph(ideas.slice(0, 5), 'El punto de partida del corpus es que') : 'No hay ideas seleccionadas suficientes para desarrollar este apartado.',
    '',
    '## Evidencia textual recuperada',
    passages.length
      ? passages
          .slice(0, 5)
          .map((passage) => `El corpus contiene esta evidencia literal: “${passage.texto}” ${citationMarkdown(passage.obra, passage.cita)}.`)
          .join('\n\n')
      : 'No hay pasajes indexados disponibles para anclar este borrador en texto completo.',
    '',
    '## Lineas de desarrollo',
    ...ideaDevelopmentSections(ideas.slice(5)),
    '',
    '## Debate, matices y tensiones',
    contradictions.length
      ? contradictions
          .slice(0, 4)
          .map(
            (c) =>
              `La relacion entre ${c.desde} y ${c.hacia} introduce un matiz critico: ${c.explicacion ?? `${c.desde} / ${c.hacia}`} [contradiccion](${c.cita}).`
          )
          .join('\n\n')
      : 'No hay contradicciones seleccionadas.',
    '',
    '## Hueco y contribución',
    gaps.length
      ? gaps
          .slice(0, 5)
          .map((g) => `Este recorrido deja visible un hueco de investigacion: ${g.enunciado} [hueco](${g.cita}).`)
          .join('\n\n')
      : 'No hay huecos seleccionados.',
  ].join('\n');

  return {
    generatedAt: new Date().toISOString(),
    brief,
    selection,
    title,
    abstract: 'Borrador estructural generado a partir de materiales reales del grafo.',
    outline,
    draftMarkdown,
    matrix,
    bibliography: works.map((w) => `${sourceLabel(w)}. ${w.titulo}.`),
    nextSteps: ['Revisar cada cita y pedir una versión desarrollada con el modelo si hace falta.'],
    limitations: ['El modelo no devolvió un JSON válido; se generó una estructura local con los materiales seleccionados.'],
    stats: context.stats,
  };
}

function sanitizeOutline(items: AiWorkshopResult['outline']): WritingWorkshopSection[] {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 12).map((item, index) => ({
    id: cleanString(item.id, `s${index + 1}`),
    title: cleanString(item.title, `Sección ${index + 1}`),
    purpose: cleanString(item.purpose, ''),
    keyClaims: stringList(item.keyClaims).slice(0, 12),
    sources: stringList(item.sources).slice(0, 12),
  }));
}

function sanitizeMatrix(items: AiWorkshopResult['matrix']): WritingWorkshopMatrixRow[] {
  if (!Array.isArray(items)) return [];
  const roles = new Set<WritingWorkshopMatrixRow['role']>(['support', 'contrast', 'gap', 'method', 'definition', 'context']);
  return items.slice(0, 90).map((item) => {
    const role = roles.has(item.role as WritingWorkshopMatrixRow['role'])
      ? (item.role as WritingWorkshopMatrixRow['role'])
      : 'support';
    return {
      claim: cleanString(item.claim, ''),
      role,
      sourceLabel: cleanString(item.sourceLabel, ''),
      citation: cleanString(item.citation, ''),
      evidence: cleanString(item.evidence, ''),
      notes: cleanString(item.notes, ''),
    };
  });
}

function ensureSubstantialMarkdown(
  draftMarkdown: string,
  brief: WritingWorkshopBrief,
  context: WorkshopContext
): string {
  const clean = draftMarkdown.trim();
  const payload = context.payload as any;
  const ideas = ((payload.ideas ?? []) as any[]).filter((idea) => idea?.enunciado);
  const gaps = ((payload.huecos ?? []) as any[]).filter((gap) => gap?.enunciado);
  const contradictions = ((payload.contradicciones ?? []) as any[]).filter((item) => item?.desde || item?.hacia || item?.explicacion);
  const minimumChars = ideas.length >= 20 ? 9000 : ideas.length >= 8 ? 5500 : 2600;
  if (clean.length >= minimumChars || ideas.length === 0) return clean;

  const supplement = [
    '',
    '## Desarrollo ampliado de las ideas seleccionadas',
    `El objetivo de este ${kindLabel(brief.kind)} exige que las ideas no queden como notas sueltas, sino como una secuencia argumental. ${narrativeParagraph(
      ideas.slice(0, 5),
      'En primer lugar, el corpus permite sostener que'
    )}`,
    '',
    ...ideaDevelopmentSections(ideas.slice(5)),
    gaps.length ? '## Huecos que orientan la contribución' : '',
    gaps.length
      ? gaps
          .slice(0, 6)
          .map((gap) => `Este desarrollo abre una pregunta especifica: ${gap.enunciado} [hueco](${gap.cita}).`)
          .join('\n\n')
      : '',
    contradictions.length ? '## Tensiones interpretativas' : '',
    contradictions.length
      ? contradictions
          .slice(0, 5)
          .map(
            (item) =>
              `La relacion entre ${item.desde ?? 'una idea'} y ${item.hacia ?? 'otra idea'} obliga a matizar el argumento: ${item.explicacion ?? 'hay una tension registrada en el grafo'} [contradiccion](${item.cita}).`
          )
          .join('\n\n')
      : '',
  ].filter(Boolean);

  return [clean, ...supplement].join('\n');
}

function ideaDevelopmentSections(ideas: any[]): string[] {
  const sections: string[] = [];
  let sectionNumber = 1;
  for (let i = 0; i < ideas.length; i += 5) {
    const chunk = ideas.slice(i, i + 5);
    if (chunk.length === 0) continue;
    const isFirst = sectionNumber === 1;
    sections.push(`### Linea ${sectionNumber}`);
    sections.push(narrativeParagraph(chunk, isFirst ? 'A partir de esa base, otra linea del corpus muestra que' : 'La linea se completa cuando'));
    sections.push('');
    sectionNumber += 1;
  }
  return sections;
}

function narrativeParagraph(ideas: any[], opener: string): string {
  const clauses = ideas
    .filter((idea) => idea?.enunciado)
    .map((idea) => `${idea.enunciado} ${citationMarkdown(idea.obras?.[0], idea.cita)}`);
  if (clauses.length === 0) return 'No hay ideas suficientes para desarrollar esta linea.';
  if (clauses.length === 1) return `${opener} ${clauses[0]}.`;
  const [first, ...rest] = clauses;
  return `${opener} ${first}. Esto se conecta con ${rest.join('; y, a la vez, con ')}. En conjunto, estas ideas no deben leerse como evidencias aisladas, sino como piezas de una misma arquitectura argumental que permite pasar de la revision del corpus a una posicion propia.`;
}

function placeholders(values: string[]): string {
  return values.map(() => '?').join(',');
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 3 && !STOP_WORDS.has(token))
  );
}

function relevance(tokens: Set<string>, text: string): number {
  if (tokens.size === 0) return 0;
  const hay = tokenize(text);
  let hits = 0;
  for (const token of tokens) if (hay.has(token)) hits += 1;
  return Math.min(0.55, hits / Math.max(4, tokens.size));
}

function reasonFor(score: number, support: number, semantic: number): string {
  if (semantic >= support) return 'Coincide con el objetivo escrito.';
  if (score > 0.22) return 'Material conectado y con soporte en el corpus.';
  return 'Candidato con señales útiles para el borrador.';
}

function sortScored<T extends WritingWorkshopCandidateBase>(a: Scored<T>, b: Scored<T>): number {
  return b.score - a.score || a.item.label.localeCompare(b.item.label, 'es');
}

function parseAuthors(value: string): string[] {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter((a): a is string => typeof a === 'string') : [];
  } catch {
    return [];
  }
}

function splitList(value: string | null): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function clip(text: string, max = 240): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trim()}…` : clean;
}

function cleanString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((s) => s.trim())
    : [];
}

type CitationWork = { autores?: string[]; authors?: string[]; ano?: number | null; year?: number | null };

const citationLabelCache = new Map<string, string | null>();

function sourceLabel(work: CitationWork | undefined): string {
  if (!work) return 'Fuente del corpus';
  const authors = 'autores' in work ? work.autores : work.authors;
  const year = 'ano' in work ? work.ano : work.year;
  return authorYearLabel(authors?.[0], year);
}

/** Convert Nodus's stored `Apellido, I.` name into a readable inline citation. */
function authorYearLabel(author: string | undefined, year: number | null | undefined): string {
  const raw = author?.replace(/\s+/g, ' ').trim();
  if (!raw) return year ? `Autor (${year})` : 'Autor';

  const comma = raw.indexOf(',');
  const surname = (comma >= 0 ? raw.slice(0, comma) : raw.split(' ').slice(-1).join(' ')).trim() || raw;
  const given = (comma >= 0 ? raw.slice(comma + 1) : raw.split(' ').slice(0, -1).join(' ')).trim();
  const initial = given.match(/[\p{L}]/u)?.[0]?.toLocaleUpperCase('es-ES');
  const name = initial ? `${surname}, ${initial}.` : surname;
  return year ? `${name} (${year})` : name;
}

/** Resolve a Nodus citation to its canonical source label. */
function citationLabelForUrl(citation: string): string | null {
  const cached = citationLabelCache.get(citation);
  if (cached !== undefined) return cached;

  const match = citation.match(/^nodus:\/\/(idea|work|passage)\/(.+)$/);
  if (!match) return null;
  let id: string;
  try {
    id = decodeURIComponent(match[2]);
  } catch {
    return null;
  }

  const db = getDb();
  let row: { authors_json: string; year: number | null } | undefined;
  if (match[1] === 'passage') {
    const passage = db
      .prepare(
        `SELECT w.authors_json, w.year, p.page_label
           FROM passages p JOIN works w ON w.nodus_id = p.nodus_id
          WHERE p.passage_id = ?`
      )
      .get(id) as { authors_json: string; year: number | null; page_label: string | null } | undefined;
    const label = passage
      ? `${sourceLabel({ authors: parseAuthors(passage.authors_json), year: passage.year })}${passage.page_label ? `, ${passage.page_label}` : ''}`
      : null;
    citationLabelCache.set(citation, label);
    return label;
  }
  if (match[1] === 'work') {
    row = db
      .prepare('SELECT authors_json, year FROM works WHERE nodus_id = ?')
      .get(id) as typeof row;
  } else {
    row = db
      .prepare(
        `SELECT w.authors_json, w.year
           FROM idea_occurrences io
           JOIN works w ON w.nodus_id = io.nodus_id
          WHERE io.global_id = ? AND w.archived = 0
          ORDER BY io.role = 'principal' DESC, io.confidence DESC, w.year DESC
          LIMIT 1`
      )
      .get(id) as typeof row;
  }
  const label = row ? sourceLabel({ authors: parseAuthors(row.authors_json), year: row.year }) : null;
  citationLabelCache.set(citation, label);
  return label;
}

/** Never display a model-invented or abbreviated label when its nodus target is known. */
function normalizeCitationLabels(markdown: string): string {
  return markdown.replace(/\[([^\]]*)\]\((nodus:\/\/(?:idea|work|passage)\/[^)]+)\)/g, (full, _label: string, citation: string) => {
    const label = citationLabelForUrl(citation);
    return label ? `[${label}](${citation})` : full;
  });
}

function citationMarkdown(work: any, fallbackCitation: string): string {
  return `[${sourceLabel(work)}](${fallbackCitation})`;
}

function kindLabel(kind: WritingWorkshopBrief['kind']): string {
  switch (kind) {
    case 'literature_review':
      return 'estado de la cuestion';
    case 'theoretical_framework':
      return 'marco teorico';
    case 'debate':
      return 'debate entre autores';
    case 'gap_justification':
      return 'justificacion de hueco';
    case 'chapter_section':
      return 'apartado de capitulo';
    case 'research_question':
      return 'pregunta o hipotesis de investigacion';
  }
}

const STOP_WORDS = new Set([
  'para',
  'como',
  'sobre',
  'entre',
  'desde',
  'hacia',
  'este',
  'esta',
  'estos',
  'estas',
  'cada',
  'cual',
  'cuales',
  'donde',
  'cuando',
  'porque',
  'pero',
  'tambien',
  'with',
  'that',
  'this',
  'from',
  'dans',
  'avec',
  'pour',
]);
