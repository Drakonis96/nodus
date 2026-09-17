import type { PromptLanguage } from './types';
import { normalizeUiLanguage } from './uiLanguage';
import { normalizePromptLanguage } from './promptLanguageOptions';

export { normalizePromptLanguage, normalizeUiLanguage };

/** The catalogues below are prompt-language data. An interface language that is not
 *  itself a prompt language (`zh-CN`) is normalized to its prompt counterpart
 *  (`zh-Hans`) by {@link normalizePromptLanguage} before indexing. */
export type WorldPromptLocale = PromptLanguage;

type LocalizedRecord<K extends string> = Record<WorldPromptLocale, Record<K, string>>;

const ENTRY_KIND_LABELS: LocalizedRecord<string> = {
  es: { article: 'Artículo', character: 'Personaje', place: 'Lugar', group: 'Facción o cultura', scene: 'Escena', map: 'Mapa', conflict: 'Conflicto', rule: 'Regla' },
  en: { article: 'Article', character: 'Character', place: 'Place', group: 'Faction or culture', scene: 'Scene', map: 'Map', conflict: 'Conflict', rule: 'Rule' },
  fr: { article: 'Article', character: 'Personnage', place: 'Lieu', group: 'Faction ou culture', scene: 'Scène', map: 'Carte', conflict: 'Conflit', rule: 'Règle' },
  de: { article: 'Artikel', character: 'Figur', place: 'Ort', group: 'Fraktion oder Kultur', scene: 'Szene', map: 'Karte', conflict: 'Konflikt', rule: 'Regel' },
  pt: { article: 'Artigo', character: 'Personagem', place: 'Lugar', group: 'Facção ou cultura', scene: 'Cena', map: 'Mapa', conflict: 'Conflito', rule: 'Regra' },
  'pt-BR': { article: 'Artigo', character: 'Personagem', place: 'Lugar', group: 'Facção ou cultura', scene: 'Cena', map: 'Mapa', conflict: 'Conflito', rule: 'Regra' },
  it: { article: 'Articolo', character: 'Personaggio', place: 'Luogo', group: 'Fazione o cultura', scene: 'Scena', map: 'Mappa', conflict: 'Conflitto', rule: 'Regola' },
  tr: { article: 'Madde', character: 'Karakter', place: 'Yer', group: 'Fraksiyon veya kültür', scene: 'Sahne', map: 'Harita', conflict: 'Çatışma', rule: 'Kural' },
  'zh-Hans': { article: '条目', character: '角色', place: '地点', group: '派系或文化', scene: '场景', map: '地图', conflict: '冲突', rule: '规则' },
  'zh-Hant': { article: '條目', character: '角色', place: '地點', group: '派系或文化', scene: '場景', map: '地圖', conflict: '衝突', rule: '規則' },
  vi: { article: 'Bài viết', character: 'Nhân vật', place: 'Địa điểm', group: 'Phe phái hoặc văn hóa', scene: 'Cảnh', map: 'Bản đồ', conflict: 'Xung đột', rule: 'Quy tắc' },
  ja: { article: '記事', character: 'キャラクター', place: '場所', group: '勢力または文化', scene: 'シーン', map: '地図', conflict: '対立', rule: 'ルール' },
  ru: { article: 'Статья', character: 'Персонаж', place: 'Место', group: 'Фракция или культура', scene: 'Сцена', map: 'Карта', conflict: 'Конфликт', rule: 'Правило' },
  uk: { article: 'Стаття', character: 'Персонаж', place: 'Місце', group: 'Фракція або культура', scene: 'Сцена', map: 'Карта', conflict: 'Конфлікт', rule: 'Правило' },
  ko: { article: '문서', character: '인물', place: '장소', group: '세력 또는 문화', scene: '장면', map: '지도', conflict: '갈등', rule: '규칙' },
};

const ARTICLE_CATEGORY_LABELS: LocalizedRecord<string> = {
  es: { magic: 'Sistema de magia', religion: 'Religión', language: 'Lengua', creature: 'Criatura', species: 'Especie', artifact: 'Artefacto', technology: 'Tecnología', concept: 'Concepto', event: 'Suceso', organization: 'Organización', flora: 'Flora', fauna: 'Fauna', custom: 'Costumbre', other: 'Otro' },
  en: { magic: 'Magic system', religion: 'Religion', language: 'Language', creature: 'Creature', species: 'Species', artifact: 'Artifact', technology: 'Technology', concept: 'Concept', event: 'Event', organization: 'Organization', flora: 'Flora', fauna: 'Fauna', custom: 'Custom', other: 'Other' },
  fr: { magic: 'Système de magie', religion: 'Religion', language: 'Langue', creature: 'Créature', species: 'Espèce', artifact: 'Artefact', technology: 'Technologie', concept: 'Concept', event: 'Événement', organization: 'Organisation', flora: 'Flore', fauna: 'Faune', custom: 'Coutume', other: 'Autre' },
  de: { magic: 'Magiesystem', religion: 'Religion', language: 'Sprache', creature: 'Kreatur', species: 'Spezies', artifact: 'Artefakt', technology: 'Technologie', concept: 'Konzept', event: 'Ereignis', organization: 'Organisation', flora: 'Flora', fauna: 'Fauna', custom: 'Brauch', other: 'Sonstiges' },
  pt: { magic: 'Sistema de magia', religion: 'Religião', language: 'Língua', creature: 'Criatura', species: 'Espécie', artifact: 'Artefacto', technology: 'Tecnologia', concept: 'Conceito', event: 'Acontecimento', organization: 'Organização', flora: 'Flora', fauna: 'Fauna', custom: 'Costume', other: 'Outro' },
  'pt-BR': { magic: 'Sistema de magia', religion: 'Religião', language: 'Língua', creature: 'Criatura', species: 'Espécie', artifact: 'Artefato', technology: 'Tecnologia', concept: 'Conceito', event: 'Evento', organization: 'Organização', flora: 'Flora', fauna: 'Fauna', custom: 'Costume', other: 'Outro' },
  it: { magic: 'Sistema magico', religion: 'Religione', language: 'Lingua', creature: 'Creatura', species: 'Specie', artifact: 'Artefatto', technology: 'Tecnologia', concept: 'Concetto', event: 'Evento', organization: 'Organizzazione', flora: 'Flora', fauna: 'Fauna', custom: 'Usanza', other: 'Altro' },
  tr: { magic: 'Büyü sistemi', religion: 'Din', language: 'Dil', creature: 'Yaratık', species: 'Tür', artifact: 'Artefakt', technology: 'Teknoloji', concept: 'Kavram', event: 'Olay', organization: 'Örgüt', flora: 'Flora', fauna: 'Fauna', custom: 'Gelenek', other: 'Diğer' },
  'zh-Hans': { magic: '魔法体系', religion: '宗教', language: '语言', creature: '生物', species: '物种', artifact: '器物', technology: '科技', concept: '概念', event: '事件', organization: '组织', flora: '植物', fauna: '动物', custom: '习俗', other: '其他' },
  'zh-Hant': { magic: '魔法體系', religion: '宗教', language: '語言', creature: '生物', species: '物種', artifact: '器物', technology: '科技', concept: '概念', event: '事件', organization: '組織', flora: '植物', fauna: '動物', custom: '習俗', other: '其他' },
  vi: { magic: 'Hệ thống ma thuật', religion: 'Tôn giáo', language: 'Ngôn ngữ', creature: 'Sinh vật', species: 'Loài', artifact: 'Cổ vật', technology: 'Công nghệ', concept: 'Khái niệm', event: 'Sự kiện', organization: 'Tổ chức', flora: 'Thực vật', fauna: 'Động vật', custom: 'Phong tục', other: 'Khác' },
  ja: { magic: '魔法体系', religion: '宗教', language: '言語', creature: '生物', species: '種族', artifact: 'アーティファクト', technology: '技術', concept: '概念', event: '出来事', organization: '組織', flora: '植物', fauna: '動物', custom: '風習', other: 'その他' },
  ru: { magic: 'Система магии', religion: 'Религия', language: 'Язык', creature: 'Существо', species: 'Вид', artifact: 'Артефакт', technology: 'Технология', concept: 'Концепция', event: 'Событие', organization: 'Организация', flora: 'Флора', fauna: 'Фауна', custom: 'Обычай', other: 'Другое' },
  uk: { magic: 'Система магії', religion: 'Релігія', language: 'Мова', creature: 'Істота', species: 'Вид', artifact: 'Артефакт', technology: 'Технологія', concept: 'Концепція', event: 'Подія', organization: 'Організація', flora: 'Флора', fauna: 'Фауна', custom: 'Звичай', other: 'Інше' },
  ko: { magic: '마법 체계', religion: '종교', language: '언어', creature: '생물', species: '종족', artifact: '유물', technology: '기술', concept: '개념', event: '사건', organization: '조직', flora: '식물', fauna: '동물', custom: '풍습', other: '기타' },
};

const FIELD_LABELS: LocalizedRecord<string> = {
  es: { body: 'Cuerpo', summary: 'Resumen', notes: 'Notas', backstory: 'Trasfondo', personality: 'Personalidad', appearance: 'Apariencia', atmosphere: 'Atmósfera', history: 'Historia', description: 'Descripción', biography: 'Biografía', pitch: 'De qué va', stakes: 'Qué se pierde', outcome: 'Cómo acaba', statement: 'La regla', cost: 'Qué cuesta romperla', limits: 'Hasta dónde no llega', text: 'Manuscrito' },
  en: { body: 'Body', summary: 'Summary', notes: 'Notes', backstory: 'Backstory', personality: 'Personality', appearance: 'Appearance', atmosphere: 'Atmosphere', history: 'History', description: 'Description', biography: 'Biography', pitch: 'What it is about', stakes: 'What is at stake', outcome: 'How it ends', statement: 'The rule', cost: 'Cost of breaking it', limits: 'What it does not cover', text: 'Manuscript' },
  fr: { body: 'Corps', summary: 'Résumé', notes: 'Notes', backstory: 'Passé', personality: 'Personnalité', appearance: 'Apparence', atmosphere: 'Atmosphère', history: 'Histoire', description: 'Description', biography: 'Biographie', pitch: 'De quoi s’agit-il', stakes: 'Ce qui est en jeu', outcome: 'Comment cela finit', statement: 'La règle', cost: 'Prix de la transgression', limits: 'Ce qu’elle ne couvre pas', text: 'Manuscrit' },
  de: { body: 'Text', summary: 'Zusammenfassung', notes: 'Notizen', backstory: 'Hintergrund', personality: 'Persönlichkeit', appearance: 'Aussehen', atmosphere: 'Atmosphäre', history: 'Geschichte', description: 'Beschreibung', biography: 'Biografie', pitch: 'Worum es geht', stakes: 'Was auf dem Spiel steht', outcome: 'Wie es endet', statement: 'Das Gesetz', cost: 'Preis des Bruchs', limits: 'Wo es nicht greift', text: 'Manuskript' },
  pt: { body: 'Corpo', summary: 'Resumo', notes: 'Notas', backstory: 'Antecedentes', personality: 'Personalidade', appearance: 'Aparência', atmosphere: 'Atmosfera', history: 'História', description: 'Descrição', biography: 'Biografia', pitch: 'Do que trata', stakes: 'O que se perde', outcome: 'Como termina', statement: 'A regra', cost: 'Preço de a quebrar', limits: 'Onde não se aplica', text: 'Manuscrito' },
  'pt-BR': { body: 'Corpo', summary: 'Resumo', notes: 'Notas', backstory: 'Histórico', personality: 'Personalidade', appearance: 'Aparência', atmosphere: 'Atmosfera', history: 'História', description: 'Descrição', biography: 'Biografia', pitch: 'Do que se trata', stakes: 'O que está em jogo', outcome: 'Como termina', statement: 'A regra', cost: 'Custo de quebrá-la', limits: 'Onde não se aplica', text: 'Manuscrito' },
  it: { body: 'Corpo', summary: 'Sommario', notes: 'Note', backstory: 'Passato', personality: 'Personalità', appearance: 'Aspetto', atmosphere: 'Atmosfera', history: 'Storia', description: 'Descrizione', biography: 'Biografia', pitch: 'Di cosa parla', stakes: 'Cosa si perde', outcome: 'Come finisce', statement: 'La regola', cost: 'Costo della violazione', limits: 'Dove non vale', text: 'Manoscritto' },
  tr: { body: 'Gövde', summary: 'Özet', notes: 'Notlar', backstory: 'Geçmiş', personality: 'Kişilik', appearance: 'Görünüş', atmosphere: 'Atmosfer', history: 'Tarihçe', description: 'Açıklama', biography: 'Biyografi', pitch: 'Konusu', stakes: 'Kaybedilen', outcome: 'Sonu', statement: 'Kural', cost: 'Çiğneme bedeli', limits: 'Nereye kadar geçerli değil', text: 'El yazması' },
  'zh-Hans': { body: '正文', summary: '摘要', notes: '笔记', backstory: '背景故事', personality: '性格', appearance: '外貌', atmosphere: '氛围', history: '历史', description: '描述', biography: '传记', pitch: '内容梗概', stakes: '利害攸关', outcome: '结局', statement: '规则内容', cost: '违背的代价', limits: '不涵盖的范围', text: '手稿' },
  'zh-Hant': { body: '內文', summary: '摘要', notes: '筆記', backstory: '背景故事', personality: '性格', appearance: '外貌', atmosphere: '氛圍', history: '歷史', description: '描述', biography: '傳記', pitch: '內容梗概', stakes: '利害攸關', outcome: '結局', statement: '規則內容', cost: '違背的代價', limits: '不涵蓋的範圍', text: '手稿' },
  vi: { body: 'Nội dung', summary: 'Tóm tắt', notes: 'Ghi chú', backstory: 'Lai lịch', personality: 'Tính cách', appearance: 'Ngoại hình', atmosphere: 'Không khí', history: 'Lịch sử', description: 'Mô tả', biography: 'Tiểu sử', pitch: 'Nội dung chính', stakes: 'Điều đang bị đe dọa', outcome: 'Kết cục', statement: 'Nội dung quy tắc', cost: 'Cái giá khi vi phạm', limits: 'Điều không bao quát', text: 'Bản thảo' },
  ja: { body: '本文', summary: '要約', notes: 'メモ', backstory: '背景', personality: '性格', appearance: '外見', atmosphere: '雰囲気', history: '歴史', description: '説明', biography: '伝記', pitch: 'あらすじ', stakes: '失われるもの', outcome: '結末', statement: 'ルールの内容', cost: '違反の代償', limits: '適用されない範囲', text: '原稿' },
  ru: { body: 'Основной текст', summary: 'Краткое содержание', notes: 'Заметки', backstory: 'Предыстория', personality: 'Характер', appearance: 'Внешность', atmosphere: 'Атмосфера', history: 'История', description: 'Описание', biography: 'Биография', pitch: 'О чём это', stakes: 'Что на кону', outcome: 'Чем заканчивается', statement: 'Формулировка правила', cost: 'Цена нарушения', limits: 'Что не охватывает', text: 'Рукопись' },
  uk: { body: 'Основний текст', summary: 'Стислий виклад', notes: 'Нотатки', backstory: 'Передісторія', personality: 'Характер', appearance: 'Зовнішність', atmosphere: 'Атмосфера', history: 'Історія', description: 'Опис', biography: 'Біографія', pitch: 'Про що це', stakes: 'Що на кону', outcome: 'Чим закінчується', statement: 'Формулювання правила', cost: 'Ціна порушення', limits: 'Що не охоплює', text: 'Рукопис' },
  ko: { body: '본문', summary: '요약', notes: '메모', backstory: '배경', personality: '성격', appearance: '외모', atmosphere: '분위기', history: '역사', description: '설명', biography: '전기', pitch: '다루는 내용', stakes: '걸려 있는 것', outcome: '결말', statement: '규칙 내용', cost: '위반의 대가', limits: '적용되지 않는 범위', text: '원고' },
};

const HARDNESS_LABELS: LocalizedRecord<string> = {
  es: { physical: 'Imposible', costly: 'Tiene un precio', social: 'Está prohibido' },
  en: { physical: 'Impossible', costly: 'Has a cost', social: 'Forbidden' },
  fr: { physical: 'Impossible', costly: 'A un prix', social: 'Interdit' },
  de: { physical: 'Unmöglich', costly: 'Hat einen Preis', social: 'Verboten' },
  pt: { physical: 'Impossível', costly: 'Tem um preço', social: 'É proibido' },
  'pt-BR': { physical: 'Impossível', costly: 'Tem um custo', social: 'É proibido' },
  it: { physical: 'Impossibile', costly: 'Ha un prezzo', social: 'È vietato' },
  tr: { physical: 'İmkânsız', costly: 'Bedeli var', social: 'Yasak' },
  'zh-Hans': { physical: '不可能', costly: '有代价', social: '禁止' },
  'zh-Hant': { physical: '不可能', costly: '有代價', social: '禁止' },
  vi: { physical: 'Bất khả thi', costly: 'Có cái giá', social: 'Bị cấm' },
  ja: { physical: '不可能', costly: '代償を伴う', social: '禁止されている' },
  ru: { physical: 'Невозможно', costly: 'Имеет цену', social: 'Запрещено' },
  uk: { physical: 'Неможливо', costly: 'Має ціну', social: 'Заборонено' },
  ko: { physical: '불가능', costly: '대가가 따름', social: '금지됨' },
};

const HARDNESS_HINTS: LocalizedRecord<string> = {
  es: { physical: 'Aquí no puede pasar. Si pasa, es un error de continuidad.', costly: 'Puede pasar, pero cuesta algo. Si no se paga, es trampa.', social: 'Se puede, pero está prohibido. Romperlo es una trama.' },
  en: { physical: 'It cannot happen here. If it does, it is a continuity error.', costly: 'It can happen, but it costs something. If it is not paid, it is cheating.', social: 'It is possible, but forbidden. Breaking it is plot.' },
  fr: { physical: 'Cela ne peut pas arriver ici. Si cela arrive, c’est une erreur de continuité.', costly: 'C’est possible, mais cela coûte quelque chose. Sans paiement, c’est une triche.', social: 'C’est possible, mais interdit. Le transgresser fait partie de l’intrigue.' },
  de: { physical: 'Hier kann es nicht geschehen. Geschieht es doch, ist es ein Kontinuitätsfehler.', costly: 'Es kann geschehen, kostet aber etwas. Ohne Preis ist es Schummeln.', social: 'Es ist möglich, aber verboten. Der Bruch wird zur Handlung.' },
  pt: { physical: 'Aqui não pode acontecer. Se acontecer, é um erro de continuidade.', costly: 'Pode acontecer, mas tem um preço. Se não for pago, é batota.', social: 'É possível, mas proibido. Quebrá-lo é enredo.' },
  'pt-BR': { physical: 'Aqui não pode acontecer. Se acontecer, é um erro de continuidade.', costly: 'Pode acontecer, mas tem um custo. Se não for pago, é trapaça.', social: 'É possível, mas proibido. Quebrá-lo é parte da trama.' },
  it: { physical: 'Qui non può accadere. Se accade, è un errore di continuità.', costly: 'Può accadere, ma ha un costo. Se non viene pagato, è un trucco.', social: 'È possibile, ma vietato. Infrangerlo è trama.' },
  tr: { physical: 'Burada gerçekleşemez. Gerçekleşirse süreklilik hatasıdır.', costly: 'Gerçekleşebilir ama bir bedeli vardır. Ödenmezse hiledir.', social: 'Mümkündür ama yasaktır. Çiğnenmesi olay örgüsüdür.' },
  'zh-Hans': { physical: '这里不可能发生。如果发生了，就是连续性错误。', costly: '可以发生，但需要付出代价。如果不付出代价，就是作弊。', social: '可以发生，但被禁止。打破它就是情节。' },
  'zh-Hant': { physical: '這裡不可能發生。如果發生了，就是連續性錯誤。', costly: '可以發生，但必須付出代價。如果不付出代價，就是作弊。', social: '可以發生，但被禁止。打破它就是情節。' },
  vi: { physical: 'Điều này không thể xảy ra ở đây. Nếu xảy ra, đó là lỗi liên tục.', costly: 'Điều này có thể xảy ra, nhưng phải trả một cái giá. Nếu không trả, đó là gian lận.', social: 'Điều này có thể xảy ra, nhưng bị cấm. Phá vỡ nó chính là cốt truyện.' },
  ja: { physical: 'ここでは起こり得ません。起こったなら、それは連続性の誤りです。', costly: '起こり得ますが、何らかの代償を伴います。代償が払われなければ、それはごまかしです。', social: '可能ですが、禁じられています。それを破ることが筋書きです。' },
  ru: { physical: 'Здесь это невозможно. Если это происходит, это ошибка непрерывности.', costly: 'Это может произойти, но за это придётся заплатить. Если цена не уплачена, это жульничество.', social: 'Это возможно, но запрещено. Нарушение этого — сюжет.' },
  uk: { physical: 'Тут це неможливо. Якщо це станеться, це помилка безперервності.', costly: 'Це може статися, але за це доведеться заплатити. Якщо ціну не сплачено, це шахрайство.', social: 'Це можливо, але заборонено. Порушення цього — сюжет.' },
  ko: { physical: '여기서는 일어날 수 없습니다. 만약 일어난다면 연속성 오류입니다.', costly: '일어날 수 있지만 그에 대한 대가가 따릅니다. 대가를 치르지 않으면 속임수입니다.', social: '가능하지만 금지되어 있습니다. 그것을 깨는 것이 곧 플롯입니다.' },
};

const SCOPE_LABELS: LocalizedRecord<string> = {
  es: { world: 'Todo el mundo', group: 'Una facción', place: 'Un lugar' },
  en: { world: 'The whole world', group: 'A faction', place: 'A place' },
  fr: { world: 'Tout le monde', group: 'Une faction', place: 'Un lieu' },
  de: { world: 'Die ganze Welt', group: 'Eine Fraktion', place: 'Ein Ort' },
  pt: { world: 'Todo o mundo', group: 'Uma facção', place: 'Um lugar' },
  'pt-BR': { world: 'Todo o mundo', group: 'Uma facção', place: 'Um lugar' },
  it: { world: 'Tutto il mondo', group: 'Una fazione', place: 'Un luogo' },
  tr: { world: 'Tüm dünya', group: 'Bir fraksiyon', place: 'Bir yer' },
  'zh-Hans': { world: '整个世界', group: '一个派系', place: '一个地点' },
  'zh-Hant': { world: '整個世界', group: '一個派系', place: '一個地點' },
  vi: { world: 'Toàn bộ thế giới', group: 'Một phe phái', place: 'Một địa điểm' },
  ja: { world: '世界全体', group: '一つの勢力', place: '一つの場所' },
  ru: { world: 'Весь мир', group: 'Одна фракция', place: 'Одно место' },
  uk: { world: 'Увесь світ', group: 'Одна фракція', place: 'Одне місце' },
  ko: { world: '세계 전체', group: '하나의 세력', place: '하나의 장소' },
};

const MARK_LABELS: LocalizedRecord<string> = {
  es: { obeys: 'Se cumple', bends: 'Se dobla', breaks: 'Se rompe', establishes: 'Se establece', raise: 'Sube', turn: 'Gira', ease: 'Baja', resolve: 'Se cierra', step: 'Avanza' },
  en: { obeys: 'Obeys', bends: 'Bends', breaks: 'Breaks', establishes: 'Establishes', raise: 'Rises', turn: 'Turns', ease: 'Eases', resolve: 'Resolves', step: 'Advances' },
  fr: { obeys: 'Est respectée', bends: 'Plie', breaks: 'Est enfreinte', establishes: 'Est établie', raise: 'Monte', turn: 'Tourne', ease: 'Baisse', resolve: 'Se clôt', step: 'Avance' },
  de: { obeys: 'Wird befolgt', bends: 'Wird gebeugt', breaks: 'Wird gebrochen', establishes: 'Wird festgelegt', raise: 'Steigt', turn: 'Dreht sich', ease: 'Sinkt', resolve: 'Wird abgeschlossen', step: 'Geht weiter' },
  pt: { obeys: 'É cumprida', bends: 'Dobra-se', breaks: 'É quebrada', establishes: 'É estabelecida', raise: 'Sobe', turn: 'Muda', ease: 'Desce', resolve: 'Fecha-se', step: 'Avança' },
  'pt-BR': { obeys: 'É cumprida', bends: 'Dobra', breaks: 'É quebrada', establishes: 'É estabelecida', raise: 'Sobe', turn: 'Vira', ease: 'Desce', resolve: 'Se encerra', step: 'Avança' },
  it: { obeys: 'È rispettata', bends: 'Si piega', breaks: 'Si spezza', establishes: 'Si stabilisce', raise: 'Sale', turn: 'Svolta', ease: 'Scende', resolve: 'Si chiude', step: 'Avanza' },
  tr: { obeys: 'Uyulur', bends: 'Bükülür', breaks: 'Çiğnenir', establishes: 'Belirlenir', raise: 'Yükselir', turn: 'Döner', ease: 'Azalır', resolve: 'Çözülür', step: 'İlerler' },
  'zh-Hans': { obeys: '遵守', bends: '弯折', breaks: '打破', establishes: '确立', raise: '上升', turn: '转折', ease: '缓和', resolve: '收束', step: '推进' },
  'zh-Hant': { obeys: '遵守', bends: '彎折', breaks: '打破', establishes: '確立', raise: '上升', turn: '轉折', ease: '緩和', resolve: '收束', step: '推進' },
  vi: { obeys: 'Tuân thủ', bends: 'Bẻ cong', breaks: 'Phá vỡ', establishes: 'Thiết lập', raise: 'Tăng cao', turn: 'Chuyển hướng', ease: 'Giảm nhẹ', resolve: 'Khép lại', step: 'Tiến triển' },
  ja: { obeys: '守られる', bends: '曲がる', breaks: '破られる', establishes: '確立される', raise: '高まる', turn: '転換する', ease: '和らぐ', resolve: '決着する', step: '進む' },
  ru: { obeys: 'Соблюдается', bends: 'Гнётся', breaks: 'Нарушается', establishes: 'Устанавливается', raise: 'Нарастает', turn: 'Поворачивает', ease: 'Ослабевает', resolve: 'Завершается', step: 'Продвигается' },
  uk: { obeys: 'Дотримується', bends: 'Згинається', breaks: 'Порушується', establishes: 'Встановлюється', raise: 'Зростає', turn: 'Повертає', ease: 'Слабшає', resolve: 'Завершується', step: 'Просувається' },
  ko: { obeys: '준수됨', bends: '휘어짐', breaks: '깨짐', establishes: '확립됨', raise: '상승함', turn: '전환됨', ease: '완화됨', resolve: '종결됨', step: '진전됨' },
};

export function worldEntryKindLabel(kind: string, language: unknown): string {
  const locale = normalizePromptLanguage(language);
  return ENTRY_KIND_LABELS[locale][kind] ?? kind;
}

export function worldArticleCategoryLabel(category: string, language: unknown): string {
  const locale = normalizePromptLanguage(language);
  return ARTICLE_CATEGORY_LABELS[locale][category] ?? category;
}

export function worldFieldLabel(field: string, language: unknown): string {
  const locale = normalizePromptLanguage(language);
  return FIELD_LABELS[locale][field] ?? field;
}

export function worldRuleHardnessLabel(hardness: string, language: unknown): string {
  const locale = normalizePromptLanguage(language);
  return HARDNESS_LABELS[locale][hardness] ?? hardness;
}

export function worldRuleHardnessHint(hardness: string, language: unknown): string {
  const locale = normalizePromptLanguage(language);
  return HARDNESS_HINTS[locale][hardness] ?? hardness;
}

export function worldRuleScopeLabel(scope: string, language: unknown): string {
  const locale = normalizePromptLanguage(language);
  return SCOPE_LABELS[locale][scope] ?? scope;
}

export function worldBeatMarkLabel(mark: string, language: unknown): string {
  const locale = normalizePromptLanguage(language);
  return MARK_LABELS[locale][mark] ?? mark;
}

const RESPONSE_LANGUAGE_INSTRUCTION: Record<WorldPromptLocale, string> = {
  es: 'Responde íntegramente en español.',
  en: 'Respond entirely in English.',
  fr: 'Réponds intégralement en français.',
  de: 'Antworte vollständig auf Deutsch.',
  pt: 'Responde integralmente em português europeu.',
  'pt-BR': 'Responda integralmente em português do Brasil.',
  it: 'Rispondi interamente in italiano.',
  tr: 'Yanıtın tamamını Türkçe ver.',
  'zh-Hans': '请完全用简体中文回答。',
  'zh-Hant': '請完全用繁體中文回答。',
  vi: 'Hãy trả lời hoàn toàn bằng tiếng Việt.',
  ja: '完全に日本語で回答してください。',
  ru: 'Отвечайте полностью на русском языке.',
  uk: 'Відповідайте повністю українською мовою.',
  ko: '전부 한국어로 답변하십시오.',
};

/**
 * Worldbuilding prompts carry author prose and invented proper names verbatim, but every
 * generated explanation or draft must follow the prompt language selected for the
 * vault. Keeping this instruction in the target language also works with small local
 * models that underweight a final English-only locale code.
 */
export function withWorldPromptLanguage(system: string, language: unknown): string {
  const locale = normalizePromptLanguage(language);
  return `${system}\n\n${RESPONSE_LANGUAGE_INSTRUCTION[locale]}`;
}
