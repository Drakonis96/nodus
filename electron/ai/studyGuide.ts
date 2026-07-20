import type {
  AuthorDossier,
  ModelRef,
  StudyGuidePlan,
  StudyPlanRequest,
  StudyRecommendedWork,
  StudySession,
  StudySessionPassage,
  StudySessionRequest,
  StudySessionStep,
  StudyQuizQuestion,
} from '@shared/types';
import {
  buildStudyGuidePlan,
  type StudyGuideAuthorInput,
  type StudyGuideIdeaInput,
  type StudyGuideWorkInput,
} from '../../shared/studyGuide';
import { getDb } from '../db/database';
import { getSettings } from '../db/settingsRepo';
import { findSimilarIdeas } from '../db/ideasRepo';
import { findSimilarPassages } from '../db/passagesRepo';
import { findSimilarWorks } from '../db/workSummariesRepo';
import { studyProgressMap } from '../db/studyProgressRepo';
import { buildAuthorDossier, listAuthors } from './authorDossier';
import { completeJson, embed } from './aiClient';

const MAX_KEY_IDEAS_PER_AUTHOR = 16;
const MAX_PASSAGES_FOR_SESSION = 8;

function parseAuthors(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((a) => String(a)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function clip(value: string, max = 420): string {
  const clean = (value || '').replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 3).trim()}...`;
}

function addBoost(map: Map<string, number>, id: string, value: number): void {
  map.set(id, (map.get(id) ?? 0) + value);
}

interface SemanticBoosts {
  available: boolean;
  summary: string | null;
  authorBoosts: Map<string, number>;
  workBoosts: Map<string, number>;
}

async function semanticBoosts(objective: string | undefined, enabled: boolean): Promise<SemanticBoosts> {
  const clean = objective?.trim() ?? '';
  if (!enabled || clean.length < 3) {
    return { available: false, summary: null, authorBoosts: new Map(), workBoosts: new Map() };
  }
  const vector = await embed(clean);
  if (!vector) {
    return { available: false, summary: 'No hay embeddings configurados o disponibles para afinar el objetivo.', authorBoosts: new Map(), workBoosts: new Map() };
  }

  const db = getDb();
  const authorBoosts = new Map<string, number>();
  const workBoosts = new Map<string, number>();
  let hits = 0;

  const ideaHits = findSimilarIdeas(vector, 0.18, 80);
  for (const idea of ideaHits) {
    const rows = db
      .prepare(
        `SELECT DISTINCT wa.author_id, io.nodus_id
           FROM idea_occurrences io
           JOIN work_authors wa ON wa.nodus_id = io.nodus_id
           JOIN works w ON w.nodus_id = io.nodus_id AND w.archived = 0
          WHERE io.global_id = ?`
      )
      .all(idea.global_id) as { author_id: string; nodus_id: string }[];
    for (const row of rows) {
      addBoost(authorBoosts, row.author_id, idea.similarity * 1.2);
      addBoost(workBoosts, row.nodus_id, idea.similarity);
    }
    hits += rows.length;
  }

  const passageHits = findSimilarPassages(vector, 0.2, 50);
  for (const passage of passageHits) {
    const rows = db
      .prepare('SELECT author_id FROM work_authors WHERE nodus_id = ?')
      .all(passage.nodus_id) as { author_id: string }[];
    for (const row of rows) addBoost(authorBoosts, row.author_id, passage.similarity * 0.8);
    addBoost(workBoosts, passage.nodus_id, passage.similarity * 1.1);
    hits += rows.length;
  }

  const workHits = findSimilarWorks(vector, 0.2, 40);
  for (const work of workHits) {
    const rows = db
      .prepare('SELECT author_id FROM work_authors WHERE nodus_id = ?')
      .all(work.nodus_id) as { author_id: string }[];
    for (const row of rows) addBoost(authorBoosts, row.author_id, work.similarity * 0.9);
    addBoost(workBoosts, work.nodus_id, work.similarity);
    hits += rows.length;
  }

  return {
    available: true,
    summary: hits > 0 ? `Afinado con ${hits} coincidencia(s) semanticas en ideas, pasajes y resumenes.` : 'Embeddings disponibles, pero sin coincidencias fuertes para el objetivo.',
    authorBoosts,
    workBoosts,
  };
}

function loadWorkInputs(workBoosts: Map<string, number>): Map<string, StudyGuideWorkInput[]> {
  const rows = getDb()
    .prepare(
      `WITH idea_counts AS (
         SELECT nodus_id,
                COUNT(DISTINCT global_id) AS ideaCount,
                COUNT(DISTINCT CASE WHEN role = 'principal' THEN global_id END) AS principalIdeaCount
           FROM idea_occurrences
          GROUP BY nodus_id
       ),
       passage_counts AS (
         SELECT nodus_id, COUNT(*) AS passageCount
           FROM passages
          GROUP BY nodus_id
       )
       SELECT wa.author_id,
              w.nodus_id, w.title, w.authors_json AS authorsJson, w.year, w.zotero_key AS zoteroKey,
              w.read_tag AS readTag, w.source_type AS sourceType, w.deep_status AS deepStatus,
              w.summary_status AS summaryStatus, ws.summary AS summary,
              COALESCE(ic.ideaCount, 0) AS ideaCount,
              COALESCE(ic.principalIdeaCount, 0) AS principalIdeaCount,
              COALESCE(pc.passageCount, 0) AS passageCount
         FROM work_authors wa
         JOIN works w ON w.nodus_id = wa.nodus_id AND w.archived = 0
         LEFT JOIN idea_counts ic ON ic.nodus_id = w.nodus_id
         LEFT JOIN passage_counts pc ON pc.nodus_id = w.nodus_id
         LEFT JOIN work_summaries ws ON ws.nodus_id = w.nodus_id
        ORDER BY wa.author_id, ideaCount DESC, w.year DESC`
    )
    .all() as {
    author_id: string;
    nodus_id: string;
    title: string;
    authorsJson: string | null;
    year: number | null;
    zoteroKey: string | null;
    readTag: number;
    sourceType: StudyGuideWorkInput['sourceType'];
    deepStatus: StudyGuideWorkInput['deepStatus'];
    summaryStatus: StudyGuideWorkInput['summaryStatus'];
    summary: string | null;
    ideaCount: number;
    principalIdeaCount: number;
    passageCount: number;
  }[];
  const progress = studyProgressMap();
  const byAuthor = new Map<string, StudyGuideWorkInput[]>();
  for (const row of rows) {
    const record = progress.get(`work:${row.nodus_id}`);
    const work: StudyGuideWorkInput = {
      nodusId: row.nodus_id,
      title: row.title || '(sin titulo)',
      authors: parseAuthors(row.authorsJson),
      year: row.year,
      zoteroKey: row.zoteroKey,
      read: row.readTag === 1,
      sourceType: row.sourceType,
      deepStatus: row.deepStatus,
      summaryStatus: row.summaryStatus,
      ideaCount: Number(row.ideaCount ?? 0),
      principalIdeaCount: Number(row.principalIdeaCount ?? 0),
      passageCount: Number(row.passageCount ?? 0),
      summary: row.summary,
      progressStatus: record?.status ?? null,
      semanticScore: workBoosts.get(row.nodus_id) ?? 0,
    };
    const list = byAuthor.get(row.author_id) ?? [];
    list.push(work);
    byAuthor.set(row.author_id, list);
  }
  return byAuthor;
}

function loadKeyIdeas(): Map<string, StudyGuideIdeaInput[]> {
  const rows = getDb()
    .prepare(
      `SELECT wa.author_id, i.global_id, i.type, i.label, i.statement,
              io.nodus_id AS workId, w.title AS workTitle, io.role, io.confidence
         FROM work_authors wa
         JOIN works w ON w.nodus_id = wa.nodus_id AND w.archived = 0
         JOIN idea_occurrences io ON io.nodus_id = w.nodus_id
         JOIN ideas i ON i.global_id = io.global_id
        ORDER BY wa.author_id, (io.role = 'principal') DESC, io.confidence DESC, i.label`
    )
    .all() as {
    author_id: string;
    global_id: string;
    type: StudyGuideIdeaInput['type'];
    label: string;
    statement: string;
    workId: string;
    workTitle: string;
    role: StudyGuideIdeaInput['role'];
    confidence: number;
  }[];
  const byAuthor = new Map<string, StudyGuideIdeaInput[]>();
  const seen = new Map<string, Set<string>>();
  for (const row of rows) {
    const used = seen.get(row.author_id) ?? new Set<string>();
    if (used.has(row.global_id) || used.size >= MAX_KEY_IDEAS_PER_AUTHOR) {
      seen.set(row.author_id, used);
      continue;
    }
    used.add(row.global_id);
    seen.set(row.author_id, used);
    const list = byAuthor.get(row.author_id) ?? [];
    list.push({
      globalId: row.global_id,
      type: row.type,
      label: row.label,
      statement: row.statement,
      workId: row.workId,
      workTitle: row.workTitle,
      role: row.role,
      confidence: Number(row.confidence ?? 0),
    });
    byAuthor.set(row.author_id, list);
  }
  return byAuthor;
}

export async function buildStudyPlan(request: StudyPlanRequest = {}): Promise<StudyGuidePlan> {
  const boosts = await semanticBoosts(request.objective, Boolean(request.semanticFocus));
  const progress = studyProgressMap();
  const worksByAuthor = loadWorkInputs(boosts.workBoosts);
  const ideasByAuthor = loadKeyIdeas();
  const authors: StudyGuideAuthorInput[] = listAuthors().map((author) => {
    const record = progress.get(`author:${author.author_id}`);
    return {
      authorId: author.author_id,
      name: author.name,
      fullName: author.fullName || author.name,
      workCount: author.workCount,
      ideaCount: author.ideaCount,
      relationCount: author.relationCount,
      topThemes: author.topThemes,
      read: author.read,
      hasSynthesis: author.hasSynthesis,
      works: worksByAuthor.get(author.author_id) ?? [],
      keyIdeas: ideasByAuthor.get(author.author_id) ?? [],
      progressStatus: record?.status ?? null,
      progressNote: record?.note ?? null,
      semanticScore: boosts.authorBoosts.get(author.author_id) ?? 0,
    };
  });

  return buildStudyGuidePlan({
    authors,
    objective: request.objective,
    sessionMinutes: request.sessionMinutes,
    authorLimit: request.authorLimit,
    worksPerAuthor: request.worksPerAuthor,
    includeCompleted: request.includeCompleted,
    semanticFocusAvailable: boosts.available,
    semanticFocusUsed: boosts.available && Boolean(request.semanticFocus),
    semanticFocusSummary: boosts.summary,
  });
}

function fallbackSession(authorName: string, plan: StudyGuidePlan, author: StudyGuidePlan['authors'][number], model: ModelRef | null): StudySession {
  const sequence: StudySessionStep[] = [
    {
      title: 'Tesis y mapa mental',
      body: `Empieza por formular en una frase que aporta ${authorName} al corpus. Usa sus temas principales y las primeras ideas clave.`,
      workIds: author.recommendedWorks.slice(0, 1).map((w) => w.nodusId),
      ideaIds: author.keyIdeas.slice(0, 3).map((i) => i.globalId),
      minutes: Math.max(8, Math.round(plan.sessionMinutes * 0.25)),
    },
    {
      title: 'Obras y evidencia',
      body: 'Abre las obras recomendadas en Zotero y contrasta las ideas con pasajes, resumenes y notas de lectura.',
      workIds: author.recommendedWorks.slice(0, 3).map((w) => w.nodusId),
      ideaIds: author.keyIdeas.slice(0, 5).map((i) => i.globalId),
      minutes: Math.max(12, Math.round(plan.sessionMinutes * 0.45)),
    },
    {
      title: 'Repaso activo',
      body: 'Responde las preguntas sin mirar la ficha y marca lo que requiera lectura completa.',
      workIds: author.recommendedWorks.slice(0, 2).map((w) => w.nodusId),
      ideaIds: author.keyIdeas.slice(0, 5).map((i) => i.globalId),
      minutes: Math.max(8, Math.round(plan.sessionMinutes * 0.3)),
    },
  ];
  const quiz = author.reviewQuestions.slice(0, 4).map((question, index): StudyQuizQuestion => ({
    id: `q-${index + 1}`,
    question,
    expected: author.keyIdeas[index]?.statement ?? 'Debe recuperar tesis, evidencia y relacion con otros autores.',
    ideaIds: author.keyIdeas.slice(index, index + 2).map((i) => i.globalId),
    workIds: author.recommendedWorks.slice(0, 2).map((w) => w.nodusId),
  }));
  return {
    authorId: author.authorId,
    authorName,
    generatedAt: new Date().toISOString(),
    model,
    usedFullText: false,
    guide: `Sesion de estudio para ${authorName}: ${author.nextAction}`,
    sequence,
    recommendedWorks: author.recommendedWorks,
    keyIdeas: author.keyIdeas,
    passages: [],
    quiz,
    fullReadCandidates: author.recommendedWorks.filter((w) => w.zoteroKey && (!w.read || w.progressStatus === 'needs_full_read')),
    nextActions: [
      'Marcar el estado del autor al terminar la sesion.',
      'Abrir en Zotero la primera obra recomendada antes de citar.',
      'Regenerar la sesion tutor si cambian las ideas o el objetivo.',
    ],
  };
}

async function loadSessionPassages(
  objective: string,
  works: StudyRecommendedWork[],
  useFullText: boolean
): Promise<StudySessionPassage[]> {
  if (!useFullText || works.length === 0) return [];
  const workIds = works.map((w) => w.nodusId);
  const vector = objective.trim().length >= 3 ? await embed(objective) : null;
  if (vector) {
    return findSimilarPassages(vector, 0.18, MAX_PASSAGES_FOR_SESSION, { nodusIds: workIds }).map((p) => ({
      passageId: p.passage_id,
      workId: p.nodus_id,
      workTitle: p.title || '(sin titulo)',
      zoteroKey: p.zotero_key,
      pageLabel: p.page_label,
      snippet: clip(p.text, 560),
      similarity: p.similarity,
    }));
  }
  const rows = getDb()
    .prepare(
      `SELECT p.passage_id, p.nodus_id, p.text, p.page_label, w.title, w.zotero_key
         FROM passages p
         JOIN works w ON w.nodus_id = p.nodus_id
        WHERE p.nodus_id IN (${workIds.map(() => '?').join(',')})
        ORDER BY p.nodus_id, p.chunk_index
        LIMIT ?`
    )
    .all(...workIds, MAX_PASSAGES_FOR_SESSION) as {
    passage_id: string;
    nodus_id: string;
    text: string;
    page_label: string | null;
    title: string;
    zotero_key: string | null;
  }[];
  return rows.map((row) => ({
    passageId: row.passage_id,
    workId: row.nodus_id,
    workTitle: row.title || '(sin titulo)',
    zoteroKey: row.zotero_key,
    pageLabel: row.page_label,
    snippet: clip(row.text, 560),
    similarity: null,
  }));
}

interface AiStudySession {
  guide: string;
  sequence: StudySessionStep[];
  quiz: StudyQuizQuestion[];
  nextActions: string[];
}

function isAiStudySession(value: unknown): value is AiStudySession {
  if (!value || typeof value !== 'object') return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.guide === 'string' &&
    Array.isArray(o.sequence) &&
    Array.isArray(o.quiz) &&
    Array.isArray(o.nextActions)
  );
}

function safeSteps(items: StudySessionStep[], fallback: StudySessionStep[]): StudySessionStep[] {
  const valid = items
    .filter((item) => item && typeof item.title === 'string' && typeof item.body === 'string')
    .map((item, index) => ({
      title: item.title.trim() || `Bloque ${index + 1}`,
      body: item.body.trim(),
      workIds: Array.isArray(item.workIds) ? item.workIds.filter((id): id is string => typeof id === 'string') : [],
      ideaIds: Array.isArray(item.ideaIds) ? item.ideaIds.filter((id): id is string => typeof id === 'string') : [],
      minutes: Math.max(5, Math.min(45, Number(item.minutes ?? 10))),
    }))
    .filter((item) => item.body);
  return valid.length ? valid.slice(0, 6) : fallback;
}

function safeQuiz(items: StudyQuizQuestion[], fallback: StudyQuizQuestion[]): StudyQuizQuestion[] {
  const valid = items
    .filter((item) => item && typeof item.question === 'string' && typeof item.expected === 'string')
    .map((item, index) => ({
      id: typeof item.id === 'string' && item.id ? item.id : `q-${index + 1}`,
      question: item.question.trim(),
      expected: item.expected.trim(),
      ideaIds: Array.isArray(item.ideaIds) ? item.ideaIds.filter((id): id is string => typeof id === 'string') : [],
      workIds: Array.isArray(item.workIds) ? item.workIds.filter((id): id is string => typeof id === 'string') : [],
    }))
    .filter((item) => item.question);
  return valid.length ? valid.slice(0, 6) : fallback;
}

export async function generateStudySession(request: StudySessionRequest): Promise<StudySession> {
  const objective = request.objective?.trim() || 'Dominar este autor dentro del corpus.';
  const plan = await buildStudyPlan({
    objective,
    sessionMinutes: request.sessionMinutes,
    includeCompleted: true,
    authorLimit: 80,
    worksPerAuthor: 6,
    semanticFocus: false,
  });
  const authorPlan = plan.authors.find((author) => author.authorId === request.authorId);
  if (!authorPlan) throw new Error('Autor no encontrado en el plan de estudio');
  const dossier = buildAuthorDossier(request.authorId);
  const authorName = dossier?.fullName || authorPlan.fullName || authorPlan.name;
  const settings = getSettings();
  const chosen = request.model ?? settings.studyModel ?? settings.synthesisModel ?? null;
  const fallback = fallbackSession(authorName, plan, authorPlan, chosen);
  const passages = await loadSessionPassages(objective, authorPlan.recommendedWorks, Boolean(request.useFullText));

  if (!chosen) {
    return { ...fallback, passages, usedFullText: passages.length > 0 };
  }

  const material = {
    objetivo: objective,
    autor: authorName,
    tesis_cacheada: dossier?.synthesis?.thesis ?? null,
    temas: authorPlan.topThemes,
    ideas_clave: authorPlan.keyIdeas.map((idea) => ({
      id: idea.globalId,
      tipo: idea.type,
      etiqueta: idea.label,
      enunciado: idea.statement,
      obra: idea.workTitle,
    })),
    obras_recomendadas: authorPlan.recommendedWorks.map((work) => ({
      id: work.nodusId,
      titulo: work.title,
      ano: work.year,
      ideas: work.ideaCount,
      pasajes: work.passageCount,
      zotero: Boolean(work.zoteroKey),
      razones: work.reasons,
      resumen: work.summary,
    })),
    relaciones: (dossier as AuthorDossier | null)?.relations.slice(0, 10).map((rel) => ({
      autor: rel.name,
      tipo: rel.type,
      temas_comunes: rel.sharedThemes,
    })) ?? [],
    pasajes: passages.map((p) => ({
      id: p.passageId,
      obra: p.workTitle,
      pagina: p.pageLabel,
      texto: p.snippet,
    })),
  };

  const system =
    'Eres el tutor de estudio de Nodus. Tu tarea no es resumir sin mas: debes guiar a una persona para dominar un autor dentro de un corpus academico. ' +
    'Usa solo los datos proporcionados. Da una secuencia de estudio concreta, con obras que debe abrir en Zotero, ideas que debe dominar, pasajes que debe comprobar y preguntas de recuperacion activa. ' +
    'Devuelve exclusivamente JSON con esta forma: {"guide":"parrafo breve de orientacion","sequence":[{"title":"...","body":"...","workIds":["..."],"ideaIds":["..."],"minutes":12}],"quiz":[{"id":"q1","question":"...","expected":"...","ideaIds":["..."],"workIds":["..."]}],"nextActions":["..."]}.';
  const user = JSON.stringify(material);

  try {
    const ai = await completeJson<AiStudySession>({ system, user, temperature: 0.2, maxTokens: 6500 }, isAiStudySession, chosen);
    return {
      ...fallback,
      generatedAt: new Date().toISOString(),
      guide: ai.guide.trim() || fallback.guide,
      sequence: safeSteps(ai.sequence, fallback.sequence),
      quiz: safeQuiz(ai.quiz, fallback.quiz),
      passages,
      usedFullText: passages.length > 0,
      nextActions: ai.nextActions.filter((item) => typeof item === 'string' && item.trim()).slice(0, 6),
    };
  } catch {
    return { ...fallback, passages, usedFullText: passages.length > 0 };
  }
}
