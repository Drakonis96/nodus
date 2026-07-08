import type {
  AppLanguage,
  PromptLanguage,
  GapKind,
  HypothesisCandidate,
  HypothesisEvidenceLink,
  HypothesisLabMode,
  HypothesisLabRequest,
  HypothesisLabResult,
  HypothesisMaturity,
  HypothesisVariable,
} from './types';

export interface HypothesisIdeaSource {
  id: string;
  label: string;
  statement: string;
  type: string;
  themes: string[];
  workIds: string[];
  workCount: number;
  evidenceCount: number;
}

export interface HypothesisGapSource {
  id: string;
  kind: GapKind;
  statement: string;
  confidence: number;
  relatedIdeaId: string | null;
  workId: string;
  workTitle: string;
  authors: string[];
  year: number | null;
  evidenceQuote: string | null;
}

export interface HypothesisDebateSource {
  id: string;
  fromId: string;
  toId: string;
  fromLabel: string;
  toLabel: string;
  explanation: string | null;
  confidence: number;
}

export interface HypothesisWorkSource {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  themes: string[];
  deepStatus: string;
  ideaCount: number;
  gapCount: number;
  summary: string | null;
}

export interface HypothesisProjectSource {
  id: string;
  title: string;
  brief: string;
  linkLabels: string[];
}

export interface HypothesisLabCorpus {
  request: HypothesisLabRequest;
  generatedAt?: string;
  ideas: HypothesisIdeaSource[];
  gaps: HypothesisGapSource[];
  debates: HypothesisDebateSource[];
  works: HypothesisWorkSource[];
  passages: number;
  project: HypothesisProjectSource | null;
  warnings?: string[];
}

interface DraftSeed {
  id: string;
  gap: HypothesisGapSource;
  idea: HypothesisIdeaSource | null;
  work: HypothesisWorkSource | null;
  debates: HypothesisDebateSource[];
  score: number;
  novelty: number;
  support: number;
  testability: number;
  risk: number;
}

const STOP_WORDS = new Set([
  'about',
  'after',
  'also',
  'como',
  'con',
  'contra',
  'de',
  'del',
  'desde',
  'does',
  'during',
  'entre',
  'esta',
  'este',
  'estos',
  'from',
  'have',
  'into',
  'las',
  'los',
  'para',
  'por',
  'que',
  'this',
  'una',
  'with',
]);

export function buildHypothesisLabFallback(corpus: HypothesisLabCorpus): HypothesisLabResult {
  const request = normalizeRequest(corpus.request);
  const tokens = tokenize([request.objective, corpus.project?.title ?? '', corpus.project?.brief ?? ''].join(' '));
  const maxCandidates = Math.max(1, Math.min(12, request.maxCandidates ?? 6));
  const seeds = buildSeeds(corpus, tokens).slice(0, maxCandidates);
  const candidates = seeds.map((seed, index) => seedToCandidate(seed, request, corpus, index));
  const warnings = [...(corpus.warnings ?? [])];

  if (corpus.gaps.length === 0) {
    warnings.push(text(request.language, 'No hay huecos detectados: el laboratorio necesita escaneos profundos para proponer hipótesis sólidas.', 'No detected gaps: the lab needs deep scans to propose strong hypotheses.'));
  }
  if (!request.objective.trim()) {
    warnings.push(text(request.language, 'Sin objetivo escrito, la priorización usa solo señales generales del corpus.', 'Without a written objective, prioritization uses only broad corpus signals.'));
  }
  if (candidates.length === 0 && corpus.ideas.length > 0) {
    const synthetic = ideaOnlySeed(corpus);
    if (synthetic) candidates.push(seedToCandidate(synthetic, request, corpus, 0));
  }

  return {
    generatedAt: corpus.generatedAt ?? new Date().toISOString(),
    request,
    stats: {
      works: corpus.works.length,
      ideas: corpus.ideas.length,
      gaps: corpus.gaps.length,
      debates: corpus.debates.length,
      passages: corpus.passages,
      projectLinked: !!corpus.project,
      aiRefined: false,
      contextChars: JSON.stringify({
        objective: request.objective,
        project: corpus.project,
        gaps: corpus.gaps.slice(0, 30),
        ideas: corpus.ideas.slice(0, 30),
        debates: corpus.debates.slice(0, 12),
      }).length,
    },
    candidates,
    warnings,
  };
}

function normalizeRequest(request: HypothesisLabRequest): HypothesisLabRequest {
  return {
    ...request,
    objective: request.objective?.trim() ?? '',
    mode: request.mode ?? 'exploratory',
    language: request.language === 'en' ? 'en' : 'es',
    maxCandidates: request.maxCandidates ?? 6,
  };
}

function buildSeeds(corpus: HypothesisLabCorpus, tokens: Set<string>): DraftSeed[] {
  const ideaById = new Map(corpus.ideas.map((idea) => [idea.id, idea]));
  const workById = new Map(corpus.works.map((work) => [work.id, work]));
  const seeds = corpus.gaps.map((gap): DraftSeed => {
    const idea = gap.relatedIdeaId ? ideaById.get(gap.relatedIdeaId) ?? null : bestIdeaForGap(gap, corpus.ideas, tokens);
    const work = workById.get(gap.workId) ?? null;
    const debates = corpus.debates
      .filter((debate) => debate.fromId === idea?.id || debate.toId === idea?.id)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3);
    const lexical = relevance(tokens, [gap.statement, idea?.label ?? '', idea?.statement ?? '', work?.title ?? '', work?.themes.join(' ') ?? ''].join(' '));
    const novelty = Math.min(1, 0.35 + gap.confidence * 0.35 + noveltyBoost(gap.kind) + Math.min(0.16, (work?.gapCount ?? 0) * 0.025));
    const support = Math.min(1, 0.2 + Math.min(0.28, (idea?.workCount ?? 0) * 0.05) + Math.min(0.18, (idea?.evidenceCount ?? 0) * 0.025) + (gap.evidenceQuote ? 0.1 : 0));
    const testability = Math.min(1, 0.34 + modeTestability(corpus.request.mode) + (work?.deepStatus === 'done' ? 0.12 : 0) + (idea?.type === 'method' ? 0.1 : 0));
    const risk = Math.min(1, 0.22 + debates.length * 0.12 + (support < 0.38 ? 0.16 : 0));
    const score = novelty * 0.34 + support * 0.26 + testability * 0.24 + lexical * 0.22 - risk * 0.11;
    return {
      id: `hyp-${stableId(gap.id)}`,
      gap,
      idea,
      work,
      debates,
      score: clamp(score),
      novelty: clamp(novelty),
      support: clamp(support),
      testability: clamp(testability),
      risk: clamp(risk),
    };
  });
  return seeds.sort((a, b) => b.score - a.score || b.gap.confidence - a.gap.confidence);
}

function ideaOnlySeed(corpus: HypothesisLabCorpus): DraftSeed | null {
  const idea = corpus.ideas[0];
  if (!idea) return null;
  const work = corpus.works.find((item) => idea.workIds.includes(item.id)) ?? corpus.works[0] ?? null;
  const gap: HypothesisGapSource = {
    id: `synthetic-${idea.id}`,
    kind: 'open_question',
    statement: idea.statement,
    confidence: 0.5,
    relatedIdeaId: idea.id,
    workId: work?.id ?? '',
    workTitle: work?.title ?? 'Corpus',
    authors: work?.authors ?? [],
    year: work?.year ?? null,
    evidenceQuote: null,
  };
  return {
    id: `hyp-${stableId(idea.id)}`,
    gap,
    idea,
    work,
    debates: [],
    score: 0.48,
    novelty: 0.42,
    support: Math.min(1, 0.3 + idea.workCount * 0.05),
    testability: 0.45,
    risk: 0.35,
  };
}

function seedToCandidate(
  seed: DraftSeed,
  request: HypothesisLabRequest,
  corpus: HypothesisLabCorpus,
  index: number
): HypothesisCandidate {
  const lang = request.language ?? 'es';
  const theme = firstUseful(seed.idea?.themes ?? seed.work?.themes ?? [], seed.idea?.label ?? seed.work?.title ?? '');
  const gapPhrase = clip(seed.gap.statement, 120);
  const caseLabel = seed.work ? sourceLabel(seed.work.authors, seed.work.year, seed.work.title) : text(lang, 'el corpus', 'the corpus');
  const title = titleFor(seed, request.mode, lang, index);
  const hypothesis = hypothesisFor(request.mode, lang, theme, gapPhrase, caseLabel);
  const evidence = evidenceFor(seed);
  const methods = methodsFor(request.mode, lang, theme);
  const variables = variablesFor(seed, request.mode, lang, theme);
  const predictions = predictionsFor(seed, lang, theme);
  const counterArguments = counterArgumentsFor(seed, lang);
  const nextSteps = nextStepsFor(seed, request.mode, lang);
  const searchQueries = searchQueriesFor(seed, theme);

  return {
    id: seed.id,
    title,
    hypothesis,
    rationale: rationaleFor(seed, lang),
    maturity: maturityFor(seed),
    score: round(seed.score),
    novelty: round(seed.novelty),
    support: round(seed.support),
    testability: round(seed.testability),
    risk: round(seed.risk),
    variables,
    evidence,
    methods,
    predictions,
    counterArguments,
    nextSteps,
    searchQueries,
    draftAbstract: abstractFor(seed, hypothesis, corpus.project, lang),
  };
}

function evidenceFor(seed: DraftSeed): HypothesisEvidenceLink[] {
  const out: HypothesisEvidenceLink[] = [
    {
      kind: 'gap',
      role: 'gap',
      refId: seed.gap.id,
      label: clip(seed.gap.statement, 120),
      citation: `nodus://gap/${seed.gap.id}`,
      quote: seed.gap.evidenceQuote ? clip(seed.gap.evidenceQuote, 360) : null,
      score: seed.gap.confidence,
    },
  ];
  if (seed.idea) {
    out.push({
      kind: 'idea',
      role: 'support',
      refId: seed.idea.id,
      label: seed.idea.label,
      citation: `nodus://idea/${seed.idea.id}`,
      quote: clip(seed.idea.statement, 360),
      score: seed.support,
    });
  }
  if (seed.work) {
    out.push({
      kind: 'work',
      role: 'source',
      refId: seed.work.id,
      label: seed.work.title,
      citation: `nodus://work/${seed.work.id}`,
      quote: seed.work.summary ? clip(seed.work.summary, 360) : null,
      score: seed.work.ideaCount,
    });
  }
  for (const debate of seed.debates) {
    out.push({
      kind: 'debate',
      role: 'contrast',
      refId: debate.id,
      label: `${debate.fromLabel} / ${debate.toLabel}`,
      citation: `nodus://contradiction/${debate.id}`,
      quote: debate.explanation ? clip(debate.explanation, 360) : null,
      score: debate.confidence,
    });
  }
  return out;
}

function variablesFor(seed: DraftSeed, mode: HypothesisLabMode, lang: PromptLanguage, theme: string): HypothesisVariable[] {
  const shared: HypothesisVariable[] = [
    {
      name: theme,
      role: mode === 'methodological' ? 'method' : mode === 'comparative' ? 'case' : 'phenomenon',
      description: text(lang, 'Núcleo conceptual recuperado del corpus y conectado con el hueco.', 'Core concept retrieved from the corpus and connected to the gap.'),
    },
    {
      name: clip(seed.gap.statement, 72),
      role: 'outcome',
      description: text(lang, 'Problema todavía insuficientemente explicado o comprobado.', 'Problem not yet sufficiently explained or tested.'),
    },
  ];
  if (seed.work) {
    shared.push({
      name: seed.work.title,
      role: 'context',
      description: text(lang, 'Caso, tradición o corpus donde aparece la señal inicial.', 'Case, tradition or corpus where the initial signal appears.'),
    });
  }
  return shared;
}

function hypothesisFor(mode: HypothesisLabMode, lang: PromptLanguage, theme: string, gap: string, caseLabel: string): string {
  if (lang === 'en') {
    switch (mode) {
      case 'causal':
        return `If ${theme} shapes the conditions identified in ${caseLabel}, then it should explain why ${gap}.`;
      case 'comparative':
        return `${theme} should vary across cases depending on how each corpus resolves the gap: ${gap}.`;
      case 'methodological':
        return `A method centered on ${theme} can make the gap observable and testable: ${gap}.`;
      case 'intervention':
        return `An intervention targeting ${theme} should reduce or clarify the unresolved problem: ${gap}.`;
      default:
        return `${theme} is a plausible mechanism for explaining the unresolved gap: ${gap}.`;
    }
  }
  switch (mode) {
    case 'causal':
      return `Si ${theme} estructura las condiciones observadas en ${caseLabel}, entonces debería explicar por qué ${gap}.`;
    case 'comparative':
      return `${theme} debería variar entre casos según cómo cada corpus resuelva el hueco: ${gap}.`;
    case 'methodological':
      return `Un método centrado en ${theme} puede volver observable y contrastable el hueco: ${gap}.`;
    case 'intervention':
      return `Una intervención sobre ${theme} debería reducir o clarificar el problema no resuelto: ${gap}.`;
    default:
      return `${theme} funciona como mecanismo plausible para explicar el hueco no resuelto: ${gap}.`;
  }
}

function titleFor(seed: DraftSeed, mode: HypothesisLabMode, lang: PromptLanguage, index: number): string {
  const core = firstUseful(seed.idea?.themes ?? [], seed.idea?.label ?? seed.work?.title ?? `H${index + 1}`);
  const modeLabel = text(lang, modeTitleEs(mode), modeTitleEn(mode));
  return `${modeLabel}: ${clip(core, 64)}`;
}

function rationaleFor(seed: DraftSeed, lang: PromptLanguage): string {
  const source = seed.work ? sourceLabel(seed.work.authors, seed.work.year, seed.work.title) : text(lang, 'una obra del corpus', 'one corpus work');
  const idea = seed.idea ? seed.idea.label : text(lang, 'una línea conceptual cercana', 'a nearby conceptual line');
  if (lang === 'en') {
    return `The candidate starts from a gap detected in ${source} and connects it with ${idea}. Its value is that it converts an open problem into a claim that can be tested with further cases, passages or comparison.`;
  }
  return `El candidato parte de un hueco detectado en ${source} y lo conecta con ${idea}. Su valor es convertir un problema abierto en una proposición contrastable mediante casos, pasajes o comparación adicional.`;
}

function abstractFor(seed: DraftSeed, hypothesis: string, project: HypothesisProjectSource | null, lang: PromptLanguage): string {
  const projectLine = project
    ? text(lang, `La hipótesis puede incorporarse al proyecto "${project.title}" como eje de contribución o apartado de discusión.`, `The hypothesis can be folded into "${project.title}" as a contribution axis or discussion section.`)
    : text(lang, 'La hipótesis puede guardarse como nota y después promoverse a un proyecto o borrador.', 'The hypothesis can be saved as a note and later promoted into a project or draft.');
  const supportLine = text(
    lang,
    `El punto de partida es el hueco "${clip(seed.gap.statement, 160)}", apoyado por ${seed.idea ? `la idea "${seed.idea.label}"` : 'material cercano del corpus'}.`,
    `The starting point is the gap "${clip(seed.gap.statement, 160)}", supported by ${seed.idea ? `the idea "${seed.idea.label}"` : 'nearby corpus material'}.`
  );
  return `${hypothesis}\n\n${supportLine} ${projectLine}`;
}

function methodsFor(mode: HypothesisLabMode, lang: PromptLanguage, theme: string): string[] {
  const es: Record<HypothesisLabMode, string[]> = {
    exploratory: ['Revisión focalizada de pasajes indexados', 'Muestreo teórico de obras con huecos similares', `Codificación temática de "${theme}"`],
    causal: ['Modelo causal explícito de mecanismo y resultado', 'Comparación de casos positivos/negativos', 'Búsqueda de contraejemplos en debates'],
    comparative: ['Matriz comparativa entre autores/casos', 'Control por cronología y tradición teórica', 'Lectura cruzada de contradicciones'],
    methodological: ['Operacionalización de variables', 'Protocolo de codificación reproducible', 'Validación con pasajes textuales'],
    intervention: ['Diseño de intervención o recomendación', 'Criterios de éxito observables', 'Contraste antes/después o entre grupos'],
  };
  const en: Record<HypothesisLabMode, string[]> = {
    exploratory: ['Focused review of indexed passages', 'Theoretical sampling of works with similar gaps', `Thematic coding of "${theme}"`],
    causal: ['Explicit causal model of mechanism and outcome', 'Positive/negative case comparison', 'Search for counterexamples in debates'],
    comparative: ['Comparative matrix across authors/cases', 'Control for chronology and theoretical tradition', 'Cross-reading of contradictions'],
    methodological: ['Variable operationalization', 'Reproducible coding protocol', 'Validation with textual passages'],
    intervention: ['Intervention or recommendation design', 'Observable success criteria', 'Before/after or between-group contrast'],
  };
  return lang === 'en' ? en[mode] : es[mode];
}

function predictionsFor(seed: DraftSeed, lang: PromptLanguage, theme: string): string[] {
  if (lang === 'en') {
    return [
      `Works with stronger traces of ${theme} should show clearer evidence around the proposed mechanism.`,
      'Cases that do not fit the hypothesis should cluster around the listed debates or limitations.',
      'New full-text passages should either strengthen the mechanism or expose a scope condition.',
    ];
  }
  return [
    `Las obras con señales más fuertes de ${theme} deberían mostrar evidencia más clara sobre el mecanismo propuesto.`,
    'Los casos que no encajen con la hipótesis deberían concentrarse alrededor de los debates o limitaciones listadas.',
    'Los nuevos pasajes de texto completo deberían reforzar el mecanismo o revelar una condición de alcance.',
  ];
}

function counterArgumentsFor(seed: DraftSeed, lang: PromptLanguage): string[] {
  const debate = seed.debates[0];
  const base = debate
    ? text(lang, `Existe una tensión registrada entre "${debate.fromLabel}" y "${debate.toLabel}".`, `There is a registered tension between "${debate.fromLabel}" and "${debate.toLabel}".`)
    : text(lang, 'La hipótesis puede depender de una lectura todavía incompleta del corpus.', 'The hypothesis may depend on an incomplete reading of the corpus.');
  return [
    base,
    text(lang, 'El hueco puede ser un problema de cobertura local y no una laguna real del campo.', 'The gap may be local corpus coverage rather than a real field-level gap.'),
    text(lang, 'La relación propuesta puede ser correlacional, no causal.', 'The proposed relation may be correlational rather than causal.'),
  ];
}

function nextStepsFor(seed: DraftSeed, mode: HypothesisLabMode, lang: PromptLanguage): string[] {
  return [
    text(lang, 'Abrir el hueco y revisar su evidencia textual original.', 'Open the gap and review its original textual evidence.'),
    seed.idea
      ? text(lang, `Revisar la idea "${seed.idea.label}" en el grafo y sus obras principales.`, `Review the idea "${seed.idea.label}" in the graph and its main works.`)
      : text(lang, 'Buscar una idea del grafo que funcione como mecanismo central.', 'Find a graph idea that can work as the central mechanism.'),
    mode === 'comparative'
      ? text(lang, 'Elegir 2-4 casos comparables y construir una matriz de diferencias.', 'Choose 2-4 comparable cases and build a difference matrix.')
      : text(lang, 'Buscar pasajes adicionales y contraejemplos antes de convertirla en argumento de capítulo.', 'Search for additional passages and counterexamples before turning it into a chapter argument.'),
  ];
}

function searchQueriesFor(seed: DraftSeed, theme: string): string[] {
  const gapTerms = Array.from(tokenize(seed.gap.statement)).slice(0, 4).join(' ');
  const themeQ = quote(theme);
  const workAuthor = seed.work?.authors[0] ? quote(seed.work.authors[0]) : '';
  return [
    [themeQ, gapTerms].filter(Boolean).join(' AND '),
    [themeQ, '"research gap"', gapTerms].filter(Boolean).join(' AND '),
    [workAuthor, themeQ, gapTerms].filter(Boolean).join(' AND '),
  ].filter(Boolean);
}

function maturityFor(seed: DraftSeed): HypothesisMaturity {
  if (seed.support >= 0.62 && seed.testability >= 0.62 && seed.risk <= 0.48) return 'ready';
  if (seed.support >= 0.5 && seed.testability >= 0.5) return 'testable';
  if (seed.novelty >= 0.55 || seed.support >= 0.42) return 'promising';
  return 'seed';
}

function bestIdeaForGap(gap: HypothesisGapSource, ideas: HypothesisIdeaSource[], tokens: Set<string>): HypothesisIdeaSource | null {
  let best: { idea: HypothesisIdeaSource; score: number } | null = null;
  for (const idea of ideas.slice(0, 120)) {
    const score = relevance(tokens, `${idea.label} ${idea.statement} ${idea.themes.join(' ')}`) + relevance(tokenize(gap.statement), `${idea.label} ${idea.statement}`);
    if (!best || score > best.score) best = { idea, score };
  }
  return best?.score ? best.idea : null;
}

function noveltyBoost(kind: GapKind): number {
  switch (kind) {
    case 'future_work':
      return 0.18;
    case 'open_question':
      return 0.15;
    case 'unresolved_contradiction':
      return 0.12;
    case 'limitation':
      return 0.1;
  }
}

function modeTestability(mode: HypothesisLabMode): number {
  switch (mode) {
    case 'methodological':
      return 0.2;
    case 'comparative':
      return 0.18;
    case 'causal':
      return 0.14;
    case 'intervention':
      return 0.16;
    default:
      return 0.08;
  }
}

function modeTitleEs(mode: HypothesisLabMode): string {
  switch (mode) {
    case 'causal':
      return 'Hipótesis causal';
    case 'comparative':
      return 'Hipótesis comparativa';
    case 'methodological':
      return 'Hipótesis metodológica';
    case 'intervention':
      return 'Hipótesis de intervención';
    default:
      return 'Hipótesis exploratoria';
  }
}

function modeTitleEn(mode: HypothesisLabMode): string {
  switch (mode) {
    case 'causal':
      return 'Causal hypothesis';
    case 'comparative':
      return 'Comparative hypothesis';
    case 'methodological':
      return 'Methodological hypothesis';
    case 'intervention':
      return 'Intervention hypothesis';
    default:
      return 'Exploratory hypothesis';
  }
}

function firstUseful(values: string[], fallback: string): string {
  const clean = values.find((value) => value.trim().length > 2);
  return clean?.trim() || clip(fallback, 80) || 'Nodus';
}

function sourceLabel(authors: string[], year: number | null, fallback: string): string {
  const first = authors[0]?.trim();
  if (!first && !year) return clip(fallback, 70);
  return `${first ?? 's.a.'}${year ? ` (${year})` : ''}`;
}

function tokenize(text: string): Set<string> {
  return new Set(
    (text ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9ñ\s]/gi, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 3 && !STOP_WORDS.has(token))
  );
}

function relevance(tokens: Set<string>, textValue: string): number {
  if (tokens.size === 0) return 0;
  const hay = tokenize(textValue);
  let hits = 0;
  for (const token of tokens) if (hay.has(token)) hits += 1;
  return Math.min(0.6, hits / Math.max(5, tokens.size));
}

function stableId(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function quote(value: string): string {
  const clean = value.trim();
  return clean ? `"${clean.replace(/"/g, '')}"` : '';
}

function clip(textValue: string, max = 240): string {
  const clean = (textValue ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trim()}…` : clean;
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Math.round(clamp(value) * 100) / 100;
}

function text(lang: PromptLanguage | undefined, es: string, en: string): string {
  return lang === 'en' ? en : es;
}
