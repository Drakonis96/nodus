/**
 * Deterministic statistics engine for the databases Analysis view. Pure and
 * dependency-free so every figure is unit-tested and reproducible — the AI never
 * computes numbers, it only *chooses* which of these analyses to run (see
 * shared/analysisCatalog.ts); this module does the maths on the real rows.
 *
 * Two layers:
 *  1. Numeric primitives operating on plain arrays (mean, quantiles, pearson, chi²…).
 *  2. Column-aware extractors (numericValues / categoryValues / dateValues) that turn
 *     a DatabaseColumn + rows into the arrays the primitives consume, reusing the
 *     decode helpers from shared/databases.ts.
 *
 * p-values are pure approximations (regularised incomplete gamma / beta, the standard
 * Numerical-Recipes algorithms). They are good to ~1e-7 in the usual range; callers
 * should treat them as indicative, not authoritative.
 */

import { decodeCheckbox, decodeMultiSelect, decodeNumber } from './databases';
import type { DatabaseColumn, DatabaseRow } from './databases';

// ── small helpers ─────────────────────────────────────────────────────────────

export function round(n: number, dp = 4): number {
  if (!Number.isFinite(n)) return n;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Index-aligned finite pairs from two arrays (drops any pair with a nullish/NaN side). */
export function finitePairs(xs: (number | null)[], ys: (number | null)[]): [number, number][] {
  const out: [number, number][] = [];
  const n = Math.min(xs.length, ys.length);
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const y = ys[i];
    if (x != null && y != null && Number.isFinite(x) && Number.isFinite(y)) out.push([x, y]);
  }
  return out;
}

// ── univariate ──────────────────────────────────────────────────────────────

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : NaN;
}

/** Quantile via linear interpolation (type-7, the R/NumPy default). `q` in [0,1]. */
export function quantile(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (pos - lo) * (sorted[hi] - sorted[lo]);
}

export function median(xs: number[]): number {
  return quantile(xs, 0.5);
}

export function variance(xs: number[], sample = true): number {
  const n = xs.length;
  if (n < (sample ? 2 : 1)) return NaN;
  const m = mean(xs);
  const ss = xs.reduce((s, v) => s + (v - m) ** 2, 0);
  return ss / (sample ? n - 1 : n);
}

export function stdev(xs: number[], sample = true): number {
  return Math.sqrt(variance(xs, sample));
}

/** Most frequent value(s). Returns the value and how many times it occurs. */
export function mode(xs: number[]): { value: number; count: number } | null {
  if (!xs.length) return null;
  const counts = new Map<number, number>();
  for (const v of xs) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = xs[0];
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return { value: best, count: bestCount };
}

/** Fisher–Pearson sample skewness (adjusted). NaN for n < 3 or zero variance. */
export function skewness(xs: number[]): number {
  const n = xs.length;
  if (n < 3) return NaN;
  const m = mean(xs);
  const s = stdev(xs, true);
  if (!(s > 0)) return NaN;
  const sum = xs.reduce((acc, v) => acc + ((v - m) / s) ** 3, 0);
  return (n / ((n - 1) * (n - 2))) * sum;
}

/** Excess kurtosis (sample-corrected; 0 ≈ normal). NaN for n < 4 or zero variance. */
export function kurtosis(xs: number[]): number {
  const n = xs.length;
  if (n < 4) return NaN;
  const m = mean(xs);
  const s = stdev(xs, true);
  if (!(s > 0)) return NaN;
  const sum = xs.reduce((acc, v) => acc + ((v - m) / s) ** 4, 0);
  const a = (n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3));
  const b = (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
  return a * sum - b;
}

export interface Descriptive {
  n: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  sum: number;
  q1: number;
  q3: number;
  iqr: number;
  variance: number;
  stdev: number;
  /** Coefficient of variation (stdev/|mean|), or null when mean ≈ 0. */
  cv: number | null;
  skewness: number;
  kurtosis: number;
  mode: { value: number; count: number } | null;
  /** Values beyond 1.5·IQR from the quartiles (Tukey fences). */
  outliers: number[];
}

export function describe(xs: number[]): Descriptive {
  const n = xs.length;
  const m = mean(xs);
  const q1 = quantile(xs, 0.25);
  const q3 = quantile(xs, 0.75);
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;
  const sd = stdev(xs, true);
  return {
    n,
    mean: round(m),
    median: round(median(xs)),
    min: round(Math.min(...xs)),
    max: round(Math.max(...xs)),
    sum: round(xs.reduce((s, v) => s + v, 0)),
    q1: round(q1),
    q3: round(q3),
    iqr: round(iqr),
    variance: round(variance(xs, true)),
    stdev: round(sd),
    cv: Math.abs(m) > 1e-12 ? round(sd / Math.abs(m)) : null,
    skewness: round(skewness(xs)),
    kurtosis: round(kurtosis(xs)),
    mode: mode(xs),
    outliers: xs.filter((v) => v < lo || v > hi).map((v) => round(v)),
  };
}

export interface BoxplotStats {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  /** Whiskers clamped to the furthest points within 1.5·IQR of the box. */
  whiskerLow: number;
  whiskerHigh: number;
  outliers: number[];
  n: number;
}

export function boxplot(xs: number[]): BoxplotStats {
  const q1 = quantile(xs, 0.25);
  const q3 = quantile(xs, 0.75);
  const iqr = q3 - q1;
  const loFence = q1 - 1.5 * iqr;
  const hiFence = q3 + 1.5 * iqr;
  const inFence = xs.filter((v) => v >= loFence && v <= hiFence);
  return {
    min: round(Math.min(...xs)),
    q1: round(q1),
    median: round(median(xs)),
    q3: round(q3),
    max: round(Math.max(...xs)),
    whiskerLow: round(inFence.length ? Math.min(...inFence) : q1),
    whiskerHigh: round(inFence.length ? Math.max(...inFence) : q3),
    outliers: xs.filter((v) => v < loFence || v > hiFence).map((v) => round(v)),
    n: xs.length,
  };
}

// ── bivariate: correlation & regression ──────────────────────────────────────

export interface CorrelationResult {
  /** Correlation coefficient in [-1, 1]. */
  r: number;
  /** Number of complete pairs used. */
  n: number;
  /** Two-tailed p-value (Student-t, df = n-2). null when undefined. */
  p: number | null;
}

export function pearson(pairs: [number, number][]): CorrelationResult {
  const n = pairs.length;
  if (n < 2) return { r: NaN, n, p: null };
  const mx = mean(pairs.map((p) => p[0]));
  const my = mean(pairs.map((p) => p[1]));
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return { r: NaN, n, p: null };
  const r = sxy / Math.sqrt(sxx * syy);
  return { r: round(r), n, p: correlationPValue(r, n) };
}

/** Ranks with average ties (needed for Spearman). */
export function rank(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const ranks = new Array<number>(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1; // 1-based average rank
    for (let k = i; k <= j; k++) ranks[idx[k][1]] = avg;
    i = j + 1;
  }
  return ranks;
}

export function spearman(pairs: [number, number][]): CorrelationResult {
  const n = pairs.length;
  if (n < 2) return { r: NaN, n, p: null };
  const rx = rank(pairs.map((p) => p[0]));
  const ry = rank(pairs.map((p) => p[1]));
  return pearson(rx.map((v, i) => [v, ry[i]]));
}

export interface RegressionResult {
  slope: number;
  intercept: number;
  /** Coefficient of determination. */
  r2: number;
  r: number;
  n: number;
}

export function linearRegression(pairs: [number, number][]): RegressionResult {
  const n = pairs.length;
  if (n < 2) return { slope: NaN, intercept: NaN, r2: NaN, r: NaN, n };
  const mx = mean(pairs.map((p) => p[0]));
  const my = mean(pairs.map((p) => p[1]));
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  if (sxx === 0) return { slope: NaN, intercept: NaN, r2: NaN, r: NaN, n };
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r = syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
  return { slope: round(slope), intercept: round(intercept), r2: round(r * r), r: round(r), n };
}

/** Pairwise Pearson correlation matrix over named numeric series. */
export interface CorrelationMatrix {
  keys: string[];
  labels: string[];
  /** matrix[i][j] = Pearson r between series i and j (1 on the diagonal, NaN if undefined). */
  matrix: number[][];
  /** counts[i][j] = number of complete pairs used. */
  counts: number[][];
}

export function correlationMatrix(series: { key: string; label: string; values: (number | null)[] }[]): CorrelationMatrix {
  const keys = series.map((s) => s.key);
  const labels = series.map((s) => s.label);
  const k = series.length;
  const matrix: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(NaN));
  const counts: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (let i = 0; i < k; i++) {
    matrix[i][i] = 1;
    counts[i][i] = series[i].values.filter((v) => v != null && Number.isFinite(v)).length;
    for (let j = i + 1; j < k; j++) {
      const pairs = finitePairs(series[i].values, series[j].values);
      const { r, n } = pearson(pairs);
      matrix[i][j] = matrix[j][i] = r;
      counts[i][j] = counts[j][i] = n;
    }
  }
  return { keys, labels, matrix, counts };
}

/** Sample covariance of paired values. */
export function covariance(pairs: [number, number][]): number {
  const n = pairs.length;
  if (n < 2) return NaN;
  const mx = mean(pairs.map((p) => p[0]));
  const my = mean(pairs.map((p) => p[1]));
  let s = 0;
  for (const [x, y] of pairs) s += (x - mx) * (y - my);
  return s / (n - 1);
}

/** Pairwise covariance matrix (diagonal = sample variance). Same shape as CorrelationMatrix. */
export function covarianceMatrix(series: { key: string; label: string; values: (number | null)[] }[]): CorrelationMatrix {
  const keys = series.map((s) => s.key);
  const labels = series.map((s) => s.label);
  const k = series.length;
  const matrix: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(NaN));
  const counts: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (let i = 0; i < k; i++) {
    const own = series[i].values.filter((v): v is number => v != null && Number.isFinite(v));
    matrix[i][i] = round(variance(own, true));
    counts[i][i] = own.length;
    for (let j = i + 1; j < k; j++) {
      const pairs = finitePairs(series[i].values, series[j].values);
      const cov = round(covariance(pairs));
      matrix[i][j] = matrix[j][i] = cov;
      counts[i][j] = counts[j][i] = pairs.length;
    }
  }
  return { keys, labels, matrix, counts };
}

// ── categorical: contingency, chi-square, Cramér's V ─────────────────────────

export interface Contingency {
  rowLabels: string[];
  colLabels: string[];
  /** counts[r][c]. */
  counts: number[][];
  rowTotals: number[];
  colTotals: number[];
  total: number;
}

/** Build a contingency table from two index-aligned label arrays (nullish dropped). */
export function contingencyTable(rowCats: (string | null)[], colCats: (string | null)[]): Contingency {
  const rowSet = new Map<string, number>();
  const colSet = new Map<string, number>();
  const cells = new Map<string, number>();
  const n = Math.min(rowCats.length, colCats.length);
  for (let i = 0; i < n; i++) {
    const r = rowCats[i];
    const c = colCats[i];
    if (r == null || c == null) continue;
    if (!rowSet.has(r)) rowSet.set(r, rowSet.size);
    if (!colSet.has(c)) colSet.set(c, colSet.size);
    const key = `${r} ${c}`;
    cells.set(key, (cells.get(key) ?? 0) + 1);
  }
  const rowLabels = [...rowSet.keys()];
  const colLabels = [...colSet.keys()];
  const counts = rowLabels.map((r) => colLabels.map((c) => cells.get(`${r} ${c}`) ?? 0));
  const rowTotals = counts.map((row) => row.reduce((s, v) => s + v, 0));
  const colTotals = colLabels.map((_, c) => counts.reduce((s, row) => s + row[c], 0));
  const total = rowTotals.reduce((s, v) => s + v, 0);
  return { rowLabels, colLabels, counts, rowTotals, colTotals, total };
}

export interface ChiSquareResult {
  chi2: number;
  dof: number;
  /** Cramér's V, effect size in [0,1]. */
  cramersV: number;
  p: number | null;
  /** Expected counts under independence, same shape as the table. */
  expected: number[][];
  table: Contingency;
}

export function chiSquare(table: Contingency): ChiSquareResult {
  const { counts, rowTotals, colTotals, total } = table;
  const rows = rowTotals.length;
  const cols = colTotals.length;
  const expected = counts.map((row, r) => row.map((_, c) => (total ? (rowTotals[r] * colTotals[c]) / total : 0)));
  let chi2 = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const e = expected[r][c];
      if (e > 0) chi2 += (counts[r][c] - e) ** 2 / e;
    }
  }
  const dof = Math.max(1, (rows - 1) * (cols - 1));
  const kMin = Math.min(rows, cols) - 1;
  const cramersV = total > 0 && kMin > 0 ? Math.sqrt(chi2 / (total * kMin)) : NaN;
  return {
    chi2: round(chi2),
    dof: (rows - 1) * (cols - 1),
    cramersV: round(cramersV),
    p: chiSquarePValue(chi2, dof),
    expected: expected.map((row) => row.map((v) => round(v, 2))),
    table,
  };
}

// ── cross tabulation / pivot (aggregate a numeric over two categories) ───────

export type Aggregate = 'count' | 'mean' | 'sum';

export interface CrosstabTable {
  rowLabels: string[];
  colLabels: string[];
  /** Aggregated value per cell (NaN where the cell is empty and agg = mean). */
  values: number[][];
  rowTotals: number[];
  colTotals: number[];
  total: number;
  aggregate: Aggregate;
}

/**
 * Pivot: aggregate `values` (optional) across two categorical axes. `count` ignores
 * values; `mean`/`sum` fold the numeric per cell. Marginals use the same aggregate
 * (mean is value-weighted).
 */
export function crosstab(rowCats: (string | null)[], colCats: (string | null)[], values: (number | null)[] | null, aggregate: Aggregate): CrosstabTable {
  const rowMap = new Map<string, number>();
  const colMap = new Map<string, number>();
  const cellSum: Map<string, number> = new Map();
  const cellCount: Map<string, number> = new Map();
  const n = Math.min(rowCats.length, colCats.length);
  for (let i = 0; i < n; i++) {
    const r = rowCats[i];
    const c = colCats[i];
    if (r == null || c == null) continue;
    const v = values ? values[i] : 1;
    if (aggregate !== 'count' && (v == null || !Number.isFinite(v))) continue;
    if (!rowMap.has(r)) rowMap.set(r, rowMap.size);
    if (!colMap.has(c)) colMap.set(c, colMap.size);
    const key = `${r} ${c}`;
    cellSum.set(key, (cellSum.get(key) ?? 0) + (aggregate === 'count' ? 1 : (v as number)));
    cellCount.set(key, (cellCount.get(key) ?? 0) + 1);
  }
  const rowLabels = [...rowMap.keys()];
  const colLabels = [...colMap.keys()];
  const agg = (sum: number, count: number): number => (aggregate === 'mean' ? (count ? sum / count : NaN) : sum);

  const values2: number[][] = [];
  const rowSum: number[] = new Array(rowLabels.length).fill(0);
  const rowCnt: number[] = new Array(rowLabels.length).fill(0);
  const colSum: number[] = new Array(colLabels.length).fill(0);
  const colCnt: number[] = new Array(colLabels.length).fill(0);
  let grandSum = 0;
  let grandCnt = 0;
  for (let r = 0; r < rowLabels.length; r++) {
    const row: number[] = [];
    for (let c = 0; c < colLabels.length; c++) {
      const key = `${rowLabels[r]} ${colLabels[c]}`;
      const s = cellSum.get(key) ?? 0;
      const cn = cellCount.get(key) ?? 0;
      row.push(cn ? round(agg(s, cn)) : aggregate === 'mean' ? NaN : 0);
      rowSum[r] += s;
      rowCnt[r] += cn;
      colSum[c] += s;
      colCnt[c] += cn;
      grandSum += s;
      grandCnt += cn;
    }
    values2.push(row);
  }
  return {
    rowLabels,
    colLabels,
    values: values2,
    rowTotals: rowLabels.map((_, r) => round(agg(rowSum[r], rowCnt[r]))),
    colTotals: colLabels.map((_, c) => round(agg(colSum[c], colCnt[c]))),
    total: round(agg(grandSum, grandCnt)),
    aggregate,
  };
}

// ── group aggregation & one-way ANOVA ────────────────────────────────────────

export interface GroupAggregate {
  label: string;
  count: number;
  mean: number;
  median: number;
  sum: number;
  min: number;
  max: number;
  stdev: number;
}

export interface AnovaResult {
  f: number;
  dfBetween: number;
  dfWithin: number;
  p: number | null;
  /** Proportion of variance explained (η²). */
  etaSquared: number;
}

export interface GroupByResult {
  groups: GroupAggregate[];
  anova: AnovaResult | null;
}

/** Aggregate a numeric variable by a categorical grouping (index-aligned). */
export function groupBy(cats: (string | null)[], values: (number | null)[]): GroupByResult {
  const buckets = new Map<string, number[]>();
  const n = Math.min(cats.length, values.length);
  for (let i = 0; i < n; i++) {
    const c = cats[i];
    const v = values[i];
    if (c == null || v == null || !Number.isFinite(v)) continue;
    if (!buckets.has(c)) buckets.set(c, []);
    buckets.get(c)!.push(v);
  }
  const groups: GroupAggregate[] = [...buckets.entries()].map(([label, vs]) => ({
    label,
    count: vs.length,
    mean: round(mean(vs)),
    median: round(median(vs)),
    sum: round(vs.reduce((s, v) => s + v, 0)),
    min: round(Math.min(...vs)),
    max: round(Math.max(...vs)),
    stdev: round(stdev(vs, true)),
  }));
  groups.sort((a, b) => b.mean - a.mean);
  const arrays = [...buckets.values()].filter((vs) => vs.length > 0);
  return { groups, anova: oneWayAnova(arrays) };
}

/** One-way ANOVA over ≥2 groups. Returns null when there aren't enough groups/points. */
export function oneWayAnova(groups: number[][]): AnovaResult | null {
  const valid = groups.filter((g) => g.length > 0);
  if (valid.length < 2) return null;
  const all = valid.flat();
  const N = all.length;
  const k = valid.length;
  if (N <= k) return null;
  const grand = mean(all);
  let ssBetween = 0;
  let ssWithin = 0;
  for (const g of valid) {
    const gm = mean(g);
    ssBetween += g.length * (gm - grand) ** 2;
    for (const v of g) ssWithin += (v - gm) ** 2;
  }
  const dfBetween = k - 1;
  const dfWithin = N - k;
  const msBetween = ssBetween / dfBetween;
  const msWithin = ssWithin / dfWithin;
  const f = msWithin > 0 ? msBetween / msWithin : NaN;
  const ssTotal = ssBetween + ssWithin;
  return {
    f: round(f),
    dfBetween,
    dfWithin,
    p: Number.isFinite(f) ? fPValue(f, dfBetween, dfWithin) : null,
    etaSquared: ssTotal > 0 ? round(ssBetween / ssTotal) : 0,
  };
}

// ── frequency (top-N) ────────────────────────────────────────────────────────

export interface FrequencyItem {
  label: string;
  count: number;
}

/** Top-N most frequent labels (nullish dropped). `explode` handles multi-valued cells. */
export function frequencies(labels: (string | null)[], topN = 15): { items: FrequencyItem[]; distinct: number; total: number } {
  const counts = new Map<string, number>();
  let total = 0;
  for (const l of labels) {
    if (l == null || l === '') continue;
    counts.set(l, (counts.get(l) ?? 0) + 1);
    total++;
  }
  const items = [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  return { items: items.slice(0, topN), distinct: counts.size, total };
}

// ── date bucketing (time series) ─────────────────────────────────────────────

export type DateBucket = 'day' | 'month' | 'year';

export interface TimeSeriesPoint {
  bucket: string;
  count: number;
  sum: number;
  mean: number;
}

/** Group an optional numeric value by a date bucket. Dates are ISO-ish strings. */
export function timeSeries(dates: (string | null)[], values: (number | null)[] | null, bucket: DateBucket): TimeSeriesPoint[] {
  const agg = new Map<string, { count: number; sum: number }>();
  const n = dates.length;
  for (let i = 0; i < n; i++) {
    const d = dates[i];
    if (!d) continue;
    const key = bucketDate(d, bucket);
    if (!key) continue;
    const v = values ? values[i] : null;
    const cur = agg.get(key) ?? { count: 0, sum: 0 };
    cur.count++;
    if (v != null && Number.isFinite(v)) cur.sum += v;
    agg.set(key, cur);
  }
  return [...agg.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([b, { count, sum }]) => ({ bucket: b, count, sum: round(sum), mean: count ? round(sum / count) : 0 }));
}

function bucketDate(iso: string, bucket: DateBucket): string | null {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(iso.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  if (bucket === 'year') return y;
  if (bucket === 'month') return mo ? `${y}-${mo}` : y;
  return d ? `${y}-${mo}-${d}` : mo ? `${y}-${mo}` : y;
}

// ── column-aware extractors ──────────────────────────────────────────────────

/** Numeric values for a column, aligned to `rows` (null where empty/non-numeric). */
export function numericValues(column: DatabaseColumn, rows: DatabaseRow[]): (number | null)[] {
  return rows.map((r) => {
    const raw = r.cells[column.id] ?? null;
    if (column.type === 'checkbox') return decodeCheckbox(raw) ? 1 : 0;
    if (column.type === 'relation') return r.relationCounts?.[column.id] ?? 0;
    return decodeNumber(raw);
  });
}

/** A single categorical label per row (null where empty), resolving option labels. */
export function categoryValues(column: DatabaseColumn, rows: DatabaseRow[]): (string | null)[] {
  return rows.map((r) => {
    const raw = r.cells[column.id] ?? null;
    if (column.type === 'select') return column.options.find((o) => o.id === raw)?.label ?? null;
    if (column.type === 'checkbox') return decodeCheckbox(raw) ? 'Sí' : 'No';
    const trimmed = (raw ?? '').trim();
    return trimmed ? trimmed : null;
  });
}

/** Possibly-many labels per row (for multi_select), used by top-N frequency. */
export function categoryValuesMulti(column: DatabaseColumn, rows: DatabaseRow[]): (string | null)[] {
  if (column.type !== 'multi_select') return categoryValues(column, rows);
  const labels: (string | null)[] = [];
  for (const r of rows) {
    const ids = decodeMultiSelect(r.cells[column.id] ?? null);
    for (const id of ids) labels.push(column.options.find((o) => o.id === id)?.label ?? null);
  }
  return labels;
}

/** ISO date strings for a date/time column, aligned to `rows` (null where empty). */
export function dateValues(column: DatabaseColumn, rows: DatabaseRow[]): (string | null)[] {
  return rows.map((r) => {
    const raw = (r.cells[column.id] ?? '').trim();
    return raw ? raw : null;
  });
}

// ── p-value machinery (pure approximations) ──────────────────────────────────

/** Lanczos log-gamma. */
export function logGamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Regularised lower incomplete gamma P(a, x) via series / continued fraction. */
export function gammaP(a: number, x: number): number {
  if (x <= 0 || a <= 0) return 0;
  if (x < a + 1) {
    // series
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let i = 0; i < 200; i++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-12) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
  }
  // continued fraction for Q, then P = 1 - Q
  const tiny = 1e-30;
  let b = x + 1 - a;
  let cc = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 200; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    cc = b + an / cc;
    if (Math.abs(cc) < tiny) cc = tiny;
    d = 1 / d;
    const del = d * cc;
    h *= del;
    if (Math.abs(del - 1) < 1e-12) break;
  }
  const q = Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
  return 1 - q;
}

/** Upper-tail p-value of a chi-square statistic with `dof` degrees of freedom. */
export function chiSquarePValue(chi2: number, dof: number): number | null {
  if (!(chi2 >= 0) || dof < 1) return null;
  return round(1 - gammaP(dof / 2, chi2 / 2), 6);
}

/** Lentz continued fraction for the incomplete beta (Numerical Recipes `betacf`). */
function betacf(x: number, a: number, b: number): number {
  const tiny = 1e-30;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-12) break;
  }
  return h;
}

/** Regularised incomplete beta I_x(a, b). Non-recursive (avoids a==b boundary loops). */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(x, a, b)) / a;
  return 1 - (bt * betacf(1 - x, b, a)) / b;
}

/** Two-tailed p-value for a Pearson r under H0: ρ=0 (Student-t, df=n-2). */
export function correlationPValue(r: number, n: number): number | null {
  if (n < 3 || !Number.isFinite(r)) return null;
  if (Math.abs(r) >= 1) return 0;
  const df = n - 2;
  const t = r * Math.sqrt(df / (1 - r * r));
  return tPValueTwoTailed(t, df);
}

export function tPValueTwoTailed(t: number, df: number): number | null {
  if (df < 1 || !Number.isFinite(t)) return null;
  const x = df / (df + t * t);
  return round(incompleteBeta(x, df / 2, 0.5), 6);
}

/** Upper-tail p-value of an F statistic with (d1, d2) degrees of freedom. */
export function fPValue(f: number, d1: number, d2: number): number | null {
  if (!(f >= 0) || d1 < 1 || d2 < 1) return null;
  const x = d2 / (d2 + d1 * f);
  return round(incompleteBeta(x, d2 / 2, d1 / 2), 6);
}
