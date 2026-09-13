import type { IdeaType, PromptLanguage } from './types';

export interface SynthesisPromptPack {
  matrixSystem: string;
  matrixAuthor: string;
  matrixTheme: string;
  matrixIdeas: string;
  matrixReturn: string;
  workSystem(maxRemember: number): string;
  work: string;
  authors: string;
  themes: string;
  workIdeas: string;
  connections: string;
  workReturn: string;
  noAuthorship: string;
  noThemes: string;
  noConnections: string;
  primary: string;
  secondary: string;
  ideaTypes: Record<IdeaType, string>;
}

const PACKS: Record<PromptLanguage, SynthesisPromptPack> = {
  es: {
    matrixSystem: 'Eres un asistente de investigación académica. Resume en UNA sola frase la postura de un autor sobre un tema concreto, a partir únicamente de las ideas proporcionadas. No inventes nada que no esté en las ideas. Devuelve EXCLUSIVAMENTE un JSON con la forma {"stance": "una frase"}.',
    matrixAuthor: 'AUTOR', matrixTheme: 'TEMA', matrixIdeas: 'IDEAS DEL AUTOR SOBRE ESTE TEMA', matrixReturn: 'Devuelve {"stance": "…"}.',
    workSystem: (max) => 'Eres un asistente de investigación académica. A partir de las ideas extraídas de UNA obra, produces una ficha breve de síntesis para estudiar esa obra dentro de un corpus. No inventes información externa ni citas. Trabaja solo con las ideas, temas y conexiones proporcionadas. Devuelve EXCLUSIVAMENTE un JSON con la forma {"thesis": "1-2 frases con la tesis central de la obra", "remember": ["punto clave", "..."], "positioning": "un párrafo sobre cómo se organiza internamente y qué tensiones o relaciones contiene"}. El campo "remember" debe tener entre 3 y ' + max + ' puntos breves.',
    work: 'OBRA', authors: 'AUTORES', themes: 'TEMAS', workIdeas: 'IDEAS DE LA OBRA', connections: 'CONEXIONES INTERNAS ENTRE IDEAS', workReturn: 'Devuelve el JSON de síntesis de la obra.', noAuthorship: 'autoría no disponible', noThemes: 'sin temas registrados', noConnections: 'sin conexiones internas registradas', primary: 'principal', secondary: 'secundaria', ideaTypes: { claim: 'afirmación', finding: 'hallazgo', construct: 'constructo', method: 'método', framework: 'marco' },
  },
  en: {
    matrixSystem: 'You are an academic research assistant. Summarize an authors position on a specific theme in ONE sentence, using only the ideas provided. Do not invent anything absent from those ideas. Return EXCLUSIVELY JSON in the form {"stance": "one sentence"}.',
    matrixAuthor: 'AUTHOR', matrixTheme: 'THEME', matrixIdeas: 'THE AUTHORS IDEAS ABOUT THIS THEME', matrixReturn: 'Return {"stance": "…"}.',
    workSystem: (max) => 'You are an academic research assistant. From the ideas extracted from ONE work, produce a brief synthesis sheet for studying that work within a corpus. Do not invent external information or citations. Work only with the ideas, themes, and connections provided. Return EXCLUSIVELY JSON in the form {"thesis": "1-2 sentences stating the works central thesis", "remember": ["key point", "..."], "positioning": "one paragraph explaining its internal organization and the tensions or relationships it contains"}. The "remember" field must contain between 3 and ' + max + ' brief points.',
    work: 'WORK', authors: 'AUTHORS', themes: 'THEMES', workIdeas: 'IDEAS FROM THE WORK', connections: 'INTERNAL CONNECTIONS BETWEEN IDEAS', workReturn: 'Return the works synthesis JSON.', noAuthorship: 'authorship unavailable', noThemes: 'no themes recorded', noConnections: 'no internal connections recorded', primary: 'primary', secondary: 'secondary', ideaTypes: { claim: 'claim', finding: 'finding', construct: 'construct', method: 'method', framework: 'framework' },
  },
  fr: {
    matrixSystem: 'Tu es un assistant de recherche universitaire. Résume en UNE seule phrase la position d’un auteur sur un thème précis, uniquement à partir des idées fournies. N’invente rien qui ne figure pas dans ces idées. Renvoie EXCLUSIVEMENT un JSON de la forme {"stance": "une phrase"}.',
    matrixAuthor: 'AUTEUR', matrixTheme: 'THÈME', matrixIdeas: 'IDÉES DE L’AUTEUR SUR CE THÈME', matrixReturn: 'Renvoie {"stance": "…"}.',
    workSystem: (max) => 'Tu es un assistant de recherche universitaire. À partir des idées extraites d’UNE œuvre, produis une courte fiche de synthèse permettant d’étudier cette œuvre dans un corpus. N’invente aucune information externe ni aucune citation. Travaille uniquement avec les idées, thèmes et liens fournis. Renvoie EXCLUSIVEMENT un JSON de la forme {"thesis": "1 à 2 phrases exposant la thèse centrale de l’œuvre", "remember": ["point clé", "..."], "positioning": "un paragraphe sur son organisation interne et les tensions ou relations qu’elle contient"}. Le champ "remember" doit contenir entre 3 et ' + max + ' points brefs.',
    work: 'ŒUVRE', authors: 'AUTEURS', themes: 'THÈMES', workIdeas: 'IDÉES DE L’ŒUVRE', connections: 'LIENS INTERNES ENTRE LES IDÉES', workReturn: 'Renvoie le JSON de synthèse de l’œuvre.', noAuthorship: 'auteurs non disponibles', noThemes: 'aucun thème enregistré', noConnections: 'aucun lien interne enregistré', primary: 'principale', secondary: 'secondaire', ideaTypes: { claim: 'affirmation', finding: 'résultat', construct: 'construit', method: 'méthode', framework: 'cadre' },
  },
  de: {
    matrixSystem: 'Du bist ein wissenschaftlicher Forschungsassistent. Fasse die Position eines Autors zu einem bestimmten Thema in EINEM Satz zusammen und stütze dich ausschließlich auf die bereitgestellten Ideen. Erfinde nichts, was nicht in den Ideen enthalten ist. Gib AUSSCHLIESSLICH JSON in der Form {"stance": "ein Satz"} zurück.',
    matrixAuthor: 'AUTOR', matrixTheme: 'THEMA', matrixIdeas: 'IDEEN DES AUTORS ZU DIESEM THEMA', matrixReturn: 'Gib {"stance": "…"} zurück.',
    workSystem: (max) => 'Du bist ein wissenschaftlicher Forschungsassistent. Erstelle aus den extrahierten Ideen EINES Werks ein kurzes Syntheseblatt, um dieses Werk innerhalb eines Korpus zu untersuchen. Erfinde keine externen Informationen oder Zitate. Arbeite ausschließlich mit den bereitgestellten Ideen, Themen und Verbindungen. Gib AUSSCHLIESSLICH JSON in der Form {"thesis": "1-2 Sätze zur zentralen These des Werks", "remember": ["Kernpunkt", "..."], "positioning": "ein Absatz über den inneren Aufbau sowie enthaltene Spannungen oder Beziehungen"} zurück. Das Feld "remember" muss zwischen 3 und ' + max + ' kurze Punkte enthalten.',
    work: 'WERK', authors: 'AUTOREN', themes: 'THEMEN', workIdeas: 'IDEEN DES WERKS', connections: 'INTERNE VERBINDUNGEN ZWISCHEN IDEEN', workReturn: 'Gib das Synthese-JSON des Werks zurück.', noAuthorship: 'Urheberschaft nicht verfügbar', noThemes: 'keine Themen erfasst', noConnections: 'keine internen Verbindungen erfasst', primary: 'primär', secondary: 'sekundär', ideaTypes: { claim: 'Behauptung', finding: 'Ergebnis', construct: 'Konstrukt', method: 'Methode', framework: 'Rahmen' },
  },
  pt: {
    matrixSystem: 'És um assistente de investigação académica. Resume numa ÚNICA frase a posição de um autor sobre um tema concreto, usando apenas as ideias fornecidas. Não inventes nada que não conste dessas ideias. Devolve EXCLUSIVAMENTE JSON com a forma {"stance": "uma frase"}.',
    matrixAuthor: 'AUTOR', matrixTheme: 'TEMA', matrixIdeas: 'IDEIAS DO AUTOR SOBRE ESTE TEMA', matrixReturn: 'Devolve {"stance": "…"}.',
    workSystem: (max) => 'És um assistente de investigação académica. A partir das ideias extraídas de UMA obra, produz uma ficha breve de síntese para estudar essa obra dentro de um corpus. Não inventes informação externa nem citações. Trabalha apenas com as ideias, temas e conexões fornecidos. Devolve EXCLUSIVAMENTE JSON com a forma {"thesis": "1-2 frases com a tese central da obra", "remember": ["ponto-chave", "..."], "positioning": "um parágrafo sobre a sua organização interna e as tensões ou relações que contém"}. O campo "remember" deve conter entre 3 e ' + max + ' pontos breves.',
    work: 'OBRA', authors: 'AUTORES', themes: 'TEMAS', workIdeas: 'IDEIAS DA OBRA', connections: 'CONEXÕES INTERNAS ENTRE IDEIAS', workReturn: 'Devolve o JSON de síntese da obra.', noAuthorship: 'autoria não disponível', noThemes: 'sem temas registados', noConnections: 'sem conexões internas registadas', primary: 'principal', secondary: 'secundária', ideaTypes: { claim: 'afirmação', finding: 'descoberta', construct: 'constructo', method: 'método', framework: 'quadro' },
  },
  'pt-BR': {
    matrixSystem: 'Você é um assistente de pesquisa acadêmica. Resuma em UMA única frase a posição de um autor sobre um tema específico, usando somente as ideias fornecidas. Não invente nada que não esteja nessas ideias. Retorne EXCLUSIVAMENTE JSON no formato {"stance": "uma frase"}.',
    matrixAuthor: 'AUTOR', matrixTheme: 'TEMA', matrixIdeas: 'IDEIAS DO AUTOR SOBRE ESTE TEMA', matrixReturn: 'Retorne {"stance": "…"}.',
    workSystem: (max) => 'Você é um assistente de pesquisa acadêmica. A partir das ideias extraídas de UMA obra, produza uma ficha breve de síntese para estudar essa obra dentro de um corpus. Não invente informações externas nem citações. Trabalhe somente com as ideias, os temas e as conexões fornecidos. Retorne EXCLUSIVAMENTE JSON no formato {"thesis": "1-2 frases com a tese central da obra", "remember": ["ponto-chave", "..."], "positioning": "um parágrafo sobre sua organização interna e as tensões ou relações que contém"}. O campo "remember" deve conter entre 3 e ' + max + ' pontos breves.',
    work: 'OBRA', authors: 'AUTORES', themes: 'TEMAS', workIdeas: 'IDEIAS DA OBRA', connections: 'CONEXÕES INTERNAS ENTRE IDEIAS', workReturn: 'Retorne o JSON de síntese da obra.', noAuthorship: 'autoria não disponível', noThemes: 'sem temas registrados', noConnections: 'sem conexões internas registradas', primary: 'principal', secondary: 'secundária', ideaTypes: { claim: 'afirmação', finding: 'achado', construct: 'construto', method: 'método', framework: 'estrutura' },
  },
  it: {
    matrixSystem: 'Sei un assistente di ricerca accademica. Riassumi in UNA sola frase la posizione di un autore su un tema specifico, basandoti unicamente sulle idee fornite. Non inventare nulla che non sia presente nelle idee. Restituisci ESCLUSIVAMENTE JSON nella forma {"stance": "una frase"}.',
    matrixAuthor: 'AUTORE', matrixTheme: 'TEMA', matrixIdeas: 'IDEE DELL’AUTORE SU QUESTO TEMA', matrixReturn: 'Restituisci {"stance": "…"}.',
    workSystem: (max) => 'Sei un assistente di ricerca accademica. A partire dalle idee estratte da UNA sola opera, produci una breve scheda di sintesi per studiare quell’opera all’interno di un corpus. Non inventare informazioni esterne né citazioni. Lavora soltanto con le idee, i temi e i collegamenti forniti. Restituisci ESCLUSIVAMENTE JSON nella forma {"thesis": "1-2 frasi con la tesi centrale dell’opera", "remember": ["punto chiave", "..."], "positioning": "un paragrafo sulla sua organizzazione interna e sulle tensioni o relazioni che contiene"}. Il campo "remember" deve contenere da 3 a ' + max + ' punti brevi.',
    work: 'OPERA', authors: 'AUTORI', themes: 'TEMI', workIdeas: 'IDEE DELL’OPERA', connections: 'COLLEGAMENTI INTERNI TRA LE IDEE', workReturn: 'Restituisci il JSON di sintesi dell’opera.', noAuthorship: 'autori non disponibili', noThemes: 'nessun tema registrato', noConnections: 'nessun collegamento interno registrato', primary: 'principale', secondary: 'secondaria', ideaTypes: { claim: 'affermazione', finding: 'risultato', construct: 'costrutto', method: 'metodo', framework: 'quadro' },
  },
  tr: {
    matrixSystem: 'Akademik bir araştırma asistanısın. Bir yazarın belirli bir tema hakkındaki konumunu yalnızca sağlanan fikirlere dayanarak TEK cümlede özetle. Fikirlerde bulunmayan hiçbir şeyi uydurma. YALNIZCA {"stance": "tek cümle"} biçiminde JSON döndür.',
    matrixAuthor: 'YAZAR', matrixTheme: 'TEMA', matrixIdeas: 'YAZARIN BU TEMA HAKKINDAKİ FİKİRLERİ', matrixReturn: '{"stance": "…"} döndür.',
    workSystem: (max) => 'Akademik bir araştırma asistanısın. TEK bir eserden çıkarılmış fikirlerden, o eseri bir derlem içinde incelemek için kısa bir sentez fişi oluştur. Dış bilgi veya alıntı uydurma. Yalnızca sağlanan fikirler, temalar ve bağlantılarla çalış. YALNIZCA {"thesis": "eserin ana tezini belirten 1-2 cümle", "remember": ["temel nokta", "..."], "positioning": "iç düzenini ve içerdiği gerilim veya ilişkileri açıklayan bir paragraf"} biçiminde JSON döndür. "remember" alanı 3 ile ' + max + ' arasında kısa nokta içermelidir.',
    work: 'ESER', authors: 'YAZARLAR', themes: 'TEMALAR', workIdeas: 'ESERİN FİKİRLERİ', connections: 'FİKİRLER ARASINDAKİ İÇ BAĞLANTILAR', workReturn: 'Eser sentezinin JSON çıktısını döndür.', noAuthorship: 'yazarlık bilgisi yok', noThemes: 'kayıtlı tema yok', noConnections: 'kayıtlı iç bağlantı yok', primary: 'birincil', secondary: 'ikincil', ideaTypes: { claim: 'iddia', finding: 'bulgu', construct: 'yapı', method: 'yöntem', framework: 'çerçeve' },
  },
  'zh-Hans': {
    matrixSystem: '你是一位学术研究助手。请仅使用所提供的观点，用一句话概括某位作者对某一特定主题的立场。不要编造这些观点中不存在的内容。仅返回如下形式的 JSON：{"stance": "一句话"}。',
    matrixAuthor: '作者', matrixTheme: '主题', matrixIdeas: '该作者关于这一主题的观点', matrixReturn: '返回 {"stance": "…"}。',
    workSystem: (max) => '你是一位学术研究助手。请根据从一部著作中提取的观点，生成一份简短的综合作业单，以便在语料库中研读该著作。不要编造外部信息或引文。只使用所提供的观点、主题和联系。仅返回如下形式的 JSON：{"thesis": "1-2 句话，说明该著作的核心论点", "remember": ["要点", "..."], "positioning": "一段话，说明其内部组织方式以及其中包含的张力或关系"}。"remember" 字段必须包含 3 到 ' + max + ' 个简短要点。',
    work: '著作', authors: '作者', themes: '主题', workIdeas: '该著作的观点', connections: '观点之间的内部联系', workReturn: '返回该著作的综合 JSON。', noAuthorship: '作者信息不可用', noThemes: '未记录主题', noConnections: '未记录内部联系', primary: '主要', secondary: '次要', ideaTypes: { claim: '主张', finding: '发现', construct: '构念', method: '方法', framework: '框架' },
  },
  'zh-Hant': {
    matrixSystem: '你是一位學術研究助手。請僅使用所提供的觀點，用一句話概括某位作者對某一特定主題的立場。不要編造這些觀點中不存在的內容。僅回傳如下形式的 JSON：{"stance": "一句話"}。',
    matrixAuthor: '作者', matrixTheme: '主題', matrixIdeas: '該作者關於這一主題的觀點', matrixReturn: '回傳 {"stance": "…"}。',
    workSystem: (max) => '你是一位學術研究助手。請根據從一部著作中擷取的觀點，產生一份簡短的綜合作業單，以便在語料庫中研讀該著作。不要編造外部資訊或引文。只使用所提供的觀點、主題和連結。僅回傳如下形式的 JSON：{"thesis": "1-2 句話，說明該著作的核心論點", "remember": ["要點", "..."], "positioning": "一段話，說明其內部組織方式以及其中包含的張力或關係"}。"remember" 欄位必須包含 3 到 ' + max + ' 個簡短要點。',
    work: '著作', authors: '作者', themes: '主題', workIdeas: '該著作的觀點', connections: '觀點之間的內部連結', workReturn: '回傳該著作的綜合 JSON。', noAuthorship: '作者資訊不可用', noThemes: '未記錄主題', noConnections: '未記錄內部連結', primary: '主要', secondary: '次要', ideaTypes: { claim: '主張', finding: '發現', construct: '構念', method: '方法', framework: '框架' },
  },
  vi: {
    matrixSystem: 'Bạn là trợ lý nghiên cứu học thuật. Hãy tóm tắt lập trường của một tác giả về một chủ đề cụ thể trong MỘT câu, chỉ dùng những ý tưởng được cung cấp. Không bịa đặt bất cứ điều gì không có trong những ý tưởng đó. Chỉ trả về JSON theo dạng {"stance": "một câu"}.',
    matrixAuthor: 'TÁC GIẢ', matrixTheme: 'CHỦ ĐỀ', matrixIdeas: 'Ý TƯỞNG CỦA TÁC GIẢ VỀ CHỦ ĐỀ NÀY', matrixReturn: 'Trả về {"stance": "…"}.',
    workSystem: (max) => 'Bạn là trợ lý nghiên cứu học thuật. Từ những ý tưởng được trích xuất từ MỘT tác phẩm, hãy tạo một phiếu tổng hợp ngắn để nghiên cứu tác phẩm đó trong một ngữ liệu. Không bịa đặt thông tin hay trích dẫn bên ngoài. Chỉ làm việc với những ý tưởng, chủ đề và kết nối được cung cấp. Chỉ trả về JSON theo dạng {"thesis": "1-2 câu nêu luận điểm trung tâm của tác phẩm", "remember": ["điểm chính", "..."], "positioning": "một đoạn về cách tổ chức nội tại và những căng thẳng hoặc quan hệ mà tác phẩm chứa đựng"}. Trường "remember" phải chứa từ 3 đến ' + max + ' điểm ngắn gọn.',
    work: 'TÁC PHẨM', authors: 'TÁC GIẢ', themes: 'CHỦ ĐỀ', workIdeas: 'Ý TƯỞNG CỦA TÁC PHẨM', connections: 'KẾT NỐI NỘI TẠI GIỮA CÁC Ý TƯỞNG', workReturn: 'Trả về JSON tổng hợp của tác phẩm.', noAuthorship: 'không có thông tin tác giả', noThemes: 'không có chủ đề nào được ghi lại', noConnections: 'không có kết nối nội tại nào được ghi lại', primary: 'chính', secondary: 'phụ', ideaTypes: { claim: 'khẳng định', finding: 'phát hiện', construct: 'cấu trúc', method: 'phương pháp', framework: 'khung' },
  },
  ja: {
    matrixSystem: 'あなたは学術研究助手です。特定のテーマに対するある著者の立場を、提供されたアイデアのみを用いて一文で要約してください。それらのアイデアにない事柄を捏造しないでください。{"stance": "一文"} の形式の JSON のみを返してください。',
    matrixAuthor: '著者', matrixTheme: 'テーマ', matrixIdeas: 'このテーマに関する著者のアイデア', matrixReturn: '{"stance": "…"} を返してください。',
    workSystem: (max) => 'あなたは学術研究助手です。一つの著作から抽出されたアイデアをもとに、コーパス内でその著作を研究するための簡潔な総合シートを作成してください。外部情報や引用を捏造しないでください。提供されたアイデア、テーマ、つながりのみを使用してください。{"thesis": "その著作の中心論点を示す 1-2 文", "remember": ["要点", "..."], "positioning": "その内部構成と、含まれる緊張や関係を説明する一段落"} の形式の JSON のみを返してください。"remember" フィールドには、3 から ' + max + ' 個の簡潔な要点を含めてください。',
    work: '著作', authors: '著者', themes: 'テーマ', workIdeas: '著作のアイデア', connections: 'アイデア間の内部的なつながり', workReturn: '著作の総合 JSON を返してください。', noAuthorship: '著者情報なし', noThemes: 'テーマの記録なし', noConnections: '内部的なつながりの記録なし', primary: '主要', secondary: '副次', ideaTypes: { claim: '主張', finding: '知見', construct: '構成概念', method: '方法', framework: '枠組み' },
  },
  ru: {
    matrixSystem: 'Вы ассистент академического исследователя. Сформулируйте позицию автора по конкретной теме ОДНИМ предложением, используя только предоставленные идеи. Не выдумывайте ничего, чего нет в этих идеях. Верните ИСКЛЮЧИТЕЛЬНО JSON в форме {"stance": "одно предложение"}.',
    matrixAuthor: 'АВТОР', matrixTheme: 'ТЕМА', matrixIdeas: 'ИДЕИ АВТОРА ПО ЭТОЙ ТЕМЕ', matrixReturn: 'Верните {"stance": "…"}.',
    workSystem: (max) => 'Вы ассистент академического исследователя. На основе идей, извлечённых из ОДНОГО произведения, составьте краткую синтетическую карточку для изучения этого произведения в рамках корпуса. Не выдумывайте внешнюю информацию или цитаты. Работайте только с предоставленными идеями, темами и связями. Верните ИСКЛЮЧИТЕЛЬНО JSON в форме {"thesis": "1-2 предложения с центральным тезисом произведения", "remember": ["ключевой пункт", "..."], "positioning": "один абзац о его внутренней организации и содержащихся в нём напряжениях или связях"}. Поле "remember" должно содержать от 3 до ' + max + ' кратких пунктов.',
    work: 'ПРОИЗВЕДЕНИЕ', authors: 'АВТОРЫ', themes: 'ТЕМЫ', workIdeas: 'ИДЕИ ПРОИЗВЕДЕНИЯ', connections: 'ВНУТРЕННИЕ СВЯЗИ МЕЖДУ ИДЕЯМИ', workReturn: 'Верните JSON синтеза произведения.', noAuthorship: 'авторство недоступно', noThemes: 'темы не зафиксированы', noConnections: 'внутренние связи не зафиксированы', primary: 'основной', secondary: 'второстепенный', ideaTypes: { claim: 'утверждение', finding: 'находка', construct: 'конструкт', method: 'метод', framework: 'рамка' },
  },
  uk: {
    matrixSystem: 'Ви асистент академічного дослідника. Сформулюйте позицію автора щодо конкретної теми ОДНИМ реченням, використовуючи лише надані ідеї. Не вигадуйте нічого, чого немає в цих ідеях. Поверніть ВИКЛЮЧНО JSON у формі {"stance": "одне речення"}.',
    matrixAuthor: 'АВТОР', matrixTheme: 'ТЕМА', matrixIdeas: 'ІДЕЇ АВТОРА ЩОДО ЦІЄЇ ТЕМИ', matrixReturn: 'Поверніть {"stance": "…"}.',
    workSystem: (max) => 'Ви асистент академічного дослідника. На основі ідей, вилучених з ОДНОГО твору, складіть стислу синтетичну картку для вивчення цього твору в межах корпусу. Не вигадуйте зовнішню інформацію чи цитати. Працюйте лише з наданими ідеями, темами та зв’язками. Поверніть ВИКЛЮЧНО JSON у формі {"thesis": "1-2 речення з центральною тезою твору", "remember": ["ключовий пункт", "..."], "positioning": "один абзац про його внутрішню організацію та наявні в ньому напруження чи зв’язки"}. Поле "remember" має містити від 3 до ' + max + ' стислих пунктів.',
    work: 'ТВІР', authors: 'АВТОРИ', themes: 'ТЕМИ', workIdeas: 'ІДЕЇ ТВОРУ', connections: 'ВНУТРІШНІ ЗВ’ЯЗКИ МІЖ ІДЕЯМИ', workReturn: 'Поверніть JSON синтезу твору.', noAuthorship: 'авторство недоступне', noThemes: 'теми не зафіксовано', noConnections: 'внутрішні зв’язки не зафіксовано', primary: 'основна', secondary: 'другорядна', ideaTypes: { claim: 'твердження', finding: 'знахідка', construct: 'конструкт', method: 'метод', framework: 'рамка' },
  },
  ko: {
    matrixSystem: '당신은 학술 연구 조수입니다. 특정 주제에 대한 한 저자의 입장을 제공된 아이디어만 사용하여 한 문장으로 요약하십시오. 그 아이디어에 없는 내용을 날조하지 마십시오. {"stance": "한 문장"} 형식의 JSON만 반환하십시오.',
    matrixAuthor: '저자', matrixTheme: '주제', matrixIdeas: '이 주제에 대한 저자의 아이디어', matrixReturn: '{"stance": "…"}를 반환하십시오.',
    workSystem: (max) => '당신은 학술 연구 조수입니다. 한 편의 저작에서 추출된 아이디어를 바탕으로, 코퍼스 안에서 그 저작을 연구하기 위한 간략한 종합 카드를 작성하십시오. 외부 정보나 인용을 날조하지 마십시오. 제공된 아이디어, 주제, 연결만 사용하십시오. {"thesis": "저작의 중심 논지를 밝히는 1-2문장", "remember": ["핵심 요점", "..."], "positioning": "내부 구성과 그 안에 담긴 긴장 또는 관계를 설명하는 한 문단"} 형식의 JSON만 반환하십시오. "remember" 필드에는 3개에서 ' + max + '개 사이의 간략한 요점이 들어가야 합니다.',
    work: '저작', authors: '저자', themes: '주제', workIdeas: '저작의 아이디어', connections: '아이디어 간의 내부 연결', workReturn: '저작 종합 JSON을 반환하십시오.', noAuthorship: '저자 정보 없음', noThemes: '기록된 주제 없음', noConnections: '기록된 내부 연결 없음', primary: '주요', secondary: '부차적', ideaTypes: { claim: '주장', finding: '발견', construct: '구성 개념', method: '방법', framework: '프레임워크' },
  },
};

export function synthesisPromptPack(language: PromptLanguage = 'es'): SynthesisPromptPack {
  return PACKS[language] ?? PACKS.es;
}
