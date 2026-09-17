// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * Presentation rules shared by both Connector surfaces:
 *
 * - the Chrome extension popup; and
 * - the trusted Connector built into Nodus Browser.
 *
 * Keep this module free of Chrome, Electron and DOM APIs. A change here must be
 * reflected by both adapters, which is enforced by test-browser-connector.mjs.
 */
export const ITEM_TYPES = [
  ['journal-article', 'Journal article'], ['book', 'Book'], ['book-chapter', 'Book chapter'], ['conference-paper', 'Conference paper'],
  ['thesis', 'Thesis'], ['report', 'Report'], ['manuscript', 'Manuscript'], ['preprint', 'Preprint'], ['dataset', 'Dataset'],
  ['presentation', 'Presentation'], ['newspaper-article', 'Newspaper article'], ['magazine-article', 'Magazine article'],
  ['encyclopedia-article', 'Encyclopedia article'], ['dictionary-entry', 'Dictionary entry'], ['interview', 'Interview'],
  ['letter', 'Letter'], ['email', 'Email'], ['instant-message', 'Instant message'], ['case', 'Case'], ['hearing', 'Hearing'], ['bill', 'Bill'], ['statute', 'Statute'],
  ['patent', 'Patent'], ['artwork', 'Artwork'], ['map', 'Map'], ['film', 'Film'], ['audio-recording', 'Audio recording'],
  ['video-recording', 'Video recording'], ['radio-broadcast', 'Radio broadcast'], ['tv-broadcast', 'TV broadcast'],
  ['podcast', 'Podcast'], ['blog-post', 'Blog post'], ['forum-post', 'Forum post'], ['computer-program', 'Computer program'],
  ['webpage', 'Web page'], ['document', 'Document'], ['standard', 'Standard'], ['other', 'Other'],
];

/**
 * Document-type names in every interface language Nodus ships, written in the
 * product's shared vocabulary. The Chrome popup and the Nodus Browser review
 * dialog both render them, so this module stays free of Chrome APIs and of any
 * message catalog. A language without an entry falls back to the English label
 * above, which is also what a page that declares no type gets.
 */
const ITEM_TYPE_LABELS = {
  es: {
    'journal-article': 'Artículo académico', book: 'Libro', 'book-chapter': 'Capítulo de libro',
    'conference-paper': 'Ponencia', thesis: 'Tesis', report: 'Informe',
    manuscript: 'Manuscrito', preprint: 'Preprint', dataset: 'Conjunto de datos',
    presentation: 'Presentación', 'newspaper-article': 'Artículo de periódico', 'magazine-article': 'Artículo de revista',
    'encyclopedia-article': 'Artículo de enciclopedia', 'dictionary-entry': 'Entrada de diccionario', interview: 'Entrevista',
    letter: 'Carta', email: 'Correo electrónico', 'instant-message': 'Mensaje instantáneo',
    case: 'Caso', hearing: 'Audiencia', bill: 'Proyecto de ley',
    statute: 'Estatuto', patent: 'Patente', artwork: 'Obra de arte',
    map: 'Mapa', film: 'Película', 'audio-recording': 'Grabación de audio',
    'video-recording': 'Grabación de vídeo', 'radio-broadcast': 'Emisión de radio', 'tv-broadcast': 'Emisión de televisión',
    podcast: 'Podcast', 'blog-post': 'Entrada de blog', 'forum-post': 'Entrada de foro',
    'computer-program': 'Programa informático', webpage: 'Página web', document: 'Documento',
    standard: 'Norma', other: 'Otro',
  },
  fr: {
    'journal-article': 'Article de revue scientifique', book: 'Livre', 'book-chapter': 'Chapitre de livre',
    'conference-paper': 'Communication de conférence', thesis: 'Thèse', report: 'Rapport',
    manuscript: 'Manuscrit', preprint: 'Prépublication', dataset: 'Jeu de données',
    presentation: 'Présentation', 'newspaper-article': 'Article de journal', 'magazine-article': 'Article de magazine',
    'encyclopedia-article': 'Article d’encyclopédie', 'dictionary-entry': 'Entrée de dictionnaire', interview: 'Entretien',
    letter: 'Lettre', email: 'Courriel', 'instant-message': 'Message instantané',
    case: 'Affaire', hearing: 'Audience', bill: 'Projet de loi',
    statute: 'Loi', patent: 'Brevet', artwork: 'Œuvre d’art',
    map: 'Carte', film: 'Film', 'audio-recording': 'Enregistrement audio',
    'video-recording': 'Enregistrement vidéo', 'radio-broadcast': 'Émission de radio', 'tv-broadcast': 'Émission de télévision',
    podcast: 'Podcast', 'blog-post': 'Billet de blog', 'forum-post': 'Message de forum',
    'computer-program': 'Logiciel', webpage: 'Page web', document: 'Document',
    standard: 'Norme', other: 'Autre',
  },
  de: {
    'journal-article': 'Wissenschaftlicher Zeitschriftenartikel', book: 'Buch', 'book-chapter': 'Buchkapitel',
    'conference-paper': 'Konferenzbeitrag', thesis: 'Dissertation', report: 'Bericht',
    manuscript: 'Manuskript', preprint: 'Preprint', dataset: 'Datensatz',
    presentation: 'Präsentation', 'newspaper-article': 'Zeitungsartikel', 'magazine-article': 'Zeitschriftenartikel',
    'encyclopedia-article': 'Enzyklopädieartikel', 'dictionary-entry': 'Wörterbucheintrag', interview: 'Interview',
    letter: 'Brief', email: 'E-Mail', 'instant-message': 'Sofortnachricht',
    case: 'Rechtsfall', hearing: 'Anhörung', bill: 'Gesetzentwurf',
    statute: 'Gesetz', patent: 'Patent', artwork: 'Kunstwerk',
    map: 'Karte', film: 'Film', 'audio-recording': 'Audioaufnahme',
    'video-recording': 'Videoaufnahme', 'radio-broadcast': 'Radiosendung', 'tv-broadcast': 'Fernsehsendung',
    podcast: 'Podcast', 'blog-post': 'Blogbeitrag', 'forum-post': 'Forenbeitrag',
    'computer-program': 'Computerprogramm', webpage: 'Webseite', document: 'Dokument',
    standard: 'Norm', other: 'Sonstiges',
  },
  pt: {
    'journal-article': 'Artigo de revista académica', book: 'Livro', 'book-chapter': 'Capítulo de livro',
    'conference-paper': 'Comunicação em conferência', thesis: 'Tese', report: 'Relatório',
    manuscript: 'Manuscrito', preprint: 'Preprint', dataset: 'Conjunto de dados',
    presentation: 'Apresentação', 'newspaper-article': 'Artigo de jornal', 'magazine-article': 'Artigo de revista',
    'encyclopedia-article': 'Artigo de enciclopédia', 'dictionary-entry': 'Entrada de dicionário', interview: 'Entrevista',
    letter: 'Carta', email: 'Correio eletrónico', 'instant-message': 'Mensagem instantânea',
    case: 'Processo judicial', hearing: 'Audiência', bill: 'Projeto de lei',
    statute: 'Estatuto', patent: 'Patente', artwork: 'Obra de arte',
    map: 'Mapa', film: 'Filme', 'audio-recording': 'Gravação de áudio',
    'video-recording': 'Gravação de vídeo', 'radio-broadcast': 'Emissão de rádio', 'tv-broadcast': 'Emissão televisiva',
    podcast: 'Podcast', 'blog-post': 'Publicação de blogue', 'forum-post': 'Publicação em fórum',
    'computer-program': 'Programa informático', webpage: 'Página web', document: 'Documento',
    standard: 'Norma', other: 'Outro',
  },
  'pt-BR': {
    'journal-article': 'Artigo de periódico acadêmico', book: 'Livro', 'book-chapter': 'Capítulo de livro',
    'conference-paper': 'Trabalho apresentado em conferência', thesis: 'Tese', report: 'Relatório',
    manuscript: 'Manuscrito', preprint: 'Preprint', dataset: 'Conjunto de dados',
    presentation: 'Apresentação', 'newspaper-article': 'Artigo de jornal', 'magazine-article': 'Artigo de revista',
    'encyclopedia-article': 'Artigo de enciclopédia', 'dictionary-entry': 'Verbete de dicionário', interview: 'Entrevista',
    letter: 'Carta', email: 'E-mail', 'instant-message': 'Mensagem instantânea',
    case: 'Caso jurídico', hearing: 'Audiência', bill: 'Projeto de lei',
    statute: 'Estatuto', patent: 'Patente', artwork: 'Obra de arte',
    map: 'Mapa', film: 'Filme', 'audio-recording': 'Gravação de áudio',
    'video-recording': 'Gravação de vídeo', 'radio-broadcast': 'Transmissão de rádio', 'tv-broadcast': 'Transmissão de TV',
    podcast: 'Podcast', 'blog-post': 'Post de blog', 'forum-post': 'Post de fórum',
    'computer-program': 'Programa de computador', webpage: 'Página web', document: 'Documento',
    standard: 'Norma', other: 'Outro',
  },
  it: {
    'journal-article': 'Articolo di rivista accademica', book: 'Prenota', 'book-chapter': 'Capitolo di libro',
    'conference-paper': 'Contributo a convegno', thesis: 'Tesi', report: 'Rapporto',
    manuscript: 'Manoscritto', preprint: 'Preprint', dataset: 'Set di dati',
    presentation: 'Presentazione', 'newspaper-article': 'Articolo di giornale', 'magazine-article': 'Articolo di rivista',
    'encyclopedia-article': 'Voce di enciclopedia', 'dictionary-entry': 'Voce di dizionario', interview: 'Intervista',
    letter: 'Lettera', email: 'E-mail', 'instant-message': 'Messaggio istantaneo',
    case: 'Caso giuridico', hearing: 'Udienza', bill: 'Disegno di legge',
    statute: 'Legge', patent: 'Brevetto', artwork: 'Opera d’arte',
    map: 'Mappa', film: 'Film', 'audio-recording': 'Registrazione audio',
    'video-recording': 'Registrazione video', 'radio-broadcast': 'Trasmissione radiofonica', 'tv-broadcast': 'Trasmissione televisiva',
    podcast: 'Podcast', 'blog-post': 'Articolo di blog', 'forum-post': 'Messaggio di forum',
    'computer-program': 'Programma informatico', webpage: 'Pagina web', document: 'Documento',
    standard: 'Norma', other: 'Altro',
  },
  tr: {
    'journal-article': 'Akademik dergi makalesi', book: 'Kitap', 'book-chapter': 'Kitap bölümü',
    'conference-paper': 'Konferans bildirisi', thesis: 'Tez', report: 'Rapor',
    manuscript: 'El yazması', preprint: 'Ön baskı', dataset: 'Veri kümesi',
    presentation: 'Sunum', 'newspaper-article': 'Gazete makalesi', 'magazine-article': 'Dergi makalesi',
    'encyclopedia-article': 'Ansiklopedi maddesi', 'dictionary-entry': 'Sözlük maddesi', interview: 'Röportaj',
    letter: 'Mektup', email: 'E-posta', 'instant-message': 'Anlık ileti',
    case: 'Dava', hearing: 'Duruşma', bill: 'Yasa tasarısı',
    statute: 'Kanun', patent: 'Patent', artwork: 'Sanat eseri',
    map: 'Harita', film: 'Film', 'audio-recording': 'Ses kaydı',
    'video-recording': 'Video kaydı', 'radio-broadcast': 'Radyo yayını', 'tv-broadcast': 'Televizyon yayını',
    podcast: 'Podcast', 'blog-post': 'Blog yazısı', 'forum-post': 'Forum gönderisi',
    'computer-program': 'Bilgisayar programı', webpage: 'Web sayfası', document: 'Belge',
    standard: 'Standart', other: 'Diğer',
  },
  'zh-CN': {
    'journal-article': '学术期刊论文', book: '图书', 'book-chapter': '书籍章节',
    'conference-paper': '会议论文', thesis: '学位论文', report: '报告',
    manuscript: '手稿', preprint: '预印本', dataset: '数据集',
    presentation: '演示文稿', 'newspaper-article': '报纸文章', 'magazine-article': '杂志文章',
    'encyclopedia-article': '百科全书条目', 'dictionary-entry': '词典条目', interview: '访谈',
    letter: '书信', email: '电子邮件', 'instant-message': '即时消息',
    case: '案例', hearing: '听证会', bill: '法案',
    statute: '法规', patent: '专利', artwork: '艺术作品',
    map: '地图', film: '影片', 'audio-recording': '录音',
    'video-recording': '录像', 'radio-broadcast': '广播节目', 'tv-broadcast': '电视节目',
    podcast: '播客', 'blog-post': '博客文章', 'forum-post': '论坛帖子',
    'computer-program': '计算机程序', webpage: '网页', document: '文档',
    standard: '标准', other: '其他',
  },
  ja: {
    'journal-article': '学術雑誌論文', book: '図書', 'book-chapter': '図書の章',
    'conference-paper': '会議論文', thesis: '学位論文', report: '報告書',
    manuscript: '手稿', preprint: 'プレプリント', dataset: 'データセット',
    presentation: 'プレゼンテーション', 'newspaper-article': '新聞記事', 'magazine-article': '雑誌記事',
    'encyclopedia-article': '百科事典の項目', 'dictionary-entry': '辞書項目', interview: 'インタビュー',
    letter: '書簡', email: 'メール', 'instant-message': 'インスタントメッセージ',
    case: '判例', hearing: '公聴会', bill: '法案',
    statute: '法令', patent: '特許', artwork: '美術作品',
    map: '地図', film: '映画', 'audio-recording': '音声録音',
    'video-recording': '映像録音', 'radio-broadcast': 'ラジオ放送', 'tv-broadcast': 'テレビ放送',
    podcast: 'ポッドキャスト', 'blog-post': 'ブログ記事', 'forum-post': 'フォーラム投稿',
    'computer-program': 'コンピュータプログラム', webpage: 'ウェブページ', document: 'ドキュメント',
    standard: '規格', other: 'その他',
  },
  ko: {
    'journal-article': '학술지 논문', book: '도서', 'book-chapter': '도서 챕터',
    'conference-paper': '학회 논문', thesis: '학위 논문', report: '보고서',
    manuscript: '원고', preprint: '프리프린트', dataset: '데이터셋',
    presentation: '프레젠테이션', 'newspaper-article': '신문 기사', 'magazine-article': '잡지 기사',
    'encyclopedia-article': '백과사전 항목', 'dictionary-entry': '사전 항목', interview: '인터뷰',
    letter: '서한', email: '이메일', 'instant-message': '인스턴트 메시지',
    case: '판례', hearing: '청문회', bill: '법안',
    statute: '법령', patent: '특허', artwork: '미술 작품',
    map: '지도', film: '영화', 'audio-recording': '오디오 녹음',
    'video-recording': '비디오 녹화', 'radio-broadcast': '라디오 방송', 'tv-broadcast': 'TV 방송',
    podcast: '팟캐스트', 'blog-post': '블로그 글', 'forum-post': '포럼 게시물',
    'computer-program': '컴퓨터 프로그램', webpage: '웹페이지', document: '문서',
    standard: '표준', other: '기타',
  },
  ru: {
    'journal-article': 'Научная статья в журнале', book: 'Книга', 'book-chapter': 'Глава книги',
    'conference-paper': 'Доклад на конференции', thesis: 'Диссертация', report: 'Отчёт',
    manuscript: 'Рукопись', preprint: 'Препринт', dataset: 'Набор данных',
    presentation: 'Презентация', 'newspaper-article': 'Газетная статья', 'magazine-article': 'Журнальная статья',
    'encyclopedia-article': 'Статья в энциклопедии', 'dictionary-entry': 'Словарная статья', interview: 'Интервью',
    letter: 'Письмо', email: 'Электронное письмо', 'instant-message': 'Мгновенное сообщение',
    case: 'Судебное дело', hearing: 'Судебное заседание', bill: 'Законопроект',
    statute: 'Закон', patent: 'Патент', artwork: 'Произведение искусства',
    map: 'Карта', film: 'Фильм', 'audio-recording': 'Аудиозапись',
    'video-recording': 'Видеозапись', 'radio-broadcast': 'Радиопередача', 'tv-broadcast': 'Телепередача',
    podcast: 'Подкаст', 'blog-post': 'Пост в блоге', 'forum-post': 'Сообщение на форуме',
    'computer-program': 'Компьютерная программа', webpage: 'Веб-страница', document: 'Документ',
    standard: 'Стандарт', other: 'Другое',
  },
  'zh-TW': {
    'journal-article': '學術期刊論文', book: '圖書', 'book-chapter': '圖書章節',
    'conference-paper': '會議論文', thesis: '學位論文', report: '報告',
    manuscript: '手稿', preprint: '預印本', dataset: '資料集',
    presentation: '簡報', 'newspaper-article': '報紙文章', 'magazine-article': '雜誌文章',
    'encyclopedia-article': '百科全書條目', 'dictionary-entry': '詞典條目', interview: '訪談',
    letter: '書信', email: '電子郵件', 'instant-message': '即時訊息',
    case: '案例', hearing: '聽證會', bill: '法案',
    statute: '法規', patent: '專利', artwork: '藝術作品',
    map: '地圖', film: '影片', 'audio-recording': '錄音',
    'video-recording': '錄影', 'radio-broadcast': '廣播節目', 'tv-broadcast': '電視節目',
    podcast: '播客', 'blog-post': '部落格文章', 'forum-post': '論壇貼文',
    'computer-program': '電腦程式', webpage: '網頁', document: '文件',
    standard: '標準', other: '其他',
  }
};

export function byline(metadata) {
  const names = (metadata.creators || []).slice(0, 3)
    .map((creator) => creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(' '))
    .filter(Boolean);
  return [names.join(', '), metadata.year || metadata.date || '', metadata.publicationTitle || '']
    .filter(Boolean)
    .join(' · ');
}

export function typeLabel(type, locale = 'en') {
  return ITEM_TYPE_LABELS[locale]?.[type] || ITEM_TYPES.find(([id]) => id === type)?.[1] || type;
}

export function typeGlyph(type) {
  if (type === 'book') return 'B';
  if (type.includes('article')) return 'A';
  if (type === 'webpage') return 'W';
  return 'Aa';
}
