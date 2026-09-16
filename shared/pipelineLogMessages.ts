/**
 * The catalogue of processing-log lines: extraction, indexing, embeddings and the
 * provider failures around them.
 *
 * A log line is stored as an id plus its values, never as finished prose. The store is
 * a single global file (a corpus run crosses vaults and the Library while `uiLanguage`
 * is per vault), and the reader can pick a DIFFERENT language for the log itself — so
 * prose written by the emitter would freeze both the moment it was written. The renderer
 * resolves the id every time it paints, in the language the reader selected.
 *
 * Two kinds of sentence live here:
 *   - templates, built around `{subject}` (the subsystem) and `{detail}` (runtime
 *     prose that cannot be translated in advance: a provider's own error text);
 *   - specific lines for the handful of events whose numbers matter (a document
 *     extracted or indexed, a finished campaign).
 *
 * `{subject}` and `{reason}` are themselves ids from this table, so a caller passes
 * `{ id: 'subjectIndexing' }` rather than a sentence and the renderer translates the
 * whole line in one pass.
 *
 * These values are ordinary translation keys: scripts/test-i18n-coverage.mjs reads this
 * table through INDIRECT_KEY_SOURCES and demands a translation in every language.
 */

/** The subsystems a log line can be about. */
export const PIPELINE_LOG_SUBJECTS = {
  subjectExtraction: 'Extracción de texto',
  subjectLibraryExtraction: 'Extracción de la Biblioteca',
  subjectOcr: 'OCR',
  subjectModelCall: 'Llamada al modelo',
  subjectJsonResponse: 'Respuesta JSON del modelo',
  subjectEmbeddings: 'Embeddings',
  subjectIndexing: 'Indexado de documentos',
  subjectPassages: 'Fragmentos de recuperación',
  subjectProfileScan: 'Análisis del documento',
  subjectFigureAnalysis: 'Análisis de figuras',
  subjectScan: 'Análisis con IA',
  subjectPublish: 'Publicación del índice',
  subjectDatabase: 'Base de datos',
  subjectQueue: 'Cola de trabajos',
  subjectApp: 'Aplicación',
} as const;

/**
 * Why something was skipped, degraded or replaced. Short noun phrases so they can
 * follow a colon in any of the templates below.
 */
export const PIPELINE_LOG_REASONS = {
  reasonNoAttachment: 'el ítem no tiene ningún adjunto legible',
  reasonUnreadable: 'el adjunto no se pudo leer',
  reasonAbstractOnly: 'solo hay resumen disponible',
  reasonZoteroUnavailable: 'Zotero no está disponible',
  reasonNoLegibleText: 'no se encontró texto legible en el documento',
  reasonOcrLowQuality: 'la calidad del OCR es insuficiente',
  reasonProviderConfig: 'falta la clave o el modelo de IA',
  reasonSourceChanged: 'el documento de origen cambió',
  reasonUnsupportedFormat: 'el formato del archivo no es compatible',
  reasonCancelled: 'el usuario canceló el trabajo',
  // Why a proposal the planner made never became a figure. A run that produced none
  // because it refused them all must not read as a document that needed none, so every
  // refusal names its motive instead of vanishing into an anonymous `continue`.
  reasonUnknownBlock: 'el bloque indicado no existe',
  reasonHeadingBlock: 'un título no admite una figura',
  reasonSkillNotEnabled: 'la skill no estaba habilitada',
  reasonSkillCeiling: 'se alcanzó el máximo de la skill',
  reasonSourceNotInBlock: 'la fuente citada no está en ese bloque',
  reasonBlockAlreadyFigured: 'el bloque ya tiene una figura',
  reasonDiscardNotSelected: 'descartada al elegir las figuras del documento',
} as const;

/** Sentence templates. `{subject}` is a `subject*` id; `{detail}` is runtime prose. */
export const PIPELINE_LOG_TEMPLATES = {
  logDone: '{subject}: completado',
  logFailed: '{subject}: error — {detail}',
  logFailedPlain: '{subject}: error',
  logWarning: '{subject}: aviso — {reason}',
  logWarningDetail: '{subject}: aviso — {detail}',
  logWarningPlain: '{subject}: aviso',
  logInfo: '{subject}: {detail}',
  logInfoPlain: '{subject}',
  logRetry: '{subject}: error — reintentando ({attempt}/{max})',
  logPaused: '{subject}: en pausa — {reason}',
  logCancelled: '{subject}: cancelado',
  logSkipped: '{subject}: omitido — {reason}',
  logFallback: '{subject}: alternativa aplicada — {reason}',
} as const;

/** Lines whose numbers are the point: they name the document and its counts. */
export const PIPELINE_LOG_EVENTS = {
  documentExtracted: 'Documento extraído: {title} · {words} palabras · {figures} figuras · {tables} tablas',
  documentExtractedReview: 'Documento extraído con avisos: {title} · {warnings}',
  documentIndexed: 'Documento indexado: {title} · {sections} secciones · {vectors} vectores',
  campaignFinished: 'Indexado terminado: {completed} de {total} documentos ({failed} con errores)',
  passagesEmbedded: 'Fragmentos indexados: {done} de {total}',
  ideasEmbedded: 'Ideas indexadas: {done} de {total}',
  summariesEmbedded: 'Resúmenes indexados: {done} de {total}',
  uncaughtFailure: 'Fallo no controlado: {detail}',
  repeatedGrouped: 'Se agruparon {count} repeticiones idénticas',
  burstDiscarded: 'Se descartaron {count} entradas por límite de ráfaga',
  figuresDiscarded: 'Recursos visuales descartados: {count} — {reason}',
} as const;

/**
 * Spanish source strings, keyed by id — what the renderer hands to `tx()`. The subjects
 * and reasons are here too: they are interpolated as `{subject}` / `{reason}`, so they
 * need a translation just like the sentence around them.
 */
export const PIPELINE_LOG_TEXT = {
  ...PIPELINE_LOG_SUBJECTS,
  ...PIPELINE_LOG_REASONS,
  ...PIPELINE_LOG_TEMPLATES,
  ...PIPELINE_LOG_EVENTS,
} as const;

export type PipelineLogTextId = keyof typeof PIPELINE_LOG_TEXT;
export type PipelineLogSubjectId = keyof typeof PIPELINE_LOG_SUBJECTS;
export type PipelineLogReasonId = keyof typeof PIPELINE_LOG_REASONS;

/** A value substituted into a line. `{ id }` is another catalogue id from this file. */
export type PipelineLogParamValue = string | number | boolean | null | { id: PipelineLogTextId };

/** A translated line, as it travels from the pipeline to the store. */
export interface PipelineLogText {
  id: PipelineLogTextId;
  params?: Record<string, PipelineLogParamValue>;
}

/** Build a line with its id checked against the catalogue. */
export function pipelineLogText(
  id: PipelineLogTextId,
  params?: Record<string, PipelineLogParamValue>
): PipelineLogText {
  return params ? { id, params } : { id };
}

/**
 * A stable identity for grouping repeated lines, derived from the id and its values
 * rather than from rendered prose (which changes with the language and would let the
 * same failure in twice).
 */
export function pipelineLogSignature(text: PipelineLogText): string {
  const params = text.params ?? {};
  const names = Object.keys(params).sort();
  if (names.length === 0) return text.id;
  const values = names.map((name) => {
    const value = params[name];
    return [name, value && typeof value === 'object' ? value.id : value];
  });
  return `${text.id}:${JSON.stringify(values)}`;
}
