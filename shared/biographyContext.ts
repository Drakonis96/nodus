/**
 * Assemble the evidence a person's AI biography is written from — kinship, life
 * events, linked documents and cited evidence — into a compact, source-faithful
 * context. Pure so it is unit-tested without the DB; the electron side gathers the
 * data and runs the model. The biography is factual and only as rich as the sources.
 */

import type { PromptLanguage } from './types';

const EVENT_LABEL: Record<string, string> = {
  birth: 'nacimiento',
  baptism: 'bautismo',
  marriage: 'matrimonio',
  death: 'defunción',
  burial: 'entierro',
  census: 'censo',
  residence: 'residencia',
  migration: 'migración',
  occupation: 'ocupación',
  other: 'evento',
};

export interface BiographySources {
  name: string;
  sex: string;
  birthDate: string | null;
  deathDate: string | null;
  parents: string[];
  spouses: string[];
  children: string[];
  siblings: string[];
  events: { type: string; date: string | null; place: string | null }[];
  documents: { title: string; docType: string | null; text: string | null }[];
  evidence: { quote: string | null; location: string | null }[];
}

export const BIOGRAPHY_SYSTEM = `Eres un genealogista que redacta una biografía breve y FACTUAL de una persona basándote ÚNICAMENTE en la evidencia proporcionada (parentescos, eventos, documentos y citas). Reglas estrictas:
- No inventes datos, fechas, lugares ni parentescos que no consten en la evidencia.
- Escribe en prosa continua, en pasado, de 120 a 220 palabras aproximadamente.
- Respeta las fechas tal como se dan (incluidas las inciertas como "hacia 1850"); no las normalices.
- Si la evidencia es escasa, dilo con naturalidad en lugar de rellenar con conjeturas.
- No incluyas encabezados, viñetas ni notas: solo el texto de la biografía.`;

interface BiographyPromptCopy {
  system: string;
  person: string; male: string; female: string; birth: string; death: string;
  parents: string; spouses: string; children: string; siblings: string; events: string;
  documents: string; evidenceQuotes: string; inPlace: string; write: string;
  eventLabels: Record<string, string>;
}

const eventLabels = (birth: string, baptism: string, marriage: string, death: string, burial: string, census: string, residence: string, migration: string, occupation: string, other: string) => ({ birth, baptism, marriage, death, burial, census, residence, migration, occupation, other });

const BIOGRAPHY_PROMPT_COPY: Record<PromptLanguage, BiographyPromptCopy> = {
  es: { system: BIOGRAPHY_SYSTEM, person: 'Persona', male: 'hombre', female: 'mujer', birth: 'Nacimiento', death: 'Defunción', parents: 'Padres', spouses: 'Cónyuges', children: 'Hijos', siblings: 'Hermanos', events: 'Eventos', documents: 'Documentos vinculados', evidenceQuotes: 'Citas de evidencia', inPlace: 'en', write: 'Redacta la biografía factual a partir de lo anterior.', eventLabels: EVENT_LABEL },
  en: { system: 'You are a genealogist writing a brief, FACTUAL biography of one person based ONLY on the supplied evidence (kinship, events, documents, and quotations). Strict rules:\n- Do not invent data, dates, places, or kinship absent from the evidence.\n- Write continuous prose in the past tense, approximately 120 to 220 words.\n- Preserve dates exactly as supplied, including uncertain forms such as “circa 1850”; do not normalize them.\n- If evidence is sparse, say so naturally instead of filling gaps with guesses.\n- Do not include headings, bullets, or notes: return only the biography text.', person: 'Person', male: 'man', female: 'woman', birth: 'Birth', death: 'Death', parents: 'Parents', spouses: 'Spouses', children: 'Children', siblings: 'Siblings', events: 'Events', documents: 'Linked documents', evidenceQuotes: 'Evidence quotations', inPlace: 'in', write: 'Write the factual biography from the information above.', eventLabels: eventLabels('birth', 'baptism', 'marriage', 'death', 'burial', 'census', 'residence', 'migration', 'occupation', 'event') },
  fr: { system: 'Vous êtes généalogiste et rédigez une biographie brève et FACTUELLE d’une personne en vous fondant UNIQUEMENT sur les preuves fournies (parentés, événements, documents et citations). Règles strictes :\n- N’inventez aucune donnée, date, lieu ou parenté absente des preuves.\n- Rédigez une prose continue au passé, d’environ 120 à 220 mots.\n- Respectez les dates exactement comme elles sont données, y compris les formes incertaines telles que « vers 1850 » ; ne les normalisez pas.\n- Si les preuves sont rares, dites-le naturellement au lieu de combler les lacunes par des conjectures.\n- N’incluez ni titres, ni puces, ni notes : retournez uniquement le texte de la biographie.', person: 'Personne', male: 'homme', female: 'femme', birth: 'Naissance', death: 'Décès', parents: 'Parents', spouses: 'Conjoints', children: 'Enfants', siblings: 'Frères et sœurs', events: 'Événements', documents: 'Documents liés', evidenceQuotes: 'Citations de preuve', inPlace: 'à', write: 'Rédigez la biographie factuelle à partir des informations ci-dessus.', eventLabels: eventLabels('naissance', 'baptême', 'mariage', 'décès', 'inhumation', 'recensement', 'résidence', 'migration', 'profession', 'événement') },
  de: { system: 'Du bist Genealoge und verfasst eine kurze, SACHLICHE Biografie einer Person AUSSCHLIESSLICH anhand der bereitgestellten Belege (Verwandtschaft, Ereignisse, Dokumente und Zitate). Strenge Regeln:\n- Erfinde keine Daten, Datumsangaben, Orte oder Verwandtschaft, die nicht belegt sind.\n- Schreibe fortlaufende Prosa in der Vergangenheit mit ungefähr 120 bis 220 Wörtern.\n- Bewahre Datumsangaben exakt wie geliefert, einschließlich unsicherer Formen wie „um 1850“; normalisiere sie nicht.\n- Bei dünner Beleglage sage das natürlich, statt Lücken durch Vermutungen zu füllen.\n- Verwende keine Überschriften, Aufzählungen oder Anmerkungen: gib nur den Biografietext zurück.', person: 'Person', male: 'Mann', female: 'Frau', birth: 'Geburt', death: 'Tod', parents: 'Eltern', spouses: 'Ehepartner', children: 'Kinder', siblings: 'Geschwister', events: 'Ereignisse', documents: 'Verknüpfte Dokumente', evidenceQuotes: 'Belegzitate', inPlace: 'in', write: 'Verfasse anhand der obigen Angaben die sachliche Biografie.', eventLabels: eventLabels('Geburt', 'Taufe', 'Eheschließung', 'Tod', 'Bestattung', 'Volkszählung', 'Wohnsitz', 'Migration', 'Beruf', 'Ereignis') },
  pt: { system: 'És genealogista e rediges uma biografia breve e FACTUAL de uma pessoa com base APENAS nas evidências fornecidas (parentescos, acontecimentos, documentos e citações). Regras estritas:\n- Não inventes dados, datas, lugares ou parentescos que não constem das evidências.\n- Escreve prosa contínua no passado, com aproximadamente 120 a 220 palavras.\n- Conserva as datas exatamente como são fornecidas, incluindo formas incertas como «cerca de 1850»; não as normalizes.\n- Se as evidências forem escassas, di-lo naturalmente em vez de preencher lacunas com conjeturas.\n- Não incluas títulos, listas ou notas: devolve apenas o texto da biografia.', person: 'Pessoa', male: 'homem', female: 'mulher', birth: 'Nascimento', death: 'Falecimento', parents: 'Pais', spouses: 'Cônjuges', children: 'Filhos', siblings: 'Irmãos', events: 'Acontecimentos', documents: 'Documentos associados', evidenceQuotes: 'Citações de evidência', inPlace: 'em', write: 'Redige a biografia factual a partir da informação anterior.', eventLabels: eventLabels('nascimento', 'batismo', 'casamento', 'falecimento', 'sepultamento', 'censo', 'residência', 'migração', 'profissão', 'acontecimento') },
  'pt-BR': { system: 'Você é genealogista e escreve uma biografia breve e FACTUAL de uma pessoa com base SOMENTE nas evidências fornecidas (parentescos, eventos, documentos e citações). Regras estritas:\n- Não invente dados, datas, lugares ou parentescos que não constem das evidências.\n- Escreva prosa contínua no passado, com aproximadamente 120 a 220 palavras.\n- Preserve as datas exatamente como fornecidas, inclusive formas incertas como “por volta de 1850”; não as normalize.\n- Se as evidências forem escassas, diga isso naturalmente em vez de preencher lacunas com suposições.\n- Não inclua títulos, listas ou notas: retorne apenas o texto da biografia.', person: 'Pessoa', male: 'homem', female: 'mulher', birth: 'Nascimento', death: 'Falecimento', parents: 'Pais', spouses: 'Cônjuges', children: 'Filhos', siblings: 'Irmãos', events: 'Eventos', documents: 'Documentos vinculados', evidenceQuotes: 'Citações de evidência', inPlace: 'em', write: 'Escreva a biografia factual a partir das informações acima.', eventLabels: eventLabels('nascimento', 'batismo', 'casamento', 'falecimento', 'sepultamento', 'censo', 'residência', 'migração', 'ocupação', 'evento') },
  it: { system: 'Sei un genealogista e redigi una biografia breve e FATTUALE di una persona basandoti ESCLUSIVAMENTE sulle prove fornite (parentele, eventi, documenti e citazioni). Regole rigorose:\n- Non inventare dati, date, luoghi o parentele assenti dalle prove.\n- Scrivi prosa continua al passato, di circa 120-220 parole.\n- Conserva le date esattamente come fornite, comprese le forme incerte come «circa 1850»; non normalizzarle.\n- Se le prove sono scarse, dichiaralo con naturalezza invece di colmare le lacune con congetture.\n- Non includere titoli, elenchi o note: restituisci solo il testo della biografia.', person: 'Persona', male: 'uomo', female: 'donna', birth: 'Nascita', death: 'Morte', parents: 'Genitori', spouses: 'Coniugi', children: 'Figli', siblings: 'Fratelli e sorelle', events: 'Eventi', documents: 'Documenti collegati', evidenceQuotes: 'Citazioni di prova', inPlace: 'a', write: 'Scrivi la biografia fattuale a partire dalle informazioni precedenti.', eventLabels: eventLabels('nascita', 'battesimo', 'matrimonio', 'morte', 'sepoltura', 'censimento', 'residenza', 'migrazione', 'occupazione', 'evento') },
  tr: { system: 'Yalnızca sağlanan kanıtlara (akrabalıklar, olaylar, belgeler ve alıntılar) dayanarak bir kişinin kısa ve OLGUSAL biyografisini yazan bir soybilimcisin. Kesin kurallar:\n- Kanıtlarda bulunmayan veri, tarih, yer veya akrabalık uydurma.\n- Geçmiş zamanda, yaklaşık 120-220 kelimelik kesintisiz düzyazı yaz.\n- “1850 civarı” gibi belirsiz biçimler dâhil tarihleri sağlandığı biçimde koru; standartlaştırma.\n- Kanıt azsa boşlukları varsayımla doldurmak yerine bunu doğal biçimde söyle.\n- Başlık, madde işareti veya not ekleme: yalnızca biyografi metnini döndür.', person: 'Kişi', male: 'erkek', female: 'kadın', birth: 'Doğum', death: 'Ölüm', parents: 'Ebeveynler', spouses: 'Eşler', children: 'Çocuklar', siblings: 'Kardeşler', events: 'Olaylar', documents: 'Bağlı belgeler', evidenceQuotes: 'Kanıt alıntıları', inPlace: 'yer', write: 'Yukarıdaki bilgilerden olgusal biyografiyi yaz.', eventLabels: eventLabels('doğum', 'vaftiz', 'evlilik', 'ölüm', 'defin', 'nüfus sayımı', 'ikamet', 'göç', 'meslek', 'olay') },
  'zh-Hans': { system: '你是一位家谱学家，仅依据所提供的证据（亲属关系、事件、文件与引文）撰写一人的简短、事实性传记。严格规则：\n- 不得虚构证据中不存在的数据、日期、地点或亲属关系。\n- 以过去时撰写连续行文，约 120 至 220 词。\n- 严格按所提供的原样保留日期，包括“约 1850 年”等不确定形式；不要将其规范化。\n- 若证据稀少，应自然说明，而不要以猜测填补空白。\n- 不要包含标题、项目符号或注释：只返回传记正文。', person: '人物', male: '男性', female: '女性', birth: '出生', death: '死亡', parents: '父母', spouses: '配偶', children: '子女', siblings: '兄弟姐妹', events: '事件', documents: '关联文件', evidenceQuotes: '证据引文', inPlace: '地点', write: '请根据以上信息撰写事实性传记。', eventLabels: eventLabels('出生', '洗礼', '婚姻', '死亡', '安葬', '人口普查', '居住', '迁徙', '职业', '事件') },
  'zh-Hant': { system: '你是一位族譜學家，僅依據所提供的證據（親屬關係、事件、文件與引文）撰寫一人的簡短、事實性傳記。嚴格規則：\n- 不得虛構證據中不存在的資料、日期、地點或親屬關係。\n- 以過去時撰寫連續行文，約 120 至 220 詞。\n- 嚴格按所提供的原樣保留日期，包括「約 1850 年」等不確定形式；不要將其制式化。\n- 若證據稀少，應自然說明，而不要以猜測填補空白。\n- 不要包含標題、項目符號或註釋：只傳回傳記正文。', person: '人物', male: '男性', female: '女性', birth: '出生', death: '死亡', parents: '父母', spouses: '配偶', children: '子女', siblings: '兄弟姊妹', events: '事件', documents: '關聯文件', evidenceQuotes: '證據引文', inPlace: '地點', write: '請根據以上資訊撰寫事實性傳記。', eventLabels: eventLabels('出生', '洗禮', '婚姻', '死亡', '安葬', '人口普查', '居住', '遷徙', '職業', '事件') },
  vi: { system: 'Bạn là nhà phả hệ học viết một tiểu sử ngắn và ĐÚNG SỰ THẬT về một người CHỈ dựa trên chứng cứ được cung cấp (quan hệ huyết tộc, sự kiện, tài liệu và trích dẫn). Quy tắc nghiêm ngặt:\n- Không bịa đặt dữ liệu, ngày tháng, địa điểm hay quan hệ huyết tộc không có trong chứng cứ.\n- Viết văn xuôi liền mạch ở thì quá khứ, khoảng 120 đến 220 từ.\n- Giữ nguyên ngày tháng đúng như được cung cấp, kể cả các dạng không chắc chắn như “khoảng 1850”; không chuẩn hóa chúng.\n- Nếu chứng cứ ít ỏi, hãy nói rõ một cách tự nhiên thay vì lấp khoảng trống bằng phỏng đoán.\n- Không kèm tiêu đề, gạch đầu dòng hay ghi chú: chỉ trả về nội dung tiểu sử.', person: 'Nhân vật', male: 'nam', female: 'nữ', birth: 'Sinh', death: 'Mất', parents: 'Cha mẹ', spouses: 'Vợ/chồng', children: 'Con cái', siblings: 'Anh chị em', events: 'Sự kiện', documents: 'Tài liệu liên kết', evidenceQuotes: 'Trích dẫn chứng cứ', inPlace: 'tại', write: 'Hãy viết tiểu sử đúng sự thật dựa trên thông tin trên.', eventLabels: eventLabels('sinh', 'rửa tội', 'hôn nhân', 'mất', 'mai táng', 'điều tra dân số', 'cư trú', 'di cư', 'nghề nghiệp', 'sự kiện') },
  ja: { system: 'あなたは系譜学者であり、提供された証拠（親族関係、出来事、文書、引用）のみに基づいて、一人の簡潔で事実に即した伝記を書きます。厳守事項：\n- 証拠にないデータ、日付、場所、親族関係を創作しないでください。\n- 過去形の連続した文章で、およそ 120-220 語書いてください。\n- 「1850年頃」のような不確かな表現も含め、日付は提供されたまま正確に保持し、正規化しないでください。\n- 証拠が乏しい場合は、推測で空白を埋めず、そのことを自然に述べてください。\n- 見出し、箇条書き、注記は含めず、伝記本文のみを返してください。', person: '人物', male: '男性', female: '女性', birth: '出生', death: '死亡', parents: '両親', spouses: '配偶者', children: '子供', siblings: '兄弟姉妹', events: '出来事', documents: '関連文書', evidenceQuotes: '証拠の引用', inPlace: '場所', write: '上記の情報をもとに、事実に即した伝記を書いてください。', eventLabels: eventLabels('出生', '洗礼', '婚姻', '死亡', '埋葬', '国勢調査', '居住', '移住', '職業', '出来事') },
  ru: { system: 'Вы — генеалог, который составляет краткую ФАКТИЧЕСКУЮ биографию человека ИСКЛЮЧИТЕЛЬНО на основе предоставленных доказательств (родственные связи, события, документы и цитаты). Строгие правила:\n- Не выдумывайте данные, даты, места или родственные связи, которых нет в доказательствах.\n- Пишите связным текстом в прошедшем времени, примерно 120–220 слов.\n- Сохраняйте даты точно так, как они даны, включая неопределённые формы вроде «около 1850 года»; не нормализуйте их.\n- Если доказательств мало, скажите об этом естественно, а не заполняйте пробелы догадками.\n- Не включайте заголовки, маркированные списки или примечания: возвращайте только текст биографии.', person: 'Персона', male: 'мужчина', female: 'женщина', birth: 'Рождение', death: 'Смерть', parents: 'Родители', spouses: 'Супруги', children: 'Дети', siblings: 'Братья и сёстры', events: 'События', documents: 'Связанные документы', evidenceQuotes: 'Цитаты из доказательств', inPlace: 'в', write: 'Напишите фактическую биографию на основе приведённой выше информации.', eventLabels: eventLabels('рождение', 'крещение', 'брак', 'смерть', 'погребение', 'перепись', 'проживание', 'миграция', 'занятие', 'событие') },
  uk: { system: 'Ви — генеалог, який складає стислий ФАКТИЧНИЙ життєпис людини ВИКЛЮЧНО на основі наданих доказів (родинні зв’язки, події, документи та цитати). Суворі правила:\n- Не вигадуйте дані, дати, місця чи родинні зв’язки, яких немає в доказах.\n- Пишіть зв’язним текстом у минулому часі, приблизно 120–220 слів.\n- Зберігайте дати точно такими, як вони надані, включно з непевними формами на кшталт «близько 1850 року»; не нормалізуйте їх.\n- Якщо доказів обмаль, скажіть про це природно, а не заповнюйте прогалини здогадами.\n- Не додавайте заголовків, маркованих списків чи приміток: повертайте лише текст життєпису.', person: 'Персона', male: 'чоловік', female: 'жінка', birth: 'Народження', death: 'Смерть', parents: 'Батьки', spouses: 'Подружжя', children: 'Діти', siblings: 'Брати й сестри', events: 'Події', documents: 'Пов’язані документи', evidenceQuotes: 'Цитати з доказів', inPlace: 'у', write: 'Напишіть фактичний життєпис на основі наведеної вище інформації.', eventLabels: eventLabels('народження', 'хрещення', 'шлюб', 'смерть', 'поховання', 'перепис', 'проживання', 'міграція', 'заняття', 'подія') },
  ko: { system: '당신은 가계학자로서 제공된 증거(친족 관계, 사건, 문서, 인용)만을 근거로 한 사람의 간결하고 사실에 입각한 전기를 작성합니다. 엄격한 규칙:\n- 증거에 없는 데이터, 날짜, 장소 또는 친족 관계를 지어내지 마십시오.\n- 과거 시제의 연속된 산문으로 약 120~220단어를 작성하십시오.\n- “1850년경”과 같은 불확실한 표현을 포함해 날짜를 제공된 그대로 정확히 보존하고, 정규화하지 마십시오.\n- 증거가 부족하면 추측으로 빈틈을 채우지 말고 그 사실을 자연스럽게 밝히십시오.\n- 제목, 글머리 기호 또는 주석을 포함하지 말고 전기 본문만 반환하십시오.', person: '인물', male: '남성', female: '여성', birth: '출생', death: '사망', parents: '부모', spouses: '배우자', children: '자녀', siblings: '형제자매', events: '사건', documents: '연결된 문서', evidenceQuotes: '증거 인용', inPlace: '장소', write: '위 정보를 바탕으로 사실에 입각한 전기를 작성하십시오.', eventLabels: eventLabels('출생', '세례', '혼인', '사망', '매장', '인구 조사', '거주', '이주', '직업', '사건') },
};

export function biographySystemPrompt(language: PromptLanguage = 'es'): string {
  return BIOGRAPHY_PROMPT_COPY[language]?.system ?? BIOGRAPHY_SYSTEM;
}

function list(label: string, items: string[]): string {
  const clean = items.map((x) => x.trim()).filter(Boolean);
  return clean.length ? `${label}: ${clean.join(', ')}.` : '';
}

/** Build the user message: a structured, deduplicated digest of the person's sources. */
export function composeBiographyContext(s: BiographySources, language: PromptLanguage = 'es'): string {
  const copy = BIOGRAPHY_PROMPT_COPY[language] ?? BIOGRAPHY_PROMPT_COPY.es;
  const lines: string[] = [];
  lines.push(`${copy.person}: ${s.name}${s.sex && s.sex !== 'unknown' ? ` (${s.sex === 'male' ? copy.male : copy.female})` : ''}.`);
  if (s.birthDate) lines.push(`${copy.birth}: ${s.birthDate}.`);
  if (s.deathDate) lines.push(`${copy.death}: ${s.deathDate}.`);
  const kin = [list(copy.parents, s.parents), list(copy.spouses, s.spouses), list(copy.children, s.children), list(copy.siblings, s.siblings)].filter(Boolean);
  if (kin.length) lines.push(kin.join(' '));

  if (s.events.length) {
    lines.push(`${copy.events}:`);
    for (const e of s.events.slice(0, 40)) {
      const parts = [copy.eventLabels[e.type] ?? e.type];
      if (e.date) parts.push(e.date);
      if (e.place) parts.push(`${copy.inPlace} ${e.place}`);
      lines.push(`- ${parts.join(', ')}.`);
    }
  }

  const docs = s.documents.filter((d) => d.title || d.text);
  if (docs.length) {
    lines.push(`${copy.documents}:`);
    for (const d of docs.slice(0, 12)) {
      const snippet = (d.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
      lines.push(`- ${d.title}${d.docType ? ` [${d.docType}]` : ''}${snippet ? `: ${snippet}` : ''}`);
    }
  }

  const quotes = s.evidence.filter((e) => e.quote);
  if (quotes.length) {
    lines.push(`${copy.evidenceQuotes}:`);
    for (const q of quotes.slice(0, 12)) {
      lines.push(`- "${(q.quote ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)}"${q.location ? ` (${q.location})` : ''}`);
    }
  }

  lines.push(`\n${copy.write}`);
  return lines.join('\n');
}

/** True when there is enough to write anything at all. */
export function hasBiographyEvidence(s: BiographySources): boolean {
  return Boolean(
    s.birthDate ||
      s.deathDate ||
      s.events.length ||
      s.documents.some((d) => d.title || d.text) ||
      s.evidence.some((e) => e.quote) ||
      s.parents.length ||
      s.spouses.length ||
      s.children.length
  );
}
