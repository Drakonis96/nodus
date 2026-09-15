// Turning the filtered log into the text a reader copies or downloads.
//
// Two deliberate choices, both about the GitHub issue this ends up in:
//
//  - the SENTENCES follow the language chosen beside the filters (English by default), while
//    the field scaffolding (`detail:`, `stack:`, `Filters:`, `Generated:`) stays English. A
//    maintainer should be able to parse a log from a user in any locale;
//  - nothing is summarised away. Counts, ids, model, provider, HTTP status, the provider's own
//    message and the stack all travel, because the field that turns out to matter is never the
//    one that was trimmed.
import type { AppLanguage } from '@shared/types';
import type { PipelineLogEntry, PipelineLogFilter, PipelineLogSort } from '@shared/pipelineLogs';
import { formatPipelineLogsText } from '@shared/pipelineLogs';
import { renderPipelineLogLine } from './logPresentation';
import { t, tx } from '../../i18n';

/** The sentence, in the language the reader picked for the log. */
function translateText(text: PipelineLogEntry['message'], language: AppLanguage): string {
  return renderPipelineLogLine(text, language);
}

/** A one-line description of the active filters, for the export header. */
export function describeLogFilters(filter: PipelineLogFilter): string[] {
  const parts: string[] = [];
  if (filter.levels?.length) parts.push(`levels=${filter.levels.join(',')}`);
  if (filter.categories?.length) parts.push(`types=${filter.categories.join(',')}`);
  if (filter.scopes?.length) parts.push(`scopes=${filter.scopes.join(',')}`);
  if (filter.days?.length) parts.push(`days=${filter.days.join(',')}`);
  if (filter.vaultIds?.length) parts.push(`vaults=${filter.vaultIds.length}`);
  if (filter.search) parts.push(`search=${JSON.stringify(filter.search)}`);
  return parts;
}

/** The downloadable `.txt`: a header, then one block per line. */
export function buildLogsText(
  entries: PipelineLogEntry[],
  options: {
    language: AppLanguage;
    filter: PipelineLogFilter;
    sort: PipelineLogSort;
    total: number;
    appVersion?: string;
  },
): string {
  return formatPipelineLogsText([...entries], {
    translate: (text) => translateText(text, options.language),
    generatedAt: new Date().toISOString(),
    shown: entries.length,
    total: options.total,
    filters: describeLogFilters(options.filter),
    logLanguage: options.language,
    appVersion: options.appVersion,
  });
}

/** One line as text, for the row menu's "copy". */
export function buildLogEntryText(entry: PipelineLogEntry, language: AppLanguage): string {
  return formatPipelineLogsText([entry], {
    translate: (text) => translateText(text, language),
    generatedAt: new Date().toISOString(),
    shown: 1,
    filters: [`entry=${entry.id}`],
    logLanguage: language,
  });
}

/** The same line as JSON, for pasting into a bug report next to a stack trace. */
export function buildLogEntryJson(entry: PipelineLogEntry, language: AppLanguage): string {
  return JSON.stringify({
    id: entry.id,
    at: entry.at,
    firstAt: entry.firstAt ?? null,
    repeat: entry.repeat,
    level: entry.level,
    category: entry.category,
    scope: entry.scope,
    code: entry.code ?? null,
    message: { id: entry.message.id, text: translateText(entry.message, language), params: entry.message.params ?? {} },
    detail: entry.detail ?? null,
    httpStatus: entry.httpStatus ?? null,
    retriable: entry.retriable ?? null,
    attempts: entry.attempts ?? null,
    durationMs: entry.durationMs ?? null,
    provider: entry.provider ?? null,
    model: entry.model ?? null,
    phase: entry.phase ?? null,
    vaultId: entry.vaultId ?? null,
    vaultName: entry.vaultName ?? null,
    nodusId: entry.nodusId ?? null,
    documentTitle: entry.documentTitle ?? null,
    jobId: entry.jobId ?? null,
    stack: entry.stack ?? null,
  }, null, 2);
}

/** `nodus-logs-2026-09-15.txt`, so a folder of exports sorts by date. */
export function suggestedLogFileName(suffix = ''): string {
  const day = new Date().toISOString().slice(0, 10);
  return `nodus-logs-${day}${suffix}.txt`;
}

/** The toast text after a successful save. Reuses the existing 'Guardado en {path}' key. */
export function savedLogNotice(path: string): string {
  return tx('Guardado en {path}', { path });
}

/** The modal's own title, in the interface language. */
export function logsTitle(): string {
  return t('Registros de procesamiento');
}
