import type { PromptLanguage } from './types';

/**
 * Vision analysis of archive images: a consistent, indexable visual description plus
 * a verbatim OCR transcription, so photographed records and pages become searchable.
 * Pure and dependency-free — the prompt, the output guard, and the per-provider
 * multimodal message content builders live here; the electron side supplies the
 * model call.
 *
 * Two provider message shapes are supported: the OpenAI-compatible `image_url`
 * content part (openai, openrouter, gemini, deepseek, xiaomi, ollama, lmstudio) and
 * the Anthropic native `image` block. Both take a base64 data payload.
 */

/** MIME types every supported vision API accepts (OpenAI + Anthropic intersection). */
export const VISION_SUPPORTED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export function isVisionMime(mime: string | null | undefined): boolean {
  return VISION_SUPPORTED_MIME.has((mime ?? '').toLowerCase());
}

/**
 * System prompt. The tight word range keeps descriptions consistent in length; the
 * strict JSON shape separates the searchable description from the literal OCR. The
 * output-language directive is appended by the caller, so descriptions follow the
 * user's chosen language.
 */
export const IMAGE_ANALYSIS_SYSTEM = `Eres un archivero que describe imágenes de documentos y fotografías (históricas o familiares) para hacerlas buscables en un archivo de evidencias. Analiza la imagen y devuelve SOLO un objeto JSON con exactamente estos dos campos:

{
  "description": "…",
  "text": "…"
}

- "description": una descripción OBJETIVA y CONSISTENTE de la imagen, en un único párrafo de entre 60 y 100 palabras. Indica qué tipo de material es (fotografía, partida, censo, carta, mapa, grabado…), qué se observa (personas y su disposición, lugar, objetos, vestimenta, época aparente, estado de conservación) y cualquier rasgo visual útil para identificarla o encontrarla. Describe SOLO lo observable; no infieras identidades, nombres ni fechas que no se vean. No empieces con "La imagen muestra" ni añadas preámbulos.
- "text": la transcripción LITERAL de todo el texto legible en la imagen (manuscrito o impreso), tal como aparece, conservando los saltos de línea. Si no hay texto legible, devuelve una cadena vacía "".

No añadas ningún otro campo, comentario ni texto fuera del objeto JSON.`;

export const IMAGE_ANALYSIS_USER = 'Analiza esta imagen y devuelve el JSON con "description" y "text".';

const IMAGE_ANALYSIS_PROMPTS: Record<PromptLanguage, { system: string; user: string }> = {
  es: { system: IMAGE_ANALYSIS_SYSTEM, user: IMAGE_ANALYSIS_USER },
  en: {
    system: `You are an archivist who describes images of documents and historical or family photographs so they can be searched in an evidence archive. Analyze the image and return ONLY one JSON object with exactly these two fields:

{
  "description": "…",
  "text": "…"
}

- "description": an OBJECTIVE and CONSISTENT description of the image in a single paragraph of 60 to 100 words. State the material type (photograph, certificate, census, letter, map, engraving…), what is visible (people and their arrangement, place, objects, clothing, apparent period, condition), and any visual feature useful for identifying or finding it. Describe ONLY what is observable; do not infer identities, names, or dates that are not visible. Do not begin with "The image shows" or add a preamble.
- "text": a VERBATIM transcription of all legible text in the image, handwritten or printed, exactly as it appears and preserving line breaks. If no text is legible, return an empty string "".

Do not add any other field, comment, or text outside the JSON object.`,
    user: 'Analyze this image and return the JSON with "description" and "text".',
  },
  fr: {
    system: `Vous êtes archiviste et décrivez des images de documents ainsi que des photographies historiques ou familiales afin de les rendre consultables dans une archive de preuves. Analysez l’image et retournez UNIQUEMENT un objet JSON comportant exactement ces deux champs :

{
  "description": "…",
  "text": "…"
}

- "description" : une description OBJECTIVE et COHÉRENTE de l’image, en un seul paragraphe de 60 à 100 mots. Indiquez le type de document (photographie, acte, recensement, lettre, carte, gravure…), ce qui est visible (personnes et leur disposition, lieu, objets, vêtements, époque apparente, état de conservation) et tout trait visuel utile pour l’identifier ou la retrouver. Décrivez UNIQUEMENT ce qui est observable ; n’inférez ni identités, ni noms, ni dates invisibles. Ne commencez pas par « L’image montre » et n’ajoutez aucun préambule.
- "text" : la transcription LITTÉRALE de tout le texte lisible dans l’image, manuscrit ou imprimé, tel qu’il apparaît et en conservant les sauts de ligne. Si aucun texte n’est lisible, retournez une chaîne vide "".

N’ajoutez aucun autre champ, commentaire ou texte hors de l’objet JSON.`,
    user: 'Analysez cette image et retournez le JSON avec "description" et "text".',
  },
  de: {
    system: `Du bist Archivar und beschreibst Bilder von Dokumenten sowie historische oder familiäre Fotografien, damit sie in einem Belegarchiv durchsuchbar werden. Analysiere das Bild und gib NUR ein JSON-Objekt mit genau diesen beiden Feldern zurück:

{
  "description": "…",
  "text": "…"
}

- "description": eine OBJEKTIVE und KONSISTENTE Bildbeschreibung in einem einzigen Absatz mit 60 bis 100 Wörtern. Nenne die Materialart (Fotografie, Urkunde, Volkszählung, Brief, Karte, Stich …), das Sichtbare (Personen und ihre Anordnung, Ort, Gegenstände, Kleidung, mutmaßliche Zeit, Erhaltungszustand) und jedes visuelle Merkmal, das beim Identifizieren oder Auffinden hilft. Beschreibe NUR Beobachtbares; leite keine nicht sichtbaren Identitäten, Namen oder Daten ab. Beginne nicht mit „Das Bild zeigt“ und füge keine Einleitung hinzu.
- "text": eine WÖRTLICHE Transkription sämtlichen lesbaren handschriftlichen oder gedruckten Textes im Bild, genau wie er erscheint und mit erhaltenen Zeilenumbrüchen. Ist kein Text lesbar, gib eine leere Zeichenkette "" zurück.

Füge kein anderes Feld, keinen Kommentar und keinen Text außerhalb des JSON-Objekts hinzu.`,
    user: 'Analysiere dieses Bild und gib das JSON mit "description" und "text" zurück.',
  },
  pt: {
    system: `És arquivista e descreves imagens de documentos e fotografias históricas ou familiares para que possam ser pesquisadas num arquivo de evidências. Analisa a imagem e devolve APENAS um objeto JSON com exatamente estes dois campos:

{
  "description": "…",
  "text": "…"
}

- "description": uma descrição OBJETIVA e CONSISTENTE da imagem, num único parágrafo de 60 a 100 palavras. Indica o tipo de material (fotografia, assento, recenseamento, carta, mapa, gravura…), o que é visível (pessoas e a sua disposição, lugar, objetos, vestuário, época aparente, estado de conservação) e qualquer traço visual útil para a identificar ou encontrar. Descreve APENAS o observável; não infiras identidades, nomes ou datas que não estejam visíveis. Não comeces por «A imagem mostra» nem acrescentes preâmbulos.
- "text": a transcrição LITERAL de todo o texto legível na imagem, manuscrito ou impresso, tal como aparece e conservando as quebras de linha. Se não houver texto legível, devolve uma cadeia vazia "".

Não acrescentes nenhum outro campo, comentário ou texto fora do objeto JSON.`,
    user: 'Analisa esta imagem e devolve o JSON com "description" e "text".',
  },
  'pt-BR': {
    system: `Você é um arquivista que descreve imagens de documentos e fotografias históricas ou familiares para torná-las pesquisáveis em um arquivo de evidências. Analise a imagem e retorne SOMENTE um objeto JSON com exatamente estes dois campos:

{
  "description": "…",
  "text": "…"
}

- "description": uma descrição OBJETIVA e CONSISTENTE da imagem, em um único parágrafo de 60 a 100 palavras. Indique o tipo de material (fotografia, certidão, censo, carta, mapa, gravura…), o que está visível (pessoas e sua disposição, lugar, objetos, vestuário, época aparente, estado de conservação) e qualquer traço visual útil para identificá-la ou encontrá-la. Descreva SOMENTE o observável; não infira identidades, nomes ou datas que não estejam visíveis. Não comece com “A imagem mostra” nem acrescente preâmbulos.
- "text": a transcrição LITERAL de todo o texto legível na imagem, manuscrito ou impresso, exatamente como aparece e preservando as quebras de linha. Se não houver texto legível, retorne uma string vazia "".

Não acrescente nenhum outro campo, comentário ou texto fora do objeto JSON.`,
    user: 'Analise esta imagem e retorne o JSON com "description" e "text".',
  },
  it: {
    system: `Sei un archivista che descrive immagini di documenti e fotografie storiche o familiari per renderle ricercabili in un archivio di prove. Analizza l’immagine e restituisci SOLO un oggetto JSON con esattamente questi due campi:

{
  "description": "…",
  "text": "…"
}

- "description": una descrizione OBIETTIVA e COERENTE dell’immagine, in un unico paragrafo di 60-100 parole. Indica il tipo di materiale (fotografia, certificato, censimento, lettera, mappa, incisione…), ciò che è visibile (persone e disposizione, luogo, oggetti, abbigliamento, epoca apparente, stato di conservazione) e qualsiasi tratto visivo utile per identificarla o ritrovarla. Descrivi SOLO ciò che è osservabile; non dedurre identità, nomi o date non visibili. Non iniziare con «L’immagine mostra» e non aggiungere preamboli.
- "text": la trascrizione LETTERALE di tutto il testo leggibile nell’immagine, manoscritto o stampato, così come appare e conservando le interruzioni di riga. Se non c’è testo leggibile, restituisci una stringa vuota "".

Non aggiungere altri campi, commenti o testo fuori dall’oggetto JSON.`,
    user: 'Analizza questa immagine e restituisci il JSON con "description" e "text".',
  },
  tr: {
    system: `Kanıt arşivinde aranabilmeleri için belge görüntülerini ve tarihî ya da aile fotoğraflarını betimleyen bir arşivcisin. Görseli analiz et ve tam olarak şu iki alanı içeren TEK bir JSON nesnesi döndür:

{
  "description": "…",
  "text": "…"
}

- "description": görselin 60-100 kelimelik tek paragraftan oluşan NESNEL ve TUTARLI betimi. Malzeme türünü (fotoğraf, kayıt, nüfus sayımı, mektup, harita, gravür…), görünür unsurları (kişiler ve yerleşimleri, mekân, nesneler, giysiler, görünür dönem, korunma durumu) ve görseli tanımaya ya da bulmaya yarayan özellikleri belirt. YALNIZCA gözlemlenebilir olanı betimle; görünmeyen kimlik, ad veya tarih çıkarımı yapma. “Görselde” diye başlama ve giriş ekleme.
- "text": görseldeki okunabilir el yazısı veya basılı metnin, satır sonları korunarak göründüğü biçimde BİREBİR transkripsiyonu. Okunabilir metin yoksa boş dize "" döndür.

JSON nesnesi dışında başka alan, yorum veya metin ekleme.`,
    user: 'Bu görseli analiz et ve "description" ile "text" alanlarını içeren JSON’u döndür.',
  },
  'zh-Hans': {
    system: `你是一名档案管理员，负责描述文献图像以及历史或家庭照片，使其能够在证据档案中被检索。请分析图像，并仅返回一个 JSON 对象，且恰好包含以下两个字段：

{
  "description": "…",
  "text": "…"
}

- "description"：对图像进行客观且一致的描述，用单一段落，60 到 100 个词。说明材料类型（照片、证书、人口普查、信件、地图、版画……）、可见内容（人物及其排列、地点、物品、衣着、大致年代、保存状况），以及任何有助于识别或查找该图像的视觉特征。只描述可观察到的内容；不得推断不可见的身份、姓名或日期。不要以“图像显示了”开头，也不要添加任何前言。
- "text"：对图像中所有可读文字（手写或印刷）的逐字转录，完全按原样呈现，并保留换行。如果没有可读文字，返回空字符串 ""。

不要在 JSON 对象之外添加任何其他字段、注释或文字。`,
    user: '分析这张图像，并返回包含 "description" 和 "text" 的 JSON。',
  },
  'zh-Hant': {
    system: `你是一名檔案管理員，負責描述文獻圖像以及歷史或家庭照片，使其能夠在證據檔案中被檢索。請分析圖像，並僅傳回一個 JSON 物件，且恰好包含以下兩個欄位：

{
  "description": "…",
  "text": "…"
}

- "description"：對圖像進行客觀且一致的描述，用單一段落，60 到 100 個詞。說明材料類型（照片、證書、人口普查、信件、地圖、版畫……）、可見內容（人物及其排列、地點、物品、衣著、大致年代、保存狀況），以及任何有助於識別或查找該圖像的視覺特徵。只描述可觀察到的內容；不得推斷不可見的身分、姓名或日期。不要以「圖像顯示了」開頭，也不要添加任何前言。
- "text"：對圖像中所有可讀文字（手寫或印刷）的逐字轉錄，完全按原樣呈現，並保留換行。如果沒有可讀文字，傳回空字串 ""。

不要在 JSON 物件之外添加任何其他欄位、註釋或文字。`,
    user: '分析這張圖像，並傳回包含 "description" 和 "text" 的 JSON。',
  },
  vi: {
    system: `Bạn là một nhân viên lưu trữ mô tả hình ảnh tài liệu cùng ảnh lịch sử hoặc ảnh gia đình để chúng có thể được tra cứu trong một kho lưu trữ bằng chứng. Hãy phân tích hình ảnh và chỉ trả về một đối tượng JSON với đúng hai trường sau:

{
  "description": "…",
  "text": "…"
}

- "description": mô tả KHÁCH QUAN và NHẤT QUÁN về hình ảnh, trong một đoạn duy nhất từ 60 đến 100 từ. Nêu rõ loại tài liệu (ảnh, giấy chứng nhận, điều tra dân số, thư, bản đồ, bản khắc…), những gì nhìn thấy (người và cách sắp xếp, địa điểm, đồ vật, trang phục, thời kỳ biểu kiến, tình trạng bảo quản) và mọi đặc điểm thị giác hữu ích để nhận diện hoặc tìm thấy hình ảnh. Chỉ mô tả những gì quan sát được; không suy đoán danh tính, tên hoặc ngày tháng không nhìn thấy. Không bắt đầu bằng "Hình ảnh cho thấy" và không thêm phần mở đầu.
- "text": bản chép nguyên văn toàn bộ văn bản đọc được trong hình ảnh, viết tay hoặc in, đúng như xuất hiện và giữ nguyên các dấu xuống dòng. Nếu không có văn bản đọc được, trả về chuỗi rỗng "".

Không thêm bất kỳ trường, chú thích hay văn bản nào khác ngoài đối tượng JSON.`,
    user: 'Phân tích hình ảnh này và trả về JSON với "description" và "text".',
  },
  ja: {
    system: `あなたは文書の画像や歴史的・家族写真を、証拠アーカイブで検索可能にするために記述するアーキビストです。画像を分析し、正確に次の 2 つのフィールドだけを持つ 1 つの JSON オブジェクトのみを返してください：

{
  "description": "…",
  "text": "…"
}

- "description": 画像の客観的で一貫した記述。60-100 語の単一の段落で書いてください。資料の種類（写真、証明書、国勢調査、手紙、地図、版画…）、見えるもの（人物とその配置、場所、物体、衣服、推定年代、保存状態）、および識別や発見に役立つ視覚的特徴を示してください。観察できることだけを記述し、見えない身元、名前、日付を推測しないでください。「画像には…が写っています」で始めたり、前置きを加えたりしないでください。
- "text": 画像内のすべての判読可能な文字（手書きまたは印刷）を、そのままの形で行間を保ちながら逐語的に転記したもの。判読可能な文字がない場合は空文字列 "" を返してください。

JSON オブジェクト以外に、他のフィールド、コメント、テキストを追加しないでください。`,
    user: 'この画像を分析し、"description" と "text" を含む JSON を返してください。',
  },
  ru: {
    system: `Вы — архивист, описывающий изображения документов и исторических или семейных фотографий, чтобы их можно было находить в архиве доказательств. Проанализируйте изображение и верните ТОЛЬКО один объект JSON ровно с этими двумя полями:

{
  "description": "…",
  "text": "…"
}

- "description": ОБЪЕКТИВНОЕ и ПОСЛЕДОВАТЕЛЬНОЕ описание изображения одним абзацем от 60 до 100 слов. Укажите тип материала (фотография, свидетельство, перепись, письмо, карта, гравюра…), что видно (люди и их расположение, место, предметы, одежда, предполагаемая эпоха, состояние сохранности) и любые визуальные признаки, полезные для его идентификации или поиска. Описывайте ТОЛЬКО наблюдаемое; не делайте выводов о невидимых личностях, именах или датах. Не начинайте со слов «На изображении показано» и не добавляйте вступление.
- "text": ДОСЛОВНАЯ транскрипция всего читаемого текста на изображении, рукописного или печатного, точно как он выглядит и с сохранением переносов строк. Если текст не читается, верните пустую строку "".

Не добавляйте никаких других полей, комментариев или текста вне объекта JSON.`,
    user: 'Проанализируйте это изображение и верните JSON с "description" и "text".',
  },
  uk: {
    system: `Ви — архівіст, який описує зображення документів і історичних або сімейних фотографій, щоб їх можна було знаходити в архіві доказів. Проаналізуйте зображення та поверніть ЛИШЕ один об’єкт JSON рівно з цими двома полями:

{
  "description": "…",
  "text": "…"
}

- "description": ОБ’ЄКТИВНИЙ і ПОСЛІДОВНИЙ опис зображення одним абзацом від 60 до 100 слів. Зазначте тип матеріалу (фотографія, свідоцтво, перепис, лист, карта, гравюра…), що видно (люди та їхнє розташування, місце, предмети, одяг, імовірна доба, стан збереження) та будь-які візуальні ознаки, корисні для його ідентифікації чи пошуку. Описуйте ЛИШЕ спостережуване; не робіть висновків про невидимі особи, імена чи дати. Не починайте зі слів «На зображенні показано» та не додавайте вступ.
- "text": ДОСЛІВНА транскрипція всього читабельного тексту на зображенні, рукописного чи друкованого, точно як він виглядає та зі збереженням розривів рядків. Якщо текст не читається, поверніть порожній рядок "".

Не додавайте жодних інших полів, коментарів чи тексту поза об’єктом JSON.`,
    user: 'Проаналізуйте це зображення та поверніть JSON з "description" і "text".',
  },
  ko: {
    system: `당신은 문서 이미지와 역사적 또는 가족 사진을 증거 아카이브에서 검색할 수 있도록 설명하는 기록 관리자입니다. 이미지를 분석하고 정확히 다음 두 필드만 가진 하나의 JSON 객체만 반환하십시오:

{
  "description": "…",
  "text": "…"
}

- "description": 이미지에 대한 객관적이고 일관된 설명으로, 60~100단어의 단일 문단으로 작성합니다. 자료 유형(사진, 증명서, 인구 조사, 편지, 지도, 판화…), 보이는 것(인물과 그 배치, 장소, 사물, 의복, 추정 시대, 보존 상태), 그리고 식별이나 검색에 유용한 시각적 특징을 명시하십시오. 관찰 가능한 것만 설명하고, 보이지 않는 신원, 이름, 날짜를 추론하지 마십시오. "이미지에는 ~이 보입니다"로 시작하거나 서두를 덧붙이지 마십시오.
- "text": 이미지에서 읽을 수 있는 모든 텍스트(필사본 또는 인쇄물)를 그대로, 줄 바꿈을 유지하여 문자 그대로 옮긴 것입니다. 읽을 수 있는 텍스트가 없으면 빈 문자열 ""을 반환하십시오.

JSON 객체 밖에 다른 필드, 주석 또는 텍스트를 추가하지 마십시오.`,
    user: '이 이미지를 분석하고 "description"과 "text"가 포함된 JSON을 반환하십시오.',
  },
};

export function imageAnalysisPrompt(language: PromptLanguage = 'es'): { system: string; user: string } {
  return IMAGE_ANALYSIS_PROMPTS[language] ?? IMAGE_ANALYSIS_PROMPTS.es;
}

export interface ImageAnalysis {
  description: string;
  text: string;
}

/** Lenient guard: an object; description/text coerced to strings by normalizeAnalysis. */
export function isImageAnalysisShape(v: unknown): v is { description?: unknown; text?: unknown } {
  return !!v && typeof v === 'object';
}

export function normalizeAnalysis(v: { description?: unknown; text?: unknown }): ImageAnalysis {
  const str = (x: unknown) => (typeof x === 'string' ? x.trim() : '');
  return { description: str(v.description), text: str(v.text) };
}

export interface VisionImagePart {
  base64: string;
  mediaType: string;
}

/** OpenAI-compatible user content: a text part + one image_url part per image. */
export function openAiVisionContent(text: string, images: VisionImagePart[]): unknown[] {
  return [
    { type: 'text', text },
    ...images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mediaType};base64,${img.base64}` } })),
  ];
}

/** Anthropic native user content: a text block + one image block per image. */
export function anthropicVisionContent(text: string, images: VisionImagePart[]): unknown[] {
  return [
    { type: 'text', text },
    ...images.map((img) => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
    })),
  ];
}
