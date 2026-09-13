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
      'zh-Hans': '未检测到缺口：实验室需要深度扫描才能提出有力的假设。', 'zh-Hant': '未偵測到缺口：實驗室需要深度掃描才能提出有力的假設。', vi: 'Không phát hiện khoảng trống: phòng thí nghiệm cần quét chuyên sâu để đề xuất giả thuyết vững chắc.', ja: 'ギャップが検出されませんでした。実験室が強力な仮説を提案するには、詳細なスキャンが必要です。', ru: 'Разрывы не обнаружены: для выдвижения сильных гипотез лаборатории необходимы глубокие сканирования.', uk: 'Розривів не виявлено: щоб запропонувати сильні гіпотези, лабораторії потрібні глибокі сканування.', ko: '갭이 감지되지 않았습니다. 실험실이 강력한 가설을 제안하려면 심층 스캔이 필요합니다.',
    }));
  }
  if (!request.objective.trim()) {
    warnings.push(localized(request.language, {
      es: 'Sin objetivo escrito, la priorización usa solo señales generales del corpus.', en: 'Without a written objective, prioritization uses only broad corpus signals.', fr: 'Sans objectif écrit, la priorisation utilise uniquement les signaux généraux du corpus.', de: 'Ohne schriftliches Ziel stützt sich die Priorisierung nur auf allgemeine Korpussignale.', pt: 'Sem um objetivo escrito, a priorização usa apenas sinais gerais do corpus.', 'pt-BR': 'Sem um objetivo escrito, a priorização usa apenas sinais gerais do corpus.', it: 'Senza un obiettivo scritto, la priorità usa soltanto segnali generali del corpus.', tr: 'Yazılı bir hedef olmadan önceliklendirme yalnızca derlemin genel sinyallerini kullanır.',
      'zh-Hans': '没有书面目标时，优先级排序仅使用语料库的总体信号。', 'zh-Hant': '沒有書面目標時，優先級排序僅使用語料庫的整體訊號。', vi: 'Nếu không có mục tiêu bằng văn bản, việc ưu tiên chỉ dựa trên các tín hiệu chung của ngữ liệu.', ja: '目標が文書化されていない場合、優先順位付けはコーパス全体のシグナルのみを使用します。', ru: 'Без письменной цели приоритизация опирается только на общие сигналы корпуса.', uk: 'Без письмової мети пріоритезація спирається лише на загальні сигнали корпусу.', ko: '작성된 목표가 없으면 우선순위 지정은 코퍼스의 일반적인 신호만 사용합니다.',
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
  const language: PromptLanguage = requestedLanguage && ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr', 'zh-Hans', 'zh-Hant', 'vi', 'ja', 'ru', 'uk', 'ko'].includes(requestedLanguage)
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
  const caseLabel = seed.work ? sourceLabel(seed.work.authors, seed.work.year, seed.work.title, lang) : localized(lang, { es: 'el corpus', en: 'the corpus', fr: 'le corpus', de: 'das Korpus', pt: 'o corpus', 'pt-BR': 'o corpus', it: 'il corpus', tr: 'derlem', 'zh-Hans': '语料库', 'zh-Hant': '語料庫', vi: 'ngữ liệu', ja: 'コーパス', ru: 'корпус', uk: 'корпус', ko: '코퍼스' });
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
      description: ({ es: 'Núcleo conceptual recuperado del corpus y conectado con el hueco.', en: 'Core concept retrieved from the corpus and connected to the gap.', fr: 'Noyau conceptuel extrait du corpus et relié à la lacune.', de: 'Aus dem Korpus gewonnenes und mit der Lücke verbundenes Konzept.', pt: 'Núcleo conceptual recuperado do corpus e ligado à lacuna.', 'pt-BR': 'Núcleo conceitual recuperado do corpus e conectado à lacuna.', it: 'Nucleo concettuale ricavato dal corpus e collegato alla lacuna.', tr: 'Derlemden çıkarılan ve boşlukla ilişkilendirilen kavramsal çekirdek.', 'zh-Hans': '从语料库中提取并与缺口相关联的核心概念。', 'zh-Hant': '從語料庫中擷取並與缺口相關聯的核心概念。', vi: 'Khái niệm cốt lõi được trích xuất từ ngữ liệu và kết nối với khoảng trống.', ja: 'コーパスから抽出され、ギャップに関連付けられた中核概念。', ru: 'Ключевое понятие, извлечённое из корпуса и связанное с разрывом.', uk: 'Ключове поняття, вилучене з корпусу та пов’язане з розривом.', ko: '코퍼스에서 추출되어 갭과 연결된 핵심 개념입니다.' } as Record<PromptLanguage, string>)[lang],
    },
    {
      name: clip(seed.gap.statement, 72),
      role: 'outcome',
      description: ({ es: 'Problema todavía insuficientemente explicado o comprobado.', en: 'Problem not yet sufficiently explained or tested.', fr: 'Problème encore insuffisamment expliqué ou vérifié.', de: 'Noch nicht hinreichend erklärtes oder geprüftes Problem.', pt: 'Problema ainda insuficientemente explicado ou testado.', 'pt-BR': 'Problema ainda insuficientemente explicado ou testado.', it: 'Problema non ancora spiegato o verificato a sufficienza.', tr: 'Henüz yeterince açıklanmamış veya sınanmamış sorun.', 'zh-Hans': '尚未得到充分解释或检验的问题。', 'zh-Hant': '尚未獲得充分解釋或檢驗的問題。', vi: 'Vấn đề chưa được giải thích hoặc kiểm chứng đầy đủ.', ja: 'まだ十分に説明または検証されていない問題。', ru: 'Проблема, ещё не получившая достаточного объяснения или проверки.', uk: 'Проблема, яка ще не отримала достатнього пояснення або перевірки.', ko: '아직 충분히 설명되거나 검증되지 않은 문제입니다.' } as Record<PromptLanguage, string>)[lang],
    },
  ];
  if (seed.work) {
    shared.push({
      name: seed.work.title,
      role: 'context',
      description: ({ es: 'Caso, tradición o corpus donde aparece la señal inicial.', en: 'Case, tradition or corpus where the initial signal appears.', fr: 'Cas, tradition ou corpus où apparaît le signal initial.', de: 'Fall, Tradition oder Korpus, in dem das Ausgangssignal auftritt.', pt: 'Caso, tradição ou corpus onde surge o sinal inicial.', 'pt-BR': 'Caso, tradição ou corpus onde surge o sinal inicial.', it: 'Caso, tradizione o corpus in cui compare il segnale iniziale.', tr: 'İlk sinyalin ortaya çıktığı vaka, gelenek veya derlem.', 'zh-Hans': '初始信号出现的案例、传统或语料库。', 'zh-Hant': '初始訊號出現的案例、傳統或語料庫。', vi: 'Trường hợp, truyền thống hoặc ngữ liệu nơi tín hiệu ban đầu xuất hiện.', ja: '初期シグナルが現れる事例、伝統、またはコーパス。', ru: 'Случай, традиция или корпус, где проявляется исходный сигнал.', uk: 'Випадок, традиція або корпус, де з’являється початковий сигнал.', ko: '초기 신호가 나타나는 사례, 전통 또는 코퍼스입니다.' } as Record<PromptLanguage, string>)[lang],
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
    'zh-Hans': { causal: `如果${theme}塑造了在${caseLabel}中发现的条件，那么它应能解释为何${gap}。`, comparative: `${theme}应因各语料库解决缺口的方式不同而在案例之间呈现差异：${gap}。`, methodological: `以${theme}为中心的方法可使缺口变得可观察、可检验：${gap}。`, intervention: `针对${theme}的干预应能减轻或厘清尚未解决的问题：${gap}。`, exploratory: `${theme}是解释未解决缺口的一个合理机制：${gap}。` },
    'zh-Hant': { causal: `如果${theme}塑造了在${caseLabel}中發現的條件，那麼它應能解釋為何${gap}。`, comparative: `${theme}應因各語料庫解決缺口的方式不同而在案例之間呈現差異：${gap}。`, methodological: `以${theme}為中心的方法可使缺口變得可觀察、可檢驗：${gap}。`, intervention: `針對${theme}的干預應能減輕或釐清尚未解決的問題：${gap}。`, exploratory: `${theme}是解釋未解決缺口的一個合理機制：${gap}。` },
    vi: { causal: `Nếu ${theme} định hình các điều kiện được nhận diện trong ${caseLabel}, thì nó phải giải thích vì sao ${gap}.`, comparative: `${theme} phải biến thiên giữa các trường hợp tùy theo cách mỗi ngữ liệu giải quyết khoảng trống: ${gap}.`, methodological: `Một phương pháp lấy ${theme} làm trung tâm có thể khiến khoảng trống trở nên quan sát được và có thể kiểm chứng: ${gap}.`, intervention: `Một can thiệp nhắm vào ${theme} phải làm giảm hoặc làm rõ vấn đề chưa được giải quyết: ${gap}.`, exploratory: `${theme} là một cơ chế khả dĩ để giải thích khoảng trống chưa được giải quyết: ${gap}.` },
    ja: { causal: `もし${theme}が${caseLabel}で確認された条件を形成しているなら、なぜ${gap}のかを説明できるはずです。`, comparative: `${theme}は、各コーパスがギャップをどう解決するかに応じて、事例間で変動するはずです：${gap}。`, methodological: `${theme}を中心とした方法は、ギャップを観察可能かつ検証可能にすることができます：${gap}。`, intervention: `${theme}を対象とした介入は、未解決の問題を軽減または明確化するはずです：${gap}。`, exploratory: `${theme}は、未解決のギャップを説明する妥当なメカニズムです：${gap}。` },
    ru: { causal: `Если ${theme} определяет условия, наблюдаемые в «${caseLabel}», то это должно объяснять, почему ${gap}.`, comparative: `${theme} должна варьироваться между случаями в зависимости от того, как каждый корпус решает разрыв: ${gap}.`, methodological: `Метод, сосредоточенный на ${theme}, может сделать разрыв наблюдаемым и проверяемым: ${gap}.`, intervention: `Вмешательство, направленное на ${theme}, должно уменьшить или прояснить нерешённую проблему: ${gap}.`, exploratory: `${theme} — правдоподобный механизм объяснения нерешённого разрыва: ${gap}.` },
    uk: { causal: `Якщо ${theme} визначає умови, спостережувані в «${caseLabel}», то це має пояснювати, чому ${gap}.`, comparative: `${theme} має варіюватися між випадками залежно від того, як кожен корпус розв’язує розрив: ${gap}.`, methodological: `Метод, зосереджений на ${theme}, може зробити розрив спостережуваним і перевірним: ${gap}.`, intervention: `Втручання, спрямоване на ${theme}, має зменшити або прояснити невирішену проблему: ${gap}.`, exploratory: `${theme} — правдоподібний механізм пояснення невирішеного розриву: ${gap}.` },
    ko: { causal: `${theme}가 ${caseLabel}에서 확인된 조건을 형성한다면, 왜 ${gap}인지 설명할 수 있어야 합니다.`, comparative: `${theme}는 각 코퍼스가 갭을 해결하는 방식에 따라 사례마다 달라져야 합니다: ${gap}.`, methodological: `${theme}에 초점을 둔 방법은 갭을 관찰 가능하고 검증 가능하게 만들 수 있습니다: ${gap}.`, intervention: `${theme}를 대상으로 한 개입은 미해결 문제를 줄이거나 명확히 해야 합니다: ${gap}.`, exploratory: `${theme}는 미해결 갭을 설명하는 그럴듯한 메커니즘입니다: ${gap}.` },
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
    'zh-Hans': { causal: '因果假设', comparative: '比较假设', methodological: '方法论假设', intervention: '干预假设', exploratory: '探索性假设' },
    'zh-Hant': { causal: '因果假設', comparative: '比較假設', methodological: '方法論假設', intervention: '干預假設', exploratory: '探索性假設' },
    vi: { causal: 'Giả thuyết nhân quả', comparative: 'Giả thuyết so sánh', methodological: 'Giả thuyết phương pháp luận', intervention: 'Giả thuyết can thiệp', exploratory: 'Giả thuyết khám phá' },
    ja: { causal: '因果仮説', comparative: '比較仮説', methodological: '方法論的仮説', intervention: '介入仮説', exploratory: '探索的仮説' },
    ru: { causal: 'Причинная гипотеза', comparative: 'Сравнительная гипотеза', methodological: 'Методологическая гипотеза', intervention: 'Гипотеза вмешательства', exploratory: 'Поисковая гипотеза' },
    uk: { causal: 'Причинна гіпотеза', comparative: 'Порівняльна гіпотеза', methodological: 'Методологічна гіпотеза', intervention: 'Гіпотеза втручання', exploratory: 'Пошукова гіпотеза' },
    ko: { causal: '인과 가설', comparative: '비교 가설', methodological: '방법론적 가설', intervention: '개입 가설', exploratory: '탐색적 가설' },
  };
  return labels[lang][mode];
}

function rationaleFor(seed: DraftSeed, lang: PromptLanguage): string {
  const source = seed.work ? sourceLabel(seed.work.authors, seed.work.year, seed.work.title, lang) : localized(lang, { es: 'una obra del corpus', en: 'one corpus work', fr: 'un ouvrage du corpus', de: 'ein Werk des Korpus', pt: 'uma obra do corpus', 'pt-BR': 'uma obra do corpus', it: 'un’opera del corpus', tr: 'derlemden bir eser', 'zh-Hans': '一部语料库作品', 'zh-Hant': '一部語料庫作品', vi: 'một công trình trong ngữ liệu', ja: 'コーパス内の一作品', ru: 'одна работа из корпуса', uk: 'одна праця з корпусу', ko: '코퍼스의 한 저작' });
  const idea = seed.idea ? seed.idea.label : localized(lang, { es: 'una línea conceptual cercana', en: 'a nearby conceptual line', fr: 'une ligne conceptuelle proche', de: 'eine nahegelegene Konzeptlinie', pt: 'uma linha conceptual próxima', 'pt-BR': 'uma linha conceitual próxima', it: 'una linea concettuale vicina', tr: 'yakın bir kavramsal çizgi', 'zh-Hans': '一条相近的概念线索', 'zh-Hant': '一條相近的概念線索', vi: 'một dòng khái niệm gần gũi', ja: '近接する概念の筋', ru: 'близкая концептуальная линия', uk: 'близька концептуальна лінія', ko: '인접한 개념 계열' });
  return ({
    es: `El candidato parte de un hueco detectado en ${source} y lo conecta con ${idea}. Su valor es convertir un problema abierto en una proposición contrastable mediante casos, pasajes o comparación adicional.`,
    en: `The candidate starts from a gap detected in ${source} and connects it with ${idea}. Its value is that it converts an open problem into a claim that can be tested with further cases, passages or comparison.`,
    fr: `La proposition part d’une lacune détectée dans ${source} et la relie à ${idea}. Elle transforme ainsi un problème ouvert en proposition vérifiable par d’autres cas, passages ou comparaisons.`,
    de: `Der Kandidat geht von einer in ${source} erkannten Lücke aus und verbindet sie mit ${idea}. So wird ein offenes Problem in eine anhand weiterer Fälle, Passagen oder Vergleiche prüfbare Aussage überführt.`,
    pt: `A proposta parte de uma lacuna detetada em ${source} e liga-a a ${idea}. O seu valor está em transformar um problema aberto numa afirmação testável com mais casos, passagens ou comparação.`,
    'pt-BR': `A proposta parte de uma lacuna detectada em ${source} e a conecta a ${idea}. Seu valor é transformar um problema aberto em uma afirmação que pode ser testada com novos casos, passagens ou comparação.`,
    it: `La proposta parte da una lacuna individuata in ${source} e la collega a ${idea}. Il suo valore è trasformare un problema aperto in un’affermazione verificabile con ulteriori casi, passaggi o confronti.`,
    tr: `Aday, ${source} içinde tespit edilen bir boşluktan yola çıkar ve bunu ${idea} ile ilişkilendirir. Böylece açık bir sorunu yeni vakalar, pasajlar veya karşılaştırmalarla sınanabilecek bir iddiaya dönüştürür.`,
    'zh-Hans': `该候选假设从${source}中检测到的缺口出发，并将其与${idea}联系起来。其价值在于将一个开放性问题转化为可通过更多案例、段落或比较加以检验的命题。`,
    'zh-Hant': `該候選假設從${source}中偵測到的缺口出發，並將其與${idea}連結起來。其價值在於將一個開放性問題轉化為可透過更多案例、段落或比較加以檢驗的命題。`,
    vi: `Ứng viên xuất phát từ một khoảng trống được phát hiện trong ${source} và kết nối khoảng trống đó với ${idea}. Giá trị của nó nằm ở việc chuyển một vấn đề mở thành một luận điểm có thể kiểm chứng bằng các trường hợp, đoạn văn hoặc so sánh bổ sung.`,
    ja: `この候補は、${source}で検出されたギャップを出発点とし、それを${idea}と結び付けます。その価値は、未解決の問題を、さらなる事例・箇所・比較によって検証可能な命題へと変える点にあります。`,
    ru: `Кандидат исходит из разрыва, обнаруженного в ${source}, и связывает его с ${idea}. Его ценность в том, что он превращает открытую проблему в утверждение, проверяемое на дополнительных случаях, фрагментах или сравнениях.`,
    uk: `Кандидат виходить із розриву, виявленого в ${source}, і пов’язує його з ${idea}. Його цінність полягає в тому, що він перетворює відкриту проблему на твердження, яке можна перевірити на додаткових випадках, фрагментах або порівняннях.`,
    ko: `이 후보는 ${source}에서 감지된 갭에서 출발하여 이를 ${idea}와 연결합니다. 그 가치는 열린 문제를 추가 사례, 구절 또는 비교를 통해 검증할 수 있는 주장으로 전환한다는 데 있습니다.`,
  } as Record<PromptLanguage, string>)[lang];
}

function abstractFor(seed: DraftSeed, hypothesis: string, project: HypothesisProjectSource | null, lang: PromptLanguage): string {
  const projectLine = project ? ({
    es: `La hipótesis puede incorporarse al proyecto "${project.title}" como eje de contribución o apartado de discusión.`, en: `The hypothesis can be folded into "${project.title}" as a contribution axis or discussion section.`, fr: `L’hypothèse peut être intégrée au projet « ${project.title} » comme axe de contribution ou section de discussion.`, de: `Die Hypothese kann in das Projekt „${project.title}“ als Beitragsachse oder Diskussionsabschnitt aufgenommen werden.`, pt: `A hipótese pode ser integrada no projeto “${project.title}” como eixo de contribuição ou secção de discussão.`, 'pt-BR': `A hipótese pode ser incorporada ao projeto “${project.title}” como eixo de contribuição ou seção de discussão.`, it: `L’ipotesi può essere inserita nel progetto «${project.title}» come asse del contributo o sezione di discussione.`, tr: `Hipotez, “${project.title}” projesine katkı ekseni veya tartışma bölümü olarak eklenebilir.`,
    'zh-Hans': `该假设可作为贡献主线或讨论章节纳入项目“${project.title}”。`,
    'zh-Hant': `該假設可作為貢獻主軸或討論章節納入專案「${project.title}」。`,
    vi: `Giả thuyết có thể được đưa vào "${project.title}" như một trục đóng góp hoặc một mục thảo luận.`,
    ja: `この仮説は、貢献の軸または議論の節として「${project.title}」に組み込むことができます。`,
    ru: `Гипотезу можно включить в «${project.title}» в качестве оси вклада или раздела обсуждения.`,
    uk: `Гіпотезу можна включити до «${project.title}» як вісь внеску або розділ обговорення.`,
    ko: `이 가설은 기여 축 또는 논의 섹션으로서 "${project.title}"에 포함될 수 있습니다.`,
  } as Record<PromptLanguage, string>)[lang] : ({
    es: 'La hipótesis puede guardarse como nota y después promoverse a un proyecto o borrador.', en: 'The hypothesis can be saved as a note and later promoted into a project or draft.', fr: 'L’hypothèse peut être enregistrée comme note, puis intégrée à un projet ou à un brouillon.', de: 'Die Hypothese kann als Notiz gespeichert und später in ein Projekt oder einen Entwurf überführt werden.', pt: 'A hipótese pode ser guardada como nota e depois promovida a um projeto ou rascunho.', 'pt-BR': 'A hipótese pode ser salva como nota e depois promovida a um projeto ou rascunho.', it: 'L’ipotesi può essere salvata come nota e poi inserita in un progetto o in una bozza.', tr: 'Hipotez not olarak kaydedilip daha sonra bir projeye veya taslağa aktarılabilir.',
    'zh-Hans': '该假设可以保存为笔记，之后再提升为项目或草稿。',
    'zh-Hant': '該假設可以儲存為筆記，之後再提升為專案或草稿。',
    vi: 'Giả thuyết có thể được lưu dưới dạng ghi chú và sau đó nâng cấp thành dự án hoặc bản nháp.',
    ja: 'この仮説はノートとして保存し、後でプロジェクトや草稿に昇格させることができます。',
    ru: 'Гипотезу можно сохранить как заметку и позже преобразовать в проект или черновик.',
    uk: 'Гіпотезу можна зберегти як нотатку й згодом перетворити на проєкт або чернетку.',
    ko: '이 가설은 노트로 저장한 뒤 나중에 프로젝트나 초안으로 승격할 수 있습니다.',
  } as Record<PromptLanguage, string>)[lang];
  const supportLine = seed.idea ? ({
    es: `El punto de partida es el hueco "${clip(seed.gap.statement, 160)}", apoyado por la idea "${seed.idea.label}".`, en: `The starting point is the gap "${clip(seed.gap.statement, 160)}", supported by the idea "${seed.idea.label}".`, fr: `Le point de départ est la lacune « ${clip(seed.gap.statement, 160)} », étayée par l’idée « ${seed.idea.label} ».`, de: `Ausgangspunkt ist die Lücke „${clip(seed.gap.statement, 160)}“, gestützt durch die Idee „${seed.idea.label}“.`, pt: `O ponto de partida é a lacuna “${clip(seed.gap.statement, 160)}”, apoiada pela ideia “${seed.idea.label}”.`, 'pt-BR': `O ponto de partida é a lacuna “${clip(seed.gap.statement, 160)}”, apoiada pela ideia “${seed.idea.label}”.`, it: `Il punto di partenza è la lacuna «${clip(seed.gap.statement, 160)}», sostenuta dall’idea «${seed.idea.label}».`, tr: `Başlangıç noktası, “${seed.gap.statement}” boşluğudur; bu boşluk “${seed.idea.label}” fikriyle desteklenir.`,
    'zh-Hans': `起点是缺口“${clip(seed.gap.statement, 160)}”，并由理念“${seed.idea.label}”支持。`,
    'zh-Hant': `起點是缺口「${clip(seed.gap.statement, 160)}」，並由理念「${seed.idea.label}」支持。`,
    vi: `Điểm khởi đầu là khoảng trống "${clip(seed.gap.statement, 160)}", được hỗ trợ bởi ý tưởng "${seed.idea.label}".`,
    ja: `出発点はギャップ「${clip(seed.gap.statement, 160)}」であり、理念「${seed.idea.label}」に支えられています。`,
    ru: `Отправная точка — разрыв «${clip(seed.gap.statement, 160)}», подкреплённый идеей «${seed.idea.label}».`,
    uk: `Відправна точка — розрив «${clip(seed.gap.statement, 160)}», підкріплений ідеєю «${seed.idea.label}».`,
    ko: `출발점은 갭 "${clip(seed.gap.statement, 160)}"이며, 이는 아이디어 "${seed.idea.label}"의 뒷받침을 받습니다.`,
  } as Record<PromptLanguage, string>)[lang] : ({
    es: `El punto de partida es el hueco "${clip(seed.gap.statement, 160)}", apoyado por material cercano del corpus.`, en: `The starting point is the gap "${clip(seed.gap.statement, 160)}", supported by nearby corpus material.`, fr: `Le point de départ est la lacune « ${clip(seed.gap.statement, 160)} », étayée par des éléments proches du corpus.`, de: `Ausgangspunkt ist die Lücke „${clip(seed.gap.statement, 160)}“, gestützt durch verwandtes Korpusmaterial.`, pt: `O ponto de partida é a lacuna “${clip(seed.gap.statement, 160)}”, apoiada por material próximo do corpus.`, 'pt-BR': `O ponto de partida é a lacuna “${clip(seed.gap.statement, 160)}”, apoiada por material próximo do corpus.`, it: `Il punto di partenza è la lacuna «${clip(seed.gap.statement, 160)}», sostenuta da materiale vicino del corpus.`, tr: `Başlangıç noktası, derleme ait yakın malzemeyle desteklenen “${clip(seed.gap.statement, 160)}” boşluğudur.`,
    'zh-Hans': `起点是缺口“${clip(seed.gap.statement, 160)}”，并由语料库中的邻近材料支持。`,
    'zh-Hant': `起點是缺口「${clip(seed.gap.statement, 160)}」，並由語料庫中的鄰近材料支持。`,
    vi: `Điểm khởi đầu là khoảng trống "${clip(seed.gap.statement, 160)}", được hỗ trợ bởi tài liệu lân cận trong ngữ liệu.`,
    ja: `出発点はギャップ「${clip(seed.gap.statement, 160)}」であり、コーパス内の近接資料に支えられています。`,
    ru: `Отправная точка — разрыв «${clip(seed.gap.statement, 160)}», подкреплённый близким материалом корпуса.`,
    uk: `Відправна точка — розрив «${clip(seed.gap.statement, 160)}», підкріплений близьким матеріалом корпусу.`,
    ko: `출발점은 갭 "${clip(seed.gap.statement, 160)}"이며, 코퍼스의 인접 자료가 이를 뒷받침합니다.`,
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
    'zh-Hans': {
      exploratory: ['对已索引段落的定向审读', '对存在类似缺口的作品进行理论抽样', `对“${theme}”进行主题编码`],
      causal: ['机制与结果的显式因果模型', '正例/反例比较', '在争论中寻找反例'],
      comparative: ['跨作者/案例的比较矩阵', '控制年代顺序与理论传统', '对矛盾的交叉阅读'],
      methodological: ['变量的操作化', '可复现的编码方案', '以文本段落进行验证'],
      intervention: ['干预或建议方案的设计', '可观察的成功标准', '前后对比或组间对比'],
    },
    'zh-Hant': {
      exploratory: ['對已索引段落的定向審讀', '對存在類似缺口的作品進行理論抽樣', `對「${theme}」進行主題編碼`],
      causal: ['機制與結果的顯式因果模型', '正例/反例比較', '在爭論中尋找反例'],
      comparative: ['跨作者/案例的比較矩陣', '控制年代順序與理論傳統', '對矛盾的交叉閱讀'],
      methodological: ['變數的操作化', '可重現的編碼方案', '以文本段落進行驗證'],
      intervention: ['干預或建議方案的設計', '可觀察的成功標準', '前後對比或組間對比'],
    },
    vi: {
      exploratory: ['Rà soát có trọng tâm các đoạn đã được lập chỉ mục', 'Lấy mẫu lý thuyết từ các công trình có khoảng trống tương tự', `Mã hóa chủ đề "${theme}"`],
      causal: ['Mô hình nhân quả tường minh về cơ chế và kết quả', 'So sánh trường hợp tích cực/tiêu cực', 'Tìm kiếm phản ví dụ trong các tranh luận'],
      comparative: ['Ma trận so sánh giữa các tác giả/trường hợp', 'Kiểm soát niên đại và truyền thống lý thuyết', 'Đọc chéo các mâu thuẫn'],
      methodological: ['Thao tác hóa các biến', 'Quy trình mã hóa có thể tái lập', 'Kiểm chứng bằng các đoạn văn bản'],
      intervention: ['Thiết kế can thiệp hoặc khuyến nghị', 'Tiêu chí thành công có thể quan sát', 'Đối chiếu trước/sau hoặc giữa các nhóm'],
    },
    ja: {
      exploratory: ['索引付けされた箇所の集中的なレビュー', '類似のギャップを持つ作品の理論的サンプリング', `「${theme}」の主題コーディング`],
      causal: ['メカニズムと結果の明示的な因果モデル', 'ポジティブ／ネガティブ事例の比較', '議論の中の反例の探索'],
      comparative: ['著者・事例間の比較マトリクス', '年代順序と理論的伝統の統制', '矛盾のクロスリーディング'],
      methodological: ['変数の操作化', '再現可能なコーディング手順', 'テキスト箇所による検証'],
      intervention: ['介入または提言の設計', '観察可能な成功基準', '前後比較または群間比較'],
    },
    ru: {
      exploratory: ['Целенаправленный обзор проиндексированных фрагментов', 'Теоретическая выборка работ со сходными разрывами', `Тематическое кодирование «${theme}»`],
      causal: ['Явная причинная модель механизма и результата', 'Сравнение положительных и отрицательных случаев', 'Поиск контрпримеров в дискуссиях'],
      comparative: ['Сравнительная матрица по авторам/случаям', 'Контроль хронологии и теоретической традиции', 'Перекрёстное чтение противоречий'],
      methodological: ['Операционализация переменных', 'Воспроизводимый протокол кодирования', 'Валидация по текстовым фрагментам'],
      intervention: ['Разработка вмешательства или рекомендации', 'Наблюдаемые критерии успеха', 'Сопоставление до/после или между группами'],
    },
    uk: {
      exploratory: ['Цілеспрямований огляд проіндексованих фрагментів', 'Теоретична вибірка праць зі схожими розривами', `Тематичне кодування «${theme}»`],
      causal: ['Явна причинна модель механізму та результату', 'Порівняння позитивних і негативних випадків', 'Пошук контрприкладів у дискусіях'],
      comparative: ['Порівняльна матриця за авторами/випадками', 'Контроль хронології та теоретичної традиції', 'Перехресне читання суперечностей'],
      methodological: ['Операціоналізація змінних', 'Відтворюваний протокол кодування', 'Валідація за текстовими фрагментами'],
      intervention: ['Розробка втручання або рекомендації', 'Спостережувані критерії успіху', 'Порівняння до/після або між групами'],
    },
    ko: {
      exploratory: ['색인된 구절에 대한 집중 검토', '유사한 갭이 있는 저작의 이론적 표본 추출', `"${theme}"의 주제 코딩`],
      causal: ['메커니즘과 결과에 대한 명시적 인과 모델', '긍정적/부정적 사례 비교', '논쟁에서의 반례 탐색'],
      comparative: ['저자/사례 간 비교 매트릭스', '연대기와 이론적 전통의 통제', '모순의 교차 읽기'],
      methodological: ['변수 조작화', '재현 가능한 코딩 프로토콜', '텍스트 구절을 통한 검증'],
      intervention: ['개입 또는 권고 설계', '관찰 가능한 성공 기준', '전후 또는 집단 간 대비'],
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
    'zh-Hans': [`带有${theme}更强痕迹的作品，应围绕所提出的机制显示更清晰的证据。`, '不符合假设的案例应聚集在所列的争论或局限周围。', '新的全文段落应要么强化该机制，要么揭示出适用范围条件。'],
    'zh-Hant': [`帶有${theme}更強痕跡的作品，應圍繞所提出的機制顯示更清晰的證據。`, '不符合假設的案例應聚集在所列的爭論或局限周圍。', '新的全文段落應要麼強化該機制，要麼揭示出適用範圍條件。'],
    vi: [`Những công trình có dấu vết ${theme} mạnh hơn phải cho thấy bằng chứng rõ ràng hơn về cơ chế được đề xuất.`, 'Những trường hợp không khớp với giả thuyết phải tập trung quanh các tranh luận hoặc hạn chế đã liệt kê.', 'Các đoạn toàn văn mới phải củng cố cơ chế hoặc bộc lộ một điều kiện phạm vi.'],
    ja: [`${theme}の痕跡がより強い作品は、提案されたメカニズムに関してより明確な証拠を示すはずです。`, '仮説に当てはまらない事例は、列挙された議論や限界の周辺に集まるはずです。', '新しい全文箇所は、メカニズムを強めるか、適用範囲の条件を明らかにするはずです。'],
    ru: [`Работы с более сильными следами ${theme} должны демонстрировать более ясные свидетельства предложенного механизма.`, 'Случаи, не соответствующие гипотезе, должны группироваться вокруг перечисленных дискуссий или ограничений.', 'Новые полнотекстовые фрагменты должны либо укрепить механизм, либо выявить условие области применения.'],
    uk: [`Праці з сильнішими слідами ${theme} мають демонструвати чіткіші свідчення запропонованого механізму.`, 'Випадки, що не відповідають гіпотезі, мають групуватися навколо перелічених дискусій або обмежень.', 'Нові повнотекстові фрагменти мають або підкріпити механізм, або виявити умову сфери застосування.'],
    ko: [`${theme}의 흔적이 더 강한 저작은 제안된 메커니즘에 대해 더 명확한 증거를 보여야 합니다.`, '가설에 맞지 않는 사례는 나열된 논쟁이나 한계 주변에 몰려야 합니다.', '새로운 전문 구절은 메커니즘을 강화하거나 적용 범위 조건을 드러내야 합니다.'],
  };
  return copy[lang];
}

function counterArgumentsFor(seed: DraftSeed, lang: PromptLanguage): string[] {
  const debate = seed.debates[0];
  const base = debate ? {
    es: `Existe una tensión registrada entre "${debate.fromLabel}" y "${debate.toLabel}".`, en: `There is a registered tension between "${debate.fromLabel}" and "${debate.toLabel}".`, fr: `Une tension est enregistrée entre « ${debate.fromLabel} » et « ${debate.toLabel} ».`, de: `Zwischen „${debate.fromLabel}“ und „${debate.toLabel}“ besteht eine dokumentierte Spannung.`, pt: `Existe uma tensão registada entre “${debate.fromLabel}” e “${debate.toLabel}”.`, 'pt-BR': `Há uma tensão registrada entre “${debate.fromLabel}” e “${debate.toLabel}”.`, it: `È registrata una tensione tra «${debate.fromLabel}» e «${debate.toLabel}».`, tr: `“${debate.fromLabel}” ile “${debate.toLabel}” arasında kayıtlı bir gerilim var.`,
    'zh-Hans': `在“${debate.fromLabel}”与“${debate.toLabel}”之间存在已记录的张力。`,
    'zh-Hant': `在「${debate.fromLabel}」與「${debate.toLabel}」之間存在已記錄的張力。`,
    vi: `Có một căng thẳng đã được ghi nhận giữa "${debate.fromLabel}" và "${debate.toLabel}".`,
    ja: `「${debate.fromLabel}」と「${debate.toLabel}」の間には記録された緊張関係があります。`,
    ru: `Между «${debate.fromLabel}» и «${debate.toLabel}» зафиксировано напряжение.`,
    uk: `Між «${debate.fromLabel}» та «${debate.toLabel}» зафіксовано напруження.`,
    ko: `"${debate.fromLabel}"와 "${debate.toLabel}" 사이에 기록된 긴장이 있습니다.`,
  }[lang] : {
    es: 'La hipótesis puede depender de una lectura todavía incompleta del corpus.', en: 'The hypothesis may depend on an incomplete reading of the corpus.', fr: 'L’hypothèse peut dépendre d’une lecture encore incomplète du corpus.', de: 'Die Hypothese könnte von einer noch unvollständigen Korpuslektüre abhängen.', pt: 'A hipótese pode depender de uma leitura ainda incompleta do corpus.', 'pt-BR': 'A hipótese pode depender de uma leitura ainda incompleta do corpus.', it: 'L’ipotesi può dipendere da una lettura ancora incompleta del corpus.', tr: 'Hipotez, derlemin henüz tamamlanmamış bir okumasına dayanıyor olabilir.',
    'zh-Hans': '该假设可能依赖于对语料库尚不完整的阅读。',
    'zh-Hant': '該假設可能依賴於對語料庫尚不完整的閱讀。',
    vi: 'Giả thuyết có thể phụ thuộc vào việc đọc ngữ liệu chưa đầy đủ.',
    ja: 'この仮説は、コーパスのまだ不完全な読解に依存している可能性があります。',
    ru: 'Гипотеза может опираться на неполное прочтение корпуса.',
    uk: 'Гіпотеза може спиратися на неповне прочитання корпусу.',
    ko: '이 가설은 코퍼스에 대한 아직 불완전한 독해에 의존할 수 있습니다.',
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
    'zh-Hans': ['该缺口可能只是语料库的局部覆盖问题，而非该领域真正的空白。', '所提出的关系可能是相关性的，而非因果性的。'],
    'zh-Hant': ['該缺口可能只是語料庫的局部覆蓋問題，而非該領域真正的空白。', '所提出的關係可能是相關性的，而非因果性的。'],
    vi: ['Khoảng trống có thể chỉ là vấn đề độ phủ cục bộ của ngữ liệu chứ không phải một lỗ hổng thực sự của lĩnh vực.', 'Mối quan hệ được đề xuất có thể là tương quan chứ không phải nhân quả.'],
    ja: ['ギャップは、分野に本当に存在する空白ではなく、コーパスの局所的な網羅性の問題である可能性があります。', '提案された関係は因果的ではなく相関的である可能性があります。'],
    ru: ['Разрыв может быть следствием локальной полноты корпуса, а не реальным пробелом в исследовательском поле.', 'Предложенная связь может быть корреляционной, а не причинной.'],
    uk: ['Розрив може бути наслідком локальної повноти корпусу, а не реальною прогалиною в дослідницькій галузі.', 'Запропонований зв\'язок може бути кореляційним, а не причинним.'],
    ko: ['갭은 해당 분야의 실제 공백이 아니라 코퍼스의 국지적 포괄 범위 문제일 수 있습니다.', '제안된 관계는 인과적이기보다 상관적일 수 있습니다.'],
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
    'zh-Hans': { open: '打开该缺口并审阅其原始文本证据。', idea: '寻找一个可作为核心机制的图谱理念。', search: '在将其转化为章节论证之前，搜索更多段落和反例。', compare: '选择 2–4 个可比较的案例并构建差异矩阵。' },
    'zh-Hant': { open: '開啟該缺口並審閱其原始文本證據。', idea: '尋找一個可作為核心機制的圖譜理念。', search: '在將其轉化為章節論證之前，搜尋更多段落和反例。', compare: '選擇 2–4 個可比較的案例並建立差異矩陣。' },
    vi: { open: 'Mở khoảng trống và xem xét bằng chứng văn bản gốc của nó.', idea: 'Tìm một ý tưởng trong đồ thị có thể đóng vai trò cơ chế trung tâm.', search: 'Tìm thêm các đoạn văn và phản ví dụ trước khi chuyển nó thành luận điểm của chương.', compare: 'Chọn 2–4 trường hợp có thể so sánh và xây dựng ma trận khác biệt.' },
    ja: { open: 'ギャップを開き、その元のテキスト証拠を確認します。', idea: '中心的なメカニズムとして機能しうるグラフの理念を探します。', search: '章の論証に変える前に、追加の箇所と反例を探索します。', compare: '比較可能な2–4の事例を選び、差異マトリクスを構築します。' },
    ru: { open: 'Открыть разрыв и изучить его исходные текстовые свидетельства.', idea: 'Найти идею графа, которая может служить центральным механизмом.', search: 'Найти дополнительные фрагменты и контрпримеры, прежде чем превращать это в аргумент главы.', compare: 'Выбрать 2–4 сопоставимых случая и построить матрицу различий.' },
    uk: { open: 'Відкрити розрив і переглянути його вихідні текстові свідчення.', idea: 'Знайти ідею графа, яка може слугувати центральним механізмом.', search: 'Знайти додаткові фрагменти та контрприклади, перш ніж перетворювати це на аргумент розділу.', compare: 'Вибрати 2–4 порівнянні випадки та побудувати матрицю відмінностей.' },
    ko: { open: '갭을 열고 원래의 텍스트 증거를 검토합니다.', idea: '중심 메커니즘으로 작동할 수 있는 그래프 아이디어를 찾습니다.', search: '챕터 논증으로 전환하기 전에 추가 구절과 반례를 검색합니다.', compare: '비교 가능한 사례 2–4개를 선택하고 차이 매트릭스를 구축합니다.' },
  };
  const labels = copy[lang];
  return [
    labels.open,
    seed.idea
      ? ({ es: `Revisar la idea "${seed.idea.label}" en el grafo y sus obras principales.`, en: `Review the idea "${seed.idea.label}" in the graph and its main works.`, fr: `Examiner l’idée « ${seed.idea.label} » dans le graphe et ses principaux ouvrages.`, de: `Die Idee „${seed.idea.label}“ im Graphen und ihre wichtigsten Werke prüfen.`, pt: `Rever a ideia “${seed.idea.label}” no grafo e as suas principais obras.`, 'pt-BR': `Revisar a ideia “${seed.idea.label}” no grafo e suas principais obras.`, it: `Rivedere l’idea «${seed.idea.label}» nel grafo e le opere principali.`, tr: `“${seed.idea.label}” fikrini grafikte ve temel eserlerinde inceleyin.`, 'zh-Hans': `在图谱中审阅“${seed.idea.label}”及其主要作品。`, 'zh-Hant': `在圖譜中審閱「${seed.idea.label}」及其主要作品。`, vi: `Xem xét ý tưởng "${seed.idea.label}" trong đồ thị và các công trình chính của nó.`, ja: `グラフ内の理念「${seed.idea.label}」とその主要作品を確認します。`, ru: `Проверить идею «${seed.idea.label}» в графе и её основные работы.`, uk: `Перевірити ідею «${seed.idea.label}» у графі та її основні праці.`, ko: `그래프에서 "${seed.idea.label}" 아이디어와 그 주요 저작을 검토합니다.` }[lang])
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
  const noAuthor = localized(language, { es: 's.a.', en: 'n.d.', fr: 's. d.', de: 'o. V.', pt: 's.d.', 'pt-BR': 's.d.', it: 's.d.', tr: 't.y.', 'zh-Hans': '无日期', 'zh-Hant': '無日期', vi: 'không rõ năm', ja: '日付なし', ru: 'б. г.', uk: 'б. р.', ko: '연도 미상' });
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
