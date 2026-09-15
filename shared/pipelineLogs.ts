/**
 * Plain-data model for the processing log: extraction, OCR, indexing, embeddings and
 * the provider/JSON/connection failures around them.
 *
 * It is deliberately free of Electron, the database and the filesystem, because three
 * different readers share it: the main process appends, the renderer queries, and
 * `scripts/test-pipeline-logs.mjs` asserts the retention, grouping, filtering and export
 * behaviour directly. The store is one global file (a corpus run crosses vaults and the
 * Library) and is NOT vault content: it is local diagnostics, excluded from backups and
 * sync like the Browser history.
 *
 * Entries are stored as a catalogue id plus values, never as prose — see
 * shared/pipelineLogMessages.ts. Sorting, day bucketing and filtering therefore only ever
 * touch language-neutral fields, which is also what makes `time` and `repeat` stable.
 */

import type { PipelineLogParamValue, PipelineLogText, PipelineLogTextId } from './pipelineLogMessages';
import { PIPELINE_LOG_TEXT, pipelineLogSignature } from './pipelineLogMessages';

export type PipelineLogLevel = 'success' | 'error' | 'warning' | 'info';

export type PipelineLogCategory =
  | 'model'
  | 'json'
  | 'embedding'
  | 'provider'
  | 'connection'
  | 'extraction'
  | 'ocr'
  | 'indexing'
  | 'queue'
  | 'storage'
  | 'system';

/** Which pipeline produced the line. `chat`/`research` cover AI failures outside it. */
export type PipelineLogScope =
  | 'extraction'
  | 'library'
  | 'ocr'
  | 'indexing'
  | 'embeddings'
  | 'scan'
  | 'chat'
  | 'research'
  | 'app';

export const PIPELINE_LOG_LEVELS: readonly PipelineLogLevel[] = ['success', 'error', 'warning', 'info'];
export const PIPELINE_LOG_CATEGORIES: readonly PipelineLogCategory[] = [
  'model', 'json', 'embedding', 'provider', 'connection',
  'extraction', 'ocr', 'indexing', 'queue', 'storage', 'system',
];
export const PIPELINE_LOG_SCOPES: readonly PipelineLogScope[] = [
  'extraction', 'library', 'ocr', 'indexing', 'embeddings', 'scan', 'chat', 'research', 'app',
];

/** One recorded event. `at` is the most recent occurrence, so a repeat bubbles up. */
export interface PipelineLogEntry {
  id: string;
  /** ISO instant of the most recent occurrence (or the only one). */
  at: string;
  level: PipelineLogLevel;
  category: PipelineLogCategory;
  scope: PipelineLogScope;
  message: PipelineLogText;
  /** Language-neutral badge: invalid_json, timeout, rate_limit, auth, uncaught… */
  code?: string | null;
  /** Runtime prose that has no key (a provider's own message), shown verbatim. */
  detail?: string | null;
  retriable?: boolean | null;
  attempts?: number | null;
  httpStatus?: number | null;
  provider?: string | null;
  model?: string | null;
  durationMs?: number | null;
  phase?: string | null;
  vaultId?: string | null;
  vaultName?: string | null;
  nodusId?: string | null;
  documentTitle?: string | null;
  jobId?: string | null;
  /** How many identical lines were grouped into this one. 1 when it never repeated. */
  repeat: number;
  /** Set only when `repeat` > 1: when the first occurrence was recorded. */
  firstAt?: string | null;
  /** Only for uncaught failures. */
  stack?: string | null;
}

export interface PipelineLogStore {
  version: 1;
  revision: number;
  entries: PipelineLogEntry[];
}

export type PipelineLogSort = 'newest' | 'oldest';

export interface PipelineLogFilter {
  /** Exact entry ids, for deleting the single row under the cursor. */
  ids?: string[];
  levels?: PipelineLogLevel[];
  categories?: PipelineLogCategory[];
  scopes?: PipelineLogScope[];
  vaultIds?: string[];
  /** Local calendar days (`YYYY-MM-DD`), as produced by {@link localDayKey}. */
  days?: string[];
  /** Matches language-neutral fields only: codes, ids, model, provider, detail prose. */
  search?: string;
}

export interface PipelineLogQuery {
  filter?: PipelineLogFilter;
  sort?: PipelineLogSort;
  limit?: number;
  offset?: number;
}

export interface PipelineLogCount<T> {
  value: T;
  count: number;
}

export interface PipelineLogVaultCount {
  id: string;
  label: string;
  count: number;
}

export interface PipelineLogFacets {
  total: number;
  levels: PipelineLogCount<PipelineLogLevel>[];
  categories: PipelineLogCount<PipelineLogCategory>[];
  scopes: PipelineLogCount<PipelineLogScope>[];
  vaults: PipelineLogVaultCount[];
  /** Newest day first. */
  days: PipelineLogCount<string>[];
}

export interface PipelineLogResult {
  entries: PipelineLogEntry[];
  /** Entries matching the filter, not the page. */
  total: number;
  /** Computed over the whole store, so the counts never depend on the active filter. */
  facets: PipelineLogFacets;
  revision: number;
}

export type PipelineLogRetention = '1d' | '3d' | '7d' | '10d' | '30d' | '90d' | 'forever';

export const PIPELINE_LOG_RETENTION_OPTIONS: readonly PipelineLogRetention[] = [
  '1d', '3d', '7d', '10d', '30d', '90d', 'forever',
];
export const DEFAULT_PIPELINE_LOG_RETENTION: PipelineLogRetention = '10d';

export const PIPELINE_LOG_MAX_ENTRIES_OPTIONS: readonly number[] = [1_000, 5_000, 20_000];
export const DEFAULT_PIPELINE_LOG_MAX_ENTRIES = 5_000;
export const MAX_PIPELINE_LOG_ENTRIES = 20_000;

/** Identical lines inside this window are grouped into one row instead of piling up. */
export const PIPELINE_LOG_REPEAT_WINDOW_MS = 5_000;
/** Beyond this many new lines per second the store records one "discarded" summary. */
export const PIPELINE_LOG_BURST_WINDOW_MS = 1_000;
export const PIPELINE_LOG_BURST_LIMIT = 60;

export const DEFAULT_PIPELINE_LOG_LIMIT = 300;
export const MAX_PIPELINE_LOG_LIMIT = 2_000;

const RETENTION_MS: Record<Exclude<PipelineLogRetention, 'forever'>, number> = {
  '1d': 24 * 60 * 60 * 1_000,
  '3d': 3 * 24 * 60 * 60 * 1_000,
  '7d': 7 * 24 * 60 * 60 * 1_000,
  '10d': 10 * 24 * 60 * 60 * 1_000,
  '30d': 30 * 24 * 60 * 60 * 1_000,
  '90d': 90 * 24 * 60 * 60 * 1_000,
};

const LEVELS = new Set<string>(PIPELINE_LOG_LEVELS);
const CATEGORIES = new Set<string>(PIPELINE_LOG_CATEGORIES);
const SCOPES = new Set<string>(PIPELINE_LOG_SCOPES);
const RETENTIONS = new Set<string>(PIPELINE_LOG_RETENTION_OPTIONS);
const TEXT_IDS = new Set<string>(Object.keys(PIPELINE_LOG_TEXT));

const DETAIL_LIMIT = 4_000;
const STACK_LIMIT = 4_000;
const TITLE_LIMIT = 300;
const SHORT_LIMIT = 120;
const CODE_LIMIT = 64;
const PARAM_LIMIT = 500;
const MAX_PARAMS = 16;

/** Limits applied on every append; the store never grows past `maxEntries`. */
export interface PipelineLogLimits {
  retention: PipelineLogRetention;
  maxEntries: number;
}

export function isPipelineLogRetention(value: unknown): value is PipelineLogRetention {
  return typeof value === 'string' && RETENTIONS.has(value);
}

export function isPipelineLogMaxEntries(value: unknown): boolean {
  return typeof value === 'number' && PIPELINE_LOG_MAX_ENTRIES_OPTIONS.includes(value);
}

export function normalizePipelineLogRetention(value: unknown): PipelineLogRetention {
  return isPipelineLogRetention(value) ? value : DEFAULT_PIPELINE_LOG_RETENTION;
}

/**
 * The setting is one of a few offered values ({@link isPipelineLogMaxEntries} guards the
 * write path), but the model honours any positive count: the cap is the last line of defence
 * against a runaway producer, and it must not become 5000 because a caller passed 10.
 */
export function clampPipelineLogMaxEntries(value: unknown): number {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_PIPELINE_LOG_MAX_ENTRIES;
  return Math.min(MAX_PIPELINE_LOG_ENTRIES, parsed);
}

export function normalizePipelineLogMaxEntries(value: unknown): number {
  return isPipelineLogMaxEntries(value) ? (value as number) : DEFAULT_PIPELINE_LOG_MAX_ENTRIES;
}

/** The local calendar day an instant falls on, as `YYYY-MM-DD`. */
export function localDayKey(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** `null` means "never delete"; otherwise the oldest instant that is still kept. */
export function pipelineLogRetentionCutoff(retention: PipelineLogRetention, now = Date.now()): number | null {
  if (retention === 'forever') return null;
  return now - RETENTION_MS[retention];
}

export function emptyPipelineLogStore(): PipelineLogStore {
  return { version: 1, revision: 0, entries: [] };
}

function cleanText(value: unknown, limit: number): string {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex -- provider text can carry control bytes
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function cleanOptional(value: unknown, limit: number): string | null {
  if (value == null) return null;
  const text = cleanText(value, limit);
  return text || null;
}

function cleanNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function cleanBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/** Sanitize the values of a line, dropping anything that is not a scalar or a text id. */
function cleanParams(value: unknown): Record<string, PipelineLogParamValue> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, PipelineLogParamValue> = {};
  let count = 0;
  for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
    if (count >= MAX_PARAMS) break;
    if (!/^[a-zA-Z][\w]{0,31}$/.test(name)) continue;
    if (typeof raw === 'number') {
      if (Number.isFinite(raw)) { out[name] = raw; count += 1; }
      continue;
    }
    if (typeof raw === 'boolean') { out[name] = raw; count += 1; continue; }
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const id = (raw as { id?: unknown }).id;
      if (typeof id === 'string' && TEXT_IDS.has(id)) { out[name] = { id: id as PipelineLogTextId }; count += 1; }
      continue;
    }
    const text = cleanText(raw, PARAM_LIMIT);
    if (text) { out[name] = text; count += 1; }
  }
  return Object.keys(out).length ? out : undefined;
}

function cleanMessage(value: unknown): PipelineLogText | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = (value as { id?: unknown }).id;
  if (typeof id !== 'string' || !TEXT_IDS.has(id)) return null;
  const params = cleanParams((value as { params?: unknown }).params);
  return params ? { id: id as PipelineLogText['id'], params } : { id: id as PipelineLogText['id'] };
}

/**
 * Read back whatever is on disk. A corrupt or half-written file must never break the app:
 * every field is re-validated and unusable entries are dropped, not repaired.
 */
export function normalizePipelineLogStore(value: unknown): PipelineLogStore {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyPipelineLogStore();
  const candidate = value as Partial<PipelineLogStore>;
  const seen = new Set<string>();
  const entries: PipelineLogEntry[] = [];
  for (const raw of Array.isArray(candidate.entries) ? candidate.entries : []) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const item = raw as Partial<PipelineLogEntry>;
    const id = cleanText(item.id, SHORT_LIMIT);
    const time = Date.parse(String(item.at ?? ''));
    const level = cleanText(item.level, 16);
    const category = cleanText(item.category, 24);
    const scope = cleanText(item.scope, 24);
    const message = cleanMessage(item.message);
    if (!id || seen.has(id) || !Number.isFinite(time) || !LEVELS.has(level)
      || !CATEGORIES.has(category) || !SCOPES.has(scope) || !message) continue;
    seen.add(id);
    const firstAt = Date.parse(String(item.firstAt ?? ''));
    const repeat = Math.max(1, Math.min(1_000_000, Math.floor(Number(item.repeat) || 1)));
    entries.push({
      id,
      at: new Date(time).toISOString(),
      level: level as PipelineLogLevel,
      category: category as PipelineLogCategory,
      scope: scope as PipelineLogScope,
      message,
      code: cleanOptional(item.code, CODE_LIMIT),
      detail: cleanOptional(item.detail, DETAIL_LIMIT),
      retriable: cleanBoolean(item.retriable),
      attempts: cleanNumber(item.attempts),
      httpStatus: cleanNumber(item.httpStatus),
      provider: cleanOptional(item.provider, SHORT_LIMIT),
      model: cleanOptional(item.model, SHORT_LIMIT),
      durationMs: cleanNumber(item.durationMs),
      phase: cleanOptional(item.phase, CODE_LIMIT),
      vaultId: cleanOptional(item.vaultId, SHORT_LIMIT),
      vaultName: cleanOptional(item.vaultName, TITLE_LIMIT),
      nodusId: cleanOptional(item.nodusId, SHORT_LIMIT),
      documentTitle: cleanOptional(item.documentTitle, TITLE_LIMIT),
      jobId: cleanOptional(item.jobId, SHORT_LIMIT),
      repeat,
      firstAt: repeat > 1 && Number.isFinite(firstAt) ? new Date(firstAt).toISOString() : null,
      stack: cleanOptional(item.stack, STACK_LIMIT),
    });
    if (entries.length >= MAX_PIPELINE_LOG_ENTRIES) break;
  }
  entries.sort((a, b) => b.at.localeCompare(a.at));
  return {
    version: 1,
    revision: Math.max(0, Math.floor(Number(candidate.revision) || 0)),
    entries,
  };
}

/** Age horizon first, then the hard entry cap. Both are bounded by the model limits. */
export function prunePipelineLogs(store: PipelineLogStore, limits: PipelineLogLimits, now = Date.now()): PipelineLogStore {
  const normalized = normalizePipelineLogStore(store);
  const cutoff = pipelineLogRetentionCutoff(limits.retention, now);
  const maxEntries = clampPipelineLogMaxEntries(limits.maxEntries);
  const kept = cutoff == null
    ? normalized.entries
    : normalized.entries.filter((entry) => Date.parse(entry.at) >= cutoff);
  const capped = kept.length > maxEntries ? kept.slice(0, maxEntries) : kept;
  if (capped.length === normalized.entries.length) return normalized;
  return { ...normalized, revision: normalized.revision + 1, entries: capped };
}

function entrySignature(entry: PipelineLogEntry): string {
  return [
    entry.level,
    entry.category,
    entry.scope,
    entry.code ?? '',
    entry.provider ?? '',
    entry.model ?? '',
    entry.jobId ?? '',
    entry.nodusId ?? '',
    pipelineLogSignature(entry.message),
    entry.detail ?? '',
  ].join('\u0000');
}

/**
 * Append what the pipeline just recorded.
 *
 * Three things happen here rather than at the call site, so every producer gets them for
 * free: identical lines inside {@link PIPELINE_LOG_REPEAT_WINDOW_MS} increment `repeat`
 * instead of adding a row (a provider outage must not bury everything else); a burst past
 * {@link PIPELINE_LOG_BURST_LIMIT} per second collapses into one summary line; and the
 * age/count limits are applied on write, so the file cannot grow unbounded between the
 * scheduled prunes.
 */
export function appendPipelineLogEntries(
  store: PipelineLogStore,
  incoming: PipelineLogEntry[],
  limits: PipelineLogLimits,
  now = Date.now(),
): PipelineLogStore {
  if (incoming.length === 0) return normalizePipelineLogStore(store);
  const normalized = normalizePipelineLogStore(store);
  // Entries are kept newest-first, so both the burst tally and the grouping scan stop at
  // the window edge instead of walking the whole store.
  const entries = [...normalized.entries];
  let inBurstWindow = 0;
  for (const entry of entries) {
    if (now - Date.parse(entry.at) > PIPELINE_LOG_BURST_WINDOW_MS) break;
    inBurstWindow += 1;
  }
  let changed = false;

  for (const raw of incoming) {
    const [entry] = normalizePipelineLogStore({ version: 1, revision: 0, entries: [raw] }).entries;
    if (!entry) continue;
    const at = new Date(now).toISOString();

    if (inBurstWindow >= PIPELINE_LOG_BURST_LIMIT) {
      const summary = entries.find((candidate) => candidate.message.id === 'burstDiscarded'
        && now - Date.parse(candidate.at) <= PIPELINE_LOG_BURST_WINDOW_MS);
      if (summary) {
        summary.repeat += 1;
        summary.at = at;
        summary.message = { id: 'burstDiscarded', params: { count: summary.repeat } };
      } else {
        entries.unshift({
          ...entry,
          level: 'warning',
          category: 'system',
          scope: 'app',
          message: { id: 'burstDiscarded', params: { count: 1 } },
          code: 'burst_limit',
          detail: null,
          repeat: 1,
          firstAt: null,
        });
        inBurstWindow += 1;
      }
      changed = true;
      continue;
    }

    const signature = entrySignature(entry);
    // Group against the incoming line's own instant, not against `now`: the two are the same
    // in production, but keying on the entry keeps the rule "identical lines that happened
    // together" true even when a caller (or a test) replays an older sample.
    const incomingAt = Date.parse(entry.at);
    let target: PipelineLogEntry | undefined;
    for (const candidate of entries) {
      const candidateAt = Date.parse(candidate.at);
      if (candidateAt < incomingAt - PIPELINE_LOG_REPEAT_WINDOW_MS) break;
      if (Math.abs(candidateAt - incomingAt) <= PIPELINE_LOG_REPEAT_WINDOW_MS && entrySignature(candidate) === signature) {
        target = candidate;
        break;
      }
    }
    if (target) {
      target.repeat += 1;
      target.firstAt = target.firstAt ?? target.at;
      target.at = at;
      changed = true;
      continue;
    }
    entries.unshift(entry);
    inBurstWindow += 1;
    changed = true;
  }

  if (!changed) return normalized;
  entries.sort((a, b) => b.at.localeCompare(a.at));
  return prunePipelineLogs({ ...normalized, revision: normalized.revision + 1, entries }, limits, now);
}

function matchesSearch(entry: PipelineLogEntry, needle: string): boolean {
  if (!needle) return true;
  const params = Object.values(entry.message.params ?? {}).map((value) => (
    value && typeof value === 'object' ? value.id : String(value)
  ));
  const haystack = [
    entry.id, entry.code, entry.provider, entry.model, entry.phase, entry.detail,
    entry.vaultName, entry.documentTitle, entry.vaultId, entry.nodusId, entry.jobId,
    entry.category, entry.scope, entry.level, entry.message.id,
    entry.httpStatus == null ? '' : String(entry.httpStatus),
    ...params,
  ].join('\n').toLocaleLowerCase();
  return haystack.includes(needle);
}

export function pipelineLogMatchesFilter(entry: PipelineLogEntry, filter: PipelineLogFilter = {}): boolean {
  if (filter.ids?.length && !filter.ids.includes(entry.id)) return false;
  if (filter.levels?.length && !filter.levels.includes(entry.level)) return false;
  if (filter.categories?.length && !filter.categories.includes(entry.category)) return false;
  if (filter.scopes?.length && !filter.scopes.includes(entry.scope)) return false;
  if (filter.vaultIds?.length && !(entry.vaultId && filter.vaultIds.includes(entry.vaultId))) return false;
  if (filter.days?.length && !filter.days.includes(localDayKey(entry.at))) return false;
  const search = cleanText(filter.search, 200).toLocaleLowerCase();
  return matchesSearch(entry, search);
}

/** Counts over the WHOLE store, so a filter never changes the numbers beside it. */
export function pipelineLogFacets(store: PipelineLogStore): PipelineLogFacets {
  const entries = normalizePipelineLogStore(store).entries;
  const tally = <T extends string>(pick: (entry: PipelineLogEntry) => T | null | undefined, order: readonly T[]) => {
    const counts = new Map<T, number>();
    for (const entry of entries) {
      const value = pick(entry);
      if (value == null) continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return order
      .filter((value) => counts.has(value))
      .map((value) => ({ value, count: counts.get(value) ?? 0 }));
  };
  const vaults = new Map<string, PipelineLogVaultCount>();
  for (const entry of entries) {
    if (!entry.vaultId) continue;
    const current = vaults.get(entry.vaultId);
    if (current) current.count += 1;
    else vaults.set(entry.vaultId, { id: entry.vaultId, label: entry.vaultName ?? entry.vaultId, count: 1 });
  }
  const days = new Map<string, number>();
  for (const entry of entries) {
    const day = localDayKey(entry.at);
    if (day) days.set(day, (days.get(day) ?? 0) + 1);
  }
  return {
    total: entries.length,
    levels: tally((entry) => entry.level, PIPELINE_LOG_LEVELS),
    categories: tally((entry) => entry.category, PIPELINE_LOG_CATEGORIES),
    scopes: tally((entry) => entry.scope, PIPELINE_LOG_SCOPES),
    vaults: [...vaults.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    days: [...days.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.value.localeCompare(a.value)),
  };
}

export function queryPipelineLogs(store: PipelineLogStore, query: PipelineLogQuery = {}): PipelineLogResult {
  const normalized = normalizePipelineLogStore(store);
  const filter = query.filter ?? {};
  const matched = normalized.entries.filter((entry) => pipelineLogMatchesFilter(entry, filter));
  const ordered = query.sort === 'oldest' ? [...matched].reverse() : matched;
  const limit = Math.max(1, Math.min(MAX_PIPELINE_LOG_LIMIT, Math.floor(Number(query.limit) || DEFAULT_PIPELINE_LOG_LIMIT)));
  const offset = Math.max(0, Math.floor(Number(query.offset) || 0));
  return {
    entries: ordered.slice(offset, offset + limit),
    total: matched.length,
    facets: pipelineLogFacets(normalized),
    revision: normalized.revision,
  };
}

/**
 * Delete every entry the filter selects. With an empty filter this is "delete all", which
 * is why the UI always confirms it with the affected count in hand.
 */
export function deletePipelineLogs(store: PipelineLogStore, filter: PipelineLogFilter = {}): PipelineLogStore {
  const normalized = normalizePipelineLogStore(store);
  const kept = normalized.entries.filter((entry) => !pipelineLogMatchesFilter(entry, filter));
  return kept.length === normalized.entries.length
    ? normalized
    : { ...normalized, revision: normalized.revision + 1, entries: kept };
}

/** Delete one entry by id, for the row menu. */
export function deletePipelineLogEntry(store: PipelineLogStore, id: string): PipelineLogStore {
  const normalized = normalizePipelineLogStore(store);
  const kept = normalized.entries.filter((entry) => entry.id !== id);
  return kept.length === normalized.entries.length
    ? normalized
    : { ...normalized, revision: normalized.revision + 1, entries: kept };
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[]): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const permitted = new Set<string>(allowed);
  const out = value.filter((item): item is T => typeof item === 'string' && permitted.has(item));
  return out.length ? out : undefined;
}

function pickStrings(value: unknown, limit: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((item): item is string => typeof item === 'string' && item.length <= 200).slice(0, limit);
  return out.length ? out : undefined;
}

/**
 * Re-validate a filter that came from the renderer. Nothing about a delete request is
 * trusted: an unknown category must narrow the selection to nothing rather than widen it to
 * the whole log, which is what a missing validation would do.
 */
export function sanitizePipelineLogFilter(value: unknown): PipelineLogFilter {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const candidate = value as PipelineLogFilter;
  return {
    ids: pickStrings(candidate.ids, 200),
    levels: pickEnum(candidate.levels, PIPELINE_LOG_LEVELS),
    categories: pickEnum(candidate.categories, PIPELINE_LOG_CATEGORIES),
    scopes: pickEnum(candidate.scopes, PIPELINE_LOG_SCOPES),
    vaultIds: pickStrings(candidate.vaultIds, 200),
    days: pickStrings(candidate.days, 400)?.filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day)),
    search: typeof candidate.search === 'string' ? cleanText(candidate.search, 200) : undefined,
  };
}

/** The same, for a whole query: sort, paging and the filter. */
export function sanitizePipelineLogQuery(value: unknown): Required<Pick<PipelineLogQuery, 'sort' | 'limit' | 'offset'>> & { filter: PipelineLogFilter } {
  const candidate = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as PipelineLogQuery;
  const limit = Math.floor(Number(candidate.limit));
  const offset = Math.floor(Number(candidate.offset));
  return {
    filter: sanitizePipelineLogFilter(candidate.filter),
    sort: candidate.sort === 'oldest' ? 'oldest' : 'newest',
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(MAX_PIPELINE_LOG_LIMIT, limit) : DEFAULT_PIPELINE_LOG_LIMIT,
    offset: Number.isFinite(offset) && offset > 0 ? offset : 0,
  };
}

const EXPORT_RULE = '─'.repeat(78);

/**
 * Render one entry as a line of the exported log. The sentence comes from `translate`,
 * which the renderer supplies in the language the reader picked for the logs; the field
 * scaffolding stays English on purpose, because the export is an artefact meant to be
 * pasted into a GitHub issue where a stable, parseable shape matters more than locale.
 */
export function formatPipelineLogEntry(entry: PipelineLogEntry, translate: (text: PipelineLogText) => string): string {
  const lines: string[] = [];
  const repeat = entry.repeat > 1 ? `  ×${entry.repeat}${entry.firstAt ? ` (first ${entry.firstAt})` : ''}` : '';
  lines.push(`${entry.at}  ${entry.level.toUpperCase().padEnd(7)}  ${entry.category}${entry.code ? `  [${entry.code}]` : ''}${repeat}`);
  const fields: string[] = [];
  if (entry.httpStatus != null) fields.push(`http=${entry.httpStatus}`);
  if (entry.model) fields.push(`model=${entry.model}`);
  if (entry.provider) fields.push(`provider=${entry.provider}`);
  if (entry.phase) fields.push(`phase=${entry.phase}`);
  if (entry.attempts != null) fields.push(`attempts=${entry.attempts}`);
  if (entry.retriable != null) fields.push(`retriable=${entry.retriable}`);
  if (entry.durationMs != null) fields.push(`duration=${entry.durationMs}ms`);
  if (entry.vaultName ?? entry.vaultId) fields.push(`vault=${JSON.stringify(entry.vaultName ?? entry.vaultId ?? '')}`);
  if (entry.documentTitle) fields.push(`document=${JSON.stringify(entry.documentTitle)}`);
  if (entry.nodusId) fields.push(`nodus=${entry.nodusId}`);
  if (entry.jobId) fields.push(`job=${entry.jobId}`);
  if (entry.scope !== 'app') fields.push(`scope=${entry.scope}`);
  if (fields.length) lines.push(`  ${fields.join(' · ')}`);
  lines.push(`  ${translate(entry.message)}`);
  if (entry.detail) lines.push(`  detail: ${entry.detail}`);
  if (entry.stack) lines.push(`  stack:\n${entry.stack.split('\n').map((line) => `    ${line}`).join('\n')}`);
  return lines.join('\n');
}

/**
 * The downloadable `.txt`: a header that says what was exported and under which filters,
 * then one block per entry. `shown` and `total` are both reported so a filtered export
 * can never be mistaken for the whole log.
 */
export function formatPipelineLogsText(
  entries: PipelineLogEntry[],
  options: {
    translate: (text: PipelineLogText) => string;
    generatedAt?: string;
    shown?: number;
    total?: number;
    filters?: string[];
    logLanguage?: string;
    appVersion?: string;
  },
): string {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const parts = [
    'Nodus processing logs',
    `Generated: ${generatedAt}${options.appVersion ? ` · Nodus ${options.appVersion}` : ''}`,
    `Entries: ${options.shown ?? entries.length}${options.total != null ? ` of ${options.total}` : ''}`,
    `Log language: ${options.logLanguage ?? 'en'}`,
    `Filters: ${options.filters?.length ? options.filters.join(' · ') : 'none'}`,
  ];
  const body = entries.map((entry) => formatPipelineLogEntry(entry, options.translate));
  return [
    ...parts,
    EXPORT_RULE,
    '',
    body.length ? body.join(`\n${EXPORT_RULE}\n`) : '(no entries)',
    '',
  ].join('\n');
}
