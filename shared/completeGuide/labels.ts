/**
 * Every fixed word the complete study guide prints: headings, callout labels, table
 * headers and locator abbreviations. They are produced by code from provenance data,
 * never written by the model, so a block is labelled "elaborado por IA" because its
 * data says so, not because the model remembered to say it.
 */
import type { PromptLanguage } from '../types';

export interface CompleteGuideLabels {
  guideTitle: string;
  howToUse: string;
  howToUseBody: string;
  syllabusMap: string;
  whatToKnow: string;
  definition: string;
  formula: string;
  rule: string;
  procedure: string;
  example: string;
  aiExample: string;
  aiAnalogy: string;
  mistake: string;
  aiMistake: string;
  memorize: string;
  selfCheck: string;
  answer: string;
  summaryTable: string;
  webNote: string;
  aiNote: string;
  readMore: string;
  chapterSources: string;
  additionalDetails: string;
  selfCheckAnswers: string;
  glossary: string;
  formulaSheet: string;
  timeline: string;
  conflicts: string;
  reviewSheet: string;
  keyPoints: string;
  coverage: string;
  coverageIntro: string;
  sourceIndex: string;
  webSources: string;
  term: string;
  meaning: string;
  source: string;
  variables: string;
  conditions: string;
  date: string;
  event: string;
  title: string;
  location: string;
  read: string;
  itemsUsed: string;
  notes: string;
  pagesWithoutText: string;
  unreadParts: string;
  duplicates: string;
  unitNotCovered: string;
  page: string;
  pages: string;
  slide: string;
  minute: string;
  reconstructedFormula: string;
}

type Pack = CompleteGuideLabels;

const es: Pack = {
  guideTitle: 'Guía de estudio', howToUse: 'Cómo usar esta guía',
  howToUseBody: 'Cada capítulo corresponde a una unidad de tus materiales. Los recuadros marcados como «elaborado por IA» no proceden de tus materiales: sirven para entender, no como fuente. Todo lo demás cita el material y la página, diapositiva o minuto donde puedes ampliarlo. Al final tienes glosario, formulario y la ficha de repaso.',
  syllabusMap: 'Mapa del temario', whatToKnow: 'Qué debes saber', definition: 'Definición', formula: 'Fórmula', rule: 'Regla', procedure: 'Procedimiento',
  example: 'Ejemplo de los materiales', aiExample: 'Ejemplo elaborado por IA', aiAnalogy: 'Analogía elaborada por IA', mistake: 'Error frecuente', aiMistake: 'Error frecuente (sugerido por IA)',
  memorize: 'Para memorizar', selfCheck: 'Autoevaluación', answer: 'Respuesta', summaryTable: 'Tabla resumen', webNote: 'Fuente web: no procede de tus materiales.',
  aiNote: 'Elaborado por IA: no procede de tus materiales.', readMore: 'Para ampliar', chapterSources: 'Fuentes de este capítulo', additionalDetails: 'Detalles adicionales',
  selfCheckAnswers: 'Respuestas de autoevaluación', glossary: 'Glosario', formulaSheet: 'Formulario', timeline: 'Cronología', conflicts: 'Discrepancias entre fuentes',
  reviewSheet: 'Ficha de repaso', keyPoints: 'Puntos clave', coverage: 'Cobertura y limitaciones',
  coverageIntro: 'Lo que se leyó de cada fuente seleccionada. «Leído» se refiere al texto disponible en Nodus, no a garantizar que el archivo original no contenga más.',
  sourceIndex: 'Índice de fuentes', webSources: 'Fuentes web', term: 'Término', meaning: 'Significado', source: 'Fuente', variables: 'Variables', conditions: 'Condiciones',
  date: 'Fecha', event: 'Acontecimiento', title: 'Título', location: 'Ubicación', read: 'Leído', itemsUsed: 'Elementos usados', notes: 'Observaciones',
  pagesWithoutText: 'Páginas sin texto', unreadParts: 'Partes no procesadas', duplicates: 'Pasajes duplicados', unitNotCovered: 'Sin contenido legible en las fuentes seleccionadas.',
  page: 'p.', pages: 'pp.', slide: 'diap.', minute: 'min', reconstructedFormula: 'Fórmula reconstruida a partir de un texto extraído dañado: compruébala en el original.',
};

const en: Pack = {
  guideTitle: 'Study guide', howToUse: 'How to use this guide',
  howToUseBody: 'Each chapter corresponds to a unit of your materials. Boxes marked "written by AI" do not come from your materials: they help you understand and are not a source. Everything else cites the material and the page, slide or minute where you can read more. Glossary, formula sheet and review sheet are at the end.',
  syllabusMap: 'Syllabus map', whatToKnow: 'What you need to know', definition: 'Definition', formula: 'Formula', rule: 'Rule', procedure: 'Procedure',
  example: 'Example from your materials', aiExample: 'Example written by AI', aiAnalogy: 'Analogy written by AI', mistake: 'Common mistake', aiMistake: 'Common mistake (suggested by AI)',
  memorize: 'To memorize', selfCheck: 'Self-check', answer: 'Answer', summaryTable: 'Summary table', webNote: 'Web source: not from your materials.',
  aiNote: 'Written by AI: not from your materials.', readMore: 'Read more', chapterSources: 'Sources for this chapter', additionalDetails: 'Additional details',
  selfCheckAnswers: 'Self-check answers', glossary: 'Glossary', formulaSheet: 'Formula sheet', timeline: 'Timeline', conflicts: 'Discrepancies between sources',
  reviewSheet: 'Review sheet', keyPoints: 'Key points', coverage: 'Coverage and limitations',
  coverageIntro: 'What was read from each selected source. "Read" refers to the text available in Nodus; it does not guarantee that the original file contains nothing more.',
  sourceIndex: 'Source index', webSources: 'Web sources', term: 'Term', meaning: 'Meaning', source: 'Source', variables: 'Variables', conditions: 'Conditions',
  date: 'Date', event: 'Event', title: 'Title', location: 'Location', read: 'Read', itemsUsed: 'Items used', notes: 'Notes',
  pagesWithoutText: 'Pages without text', unreadParts: 'Unprocessed parts', duplicates: 'Duplicate passages', unitNotCovered: 'No readable content in the selected sources.',
  page: 'p.', pages: 'pp.', slide: 'slide', minute: 'min', reconstructedFormula: 'Formula reconstructed from damaged extracted text: check it in the original.',
};

const fr: Pack = {
  guideTitle: 'Guide d’étude', howToUse: 'Comment utiliser ce guide',
  howToUseBody: 'Chaque chapitre correspond à une unité de vos documents. Les encadrés marqués « rédigé par l’IA » ne proviennent pas de vos documents : ils aident à comprendre et ne sont pas une source. Tout le reste cite le document et la page, la diapositive ou la minute où approfondir. Le glossaire, le formulaire et la fiche de révision se trouvent à la fin.',
  syllabusMap: 'Carte du programme', whatToKnow: 'Ce qu’il faut savoir', definition: 'Définition', formula: 'Formule', rule: 'Règle', procedure: 'Méthode',
  example: 'Exemple tiré de vos documents', aiExample: 'Exemple rédigé par l’IA', aiAnalogy: 'Analogie rédigée par l’IA', mistake: 'Erreur fréquente', aiMistake: 'Erreur fréquente (suggérée par l’IA)',
  memorize: 'À retenir', selfCheck: 'Auto-évaluation', answer: 'Réponse', summaryTable: 'Tableau récapitulatif', webNote: 'Source web : ne provient pas de vos documents.',
  aiNote: 'Rédigé par l’IA : ne provient pas de vos documents.', readMore: 'Pour approfondir', chapterSources: 'Sources de ce chapitre', additionalDetails: 'Détails supplémentaires',
  selfCheckAnswers: 'Réponses de l’auto-évaluation', glossary: 'Glossaire', formulaSheet: 'Formulaire', timeline: 'Chronologie', conflicts: 'Divergences entre sources',
  reviewSheet: 'Fiche de révision', keyPoints: 'Points clés', coverage: 'Couverture et limites',
  coverageIntro: 'Ce qui a été lu dans chaque source sélectionnée. « Lu » renvoie au texte disponible dans Nodus, sans garantir que le fichier original ne contient rien de plus.',
  sourceIndex: 'Index des sources', webSources: 'Sources web', term: 'Terme', meaning: 'Signification', source: 'Source', variables: 'Variables', conditions: 'Conditions',
  date: 'Date', event: 'Événement', title: 'Titre', location: 'Emplacement', read: 'Lu', itemsUsed: 'Éléments utilisés', notes: 'Remarques',
  pagesWithoutText: 'Pages sans texte', unreadParts: 'Parties non traitées', duplicates: 'Passages en double', unitNotCovered: 'Aucun contenu lisible dans les sources sélectionnées.',
  page: 'p.', pages: 'pp.', slide: 'diapo', minute: 'min', reconstructedFormula: 'Formule reconstruite à partir d’un texte extrait endommagé : vérifiez-la dans l’original.',
};

const de: Pack = {
  guideTitle: 'Lernleitfaden', howToUse: 'So nutzt du diesen Leitfaden',
  howToUseBody: 'Jedes Kapitel entspricht einer Einheit deiner Materialien. Kästen mit „von KI verfasst“ stammen nicht aus deinen Materialien: Sie helfen beim Verstehen und sind keine Quelle. Alles andere nennt Material und Seite, Folie oder Minute zum Nachlesen. Glossar, Formelsammlung und Wiederholungsblatt stehen am Ende.',
  syllabusMap: 'Stoffübersicht', whatToKnow: 'Das solltest du wissen', definition: 'Definition', formula: 'Formel', rule: 'Regel', procedure: 'Vorgehen',
  example: 'Beispiel aus deinen Materialien', aiExample: 'Von KI verfasstes Beispiel', aiAnalogy: 'Von KI verfasste Analogie', mistake: 'Häufiger Fehler', aiMistake: 'Häufiger Fehler (von KI vorgeschlagen)',
  memorize: 'Zum Einprägen', selfCheck: 'Selbsttest', answer: 'Antwort', summaryTable: 'Übersichtstabelle', webNote: 'Webquelle: stammt nicht aus deinen Materialien.',
  aiNote: 'Von KI verfasst: stammt nicht aus deinen Materialien.', readMore: 'Zum Nachlesen', chapterSources: 'Quellen dieses Kapitels', additionalDetails: 'Weitere Details',
  selfCheckAnswers: 'Lösungen zum Selbsttest', glossary: 'Glossar', formulaSheet: 'Formelsammlung', timeline: 'Zeitleiste', conflicts: 'Abweichungen zwischen Quellen',
  reviewSheet: 'Wiederholungsblatt', keyPoints: 'Kernpunkte', coverage: 'Abdeckung und Grenzen',
  coverageIntro: 'Was aus jeder gewählten Quelle gelesen wurde. „Gelesen“ bezieht sich auf den in Nodus verfügbaren Text und garantiert nicht, dass die Originaldatei nicht mehr enthält.',
  sourceIndex: 'Quellenverzeichnis', webSources: 'Webquellen', term: 'Begriff', meaning: 'Bedeutung', source: 'Quelle', variables: 'Variablen', conditions: 'Bedingungen',
  date: 'Datum', event: 'Ereignis', title: 'Titel', location: 'Fundstelle', read: 'Gelesen', itemsUsed: 'Verwendete Elemente', notes: 'Hinweise',
  pagesWithoutText: 'Seiten ohne Text', unreadParts: 'Nicht verarbeitete Teile', duplicates: 'Doppelte Passagen', unitNotCovered: 'Kein lesbarer Inhalt in den gewählten Quellen.',
  page: 'S.', pages: 'S.', slide: 'Folie', minute: 'Min.', reconstructedFormula: 'Aus beschädigtem extrahiertem Text rekonstruierte Formel: im Original prüfen.',
};

const pt: Pack = {
  guideTitle: 'Guia de estudo', howToUse: 'Como usar este guia',
  howToUseBody: 'Cada capítulo corresponde a uma unidade dos teus materiais. As caixas marcadas como «elaborado por IA» não vêm dos teus materiais: ajudam a compreender e não são fonte. Todo o resto cita o material e a página, diapositivo ou minuto onde podes aprofundar. No fim tens glossário, formulário e a ficha de revisão.',
  syllabusMap: 'Mapa do programa', whatToKnow: 'O que deves saber', definition: 'Definição', formula: 'Fórmula', rule: 'Regra', procedure: 'Procedimento',
  example: 'Exemplo dos materiais', aiExample: 'Exemplo elaborado por IA', aiAnalogy: 'Analogia elaborada por IA', mistake: 'Erro frequente', aiMistake: 'Erro frequente (sugerido por IA)',
  memorize: 'Para memorizar', selfCheck: 'Autoavaliação', answer: 'Resposta', summaryTable: 'Tabela-resumo', webNote: 'Fonte web: não vem dos teus materiais.',
  aiNote: 'Elaborado por IA: não vem dos teus materiais.', readMore: 'Para aprofundar', chapterSources: 'Fontes deste capítulo', additionalDetails: 'Detalhes adicionais',
  selfCheckAnswers: 'Respostas da autoavaliação', glossary: 'Glossário', formulaSheet: 'Formulário', timeline: 'Cronologia', conflicts: 'Discrepâncias entre fontes',
  reviewSheet: 'Ficha de revisão', keyPoints: 'Pontos-chave', coverage: 'Cobertura e limitações',
  coverageIntro: 'O que foi lido de cada fonte selecionada. «Lido» refere-se ao texto disponível no Nodus e não garante que o ficheiro original não contenha mais.',
  sourceIndex: 'Índice de fontes', webSources: 'Fontes web', term: 'Termo', meaning: 'Significado', source: 'Fonte', variables: 'Variáveis', conditions: 'Condições',
  date: 'Data', event: 'Acontecimento', title: 'Título', location: 'Localização', read: 'Lido', itemsUsed: 'Elementos usados', notes: 'Observações',
  pagesWithoutText: 'Páginas sem texto', unreadParts: 'Partes não processadas', duplicates: 'Passagens duplicadas', unitNotCovered: 'Sem conteúdo legível nas fontes selecionadas.',
  page: 'p.', pages: 'pp.', slide: 'diap.', minute: 'min', reconstructedFormula: 'Fórmula reconstruída a partir de texto extraído danificado: confirma-a no original.',
};

const ptBR: Pack = {
  ...pt,
  howToUseBody: 'Cada capítulo corresponde a uma unidade dos seus materiais. As caixas marcadas como "elaborado por IA" não vêm dos seus materiais: ajudam a entender e não são fonte. Todo o resto cita o material e a página, slide ou minuto onde você pode se aprofundar. No fim há glossário, formulário e a ficha de revisão.',
  whatToKnow: 'O que você precisa saber', webNote: 'Fonte web: não vem dos seus materiais.', aiNote: 'Elaborado por IA: não vem dos seus materiais.', example: 'Exemplo dos seus materiais',
  coverageIntro: 'O que foi lido de cada fonte selecionada. "Lido" refere-se ao texto disponível no Nodus e não garante que o arquivo original não contenha mais.',
  location: 'Localização', slide: 'slide', reconstructedFormula: 'Fórmula reconstruída a partir de texto extraído danificado: confira no original.',
};

const it: Pack = {
  guideTitle: 'Guida allo studio', howToUse: 'Come usare questa guida',
  howToUseBody: 'Ogni capitolo corrisponde a un’unità dei tuoi materiali. I riquadri segnati «scritto dall’IA» non provengono dai tuoi materiali: aiutano a capire e non sono una fonte. Tutto il resto cita il materiale e la pagina, la diapositiva o il minuto dove approfondire. In fondo trovi glossario, formulario e la scheda di ripasso.',
  syllabusMap: 'Mappa del programma', whatToKnow: 'Cosa devi sapere', definition: 'Definizione', formula: 'Formula', rule: 'Regola', procedure: 'Procedimento',
  example: 'Esempio dai tuoi materiali', aiExample: 'Esempio scritto dall’IA', aiAnalogy: 'Analogia scritta dall’IA', mistake: 'Errore frequente', aiMistake: 'Errore frequente (suggerito dall’IA)',
  memorize: 'Da memorizzare', selfCheck: 'Autoverifica', answer: 'Risposta', summaryTable: 'Tabella riassuntiva', webNote: 'Fonte web: non proviene dai tuoi materiali.',
  aiNote: 'Scritto dall’IA: non proviene dai tuoi materiali.', readMore: 'Per approfondire', chapterSources: 'Fonti di questo capitolo', additionalDetails: 'Dettagli aggiuntivi',
  selfCheckAnswers: 'Soluzioni dell’autoverifica', glossary: 'Glossario', formulaSheet: 'Formulario', timeline: 'Cronologia', conflicts: 'Discrepanze tra fonti',
  reviewSheet: 'Scheda di ripasso', keyPoints: 'Punti chiave', coverage: 'Copertura e limiti',
  coverageIntro: 'Ciò che è stato letto di ogni fonte selezionata. «Letto» si riferisce al testo disponibile in Nodus e non garantisce che il file originale non contenga altro.',
  sourceIndex: 'Indice delle fonti', webSources: 'Fonti web', term: 'Termine', meaning: 'Significato', source: 'Fonte', variables: 'Variabili', conditions: 'Condizioni',
  date: 'Data', event: 'Evento', title: 'Titolo', location: 'Posizione', read: 'Letto', itemsUsed: 'Elementi usati', notes: 'Note',
  pagesWithoutText: 'Pagine senza testo', unreadParts: 'Parti non elaborate', duplicates: 'Passaggi duplicati', unitNotCovered: 'Nessun contenuto leggibile nelle fonti selezionate.',
  page: 'p.', pages: 'pp.', slide: 'diap.', minute: 'min', reconstructedFormula: 'Formula ricostruita da un testo estratto danneggiato: verificala nell’originale.',
};

const tr: Pack = {
  guideTitle: 'Çalışma rehberi', howToUse: 'Bu rehber nasıl kullanılır',
  howToUseBody: 'Her bölüm materyallerindeki bir üniteye karşılık gelir. "Yapay zekâ tarafından yazıldı" olarak işaretli kutular materyallerinden gelmez: anlamaya yardımcı olur, kaynak değildir. Geri kalan her şey, daha fazlasını okuyabileceğin materyali ve sayfa, slayt ya da dakikayı gösterir. Sonda sözlük, formül listesi ve tekrar kartı yer alır.',
  syllabusMap: 'Konu haritası', whatToKnow: 'Bilmen gerekenler', definition: 'Tanım', formula: 'Formül', rule: 'Kural', procedure: 'İşlem adımları',
  example: 'Materyallerinden örnek', aiExample: 'Yapay zekâ tarafından yazılan örnek', aiAnalogy: 'Yapay zekâ tarafından yazılan benzetme', mistake: 'Sık yapılan hata', aiMistake: 'Sık yapılan hata (yapay zekâ önerisi)',
  memorize: 'Ezberlenecekler', selfCheck: 'Kendini sına', answer: 'Cevap', summaryTable: 'Özet tablo', webNote: 'Web kaynağı: materyallerinden gelmez.',
  aiNote: 'Yapay zekâ tarafından yazıldı: materyallerinden gelmez.', readMore: 'Daha fazlası için', chapterSources: 'Bu bölümün kaynakları', additionalDetails: 'Ek ayrıntılar',
  selfCheckAnswers: 'Kendini sına cevapları', glossary: 'Sözlük', formulaSheet: 'Formül listesi', timeline: 'Zaman çizelgesi', conflicts: 'Kaynaklar arası farklılıklar',
  reviewSheet: 'Tekrar kartı', keyPoints: 'Temel noktalar', coverage: 'Kapsam ve sınırlılıklar',
  coverageIntro: 'Seçilen her kaynaktan okunanlar. "Okundu", Nodus’ta bulunan metni ifade eder; özgün dosyada daha fazlasının olmadığını garanti etmez.',
  sourceIndex: 'Kaynak dizini', webSources: 'Web kaynakları', term: 'Terim', meaning: 'Anlamı', source: 'Kaynak', variables: 'Değişkenler', conditions: 'Koşullar',
  date: 'Tarih', event: 'Olay', title: 'Başlık', location: 'Konum', read: 'Okundu', itemsUsed: 'Kullanılan öğeler', notes: 'Notlar',
  pagesWithoutText: 'Metinsiz sayfalar', unreadParts: 'İşlenmeyen kısımlar', duplicates: 'Yinelenen bölümler', unitNotCovered: 'Seçilen kaynaklarda okunabilir içerik yok.',
  page: 's.', pages: 'ss.', slide: 'slayt', minute: 'dk', reconstructedFormula: 'Bozuk çıkarılmış metinden yeniden oluşturulan formül: özgün belgede kontrol et.',
};

const zhHans: Pack = {
  guideTitle: '学习指南', howToUse: '如何使用本指南',
  howToUseBody: '每一章对应你资料中的一个单元。标有“AI 撰写”的方框并非来自你的资料：它们帮助理解，但不是来源。其余内容都注明了资料及可深入阅读的页码、幻灯片或时间点。书末附有术语表、公式表和复习卡。',
  syllabusMap: '课程地图', whatToKnow: '你需要掌握的内容', definition: '定义', formula: '公式', rule: '规则', procedure: '步骤',
  example: '资料中的例题', aiExample: 'AI 撰写的示例', aiAnalogy: 'AI 撰写的类比', mistake: '常见错误', aiMistake: '常见错误（AI 建议）',
  memorize: '需要记住', selfCheck: '自测', answer: '答案', summaryTable: '总结表', webNote: '网络来源：并非来自你的资料。',
  aiNote: 'AI 撰写：并非来自你的资料。', readMore: '延伸阅读', chapterSources: '本章来源', additionalDetails: '补充细节',
  selfCheckAnswers: '自测答案', glossary: '术语表', formulaSheet: '公式表', timeline: '时间线', conflicts: '来源之间的差异',
  reviewSheet: '复习卡', keyPoints: '要点', coverage: '覆盖范围与局限',
  coverageIntro: '从每个所选来源中读取的内容。“已读”指 Nodus 中可用的文本，并不保证原始文件不包含更多内容。',
  sourceIndex: '来源索引', webSources: '网络来源', term: '术语', meaning: '含义', source: '来源', variables: '变量', conditions: '条件',
  date: '日期', event: '事件', title: '标题', location: '位置', read: '已读', itemsUsed: '使用的要素', notes: '备注',
  pagesWithoutText: '无文本页', unreadParts: '未处理部分', duplicates: '重复段落', unitNotCovered: '所选来源中没有可读内容。',
  page: '第', pages: '第', slide: '幻灯片', minute: '分钟', reconstructedFormula: '此公式根据受损的提取文本重建：请对照原文核实。',
};

const zhHant: Pack = {
  ...zhHans,
  guideTitle: '學習指南', howToUse: '如何使用本指南',
  howToUseBody: '每一章對應你資料中的一個單元。標有「AI 撰寫」的方框並非來自你的資料：它們幫助理解，但不是來源。其餘內容都註明了資料及可深入閱讀的頁碼、投影片或時間點。書末附有術語表、公式表和複習卡。',
  syllabusMap: '課程地圖', whatToKnow: '你需要掌握的內容', definition: '定義', formula: '公式', rule: '規則', procedure: '步驟',
  example: '資料中的例題', aiExample: 'AI 撰寫的範例', aiAnalogy: 'AI 撰寫的類比', mistake: '常見錯誤', aiMistake: '常見錯誤（AI 建議）',
  memorize: '需要記住', selfCheck: '自我測驗', answer: '答案', summaryTable: '總結表', webNote: '網路來源：並非來自你的資料。',
  aiNote: 'AI 撰寫：並非來自你的資料。', readMore: '延伸閱讀', chapterSources: '本章來源', additionalDetails: '補充細節',
  selfCheckAnswers: '自我測驗答案', glossary: '術語表', formulaSheet: '公式表', timeline: '時間軸', conflicts: '來源之間的差異',
  reviewSheet: '複習卡', keyPoints: '重點', coverage: '涵蓋範圍與限制',
  coverageIntro: '從每個所選來源中讀取的內容。「已讀」指 Nodus 中可用的文字，並不保證原始檔案不包含更多內容。',
  sourceIndex: '來源索引', webSources: '網路來源', term: '術語', meaning: '含義', source: '來源', variables: '變數', conditions: '條件',
  date: '日期', event: '事件', title: '標題', location: '位置', read: '已讀', itemsUsed: '使用的要素', notes: '備註',
  pagesWithoutText: '無文字頁', unreadParts: '未處理部分', duplicates: '重複段落', unitNotCovered: '所選來源中沒有可讀內容。',
  slide: '投影片', minute: '分鐘', reconstructedFormula: '此公式根據受損的擷取文字重建：請對照原文核實。',
};

const vi: Pack = {
  guideTitle: 'Tài liệu ôn tập', howToUse: 'Cách sử dụng tài liệu này',
  howToUseBody: 'Mỗi chương tương ứng với một đơn vị trong tài liệu của bạn. Các khung đánh dấu "do AI soạn" không lấy từ tài liệu của bạn: chúng giúp hiểu bài và không phải là nguồn. Mọi nội dung khác đều dẫn tài liệu cùng trang, trang chiếu hoặc phút để bạn đọc thêm. Cuối tài liệu có bảng thuật ngữ, bảng công thức và phiếu ôn tập.',
  syllabusMap: 'Sơ đồ chương trình', whatToKnow: 'Những điều cần nắm', definition: 'Định nghĩa', formula: 'Công thức', rule: 'Quy tắc', procedure: 'Các bước',
  example: 'Ví dụ từ tài liệu của bạn', aiExample: 'Ví dụ do AI soạn', aiAnalogy: 'Phép so sánh do AI soạn', mistake: 'Lỗi thường gặp', aiMistake: 'Lỗi thường gặp (AI gợi ý)',
  memorize: 'Cần ghi nhớ', selfCheck: 'Tự kiểm tra', answer: 'Đáp án', summaryTable: 'Bảng tóm tắt', webNote: 'Nguồn web: không lấy từ tài liệu của bạn.',
  aiNote: 'Do AI soạn: không lấy từ tài liệu của bạn.', readMore: 'Đọc thêm', chapterSources: 'Nguồn của chương này', additionalDetails: 'Chi tiết bổ sung',
  selfCheckAnswers: 'Đáp án tự kiểm tra', glossary: 'Bảng thuật ngữ', formulaSheet: 'Bảng công thức', timeline: 'Dòng thời gian', conflicts: 'Khác biệt giữa các nguồn',
  reviewSheet: 'Phiếu ôn tập', keyPoints: 'Ý chính', coverage: 'Phạm vi và giới hạn',
  coverageIntro: 'Những gì đã được đọc từ mỗi nguồn đã chọn. "Đã đọc" là văn bản có trong Nodus; điều này không đảm bảo tệp gốc không còn nội dung khác.',
  sourceIndex: 'Danh mục nguồn', webSources: 'Nguồn web', term: 'Thuật ngữ', meaning: 'Nghĩa', source: 'Nguồn', variables: 'Biến', conditions: 'Điều kiện',
  date: 'Thời gian', event: 'Sự kiện', title: 'Tiêu đề', location: 'Vị trí', read: 'Đã đọc', itemsUsed: 'Mục đã dùng', notes: 'Ghi chú',
  pagesWithoutText: 'Trang không có văn bản', unreadParts: 'Phần chưa xử lý', duplicates: 'Đoạn trùng lặp', unitNotCovered: 'Không có nội dung đọc được trong các nguồn đã chọn.',
  page: 'tr.', pages: 'tr.', slide: 'trang chiếu', minute: 'phút', reconstructedFormula: 'Công thức được dựng lại từ văn bản trích xuất bị lỗi: hãy đối chiếu với bản gốc.',
};

const ja: Pack = {
  guideTitle: '学習ガイド', howToUse: 'このガイドの使い方',
  howToUseBody: '各章はあなたの資料の単元に対応しています。「AI作成」と表示された枠はあなたの資料に由来しません。理解を助けるためのもので、出典ではありません。それ以外の内容はすべて、詳しく読める資料とページ・スライド・時間を示しています。巻末に用語集、公式集、復習シートがあります。',
  syllabusMap: '単元マップ', whatToKnow: '押さえるべきこと', definition: '定義', formula: '公式', rule: '規則', procedure: '手順',
  example: '資料の例題', aiExample: 'AIが作成した例', aiAnalogy: 'AIが作成したたとえ', mistake: 'よくある間違い', aiMistake: 'よくある間違い（AIの提案）',
  memorize: '暗記事項', selfCheck: '確認問題', answer: '解答', summaryTable: 'まとめ表', webNote: 'ウェブ情報源：あなたの資料に由来しません。',
  aiNote: 'AI作成：あなたの資料に由来しません。', readMore: '詳しく読む', chapterSources: 'この章の出典', additionalDetails: '補足事項',
  selfCheckAnswers: '確認問題の解答', glossary: '用語集', formulaSheet: '公式集', timeline: '年表', conflicts: '出典間の相違',
  reviewSheet: '復習シート', keyPoints: '要点', coverage: '対象範囲と限界',
  coverageIntro: '選択した各出典から読み取った内容です。「読了」はNodusで利用できるテキストを指し、元のファイルにそれ以上の内容がないことを保証するものではありません。',
  sourceIndex: '出典一覧', webSources: 'ウェブ情報源', term: '用語', meaning: '意味', source: '出典', variables: '変数', conditions: '条件',
  date: '日付', event: '出来事', title: 'タイトル', location: '位置', read: '読了', itemsUsed: '使用した項目', notes: '備考',
  pagesWithoutText: 'テキストのないページ', unreadParts: '未処理の部分', duplicates: '重複した箇所', unitNotCovered: '選択した出典に読み取れる内容がありません。',
  page: 'p.', pages: 'pp.', slide: 'スライド', minute: '分', reconstructedFormula: '破損した抽出テキストから再構成した公式です。原本で確認してください。',
};

const ru: Pack = {
  guideTitle: 'Учебное пособие', howToUse: 'Как пользоваться пособием',
  howToUseBody: 'Каждая глава соответствует разделу ваших материалов. Блоки с пометкой «составлено ИИ» не взяты из ваших материалов: они помогают понять и не являются источником. Всё остальное ссылается на материал и страницу, слайд или минуту, где можно прочитать подробнее. В конце — глоссарий, сборник формул и карточка для повторения.',
  syllabusMap: 'Карта программы', whatToKnow: 'Что нужно знать', definition: 'Определение', formula: 'Формула', rule: 'Правило', procedure: 'Порядок действий',
  example: 'Пример из ваших материалов', aiExample: 'Пример, составленный ИИ', aiAnalogy: 'Аналогия, составленная ИИ', mistake: 'Частая ошибка', aiMistake: 'Частая ошибка (предложено ИИ)',
  memorize: 'Запомнить', selfCheck: 'Самопроверка', answer: 'Ответ', summaryTable: 'Сводная таблица', webNote: 'Веб-источник: не из ваших материалов.',
  aiNote: 'Составлено ИИ: не из ваших материалов.', readMore: 'Подробнее', chapterSources: 'Источники главы', additionalDetails: 'Дополнительные сведения',
  selfCheckAnswers: 'Ответы к самопроверке', glossary: 'Глоссарий', formulaSheet: 'Сборник формул', timeline: 'Хронология', conflicts: 'Расхождения между источниками',
  reviewSheet: 'Карточка для повторения', keyPoints: 'Ключевые моменты', coverage: 'Охват и ограничения',
  coverageIntro: 'Что было прочитано в каждом выбранном источнике. «Прочитано» относится к тексту, доступному в Nodus, и не гарантирует, что в исходном файле нет ничего больше.',
  sourceIndex: 'Указатель источников', webSources: 'Веб-источники', term: 'Термин', meaning: 'Значение', source: 'Источник', variables: 'Переменные', conditions: 'Условия',
  date: 'Дата', event: 'Событие', title: 'Название', location: 'Место', read: 'Прочитано', itemsUsed: 'Использовано элементов', notes: 'Примечания',
  pagesWithoutText: 'Страницы без текста', unreadParts: 'Необработанные части', duplicates: 'Повторяющиеся фрагменты', unitNotCovered: 'В выбранных источниках нет читаемого содержания.',
  page: 'с.', pages: 'с.', slide: 'слайд', minute: 'мин', reconstructedFormula: 'Формула восстановлена из повреждённого извлечённого текста: сверьте с оригиналом.',
};

const uk: Pack = {
  guideTitle: 'Навчальний посібник', howToUse: 'Як користуватися посібником',
  howToUseBody: 'Кожен розділ відповідає темі ваших матеріалів. Блоки з позначкою «складено ШІ» не взяті з ваших матеріалів: вони допомагають зрозуміти й не є джерелом. Усе інше посилається на матеріал і сторінку, слайд чи хвилину, де можна прочитати докладніше. Наприкінці — глосарій, збірник формул і картка для повторення.',
  syllabusMap: 'Карта програми', whatToKnow: 'Що потрібно знати', definition: 'Визначення', formula: 'Формула', rule: 'Правило', procedure: 'Порядок дій',
  example: 'Приклад із ваших матеріалів', aiExample: 'Приклад, складений ШІ', aiAnalogy: 'Аналогія, складена ШІ', mistake: 'Поширена помилка', aiMistake: 'Поширена помилка (запропоновано ШІ)',
  memorize: 'Запам’ятати', selfCheck: 'Самоперевірка', answer: 'Відповідь', summaryTable: 'Зведена таблиця', webNote: 'Веб-джерело: не з ваших матеріалів.',
  aiNote: 'Складено ШІ: не з ваших матеріалів.', readMore: 'Докладніше', chapterSources: 'Джерела розділу', additionalDetails: 'Додаткові відомості',
  selfCheckAnswers: 'Відповіді до самоперевірки', glossary: 'Глосарій', formulaSheet: 'Збірник формул', timeline: 'Хронологія', conflicts: 'Розбіжності між джерелами',
  reviewSheet: 'Картка для повторення', keyPoints: 'Ключові моменти', coverage: 'Охоплення та обмеження',
  coverageIntro: 'Що було прочитано в кожному вибраному джерелі. «Прочитано» стосується тексту, доступного в Nodus, і не гарантує, що у вихідному файлі немає нічого більше.',
  sourceIndex: 'Покажчик джерел', webSources: 'Веб-джерела', term: 'Термін', meaning: 'Значення', source: 'Джерело', variables: 'Змінні', conditions: 'Умови',
  date: 'Дата', event: 'Подія', title: 'Назва', location: 'Місце', read: 'Прочитано', itemsUsed: 'Використано елементів', notes: 'Примітки',
  pagesWithoutText: 'Сторінки без тексту', unreadParts: 'Необроблені частини', duplicates: 'Повторювані фрагменти', unitNotCovered: 'У вибраних джерелах немає читабельного змісту.',
  page: 'с.', pages: 'с.', slide: 'слайд', minute: 'хв', reconstructedFormula: 'Формулу відновлено з пошкодженого видобутого тексту: звірте з оригіналом.',
};

const ko: Pack = {
  guideTitle: '학습 가이드', howToUse: '이 가이드 사용법',
  howToUseBody: '각 장은 자료의 한 단원에 해당합니다. "AI 작성"으로 표시된 상자는 자료에서 나온 내용이 아니며, 이해를 돕기 위한 것으로 출처가 아닙니다. 그 밖의 모든 내용은 더 읽어 볼 수 있는 자료와 쪽, 슬라이드 또는 시간을 표시합니다. 끝부분에 용어집, 공식집, 복습 시트가 있습니다.',
  syllabusMap: '단원 지도', whatToKnow: '꼭 알아야 할 내용', definition: '정의', formula: '공식', rule: '규칙', procedure: '절차',
  example: '자료의 예제', aiExample: 'AI가 작성한 예시', aiAnalogy: 'AI가 작성한 비유', mistake: '자주 하는 실수', aiMistake: '자주 하는 실수(AI 제안)',
  memorize: '암기할 내용', selfCheck: '자기 점검', answer: '정답', summaryTable: '요약 표', webNote: '웹 출처: 자료에서 나온 내용이 아닙니다.',
  aiNote: 'AI 작성: 자료에서 나온 내용이 아닙니다.', readMore: '더 읽어 보기', chapterSources: '이 장의 출처', additionalDetails: '추가 세부 사항',
  selfCheckAnswers: '자기 점검 정답', glossary: '용어집', formulaSheet: '공식집', timeline: '연표', conflicts: '출처 간 차이',
  reviewSheet: '복습 시트', keyPoints: '핵심 요점', coverage: '범위와 한계',
  coverageIntro: '선택한 각 출처에서 읽은 내용입니다. "읽음"은 Nodus에서 사용할 수 있는 텍스트를 뜻하며, 원본 파일에 더 많은 내용이 없음을 보장하지 않습니다.',
  sourceIndex: '출처 색인', webSources: '웹 출처', term: '용어', meaning: '의미', source: '출처', variables: '변수', conditions: '조건',
  date: '날짜', event: '사건', title: '제목', location: '위치', read: '읽음', itemsUsed: '사용한 항목', notes: '비고',
  pagesWithoutText: '텍스트가 없는 쪽', unreadParts: '처리되지 않은 부분', duplicates: '중복 구절', unitNotCovered: '선택한 출처에 읽을 수 있는 내용이 없습니다.',
  page: 'p.', pages: 'pp.', slide: '슬라이드', minute: '분', reconstructedFormula: '손상된 추출 텍스트로부터 재구성한 공식입니다. 원본에서 확인하세요.',
};

export const COMPLETE_GUIDE_LABELS: Record<PromptLanguage, CompleteGuideLabels> = {
  es, en, fr, de, pt, 'pt-BR': ptBR, it, tr, 'zh-Hans': zhHans, 'zh-Hant': zhHant, vi, ja, ru, uk, ko,
};

export function completeGuideLabels(language: PromptLanguage | null | undefined): CompleteGuideLabels {
  return COMPLETE_GUIDE_LABELS[language ?? 'es'] ?? es;
}
