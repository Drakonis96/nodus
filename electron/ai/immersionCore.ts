import type {
  GraphData,
  ImmersionAuthorPosition,
  ImmersionBuildProgress,
  ImmersionCitation,
  ImmersionContrastRow,
  ImmersionContrasts,
  ImmersionExam,
  ImmersionFrontier,
  ImmersionIdeaRef,
  ImmersionKeyTerm,
  ImmersionPlan,
  ImmersionQuizQuestion,
  ImmersionRequest,
  ImmersionStation,
} from '@shared/types';

// ─────────────────────────────────────────────────────────────────────────────
// Pure orchestration core for Inmersión. This module has NO Electron / DB /
// AI-provider imports (only erased type imports), so the whole control flow —
// curriculum planning, station writing, citation policy, contrasts, exam and
// assembly — can be unit-tested with injected fakes. The AI/DB wiring lives in
// ./immersion.ts.
//
// Two invariants the whole feature stands on:
//   • Literal quotes NEVER come from the model. The model picks passage ids from
//     a menu; the quote text is copied from the material (i.e. the database).
//   • A model failure at any step degrades that step to structural content and
//     the session still completes end to end (stoppedReason records it).
// ─────────────────────────────────────────────────────────────────────────────

export const IMMERSION_LIMITS = {
  minStations: 3,
  maxStations: 24,
  ideasPerStation: 12,
  passagesPerStation: 6,
  positionsPerStation: 6,
  quizPerStation: 3,
  examQuestions: 8,
  keyTerms: 10,
  frontiers: 8,
  contrastAuthors: 8,
} as const;

/** Minutes each fixed block of the experience roughly takes. A station is a
 *  full mini-lesson (context → lesson → guided reading → positions → takeaways
 *  → quiz), so it carries real study time, not a skim. */
export const IMMERSION_TIME = {
  panorama: 15,
  station: 28,
  contrasts: 15,
  frontiers: 8,
  exam: 18,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Material (assembled by the wiring from embeddings + graph, no AI)
// ─────────────────────────────────────────────────────────────────────────────

export interface MaterialIdea {
  id: string;
  type: string;
  label: string;
  statement: string;
  score: number;
  themes: string[];
  authors: string[];
  works: { nodusId: string; title: string; year: number | null; zoteroKey: string | null }[];
}

export interface MaterialPassage {
  id: string;
  workId: string;
  workTitle: string;
  authors: string[];
  year: number | null;
  zoteroKey: string | null;
  pageLabel: string | null;
  /** Full stored chunk text, straight from the database. */
  text: string;
  score: number;
}

export interface MaterialWork {
  nodusId: string;
  title: string;
  authors: string[];
  year: number | null;
  zoteroKey: string | null;
  score: number;
  ideaCount: number;
}

export interface MaterialAuthor {
  authorId: string | null;
  name: string;
  ideaCount: number;
  workCount: number;
}

export interface MaterialEdge {
  id: string;
  source: string;
  target: string;
  type: string;
}

export interface MaterialDebate {
  edgeId: string;
  fromIdeaId: string;
  toIdeaId: string;
  fromLabel: string;
  toLabel: string;
  type: string;
}

export interface MaterialGap {
  id: string;
  kind: string;
  statement: string;
  workTitle: string | null;
  score: number;
}

export interface ImmersionMaterial {
  topic: string;
  embeddingAvailable: boolean;
  ideas: MaterialIdea[];
  passages: MaterialPassage[];
  works: MaterialWork[];
  authors: MaterialAuthor[];
  edges: MaterialEdge[];
  debates: MaterialDebate[];
  gaps: MaterialGap[];
  themes: string[];
  graph: GraphData;
}

// ─────────────────────────────────────────────────────────────────────────────
// Injected AI dependencies
// ─────────────────────────────────────────────────────────────────────────────

export interface CurriculumInput {
  topic: string;
  language: 'es' | 'en';
  stationCount: number;
  ideas: { id: string; label: string; statement: string; authors: string[]; themes: string[] }[];
  passages: { id: string; workTitle: string; pageLabel: string | null; excerpt: string }[];
  authors: string[];
  debates: { fromLabel: string; toLabel: string; type: string }[];
}

export interface CurriculumStation {
  id: string;
  title: string;
  question: string;
  ideaIds: string[];
  passageIds: string[];
}

export interface CurriculumResult {
  title: string;
  stations: CurriculumStation[];
}

export interface PanoramaInput {
  topic: string;
  language: 'es' | 'en';
  stationQuestions: string[];
  ideas: { id: string; label: string; statement: string; authors: string[]; citation: string }[];
  works: { id: string; title: string; authors: string[]; year: number | null; citation: string }[];
  debates: { fromLabel: string; toLabel: string }[];
}

export interface PanoramaResult {
  overview: string;
  keyTerms: ImmersionKeyTerm[];
}

export interface StationInput {
  topic: string;
  language: 'es' | 'en';
  title: string;
  question: string;
  includeQuiz: boolean;
  ideas: { id: string; label: string; statement: string; authors: string[]; citation: string }[];
  passages: { id: string; workTitle: string; authors: string[]; pageLabel: string | null; text: string; citation: string }[];
  authors: string[];
}

export interface StationResult {
  /** Why this sub-question matters inside the topic (framing, ~120 words). */
  context: string;
  /** The main lesson: a long, threaded essay with citations. */
  synthesis: string;
  /** Guided close reading: chosen passages + a commentary that teaches how to read each one. */
  citations: { passageId: string; whyItMatters: string; commentary?: string }[];
  positions: { author: string; position: string; ideaIds: string[] }[];
  /** 4-6 sentences the reader must retain from this station. */
  takeaways: string[];
  quiz: {
    kind: 'choice' | 'open';
    question: string;
    options?: string[];
    correctIndex?: number;
    explanation?: string;
    expected?: string;
    ideaIds?: string[];
  }[];
}

export interface ContrastsInput {
  topic: string;
  language: 'es' | 'en';
  authors: string[];
  rows: {
    stationId: string;
    question: string;
    ideasByAuthor: Record<string, { id: string; label: string; statement: string }[]>;
  }[];
}

export interface ContrastsResult {
  rows: { stationId: string; cells: { author: string; stance: string }[] }[];
}

export interface ExamInput {
  topic: string;
  language: 'es' | 'en';
  stationQuestions: string[];
  ideas: { id: string; label: string; statement: string; authors: string[] }[];
  questionCount: number;
}

export interface ExamResult {
  questions: StationResult['quiz'];
  feynman: string;
}

export interface ImmersionDeps {
  buildMaterial(topic: string): Promise<ImmersionMaterial>;
  planCurriculum(input: CurriculumInput): Promise<CurriculumResult>;
  writePanorama(input: PanoramaInput): Promise<PanoramaResult>;
  writeStation(input: StationInput): Promise<StationResult>;
  writeContrasts(input: ContrastsInput): Promise<ContrastsResult>;
  writeExam(input: ExamInput): Promise<ExamResult>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestration
// ─────────────────────────────────────────────────────────────────────────────

type ProgressFn = (p: ImmersionBuildProgress) => void;

/** Target number of guided stations for the chosen depth and the material.
 *
 *  Depth scales with the budget, anchored on the three presets and interpolated
 *  in between: ~6 stations for a quick pass (90 min), ~12 for an afternoon
 *  (150 min), ~20 for a deep dive (240 min). This is a TARGET the planner aims
 *  for — the model may plan somewhat fewer or more when the topic warrants it,
 *  including several consecutive stations that deepen the same thread. */
export function resolveStationCount(minutes: number, ideaCount: number): number {
  const byTime = Math.round(((minutes - 90) * 14) / 150) + 6;
  // Each station still needs its own distinct material to be worth a stop.
  const byMaterial = Math.floor(ideaCount / 3);
  return clamp(
    Math.min(byTime, Math.max(IMMERSION_LIMITS.minStations, byMaterial)),
    IMMERSION_LIMITS.minStations,
    IMMERSION_LIMITS.maxStations
  );
}

export async function orchestrateImmersion(
  request: ImmersionRequest,
  deps: ImmersionDeps,
  onProgress?: ProgressFn
): Promise<ImmersionPlan> {
  const language: 'es' | 'en' = request.language === 'en' ? 'en' : 'es';
  const msg = labels(language);
  const emit: ProgressFn = (p) => onProgress?.(p);
  const degradations: string[] = [];

  emit({ phase: 'material', message: msg.material });
  const material = await deps.buildMaterial(request.topic);
  if (material.ideas.length === 0) {
    throw new Error(msg.noMaterial);
  }

  const stationCount = resolveStationCount(request.minutes, material.ideas.length);

  // ── Curriculum ─────────────────────────────────────────────────────────────
  emit({ phase: 'curriculum', message: msg.curriculum });
  let curriculum: CurriculumResult;
  try {
    curriculum = normalizeCurriculum(
      await deps.planCurriculum(curriculumInput(request.topic, language, stationCount, material)),
      material,
      stationCount,
      request.topic
    );
  } catch {
    degradations.push(msg.degradedCurriculum);
    curriculum = fallbackCurriculum(request.topic, material, stationCount);
  }

  // ── Panorama ───────────────────────────────────────────────────────────────
  emit({ phase: 'panorama', message: msg.panorama });
  const catalog = buildCitationCatalog(material);
  const citationLabels = buildCitationLabels(material);
  let panorama: PanoramaResult;
  try {
    panorama = await deps.writePanorama(panoramaInput(request.topic, language, curriculum, material));
    panorama = {
      overview:
        applyCitationPolicy(normalizeBareCitations(cleanStr(panorama.overview, ''), citationLabels), catalog) ||
        fallbackOverview(request.topic, material, msg),
      keyTerms: normalizeKeyTerms(panorama.keyTerms),
    };
  } catch {
    degradations.push(msg.degradedPanorama);
    panorama = { overview: fallbackOverview(request.topic, material, msg), keyTerms: fallbackKeyTerms(material) };
  }

  // ── Stations ───────────────────────────────────────────────────────────────
  const stations: ImmersionStation[] = [];
  for (let i = 0; i < curriculum.stations.length; i++) {
    const spec = curriculum.stations[i];
    emit({
      phase: 'station',
      message: msg.station,
      stationIndex: i + 1,
      stationTotal: curriculum.stations.length,
      stationTitle: spec.title,
    });
    const input = stationInput(request, language, spec, material);
    let result: StationResult;
    try {
      result = await deps.writeStation(input);
    } catch {
      degradations.push(`${msg.degradedStation} «${spec.title}»`);
      result = fallbackStation(input);
    }
    stations.push(buildStation(spec, result, input, material, catalog, citationLabels, request.includeQuiz, i));
  }

  // ── Contrasts ──────────────────────────────────────────────────────────────
  emit({ phase: 'contrasts', message: msg.contrasts });
  let contrasts: ImmersionContrasts;
  try {
    contrasts = normalizeContrasts(
      await deps.writeContrasts(contrastsInput(request.topic, language, stations, material)),
      stations,
      material
    );
  } catch {
    degradations.push(msg.degradedContrasts);
    contrasts = fallbackContrasts(stations, material);
  }

  // ── Frontiers (pure, no AI) ────────────────────────────────────────────────
  emit({ phase: 'frontiers', message: msg.frontiers });
  const frontiers = buildFrontiers(material, stations, msg);

  // ── Exam ───────────────────────────────────────────────────────────────────
  emit({ phase: 'exam', message: msg.exam });
  let exam: ImmersionExam;
  if (!request.includeQuiz) {
    exam = { questions: [], feynman: msg.feynman(request.topic) };
  } else {
    try {
      const result = await deps.writeExam(examInput(request.topic, language, stations, material));
      exam = {
        questions: normalizeQuiz(result.questions, material, 'exam', IMMERSION_LIMITS.examQuestions),
        feynman: cleanStr(result.feynman, msg.feynman(request.topic)),
      };
    } catch {
      degradations.push(msg.degradedExam);
      exam = fallbackExam(stations, request.topic, msg);
    }
    if (exam.questions.length === 0) exam = fallbackExam(stations, request.topic, msg);
  }

  // ── Assembly ───────────────────────────────────────────────────────────────
  emit({ phase: 'assembling', message: msg.assembling });
  const coveredIdeaIds = new Set(stations.flatMap((s) => s.ideaIds));
  const ideaIndex: ImmersionIdeaRef[] = material.ideas
    .filter((idea) => coveredIdeaIds.has(idea.id))
    .map((idea) => ({
      id: idea.id,
      label: idea.label,
      statement: idea.statement,
      authors: idea.authors,
      workTitles: idea.works.map((w) => w.title),
    }));

  const citationsTotal = stations.reduce((acc, s) => acc + s.citations.length, 0);
  const quizTotal = stations.reduce((acc, s) => acc + s.quiz.length, 0) + exam.questions.length;

  const plan: ImmersionPlan = {
    topic: request.topic,
    title: curriculum.title || request.topic,
    language,
    minutes: request.minutes,
    generatedAt: new Date().toISOString(),
    model: request.model ?? null,
    overview: panorama.overview,
    keyTerms: panorama.keyTerms,
    stations,
    contrasts,
    frontiers,
    exam,
    graph: material.graph,
    ideaIndex,
    stats: {
      stations: stations.length,
      ideas: coveredIdeaIds.size,
      works: material.works.length,
      authors: material.authors.length,
      citations: citationsTotal,
      quizQuestions: quizTotal,
    },
    stoppedReason: degradations.length ? degradations.join(' · ') : null,
  };

  emit({ phase: 'done', message: msg.done });
  return plan;
}

// ─────────────────────────────────────────────────────────────────────────────
// Input builders
// ─────────────────────────────────────────────────────────────────────────────

function curriculumInput(topic: string, language: 'es' | 'en', stationCount: number, material: ImmersionMaterial): CurriculumInput {
  // A longer route needs more raw material to distribute; the planner sees a
  // generous slice so it can build coherent, deepening threads across stations.
  return {
    topic,
    language,
    stationCount,
    ideas: material.ideas.slice(0, 90).map((i) => ({
      id: i.id,
      label: i.label,
      statement: clip(i.statement, 240),
      authors: i.authors.slice(0, 4),
      themes: i.themes.slice(0, 4),
    })),
    passages: material.passages.slice(0, 32).map((p) => ({
      id: p.id,
      workTitle: p.workTitle,
      pageLabel: p.pageLabel,
      excerpt: clip(p.text, 260),
    })),
    authors: material.authors.slice(0, 20).map((a) => a.name),
    debates: material.debates.slice(0, 14).map((d) => ({ fromLabel: d.fromLabel, toLabel: d.toLabel, type: d.type })),
  };
}

function panoramaInput(topic: string, language: 'es' | 'en', curriculum: CurriculumResult, material: ImmersionMaterial): PanoramaInput {
  return {
    topic,
    language,
    stationQuestions: curriculum.stations.map((s) => s.question),
    ideas: material.ideas.slice(0, 30).map((i) => ({
      id: i.id,
      label: i.label,
      statement: clip(i.statement, 220),
      authors: i.authors.slice(0, 4),
      citation: `nodus://idea/${i.id}`,
    })),
    works: material.works.slice(0, 20).map((w) => ({
      id: w.nodusId,
      title: w.title,
      authors: w.authors.slice(0, 4),
      year: w.year,
      citation: `nodus://work/${w.nodusId}`,
    })),
    debates: material.debates.slice(0, 8).map((d) => ({ fromLabel: d.fromLabel, toLabel: d.toLabel })),
  };
}

function stationInput(
  request: ImmersionRequest,
  language: 'es' | 'en',
  spec: CurriculumStation,
  material: ImmersionMaterial
): StationInput {
  const ideaById = new Map(material.ideas.map((i) => [i.id, i] as const));
  const passageById = new Map(material.passages.map((p) => [p.id, p] as const));
  const ideas = spec.ideaIds
    .map((id) => ideaById.get(id))
    .filter((i): i is MaterialIdea => Boolean(i))
    .slice(0, IMMERSION_LIMITS.ideasPerStation);
  const passages = spec.passageIds
    .map((id) => passageById.get(id))
    .filter((p): p is MaterialPassage => Boolean(p))
    .slice(0, IMMERSION_LIMITS.passagesPerStation + 2);
  const authors = [...new Set(ideas.flatMap((i) => i.authors))].slice(0, IMMERSION_LIMITS.positionsPerStation + 2);
  return {
    topic: request.topic,
    language,
    title: spec.title,
    question: spec.question,
    includeQuiz: request.includeQuiz,
    ideas: ideas.map((i) => ({
      id: i.id,
      label: i.label,
      statement: i.statement,
      authors: i.authors.slice(0, 4),
      citation: `nodus://idea/${i.id}`,
    })),
    passages: passages.map((p) => ({
      id: p.id,
      workTitle: p.workTitle,
      authors: p.authors.slice(0, 4),
      pageLabel: p.pageLabel,
      text: clip(p.text, 1400),
      citation: `nodus://passage/${encodeURIComponent(p.id)}`,
    })),
    authors,
  };
}

function contrastsInput(topic: string, language: 'es' | 'en', stations: ImmersionStation[], material: ImmersionMaterial): ContrastsInput {
  const authors = topAuthors(material);
  const ideaById = new Map(material.ideas.map((i) => [i.id, i] as const));
  return {
    topic,
    language,
    authors: authors.map((a) => a.name),
    rows: stations.map((station) => {
      const ideasByAuthor: Record<string, { id: string; label: string; statement: string }[]> = {};
      for (const author of authors) {
        const ideas = station.ideaIds
          .map((id) => ideaById.get(id))
          .filter((i): i is MaterialIdea => Boolean(i) && i!.authors.includes(author.name))
          .slice(0, 4)
          .map((i) => ({ id: i.id, label: i.label, statement: clip(i.statement, 200) }));
        if (ideas.length) ideasByAuthor[author.name] = ideas;
      }
      return { stationId: station.id, question: station.question, ideasByAuthor };
    }),
  };
}

function examInput(topic: string, language: 'es' | 'en', stations: ImmersionStation[], material: ImmersionMaterial): ExamInput {
  const covered = new Set(stations.flatMap((s) => s.ideaIds));
  return {
    topic,
    language,
    stationQuestions: stations.map((s) => s.question),
    ideas: material.ideas
      .filter((i) => covered.has(i.id))
      .slice(0, 40)
      .map((i) => ({ id: i.id, label: i.label, statement: clip(i.statement, 220), authors: i.authors.slice(0, 4) })),
    questionCount: IMMERSION_LIMITS.examQuestions,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalization + validation (everything the model returns is distrusted)
// ─────────────────────────────────────────────────────────────────────────────

function normalizeCurriculum(
  result: CurriculumResult,
  material: ImmersionMaterial,
  stationCount: number,
  topic: string
): CurriculumResult {
  const ideaIds = new Set(material.ideas.map((i) => i.id));
  const passageIds = new Set(material.passages.map((p) => p.id));
  const stations = (Array.isArray(result.stations) ? result.stations : [])
    .map((s, i) => ({
      id: cleanStr(s.id, `st-${i + 1}`),
      title: cleanStr(s.title, ''),
      question: cleanStr(s.question, ''),
      ideaIds: strList(s.ideaIds).filter((id) => ideaIds.has(id)),
      passageIds: strList(s.passageIds).filter((id) => passageIds.has(id)),
    }))
    .filter((s) => s.title && s.question && s.ideaIds.length > 0)
    // The planner is given a target but keeps discretion over the exact count;
    // only the hard ceiling is enforced here so a rich topic can breathe.
    .slice(0, IMMERSION_LIMITS.maxStations);
  if (stations.length < IMMERSION_LIMITS.minStations) {
    return fallbackCurriculum(topic, material, stationCount);
  }
  assignOrphans(stations, material);
  return { title: cleanStr(result.title, topic), stations };
}

/** Spread strong unassigned ideas and passages across stations so nothing key is dropped. */
function assignOrphans(stations: CurriculumStation[], material: ImmersionMaterial): void {
  const assignedIdeas = new Set(stations.flatMap((s) => s.ideaIds));
  const strongIdeas = material.ideas.slice(0, stations.length * 6).filter((i) => !assignedIdeas.has(i.id));
  for (let i = 0; i < strongIdeas.length; i++) {
    const station = stations[i % stations.length];
    if (station.ideaIds.length < IMMERSION_LIMITS.ideasPerStation) station.ideaIds.push(strongIdeas[i].id);
  }
  const assignedPassages = new Set(stations.flatMap((s) => s.passageIds));
  const ideaWorkByStation = stations.map((s) => {
    const works = new Set<string>();
    const ideaById = new Map(material.ideas.map((i) => [i.id, i] as const));
    for (const id of s.ideaIds) for (const w of ideaById.get(id)?.works ?? []) works.add(w.nodusId);
    return works;
  });
  for (const passage of material.passages) {
    if (assignedPassages.has(passage.id)) continue;
    // Attach the passage to the least-served station whose ideas share its work,
    // so quotes spread across the route instead of piling on the first stops.
    let best = -1;
    for (let i = 0; i < stations.length; i++) {
      if (!ideaWorkByStation[i].has(passage.workId)) continue;
      if (stations[i].passageIds.length >= IMMERSION_LIMITS.passagesPerStation + 2) continue;
      if (best === -1 || stations[i].passageIds.length < stations[best].passageIds.length) best = i;
    }
    if (best >= 0) stations[best].passageIds.push(passage.id);
  }
}

export function fallbackCurriculum(topic: string, material: ImmersionMaterial, stationCount: number): CurriculumResult {
  // Group ideas by dominant theme; themes with the most relevant ideas become stations.
  const byTheme = new Map<string, MaterialIdea[]>();
  for (const idea of material.ideas) {
    const theme = idea.themes[0] ?? '';
    const list = byTheme.get(theme) ?? [];
    list.push(idea);
    byTheme.set(theme, list);
  }
  const groups = [...byTheme.entries()].sort((a, b) => b[1].length - a[1].length);
  const stations: CurriculumStation[] = [];
  for (let i = 0; i < Math.min(stationCount, groups.length); i++) {
    const [theme, ideas] = groups[i];
    const title = theme || topic;
    stations.push({
      id: `st-${i + 1}`,
      title,
      question: `¿Qué sostiene el corpus sobre «${title}» en relación con ${topic}?`,
      ideaIds: ideas.slice(0, IMMERSION_LIMITS.ideasPerStation).map((idea) => idea.id),
      passageIds: [],
    });
  }
  // Too few themes: chunk the ranked ideas evenly instead.
  while (stations.length < Math.min(stationCount, Math.ceil(material.ideas.length / 4))) {
    const index = stations.length;
    const chunk = material.ideas.filter((_, i) => i % stationCount === index).slice(0, IMMERSION_LIMITS.ideasPerStation);
    if (chunk.length === 0) break;
    stations.push({
      id: `st-${index + 1}`,
      title: chunk[0].label,
      question: `¿Qué papel juega «${chunk[0].label}» dentro de ${topic}?`,
      ideaIds: chunk.map((idea) => idea.id),
      passageIds: [],
    });
  }
  assignOrphans(stations, material);
  return { title: topic, stations };
}

function buildStation(
  spec: CurriculumStation,
  result: StationResult,
  input: StationInput,
  material: ImmersionMaterial,
  catalog: Set<string>,
  citationLabels: Map<string, string>,
  includeQuiz: boolean,
  index: number
): ImmersionStation {
  const passageById = new Map(material.passages.map((p) => [p.id, p] as const));
  const menuIds = new Set(input.passages.map((p) => p.id));

  // Citations: model may only pick from the station menu; quote text is copied from material.
  const picked = (Array.isArray(result.citations) ? result.citations : [])
    .filter((c) => c && typeof c.passageId === 'string' && menuIds.has(c.passageId))
    .slice(0, IMMERSION_LIMITS.passagesPerStation);
  const chosen = picked.length
    ? picked
    : input.passages
        .slice(0, IMMERSION_LIMITS.passagesPerStation)
        .map((p) => ({ passageId: p.id, whyItMatters: '', commentary: '' }));
  const citations: ImmersionCitation[] = chosen
    .map((c) => {
      const p = passageById.get(c.passageId);
      if (!p) return null;
      return {
        passageId: p.id,
        workId: p.workId,
        workTitle: p.workTitle,
        authors: p.authors,
        year: p.year,
        zoteroKey: p.zoteroKey,
        pageLabel: p.pageLabel,
        text: p.text,
        whyItMatters: cleanStr(c.whyItMatters, ''),
        commentary: cleanStr(c.commentary, ''),
      };
    })
    .filter((c): c is ImmersionCitation => c !== null);

  const knownAuthors = new Set(material.authors.map((a) => a.name));
  const authorIdByName = new Map(material.authors.map((a) => [a.name, a.authorId] as const));
  const stationIdeaIds = new Set(input.ideas.map((i) => i.id));
  const positions: ImmersionAuthorPosition[] = (Array.isArray(result.positions) ? result.positions : [])
    .filter((p) => p && typeof p.author === 'string' && typeof p.position === 'string' && p.position.trim())
    .map((p) => ({
      authorId: authorIdByName.get(p.author) ?? null,
      name: p.author,
      position: p.position.trim(),
      ideaIds: strList(p.ideaIds).filter((id) => stationIdeaIds.has(id)),
    }))
    .filter((p) => knownAuthors.has(p.name))
    .slice(0, IMMERSION_LIMITS.positionsPerStation);

  const synthesis =
    applyCitationPolicy(normalizeBareCitations(cleanStr(result.synthesis, ''), citationLabels), catalog) ||
    input.ideas.map((i) => `- **${i.label}**: ${i.statement}`).join('\n');

  return {
    id: spec.id || `st-${index + 1}`,
    title: spec.title,
    question: spec.question,
    minutes: IMMERSION_TIME.station,
    context: applyCitationPolicy(normalizeBareCitations(cleanStr(result.context, ''), citationLabels), catalog),
    synthesis,
    citations,
    positions,
    takeaways: strList(result.takeaways).slice(0, 6),
    ideaIds: input.ideas.map((i) => i.id),
    quiz: includeQuiz ? normalizeQuiz(result.quiz, material, spec.id || `st-${index + 1}`, IMMERSION_LIMITS.quizPerStation) : [],
  };
}

export function fallbackStation(input: StationInput): StationResult {
  return {
    context: `Esta estación responde: ${input.question}`,
    synthesis: input.ideas.map((i) => `- **${i.label}**: ${i.statement} ([${i.authors[0] ?? 'fuente'}](${i.citation}))`).join('\n'),
    citations: input.passages.slice(0, IMMERSION_LIMITS.passagesPerStation).map((p) => ({ passageId: p.id, whyItMatters: '' })),
    positions: [],
    takeaways: input.ideas.slice(0, 5).map((i) => i.statement),
    quiz: input.includeQuiz
      ? input.ideas.slice(0, IMMERSION_LIMITS.quizPerStation).map((i) => ({
          kind: 'open' as const,
          question: `¿Qué sostiene el corpus sobre «${i.label}» y quién lo defiende?`,
          expected: i.statement,
          ideaIds: [i.id],
        }))
      : [],
  };
}

export function normalizeQuiz(
  items: StationResult['quiz'],
  material: ImmersionMaterial,
  prefix: string,
  max: number
): ImmersionQuizQuestion[] {
  const ideaIds = new Set(material.ideas.map((i) => i.id));
  const out: ImmersionQuizQuestion[] = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item.question !== 'string' || !item.question.trim()) continue;
    const kind = item.kind === 'choice' ? 'choice' : 'open';
    if (kind === 'choice') {
      const options = strList(item.options).slice(0, 4);
      const correct = Number(item.correctIndex);
      if (options.length < 2 || !Number.isInteger(correct) || correct < 0 || correct >= options.length) continue;
      out.push({
        id: `${prefix}-q${out.length + 1}`,
        kind,
        question: item.question.trim(),
        options,
        correctIndex: correct,
        explanation: cleanStr(item.explanation, ''),
        expected: '',
        ideaIds: strList(item.ideaIds).filter((id) => ideaIds.has(id)),
      });
    } else {
      const expected = cleanStr(item.expected, '');
      if (!expected) continue;
      out.push({
        id: `${prefix}-q${out.length + 1}`,
        kind,
        question: item.question.trim(),
        options: [],
        correctIndex: null,
        explanation: '',
        expected,
        ideaIds: strList(item.ideaIds).filter((id) => ideaIds.has(id)),
      });
    }
    if (out.length >= max) break;
  }
  return out;
}

function normalizeContrasts(result: ContrastsResult, stations: ImmersionStation[], material: ImmersionMaterial): ImmersionContrasts {
  const authors = topAuthors(material);
  const authorNames = authors.map((a) => a.name);
  const authorIdByName = new Map(material.authors.map((a) => [a.name, a.authorId] as const));
  const stationById = new Map(stations.map((s) => [s.id, s] as const));
  const rowsIn = Array.isArray(result.rows) ? result.rows : [];
  const rowByStation = new Map(rowsIn.map((r) => [r.stationId, r] as const));
  const rows: ImmersionContrastRow[] = stations.map((station) => {
    const row = rowByStation.get(station.id);
    const cellByAuthor = new Map((row?.cells ?? []).map((c) => [c.author, cleanStr(c.stance, '')] as const));
    return {
      stationId: station.id,
      question: station.question,
      cells: authorNames.map((name) => ({
        author: name,
        authorId: authorIdByName.get(name) ?? null,
        stance: cellByAuthor.get(name) ?? '',
        ideaIds: ideasOfAuthorInStation(name, station, material),
      })),
    };
  });
  // Sanity: every station must have a row; authors validated by construction.
  if (rows.length !== stations.length || !stationById) return fallbackContrasts(stations, material);
  return { authors: authorNames, rows };
}

export function fallbackContrasts(stations: ImmersionStation[], material: ImmersionMaterial): ImmersionContrasts {
  const authors = topAuthors(material);
  const ideaById = new Map(material.ideas.map((i) => [i.id, i] as const));
  const authorIdByName = new Map(material.authors.map((a) => [a.name, a.authorId] as const));
  return {
    authors: authors.map((a) => a.name),
    rows: stations.map((station) => ({
      stationId: station.id,
      question: station.question,
      cells: authors.map((author) => {
        const ideaIds = ideasOfAuthorInStation(author.name, station, material);
        const first = ideaIds.length ? ideaById.get(ideaIds[0]) : undefined;
        return {
          author: author.name,
          authorId: authorIdByName.get(author.name) ?? null,
          stance: first ? clip(first.statement, 180) : '',
          ideaIds,
        };
      }),
    })),
  };
}

function ideasOfAuthorInStation(author: string, station: ImmersionStation, material: ImmersionMaterial): string[] {
  const ideaById = new Map(material.ideas.map((i) => [i.id, i] as const));
  return station.ideaIds.filter((id) => ideaById.get(id)?.authors.includes(author));
}

function topAuthors(material: ImmersionMaterial): MaterialAuthor[] {
  return [...material.authors].sort((a, b) => b.ideaCount - a.ideaCount).slice(0, IMMERSION_LIMITS.contrastAuthors);
}

export function buildFrontiers(
  material: ImmersionMaterial,
  stations: ImmersionStation[],
  msg: ReturnType<typeof labels>
): ImmersionFrontier[] {
  const out: ImmersionFrontier[] = material.gaps.slice(0, IMMERSION_LIMITS.frontiers).map((gap) => ({
    kind: 'gap' as const,
    statement: gap.statement,
    detail: msg.gapDetail(gap.kind),
    workTitle: gap.workTitle,
  }));
  // Ideas relevant to the topic that no station covered → honest thin-coverage flag.
  const covered = new Set(stations.flatMap((s) => s.ideaIds));
  const uncovered = material.ideas.filter((i) => !covered.has(i.id));
  if (uncovered.length > 0 && out.length < IMMERSION_LIMITS.frontiers) {
    out.push({
      kind: 'thin_coverage',
      statement: msg.thinCoverage(uncovered.length),
      detail: uncovered
        .slice(0, 5)
        .map((i) => i.label)
        .join(' · '),
      workTitle: null,
    });
  }
  return out;
}

export function fallbackExam(stations: ImmersionStation[], topic: string, msg: ReturnType<typeof labels>): ImmersionExam {
  const questions = stations
    .flatMap((s) => s.quiz)
    .slice(0, IMMERSION_LIMITS.examQuestions)
    .map((q, i) => ({ ...q, id: `exam-q${i + 1}` }));
  return { questions, feynman: msg.feynman(topic) };
}

function fallbackOverview(topic: string, material: ImmersionMaterial, msg: ReturnType<typeof labels>): string {
  const lines = [
    `## ${msg.overviewTitle(topic)}`,
    '',
    msg.overviewIntro(material.ideas.length, material.works.length, material.authors.length),
    '',
    ...material.ideas.slice(0, 10).map((i) => `- **${i.label}** (${i.authors.slice(0, 2).join(', ') || '—'}): ${clip(i.statement, 200)} ([→](nodus://idea/${i.id}))`),
  ];
  return lines.join('\n');
}

function fallbackKeyTerms(material: ImmersionMaterial): ImmersionKeyTerm[] {
  return material.ideas
    .filter((i) => i.type === 'construct' || i.type === 'framework')
    .slice(0, IMMERSION_LIMITS.keyTerms)
    .map((i) => ({ term: i.label, definition: clip(i.statement, 200) }));
}

function normalizeKeyTerms(items: unknown): ImmersionKeyTerm[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((t): t is ImmersionKeyTerm => Boolean(t) && typeof (t as ImmersionKeyTerm).term === 'string' && typeof (t as ImmersionKeyTerm).definition === 'string')
    .map((t) => ({ term: t.term.trim(), definition: t.definition.trim() }))
    .filter((t) => t.term && t.definition)
    .slice(0, IMMERSION_LIMITS.keyTerms);
}

// ─────────────────────────────────────────────────────────────────────────────
// Citation policy — a nodus:// link that is not in the material catalog is
// hallucinated and gets stripped down to its plain label.
// ─────────────────────────────────────────────────────────────────────────────

export function buildCitationCatalog(material: ImmersionMaterial): Set<string> {
  const catalog = new Set<string>();
  for (const idea of material.ideas) catalog.add(`nodus://idea/${idea.id}`);
  for (const work of material.works) catalog.add(`nodus://work/${work.nodusId}`);
  for (const passage of material.passages) {
    catalog.add(`nodus://passage/${passage.id}`);
    catalog.add(`nodus://passage/${encodeURIComponent(passage.id)}`);
  }
  return catalog;
}

/** Human labels for every citable url, used to repair citations the model wrote bare. */
export function buildCitationLabels(material: ImmersionMaterial): Map<string, string> {
  const labels = new Map<string, string>();
  for (const idea of material.ideas) labels.set(`nodus://idea/${idea.id}`, idea.label);
  for (const work of material.works) {
    const surname = (work.authors[0] ?? '').split(',')[0].trim() || work.title;
    labels.set(`nodus://work/${work.nodusId}`, work.year != null ? `${surname} (${work.year})` : surname);
  }
  for (const passage of material.passages) {
    const surname = (passage.authors[0] ?? '').split(',')[0].trim() || passage.workTitle;
    const label = [surname, passage.year ?? '', passage.pageLabel ? `p. ${passage.pageLabel}` : '']
      .filter(Boolean)
      .join(', ');
    labels.set(`nodus://passage/${passage.id}`, label);
    labels.set(`nodus://passage/${encodeURIComponent(passage.id)}`, label);
  }
  return labels;
}

/**
 * Models sometimes emit citations as bare urls — `(nodus://idea/x)` or
 * `[Autor] (nodus://…)` with a space — which would reach the reader as raw text.
 * Repair both into proper Markdown links so the renderer shows citation chips.
 */
export function normalizeBareCitations(markdown: string, labels: Map<string, string>): string {
  // `[label] (url)` → `[label](url)` (stray space breaks the Markdown link).
  let out = markdown.replace(/\]\s+\(\s*(nodus:\/\/[^)\s]+)\s*\)/g, ']($1)');
  // Bare urls (not already a link target) get wrapped with their catalog label.
  out = out.replace(/(\]\()?(nodus:\/\/(?:idea|work|passage)\/[^\s)\]"',;.]+)/g, (full, prefix: string | undefined, url: string) => {
    if (prefix) return full;
    return `[${labels.get(url) ?? '→'}](${url})`;
  });
  return out;
}

export function applyCitationPolicy(markdown: string, catalog: Set<string>): string {
  return markdown.replace(/\[([^\]]*)\]\((nodus:\/\/[^)]+)\)/g, (full, label: string, url: string) => {
    return catalog.has(url) ? full : label;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clip(text: string, max: number): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trim()}…`;
}

function cleanStr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0) : [];
}

export function labels(language: 'es' | 'en') {
  if (language === 'en') {
    return {
      material: 'Mapping the topic territory…',
      curriculum: 'Designing the guided route…',
      panorama: 'Writing the panorama…',
      station: 'Writing station…',
      contrasts: 'Building the author contrast matrix…',
      frontiers: 'Charting the frontiers of the corpus…',
      exam: 'Preparing the final exam…',
      assembling: 'Assembling the immersion…',
      done: 'Immersion ready.',
      noMaterial: 'No relevant material found for this topic. Analyse more works or refine the topic.',
      degradedCurriculum: 'curriculum fell back to a structural plan',
      degradedPanorama: 'panorama fell back to structural content',
      degradedStation: 'a station fell back to structural content:',
      degradedContrasts: 'contrast matrix fell back to structural content',
      degradedExam: 'the exam fell back to station questions',
      overviewTitle: (topic: string) => `Panorama: ${topic}`,
      overviewIntro: (ideas: number, works: number, authors: number) =>
        `Your corpus holds ${ideas} relevant ideas across ${works} works by ${authors} authors on this topic. These are the strongest lines:`,
      gapDetail: (kind: string) => `Gap detected in the corpus (${kind}).`,
      thinCoverage: (n: number) => `${n} relevant ideas were left outside the guided stations.`,
      feynman: (topic: string) =>
        `Explain, in your own words and as if teaching a colleague, what the corpus knows about “${topic}”: the main positions, which author defends each one, and where they disagree.`,
    };
  }
  return {
    material: 'Cartografiando el territorio del tema…',
    curriculum: 'Diseñando la ruta guiada…',
    panorama: 'Redactando el panorama…',
    station: 'Redactando estación…',
    contrasts: 'Construyendo la matriz de contrastes…',
    frontiers: 'Trazando las fronteras del corpus…',
    exam: 'Preparando el examen final…',
    assembling: 'Ensamblando la inmersión…',
    done: 'Inmersión lista.',
    noMaterial: 'No hay material relevante para este tema. Analiza más obras o reformula el tema.',
    degradedCurriculum: 'el plan de estaciones usó la ruta estructural',
    degradedPanorama: 'el panorama usó contenido estructural',
    degradedStation: 'una estación usó contenido estructural:',
    degradedContrasts: 'la matriz de contrastes usó contenido estructural',
    degradedExam: 'el examen reutilizó preguntas de las estaciones',
    overviewTitle: (topic: string) => `Panorama: ${topic}`,
    overviewIntro: (ideas: number, works: number, authors: number) =>
      `Tu corpus contiene ${ideas} ideas relevantes en ${works} obras de ${authors} autores sobre este tema. Estas son las líneas más fuertes:`,
    gapDetail: (kind: string) => `Hueco detectado en el corpus (${kind}).`,
    thinCoverage: (n: number) => `${n} ideas relevantes quedaron fuera de las estaciones guiadas.`,
    feynman: (topic: string) =>
      `Explica, con tus palabras y como si se lo enseñaras a un colega, qué sabe el corpus sobre «${topic}»: las posiciones principales, qué autor defiende cada una y dónde discrepan.`,
  };
}
