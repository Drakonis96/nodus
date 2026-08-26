const KEYS = [
  'Versión del sistema',
  'v1 · Recuperación sencilla (por defecto)',
  'Usa las ideas y los pasajes ya extraídos del corpus y no inicia el análisis de documentos completos. Es la opción recomendada para consultas sencillas y normalmente consume menos tokens.',
  'v2 · Análisis ampliado (más tokens)',
  'Consume más tokens. En vaults académicos, parte de ideas y relaciones y puede analizar hasta 8 documentos completos relevantes: analiza los que aún no tienen un perfil completo, regenera los desactualizados y reutiliza los que ya están al día. La primera ejecución puede tener un coste notable.',
  'Pulsa «Nuevo informe» y escribe la pregunta o idea. El informe desarrolla solo las aportaciones que el corpus permite sostener, sin una longitud prefijada.',
  'Pulsa «Nueva unidad» y escribe el tema. Nodus desarrolla las partes que tus materiales permiten sostener, sin una longitud prefijada.',
] as const;

function table(values: readonly string[]): Record<string, string> {
  if (values.length !== KEYS.length) throw new Error('Deep Research version translations are incomplete.');
  return Object.fromEntries(KEYS.map((key, index) => [key, values[index]]));
}

export const DEEP_RESEARCH_VERSION_TRANSLATIONS = {
  en: table([
    'System version',
    'v1 · Simple retrieval (default)',
    'Uses ideas and passages already extracted from the corpus and does not start full-document analysis. It is recommended for simple queries and usually uses fewer tokens.',
    'v2 · Expanded analysis (more tokens)',
    'Uses more tokens. In academic vaults, it starts from ideas and relationships and may analyze up to 8 relevant full documents: it analyzes those without a complete profile, rebuilds outdated profiles, and reuses profiles that are up to date. The first run can have a notable cost.',
    'Press “New report” and enter the question or idea. The report develops only the contributions the corpus can support, with no preset length.',
    'Press “New unit” and enter the topic. Nodus develops the parts your materials can support, with no preset length.',
  ]),
  fr: table([
    'Version du système',
    'v1 · Recherche simple (par défaut)',
    'Utilise les idées et passages déjà extraits du corpus et ne lance pas l’analyse de documents complets. Cette option est recommandée pour les requêtes simples et consomme généralement moins de jetons.',
    'v2 · Analyse étendue (plus de jetons)',
    'Consomme plus de jetons. Dans les coffres académiques, elle part des idées et relations et peut analyser jusqu’à 8 documents complets pertinents : elle analyse ceux qui n’ont pas de profil complet, régénère les profils obsolètes et réutilise ceux qui sont à jour. La première exécution peut avoir un coût notable.',
    'Cliquez sur « Nouveau rapport » et saisissez la question ou l’idée. Le rapport développe uniquement ce que le corpus permet d’étayer, sans longueur prédéfinie.',
    'Cliquez sur « Nouvelle unité » et saisissez le sujet. Nodus développe ce que vos documents permettent d’étayer, sans longueur prédéfinie.',
  ]),
  de: table([
    'Systemversion',
    'v1 · Einfache Suche (Standard)',
    'Verwendet bereits aus dem Korpus extrahierte Ideen und Passagen und startet keine Analyse vollständiger Dokumente. Diese Option wird für einfache Anfragen empfohlen und verbraucht normalerweise weniger Tokens.',
    'v2 · Erweiterte Analyse (mehr Tokens)',
    'Verbraucht mehr Tokens. In akademischen Vaults beginnt sie mit Ideen und Beziehungen und kann bis zu 8 relevante vollständige Dokumente analysieren: Dokumente ohne vollständiges Profil werden analysiert, veraltete Profile neu erstellt und aktuelle Profile wiederverwendet. Der erste Durchlauf kann merkliche Kosten verursachen.',
    'Klicken Sie auf „Neuer Bericht“ und geben Sie die Frage oder Idee ein. Der Bericht entwickelt nur Beiträge, die der Korpus belegen kann, ohne vorgegebene Länge.',
    'Klicken Sie auf „Neue Einheit“ und geben Sie das Thema ein. Nodus entwickelt nur die Teile, die Ihre Materialien belegen können, ohne vorgegebene Länge.',
  ]),
  pt: table([
    'Versão do sistema',
    'v1 · Recuperação simples (predefinição)',
    'Usa ideias e passagens já extraídas do corpus e não inicia a análise de documentos completos. É a opção recomendada para consultas simples e normalmente consome menos tokens.',
    'v2 · Análise ampliada (mais tokens)',
    'Consome mais tokens. Em vaults académicos, parte de ideias e relações e pode analisar até 8 documentos completos relevantes: analisa os que ainda não têm um perfil completo, regenera os desatualizados e reutiliza os que estão atualizados. A primeira execução pode ter um custo considerável.',
    'Prima «Novo relatório» e escreva a pergunta ou ideia. O relatório desenvolve apenas o que o corpus permite sustentar, sem extensão predefinida.',
    'Prima «Nova unidade» e escreva o tema. O Nodus desenvolve apenas o que os seus materiais permitem sustentar, sem extensão predefinida.',
  ]),
  'pt-BR': table([
    'Versão do sistema',
    'v1 · Recuperação simples (padrão)',
    'Usa ideias e trechos já extraídos do corpus e não inicia a análise de documentos completos. É a opção recomendada para consultas simples e normalmente consome menos tokens.',
    'v2 · Análise ampliada (mais tokens)',
    'Consome mais tokens. Em vaults acadêmicos, parte de ideias e relações e pode analisar até 8 documentos completos relevantes: analisa os que ainda não têm um perfil completo, regenera os desatualizados e reutiliza os que estão atualizados. A primeira execução pode ter um custo considerável.',
    'Pressione “Novo relatório” e escreva a pergunta ou ideia. O relatório desenvolve apenas o que o corpus permite sustentar, sem tamanho predefinido.',
    'Pressione “Nova unidade” e escreva o tema. O Nodus desenvolve apenas o que seus materiais permitem sustentar, sem tamanho predefinido.',
  ]),
  it: table([
    'Versione del sistema',
    'v1 · Recupero semplice (predefinito)',
    'Usa idee e passaggi già estratti dal corpus e non avvia l’analisi di documenti completi. È l’opzione consigliata per le richieste semplici e normalmente consuma meno token.',
    'v2 · Analisi estesa (più token)',
    'Consuma più token. Nei vault accademici parte da idee e relazioni e può analizzare fino a 8 documenti completi pertinenti: analizza quelli senza un profilo completo, rigenera i profili obsoleti e riutilizza quelli aggiornati. La prima esecuzione può avere un costo rilevante.',
    'Premi “Nuovo rapporto” e inserisci la domanda o l’idea. Il rapporto sviluppa solo ciò che il corpus consente di sostenere, senza una lunghezza prefissata.',
    'Premi “Nuova unità” e inserisci il tema. Nodus sviluppa solo le parti sostenute dai tuoi materiali, senza una lunghezza prefissata.',
  ]),
  tr: table([
    'Sistem sürümü',
    'v1 · Basit erişim (varsayılan)',
    'Derlemden önceden çıkarılmış fikirleri ve pasajları kullanır; tam belge analizi başlatmaz. Basit sorgular için önerilir ve genellikle daha az token tüketir.',
    'v2 · Genişletilmiş analiz (daha fazla token)',
    'Daha fazla token tüketir. Akademik kasalarda fikirler ve ilişkilerden başlar ve en fazla 8 ilgili tam belgeyi analiz edebilir: eksiksiz profili olmayanları analiz eder, güncel olmayan profilleri yeniden oluşturur ve güncel olanları yeniden kullanır. İlk çalıştırmanın maliyeti kayda değer olabilir.',
    '“Yeni rapor”a basıp soruyu veya fikri yazın. Rapor yalnızca derlemin destekleyebildiği katkıları, önceden belirlenmiş bir uzunluk olmadan geliştirir.',
    '“Yeni ünite”ye basıp konuyu yazın. Nodus yalnızca materyallerinizin destekleyebildiği bölümleri, önceden belirlenmiş bir uzunluk olmadan geliştirir.',
  ]),
} as const;
