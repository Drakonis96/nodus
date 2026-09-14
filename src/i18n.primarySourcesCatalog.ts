/**
 * Document-catalogue and modal copy shared by the Primary Sources archive.
 * Columns: Spanish source, English, French, German, Portuguese, Italian, Turkish, Chinese.
 */
const rows = [
  ["Seleccionar icono", "Select icon", "Sélectionner une icône", "Symbol auswählen", "Selecionar ícone", "Seleziona icona", "Simge seç", "选择图标"],
  ["Usar icono sugerido", "Use suggested icon", "Utiliser l’icône suggérée", "Vorgeschlagenes Symbol verwenden", "Usar ícone sugerido", "Usa l’icona suggerita", "Önerilen simgeyi kullan", "使用建议的图标"],
  ["Elige cómo se representará el documento en el archivo.", "Choose how the document will appear in the archive.", "Choisissez comment le document apparaîtra dans les archives.", "Wählen Sie, wie das Dokument im Archiv dargestellt wird.", "Escolha como o documento será representado no arquivo.", "Scegli come rappresentare il documento nell’archivio.", "Belgenin arşivde nasıl gösterileceğini seçin.", "选择文档在档案中的呈现方式。"],
  ["Cerrar ficha", "Close record", "Fermer la fiche", "Datensatz schließen", "Fechar ficha", "Chiudi scheda", "Kaydı kapat", "关闭记录"],
  ["Identificación y catalogación", "Identification and cataloguing", "Identification et catalogage", "Identifikation und Erschließung", "Identificação e catalogação", "Identificazione e catalogazione", "Tanımlama ve kataloglama", "标识与编目"],
  ["Usa el mismo catálogo documental que el Archivo de Genealogía.", "Uses the same document catalogue as the Genealogy Archive.", "Utilise le même catalogue documentaire que les Archives de généalogie.", "Verwendet denselben Dokumentkatalog wie das Genealogiearchiv.", "Usa o mesmo catálogo documental do Arquivo de Genealogia.", "Usa lo stesso catalogo documentale dell’Archivio di genealogia.", "Şecere Arşivi ile aynı belge kataloğunu kullanır.", "使用与家谱档案相同的文档目录。"],
  ["Tipo de título", "Title type", "Type de titre", "Titelart", "Tipo de título", "Tipo di titolo", "Başlık türü", "题名类型"],
  ["Original", "Original", "Original", "Original", "Original", "Originale", "Özgün", "原件"],
  ["Atribuido", "Attributed", "Attribué", "Zugeschrieben", "Atribuído", "Attribuito", "Atfedilen", "归属"],
  ["Formal", "Formal", "Formel", "Förmlich", "Formal", "Formale", "Resmî", "正式"],
  ["Desconocido", "Unknown", "Inconnu", "Unbekannt", "Desconhecido", "Sconosciuto", "Bilinmiyor", "未知"],
  ["Extensión", "Extent", "Importance matérielle", "Umfang", "Dimensão", "Consistenza", "Kapsam", "载体形态"],
  ["Certeza de la fecha", "Date certainty", "Certitude de la date", "Datierungssicherheit", "Certeza da data", "Certezza della data", "Tarih kesinliği", "日期确定性"],
  ["Entre fechas", "Date range", "Plage de dates", "Zeitraum", "Intervalo de datas", "Intervallo di date", "Tarih aralığı", "日期范围"],
  ["Incierta", "Uncertain", "Incertaine", "Unsicher", "Incerta", "Incerta", "Belirsiz", "不确定"],
  ["Acceso, estado y preservación", "Access, status, and preservation", "Accès, état et conservation", "Zugang, Status und Erhaltung", "Acesso, estado e preservação", "Accesso, stato e conservazione", "Erişim, durum ve koruma", "访问、状态与保存"],
  ["Estado de descripción", "Description status", "État de la description", "Erschließungsstatus", "Estado da descrição", "Stato della descrizione", "Tanımlama durumu", "著录状态"],
  ["Procedencia incompleta", "Incomplete provenance", "Provenance incomplète", "Unvollständige Provenienz", "Proveniência incompleta", "Provenienza incompleta", "Eksik köken bilgisi", "来源信息不完整"],
  ["Descrita", "Described", "Décrite", "Erschlossen", "Descrita", "Descritta", "Tanımlandı", "已著录"],
  ["Lista para citar", "Ready to cite", "Prête à citer", "Zitierfähig", "Pronta para citar", "Pronta per la citazione", "Atıf için hazır", "可引用"],
  ["Estado de cita", "Citation status", "État de la citation", "Zitierstatus", "Estado da citação", "Stato della citazione", "Atıf durumu", "引用状态"],
  ["No preparada", "Not prepared", "Non préparée", "Nicht vorbereitet", "Não preparada", "Non preparata", "Hazır değil", "未准备"],
  ["Localizador general", "General locator", "Localisateur général", "Allgemeiner Fundort", "Localizador geral", "Localizzatore generale", "Genel konum", "通用定位符"],
  ["Declaración de derechos", "Rights statement", "Déclaration de droits", "Rechtehinweis", "Declaração de direitos", "Dichiarazione dei diritti", "Haklar bildirimi", "权利声明"],
  ["Condiciones de reproducción", "Reproduction conditions", "Conditions de reproduction", "Reproduktionsbedingungen", "Condições de reprodução", "Condizioni di riproduzione", "Çoğaltma koşulları", "复制条件"],
  ["Códigos separados por comas, por ejemplo: es, la", "Comma-separated codes, for example: en, la", "Codes séparés par des virgules, par exemple : fr, la", "Kommagetrennte Codes, zum Beispiel: de, la", "Códigos separados por vírgulas, por exemplo: pt, la", "Codici separati da virgole, ad esempio: it, la", "Virgülle ayrılmış kodlar, örneğin: tr, la", "以逗号分隔的代码，例如：en, la"],
  ["Escrituras", "Scripts", "Systèmes d’écriture", "Schriftsysteme", "Sistemas de escrita", "Sistemi di scrittura", "Yazı sistemleri", "文字系统"],
  ["Códigos separados por comas, por ejemplo: Latn", "Comma-separated codes, for example: Latn", "Codes séparés par des virgules, par exemple : Latn", "Kommagetrennte Codes, zum Beispiel: Latn", "Códigos separados por vírgulas, por exemplo: Latn", "Codici separati da virgole, ad esempio: Latn", "Virgülle ayrılmış kodlar, örneğin: Latn", "以逗号分隔的代码，例如：Latn"],
  ["Descripción archivística avanzada", "Advanced archival description", "Description archivistique avancée", "Erweiterte Archivbeschreibung", "Descrição arquivística avançada", "Descrizione archivistica avanzata", "Gelişmiş arşiv tanımı", "高级档案著录"],
  ["Organización original", "Original arrangement", "Classement d’origine", "Ursprüngliche Ordnung", "Organização original", "Ordinamento originale", "Özgün düzen", "原始整理"],
  ["Historia administrativa o biográfica", "Administrative or biographical history", "Histoire administrative ou biographique", "Verwaltungs- oder biografische Geschichte", "História administrativa ou biográfica", "Storia amministrativa o biografica", "İdari veya biyografik tarih", "行政或传记历史"],
  ["Historia de custodia", "Custodial history", "Historique de la conservation", "Bestandsgeschichte", "História de custódia", "Storia della custodia", "Muhafaza geçmişi", "保管历史"],
  ["Forma de ingreso", "Immediate source of acquisition", "Modalités d’entrée", "Abgebende Stelle", "Forma de ingresso", "Modalità di acquisizione", "Edinim biçimi", "直接来源"],
  ["Condiciones de acceso archivísticas", "Archival access conditions", "Conditions d’accès archivistiques", "Archivische Zugangsbedingungen", "Condições de acesso arquivístico", "Condizioni di accesso archivistiche", "Arşiv erişim koşulları", "档案访问条件"],
  ["Condiciones de reproducción archivísticas", "Archival reproduction conditions", "Conditions de reproduction archivistiques", "Archivische Reproduktionsbedingungen", "Condições de reprodução arquivística", "Condizioni di riproduzione archivistiche", "Arşiv çoğaltma koşulları", "档案复制条件"],
  ["Características físicas", "Physical characteristics", "Caractéristiques physiques", "Physische Merkmale", "Características físicas", "Caratteristiche fisiche", "Fiziksel özellikler", "物理特征"],
  ["Instrumentos de descripción", "Finding aids", "Instruments de recherche", "Findmittel", "Instrumentos de descrição", "Strumenti di ricerca", "Bulma araçları", "检索工具"],
  ["Unidades relacionadas", "Related units", "Unités de description associées", "Verwandte Einheiten", "Unidades relacionadas", "Unità collegate", "İlgili birimler", "相关单元"],
  ["URL del catálogo", "Catalogue URL", "URL du catalogue", "Katalog-URL", "URL do catálogo", "URL del catalogo", "Katalog URL’si", "目录 URL"],
  ["Guardar ficha", "Save record", "Enregistrer la fiche", "Datensatz speichern", "Guardar ficha", "Salva scheda", "Kaydı kaydet", "保存记录"],
  ["Ficha documental", "Document record", "Fiche documentaire", "Dokumentdatensatz", "Ficha documental", "Scheda documentale", "Belge kaydı", "文档记录"],
  ["Abrir ficha de {title}", "Open record for {title}", "Ouvrir la fiche de {title}", "Datensatz für {title} öffnen", "Abrir ficha de {title}", "Apri la scheda di {title}", "{title} kaydını aç", "打开{title}的记录"],
  ["2. Clasificación documental", "2. Document classification", "2. Classification documentaire", "2. Dokumentklassifikation", "2. Classificação documental", "2. Classificazione documentale", "2. Belge sınıflandırması", "2. 文档分类"],
  ["3. Ubicación archivística", "3. Archival location", "3. Localisation archivistique", "3. Archivstandort", "3. Localização arquivística", "3. Collocazione archivistica", "3. Arşiv konumu", "3. 档案位置"],
  ["Datos de catalogación", "Cataloguing data", "Données de catalogage", "Erschließungsdaten", "Dados de catalogação", "Dati di catalogazione", "Kataloglama verileri", "编目数据"],
] as const;

function column(index: number): Record<string, string> {
  return Object.fromEntries(rows.map((row) => [row[0], row[index]]));
}

export const PRIMARY_SOURCES_CATALOG_TRANSLATIONS = {
  en: column(1),
  fr: column(2),
  de: column(3),
  pt: column(4),
  ptBR: column(4),
  it: column(5),
  tr: column(6),
  'zh-CN': column(7),
} as const;
