// Nodus AI OCR — the prompts. Pure and dependency-free. Two builders:
//
//  • buildOcrSystemPrompt  → asks for OCR + layout segmentation as strict JSON blocks
//    with labels and bounding boxes (the rich "structured" mode).
//  • buildOcrTextPrompt    → asks for a clean verbatim transcription as plain text
//    (the "text" fallback for models that cannot reliably emit JSON).
//
// Written in Spanish to match Nodus's own prompt voice (cf. shared/imageAnalysis.ts).
// The instructions' language does not force the output language: the extraction/
// language rules explicitly keep the transcription in the document's original
// language (or translate it, in translation mode).
import type { OcrOptions } from './aiOcrTypes';
import type { PromptLanguage } from './types';

/** Short user turn that accompanies the page image; the rules live in the system prompt. */
export const OCR_USER_PROMPT = 'Transcribe el texto de esta imagen siguiendo estrictamente las reglas indicadas.';

export function ocrUserPrompt(language: PromptLanguage = 'es'): string {
  if (language === 'es') return OCR_USER_PROMPT;
  return OCR_LOCALIZED_COPY[language]?.user ?? OCR_LOCALIZED_COPY.en.user;
}

function extractionRule(o: OcrOptions): string {
  if (o.processingMode === 'translation' && o.targetLanguage) {
    return `**TRADUCCIÓN**: extrae el texto y tradúcelo a ${o.targetLanguage}. **NO RESUMAS**. **NO AÑADAS COMENTARIOS**.`;
  }
  if (o.processingMode === 'manual') {
    return '**MODO INSTRUCCIONES ADICIONALES**: aplica las instrucciones extra del usuario incluidas al final, pero sin incumplir nunca las reglas obligatorias de reconstrucción de párrafos, orden de lectura, detección de página en blanco, etiquetado y salida.';
  }
  return '**EXTRACCIÓN LITERAL**: extrae el texto exactamente como aparece en la imagen. **NO TRADUZCAS**. **NO RESUMAS**. **NO AÑADAS COMENTARIOS**.';
}

function languageRule(o: OcrOptions): string {
  if (o.processingMode === 'translation' && o.targetLanguage) {
    return `**IDIOMA DESTINO**: el texto debe quedar en ${o.targetLanguage}.`;
  }
  if (o.processingMode === 'manual') {
    return '**IDIOMA**: conserva el idioma original salvo que las instrucciones adicionales pidan explícitamente otro idioma destino.';
  }
  return '**IDIOMA ORIGINAL**: el texto debe permanecer en el idioma original del documento.';
}

function referencesRule(remove: boolean): string {
  if (!remove) {
    return 'Conserva las citas y referencias en el texto exactamente como aparecen en la fuente.';
  }
  return `Al extraer bloques MAIN_TEXT, omite las citas académicas dentro del texto, como:
    - (Autor, Año)
    - (Autor, Año: página)
    - (APELLIDO, 1908: p. 104)
    - (Autor et al., Año)
    - (Autor y Autor, Año)
    - formatos APA, MLA, Chicago o similares entre paréntesis
    Salta esas referencias por completo y mantén la frase fluyendo con naturalidad.`;
}

function columnRules(singleColumn: boolean): string {
  if (singleColumn) {
    return '**COLUMNA ÚNICA**: esta imagen es una única columna recortada de una página multicolumna. Toda el área visible es UNA columna de texto. Léela de arriba abajo. NO intentes detectar ni dividir en varias columnas: solo hay una.';
  }
  return `**ORDEN DE LECTURA MULTICOLUMNA (OBLIGATORIO)**: antes de transcribir, decide si la página tiene una o varias columnas separadas. Si hay varias, termina toda la columna izquierda de arriba abajo antes de pasar a la siguiente por la derecha. Nunca leas en horizontal cruzando el ancho completo de la página.
**NO CRUCES EL CANAL ENTRE COLUMNAS**: un espacio vertical amplio o una separación clara indica columnas distintas. No fusiones texto de columnas adyacentes en un mismo párrafo ni continúes una frase a través del canal.`;
}

function additionalInstructions(o: OcrOptions): string {
  if (o.processingMode !== 'manual' || !o.customPrompt?.trim()) return '';
  return `

**INSTRUCCIONES ADICIONALES DEL USUARIO**:
${o.customPrompt.trim()}

Estas instrucciones son solo aditivas. Si entran en conflicto con las reglas obligatorias de OCR y maquetación anteriores, prevalecen las reglas obligatorias.`;
}

/** Structured mode: OCR + layout segmentation returned as strict JSON. */
export function buildOcrSystemPrompt(o: OcrOptions): string {
  return `Eres una IA avanzada de análisis de maquetación documental. Tu tarea es hacer OCR y segmentación de maquetación sobre la imagen de documento proporcionada.

**INSTRUCCIONES CRÍTICAS:**
1. ${extractionRule(o)}
2. ${languageRule(o)}
3. **SOLO JSON**: devuelve JSON estrictamente válido. No incluyas formato markdown (como \`\`\`json) ni texto conversacional.
4. **SALTOS DE PÁRRAFO REALES**: nunca insertes un salto de línea solo porque el texto de origen pasó a una nueva línea visual. Inserta una línea nueva únicamente cuando el documento muestre un verdadero cambio de párrafo.
5. **UNE LÍNEAS PARTIDAS CON NATURALIDAD**: si una frase continúa en la siguiente línea visual dentro del mismo párrafo, únela en una sola frase continua con espaciado normal.
6. **RECONSTRUYE PALABRAS CON GUIÓN**: si una palabra queda partida por un guión al final de línea y continúa en la siguiente, elimina el salto y el guión y reconstruye la palabra completa.
7. **REESCRITURA EN COLUMNA ÚNICA**: no reproduzcas la maquetación visual exacta, el ajuste de línea ni el flujo a lo ancho de la página. Reescribe el contenido como si fuera un documento limpio de una sola columna, conservando la verdadera estructura de párrafos.
8. **REFERENCIAS**: ${referencesRule(o.removeReferences)}
9. **LA SANGRÍA DEFINE PÁRRAFOS**: trata la sangría de primera línea como una señal decisiva de párrafo. Si una línea empieza claramente a la derecha del margen izquierdo del párrafo anterior, inicia un párrafo nuevo. Nunca fusiones una línea sangrada con el párrafo anterior.
10. ${columnRules(!!o.singleColumn)}

**PASOS:**
0. **Clasifica páginas en blanco**: si la página está en blanco o solo contiene artefactos de escaneo, manchas o ruido de bordes sin contenido legible, pon "blankPage" en true y devuelve un array "blocks" vacío.
1. **Orden de lectura**: identifica el orden de lectura correcto antes de transcribir; detecta primero la estructura de columnas.
2. **Extrae el texto**: lee todo el texto aplicando las reglas de párrafos y reconstrucción anteriores.
3. **Segmenta en bloques**: agrupa el texto continuo en párrafos coherentes o bloques lógicos. Inicia un bloque nuevo cuando la fuente muestre un cambio real de párrafo. No dividas un mismo párrafo en varios bloques MAIN_TEXT salvo que sea necesario.
4. **Etiqueta cada bloque** con una de estas etiquetas:
   - **TITLE**: títulos, subtítulos, encabezados de sección (fuente mayor, negrita, centrado o líneas cortas al inicio de una sección).
   - **MAIN_TEXT**: el cuerpo principal del documento.${o.removeReferences ? ' Elimina de aquí las citas en el texto.' : ''}
   - **FOOTNOTE**: notas al pie, a menudo con números/superíndices pequeños o referencias bibliográficas (Ibid, Op. cit.).
   - **HEADER**: texto repetido en la parte superior (números de página, título de capítulo).
   - **FOOTER**: texto repetido en la parte inferior (números de página, título del libro).
   - **CAPTION**: texto que describe imágenes o tablas.
5. **Ambigüedad**: si no hay un título claro, etiqueta como MAIN_TEXT. Sé estricto separando HEADER y FOOTER del MAIN_TEXT.${o.singleColumn ? '' : ' Cuando las señales de maquetación entren en conflicto, el orden de columnas manda para el orden de lectura y la sangría manda para los saltos de párrafo.'} Mantén las coordenadas en "box_2d", pero no dejes que el ajuste de línea visual se cuele en el texto del bloque.

**FORMATO DE SALIDA:**
Devuelve un objeto JSON válido con esta estructura:
{
  "blankPage": false,
  "blocks": [
    { "text": "El contenido del bloque…", "label": "MAIN_TEXT", "box_2d": [ymin, xmin, ymax, xmax] }
  ]
}
"box_2d" en coordenadas normalizadas 0–1000 si es posible.${additionalInstructions(o)}`;
}

/** Verbatim-text fallback: clean transcription as plain text, no JSON. Used for models
 *  that cannot reliably produce structured output. */
export function buildOcrTextPrompt(o: OcrOptions): string {
  return `Eres una IA de OCR. Transcribe el texto de la imagen del documento.

**REGLAS:**
1. ${extractionRule(o)}
2. ${languageRule(o)}
3. **SOLO EL TEXTO**: devuelve únicamente el texto transcrito. No añadas comentarios, títulos inventados, JSON, ni bloques de código.
4. **SALTOS DE PÁRRAFO REALES**: separa los párrafos con una línea en blanco. No cortes líneas dentro de un mismo párrafo por el ajuste visual.
5. **UNE LÍNEAS PARTIDAS** y **RECONSTRUYE PALABRAS CON GUIÓN** al final de línea.
6. **REFERENCIAS**: ${referencesRule(o.removeReferences)}
7. ${columnRules(!!o.singleColumn)}
8. Si la página está en blanco o no tiene texto legible, devuelve una cadena vacía.${additionalInstructions(o)}`;
}

/** Localized contract used by production calls. The legacy Spanish builders remain
 * exported for compatibility and tests; this path avoids leaking Spanish into
 * non-Spanish prompt sessions while preserving the fixed protocol labels. */
type LocalizedOcrCopy = {
  user: string; intro: string; literal: string; translation: string; manual: string;
  critical: string; steps: string; rules: string; referencesHeading: string;
  original: string; target: string; manualLanguage: string; json: string;
  paragraph: string; join: string; hyphen: string; singleRewrite: string;
  refsKeep: string; refsRemove: string; indent: string; single: string; multi: string;
  blank: string; reading: string; extract: string; segment: string; labels: string;
  roles: string; ambiguity: string; output: string; schema: string; box: string;
  additional: string; precedence: string; textIntro: string; textOnly: string;
  textParagraph: string; textJoin: string; textBlank: string;
};

const OCR_LOCALIZED_COPY: Record<string, LocalizedOcrCopy> = {
  en: {
    user: "Transcribe the text in this image, following the stated rules exactly.",
    intro: "You are an advanced document-layout analysis AI. Your task is to perform OCR and layout segmentation on the supplied document image.",
    critical: "**CRITICAL INSTRUCTIONS:**", steps: "**STEPS:**", rules: "**RULES:**", referencesHeading: "**REFERENCES**",
    literal: "**VERBATIM EXTRACTION**: extract the text exactly as it appears in the image. **DO NOT TRANSLATE**. **DO NOT SUMMARIZE**. **DO NOT ADD COMMENTS**.",
    translation: "**TRANSLATION**: extract the text and translate it into ",
    manual: "**ADDITIONAL-INSTRUCTIONS MODE**: apply the extra user instructions included at the end, but never violate the mandatory rules for paragraph reconstruction, reading order, blank-page detection, labelling and output.",
    original: "**ORIGINAL LANGUAGE**: the text must remain in the document's original language.",
    target: "**TARGET LANGUAGE**: the text must end up in ",
    manualLanguage: "**LANGUAGE**: preserve the original language unless the additional instructions explicitly request another target language.",
    json: "**JSON ONLY**: return strictly valid JSON. Do not include Markdown formatting or conversational text.",
    paragraph: "**REAL PARAGRAPH BREAKS**: never insert a line break merely because the source text moved to a new visual line. Insert a new line only when the document shows a genuine paragraph change.",
    join: "**JOIN WRAPPED LINES NATURALLY**: when a sentence continues on the next visual line within the same paragraph, join it into one continuous sentence with normal spacing.",
    hyphen: "**RECONSTRUCT HYPHENATED WORDS**: when a word is split by a hyphen at the end of a line and continues on the next line, remove the line break and hyphen and reconstruct the complete word.",
    singleRewrite: "**SINGLE-COLUMN REWRITING**: do not reproduce the exact visual layout, line wrapping or page-wide flow. Rewrite the content as a clean single-column document while preserving the true paragraph structure.",
    refsKeep: "Keep citations and references in the text exactly as they appear in the source.",
    refsRemove: "When extracting MAIN_TEXT blocks, omit academic citations inside the text, such as:\n    - (Author, Year)\n    - (Author, Year: page)\n    - (SURNAME, 1908: p. 104)\n    - (Author et al., Year)\n    - (Author and Author, Year)\n    - APA, MLA, Chicago or similar parenthesized formats\n    Skip those references completely and keep the sentence flowing naturally.",
    indent: "**INDENTATION DEFINES PARAGRAPHS**: treat first-line indentation as a decisive paragraph signal. If a line clearly starts to the right of the previous paragraph's left margin, start a new paragraph. Never merge an indented line with the preceding paragraph.",
    single: "**SINGLE COLUMN**: this image is one column cropped from a multi-column page. The entire visible area is ONE text column. Read it from top to bottom. Do NOT detect or split it into multiple columns: there is only one.",
    multi: "**MULTI-COLUMN READING ORDER (MANDATORY)**: before transcribing, decide whether the page has one or several separated columns. If there are several, finish the entire left column from top to bottom before moving to the next column on the right. Never read horizontally across the full page width.\n**DO NOT CROSS THE GUTTER BETWEEN COLUMNS**: a wide vertical gap or clear separation indicates different columns. Do not merge text from adjacent columns into one paragraph or continue a sentence across the gutter.",
    blank: "0. **Classify blank pages**: if the page is blank or contains only scan artefacts, stains or edge noise with no legible content, set \"blankPage\" to true and return an empty \"blocks\" array.",
    reading: "1. **Reading order**: identify the correct reading order before transcribing; detect the column structure first.",
    extract: "2. **Extract the text**: read all text while applying the paragraph and reconstruction rules above.",
    segment: "3. **Segment into blocks**: group continuous text into coherent paragraphs or logical blocks. Start a new block when the source shows a genuine paragraph change. Do not split one MAIN_TEXT paragraph into multiple blocks unless necessary.",
    labels: "4. **Label each block** with one of these labels:",
    roles: "   - **TITLE**: titles, subtitles and section headings (larger font, bold, centred or short lines at the start of a section).\n   - **MAIN_TEXT**: the document's main body.\n   - **FOOTNOTE**: footnotes, often with small numbers/superscripts or bibliographic references (Ibid, Op. cit.).\n   - **HEADER**: repeated text at the top (page numbers, chapter title).\n   - **FOOTER**: repeated text at the bottom (page numbers, book title).\n   - **CAPTION**: text describing images or tables.",
    ambiguity: "5. **Ambiguity**: if there is no clear title, label it MAIN_TEXT. Be strict when separating HEADER and FOOTER from MAIN_TEXT.",
    output: "**OUTPUT FORMAT:**",
    schema: "Return a valid JSON object with this structure:\n{\n  \"blankPage\": false,\n  \"blocks\": [\n    { \"text\": \"Block content…\", \"label\": \"MAIN_TEXT\", \"box_2d\": [ymin, xmin, ymax, xmax] }\n  ]\n}",
    box: "Use normalized 0–1000 coordinates in \"box_2d\" where possible.",
    additional: "**ADDITIONAL USER INSTRUCTIONS:**",
    precedence: "These instructions are additive only. If they conflict with the mandatory OCR and layout rules above, the mandatory rules prevail.",
    textIntro: "You are an OCR AI. Transcribe the text in the document image.",
    textOnly: "**TEXT ONLY**: return only the transcribed text. Do not add comments, invented headings, JSON or code blocks.",
    textParagraph: "**REAL PARAGRAPH BREAKS**: separate paragraphs with a blank line. Do not break lines within one paragraph because of visual wrapping.",
    textJoin: "**JOIN WRAPPED LINES** and **RECONSTRUCT HYPHENATED WORDS** at the end of a line.",
    textBlank: "8. If the page is blank or has no legible text, return an empty string.",
  },
  fr: {
    user: "Transcris le texte de cette image en suivant exactement les règles indiquées.",
    intro: "Tu es une IA avancée d'analyse de la mise en page des documents. Ta tâche consiste à effectuer l'OCR et la segmentation de la mise en page de l'image fournie.",
    critical: "**INSTRUCTIONS CRITIQUES :**", steps: "**ÉTAPES :**", rules: "**RÈGLES :**", referencesHeading: "**RÉFÉRENCES**",
    literal: "**EXTRACTION LITTÉRALE** : extrais le texte exactement comme il apparaît sur l'image. **NE TRADUIS PAS**. **NE RÉSUME PAS**. **N'AJOUTE AUCUN COMMENTAIRE**.",
    translation: "**TRADUCTION** : extrais le texte et traduis-le en ",
    manual: "**MODE INSTRUCTIONS SUPPLÉMENTAIRES** : applique les instructions supplémentaires de l'utilisateur à la fin, sans jamais enfreindre les règles obligatoires de reconstruction des paragraphes, d'ordre de lecture, de détection des pages blanches, d'étiquetage et de sortie.",
    original: "**LANGUE ORIGINALE** : le texte doit rester dans la langue originale du document.",
    target: "**LANGUE CIBLE** : le texte doit être en ",
    manualLanguage: "**LANGUE** : conserve la langue originale, sauf si les instructions supplémentaires demandent explicitement une autre langue cible.",
    json: "**JSON UNIQUEMENT** : renvoie un JSON strictement valide. N'inclus pas de mise en forme Markdown ni de texte conversationnel.",
    paragraph: "**VRAIES COUPURES DE PARAGRAPHE** : n'insère jamais de saut de ligne simplement parce que le texte source passe à une nouvelle ligne visuelle. Insère une nouvelle ligne uniquement lorsque le document montre un véritable changement de paragraphe.",
    join: "**ASSEMBLE NATURELLEMENT LES LIGNES** : si une phrase continue sur la ligne visuelle suivante dans le même paragraphe, assemble-la en une phrase continue avec un espacement normal.",
    hyphen: "**RECONSTITUE LES MOTS COUPÉS** : lorsqu'un mot est coupé par un trait d'union en fin de ligne et continue à la ligne suivante, supprime le saut et le trait d'union et reconstitue le mot complet.",
    singleRewrite: "**RÉÉCRITURE EN COLONNE UNIQUE** : ne reproduis pas la mise en page visuelle exacte, le retour à la ligne ni le flux sur toute la largeur de la page. Réécris le contenu comme un document propre à une seule colonne en conservant la véritable structure des paragraphes.",
    refsKeep: "Conserve les citations et les références dans le texte exactement comme dans la source.",
    refsRemove: "Lors de l'extraction des blocs MAIN_TEXT, omets les citations académiques dans le texte, par exemple :\n    - (Auteur, Année)\n    - (Auteur, Année : page)\n    - (NOM, 1908 : p. 104)\n    - (Auteur et al., Année)\n    - (Auteur et Auteur, Année)\n    - les formats APA, MLA, Chicago ou similaires entre parenthèses\n    Ignore complètement ces références et garde une phrase naturelle.",
    indent: "**L'INDENTATION DÉFINIT LES PARAGRAPHES** : considère l'indentation de la première ligne comme un signal décisif de paragraphe. Si une ligne commence clairement à droite de la marge gauche du paragraphe précédent, commence un nouveau paragraphe. Ne fusionne jamais une ligne indentée avec le paragraphe précédent.",
    single: "**COLONNE UNIQUE** : cette image est une colonne recadrée d'une page à plusieurs colonnes. Toute la zone visible est UNE colonne de texte. Lis-la de haut en bas. N'essaie PAS de détecter ou de diviser plusieurs colonnes : il n'y en a qu'une.",
    multi: "**ORDRE DE LECTURE MULTICOLONNE (OBLIGATOIRE)** : avant de transcrire, détermine si la page comporte une ou plusieurs colonnes séparées. S'il y en a plusieurs, termine toute la colonne de gauche de haut en bas avant de passer à la suivante vers la droite. Ne lis jamais horizontalement sur toute la largeur de la page.\n**NE TRAVERSE PAS LA GOUTTIÈRE ENTRE LES COLONNES** : un large espace vertical ou une séparation nette indique des colonnes distinctes. Ne fusionne pas le texte de colonnes adjacentes dans un même paragraphe et ne poursuis pas une phrase à travers la gouttière.",
    blank: "0. **Classe les pages blanches** : si la page est blanche ou contient uniquement des artefacts de numérisation, des taches ou du bruit de bord sans contenu lisible, mets \"blankPage\" à true et renvoie un tableau \"blocks\" vide.",
    reading: "1. **Ordre de lecture** : identifie le bon ordre de lecture avant de transcrire ; détecte d'abord la structure des colonnes.",
    extract: "2. **Extrais le texte** : lis tout le texte en appliquant les règles de paragraphe et de reconstruction ci-dessus.",
    segment: "3. **Segmente en blocs** : regroupe le texte continu en paragraphes cohérents ou en blocs logiques. Commence un nouveau bloc lorsque la source montre un véritable changement de paragraphe. Ne divise pas un même paragraphe MAIN_TEXT en plusieurs blocs sauf nécessité.",
    labels: "4. **Étiquette chaque bloc** avec l'une de ces étiquettes :",
    roles: "   - **TITLE** : titres, sous-titres et en-têtes de section (police plus grande, gras, centrés ou lignes courtes au début d'une section).\n   - **MAIN_TEXT** : le corps principal du document.\n   - **FOOTNOTE** : notes de bas de page, souvent accompagnées de petits numéros/exposants ou de références bibliographiques (Ibid, Op. cit.).\n   - **HEADER** : texte répété en haut (numéros de page, titre du chapitre).\n   - **FOOTER** : texte répété en bas (numéros de page, titre du livre).\n   - **CAPTION** : texte décrivant des images ou des tableaux.",
    ambiguity: "5. **Ambiguïté** : s'il n'y a pas de titre clair, étiquette le bloc MAIN_TEXT. Sois strict pour séparer HEADER et FOOTER de MAIN_TEXT.",
    output: "**FORMAT DE SORTIE :**",
    schema: "Renvoie un objet JSON valide avec cette structure :\n{\n  \"blankPage\": false,\n  \"blocks\": [\n    { \"text\": \"Contenu du bloc…\", \"label\": \"MAIN_TEXT\", \"box_2d\": [ymin, xmin, ymax, xmax] }\n  ]\n}",
    box: "Utilise si possible des coordonnées normalisées de 0 à 1000 dans \"box_2d\".",
    additional: "**INSTRUCTIONS SUPPLÉMENTAIRES DE L'UTILISATEUR :**",
    precedence: "Ces instructions sont uniquement additives. En cas de conflit avec les règles obligatoires d'OCR et de mise en page ci-dessus, les règles obligatoires prévalent.",
    textIntro: "Tu es une IA d'OCR. Transcris le texte de l'image du document.",
    textOnly: "**TEXTE UNIQUEMENT** : renvoie uniquement le texte transcrit. N'ajoute ni commentaires, ni titres inventés, ni JSON, ni blocs de code.",
    textParagraph: "**VRAIES COUPURES DE PARAGRAPHE** : sépare les paragraphes par une ligne vide. Ne coupe pas les lignes à l'intérieur d'un même paragraphe à cause du retour visuel.",
    textJoin: "**ASSEMBLE LES LIGNES** et **RECONSTITUE LES MOTS COUPÉS** en fin de ligne.",
    textBlank: "8. Si la page est blanche ou ne contient aucun texte lisible, renvoie une chaîne vide.",
  },
  de: {
    user: "Transkribiere den Text in diesem Bild und befolge die angegebenen Regeln genau.",
    intro: "Du bist eine fortgeschrittene KI zur Analyse von Dokumentlayouts. Deine Aufgabe ist OCR und Layoutsegmentierung für das bereitgestellte Dokumentbild.",
    critical: "**KRITISCHE ANWEISUNGEN:**", steps: "**SCHRITTE:**", rules: "**REGELN:**", referencesHeading: "**VERWEISE**",
    literal: "**WÖRTLICHE EXTRAKTION**: Extrahiere den Text genau so, wie er im Bild erscheint. **NICHT ÜBERSETZEN**. **NICHT ZUSAMMENFASSEN**. **KEINE KOMMENTARE HINZUFÜGEN**.",
    translation: "**ÜBERSETZUNG**: Extrahiere den Text und übersetze ihn nach ",
    manual: "**MODUS FÜR ZUSÄTZLICHE ANWEISUNGEN**: Wende die zusätzlichen Benutzeranweisungen am Ende an, ohne jemals die verbindlichen Regeln für Absatzrekonstruktion, Lesereihenfolge, Erkennung leerer Seiten, Beschriftung und Ausgabe zu verletzen.",
    original: "**ORIGINALSPRACHE**: Der Text muss in der Originalsprache des Dokuments bleiben.",
    target: "**ZIELSPRACHE**: Der Text muss am Ende auf ",
    manualLanguage: "**SPRACHE**: Behalte die Originalsprache bei, sofern die zusätzlichen Anweisungen nicht ausdrücklich eine andere Zielsprache verlangen.",
    json: "**NUR JSON**: Gib ausschließlich gültiges JSON zurück. Verwende keine Markdown-Formatierung und keinen Gesprächstext.",
    paragraph: "**ECHTE ABSATZUMBRÜCHE**: Füge niemals nur deshalb einen Zeilenumbruch ein, weil der Quelltext in eine neue sichtbare Zeile wechselt. Füge eine neue Zeile nur bei einem echten Absatzwechsel im Dokument ein.",
    join: "**ZEILENUMBRÜCHE NATÜRLICH VERBINDEN**: Wenn ein Satz innerhalb desselben Absatzes in der nächsten sichtbaren Zeile weitergeht, verbinde ihn mit normalem Abstand zu einem fortlaufenden Satz.",
    hyphen: "**GETRENNTE WÖRTER REKONSTRUIEREN**: Wenn ein Wort am Zeilenende durch einen Bindestrich getrennt ist und in der nächsten Zeile fortgesetzt wird, entferne Zeilenumbruch und Bindestrich und rekonstruiere das vollständige Wort.",
    singleRewrite: "**EINSPALTIGE NEUFASSUNG**: Gib weder das genaue visuelle Layout noch den Zeilenumbruch oder den seitenweiten Fluss wieder. Schreibe den Inhalt als sauberes einspaltiges Dokument um und bewahre die echte Absatzstruktur.",
    refsKeep: "Erhalte Zitate und Verweise im Text genau wie in der Quelle.",
    refsRemove: "Lass beim Extrahieren von MAIN_TEXT-Blöcken akademische Zitate im Text weg, zum Beispiel:\n    - (Autor, Jahr)\n    - (Autor, Jahr: Seite)\n    - (NACHNAME, 1908: S. 104)\n    - (Autor et al., Jahr)\n    - (Autor und Autor, Jahr)\n    - APA-, MLA-, Chicago- oder ähnliche Klammerformate\n    Überspringe diese Verweise vollständig und halte den Satzfluss natürlich.",
    indent: "**EINRÜCKUNG DEFINIERT ABSÄTZE**: Behandle die Einrückung der ersten Zeile als eindeutiges Absatzsignal. Wenn eine Zeile klar rechts vom linken Rand des vorherigen Absatzes beginnt, starte einen neuen Absatz. Verbinde eine eingerückte Zeile niemals mit dem vorherigen Absatz.",
    single: "**EINSPALTIG**: Dieses Bild ist eine einzelne, aus einer mehrspaltigen Seite ausgeschnittene Spalte. Der gesamte sichtbare Bereich ist EINE Textspalte. Lies sie von oben nach unten. Versuche NICHT, mehrere Spalten zu erkennen oder aufzuteilen: Es gibt nur eine.",
    multi: "**MEHRSPALTIGE LESEREIHENFOLGE (VERBINDLICH)**: Entscheide vor dem Transkribieren, ob die Seite eine oder mehrere getrennte Spalten hat. Wenn es mehrere gibt, bearbeite zuerst die gesamte linke Spalte von oben nach unten und wechsle dann zur nächsten Spalte rechts. Lies niemals horizontal über die gesamte Seitenbreite.\n**ÜBERQUERE NICHT DEN ZWISCHENRAUM ZWISCHEN SPALTEN**: Ein breiter vertikaler Abstand oder eine klare Trennung kennzeichnet verschiedene Spalten. Führe Text aus benachbarten Spalten nicht in einem Absatz zusammen und setze keinen Satz über den Zwischenraum fort.",
    blank: "0. **Leere Seiten klassifizieren**: Wenn die Seite leer ist oder nur Scanartefakte, Flecken oder Randrauschen ohne lesbaren Inhalt enthält, setze \"blankPage\" auf true und gib ein leeres Array \"blocks\" zurück.",
    reading: "1. **Lesereihenfolge**: Bestimme vor dem Transkribieren die richtige Lesereihenfolge und erkenne zuerst die Spaltenstruktur.",
    extract: "2. **Text extrahieren**: Lies den gesamten Text unter Anwendung der obigen Absatz- und Rekonstruktionsregeln.",
    segment: "3. **In Blöcke segmentieren**: Gruppiere fortlaufenden Text in zusammenhängende Absätze oder logische Blöcke. Beginne bei einem echten Absatzwechsel der Quelle einen neuen Block. Teile einen MAIN_TEXT-Absatz nicht ohne Not in mehrere Blöcke.",
    labels: "4. **Jeden Block beschriften** mit genau einer dieser Beschriftungen:",
    roles: "   - **TITLE**: Titel, Untertitel und Abschnittsüberschriften (größere Schrift, fett, zentriert oder kurze Zeilen am Abschnittsanfang).\n   - **MAIN_TEXT**: der Haupttext des Dokuments.\n   - **FOOTNOTE**: Fußnoten, oft mit kleinen Zahlen/Hochstellungen oder Literaturverweisen (Ibid, Op. cit.).\n   - **HEADER**: wiederholter Text oben (Seitenzahlen, Kapitelüberschrift).\n   - **FOOTER**: wiederholter Text unten (Seitenzahlen, Buchtitel).\n   - **CAPTION**: Text zur Beschreibung von Bildern oder Tabellen.",
    ambiguity: "5. **Mehrdeutigkeit**: Wenn kein eindeutiger Titel vorhanden ist, beschrifte den Block als MAIN_TEXT. Trenne HEADER und FOOTER strikt von MAIN_TEXT.",
    output: "**AUSGABEFORMAT:**",
    schema: "Gib ein gültiges JSON-Objekt mit dieser Struktur zurück:\n{\n  \"blankPage\": false,\n  \"blocks\": [\n    { \"text\": \"Blockinhalt…\", \"label\": \"MAIN_TEXT\", \"box_2d\": [ymin, xmin, ymax, xmax] }\n  ]\n}",
    box: "Verwende in \"box_2d\" nach Möglichkeit normalisierte Koordinaten von 0 bis 1000.",
    additional: "**ZUSÄTZLICHE BENUTZERANWEISUNGEN:**",
    precedence: "Diese Anweisungen sind nur ergänzend. Bei Konflikten mit den verbindlichen OCR- und Layoutregeln oben haben die verbindlichen Regeln Vorrang.",
    textIntro: "Du bist eine OCR-KI. Transkribiere den Text aus dem Dokumentbild.",
    textOnly: "**NUR TEXT**: Gib ausschließlich den transkribierten Text zurück. Füge keine Kommentare, erfundenen Überschriften, JSON- oder Codeblöcke hinzu.",
    textParagraph: "**ECHTE ABSATZUMBRÜCHE**: Trenne Absätze durch eine Leerzeile. Unterbrich Zeilen innerhalb eines Absatzes nicht wegen des visuellen Umbruchs.",
    textJoin: "**VERBINDE ZEILENUMBRÜCHE** und **REKONSTRUIERE GETRENNTE WÖRTER** am Zeilenende.",
    textBlank: "8. Wenn die Seite leer ist oder keinen lesbaren Text enthält, gib eine leere Zeichenkette zurück.",
  },
  pt: {
    user: "Transcreva o texto desta imagem seguindo exatamente as regras indicadas.", intro: "Você é uma IA avançada de análise de layout de documentos. Faça OCR e segmentação de layout na imagem fornecida.", critical: "**INSTRUÇÕES CRÍTICAS:**", steps: "**PASSOS:**", rules: "**REGRAS:**", referencesHeading: "**REFERÊNCIAS**",
    literal: "**EXTRAÇÃO LITERAL**: extraia o texto exatamente como aparece. **NÃO TRADUZA**. **NÃO RESUMA**. **NÃO ADICIONE COMENTÁRIOS**.", translation: "**TRADUÇÃO**: extraia o texto e traduza-o para ", manual: "**MODO DE INSTRUÇÕES ADICIONAIS**: aplique as instruções extras do utilizador no final, sem violar as regras obrigatórias de reconstrução de parágrafos, ordem de leitura, páginas em branco, etiquetas e saída.",
    original: "**IDIOMA ORIGINAL**: mantenha o idioma original do documento.", target: "**IDIOMA DE DESTINO**: o texto deve ficar em ", manualLanguage: "**IDIOMA**: conserve o idioma original, salvo pedido explícito de outro idioma.", json: "**APENAS JSON**: devolva JSON estritamente válido, sem Markdown nem texto conversacional.",
    paragraph: "**QUEBRAS REAIS DE PARÁGRAFO**: só insira uma nova linha quando houver uma mudança real de parágrafo; não siga quebras visuais.", join: "**UNA LINHAS QUEBRADAS NATURALMENTE** dentro do mesmo parágrafo, usando espaçamento normal.", hyphen: "**RECONSTRUA PALAVRAS HIFENIZADAS**: remova a quebra e o hífen quando a palavra continuar na linha seguinte.", singleRewrite: "**REESCRITA EM COLUNA ÚNICA**: reescreva como documento limpo de uma coluna, mantendo a estrutura real dos parágrafos e a ordem de leitura.",
    refsKeep: "Conserve citações e referências exatamente como aparecem na fonte.", refsRemove: "Nos blocos MAIN_TEXT, omita citações académicas no texto, como (Autor, Ano), (Autor, Ano: página), (APELIDO, 1908: p. 104), (Autor et al., Ano), (Autor e Autor, Ano) e formatos APA, MLA ou Chicago entre parênteses. Ignore-as completamente e mantenha o fluxo natural.",
    indent: "**A INDENTAÇÃO DEFINE PARÁGRAFOS**: uma primeira linha claramente mais à direita inicia um novo parágrafo; nunca a una ao anterior.", single: "**COLUNA ÚNICA**: toda a área visível é UMA coluna. Leia de cima para baixo e não a divida.", multi: "**ORDEM DE LEITURA MULTICOLUNA (OBRIGATÓRIA)**: termine a coluna esquerda de cima para baixo antes da próxima à direita; nunca leia horizontalmente.\n**NÃO ATRAVESSE O ESPAÇO ENTRE COLUNAS**: não misture colunas nem continue frases através da separação.",
    blank: "0. **Classifique páginas em branco**: para uma página sem conteúdo legível, defina \"blankPage\" como true e devolva \"blocks\" vazio.", reading: "1. **Ordem de leitura**: determine a ordem correta e detete primeiro as colunas.", extract: "2. **Extraia o texto** aplicando as regras de parágrafos e reconstrução.", segment: "3. **Segmente em blocos**: agrupe parágrafos coerentes e comece um bloco em cada mudança real; não divida MAIN_TEXT sem necessidade.", labels: "4. **Etiquete cada bloco** com uma destas etiquetas:", roles: "   - **TITLE**: títulos e cabeçalhos de secção.\n   - **MAIN_TEXT**: corpo principal.\n   - **FOOTNOTE**: notas de rodapé e referências bibliográficas.\n   - **HEADER**: texto repetido no topo.\n   - **FOOTER**: texto repetido no fundo.\n   - **CAPTION**: descrição de imagens ou tabelas.", ambiguity: "5. **Ambiguidade**: sem título claro, use MAIN_TEXT; separe HEADER e FOOTER rigorosamente.",
    output: "**FORMATO DE SAÍDA:**", schema: "Devolva um objeto JSON válido:\n{\n  \"blankPage\": false,\n  \"blocks\": [{ \"text\": \"Conteúdo do bloco…\", \"label\": \"MAIN_TEXT\", \"box_2d\": [ymin, xmin, ymax, xmax] }]\n}", box: "Use coordenadas normalizadas 0–1000 em \"box_2d\" sempre que possível.", additional: "**INSTRUÇÕES ADICIONAIS DO UTILIZADOR:**", precedence: "São instruções aditivas; em conflito, prevalecem as regras obrigatórias de OCR e layout.",
    textIntro: "Você é uma IA de OCR. Transcreva o texto da imagem.", textOnly: "**APENAS TEXTO**: devolva somente a transcrição, sem comentários, títulos inventados, JSON ou código.", textParagraph: "**QUEBRAS REAIS DE PARÁGRAFO**: separe parágrafos com uma linha vazia e não corte linhas por causa do ajuste visual.", textJoin: "**UNA LINHAS QUEBRADAS** e **RECONSTRUA PALAVRAS HIFENIZADAS** no fim da linha.", textBlank: "8. Se a página estiver em branco ou sem texto legível, devolva uma string vazia.",
  },
  "pt-BR": {
    user: "Transcreva o texto desta imagem seguindo exatamente as regras indicadas.", intro: "Você é uma IA avançada de análise de layout de documentos. Faça OCR e segmentação de layout na imagem fornecida.", critical: "**INSTRUÇÕES CRÍTICAS:**", steps: "**PASSOS:**", rules: "**REGRAS:**", referencesHeading: "**REFERÊNCIAS**",
    literal: "**EXTRAÇÃO LITERAL**: extraia o texto exatamente como aparece. **NÃO TRADUZA**. **NÃO RESUMA**. **NÃO ADICIONE COMENTÁRIOS**.", translation: "**TRADUÇÃO**: extraia o texto e traduza-o para ", manual: "**MODO DE INSTRUÇÕES ADICIONAIS**: aplique as instruções extras do usuário no final, sem violar as regras obrigatórias de reconstrução de parágrafos, ordem de leitura, páginas em branco, rotulagem e saída.",
    original: "**IDIOMA ORIGINAL**: mantenha o idioma original do documento.", target: "**IDIOMA DE DESTINO**: o texto deve ficar em ", manualLanguage: "**IDIOMA**: mantenha o idioma original, a menos que as instruções adicionais peçam explicitamente outro idioma.", json: "**APENAS JSON**: retorne JSON estritamente válido, sem Markdown nem texto conversacional.",
    paragraph: "**QUEBRAS REAIS DE PARÁGRAFO**: só insira nova linha quando houver mudança real de parágrafo; não siga quebras visuais.", join: "**UNA LINHAS QUEBRADAS NATURALMENTE** dentro do mesmo parágrafo, com espaçamento normal.", hyphen: "**RECONSTRUA PALAVRAS HIFENIZADAS**: remova a quebra e o hífen quando a palavra continuar na linha seguinte.", singleRewrite: "**REESCRITA EM COLUNA ÚNICA**: reescreva como documento limpo de uma coluna, mantendo a estrutura real dos parágrafos e a ordem de leitura.",
    refsKeep: "Mantenha citações e referências exatamente como aparecem na fonte.", refsRemove: "Nos blocos MAIN_TEXT, omita citações acadêmicas como (Autor, Ano), (Autor, Ano: página), (SOBRENOME, 1908: p. 104), (Autor et al., Ano), (Autor e Autor, Ano) e formatos APA, MLA ou Chicago entre parênteses. Ignore-as completamente e mantenha o fluxo natural.",
    indent: "**A INDENTAÇÃO DEFINE PARÁGRAFOS**: uma primeira linha claramente mais à direita inicia um novo parágrafo; nunca a una ao anterior.", single: "**COLUNA ÚNICA**: toda a área visível é UMA coluna. Leia de cima para baixo e não a divida.", multi: "**ORDEM DE LEITURA MULTICOLUNA (OBRIGATÓRIA)**: termine a coluna esquerda de cima para baixo antes da próxima à direita; nunca leia horizontalmente.\n**NÃO ATRAVESSE O ESPAÇO ENTRE COLUNAS**: não misture colunas nem continue frases através da separação.",
    blank: "0. **Classifique páginas em branco**: para uma página sem conteúdo legível, defina \"blankPage\" como true e retorne \"blocks\" vazio.", reading: "1. **Ordem de leitura**: determine a ordem correta e detecte primeiro as colunas.", extract: "2. **Extraia o texto** aplicando as regras de parágrafos e reconstrução.", segment: "3. **Segmente em blocos**: agrupe parágrafos coerentes e comece um bloco em cada mudança real; não divida MAIN_TEXT sem necessidade.", labels: "4. **Rotule cada bloco** com um destes rótulos:", roles: "   - **TITLE**: títulos e cabeçalhos de seção.\n   - **MAIN_TEXT**: corpo principal.\n   - **FOOTNOTE**: notas de rodapé e referências.\n   - **HEADER**: texto repetido no topo.\n   - **FOOTER**: texto repetido na parte inferior.\n   - **CAPTION**: descrição de imagens ou tabelas.", ambiguity: "5. **Ambiguidade**: sem título claro, use MAIN_TEXT; separe HEADER e FOOTER rigorosamente.",
    output: "**FORMATO DE SAÍDA:**", schema: "Retorne um objeto JSON válido:\n{\n  \"blankPage\": false,\n  \"blocks\": [{ \"text\": \"Conteúdo do bloco…\", \"label\": \"MAIN_TEXT\", \"box_2d\": [ymin, xmin, ymax, xmax] }]\n}", box: "Use coordenadas normalizadas de 0 a 1000 em \"box_2d\" sempre que possível.", additional: "**INSTRUÇÕES ADICIONAIS DO USUÁRIO:**", precedence: "São instruções aditivas; em conflito, prevalecem as regras obrigatórias de OCR e layout.",
    textIntro: "Você é uma IA de OCR. Transcreva o texto da imagem.", textOnly: "**APENAS TEXTO**: retorne somente a transcrição, sem comentários, títulos inventados, JSON ou código.", textParagraph: "**QUEBRAS REAIS DE PARÁGRAFO**: separe parágrafos com uma linha vazia e não corte linhas por causa do ajuste visual.", textJoin: "**UNA LINHAS QUEBRADAS** e **RECONSTRUA PALAVRAS HIFENIZADAS** no fim da linha.", textBlank: "8. Se a página estiver em branco ou sem texto legível, retorne uma string vazia.",
  },

};

const OCR_LAYOUT_CONFLICT: Record<string, string> = {
  en: "When layout signals conflict, column order controls reading order and indentation controls paragraph breaks.",
  fr: "Lorsque les indices de mise en page se contredisent, l’ordre des colonnes contrôle l’ordre de lecture et l’indentation contrôle les coupures de paragraphe.",
  de: "Wenn Layoutsignale widersprüchlich sind, bestimmt die Spaltenreihenfolge die Lesereihenfolge und die Einrückung die Absatzumbrüche.",
  pt: "Quando os sinais de layout entram em conflito, a ordem das colunas determina a ordem de leitura e a indentação determina as quebras de parágrafo.",
  "pt-BR": "Quando os sinais de layout entram em conflito, a ordem das colunas determina a ordem de leitura e a indentação determina as quebras de parágrafo.",
  it: "Quando i segnali del layout sono in conflitto, l’ordine delle colonne determina l’ordine di lettura e l’indentazione determina le interruzioni di paragrafo.",
  tr: "Düzen işaretleri çeliştiğinde sütun sırası okuma sırasını, girinti ise paragraf sonlarını belirler.",
};
const OCR_COORDINATES_RULE: Record<string, string> = {
  en: 'Keep coordinates in "box_2d", but do not let visual line wrapping leak into block text.',
  fr: 'Conserve les coordonnées dans « box_2d », mais ne laisse pas le retour visuel se retrouver dans le texte du bloc.',
  de: 'Behalte die Koordinaten in „box_2d“ bei, aber übertrage sichtbare Zeilenumbrüche nicht in den Blocktext.',
  pt: 'Mantenha as coordenadas em "box_2d", mas não deixe a quebra visual de linhas entrar no texto do bloco.',
  "pt-BR": 'Mantenha as coordenadas em "box_2d", mas não deixe a quebra visual de linhas entrar no texto do bloco.',
  it: 'Mantieni le coordinate in "box_2d", ma non lasciare che il ritorno visivo finisca nel testo del blocco.',
  tr: 'Koordinatları "box_2d" içinde koruyun; ancak görsel satır kaymasını blok metnine aktarmayın.',
};
const OCR_TRANSLATION_SUFFIX: Record<string, string> = {
  en: " **DO NOT SUMMARIZE**. **DO NOT ADD COMMENTS**.",
  fr: " **NE RÉSUME PAS**. **N'AJOUTE AUCUN COMMENTAIRE**.",
  de: " **NICHT ZUSAMMENFASSEN**. **KEINE KOMMENTARE HINZUFÜGEN**.",
  pt: " **NÃO RESUMA**. **NÃO ADICIONE COMENTÁRIOS**.",
  "pt-BR": " **NÃO RESUMA**. **NÃO ADICIONE COMENTÁRIOS**.",
  it: " **NON RIASSUMERE**. **NON AGGIUNGERE COMMENTI**.",
  tr: " **ÖZETLEMEYİN**. **YORUM EKLEMEYİN**.",
};

// Italian and Turkish are kept as explicit full copies as well.  They must not
// inherit the English contract: every layout rule is repeated in the locale.
OCR_LOCALIZED_COPY.it = {
  user: "Trascrivi il testo di questa immagine seguendo esattamente le regole indicate.", intro: "Sei un'IA avanzata per l'analisi del layout dei documenti. Esegui OCR e segmentazione del layout sull'immagine fornita.", critical: "**ISTRUZIONI CRITICHE:**", steps: "**PASSAGGI:**", rules: "**REGOLE:**", referencesHeading: "**RIFERIMENTI**",
  literal: "**ESTRAZIONE LETTERALE**: estrai il testo esattamente come appare. **NON TRADURRE**. **NON RIASSUMERE**. **NON AGGIUNGERE COMMENTI**.", translation: "**TRADUZIONE**: estrai il testo e traducilo in ", manual: "**MODALITÀ ISTRUZIONI AGGIUNTIVE**: applica le istruzioni extra dell'utente alla fine senza violare le regole obbligatorie su paragrafi, ordine di lettura, pagine bianche, etichette e output.", original: "**LINGUA ORIGINALE**: conserva la lingua originale del documento.", target: "**LINGUA DI DESTINAZIONE**: il testo deve essere in ", manualLanguage: "**LINGUA**: conserva la lingua originale salvo richiesta esplicita di un'altra lingua.", json: "**SOLO JSON**: restituisci JSON rigorosamente valido, senza Markdown né testo conversazionale.",
  paragraph: "**INTERRUZIONI REALI DI PARAGRAFO**: inserisci una nuova riga solo per un vero cambio di paragrafo, non per il ritorno visivo.", join: "**UNISCI NATURALMENTE LE RIGHE SPEZZATE** nello stesso paragrafo con spaziatura normale.", hyphen: "**RICOSTRUISCI LE PAROLE CON TRATTINO**: elimina ritorno a capo e trattino quando la parola continua nella riga seguente.", singleRewrite: "**RISCRITTURA A COLONNA SINGOLA**: riscrivi come documento pulito a colonna singola, conservando struttura reale e ordine di lettura.",
  refsKeep: "Conserva citazioni e riferimenti esattamente come nella fonte.", refsRemove: "Nei blocchi MAIN_TEXT ometti citazioni accademiche, come (Autore, Anno), (Autore, Anno: pagina), (COGNOME, 1908: p. 104), (Autore et al., Anno), (Autore e Autore, Anno) e formati APA, MLA o Chicago tra parentesi. Saltale completamente e mantieni naturale la frase.", indent: "**L'INDENTAZIONE DEFINISCE I PARAGRAFI**: una prima riga chiaramente più a destra inizia un nuovo paragrafo; non unirla mai al precedente.", single: "**COLONNA SINGOLA**: l'intera area visibile è UNA colonna. Leggi dall'alto verso il basso e non dividerla.", multi: "**ORDINE DI LETTURA MULTICOLONNA (OBBLIGATORIO)**: completa la colonna sinistra dall'alto verso il basso prima della successiva a destra; non leggere orizzontalmente.\n**NON ATTRAVERSARE LO SPAZIO TRA LE COLONNE**: non fondere colonne né continuare frasi attraverso la separazione.",
  blank: "0. **Classifica le pagine bianche**: senza contenuto leggibile imposta \"blankPage\" su true e restituisci \"blocks\" vuoto.", reading: "1. **Ordine di lettura**: determina l'ordine corretto e rileva prima le colonne.", extract: "2. **Estrai il testo** applicando le regole su paragrafi e ricostruzione.", segment: "3. **Segmenta in blocchi**: raggruppa paragrafi coerenti e inizia un blocco a ogni cambio reale; non dividere MAIN_TEXT senza necessità.", labels: "4. **Etichetta ogni blocco** con una di queste etichette:", roles: "   - **TITLE**: titoli e intestazioni.\n   - **MAIN_TEXT**: corpo principale.\n   - **FOOTNOTE**: note a piè di pagina e riferimenti.\n   - **HEADER**: testo ripetuto in alto.\n   - **FOOTER**: testo ripetuto in basso.\n   - **CAPTION**: descrizione di immagini o tabelle.", ambiguity: "5. **Ambiguità**: senza titolo chiaro usa MAIN_TEXT; separa rigorosamente HEADER e FOOTER.", output: "**FORMATO DELL'OUTPUT:**", schema: "Restituisci un oggetto JSON valido:\n{\n  \"blankPage\": false,\n  \"blocks\": [{ \"text\": \"Contenuto del blocco…\", \"label\": \"MAIN_TEXT\", \"box_2d\": [ymin, xmin, ymax, xmax] }]\n}", box: "Usa coordinate normalizzate 0–1000 in \"box_2d\" quando possibile.", additional: "**ISTRUZIONI AGGIUNTIVE DELL'UTENTE:**", precedence: "Sono istruzioni additive; in caso di conflitto prevalgono le regole obbligatorie di OCR e layout.", textIntro: "Sei un'IA OCR. Trascrivi il testo dell'immagine.", textOnly: "**SOLO TESTO**: restituisci solo la trascrizione, senza commenti, titoli inventati, JSON o codice.", textParagraph: "**INTERRUZIONI REALI DI PARAGRAFO**: separa i paragrafi con una riga vuota e non spezzare le righe per il ritorno visivo.", textJoin: "**UNISCI LE RIGHE SPEZZATE** e **RICOSTRUISCI LE PAROLE CON TRATTINO** a fine riga.", textBlank: "8. Se la pagina è bianca o senza testo leggibile, restituisci una stringa vuota.",
};
OCR_LOCALIZED_COPY.tr = {
  user: "Bu görüntüdeki metni belirtilen kurallara tam olarak uyarak yazıya dökün.", intro: "İleri düzey bir belge düzeni analiz yapay zekâsısınız. Sağlanan belge görüntüsünde OCR ve düzen bölümleme yapın.", critical: "**KRİTİK TALİMATLAR:**", steps: "**ADIMLAR:**", rules: "**KURALLAR:**", referencesHeading: "**KAYNAKLAR**",
  literal: "**BİREBİR ÇIKARIM**: metni görüntüde göründüğü gibi çıkarın. **ÇEVİRMEYİN**. **ÖZETLEMEYİN**. **YORUM EKLEMEYİN**.", translation: "**ÇEVİRİ**: metni çıkarın ve ", manual: "**EK TALİMATLAR MODU**: sondaki kullanıcı talimatlarını paragraf, okuma sırası, boş sayfa, etiketleme ve çıktı kurallarını ihlal etmeden uygulayın.", original: "**ÖZGÜN DİL**: metni belgenin özgün dilinde tutun.", target: "**HEDEF DİL**: metin ", manualLanguage: "**DİL**: ek talimatlar açıkça başka dil istemedikçe özgün dili koruyun.", json: "**SADECE JSON**: Markdown veya konuşma metni olmadan kesinlikle geçerli JSON döndürün.",
  paragraph: "**GERÇEK PARAGRAF SONLARI**: yalnızca gerçek paragraf değişiminde satır sonu ekleyin; görsel satır kaymasını izlemeyin.", join: "**BÖLÜNMÜŞ SATIRLARI DOĞAL BİÇİMDE BİRLEŞTİRİN** ve aynı paragrafta normal boşluk kullanın.", hyphen: "**TİRE İLE BÖLÜNMÜŞ KELİMELERİ YENİDEN OLUŞTURUN**: kelime sonraki satırda sürüyorsa satır sonunu ve tireyi kaldırın.", singleRewrite: "**TEK SÜTUNLU YENİDEN YAZIM**: gerçek paragraf yapısını ve okuma sırasını koruyarak temiz, tek sütunlu belge olarak yazın.",
  refsKeep: "Alıntıları ve kaynakları kaynakta göründükleri gibi koruyun.", refsRemove: "MAIN_TEXT bloklarında metin içi akademik alıntıları, örneğin (Yazar, Yıl), (Yazar, Yıl: sayfa), (SOYADI, 1908: s. 104), (Yazar et al., Yıl), (Yazar ve Yazar, Yıl) ve parantez içindeki APA, MLA veya Chicago biçimlerini atlayın. Tamamen atlayıp cümle akışını koruyun.", indent: "**GİRİNTİ PARAGRAFLARI BELİRLER**: ilk satır açıkça daha sağda başlıyorsa yeni paragraf başlatın; girintili satırı öncekiyle birleştirmeyin.", single: "**TEK SÜTUN**: görünen alanın tamamı BİR sütundur. Yukarıdan aşağı okuyun ve bölmeyin.", multi: "**ÇOK SÜTUNLU OKUMA SIRASI (ZORUNLU)**: sağdaki sütuna geçmeden önce sol sütunu yukarıdan aşağı bitirin; yatay okumayın.\n**SÜTUNLAR ARASINDAKİ BOŞLUĞU GEÇMEYİN**: sütunları birleştirmeyin veya cümleyi boşluk üzerinden sürdürmeyin.",
  blank: "0. **Boş sayfaları sınıflandırın**: okunabilir içerik yoksa \"blankPage\" değerini true yapın ve boş \"blocks\" döndürün.", reading: "1. **Okuma sırası**: doğru sırayı belirleyin ve önce sütun yapısını algılayın.", extract: "2. **Metni çıkarın**: yukarıdaki paragraf ve yeniden oluşturma kurallarını uygulayın.", segment: "3. **Bloklara ayırın**: tutarlı paragrafları gruplayın; gerçek değişimde yeni blok başlatın; MAIN_TEXT'i gereksiz bölmeyin.", labels: "4. **Her bloğu** şu etiketlerden biriyle etiketleyin:", roles: "   - **TITLE**: başlıklar ve bölüm başlıkları.\n   - **MAIN_TEXT**: ana gövde.\n   - **FOOTNOTE**: dipnotlar ve kaynaklar.\n   - **HEADER**: üstte tekrarlanan metin.\n   - **FOOTER**: altta tekrarlanan metin.\n   - **CAPTION**: görsel veya tablo açıklaması.", ambiguity: "5. **Belirsizlik**: açık başlık yoksa MAIN_TEXT kullanın; HEADER ve FOOTER'ı ayırın.", output: "**ÇIKTI BİÇİMİ:**", schema: "Şu yapıya sahip geçerli JSON döndürün:\n{\n  \"blankPage\": false,\n  \"blocks\": [{ \"text\": \"Blok içeriği…\", \"label\": \"MAIN_TEXT\", \"box_2d\": [ymin, xmin, ymax, xmax] }]\n}", box: "Mümkünse \"box_2d\" içinde 0–1000 arası normalleştirilmiş koordinatlar kullanın.", additional: "**EK KULLANICI TALİMATLARI:**", precedence: "Bunlar yalnızca ek talimatlardır; çelişki hâlinde zorunlu OCR ve düzen kuralları geçerlidir.", textIntro: "Siz bir OCR yapay zekâsısınız. Belge görüntüsündeki metni yazıya dökün.", textOnly: "**YALNIZCA METİN**: yalnızca transkripti döndürün; yorum, uydurma başlık, JSON veya kod eklemeyin.", textParagraph: "**GERÇEK PARAGRAF SONLARI**: paragrafları boş satırla ayırın; görsel kaydırma nedeniyle satırları kesmeyin.", textJoin: "**BÖLÜNMÜŞ SATIRLARI BİRLEŞTİRİN** ve satır sonunda **TİRE İLE BÖLÜNMÜŞ KELİMELERİ YENİDEN OLUŞTURUN**.", textBlank: "8. Sayfa boşsa veya okunabilir metin yoksa boş bir dize döndürün.",
};

export function buildLocalizedOcrSystemPrompt(o: OcrOptions): string {
  if ((o.promptLanguage ?? 'es') === 'es') return buildOcrSystemPrompt(o);
  const copy = OCR_LOCALIZED_COPY[o.promptLanguage as Exclude<PromptLanguage, 'es'>] ?? OCR_LOCALIZED_COPY.en;
  const translationSuffix = OCR_TRANSLATION_SUFFIX[o.promptLanguage ?? 'en'] ?? OCR_TRANSLATION_SUFFIX.en;
  const extraction = o.processingMode === 'translation' && o.targetLanguage
    ? copy.translation + o.targetLanguage + '.' + translationSuffix
    : o.processingMode === 'manual' ? copy.manual : copy.literal;
  const language = o.processingMode === 'translation' && o.targetLanguage
    ? copy.target + o.targetLanguage + '.'
    : o.processingMode === 'manual' ? copy.manualLanguage : copy.original;
  const refs = o.removeReferences ? copy.refsRemove : copy.refsKeep;
  const columns = o.singleColumn ? copy.single : copy.multi;
  const extra = o.processingMode === 'manual' && o.customPrompt?.trim()
    ? `\n\n${copy.additional}\n${o.customPrompt.trim()}\n\n${copy.precedence}` : '';
  const conflict = o.singleColumn ? '' : ` ${OCR_LAYOUT_CONFLICT[o.promptLanguage ?? 'en'] ?? OCR_LAYOUT_CONFLICT.en}`;
  const coordinates = OCR_COORDINATES_RULE[o.promptLanguage ?? 'en'] ?? OCR_COORDINATES_RULE.en;
  return `${copy.intro}\n\n${copy.critical}\n1. ${extraction}\n2. ${language}\n3. ${copy.json}\n4. ${copy.paragraph}\n5. ${copy.join}\n6. ${copy.hyphen}\n7. ${copy.singleRewrite}\n8. ${copy.referencesHeading}: ${refs}\n9. ${copy.indent}\n10. ${columns}\n\n${copy.steps}\n${copy.blank}\n${copy.reading}\n${copy.extract}\n${copy.segment}\n${copy.labels}\n${copy.roles}\n${copy.ambiguity}${conflict} ${coordinates}\n\n${copy.output}\n${copy.schema}\n${copy.box}${extra}`;
}

export function buildLocalizedOcrTextPrompt(o: OcrOptions): string {
  if ((o.promptLanguage ?? 'es') === 'es') return buildOcrTextPrompt(o);
  const copy = OCR_LOCALIZED_COPY[o.promptLanguage as Exclude<PromptLanguage, 'es'>] ?? OCR_LOCALIZED_COPY.en;
  const translationSuffix = OCR_TRANSLATION_SUFFIX[o.promptLanguage ?? 'en'] ?? OCR_TRANSLATION_SUFFIX.en;
  const extraction = o.processingMode === 'translation' && o.targetLanguage
    ? copy.translation + o.targetLanguage + '.' + translationSuffix
    : o.processingMode === 'manual' ? copy.manual : copy.literal;
  const language = o.processingMode === 'translation' && o.targetLanguage
    ? copy.target + o.targetLanguage + '.'
    : o.processingMode === 'manual' ? copy.manualLanguage : copy.original;
  const refs = o.removeReferences ? copy.refsRemove : copy.refsKeep;
  const columns = o.singleColumn ? copy.single : copy.multi;
  const extra = o.processingMode === 'manual' && o.customPrompt?.trim()
    ? `\n\n${copy.additional}\n${o.customPrompt.trim()}\n\n${copy.precedence}` : '';
  return `${copy.textIntro}\n\n${copy.rules}\n1. ${extraction}\n2. ${language}\n3. ${copy.textOnly}\n4. ${copy.textParagraph}\n5. ${copy.textJoin}\n6. ${copy.referencesHeading}: ${refs}\n7. ${columns}\n${copy.textBlank}${extra}`;
}
