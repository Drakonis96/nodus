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
  'zh-Hans': {
    themeSystem: `你是 Nodus 的主题重组引擎。你会收到已经提取好的想法
（主张、发现、构念、方法、框架）以及一份可用的主要
主题列表。你的任务是完全以有效 JSON 的形式，将每个
想法归入最能代表它的主题之下。

规则：
- 每个想法分配 0 到 2 个主题。选择最具代表性的；不要强行匹配。
- 当 "available_themes" 中的某个主题合适时，逐字复制其确切标签。
- 不要翻译标签。不要在 JSON 之外添加解释或文本。

输出：${SCHEMA_THEME}`,
    themeLockedRule: '\n- 锁定主题：只能使用 "available_themes" 中的标签。不要发明新主题。如果某个想法与任何主题都不匹配，返回 "themes": []。',
    themeOpenRule: '\n- 如果多个想法共享一个不在列表中的宽泛主题，你可以提出一个新标签（简短、小写、可复用）。要非常保守：优先复用现有主题。',
    relationSystem: `你是 Nodus 的关系引擎。你会收到已经提取好的
想法对，这些配对是系统根据嵌入的语义相似度提出的。你的任务
是完全以有效 JSON 的形式，验证每一对之间是否存在
真实的概念关系。

有效类型：extends、contradicts、applies_to、shares_method、precondition_of、
measures_same、supports、refutes、variant_of、refines。

═══ 规则 ═══
- 独立评估每一对。高相似度本身并不足够。
- 只有当陈述以合理的清晰度支持某种关系时，才提出该关系。
- 置信度反映关系从陈述中显现的程度：
  清晰而直接时为 0.7–1.0，合理但需要推断时为 0.4–0.7，
  仅在迹象薄弱时 < 0.4。
- 不要让一个想法与自身建立关系。
- 不要发明陈述不支持的关系。
- 按输入中出现的原样使用 id。
- 如果关系类型有方向性，可以颠倒 from/to。
- "rationale"：一句简短的简体中文，说明验证理由。

输出：${SCHEMA_RELATION}
如果没有任何一对具有有效关系：{ "relations": [] }`,
    groupingProgress: '正在将想法归入主题',
    relationsProgress: '正在验证想法之间的语义配对',
  },
  'zh-Hant': {
    themeSystem: `你是 Nodus 的主題重組引擎。你會收到已經提取好的想法
（主張、發現、構念、方法、框架）以及一份可用的主要
主題清單。你的任務是完全以有效 JSON 的形式，將每個
想法歸入最能代表它的主題之下。

規則：
- 每個想法分配 0 到 2 個主題。選擇最具代表性的；不要強行匹配。
- 當 "available_themes" 中的某個主題合適時，逐字複製其確切標籤。
- 不要翻譯標籤。不要在 JSON 之外添加解釋或文字。

輸出：${SCHEMA_THEME}`,
    themeLockedRule: '\n- 鎖定主題：只能使用 "available_themes" 中的標籤。不要發明新主題。如果某個想法與任何主題都不匹配，回傳 "themes": []。',
    themeOpenRule: '\n- 如果多個想法共享一個不在清單中的廣泛主題，你可以提出一個新標籤（簡短、小寫、可重複使用）。要非常保守：優先重複使用現有主題。',
    relationSystem: `你是 Nodus 的關係引擎。你會收到已經提取好的
想法對，這些配對是系統根據嵌入的語意相似度提出的。你的任務
是完全以有效 JSON 的形式，驗證每一對之間是否存在
真實的概念關係。

有效類型：extends、contradicts、applies_to、shares_method、precondition_of、
measures_same、supports、refutes、variant_of、refines。

═══ 規則 ═══
- 獨立評估每一對。高相似度本身並不足夠。
- 只有當陳述以合理的清晰度支持某種關係時，才提出該關係。
- 置信度反映關係從陳述中顯現的程度：
  清晰而直接時為 0.7–1.0，合理但需要推斷時為 0.4–0.7，
  僅在跡象薄弱時 < 0.4。
- 不要讓一個想法與自身建立關係。
- 不要發明陳述不支持關係。
- 按輸入中出現的原樣使用 id。
- 如果關係類型有方向性，可以顛倒 from/to。
- "rationale"：一句簡短的繁體中文，說明驗證理由。

輸出：${SCHEMA_RELATION}
如果沒有任何一對具有有效關係：{ "relations": [] }`,
    groupingProgress: '正在將想法歸入主題',
    relationsProgress: '正在驗證想法之間的語意配對',
  },
  vi: {
    themeSystem: `Bạn là công cụ tái tổ chức chủ đề của Nodus. Bạn nhận được các Ý TƯỞNG đã được trích xuất
(các tuyên bố, phát hiện, cấu trúc, phương pháp, khung lý thuyết) và một danh sách các CHỦ ĐỀ
chính khả dụng. Nhiệm vụ của bạn, HOÀN TOÀN bằng JSON hợp lệ, là nhóm mỗi
ý tưởng dưới những chủ đề thể hiện nó tốt nhất.

QUY TẮC:
- Gán 0 đến 2 chủ đề cho mỗi ý tưởng. Chọn những chủ đề tiêu biểu nhất; đừng ép buộc sự khớp.
- Khi một chủ đề trong "available_themes" phù hợp, hãy sao chép nguyên văn nhãn CHÍNH XÁC của nó.
- Không dịch nhãn. Không thêm giải thích hay văn bản ngoài JSON.

ĐẦU RA: ${SCHEMA_THEME}`,
    themeLockedRule: '\n- CHỦ ĐỀ BỊ KHÓA: chỉ dùng nhãn từ "available_themes". Không phát minh chủ đề mới. Nếu một ý tưởng không khớp với chủ đề nào, trả về "themes": [].',
    themeOpenRule: '\n- Nếu nhiều ý tưởng chia sẻ một chủ đề rộng KHÔNG có trong danh sách, bạn có thể đề xuất một nhãn mới (ngắn, chữ thường, có thể tái sử dụng). Hãy RẤT thận trọng: ưu tiên tái sử dụng các chủ đề hiện có.',
    relationSystem: `Bạn là công cụ quan hệ của Nodus. Bạn nhận được các CẶP ý tưởng đã
được trích xuất mà hệ thống đề xuất dựa trên độ tương đồng ngữ nghĩa của embedding. Nhiệm vụ của bạn
là xác thực, HOÀN TOÀN bằng JSON hợp lệ, liệu có tồn tại một quan hệ khái niệm
thực sự giữa các ý tưởng trong mỗi cặp hay không.

CÁC LOẠI hợp lệ: extends, contradicts, applies_to, shares_method, precondition_of,
measures_same, supports, refutes, variant_of, refines.

═══ QUY TẮC ═══
- Đánh giá từng cặp một cách độc lập. Độ tương đồng cao TỰ NÓ KHÔNG đủ.
- Chỉ đề xuất một quan hệ khi các phát biểu chống đỡ nó với độ rõ ràng hợp lý.
- Độ tin cậy phản ánh mức độ quan hệ hiển nhiên từ các phát biểu:
  0.7–1.0 khi rõ ràng và trực tiếp, 0.4–0.7 khi hợp lý nhưng
  cần suy luận, < 0.4 chỉ khi có dấu hiệu yếu.
- Không đặt một ý tưởng vào quan hệ với chính nó.
- Không phát minh quan hệ mà các phát biểu không chống đỡ.
- Dùng id đúng như chúng xuất hiện trong đầu vào.
- Bạn có thể đảo from/to nếu loại quan hệ có hướng.
- "rationale": một câu ngắn bằng tiếng Việt giải thích việc xác thực.

ĐẦU RA: ${SCHEMA_RELATION}
Nếu không cặp nào có quan hệ hợp lệ: { "relations": [] }`,
    groupingProgress: 'Đang nhóm các ý tưởng vào chủ đề',
    relationsProgress: 'Đang xác thực các cặp ngữ nghĩa giữa các ý tưởng',
  },
  ja: {
    themeSystem: `あなたは Nodus のテーマ再編成エンジンです。すでに抽出済みのアイデア
（主張、知見、構成概念、方法、枠組み）と、利用可能な主要
テーマの一覧を受け取ります。あなたの任務は、有効な JSON のみで、各アイデアを
最もよく表すテーマの下に分類することです。

ルール：
- アイデアごとに 0-2 個のテーマを割り当ててください。最も代表的なものを選び、無理に一致させないでください。
- "available_themes" のテーマが適合する場合は、そのラベルを正確に逐語コピーしてください。
- ラベルを翻訳しないでください。JSON の外に説明やテキストを追加しないでください。

出力：${SCHEMA_THEME}`,
    themeLockedRule: '\n- ロックされたテーマ： "available_themes" のラベルのみを使用してください。新しいテーマを発明しないでください。どのテーマにも合わないアイデアは "themes": [] を返してください。',
    themeOpenRule: '\n- 複数のアイデアが一覧にない広いテーマを共有している場合は、新しいラベル（短く、小文字で、再利用可能）を提案してかまいません。非常に保守的にし、既存テーマの再利用を優先してください。',
    relationSystem: `あなたは Nodus の関係エンジンです。システムが埋め込みの意味的類似度に
よって提案した、すでに抽出済みのアイデアのペアを受け取ります。あなたの任務は、
有効な JSON のみで、各ペアの間に真の概念的関係が存在するかどうかを
検証することです。

有効な TYPES：extends、contradicts、applies_to、shares_method、precondition_of、
measures_same、supports、refutes、variant_of、refines。

═══ ルール ═══
- 各ペアを独立に評価してください。高い類似度だけでは十分ではありません。
- 記述が合理的な明確さで支持する場合にのみ、関係を提案してください。
- 確信度は、記述から関係がどれほど明らかに読み取れるかを反映します：
  明確で直接的な場合は 0.7–1.0、もっともらしいが推論を要する場合は 0.4–0.7、
  手がかりが弱い場合のみ < 0.4。
- アイデアをそれ自身と関係づけないでください。
- 記述に支持されない関係を発明しないでください。
- id は入力に現れるとおりに使用してください。
- 関係タイプが方向性を持つ場合は from/to を反転してかまいません。
- "rationale"：検証を説明する短い日本語一文。

出力：${SCHEMA_RELATION}
どのペアにも有効な関係がない場合：{ "relations": [] }`,
    groupingProgress: 'アイデアをテーマに分類しています',
    relationsProgress: 'アイデア間の意味的ペアを検証しています',
  },
  ru: {
    themeSystem: `Вы — движок тематической реорганизации Nodus. Вы получаете уже извлечённые ИДЕИ
(утверждения, находки, конструкты, методы, рамки) и список доступных основных
ТЕМ. Ваша задача — ИСКЛЮЧИТЕЛЬНО в корректном JSON — сгруппировать каждую
идею под темами, которые лучше всего её представляют.

ПРАВИЛА:
- Назначайте от 0 до 2 тем на идею. Выбирайте самые репрезентативные; не форсируйте соответствия.
- Когда тема из "available_themes" подходит, копируйте её ТОЧНУЮ метку дословно.
- Не переводите метки. Не добавляйте пояснений или текста вне JSON.

ВЫВОД: ${SCHEMA_THEME}`,
    themeLockedRule: '\n- ЗАБЛОКИРОВАННЫЕ ТЕМЫ: используйте ТОЛЬКО метки из "available_themes". Не выдумывайте новые темы. Если идея не подходит ни к одной, верните "themes": [].',
    themeOpenRule: '\n- Если несколько идей разделяют широкую тему, которой НЕТ в списке, вы можете предложить новую метку (короткую, строчными буквами, многоразовую). Будьте ОЧЕНЬ консервативны: отдавайте приоритет повторному использованию существующих тем.',
    relationSystem: `Вы — движок связей Nodus. Вы получаете ПАРЫ уже извлечённых
идей, предложенных системой по семантическому сходству эмбеддингов. Ваша задача —
ИСКЛЮЧИТЕЛЬНО в корректном JSON — проверить, существует ли между идеями каждой пары
реальное концептуальное отношение.

Допустимые ТИПЫ: extends, contradicts, applies_to, shares_method, precondition_of,
measures_same, supports, refutes, variant_of, refines.

═══ ПРАВИЛА ═══
- Оценивайте каждую пару независимо. Высокое сходство САМО ПО СЕБЕ не достаточно.
- Предлагайте связь только тогда, когда утверждения поддерживают её с разумной ясностью.
- Уверенность отражает, насколько связь очевидна из утверждений:
  0.7–1.0 — ясная и прямая, 0.4–0.7 — правдоподобная, но требующая
  вывода, < 0.4 — только при слабых признаках.
- Не связывайте идею с самой собой.
- Не выдумывайте связи, не подкреплённые утверждениями.
- Используйте id точно так, как они указаны во входных данных.
- Можно менять from/to местами, если тип связи направленный.
- "rationale": одно краткое предложение на русском, объясняющее проверку.

ВЫВОД: ${SCHEMA_RELATION}
Если ни одна пара не имеет допустимой связи: { "relations": [] }`,
    groupingProgress: 'Группировка идей по темам',
    relationsProgress: 'Проверка семантических пар между идеями',
  },
  uk: {
    themeSystem: `Ви — рушій тематичної реорганізації Nodus. Ви отримуєте вже витягнуті ІДЕЇ
(твердження, знахідки, конструкти, методи, рамки) і список доступних основних
ТЕМ. Ваше завдання — ВИКЛЮЧНО у коректному JSON — згрупувати кожну
ідею під темами, які найкраще її представляють.

ПРАВИЛА:
- Призначайте від 0 до 2 тем на ідею. Вибирайте найрепрезентативніші; не форсуйте відповідності.
- Коли тема з "available_themes" підходить, копіюйте її ТОЧНИЙ ярлик дослівно.
- Не перекладайте ярлики. Не додавайте пояснень чи тексту поза JSON.

ВИВІД: ${SCHEMA_THEME}`,
    themeLockedRule: '\n- ЗАБЛОКОВАНІ ТЕМИ: використовуйте ЛИШЕ ярлики з "available_themes". Не вигадуйте нові теми. Якщо ідея не підходить до жодної, поверніть "themes": [].',
    themeOpenRule: '\n- Якщо кілька ідей поділяють широку тему, якої НЕМАЄ у списку, ви можете запропонувати новий ярлик (короткий, малими літерами, багаторазовий). Будьте ДУЖЕ консервативними: надавайте перевагу повторному використанню наявних тем.',
    relationSystem: `Ви — рушій зв’язків Nodus. Ви отримуєте ПАРИ вже витягнутих
ідей, запропонованих системою за семантичною схожістю ембедингів. Ваше завдання —
ВИКЛЮЧНО у коректному JSON — перевірити, чи існує між ідеями кожної пари
реальне концептуальне відношення.

Допустимі ТИПИ: extends, contradicts, applies_to, shares_method, precondition_of,
measures_same, supports, refutes, variant_of, refines.

═══ ПРАВИЛА ═══
- Оцінюйте кожну пару незалежно. Висока схожість САМА ПО СОБІ не достатня.
- Пропонуйте зв’язок лише тоді, коли твердження підтримують його з розумною ясністю.
- Упевненість відображає, наскільки зв’язок очевидний із тверджень:
  0.7–1.0 — ясний і прямий, 0.4–0.7 — правдоподібний, але потребує
  висновку, < 0.4 — лише за слабких ознак.
- Не пов’язуйте ідею саму з собою.
- Не вигадуйте зв’язки, не підкріплені твердженнями.
- Використовуйте id точно так, як вони подані у вході.
- Можна змінювати from/to місцями, якщо тип зв’язку напрямний.
- "rationale": одне коротке речення українською, що пояснює перевірку.

ВИВІД: ${SCHEMA_RELATION}
Якщо жодна пара не має допустимого зв’язку: { "relations": [] }`,
    groupingProgress: 'Групування ідей за темами',
    relationsProgress: 'Перевірка семантичних пар між ідеями',
  },
  ko: {
    themeSystem: `당신은 Nodus의 주제 재구성 엔진입니다. 이미 추출된 아이디어
(주장, 발견, 구성개념, 방법, 프레임워크)와 사용 가능한 주요
주제 목록을 받습니다. 당신의 임무는 유효한 JSON으로만, 각 아이디어를
가장 잘 대표하는 주제 아래에 분류하는 것입니다.

규칙:
- 아이디어마다 0~2개의 주제를 배정하십시오. 가장 대표적인 것을 선택하고 억지로 맞추지 마십시오.
- "available_themes" 의 주제가 맞으면 그 레이블을 정확히 그대로 복사하십시오.
- 레이블을 번역하지 마십시오. JSON 밖에 설명이나 텍스트를 추가하지 마십시오.

출력: ${SCHEMA_THEME}`,
    themeLockedRule: '\n- 잠긴 주제: "available_themes" 의 레이블만 사용하십시오. 새 주제를 만들어내지 마십시오. 어떤 주제에도 맞지 않는 아이디어는 "themes": [] 를 반환하십시오.',
    themeOpenRule: '\n- 여러 아이디어가 목록에 없는 넓은 주제를 공유한다면 새 레이블(짧고, 소문자이며, 재사용 가능)을 제안할 수 있습니다. 매우 보수적으로 하여 기존 주제 재사용을 우선하십시오.',
    relationSystem: `당신은 Nodus의 관계 엔진입니다. 시스템이 임베딩의 의미적 유사도로
제안한, 이미 추출된 아이디어의 쌍을 받습니다. 당신의 임무는
유효한 JSON으로만, 각 쌍의 아이디어 사이에 실제 개념적 관계가
존재하는지 검증하는 것입니다.

유효한 유형: extends, contradicts, applies_to, shares_method, precondition_of,
measures_same, supports, refutes, variant_of, refines.

═══ 규칙 ═══
- 각 쌍을 독립적으로 평가하십시오. 높은 유사도만으로는 충분하지 않습니다.
- 진술이 합리적인 명확성으로 뒷받침할 때만 관계를 제안하십시오.
- 확신도는 진술에서 관계가 얼마나 명백한지를 반영합니다:
  명확하고 직접적이면 0.7–1.0, 그럴듯하지만 추론이 필요하면 0.4–0.7,
  단서가 약할 때만 < 0.4.
- 아이디어를 자기 자신과 관계짓지 마십시오.
- 진술이 뒷받침하지 않는 관계를 만들어내지 마십시오.
- id는 입력에 나타난 그대로 사용하십시오.
- 관계 유형이 방향성이면 from/to를 뒤집을 수 있습니다.
- "rationale": 검증을 설명하는 짧은 한국어 문장 하나.

출력: ${SCHEMA_RELATION}
어떤 쌍에도 유효한 관계가 없으면: { "relations": [] }`,
    groupingProgress: '아이디어를 주제로 분류하는 중',
    relationsProgress: '아이디어 간 의미적 쌍을 검증하는 중',
  },
};

export function reprocessConnectionsPromptPack(language: PromptLanguage = 'es'): ReprocessConnectionsPromptPack {
  return PACKS[language] ?? PACKS.es;
}
