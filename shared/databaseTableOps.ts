import type { DatabaseRow } from './databases';
import type { FilterNode } from './databaseQuery';

export const DATABASE_BULK_CELL_LIMIT = 10_000;

export interface DatabaseCellPatch {
  rowId: string;
  columnId: string;
  raw: string | null;
}

export interface DatabaseBulkEditInput {
  databaseId: string;
  changes: DatabaseCellPatch[];
  /** Reject the complete transaction when the database changed since it was read. */
  expectedRevision?: number;
}

export interface DatabaseBulkEditResult {
  databaseId: string;
  revision: number;
  rowsChanged: number;
  cellsChanged: number;
  rows: DatabaseRow[];
}

export interface DatabaseAggregateQuery {
  databaseId: string;
  viewId?: string | null;
  filter?: FilterNode | null;
  /** Omitting this field calculates every property. */
  columnIds?: string[];
}

export interface DatabaseColumnAggregate {
  columnId: string;
  count: number;
  nonEmpty: number;
  numericCount: number;
  sum: number | null;
  average: number | null;
  min: string | number | null;
  max: string | number | null;
}

export interface DatabaseAggregateResult {
  databaseId: string;
  revision: number;
  totalCount: number;
  columns: DatabaseColumnAggregate[];
}

/** Parse the tab/newline clipboard format emitted by spreadsheet applications. */
export function parseRectangularClipboard(value: string): string[][] {
  if (!value) return [];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quoted) {
      if (char === '"' && value[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"' && field.length === 0) quoted = true;
    else if (char === '\t') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && value[index + 1] === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  row.push(field);
  rows.push(row);
  if (rows.length > 1 && rows.at(-1)?.length === 1 && rows.at(-1)?.[0] === '') rows.pop();
  return rows;
}

/** Serialize a rectangular selection without losing tabs, quotes or line breaks. */
export function serializeRectangularClipboard(matrix: Array<Array<string | null | undefined>>): string {
  const encode = (raw: string | null | undefined) => {
    const value = raw ?? '';
    return /[\t\r\n"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  };
  return matrix.map((row) => row.map(encode).join('\t')).join('\n');
}

