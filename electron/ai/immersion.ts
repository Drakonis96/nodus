import type {
  GraphData,
  ImmersionAnswerRecord,
  ImmersionAnswerRequest,
  ImmersionAnswerResult,
  ImmersionBuildProgress,
  ImmersionQuizQuestion,
  ImmersionRequest,
  ImmersionScope,
  ImmersionScopeRequest,
  ImmersionSession,
  ModelRef,
  PromptLanguage,
  WritingWorkshopIdeaCandidate,
} from '@shared/types';
import { getDb } from '../db/database';
import { parseBylineEntry } from '../db/authorsRepo';
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
  labels,
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
const DOCUMENT_WORK_MAX_KEEP = 20;
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

/** Who an idea can be attributed to: the authors of the works it occurs in, never
 *  the editors of the volumes those works appear in. */
function ideaAuthors(idea: WritingWorkshopIdeaCandidate): string[] {
  const names = idea.works
    .flatMap((w) => w.authors)
    .map((entry) => parseBylineEntry(entry))
    .filter((entry) => entry.role === 'author')
    .map((entry) => entry.display);
  return [...new Set(names)];
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
           FROM passages p JOIN works w ON w.nodus_id = p.nodus_id
          WHERE p.nodus_id IN (${workIds.map(() => '?').join(',')})
            AND ((w.resolved_text_hash IS NOT NULL AND p.content_hash = w.resolved_text_hash)
              OR (w.resolved_text_hash IS NULL AND (w.deep_hash IS NULL OR p.content_hash = w.deep_hash)))
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
export async function buildImmersionMaterial(
  topic: string,
  language: PromptLanguage = normalizeImmersionLanguage(getSettings().promptLanguage),
): Promise<ImmersionMaterial> {
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
          WHERE p.passage_id IN (${passageCandidates.map(() => '?').join(',')})
            AND ((w.resolved_text_hash IS NOT NULL AND p.content_hash = w.resolved_text_hash)
              OR (w.resolved_text_hash IS NULL AND (w.deep_hash IS NULL OR p.content_hash = w.deep_hash)))`
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
        workTitle: row.title || ({ es: '(sin título)', en: '(untitled)', fr: '(sans titre)', de: '(ohne Titel)', pt: '(sem título)', 'pt-BR': '(sem título)', it: '(senza titolo)', tr: '(başlıksız)' } satisfies Record<PromptLanguage, string>)[language],
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
  const workMeta = new Map<string, { title: string; authors: string[]; year: number | null; zoteroKey: string | null; orientation: string | null }>();
  const ideaCountByWork = new Map<string, number>();
  for (const idea of ideas) {
    for (const work of idea.works) {
      workMeta.set(work.nodusId, { title: work.title, authors: [], year: work.year, zoteroKey: work.zoteroKey, orientation: null });
      workScore.set(work.nodusId, Math.max(workScore.get(work.nodusId) ?? 0, idea.score));
      ideaCountByWork.set(work.nodusId, (ideaCountByWork.get(work.nodusId) ?? 0) + 1);
    }
  }
  for (const passage of passages) {
    if (!workMeta.has(passage.workId)) {
      workMeta.set(passage.workId, { title: passage.workTitle, authors: passage.authors, year: passage.year, zoteroKey: passage.zoteroKey, orientation: null });
    }
    workScore.set(passage.workId, Math.max(workScore.get(passage.workId) ?? 0, passage.score));
  }
  // Macro profiles are a genuine third lane. Previously Immersion prepared them
  // and then threw them away unless the same work also happened to own a top idea
  // or passage, which made the preparation phase a no-op in measured scopes.
  for (const work of snapshot.works
    .filter((candidate) => candidate.documentStatus === 'current' && candidate.documentOverview)
    .slice(0, DOCUMENT_WORK_MAX_KEEP)) {
    const previous = workMeta.get(work.id);
    workMeta.set(work.id, {
      title: work.title,
      authors: work.authors,
      year: work.year,
      zoteroKey: work.zotero_key ?? null,
      orientation: work.documentOverview ?? null,
    });
    workScore.set(work.id, Math.max(workScore.get(work.id) ?? 0, work.score));
    if (previous?.orientation) workMeta.get(work.id)!.orientation = previous.orientation;
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
        orientation: meta.orientation,
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
  const settings = getSettings();
  const language = normalizeImmersionLanguage(settings.promptLanguage);
  const material = await buildImmersionMaterial(request.topic, language);
  const warnings: string[] = [];
  const plannedModel = settings.immersionModel ?? settings.synthesisModel ?? null;
  const aiKeyAvailable = plannedModel != null && getApiKey(plannedModel.provider) != null;
  if (!aiKeyAvailable) {
    warnings.push(
      plannedModel
        ? immersionScopeWarning(language, 'key', plannedModel.provider)
        : immersionScopeWarning(language, 'model')
    );
  }
  if (!material.embeddingAvailable) {
    warnings.push(immersionScopeWarning(language, 'embeddings'));
  }
  if (material.passages.length === 0) {
    warnings.push(immersionScopeWarning(language, 'passages'));
  }
  if (material.ideas.length < IDEA_MIN_KEEP / 2) {
    warnings.push(immersionScopeWarning(language, 'sparse'));
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
    estimatedStations: resolveStationCount(request.minutes ?? 150, material.ideas.length),
    warnings,
  };
}

export async function generateImmersionSession(
  request: ImmersionRequest,
  onProgress?: (p: ImmersionBuildProgress) => void
): Promise<ImmersionSession> {
  const settings = getSettings();
  const model = request.model ?? settings.immersionModel ?? settings.synthesisModel ?? null;
  const requestedLanguage = (request as ImmersionRequest & { language?: PromptLanguage }).language;
  const language = normalizeImmersionLanguage(requestedLanguage ?? settings.promptLanguage);
  const routedRequest = { ...request, language } as ImmersionRequest;
  const copy = labels(language);
  const emit = (progress: ImmersionBuildProgress) => {
    try { onProgress?.(progress); } catch { /* progress cannot abort generation */ }
  };
  emit({ phase: 'discovery', message: copy.material });
  const material = await buildImmersionMaterial(request.topic, language);
  emit({
    phase: 'document_preparation',
    message: language === 'es'
      ? 'Usando las fichas documentales ya disponibles junto con ideas y evidencia literal…'
      : language === 'en'
        ? 'Using the available document profiles together with ideas and literal evidence…'
        : language === 'fr'
          ? 'Utilisation des fiches documentaires disponibles avec les idées et les preuves littérales…'
          : language === 'de'
            ? 'Verfügbare Dokumentprofile werden zusammen mit Ideen und wörtlicher Evidenz verwendet…'
            : language === 'it'
              ? 'Uso delle schede documentarie disponibili insieme alle idee e alle prove testuali…'
              : language === 'tr'
                ? 'Mevcut belge profilleri, fikirler ve kelimesi kelimesine kanıtla birlikte kullanılıyor…'
                : language === 'pt-BR'
                  ? 'Usando os perfis documentais disponíveis junto com ideias e evidência literal…'
                  : 'A usar as fichas documentais disponíveis juntamente com ideias e evidência literal…',
  });
  // Immersion may consume profiles already prepared by Deep Research or a manual
  // reader action, but it never creates new Documentary Index work itself.
  const plan = await orchestrateImmersion({ ...routedRequest, model }, realDeps(model, material), onProgress);
  return saveImmersionSession(plan, model);
}

// ─────────────────────────────────────────────────────────────────────────────
// Answer handling (choice → deterministic local match, open → unscored local reflection)
// ─────────────────────────────────────────────────────────────────────────────

function findQuestion(session: ImmersionSession, questionId: string): ImmersionQuizQuestion | null {
  for (const station of session.plan.stations) {
    const hit = station.quiz.find((q) => q.id === questionId);
    if (hit) return hit;
  }
  return session.plan.exam.questions.find((q) => q.id === questionId) ?? null;
}

export async function evaluateImmersionAnswer(request: ImmersionAnswerRequest): Promise<ImmersionAnswerResult> {
  const session = getImmersionSession(request.sessionId);
  if (!session) throw new Error(immersionError('es', 'session'));
  const language = normalizeImmersionLanguage(session.plan.language);
  const question = findQuestion(session, request.questionId);
  if (!question) throw new Error(immersionError(language, 'question'));

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
    // Open answers are private reflections. They are persisted locally verbatim and
    // never sent to a model, heuristically scored, profiled or used to steer access.
    record = {
      questionId: question.id,
      kind: 'open',
      answer: request.answer,
      correct: null,
      assessment: null,
      answeredAt: new Date().toISOString(),
    };
  }

  const progress = recordImmersionAnswer(session.id, record);
  return { record, progress };
}

// ─────────────────────────────────────────────────────────────────────────────
// Real AI dependencies
// ─────────────────────────────────────────────────────────────────────────────

function realDeps(model: ModelRef | null, preparedMaterial?: ImmersionMaterial): ImmersionDeps {
  let material = preparedMaterial;
  return {
    buildMaterial: async (topic) => {
      if (material && material.topic === topic.trim()) {
        const cached = material;
        material = undefined;
        return cached;
      }
      return buildImmersionMaterial(topic);
    },
    planCurriculum: (input) => aiPlanCurriculum(input, model),
    writePanorama: (input) => aiWritePanorama(input, model),
    writeStation: (input) => aiWriteStation(input, model),
    writeContrasts: (input) => aiWriteContrasts(input, model),
    writeExam: (input) => aiWriteExam(input, model),
  };
}

function normalizeImmersionLanguage(value: unknown): PromptLanguage {
  return IMMERSION_PROMPT_LANGUAGES.includes(value as PromptLanguage) ? value as PromptLanguage : 'es';
}

function immersionScopeWarning(language: PromptLanguage, kind: 'key' | 'model' | 'embeddings' | 'passages' | 'sparse', value?: string): string {
  const text: Record<PromptLanguage, Record<typeof kind, string>> = {
    es: { key: `Falta la clave de IA para ${value ?? ''}: sin ella la inmersión saldría vacía (solo esqueleto estructural). Añádela en Ajustes.`, model: 'No hay modelo de IA configurado: la inmersión saldría vacía (solo esqueleto estructural).', embeddings: 'Sin embeddings configurados: el alcance se calculó por coincidencia léxica y será menos preciso.', passages: 'No hay pasajes indexados para este tema: la inmersión no podrá mostrar citas literales del texto completo.', sparse: 'Hay poco material relevante: analiza más obras en profundidad para una inmersión más rica.' },
    en: { key: `No AI key is configured for ${value ?? ''}: immersion would be empty (structural skeleton only). Add it in Settings.`, model: 'No AI model is configured: immersion would be empty (structural skeleton only).', embeddings: 'No embeddings are configured: the scope was calculated lexically and will be less precise.', passages: 'No passages are indexed for this topic: immersion cannot show literal quotes from the full text.', sparse: 'There is little relevant material: analyse more works in depth for a richer immersion.' },
    fr: { key: `Aucune clé d’IA n’est configurée pour ${value ?? ''} : l’immersion serait vide (simple squelette structurel). Ajoutez-la dans les réglages.`, model: 'Aucun modèle d’IA n’est configuré : l’immersion serait vide (simple squelette structurel).', embeddings: 'Aucun embedding n’est configuré : le périmètre a été calculé lexicalement et sera moins précis.', passages: 'Aucun passage n’est indexé pour ce sujet : l’immersion ne pourra pas afficher de citations littérales du texte intégral.', sparse: 'Le matériau pertinent est limité : analysez davantage d’ouvrages en profondeur pour une immersion plus riche.' },
    de: { key: `Für ${value ?? ''} ist kein KI-Schlüssel konfiguriert: Die Immersion wäre leer (nur strukturelles Gerüst). Fügen Sie ihn in den Einstellungen hinzu.`, model: 'Es ist kein KI-Modell konfiguriert: Die Immersion wäre leer (nur strukturelles Gerüst).', embeddings: 'Es sind keine Embeddings konfiguriert: Der Umfang wurde lexikalisch berechnet und ist weniger präzise.', passages: 'Für dieses Thema sind keine Passagen indexiert: Die Immersion kann keine wörtlichen Zitate aus dem Volltext anzeigen.', sparse: 'Es gibt wenig relevantes Material: Analysieren Sie weitere Werke gründlich für eine reichhaltigere Immersion.' },
    pt: { key: `Não está configurada uma chave de IA para ${value ?? ''}: a imersão ficaria vazia (apenas esqueleto estrutural). Adiciona-a em Definições.`, model: 'Não está configurado nenhum modelo de IA: a imersão ficaria vazia (apenas esqueleto estrutural).', embeddings: 'Não estão configurados embeddings: o alcance foi calculado lexicalmente e será menos preciso.', passages: 'Não há passagens indexadas para este tema: a imersão não poderá mostrar citações literais do texto completo.', sparse: 'Há pouco material relevante: analisa mais obras em profundidade para uma imersão mais rica.' },
    'pt-BR': { key: `Nenhuma chave de IA está configurada para ${value ?? ''}: a imersão ficaria vazia (apenas esqueleto estrutural). Adicione-a em Configurações.`, model: 'Nenhum modelo de IA está configurado: a imersão ficaria vazia (apenas esqueleto estrutural).', embeddings: 'Nenhum embedding está configurado: o escopo foi calculado lexicalmente e será menos preciso.', passages: 'Não há passagens indexadas para este tema: a imersão não poderá mostrar citações literais do texto completo.', sparse: 'Há pouco material relevante: analise mais obras em profundidade para uma imersão mais rica.' },
    it: { key: `Non è configurata alcuna chiave IA per ${value ?? ''}: l’immersione sarebbe vuota (solo scheletro strutturale). Aggiungila nelle Impostazioni.`, model: 'Non è configurato alcun modello IA: l’immersione sarebbe vuota (solo scheletro strutturale).', embeddings: 'Non sono configurati embedding: l’ambito è stato calcolato lessicalmente e sarà meno preciso.', passages: 'Non ci sono passaggi indicizzati per questo argomento: l’immersione non può mostrare citazioni letterali del testo completo.', sparse: 'Il materiale pertinente è scarso: analizza più opere in profondità per un’immersione più ricca.' },
    tr: { key: `${value ?? ''} için yapay zekâ anahtarı yapılandırılmamış: immersiyon boş olurdu (yalnızca yapısal iskelet). Ayarlardan ekleyin.`, model: 'Yapay zekâ modeli yapılandırılmamış: immersiyon boş olurdu (yalnızca yapısal iskelet).', embeddings: 'Embedding yapılandırılmamış: kapsam sözcüksel olarak hesaplandı ve daha az kesin olacak.', passages: 'Bu konu için pasaj dizinlenmemiş: immersiyon tam metinden kelimesi kelimesine alıntılar gösteremez.', sparse: 'İlgili materyal az: daha zengin bir immersiyon için daha fazla eseri derinlemesine analiz edin.' },
  };
  return text[language][kind];
}

function immersionError(language: PromptLanguage, kind: 'session' | 'question'): string {
  const messages: Record<PromptLanguage, Record<typeof kind, string>> = {
    es: { session: 'Sesión de inmersión no encontrada', question: 'Pregunta no encontrada en esta sesión' },
    en: { session: 'Immersion session not found', question: 'Question not found in this session' },
    fr: { session: 'Session d’immersion introuvable', question: 'Question introuvable dans cette session' },
    de: { session: 'Immersionssitzung nicht gefunden', question: 'Frage in dieser Sitzung nicht gefunden' },
    pt: { session: 'Sessão de imersão não encontrada', question: 'Pergunta não encontrada nesta sessão' },
    'pt-BR': { session: 'Sessão de imersão não encontrada', question: 'Pergunta não encontrada nesta sessão' },
    it: { session: 'Sessione di immersione non trovata', question: 'Domanda non trovata in questa sessione' },
    tr: { session: 'İmmersiyon oturumu bulunamadı', question: 'Bu oturumda soru bulunamadı' },
  };
  return messages[language][kind];
}

// Every model-facing instruction for Immersion lives in this pack. JSON field
// names, enums, identifiers, citation syntax and limits are deliberately kept
// identical in every language; only the natural-language clauses are translated.
export interface ImmersionPromptPack {
  curriculum(input: CurriculumInput): string;
  panorama(input: PanoramaInput): string;
  station(input: StationInput): string;
  contrasts(input: ContrastsInput): string;
  exam(input: ExamInput): string;
}

type ImmersionPromptText = {
  language: string;
  curriculum: string[];
  panorama: string[];
  station: string[];
  contrasts: string[];
  exam: string[];
};

const IMMERSION_PROMPT_LANGUAGES: readonly PromptLanguage[] = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr'];
const IMMERSION_JSON = {
  curriculum: '{"title":"título breve de la inmersión","stations":[{"id":"st-1","title":"...","question":"...","ideaIds":["..."],"passageIds":["..."]}]}',
  panorama: '{"overview":"markdown","keyTerms":[{"term":"...","definition":"..."}]}',
  station: '{"context":"...","synthesis":"...","citations":[{"passageId":"...","whyItMatters":"...","commentary":"..."}],"positions":[{"author":"...","position":"...","ideaIds":["..."]}],"takeaways":["..."],"quiz":[{"kind":"choice|open","question":"...","options":["..."],"correctIndex":0,"explanation":"...","expected":"...","ideaIds":["..."]}]}' ,
  contrasts: '{"rows":[{"stationId":"...","cells":[{"author":"...","stance":"..."}]}]}',
  exam: '{"questions":[{"kind":"choice|open","question":"...","options":["..."],"correctIndex":0,"explanation":"...","expected":"...","ideaIds":["..."]}],"feynman":"..."}',
} as const;

const PROMPT_TEXT: Record<PromptLanguage, ImmersionPromptText> = {
  es: {
    language: 'español',
    curriculum: [
      'Eres el diseñador del modo Inmersión de Nodus: conviertes un tema de investigación en una RUTA de estaciones guiadas para dominarlo a fondo, de principio a fin.',
      'Tu trabajo aquí es la PLANIFICACIÓN de la ruta: defines la secuencia de estaciones y, para cada una, la sub-pregunta que responde y las ideas y pasajes del corpus que la sostienen. No redactas todavía el contenido.',
      'Apunta a unas {{count}} estaciones. Es un OBJETIVO, no una cuota: usa algunas menos si el material no da para más, o algunas más si el tema lo merece. Prioriza SIEMPRE una secuencia coherente, progresiva y sin relleno por encima de alcanzar un número exacto.',
      'ARCO PEDAGÓGICO del conjunto: abre por lo fundacional (qué está en juego, marco y conceptos base), avanza hacia los mecanismos, la evidencia y los casos, reserva las tensiones, debates y contra-lecturas para el tramo medio-final, y cierra con síntesis, límites o implicaciones. La ruta debe leerse como un curso que progresa, no como una lista de temas sueltos.',
      'PROFUNDIDAD POR CONTINUACIÓN: cuando un aspecto es rico, dedícale VARIAS estaciones CONSECUTIVAS que avancen de lo general a lo particular (p. ej. «X: panorama» → «X: mecanismos» → «X: evidencia y casos» → «X: consecuencias y tensiones»), en lugar de comprimirlo en una sola parada. Encadena las continuaciones para que cada una presuponga la anterior.',
      'Cada estación responde UNA sub-pregunta concreta y distinta, con su propio foco. No repartas la misma idea entre varias estaciones salvo que una continuación la retome deliberadamente desde un ángulo nuevo.',
      'COBERTURA: en conjunto, las estaciones deben abordar las ideas más fuertes del material y las voces y debates principales; no dejes fuera lo central del tema.',
      'Las fichas de obras son ORIENTACIÓN MACRO auditada: úsalas para decidir qué ejes son centrales y cómo ordenar la ruta, pero no como evidencia literal ni para inventar ideaIds o passageIds.',
      'Asigna a cada estación los pasajes de las mismas obras que sus ideas cuando existan, para que haya lectura literal donde corresponde.',
      'Usa EXCLUSIVAMENTE los identificadores (ideaIds, passageIds) que se te dan en el material. No inventes ids ni cites nada que no esté en la lista.',
      'Escribe los títulos y las preguntas en {{language}}: títulos breves y evocadores; preguntas concretas y respondibles con este material.',
      'Devuelve SOLO JSON válido, sin texto alrededor: {{json}}',
    ],
    panorama: [
      'Eres el redactor del panorama inicial del modo Inmersión de Nodus: el mapa mental que el lector necesita ANTES de bajar al detalle.',
      'Escribe en {{language}}.',
      'En 350-500 palabras de Markdown: qué está en juego en el tema, las 2-4 líneas o posiciones principales, qué autores las encarnan y cómo se conectan las sub-preguntas de la ruta.',
      'Usa SOLO los materiales dados. Cada afirmación sustantiva lleva una cita Markdown con la forma exacta [Autor (año)](nodus://idea/<id>) o [Autor (año)](nodus://work/<id>) usando el campo citation.',
      'El campo orientation de una obra sirve para situar su argumento global; no lo presentes como una cita literal ni inventes páginas. Prefiere las ideas para sostener afirmaciones concretas.',
      'Añade un vocabulario mínimo del campo: términos que el lector debe reconocer, con definiciones de una frase basadas en las ideas dadas.',
      'Devuelve SOLO JSON válido: {{json}}',
    ],
    station: [
      'Eres el guía de una estación del modo Inmersión de Nodus: una LECCIÓN COMPLETA sobre una sub-pregunta, para que el lector la domine de verdad en ~25-30 minutos de estudio. Nada de resúmenes superficiales.',
      'Escribe en {{language}}.',
      'Produce estos bloques:',
      '1) "context": 100-160 palabras que sitúen la sub-pregunta: por qué importa dentro del tema, qué está en juego y qué debe buscar el lector en esta estación.',
      '2) "synthesis": la lección principal, 600-900 palabras de Markdown en párrafos densos y encadenados (usa ### para 2-3 subsecciones si ayuda). Construye un argumento continuo: presenta cada posición, contrástala con las demás, señala matices, evolución y consecuencias. Cada afirmación sustantiva lleva su cita [Autor (año)](nodus://idea/<id>) o [Autor, año, p. N](nodus://passage/<id>) con el campo citation EXACTO del menú. Integra TODAS las ideas dadas que puedas sostener.',
      '3) "citations": lectura guiada. Elige los 3-5 pasajes del menú que un experto citaría de memoria. Para cada uno: "whyItMatters" (una frase: por qué es imprescindible) y "commentary" (80-140 palabras que enseñen a LEERLO: qué notar en su lenguaje, qué revela, cómo sostiene o complica el argumento de la lección). NO copies el texto del pasaje: solo su id.',
      '4) "positions": para cada autor con voz propia en esta sub-pregunta, su posición en 1-2 frases nítidas que lo distingan de los demás. Usa solo los autores dados.',
      '5) "takeaways": 4-6 frases completas que el lector debe retener de esta estación (lo que respondería un experto si le preguntan por esta sub-pregunta en un tribunal).',
      '{{quizRule}}',
      'Usa SOLO los materiales dados. No inventes obras, autores, páginas ni citas.',
      'Devuelve SOLO JSON válido: {{json}}',
    ],
    contrasts: [
      'Eres el constructor de la matriz de contrastes del modo Inmersión de Nodus: autores × sub-preguntas.',
      'Escribe en {{language}}.',
      'Para cada fila (sub-pregunta) y cada autor, escribe su postura en UNA frase que lo distinga de los demás autores de esa fila, basada SOLO en las ideas dadas para ese autor en esa fila.',
      'Si un autor no tiene ideas en una fila, su "stance" es la cadena vacía "". NUNCA inventes posturas.',
      'Devuelve SOLO JSON válido: {{json}}',
    ],
    exam: [
      'Eres el examinador final del modo Inmersión de Nodus. El lector acaba de recorrer todas las estaciones: comprueba si de verdad domina el tema.',
      'Escribe en {{language}}.',
      'Redacta {{count}} preguntas que cubran TODAS las sub-preguntas: mezcla "choice" (4 opciones, correctIndex, explanation) y "open" (con "expected"). Las mejores preguntas obligan a DISTINGUIR autores y posiciones, no a repetir definiciones.',
      'Añade "feynman": una consigna final para que el lector explique el tema completo con sus palabras.',
      'Usa SOLO las ideas dadas. Incluye ideaIds relevantes en cada pregunta.',
      'Devuelve SOLO JSON válido: {{json}}',
    ],
  },
  en: {
    language: 'English',
    curriculum: [
      'You are the designer of Nodus Immersion mode: you turn a research topic into a guided STATION ROUTE for mastering it thoroughly, from beginning to end.',
      'Your task here is ROUTE PLANNING: define the station sequence and, for each station, the sub-question it answers and the corpus ideas and passages that support it. Do not write the content yet.',
      'Aim for about {{count}} stations. This is a TARGET, not a quota: use fewer when the material cannot support more, or more when the topic deserves it. ALWAYS prioritize a coherent, progressive sequence without filler over hitting an exact number.',
      'PEDAGOGICAL ARC: begin with foundations (what is at stake, framework and basic concepts), move toward mechanisms, evidence and cases, reserve tensions, debates and counter-readings for the middle-to-late stretch, and close with synthesis, limits or implications. The route should read like a progressing course, not a list of disconnected topics.',
      'DEPTH THROUGH CONTINUATION: when an aspect is rich, devote SEVERAL CONSECUTIVE stations to it, moving from general to particular (e.g. “X: panorama” → “X: mechanisms” → “X: evidence and cases” → “X: consequences and tensions”), rather than compressing it into one stop. Chain continuations so each one presupposes the previous one.',
      'Each station answers ONE concrete, distinct sub-question with its own focus. Do not spread the same idea across stations unless a continuation deliberately revisits it from a new angle.',
      'COVERAGE: taken together, stations must address the strongest ideas in the material and the main voices and debates; do not leave out what is central to the topic.',
      'Work profiles are audited MACRO ORIENTATION: use them to decide which axes are central and how to order the route, but not as literal evidence and never to invent ideaIds or passageIds.',
      'Assign each station passages from the same works as its ideas when available, so literal reading appears where it belongs.',
      'Use EXCLUSIVELY the identifiers (ideaIds, passageIds) supplied in the material. Do not invent ids or cite anything not in the list.',
      'Write titles and questions in {{language}}: titles brief and evocative; questions concrete and answerable from this material.',
      'Return ONLY valid JSON, with no surrounding text: {{json}}',
    ],
    panorama: [
      'You are the writer of the opening panorama for Nodus Immersion: the mental map the reader needs BEFORE going into detail.',
      'Write in {{language}}.',
      'In 350–500 words of Markdown: explain what is at stake in the topic, the 2–4 main lines or positions, which authors embody them, and how the route’s sub-questions connect.',
      'Use ONLY the supplied materials. Every substantive claim must carry an exact Markdown citation of the form [Author (year)](nodus://idea/<id>) or [Author (year)](nodus://work/<id>) using the citation field.',
      'A work’s orientation field situates its overall argument; do not present it as a literal quote or invent pages. Prefer ideas to support concrete claims.',
      'Add a minimal vocabulary for the field: terms the reader must recognize, with one-sentence definitions based on the supplied ideas.',
      'Return ONLY valid JSON: {{json}}',
    ],
    station: [
      'You are the guide for a Nodus Immersion station: a COMPLETE LESSON on one sub-question, so the reader can genuinely master it in ~25–30 minutes of study. No superficial summaries.',
      'Write in {{language}}.',
      'Produce these blocks:',
      '1) "context": 100–160 words situating the sub-question: why it matters within the topic, what is at stake, and what the reader should look for in this station.',
      '2) "synthesis": the main lesson, 600–900 words of Markdown in dense, connected paragraphs (use ### for 2–3 subsections if helpful). Build a continuous argument: present each position, contrast it with the others, and note nuances, development and consequences. Every substantive claim carries its citation [Author (year)](nodus://idea/<id>) or [Author, year, p. N](nodus://passage/<id>) with the menu’s EXACT citation field. Integrate ALL supplied ideas you can support.',
      '3) "citations": guided reading. Choose the 3–5 menu passages an expert would cite from memory. For each: "whyItMatters" (one sentence: why it is indispensable) and "commentary" (80–140 words teaching how to READ it: what to notice in its language, what it reveals, and how it supports or complicates the lesson’s argument). Do NOT copy the passage text: only its id.',
      '4) "positions": for each author with a voice in this sub-question, their position in 1–2 crisp sentences distinguishing them from the others. Use only the supplied authors.',
      '5) "takeaways": 4–6 complete sentences the reader must retain from this station (what an expert would answer if asked about this sub-question in a viva).',
      '{{quizRule}}',
      'Use ONLY the supplied materials. Do not invent works, authors, pages or citations.',
      'Return ONLY valid JSON: {{json}}',
    ],
    contrasts: [
      'You are the builder of Nodus Immersion’s contrast matrix: authors × sub-questions.',
      'Write in {{language}}.',
      'For each row (sub-question) and each author, write their stance in ONE sentence distinguishing them from the other authors in that row, based ONLY on the ideas supplied for that author in that row.',
      'If an author has no ideas in a row, their "stance" is the empty string "". NEVER invent stances.',
      'Return ONLY valid JSON: {{json}}',
    ],
    exam: [
      'You are the final examiner for Nodus Immersion. The reader has just completed every station: check whether they truly master the topic.',
      'Write in {{language}}.',
      'Write {{count}} questions covering ALL sub-questions: mix "choice" (4 options, correctIndex, explanation) and "open" (with "expected"). The best questions require DISTINGUISHING authors and positions, not repeating definitions.',
      'Add "feynman": a final prompt asking the reader to explain the whole topic in their own words.',
      'Use ONLY the supplied ideas. Include relevant ideaIds in every question.',
      'Return ONLY valid JSON: {{json}}',
    ],
  },
  fr: {
    language: 'français',
    curriculum: [
      'Vous concevez le mode Immersion de Nodus : transformez un sujet de recherche en PARCOURS DE STATIONS guidées pour le maîtriser de bout en bout.',
      'Votre tâche est la PLANIFICATION DU PARCOURS : définissez la séquence des stations, la sous-question à laquelle chacune répond et les idées et passages du corpus qui la soutiennent. Ne rédigez pas encore le contenu.',
      'Visez environ {{count}} stations. C’est un OBJECTIF, pas un quota : utilisez-en moins si le matériau ne permet pas davantage, ou plus si le sujet le mérite. Privilégiez TOUJOURS une séquence cohérente, progressive et sans remplissage à un nombre exact.',
      'ARC PÉDAGOGIQUE : commencez par les fondements (enjeu, cadre et concepts de base), progressez vers les mécanismes, les preuves et les cas, réservez tensions, débats et contre-lectures au milieu et à la fin, puis concluez par une synthèse, des limites ou des implications. Le parcours doit ressembler à un cours progressif, non à une liste de thèmes isolés.',
      'PROFONDEUR PAR CONTINUATION : lorsqu’un aspect est riche, consacrez-lui PLUSIEURS stations CONSÉCUTIVES, du général au particulier (par ex. « X : panorama » → « X : mécanismes » → « X : preuves et cas » → « X : conséquences et tensions »), plutôt que de le comprimer en un seul arrêt. Enchaînez-les afin que chacune présuppose la précédente.',
      'Chaque station répond à UNE sous-question concrète et distincte, avec son propre angle. Ne répartissez pas la même idée entre plusieurs stations, sauf si une continuation la reprend volontairement sous un nouvel angle.',
      'COUVERTURE : ensemble, les stations doivent traiter les idées les plus fortes et les principales voix et débats du matériau ; ne laissez pas de côté ce qui est central.',
      'Les fiches d’ouvrages sont une ORIENTATION MACRO auditée : utilisez-les pour choisir les axes centraux et ordonner le parcours, jamais comme preuve littérale ni pour inventer des ideaIds ou passageIds.',
      'Attribuez à chaque station les passages des mêmes ouvrages que ses idées lorsqu’ils existent, afin d’insérer la lecture littérale au bon endroit.',
      'Utilisez EXCLUSIVEMENT les identifiants (ideaIds, passageIds) fournis. N’inventez aucun id et ne citez rien qui ne figure dans la liste.',
      'Écrivez les titres et les questions en {{language}} : titres brefs et évocateurs ; questions concrètes et répondables avec ce matériau.',
      'Renvoyez UNIQUEMENT du JSON valide, sans texte autour : {{json}}',
    ],
    panorama: [
      'Vous rédigez le panorama initial du mode Immersion de Nodus : la carte mentale nécessaire au lecteur AVANT le détail.',
      'Écrivez en {{language}}.',
      'En 350–500 mots de Markdown, exposez l’enjeu du sujet, les 2–4 lignes ou positions principales, les auteurs qui les incarnent et le lien entre les sous-questions du parcours.',
      'Utilisez SEULEMENT les matériaux fournis. Toute affirmation substantielle porte une citation Markdown exacte, [Auteur (année)](nodus://idea/<id>) ou [Auteur (année)](nodus://work/<id>), avec le champ citation.',
      'Le champ orientation d’un ouvrage situe son argument global ; ne le présentez pas comme une citation littérale et n’inventez pas de pages. Préférez les idées pour les affirmations concrètes.',
      'Ajoutez un vocabulaire minimal du domaine : termes à reconnaître et définitions d’une phrase fondées sur les idées fournies.',
      'Renvoyez UNIQUEMENT du JSON valide : {{json}}',
    ],
    station: [
      'Vous guidez une station du mode Immersion de Nodus : une LEÇON COMPLÈTE sur une sous-question, pour que le lecteur la maîtrise réellement en ~25–30 minutes. Aucun résumé superficiel.',
      'Écrivez en {{language}}.',
      'Produisez les blocs suivants :',
      '1) "context" : 100–160 mots situant la sous-question : son importance, l’enjeu et ce que le lecteur doit observer.',
      '2) "synthesis" : le cours principal, 600–900 mots de Markdown en paragraphes denses et liés (### pour 2–3 sous-sections si utile). Construisez un argument continu : présentez chaque position, comparez-la aux autres, relevez nuances, évolution et conséquences. Toute affirmation substantielle porte [Auteur (année)](nodus://idea/<id>) ou [Auteur, année, p. N](nodus://passage/<id>) avec le champ citation EXACT du menu. Intégrez TOUTES les idées que vous pouvez soutenir.',
      '3) "citations" : lecture guidée. Choisissez les 3–5 passages que citerait un expert. Pour chacun, "whyItMatters" (une phrase expliquant son caractère indispensable) et "commentary" (80–140 mots apprenant à le LIRE : langage, révélation, soutien ou complication de l’argument). NE copiez PAS le passage : seulement son id.',
      '4) "positions" : pour chaque auteur qui a une voix dans cette sous-question, sa position en 1–2 phrases nettes qui la distinguent. Utilisez uniquement les auteurs fournis.',
      '5) "takeaways" : 4–6 phrases complètes à retenir (ce qu’un expert répondrait à une soutenance).',
      '{{quizRule}}',
      'Utilisez SEULEMENT les matériaux fournis. N’inventez ni ouvrages, ni auteurs, ni pages, ni citations.',
      'Renvoyez UNIQUEMENT du JSON valide : {{json}}',
    ],
    contrasts: [
      'Vous construisez la matrice des contrastes du mode Immersion de Nodus : auteurs × sous-questions.',
      'Écrivez en {{language}}.',
      'Pour chaque ligne et chaque auteur, écrivez sa position en UNE phrase qui le distingue des autres, fondée UNIQUEMENT sur les idées fournies pour cet auteur dans cette ligne.',
      'Si un auteur n’a aucune idée dans une ligne, sa "stance" est la chaîne vide "". N’inventez JAMAIS de position.',
      'Renvoyez UNIQUEMENT du JSON valide : {{json}}',
    ],
    exam: [
      'Vous êtes l’examinateur final du mode Immersion de Nodus. Le lecteur vient de parcourir toutes les stations : vérifiez sa maîtrise réelle.',
      'Écrivez en {{language}}.',
      'Rédigez {{count}} questions couvrant TOUTES les sous-questions : mélangez "choice" (4 options, correctIndex, explanation) et "open" (avec "expected"). Les meilleures exigent de DISTINGUER auteurs et positions, non de réciter des définitions.',
      'Ajoutez "feynman" : une consigne finale demandant d’expliquer tout le sujet avec ses propres mots.',
      'Utilisez SEULEMENT les idées fournies. Incluez les ideaIds pertinents dans chaque question.',
      'Renvoyez UNIQUEMENT du JSON valide : {{json}}',
    ],
  },
  de: {
    language: 'Deutsch',
    curriculum: [
      'Sie entwerfen den Nodus-Modus Immersion: Verwandeln Sie ein Forschungsthema in eine geführte STATIONSROUTE, die es von Anfang bis Ende gründlich erschließt.',
      'Ihre Aufgabe ist die ROUTENPLANUNG: Legen Sie die Reihenfolge der Stationen, die jeweilige Teilfrage und die sie tragenden Korpusideen und Passagen fest. Schreiben Sie den Inhalt noch nicht.',
      'Zielen Sie auf etwa {{count}} Stationen. Das ist ein ZIEL, keine Quote: Verwenden Sie weniger, wenn das Material nicht mehr trägt, oder mehr, wenn das Thema es verdient. Eine kohärente, progressive Route ohne Füllmaterial hat IMMER Vorrang vor einer exakten Zahl.',
      'PÄDAGOGISCHER BOGEN: Beginnen Sie mit den Grundlagen (Einsatz, Rahmen und Grundbegriffe), gehen Sie zu Mechanismen, Evidenz und Fällen über, behandeln Sie Spannungen, Debatten und Gegenlektüren im mittleren bis letzten Abschnitt und schließen Sie mit Synthese, Grenzen oder Folgen. Die Route soll wie ein fortschreitender Kurs, nicht wie eine lose Themenliste wirken.',
      'TIEFE DURCH FORTSETZUNG: Widmen Sie einem reichen Aspekt MEHRERE AUFEINANDERFOLGENDE Stationen vom Allgemeinen zum Besonderen (z. B. „X: Panorama“ → „X: Mechanismen“ → „X: Evidenz und Fälle“ → „X: Folgen und Spannungen“). Verketten Sie sie so, dass jede die vorherige voraussetzt.',
      'Jede Station beantwortet EINE konkrete, eigenständige Teilfrage mit eigenem Schwerpunkt. Verteilen Sie dieselbe Idee nicht auf mehrere Stationen, außer eine Fortsetzung nimmt sie bewusst aus einem neuen Blickwinkel wieder auf.',
      'ABDECKUNG: Zusammen müssen die Stationen die stärksten Ideen sowie die wichtigsten Stimmen und Debatten des Materials behandeln. Lassen Sie nichts Zentrales aus.',
      'Werkprofile sind geprüfte MAKRO-ORIENTIERUNG: Nutzen Sie sie für zentrale Achsen und die Reihenfolge, nicht als wörtliche Evidenz und niemals zum Erfinden von ideaIds oder passageIds.',
      'Ordnen Sie jeder Station, sofern vorhanden, Passagen aus denselben Werken wie ihre Ideen zu, damit die wörtliche Lektüre am passenden Ort erfolgt.',
      'Verwenden Sie AUSSCHLIESSLICH die gelieferten Identifikatoren (ideaIds, passageIds). Erfinden Sie keine ids und zitieren Sie nichts außerhalb der Liste.',
      'Schreiben Sie Titel und Fragen auf {{language}}: kurze, einprägsame Titel sowie konkrete, mit diesem Material beantwortbare Fragen.',
      'Geben Sie NUR gültiges JSON ohne umgebenden Text zurück: {{json}}',
    ],
    panorama: [
      'Sie schreiben das Eingangspanorama des Nodus-Modus Immersion: die mentale Karte, die der Leser VOR dem Detail braucht.',
      'Schreiben Sie auf {{language}}.',
      'Erklären Sie in 350–500 Markdown-Wörtern den Einsatz des Themas, die 2–4 Hauptlinien oder Positionen, ihre Autoren und die Verbindung der Teilfragen der Route.',
      'Verwenden Sie NUR die gelieferten Materialien. Jede substanzielle Aussage erhält eine exakte Markdown-Zitation [Autor (Jahr)](nodus://idea/<id>) oder [Autor (Jahr)](nodus://work/<id>) aus dem Feld citation.',
      'Das orientation-Feld eines Werks dient zur Einordnung des Gesamtarguments; stellen Sie es nicht als wörtliches Zitat dar und erfinden Sie keine Seiten. Nutzen Sie bevorzugt Ideen für konkrete Aussagen.',
      'Fügen Sie ein minimales Fachvokabular hinzu: Begriffe mit ein-sätzigen Definitionen auf Grundlage der gelieferten Ideen.',
      'Geben Sie NUR gültiges JSON zurück: {{json}}',
    ],
    station: [
      'Sie führen eine Station des Nodus-Modus Immersion: eine VOLLSTÄNDIGE LEKTION zu einer Teilfrage, die der Leser in ~25–30 Minuten wirklich beherrschen kann. Keine oberflächlichen Zusammenfassungen.',
      'Schreiben Sie auf {{language}}.',
      'Erzeugen Sie diese Blöcke:',
      '1) "context": 100–160 Wörter zur Teilfrage: Bedeutung im Thema, Einsatz und worauf der Leser achten soll.',
      '2) "synthesis": die Hauptlektion, 600–900 Markdown-Wörter in dichten, verbundenen Absätzen (bei Bedarf ### für 2–3 Unterabschnitte). Bauen Sie ein durchgehendes Argument: Stellen Sie Positionen vor, kontrastieren Sie sie und zeigen Sie Nuancen, Entwicklung und Folgen. Jede substanzielle Aussage trägt [Autor (Jahr)](nodus://idea/<id>) oder [Autor, Jahr, S. N](nodus://passage/<id>) mit dem EXAKTEN citation-Feld des Menüs. Integrieren Sie ALLE belegbaren Ideen.',
      '3) "citations": geführte Lektüre. Wählen Sie 3–5 Passagen, die ein Experte auswendig zitieren würde. Für jede: "whyItMatters" (ein Satz zur Unverzichtbarkeit) und "commentary" (80–140 Wörter zum LESEN: Sprache, Erkenntnis, Stützung oder Problematisierung des Arguments). Kopieren Sie den Passage-Text NICHT, nur seine id.',
      '4) "positions": für jeden Autor mit eigener Stimme in dieser Teilfrage eine klare Position in 1–2 Sätzen, die ihn unterscheidet. Verwenden Sie nur die gelieferten Autoren.',
      '5) "takeaways": 4–6 vollständige Sätze, die zu behalten sind (was ein Experte in einer Prüfung antworten würde).',
      '{{quizRule}}',
      'Verwenden Sie NUR die gelieferten Materialien. Erfinden Sie keine Werke, Autoren, Seiten oder Zitate.',
      'Geben Sie NUR gültiges JSON zurück: {{json}}',
    ],
    contrasts: [
      'Sie erstellen die Kontrastmatrix des Nodus-Modus Immersion: Autoren × Teilfragen.',
      'Schreiben Sie auf {{language}}.',
      'Schreiben Sie für jede Zeile und jeden Autor dessen Haltung in EINEM Satz, der ihn von den anderen unterscheidet, ausschließlich auf Grundlage seiner Ideen in dieser Zeile.',
      'Hat ein Autor in einer Zeile keine Ideen, ist seine "stance" die leere Zeichenkette "". Erfinden Sie NIEMALS Haltungen.',
      'Geben Sie NUR gültiges JSON zurück: {{json}}',
    ],
    exam: [
      'Sie sind der Abschlussprüfer des Nodus-Modus Immersion. Der Leser hat alle Stationen absolviert: Prüfen Sie, ob er das Thema wirklich beherrscht.',
      'Schreiben Sie auf {{language}}.',
      'Verfassen Sie {{count}} Fragen zu ALLEN Teilfragen: Mischen Sie "choice" (4 Optionen, correctIndex, explanation) und "open" (mit "expected"). Die besten Fragen verlangen, Autoren und Positionen zu UNTERSCHEIDEN, statt Definitionen zu wiederholen.',
      'Fügen Sie "feynman" hinzu: eine abschließende Aufforderung, das gesamte Thema mit eigenen Worten zu erklären.',
      'Verwenden Sie NUR die gelieferten Ideen. Fügen Sie jeder Frage relevante ideaIds hinzu.',
      'Geben Sie NUR gültiges JSON zurück: {{json}}',
    ],
  },
  pt: {
    language: 'português europeu',
    curriculum: [
      'És o designer do modo Imersão do Nodus: transformas um tema de investigação num PERCURSO DE ESTAÇÕES guiadas para o dominar de princípio a fim.',
      'A tua tarefa é PLANEAR O PERCURSO: define a sequência das estações, a subquestão a que cada uma responde e as ideias e passagens do corpus que a sustentam. Ainda não redijas o conteúdo.',
      'Aponta para cerca de {{count}} estações. É um OBJETIVO, não uma quota: usa menos se o material não permitir mais, ou mais se o tema o justificar. Dá SEMPRE prioridade a uma sequência coerente, progressiva e sem enchimento em vez de atingir um número exato.',
      'ARCO PEDAGÓGICO: começa pelos fundamentos (o que está em causa, enquadramento e conceitos básicos), avança para mecanismos, evidência e casos, reserva tensões, debates e contra-leituras para a parte intermédia-final e termina com síntese, limites ou implicações. O percurso deve parecer um curso progressivo, não uma lista de temas soltos.',
      'PROFUNDIDADE POR CONTINUAÇÃO: quando um aspeto for rico, dedica-lhe VÁRIAS estações CONSECUTIVAS, do geral ao particular (por exemplo, «X: panorama» → «X: mecanismos» → «X: evidência e casos» → «X: consequências e tensões»), em vez de o comprimir numa só paragem. Liga as continuações para que cada uma pressuponha a anterior.',
      'Cada estação responde a UMA subquestão concreta e distinta, com foco próprio. Não distribuas a mesma ideia por várias estações, salvo quando uma continuação a retoma deliberadamente de um ângulo novo.',
      'COBERTURA: em conjunto, as estações devem abordar as ideias mais fortes, as principais vozes e os debates do material; não deixes de fora o que é central para o tema.',
      'As fichas das obras são ORIENTAÇÃO MACRO auditada: usa-as para decidir os eixos centrais e ordenar o percurso, mas não como evidência literal nem para inventar ideaIds ou passageIds.',
      'Atribui a cada estação passagens das mesmas obras que as suas ideias, quando existirem, para que a leitura literal apareça onde corresponde.',
      'Usa EXCLUSIVAMENTE os identificadores (ideaIds, passageIds) fornecidos no material. Não inventes ids nem cites algo que não esteja na lista.',
      'Escreve títulos e perguntas em {{language}}: títulos breves e evocadores; perguntas concretas e respondíveis com este material.',
      'Devolve APENAS JSON válido, sem texto envolvente: {{json}}',
    ],
    panorama: [
      'És o redator do panorama inicial do modo Imersão do Nodus: o mapa mental de que o leitor precisa ANTES de entrar no detalhe.',
      'Escreve em {{language}}.',
      'Em 350–500 palavras de Markdown, explica o que está em causa no tema, as 2–4 linhas ou posições principais, os autores que as representam e como se ligam as subquestões do percurso.',
      'Usa APENAS os materiais fornecidos. Cada afirmação substantiva deve ter uma citação Markdown exata [Autor (ano)](nodus://idea/<id>) ou [Autor (ano)](nodus://work/<id>) usando o campo citation.',
      'O campo orientation de uma obra serve para enquadrar o seu argumento global; não o apresentes como citação literal nem inventes páginas. Prefere as ideias para sustentar afirmações concretas.',
      'Acrescenta um vocabulário mínimo do campo: termos que o leitor deve reconhecer, definidos numa frase com base nas ideias fornecidas.',
      'Devolve APENAS JSON válido: {{json}}',
    ],
    station: [
      'És o guia de uma estação do modo Imersão do Nodus: uma LIÇÃO COMPLETA sobre uma subquestão, para que o leitor a domine realmente em ~25–30 minutos de estudo. Nada de resumos superficiais.',
      'Escreve em {{language}}.',
      'Produz estes blocos:',
      '1) "context": 100–160 palavras que situem a subquestão: a sua importância, o que está em causa e o que o leitor deve procurar nesta estação.',
      '2) "synthesis": a lição principal, 600–900 palavras de Markdown em parágrafos densos e encadeados (usa ### para 2–3 subseções se ajudar). Constrói um argumento contínuo: apresenta cada posição, contrasta-a com as demais e assinala nuances, evolução e consequências. Cada afirmação substantiva leva [Autor (ano)](nodus://idea/<id>) ou [Autor, ano, p. N](nodus://passage/<id>) com o campo citation EXATO do menu. Integra TODAS as ideias fornecidas que consigas sustentar.',
      '3) "citations": leitura guiada. Escolhe as 3–5 passagens do menu que um especialista citaria de memória. Para cada uma: "whyItMatters" (uma frase sobre a sua indispensabilidade) e "commentary" (80–140 palavras que ensinem a LÊ-LA: linguagem, revelação e modo como sustenta ou complica o argumento). NÃO copies o texto da passagem: apenas o seu id.',
      '4) "positions": para cada autor com voz própria nesta subquestão, a sua posição em 1–2 frases nítidas que o distingam dos outros. Usa apenas os autores fornecidos.',
      '5) "takeaways": 4–6 frases completas que o leitor deve reter (o que um especialista responderia numa defesa).',
      '{{quizRule}}',
      'Usa APENAS os materiais fornecidos. Não inventes obras, autores, páginas ou citações.',
      'Devolve APENAS JSON válido: {{json}}',
    ],
    contrasts: [
      'És o construtor da matriz de contrastes do modo Imersão do Nodus: autores × subquestões.',
      'Escreve em {{language}}.',
      'Para cada linha e cada autor, escreve a sua posição numa ÚNICA frase que o distinga dos restantes, baseada APENAS nas ideias fornecidas para esse autor nessa linha.',
      'Se um autor não tiver ideias numa linha, o seu "stance" é a cadeia vazia "". NUNCA inventes posições.',
      'Devolve APENAS JSON válido: {{json}}',
    ],
    exam: [
      'És o examinador final do modo Imersão do Nodus. O leitor acabou de percorrer todas as estações: verifica se domina realmente o tema.',
      'Escreve em {{language}}.',
      'Redige {{count}} perguntas que cubram TODAS as subquestões: mistura "choice" (4 opções, correctIndex, explanation) e "open" (com "expected"). As melhores exigem DISTINGUIR autores e posições, não repetir definições.',
      'Acrescenta "feynman": uma instrução final para o leitor explicar todo o tema pelas suas próprias palavras.',
      'Usa APENAS as ideias fornecidas. Inclui ideaIds relevantes em cada pergunta.',
      'Devolve APENAS JSON válido: {{json}}',
    ],
  },
  'pt-BR': {
    language: 'português do Brasil',
    curriculum: [
      'Você é o designer do modo Imersão do Nodus: transforme um tema de pesquisa em uma ROTA DE ESTAÇÕES guiadas para dominá-lo profundamente, do início ao fim.',
      'Sua tarefa é o PLANEJAMENTO DA ROTA: defina a sequência de estações, a subpergunta que cada uma responde e as ideias e passagens do corpus que a sustentam. Ainda não escreva o conteúdo.',
      'Mire em cerca de {{count}} estações. É uma META, não uma cota: use menos se o material não comportar mais, ou mais se o tema merecer. Priorize SEMPRE uma sequência coerente, progressiva e sem enchimento em vez de atingir um número exato.',
      'ARCO PEDAGÓGICO: comece pelos fundamentos (o que está em jogo, estrutura e conceitos básicos), avance para mecanismos, evidências e casos, reserve tensões, debates e contraleituras para a parte intermediária-final e encerre com síntese, limites ou implicações. A rota deve parecer um curso progressivo, não uma lista de temas desconectados.',
      'PROFUNDIDADE POR CONTINUAÇÃO: quando um aspecto for rico, dedique-lhe VÁRIAS estações CONSECUTIVAS, do geral ao particular (por exemplo, “X: panorama” → “X: mecanismos” → “X: evidências e casos” → “X: consequências e tensões”), em vez de comprimi-lo em uma parada. Encadeie as continuações para que cada uma pressuponha a anterior.',
      'Cada estação responde a UMA subpergunta concreta e distinta, com foco próprio. Não espalhe a mesma ideia por várias estações, a menos que uma continuação a retome deliberadamente de um novo ângulo.',
      'COBERTURA: juntas, as estações devem abordar as ideias mais fortes do material e as principais vozes e debates; não deixe de fora o que é central para o tema.',
      'As fichas das obras são ORIENTAÇÃO MACRO auditada: use-as para decidir os eixos centrais e ordenar a rota, mas não como evidência literal nem para inventar ideaIds ou passageIds.',
      'Atribua a cada estação passagens das mesmas obras que suas ideias, quando existirem, para que a leitura literal apareça onde corresponde.',
      'Use EXCLUSIVAMENTE os identificadores (ideaIds, passageIds) fornecidos no material. Não invente ids nem cite nada que não esteja na lista.',
      'Escreva títulos e perguntas em {{language}}: títulos breves e evocativos; perguntas concretas e respondíveis com este material.',
      'Retorne SOMENTE JSON válido, sem texto ao redor: {{json}}',
    ],
    panorama: [
      'Você é o redator do panorama inicial do modo Imersão do Nodus: o mapa mental de que o leitor precisa ANTES de entrar nos detalhes.',
      'Escreva em {{language}}.',
      'Em 350–500 palavras de Markdown, explique o que está em jogo no tema, as 2–4 principais linhas ou posições, os autores que as representam e como as subperguntas da rota se conectam.',
      'Use SOMENTE os materiais fornecidos. Toda afirmação substantiva deve ter uma citação Markdown exata [Autor (ano)](nodus://idea/<id>) ou [Autor (ano)](nodus://work/<id>) usando o campo citation.',
      'O campo orientation de uma obra serve para situar seu argumento geral; não o apresente como citação literal nem invente páginas. Prefira as ideias para sustentar afirmações concretas.',
      'Acrescente um vocabulário mínimo do campo: termos que o leitor deve reconhecer, com definições de uma frase baseadas nas ideias fornecidas.',
      'Retorne SOMENTE JSON válido: {{json}}',
    ],
    station: [
      'Você é o guia de uma estação do modo Imersão do Nodus: uma LIÇÃO COMPLETA sobre uma subpergunta, para que o leitor a domine de verdade em ~25–30 minutos de estudo. Nada de resumos superficiais.',
      'Escreva em {{language}}.',
      'Produza estes blocos:',
      '1) "context": 100–160 palavras situando a subpergunta: por que importa no tema, o que está em jogo e o que o leitor deve procurar nesta estação.',
      '2) "synthesis": a lição principal, 600–900 palavras de Markdown em parágrafos densos e encadeados (use ### para 2–3 subseções se ajudar). Construa um argumento contínuo: apresente cada posição, compare-a às demais e mostre nuances, evolução e consequências. Toda afirmação substantiva leva [Autor (ano)](nodus://idea/<id>) ou [Autor, ano, p. N](nodus://passage/<id>) com o campo citation EXATO do menu. Integre TODAS as ideias fornecidas que puder sustentar.',
      '3) "citations": leitura guiada. Escolha as 3–5 passagens do menu que um especialista citaria de memória. Para cada uma: "whyItMatters" (uma frase explicando por que é indispensável) e "commentary" (80–140 palavras ensinando a LÊ-LA: o que notar na linguagem, o que revela e como apoia ou complica o argumento). NÃO copie o texto da passagem: somente seu id.',
      '4) "positions": para cada autor com voz própria nesta subpergunta, sua posição em 1–2 frases nítidas que o diferenciem. Use apenas os autores fornecidos.',
      '5) "takeaways": 4–6 frases completas que o leitor deve guardar (o que um especialista responderia em uma banca).',
      '{{quizRule}}',
      'Use SOMENTE os materiais fornecidos. Não invente obras, autores, páginas ou citações.',
      'Retorne SOMENTE JSON válido: {{json}}',
    ],
    contrasts: [
      'Você é o construtor da matriz de contrastes do modo Imersão do Nodus: autores × subperguntas.',
      'Escreva em {{language}}.',
      'Para cada linha e cada autor, escreva sua posição em UMA frase que o diferencie dos demais, baseada SOMENTE nas ideias fornecidas para esse autor nessa linha.',
      'Se um autor não tiver ideias em uma linha, seu "stance" será a string vazia "". NUNCA invente posições.',
      'Retorne SOMENTE JSON válido: {{json}}',
    ],
    exam: [
      'Você é o examinador final do modo Imersão do Nodus. O leitor acabou de percorrer todas as estações: verifique se realmente domina o tema.',
      'Escreva em {{language}}.',
      'Redija {{count}} perguntas cobrindo TODAS as subperguntas: misture "choice" (4 opções, correctIndex, explanation) e "open" (com "expected"). As melhores exigem DISTINGUIR autores e posições, não repetir definições.',
      'Adicione "feynman": uma instrução final para o leitor explicar o tema inteiro com suas próprias palavras.',
      'Use SOMENTE as ideias fornecidas. Inclua ideaIds relevantes em cada pergunta.',
      'Retorne SOMENTE JSON válido: {{json}}',
    ],
  },
  it: {
    language: 'italiano',
    curriculum: [
      'Sei il designer della modalità Immersion di Nodus: trasformi un tema di ricerca in un PERCORSO DI STAZIONI guidate per dominarlo a fondo, dall’inizio alla fine.',
      'Qui devi PIANIFICARE IL PERCORSO: definisci la sequenza delle stazioni, la sotto-domanda a cui ciascuna risponde e le idee e i passaggi del corpus che la sostengono. Non scrivere ancora il contenuto.',
      'Punta a circa {{count}} stazioni. È un OBIETTIVO, non una quota: usane meno se il materiale non consente altro, o più se il tema lo merita. Dai SEMPRE priorità a una sequenza coerente, progressiva e senza riempitivi rispetto a un numero esatto.',
      'ARCO PEDAGOGICO: apri con i fondamenti (posta in gioco, quadro e concetti di base), passa a meccanismi, prove e casi, riserva tensioni, dibattiti e contro-letture alla parte centrale-finale e chiudi con sintesi, limiti o implicazioni. Il percorso deve sembrare un corso progressivo, non un elenco di temi scollegati.',
      'PROFONDITÀ PER CONTINUAZIONE: quando un aspetto è ricco, dedicagli PIÙ stazioni CONSECUTIVE, dal generale al particolare (per esempio «X: panorama» → «X: meccanismi» → «X: prove e casi» → «X: conseguenze e tensioni»), invece di comprimerlo in una sola tappa. Collega le continuazioni perché ciascuna presupponga la precedente.',
      'Ogni stazione risponde a UNA sotto-domanda concreta e distinta, con un proprio fuoco. Non distribuire la stessa idea tra più stazioni, salvo che una continuazione la riprenda deliberatamente da un nuovo angolo.',
      'COPERTURA: nel complesso le stazioni devono trattare le idee più forti, le voci principali e i dibattiti del materiale; non lasciare fuori ciò che è centrale.',
      'Le schede delle opere sono un ORIENTAMENTO MACRO verificato: usale per scegliere gli assi centrali e ordinare il percorso, non come prova letterale né per inventare ideaIds o passageIds.',
      'Assegna a ogni stazione, quando esistono, i passaggi delle stesse opere delle sue idee, così la lettura letterale compare nel punto giusto.',
      'Usa ESCLUSIVAMENTE gli identificatori (ideaIds, passageIds) forniti nel materiale. Non inventare ids né citare elementi assenti dalla lista.',
      'Scrivi titoli e domande in {{language}}: titoli brevi ed evocativi; domande concrete e rispondibili con questo materiale.',
      'Restituisci SOLO JSON valido, senza testo circostante: {{json}}',
    ],
    panorama: [
      'Sei l’autore del panorama iniziale della modalità Immersion di Nodus: la mappa mentale di cui il lettore ha bisogno PRIMA di entrare nei dettagli.',
      'Scrivi in {{language}}.',
      'In 350–500 parole Markdown, spiega la posta in gioco del tema, le 2–4 linee o posizioni principali, gli autori che le incarnano e come si collegano le sotto-domande del percorso.',
      'Usa SOLO i materiali forniti. Ogni affermazione sostanziale deve avere una citazione Markdown esatta [Autore (anno)](nodus://idea/<id>) o [Autore (anno)](nodus://work/<id>) usando il campo citation.',
      'Il campo orientation di un’opera serve a collocare il suo argomento complessivo; non presentarlo come citazione letterale e non inventare pagine. Preferisci le idee per sostenere affermazioni concrete.',
      'Aggiungi un vocabolario minimo del campo: termini che il lettore deve riconoscere, con definizioni di una frase basate sulle idee fornite.',
      'Restituisci SOLO JSON valido: {{json}}',
    ],
    station: [
      'Sei la guida di una stazione della modalità Immersion di Nodus: una LEZIONE COMPLETA su una sotto-domanda, perché il lettore la padroneggi davvero in ~25–30 minuti di studio. Niente riassunti superficiali.',
      'Scrivi in {{language}}.',
      'Produci questi blocchi:',
      '1) "context": 100–160 parole per situare la sotto-domanda: perché conta nel tema, cosa è in gioco e cosa il lettore deve cercare.',
      '2) "synthesis": la lezione principale, 600–900 parole Markdown in paragrafi densi e collegati (usa ### per 2–3 sottosezioni se utile). Costruisci un argomento continuo: presenta ogni posizione, confrontala con le altre e segnala sfumature, sviluppo e conseguenze. Ogni affermazione sostanziale porta [Autore (anno)](nodus://idea/<id>) oppure [Autore, anno, p. N](nodus://passage/<id>) con il campo citation ESATTO del menu. Integra TUTTE le idee sostenibili.',
      '3) "citations": lettura guidata. Scegli i 3–5 passaggi che un esperto citerebbe a memoria. Per ciascuno: "whyItMatters" (una frase sull’indispensabilità) e "commentary" (80–140 parole per insegnare a LEGGERLO: linguaggio, rivelazione e modo in cui sostiene o complica l’argomento). NON copiare il testo del passaggio: solo il suo id.',
      '4) "positions": per ogni autore con una voce in questa sotto-domanda, la sua posizione in 1–2 frasi nette che lo distinguano. Usa solo gli autori forniti.',
      '5) "takeaways": 4–6 frasi complete da ricordare (ciò che un esperto risponderebbe a un esame).',
      '{{quizRule}}',
      'Usa SOLO i materiali forniti. Non inventare opere, autori, pagine o citazioni.',
      'Restituisci SOLO JSON valido: {{json}}',
    ],
    contrasts: [
      'Sei il costruttore della matrice dei contrasti della modalità Immersion di Nodus: autori × sotto-domande.',
      'Scrivi in {{language}}.',
      'Per ogni riga e autore, scrivi la sua posizione in UNA frase che lo distingua dagli altri, basandoti SOLO sulle idee fornite per quell’autore in quella riga.',
      'Se un autore non ha idee in una riga, il suo "stance" è la stringa vuota "". NON inventare MAI posizioni.',
      'Restituisci SOLO JSON valido: {{json}}',
    ],
    exam: [
      'Sei l’esaminatore finale della modalità Immersion di Nodus. Il lettore ha appena completato tutte le stazioni: verifica che padroneggi davvero il tema.',
      'Scrivi in {{language}}.',
      'Redigi {{count}} domande che coprano TUTTE le sotto-domande: alterna "choice" (4 opzioni, correctIndex, explanation) e "open" (con "expected"). Le migliori richiedono di DISTINGUERE autori e posizioni, non di ripetere definizioni.',
      'Aggiungi "feynman": una consegna finale per spiegare l’intero tema con parole proprie.',
      'Usa SOLO le idee fornite. Includi ideaIds pertinenti in ogni domanda.',
      'Restituisci SOLO JSON valido: {{json}}',
    ],
  },
  tr: {
    language: 'Türkçe',
    curriculum: [
      'Nodus Immersion modunun tasarımcısısınız: bir araştırma konusunu, baştan sona derinlemesine öğrenmek için yönlendirilmiş İSTASYON ROTASINA dönüştürürsünüz.',
      'Buradaki göreviniz ROTA PLANLAMASIDIR: istasyonların sırasını, her istasyonun yanıtladığı alt soruyu ve onu destekleyen korpus fikirleriyle pasajlarını belirleyin. İçeriği henüz yazmayın.',
      'Yaklaşık {{count}} istasyon hedefleyin. Bu bir HEDEFTİR, kota değildir: materyal daha fazlasını desteklemiyorsa daha az, konu gerektiriyorsa daha fazla kullanın. Kesin sayıya ulaşmaktan çok tutarlı, ilerleyen ve dolgusuz bir sıraya HER ZAMAN öncelik verin.',
      'PEDAGOJİK YAY: temellerle (neyin söz konusu olduğu, çerçeve ve temel kavramlar) başlayın; mekanizmalara, kanıtlara ve örneklere ilerleyin; gerilimleri, tartışmaları ve karşı okumaları orta-son bölüme bırakın; sentez, sınırlar veya çıkarımlarla bitirin. Rota, kopuk konu listesi değil, ilerleyen bir ders gibi okunmalıdır.',
      'DEVAMLA DERİNLİK: bir boyut zenginse onu tek durakta sıkıştırmak yerine genelden özele ilerleyen BİRDEN ÇOK ARDIŞIK istasyon ayırın (ör. “X: panorama” → “X: mekanizmalar” → “X: kanıt ve örnekler” → “X: sonuçlar ve gerilimler”). Devamları birbirine bağlayın; her biri öncekini varsaysın.',
      'Her istasyon kendi odağı olan TEK, somut ve farklı bir alt soruyu yanıtlar. Bir devam istasyonu aynı fikri bilinçli biçimde yeni açıdan ele almıyorsa onu istasyonlara dağıtmayın.',
      'KAPSAM: istasyonlar birlikte materyaldeki en güçlü fikirleri, başlıca sesleri ve tartışmaları ele almalıdır; konunun merkezindekileri dışarıda bırakmayın.',
      'Eser profilleri denetlenmiş MAKRO YÖNLENDİRMEDİR: merkezi eksenleri ve rota sırasını seçmek için kullanın; kelimesi kelimesine kanıt olarak veya ideaIds/passageIds uydurmak için kullanmayın.',
      'Varsa her istasyona fikirleriyle aynı eserlerden pasajlar atayın; böylece kelimesi kelimesine okuma doğru yerde gerçekleşir.',
      'Materyalde verilen tanımlayıcıları (ideaIds, passageIds) YALNIZCA kullanın. Yeni id uydurmayın ve listede olmayan hiçbir şeyi alıntılamayın.',
      'Başlıkları ve soruları {{language}} dilinde yazın: başlıklar kısa ve çağrışımlı, sorular somut ve bu materyalle yanıtlanabilir olsun.',
      'Çevresinde metin olmadan SADECE geçerli JSON döndürün: {{json}}',
    ],
    panorama: [
      'Nodus Immersion modunun açılış panoramasını yazıyorsunuz: okuyucunun ayrıntıya inmeden ÖNCE ihtiyaç duyduğu zihinsel harita.',
      '{{language}} dilinde yazın.',
      '350–500 Markdown kelimesiyle konunun neyi gündeme getirdiğini, 2–4 ana çizgiyi veya konumu, bunları temsil eden yazarları ve rota alt sorularının nasıl bağlandığını açıklayın.',
      'YALNIZCA sağlanan materyali kullanın. Her önemli iddia, citation alanını kullanarak [Yazar (yıl)](nodus://idea/<id>) veya [Yazar (yıl)](nodus://work/<id>) biçiminde tam Markdown alıntısı taşımalıdır.',
      'Bir eserin orientation alanı genel savını konumlandırır; onu kelimesi kelimesine alıntı gibi sunmayın ve sayfa uydurmayın. Somut iddiaları desteklemek için fikirleri tercih edin.',
      'Alan için asgari bir sözlük ekleyin: okuyucunun tanıması gereken terimler ve verilen fikirlere dayalı tek cümlelik tanımlar.',
      'SADECE geçerli JSON döndürün: {{json}}',
    ],
    station: [
      'Nodus Immersion istasyonunun rehberisiniz: tek bir alt soru üzerine, okuyucunun ~25–30 dakikalık çalışmayla gerçekten uzmanlaşacağı TAM BİR DERS. Yüzeysel özetler yazmayın.',
      '{{language}} dilinde yazın.',
      'Şu blokları üretin:',
      '1) "context": alt soruyu 100–160 kelimeyle konumlandırın: konu içindeki önemi, neyin söz konusu olduğu ve okuyucunun bu istasyonda ne araması gerektiği.',
      '2) "synthesis": ana dersi, yoğun ve bağlantılı paragraflarla 600–900 Markdown kelimesi olarak yazın (gerekirse 2–3 alt bölüm için ### kullanın). Sürekli bir sav kurun: her konumu sunun, diğerleriyle karşılaştırın, nüansları, gelişimi ve sonuçları belirtin. Her önemli iddia menüdeki citation alanıyla TAM olarak [Yazar (yıl)](nodus://idea/<id>) veya [Yazar, yıl, s. N](nodus://passage/<id>) alıntısını taşımalıdır. Destekleyebildiğiniz TÜM fikirleri birleştirin.',
      '3) "citations": yönlendirilmiş okuma. Bir uzmanın ezbere alıntılayacağı 3–5 menü pasajını seçin. Her biri için "whyItMatters" (neden vazgeçilmez olduğunu belirten bir cümle) ve "commentary" (dilinde neye dikkat edileceğini, neyi açığa çıkardığını ve dersin savını nasıl desteklediğini veya karmaşıklaştırdığını ÖĞRETEN 80–140 kelime) yazın. Pasaj metnini KOPYALAMAYIN: yalnızca id’sini verin.',
      '4) "positions": bu alt soruda kendi sesi olan her yazar için, diğerlerinden ayıran 1–2 net cümlelik konumunu yazın. Yalnızca verilen yazarları kullanın.',
      '5) "takeaways": okuyucunun bu istasyondan hatırlaması gereken 4–6 tam cümle (bir uzmanın sınavda vereceği yanıt).',
      '{{quizRule}}',
      'YALNIZCA sağlanan materyali kullanın. Eser, yazar, sayfa veya alıntı uydurmayın.',
      'SADECE geçerli JSON döndürün: {{json}}',
    ],
    contrasts: [
      'Nodus Immersion modunun karşılaştırma matrisini oluşturuyorsunuz: yazarlar × alt sorular.',
      '{{language}} dilinde yazın.',
      'Her satır ve yazar için, yalnızca o satırda o yazara verilen fikirlere dayanarak, onu diğer yazarlardan ayıran TEK cümlelik tutum yazın.',
      'Bir yazarın satırda fikri yoksa "stance" değeri boş dize "" olsun. ASLA tutum uydurmayın.',
      'SADECE geçerli JSON döndürün: {{json}}',
    ],
    exam: [
      'Nodus Immersion modunun final sınavcısısınız. Okuyucu tüm istasyonları tamamladı: konuyu gerçekten öğrenip öğrenmediğini sınayın.',
      '{{language}} dilinde yazın.',
      'TÜM alt soruları kapsayan {{count}} soru yazın: "choice" (4 seçenek, correctIndex, explanation) ve "open" ("expected" ile) türlerini karıştırın. En iyi sorular tanımları tekrarlatmaz; yazarları ve konumları AYIRT ETMEYİ gerektirir.',
      'Okuyucunun tüm konuyu kendi sözleriyle açıklamasını isteyen son bir yönerge olarak "feynman" ekleyin.',
      'YALNIZCA verilen fikirleri kullanın. Her soruya ilgili ideaIds ekleyin.',
      'SADECE geçerli JSON döndürün: {{json}}',
    ],
  },
};

function renderImmersionPrompt(lines: readonly string[], values: Record<string, string | number>): string {
  return lines.join('\n').replace(/\{\{(count|language|quizRule|json)\}\}/g, (_match, key: string) => String(values[key] ?? ''));
}

function immersionQuizRule(language: PromptLanguage, enabled: boolean): string {
  if (language === 'es') return enabled ? '6) "quiz": 3 preguntas de recuperación activa: dos "choice" (4 opciones, correctIndex, explanation breve) y una "open" (con "expected": lo que debe recuperar una respuesta sólida). Las mejores preguntas obligan a distinguir autores y posiciones. Incluye ideaIds relevantes.' : '6) "quiz": [] (el usuario ha desactivado las preguntas).';
  if (language === 'en') return enabled ? '6) "quiz": 3 active-recall questions: two "choice" questions (4 options, correctIndex, brief explanation) and one "open" question (with "expected": what a strong answer must recall). The best questions require distinguishing authors and positions. Include relevant ideaIds.' : '6) "quiz": [] (the user has disabled questions).';
  if (language === 'fr') return enabled ? '6) "quiz" : 3 questions de rappel actif : deux questions "choice" (4 options, correctIndex, explication brève) et une question "open" (avec "expected" : ce qu’une réponse solide doit retrouver). Les meilleures distinguent auteurs et positions. Incluez les ideaIds pertinents.' : '6) "quiz" : [] (l’utilisateur a désactivé les questions).';
  if (language === 'de') return enabled ? '6) "quiz": 3 Fragen zum aktiven Abruf: zwei "choice" (4 Optionen, correctIndex, kurze Erklärung) und eine "open" (mit "expected": was eine gute Antwort erinnern muss). Die besten Fragen verlangen die Unterscheidung von Autoren und Positionen. Fügen Sie relevante ideaIds ein.' : '6) "quiz": [] (der Benutzer hat die Fragen deaktiviert).';
  if (language === 'pt') return enabled ? '6) "quiz": 3 perguntas de recuperação ativa: duas "choice" (4 opções, correctIndex, explicação breve) e uma "open" (com "expected": o que uma resposta sólida deve recuperar). As melhores distinguem autores e posições. Inclui ideaIds relevantes.' : '6) "quiz": [] (o utilizador desativou as perguntas).';
  if (language === 'pt-BR') return enabled ? '6) "quiz": 3 perguntas de recuperação ativa: duas "choice" (4 opções, correctIndex, explicação breve) e uma "open" (com "expected": o que uma resposta sólida deve recuperar). As melhores exigem distinguir autores e posições. Inclua ideaIds relevantes.' : '6) "quiz": [] (o usuário desativou as perguntas).';
  if (language === 'it') return enabled ? '6) "quiz": 3 domande di recupero attivo: due "choice" (4 opzioni, correctIndex, spiegazione breve) e una "open" (con "expected": ciò che una risposta solida deve ricordare). Le migliori richiedono di distinguere autori e posizioni. Includi gli ideaIds pertinenti.' : '6) "quiz": [] (l’utente ha disattivato le domande).';
  return enabled ? '6) "quiz": 3 aktif hatırlama sorusu: ikisi "choice" (4 seçenek, correctIndex, kısa açıklama), biri "open" ("expected" ile: güçlü bir yanıtın hatırlaması gerekenler). En iyi sorular yazarları ve konumları ayırt etmeyi gerektirir. İlgili ideaIds değerlerini ekleyin.' : '6) "quiz": [] (kullanıcı soruları devre dışı bıraktı).';
}

export function immersionPromptPack(language: PromptLanguage = 'es'): ImmersionPromptPack {
  const lang = IMMERSION_PROMPT_LANGUAGES.includes(language) ? language : 'es';
  const text = PROMPT_TEXT[lang];
  return {
    curriculum: (input) => renderImmersionPrompt(text.curriculum, { count: input.stationCount, language: text.language, json: IMMERSION_JSON.curriculum }),
    panorama: (_input) => renderImmersionPrompt(text.panorama, { language: text.language, json: IMMERSION_JSON.panorama }),
    station: (input) => renderImmersionPrompt(text.station, { language: text.language, quizRule: immersionQuizRule(lang, input.includeQuiz), json: IMMERSION_JSON.station }),
    contrasts: (_input) => renderImmersionPrompt(text.contrasts, { language: text.language, json: IMMERSION_JSON.contrasts }),
    exam: (input) => renderImmersionPrompt(text.exam, { count: input.questionCount, language: text.language, json: IMMERSION_JSON.exam }),
  };
}

export const IMMERSION_PROMPT_PACKS = Object.fromEntries(
  IMMERSION_PROMPT_LANGUAGES.map((language) => [language, immersionPromptPack(language)])
) as Record<PromptLanguage, ImmersionPromptPack>;

function isCurriculum(v: unknown): v is CurriculumResult {
  return typeof v === 'object' && v !== null && Array.isArray((v as CurriculumResult).stations);
}

async function aiPlanCurriculum(input: CurriculumInput, model: ModelRef | null): Promise<CurriculumResult> {
  const system = immersionPromptPack(input.language).curriculum(input);
  const user = JSON.stringify(
    {
      tema: input.topic,
      idioma: input.language,
      estaciones_objetivo: input.stationCount,
      ideas: input.ideas,
      pasajes: input.passages,
      orientacion_de_obras: input.works,
      autores: input.authors,
      debates: input.debates,
    },
    null,
    2
  );
  return completeJson<CurriculumResult>({ system, user, temperature: 0.2, maxTokens: 9000 }, isCurriculum, model);
}

function isPanorama(v: unknown): v is PanoramaResult {
  return typeof v === 'object' && v !== null && typeof (v as PanoramaResult).overview === 'string';
}

async function aiWritePanorama(input: PanoramaInput, model: ModelRef | null): Promise<PanoramaResult> {
  const system = immersionPromptPack(input.language).panorama(input);
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
  const system = immersionPromptPack(input.language).station(input);
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
  const system = immersionPromptPack(input.language).contrasts(input);
  const user = JSON.stringify({ tema: input.topic, idioma: input.language, autores: input.authors, filas: input.rows }, null, 2);
  return completeJson<ContrastsResult>({ system, user, temperature: 0.2, maxTokens: 4000 }, isContrasts, model);
}

function isExam(v: unknown): v is ExamResult {
  return typeof v === 'object' && v !== null && Array.isArray((v as ExamResult).questions);
}

async function aiWriteExam(input: ExamInput, model: ModelRef | null): Promise<ExamResult> {
  const system = immersionPromptPack(input.language).exam(input);
  const user = JSON.stringify(
    { tema: input.topic, idioma: input.language, sub_preguntas: input.stationQuestions, ideas: input.ideas },
    null,
    2
  );
  return completeJson<ExamResult>({ system, user, temperature: 0.25, maxTokens: 4500 }, isExam, model);
}
