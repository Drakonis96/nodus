/**
 * Records-lens extraction core. Where the deep scan pulls arguable *ideas* from a
 * work, this pulls factual *entities* — persons, places, events — from a primary
 * source (census page, parish register, record dump). Pure and dependency-free:
 * the prompt, the output guard, and the cross-chunk merge/de-duplication live here
 * and are unit-tested without any AI call; the electron orchestrator supplies the
 * model and the persistence.
 *
 * The model refers to persons and places by NAME (it has no ids); the persistence
 * step resolves those names to entity ids, creating records as needed. Every fact
 * carries a verbatim quote + page location so the record layer stays citable.
 */

import type { HistoricalEventType, ParticipantRole, PersonSex, PromptLanguage } from './types';

export const RECORDS_EXTRACTION_PROMPT = `Eres un archivero experto en fuentes primarias y genealogía. Recibes un fragmento de un documento (censo, padrón, partida parroquial, acta, registro, diario, carta, memorias). Extrae ÚNICAMENTE los hechos explícitos en el texto: personas, lugares, eventos y los parentescos que el texto AFIRME. No inventes datos, no deduzcas parentescos que el texto no afirme, no completes fechas que no aparezcan.

REGLA DE ORO: la mera aparición de dos nombres en el mismo texto NO implica ningún parentesco entre ellos. Nunca conviertas una co-aparición en una relación familiar. Solo registra un parentesco cuando el texto lo enuncie de forma explícita (p. ej. "Juan, padre de Ana"; "María, su esposa"; "hijo de Pedro").

Devuelve SOLO un objeto JSON con esta forma:
{
  "persons": [
    { "name": "nombre tal como aparece", "sex": "male|female|unknown", "birth": "fecha de nacimiento si consta, tal como aparece", "death": "fecha de defunción si consta", "quote": "cita literal de la fuente", "location": "p. N si hay marcador" }
  ],
  "places": [ { "name": "nombre del lugar", "kind": "parish|municipality|province|country|other" } ],
  "events": [
    { "type": "birth|baptism|marriage|death|burial|census|residence|migration|occupation|other",
      "date": "fecha tal como aparece",
      "place": "nombre del lugar del evento",
      "label": "descripción breve opcional",
      "participants": [ { "name": "nombre de la persona", "role": "principal|spouse|father|mother|child|witness|officiant|other" } ],
      "quote": "cita literal", "location": "p. N" }
  ],
  "relations": [
    { "subject": "nombre de una persona nombrada", "relation": "father|mother|parent|son|daughter|child|husband|wife|spouse", "object": "nombre de la otra persona nombrada", "quote": "cita literal que afirma el parentesco", "location": "p. N" }
  ]
}

Reglas:
- Copia "quote" EXACTAMENTE como está en la fuente, en su idioma original. Nunca la traduzcas ni la parafrasees.
- Usa los marcadores [[p. N]] del texto para "location". Si no hay marcador, deja "location" vacío; no inventes páginas.
- Las fechas se copian tal como aparecen (p. ej. "hacia 1850", "2 de marzo de 1875"); no las normalices.
- Si un dato no consta, omite el campo (no pongas null ni cadenas inventadas).
- Cada persona que participe en un evento debe aparecer también con su "name" en "participants".
- En "relations", "subject" es <relation> de "object" (p. ej. relation="father" significa que subject es el padre de object). Ambos deben ser personas NOMBRADAS en el texto; no uses la primera persona ("mi padre") salvo que el narrador esté nombrado. Si el texto no afirma ningún parentesco, deja "relations" vacío.`;

interface RecordsExtractionCopy {
  intro: string;
  goldenRule: string;
  returnJson: string;
  personName: string; birth: string; death: string; quote: string; location: string;
  placeName: string; eventDate: string; eventPlace: string; eventLabel: string; participantName: string;
  subject: string; object: string; relationQuote: string;
  rules: string[];
}

const RECORDS_EXTRACTION_COPY: Record<Exclude<PromptLanguage, 'es'>, RecordsExtractionCopy> = {
  en: {
    intro: 'You are an expert archivist in primary sources and genealogy. You receive a document fragment (census, register, parish record, certificate, journal, letter, memoir). Extract ONLY facts explicitly stated in the text: people, places, events, and kinship that the text ASSERTS. Do not invent data, infer unstated kinship, or complete dates that do not appear.',
    goldenRule: 'GOLDEN RULE: two names merely appearing in the same text does NOT imply any kinship between them. Never turn co-occurrence into a family relationship. Record kinship only when the text states it explicitly (for example, “Juan, father of Ana”; “María, his wife”; “son of Pedro”).',
    returnJson: 'Return ONLY one JSON object with this shape:', personName: 'name exactly as written', birth: 'birth date if stated, exactly as written', death: 'death date if stated', quote: 'verbatim source quotation', location: 'p. N when a marker exists', placeName: 'place name', eventDate: 'date exactly as written', eventPlace: 'event place name', eventLabel: 'optional brief description', participantName: 'person name', subject: 'name of a named person', object: 'name of the other named person', relationQuote: 'verbatim quotation asserting the relationship',
    rules: ['Copy every "quote" EXACTLY as it appears in the source, in its original language. Never translate or paraphrase it.', 'Use the text markers [[p. N]] for "location". If there is no marker, leave "location" empty; never invent pages.', 'Copy dates exactly as written (for example, “circa 1850”, “2 March 1875”); do not normalize them.', 'If a value is absent, omit the field (do not use null or invented strings).', 'Every person participating in an event must also appear by "name" in "participants".', 'In "relations", "subject" is <relation> of "object" (for example, relation="father" means subject is the father of object). Both must be people NAMED in the text; do not use first-person references (“my father”) unless the narrator is named. If the text asserts no kinship, leave "relations" empty.'],
  },
  fr: {
    intro: 'Vous êtes archiviste spécialiste des sources primaires et de la généalogie. Vous recevez un fragment de document (recensement, registre, acte paroissial, procès-verbal, journal, lettre, mémoires). Extrayez UNIQUEMENT les faits explicitement énoncés : personnes, lieux, événements et liens de parenté que le texte AFFIRME. N’inventez aucune donnée, ne déduisez aucun lien non affirmé et ne complétez aucune date absente.',
    goldenRule: 'RÈGLE D’OR : la simple présence de deux noms dans le même texte N’implique AUCUN lien de parenté. Ne transformez jamais une cooccurrence en relation familiale. Enregistrez un lien seulement si le texte l’énonce explicitement (par exemple « Juan, père d’Ana » ; « María, son épouse » ; « fils de Pedro »).',
    returnJson: 'Retournez UNIQUEMENT un objet JSON de cette forme :', personName: 'nom tel qu’il apparaît', birth: 'date de naissance si elle est indiquée, telle qu’elle apparaît', death: 'date de décès si elle est indiquée', quote: 'citation littérale de la source', location: 'p. N si un marqueur existe', placeName: 'nom du lieu', eventDate: 'date telle qu’elle apparaît', eventPlace: 'nom du lieu de l’événement', eventLabel: 'courte description facultative', participantName: 'nom de la personne', subject: 'nom d’une personne citée', object: 'nom de l’autre personne citée', relationQuote: 'citation littérale affirmant la parenté',
    rules: ['Copiez "quote" EXACTEMENT comme dans la source, dans sa langue originale. Ne le traduisez ni ne le paraphrasez jamais.', 'Utilisez les marqueurs [[p. N]] du texte pour "location". Sans marqueur, laissez "location" vide ; n’inventez jamais de pages.', 'Copiez les dates telles qu’elles apparaissent (par exemple « vers 1850 », « 2 mars 1875 ») ; ne les normalisez pas.', 'Si une donnée est absente, omettez le champ (n’utilisez ni null ni chaîne inventée).', 'Toute personne participant à un événement doit aussi apparaître par son "name" dans "participants".', 'Dans "relations", "subject" est <relation> de "object" (par exemple relation="father" signifie que subject est le père de object). Tous deux doivent être des personnes NOMMÉES dans le texte ; n’utilisez pas la première personne (« mon père ») sauf si le narrateur est nommé. Si le texte n’affirme aucune parenté, laissez "relations" vide.'],
  },
  de: {
    intro: 'Du bist Facharchivar für Primärquellen und Genealogie. Du erhältst einen Dokumentausschnitt (Volkszählung, Register, Kirchenbucheintrag, Urkunde, Tagebuch, Brief, Memoiren). Extrahiere AUSSCHLIESSLICH ausdrücklich genannte Tatsachen: Personen, Orte, Ereignisse und Verwandtschaft, die der Text BEHAUPTET. Erfinde keine Daten, leite keine ungenannte Verwandtschaft ab und ergänze keine fehlenden Datumsangaben.',
    goldenRule: 'GOLDENE REGEL: Das bloße Auftreten zweier Namen im selben Text bedeutet KEINE Verwandtschaft. Verwandle gemeinsames Auftreten niemals in eine Familienbeziehung. Erfasse Verwandtschaft nur, wenn der Text sie ausdrücklich nennt (z. B. „Juan, Vater von Ana“; „María, seine Ehefrau“; „Sohn von Pedro“).',
    returnJson: 'Gib NUR ein JSON-Objekt in dieser Form zurück:', personName: 'Name genau wie angegeben', birth: 'Geburtsdatum, falls genannt, genau wie angegeben', death: 'Sterbedatum, falls genannt', quote: 'wörtliches Quellenzitat', location: 'S. N, wenn eine Markierung vorhanden ist', placeName: 'Ortsname', eventDate: 'Datum genau wie angegeben', eventPlace: 'Name des Ereignisortes', eventLabel: 'optionale Kurzbeschreibung', participantName: 'Name der Person', subject: 'Name einer genannten Person', object: 'Name der anderen genannten Person', relationQuote: 'wörtliches Zitat, das die Verwandtschaft behauptet',
    rules: ['Kopiere "quote" EXAKT aus der Quelle in ihrer Originalsprache. Übersetze oder paraphrasiere es niemals.', 'Verwende die Textmarkierungen [[p. N]] für "location". Fehlt eine Markierung, lasse "location" leer; erfinde keine Seiten.', 'Kopiere Datumsangaben genau wie angegeben (z. B. „um 1850“, „2. März 1875“); normalisiere sie nicht.', 'Fehlt eine Angabe, lasse das Feld weg (verwende weder null noch erfundene Zeichenketten).', 'Jede an einem Ereignis beteiligte Person muss auch mit ihrem "name" in "participants" erscheinen.', 'In "relations" ist "subject" die <relation> von "object" (z. B. bedeutet relation="father", dass subject der Vater von object ist). Beide müssen im Text NAMENTLICH genannte Personen sein; verwende keine Ich-Bezüge („mein Vater“), außer der Erzähler ist benannt. Behauptet der Text keine Verwandtschaft, lasse "relations" leer.'],
  },
  pt: {
    intro: 'És arquivista especialista em fontes primárias e genealogia. Recebes um fragmento documental (censo, registo, assento paroquial, ata, diário, carta, memórias). Extrai APENAS os factos explicitamente enunciados: pessoas, lugares, acontecimentos e parentescos que o texto AFIRMA. Não inventes dados, não deduzas parentescos não afirmados nem completes datas ausentes.',
    goldenRule: 'REGRA DE OURO: a mera presença de dois nomes no mesmo texto NÃO implica parentesco. Nunca transformes uma coocorrência numa relação familiar. Regista parentesco apenas quando o texto o enuncia explicitamente (por exemplo, «Juan, pai de Ana»; «María, sua esposa»; «filho de Pedro»).',
    returnJson: 'Devolve APENAS um objeto JSON com esta forma:', personName: 'nome tal como aparece', birth: 'data de nascimento, se constar, tal como aparece', death: 'data de falecimento, se constar', quote: 'citação literal da fonte', location: 'p. N se houver marcador', placeName: 'nome do lugar', eventDate: 'data tal como aparece', eventPlace: 'nome do lugar do acontecimento', eventLabel: 'descrição breve opcional', participantName: 'nome da pessoa', subject: 'nome de uma pessoa mencionada', object: 'nome da outra pessoa mencionada', relationQuote: 'citação literal que afirma o parentesco',
    rules: ['Copia "quote" EXATAMENTE como está na fonte, no idioma original. Nunca a traduzas nem parafraseies.', 'Usa os marcadores [[p. N]] do texto para "location". Sem marcador, deixa "location" vazio; não inventes páginas.', 'Copia as datas tal como aparecem (por exemplo, «cerca de 1850», «2 de março de 1875»); não as normalizes.', 'Se um dado não constar, omite o campo (não uses null nem cadeias inventadas).', 'Cada pessoa que participe num acontecimento deve também aparecer pelo seu "name" em "participants".', 'Em "relations", "subject" é <relation> de "object" (por exemplo, relation="father" significa que subject é o pai de object). Ambos devem ser pessoas NOMEADAS no texto; não uses a primeira pessoa («o meu pai») salvo se o narrador estiver nomeado. Se o texto não afirmar parentesco, deixa "relations" vazio.'],
  },
  'pt-BR': {
    intro: 'Você é um arquivista especialista em fontes primárias e genealogia. Recebe um fragmento documental (censo, registro, certidão paroquial, ata, diário, carta, memórias). Extraia SOMENTE os fatos explicitamente declarados: pessoas, lugares, eventos e parentescos que o texto AFIRMA. Não invente dados, não deduza parentescos não afirmados nem complete datas ausentes.',
    goldenRule: 'REGRA DE OURO: a mera presença de dois nomes no mesmo texto NÃO implica parentesco. Nunca transforme uma coocorrência em relação familiar. Registre parentesco somente quando o texto o declarar explicitamente (por exemplo, “Juan, pai de Ana”; “María, sua esposa”; “filho de Pedro”).',
    returnJson: 'Retorne SOMENTE um objeto JSON com este formato:', personName: 'nome como aparece', birth: 'data de nascimento, se constar, como aparece', death: 'data de falecimento, se constar', quote: 'citação literal da fonte', location: 'p. N se houver marcador', placeName: 'nome do lugar', eventDate: 'data como aparece', eventPlace: 'nome do local do evento', eventLabel: 'descrição breve opcional', participantName: 'nome da pessoa', subject: 'nome de uma pessoa mencionada', object: 'nome da outra pessoa mencionada', relationQuote: 'citação literal que afirma o parentesco',
    rules: ['Copie "quote" EXATAMENTE como está na fonte, no idioma original. Nunca traduza nem parafraseie.', 'Use os marcadores [[p. N]] do texto para "location". Sem marcador, deixe "location" vazio; não invente páginas.', 'Copie as datas como aparecem (por exemplo, “por volta de 1850”, “2 de março de 1875”); não as normalize.', 'Se um dado não constar, omita o campo (não use null nem strings inventadas).', 'Cada pessoa que participe de um evento também deve aparecer pelo seu "name" em "participants".', 'Em "relations", "subject" é <relation> de "object" (por exemplo, relation="father" significa que subject é o pai de object). Ambos devem ser pessoas NOMEADAS no texto; não use a primeira pessoa (“meu pai”) salvo se o narrador estiver nomeado. Se o texto não afirmar parentesco, deixe "relations" vazio.'],
  },
  it: {
    intro: 'Sei un archivista esperto di fonti primarie e genealogia. Ricevi un frammento di documento (censimento, registro, atto parrocchiale, verbale, diario, lettera, memorie). Estrai ESCLUSIVAMENTE i fatti dichiarati esplicitamente: persone, luoghi, eventi e parentele che il testo AFFERMA. Non inventare dati, non dedurre parentele non dichiarate e non completare date assenti.',
    goldenRule: 'REGOLA D’ORO: la semplice presenza di due nomi nello stesso testo NON implica parentela. Non trasformare mai una compresenza in relazione familiare. Registra una parentela solo quando il testo la enuncia esplicitamente (per esempio «Juan, padre di Ana»; «María, sua moglie»; «figlio di Pedro»).',
    returnJson: 'Restituisci SOLO un oggetto JSON con questa forma:', personName: 'nome come appare', birth: 'data di nascita, se indicata, come appare', death: 'data di morte, se indicata', quote: 'citazione letterale della fonte', location: 'p. N se esiste un indicatore', placeName: 'nome del luogo', eventDate: 'data come appare', eventPlace: 'nome del luogo dell’evento', eventLabel: 'breve descrizione facoltativa', participantName: 'nome della persona', subject: 'nome di una persona citata', object: 'nome dell’altra persona citata', relationQuote: 'citazione letterale che afferma la parentela',
    rules: ['Copia "quote" ESATTAMENTE come appare nella fonte, nella lingua originale. Non tradurla né parafrasarla mai.', 'Usa i marcatori [[p. N]] del testo per "location". Se non esiste un marcatore, lascia "location" vuoto; non inventare pagine.', 'Copia le date come appaiono (per esempio «circa 1850», «2 marzo 1875»); non normalizzarle.', 'Se un dato non compare, ometti il campo (non usare null né stringhe inventate).', 'Ogni persona che partecipa a un evento deve comparire anche con il proprio "name" in "participants".', 'In "relations", "subject" è <relation> di "object" (per esempio relation="father" significa che subject è il padre di object). Entrambi devono essere persone NOMINATE nel testo; non usare la prima persona («mio padre») salvo che il narratore sia nominato. Se il testo non afferma alcuna parentela, lascia "relations" vuoto.'],
  },
  tr: {
    intro: 'Birincil kaynaklar ve soybilim konusunda uzman bir arşivcisin. Bir belge parçası alırsın (nüfus sayımı, sicil, kilise kaydı, tutanak, günlük, mektup, anı). YALNIZCA metinde açıkça belirtilen olguları çıkar: kişiler, yerler, olaylar ve metnin İDDİA ETTİĞİ akrabalıklar. Veri uydurma, belirtilmeyen akrabalık çıkarımı yapma ve görünmeyen tarihleri tamamlama.',
    goldenRule: 'ALTIN KURAL: iki adın aynı metinde geçmesi aralarında akrabalık olduğu anlamına GELMEZ. Birlikte geçmeyi asla aile ilişkisine dönüştürme. Akrabalığı yalnızca metin açıkça söylediğinde kaydet (örneğin “Ana’nın babası Juan”; “karısı María”; “Pedro’nun oğlu”).',
    returnJson: 'YALNIZCA şu biçimde bir JSON nesnesi döndür:', personName: 'ad, metinde göründüğü biçimde', birth: 'belirtilmişse doğum tarihi, göründüğü biçimde', death: 'belirtilmişse ölüm tarihi', quote: 'kaynaktan birebir alıntı', location: 'işaret varsa s. N', placeName: 'yer adı', eventDate: 'tarih, göründüğü biçimde', eventPlace: 'olayın yer adı', eventLabel: 'isteğe bağlı kısa açıklama', participantName: 'kişinin adı', subject: 'adı geçen bir kişinin adı', object: 'adı geçen diğer kişinin adı', relationQuote: 'akrabalığı bildiren birebir alıntı',
    rules: ['Her "quote" alanını kaynaktaki özgün dilinde, göründüğü biçimde AYNEN kopyala. Asla çevirme veya başka sözcüklerle anlatma.', '"location" için metindeki [[p. N]] işaretlerini kullan. İşaret yoksa "location" alanını boş bırak; sayfa uydurma.', 'Tarihleri göründüğü biçimde kopyala (örneğin “1850 civarı”, “2 Mart 1875”); standartlaştırma.', 'Bir veri yoksa alanı çıkar (null veya uydurma dize kullanma).', 'Bir olaya katılan her kişi "participants" içinde "name" ile de yer almalıdır.', '"relations" içinde "subject", "object"in <relation>ıdır (örneğin relation="father", subject’in object’in babası olduğu anlamına gelir). İkisi de metinde ADI GEÇEN kişiler olmalıdır; anlatıcının adı verilmedikçe birinci şahıs ifadelerini (“babam”) kullanma. Metin hiçbir akrabalık iddia etmiyorsa "relations" alanını boş bırak.'],
  },
  'zh-Hans': {
    intro: '你是一名精通原始文献与族谱的档案员。你会收到一份文献片段（人口普查、户籍册、教区记录、证书、日记、书信、回忆录）。仅提取文本中明确陈述的事实：人物、地点、事件以及文本所断言的亲属关系。不要编造数据，不要推断文本未断言的亲属关系，不要补全未出现的日期。',
    goldenRule: '黄金法则：两个名字仅仅出现在同一文本中，并不表示他们之间存在任何亲属关系。绝不要将共同出现变成家庭关系。只有当文本明确陈述亲属关系时才记录（例如“Juan, Ana 的父亲”；“María, 他的妻子”；“Pedro 的儿子”）。',
    returnJson: '仅返回一个如下形式的 JSON 对象：', personName: '姓名，与原文一致', birth: '若注明，出生日期，与原文一致', death: '若注明，死亡日期', quote: '来源的逐字引文', location: '有标记时为 p. N', placeName: '地点名称', eventDate: '日期，与原文一致', eventPlace: '事件地点名称', eventLabel: '可选的简短描述', participantName: '人物姓名', subject: '某一被指名者的姓名', object: '另一被指名者的姓名', relationQuote: '断言该亲属关系的逐字引文',
    rules: ['将 "quote" 与来源完全一致地复制，保留其原始语言。绝不翻译或改写。', '使用文本中的 [[p. N]] 标记填写 "location"。没有标记时，将 "location" 留空；不要编造页码。', '日期按原样复制（例如“约 1850 年”“1875 年 3 月 2 日”）；不要规范化。', '如果某项数据不存在，省略该字段（不要使用 null 或编造的字符串）。', '参与某一事件的每个人都必须在 "participants" 中以 "name" 出现。', '在 "relations" 中，"subject" 是 "object" 的 <relation>（例如 relation="father" 表示 subject 是 object 的父亲）。双方都必须是文本中被指名的人物；除非叙述者被指名，不要使用第一人称（“我的父亲”）。如果文本未断言任何亲属关系，将 "relations" 留空。'],
  },
  'zh-Hant': {
    intro: '你是一名精通原始文獻與族譜的檔案員。你會收到一份文獻片段（人口普查、戶籍冊、教區記錄、證書、日記、書信、回憶錄）。僅提取文本中明確陳述的事實：人物、地點、事件以及文本所斷言的親屬關係。不要編造資料，不要推斷文本未斷言的親屬關係，不要補全未出現的日期。',
    goldenRule: '黃金法則：兩個名字僅僅出現在同一文本中，並不表示他們之間存在任何親屬關係。絕不要將共同出現變成家庭關係。只有當文本明確陳述親屬關係時才記錄（例如「Juan，Ana 的父親」；「María，他的妻子」；「Pedro 的兒子」）。',
    returnJson: '僅回傳一個如下形式的 JSON 物件：', personName: '姓名，與原文一致', birth: '若註明，出生日期，與原文一致', death: '若註明，死亡日期', quote: '來源的逐字引文', location: '有標記時為 p. N', placeName: '地點名稱', eventDate: '日期，與原文一致', eventPlace: '事件地點名稱', eventLabel: '簡短的選填描述', participantName: '人物姓名', subject: '某一被指名者的姓名', object: '另一被指名者的姓名', relationQuote: '斷言該親屬關係的逐字引文',
    rules: ['將 "quote" 與來源完全一致地複製，保留其原始語言。絕不翻譯或改寫。', '使用文本中的 [[p. N]] 標記填寫 "location"。沒有標記時，將 "location" 留空；不要編造頁碼。', '日期按原樣複製（例如「約 1850 年」「1875 年 3 月 2 日」）；不要正規化。', '如果某項資料不存在，省略該欄位（不要使用 null 或編造的字串）。', '參與某一事件的每個人都必須在 "participants" 中以 "name" 出現。', '在 "relations" 中，"subject" 是 "object" 的 <relation>（例如 relation="father" 表示 subject 是 object 的父親）。雙方都必須是文本中被指名的人物；除非敘述者被指名，不要使用第一人稱（「我的父親」）。如果文本未斷言任何親屬關係，將 "relations" 留空。'],
  },
  vi: {
    intro: 'Bạn là chuyên viên lưu trữ thành thạo nguồn sơ cấp và phả hệ. Bạn nhận được một đoạn trích tài liệu (điều tra dân số, sổ hộ tịch, sổ đăng ký giáo xứ, chứng thư, nhật ký, thư từ, hồi ký). Chỉ trích xuất những sự kiện được tuyên bố rõ ràng trong văn bản: con người, địa điểm, sự kiện và các quan hệ huyết thống mà văn bản KHẲNG ĐỊNH. Không bịa dữ liệu, không suy diễn quan hệ huyết thống không được tuyên bố, không bổ sung ngày tháng không xuất hiện.',
    goldenRule: 'QUY TẮC VÀNG: việc hai cái tên chỉ cùng xuất hiện trong một văn bản KHÔNG hàm ý bất kỳ quan hệ huyết thống nào giữa chúng. Không bao giờ biến sự cùng xuất hiện thành quan hệ gia đình. Chỉ ghi nhận quan hệ huyết thống khi văn bản tuyên bố điều đó một cách rõ ràng (ví dụ “Juan, cha của Ana”; “María, vợ ông ấy”; “con trai của Pedro”).',
    returnJson: 'Chỉ trả về một đối tượng JSON với dạng sau:', personName: 'tên đúng như xuất hiện', birth: 'ngày sinh nếu có ghi, đúng như xuất hiện', death: 'ngày mất nếu có ghi', quote: 'trích dẫn nguyên văn từ nguồn', location: 'p. N nếu có ký hiệu', placeName: 'tên địa điểm', eventDate: 'ngày tháng đúng như xuất hiện', eventPlace: 'tên địa điểm của sự kiện', eventLabel: 'mô tả ngắn không bắt buộc', participantName: 'tên người', subject: 'tên của một người được nêu tên', object: 'tên của người được nêu tên kia', relationQuote: 'trích dẫn nguyên văn khẳng định mối quan hệ',
    rules: ['Sao chép "quote" ĐÚNG NGUYÊN như trong nguồn, theo ngôn ngữ gốc. Không bao giờ dịch hay diễn giải lại.', 'Dùng các ký hiệu [[p. N]] trong văn bản cho "location". Nếu không có ký hiệu, để trống "location"; không bịa số trang.', 'Sao chép ngày tháng đúng như xuất hiện (ví dụ “khoảng 1850”, “2 tháng 3 năm 1875”); không chuẩn hóa chúng.', 'Nếu một dữ kiện không có, hãy bỏ qua trường đó (không dùng null hay chuỗi bịa đặt).', 'Mỗi người tham gia vào một sự kiện cũng phải xuất hiện bằng "name" trong "participants".', 'Trong "relations", "subject" là <relation> của "object" (ví dụ relation="father" nghĩa là subject là cha của object). Cả hai phải là những người được NÊU TÊN trong văn bản; không dùng cách nói ngôi thứ nhất (“cha tôi”) trừ khi người thuật chuyện được nêu tên. Nếu văn bản không khẳng định quan hệ huyết thống nào, hãy để trống "relations".'],
  },
  ja: {
    intro: 'あなたは一次資料と系譜学に通じたアーキビストです。文書の断片（国勢調査、戸籍、教区記録、証明書、日記、書簡、回顧録）を受け取ります。本文に明示的に述べられている事実のみを抽出してください。人物、場所、出来事、そして本文が主張する親族関係です。データを捏造したり、述べられていない親族関係を推論したり、記載のない日付を補完したりしないでください。',
    goldenRule: '黄金律：二つの名前が同じ本文に現れるだけでは、両者の間にいかなる親族関係も意味しません。共起を家族関係に変えないでください。本文が明示的に述べている場合にのみ親族関係を記録してください（例：「Juan、Ana の父」「María、彼の妻」「Pedro の息子」）。',
    returnJson: '次の形式の JSON オブジェクトだけを返してください。', personName: '原文どおりの名前', birth: '記載がある場合の生年月日（原文どおり）', death: '記載がある場合の死亡日', quote: '出典からの逐語的な引用', location: '目印がある場合は p. N', placeName: '場所の名前', eventDate: '原文どおりの日付', eventPlace: '出来事の場所の名前', eventLabel: '任意の簡単な説明', participantName: '人物の名前', subject: '名前が挙げられた人物の名前', object: 'もう一方の名前が挙げられた人物の名前', relationQuote: '関係を主張する逐語的な引用',
    rules: ['"quote" は出典のとおりに、元の言語のまま正確にコピーしてください。翻訳したり言い換えたりしないでください。', '"location" には本文中の [[p. N]] の目印を使用してください。目印がない場合は "location" を空のままにし、ページを捏造しないでください。', '日付は現れるとおりにコピーしてください（例：「1850年頃」「1875年3月2日」）。正規化しないでください。', '値がない場合はそのフィールドを省略してください（null や捏造した文字列を使用しないでください）。', '出来事に参加する人物は全員、"participants" にも "name" で現れる必要があります。', '"relations" では、"subject" は "object" の <relation> です（例：relation="father" は subject が object の父であることを意味します）。どちらも本文で名前が挙げられた人物でなければなりません。語り手の名前が挙げられている場合を除き、一人称表現（「私の父」）は使わないでください。本文が親族関係を主張しない場合は "relations" を空のままにしてください。'],
  },
  ru: {
    intro: 'Вы — опытный архивист по первоисточникам и генеалогии. Вы получаете фрагмент документа (перепись, реестр, приходская запись, свидетельство, дневник, письмо, мемуары). Извлекайте ТОЛЬКО факты, явно указанные в тексте: людей, места, события и родственные связи, которые текст УТВЕРЖДАЕТ. Не выдумывайте данные, не выводите неназванные родственные связи и не дополняйте отсутствующие даты.',
    goldenRule: 'ЗОЛОТОЕ ПРАВИЛО: простое появление двух имён в одном тексте НЕ подразумевает никакой родственной связи между ними. Никогда не превращайте совместное появление в семейное отношение. Фиксируйте родство только тогда, когда текст прямо его утверждает (например, «Juan, отец Ana»; «María, его жена»; «сын Pedro»).',
    returnJson: 'Верните ТОЛЬКО один объект JSON следующей формы:', personName: 'имя точно как указано', birth: 'дата рождения, если указана, точно как в тексте', death: 'дата смерти, если указана', quote: 'дословная цитата из источника', location: 'с. N при наличии маркера', placeName: 'название места', eventDate: 'дата точно как указана', eventPlace: 'название места события', eventLabel: 'необязательное краткое описание', participantName: 'имя человека', subject: 'имя названного человека', object: 'имя другого названного человека', relationQuote: 'дословная цитата, утверждающая родство',
    rules: ['Копируйте "quote" ТОЧНО так, как в источнике, на языке оригинала. Никогда не переводите и не перефразируйте.', 'Используйте маркеры [[p. N]] из текста для "location". Если маркера нет, оставьте "location" пустым; не выдумывайте страницы.', 'Копируйте даты так, как они указаны (например, «около 1850», «2 марта 1875»); не нормализуйте их.', 'Если значение отсутствует, пропустите поле (не используйте null или выдуманные строки).', 'Каждый человек, участвующий в событии, также должен присутствовать под своим "name" в "participants".', 'В "relations" "subject" — это <relation> от "object" (например, relation="father" означает, что subject — отец object). Оба должны быть людьми, НАЗВАННЫМИ в тексте; не используйте первое лицо («мой отец»), если рассказчик не назван. Если текст не утверждает никакого родства, оставьте "relations" пустым.'],
  },
  uk: {
    intro: 'Ви — досвідчений архівіст із першоджерел і генеалогії. Ви отримуєте фрагмент документа (перепис, реєстр, парафіяльний запис, свідоцтво, щоденник, лист, спогади). Витягуйте ЛИШЕ факти, явно зазначені в тексті: людей, місця, події та спорідненість, яку текст СТВЕРДЖУЄ. Не вигадуйте дані, не виводьте незазначену спорідненість і не доповнюйте відсутні дати.',
    goldenRule: 'ЗОЛОТЕ ПРАВИЛО: сама лише поява двох імен в одному тексті НЕ означає жодної спорідненості між ними. Ніколи не перетворюйте спільну появу на родинний зв’язок. Фіксуйте спорідненість лише тоді, коли текст прямо її зазначає (наприклад, «Juan, батько Ana»; «María, його дружина»; «син Pedro»).',
    returnJson: 'Поверніть ЛИШЕ один об’єкт JSON такої форми:', personName: 'ім’я точно як наведено', birth: 'дата народження, якщо зазначена, точно як наведено', death: 'дата смерті, якщо зазначена', quote: 'дослівна цитата з джерела', location: 'с. N за наявності маркера', placeName: 'назва місця', eventDate: 'дата точно як наведена', eventPlace: 'назва місця події', eventLabel: 'необов’язковий короткий опис', participantName: 'ім’я особи', subject: 'ім’я названої особи', object: 'ім’я іншої названої особи', relationQuote: 'дослівна цитата, що стверджує спорідненість',
    rules: ['Копіюйте "quote" ТОЧНО так, як у джерелі, мовою оригіналу. Ніколи не перекладайте й не перефразовуйте.', 'Використовуйте маркери [[p. N]] з тексту для "location". Якщо маркера немає, залиште "location" порожнім; не вигадуйте сторінки.', 'Копіюйте дати так, як вони наведені (наприклад, «близько 1850», «2 березня 1875»); не нормалізуйте їх.', 'Якщо значення відсутнє, пропустіть поле (не використовуйте null чи вигадані рядки).', 'Кожна особа, яка бере участь у події, також має бути зазначена під своїм "name" у "participants".', 'У "relations" "subject" — це <relation> від "object" (наприклад, relation="father" означає, що subject — батько object). Обидва мають бути особами, НАЗВАНИМИ в тексті; не використовуйте першу особу («мій батько»), якщо оповідача не названо. Якщо текст не стверджує жодної спорідненості, залиште "relations" порожнім.'],
  },
  ko: {
    intro: '당신은 1차 사료와 계보학에 능숙한 기록물 관리자입니다. 문서 조각(인구 조사, 호적, 교구 기록, 증서, 일기, 편지, 회고록)을 받습니다. 텍스트에 명시적으로 서술된 사실만 추출하십시오: 인물, 장소, 사건, 그리고 텍스트가 단언하는 친족 관계입니다. 데이터를 만들어내거나 서술되지 않은 친족 관계를 추론하거나 나타나지 않은 날짜를 보완하지 마십시오.',
    goldenRule: '황금률: 두 이름이 같은 텍스트에 단순히 함께 나타나는 것은 그들 사이에 어떤 친족 관계도 의미하지 않습니다. 동시 출현을 가족 관계로 바꾸지 마십시오. 텍스트가 명시적으로 서술할 때만 친족 관계를 기록하십시오(예: "Juan, Ana의 아버지", "María, 그의 아내", "Pedro의 아들").',
    returnJson: '다음 형식의 JSON 객체 하나만 반환하십시오:', personName: '나타난 그대로의 이름', birth: '기재된 경우 생년월일, 나타난 그대로', death: '기재된 경우 사망일', quote: '출처의 축자적 인용', location: '표시가 있으면 p. N', placeName: '장소 이름', eventDate: '나타난 그대로의 날짜', eventPlace: '사건 장소 이름', eventLabel: '선택적 간단 설명', participantName: '인물 이름', subject: '이름이 언급된 한 사람의 이름', object: '이름이 언급된 다른 사람의 이름', relationQuote: '친족 관계를 단언하는 축자적 인용',
    rules: ['"quote" 는 출처에 있는 그대로, 원래 언어로 정확히 복사하십시오. 번역하거나 바꿔 쓰지 마십시오.', '"location" 에는 텍스트의 [[p. N]] 표시를 사용하십시오. 표시가 없으면 "location" 을 비워 두고 페이지를 만들어내지 마십시오.', '날짜는 나타난 그대로 복사하십시오(예: "1850년경", "1875년 3월 2일"). 정규화하지 마십시오.', '값이 없으면 해당 필드를 생략하십시오(null 이나 만들어낸 문자열을 사용하지 마십시오).', '사건에 참여하는 모든 사람은 "participants" 에도 "name" 으로 나타나야 합니다.', '"relations" 에서 "subject" 는 "object" 의 <relation> 입니다(예: relation="father" 는 subject 가 object 의 아버지임을 의미합니다). 둘 다 텍스트에 이름이 언급된 사람이어야 합니다. 화자의 이름이 언급되지 않은 한 1인칭 표현("나의 아버지")을 사용하지 마십시오. 텍스트가 어떤 친족 관계도 단언하지 않으면 "relations" 를 비워 두십시오.'],
  },
};

function composeRecordsExtractionPrompt(copy: RecordsExtractionCopy, language: Exclude<PromptLanguage, 'es'>): string {
  const rulesHeading: Record<Exclude<PromptLanguage, 'es'>, string> = {
    en: 'Rules', fr: 'Règles', de: 'Regeln', pt: 'Regras', 'pt-BR': 'Regras', it: 'Regole', tr: 'Kurallar',
    'zh-Hans': '规则', 'zh-Hant': '規則', vi: 'Quy tắc', ja: 'ルール', ru: 'Правила', uk: 'Правила', ko: '규칙',
  };
  return `${copy.intro}

${copy.goldenRule}

${copy.returnJson}
{
  "persons": [
    { "name": "${copy.personName}", "sex": "male|female|unknown", "birth": "${copy.birth}", "death": "${copy.death}", "quote": "${copy.quote}", "location": "${copy.location}" }
  ],
  "places": [ { "name": "${copy.placeName}", "kind": "parish|municipality|province|country|other" } ],
  "events": [
    { "type": "birth|baptism|marriage|death|burial|census|residence|migration|occupation|other",
      "date": "${copy.eventDate}",
      "place": "${copy.eventPlace}",
      "label": "${copy.eventLabel}",
      "participants": [ { "name": "${copy.participantName}", "role": "principal|spouse|father|mother|child|witness|officiant|other" } ],
      "quote": "${copy.quote}", "location": "${copy.location}" }
  ],
  "relations": [
    { "subject": "${copy.subject}", "relation": "father|mother|parent|son|daughter|child|husband|wife|spouse", "object": "${copy.object}", "quote": "${copy.relationQuote}", "location": "${copy.location}" }
  ]
}

${rulesHeading[language]}:
${copy.rules.map((rule) => `- ${rule}`).join('\n')}`;
}

export function recordsExtractionPrompt(language: PromptLanguage = 'es'): string {
  if (language === 'es') return RECORDS_EXTRACTION_PROMPT;
  return composeRecordsExtractionPrompt(RECORDS_EXTRACTION_COPY[language], language);
}

export interface RawEvidence {
  quote?: string;
  location?: string;
}

export interface RawPerson extends RawEvidence {
  name?: string;
  sex?: string;
  birth?: string;
  death?: string;
}

export interface RawPlace {
  name?: string;
  kind?: string;
}

export interface RawParticipant {
  name?: string;
  role?: string;
}

export interface RawEvent extends RawEvidence {
  type?: string;
  date?: string;
  place?: string;
  label?: string;
  participants?: RawParticipant[];
}

export interface RawRelation extends RawEvidence {
  subject?: string;
  relation?: string;
  object?: string;
}

export interface RecordsChunkResult {
  persons?: RawPerson[];
  places?: RawPlace[];
  events?: RawEvent[];
  relations?: RawRelation[];
}

/** Lenient shape guard: an object whose persons/places/events/relations, when present, are arrays. */
export function isRecordsChunkResult(v: unknown): v is RecordsChunkResult {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  const okArr = (x: unknown) => x === undefined || Array.isArray(x);
  return okArr(o.persons) && okArr(o.places) && okArr(o.events) && okArr(o.relations);
}

/** Input payload for one chunk (stringified as the user message). */
export function buildRecordsInput(chunkText: string, index: number, total: number) {
  return {
    task: 'extract_records',
    chunk: { index, total, text: chunkText },
  };
}

const EVENT_TYPES = new Set<HistoricalEventType>([
  'birth',
  'baptism',
  'marriage',
  'death',
  'burial',
  'census',
  'residence',
  'migration',
  'occupation',
  'other',
]);
const ROLES = new Set<ParticipantRole>([
  'principal',
  'spouse',
  'father',
  'mother',
  'child',
  'witness',
  'officiant',
  'other',
]);

export function normalizeSex(value: unknown): PersonSex {
  const s = String(value ?? '').trim().toLowerCase();
  if (s === 'male' || s === 'm' || s === 'hombre' || s === 'varón' || s === 'varon') return 'male';
  if (s === 'female' || s === 'f' || s === 'mujer') return 'female';
  return 'unknown';
}

export function normalizeEventType(value: unknown): HistoricalEventType {
  const s = String(value ?? '').trim().toLowerCase() as HistoricalEventType;
  return EVENT_TYPES.has(s) ? s : 'other';
}

export function normalizeRole(value: unknown): ParticipantRole {
  const s = String(value ?? '').trim().toLowerCase() as ParticipantRole;
  return ROLES.has(s) ? s : 'principal';
}

/** Dedupe key for a person/place name: lowercase, strip diacritics + punctuation, collapse spaces. */
export function normalizeNameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanEvidence(raw: RawEvidence): RawEvidence | null {
  const quote = (raw.quote ?? '').trim();
  const location = (raw.location ?? '').trim();
  if (!quote && !location) return null;
  return { quote: quote || undefined, location: location || undefined };
}

export interface MergedPerson {
  name: string;
  key: string;
  sex: PersonSex;
  birth: string | null;
  death: string | null;
  evidence: RawEvidence[];
}

export interface MergedPlace {
  name: string;
  kind: string | null;
}

export interface MergedParticipant {
  name: string;
  role: ParticipantRole;
}

export interface MergedEvent {
  type: HistoricalEventType;
  date: string | null;
  place: string | null;
  label: string | null;
  participants: MergedParticipant[];
  evidence: RawEvidence | null;
}

/** An explicit kinship claim from the text, its names left unresolved for the persist step. */
export interface MergedRelation {
  subject: string;
  relation: string;
  object: string;
  quote: string | null;
  location: string | null;
}

export interface MergedRecords {
  persons: MergedPerson[];
  places: MergedPlace[];
  events: MergedEvent[];
  relations: MergedRelation[];
}

/**
 * Merge per-chunk extractions into a de-duplicated record set: persons collapse by
 * name key (coalescing sex/birth/death and accumulating evidence), places by name,
 * events are kept per occurrence (each is a distinct fact) with normalised fields.
 */
export function mergeRecordsResults(results: RecordsChunkResult[]): MergedRecords {
  const persons = new Map<string, MergedPerson>();
  const places = new Map<string, MergedPlace>();
  const events: MergedEvent[] = [];
  const relations: MergedRelation[] = [];
  const relationSeen = new Set<string>();

  const rememberPerson = (name: string, sex?: string, birth?: string, death?: string, ev?: RawEvidence | null) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const key = normalizeNameKey(trimmed);
    if (!key) return;
    let person = persons.get(key);
    if (!person) {
      person = { name: trimmed, key, sex: 'unknown', birth: null, death: null, evidence: [] };
      persons.set(key, person);
    }
    if (person.sex === 'unknown' && sex) person.sex = normalizeSex(sex);
    if (!person.birth && birth && birth.trim()) person.birth = birth.trim();
    if (!person.death && death && death.trim()) person.death = death.trim();
    if (ev) person.evidence.push(ev);
  };

  const rememberPlace = (name?: string, kind?: string) => {
    const trimmed = (name ?? '').trim();
    if (!trimmed) return;
    const key = normalizeNameKey(trimmed);
    if (!key || places.has(key)) {
      if (key && kind && !places.get(key)?.kind) {
        const existing = places.get(key);
        if (existing && !existing.kind) existing.kind = kind.trim() || null;
      }
      return;
    }
    places.set(key, { name: trimmed, kind: (kind ?? '').trim() || null });
  };

  for (const result of results) {
    for (const p of result.persons ?? []) {
      if (!p?.name) continue;
      rememberPerson(p.name, p.sex, p.birth, p.death, cleanEvidence(p));
    }
    for (const pl of result.places ?? []) rememberPlace(pl?.name, pl?.kind);
    for (const e of result.events ?? []) {
      if (!e) continue;
      const participants: MergedParticipant[] = [];
      for (const part of e.participants ?? []) {
        const name = (part?.name ?? '').trim();
        if (!name) continue;
        participants.push({ name, role: normalizeRole(part.role) });
        // A participant is also a person; make sure it exists as one.
        rememberPerson(name);
      }
      if (e.place) rememberPlace(e.place);
      events.push({
        type: normalizeEventType(e.type),
        date: (e.date ?? '').trim() || null,
        place: (e.place ?? '').trim() || null,
        label: (e.label ?? '').trim() || null,
        participants,
        evidence: cleanEvidence(e),
      });
    }
    for (const r of result.relations ?? []) {
      const subject = (r?.subject ?? '').trim();
      const object = (r?.object ?? '').trim();
      const relation = (r?.relation ?? '').trim();
      if (!subject || !object || !relation) continue;
      // Both parties of an explicit claim are persons; make sure they exist as such.
      rememberPerson(subject);
      rememberPerson(object);
      const key = `${normalizeNameKey(subject)}|${relation.toLowerCase()}|${normalizeNameKey(object)}`;
      if (relationSeen.has(key)) continue;
      relationSeen.add(key);
      relations.push({
        subject,
        object,
        relation,
        quote: (r.quote ?? '').trim() || null,
        location: (r.location ?? '').trim() || null,
      });
    }
  }

  return { persons: [...persons.values()], places: [...places.values()], events, relations };
}
