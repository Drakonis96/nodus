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

const OCR_LOCALIZED_COPY: Record<Exclude<PromptLanguage, 'es'>, LocalizedOcrCopy> = {
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
  // Italian and Turkish are kept as explicit full copies as well.  They must not
  // inherit the English contract: every layout rule is repeated in the locale.
  it: {
  user: "Trascrivi il testo di questa immagine seguendo esattamente le regole indicate.", intro: "Sei un'IA avanzata per l'analisi del layout dei documenti. Esegui OCR e segmentazione del layout sull'immagine fornita.", critical: "**ISTRUZIONI CRITICHE:**", steps: "**PASSAGGI:**", rules: "**REGOLE:**", referencesHeading: "**RIFERIMENTI**",
  literal: "**ESTRAZIONE LETTERALE**: estrai il testo esattamente come appare. **NON TRADURRE**. **NON RIASSUMERE**. **NON AGGIUNGERE COMMENTI**.", translation: "**TRADUZIONE**: estrai il testo e traducilo in ", manual: "**MODALITÀ ISTRUZIONI AGGIUNTIVE**: applica le istruzioni extra dell'utente alla fine senza violare le regole obbligatorie su paragrafi, ordine di lettura, pagine bianche, etichette e output.", original: "**LINGUA ORIGINALE**: conserva la lingua originale del documento.", target: "**LINGUA DI DESTINAZIONE**: il testo deve essere in ", manualLanguage: "**LINGUA**: conserva la lingua originale salvo richiesta esplicita di un'altra lingua.", json: "**SOLO JSON**: restituisci JSON rigorosamente valido, senza Markdown né testo conversazionale.",
  paragraph: "**INTERRUZIONI REALI DI PARAGRAFO**: inserisci una nuova riga solo per un vero cambio di paragrafo, non per il ritorno visivo.", join: "**UNISCI NATURALMENTE LE RIGHE SPEZZATE** nello stesso paragrafo con spaziatura normale.", hyphen: "**RICOSTRUISCI LE PAROLE CON TRATTINO**: elimina ritorno a capo e trattino quando la parola continua nella riga seguente.", singleRewrite: "**RISCRITTURA A COLONNA SINGOLA**: riscrivi come documento pulito a colonna singola, conservando struttura reale e ordine di lettura.",
  refsKeep: "Conserva citazioni e riferimenti esattamente come nella fonte.", refsRemove: "Nei blocchi MAIN_TEXT ometti citazioni accademiche, come (Autore, Anno), (Autore, Anno: pagina), (COGNOME, 1908: p. 104), (Autore et al., Anno), (Autore e Autore, Anno) e formati APA, MLA o Chicago tra parentesi. Saltale completamente e mantieni naturale la frase.", indent: "**L'INDENTAZIONE DEFINISCE I PARAGRAFI**: una prima riga chiaramente più a destra inizia un nuovo paragrafo; non unirla mai al precedente.", single: "**COLONNA SINGOLA**: l'intera area visibile è UNA colonna. Leggi dall'alto verso il basso e non dividerla.", multi: "**ORDINE DI LETTURA MULTICOLONNA (OBBLIGATORIO)**: completa la colonna sinistra dall'alto verso il basso prima della successiva a destra; non leggere orizzontalmente.\n**NON ATTRAVERSARE LO SPAZIO TRA LE COLONNE**: non fondere colonne né continuare frasi attraverso la separazione.",
  blank: "0. **Classifica le pagine bianche**: senza contenuto leggibile imposta \"blankPage\" su true e restituisci \"blocks\" vuoto.", reading: "1. **Ordine di lettura**: determina l'ordine corretto e rileva prima le colonne.", extract: "2. **Estrai il testo** applicando le regole su paragrafi e ricostruzione.", segment: "3. **Segmenta in blocchi**: raggruppa paragrafi coerenti e inizia un blocco a ogni cambio reale; non dividere MAIN_TEXT senza necessità.", labels: "4. **Etichetta ogni blocco** con una di queste etichette:", roles: "   - **TITLE**: titoli e intestazioni.\n   - **MAIN_TEXT**: corpo principale.\n   - **FOOTNOTE**: note a piè di pagina e riferimenti.\n   - **HEADER**: testo ripetuto in alto.\n   - **FOOTER**: testo ripetuto in basso.\n   - **CAPTION**: descrizione di immagini o tabelle.", ambiguity: "5. **Ambiguità**: senza titolo chiaro usa MAIN_TEXT; separa rigorosamente HEADER e FOOTER.", output: "**FORMATO DELL'OUTPUT:**", schema: "Restituisci un oggetto JSON valido:\n{\n  \"blankPage\": false,\n  \"blocks\": [{ \"text\": \"Contenuto del blocco…\", \"label\": \"MAIN_TEXT\", \"box_2d\": [ymin, xmin, ymax, xmax] }]\n}", box: "Usa coordinate normalizzate 0–1000 in \"box_2d\" quando possibile.", additional: "**ISTRUZIONI AGGIUNTIVE DELL'UTENTE:**", precedence: "Sono istruzioni additive; in caso di conflitto prevalgono le regole obbligatorie di OCR e layout.", textIntro: "Sei un'IA OCR. Trascrivi il testo dell'immagine.", textOnly: "**SOLO TESTO**: restituisci solo la trascrizione, senza commenti, titoli inventati, JSON o codice.", textParagraph: "**INTERRUZIONI REALI DI PARAGRAFO**: separa i paragrafi con una riga vuota e non spezzare le righe per il ritorno visivo.", textJoin: "**UNISCI LE RIGHE SPEZZATE** e **RICOSTRUISCI LE PAROLE CON TRATTINO** a fine riga.", textBlank: "8. Se la pagina è bianca o senza testo leggibile, restituisci una stringa vuota.",
  },
  tr: {
  user: "Bu görüntüdeki metni belirtilen kurallara tam olarak uyarak yazıya dökün.", intro: "İleri düzey bir belge düzeni analiz yapay zekâsısınız. Sağlanan belge görüntüsünde OCR ve düzen bölümleme yapın.", critical: "**KRİTİK TALİMATLAR:**", steps: "**ADIMLAR:**", rules: "**KURALLAR:**", referencesHeading: "**KAYNAKLAR**",
  literal: "**BİREBİR ÇIKARIM**: metni görüntüde göründüğü gibi çıkarın. **ÇEVİRMEYİN**. **ÖZETLEMEYİN**. **YORUM EKLEMEYİN**.", translation: "**ÇEVİRİ**: metni çıkarın ve ", manual: "**EK TALİMATLAR MODU**: sondaki kullanıcı talimatlarını paragraf, okuma sırası, boş sayfa, etiketleme ve çıktı kurallarını ihlal etmeden uygulayın.", original: "**ÖZGÜN DİL**: metni belgenin özgün dilinde tutun.", target: "**HEDEF DİL**: metin ", manualLanguage: "**DİL**: ek talimatlar açıkça başka dil istemedikçe özgün dili koruyun.", json: "**SADECE JSON**: Markdown veya konuşma metni olmadan kesinlikle geçerli JSON döndürün.",
  paragraph: "**GERÇEK PARAGRAF SONLARI**: yalnızca gerçek paragraf değişiminde satır sonu ekleyin; görsel satır kaymasını izlemeyin.", join: "**BÖLÜNMÜŞ SATIRLARI DOĞAL BİÇİMDE BİRLEŞTİRİN** ve aynı paragrafta normal boşluk kullanın.", hyphen: "**TİRE İLE BÖLÜNMÜŞ KELİMELERİ YENİDEN OLUŞTURUN**: kelime sonraki satırda sürüyorsa satır sonunu ve tireyi kaldırın.", singleRewrite: "**TEK SÜTUNLU YENİDEN YAZIM**: gerçek paragraf yapısını ve okuma sırasını koruyarak temiz, tek sütunlu belge olarak yazın.",
  refsKeep: "Alıntıları ve kaynakları kaynakta göründükleri gibi koruyun.", refsRemove: "MAIN_TEXT bloklarında metin içi akademik alıntıları, örneğin (Yazar, Yıl), (Yazar, Yıl: sayfa), (SOYADI, 1908: s. 104), (Yazar et al., Yıl), (Yazar ve Yazar, Yıl) ve parantez içindeki APA, MLA veya Chicago biçimlerini atlayın. Tamamen atlayıp cümle akışını koruyun.", indent: "**GİRİNTİ PARAGRAFLARI BELİRLER**: ilk satır açıkça daha sağda başlıyorsa yeni paragraf başlatın; girintili satırı öncekiyle birleştirmeyin.", single: "**TEK SÜTUN**: görünen alanın tamamı BİR sütundur. Yukarıdan aşağı okuyun ve bölmeyin.", multi: "**ÇOK SÜTUNLU OKUMA SIRASI (ZORUNLU)**: sağdaki sütuna geçmeden önce sol sütunu yukarıdan aşağı bitirin; yatay okumayın.\n**SÜTUNLAR ARASINDAKİ BOŞLUĞU GEÇMEYİN**: sütunları birleştirmeyin veya cümleyi boşluk üzerinden sürdürmeyin.",
  blank: "0. **Boş sayfaları sınıflandırın**: okunabilir içerik yoksa \"blankPage\" değerini true yapın ve boş \"blocks\" döndürün.", reading: "1. **Okuma sırası**: doğru sırayı belirleyin ve önce sütun yapısını algılayın.", extract: "2. **Metni çıkarın**: yukarıdaki paragraf ve yeniden oluşturma kurallarını uygulayın.", segment: "3. **Bloklara ayırın**: tutarlı paragrafları gruplayın; gerçek değişimde yeni blok başlatın; MAIN_TEXT'i gereksiz bölmeyin.", labels: "4. **Her bloğu** şu etiketlerden biriyle etiketleyin:", roles: "   - **TITLE**: başlıklar ve bölüm başlıkları.\n   - **MAIN_TEXT**: ana gövde.\n   - **FOOTNOTE**: dipnotlar ve kaynaklar.\n   - **HEADER**: üstte tekrarlanan metin.\n   - **FOOTER**: altta tekrarlanan metin.\n   - **CAPTION**: görsel veya tablo açıklaması.", ambiguity: "5. **Belirsizlik**: açık başlık yoksa MAIN_TEXT kullanın; HEADER ve FOOTER'ı ayırın.", output: "**ÇIKTI BİÇİMİ:**", schema: "Şu yapıya sahip geçerli JSON döndürün:\n{\n  \"blankPage\": false,\n  \"blocks\": [{ \"text\": \"Blok içeriği…\", \"label\": \"MAIN_TEXT\", \"box_2d\": [ymin, xmin, ymax, xmax] }]\n}", box: "Mümkünse \"box_2d\" içinde 0–1000 arası normalleştirilmiş koordinatlar kullanın.", additional: "**EK KULLANICI TALİMATLARI:**", precedence: "Bunlar yalnızca ek talimatlardır; çelişki hâlinde zorunlu OCR ve düzen kuralları geçerlidir.", textIntro: "Siz bir OCR yapay zekâsısınız. Belge görüntüsündeki metni yazıya dökün.", textOnly: "**YALNIZCA METİN**: yalnızca transkripti döndürün; yorum, uydurma başlık, JSON veya kod eklemeyin.", textParagraph: "**GERÇEK PARAGRAF SONLARI**: paragrafları boş satırla ayırın; görsel kaydırma nedeniyle satırları kesmeyin.", textJoin: "**BÖLÜNMÜŞ SATIRLARI BİRLEŞTİRİN** ve satır sonunda **TİRE İLE BÖLÜNMÜŞ KELİMELERİ YENİDEN OLUŞTURUN**.",   textBlank: "8. Sayfa boşsa veya okunabilir metin yoksa boş bir dize döndürün.",
  },
  'zh-Hans': {
    user: "请严格按照所述规则转录此图像中的文本。",
    intro: "你是一名先进的文档版面分析 AI。你的任务是对所提供的文档图像执行 OCR 和版面分割。",
    critical: "**关键指令：**", steps: "**步骤：**", rules: "**规则：**", referencesHeading: "**参考文献**",
    literal: "**逐字提取**：完全按照图像中呈现的样子提取文本。**不要翻译**。**不要总结**。**不要添加评论**。",
    translation: "**翻译**：提取文本并将其翻译为",
    manual: "**附加指令模式**：应用文末包含的用户附加指令，但绝不得违反有关段落重建、阅读顺序、空白页检测、标注和输出的强制规则。",
    original: "**原始语言**：文本必须保持文档的原始语言。",
    target: "**目标语言**：文本最终必须为",
    manualLanguage: "**语言**：保留原始语言，除非附加指令明确要求其他目标语言。",
    json: "**仅限 JSON**：返回严格有效的 JSON。不要包含 Markdown 格式或对话式文本。",
    paragraph: "**真实段落分隔**：绝不要仅仅因为源文本换到新的视觉行就插入换行。仅当文档显示真正的段落变化时才插入新行。",
    join: "**自然衔接换行**：如果一句话在同一段落内延续到下一视觉行，请用正常间距将其合并为一个连续的句子。",
    hyphen: "**重建连字符断词**：如果单词在行末被连字符断开并在下一行继续，请删除换行和连字符，重建完整的单词。",
    singleRewrite: "**单栏重写**：不要复制精确的视觉版面、换行或整页流向。在保留真实段落结构的前提下，将内容重写为干净的单栏文档。",
    refsKeep: "保留文本中的引用和参考文献，与来源中完全一致。",
    refsRemove: "提取 MAIN_TEXT 块时，省略正文中的学术引用，例如：\n    - （作者，年份）\n    - （作者，年份：页码）\n    - （姓氏，1908：第 104 页）\n    - （作者等，年份）\n    - （作者与作者，年份）\n    - APA、MLA、Chicago 或类似的括号格式\n    完全跳过这些引用，并保持句子自然流畅。",
    indent: "**缩进定义段落**：将首行缩进视为决定性的段落信号。如果某行的起始位置明显位于上一段左边距的右侧，则开始新段落。绝不要把缩进行与上一段合并。",
    single: "**单栏**：此图像是从多栏页面中裁切出的一栏。整个可见区域是一栏文本。请从上到下阅读。不要检测或拆分为多栏：只有一栏。",
    multi: "**多栏阅读顺序（强制）**：转录之前，先判断页面有一栏还是多个分隔的栏。如果有多个栏，请先从上到下读完整个左栏，再移到右侧的下一栏。绝不要横向跨整页宽度阅读。\n**不要跨越栏间沟槽**：宽阔的垂直间隙或明显的分隔表示不同的栏。不要把相邻栏的文本合并到同一段落中，也不要跨越沟槽延续句子。",
    blank: "0. **空白页分类**：如果页面为空白，或仅包含扫描伪影、污渍或边缘噪点而没有可读内容，请将 \"blankPage\" 设为 true，并返回空的 \"blocks\" 数组。",
    reading: "1. **阅读顺序**：转录前先确定正确的阅读顺序；先检测栏结构。",
    extract: "2. **提取文本**：应用上述段落和重建规则读取全部文本。",
    segment: "3. **分割为块**：将连续文本归并为连贯的段落或逻辑块。当源文本出现真正的段落变化时开始新块。除非必要，不要把一个 MAIN_TEXT 段落拆分为多个块。",
    labels: "4. **为每个块添加标签**，使用以下标签之一：",
    roles: "   - **TITLE**：标题、副标题和章节标题（字号较大、加粗、居中或位于章节开头的短行）。\n   - **MAIN_TEXT**：文档的主体正文。\n   - **FOOTNOTE**：脚注，通常带有小号数字/上标或文献引用（Ibid, Op. cit.）。\n   - **HEADER**：顶部重复出现的文本（页码、章节标题）。\n   - **FOOTER**：底部重复出现的文本（页码、书名）。\n   - **CAPTION**：描述图像或表格的文本。",
    ambiguity: "5. **歧义**：如果没有明确的标题，则标注为 MAIN_TEXT。严格区分 HEADER、FOOTER 与 MAIN_TEXT。",
    output: "**输出格式：**",
    schema: "返回具有以下结构的有效 JSON 对象：\n{\n  \"blankPage\": false,\n  \"blocks\": [\n    { \"text\": \"块内容…\", \"label\": \"MAIN_TEXT\", \"box_2d\": [ymin, xmin, ymax, xmax] }\n  ]\n}",
    box: "尽量在 \"box_2d\" 中使用 0–1000 的归一化坐标。",
    additional: "**用户的附加指令：**",
    precedence: "这些指令仅作补充。如果它们与上述强制的 OCR 和版面规则冲突，以强制规则为准。",
    textIntro: "你是一名 OCR AI。请转录文档图像中的文本。",
    textOnly: "**仅限文本**：只返回转录的文本。不要添加评论、凭空编造的标题、JSON 或代码块。",
    textParagraph: "**真实段落分隔**：用空行分隔段落。不要因视觉换行而断开同一段落内的行。",
    textJoin: "**衔接换行**并**重建行末的连字符断词**。",
    textBlank: "8. 如果页面为空白或没有可读文本，返回空字符串。",
  },
  'zh-Hant': {
    user: "請嚴格按照所述規則轉錄此圖像中的文字。",
    intro: "你是一名先進的文件版面分析 AI。你的任務是對所提供的文件圖像執行 OCR 與版面分割。",
    critical: "**關鍵指示：**", steps: "**步驟：**", rules: "**規則：**", referencesHeading: "**參考文獻**",
    literal: "**逐字擷取**：完全按照圖像中呈現的樣子擷取文字。**不要翻譯**。**不要摘要**。**不要新增評論**。",
    translation: "**翻譯**：擷取文字並將其翻譯為",
    manual: "**附加指示模式**：套用文末包含的使用者附加指示，但絕不得違反有關段落重建、閱讀順序、空白頁偵測、標註與輸出的強制規則。",
    original: "**原始語言**：文字必須保持文件的原始語言。",
    target: "**目標語言**：文字最終必須為",
    manualLanguage: "**語言**：保留原始語言，除非附加指示明確要求其他目標語言。",
    json: "**僅限 JSON**：傳回嚴格有效的 JSON。不要包含 Markdown 格式或對話式文字。",
    paragraph: "**真實段落分隔**：絕不要僅因為來源文字換到新的視覺行就插入換行。僅當文件顯示真正的段落變化時才插入新行。",
    join: "**自然銜接換行**：如果一句話在同一段落內延續到下一視覺行，請以正常間距將其合併為一個連續的句子。",
    hyphen: "**重建連字號斷詞**：如果詞語在行末被連字號斷開並在下一行繼續，請刪除換行與連字號，重建完整的詞語。",
    singleRewrite: "**單欄重寫**：不要複製精確的視覺版面、換行或整頁流向。在保留真實段落結構的前提下，將內容重寫為乾淨的單欄文件。",
    refsKeep: "保留文字中的引用與參考文獻，與來源中完全一致。",
    refsRemove: "擷取 MAIN_TEXT 區塊時，省略正文中的學術引用，例如：\n    - （作者，年份）\n    - （作者，年份：頁碼）\n    - （姓氏，1908：第 104 頁）\n    - （作者等，年份）\n    - （作者與作者，年份）\n    - APA、MLA、Chicago 或類似的括號格式\n    完全略過這些引用，並保持句子自然流暢。",
    indent: "**縮排定義段落**：將首行縮排視為決定性的段落訊號。如果某行的起始位置明顯位於上一段左邊界的右側，則開始新段落。絕不要把縮排行與上一段合併。",
    single: "**單欄**：此圖像是從多欄頁面中裁切出的一欄。整個可見區域是一欄文字。請由上而下閱讀。不要偵測或拆分為多欄：只有一欄。",
    multi: "**多欄閱讀順序（強制）**：轉錄之前，先判斷頁面有一欄還是多個分隔的欄。如果有多個欄，請先由上而下讀完整個左欄，再移到右側的下一欄。絕不要橫向跨整頁寬度閱讀。\n**不要跨越欄間溝槽**：寬闊的垂直間隙或明顯的分隔表示不同的欄。不要把相鄰欄的文字合併到同一段落中，也不要跨越溝槽延續句子。",
    blank: "0. **空白頁分類**：如果頁面為空白，或僅包含掃描偽影、污漬或邊緣雜訊而沒有可讀內容，請將 \"blankPage\" 設為 true，並傳回空的 \"blocks\" 陣列。",
    reading: "1. **閱讀順序**：轉錄前先確定正確的閱讀順序；先偵測欄結構。",
    extract: "2. **擷取文字**：套用上述段落與重建規則讀取全部文字。",
    segment: "3. **分割為區塊**：將連續文字歸併為連貫的段落或邏輯區塊。當來源出現真正的段落變化時開始新區塊。除非必要，不要把一個 MAIN_TEXT 段落拆分為多個區塊。",
    labels: "4. **為每個區塊加上標籤**，使用以下標籤之一：",
    roles: "   - **TITLE**：標題、副標題與章節標題（字級較大、粗體、置中或位於章節開頭的短行）。\n   - **MAIN_TEXT**：文件的主體正文。\n   - **FOOTNOTE**：註腳，通常帶有小號數字/上標或文獻引用（Ibid, Op. cit.）。\n   - **HEADER**：頂端重複出現的文字（頁碼、章節標題）。\n   - **FOOTER**：底部重複出現的文字（頁碼、書名）。\n   - **CAPTION**：描述圖像或表格的文字。",
    ambiguity: "5. **歧義**：如果沒有明確的標題，則標註為 MAIN_TEXT。嚴格區分 HEADER、FOOTER 與 MAIN_TEXT。",
    output: "**輸出格式：**",
    schema: "傳回具有以下結構的有效 JSON 物件：\n{\n  \"blankPage\": false,\n  \"blocks\": [\n    { \"text\": \"區塊內容…\", \"label\": \"MAIN_TEXT\", \"box_2d\": [ymin, xmin, ymax, xmax] }\n  ]\n}",
    box: "盡量在 \"box_2d\" 中使用 0–1000 的正規化座標。",
    additional: "**使用者的附加指示：**",
    precedence: "這些指示僅作補充。如果它們與上述強制的 OCR 與版面規則衝突，以強制規則為準。",
    textIntro: "你是一名 OCR AI。請轉錄文件圖像中的文字。",
    textOnly: "**僅限文字**：只傳回轉錄的文字。不要新增評論、憑空編造的標題、JSON 或程式碼區塊。",
    textParagraph: "**真實段落分隔**：以空行分隔段落。不要因視覺換行而斷開同一段落內的行。",
    textJoin: "**銜接換行**並**重建行末的連字號斷詞**。",
    textBlank: "8. 如果頁面為空白或沒有可讀文字，傳回空字串。",
  },
  vi: {
    user: "Hãy chép lại văn bản trong hình ảnh này, tuân thủ chính xác các quy tắc đã nêu.",
    intro: "Bạn là một AI phân tích bố cục tài liệu tiên tiến. Nhiệm vụ của bạn là thực hiện OCR và phân đoạn bố cục trên hình ảnh tài liệu được cung cấp.",
    critical: "**HƯỚNG DẪN QUAN TRỌNG:**", steps: "**CÁC BƯỚC:**", rules: "**QUY TẮC:**", referencesHeading: "**TÀI LIỆU THAM KHẢO**",
    literal: "**TRÍCH XUẤT NGUYÊN VĂN**: trích xuất văn bản đúng như xuất hiện trong hình ảnh. **KHÔNG DỊCH**. **KHÔNG TÓM TẮT**. **KHÔNG THÊM NHẬN XÉT**.",
    translation: "**DỊCH**: trích xuất văn bản và dịch sang ",
    manual: "**CHẾ ĐỘ HƯỚNG DẪN BỔ SUNG**: áp dụng các hướng dẫn bổ sung của người dùng ở cuối, nhưng tuyệt đối không vi phạm các quy tắc bắt buộc về tái tạo đoạn, thứ tự đọc, phát hiện trang trắng, gán nhãn và đầu ra.",
    original: "**NGÔN NGỮ GỐC**: văn bản phải giữ nguyên ngôn ngữ gốc của tài liệu.",
    target: "**NGÔN NGỮ ĐÍCH**: văn bản cuối cùng phải bằng ",
    manualLanguage: "**NGÔN NGỮ**: giữ nguyên ngôn ngữ gốc, trừ khi các hướng dẫn bổ sung yêu cầu rõ ràng một ngôn ngữ đích khác.",
    json: "**CHỈ JSON**: trả về JSON hợp lệ nghiêm ngặt. Không bao gồm định dạng Markdown hay văn bản hội thoại.",
    paragraph: "**NGẮT ĐOẠN THỰC SỰ**: tuyệt đối không chèn dấu xuống dòng chỉ vì văn bản nguồn chuyển sang một dòng hình ảnh mới. Chỉ chèn dòng mới khi tài liệu cho thấy sự thay đổi đoạn thực sự.",
    join: "**NỐI CÁC DÒNG BỊ NGẮT MỘT CÁCH TỰ NHIÊN**: nếu một câu tiếp tục ở dòng hình ảnh kế tiếp trong cùng một đoạn, hãy nối câu đó thành một câu liền mạch với khoảng cách bình thường.",
    hyphen: "**TÁI TẠO TỪ BỊ GẠCH NỐI**: nếu một từ bị gạch nối ở cuối dòng và tiếp tục ở dòng sau, hãy xóa dấu xuống dòng và gạch nối rồi tái tạo từ hoàn chỉnh.",
    singleRewrite: "**VIẾT LẠI THEO MỘT CỘT**: không tái tạo đúng bố cục hình ảnh, cách ngắt dòng hay dòng chảy trên toàn chiều rộng trang. Hãy viết lại nội dung như một tài liệu một cột sạch sẽ, đồng thời giữ nguyên cấu trúc đoạn thực sự.",
    refsKeep: "Giữ nguyên các trích dẫn và tài liệu tham khảo trong văn bản đúng như chúng xuất hiện trong nguồn.",
    refsRemove: "Khi trích xuất các khối MAIN_TEXT, hãy bỏ qua các trích dẫn học thuật trong văn bản, chẳng hạn như:\n    - (Tác giả, Năm)\n    - (Tác giả, Năm: trang)\n    - (HỌ, 1908: tr. 104)\n    - (Tác giả và cộng sự, Năm)\n    - (Tác giả và Tác giả, Năm)\n    - các định dạng APA, MLA, Chicago hoặc tương tự trong ngoặc đơn\n    Bỏ qua hoàn toàn các tài liệu tham khảo đó và giữ cho câu văn diễn đạt tự nhiên.",
    indent: "**THỤT LỀ XÁC ĐỊNH ĐOẠN**: coi thụt lề dòng đầu là tín hiệu đoạn mang tính quyết định. Nếu một dòng rõ ràng bắt đầu bên phải lề trái của đoạn trước, hãy bắt đầu một đoạn mới. Tuyệt đối không gộp dòng thụt lề với đoạn trước.",
    single: "**MỘT CỘT**: hình ảnh này là một cột được cắt từ một trang nhiều cột. Toàn bộ vùng nhìn thấy là MỘT cột văn bản. Hãy đọc từ trên xuống dưới. KHÔNG phát hiện hay chia thành nhiều cột: chỉ có một cột.",
    multi: "**THỨ TỰ ĐỌC NHIỀU CỘT (BẮT BUỘC)**: trước khi chép lại, hãy xác định trang có một hay nhiều cột tách biệt. Nếu có nhiều cột, hãy đọc hết toàn bộ cột trái từ trên xuống dưới trước khi chuyển sang cột tiếp theo bên phải. Tuyệt đối không đọc theo chiều ngang trên toàn bộ chiều rộng trang.\n**KHÔNG VƯỢT QUA RÃNH GIỮA CÁC CỘT**: khoảng trống dọc rộng hoặc sự tách biệt rõ ràng cho thấy các cột khác nhau. Không gộp văn bản từ các cột liền kề vào cùng một đoạn và không tiếp tục câu xuyên qua rãnh.",
    blank: "0. **Phân loại trang trắng**: nếu trang trắng hoặc chỉ chứa hiện tượng giả khi quét, vết bẩn hay nhiễu viền không có nội dung đọc được, hãy đặt \"blankPage\" thành true và trả về mảng \"blocks\" rỗng.",
    reading: "1. **Thứ tự đọc**: xác định thứ tự đọc đúng trước khi chép lại; phát hiện cấu trúc cột trước tiên.",
    extract: "2. **Trích xuất văn bản**: đọc toàn bộ văn bản, áp dụng các quy tắc về đoạn và tái tạo ở trên.",
    segment: "3. **Phân đoạn thành khối**: nhóm văn bản liên tục thành các đoạn mạch lạc hoặc khối logic. Bắt đầu khối mới khi nguồn cho thấy sự thay đổi đoạn thực sự. Không chia một đoạn MAIN_TEXT thành nhiều khối trừ khi cần thiết.",
    labels: "4. **Gán nhãn cho mỗi khối** bằng một trong các nhãn sau:",
    roles: "   - **TITLE**: tiêu đề, phụ đề và đề mục chương (cỡ chữ lớn hơn, in đậm, căn giữa hoặc dòng ngắn ở đầu một mục).\n   - **MAIN_TEXT**: phần thân chính của tài liệu.\n   - **FOOTNOTE**: chú thích cuối trang, thường có số/chỉ số trên nhỏ hoặc tài liệu tham khảo (Ibid, Op. cit.).\n   - **HEADER**: văn bản lặp lại ở đầu trang (số trang, tên chương).\n   - **FOOTER**: văn bản lặp lại ở cuối trang (số trang, tên sách).\n   - **CAPTION**: văn bản mô tả hình ảnh hoặc bảng.",
    ambiguity: "5. **Mơ hồ**: nếu không có tiêu đề rõ ràng, hãy gán nhãn MAIN_TEXT. Phân tách chặt chẽ HEADER và FOOTER khỏi MAIN_TEXT.",
    output: "**ĐỊNH DẠNG ĐẦU RA:**",
    schema: "Trả về một đối tượng JSON hợp lệ với cấu trúc sau:\n{\n  \"blankPage\": false,\n  \"blocks\": [\n    { \"text\": \"Nội dung khối…\", \"label\": \"MAIN_TEXT\", \"box_2d\": [ymin, xmin, ymax, xmax] }\n  ]\n}",
    box: "Sử dụng tọa độ chuẩn hóa 0–1000 trong \"box_2d\" khi có thể.",
    additional: "**HƯỚNG DẪN BỔ SUNG CỦA NGƯỜI DÙNG:**",
    precedence: "Các hướng dẫn này chỉ mang tính bổ sung. Nếu chúng xung đột với các quy tắc OCR và bố cục bắt buộc ở trên, các quy tắc bắt buộc sẽ được ưu tiên.",
    textIntro: "Bạn là một AI OCR. Hãy chép lại văn bản trong hình ảnh tài liệu.",
    textOnly: "**CHỈ VĂN BẢN**: chỉ trả về văn bản đã chép. Không thêm nhận xét, tiêu đề bịa đặt, JSON hay khối mã.",
    textParagraph: "**NGẮT ĐOẠN THỰC SỰ**: phân tách các đoạn bằng một dòng trống. Không ngắt dòng trong cùng một đoạn vì việc xuống dòng thị giác.",
    textJoin: "**NỐI CÁC DÒNG BỊ NGẮT** và **TÁI TẠO TỪ BỊ GẠCH NỐI** ở cuối dòng.",
    textBlank: "8. Nếu trang trắng hoặc không có văn bản đọc được, hãy trả về chuỗi rỗng.",
  },
  ja: {
    user: "この画像のテキストを、示された規則に厳密に従って文字起こししてください。",
    intro: "あなたは高度な文書レイアウト解析 AI です。提供された文書画像に対して OCR とレイアウトセグメンテーションを実行してください。",
    critical: "**重要な指示：**", steps: "**手順：**", rules: "**ルール：**", referencesHeading: "**参考文献**",
    literal: "**逐語的抽出**：画像に表示されているとおりにテキストを抽出してください。**翻訳しないでください**。**要約しないでください**。**コメントを追加しないでください**。",
    translation: "**翻訳**：テキストを抽出し、対象言語に翻訳してください：",
    manual: "**追加指示モード**：末尾に含まれるユーザーの追加指示を適用してください。ただし、段落の再構成、読み順、空白ページの検出、ラベル付け、出力に関する必須ルールに決して違反しないでください。",
    original: "**原文の言語**：テキストは文書の原文の言語のままにしてください。",
    target: "**対象言語**：テキストは最終的に次の言語でなければなりません：",
    manualLanguage: "**言語**：追加指示が別の対象言語を明示的に要求しない限り、原文の言語を維持してください。",
    json: "**JSON のみ**：厳密に有効な JSON を返してください。Markdown 形式や会話的なテキストを含めないでください。",
    paragraph: "**実際の段落区切り**：ソーステキストが新しい表示行に移ったという理由だけで改行を挿入しないでください。文書に真正の段落変更がある場合にのみ改行を挿入してください。",
    join: "**折り返された行を自然につなげる**：同じ段落内で文が次の表示行に続く場合は、通常の間隔で 1 つの連続した文につなげてください。",
    hyphen: "**ハイフンで分割された語を再構成する**：語が行末でハイフンにより分割され、次の行に続く場合は、改行とハイフンを削除して完全な語を再構成してください。",
    singleRewrite: "**単一カラムへの書き直し**：正確な視覚的レイアウト、行の折り返し、ページ全体の流れを再現しないでください。真の段落構造を保ちながら、内容をクリーンな単一カラム文書として書き直してください。",
    refsKeep: "テキスト内の引用と参考文献は、ソースに表示されているとおりにそのまま保持してください。",
    refsRemove: "MAIN_TEXT ブロックを抽出する際は、本文中の学術的引用を省略してください。例：\n    - （著者、年）\n    - （著者、年：ページ）\n    - （姓、1908: p. 104）\n    - （著者 et al.、年）\n    - （著者と著者、年）\n    - APA、MLA、Chicago などの括弧形式\n    これらの参考文献は完全に飛ばし、文が自然に流れるようにしてください。",
    indent: "**インデントが段落を定義する**：先頭行のインデントを決定的な段落の手がかりとして扱ってください。行が前の段落の左マージンより明らかに右から始まる場合は、新しい段落を開始してください。インデントされた行を前の段落と決して統合しないでください。",
    single: "**単一カラム**：この画像は多段組みページから切り出された 1 つのカラムです。表示される領域全体が 1 つのテキストカラムです。上から下へ読んでください。複数のカラムを検出したり分割したりしないでください。カラムは 1 つだけです。",
    multi: "**多段組みの読み順（必須）**：文字起こしの前に、ページに 1 つまたは複数の分離したカラムがあるかを判断してください。複数ある場合は、右側の次のカラムに移る前に、左のカラム全体を上から下まで読み終えてください。ページ幅全体にわたって横方向に読まないでください。\n**カラム間の溝をまたがないでください**：広い垂直方向の隙間や明確な分離は異なるカラムを示します。隣接するカラムのテキストを同じ段落に統合したり、溝をまたいで文を続けたりしないでください。",
    blank: "0. **空白ページを分類する**：ページが空白であるか、判読可能な内容のないスキャンアーティファクト、汚れ、端のノイズのみを含む場合は、\"blankPage\" を true に設定し、空の \"blocks\" 配列を返してください。",
    reading: "1. **読み順**：文字起こしの前に正しい読み順を特定し、まずカラム構造を検出してください。",
    extract: "2. **テキストを抽出する**：上記の段落と再構成のルールを適用してすべてのテキストを読んでください。",
    segment: "3. **ブロックに分割する**：連続するテキストを一貫した段落または論理ブロックにまとめてください。ソースに真正の段落変更がある場合は新しいブロックを開始してください。必要でない限り、1 つの MAIN_TEXT 段落を複数のブロックに分割しないでください。",
    labels: "4. **各ブロックにラベルを付ける**：次のいずれかのラベルを使用してください：",
    roles: "   - **TITLE**：タイトル、サブタイトル、節見出し（大きいフォント、太字、中央揃え、または節の冒頭にある短い行）。\n   - **MAIN_TEXT**：文書の本文。\n   - **FOOTNOTE**：脚注。多くの場合、小さい数字/上付き文字や文献参照（Ibid, Op. cit.）を伴います。\n   - **HEADER**：上部に繰り返されるテキスト（ページ番号、章タイトル）。\n   - **FOOTER**：下部に繰り返されるテキスト（ページ番号、書名）。\n   - **CAPTION**：画像や表を説明するテキスト。",
    ambiguity: "5. **曖昧さ**：明確なタイトルがない場合は MAIN_TEXT とラベル付けしてください。HEADER と FOOTER を MAIN_TEXT から厳密に分離してください。",
    output: "**出力形式：**",
    schema: "次の構造を持つ有効な JSON オブジェクトを返してください：\n{\n  \"blankPage\": false,\n  \"blocks\": [\n    { \"text\": \"ブロックの内容…\", \"label\": \"MAIN_TEXT\", \"box_2d\": [ymin, xmin, ymax, xmax] }\n  ]\n}",
    box: "可能であれば \"box_2d\" に 0-1000 の正規化座標を使用してください。",
    additional: "**ユーザーの追加指示：**",
    precedence: "これらの指示は追加的なものにすぎません。上記の必須の OCR およびレイアウトルールと競合する場合は、必須ルールが優先されます。",
    textIntro: "あなたは OCR AI です。文書画像のテキストを文字起こししてください。",
    textOnly: "**テキストのみ**：文字起こししたテキストのみを返してください。コメント、でっち上げの見出し、JSON、コードブロックを追加しないでください。",
    textParagraph: "**実際の段落区切り**：段落は空行で区切ってください。視覚的な折り返しのため、1 つの段落内の行を分割しないでください。",
    textJoin: "**折り返された行をつなげ**、行末の**ハイフンで分割された語を再構成して**ください。",
    textBlank: "8. ページが空白であるか判読可能なテキストがない場合は、空の文字列を返してください。",
  },
  ru: {
    user: "Расшифруйте текст на этом изображении, строго соблюдая указанные правила.",
    intro: "Вы — продвинутый ИИ для анализа макета документов. Ваша задача — выполнить OCR и сегментацию макета на предоставленном изображении документа.",
    critical: "**КРИТИЧЕСКИ ВАЖНЫЕ ИНСТРУКЦИИ:**", steps: "**ШАГИ:**", rules: "**ПРАВИЛА:**", referencesHeading: "**ССЫЛКИ**",
    literal: "**ДОСЛОВНОЕ ИЗВЛЕЧЕНИЕ**: извлеките текст точно так, как он отображается на изображении. **НЕ ПЕРЕВОДИТЕ**. **НЕ СОКРАЩАЙТЕ**. **НЕ ДОБАВЛЯЙТЕ КОММЕНТАРИИ**.",
    translation: "**ПЕРЕВОД**: извлеките текст и переведите его на ",
    manual: "**РЕЖИМ ДОПОЛНИТЕЛЬНЫХ ИНСТРУКЦИЙ**: примените дополнительные инструкции пользователя, приведённые в конце, но никогда не нарушайте обязательные правила восстановления абзацев, порядка чтения, обнаружения пустых страниц, разметки и вывода.",
    original: "**ЯЗЫК ОРИГИНАЛА**: текст должен остаться на исходном языке документа.",
    target: "**ЦЕЛЕВОЙ ЯЗЫК**: текст должен быть в итоге на ",
    manualLanguage: "**ЯЗЫК**: сохраните исходный язык, если только дополнительные инструкции явно не требуют другого целевого языка.",
    json: "**ТОЛЬКО JSON**: верните строго допустимый JSON. Не включайте форматирование Markdown или разговорный текст.",
    paragraph: "**РЕАЛЬНЫЕ РАЗРЫВЫ АБЗАЦЕВ**: никогда не вставляйте перенос строки только потому, что исходный текст перешёл на новую визуальную строку. Вставляйте новую строку только тогда, когда документ показывает настоящую смену абзаца.",
    join: "**ЕСТЕСТВЕННО СОЕДИНЯЙТЕ ПЕРЕНОСЫ СТРОК**: если предложение продолжается на следующей визуальной строке в пределах одного абзаца, соедините его в одно непрерывное предложение с обычными пробелами.",
    hyphen: "**ВОССТАНАВЛИВАЙТЕ СЛОВА С ПЕРЕНОСОМ**: если слово разделено дефисом в конце строки и продолжается на следующей строке, удалите перенос строки и дефис и восстановите полное слово.",
    singleRewrite: "**ПЕРЕПИСЫВАНИЕ В ОДНУ КОЛОНКУ**: не воспроизводите точную визуальную вёрстку, перенос строк или поток на всю ширину страницы. Перепишите содержимое как чистый одноколоночный документ, сохраняя истинную структуру абзацев.",
    refsKeep: "Сохраняйте цитаты и ссылки в тексте точно так, как они приведены в источнике.",
    refsRemove: "При извлечении блоков MAIN_TEXT опускайте академические цитаты внутри текста, например:\n    - (Автор, год)\n    - (Автор, год: страница)\n    - (ФАМИЛИЯ, 1908: с. 104)\n    - (Автор и др., год)\n    - (Автор и Автор, год)\n    - форматы APA, MLA, Chicago или аналогичные в скобках\n    Полностью пропускайте эти ссылки и сохраняйте естественный поток предложения.",
    indent: "**ОТСТУП ОПРЕДЕЛЯЕТ АБЗАЦЫ**: рассматривайте отступ первой строки как решающий сигнал абзаца. Если строка явно начинается правее левого поля предыдущего абзаца, начните новый абзац. Никогда не объединяйте строку с отступом с предыдущим абзацем.",
    single: "**ОДНА КОЛОНКА**: это изображение — одна колонка, вырезанная из многоколоночной страницы. Вся видимая область — это ОДНА текстовая колонка. Читайте её сверху вниз. НЕ пытайтесь обнаружить или разделить несколько колонок: она только одна.",
    multi: "**ПОРЯДОК ЧТЕНИЯ МНОГОКОЛОНОЧНОЙ ВЁРСТКИ (ОБЯЗАТЕЛЬНО)**: перед расшифровкой определите, содержит страница одну или несколько раздельных колонок. Если их несколько, прочитайте всю левую колонку сверху вниз, прежде чем перейти к следующей колонке справа. Никогда не читайте по горизонтали через всю ширину страницы.\n**НЕ ПЕРЕСЕКАЙТЕ ПРОМЕЖУТОК МЕЖДУ КОЛОНКАМИ**: широкий вертикальный разрыв или чёткое разделение указывает на разные колонки. Не объединяйте текст соседних колонок в один абзац и не продолжайте предложение через промежуток.",
    blank: "0. **Классифицируйте пустые страницы**: если страница пуста или содержит только артефакты сканирования, пятна или краевой шум без читаемого содержимого, установите \"blankPage\" в true и верните пустой массив \"blocks\".",
    reading: "1. **Порядок чтения**: определите правильный порядок чтения перед расшифровкой; сначала обнаружьте структуру колонок.",
    extract: "2. **Извлеките текст**: прочитайте весь текст, применяя приведённые выше правила абзацев и восстановления.",
    segment: "3. **Разделите на блоки**: сгруппируйте непрерывный текст в связные абзацы или логические блоки. Начинайте новый блок, когда источник показывает настоящую смену абзаца. Не разбивайте один абзац MAIN_TEXT на несколько блоков без необходимости.",
    labels: "4. **Помечайте каждый блок** одной из следующих меток:",
    roles: "   - **TITLE**: заголовки, подзаголовки и названия разделов (крупный шрифт, полужирный, по центру или короткие строки в начале раздела).\n   - **MAIN_TEXT**: основной текст документа.\n   - **FOOTNOTE**: сноски, часто с мелкими цифрами/надстрочными знаками или библиографическими ссылками (Ibid, Op. cit.).\n   - **HEADER**: повторяющийся текст вверху (номера страниц, название главы).\n   - **FOOTER**: повторяющийся текст внизу (номера страниц, название книги).\n   - **CAPTION**: текст, описывающий изображения или таблицы.",
    ambiguity: "5. **Неоднозначность**: если нет чёткого заголовка, помечайте блок как MAIN_TEXT. Строго отделяйте HEADER и FOOTER от MAIN_TEXT.",
    output: "**ФОРМАТ ВЫВОДА:**",
    schema: "Верните допустимый объект JSON следующей структуры:\n{\n  \"blankPage\": false,\n  \"blocks\": [\n    { \"text\": \"Содержимое блока…\", \"label\": \"MAIN_TEXT\", \"box_2d\": [ymin, xmin, ymax, xmax] }\n  ]\n}",
    box: "По возможности используйте нормализованные координаты 0–1000 в \"box_2d\".",
    additional: "**ДОПОЛНИТЕЛЬНЫЕ ИНСТРУКЦИИ ПОЛЬЗОВАТЕЛЯ:**",
    precedence: "Эти инструкции носят только дополняющий характер. Если они противоречат обязательным правилам OCR и вёрстки выше, преимущественную силу имеют обязательные правила.",
    textIntro: "Вы — ИИ для OCR. Расшифруйте текст на изображении документа.",
    textOnly: "**ТОЛЬКО ТЕКСТ**: верните только расшифрованный текст. Не добавляйте комментарии, вымышленные заголовки, JSON или блоки кода.",
    textParagraph: "**РЕАЛЬНЫЕ РАЗРЫВЫ АБЗАЦЕВ**: разделяйте абзацы пустой строкой. Не разрывайте строки внутри одного абзаца из-за визуального переноса.",
    textJoin: "**СОЕДИНЯЙТЕ ПЕРЕНОСЫ СТРОК** и **ВОССТАНАВЛИВАЙТЕ СЛОВА С ПЕРЕНОСОМ** в конце строки.",
    textBlank: "8. Если страница пуста или не содержит читаемого текста, верните пустую строку.",
  },
  uk: {
    user: "Розшифруйте текст на цьому зображенні, суворо дотримуючись зазначених правил.",
    intro: "Ви — просунутий ШІ для аналізу макета документів. Ваше завдання — виконати OCR і сегментацію макета на наданому зображенні документа.",
    critical: "**КРИТИЧНО ВАЖЛИВІ ІНСТРУКЦІЇ:**", steps: "**КРОКИ:**", rules: "**ПРАВИЛА:**", referencesHeading: "**ПОСИЛАННЯ**",
    literal: "**ДОСЛІВНЕ ВИЛУЧЕННЯ**: вилучіть текст точно так, як він відображається на зображенні. **НЕ ПЕРЕКЛАДАЙТЕ**. **НЕ СКОРОЧУЙТЕ**. **НЕ ДОДАВАЙТЕ КОМЕНТАРІ**.",
    translation: "**ПЕРЕКЛАД**: вилучіть текст і перекладіть його на ",
    manual: "**РЕЖИМ ДОДАТКОВИХ ІНСТРУКЦІЙ**: застосуйте додаткові інструкції користувача, наведені в кінці, але ніколи не порушуйте обов’язкові правила відновлення абзаців, порядку читання, виявлення порожніх сторінок, розмітки та виведення.",
    original: "**МОВА ОРИГІНАЛУ**: текст має залишитися мовою оригіналу документа.",
    target: "**ЦІЛЬОВА МОВА**: текст має бути зрештою ",
    manualLanguage: "**МОВА**: збережіть мову оригіналу, якщо додаткові інструкції явно не вимагають іншої цільової мови.",
    json: "**ЛИШЕ JSON**: поверніть суворо дійсний JSON. Не додавайте форматування Markdown чи розмовний текст.",
    paragraph: "**СПРАВЖНІ РОЗРИВИ АБЗАЦІВ**: ніколи не вставляйте розрив рядка лише тому, що вихідний текст перейшов на новий візуальний рядок. Вставляйте новий рядок лише тоді, коли документ показує справжню зміну абзацу.",
    join: "**ПРИРОДНО З’ЄДНУЙТЕ ПЕРЕНОСИ РЯДКІВ**: якщо речення продовжується на наступному візуальному рядку в межах одного абзацу, з’єднайте його в одне безперервне речення зі звичайними проміжками.",
    hyphen: "**ВІДНОВЛЮЙТЕ СЛОВА З ПЕРЕНОСОМ**: якщо слово розділене дефісом у кінці рядка й продовжується на наступному рядку, видаліть розрив рядка та дефіс і відновіть повне слово.",
    singleRewrite: "**ПЕРЕПИСУВАННЯ В ОДНУ КОЛОНКУ**: не відтворюйте точну візуальну верстку, перенос рядків або потік на всю ширину сторінки. Перепишіть вміст як чистий одноколонковий документ, зберігаючи справжню структуру абзаців.",
    refsKeep: "Зберігайте цитати та посилання в тексті точно так, як вони наведені в джерелі.",
    refsRemove: "Під час вилучення блоків MAIN_TEXT пропускайте академічні цитати всередині тексту, наприклад:\n    - (Автор, рік)\n    - (Автор, рік: сторінка)\n    - (ПРІЗВИЩЕ, 1908: с. 104)\n    - (Автор та ін., рік)\n    - (Автор і Автор, рік)\n    - формати APA, MLA, Chicago або подібні формати в дужках\n    Повністю пропускайте ці посилання та зберігайте природний плин речення.",
    indent: "**ВІДСТУП ВИЗНАЧАЄ АБЗАЦИ**: розглядайте відступ першого рядка як вирішальний сигнал абзацу. Якщо рядок явно починається правіше від лівого поля попереднього абзацу, почніть новий абзац. Ніколи не об’єднуйте рядок з відступом із попереднім абзацом.",
    single: "**ОДНА КОЛОНКА**: це зображення — одна колонка, вирізана з багатоколонкової сторінки. Уся видима область — це ОДНА текстова колонка. Читайте її згори вниз. НЕ намагайтеся виявити чи розділити кілька колонок: вона лише одна.",
    multi: "**ПОРЯДОК ЧИТАННЯ БАГАТОКОЛОНКОВОЇ ВЕРСТКИ (ОБОВ’ЯЗКОВО)**: перед розшифруванням визначте, чи має сторінка одну або кілька розділених колонок. Якщо їх кілька, прочитайте всю ліву колонку згори вниз, перш ніж перейти до наступної колонки праворуч. Ніколи не читайте горизонтально через усю ширину сторінки.\n**НЕ ПЕРЕТИНАЙТЕ ПРОМІЖОК МІЖ КОЛОНКАМИ**: широкий вертикальний розрив або чітке розділення вказує на різні колонки. Не об’єднуйте текст сусідніх колонок в один абзац і не продовжуйте речення через проміжок.",
    blank: "0. **Класифікуйте порожні сторінки**: якщо сторінка порожня або містить лише артефакти сканування, плями чи шум по краях без читаного вмісту, установіть \"blankPage\" у true і поверніть порожній масив \"blocks\".",
    reading: "1. **Порядок читання**: визначте правильний порядок читання перед розшифруванням; спершу виявте структуру колонок.",
    extract: "2. **Вилучіть текст**: прочитайте весь текст, застосовуючи наведені вище правила абзаців і відновлення.",
    segment: "3. **Розділіть на блоки**: згрупуйте безперервний текст у зв’язні абзаци або логічні блоки. Починайте новий блок, коли джерело показує справжню зміну абзацу. Не розбивайте один абзац MAIN_TEXT на кілька блоків без потреби.",
    labels: "4. **Позначайте кожен блок** однією з таких міток:",
    roles: "   - **TITLE**: заголовки, підзаголовки та назви розділів (більший шрифт, напівжирний, по центру або короткі рядки на початку розділу).\n   - **MAIN_TEXT**: основний текст документа.\n   - **FOOTNOTE**: виноски, часто з дрібними цифрами/надрядковими знаками або бібліографічними посиланнями (Ibid, Op. cit.).\n   - **HEADER**: повторюваний текст угорі (номери сторінок, назва розділу).\n   - **FOOTER**: повторюваний текст унизу (номери сторінок, назва книги).\n   - **CAPTION**: текст, що описує зображення або таблиці.",
    ambiguity: "5. **Неоднозначність**: якщо немає чіткого заголовка, позначайте блок як MAIN_TEXT. Суворо відокремлюйте HEADER і FOOTER від MAIN_TEXT.",
    output: "**ФОРМАТ ВИВЕДЕННЯ:**",
    schema: "Поверніть дійсний об’єкт JSON такої структури:\n{\n  \"blankPage\": false,\n  \"blocks\": [\n    { \"text\": \"Вміст блоку…\", \"label\": \"MAIN_TEXT\", \"box_2d\": [ymin, xmin, ymax, xmax] }\n  ]\n}",
    box: "За можливості використовуйте нормалізовані координати 0–1000 у \"box_2d\".",
    additional: "**ДОДАТКОВІ ІНСТРУКЦІЇ КОРИСТУВАЧА:**",
    precedence: "Ці інструкції мають лише доповнювальний характер. Якщо вони суперечать обов’язковим правилам OCR і верстки вище, переважають обов’язкові правила.",
    textIntro: "Ви — ШІ для OCR. Розшифруйте текст на зображенні документа.",
    textOnly: "**ЛИШЕ ТЕКСТ**: поверніть лише розшифрований текст. Не додавайте коментарі, вигадані заголовки, JSON або блоки коду.",
    textParagraph: "**СПРАВЖНІ РОЗРИВИ АБЗАЦІВ**: розділяйте абзаци порожнім рядком. Не розривайте рядки в межах одного абзацу через візуальний перенос.",
    textJoin: "**З’ЄДНУЙТЕ ПЕРЕНОСИ РЯДКІВ** і **ВІДНОВІТЬ СЛОВА З ПЕРЕНОСОМ** у кінці рядка.",
    textBlank: "8. Якщо сторінка порожня або не містить читаного тексту, поверніть порожній рядок.",
  },
  ko: {
    user: "이 이미지의 텍스트를 명시된 규칙에 따라 정확히 전사하십시오.",
    intro: "귀하는 고급 문서 레이아웃 분석 AI입니다. 제공된 문서 이미지에 대해 OCR과 레이아웃 분할을 수행하는 것이 과제입니다.",
    critical: "**중요 지침:**", steps: "**단계:**", rules: "**규칙:**", referencesHeading: "**참고 문헌**",
    literal: "**축자 추출**: 이미지에 나타난 그대로 텍스트를 추출하십시오. **번역하지 마십시오**. **요약하지 마십시오**. **논평을 추가하지 마십시오**.",
    translation: "**번역**: 텍스트를 추출하여 다음 언어로 번역하십시오: ",
    manual: "**추가 지침 모드**: 끝에 포함된 사용자 추가 지침을 적용하되, 단락 재구성, 읽기 순서, 빈 페이지 감지, 레이블 지정 및 출력에 관한 필수 규칙을 결코 위반하지 마십시오.",
    original: "**원문 언어**: 텍스트는 문서의 원래 언어로 유지되어야 합니다.",
    target: "**대상 언어**: 텍스트는 최종적으로 다음 언어여야 합니다: ",
    manualLanguage: "**언어**: 추가 지침이 다른 대상 언어를 명시적으로 요구하지 않는 한 원래 언어를 유지하십시오.",
    json: "**JSON만**: 엄격하게 유효한 JSON을 반환하십시오. Markdown 서식이나 대화체 텍스트를 포함하지 마십시오.",
    paragraph: "**실제 단락 구분**: 원본 텍스트가 새로운 시각적 줄로 넘어갔다는 이유만으로 줄바꿈을 삽입하지 마십시오. 문서에 진정한 단락 변경이 있을 때만 새 줄을 삽입하십시오.",
    join: "**줄바꿈을 자연스럽게 연결**: 같은 단락 안에서 문장이 다음 시각적 줄로 이어지는 경우, 정상적인 간격으로 하나의 연속된 문장으로 연결하십시오.",
    hyphen: "**하이픈으로 나뉜 단어 재구성**: 단어가 줄 끝에서 하이픈으로 나뉘어 다음 줄로 이어지는 경우, 줄바꿈과 하이픈을 제거하고 완전한 단어를 재구성하십시오.",
    singleRewrite: "**단일 열로 다시 쓰기**: 정확한 시각적 레이아웃, 줄바꿈 또는 페이지 전체 흐름을 재현하지 마십시오. 진정한 단락 구조를 유지하면서 내용을 깔끔한 단일 열 문서로 다시 쓰십시오.",
    refsKeep: "텍스트의 인용과 참고 문헌을 원본에 나타난 그대로 유지하십시오.",
    refsRemove: "MAIN_TEXT 블록을 추출할 때 본문 내 학술 인용을 생략하십시오. 예:\n    - (저자, 연도)\n    - (저자, 연도: 페이지)\n    - (성, 1908: p. 104)\n    - (저자 외, 연도)\n    - (저자 및 저자, 연도)\n    - APA, MLA, Chicago 또는 이와 유사한 괄호 형식\n    이러한 참고 문헌은 완전히 건너뛰고 문장이 자연스럽게 이어지도록 하십시오.",
    indent: "**들여쓰기가 단락을 정의합니다**: 첫 줄 들여쓰기를 결정적인 단락 신호로 취급하십시오. 어떤 줄이 이전 단락의 왼쪽 여백보다 분명히 오른쪽에서 시작하면 새 단락을 시작하십시오. 들여쓴 줄을 이전 단락과 절대 합치지 마십시오.",
    single: "**단일 열**: 이 이미지는 여러 열로 된 페이지에서 잘라낸 하나의 열입니다. 보이는 전체 영역이 하나의 텍스트 열입니다. 위에서 아래로 읽으십시오. 여러 열을 감지하거나 분할하지 마십시오. 열은 하나뿐입니다.",
    multi: "**여러 열 읽기 순서(필수)**: 전사하기 전에 페이지에 하나 또는 여러 개의 분리된 열이 있는지 판단하십시오. 여러 개인 경우 오른쪽의 다음 열로 넘어가기 전에 왼쪽 열 전체를 위에서 아래로 끝까지 읽으십시오. 페이지 전체 너비를 가로질러 읽지 마십시오.\n**열 사이의 홈을 넘지 마십시오**: 넓은 세로 간격이나 명확한 분리는 서로 다른 열을 나타냅니다. 인접한 열의 텍스트를 하나의 단락으로 합치거나 홈을 가로질러 문장을 이어 가지 마십시오.",
    blank: "0. **빈 페이지 분류**: 페이지가 비어 있거나 읽을 수 있는 내용 없이 스캔 아티팩트, 얼룩 또는 가장자리 노이즈만 포함하는 경우 \"blankPage\"를 true로 설정하고 빈 \"blocks\" 배열을 반환하십시오.",
    reading: "1. **읽기 순서**: 전사하기 전에 올바른 읽기 순서를 확인하고 열 구조를 먼저 감지하십시오.",
    extract: "2. **텍스트 추출**: 위의 단락 및 재구성 규칙을 적용하여 모든 텍스트를 읽으십시오.",
    segment: "3. **블록으로 분할**: 연속된 텍스트를 일관된 단락이나 논리적 블록으로 묶으십시오. 원본에 진정한 단락 변경이 있으면 새 블록을 시작하십시오. 필요하지 않으면 하나의 MAIN_TEXT 단락을 여러 블록으로 나누지 마십시오.",
    labels: "4. **각 블록에 레이블 지정**: 다음 레이블 중 하나를 사용하십시오:",
    roles: "   - **TITLE**: 제목, 부제목 및 절 제목(더 큰 글꼴, 굵게, 가운데 정렬 또는 절 시작 부분의 짧은 줄).\n   - **MAIN_TEXT**: 문서의 본문.\n   - **FOOTNOTE**: 각주. 흔히 작은 숫자/위첨자나 서지 참조(Ibid, Op. cit.)가 함께 있습니다.\n   - **HEADER**: 상단에 반복되는 텍스트(페이지 번호, 장 제목).\n   - **FOOTER**: 하단에 반복되는 텍스트(페이지 번호, 책 제목).\n   - **CAPTION**: 이미지나 표를 설명하는 텍스트.",
    ambiguity: "5. **모호성**: 명확한 제목이 없으면 MAIN_TEXT로 레이블을 지정하십시오. HEADER와 FOOTER를 MAIN_TEXT와 엄격히 구분하십시오.",
    output: "**출력 형식:**",
    schema: "다음 구조의 유효한 JSON 객체를 반환하십시오:\n{\n  \"blankPage\": false,\n  \"blocks\": [\n    { \"text\": \"블록 내용…\", \"label\": \"MAIN_TEXT\", \"box_2d\": [ymin, xmin, ymax, xmax] }\n  ]\n}",
    box: "가능하면 \"box_2d\"에 0–1000 정규화 좌표를 사용하십시오.",
    additional: "**사용자 추가 지침:**",
    precedence: "이 지침은 추가적인 것일 뿐입니다. 위의 필수 OCR 및 레이아웃 규칙과 충돌하는 경우 필수 규칙이 우선합니다.",
    textIntro: "귀하는 OCR AI입니다. 문서 이미지의 텍스트를 전사하십시오.",
    textOnly: "**텍스트만**: 전사한 텍스트만 반환하십시오. 논평, 지어낸 제목, JSON 또는 코드 블록을 추가하지 마십시오.",
    textParagraph: "**실제 단락 구분**: 단락을 빈 줄로 구분하십시오. 시각적 줄바꿈 때문에 한 단락 안의 줄을 나누지 마십시오.",
    textJoin: "**줄바꿈을 연결**하고 줄 끝의 **하이픈으로 나뉜 단어를 재구성**하십시오.",
    textBlank: "8. 페이지가 비어 있거나 읽을 수 있는 텍스트가 없으면 빈 문자열을 반환하십시오.",
  },
};

const OCR_LAYOUT_CONFLICT: Record<Exclude<PromptLanguage, 'es'>, string> = {
  en: "When layout signals conflict, column order controls reading order and indentation controls paragraph breaks.",
  fr: "Lorsque les indices de mise en page se contredisent, l’ordre des colonnes contrôle l’ordre de lecture et l’indentation contrôle les coupures de paragraphe.",
  de: "Wenn Layoutsignale widersprüchlich sind, bestimmt die Spaltenreihenfolge die Lesereihenfolge und die Einrückung die Absatzumbrüche.",
  pt: "Quando os sinais de layout entram em conflito, a ordem das colunas determina a ordem de leitura e a indentação determina as quebras de parágrafo.",
  "pt-BR": "Quando os sinais de layout entram em conflito, a ordem das colunas determina a ordem de leitura e a indentação determina as quebras de parágrafo.",
  it: "Quando i segnali del layout sono in conflitto, l’ordine delle colonne determina l’ordine di lettura e l’indentazione determina le interruzioni di paragrafo.",
  tr: "Düzen işaretleri çeliştiğinde sütun sırası okuma sırasını, girinti ise paragraf sonlarını belirler.",
  'zh-Hans': "当版面信号相互冲突时，分栏顺序决定阅读顺序，首行缩进决定段落划分。",
  'zh-Hant': "當版面訊號相互衝突時，分欄順序決定閱讀順序，首行縮排決定段落劃分。",
  vi: "Khi các tín hiệu bố cục xung đột, thứ tự cột quyết định thứ tự đọc và thụt lề quyết định chỗ ngắt đoạn.",
  ja: "レイアウトの手がかりが矛盾する場合、段組みの順序が読み順を、インデントが段落の区切りを決定します。",
  ru: "Если сигналы вёрстки противоречат друг другу, порядок колонок определяет порядок чтения, а отступ — границы абзацев.",
  uk: "Якщо сигнали верстки суперечать одне одному, порядок колонок визначає порядок читання, а відступ — межі абзаців.",
  ko: "레이아웃 신호가 충돌할 때 열 순서가 읽기 순서를 결정하고, 들여쓰기가 단락 구분을 결정합니다.",
};
const OCR_COORDINATES_RULE: Record<Exclude<PromptLanguage, 'es'>, string> = {
  en: 'Keep coordinates in "box_2d", but do not let visual line wrapping leak into block text.',
  fr: 'Conserve les coordonnées dans « box_2d », mais ne laisse pas le retour visuel se retrouver dans le texte du bloc.',
  de: 'Behalte die Koordinaten in „box_2d“ bei, aber übertrage sichtbare Zeilenumbrüche nicht in den Blocktext.',
  pt: 'Mantenha as coordenadas em "box_2d", mas não deixe a quebra visual de linhas entrar no texto do bloco.',
  "pt-BR": 'Mantenha as coordenadas em "box_2d", mas não deixe a quebra visual de linhas entrar no texto do bloco.',
  it: 'Mantieni le coordinate in "box_2d", ma non lasciare che il ritorno visivo finisca nel testo del blocco.',
  tr: 'Koordinatları "box_2d" içinde koruyun; ancak görsel satır kaymasını blok metnine aktarmayın.',
  'zh-Hans': '坐标保留在 "box_2d" 中，但不要让视觉换行混入块文本。',
  'zh-Hant': '座標保留在 "box_2d" 中，但不要讓視覺換行混入區塊文字。',
  vi: 'Giữ tọa độ trong "box_2d", nhưng đừng để việc ngắt dòng thị giác lọt vào văn bản của khối.',
  ja: '座標は "box_2d" に保持してください。ただし、見た目の折り返しをブロックのテキストに混入させないでください。',
  ru: 'Сохраняйте координаты в "box_2d", но не допускайте, чтобы визуальные переносы строк попадали в текст блока.',
  uk: 'Зберігайте координати в "box_2d", але не допускайте, щоб візуальні перенесення рядків потрапляли в текст блоку.',
  ko: '좌표는 "box_2d"에 유지하되, 시각적 줄바꿈이 블록 텍스트에 섞이지 않도록 하십시오.',
};
const OCR_TRANSLATION_SUFFIX: Record<Exclude<PromptLanguage, 'es'>, string> = {
  en: " **DO NOT SUMMARIZE**. **DO NOT ADD COMMENTS**.",
  fr: " **NE RÉSUME PAS**. **N'AJOUTE AUCUN COMMENTAIRE**.",
  de: " **NICHT ZUSAMMENFASSEN**. **KEINE KOMMENTARE HINZUFÜGEN**.",
  pt: " **NÃO RESUMA**. **NÃO ADICIONE COMENTÁRIOS**.",
  "pt-BR": " **NÃO RESUMA**. **NÃO ADICIONE COMENTÁRIOS**.",
  it: " **NON RIASSUMERE**. **NON AGGIUNGERE COMMENTI**.",
  tr: " **ÖZETLEMEYİN**. **YORUM EKLEMEYİN**.",
  'zh-Hans': " **不要总结**。**不要添加评论**。",
  'zh-Hant': " **不要摘要**。**不要新增評論**。",
  vi: " **KHÔNG TÓM TẮT**. **KHÔNG THÊM NHẬN XÉT**.",
  ja: " **要約しないでください**。**コメントを追加しないでください**。",
  ru: " **НЕ СОКРАЩАЙТЕ**. **НЕ ДОБАВЛЯЙТЕ КОММЕНТАРИИ**.",
  uk: " **НЕ СКОРОЧУЙТЕ**. **НЕ ДОДАВАЙТЕ КОМЕНТАРІ**.",
  ko: " **요약하지 마십시오**. **논평을 추가하지 마십시오**.",
};

export function buildLocalizedOcrSystemPrompt(o: OcrOptions): string {
  if ((o.promptLanguage ?? 'es') === 'es') return buildOcrSystemPrompt(o);
  const copy = OCR_LOCALIZED_COPY[o.promptLanguage as Exclude<PromptLanguage, 'es'>] ?? OCR_LOCALIZED_COPY.en;
  const translationSuffix = OCR_TRANSLATION_SUFFIX[(o.promptLanguage ?? 'en') as Exclude<PromptLanguage, 'es'>] ?? OCR_TRANSLATION_SUFFIX.en;
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
  const conflict = o.singleColumn ? '' : ` ${OCR_LAYOUT_CONFLICT[(o.promptLanguage ?? 'en') as Exclude<PromptLanguage, 'es'>] ?? OCR_LAYOUT_CONFLICT.en}`;
  const coordinates = OCR_COORDINATES_RULE[(o.promptLanguage ?? 'en') as Exclude<PromptLanguage, 'es'>] ?? OCR_COORDINATES_RULE.en;
  return `${copy.intro}\n\n${copy.critical}\n1. ${extraction}\n2. ${language}\n3. ${copy.json}\n4. ${copy.paragraph}\n5. ${copy.join}\n6. ${copy.hyphen}\n7. ${copy.singleRewrite}\n8. ${copy.referencesHeading}: ${refs}\n9. ${copy.indent}\n10. ${columns}\n\n${copy.steps}\n${copy.blank}\n${copy.reading}\n${copy.extract}\n${copy.segment}\n${copy.labels}\n${copy.roles}\n${copy.ambiguity}${conflict} ${coordinates}\n\n${copy.output}\n${copy.schema}\n${copy.box}${extra}`;
}

export function buildLocalizedOcrTextPrompt(o: OcrOptions): string {
  if ((o.promptLanguage ?? 'es') === 'es') return buildOcrTextPrompt(o);
  const copy = OCR_LOCALIZED_COPY[o.promptLanguage as Exclude<PromptLanguage, 'es'>] ?? OCR_LOCALIZED_COPY.en;
  const translationSuffix = OCR_TRANSLATION_SUFFIX[(o.promptLanguage ?? 'en') as Exclude<PromptLanguage, 'es'>] ?? OCR_TRANSLATION_SUFFIX.en;
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
