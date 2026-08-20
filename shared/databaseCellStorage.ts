import type { DatabaseColumnType } from './databases';

export type DatabaseCellStorageKind = 'text' | 'number' | 'integer' | 'date' | 'json' | 'reference' | 'legacy';

export interface DatabaseCellStorageRecord {
  value_text?: string | null;
  value_number?: number | null;
  value_integer?: number | null;
  value_date?: string | null;
  value_json?: string | null;
  value_reference?: string | null;
}

export interface DatabaseCellStorageValues extends Required<DatabaseCellStorageRecord> {
  value_type: DatabaseCellStorageKind;
}

const emptyValues = (): Omit<DatabaseCellStorageValues, 'value_type' | 'value_text'> => ({
  value_number: null,
  value_integer: null,
  value_date: null,
  value_json: null,
  value_reference: null,
});

/** Convert a normalized public cell string into its indexed SQLite representation. */
export function databaseCellStorage(type: DatabaseColumnType, raw: string): DatabaseCellStorageValues {
  const base = { value_text: raw, ...emptyValues() };
  if (type === 'number') {
    const value = Number(raw);
    return Number.isFinite(value)
      ? { ...base, value_type: 'number', value_number: value }
      : { ...base, value_type: 'text' };
  }
  if (type === 'checkbox') {
    return { ...base, value_type: 'integer', value_integer: raw === '1' || raw === 'true' ? 1 : 0 };
  }
  if (type === 'date') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && typeof parsed.start === 'string') {
        return { ...base, value_type: 'json', value_json: JSON.stringify(parsed) };
      }
    } catch {
      // Historical ISO dates remain date-backed.
    }
    return { ...base, value_type: 'date', value_date: raw };
  }
  if (type === 'time') return { ...base, value_type: 'date', value_date: raw };
  if (type === 'multi_select' || type === 'person' || type === 'location' || type === 'button') {
    try {
      const parsed = JSON.parse(raw);
      const valid = type === 'multi_select' || type === 'person'
        ? Array.isArray(parsed)
        : Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed));
      if (valid) return { ...base, value_type: 'json', value_json: JSON.stringify(parsed) };
    } catch {
      // A malformed legacy value remains losslessly available as text.
    }
    return { ...base, value_type: 'text' };
  }
  if (type === 'select' || type === 'status') return { ...base, value_type: 'reference', value_reference: raw };
  return { ...base, value_type: 'text' };
}

/**
 * Compatibility read: current clients still consume the historical raw string. New
 * rows keep it populated for old readers; if a future writer omits it, typed storage is
 * losslessly projected back into the same API shape.
 */
export function databaseCellRaw(record: DatabaseCellStorageRecord): string | null {
  if (record.value_text !== null && record.value_text !== undefined) return record.value_text;
  if (record.value_number !== null && record.value_number !== undefined) {
    return Number.isInteger(record.value_number) ? String(record.value_number) : String(record.value_number);
  }
  if (record.value_integer !== null && record.value_integer !== undefined) return String(record.value_integer);
  if (record.value_date !== null && record.value_date !== undefined) return record.value_date;
  if (record.value_json !== null && record.value_json !== undefined) return record.value_json;
  if (record.value_reference !== null && record.value_reference !== undefined) return record.value_reference;
  return null;
}
