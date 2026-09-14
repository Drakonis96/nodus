import type { PromptLanguage } from './types';

export interface StudyKnowledgePromptPack {
  system: string;
  title: string;
  text: string;
  insufficientText: string;
  externalPurpose: string;
  connection: string;
}

const SCHEMA = '{"ideas":[{"key":"i1","type":"concept","label":"...","statement":"...","role":"principal|secondary","confidence":0.8,"evidence":[{"quote":"...","location":"p. 2"}]}],"relations":[{"from":"i1","to":"i2","type":"related","basis":"...","confidence":0.8}]}';

const PACKS: Record<PromptLanguage, StudyKnowledgePromptPack> = {
  es: { system: `Analiza material docente y devuelve un mapa conceptual trazable. Extrae solo ideas respaldadas por el texto.
Cada idea necesita una etiqueta breve, un enunciado autosuficiente y una o más citas textuales exactas.
Usa tipos: concept, definition, principle, process, cause, consequence, example, debate.
Usa relaciones: related, supports, contrasts, causes, depends_on, part_of, applies.
Las relaciones solo pueden referirse a las claves de ideas devueltas. No inventes páginas ni citas.
Devuelve JSON: ${SCHEMA}`, title: 'TÍTULO', text: 'TEXTO', insufficientText: 'La fuente no contiene suficiente texto para extraer ideas.', externalPurpose: 'analizar el material y extraer un mapa conceptual trazable', connection: 'Conexión' },
  en: { system: `Analyze teaching material and return a traceable concept map. Extract only ideas supported by the text.
Each idea needs a short label, a self-contained statement, and one or more exact verbatim quotations.
Use types: concept, definition, principle, process, cause, consequence, example, debate.
Use relations: related, supports, contrasts, causes, depends_on, part_of, applies.
Relations may refer only to the keys of returned ideas. Do not invent pages or quotations.
Return JSON: ${SCHEMA}`, title: 'TITLE', text: 'TEXT', insufficientText: 'The source does not contain enough text to extract ideas.', externalPurpose: 'analyze the material and extract a traceable concept map', connection: 'Connection' },
  fr: { system: `Analyse le matériel pédagogique et renvoie une carte conceptuelle traçable. Extrais uniquement les idées étayées par le texte.
Chaque idée doit comporter un libellé bref, un énoncé autonome et une ou plusieurs citations textuelles exactes.
Utilise les types : concept, definition, principle, process, cause, consequence, example, debate.
Utilise les relations : related, supports, contrasts, causes, depends_on, part_of, applies.
Les relations ne peuvent se référer qu’aux clés des idées renvoyées. N’invente ni pages ni citations.
Renvoie du JSON : ${SCHEMA}`, title: 'TITRE', text: 'TEXTE', insufficientText: 'La source ne contient pas assez de texte pour extraire des idées.', externalPurpose: 'analyser le matériel et extraire une carte conceptuelle traçable', connection: 'Lien' },
  de: { system: `Analysiere Lehrmaterial und gib eine nachvollziehbare Begriffslandkarte zurück. Extrahiere nur Ideen, die durch den Text gestützt werden.
Jede Idee benötigt eine kurze Bezeichnung, eine eigenständige Aussage und ein oder mehrere exakte wörtliche Zitate.
Verwende die Typen: concept, definition, principle, process, cause, consequence, example, debate.
Verwende die Beziehungen: related, supports, contrasts, causes, depends_on, part_of, applies.
Beziehungen dürfen sich nur auf die Schlüssel der zurückgegebenen Ideen beziehen. Erfinde keine Seiten oder Zitate.
Gib JSON zurück: ${SCHEMA}`, title: 'TITEL', text: 'TEXT', insufficientText: 'Die Quelle enthält nicht genügend Text, um Ideen zu extrahieren.', externalPurpose: 'das Material analysieren und eine nachvollziehbare Begriffslandkarte extrahieren', connection: 'Verbindung' },
  pt: { system: `Analisa material docente e devolve um mapa conceptual rastreável. Extrai apenas ideias sustentadas pelo texto.
Cada ideia precisa de uma etiqueta breve, um enunciado autónomo e uma ou mais citações textuais exatas.
Usa os tipos: concept, definition, principle, process, cause, consequence, example, debate.
Usa as relações: related, supports, contrasts, causes, depends_on, part_of, applies.
As relações só podem referir-se às chaves das ideias devolvidas. Não inventes páginas nem citações.
Devolve JSON: ${SCHEMA}`, title: 'TÍTULO', text: 'TEXTO', insufficientText: 'A fonte não contém texto suficiente para extrair ideias.', externalPurpose: 'analisar o material e extrair um mapa conceptual rastreável', connection: 'Conexão' },
  'pt-BR': { system: `Analise o material didático e retorne um mapa conceitual rastreável. Extraia somente ideias sustentadas pelo texto.
Cada ideia precisa de um rótulo breve, um enunciado autônomo e uma ou mais citações textuais exatas.
Use os tipos: concept, definition, principle, process, cause, consequence, example, debate.
Use as relações: related, supports, contrasts, causes, depends_on, part_of, applies.
As relações podem se referir somente às chaves das ideias retornadas. Não invente páginas nem citações.
Retorne JSON: ${SCHEMA}`, title: 'TÍTULO', text: 'TEXTO', insufficientText: 'A fonte não contém texto suficiente para extrair ideias.', externalPurpose: 'analisar o material e extrair um mapa conceitual rastreável', connection: 'Conexão' },
  it: { system: `Analizza il materiale didattico e restituisci una mappa concettuale tracciabile. Estrai soltanto idee sostenute dal testo.
Ogni idea deve avere un’etichetta breve, un enunciato autonomo e una o più citazioni testuali esatte.
Usa i tipi: concept, definition, principle, process, cause, consequence, example, debate.
Usa le relazioni: related, supports, contrasts, causes, depends_on, part_of, applies.
Le relazioni possono riferirsi solo alle chiavi delle idee restituite. Non inventare pagine né citazioni.
Restituisci JSON: ${SCHEMA}`, title: 'TITOLO', text: 'TESTO', insufficientText: 'La fonte non contiene testo sufficiente per estrarre idee.', externalPurpose: 'analizzare il materiale ed estrarre una mappa concettuale tracciabile', connection: 'Collegamento' },
  tr: { system: `Öğretim materyalini incele ve izlenebilir bir kavram haritası döndür. Yalnızca metin tarafından desteklenen fikirleri çıkar.
Her fikir kısa bir etiket, kendi başına anlaşılır bir ifade ve bir veya daha fazla birebir alıntı içermelidir.
Şu türleri kullan: concept, definition, principle, process, cause, consequence, example, debate.
Şu ilişkileri kullan: related, supports, contrasts, causes, depends_on, part_of, applies.
İlişkiler yalnızca döndürülen fikirlerin anahtarlarına başvurabilir. Sayfa veya alıntı uydurma.
JSON döndür: ${SCHEMA}`, title: 'BAŞLIK', text: 'METİN', insufficientText: 'Kaynak, fikir çıkarmak için yeterli metin içermiyor.', externalPurpose: 'materyali incelemek ve izlenebilir bir kavram haritası çıkarmak', connection: 'Bağlantı' },
  'zh-Hans': { system: `分析教学材料并返回可追溯的概念图。仅提取有文本支持的观点。
每个观点需要一个简短标签、一个自足的陈述，以及一条或多条精确的原文引用。
使用类型：concept, definition, principle, process, cause, consequence, example, debate。
使用关系：related, supports, contrasts, causes, depends_on, part_of, applies。
关系只能引用所返回观点的键。不要编造页码或引文。
返回 JSON：${SCHEMA}`, title: '标题', text: '文本', insufficientText: '来源没有足够的文本可供提取观点。', externalPurpose: '分析材料并提取可追溯的概念图', connection: '连接' },
  'zh-Hant': { system: `分析教學材料並回傳可追溯的概念圖。僅擷取有文本支持的觀點。
每個觀點需要一個簡短標籤、一個自足的陳述，以及一條或多條精確的原文引用。
使用類型：concept, definition, principle, process, cause, consequence, example, debate。
使用關係：related, supports, contrasts, causes, depends_on, part_of, applies。
關係只能引用所回傳觀點的鍵。不要編造頁碼或引文。
回傳 JSON：${SCHEMA}`, title: '標題', text: '文字', insufficientText: '來源沒有足夠的文字可供擷取觀點。', externalPurpose: '分析材料並擷取可追溯的概念圖', connection: '連結' },
  vi: { system: `Phân tích tài liệu giảng dạy và trả về một bản đồ khái niệm có thể truy nguyên. Chỉ trích xuất những ý tưởng được văn bản hỗ trợ.
Mỗi ý tưởng cần một nhãn ngắn, một phát biểu độc lập và một hoặc nhiều trích dẫn nguyên văn chính xác.
Dùng các loại: concept, definition, principle, process, cause, consequence, example, debate.
Dùng các quan hệ: related, supports, contrasts, causes, depends_on, part_of, applies.
Các quan hệ chỉ được tham chiếu đến khóa của những ý tưởng đã trả về. Không bịa đặt số trang hay trích dẫn.
Trả về JSON: ${SCHEMA}`, title: 'TIÊU ĐỀ', text: 'VĂN BẢN', insufficientText: 'Nguồn không có đủ văn bản để trích xuất ý tưởng.', externalPurpose: 'phân tích tài liệu và trích xuất một bản đồ khái niệm có thể truy nguyên', connection: 'Kết nối' },
  ja: { system: `教材を分析し、追跡可能な概念マップを返してください。本文に裏付けられたアイデアのみを抽出します。
各アイデアには、短いラベル、それ自体で完結する記述、および正確な原文引用を 1 つ以上含めてください。
使用する種類：concept, definition, principle, process, cause, consequence, example, debate。
使用する関係：related, supports, contrasts, causes, depends_on, part_of, applies。
関係は返されたアイデアのキーのみを参照できます。ページ番号や引用を捏造しないでください。
JSON を返してください：${SCHEMA}`, title: 'タイトル', text: '本文', insufficientText: '情報源にはアイデアを抽出するのに十分な本文がありません。', externalPurpose: '教材を分析して追跡可能な概念マップを抽出する', connection: '接続' },
  ru: { system: `Проанализируйте учебный материал и верните отслеживаемую карту понятий. Извлекайте только идеи, подкреплённые текстом.
Каждой идее нужны краткая метка, самодостаточное утверждение и одна или несколько точных дословных цитат.
Используйте типы: concept, definition, principle, process, cause, consequence, example, debate.
Используйте связи: related, supports, contrasts, causes, depends_on, part_of, applies.
Связи могут ссылаться только на ключи возвращённых идей. Не выдумывайте страницы или цитаты.
Верните JSON: ${SCHEMA}`, title: 'НАЗВАНИЕ', text: 'ТЕКСТ', insufficientText: 'Источник не содержит достаточно текста для извлечения идей.', externalPurpose: 'проанализировать материал и извлечь отслеживаемую карту понятий', connection: 'Связь' },
  uk: { system: `Проаналізуйте навчальний матеріал і поверніть простежувану карту понять. Витягуйте лише ідеї, підкріплені текстом.
Кожній ідеї потрібна коротка позначка, самодостатнє твердження та один або кілька точних дослівних цитат.
Використовуйте типи: concept, definition, principle, process, cause, consequence, example, debate.
Використовуйте зв’язки: related, supports, contrasts, causes, depends_on, part_of, applies.
Зв’язки можуть посилатися лише на ключі повернутих ідей. Не вигадуйте сторінки чи цитати.
Поверніть JSON: ${SCHEMA}`, title: 'НАЗВА', text: 'ТЕКСТ', insufficientText: 'Джерело не містить достатньо тексту для вилучення ідей.', externalPurpose: 'проаналізувати матеріал і вилучити простежувану карту понять', connection: 'Зв’язок' },
  ko: { system: `교육 자료를 분석하고 추적 가능한 개념 지도를 반환하십시오. 텍스트가 뒷받침하는 아이디어만 추출하십시오.
각 아이디어에는 짧은 레이블, 그 자체로 완결된 진술, 그리고 하나 이상의 정확한 원문 인용이 필요합니다.
사용할 유형: concept, definition, principle, process, cause, consequence, example, debate.
사용할 관계: related, supports, contrasts, causes, depends_on, part_of, applies.
관계는 반환된 아이디어의 키만 참조할 수 있습니다. 페이지나 인용을 날조하지 마십시오.
JSON을 반환하십시오: ${SCHEMA}`, title: '제목', text: '텍스트', insufficientText: '출처에 아이디어를 추출할 만큼 충분한 텍스트가 없습니다.', externalPurpose: '자료를 분석하고 추적 가능한 개념 지도를 추출하는 것', connection: '연결' },
};

export function studyKnowledgePromptPack(language: PromptLanguage = 'es'): StudyKnowledgePromptPack {
  return PACKS[language] ?? PACKS.es;
}
