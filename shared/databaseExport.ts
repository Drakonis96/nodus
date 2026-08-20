/**
 * Export a database's rows to CSV / JSON. Pure and dependency-free so the serialization
 * is unit-tested; the XLSX writer (which needs a zip lib) lives in electron/export.
 */

import { decodeCheckbox, decodeMultiSelect, decodeNumber } from './databases';
import type { DatabaseColumn, DatabaseRow } from './databases';
import {
  decodeDatabaseButton,
  decodeDatabaseDate,
  decodeDatabaseLocation,
  decodeDatabasePeople,
} from './databaseProperties';

export type ExportFormat = 'csv' | 'json' | 'xlsx';

/** A cell's value as a plain string, for CSV/XLSX text cells. */
export function exportCellText(col: DatabaseColumn, row: DatabaseRow): string {
  const raw = row.cells[col.id] ?? null;
  switch (col.type) {
    case 'select':
    case 'status':
      return col.options.find((o) => o.id === raw)?.label ?? '';
    case 'multi_select':
      return decodeMultiSelect(raw)
        .map((id) => col.options.find((o) => o.id === id)?.label ?? '')
        .filter(Boolean)
        .join(', ');
    case 'checkbox':
      return decodeCheckbox(raw) ? 'sí' : 'no';
    case 'attachment':
    case 'files':
      return (row.attachments?.[col.id] ?? []).map((a) => a.fileName ?? '').filter(Boolean).join(', ');
    case 'relation':
      return String(row.relationCounts?.[col.id] ?? 0);
    case 'date': {
      const value = decodeDatabaseDate(raw);
      return value ? [value.start, value.end].filter(Boolean).join(' – ') : '';
    }
    case 'person':
    case 'created_by':
    case 'last_edited_by':
      return decodeDatabasePeople(raw).map((person) => person.label).join(', ');
    case 'location': {
      const value = decodeDatabaseLocation(raw);
      return value ? [value.name, value.address].filter(Boolean).join(' · ') : '';
    }
    case 'button': {
      const value = decodeDatabaseButton(raw);
      return value.lastClickedAt ? `${value.clicks} · ${value.lastClickedAt}` : String(value.clicks);
    }
    default:
      return raw ?? '';
  }
}

/** A cell's value typed for JSON (numbers/booleans/arrays where meaningful). */
export function exportCellValue(col: DatabaseColumn, row: DatabaseRow): unknown {
  const raw = row.cells[col.id] ?? null;
  switch (col.type) {
    case 'number':
      return decodeNumber(raw);
    case 'checkbox':
      return decodeCheckbox(raw);
    case 'select':
    case 'status':
      return col.options.find((o) => o.id === raw)?.label ?? null;
    case 'multi_select':
      return decodeMultiSelect(raw).map((id) => col.options.find((o) => o.id === id)?.label ?? id);
    case 'attachment':
    case 'files':
      return (row.attachments?.[col.id] ?? []).map((a) => a.fileName ?? '').filter(Boolean);
    case 'relation':
      return row.relationCounts?.[col.id] ?? 0;
    case 'date':
      return decodeDatabaseDate(raw);
    case 'person':
    case 'created_by':
    case 'last_edited_by':
      return decodeDatabasePeople(raw);
    case 'location':
      return decodeDatabaseLocation(raw);
    case 'button':
      return decodeDatabaseButton(raw);
    default:
      return raw;
  }
}

/**
 * Neutralises a cell a spreadsheet would otherwise read as a formula.
 *
 * A value starting with `=`, `+`, `-` or `@` is executed on open by Excel, LibreOffice
 * and Sheets — that is CSV injection, and the content here is user data: a database cell
 * or, in the gradebook, a name typed into a roster. The single quote is the standard
 * mitigation; it is not shown as part of the value once the file is opened.
 */
function neutraliseFormula(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function csvCell(s: string): string {
  const safe = neutraliseFormula(s);
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function databaseToCsv(columns: DatabaseColumn[], rows: DatabaseRow[]): string {
  const header = columns.map((c) => csvCell(c.name)).join(',');
  const lines = rows.map((r) => columns.map((c) => csvCell(exportCellText(c, r))).join(','));
  return [header, ...lines].join('\r\n');
}

export function databaseRowToCsv(columns: DatabaseColumn[], row: DatabaseRow): string {
  return columns.map((column) => csvCell(exportCellText(column, row))).join(',');
}

export function databaseRowToJsonValue(columns: DatabaseColumn[], row: DatabaseRow): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  for (const column of columns) value[column.name] = exportCellValue(column, row);
  return value;
}

export function databaseToJson(columns: DatabaseColumn[], rows: DatabaseRow[]): string {
  return JSON.stringify(
    {
      columns: columns.map((c) => ({ name: c.name, type: c.type })),
      rows: rows.map((row) => databaseRowToJsonValue(columns, row)),
    },
    null,
    2
  );
}

export function databaseRowToMatrix(columns: DatabaseColumn[], row: DatabaseRow): ExportCell[] {
  return columns.map((column) => {
    if (column.type === 'number') {
      const value = decodeNumber(row.cells[column.id] ?? null);
      return { text: value == null ? '' : String(value), numeric: value };
    }
    return { text: exportCellText(column, row), numeric: null };
  });
}

/** Rows as a 2D matrix of {text, numeric} cells — the input the XLSX writer needs. */
export interface ExportCell {
  text: string;
  numeric: number | null;
}

export function databaseToMatrix(columns: DatabaseColumn[], rows: DatabaseRow[]): { header: string[]; body: ExportCell[][] } {
  const header = columns.map((c) => c.name);
  const body = rows.map((row) => databaseRowToMatrix(columns, row));
  return { header, body };
}
