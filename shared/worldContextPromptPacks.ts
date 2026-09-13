import type {
  BeatMark,
  BeatThreadKind,
  CharacterLifeStatus,
  CharacterNarrativeRole,
  EventTypeValue,
  PromptLanguage,
} from './types';

export interface CharacterBiographyContextCopy {
  character: string;
  species: string;
  gender: string;
  pronouns: string;
  status: string;
  narrativeRole: string;
  alsoKnownAs: string;
  birth: string;
  death: string;
  appearance: string;
  personality: string;
  backstory: string;
  parents: string;
  partners: string;
  children: string;
  siblings: string;
  links: string;
  lifeEvents: string;
  year: string;
  inPlace: string;
  authorNotes: string;
  writeFaithful: string;
  writePropose: string;
  lifeStatuses: Record<CharacterLifeStatus, string>;
  roles: Record<CharacterNarrativeRole, string>;
  eventTypes: Partial<Record<EventTypeValue, string>>;
  aliasKinds: Record<string, string>;
}

export interface ProseReviewContextCopy {
  scene: string;
  declaredBeats: string;
  sceneText: string;
  ask: (count: number) => string;
  threadKinds: Record<BeatThreadKind, string>;
  beatMarks: Record<BeatMark, string>;
}

const life = (
  unknown: string, alive: string, dead: string, missing: string,
  undead: string, immortal: string, unborn: string,
): Record<CharacterLifeStatus, string> => ({ unknown, alive, dead, missing, undead, immortal, unborn });
const roles = (
  protagonist: string, antagonist: string, secondary: string, tertiary: string, cameo: string,
): Record<CharacterNarrativeRole, string> => ({ protagonist, antagonist, secondary, tertiary, cameo });
const events = (
  birth: string, firstAppearance: string, oath: string, bond: string, journey: string,
  battle: string, betrayal: string, revelation: string, transformation: string,
  ascension: string, exile: string, loss: string, death: string, other: string,
): Partial<Record<EventTypeValue, string>> => ({
  birth, first_appearance: firstAppearance, oath, bond, journey, battle, betrayal,
  revelation, transformation, ascension, exile, loss, death, other,
});
const aliasKinds = (
  trueName: string, birthName: string, epithet: string, nickname: string, alias: string, foreignName: string,
): Record<string, string> => ({
  true_name: trueName, birth_name: birthName, epithet, nickname, alias, foreign_name: foreignName,
});
const marks = (
  obeys: string, bends: string, breaks: string, establishes: string,
  raise: string, turn: string, ease: string, resolve: string, step: string,
): Record<BeatMark, string> => ({ obeys, bends, breaks, establishes, raise, turn, ease, resolve, step });

export const CHARACTER_BIOGRAPHY_CONTEXT_COPY: Record<PromptLanguage, CharacterBiographyContextCopy> = {
  es: {
    character: 'Personaje', species: 'especie', gender: 'género', pronouns: 'pronombres (úsalos literalmente)',
    status: 'estado', narrativeRole: 'papel en el relato', alsoKnownAs: 'También conocido como', birth: 'Nacimiento',
    death: 'Muerte', appearance: 'Apariencia', personality: 'Personalidad', backstory: 'Trasfondo',
    parents: 'Progenitores', partners: 'Parejas', children: 'Descendencia', siblings: 'Hermanos', links: 'Vínculos',
    lifeEvents: 'Hechos de su vida, en orden', year: 'año', inPlace: 'en', authorNotes: 'Notas del autor',
    writeFaithful: 'Redacta la biografía del personaje a partir de lo anterior.',
    writePropose: 'Redacta la biografía del personaje a partir de lo anterior, y propón lo que falte marcándolo entre corchetes.',
    lifeStatuses: life('Sin determinar', 'Vivo', 'Muerto', 'Desaparecido', 'No muerto', 'Inmortal', 'Aún no nace'),
    roles: roles('Protagonista', 'Antagonista', 'Secundario', 'Terciario', 'Mención'),
    eventTypes: events('Nacimiento', 'Primera aparición', 'Juramento', 'Vínculo', 'Viaje', 'Batalla', 'Traición', 'Revelación', 'Transformación', 'Ascenso', 'Exilio', 'Pérdida', 'Muerte', 'Otro'),
    aliasKinds: aliasKinds('Nombre verdadero', 'Nombre de nacimiento', 'Epíteto o título', 'Apodo', 'Alias', 'Nombre en otra lengua'),
  },
  en: {
    character: 'Character', species: 'species', gender: 'gender', pronouns: 'pronouns (use them verbatim)',
    status: 'status', narrativeRole: 'role in the story', alsoKnownAs: 'Also known as', birth: 'Birth', death: 'Death',
    appearance: 'Appearance', personality: 'Personality', backstory: 'Backstory', parents: 'Parents', partners: 'Partners',
    children: 'Children', siblings: 'Siblings', links: 'Relationships', lifeEvents: 'Life events, in order', year: 'year',
    inPlace: 'in', authorNotes: 'Author notes', writeFaithful: 'Write the character biography from the information above.',
    writePropose: 'Write the character biography from the information above and propose what is missing, marking it in brackets.',
    lifeStatuses: life('Undetermined', 'Alive', 'Dead', 'Missing', 'Undead', 'Immortal', 'Not yet born'),
    roles: roles('Protagonist', 'Antagonist', 'Supporting', 'Tertiary', 'Mention'),
    eventTypes: events('Birth', 'First appearance', 'Oath', 'Bond', 'Journey', 'Battle', 'Betrayal', 'Revelation', 'Transformation', 'Ascension', 'Exile', 'Loss', 'Death', 'Other'),
    aliasKinds: aliasKinds('True name', 'Birth name', 'Epithet or title', 'Nickname', 'Alias', 'Name in another language'),
  },
  fr: {
    character: 'Personnage', species: 'espèce', gender: 'genre', pronouns: 'pronoms (utilisez-les tels quels)',
    status: 'statut', narrativeRole: 'rôle dans le récit', alsoKnownAs: 'Également connu sous le nom de', birth: 'Naissance',
    death: 'Mort', appearance: 'Apparence', personality: 'Personnalité', backstory: 'Passé', parents: 'Parents',
    partners: 'Partenaires', children: 'Descendance', siblings: 'Frères et sœurs', links: 'Liens',
    lifeEvents: 'Événements de sa vie, dans l’ordre', year: 'année', inPlace: 'à', authorNotes: 'Notes de l’auteur',
    writeFaithful: 'Rédigez la biographie du personnage à partir des informations ci-dessus.',
    writePropose: 'Rédigez la biographie du personnage à partir des informations ci-dessus et proposez ce qui manque en le plaçant entre crochets.',
    lifeStatuses: life('Indéterminé', 'Vivant', 'Mort', 'Disparu', 'Mort-vivant', 'Immortel', 'Pas encore né'),
    roles: roles('Protagoniste', 'Antagoniste', 'Secondaire', 'Tertiaire', 'Mention'),
    eventTypes: events('Naissance', 'Première apparition', 'Serment', 'Lien', 'Voyage', 'Bataille', 'Trahison', 'Révélation', 'Transformation', 'Ascension', 'Exil', 'Perte', 'Mort', 'Autre'),
    aliasKinds: aliasKinds('Vrai nom', 'Nom de naissance', 'Épithète ou titre', 'Surnom', 'Alias', 'Nom dans une autre langue'),
  },
  de: {
    character: 'Figur', species: 'Spezies', gender: 'Geschlecht', pronouns: 'Pronomen (wörtlich verwenden)',
    status: 'Status', narrativeRole: 'Rolle in der Erzählung', alsoKnownAs: 'Auch bekannt als', birth: 'Geburt', death: 'Tod',
    appearance: 'Erscheinung', personality: 'Persönlichkeit', backstory: 'Vorgeschichte', parents: 'Eltern',
    partners: 'Partner', children: 'Nachkommen', siblings: 'Geschwister', links: 'Beziehungen',
    lifeEvents: 'Lebensereignisse in Reihenfolge', year: 'Jahr', inPlace: 'in', authorNotes: 'Anmerkungen der schreibenden Person',
    writeFaithful: 'Schreibe die Biografie der Figur anhand der obigen Angaben.',
    writePropose: 'Schreibe die Biografie der Figur anhand der obigen Angaben und schlage Fehlendes in eckigen Klammern vor.',
    lifeStatuses: life('Unbestimmt', 'Lebendig', 'Tot', 'Verschollen', 'Untot', 'Unsterblich', 'Noch nicht geboren'),
    roles: roles('Hauptfigur', 'Gegenspieler', 'Nebenfigur', 'Tertiärfigur', 'Erwähnung'),
    eventTypes: events('Geburt', 'Erster Auftritt', 'Eid', 'Bindung', 'Reise', 'Schlacht', 'Verrat', 'Enthüllung', 'Verwandlung', 'Aufstieg', 'Exil', 'Verlust', 'Tod', 'Sonstiges'),
    aliasKinds: aliasKinds('Wahrer Name', 'Geburtsname', 'Beiname oder Titel', 'Spitzname', 'Alias', 'Name in einer anderen Sprache'),
  },
  pt: {
    character: 'Personagem', species: 'espécie', gender: 'género', pronouns: 'pronomes (usa-os literalmente)',
    status: 'estado', narrativeRole: 'papel na narrativa', alsoKnownAs: 'Também conhecido como', birth: 'Nascimento',
    death: 'Morte', appearance: 'Aparência', personality: 'Personalidade', backstory: 'Antecedentes',
    parents: 'Progenitores', partners: 'Parceiros', children: 'Descendência', siblings: 'Irmãos', links: 'Vínculos',
    lifeEvents: 'Acontecimentos da sua vida, por ordem', year: 'ano', inPlace: 'em', authorNotes: 'Notas do autor',
    writeFaithful: 'Redige a biografia da personagem a partir da informação anterior.',
    writePropose: 'Redige a biografia da personagem a partir da informação anterior e propõe o que falta, marcando-o entre parênteses retos.',
    lifeStatuses: life('Por determinar', 'Vivo', 'Morto', 'Desaparecido', 'Morto-vivo', 'Imortal', 'Ainda não nasceu'),
    roles: roles('Protagonista', 'Antagonista', 'Secundário', 'Terciário', 'Menção'),
    eventTypes: events('Nascimento', 'Primeira aparição', 'Juramento', 'Vínculo', 'Viagem', 'Batalha', 'Traição', 'Revelação', 'Transformação', 'Ascensão', 'Exílio', 'Perda', 'Morte', 'Outro'),
    aliasKinds: aliasKinds('Nome verdadeiro', 'Nome de nascimento', 'Epíteto ou título', 'Alcunha', 'Alias', 'Nome noutra língua'),
  },
  'pt-BR': {
    character: 'Personagem', species: 'espécie', gender: 'gênero', pronouns: 'pronomes (use-os literalmente)',
    status: 'estado', narrativeRole: 'papel na narrativa', alsoKnownAs: 'Também conhecido como', birth: 'Nascimento',
    death: 'Morte', appearance: 'Aparência', personality: 'Personalidade', backstory: 'Histórico', parents: 'Progenitores',
    partners: 'Parceiros', children: 'Descendência', siblings: 'Irmãos', links: 'Vínculos',
    lifeEvents: 'Acontecimentos da vida, em ordem', year: 'ano', inPlace: 'em', authorNotes: 'Notas do autor',
    writeFaithful: 'Escreva a biografia do personagem a partir das informações acima.',
    writePropose: 'Escreva a biografia do personagem a partir das informações acima e proponha o que falta, marcando-o entre colchetes.',
    lifeStatuses: life('Indeterminado', 'Vivo', 'Morto', 'Desaparecido', 'Morto-vivo', 'Imortal', 'Ainda não nasceu'),
    roles: roles('Protagonista', 'Antagonista', 'Coadjuvante', 'Terciário', 'Menção'),
    eventTypes: events('Nascimento', 'Primeira aparição', 'Juramento', 'Vínculo', 'Viagem', 'Batalha', 'Traição', 'Revelação', 'Transformação', 'Ascensão', 'Exílio', 'Perda', 'Morte', 'Outro'),
    aliasKinds: aliasKinds('Nome verdadeiro', 'Nome de nascimento', 'Epíteto ou título', 'Apelido', 'Alias', 'Nome em outro idioma'),
  },
  it: {
    character: 'Personaggio', species: 'specie', gender: 'genere', pronouns: 'pronomi (usali alla lettera)',
    status: 'stato', narrativeRole: 'ruolo nella narrazione', alsoKnownAs: 'Conosciuto anche come', birth: 'Nascita',
    death: 'Morte', appearance: 'Aspetto', personality: 'Personalità', backstory: 'Antefatti',
    parents: 'Genitori', partners: 'Partner', children: 'Discendenza', siblings: 'Fratelli e sorelle', links: 'Legami',
    lifeEvents: 'Eventi della sua vita, in ordine', year: 'anno', inPlace: 'a', authorNotes: 'Note dell’autore',
    writeFaithful: 'Scrivi la biografia del personaggio a partire dalle informazioni precedenti.',
    writePropose: 'Scrivi la biografia del personaggio a partire dalle informazioni precedenti e proponi ciò che manca, segnalandolo tra parentesi quadre.',
    lifeStatuses: life('Da determinare', 'Vivo', 'Morto', 'Scomparso', 'Non morto', 'Immortale', 'Non ancora nato'),
    roles: roles('Protagonista', 'Antagonista', 'Secondario', 'Terziario', 'Menzione'),
    eventTypes: events('Nascita', 'Prima apparizione', 'Giuramento', 'Legame', 'Viaggio', 'Battaglia', 'Tradimento', 'Rivelazione', 'Trasformazione', 'Ascesa', 'Esilio', 'Perdita', 'Morte', 'Altro'),
    aliasKinds: aliasKinds('Vero nome', 'Nome di nascita', 'Epiteto o titolo', 'Soprannome', 'Alias', 'Nome in un’altra lingua'),
  },
  tr: {
    character: 'Karakter', species: 'tür', gender: 'cinsiyet', pronouns: 'zamirler (aynen kullan)', status: 'durum',
    narrativeRole: 'anlatıdaki rol', alsoKnownAs: 'Diğer adları', birth: 'Doğum', death: 'Ölüm', appearance: 'Görünüş',
    personality: 'Kişilik', backstory: 'Geçmiş', parents: 'Ebeveynler', partners: 'Eşler', children: 'Çocuklar',
    siblings: 'Kardeşler', links: 'Bağlar', lifeEvents: 'Yaşam olayları, sırayla', year: 'yıl', inPlace: 'yer',
    authorNotes: 'Yazarın notları', writeFaithful: 'Yukarıdaki bilgilerden karakterin biyografisini yaz.',
    writePropose: 'Yukarıdaki bilgilerden karakterin biyografisini yaz ve eksikleri köşeli parantez içinde öner.',
    lifeStatuses: life('Belirsiz', 'Hayatta', 'Ölü', 'Kayıp', 'Yaşayan ölü', 'Ölümsüz', 'Henüz doğmadı'),
    roles: roles('Başkahraman', 'Karşıt karakter', 'Yardımcı karakter', 'Üçüncül karakter', 'Anılma'),
    eventTypes: events('Doğum', 'İlk görünüş', 'Yemin', 'Bağ', 'Yolculuk', 'Savaş', 'İhanet', 'Vahiy', 'Dönüşüm', 'Yükseliş', 'Sürgün', 'Kayıp', 'Ölüm', 'Diğer'),
    aliasKinds: aliasKinds('Gerçek ad', 'Doğum adı', 'Lakap veya unvan', 'Takma ad', 'Alias', 'Başka dilde ad'),
  },
  'zh-Hans': {
    character: '角色', species: '物种', gender: '性别', pronouns: '代词（请原样使用）',
    status: '状态', narrativeRole: '在故事中的角色', alsoKnownAs: '又名', birth: '出生', death: '死亡',
    appearance: '外貌', personality: '性格', backstory: '背景故事', parents: '父母', partners: '伴侣',
    children: '子女', siblings: '兄弟姐妹', links: '关系', lifeEvents: '生平事件，按顺序', year: '年份',
    inPlace: '地点', authorNotes: '作者笔记', writeFaithful: '请根据以上信息撰写该角色的传记。',
    writePropose: '请根据以上信息撰写该角色的传记，并对缺失内容提出补充建议，用方括号标出。',
    lifeStatuses: life('未确定', '在世', '已故', '失踪', '亡灵', '永生', '尚未出生'),
    roles: roles('主角', '反派', '配角', '次要角色', '提及'),
    eventTypes: events('出生', '首次登场', '誓言', '羁绊', '旅程', '战斗', '背叛', '揭示', '转变', '晋升', '流放', '失去', '死亡', '其他'),
    aliasKinds: aliasKinds('真名', '本名', '称号或头衔', '绰号', '化名', '外语名称'),
  },
  'zh-Hant': {
    character: '角色', species: '物種', gender: '性別', pronouns: '代詞（請原樣使用）',
    status: '狀態', narrativeRole: '在故事中的角色', alsoKnownAs: '又名', birth: '出生', death: '死亡',
    appearance: '外貌', personality: '性格', backstory: '背景故事', parents: '父母', partners: '伴侶',
    children: '子女', siblings: '兄弟姊妹', links: '關係', lifeEvents: '生平事件，按順序', year: '年份',
    inPlace: '地點', authorNotes: '作者筆記', writeFaithful: '請根據以上資訊撰寫該角色的傳記。',
    writePropose: '請根據以上資訊撰寫該角色的傳記，並針對缺失內容提出補充建議，以方括號標示。',
    lifeStatuses: life('未確定', '在世', '已故', '失蹤', '亡靈', '永生', '尚未出生'),
    roles: roles('主角', '反派', '配角', '次要角色', '提及'),
    eventTypes: events('出生', '首次登場', '誓言', '羈絆', '旅程', '戰鬥', '背叛', '揭示', '轉變', '晉升', '流放', '失去', '死亡', '其他'),
    aliasKinds: aliasKinds('真名', '本名', '稱號或頭銜', '綽號', '化名', '外語名稱'),
  },
  vi: {
    character: 'Nhân vật', species: 'loài', gender: 'giới tính', pronouns: 'đại từ (dùng nguyên văn)',
    status: 'trạng thái', narrativeRole: 'vai trò trong câu chuyện', alsoKnownAs: 'Còn được gọi là', birth: 'Sinh', death: 'Mất',
    appearance: 'Ngoại hình', personality: 'Tính cách', backstory: 'Lai lịch', parents: 'Cha mẹ', partners: 'Bạn đời',
    children: 'Con cái', siblings: 'Anh chị em', links: 'Quan hệ', lifeEvents: 'Các sự kiện trong cuộc đời, theo thứ tự', year: 'năm',
    inPlace: 'tại', authorNotes: 'Ghi chú của tác giả', writeFaithful: 'Hãy viết tiểu sử của nhân vật dựa trên thông tin trên.',
    writePropose: 'Hãy viết tiểu sử của nhân vật dựa trên thông tin trên và đề xuất những phần còn thiếu, đánh dấu chúng trong ngoặc vuông.',
    lifeStatuses: life('Chưa xác định', 'Còn sống', 'Đã chết', 'Mất tích', 'Xác sống', 'Bất tử', 'Chưa sinh ra'),
    roles: roles('Nhân vật chính', 'Phản diện', 'Nhân vật phụ', 'Nhân vật thứ yếu', 'Được nhắc đến'),
    eventTypes: events('Sinh', 'Xuất hiện lần đầu', 'Lời thề', 'Gắn kết', 'Hành trình', 'Trận chiến', 'Phản bội', 'Mặc khải', 'Biến đổi', 'Thăng tiến', 'Lưu đày', 'Mất mát', 'Tử vong', 'Khác'),
    aliasKinds: aliasKinds('Tên thật', 'Tên khai sinh', 'Biệt hiệu hoặc danh hiệu', 'Biệt danh', 'Bí danh', 'Tên ở ngôn ngữ khác'),
  },
  ja: {
    character: 'キャラクター', species: '種族', gender: '性別', pronouns: '代名詞（そのまま使用してください）',
    status: '状態', narrativeRole: '物語における役割', alsoKnownAs: '別名', birth: '誕生', death: '死',
    appearance: '外見', personality: '性格', backstory: '背景', parents: '両親', partners: 'パートナー',
    children: '子供', siblings: '兄弟姉妹', links: '関係', lifeEvents: '人生の出来事、順番どおり', year: '年',
    inPlace: '場所', authorNotes: '作者のメモ', writeFaithful: '上記の情報をもとに、このキャラクターの伝記を書いてください。',
    writePropose: '上記の情報をもとにこのキャラクターの伝記を書き、不足している内容を角括弧で示して提案してください。',
    lifeStatuses: life('未確定', '生存', '死亡', '行方不明', 'アンデッド', '不死', '未誕生'),
    roles: roles('主人公', '敵役', '脇役', '端役', '言及のみ'),
    eventTypes: events('誕生', '初登場', '誓約', '絆', '旅', '戦い', '裏切り', '啓示', '変容', '昇天', '追放', '喪失', '死', 'その他'),
    aliasKinds: aliasKinds('真名', '出生名', '異名または称号', 'あだ名', '偽名', '他言語での名前'),
  },
  ru: {
    character: 'Персонаж', species: 'вид', gender: 'пол', pronouns: 'местоимения (используйте их дословно)',
    status: 'статус', narrativeRole: 'роль в истории', alsoKnownAs: 'Также известен как', birth: 'Рождение', death: 'Смерть',
    appearance: 'Внешность', personality: 'Характер', backstory: 'Предыстория', parents: 'Родители', partners: 'Партнёры',
    children: 'Дети', siblings: 'Братья и сёстры', links: 'Связи', lifeEvents: 'События жизни, по порядку', year: 'год',
    inPlace: 'в', authorNotes: 'Заметки автора', writeFaithful: 'Напишите биографию персонажа на основе приведённой выше информации.',
    writePropose: 'Напишите биографию персонажа на основе приведённой выше информации и предложите недостающее, обозначив его в квадратных скобках.',
    lifeStatuses: life('Не определён', 'Жив', 'Мёртв', 'Пропал без вести', 'Нежить', 'Бессмертен', 'Ещё не родился'),
    roles: roles('Протагонист', 'Антагонист', 'Второстепенный', 'Третьестепенный', 'Упоминание'),
    eventTypes: events('Рождение', 'Первое появление', 'Клятва', 'Связь', 'Путешествие', 'Битва', 'Предательство', 'Откровение', 'Превращение', 'Вознесение', 'Изгнание', 'Утрата', 'Смерть', 'Другое'),
    aliasKinds: aliasKinds('Истинное имя', 'Имя при рождении', 'Эпитет или титул', 'Прозвище', 'Псевдоним', 'Имя на другом языке'),
  },
  uk: {
    character: 'Персонаж', species: 'вид', gender: 'стать', pronouns: 'займенники (використовуйте їх дослівно)',
    status: 'статус', narrativeRole: 'роль в історії', alsoKnownAs: 'Також відомий як', birth: 'Народження', death: 'Смерть',
    appearance: 'Зовнішність', personality: 'Характер', backstory: 'Передісторія', parents: 'Батьки', partners: 'Партнери',
    children: 'Діти', siblings: 'Брати й сестри', links: 'Зв’язки', lifeEvents: 'Події життя, за порядком', year: 'рік',
    inPlace: 'у', authorNotes: 'Нотатки автора', writeFaithful: 'Напишіть біографію персонажа на основі наведеної вище інформації.',
    writePropose: 'Напишіть біографію персонажа на основі наведеної вище інформації та запропонуйте те, чого бракує, позначивши це у квадратних дужках.',
    lifeStatuses: life('Не визначено', 'Живий', 'Мертвий', 'Зник безвісти', 'Нежить', 'Безсмертний', 'Ще не народився'),
    roles: roles('Протагоніст', 'Антагоніст', 'Другорядний', 'Третьорядний', 'Згадка'),
    eventTypes: events('Народження', 'Перша поява', 'Клятва', 'Зв’язок', 'Подорож', 'Битва', 'Зрада', 'Одкровення', 'Перетворення', 'Вознесіння', 'Вигнання', 'Втрата', 'Смерть', 'Інше'),
    aliasKinds: aliasKinds('Справжнє ім’я', 'Ім’я при народженні', 'Епітет або титул', 'Прізвисько', 'Псевдонім', 'Ім’я іншою мовою'),
  },
  ko: {
    character: '인물', species: '종족', gender: '성별', pronouns: '대명사(그대로 사용)',
    status: '상태', narrativeRole: '이야기에서의 역할', alsoKnownAs: '다른 이름', birth: '출생', death: '사망',
    appearance: '외모', personality: '성격', backstory: '배경', parents: '부모', partners: '파트너',
    children: '자녀', siblings: '형제자매', links: '관계', lifeEvents: '생애 사건, 순서대로', year: '연도',
    inPlace: '장소', authorNotes: '작가 메모', writeFaithful: '위 정보를 바탕으로 인물의 전기를 작성하십시오.',
    writePropose: '위 정보를 바탕으로 인물의 전기를 작성하고, 빠진 내용을 대괄호로 표시하여 제안하십시오.',
    lifeStatuses: life('미정', '생존', '사망', '실종', '언데드', '불멸', '아직 태어나지 않음'),
    roles: roles('주인공', '적대자', '조연', '단역', '언급'),
    eventTypes: events('출생', '첫 등장', '맹세', '유대', '여정', '전투', '배신', '계시', '변모', '승천', '유배', '상실', '죽음', '기타'),
    aliasKinds: aliasKinds('진명', '출생명', '별칭 또는 칭호', '애칭', '가명', '다른 언어의 이름'),
  },
};

export const PROSE_REVIEW_CONTEXT_COPY: Record<PromptLanguage, ProseReviewContextCopy> = {
  es: { scene: 'ESCENA', declaredBeats: 'LO QUE DIJISTE QUE TENÍA QUE PASAR', sceneText: 'EL TEXTO DE LA ESCENA', ask: (n) => `Dime, en ${n} línea(s) y en ese mismo orden, cuáles aparecen.`, threadKinds: { rule: 'regla', conflict: 'conflicto', arc: 'arco' }, beatMarks: marks('Se cumple', 'Se dobla', 'Se rompe', 'Se establece', 'Sube', 'Gira', 'Baja', 'Se cierra', 'Avanza') },
  en: { scene: 'SCENE', declaredBeats: 'WHAT YOU SAID HAD TO HAPPEN', sceneText: 'THE SCENE TEXT', ask: (n) => `In ${n} line(s), in the same order, tell me which ones appear.`, threadKinds: { rule: 'rule', conflict: 'conflict', arc: 'arc' }, beatMarks: marks('Holds', 'Bends', 'Breaks', 'Is established', 'Rises', 'Turns', 'Eases', 'Closes', 'Advances') },
  fr: { scene: 'SCÈNE', declaredBeats: 'CE QUI DEVAIT SE PRODUIRE SELON VOUS', sceneText: 'LE TEXTE DE LA SCÈNE', ask: (n) => `Indiquez-moi, en ${n} ligne(s) et dans le même ordre, lesquels apparaissent.`, threadKinds: { rule: 'règle', conflict: 'conflit', arc: 'arc' }, beatMarks: marks('Est respectée', 'Se plie', 'Se brise', 'Est établie', 'Monte', 'Bascule', 'Retombe', 'Se clôt', 'Avance') },
  de: { scene: 'SZENE', declaredBeats: 'WAS LAUT IHNEN GESCHEHEN MUSSTE', sceneText: 'DER SZENENTEXT', ask: (n) => `Nenne mir in ${n} Zeile(n) und in derselben Reihenfolge, welche davon vorkommen.`, threadKinds: { rule: 'Regel', conflict: 'Konflikt', arc: 'Bogen' }, beatMarks: marks('Wird eingehalten', 'Wird gebeugt', 'Bricht', 'Wird etabliert', 'Steigt', 'Wendet sich', 'Flaut ab', 'Schließt', 'Schreitet voran') },
  pt: { scene: 'CENA', declaredBeats: 'O QUE DISSE QUE TINHA DE ACONTECER', sceneText: 'O TEXTO DA CENA', ask: (n) => `Diz-me, em ${n} linha(s) e pela mesma ordem, quais aparecem.`, threadKinds: { rule: 'regra', conflict: 'conflito', arc: 'arco' }, beatMarks: marks('Cumpre-se', 'Dobra-se', 'Quebra-se', 'Estabelece-se', 'Sobe', 'Vira', 'Desce', 'Fecha-se', 'Avança') },
  'pt-BR': { scene: 'CENA', declaredBeats: 'O QUE VOCÊ DISSE QUE TINHA DE ACONTECER', sceneText: 'O TEXTO DA CENA', ask: (n) => `Diga, em ${n} linha(s) e na mesma ordem, quais aparecem.`, threadKinds: { rule: 'regra', conflict: 'conflito', arc: 'arco' }, beatMarks: marks('É cumprida', 'É flexibilizada', 'É quebrada', 'É estabelecida', 'Sobe', 'Vira', 'Diminui', 'É encerrado', 'Avança') },
  it: { scene: 'SCENA', declaredBeats: 'CIÒ CHE HAI DETTO DOVEVA ACCADERE', sceneText: 'IL TESTO DELLA SCENA', ask: (n) => `Dimmi, in ${n} riga/righe e nello stesso ordine, quali compaiono.`, threadKinds: { rule: 'regola', conflict: 'conflitto', arc: 'arco' }, beatMarks: marks('Viene rispettata', 'Si piega', 'Si infrange', 'Viene stabilita', 'Sale', 'Svolta', 'Scende', 'Si chiude', 'Avanza') },
  tr: { scene: 'SAHNE', declaredBeats: 'OLMASI GEREKTİĞİNİ SÖYLEDİĞİN ŞEYLER', sceneText: 'SAHNE METNİ', ask: (n) => `Hangilerinin yer aldığını aynı sırayla ${n} satırda söyle.`, threadKinds: { rule: 'kural', conflict: 'çatışma', arc: 'yay' }, beatMarks: marks('Uygulanır', 'Esnetilir', 'Bozulur', 'Kurulur', 'Yükselir', 'Döner', 'Azalır', 'Kapanır', 'İlerler') },
  'zh-Hans': { scene: '场景', declaredBeats: '你说过必须发生的内容', sceneText: '场景文本', ask: (n) => `请用 ${n} 行、按相同顺序告诉我哪些出现了。`, threadKinds: { rule: '规则', conflict: '冲突', arc: '弧线' }, beatMarks: marks('保持', '弯折', '打破', '确立', '上升', '转折', '缓和', '收束', '推进') },
  'zh-Hant': { scene: '場景', declaredBeats: '你說過必須發生的內容', sceneText: '場景文本', ask: (n) => `請用 ${n} 行、按相同順序告訴我哪些出現了。`, threadKinds: { rule: '規則', conflict: '衝突', arc: '弧線' }, beatMarks: marks('保持', '彎折', '打破', '確立', '上升', '轉折', '緩和', '收束', '推進') },
  vi: { scene: 'CẢNH', declaredBeats: 'NHỮNG GÌ BẠN NÓI PHẢI XẢY RA', sceneText: 'VĂN BẢN CỦA CẢNH', ask: (n) => `Hãy cho tôi biết, trong ${n} dòng và theo đúng thứ tự đó, những sự kiện nào xuất hiện.`, threadKinds: { rule: 'quy tắc', conflict: 'xung đột', arc: 'mạch truyện' }, beatMarks: marks('Giữ vững', 'Bẻ cong', 'Phá vỡ', 'Được thiết lập', 'Tăng cao', 'Chuyển hướng', 'Giảm nhẹ', 'Khép lại', 'Tiến triển') },
  ja: { scene: 'シーン', declaredBeats: 'あなたが起こるべきだと述べたこと', sceneText: 'シーンのテキスト', ask: (n) => `${n} 行で、同じ順序で、どれが現れるかを教えてください。`, threadKinds: { rule: 'ルール', conflict: '対立', arc: 'アーク' }, beatMarks: marks('保持される', '曲がる', '破られる', '確立される', '高まる', '転換する', '和らぐ', '閉じる', '進む') },
  ru: { scene: 'СЦЕНА', declaredBeats: 'ЧТО, ПО ВАШИМ СЛОВАМ, ДОЛЖНО БЫЛО ПРОИЗОЙТИ', sceneText: 'ТЕКСТ СЦЕНЫ', ask: (n) => `Скажите, в ${n} строке(ах) и в том же порядке, какие из них появляются.`, threadKinds: { rule: 'правило', conflict: 'конфликт', arc: 'арка' }, beatMarks: marks('Соблюдается', 'Гнётся', 'Нарушается', 'Устанавливается', 'Нарастает', 'Поворачивает', 'Ослабевает', 'Закрывается', 'Продвигается') },
  uk: { scene: 'СЦЕНА', declaredBeats: 'ТЕ, ЩО, ЗА ВАШИМИ СЛОВАМИ, МАЛО СТАТИСЯ', sceneText: 'ТЕКСТ СЦЕНИ', ask: (n) => `Скажіть, у ${n} рядку(ах) і в тому самому порядку, які з них з’являються.`, threadKinds: { rule: 'правило', conflict: 'конфлікт', arc: 'арка' }, beatMarks: marks('Дотримується', 'Згинається', 'Порушується', 'Встановлюється', 'Зростає', 'Повертає', 'Слабшає', 'Закривається', 'Просувається') },
  ko: { scene: '장면', declaredBeats: '당신이 일어나야 한다고 말한 것', sceneText: '장면 텍스트', ask: (n) => `${n}줄로, 같은 순서로, 어떤 것들이 나타나는지 알려주십시오.`, threadKinds: { rule: '규칙', conflict: '갈등', arc: '아크' }, beatMarks: marks('유지됨', '휘어짐', '깨짐', '확립됨', '상승함', '전환됨', '완화됨', '닫힘', '진전됨') },
};

export function characterBiographyContextCopy(language: PromptLanguage = 'es'): CharacterBiographyContextCopy {
  return CHARACTER_BIOGRAPHY_CONTEXT_COPY[language] ?? CHARACTER_BIOGRAPHY_CONTEXT_COPY.es;
}

export function proseReviewContextCopy(language: PromptLanguage = 'es'): ProseReviewContextCopy {
  return PROSE_REVIEW_CONTEXT_COPY[language] ?? PROSE_REVIEW_CONTEXT_COPY.es;
}
