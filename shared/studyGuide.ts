import type {
  DeepStatus,
  IdeaType,
  SourceType,
  StudyAuthorPlan,
  StudyGuidePhase,
  StudyGuidePlan,
  StudyKeyIdea,
  StudyProgressStatus,
  StudyRecommendedWork,
  SummaryStatus,
} from './types';

export interface StudyGuideIdeaInput {
  globalId: string;
  type: IdeaType;
  label: string;
  statement: string;
  workId: string;
  workTitle: string;
  role: 'principal' | 'secondary';
  confidence: number;
}

export interface StudyGuideWorkInput {
  nodusId: string;
  title: string;
  authors: string[];
  year: number | null;
  zoteroKey: string | null;
  read: boolean;
  sourceType: SourceType | null;
  deepStatus: DeepStatus;
  summaryStatus: SummaryStatus;
  ideaCount: number;
  principalIdeaCount: number;
  passageCount: number;
  summary: string | null;
  progressStatus?: StudyProgressStatus | null;
  semanticScore?: number;
}

export interface StudyGuideAuthorInput {
  authorId: string;
  name: string;
  fullName: string;
  workCount: number;
  ideaCount: number;
  relationCount: number;
  topThemes: string[];
  read: boolean;
  hasSynthesis: boolean;
  works: StudyGuideWorkInput[];
  keyIdeas: StudyGuideIdeaInput[];
  progressStatus?: StudyProgressStatus | null;
  progressNote?: string | null;
  semanticScore?: number;
}

export interface StudyGuideBuildInput {
  authors: StudyGuideAuthorInput[];
  objective?: string;
  sessionMinutes?: number;
  authorLimit?: number;
  worksPerAuthor?: number;
  includeCompleted?: boolean;
  semanticFocusAvailable?: boolean;
  semanticFocusUsed?: boolean;
  semanticFocusSummary?: string | null;
  generatedAt?: string;
}

const DEFAULT_SESSION_MINUTES = 45;
const DEFAULT_AUTHOR_LIMIT = 18;
const DEFAULT_WORKS_PER_AUTHOR = 4;

const STATUS_LABEL: Record<StudyProgressStatus, string> = {
  pending: 'pendiente',
  in_progress: 'en curso',
  understood: 'entendido',
  needs_full_read: 'requiere lectura completa',
  review: 'repaso',
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function compact(value: string, max = 150): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 3).trim()}...`;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function workScore(work: StudyGuideWorkInput): number {
  let score = 0;
  score += work.ideaCount * 8;
  score += work.principalIdeaCount * 6;
  score += Math.min(work.passageCount, 80) * 0.35;
  if (work.deepStatus === 'done') score += 18;
  if (work.summaryStatus === 'done') score += 8;
  if (work.zoteroKey) score += 6;
  if (!work.read) score += 4;
  if (work.progressStatus === 'needs_full_read') score += 12;
  if (work.progressStatus === 'understood') score -= 10;
  score += (work.semanticScore ?? 0) * 70;
  return Math.round(score);
}

function workReasons(work: StudyGuideWorkInput): string[] {
  const reasons: string[] = [];
  if (work.ideaCount > 0) reasons.push(`${work.ideaCount} idea(s) extraidas`);
  if (work.principalIdeaCount > 0) reasons.push(`${work.principalIdeaCount} idea(s) principales`);
  if (work.passageCount > 0) reasons.push(`${work.passageCount} pasaje(s) indexados`);
  if (work.summaryStatus === 'done') reasons.push('resumen disponible');
  if (work.zoteroKey) reasons.push('abrible en Zotero');
  if (!work.read) reasons.push('pendiente de lectura');
  if (work.semanticScore && work.semanticScore > 0.01) reasons.push('alineada con el objetivo');
  if (work.progressStatus) reasons.push(`estado: ${STATUS_LABEL[work.progressStatus]}`);
  return reasons.slice(0, 5);
}

function toRecommendedWork(work: StudyGuideWorkInput): StudyRecommendedWork {
  return {
    nodusId: work.nodusId,
    title: work.title,
    authors: work.authors,
    year: work.year,
    zoteroKey: work.zoteroKey,
    read: work.read,
    sourceType: work.sourceType,
    deepStatus: work.deepStatus,
    summaryStatus: work.summaryStatus,
    ideaCount: work.ideaCount,
    principalIdeaCount: work.principalIdeaCount,
    passageCount: work.passageCount,
    score: workScore(work),
    reasons: workReasons(work),
    progressStatus: work.progressStatus ?? null,
    summary: work.summary ? compact(work.summary, 260) : null,
  };
}

function authorScore(author: StudyGuideAuthorInput): number {
  const recommended = author.works.map(workScore).sort((a, b) => b - a);
  let score = 0;
  score += author.ideaCount * 7;
  score += author.relationCount * 12;
  score += author.workCount * 4;
  score += Math.min(author.topThemes.length, 8) * 6;
  score += recommended.slice(0, 3).reduce((sum, value) => sum + value * 0.35, 0);
  if (author.hasSynthesis) score += 10;
  if (author.read) score -= 6;
  if (author.progressStatus === 'understood') score -= 40;
  if (author.progressStatus === 'review') score += 16;
  if (author.progressStatus === 'needs_full_read') score += 20;
  if (author.progressStatus === 'in_progress') score += 8;
  score += (author.semanticScore ?? 0) * 95;
  return Math.round(score);
}

function keyIdeasFor(author: StudyGuideAuthorInput, max = 8): StudyKeyIdea[] {
  const seen = new Set<string>();
  const ordered = [...author.keyIdeas].sort(
    (a, b) =>
      (b.role === 'principal' ? 1 : 0) - (a.role === 'principal' ? 1 : 0) ||
      b.confidence - a.confidence ||
      a.label.localeCompare(b.label)
  );
  const out: StudyKeyIdea[] = [];
  for (const idea of ordered) {
    if (seen.has(idea.globalId)) continue;
    seen.add(idea.globalId);
    out.push({
      globalId: idea.globalId,
      type: idea.type,
      label: idea.label,
      statement: compact(idea.statement, 260),
      workId: idea.workId,
      workTitle: idea.workTitle,
    });
    if (out.length >= max) break;
  }
  return out;
}

function learningGoals(author: StudyGuideAuthorInput, works: StudyRecommendedWork[], ideas: StudyKeyIdea[]): string[] {
  const goals: string[] = [];
  if (author.topThemes.length) goals.push(`Situar al autor en ${author.topThemes.slice(0, 3).join(', ')}.`);
  if (ideas.length) goals.push(`Dominar sus ${Math.min(ideas.length, 6)} ideas mas centrales sin perder evidencia.`);
  if (author.relationCount > 0) goals.push(`Entender con quien dialoga, contradice o extiende dentro del grafo.`);
  if (works.length) goals.push(`Leer primero ${works[0].title}${works[0].year ? ` (${works[0].year})` : ''}.`);
  if (works.some((w) => w.passageCount > 0)) goals.push('Usar pasajes indexados para comprobar matices antes de citar.');
  if (goals.length === 0) goals.push('Analizar al menos una obra para convertir este autor en una ficha estudiable.');
  return goals.slice(0, 5);
}

function reviewQuestions(author: StudyGuideAuthorInput, ideas: StudyKeyIdea[]): string[] {
  const questions: string[] = [];
  if (ideas[0]) questions.push(`Explica la idea "${ideas[0].label}" sin mirar la ficha.`);
  if (ideas[1]) questions.push(`Relaciona "${ideas[0].label}" con "${ideas[1].label}".`);
  if (author.topThemes[0]) questions.push(`Que postura sostiene sobre ${author.topThemes[0]}?`);
  if (author.relationCount > 0) questions.push('Que autores cercanos lo apoyan, extienden o contradicen?');
  questions.push('Que obra abririas completa en Zotero si tuvieras que citarlo con fuerza?');
  return unique(questions).slice(0, 5);
}

function nextAction(author: StudyGuideAuthorInput, works: StudyRecommendedWork[]): string {
  if (author.ideaCount === 0) return 'Analiza ideas de sus obras antes de estudiarlo a fondo.';
  if (author.progressStatus === 'needs_full_read') return 'Abre en Zotero la obra prioritaria y lee el texto completo.';
  if (author.progressStatus === 'review') return 'Haz una ronda de repaso con preguntas y conexiones.';
  if (works.some((w) => w.zoteroKey && w.passageCount > 0)) return 'Genera una sesion tutor con pasajes y despues abre Zotero.';
  if (works.some((w) => w.zoteroKey)) return 'Empieza por la obra recomendada y abre Zotero desde la ficha.';
  return 'Genera una sesion tutor y revisa la evidencia disponible.';
}

function authorReasons(author: StudyGuideAuthorInput, works: StudyRecommendedWork[]): string[] {
  const reasons: string[] = [];
  if (author.ideaCount > 0) reasons.push(`${author.ideaCount} idea(s)`);
  if (author.relationCount > 0) reasons.push(`${author.relationCount} conexion(es) autorales`);
  if (author.topThemes.length) reasons.push(`temas: ${author.topThemes.slice(0, 3).join(', ')}`);
  if (works[0]) reasons.push(`obra inicial: ${works[0].title}`);
  if (author.semanticScore && author.semanticScore > 0.01) reasons.push('alta afinidad semantica con el objetivo');
  if (author.progressStatus) reasons.push(`estado: ${STATUS_LABEL[author.progressStatus]}`);
  return reasons.slice(0, 5);
}

function buildAuthorPlan(
  author: StudyGuideAuthorInput,
  rank: number,
  worksPerAuthor: number
): StudyAuthorPlan {
  const recommendedWorks = author.works
    .map(toRecommendedWork)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, worksPerAuthor);
  const keyIdeas = keyIdeasFor(author);
  const analyzedWorks = author.works.filter((work) => work.deepStatus === 'done').length;
  return {
    authorId: author.authorId,
    name: author.name,
    fullName: author.fullName,
    rank,
    score: authorScore(author),
    progressStatus: author.progressStatus ?? null,
    progressNote: author.progressNote ?? null,
    workCount: author.workCount,
    ideaCount: author.ideaCount,
    relationCount: author.relationCount,
    topThemes: author.topThemes,
    coverage: {
      analyzedWorks,
      totalWorks: author.works.length,
      fullTextWorks: author.works.filter((work) => work.passageCount > 0).length,
      zoteroLinkedWorks: author.works.filter((work) => Boolean(work.zoteroKey)).length,
      readWorks: author.works.filter((work) => work.read).length,
    },
    recommendedWorks,
    keyIdeas,
    learningGoals: learningGoals(author, recommendedWorks, keyIdeas),
    reviewQuestions: reviewQuestions(author, keyIdeas),
    reasons: authorReasons(author, recommendedWorks),
    nextAction: nextAction(author, recommendedWorks),
  };
}

function buildPhases(authors: StudyAuthorPlan[]): StudyGuidePhase[] {
  const top = authors.slice(0, 4).map((a) => a.authorId);
  const core = authors.slice(0, 12).map((a) => a.authorId);
  const contrasts = authors
    .filter((a) => a.relationCount > 0)
    .slice(0, 10)
    .map((a) => a.authorId);
  const fullRead = authors
    .filter((a) => a.recommendedWorks.some((w) => w.progressStatus === 'needs_full_read' || (!w.read && w.zoteroKey)))
    .slice(0, 8)
    .map((a) => a.authorId);
  const review = authors
    .filter((a) => a.progressStatus === 'review' || a.progressStatus === 'in_progress')
    .slice(0, 8)
    .map((a) => a.authorId);

  const phases: StudyGuidePhase[] = [
    {
      id: 'orientacion',
      title: 'Mapa general',
      objective: 'Primera vuelta por los autores que mas estructuran el corpus.',
      authorIds: top,
    },
    {
      id: 'autores',
      title: 'Dominio autor por autor',
      objective: 'Convertir cada ficha en tesis, ideas, obras y evidencia verificable.',
      authorIds: core,
    },
    {
      id: 'contrastes',
      title: 'Comparaciones y tensiones',
      objective: 'Leer autores conectados para entender apoyos, extensiones y contradicciones.',
      authorIds: contrasts,
    },
    {
      id: 'lectura_profunda',
      title: 'Lectura completa necesaria',
      objective: 'Obras que conviene abrir en Zotero porque sostienen muchas ideas o requieren matiz.',
      authorIds: fullRead,
    },
    {
      id: 'repaso',
      title: 'Repaso activo',
      objective: 'Autores en curso o marcados para revisar mediante preguntas tutor.',
      authorIds: review,
    },
  ];
  return phases.filter((phase) => phase.authorIds.length > 0);
}

function coverageWarnings(authors: StudyAuthorPlan[]): string[] {
  const warnings: string[] = [];
  const noIdeas = authors.filter((a) => a.ideaCount === 0).length;
  const weakFullText = authors.filter((a) => a.coverage.fullTextWorks === 0 && a.ideaCount > 0).length;
  const noZotero = authors.filter((a) => a.coverage.zoteroLinkedWorks === 0 && a.workCount > 0).length;
  if (noIdeas > 0) warnings.push(`${noIdeas} autor(es) aparecen sin ideas extraidas; necesitan analisis profundo.`);
  if (weakFullText > 0) warnings.push(`${weakFullText} autor(es) tienen ideas pero no pasajes indexados para tutor con texto completo.`);
  if (noZotero > 0) warnings.push(`${noZotero} autor(es) no tienen enlace Zotero disponible en sus obras.`);
  return warnings.slice(0, 4);
}

export function buildStudyGuidePlan(input: StudyGuideBuildInput): StudyGuidePlan {
  const sessionMinutes = clamp(input.sessionMinutes ?? DEFAULT_SESSION_MINUTES, 20, 120);
  const authorLimit = clamp(input.authorLimit ?? DEFAULT_AUTHOR_LIMIT, 4, 80);
  const worksPerAuthor = clamp(input.worksPerAuthor ?? DEFAULT_WORKS_PER_AUTHOR, 1, 10);
  const objective = compact(input.objective?.trim() || 'Dominar autores, ideas y obras principales del corpus.', 220);

  const visibleAuthors = input.includeCompleted
    ? input.authors
    : input.authors.filter((author) => author.progressStatus !== 'understood');
  const ranked = [...visibleAuthors]
    .sort((a, b) => authorScore(b) - authorScore(a) || a.fullName.localeCompare(b.fullName))
    .slice(0, authorLimit)
    .map((author, index) => buildAuthorPlan(author, index + 1, worksPerAuthor));

  const allWorkIds = new Set<string>();
  let totalIdeas = 0;
  let linkedWorks = 0;
  for (const author of input.authors) {
    totalIdeas += author.ideaCount;
    for (const work of author.works) {
      if (!allWorkIds.has(work.nodusId) && work.zoteroKey) linkedWorks += 1;
      allWorkIds.add(work.nodusId);
    }
  }
  const completedAuthors = input.authors.filter((a) => a.progressStatus === 'understood').length;
  const reviewAuthors = input.authors.filter((a) => a.progressStatus === 'review' || a.progressStatus === 'in_progress').length;
  const fullReadWorks = unique(
    input.authors.flatMap((a) => a.works.filter((w) => w.progressStatus === 'needs_full_read').map((w) => w.nodusId))
  ).length;

  const stats = {
    totalAuthors: input.authors.length,
    shownAuthors: ranked.length,
    totalWorks: allWorkIds.size,
    totalIdeas,
    completedAuthors,
    reviewAuthors,
    fullReadWorks,
    zoteroLinkedWorks: linkedWorks,
  };

  const nextAuthor = ranked.find((a) => a.progressStatus !== 'understood') ?? ranked[0] ?? null;
  const summary =
    ranked.length === 0
      ? 'No hay autores pendientes con los filtros actuales.'
      : `Ruta de ${ranked.length} autor(es): empieza por ${nextAuthor?.fullName ?? ranked[0].fullName}, combina ficha, obras Zotero y preguntas de repaso en sesiones de ${sessionMinutes} minutos.`;

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    objective,
    sessionMinutes,
    stats,
    summary,
    nextAuthorId: nextAuthor?.authorId ?? null,
    authors: ranked,
    phases: buildPhases(ranked),
    coverageWarnings: coverageWarnings(ranked),
    semanticFocusAvailable: Boolean(input.semanticFocusAvailable),
    semanticFocusUsed: Boolean(input.semanticFocusUsed),
    semanticFocusSummary: input.semanticFocusSummary ?? null,
  };
}
