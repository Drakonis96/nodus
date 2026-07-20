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

/** Short user turn that accompanies the page image; the rules live in the system prompt. */
export const OCR_USER_PROMPT = 'Transcribe el texto de esta imagen siguiendo estrictamente las reglas indicadas.';

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
