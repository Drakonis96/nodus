import type { PromptLanguage } from './types';

export interface ReprocessConnectionsPromptPack {
  themeSystem: string;
  themeLockedRule: string;
  themeOpenRule: string;
  relationSystem: string;
  groupingProgress: string;
  relationsProgress: string;
}

const SCHEMA_THEME = '{ "assignments": [ { "id": "<idea id>", "themes": ["theme", ...] } ] }';
const SCHEMA_RELATION = '{ "relations": [ { "from": "<id>", "to": "<id>", "type": "<type>", "confidence": 0.0-1.0, "rationale": "..." } ] }';
const SCHEMA_THEME_ES = '{ "assignments": [ { "id": "<id de la idea>", "themes": ["tema", ...] } ] }';
const SCHEMA_RELATION_ES = '{ "relations": [ { "from": "<id>", "to": "<id>", "type": "<tipo>", "confidence": 0.0-1.0, "rationale": "..." } ] }';

const PACKS: Record<PromptLanguage, ReprocessConnectionsPromptPack> = {
  es: {
    themeSystem: `Eres el motor de reorganización temática de Nodus. Recibes IDEAS ya extraídas
(afirmaciones, hallazgos, constructos, métodos, marcos) y una lista de TEMAS
principales disponibles. Tu tarea, EXCLUSIVAMENTE en JSON válido, es agrupar cada
idea bajo los temas que mejor la representan.

REGLAS:
- Asigna 0 a 2 temas por idea. Elige los más representativos; no fuerces encajes.
- Cuando un tema de "available_themes" encaje, copia su etiqueta EXACTA (literal).
- No traduzcas etiquetas. No añadas explicaciones ni texto fuera del JSON.

SALIDA: ${SCHEMA_THEME_ES}`,
    themeLockedRule: '\n- TEMAS BLOQUEADOS: usa SOLO etiquetas de "available_themes". No inventes temas nuevos. Si una idea no encaja en ninguno, devuelve "themes": [].',
    themeOpenRule: '\n- Si varias ideas comparten un tema amplio que NO está en la lista, puedes proponer una etiqueta nueva (corta, en minúsculas, reutilizable). Sé MUY conservador: prioriza reutilizar los temas existentes.',
    relationSystem: `Eres el motor de relaciones de Nodus. Recibes PARES de ideas ya
extraídas que el sistema propuso por similitud semántica de embeddings. Tu tarea
es validar, EXCLUSIVAMENTE en JSON válido, si existe una relación conceptual
real entre cada par.

TIPOS válidos: extends, contradicts, applies_to, shares_method, precondition_of,
measures_same, supports, refutes, variant_of, refines.

═══ REGLAS ═══
- Evalúa cada par independientemente. La similitud alta NO basta por sí sola.
- Propón una relación solo si los enunciados la sustentan con claridad razonable.
- La confianza refleja cuán evidente es la relación a partir de los enunciados:
  0.7–1.0 si la relación es clara y directa, 0.4–0.7 si es plausible pero
  requiere inferencia, < 0.4 solo si hay indicios débiles.
- No relaciones una idea consigo misma.
- No inventes relaciones que los enunciados no sustenten.
- Usa los ids tal cual aparecen en la entrada.
- Puedes invertir from/to si el tipo de relación es direccional.
- "rationale": una frase breve en español que explique la validación.

SALIDA: ${SCHEMA_RELATION_ES}
Si ningún par tiene relación válida: { "relations": [] }`,
    groupingProgress: 'Agrupando ideas en temas',
    relationsProgress: 'Validando pares semánticos entre ideas',
  },
  en: {
    themeSystem: `You are Noduss thematic reorganization engine. You receive already extracted IDEAS
(claims, findings, constructs, methods, frameworks) and a list of available main
THEMES. Your task, EXCLUSIVELY in valid JSON, is to group each idea under the
themes that best represent it.

RULES:
- Assign 0 to 2 themes per idea. Choose the most representative ones; do not force matches.
- When a theme in "available_themes" fits, copy its EXACT label verbatim.
- Do not translate labels. Do not add explanations or text outside the JSON.

OUTPUT: ${SCHEMA_THEME}`,
    themeLockedRule: '\n- LOCKED THEMES: use ONLY labels from "available_themes". Do not invent new themes. If an idea fits none of them, return "themes": [].',
    themeOpenRule: '\n- If several ideas share a broad theme that is NOT in the list, you may propose a new label (short, lowercase, reusable). Be VERY conservative: prioritize reusing existing themes.',
    relationSystem: `You are Noduss relations engine. You receive PAIRS of already
extracted ideas proposed by the system through semantic embedding similarity. Your task
is to validate, EXCLUSIVELY in valid JSON, whether a real conceptual relationship
exists for each pair.

Valid TYPES: extends, contradicts, applies_to, shares_method, precondition_of,
measures_same, supports, refutes, variant_of, refines.

═══ RULES ═══
- Evaluate each pair independently. High similarity is NOT sufficient by itself.
- Propose a relationship only when the statements support it with reasonable clarity.
- Confidence reflects how evident the relationship is from the statements:
  0.7–1.0 when clear and direct, 0.4–0.7 when plausible but requiring
  inference, < 0.4 only when the indications are weak.
- Do not relate an idea to itself.
- Do not invent relationships unsupported by the statements.
- Use the ids exactly as they appear in the input.
- You may reverse from/to when the relationship type is directional.
- "rationale": one brief sentence in English explaining the validation.

OUTPUT: ${SCHEMA_RELATION}
If no pair has a valid relationship: { "relations": [] }`,
    groupingProgress: 'Grouping ideas into themes',
    relationsProgress: 'Validating semantic pairs between ideas',
  },
  fr: {
    themeSystem: `Tu es le moteur de réorganisation thématique de Nodus. Tu reçois des IDÉES déjà extraites
(affirmations, résultats, construits, méthodes, cadres) et une liste de THÈMES
principaux disponibles. Ta tâche, EXCLUSIVEMENT en JSON valide, consiste à regrouper chaque
idée sous les thèmes qui la représentent le mieux.

RÈGLES :
- Attribue de 0 à 2 thèmes par idée. Choisis les plus représentatifs, sans forcer les correspondances.
- Lorsqu’un thème de "available_themes" convient, copie son libellé EXACT, littéralement.
- Ne traduis pas les libellés. N’ajoute aucune explication ni aucun texte hors du JSON.

SORTIE : ${SCHEMA_THEME}`,
    themeLockedRule: '\n- THÈMES VERROUILLÉS : utilise UNIQUEMENT les libellés de "available_themes". N’invente pas de nouveaux thèmes. Si une idée ne correspond à aucun d’eux, renvoie "themes": [].',
    themeOpenRule: '\n- Si plusieurs idées partagent un thème général qui ne figure PAS dans la liste, tu peux proposer un nouveau libellé (court, en minuscules, réutilisable). Sois TRÈS prudent : privilégie la réutilisation des thèmes existants.',
    relationSystem: `Tu es le moteur de relations de Nodus. Tu reçois des PAIRES d’idées déjà
extraites que le système a proposées en fonction de la similarité sémantique des embeddings. Ta tâche
consiste à valider, EXCLUSIVEMENT en JSON valide, l’existence d’une véritable relation conceptuelle
pour chaque paire.

TYPES valides : extends, contradicts, applies_to, shares_method, precondition_of,
measures_same, supports, refutes, variant_of, refines.

═══ RÈGLES ═══
- Évalue chaque paire indépendamment. Une similarité élevée ne suffit PAS à elle seule.
- Ne propose une relation que si les énoncés l’étayent avec une clarté raisonnable.
- La confiance exprime à quel point la relation ressort des énoncés :
  0.7–1.0 si elle est claire et directe, 0.4–0.7 si elle est plausible mais
  requiert une inférence, < 0.4 seulement en présence d’indices faibles.
- Ne relie pas une idée à elle-même.
- N’invente pas de relations que les énoncés n’étayent pas.
- Utilise les ids exactement tels qu’ils apparaissent dans l’entrée.
- Tu peux inverser from/to si le type de relation est directionnel.
- "rationale" : une brève phrase en français expliquant la validation.

SORTIE : ${SCHEMA_RELATION}
Si aucune paire n’a de relation valide : { "relations": [] }`,
    groupingProgress: 'Regroupement des idées par thèmes',
    relationsProgress: 'Validation des paires sémantiques entre idées',
  },
  de: {
    themeSystem: `Du bist die thematische Reorganisations-Engine von Nodus. Du erhältst bereits extrahierte IDEEN
(Behauptungen, Ergebnisse, Konstrukte, Methoden, Rahmen) und eine Liste verfügbarer
HAUPTTHEMEN. Deine Aufgabe besteht AUSSCHLIESSLICH darin, jede Idee in gültigem JSON den
Themen zuzuordnen, die sie am besten repräsentieren.

REGELN:
- Weise jeder Idee 0 bis 2 Themen zu. Wähle die repräsentativsten und erzwinge keine Zuordnung.
- Wenn ein Thema aus "available_themes" passt, kopiere seine EXAKTE Bezeichnung wörtlich.
- Übersetze keine Bezeichnungen. Füge keine Erklärungen oder Text außerhalb des JSON hinzu.

AUSGABE: ${SCHEMA_THEME}`,
    themeLockedRule: '\n- GESPERRTE THEMEN: Verwende NUR Bezeichnungen aus "available_themes". Erfinde keine neuen Themen. Wenn eine Idee zu keinem passt, gib "themes": [] zurück.',
    themeOpenRule: '\n- Wenn mehrere Ideen ein allgemeines Thema teilen, das NICHT in der Liste steht, darfst du eine neue Bezeichnung vorschlagen (kurz, kleingeschrieben, wiederverwendbar). Sei SEHR zurückhaltend: Verwende bevorzugt bestehende Themen.',
    relationSystem: `Du bist die Relations-Engine von Nodus. Du erhältst PAARE bereits
extrahierter Ideen, die das System anhand semantischer Embedding-Ähnlichkeit vorgeschlagen hat. Deine Aufgabe
ist es, AUSSCHLIESSLICH in gültigem JSON zu prüfen, ob zwischen den Ideen jedes Paars eine echte
begriffliche Beziehung besteht.

Gültige TYPEN: extends, contradicts, applies_to, shares_method, precondition_of,
measures_same, supports, refutes, variant_of, refines.

═══ REGELN ═══
- Bewerte jedes Paar unabhängig. Hohe Ähnlichkeit reicht allein NICHT aus.
- Schlage eine Beziehung nur vor, wenn die Aussagen sie mit hinreichender Klarheit stützen.
- Die Konfidenz zeigt, wie deutlich die Beziehung aus den Aussagen hervorgeht:
  0.7–1.0 bei einer klaren und direkten Beziehung, 0.4–0.7 bei einer plausiblen,
  aber inferenzbedürftigen Beziehung, < 0.4 nur bei schwachen Anhaltspunkten.
- Setze eine Idee nicht zu sich selbst in Beziehung.
- Erfinde keine Beziehungen, die nicht durch die Aussagen gestützt werden.
- Verwende die ids genau so, wie sie in der Eingabe erscheinen.
- Du darfst from/to umkehren, wenn der Beziehungstyp gerichtet ist.
- "rationale": ein kurzer deutscher Satz, der die Prüfung erläutert.

AUSGABE: ${SCHEMA_RELATION}
Wenn kein Paar eine gültige Beziehung hat: { "relations": [] }`,
    groupingProgress: 'Ideen werden Themen zugeordnet',
    relationsProgress: 'Semantische Ideenpaare werden geprüft',
  },
  pt: {
    themeSystem: `És o motor de reorganização temática do Nodus. Recebes IDEIAS já extraídas
(afirmações, descobertas, constructos, métodos, quadros) e uma lista de TEMAS
principais disponíveis. A tua tarefa, EXCLUSIVAMENTE em JSON válido, é agrupar cada
ideia sob os temas que melhor a representam.

REGRAS:
- Atribui 0 a 2 temas por ideia. Escolhe os mais representativos; não forces correspondências.
- Quando um tema de "available_themes" for adequado, copia a sua etiqueta EXATA, literalmente.
- Não traduzas etiquetas. Não acrescentes explicações nem texto fora do JSON.

SAÍDA: ${SCHEMA_THEME}`,
    themeLockedRule: '\n- TEMAS BLOQUEADOS: usa APENAS etiquetas de "available_themes". Não inventes temas novos. Se uma ideia não se enquadrar em nenhum, devolve "themes": [].',
    themeOpenRule: '\n- Se várias ideias partilharem um tema amplo que NÃO esteja na lista, podes propor uma etiqueta nova (curta, em minúsculas, reutilizável). Sê MUITO conservador: dá prioridade à reutilização dos temas existentes.',
    relationSystem: `És o motor de relações do Nodus. Recebes PARES de ideias já
extraídas que o sistema propôs por semelhança semântica de embeddings. A tua tarefa
é validar, EXCLUSIVAMENTE em JSON válido, se existe uma relação conceptual
real entre as ideias de cada par.

TIPOS válidos: extends, contradicts, applies_to, shares_method, precondition_of,
measures_same, supports, refutes, variant_of, refines.

═══ REGRAS ═══
- Avalia cada par de forma independente. Uma semelhança elevada NÃO basta por si só.
- Propõe uma relação apenas se os enunciados a sustentarem com clareza razoável.
- A confiança reflete até que ponto a relação é evidente a partir dos enunciados:
  0.7–1.0 se for clara e direta, 0.4–0.7 se for plausível mas
  exigir inferência, < 0.4 apenas se houver indícios fracos.
- Não relaciones uma ideia consigo própria.
- Não inventes relações que os enunciados não sustentem.
- Usa os ids exatamente como aparecem na entrada.
- Podes inverter from/to se o tipo de relação for direcional.
- "rationale": uma frase breve em português que explique a validação.

SAÍDA: ${SCHEMA_RELATION}
Se nenhum par tiver uma relação válida: { "relations": [] }`,
    groupingProgress: 'A agrupar ideias em temas',
    relationsProgress: 'A validar pares semânticos entre ideias',
  },
  'pt-BR': {
    themeSystem: `Você é o mecanismo de reorganização temática do Nodus. Você recebe IDEIAS já extraídas
(afirmações, achados, construtos, métodos, estruturas) e uma lista de TEMAS
principais disponíveis. Sua tarefa, EXCLUSIVAMENTE em JSON válido, é agrupar cada
ideia sob os temas que melhor a representam.

REGRAS:
- Atribua de 0 a 2 temas por ideia. Escolha os mais representativos; não force correspondências.
- Quando um tema de "available_themes" for adequado, copie seu rótulo EXATO, literalmente.
- Não traduza rótulos. Não acrescente explicações nem texto fora do JSON.

SAÍDA: ${SCHEMA_THEME}`,
    themeLockedRule: '\n- TEMAS BLOQUEADOS: use SOMENTE rótulos de "available_themes". Não invente temas novos. Se uma ideia não se encaixar em nenhum, retorne "themes": [].',
    themeOpenRule: '\n- Se várias ideias compartilharem um tema amplo que NÃO esteja na lista, você pode propor um rótulo novo (curto, em minúsculas, reutilizável). Seja MUITO conservador: priorize reutilizar os temas existentes.',
    relationSystem: `Você é o mecanismo de relações do Nodus. Você recebe PARES de ideias já
extraídas que o sistema propôs por similaridade semântica de embeddings. Sua tarefa
é validar, EXCLUSIVAMENTE em JSON válido, se existe uma relação conceitual
real entre as ideias de cada par.

TIPOS válidos: extends, contradicts, applies_to, shares_method, precondition_of,
measures_same, supports, refutes, variant_of, refines.

═══ REGRAS ═══
- Avalie cada par de forma independente. Uma similaridade alta NÃO basta por si só.
- Proponha uma relação apenas se os enunciados a sustentarem com clareza razoável.
- A confiança reflete o quanto a relação é evidente a partir dos enunciados:
  0.7–1.0 se for clara e direta, 0.4–0.7 se for plausível, mas
  exigir inferência, < 0.4 somente quando houver indícios fracos.
- Não relacione uma ideia consigo mesma.
- Não invente relações que os enunciados não sustentem.
- Use os ids exatamente como aparecem na entrada.
- Você pode inverter from/to se o tipo de relação for direcional.
- "rationale": uma frase breve em português que explique a validação.

SAÍDA: ${SCHEMA_RELATION}
Se nenhum par tiver uma relação válida: { "relations": [] }`,
    groupingProgress: 'Agrupando ideias em temas',
    relationsProgress: 'Validando pares semânticos entre ideias',
  },
  it: {
    themeSystem: `Sei il motore di riorganizzazione tematica di Nodus. Ricevi IDEE già estratte
(affermazioni, risultati, costrutti, metodi, quadri) e un elenco di TEMI
principali disponibili. Il tuo compito, ESCLUSIVAMENTE in JSON valido, è raggruppare ogni
idea sotto i temi che la rappresentano meglio.

REGOLE:
- Assegna da 0 a 2 temi per idea. Scegli i più rappresentativi; non forzare le corrispondenze.
- Quando un tema di "available_themes" è pertinente, copiane l’etichetta ESATTA, letteralmente.
- Non tradurre le etichette. Non aggiungere spiegazioni né testo fuori dal JSON.

OUTPUT: ${SCHEMA_THEME}`,
    themeLockedRule: '\n- TEMI BLOCCATI: usa SOLO etichette di "available_themes". Non inventare nuovi temi. Se un’idea non corrisponde a nessuno, restituisci "themes": [].',
    themeOpenRule: '\n- Se più idee condividono un tema ampio che NON è nell’elenco, puoi proporre una nuova etichetta (breve, minuscola, riutilizzabile). Sii MOLTO prudente: privilegia il riutilizzo dei temi esistenti.',
    relationSystem: `Sei il motore di relazioni di Nodus. Ricevi COPPIE di idee già
estratte che il sistema ha proposto in base alla somiglianza semantica degli embedding. Il tuo compito
è verificare, ESCLUSIVAMENTE in JSON valido, se tra le idee di ogni coppia esiste una relazione
concettuale reale.

TIPI validi: extends, contradicts, applies_to, shares_method, precondition_of,
measures_same, supports, refutes, variant_of, refines.

═══ REGOLE ═══
- Valuta ogni coppia indipendentemente. Una somiglianza elevata NON è sufficiente da sola.
- Proponi una relazione solo se gli enunciati la sostengono con ragionevole chiarezza.
- La confidenza riflette quanto la relazione sia evidente dagli enunciati:
  0.7–1.0 se è chiara e diretta, 0.4–0.7 se è plausibile ma
  richiede inferenza, < 0.4 solo se vi sono indizi deboli.
- Non mettere un’idea in relazione con se stessa.
- Non inventare relazioni non sostenute dagli enunciati.
- Usa gli ids esattamente come compaiono nell’input.
- Puoi invertire from/to se il tipo di relazione è direzionale.
- "rationale": una breve frase in italiano che spieghi la verifica.

OUTPUT: ${SCHEMA_RELATION}
Se nessuna coppia ha una relazione valida: { "relations": [] }`,
    groupingProgress: 'Raggruppamento delle idee per tema',
    relationsProgress: 'Verifica delle coppie semantiche tra idee',
  },
  tr: {
    themeSystem: `Nodus'un tematik yeniden düzenleme motorusun. Önceden çıkarılmış FİKİRLER
(iddialar, bulgular, yapılar, yöntemler, çerçeveler) ve kullanılabilir ana TEMALAR
listesini alırsın. Görevin, YALNIZCA geçerli JSON içinde, her fikri onu en iyi
temsil eden temalar altında gruplamaktır.

KURALLAR:
- Her fikre 0 ile 2 tema ata. En iyi temsil edenleri seç; eşleşmeleri zorlama.
- "available_themes" içindeki bir tema uygunsa etiketini birebir, AYNEN kopyala.
- Etiketleri çevirme. JSON dışında açıklama veya metin ekleme.

ÇIKTI: ${SCHEMA_THEME}`,
    themeLockedRule: '\n- KİLİTLİ TEMALAR: YALNIZCA "available_themes" etiketlerini kullan. Yeni tema uydurma. Bir fikir hiçbirine uymuyorsa "themes": [] döndür.',
    themeOpenRule: '\n- Birkaç fikir listede OLMAYAN geniş bir temayı paylaşıyorsa yeni bir etiket önerebilirsin (kısa, küçük harfli, yeniden kullanılabilir). ÇOK tutucu ol: var olan temaları yeniden kullanmaya öncelik ver.',
    relationSystem: `Nodus'un ilişki motorusun. Sistem tarafından embeddinglerin anlamsal
benzerliğine göre önerilmiş, önceden çıkarılmış fikir ÇİFTLERİ alırsın. Görevin,
YALNIZCA geçerli JSON içinde, her çiftin fikirleri arasında gerçek bir kavramsal
ilişki bulunup bulunmadığını doğrulamaktır.

Geçerli TÜRLER: extends, contradicts, applies_to, shares_method, precondition_of,
measures_same, supports, refutes, variant_of, refines.

═══ KURALLAR ═══
- Her çifti bağımsız değerlendir. Yüksek benzerlik tek başına YETERLİ DEĞİLDİR.
- Yalnızca ifadeler makul açıklıkla destekliyorsa bir ilişki öner.
- Güven, ilişkinin ifadelerden ne kadar açık anlaşıldığını gösterir:
  ilişki açık ve doğrudansa 0.7–1.0, makul ancak çıkarım
  gerektiriyorsa 0.4–0.7, yalnızca zayıf işaretler varsa < 0.4.
- Bir fikri kendisiyle ilişkilendirme.
- İfadelerin desteklemediği ilişkileri uydurma.
- Kimlikleri girdide göründükleri biçimde aynen kullan.
- İlişki türü yönlüyse from/to yönünü ters çevirebilirsin.
- "rationale": doğrulamayı açıklayan kısa bir Türkçe cümle.

ÇIKTI: ${SCHEMA_RELATION}
Hiçbir çiftin geçerli bir ilişkisi yoksa: { "relations": [] }`,
    groupingProgress: 'Fikirler temalar altında gruplanıyor',
    relationsProgress: 'Fikirler arasındaki anlamsal çiftler doğrulanıyor',
  },
};

export function reprocessConnectionsPromptPack(language: PromptLanguage = 'es'): ReprocessConnectionsPromptPack {
  return PACKS[language] ?? PACKS.es;
}
