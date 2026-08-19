import type { FilterNode } from './databaseQuery';
import type { DatabaseDateRecurrence, DatabaseDateValue } from './databaseProperties';

export const DATABASE_TEMPORAL_EVENT_LIMIT = 500;

export interface DatabaseTemporalQuery {
  databaseId: string;
  startColumnId: string;
  endColumnId?: string | null;
  dependencyColumnId?: string | null;
  windowStart: string;
  windowEnd: string;
  timeZone: string;
  filter?: FilterNode | null;
  limit?: number;
}

export interface DatabaseTemporalEvent {
  /** Stable for one rendered occurrence; sourceRowId remains stable across recurrences. */
  id: string;
  sourceRowId: string;
  title: string;
  start: string;
  end: string;
  startUtc: string;
  endUtc: string;
  includeTime: boolean;
  timeZone: string;
  recurrence: DatabaseDateRecurrence | null;
  occurrence: number;
  dstAdjustment: 'none' | 'gap-forward' | 'overlap-earlier';
  dependencies: string[];
  rowRevision: number;
}

export interface DatabaseTemporalEventPage {
  events: DatabaseTemporalEvent[];
  revision: number;
  truncated: boolean;
  sourceRowsScanned: number;
  windowStart: string;
  windowEnd: string;
}

export interface DatabaseTemporalRangeUpdate {
  databaseId: string;
  rowId: string;
  startColumnId: string;
  endColumnId?: string | null;
  start: string;
  end?: string | null;
  timeZone: string;
  expectedRevision?: number;
}

export interface DatabaseTemporalRangeUpdateResult {
  databaseId: string;
  rowId: string;
  revision: number;
  rowRevision: number;
  start: string;
  end: string;
  dstAdjustment: DatabaseTemporalEvent['dstAdjustment'];
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  includeTime: boolean;
}

const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?)?/;

function localParts(value: string): LocalParts | null {
  const match = LOCAL_PATTERN.exec(value);
  if (!match) return null;
  const result: LocalParts = {
    year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
    hour: Number(match[4] ?? 0), minute: Number(match[5] ?? 0), second: Number(match[6] ?? 0),
    includeTime: match[4] != null,
  };
  const check = new Date(partsEpoch(result));
  if (check.getUTCFullYear() !== result.year || check.getUTCMonth() !== result.month - 1 || check.getUTCDate() !== result.day
    || result.hour > 23 || result.minute > 59 || result.second > 59) return null;
  return result;
}

function pad(value: number, width = 2): string { return String(value).padStart(width, '0'); }

function formatLocal(parts: LocalParts, includeTime = parts.includeTime): string {
  const date = `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;
  return includeTime ? `${date}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}` : date;
}

function formatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function partsAt(epoch: number, timeZone: string): LocalParts {
  const values = Object.fromEntries(formatter(timeZone).formatToParts(new Date(epoch)).map((part) => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day), hour: Number(values.hour),
    minute: Number(values.minute), second: Number(values.second), includeTime: true };
}

function partsEpoch(parts: LocalParts): number {
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour, parts.minute, parts.second, 0);
  return date.getTime();
}

function sameWall(left: LocalParts, right: LocalParts): boolean {
  return left.year === right.year && left.month === right.month && left.day === right.day && left.hour === right.hour
    && left.minute === right.minute && left.second === right.second;
}

export function isValidTimeZone(timeZone: string): boolean {
  try { formatter(timeZone).format(0); return true; } catch { return false; }
}

/** Resolve a local wall-clock value in an IANA zone, exposing DST gaps/overlaps explicitly. */
export function resolveDatabaseZonedDate(local: string, requestedTimeZone: string): {
  utc: string;
  timeZone: string;
  adjustment: DatabaseTemporalEvent['dstAdjustment'];
} {
  const parsed = localParts(local);
  if (!parsed) throw new Error(`Fecha fuera de rango o no válida: ${local}`);
  const timeZone = isValidTimeZone(requestedTimeZone) ? requestedTimeZone : 'UTC';
  const naive = partsEpoch(parsed);
  const offsets = new Set<number>();
  for (const delta of [-86_400_000, -21_600_000, 0, 21_600_000, 86_400_000]) {
    const sample = naive + delta;
    offsets.add(partsEpoch(partsAt(sample, timeZone)) - sample);
  }
  const matches = [...offsets]
    .map((offset) => naive - offset)
    .filter((epoch) => sameWall(partsAt(epoch, timeZone), parsed))
    .sort((left, right) => left - right);
  if (matches.length > 0) {
    return { utc: new Date(matches[0]).toISOString(), timeZone, adjustment: matches.length > 1 ? 'overlap-earlier' : 'none' };
  }
  // Non-existent spring-forward wall time: advance minute by minute to the first valid
  // instant. The caller can render this fact rather than silently pretending it existed.
  for (let minute = 1; minute <= 180; minute += 1) {
    const advanced = new Date(naive + minute * 60_000);
    const candidate: LocalParts = { year: advanced.getUTCFullYear(), month: advanced.getUTCMonth() + 1,
      day: advanced.getUTCDate(), hour: advanced.getUTCHours(), minute: advanced.getUTCMinutes(),
      second: advanced.getUTCSeconds(), includeTime: parsed.includeTime };
    for (const offset of offsets) {
      const epoch = partsEpoch(candidate) - offset;
      if (sameWall(partsAt(epoch, timeZone), candidate)) {
        return { utc: new Date(epoch).toISOString(), timeZone, adjustment: 'gap-forward' };
      }
    }
  }
  throw new Error(`No se pudo resolver la fecha ${local} en ${timeZone}.`);
}

function addLocal(value: string, amount: number, unit: DatabaseDateRecurrence | 'hour'): string {
  const parts = localParts(value);
  if (!parts) throw new Error(`Fecha fuera de rango o no válida: ${value}`);
  const date = new Date(partsEpoch(parts));
  if (unit === 'hour') date.setUTCHours(date.getUTCHours() + amount);
  else if (unit === 'daily') date.setUTCDate(date.getUTCDate() + amount);
  else if (unit === 'weekly') date.setUTCDate(date.getUTCDate() + amount * 7);
  else if (unit === 'monthly') {
    const wantedDay = date.getUTCDate();
    date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + amount);
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(wantedDay, last));
  } else {
    const wantedMonth = date.getUTCMonth(); const wantedDay = date.getUTCDate();
    date.setUTCDate(1); date.setUTCFullYear(date.getUTCFullYear() + amount); date.setUTCMonth(wantedMonth);
    const last = new Date(Date.UTC(date.getUTCFullYear(), wantedMonth + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(wantedDay, last));
  }
  const next: LocalParts = { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(),
    hour: date.getUTCHours(), minute: date.getUTCMinutes(), second: date.getUTCSeconds(), includeTime: parts.includeTime };
  if (next.year < 1 || next.year > 9999) throw new Error('La fecha debe estar entre los años 0001 y 9999.');
  return formatLocal(next, parts.includeTime);
}

export function shiftDatabaseLocalDate(value: string, amount: number, unit: 'hours' | 'days' | 'weeks' | 'months' | 'years'): string {
  const recurrence = unit === 'hours' ? 'hour' : unit === 'days' ? 'daily' : unit === 'weeks' ? 'weekly' : unit === 'months' ? 'monthly' : 'yearly';
  return addLocal(value, amount, recurrence);
}

function localDurationMs(start: string, end: string): number {
  const left = localParts(start); const right = localParts(end);
  if (!left || !right) return 0;
  return Math.max(0, partsEpoch(right) - partsEpoch(left));
}

function addDurationLocal(start: string, duration: number, includeTime: boolean): string {
  const parsed = localParts(start);
  if (!parsed) throw new Error(`Fecha no válida: ${start}`);
  const date = new Date(partsEpoch(parsed) + duration);
  return formatLocal({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(),
    hour: date.getUTCHours(), minute: date.getUTCMinutes(), second: date.getUTCSeconds(), includeTime }, includeTime);
}

export function expandDatabaseDateOccurrences(
  value: DatabaseDateValue,
  windowStartUtc: string,
  windowEndUtc: string,
  defaultTimeZone: string,
  limit = DATABASE_TEMPORAL_EVENT_LIMIT,
): Array<{ start: string; end: string; startUtc: string; endUtc: string; occurrence: number; dstAdjustment: DatabaseTemporalEvent['dstAdjustment'] }> {
  const windowStart = Date.parse(windowStartUtc); const windowEnd = Date.parse(windowEndUtc);
  if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd) || windowEnd <= windowStart) throw new Error('Ventana temporal no válida.');
  const timeZone = value.timeZone || defaultTimeZone || 'UTC';
  const displayDuration = localDurationMs(value.start, value.end || value.start);
  const overlapDuration = displayDuration || (value.includeTime ? 3_600_000 : 86_400_000);
  const output: Array<{ start: string; end: string; startUtc: string; endUtc: string; occurrence: number; dstAdjustment: DatabaseTemporalEvent['dstAdjustment'] }> = [];
  let start = value.start;
  let occurrence = 0;
  const hardLimit = Math.max(1, Math.min(DATABASE_TEMPORAL_EVENT_LIMIT, Math.floor(limit)));
  // An old recurring source is advanced in bounded calendar jumps rather than creating
  // every historical occurrence as an object.
  while (value.recurrence && occurrence < 1_000_000) {
    const resolved = resolveDatabaseZonedDate(start, timeZone);
    if (Date.parse(resolved.utc) >= windowStart - overlapDuration) break;
    occurrence += 1;
    start = addLocal(value.start, occurrence, value.recurrence);
  }
  while (output.length < hardLimit && occurrence < 1_000_000) {
    const end = addDurationLocal(start, displayDuration, Boolean(value.includeTime));
    // All-day end dates are inclusive in the property editor; interval arithmetic uses
    // the following midnight. A point-in-time value gets one hour of visible area.
    const intervalEnd = value.includeTime
      ? addDurationLocal(start, overlapDuration, true)
      : addDurationLocal(end, 86_400_000, false);
    const resolvedStart = resolveDatabaseZonedDate(start, timeZone);
    const resolvedEnd = resolveDatabaseZonedDate(intervalEnd, timeZone);
    const startEpoch = Date.parse(resolvedStart.utc); const endEpoch = Date.parse(resolvedEnd.utc);
    if (startEpoch >= windowEnd) break;
    if (endEpoch > windowStart && startEpoch < windowEnd) output.push({ start, end, startUtc: resolvedStart.utc, endUtc: resolvedEnd.utc,
      occurrence, dstAdjustment: resolvedStart.adjustment !== 'none' ? resolvedStart.adjustment : resolvedEnd.adjustment });
    if (!value.recurrence) break;
    occurrence += 1;
    start = addLocal(value.start, occurrence, value.recurrence);
  }
  return output;
}

/** Greedy interval partitioning used by week/day calendars; lane count is minimal. */
export function layoutDatabaseTemporalOverlaps<T extends { startUtc: string; endUtc: string }>(events: T[]): Array<T & { lane: number; laneCount: number }> {
  const ordered = [...events].sort((left, right) => Date.parse(left.startUtc) - Date.parse(right.startUtc) || Date.parse(left.endUtc) - Date.parse(right.endUtc));
  const result: Array<T & { lane: number; laneCount: number; cluster: number }> = [];
  const laneEnds: number[] = [];
  let cluster = 0; let clusterEnd = Number.NEGATIVE_INFINITY;
  for (const event of ordered) {
    const start = Date.parse(event.startUtc); const end = Math.max(start + 1, Date.parse(event.endUtc));
    if (start >= clusterEnd) { cluster += 1; laneEnds.length = 0; clusterEnd = end; }
    else clusterEnd = Math.max(clusterEnd, end);
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = end;
    result.push({ ...event, lane, laneCount: 1, cluster });
  }
  for (const item of result) item.laneCount = Math.max(...result.filter((candidate) => candidate.cluster === item.cluster).map((candidate) => candidate.lane + 1));
  return result.map((item) => {
    const output = { ...item } as T & { lane: number; laneCount: number; cluster?: number };
    delete output.cluster;
    return output;
  });
}
