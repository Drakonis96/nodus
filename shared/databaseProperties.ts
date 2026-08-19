/** Lossless codecs for the structured values carried through the legacy string cell API. */

export type DatabaseDateRecurrence = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface DatabaseDateValue {
  start: string;
  end?: string | null;
  includeTime?: boolean;
  timeZone?: string | null;
  reminderMinutes?: number | null;
  recurrence?: DatabaseDateRecurrence | null;
}

export interface DatabasePersonReference {
  id: string;
  label: string;
  kind: 'person' | 'group';
}

export interface DatabaseLocationValue {
  name: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface DatabaseButtonState {
  clicks: number;
  lastClickedAt: string | null;
  lastClickedBy: string | null;
}

export type DatabasePropertyValue =
  | { type: 'title' | 'rich_text' | 'text' | 'url' | 'email' | 'phone' | 'ai' | 'comparison'; value: string | null }
  | { type: 'number'; value: number | null }
  | { type: 'checkbox'; value: boolean }
  | { type: 'select' | 'status'; optionId: string | null }
  | { type: 'multi_select'; optionIds: string[] }
  | { type: 'date'; value: DatabaseDateValue | null }
  | { type: 'person' | 'created_by' | 'last_edited_by'; people: DatabasePersonReference[] }
  | { type: 'location'; value: DatabaseLocationValue | null }
  | { type: 'created_time' | 'last_edited_time'; value: string }
  | { type: 'unique_id'; value: string }
  | { type: 'button'; state: DatabaseButtonState }
  | { type: 'files' | 'attachment' | 'ai_image'; attachmentIds: string[] }
  | { type: 'relation'; relationIds: string[] }
  | { type: 'formula' | 'rollup'; value: string | number | boolean | null };

function parseObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function encodeDatabaseDate(value: DatabaseDateValue | null): string | null {
  if (!value?.start?.trim()) return null;
  return JSON.stringify({
    start: value.start.trim(), end: value.end?.trim() || null,
    includeTime: Boolean(value.includeTime), timeZone: value.timeZone?.trim() || null,
    reminderMinutes: Number.isFinite(value.reminderMinutes) ? Math.max(0, Number(value.reminderMinutes)) : null,
    recurrence: value.recurrence ?? null,
  });
}

/** Reads both the historical YYYY-MM-DD string and the structured range form. */
export function decodeDatabaseDate(raw: string | null): DatabaseDateValue | null {
  if (!raw) return null;
  const object = parseObject(raw);
  if (!object) return { start: raw, end: null, includeTime: raw.includes('T'), timeZone: null, reminderMinutes: null, recurrence: null };
  if (typeof object.start !== 'string' || !object.start.trim()) return null;
  const recurrence = ['daily', 'weekly', 'monthly', 'yearly'].includes(String(object.recurrence))
    ? object.recurrence as DatabaseDateRecurrence : null;
  return {
    start: object.start, end: typeof object.end === 'string' ? object.end : null,
    includeTime: Boolean(object.includeTime), timeZone: typeof object.timeZone === 'string' ? object.timeZone : null,
    reminderMinutes: typeof object.reminderMinutes === 'number' && Number.isFinite(object.reminderMinutes)
      ? Math.max(0, object.reminderMinutes) : null,
    recurrence,
  };
}

export function databaseDateSortValue(raw: string | null): string {
  return decodeDatabaseDate(raw)?.start ?? '';
}

export function encodeDatabasePeople(people: DatabasePersonReference[]): string | null {
  const unique = new Map<string, DatabasePersonReference>();
  for (const person of people) {
    const label = person.label?.trim();
    if (!label) continue;
    const kind = person.kind === 'group' ? 'group' : 'person';
    const id = person.id?.trim() || `${kind}:${label.toLocaleLowerCase()}`;
    unique.set(`${kind}:${id}`, { id, label, kind });
  }
  return unique.size ? JSON.stringify([...unique.values()]) : null;
}

export function decodeDatabasePeople(raw: string | null): DatabasePersonReference[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) throw new Error('not-array');
    return value.flatMap((item): DatabasePersonReference[] => {
      if (!item || typeof item !== 'object') return [];
      const person = item as Record<string, unknown>;
      if (typeof person.label !== 'string' || !person.label.trim()) return [];
      const kind = person.kind === 'group' ? 'group' : 'person';
      return [{ id: typeof person.id === 'string' && person.id ? person.id : `${kind}:${person.label.toLocaleLowerCase()}`, label: person.label, kind }];
    });
  } catch {
    return [{ id: `person:${raw.toLocaleLowerCase()}`, label: raw, kind: 'person' }];
  }
}

export function encodeDatabaseLocation(value: DatabaseLocationValue | null): string | null {
  if (!value?.name?.trim()) return null;
  const coordinate = (candidate: number | null | undefined, min: number, max: number) =>
    typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= min && candidate <= max ? candidate : null;
  return JSON.stringify({ name: value.name.trim(), address: value.address?.trim() || null,
    latitude: coordinate(value.latitude, -90, 90), longitude: coordinate(value.longitude, -180, 180) });
}

export function decodeDatabaseLocation(raw: string | null): DatabaseLocationValue | null {
  if (!raw) return null;
  const object = parseObject(raw);
  if (!object) return { name: raw, address: null, latitude: null, longitude: null };
  if (typeof object.name !== 'string' || !object.name.trim()) return null;
  return { name: object.name, address: typeof object.address === 'string' ? object.address : null,
    latitude: typeof object.latitude === 'number' ? object.latitude : null,
    longitude: typeof object.longitude === 'number' ? object.longitude : null };
}

export function decodeDatabaseButton(raw: string | null): DatabaseButtonState {
  const object = parseObject(raw);
  return { clicks: typeof object?.clicks === 'number' && Number.isSafeInteger(object.clicks) ? Math.max(0, object.clicks) : 0,
    lastClickedAt: typeof object?.lastClickedAt === 'string' ? object.lastClickedAt : null,
    lastClickedBy: typeof object?.lastClickedBy === 'string' ? object.lastClickedBy : null };
}

export function encodeDatabaseButton(value: DatabaseButtonState): string {
  return JSON.stringify({ clicks: Math.max(0, Math.trunc(value.clicks)), lastClickedAt: value.lastClickedAt ?? null,
    lastClickedBy: value.lastClickedBy ?? null });
}

export function formatUniqueDatabaseId(prefix: string | undefined, padding: number | undefined, sequence: number): string {
  const safePrefix = String(prefix ?? '').trim().slice(0, 24);
  const safePadding = Math.min(12, Math.max(1, Math.trunc(padding ?? 4)));
  return `${safePrefix}${String(Math.max(0, Math.trunc(sequence))).padStart(safePadding, '0')}`;
}

export function isReadOnlyDatabaseProperty(type: string): boolean {
  return ['created_by', 'last_edited_by', 'created_time', 'last_edited_time', 'unique_id'].includes(type);
}

/** Human-readable projection shared by filters, formulas and export previews. */
export function databasePropertyPlainText(type: string, raw: string | null): string {
  if (!raw) return '';
  if (type === 'person' || type === 'created_by' || type === 'last_edited_by') {
    return decodeDatabasePeople(raw).map((person) => person.label).join(', ');
  }
  if (type === 'location') {
    const location = decodeDatabaseLocation(raw);
    return location ? [location.name, location.address].filter(Boolean).join(' · ') : '';
  }
  if (type === 'date') {
    const date = decodeDatabaseDate(raw);
    return date ? [date.start, date.end].filter(Boolean).join(' – ') : '';
  }
  if (type === 'button') return String(decodeDatabaseButton(raw).clicks);
  return raw;
}
