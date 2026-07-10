import type {
  GraphData,
  ImmersionAnswerRecord,
  ImmersionAnswerRequest,
  ImmersionAnswerResult,
  ImmersionAssessment,
  ImmersionBuildProgress,
  ImmersionQuizQuestion,
  ImmersionRequest,
  ImmersionScope,
  ImmersionScopeRequest,
  ImmersionSession,
  ModelRef,
  WritingWorkshopIdeaCandidate,
} from '@shared/types';
import { getDb } from '../db/database';
import { getSettings } from '../db/settingsRepo';
import { getApiKey } from '../secrets/secretStore';
import { buildIdeaGraph, getContradictions } from '../graph/graphService';
import { getImmersionSession, recordImmersionAnswer, saveImmersionSession } from '../db/immersionRepo';
import { buildWritingWorkshopSnapshot } from './writingWorkshop';
import { completeJson, embed } from './aiClient';
import {
  IMMERSION_LIMITS,
  orchestrateImmersion,
  resolveStationCount,
  type ContrastsInput,
  type ContrastsResult,
  type CurriculumInput,
  type CurriculumResult,
  type ExamInput,
  type ExamResult,
  type ImmersionDeps,
  type ImmersionMaterial,
  type MaterialAuthor,
  type MaterialIdea,
  type MaterialPassage,
  type PanoramaInput,
  type PanoramaResult,
  type StationInput,
  type StationResult,
} from './immersionCore';

// ─────────────────────────────────────────────────────────────────────────────
// AI + DB wiring for Inmersión. The control flow lives in ./immersionCore; here
// we assemble the topic material from embeddings + graph (no AI) and bind the
// injected AI dependencies to real provider calls.
// ─────────────────────────────────────────────────────────────────────────────

// Relevance cutoffs that separate "the topic" from "the rest of the corpus".
// Scores come from writingWorkshop's semanticStrength (cosine clamped to [0, 0.65]).
const IDEA_SCORE_CUT = 0.28;
const IDEA_MIN_KEEP = 16;
const IDEA_MAX_KEEP = 60;
const PASSAGE_SCORE_CUT = 0.25;
const PASSAGE_MAX_KEEP = 24;
const WORK_MAX_KEEP = 40;
const GAP_SCORE_CUT = 0.2;

/** Let the event loop breathe between heavy synchronous steps (queries + graph build). */
function yieldLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zñ\s,.-]/gi, '')
    .trim();
}

/** Map a display name from works.authors_json to a canonical author row when unambiguous. */
function buildAuthorResolver(): (name: string) => string | null {
  const rows = getDb().prepare('SELECT author_id, name FROM authors').all() as { author_id: string; name: string }[];
  const exact = new Map<string, string[]>();
  const byLastInitial = new Map<string, string[]>();
  for (const row of rows) {
    const norm = normalizeName(row.name);
    exact.set(norm, [...(exact.get(norm) ?? []), row.author_id]);
    const [last, first] = norm.split(',').map((s) => s.trim());
    if (last) {
      const key = `${last}::${(first ?? '').charAt(0)}`;
      byLastInitial.set(key, [...(byLastInitial.get(key) ?? []), row.author_id]);
    }
  }
  return (name: string) => {
    const norm = normalizeName(name);
    const hitExact = exact.get(norm);
    if (hitExact?.length === 1) return hitExact[0];
    // "Given Surname" display order → try surname + first initial.
    const parts = norm.replace(',', ' ').split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const candidates = [
        `${parts[parts.length - 1]}::${parts[0].charAt(0)}`, // Given Surname
        `${parts[0]}::${(parts[1] ?? '').charAt(0)}`, // Surname, Given
      ];
      for (const key of candidates) {
        const hit = byLastInitial.get(key);
        if (hit?.length === 1) return hit[0];
      }
    }
    return null;
  };
}

function ideaAuthors(idea: WritingWorkshopIdeaCandidate): string[] {
  return [...new Set(idea.works.flatMap((w) => w.authors))];
}

/**
 * Lexical passage retrieval for corpora without a usable embedding index:
 * score passages of the topic's works by how many topic tokens they contain.
 */
function lexicalPassageFallback(topic: string, workIds: string[]): { id: string; score: number }[] {
  const tokens = [
    ...new Set(
      topic
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .split(/[^a-zñç0-9]+/i)
        .filter((tk) => tk.length > 3)
    ),
  ].slice(0, 6);
  if (tokens.length === 0 || workIds.length === 0) return [];
  const hitsExpr = tokens.map(() => `(CASE WHEN instr(lower(p.text), ?) > 0 THEN 1 ELSE 0 END)`).join(' + ');
  const rows = getDb()
    .prepare(
      `SELECT passage_id, hits FROM (
         SELECT p.passage_id, (${hitsExpr}) AS hits
           FROM passages p
          WHERE p.nodus_id IN (${workIds.map(() => '?').join(',')})
       ) WHERE hits > 0
       ORDER BY hits DESC
       LIMIT ?`
    )
    .all(...tokens, ...workIds, PASSAGE_MAX_KEEP) as { passage_id: string; hits: number }[];
  return rows.map((row) => ({ id: row.passage_id, score: Math.min(0.5, (row.hits / tokens.length) * 0.5) }));
}

/**
 * Assemble everything the orchestrator needs about one topic. Pure retrieval:
 * embeddings rank the corpus, the graph provides edges/debates, the passages
 * table provides the REAL full text. No AI calls happen here.
 */
export async function buildImmersionMaterial(topic: string): Promise<ImmersionMaterial> {
  const query = topic.trim();
  const vector = await embed(query);
  const snapshot = await buildWritingWorkshopSnapshot({ kind: 'deep_research', objective: query });
  await yieldLoop();

  // ── Ideas: relevance-gated so an afternoon stays on-topic, never the whole corpus.
  const rankedIdeas = [...snapshot.ideas].sort((a, b) => b.score - a.score);
  let scopedIdeas = rankedIdeas.filter((idea) => idea.score >= IDEA_SCORE_CUT);
  if (scopedIdeas.length < IDEA_MIN_KEEP) {
    scopedIdeas = rankedIdeas.filter((idea) => idea.score > 0).slice(0, IDEA_MIN_KEEP);
  }
  scopedIdeas = scopedIdeas.slice(0, IDEA_MAX_KEEP);

  const ideas: MaterialIdea[] = scopedIdeas.map((idea) => ({
    id: idea.id,
    type: idea.type,
    label: idea.label,
    statement: idea.statement,
    score: idea.score,
    themes: idea.themes,
    authors: ideaAuthors(idea),
    works: idea.works.map((w) => ({ nodusId: w.nodus_id, title: w.title, year: w.year, zoteroKey: w.zotero_key ?? null })),
  }));
  const ideaIds = new Set(ideas.map((i) => i.id));

  // ── Passages: keep the strongest hits, then re-read the FULL stored text.
  let passageCandidates: { id: string; score: number }[] = snapshot.passages
    .filter((p) => p.score >= PASSAGE_SCORE_CUT)
    .slice(0, PASSAGE_MAX_KEEP)
    .map((p) => ({ id: p.id, score: p.score }));
  if (passageCandidates.length === 0 && ideas.length) {
    // No semantic hits (e.g. no embedding key): fall back to a lexical scan
    // scoped to the topic's works so the immersion still gets literal quotes.
    const scopedWorkIds = [...new Set(ideas.flatMap((i) => i.works.map((w) => w.nodusId)))].slice(0, WORK_MAX_KEEP);
    passageCandidates = lexicalPassageFallback(query, scopedWorkIds);
  }
  const passages: MaterialPassage[] = [];
  if (passageCandidates.length) {
    const rows = getDb()
      .prepare(
        `SELECT p.passage_id, p.nodus_id, p.text, p.page_label, w.title, w.authors_json, w.year, w.zotero_key
           FROM passages p
           JOIN works w ON w.nodus_id = p.nodus_id
          WHERE p.passage_id IN (${passageCandidates.map(() => '?').join(',')})`
      )
      .all(...passageCandidates.map((p) => p.id)) as {
      passage_id: string;
      nodus_id: string;
      text: string;
      page_label: string | null;
      title: string;
      authors_json: string | null;
      year: number | null;
      zotero_key: string | null;
    }[];
    const scoreById = new Map(passageCandidates.map((p) => [p.id, p.score] as const));
    for (const row of rows) {
      let authors: string[] = [];
      try {
        authors = JSON.parse(row.authors_json || '[]');
      } catch {
        /* ignore */
      }
      passages.push({
        id: row.passage_id,
        workId: row.nodus_id,
        workTitle: row.title || '(sin título)',
        authors,
        year: row.year,
        zoteroKey: row.zotero_key,
        pageLabel: row.page_label,
        text: row.text,
        score: scoreById.get(row.passage_id) ?? 0,
      });
    }
    passages.sort((a, b) => b.score - a.score);
  }
  await yieldLoop();

  // ── Works: union of the scoped ideas' works and the strongest passage works.
  const workScore = new Map<string, number>();
  const workMeta = new Map<string, { title: string; authors: string[]; year: number | null; zoteroKey: string | null }>();
  const ideaCountByWork = new Map<string, number>();
  for (const idea of ideas) {
    for (const work of idea.works) {
      workMeta.set(work.nodusId, { title: work.title, authors: [], year: work.year, zoteroKey: work.zoteroKey });
      workScore.set(work.nodusId, Math.max(workScore.get(work.nodusId) ?? 0, idea.score));
      ideaCountByWork.set(work.nodusId, (ideaCountByWork.get(work.nodusId) ?? 0) + 1);
    }
  }
  for (const passage of passages) {
    if (!workMeta.has(passage.workId)) {
      workMeta.set(passage.workId, { title: passage.workTitle, authors: passage.authors, year: passage.year, zoteroKey: passage.zoteroKey });
    }
    workScore.set(passage.workId, Math.max(workScore.get(passage.workId) ?? 0, passage.score));
  }
  // Fill author lists from the snapshot works pool (it has them parsed already).
  const snapshotWorkById = new Map(snapshot.works.map((w) => [w.id, w] as const));
  const works = [...workMeta.entries()]
    .map(([nodusId, meta]) => {
      const fromSnapshot = snapshotWorkById.get(nodusId);
      return {
        nodusId,
        title: fromSnapshot?.title ?? meta.title,
        authors: fromSnapshot?.authors?.length ? fromSnapshot.authors : meta.authors,
        year: fromSnapshot?.year ?? meta.year,
        zoteroKey: (fromSnapshot?.zotero_key ?? meta.zoteroKey) || null,
        score: workScore.get(nodusId) ?? 0,
        ideaCount: ideaCountByWork.get(nodusId) ?? 0,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, WORK_MAX_KEEP);

  // ── Authors: aggregated from the scoped material, resolved to canonical ids when possible.
  const resolveAuthor = buildAuthorResolver();
  const authorAgg = new Map<string, { ideaCount: number; works: Set<string> }>();
  for (const idea of ideas) {
    for (const name of idea.authors) {
      const agg = authorAgg.get(name) ?? { ideaCount: 0, works: new Set<string>() };
      agg.ideaCount += 1;
      for (const w of idea.works) agg.works.add(w.nodusId);
      authorAgg.set(name, agg);
    }
  }
  const authors: MaterialAuthor[] = [...authorAgg.entries()]
    .map(([name, agg]) => ({
      authorId: resolveAuthor(name),
      name,
      ideaCount: agg.ideaCount,
      workCount: agg.works.size,
    }))
    .sort((a, b) => b.ideaCount - a.ideaCount);
  await yieldLoop();

  // ── Edges among scoped ideas (for the station graph excerpts and debates).
  const idList = [...ideaIds];
  const edgeRows = idList.length
    ? (getDb()
        .prepare(
          `SELECT id, from_id, to_id, type FROM visible_edges
            WHERE from_id IN (${idList.map(() => '?').join(',')})
              AND to_id IN (${idList.map(() => '?').join(',')})`
        )
        .all(...idList, ...idList) as { id: string; from_id: string; to_id: string; type: string }[])
    : [];
  const edges = edgeRows.map((e) => ({ id: e.id, source: e.from_id, target: e.to_id, type: e.type }));

  const ideaLabelById = new Map(ideas.map((i) => [i.id, i.label] as const));
  const debates = getContradictions()
    .filter((d) => ideaIds.has(d.edge.from_id) && ideaIds.has(d.edge.to_id))
    .map((d) => ({
      edgeId: d.edge.id,
      fromIdeaId: d.edge.from_id,
      toIdeaId: d.edge.to_id,
      fromLabel: d.fromLabel || ideaLabelById.get(d.edge.from_id) || '',
      toLabel: d.toLabel || ideaLabelById.get(d.edge.to_id) || '',
      type: d.edge.type,
    }));

  // ── Gaps relevant to the topic (already ranked against the objective).
  const gaps = snapshot.gaps
    .filter((g) => g.score >= GAP_SCORE_CUT)
    .slice(0, IMMERSION_LIMITS.frontiers)
    .map((g) => ({ id: g.id, kind: g.kind, statement: g.summary || g.label, workTitle: g.work?.title ?? null, score: g.score }));

  const themes = [...new Set(ideas.flatMap((i) => i.themes))].slice(0, 20);
  await yieldLoop();

  // ── Topic subgraph: the user-visible graph filtered to the scoped ideas.
  const fullGraph = await buildIdeaGraph();
  await yieldLoop();
  const nodes = fullGraph.nodes.filter((n) => ideaIds.has(n.id));
  const nodeIds = new Set(nodes.map((n) => n.id));
  const graph: GraphData = {
    nodes,
    edges: fullGraph.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target)),
  };

  return {
    topic: query,
    embeddingAvailable: vector != null,
    ideas,
    passages,
    works,
    authors,
    edges,
    debates,
    gaps,
    themes,
    graph,
  };
}

/** Phase 0 — the territory map shown before anything is generated. Pure, no AI. */
export async function buildImmersionScope(request: ImmersionScopeRequest): Promise<ImmersionScope> {
  const material = await buildImmersionMaterial(request.topic);
  const warnings: string[] = [];
  const settings = getSettings();
  const plannedModel = settings.immersionModel ?? settings.synthesisModel ?? null;
  const aiKeyAvailable = plannedModel != null && getApiKey(plannedModel.provider) != null;
  if (!aiKeyAvailable) {
    warnings.push(
      plannedModel
        ? `Falta la clave de IA para ${plannedModel.provider}: sin ella la inmersión saldría vacía (solo esqueleto estructural). Añádela en Ajustes.`
        : 'No hay modelo de IA configurado: la inmersión saldría vacía (solo esqueleto estructural).'
    );
  }
  if (!material.embeddingAvailable) {
    warnings.push('Sin embeddings configurados: el alcance se calculó por coincidencia léxica y será menos preciso.');
  }
  if (material.passages.length === 0) {
    warnings.push('No hay pasajes indexados para este tema: la inmersión no podrá mostrar citas literales del texto completo.');
  }
  if (material.ideas.length < IDEA_MIN_KEEP / 2) {
    warnings.push('Hay poco material relevante: analiza más obras en profundidad para una inmersión más rica.');
  }
  return {
    topic: material.topic,
    generatedAt: new Date().toISOString(),
    embeddingAvailable: material.embeddingAvailable,
    aiKeyAvailable,
    ideas: material.ideas.map((i) => ({
      id: i.id,
      type: i.type as ImmersionScope['ideas'][number]['type'],
      label: i.label,
      statement: i.statement,
      score: i.score,
      themes: i.themes,
      authors: i.authors,
      workIds: i.works.map((w) => w.nodusId),
    })),
    works: material.works.map((w) => ({
      nodusId: w.nodusId,
      title: w.title,
      authors: w.authors,
      year: w.year,
      zoteroKey: w.zoteroKey,
      score: w.score,
      ideaCount: w.ideaCount,
    })),
    authors: material.authors,
    themes: material.themes,
    debateCount: material.debates.length,
    gapCount: material.gaps.length,
    passageCount: material.passages.length,
    graph: material.graph,
    estimatedStations: resolveStationCount(150, material.ideas.length),
    warnings,
  };
}

export async function generateImmersionSession(
  request: ImmersionRequest,
  onProgress?: (p: ImmersionBuildProgress) => void
): Promise<ImmersionSession> {
  const settings = getSettings();
  const model = request.model ?? settings.immersionModel ?? settings.synthesisModel ?? null;
  const plan = await orchestrateImmersion({ ...request, model }, realDeps(model), onProgress);
  return saveImmersionSession(plan, model);
}

// ─────────────────────────────────────────────────────────────────────────────
// Answer evaluation (choice → local, open → AI with heuristic fallback)
// ─────────────────────────────────────────────────────────────────────────────

function findQuestion(session: ImmersionSession, questionId: string): ImmersionQuizQuestion | null {
  for (const station of session.plan.stations) {
    const hit = station.quiz.find((q) => q.id === questionId);
    if (hit) return hit;
  }
  return session.plan.exam.questions.find((q) => q.id === questionId) ?? null;
}

interface AiImmersionAssessment {
  verdict: 'solid' | 'partial' | 'weak';
  score: number;
  feedback: string;
  missing: string[];
}

function isImmersionAssessment(value: unknown): value is AiImmersionAssessment {
  if (!value || typeof value !== 'object') return false;
  const o = value as Record<string, unknown>;
  return (
    (o.verdict === 'solid' || o.verdict === 'partial' || o.verdict === 'weak') &&
    typeof o.score === 'number' &&
    typeof o.feedback === 'string' &&
    Array.isArray(o.missing)
  );
}

function heuristicAssessment(question: ImmersionQuizQuestion, answer: string, session: ImmersionSession): ImmersionAssessment {
  const ideaById = new Map(session.plan.ideaIndex.map((i) => [i.id, i] as const));
  const related = question.ideaIds.map((id) => ideaById.get(id)).filter((i): i is NonNullable<typeof i> => Boolean(i));
  const lower = answer.toLowerCase();
  const hits = related.filter((idea) => lower.includes((idea.label.toLowerCase().split(/\s+/)[0] ?? '').trim())).length;
  const score = Math.max(20, Math.min(75, 30 + hits * 15 + Math.floor(answer.length / 140) * 5));
  return {
    verdict: score >= 70 ? 'solid' : score >= 45 ? 'partial' : 'weak',
    score,
    feedback:
      'Evaluación heurística (sin modelo disponible): contrasta tu respuesta con lo esperado y con las ideas de la estación.',
    missing: related.slice(0, 3).map((idea) => idea.label),
  };
}

export async function evaluateImmersionAnswer(request: ImmersionAnswerRequest): Promise<ImmersionAnswerResult> {
  const session = getImmersionSession(request.sessionId);
  if (!session) throw new Error('Sesión de inmersión no encontrada');
  const question = findQuestion(session, request.questionId);
  if (!question) throw new Error('Pregunta no encontrada en esta sesión');

  let record: ImmersionAnswerRecord;
  if (question.kind === 'choice') {
    const index = Number(request.answer);
    const correct = Number.isInteger(index) && index === question.correctIndex;
    record = {
      questionId: question.id,
      kind: 'choice',
      answer: request.answer,
      correct,
      assessment: null,
      answeredAt: new Date().toISOString(),
    };
  } else {
    const settings = getSettings();
    const model = request.model ?? session.model ?? settings.immersionModel ?? settings.synthesisModel ?? null;
    let assessment: ImmersionAssessment;
    if (!model) {
      assessment = heuristicAssessment(question, request.answer, session);
    } else {
      const ideaById = new Map(session.plan.ideaIndex.map((i) => [i.id, i] as const));
      const related = question.ideaIds.map((id) => ideaById.get(id)).filter((i): i is NonNullable<typeof i> => Boolean(i));
      const system =
        'Eres un tutor académico estricto pero útil dentro del modo Inmersión de Nodus. Evalúa si la respuesta domina la pregunta según lo esperado y las ideas del corpus proporcionadas. ' +
        'No inventes información. Devuelve exclusivamente JSON: {"verdict":"solid|partial|weak","score":0-100,"feedback":"...","missing":["..."]}.';
      const user = JSON.stringify({
        tema: session.plan.topic,
        pregunta: question.question,
        respuesta_esperada: question.expected,
        respuesta_del_estudiante: request.answer,
        ideas_relacionadas: related.map((idea) => ({
          etiqueta: idea.label,
          enunciado: idea.statement,
          autores: idea.authors,
          obras: idea.workTitles,
        })),
        idioma: session.plan.language,
      });
      try {
        const ai = await completeJson<AiImmersionAssessment>({ system, user, temperature: 0.1, maxTokens: 1800 }, isImmersionAssessment, model);
        assessment = {
          verdict: ai.verdict,
          score: Math.max(0, Math.min(100, Math.round(ai.score))),
          feedback: ai.feedback.trim(),
          missing: ai.missing.filter((m): m is string => typeof m === 'string').slice(0, 5),
        };
      } catch {
        assessment = heuristicAssessment(question, request.answer, session);
      }
    }
    record = {
      questionId: question.id,
      kind: 'open',
      answer: request.answer,
      correct: null,
      assessment,
      answeredAt: new Date().toISOString(),
    };
  }

  const progress = recordImmersionAnswer(session.id, record);
  return { record, progress };
}

// ─────────────────────────────────────────────────────────────────────────────
// Real AI dependencies
// ─────────────────────────────────────────────────────────────────────────────

function realDeps(model: ModelRef | null): ImmersionDeps {
  return {
    buildMaterial: (topic) => buildImmersionMaterial(topic),
    planCurriculum: (input) => aiPlanCurriculum(input, model),
    writePanorama: (input) => aiWritePanorama(input, model),
    writeStation: (input) => aiWriteStation(input, model),
    writeContrasts: (input) => aiWriteContrasts(input, model),
    writeExam: (input) => aiWriteExam(input, model),
  };
}

function isCurriculum(v: unknown): v is CurriculumResult {
  return typeof v === 'object' && v !== null && Array.isArray((v as CurriculumResult).stations);
}

async function aiPlanCurriculum(input: CurriculumInput, model: ModelRef | null): Promise<CurriculumResult> {
  const system = [
    'Eres el diseñador del modo Inmersión de Nodus: conviertes un tema de investigación en una ruta guiada de estaciones para dominar ese tema en una tarde.',
    `Diseña EXACTAMENTE ${input.stationCount} estaciones. Cada estación responde UNA sub-pregunta concreta del tema, con las ideas y pasajes del corpus que la sostienen.`,
    'Las sub-preguntas deben cubrir el tema con progresión pedagógica: de lo fundacional a lo específico, y dejar las tensiones/debates para estaciones tardías.',
    'Usa EXCLUSIVAMENTE los identificadores de ideas y pasajes que se te dan. No inventes ids.',
    'Reparte las ideas entre estaciones sin repetirlas; asigna a cada estación los pasajes de sus mismas obras cuando existan.',
    `Escribe títulos y preguntas en ${input.language === 'en' ? 'inglés' : 'español'}.`,
    'Devuelve SOLO JSON válido: {"title":"título breve de la inmersión","stations":[{"id":"st-1","title":"...","question":"...","ideaIds":["..."],"passageIds":["..."]}]}',
  ].join('\n');
  const user = JSON.stringify(
    {
      tema: input.topic,
      idioma: input.language,
      estaciones: input.stationCount,
      ideas: input.ideas,
      pasajes: input.passages,
      autores: input.authors,
      debates: input.debates,
    },
    null,
    2
  );
  return completeJson<CurriculumResult>({ system, user, temperature: 0.2, maxTokens: 4500 }, isCurriculum, model);
}

function isPanorama(v: unknown): v is PanoramaResult {
  return typeof v === 'object' && v !== null && typeof (v as PanoramaResult).overview === 'string';
}

async function aiWritePanorama(input: PanoramaInput, model: ModelRef | null): Promise<PanoramaResult> {
  const system = [
    'Eres el redactor del panorama inicial del modo Inmersión de Nodus: el mapa mental que el lector necesita ANTES de bajar al detalle.',
    `Escribe en ${input.language === 'en' ? 'inglés' : 'español'}.`,
    'En 350-500 palabras de Markdown: qué está en juego en el tema, las 2-4 líneas o posiciones principales, qué autores las encarnan y cómo se conectan las sub-preguntas de la ruta.',
    'Usa SOLO los materiales dados. Cada afirmación sustantiva lleva una cita Markdown con la forma exacta [Autor (año)](nodus://idea/<id>) o [Autor (año)](nodus://work/<id>) usando el campo citation.',
    'Añade un vocabulario mínimo del campo: términos que el lector debe reconocer, con definiciones de una frase basadas en las ideas dadas.',
    'Devuelve SOLO JSON válido: {"overview":"markdown","keyTerms":[{"term":"...","definition":"..."}]}',
  ].join('\n');
  const user = JSON.stringify(
    {
      tema: input.topic,
      idioma: input.language,
      sub_preguntas_de_la_ruta: input.stationQuestions,
      ideas: input.ideas,
      obras: input.works,
      debates: input.debates,
    },
    null,
    2
  );
  return completeJson<PanoramaResult>({ system, user, temperature: 0.25, maxTokens: 3500 }, isPanorama, model);
}

function isStation(v: unknown): v is StationResult {
  return typeof v === 'object' && v !== null && typeof (v as StationResult).synthesis === 'string';
}

async function aiWriteStation(input: StationInput, model: ModelRef | null): Promise<StationResult> {
  const system = [
    'Eres el guía de una estación del modo Inmersión de Nodus: una LECCIÓN COMPLETA sobre una sub-pregunta, para que el lector la domine de verdad en ~25-30 minutos de estudio. Nada de resúmenes superficiales.',
    `Escribe en ${input.language === 'en' ? 'inglés' : 'español'}.`,
    'Produce estos bloques:',
    '1) "context": 100-160 palabras que sitúen la sub-pregunta: por qué importa dentro del tema, qué está en juego y qué debe buscar el lector en esta estación.',
    '2) "synthesis": la lección principal, 600-900 palabras de Markdown en párrafos densos y encadenados (usa ### para 2-3 subsecciones si ayuda). Construye un argumento continuo: presenta cada posición, contrástala con las demás, señala matices, evolución y consecuencias. Cada afirmación sustantiva lleva su cita [Autor (año)](nodus://idea/<id>) o [Autor, año, p. N](nodus://passage/<id>) con el campo citation EXACTO del menú. Integra TODAS las ideas dadas que puedas sostener.',
    '3) "citations": lectura guiada. Elige los 3-5 pasajes del menú que un experto citaría de memoria. Para cada uno: "whyItMatters" (una frase: por qué es imprescindible) y "commentary" (80-140 palabras que enseñen a LEERLO: qué notar en su lenguaje, qué revela, cómo sostiene o complica el argumento de la lección). NO copies el texto del pasaje: solo su id.',
    '4) "positions": para cada autor con voz propia en esta sub-pregunta, su posición en 1-2 frases nítidas que lo distingan de los demás. Usa solo los autores dados.',
    '5) "takeaways": 4-6 frases completas que el lector debe retener de esta estación (lo que respondería un experto si le preguntan por esta sub-pregunta en un tribunal).',
    input.includeQuiz
      ? '6) "quiz": 3 preguntas de recuperación activa: dos "choice" (4 opciones, correctIndex, explanation breve) y una "open" (con "expected": lo que debe recuperar una respuesta sólida). Las mejores preguntas obligan a distinguir autores y posiciones. Incluye ideaIds relevantes.'
      : '6) "quiz": [] (el usuario ha desactivado las preguntas).',
    'Usa SOLO los materiales dados. No inventes obras, autores, páginas ni citas.',
    'Devuelve SOLO JSON válido: {"context":"...","synthesis":"...","citations":[{"passageId":"...","whyItMatters":"...","commentary":"..."}],"positions":[{"author":"...","position":"...","ideaIds":["..."]}],"takeaways":["..."],"quiz":[{"kind":"choice|open","question":"...","options":["..."],"correctIndex":0,"explanation":"...","expected":"...","ideaIds":["..."]}]}',
  ].join('\n');
  const user = JSON.stringify(
    {
      tema: input.topic,
      estacion: { titulo: input.title, sub_pregunta: input.question },
      idioma: input.language,
      ideas: input.ideas,
      pasajes_texto_completo: input.passages,
      autores: input.authors,
    },
    null,
    2
  );
  return completeJson<StationResult>({ system, user, temperature: 0.25, maxTokens: 9000 }, isStation, model);
}

function isContrasts(v: unknown): v is ContrastsResult {
  return typeof v === 'object' && v !== null && Array.isArray((v as ContrastsResult).rows);
}

async function aiWriteContrasts(input: ContrastsInput, model: ModelRef | null): Promise<ContrastsResult> {
  const system = [
    'Eres el constructor de la matriz de contrastes del modo Inmersión de Nodus: autores × sub-preguntas.',
    `Escribe en ${input.language === 'en' ? 'inglés' : 'español'}.`,
    'Para cada fila (sub-pregunta) y cada autor, escribe su postura en UNA frase que lo distinga de los demás autores de esa fila, basada SOLO en las ideas dadas para ese autor en esa fila.',
    'Si un autor no tiene ideas en una fila, su "stance" es la cadena vacía "". NUNCA inventes posturas.',
    'Devuelve SOLO JSON válido: {"rows":[{"stationId":"...","cells":[{"author":"...","stance":"..."}]}]}',
  ].join('\n');
  const user = JSON.stringify({ tema: input.topic, idioma: input.language, autores: input.authors, filas: input.rows }, null, 2);
  return completeJson<ContrastsResult>({ system, user, temperature: 0.2, maxTokens: 4000 }, isContrasts, model);
}

function isExam(v: unknown): v is ExamResult {
  return typeof v === 'object' && v !== null && Array.isArray((v as ExamResult).questions);
}

async function aiWriteExam(input: ExamInput, model: ModelRef | null): Promise<ExamResult> {
  const system = [
    'Eres el examinador final del modo Inmersión de Nodus. El lector acaba de recorrer todas las estaciones: comprueba si de verdad domina el tema.',
    `Escribe en ${input.language === 'en' ? 'inglés' : 'español'}.`,
    `Redacta ${input.questionCount} preguntas que cubran TODAS las sub-preguntas: mezcla "choice" (4 opciones, correctIndex, explanation) y "open" (con "expected"). Las mejores preguntas obligan a DISTINGUIR autores y posiciones, no a repetir definiciones.`,
    'Añade "feynman": una consigna final para que el lector explique el tema completo con sus palabras.',
    'Usa SOLO las ideas dadas. Incluye ideaIds relevantes en cada pregunta.',
    'Devuelve SOLO JSON válido: {"questions":[{"kind":"choice|open","question":"...","options":["..."],"correctIndex":0,"explanation":"...","expected":"...","ideaIds":["..."]}],"feynman":"..."}',
  ].join('\n');
  const user = JSON.stringify(
    { tema: input.topic, idioma: input.language, sub_preguntas: input.stationQuestions, ideas: input.ideas },
    null,
    2
  );
  return completeJson<ExamResult>({ system, user, temperature: 0.25, maxTokens: 4500 }, isExam, model);
}
