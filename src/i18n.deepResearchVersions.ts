const KEYS = [
  'Versión del sistema',
  'v1 · Deep Research histórico',
  'Usa el sistema anterior de Deep Research, conservado para comparar resultados y mantener compatibilidad con el flujo histórico.',
  'v2 · Ideas primero y documentos completos',
  'Primero reconstruye ideas, relaciones, debates y huecos. Después amplía la recuperación con los textos completos que pueden aportar evidencia relevante.',
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
    'v1 · Historical Deep Research',
    'Uses the previous Deep Research system, kept for comparing results and preserving compatibility with the historical workflow.',
    'v2 · Ideas first and full documents',
    'First reconstructs ideas, relationships, debates, and gaps. Then broadens retrieval with full texts that can provide relevant evidence.',
    'Press “New report” and enter the question or idea. The report develops only the contributions the corpus can support, with no preset length.',
    'Press “New unit” and enter the topic. Nodus develops the parts your materials can support, with no preset length.',
  ]),
  fr: table([
    'Version du système',
    'v1 · Deep Research historique',
    'Utilise l’ancien système Deep Research, conservé pour comparer les résultats et maintenir la compatibilité avec le flux historique.',
    'v2 · Idées d’abord et documents complets',
    'Reconstruit d’abord les idées, relations, débats et lacunes. Élargit ensuite la recherche aux textes complets pouvant fournir des preuves pertinentes.',
    'Cliquez sur « Nouveau rapport » et saisissez la question ou l’idée. Le rapport développe uniquement ce que le corpus permet d’étayer, sans longueur prédéfinie.',
    'Cliquez sur « Nouvelle unité » et saisissez le sujet. Nodus développe ce que vos documents permettent d’étayer, sans longueur prédéfinie.',
  ]),
  de: table([
    'Systemversion',
    'v1 · Historisches Deep Research',
    'Verwendet das frühere Deep-Research-System, das zum Vergleich der Ergebnisse und zur Kompatibilität mit dem historischen Ablauf erhalten bleibt.',
    'v2 · Ideen zuerst und vollständige Dokumente',
    'Rekonstruiert zuerst Ideen, Beziehungen, Debatten und Lücken. Danach wird die Suche mit vollständigen Texten erweitert, die relevante Belege liefern können.',
    'Klicken Sie auf „Neuer Bericht“ und geben Sie die Frage oder Idee ein. Der Bericht entwickelt nur Beiträge, die der Korpus belegen kann, ohne vorgegebene Länge.',
    'Klicken Sie auf „Neue Einheit“ und geben Sie das Thema ein. Nodus entwickelt nur die Teile, die Ihre Materialien belegen können, ohne vorgegebene Länge.',
  ]),
  pt: table([
    'Versão do sistema',
    'v1 · Deep Research histórico',
    'Usa o sistema anterior do Deep Research, mantido para comparar resultados e preservar a compatibilidade com o fluxo histórico.',
    'v2 · Ideias primeiro e documentos completos',
    'Reconstrói primeiro ideias, relações, debates e lacunas. Depois amplia a recuperação com textos completos que possam fornecer evidência relevante.',
    'Prima «Novo relatório» e escreva a pergunta ou ideia. O relatório desenvolve apenas o que o corpus permite sustentar, sem extensão predefinida.',
    'Prima «Nova unidade» e escreva o tema. O Nodus desenvolve apenas o que os seus materiais permitem sustentar, sem extensão predefinida.',
  ]),
  'pt-BR': table([
    'Versão do sistema',
    'v1 · Deep Research histórico',
    'Usa o sistema anterior do Deep Research, mantido para comparar resultados e preservar a compatibilidade com o fluxo histórico.',
    'v2 · Ideias primeiro e documentos completos',
    'Primeiro reconstrói ideias, relações, debates e lacunas. Depois amplia a recuperação com textos completos que possam fornecer evidências relevantes.',
    'Pressione “Novo relatório” e escreva a pergunta ou ideia. O relatório desenvolve apenas o que o corpus permite sustentar, sem tamanho predefinido.',
    'Pressione “Nova unidade” e escreva o tema. O Nodus desenvolve apenas o que seus materiais permitem sustentar, sem tamanho predefinido.',
  ]),
  it: table([
    'Versione del sistema',
    'v1 · Deep Research storico',
    'Usa il precedente sistema Deep Research, conservato per confrontare i risultati e mantenere la compatibilità con il flusso storico.',
    'v2 · Prima le idee e documenti completi',
    'Ricostruisce prima idee, relazioni, dibattiti e lacune. Poi amplia il recupero con i testi completi che possono fornire prove pertinenti.',
    'Premi “Nuovo rapporto” e inserisci la domanda o l’idea. Il rapporto sviluppa solo ciò che il corpus consente di sostenere, senza una lunghezza prefissata.',
    'Premi “Nuova unità” e inserisci il tema. Nodus sviluppa solo le parti sostenute dai tuoi materiali, senza una lunghezza prefissata.',
  ]),
  tr: table([
    'Sistem sürümü',
    'v1 · Tarihsel Deep Research',
    'Sonuçları karşılaştırmak ve tarihsel akışla uyumluluğu korumak için saklanan önceki Deep Research sistemini kullanır.',
    'v2 · Önce fikirler ve tam belgeler',
    'Önce fikirleri, ilişkileri, tartışmaları ve boşlukları yeniden kurar. Ardından ilgili kanıt sağlayabilecek tam metinlerle erişimi genişletir.',
    '“Yeni rapor”a basıp soruyu veya fikri yazın. Rapor yalnızca derlemin destekleyebildiği katkıları, önceden belirlenmiş bir uzunluk olmadan geliştirir.',
    '“Yeni ünite”ye basıp konuyu yazın. Nodus yalnızca materyallerinizin destekleyebildiği bölümleri, önceden belirlenmiş bir uzunluk olmadan geliştirir.',
  ]),
} as const;
