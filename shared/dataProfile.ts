/**
 * Deterministic statistical profile of a database: per-column fill rate, numeric
 * summaries with a histogram, value distributions for select/multi-select, checkbox
 * splits and date ranges. Pure and dependency-free so the numbers are unit-tested and
 * reproducible — the Analysis view renders these directly and the AI report is written
 * over `profileToText(...)` (never the raw rows), so it always cites real figures.
 */

import { decodeCheckbox, decodeMultiSelect, decodeNumber } from './databases';
import type { DatabaseColumn, DatabaseColumnType, DatabaseRow } from './databases';
import { comparableType } from './databaseFormula';

export interface HistogramBucket {
  label: string;
  count: number;
}

export interface NumberStats {
  count: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  sum: number;
  stdev: number;
  histogram: HistogramBucket[];
}

export interface DistributionSlice {
  id: string | null;
  label: string;
  color: string | null;
  count: number;
}

export interface ColumnProfile {
  columnId: string;
  name: string;
  /** The column's declared type — what the header shows. */
  type: DatabaseColumnType;
  /**
   * The type the column's values actually behave as, which is what statistics care about.
   * Identical to `type` except for a formula, whose declared type says nothing about whether
   * it holds numbers or text. Without this the analysis engine cannot see a formula at all:
   * "% of total" would be profiled as if it were prose and never offered to a correlation.
   * Optional so a hand-built or persisted profile still classifies (readers fall back to `type`).
   */
  valueType?: DatabaseColumnType;
  filled: number;
  fillRate: number;
  distinct?: number;
  number?: NumberStats;
  distribution?: DistributionSlice[];
  checkbox?: { checked: number; unchecked: number };
  dateRange?: { min: string; max: string };
  /** relation columns: total number of links across all rows. */
  relationLinks?: number;
}

export interface DatabaseProfile {
  rowCount: number;
  columns: ColumnProfile[];
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function numberStats(values: number[]): NumberStats {
  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  const sum = sorted.reduce((s, v) => s + v, 0);
  const mean = sum / count;
  const min = sorted[0];
  const max = sorted[count - 1];
  const median = count % 2 ? sorted[(count - 1) / 2] : (sorted[count / 2 - 1] + sorted[count / 2]) / 2;
  const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / count;
  const stdev = Math.sqrt(variance);

  // Histogram: up to 8 equal-width buckets between min and max.
  const bucketCount = Math.min(8, Math.max(1, count));
  const histogram: HistogramBucket[] = [];
  if (min === max) {
    histogram.push({ label: String(round(min)), count });
  } else {
    const width = (max - min) / bucketCount;
    const counts = new Array(bucketCount).fill(0);
    for (const v of sorted) {
      let idx = Math.floor((v - min) / width);
      if (idx >= bucketCount) idx = bucketCount - 1;
      counts[idx]++;
    }
    for (let i = 0; i < bucketCount; i++) {
      const lo = min + width * i;
      const hi = i === bucketCount - 1 ? max : min + width * (i + 1);
      histogram.push({ label: `${round(lo)}–${round(hi)}`, count: counts[i] });
    }
  }
  return { count, min: round(min), max: round(max), mean: round(mean), median: round(median), sum: round(sum), stdev: round(stdev), histogram };
}

function distributionFor(column: DatabaseColumn, rows: DatabaseRow[], multi: boolean): DistributionSlice[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const raw = row.cells[column.id] ?? null;
    const ids = multi ? decodeMultiSelect(raw) : raw ? [raw] : [];
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const slices: DistributionSlice[] = column.options
    .map((o) => ({ id: o.id, label: o.label, color: o.color, count: counts.get(o.id) ?? 0 }))
    .filter((s) => s.count > 0);
  slices.sort((a, b) => b.count - a.count);
  return slices;
}

export function computeColumnProfile(column: DatabaseColumn, rows: DatabaseRow[]): ColumnProfile {
  const total = rows.length;
  // A formula writes its result into cells like any other column, so profile it by what it
  // computes rather than by the word "formula" — otherwise every derived column is invisible
  // to the analysis engine, which is exactly where a computed column is most wanted.
  const valueType = comparableType(column);
  const base = { columnId: column.id, name: column.name, type: column.type, valueType };

  switch (valueType) {
    case 'number': {
      const values = rows.map((r) => decodeNumber(r.cells[column.id] ?? null)).filter((n): n is number => n != null);
      return { ...base, filled: values.length, fillRate: total ? values.length / total : 0, number: values.length ? numberStats(values) : undefined };
    }
    case 'select':
    case 'multi_select': {
      const dist = distributionFor(column, rows, column.type === 'multi_select');
      const filled = column.type === 'multi_select'
        ? rows.filter((r) => decodeMultiSelect(r.cells[column.id] ?? null).length > 0).length
        : rows.filter((r) => (r.cells[column.id] ?? '') !== '').length;
      return { ...base, filled, fillRate: total ? filled / total : 0, distinct: dist.length, distribution: dist };
    }
    case 'checkbox': {
      let checked = 0;
      for (const r of rows) if (decodeCheckbox(r.cells[column.id] ?? null)) checked++;
      return { ...base, filled: total, fillRate: 1, checkbox: { checked, unchecked: total - checked } };
    }
    case 'date':
    case 'time': {
      const values = rows.map((r) => (r.cells[column.id] ?? '').trim()).filter(Boolean).sort();
      return {
        ...base,
        filled: values.length,
        fillRate: total ? values.length / total : 0,
        dateRange: values.length ? { min: values[0], max: values[values.length - 1] } : undefined,
      };
    }
    case 'attachment': {
      const filled = rows.filter((r) => (r.attachments?.[column.id] ?? []).length > 0).length;
      return { ...base, filled, fillRate: total ? filled / total : 0 };
    }
    case 'relation': {
      let links = 0;
      let filled = 0;
      for (const r of rows) {
        const n = r.relationCounts?.[column.id] ?? 0;
        links += n;
        if (n > 0) filled++;
      }
      return { ...base, filled, fillRate: total ? filled / total : 0, relationLinks: links };
    }
    default: {
      // title / text / ai / relation → fill rate + distinct values
      const values = rows.map((r) => (r.cells[column.id] ?? '').trim()).filter(Boolean);
      return { ...base, filled: values.length, fillRate: total ? values.length / total : 0, distinct: new Set(values).size };
    }
  }
}

export function computeProfile(columns: DatabaseColumn[], rows: DatabaseRow[]): DatabaseProfile {
  return { rowCount: rows.length, columns: columns.map((c) => computeColumnProfile(c, rows)) };
}

/** Compact, human-readable profile for the AI report prompt (never the raw rows). */
export function profileToText(databaseName: string, profile: DatabaseProfile): string {
  const lines: string[] = [`Base de datos: ${databaseName}`, `Filas: ${profile.rowCount}`, ''];
  for (const c of profile.columns) {
    const pct = Math.round(c.fillRate * 100);
    let detail = '';
    if (c.number) {
      const n = c.number;
      detail = `min ${n.min}, max ${n.max}, media ${n.mean}, mediana ${n.median}, desv ${n.stdev}, suma ${n.sum}`;
    } else if (c.distribution) {
      detail = c.distribution.map((d) => `${d.label}: ${d.count}`).join(', ');
    } else if (c.checkbox) {
      detail = `marcado ${c.checkbox.checked}, sin marcar ${c.checkbox.unchecked}`;
    } else if (c.dateRange) {
      detail = `de ${c.dateRange.min} a ${c.dateRange.max}`;
    } else if (c.relationLinks != null) {
      detail = `${c.relationLinks} enlaces`;
    } else if (c.distinct != null) {
      detail = `${c.distinct} valores distintos`;
    }
    // Announce what the column holds: "(formula)" tells a model nothing it can reason with,
    // while "(number)" lets it use the min/max/mean that follow.
    lines.push(`- ${c.name} (${c.valueType}) · relleno ${pct}%${detail ? ` · ${detail}` : ''}`);
  }
  return lines.join('\n');
}
