// Presentation rules for one processing-log line: how a stored id becomes a sentence, and
// which colours a level or a category carries.
//
// The colours are the standardised ones the whole surface shares, so a screenshot reads the
// same everywhere: green for a success — dark green on the light theme and light green on the
// dark one — red IN BOLD for an error, amber for a warning, neutral for information.
import type { AppLanguage } from '@shared/types';
import type { PipelineLogEntry, PipelineLogLevel, PipelineLogCategory } from '@shared/pipelineLogs';
import { PIPELINE_LOG_TEXT, type PipelineLogText } from '@shared/pipelineLogMessages';
import { knownRuntimeErrorText } from '@shared/uiLanguage';
import { t, txIn } from '../../i18n';

export interface LevelPresentation {
  /** The Spanish key of the level's label, translated with t(). */
  label: string;
  /** The line's own text: what carries the colour. */
  text: string;
  /** The tinted chip. */
  badge: string;
  /** The accent bar down the left edge of the row. */
  accent: string;
  row: string;
}

export const LEVEL_PRESENTATION: Record<PipelineLogLevel, LevelPresentation> = {
  success: {
    label: 'Correcto',
    text: 'text-green-700 dark:text-green-400',
    badge: 'bg-green-100 text-green-800 dark:bg-green-400/15 dark:text-green-300',
    accent: 'border-l-2 border-l-green-600 dark:border-l-green-400',
    row: 'hover:bg-green-500/5',
  },
  error: {
    label: 'Error',
    text: 'text-red-600 dark:text-red-400 font-semibold',
    badge: 'bg-red-100 text-red-800 dark:bg-red-400/15 dark:text-red-300',
    accent: 'border-l-2 border-l-red-600 dark:border-l-red-400',
    row: 'bg-red-500/5 hover:bg-red-500/10',
  },
  warning: {
    label: 'Advertencia',
    text: 'text-amber-700 dark:text-amber-400',
    badge: 'bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-300',
    accent: 'border-l-2 border-l-amber-600 dark:border-l-amber-400',
    row: 'hover:bg-amber-500/5',
  },
  info: {
    label: 'Informativo',
    text: 'text-neutral-700 dark:text-neutral-300',
    badge: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-700/40 dark:text-neutral-300',
    accent: 'border-l-2 border-l-neutral-400 dark:border-l-neutral-600',
    row: 'hover:bg-neutral-100 dark:hover:bg-neutral-900',
  },
};

/** Level keys, in the order the filter offers them. */
export const LEVEL_ORDER: readonly PipelineLogLevel[] = ['error', 'warning', 'success', 'info'];

/** Category labels come from the shared tables; the technical ones are brand words. */
export const CATEGORY_LABEL: Record<PipelineLogCategory, string> = {
  model: 'Modelo',
  json: 'JSON',
  embedding: 'Embeddings',
  provider: 'Proveedor',
  connection: 'Conexión',
  extraction: 'Extracción',
  ocr: 'OCR',
  indexing: 'Indexado',
  queue: 'Cola',
  storage: 'Almacenamiento',
  system: 'Sistema',
};

export const CATEGORY_ORDER: readonly PipelineLogCategory[] = [
  'model', 'json', 'embedding', 'provider', 'connection',
  'extraction', 'ocr', 'indexing', 'queue', 'storage', 'system',
];

/** Where the line's scope puts it, for the scope filter. */
export const SCOPE_LABEL: Partial<Record<PipelineLogEntry['scope'], string>> = {
  extraction: 'Extracción',
  library: 'Extracción de la Biblioteca',
  ocr: 'OCR',
  indexing: 'Indexado de documentos',
  embeddings: 'Embeddings',
  scan: 'Análisis con IA',
};

/**
 * The one value in a line that is prose rather than a field: `{detail}` carries the `message`
 * of the error the main process threw, in whatever language that process wrote it. It is
 * translated through the SAME catalogue the main process uses — `knownRuntimeErrorText` — so a
 * Spanish sentence the catalogue knows reaches an English log in English, and a provider's own
 * wording, a document title or a file path passes through untouched.
 */
function localizeLogDetail(detail: string, language: AppLanguage): string {
  return knownRuntimeErrorText(detail, language) ?? detail;
}

/**
 * Render one stored line in the reader's chosen language. Values that are themselves
 * catalogue ids (`{subject}`, `{reason}`) are resolved in the SAME language, in one pass, so
 * an English log never carries a Spanish fragment inside an English sentence.
 */
export function renderPipelineLogLine(text: PipelineLogText, language: AppLanguage): string {
  const source = PIPELINE_LOG_TEXT[text.id] ?? text.id;
  const vars: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(text.params ?? {})) {
    if (value && typeof value === 'object') {
      vars[name] = txIn(language, PIPELINE_LOG_TEXT[value.id] ?? value.id);
      continue;
    }
    if (name === 'detail' && typeof value === 'string') {
      vars[name] = localizeLogDetail(value, language);
      continue;
    }
    vars[name] = value == null ? '' : String(value);
  }
  return txIn(language, source, vars);
}

/**
 * The secondary line under an entry: an error sentence in the log's language, or the value it
 * always was. `detail` holds whatever the line needed — a document title on a warning, the
 * caught error on a failure — and only the second kind has a translation to reach.
 */
export function renderPipelineLogDetail(detail: string | null | undefined, language: AppLanguage): string | null {
  if (!detail) return null;
  return localizeLogDetail(detail, language);
}

/** `YYYY-MM-DD` of an instant, in the reader's own timezone. */
export function logDay(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** `HH:mm:ss.SSS` — fixed shape on purpose: a log is read next to another one. */
export function logTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (input: number, size = 2) => `${input}`.padStart(size, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

/** The fields shown under a line, as `label: value` chips. */
export function entryFieldChips(entry: PipelineLogEntry): string[] {
  const chips: string[] = [];
  if (entry.httpStatus != null) chips.push(`HTTP ${entry.httpStatus}`);
  if (entry.model) chips.push(entry.model);
  if (entry.provider) chips.push(entry.provider);
  if (entry.phase) chips.push(entry.phase);
  if (entry.durationMs != null) chips.push(`${entry.durationMs} ms`);
  if (entry.attempts != null) chips.push(`#${entry.attempts}`);
  if (entry.retriable) chips.push('retriable');
  return chips;
}

/** Vault/document/job identity, so a shared screenshot keeps its subject. */
export function entryIdentityChips(entry: PipelineLogEntry): string[] {
  const chips: string[] = [];
  if (entry.vaultName ?? entry.vaultId) chips.push(entry.vaultName ?? entry.vaultId ?? '');
  if (entry.documentTitle) chips.push(entry.documentTitle);
  if (entry.jobId) chips.push(entry.jobId);
  return chips;
}

export function categoryLabel(category: PipelineLogCategory): string {
  return t(CATEGORY_LABEL[category] ?? 'Sistema');
}
