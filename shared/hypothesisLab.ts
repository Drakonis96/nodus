import type {
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
    warnings.push(localized(request.language, {
      es: 'No hay huecos detectados: el laboratorio necesita escaneos profundos para proponer hipótesis sólidas.', en: 'No detected gaps: the lab needs deep scans to propose strong hypotheses.', fr: 'Aucune lacune détectée : le laboratoire a besoin d’analyses approfondies pour proposer des hypothèses solides.', de: 'Keine Lücken erkannt: Für belastbare Hypothesen benötigt das Labor vertiefte Scans.', pt: 'Não foram detetadas lacunas: o laboratório precisa de análises aprofundadas para propor hipóteses sólidas.', 'pt-BR': 'Nenhuma lacuna detectada: o laboratório precisa de análises aprofundadas para propor hipóteses sólidas.', it: 'Nessuna lacuna rilevata: il laboratorio ha bisogno di scansioni approfondite per proporre ipotesi solide.', tr: 'Boşluk tespit edilmedi: laboratuvarın güçlü hipotezler önermek için derin taramalara ihtiyacı var.',
    }));
  }
  if (!request.objective.trim()) {
    warnings.push(localized(request.language, {
      es: 'Sin objetivo escrito, la priorización usa solo señales generales del corpus.', en: 'Without a written objective, prioritization uses only broad corpus signals.', fr: 'Sans objectif écrit, la priorisation utilise uniquement les signaux généraux du corpus.', de: 'Ohne schriftliches Ziel stützt sich die Priorisierung nur auf allgemeine Korpussignale.', pt: 'Sem um objetivo escrito, a priorização usa apenas sinais gerais do corpus.', 'pt-BR': 'Sem um objetivo escrito, a priorização usa apenas sinais gerais do corpus.', it: 'Senza un obiettivo scritto, la priorità usa soltanto segnali generali del corpus.', tr: 'Yazılı bir hedef olmadan önceliklendirme yalnızca derlemin genel sinyallerini kullanır.',
    }));
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
  const requestedLanguage = request.language as PromptLanguage | undefined;
  const language: PromptLanguage = requestedLanguage && ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr'].includes(requestedLanguage)
    ? requestedLanguage
    : 'es';
  return {
    ...request,
    objective: request.objective?.trim() ?? '',
    mode: request.mode ?? 'exploratory',
    language,
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
  const caseLabel = seed.work ? sourceLabel(seed.work.authors, seed.work.year, seed.work.title, lang) : localized(lang, { es: 'el corpus', en: 'the corpus', fr: 'le corpus', de: 'das Korpus', pt: 'o corpus', 'pt-BR': 'o corpus', it: 'il corpus', tr: 'derlem' });
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
      description: ({ es: 'Núcleo conceptual recuperado del corpus y conectado con el hueco.', en: 'Core concept retrieved from the corpus and connected to the gap.', fr: 'Noyau conceptuel extrait du corpus et relié à la lacune.', de: 'Aus dem Korpus gewonnenes und mit der Lücke verbundenes Konzept.', pt: 'Núcleo conceptual recuperado do corpus e ligado à lacuna.', 'pt-BR': 'Núcleo conceitual recuperado do corpus e conectado à lacuna.', it: 'Nucleo concettuale ricavato dal corpus e collegato alla lacuna.', tr: 'Derlemden çıkarılan ve boşlukla ilişkilendirilen kavramsal çekirdek.' } as Record<PromptLanguage, string>)[lang],
    },
    {
      name: clip(seed.gap.statement, 72),
      role: 'outcome',
      description: ({ es: 'Problema todavía insuficientemente explicado o comprobado.', en: 'Problem not yet sufficiently explained or tested.', fr: 'Problème encore insuffisamment expliqué ou vérifié.', de: 'Noch nicht hinreichend erklärtes oder geprüftes Problem.', pt: 'Problema ainda insuficientemente explicado ou testado.', 'pt-BR': 'Problema ainda insuficientemente explicado ou testado.', it: 'Problema non ancora spiegato o verificato a sufficienza.', tr: 'Henüz yeterince açıklanmamış veya sınanmamış sorun.' } as Record<PromptLanguage, string>)[lang],
    },
  ];
  if (seed.work) {
    shared.push({
      name: seed.work.title,
      role: 'context',
      description: ({ es: 'Caso, tradición o corpus donde aparece la señal inicial.', en: 'Case, tradition or corpus where the initial signal appears.', fr: 'Cas, tradition ou corpus où apparaît le signal initial.', de: 'Fall, Tradition oder Korpus, in dem das Ausgangssignal auftritt.', pt: 'Caso, tradição ou corpus onde surge o sinal inicial.', 'pt-BR': 'Caso, tradição ou corpus onde surge o sinal inicial.', it: 'Caso, tradizione o corpus in cui compare il segnale iniziale.', tr: 'İlk sinyalin ortaya çıktığı vaka, gelenek veya derlem.' } as Record<PromptLanguage, string>)[lang],
    });
  }
  return shared;
}

function hypothesisFor(mode: HypothesisLabMode, lang: PromptLanguage, theme: string, gap: string, caseLabel: string): string {
  const templates: Record<PromptLanguage, Record<HypothesisLabMode, string>> = {
    es: { causal: `Si ${theme} estructura las condiciones observadas en ${caseLabel}, entonces debería explicar por qué ${gap}.`, comparative: `${theme} debería variar entre casos según cómo cada corpus resuelva el hueco: ${gap}.`, methodological: `Un método centrado en ${theme} puede volver observable y contrastable el hueco: ${gap}.`, intervention: `Una intervención sobre ${theme} debería reducir o clarificar el problema no resuelto: ${gap}.`, exploratory: `${theme} funciona como mecanismo plausible para explicar el hueco no resuelto: ${gap}.` },
    en: { causal: `If ${theme} shapes the conditions identified in ${caseLabel}, then it should explain why ${gap}.`, comparative: `${theme} should vary across cases depending on how each corpus resolves the gap: ${gap}.`, methodological: `A method centered on ${theme} can make the gap observable and testable: ${gap}.`, intervention: `An intervention targeting ${theme} should reduce or clarify the unresolved problem: ${gap}.`, exploratory: `${theme} is a plausible mechanism for explaining the unresolved gap: ${gap}.` },
    fr: { causal: `Si ${theme} structure les conditions observées dans ${caseLabel}, il devrait expliquer pourquoi ${gap}.`, comparative: `${theme} devrait varier selon les cas, en fonction de la manière dont chaque corpus résout la lacune : ${gap}.`, methodological: `Une méthode centrée sur ${theme} peut rendre la lacune observable et testable : ${gap}.`, intervention: `Une intervention ciblant ${theme} devrait réduire ou clarifier le problème non résolu : ${gap}.`, exploratory: `${theme} constitue un mécanisme plausible pour expliquer la lacune non résolue : ${gap}.` },
    de: { causal: `Wenn ${theme} die in ${caseLabel} beobachteten Bedingungen prägt, sollte es erklären, warum ${gap}.`, comparative: `${theme} sollte zwischen Fällen variieren, je nachdem, wie die jeweiligen Korpora die Lücke bearbeiten: ${gap}.`, methodological: `Eine auf ${theme} konzentrierte Methode kann die Lücke beobachtbar und prüfbar machen: ${gap}.`, intervention: `Eine auf ${theme} zielende Intervention sollte das ungelöste Problem verringern oder klären: ${gap}.`, exploratory: `${theme} ist ein plausibler Mechanismus zur Erklärung der ungelösten Lücke: ${gap}.` },
    pt: { causal: `Se ${theme} estrutura as condições observadas em ${caseLabel}, deverá explicar por que ${gap}.`, comparative: `${theme} deverá variar entre casos conforme cada corpus resolve a lacuna: ${gap}.`, methodological: `Um método centrado em ${theme} pode tornar a lacuna observável e testável: ${gap}.`, intervention: `Uma intervenção dirigida a ${theme} deverá reduzir ou esclarecer o problema não resolvido: ${gap}.`, exploratory: `${theme} é um mecanismo plausível para explicar a lacuna não resolvida: ${gap}.` },
    'pt-BR': { causal: `Se ${theme} estrutura as condições observadas em ${caseLabel}, deverá explicar por que ${gap}.`, comparative: `${theme} deve variar entre os casos conforme cada corpus resolve a lacuna: ${gap}.`, methodological: `Um método centrado em ${theme} pode tornar a lacuna observável e testável: ${gap}.`, intervention: `Uma intervenção voltada a ${theme} deve reduzir ou esclarecer o problema não resolvido: ${gap}.`, exploratory: `${theme} é um mecanismo plausível para explicar a lacuna não resolvida: ${gap}.` },
    it: { causal: `Se ${theme} struttura le condizioni osservate in ${caseLabel}, dovrebbe spiegare perché ${gap}.`, comparative: `${theme} dovrebbe variare tra i casi in base a come ciascun corpus risolve la lacuna: ${gap}.`, methodological: `Un metodo incentrato su ${theme} può rendere la lacuna osservabile e verificabile: ${gap}.`, intervention: `Un intervento rivolto a ${theme} dovrebbe ridurre o chiarire il problema irrisolto: ${gap}.`, exploratory: `${theme} è un meccanismo plausibile per spiegare la lacuna irrisolta: ${gap}.` },
    tr: { causal: `${theme}, ${caseLabel} içinde gözlenen koşulları şekillendiriyorsa ${gap} nedenini açıklamalıdır.`, comparative: `${theme}, her derlemin boşluğu nasıl çözdüğüne bağlı olarak vakalar arasında değişmelidir: ${gap}.`, methodological: `${theme} merkezli bir yöntem boşluğu gözlenebilir ve sınanabilir hâle getirebilir: ${gap}.`, intervention: `${theme} hedefli bir müdahale çözülmemiş sorunu azaltmalı veya açıklığa kavuşturmalıdır: ${gap}.`, exploratory: `${theme}, çözülmemiş boşluğu açıklamak için makul bir mekanizmadır: ${gap}.` },
  };
  return templates[lang][mode];
}

function titleFor(seed: DraftSeed, mode: HypothesisLabMode, lang: PromptLanguage, index: number): string {
  const core = firstUseful(seed.idea?.themes ?? [], seed.idea?.label ?? seed.work?.title ?? `H${index + 1}`);
  const modeLabel = modeTitle(mode, lang);
  return `${modeLabel}: ${clip(core, 64)}`;
}

function modeTitle(mode: HypothesisLabMode, lang: PromptLanguage): string {
  const labels: Record<PromptLanguage, Record<HypothesisLabMode, string>> = {
    es: { causal: 'Hipótesis causal', comparative: 'Hipótesis comparativa', methodological: 'Hipótesis metodológica', intervention: 'Hipótesis de intervención', exploratory: 'Hipótesis exploratoria' },
    en: { causal: 'Causal hypothesis', comparative: 'Comparative hypothesis', methodological: 'Methodological hypothesis', intervention: 'Intervention hypothesis', exploratory: 'Exploratory hypothesis' },
    fr: { causal: 'Hypothèse causale', comparative: 'Hypothèse comparative', methodological: 'Hypothèse méthodologique', intervention: 'Hypothèse d’intervention', exploratory: 'Hypothèse exploratoire' },
    de: { causal: 'Kausale Hypothese', comparative: 'Vergleichende Hypothese', methodological: 'Methodische Hypothese', intervention: 'Interventionshypothese', exploratory: 'Explorative Hypothese' },
    pt: { causal: 'Hipótese causal', comparative: 'Hipótese comparativa', methodological: 'Hipótese metodológica', intervention: 'Hipótese de intervenção', exploratory: 'Hipótese exploratória' },
    'pt-BR': { causal: 'Hipótese causal', comparative: 'Hipótese comparativa', methodological: 'Hipótese metodológica', intervention: 'Hipótese de intervenção', exploratory: 'Hipótese exploratória' },
    it: { causal: 'Ipotesi causale', comparative: 'Ipotesi comparativa', methodological: 'Ipotesi metodologica', intervention: 'Ipotesi d’intervento', exploratory: 'Ipotesi esplorativa' },
    tr: { causal: 'Nedensel hipotez', comparative: 'Karşılaştırmalı hipotez', methodological: 'Yöntemsel hipotez', intervention: 'Müdahale hipotezi', exploratory: 'Keşfedici hipotez' },
  };
  return labels[lang][mode];
}

function rationaleFor(seed: DraftSeed, lang: PromptLanguage): string {
  const source = seed.work ? sourceLabel(seed.work.authors, seed.work.year, seed.work.title, lang) : localized(lang, { es: 'una obra del corpus', en: 'one corpus work', fr: 'un ouvrage du corpus', de: 'ein Werk des Korpus', pt: 'uma obra do corpus', 'pt-BR': 'uma obra do corpus', it: 'un’opera del corpus', tr: 'derlemden bir eser' });
  const idea = seed.idea ? seed.idea.label : localized(lang, { es: 'una línea conceptual cercana', en: 'a nearby conceptual line', fr: 'une ligne conceptuelle proche', de: 'eine nahegelegene Konzeptlinie', pt: 'uma linha conceptual próxima', 'pt-BR': 'uma linha conceitual próxima', it: 'una linea concettuale vicina', tr: 'yakın bir kavramsal çizgi' });
  return ({
    es: `El candidato parte de un hueco detectado en ${source} y lo conecta con ${idea}. Su valor es convertir un problema abierto en una proposición contrastable mediante casos, pasajes o comparación adicional.`,
    en: `The candidate starts from a gap detected in ${source} and connects it with ${idea}. Its value is that it converts an open problem into a claim that can be tested with further cases, passages or comparison.`,
    fr: `La proposition part d’une lacune détectée dans ${source} et la relie à ${idea}. Elle transforme ainsi un problème ouvert en proposition vérifiable par d’autres cas, passages ou comparaisons.`,
    de: `Der Kandidat geht von einer in ${source} erkannten Lücke aus und verbindet sie mit ${idea}. So wird ein offenes Problem in eine anhand weiterer Fälle, Passagen oder Vergleiche prüfbare Aussage überführt.`,
    pt: `A proposta parte de uma lacuna detetada em ${source} e liga-a a ${idea}. O seu valor está em transformar um problema aberto numa afirmação testável com mais casos, passagens ou comparação.`,
    'pt-BR': `A proposta parte de uma lacuna detectada em ${source} e a conecta a ${idea}. Seu valor é transformar um problema aberto em uma afirmação que pode ser testada com novos casos, passagens ou comparação.`,
    it: `La proposta parte da una lacuna individuata in ${source} e la collega a ${idea}. Il suo valore è trasformare un problema aperto in un’affermazione verificabile con ulteriori casi, passaggi o confronti.`,
    tr: `Aday, ${source} içinde tespit edilen bir boşluktan yola çıkar ve bunu ${idea} ile ilişkilendirir. Böylece açık bir sorunu yeni vakalar, pasajlar veya karşılaştırmalarla sınanabilecek bir iddiaya dönüştürür.`,
  } as Record<PromptLanguage, string>)[lang];
}

function abstractFor(seed: DraftSeed, hypothesis: string, project: HypothesisProjectSource | null, lang: PromptLanguage): string {
  const projectLine = project ? ({
    es: `La hipótesis puede incorporarse al proyecto "${project.title}" como eje de contribución o apartado de discusión.`, en: `The hypothesis can be folded into "${project.title}" as a contribution axis or discussion section.`, fr: `L’hypothèse peut être intégrée au projet « ${project.title} » comme axe de contribution ou section de discussion.`, de: `Die Hypothese kann in das Projekt „${project.title}“ als Beitragsachse oder Diskussionsabschnitt aufgenommen werden.`, pt: `A hipótese pode ser integrada no projeto “${project.title}” como eixo de contribuição ou secção de discussão.`, 'pt-BR': `A hipótese pode ser incorporada ao projeto “${project.title}” como eixo de contribuição ou seção de discussão.`, it: `L’ipotesi può essere inserita nel progetto «${project.title}» come asse del contributo o sezione di discussione.`, tr: `Hipotez, “${project.title}” projesine katkı ekseni veya tartışma bölümü olarak eklenebilir.`,
  } as Record<PromptLanguage, string>)[lang] : ({
    es: 'La hipótesis puede guardarse como nota y después promoverse a un proyecto o borrador.', en: 'The hypothesis can be saved as a note and later promoted into a project or draft.', fr: 'L’hypothèse peut être enregistrée comme note, puis intégrée à un projet ou à un brouillon.', de: 'Die Hypothese kann als Notiz gespeichert und später in ein Projekt oder einen Entwurf überführt werden.', pt: 'A hipótese pode ser guardada como nota e depois promovida a um projeto ou rascunho.', 'pt-BR': 'A hipótese pode ser salva como nota e depois promovida a um projeto ou rascunho.', it: 'L’ipotesi può essere salvata come nota e poi inserita in un progetto o in una bozza.', tr: 'Hipotez not olarak kaydedilip daha sonra bir projeye veya taslağa aktarılabilir.',
  } as Record<PromptLanguage, string>)[lang];
  const supportLine = seed.idea ? ({
    es: `El punto de partida es el hueco "${clip(seed.gap.statement, 160)}", apoyado por la idea "${seed.idea.label}".`, en: `The starting point is the gap "${clip(seed.gap.statement, 160)}", supported by the idea "${seed.idea.label}".`, fr: `Le point de départ est la lacune « ${clip(seed.gap.statement, 160)} », étayée par l’idée « ${seed.idea.label} ».`, de: `Ausgangspunkt ist die Lücke „${clip(seed.gap.statement, 160)}“, gestützt durch die Idee „${seed.idea.label}“.`, pt: `O ponto de partida é a lacuna “${clip(seed.gap.statement, 160)}”, apoiada pela ideia “${seed.idea.label}”.`, 'pt-BR': `O ponto de partida é a lacuna “${clip(seed.gap.statement, 160)}”, apoiada pela ideia “${seed.idea.label}”.`, it: `Il punto di partenza è la lacuna «${clip(seed.gap.statement, 160)}», sostenuta dall’idea «${seed.idea.label}».`, tr: `Başlangıç noktası, “${seed.gap.statement}” boşluğudur; bu boşluk “${seed.idea.label}” fikriyle desteklenir.`,
  } as Record<PromptLanguage, string>)[lang] : ({
    es: `El punto de partida es el hueco "${clip(seed.gap.statement, 160)}", apoyado por material cercano del corpus.`, en: `The starting point is the gap "${clip(seed.gap.statement, 160)}", supported by nearby corpus material.`, fr: `Le point de départ est la lacune « ${clip(seed.gap.statement, 160)} », étayée par des éléments proches du corpus.`, de: `Ausgangspunkt ist die Lücke „${clip(seed.gap.statement, 160)}“, gestützt durch verwandtes Korpusmaterial.`, pt: `O ponto de partida é a lacuna “${clip(seed.gap.statement, 160)}”, apoiada por material próximo do corpus.`, 'pt-BR': `O ponto de partida é a lacuna “${clip(seed.gap.statement, 160)}”, apoiada por material próximo do corpus.`, it: `Il punto di partenza è la lacuna «${clip(seed.gap.statement, 160)}», sostenuta da materiale vicino del corpus.`, tr: `Başlangıç noktası, derleme ait yakın malzemeyle desteklenen “${clip(seed.gap.statement, 160)}” boşluğudur.`,
  } as Record<PromptLanguage, string>)[lang];
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
  const localized: Record<PromptLanguage, Record<HypothesisLabMode, string[]>> = {
    es,
    en,
    fr: {
      exploratory: ['Revue ciblée des passages indexés', 'Échantillonnage théorique d’ouvrages présentant des lacunes similaires', `Codage thématique de « ${theme} »`],
      causal: ['Modèle causal explicite du mécanisme et du résultat', 'Comparaison de cas positifs et négatifs', 'Recherche de contre-exemples dans les débats'],
      comparative: ['Matrice comparative entre auteurs/cas', 'Contrôle de la chronologie et de la tradition théorique', 'Lecture croisée des contradictions'],
      methodological: ['Opérationnalisation des variables', 'Protocole de codage reproductible', 'Validation par des passages textuels'],
      intervention: ['Conception d’une intervention ou recommandation', 'Critères de réussite observables', 'Comparaison avant/après ou entre groupes'],
    },
    de: {
      exploratory: ['Gezielte Prüfung indexierter Passagen', 'Theoretische Stichprobe von Werken mit ähnlichen Lücken', `Thematische Kodierung von „${theme}“`],
      causal: ['Explizites Kausalmodell von Mechanismus und Ergebnis', 'Vergleich positiver und negativer Fälle', 'Suche nach Gegenbeispielen in Debatten'],
      comparative: ['Vergleichsmatrix über Autoren/Fälle', 'Kontrolle von Chronologie und theoretischer Tradition', 'Querlektüre von Widersprüchen'],
      methodological: ['Operationalisierung der Variablen', 'Reproduzierbares Kodierprotokoll', 'Validierung anhand von Textpassagen'],
      intervention: ['Entwurf einer Intervention oder Empfehlung', 'Beobachtbare Erfolgskriterien', 'Vorher-nachher- oder Gruppenvergleich'],
    },
    pt: {
      exploratory: ['Revisão focalizada de passagens indexadas', 'Amostragem teórica de obras com lacunas semelhantes', `Codificação temática de “${theme}”`],
      causal: ['Modelo causal explícito do mecanismo e do resultado', 'Comparação de casos positivos/negativos', 'Busca de contraexemplos nos debates'],
      comparative: ['Matriz comparativa entre autores/casos', 'Controlo da cronologia e da tradição teórica', 'Leitura cruzada de contradições'],
      methodological: ['Operacionalização das variáveis', 'Protocolo de codificação reproduzível', 'Validação com passagens textuais'],
      intervention: ['Desenho de uma intervenção ou recomendação', 'Critérios de sucesso observáveis', 'Contraste antes/depois ou entre grupos'],
    },
    'pt-BR': {
      exploratory: ['Revisão focada de passagens indexadas', 'Amostragem teórica de obras com lacunas semelhantes', `Codificação temática de “${theme}”`],
      causal: ['Modelo causal explícito do mecanismo e do resultado', 'Comparação de casos positivos/negativos', 'Busca de contraexemplos nos debates'],
      comparative: ['Matriz comparativa entre autores/casos', 'Controle da cronologia e da tradição teórica', 'Leitura cruzada de contradições'],
      methodological: ['Operacionalização das variáveis', 'Protocolo de codificação reproduzível', 'Validação com passagens textuais'],
      intervention: ['Desenho de uma intervenção ou recomendação', 'Critérios de sucesso observáveis', 'Comparação antes/depois ou entre grupos'],
    },
    it: {
      exploratory: ['Revisione mirata dei passaggi indicizzati', 'Campionamento teorico di opere con lacune simili', `Codifica tematica di «${theme}»`],
      causal: ['Modello causale esplicito di meccanismo e risultato', 'Confronto di casi positivi/negativi', 'Ricerca di controesempi nei dibattiti'],
      comparative: ['Matrice comparativa tra autori/casi', 'Controllo della cronologia e della tradizione teorica', 'Lettura incrociata delle contraddizioni'],
      methodological: ['Operazionalizzazione delle variabili', 'Protocollo di codifica riproducibile', 'Validazione tramite passaggi testuali'],
      intervention: ['Progettazione di un intervento o di una raccomandazione', 'Criteri di successo osservabili', 'Confronto prima/dopo o tra gruppi'],
    },
    tr: {
      exploratory: ['Dizinlenmiş pasajların odaklı incelenmesi', 'Benzer boşluklara sahip eserlerden teorik örnekleme', `“${theme}” tematik kodlaması`],
      causal: ['Mekanizma ve sonuç için açık nedensel model', 'Pozitif/negatif vaka karşılaştırması', 'Tartışmalarda karşı örnek arama'],
      comparative: ['Yazarlar/vakalar arasında karşılaştırmalı matris', 'Kronoloji ve teorik geleneği kontrol etme', 'Çelişkilerin çapraz okunması'],
      methodological: ['Değişkenlerin işlemselleştirilmesi', 'Yeniden üretilebilir kodlama protokolü', 'Metinsel pasajlarla doğrulama'],
      intervention: ['Müdahale veya öneri tasarımı', 'Gözlenebilir başarı ölçütleri', 'Önce/sonra ya da gruplar arası karşılaştırma'],
    },
  };
  return localized[lang][mode];
}

function predictionsFor(seed: DraftSeed, lang: PromptLanguage, theme: string): string[] {
  const copy: Record<PromptLanguage, string[]> = {
    es: [`Las obras con señales más fuertes de ${theme} deberían mostrar evidencia más clara sobre el mecanismo propuesto.`, 'Los casos que no encajen con la hipótesis deberían concentrarse alrededor de los debates o limitaciones listadas.', 'Los nuevos pasajes de texto completo deberían reforzar el mecanismo o revelar una condición de alcance.'],
    en: [`Works with stronger traces of ${theme} should show clearer evidence around the proposed mechanism.`, 'Cases that do not fit the hypothesis should cluster around the listed debates or limitations.', 'New full-text passages should either strengthen the mechanism or expose a scope condition.'],
    fr: [`Les ouvrages où ${theme} est davantage présent devraient fournir des éléments plus clairs sur le mécanisme proposé.`, 'Les cas qui ne correspondent pas à l’hypothèse devraient se concentrer autour des débats ou limites indiqués.', 'Les nouveaux passages intégraux devraient soit renforcer le mécanisme, soit révéler une condition de portée.'],
    de: [`Werke mit stärkeren Spuren von ${theme} sollten deutlichere Belege für den vorgeschlagenen Mechanismus zeigen.`, 'Fälle, die nicht zur Hypothese passen, sollten sich um die genannten Debatten oder Einschränkungen gruppieren.', 'Neue Volltextpassagen sollten den Mechanismus entweder stärken oder eine Geltungsbedingung sichtbar machen.'],
    pt: [`As obras com sinais mais fortes de ${theme} deverão apresentar evidência mais clara do mecanismo proposto.`, 'Os casos que não se ajustarem à hipótese deverão concentrar-se nos debates ou limitações indicados.', 'Novas passagens de texto integral deverão reforçar o mecanismo ou revelar uma condição de alcance.'],
    'pt-BR': [`Obras com sinais mais fortes de ${theme} devem mostrar evidências mais claras do mecanismo proposto.`, 'Casos que não se ajustem à hipótese devem se concentrar nos debates ou limitações listados.', 'Novas passagens de texto completo devem reforçar o mecanismo ou revelar uma condição de escopo.'],
    it: [`Le opere con tracce più forti di ${theme} dovrebbero mostrare prove più chiare del meccanismo proposto.`, 'I casi che non corrispondono all’ipotesi dovrebbero concentrarsi attorno ai dibattiti o ai limiti indicati.', 'Nuovi passaggi integrali dovrebbero rafforzare il meccanismo o rivelare una condizione di portata.'],
    tr: [`${theme} izleri daha güçlü olan eserler, önerilen mekanizmaya dair daha açık kanıt göstermelidir.`, 'Hipoteze uymayan vakalar, listelenen tartışmalar veya sınırlamalar çevresinde kümelenmelidir.', 'Yeni tam metin pasajları mekanizmayı güçlendirmeli veya kapsam koşulunu ortaya çıkarmalıdır.'],
  };
  return copy[lang];
}

function counterArgumentsFor(seed: DraftSeed, lang: PromptLanguage): string[] {
  const debate = seed.debates[0];
  const base = debate ? {
    es: `Existe una tensión registrada entre "${debate.fromLabel}" y "${debate.toLabel}".`, en: `There is a registered tension between "${debate.fromLabel}" and "${debate.toLabel}".`, fr: `Une tension est enregistrée entre « ${debate.fromLabel} » et « ${debate.toLabel} ».`, de: `Zwischen „${debate.fromLabel}“ und „${debate.toLabel}“ besteht eine dokumentierte Spannung.`, pt: `Existe uma tensão registada entre “${debate.fromLabel}” e “${debate.toLabel}”.`, 'pt-BR': `Há uma tensão registrada entre “${debate.fromLabel}” e “${debate.toLabel}”.`, it: `È registrata una tensione tra «${debate.fromLabel}» e «${debate.toLabel}».`, tr: `“${debate.fromLabel}” ile “${debate.toLabel}” arasında kayıtlı bir gerilim var.`,
  }[lang] : {
    es: 'La hipótesis puede depender de una lectura todavía incompleta del corpus.', en: 'The hypothesis may depend on an incomplete reading of the corpus.', fr: 'L’hypothèse peut dépendre d’une lecture encore incomplète du corpus.', de: 'Die Hypothese könnte von einer noch unvollständigen Korpuslektüre abhängen.', pt: 'A hipótese pode depender de uma leitura ainda incompleta do corpus.', 'pt-BR': 'A hipótese pode depender de uma leitura ainda incompleta do corpus.', it: 'L’ipotesi può dipendere da una lettura ancora incompleta del corpus.', tr: 'Hipotez, derlemin henüz tamamlanmamış bir okumasına dayanıyor olabilir.',
  }[lang];
  const rest: Record<PromptLanguage, [string, string]> = {
    es: ['El hueco puede ser un problema de cobertura local y no una laguna real del campo.', 'La relación propuesta puede ser correlacional, no causal.'],
    en: ['The gap may be local corpus coverage rather than a real field-level gap.', 'The proposed relation may be correlational rather than causal.'],
    fr: ['La lacune peut relever de la couverture locale du corpus et non d’un véritable manque dans le champ.', 'La relation proposée peut être corrélationnelle plutôt que causale.'],
    de: ['Die Lücke könnte eine lokale Korpusabdeckung und keine echte Lücke des Forschungsfelds sein.', 'Die vorgeschlagene Beziehung könnte korrelativ statt kausal sein.'],
    pt: ['A lacuna pode resultar da cobertura local do corpus, e não de uma lacuna real no campo.', 'A relação proposta pode ser correlacional, não causal.'],
    'pt-BR': ['A lacuna pode ser um problema de cobertura local do corpus, e não uma lacuna real do campo.', 'A relação proposta pode ser correlacional, não causal.'],
    it: ['La lacuna può dipendere dalla copertura locale del corpus e non da una lacuna reale del campo.', 'La relazione proposta può essere correlazionale, non causale.'],
    tr: ['Boşluk, alandaki gerçek bir eksiklikten çok derlemin yerel kapsamıyla ilgili olabilir.', 'Önerilen ilişki nedensel değil, korelasyonel olabilir.'],
  };
  return [base, ...rest[lang]];
}

function nextStepsFor(seed: DraftSeed, mode: HypothesisLabMode, lang: PromptLanguage): string[] {
  const copy: Record<PromptLanguage, { open: string; idea: string; search: string; compare: string }> = {
    es: { open: 'Abrir el hueco y revisar su evidencia textual original.', idea: 'Buscar una idea del grafo que funcione como mecanismo central.', search: 'Buscar pasajes adicionales y contraejemplos antes de convertirla en argumento de capítulo.', compare: 'Elegir 2-4 casos comparables y construir una matriz de diferencias.' },
    en: { open: 'Open the gap and review its original textual evidence.', idea: 'Find a graph idea that can work as the central mechanism.', search: 'Search for additional passages and counterexamples before turning it into a chapter argument.', compare: 'Choose 2-4 comparable cases and build a difference matrix.' },
    fr: { open: 'Ouvrir la lacune et examiner ses éléments textuels d’origine.', idea: 'Trouver une idée du graphe qui puisse servir de mécanisme central.', search: 'Rechercher des passages supplémentaires et des contre-exemples avant d’en faire un argument de chapitre.', compare: 'Choisir 2 à 4 cas comparables et construire une matrice des différences.' },
    de: { open: 'Die Lücke öffnen und ihre ursprünglichen Textbelege prüfen.', idea: 'Eine Graphidee suchen, die als zentraler Mechanismus dienen kann.', search: 'Zusätzliche Passagen und Gegenbeispiele suchen, bevor daraus ein Kapitelargument wird.', compare: '2–4 vergleichbare Fälle auswählen und eine Differenzmatrix erstellen.' },
    pt: { open: 'Abrir a lacuna e rever a sua evidência textual original.', idea: 'Encontrar uma ideia do grafo que possa funcionar como mecanismo central.', search: 'Procurar passagens adicionais e contraexemplos antes de a transformar num argumento de capítulo.', compare: 'Escolher 2–4 casos comparáveis e construir uma matriz de diferenças.' },
    'pt-BR': { open: 'Abrir a lacuna e revisar sua evidência textual original.', idea: 'Encontrar uma ideia do grafo que possa funcionar como mecanismo central.', search: 'Buscar passagens adicionais e contraexemplos antes de transformá-la em argumento de capítulo.', compare: 'Escolher 2–4 casos comparáveis e construir uma matriz de diferenças.' },
    it: { open: 'Aprire la lacuna e rivedere le sue prove testuali originali.', idea: 'Trovare un’idea del grafo che possa fungere da meccanismo centrale.', search: 'Cercare passaggi aggiuntivi e controesempi prima di trasformarla in un argomento di capitolo.', compare: 'Scegliere 2–4 casi comparabili e costruire una matrice delle differenze.' },
    tr: { open: 'Boşluğu açıp özgün metinsel kanıtını inceleyin.', idea: 'Merkezî mekanizma olarak işleyebilecek bir grafik fikri bulun.', search: 'Bölüm argümanına dönüştürmeden önce ek pasajlar ve karşı örnekler arayın.', compare: '2–4 karşılaştırılabilir vaka seçip farklar matrisi oluşturun.' },
  };
  const labels = copy[lang];
  return [
    labels.open,
    seed.idea
      ? ({ es: `Revisar la idea "${seed.idea.label}" en el grafo y sus obras principales.`, en: `Review the idea "${seed.idea.label}" in the graph and its main works.`, fr: `Examiner l’idée « ${seed.idea.label} » dans le graphe et ses principaux ouvrages.`, de: `Die Idee „${seed.idea.label}“ im Graphen und ihre wichtigsten Werke prüfen.`, pt: `Rever a ideia “${seed.idea.label}” no grafo e as suas principais obras.`, 'pt-BR': `Revisar a ideia “${seed.idea.label}” no grafo e suas principais obras.`, it: `Rivedere l’idea «${seed.idea.label}» nel grafo e le opere principali.`, tr: `“${seed.idea.label}” fikrini grafikte ve temel eserlerinde inceleyin.` }[lang])
      : labels.idea,
    mode === 'comparative'
      ? labels.compare
      : labels.search,
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

function firstUseful(values: string[], fallback: string): string {
  const clean = values.find((value) => value.trim().length > 2);
  return clean?.trim() || clip(fallback, 80) || 'Nodus';
}

function sourceLabel(authors: string[], year: number | null, fallback: string, language: PromptLanguage = 'es'): string {
  const first = authors[0]?.trim();
  if (!first && !year) return clip(fallback, 70);
  const noAuthor = localized(language, { es: 's.a.', en: 'n.d.', fr: 's. d.', de: 'o. V.', pt: 's.d.', 'pt-BR': 's.d.', it: 's.d.', tr: 't.y.' });
  return `${first ?? noAuthor}${year ? ` (${year})` : ''}`;
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

function localized<T extends Record<PromptLanguage, string>>(lang: PromptLanguage | undefined, values: T): string {
  return values[lang ?? 'es'] ?? values.es;
}
