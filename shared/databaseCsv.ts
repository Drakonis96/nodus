/**
 * Pure helpers for importing a CSV into a database: inferring a column type from its
 * sample values and normalizing a raw string to a column type. Dependency-free so the
 * inference is unit-tested without a file or a database. The actual CSV parsing lives
 * in electron/extraction/tabular.ts; the DB creation lives in databasesRepo.ts.
 */

import type { DatabaseColumnType } from './databases';

const NUMBER_RE = /^-?\d{1,3}(?:[.,]?\d{3})*(?:[.,]\d+)?$|^-?\d+(?:\.\d+)?$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{1,2}:\d{2}$/;
const BOOL_TRUE = new Set(['sí', 'si', 'true', 'yes', 'verdadero', 'x', '✓']);
const BOOL_FALSE = new Set(['no', 'false', 'falso', '']);

/** Infer a column type from a sample of its (string) values. */
export function inferColumnType(values: string[]): DatabaseColumnType {
  const nonEmpty = values.map((v) => v.trim()).filter(Boolean);
  if (nonEmpty.length === 0) return 'text';
  const all = (pred: (v: string) => boolean) => nonEmpty.every(pred);
  if (all((v) => ISO_DATE_RE.test(v))) return 'date';
  if (all((v) => TIME_RE.test(v))) return 'time';
  if (all((v) => NUMBER_RE.test(v))) return 'number';
  const lowered = nonEmpty.map((v) => v.toLowerCase());
  if (lowered.every((v) => BOOL_TRUE.has(v) || BOOL_FALSE.has(v)) && lowered.some((v) => BOOL_TRUE.has(v))) return 'checkbox';
  // A small, repeating vocabulary → a select (controlled options).
  const distinct = new Set(nonEmpty);
  if (distinct.size <= Math.max(2, Math.floor(nonEmpty.length / 3)) && distinct.size <= 12) return 'select';
  return 'text';
}

export interface CsvImportPlan {
  headers: string[];
  /** Data rows (header row removed). */
  rows: string[][];
  /** Suggested type per column (first column defaults to title). */
  suggestedTypes: DatabaseColumnType[];
}

/** Build an import plan from parsed CSV rows (rows[0] = header). */
export function buildCsvImportPlan(parsed: string[][]): CsvImportPlan {
  const headers = (parsed[0] ?? []).map((h, i) => h.trim() || `Columna ${i + 1}`);
  const rows = parsed.slice(1).filter((r) => r.some((c) => c && c.trim() !== ''));
  const suggestedTypes = headers.map((_, col) => {
    if (col === 0) return 'title' as DatabaseColumnType;
    return inferColumnType(rows.map((r) => r[col] ?? ''));
  });
  return { headers, rows, suggestedTypes };
}

const MULTI_SPLIT_RE = /[,;|]/;

/** Split a multi-select cell's raw value into distinct trimmed option labels. */
export function splitMultiValue(raw: string): string[] {
  return raw
    .split(MULTI_SPLIT_RE)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Normalize a raw CSV value for a non-option column type (options handled by the repo). */
export function normalizeCsvValue(type: DatabaseColumnType, raw: string): string | null {
  const v = raw.trim();
  if (v === '') return null;
  if (type === 'number') {
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) ? String(n) : null;
  }
  if (type === 'checkbox') return BOOL_TRUE.has(v.toLowerCase()) ? '1' : '0';
  return v;
}
