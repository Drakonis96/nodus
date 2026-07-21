/**
 * Exact majority comparison for database cells.
 *
 * A comparison column is manually runnable for one row or the whole column. It writes the
 * unique most frequent non-empty visible value into its cell. Matching is intentionally
 * exact (case, accents and whitespace all matter); a tie has no arbitrary winner.
 */

import { cellDisplayValue } from './databaseFormulaEval';
import type { DatabaseColumn, DatabaseRow } from './databases';

/** Types whose value is meaningful as one comparable term. */
export function isComparisonSource(column: DatabaseColumn): boolean {
  return !['attachment', 'ai_image', 'relation', 'comparison'].includes(column.type);
}

/** Valid, de-duplicated source columns from a comparison column's current configuration. */
export function comparisonSourceColumns(column: DatabaseColumn, columns: DatabaseColumn[]): DatabaseColumn[] {
  const ids = Array.isArray(column.config.comparisonSourceColumnIds)
    ? column.config.comparisonSourceColumnIds.filter((id): id is string => typeof id === 'string')
    : [];
  const wanted = new Set(ids);
  return columns.filter((candidate) => wanted.has(candidate.id) && candidate.id !== column.id && isComparisonSource(candidate));
}

/** The exact text a source cell contributes. Selects resolve to the label the user sees. */
export function comparisonCellValue(column: DatabaseColumn, row: DatabaseRow): string {
  if (column.type === 'rollup') return row.rollups?.[column.id] ?? '';
  return cellDisplayValue(column, row);
}

/**
 * Unique mode across the configured sources. Empty cells do not vote; ties return null.
 * Map insertion order makes the calculation deterministic without being used as a tie-break.
 */
export function comparisonMajorityValue(
  comparisonColumn: DatabaseColumn,
  columns: DatabaseColumn[],
  row: DatabaseRow
): string | null {
  const sources = comparisonSourceColumns(comparisonColumn, columns);
  if (sources.length < 2) return null;

  const counts = new Map<string, number>();
  for (const source of sources) {
    const value = comparisonCellValue(source, row);
    if (value === '') continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  let winner: string | null = null;
  let highest = 0;
  let tied = false;
  for (const [value, count] of counts) {
    if (count > highest) {
      winner = value;
      highest = count;
      tied = false;
    } else if (count === highest) {
      tied = true;
    }
  }
  return tied ? null : winner;
}
