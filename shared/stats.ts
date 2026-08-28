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
    const key = `${r}\u0000${c}`;
    cells.set(key, (cells.get(key) ?? 0) + 1);
  }
  const rowLabels = [...rowSet.keys()];
  const colLabels = [...colSet.keys()];
  const counts = rowLabels.map((r) => colLabels.map((c) => cells.get(`${r}\u0000${c}`) ?? 0));
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
    const key = `${r}\u0000${c}`;
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
      const key = `${rowLabels[r]}\u0000${colLabels[c]}`;
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

/**
 * Compare one numeric metric across a categorical cohort column.  This is the
 * only shared entry point for two-sample tests in database research: the
 * grouping labels and metric are aligned row-by-row before any values are
 * split.  It deliberately does not accept two unrelated numeric arrays.
 */
export interface CohortComparisonResult {
  groups: GroupAggregate[];
  pairwise: Array<{
    groupA: string;
    groupB: string;
    n1: number;
    n2: number;
    welch: TwoSampleTestResult;
    mannWhitney: TwoSampleTestResult;
    effectSizes: { cohensD: number; hedgesG: number; cliffsDelta: number };
  }>;
  correction: MultipleTestingResult | null;
}

export function cohortComparison(
  groups: (string | null)[],
  values: (number | null)[],
  options: { alpha?: number; maxPairs?: number } = {},
): CohortComparisonResult {
  const buckets = new Map<string, number[]>();
  const n = Math.min(groups.length, values.length);
  for (let i = 0; i < n; i++) {
    const group = groups[i];
    const value = values[i];
    if (group == null || value == null || !Number.isFinite(value)) continue;
    const bucket = buckets.get(group) ?? [];
    bucket.push(value);
    buckets.set(group, bucket);
  }
  const ordered = [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const pairs: CohortComparisonResult['pairwise'] = [];
  const maxPairs = Math.max(1, Math.floor(options.maxPairs ?? 28));
  for (let i = 0; i < ordered.length && pairs.length < maxPairs; i++) {
    for (let j = i + 1; j < ordered.length && pairs.length < maxPairs; j++) {
      const [groupA, a] = ordered[i];
      const [groupB, b] = ordered[j];
      pairs.push({
        groupA,
        groupB,
        n1: a.length,
        n2: b.length,
        welch: welchTTest(a, b),
        mannWhitney: mannWhitneyU(a, b),
        effectSizes: effectSizes(a, b),
      });
    }
  }
  const pValues = pairs.flatMap((pair) => [pair.welch.pValue, pair.mannWhitney.pValue]).filter(
    (p): p is number => p != null && Number.isFinite(p),
  );
  return {
    groups: groupBy(groups, values).groups,
    pairwise: pairs,
    correction: pValues.length ? benjaminiHochberg(pValues, options.alpha ?? 0.05) : null,
  };
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

// ── deterministic robust statistics / resampling ───────────────────────────

/** Median absolute deviation. The optional `scale` makes the result a
 * consistent estimator of the normal-theory standard deviation. */
export function medianAbsoluteDeviation(xs: number[], scale = 1): number {
  const finite = xs.filter(Number.isFinite);
  if (!finite.length) return NaN;
  const m = median(finite);
  return median(finite.map((x) => Math.abs(x - m))) * scale;
}
export const mad = medianAbsoluteDeviation;

/** Robust five-number summary used by database research claims. */
export interface RobustSummary { n: number; median: number; mad: number; q1: number; q3: number; iqr: number; }
export function robustSummary(xs: number[], scaleMad = 1): RobustSummary {
  const values = xs.filter(Number.isFinite);
  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  return { n: values.length, median: median(values), mad: medianAbsoluteDeviation(values, scaleMad), q1, q3, iqr: q3 - q1 };
}

/** Mean after removing a proportion from each tail. */
export function trimmedMean(xs: number[], proportion = 0.1): number {
  const values = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!values.length) return NaN;
  if (!(proportion >= 0 && proportion < 0.5)) throw new RangeError('trim proportion must be in [0, 0.5).');
  const trim = Math.floor(values.length * proportion);
  const kept = values.slice(trim, values.length - trim);
  return mean(kept);
}

/** All requested type-7 quantiles, in the same order as `probabilities`. */
export function quantiles(xs: number[], probabilities: number[]): number[] {
  return probabilities.map((q) => quantile(xs.filter(Number.isFinite), q));
}

/** Stable, platform-independent FNV-1a hash. Suitable for provenance and seeds,
 * not for authentication. JSON objects are canonicalised before hashing. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

export function hashString(value: string): string {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < value.length; i++) {
    // Hash UTF-16 code units explicitly so browser and Node agree.
    h ^= BigInt(value.charCodeAt(i));
    h = BigInt.asUintN(64, h * 0x100000001b3n);
  }
  return h.toString(16).padStart(16, '0');
}

export function hashSnapshot(value: unknown): string { return hashString(stableStringify(value)); }
export const stableHash = hashSnapshot;

/** Small deterministic PRNG (Mulberry32), with no dependence on Math.random. */
export class SeededRandom {
  private state: number;
  readonly seed: number;
  constructor(seed: number | string) {
    const text = String(seed);
    let n = typeof seed === 'number' && Number.isFinite(seed) ? seed | 0 : 0;
    if (typeof seed !== 'number') {
      n = Number.parseInt(hashString(text).slice(0, 8), 16) | 0;
    }
    this.seed = n >>> 0;
    this.state = this.seed;
  }
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  integer(maxExclusive: number): number { return Math.floor(this.next() * maxExclusive); }
}
export function seededRandom(seed: number | string): SeededRandom { return new SeededRandom(seed); }

export interface BootstrapOptions { iterations?: number; seed?: number | string; confidence?: number; }
export interface BootstrapResult { estimate: number; standardError: number; confidenceInterval: [number, number]; samples: number[]; iterations: number; seed: number; }

/** Index-resampling bootstrap. Sampling order and percentile interpolation are
 * fixed, making this reproducible across runs and machines. */
export function bootstrap(
  xs: number[],
  statisticOrOptions: ((sample: number[]) => number) | BootstrapOptions = mean,
  options: BootstrapOptions = {},
): BootstrapResult {
  const statistic = typeof statisticOrOptions === 'function' ? statisticOrOptions : mean;
  if (typeof statisticOrOptions !== 'function') options = statisticOrOptions;
  const values = xs.filter(Number.isFinite);
  const iterations = Math.max(1, Math.floor(options.iterations ?? 2000));
  const confidence = options.confidence ?? 0.95;
  if (!(confidence > 0 && confidence < 1)) throw new RangeError('confidence must be in (0, 1).');
  const rng = new SeededRandom(options.seed ?? 0);
  const estimate = statistic(values);
  const samples: number[] = [];
  if (!values.length) return { estimate: NaN, standardError: NaN, confidenceInterval: [NaN, NaN], samples, iterations, seed: rng.seed };
  for (let i = 0; i < iterations; i++) {
    const sample = new Array<number>(values.length);
    for (let j = 0; j < sample.length; j++) sample[j] = values[rng.integer(values.length)];
    const result = statistic(sample);
    if (Number.isFinite(result)) samples.push(result);
  }
  const alpha = (1 - confidence) / 2;
  return { estimate, standardError: stdev(samples, true), confidenceInterval: [quantile(samples, alpha), quantile(samples, 1 - alpha)], samples, iterations, seed: rng.seed };
}

/** Inverse standard normal CDF (Acklam's rational approximation). */
function normalInverse(p: number): number {
  if (p <= 0) return -Infinity; if (p >= 1) return Infinity;
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742]; const q = p - 0.5;
  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q;
    const numerator = (((((a[5] * r + a[4]) * r + a[3]) * r + a[2]) * r + a[1]) * r + a[0]);
    const denominator = ((((b[4] * r + b[3]) * r + b[2]) * r + b[1]) * r + b[0]) * r + 1;
    return q * numerator / denominator;
  }
  const r = q < 0 ? p : 1 - p;
  const s = Math.sqrt(-Math.log(r));
  const numerator = (((((c[5] * s + c[4]) * s + c[3]) * s + c[2]) * s + c[1]) * s + c[0]);
  const denominator = ((((d[3] * s + d[2]) * s + d[1]) * s + d[0]) * s + 1);
  const value = numerator / denominator;
  return q < 0 ? -value : value;
}
function normalCdf(x: number): number { return 0.5 * (1 + gammaP(0.5, (x * x) / 2) * (x < 0 ? -1 : 1)); }

/** BCa bootstrap interval. This keeps the same seeded resampling stream as
 * `bootstrap`, while applying bias-correction and jackknife acceleration. */
export function bcaBootstrap(xs: number[], statisticOrOptions: ((sample: number[]) => number) | BootstrapOptions = mean, options: BootstrapOptions = {}): BootstrapResult {
  const statistic = typeof statisticOrOptions === 'function' ? statisticOrOptions : mean;
  if (typeof statisticOrOptions !== 'function') options = statisticOrOptions;
  const values = xs.filter(Number.isFinite); const base = bootstrap(values, statistic, options); if (values.length < 2 || !base.samples.length) return base;
  const estimate = statistic(values); const below = base.samples.filter((sample) => sample < estimate).length; const z0 = normalInverse((below + 0.5) / (base.samples.length + 1));
  const jackknife = values.map((_, i) => statistic(values.filter((__, j) => j !== i))); const jackMean = mean(jackknife); const deviations = jackknife.map((v) => jackMean - v); const denom = 6 * (deviations.reduce((s, d) => s + d * d, 0) ** 1.5); const acceleration = denom > 0 ? deviations.reduce((s, d) => s + d ** 3, 0) / denom : 0;
  const alpha = (1 - (options.confidence ?? 0.95)) / 2; const adjusted = (raw: number) => normalCdf(z0 + (z0 + normalInverse(raw)) / Math.max(1e-15, 1 - acceleration * (z0 + normalInverse(raw)))); const lo = Math.min(1, Math.max(0, adjusted(alpha))); const hi = Math.min(1, Math.max(0, adjusted(1 - alpha)));
  return { ...base, confidenceInterval: [quantile(base.samples, lo), quantile(base.samples, hi)] };
}
export const bootstrapBCa = bcaBootstrap;
export const seededBootstrap = bootstrap;

export interface PermutationOptions { iterations?: number; seed?: number | string; alternative?: 'two-sided' | 'greater' | 'less'; }
export interface PermutationResult { observed: number; pValue: number; extreme: number; iterations: number; seed: number; }

/** Randomisation test for two independent samples. The +1 correction avoids a
 * zero p-value and is deterministic for a fixed seed. */
export function permutationTest(
  a: number[], b: number[],
  statisticOrOptions: ((left: number[], right: number[]) => number) | PermutationOptions = (left, right) => mean(left) - mean(right),
  options: PermutationOptions = {},
): PermutationResult {
  const statistic = typeof statisticOrOptions === 'function' ? statisticOrOptions : (left: number[], right: number[]) => mean(left) - mean(right);
  if (typeof statisticOrOptions !== 'function') options = statisticOrOptions;
  const left = a.filter(Number.isFinite); const right = b.filter(Number.isFinite);
  const observed = statistic(left, right); const pool = [...left, ...right];
  const iterations = Math.max(1, Math.floor(options.iterations ?? 5000));
  const rng = new SeededRandom(options.seed ?? 0); const alternative = options.alternative ?? 'two-sided';
  if (!pool.length || !Number.isFinite(observed)) return { observed, pValue: NaN, extreme: 0, iterations, seed: rng.seed };
  let extreme = 0;
  for (let i = 0; i < iterations; i++) {
    const shuffled = [...pool];
    for (let j = shuffled.length - 1; j > 0; j--) { const k = rng.integer(j + 1); [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]]; }
    const candidate = statistic(shuffled.slice(0, left.length), shuffled.slice(left.length));
    const hit = alternative === 'greater' ? candidate >= observed : alternative === 'less' ? candidate <= observed : Math.abs(candidate) >= Math.abs(observed);
    if (hit) extreme++;
  }
  return { observed, pValue: (extreme + 1) / (iterations + 1), extreme, iterations, seed: rng.seed };
}
export const seededPermutationTest = permutationTest;

export interface MultipleTestingResult { adjusted: number[]; rejected: boolean[]; alpha: number; }
export function benjaminiHochberg(pValues: number[], alpha = 0.05): MultipleTestingResult {
  const n = pValues.length; const order = pValues.map((p, i) => [Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 1, i] as [number, number]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const adjusted = new Array<number>(n).fill(1); let running = 1;
  for (let i = n - 1; i >= 0; i--) { running = Math.min(running, (order[i][0] * n) / (i + 1)); adjusted[order[i][1]] = running; }
  // Step-up: find the largest passing rank, then reject every smaller rank.
  let cutoff = -1;
  for (let i = 0; i < n; i++) if (order[i][0] <= alpha * (i + 1) / Math.max(1, n)) cutoff = i;
  const rejected = order.map((_, i) => i <= cutoff).reduce((out, yes, i) => { out[order[i][1]] = yes; return out; }, new Array<boolean>(n).fill(false));
  return { adjusted, rejected, alpha };
}
export const adjustPValuesBH = benjaminiHochberg;
export const benjaminiHochbergAdjust = benjaminiHochberg;

export function holmCorrection(pValues: number[], alpha = 0.05): MultipleTestingResult {
  const n = pValues.length; const order = pValues.map((p, i) => [Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 1, i] as [number, number]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const adjusted = new Array<number>(n).fill(1); let running = 0;
  for (let i = 0; i < n; i++) { running = Math.max(running, (n - i) * order[i][0]); adjusted[order[i][1]] = Math.min(1, running); }
  let still = true; const rejected = new Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i++) { still = still && order[i][0] <= alpha / (n - i); rejected[order[i][1]] = still; }
  return { adjusted, rejected, alpha };
}
export const adjustPValuesHolm = holmCorrection;
export const holmStepDown = holmCorrection;

export function cohensD(a: number[], b: number[]): number {
  const x = a.filter(Number.isFinite), y = b.filter(Number.isFinite); if (x.length < 2 || y.length < 2) return NaN;
  const pooled = Math.sqrt(((x.length - 1) * variance(x) + (y.length - 1) * variance(y)) / (x.length + y.length - 2));
  return pooled > 0 ? (mean(x) - mean(y)) / pooled : NaN;
}
export function hedgesG(a: number[], b: number[]): number {
  const d = cohensD(a, b); const n = a.filter(Number.isFinite).length + b.filter(Number.isFinite).length;
  return Number.isFinite(d) && n > 3 ? d * (1 - 3 / (4 * n - 9)) : d;
}
export function cliffsDelta(a: number[], b: number[]): number {
  const x = a.filter(Number.isFinite), y = b.filter(Number.isFinite); if (!x.length || !y.length) return NaN;
  let score = 0; for (const left of x) for (const right of y) score += left > right ? 1 : left < right ? -1 : 0; return score / (x.length * y.length);
}
export function oddsRatio(aSuccess: number, aFailure: number, bSuccess: number, bFailure: number, correction = 0.5): number {
  return ((aSuccess + correction) * (bFailure + correction)) / ((aFailure + correction) * (bSuccess + correction));
}
export function effectSizes(a: number[], b: number[]): { cohensD: number; hedgesG: number; cliffsDelta: number } { return { cohensD: cohensD(a, b), hedgesG: hedgesG(a, b), cliffsDelta: cliffsDelta(a, b) }; }

export interface TwoSampleTestResult { statistic: number; pValue: number | null; n1: number; n2: number; effectSize?: number; }
/** Welch's unequal-variance t test. */
export function welchTTest(a: number[], b: number[]): TwoSampleTestResult {
  const x = a.filter(Number.isFinite), y = b.filter(Number.isFinite); if (x.length < 2 || y.length < 2) return { statistic: NaN, pValue: null, n1: x.length, n2: y.length };
  const vx = variance(x), vy = variance(y); const se = Math.sqrt(vx / x.length + vy / y.length); if (!(se > 0)) return { statistic: NaN, pValue: null, n1: x.length, n2: y.length };
  const statistic = (mean(x) - mean(y)) / se; const dfNum = (vx / x.length + vy / y.length) ** 2; const dfDen = (vx * vx) / (x.length * x.length * (x.length - 1)) + (vy * vy) / (y.length * y.length * (y.length - 1)); const df = dfNum / dfDen;
  return { statistic, pValue: tPValueTwoTailed(statistic, df), n1: x.length, n2: y.length, effectSize: cohensD(x, y) };
}
export const welchT = welchTTest;
/** Mann–Whitney U with normal approximation and tie correction. */
export function mannWhitneyU(a: number[], b: number[]): TwoSampleTestResult {
  const x = a.filter(Number.isFinite), y = b.filter(Number.isFinite); const all = [...x.map((v) => [v, 0] as [number, number]), ...y.map((v) => [v, 1] as [number, number])].sort((u, v) => u[0] - v[0]); if (!x.length || !y.length) return { statistic: NaN, pValue: null, n1: x.length, n2: y.length };
  let rankSum = 0, i = 0, tieTerm = 0; while (i < all.length) { let j = i; while (j + 1 < all.length && all[j + 1][0] === all[i][0]) j++; const rankMean = (i + j + 2) / 2; for (let k = i; k <= j; k++) if (all[k][1] === 0) rankSum += rankMean; tieTerm += (j - i + 1) ** 3 - (j - i + 1); i = j + 1; }
  const u = rankSum - (x.length * (x.length + 1)) / 2; const mu = x.length * y.length / 2; const varianceU = x.length * y.length / 12 * (all.length + 1 - tieTerm / (all.length * (all.length - 1))); const z = varianceU > 0 ? (u - mu) / Math.sqrt(varianceU) : NaN;
  return { statistic: u, pValue: Number.isFinite(z) ? 2 * (1 - normalCdf(Math.abs(z))) : null, n1: x.length, n2: y.length, effectSize: 2 * u / (x.length * y.length) - 1 };
}
export const mannWhitney = mannWhitneyU;
/** Kruskal–Wallis rank test for independent groups. */
export function kruskalWallis(groups: number[][]): { statistic: number; dof: number; pValue: number | null; groups: number } {
  const valid = groups.map((g) => g.filter(Number.isFinite)).filter((g) => g.length); const flat = valid.flat().sort((a, b) => a - b); if (valid.length < 2) return { statistic: NaN, dof: 0, pValue: null, groups: valid.length }; const rankBy = new Map<number, number>(); let i = 0, tieSum = 0; while (i < flat.length) { let j = i; while (j + 1 < flat.length && flat[j + 1] === flat[i]) j++; rankBy.set(flat[i], (i + j + 2) / 2); tieSum += (j - i + 1) ** 3 - (j - i + 1); i = j + 1; }
  let sum = 0; for (const group of valid) { const rankSum = group.reduce((s, v) => s + rankBy.get(v)!, 0); sum += (rankSum * rankSum) / group.length; } const n = flat.length; const h0 = 12 * sum / (n * (n + 1)) - 3 * (n + 1); const correction = 1 - tieSum / (n ** 3 - n); const statistic = correction > 0 ? h0 / correction : h0; const dof = valid.length - 1; return { statistic, dof, pValue: chiSquarePValue(statistic, dof), groups: valid.length };
}
export const kruskalWallisTest = kruskalWallis;

// ── survival analysis and causal diagnostics ────────────────────────────────

export interface KaplanMeierPoint { time: number; atRisk: number; events: number; censored: number; survival: number; variance: number; }
export interface KaplanMeierResult { points: KaplanMeierPoint[]; median: number | null; n: number; events: number; }

/** Kaplan–Meier product-limit estimator. Times are non-negative and event is
 * true for a failure, false for right-censoring. Ties are handled by applying
 * all events before censoring at each time. */
export function kaplanMeier(times: number[], events: (boolean | number)[]): KaplanMeierResult {
  const observations = times.map((time, i) => ({ time, event: Boolean(events[i]) })).filter((row) => Number.isFinite(row.time) && row.time >= 0);
  observations.sort((a, b) => a.time - b.time);
  let atRisk = observations.length, survival = 1, greenwood = 0; const points: KaplanMeierPoint[] = []; let eventTotal = 0;
  for (let i = 0; i < observations.length;) {
    const time = observations[i].time; let eventsAt = 0, censoredAt = 0;
    while (i < observations.length && observations[i].time === time) { if (observations[i].event) eventsAt++; else censoredAt++; i++; }
    if (eventsAt > 0 && atRisk > 0) { survival *= (atRisk - eventsAt) / atRisk; greenwood += eventsAt < atRisk ? eventsAt / (atRisk * (atRisk - eventsAt)) : 0; eventTotal += eventsAt; }
    points.push({ time, atRisk, events: eventsAt, censored: censoredAt, survival, variance: survival * survival * greenwood });
    atRisk -= eventsAt + censoredAt;
  }
  const medianPoint = points.find((point) => point.survival <= 0.5);
  return { points, median: medianPoint?.time ?? null, n: observations.length, events: eventTotal };
}

export interface LogRankResult { statistic: number; pValue: number | null; groups: [number, number]; events: [number, number]; }
/** Mantel–Cox log-rank test for two independent survival groups. */
export function logRank(times: number[], events: (boolean | number)[], groups: (number | string | boolean)[]): LogRankResult {
  const rows = times.map((time, i) => ({ time, event: Boolean(events[i]), group: groups[i] })).filter((row) => Number.isFinite(row.time) && row.group != null);
  const labels = [...new Set(rows.map((row) => String(row.group)))].slice(0, 2); if (labels.length < 2) return { statistic: NaN, pValue: null, groups: [0, 0], events: [0, 0] };
  let score = 0, information = 0; const eventCounts: [number, number] = [0, 0];
  for (const row of rows) if (row.event) eventCounts[labels.indexOf(String(row.group)) as 0 | 1]++;
  const eventTimes = [...new Set(rows.filter((row) => row.event).map((row) => row.time))].sort((a, b) => a - b);
  for (const time of eventTimes) {
    const risk = [0, 0]; const event = [0, 0]; for (const row of rows) { const index = labels.indexOf(String(row.group)); if (index < 0) continue; if (row.time >= time) risk[index as 0 | 1]++; if (row.time === time && row.event) event[index as 0 | 1]++; }
    const totalRisk = risk[0] + risk[1], totalEvents = event[0] + event[1]; if (!totalRisk || !totalEvents) continue;
    const expected = totalEvents * risk[0] / totalRisk; score += event[0] - expected; information += totalEvents * risk[0] * risk[1] * (totalRisk - totalEvents) / Math.max(1, totalRisk * totalRisk * (totalRisk - 1));
  }
  const statistic = information > 0 ? (score * score) / information : NaN;
  return { statistic, pValue: Number.isFinite(statistic) ? chiSquarePValue(statistic, 1) : null, groups: [rows.filter((r) => String(r.group) === labels[0]).length, rows.filter((r) => String(r.group) === labels[1]).length], events: eventCounts };
}
export const logRankTest = logRank;

export interface CoxPHResult { coefficients: number[]; hazardRatios: number[]; standardErrors: number[]; z: number[]; pValues: (number | null)[]; n: number; events: number; iterations: number; converged: boolean; proportionalHazardsWarning: boolean; warning: string | null; }
/** Basic Cox proportional-hazards model using Breslow risk sets and Newton
 * updates. This intentionally reports a PH diagnostic rather than silently
 * treating the assumption as established. */
export function coxPH(times: number[], events: (boolean | number)[], covariates: number[][], options: { maxIterations?: number; tolerance?: number; phThreshold?: number } = {}): CoxPHResult {
  const rows = times.map((time, i) => ({ time, event: Boolean(events[i]), x: covariates[i] })).filter((row) => Number.isFinite(row.time) && row.x?.every(Number.isFinite)); const p = rows[0]?.x.length ?? 0; const maxIterations = Math.max(1, Math.floor(options.maxIterations ?? 50)); const tolerance = options.tolerance ?? 1e-8;
  let beta = new Array<number>(p).fill(0), converged = false, iterations = 0;
  for (iterations = 1; iterations <= maxIterations; iterations++) {
    const gradient = new Array<number>(p).fill(0), hessian = Array.from({ length: p }, () => new Array<number>(p).fill(0));
    for (const row of rows.filter((candidate) => candidate.event)) {
      const risk = rows.filter((candidate) => candidate.time >= row.time); const weights = risk.map((candidate) => Math.exp(Math.max(-40, Math.min(40, candidate.x.reduce((s, x, j) => s + x * beta[j], 0))))); const denominator = weights.reduce((s, weight) => s + weight, 0) || 1; const meanX = beta.map((_, j) => risk.reduce((s, candidate, k) => s + weights[k] * candidate.x[j], 0) / denominator);
      row.x.forEach((value, j) => { gradient[j] += value - meanX[j]; });
      for (let j = 0; j < p; j++) for (let k = 0; k < p; k++) { const second = risk.reduce((s, candidate, index) => s + weights[index] * candidate.x[j] * candidate.x[k], 0) / denominator; hessian[j][k] += second - meanX[j] * meanX[k]; }
    }
    const inv = invertMatrix(hessian); if (!inv) break; const delta = inv.map((line) => line.reduce((s, value, j) => s + value * gradient[j], 0)); beta = beta.map((value, j) => value + delta[j]); if (Math.max(...delta.map(Math.abs), 0) < tolerance) { converged = true; break; }
  }
  const information = (() => { const h = Array.from({ length: p }, () => new Array<number>(p).fill(0)); for (const eventRow of rows.filter((candidate) => candidate.event)) { const risk = rows.filter((candidate) => candidate.time >= eventRow.time); const w = risk.map((candidate) => Math.exp(Math.max(-40, Math.min(40, candidate.x.reduce((s, x, j) => s + x * beta[j], 0))))); const d = w.reduce((s, x) => s + x, 0) || 1; const m = beta.map((_, j) => risk.reduce((s, r, k) => s + w[k] * r.x[j], 0) / d); for (let j = 0; j < p; j++) for (let k = 0; k < p; k++) h[j][k] += risk.reduce((s, r, k2) => s + w[k2] * r.x[j] * r.x[k], 0) / d - m[j] * m[k]; } return h; })();
  const inverse = invertMatrix(information); const standardErrors = inverse ? inverse.map((row, i) => Math.sqrt(Math.max(0, row[i]))) : new Array<number>(p).fill(NaN); const z = beta.map((value, i) => standardErrors[i] > 0 ? value / standardErrors[i] : NaN); const pValues = z.map((value) => Number.isFinite(value) ? tPValueTwoTailed(value, Math.max(1, rows.length - p)) : null);
  const residuals = rows.filter((row) => row.event).map((row) => ({ time: row.time, residual: row.x.map((value, j) => value - mean(rows.filter((candidate) => candidate.time >= row.time).map((candidate) => candidate.x[j]))) })); const ph = residuals.length > 2 && p > 0 && Math.abs(pearson(residuals.map((row) => [row.time, row.residual[0]])).r) > (options.phThreshold ?? 0.3);
  return { coefficients: beta, hazardRatios: beta.map(Math.exp), standardErrors, z, pValues, n: rows.length, events: rows.filter((row) => row.event).length, iterations, converged, proportionalHazardsWarning: ph, warning: ph ? 'Schoenfeld residuals suggest a possible proportional-hazards violation.' : null };
}

export interface IPWResult { estimate: number; standardError: number; propensity: number[]; overlap: { min: number; max: number; fraction: number }; balanceBefore: number[]; balanceAfter: number[]; warnings: string[]; assumptions: string[]; metadata: { method: 'inverse-probability-of-treatment weighting'; estimand: 'ATE'; stabilized: boolean }; }
/** ATE by inverse-probability weighting. The result includes overlap and
 * standardized-mean-difference diagnostics, and explicitly records causal
 * assumptions instead of presenting weighting as identification by itself. */
export function inverseProbabilityWeighting(treatment: number[], outcome: number[], covariates: number[][], options: { stabilized?: boolean; trim?: number } = {}): IPWResult {
  const rows = treatment.map((a, i) => ({ a, y: outcome[i], x: covariates[i] })).filter((r) => (r.a === 0 || r.a === 1) && Number.isFinite(r.y) && r.x?.every(Number.isFinite)); const n = rows.length; const p = rows[0]?.x.length ?? 0; const design = rows.map((r) => [1, ...r.x]); let beta = new Array<number>(p + 1).fill(0);
  for (let iter = 0; iter < 60; iter++) { const g = new Array<number>(p + 1).fill(0); const h = Array.from({ length: p + 1 }, () => new Array<number>(p + 1).fill(0)); for (let i = 0; i < n; i++) { const z = design[i].reduce((s, v, j) => s + v * beta[j], 0); const q = z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)); const w = Math.max(1e-9, q * (1 - q)); for (let j = 0; j <= p; j++) { g[j] += design[i][j] * (rows[i].a - q); for (let k = 0; k <= p; k++) h[j][k] += w * design[i][j] * design[i][k]; } } const inv = invertMatrix(h); if (!inv) break; const delta = inv.map((r) => r.reduce((s, v, j) => s + v * g[j], 0)); beta = beta.map((v, j) => v + delta[j]); if (Math.max(...delta.map(Math.abs), 0) < 1e-8) break; }
  const propensity = design.map((row) => { const z = row.reduce((s, v, j) => s + v * beta[j], 0); return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)); }); const trim = Math.min(0.49, Math.max(0, options.trim ?? 0)); const keep = rows.map((r, i) => propensity[i] >= trim && propensity[i] <= 1 - trim); const kept = rows.map((r, i) => ({ ...r, ps: propensity[i] })).filter((_, i) => keep[i]);
  const treated = kept.filter((r) => r.a === 1), control = kept.filter((r) => r.a === 0); const stabilized = options.stabilized ?? false; const marginal = n ? rows.reduce((s, r) => s + r.a, 0) / n : 0.5; const weight = (r: typeof kept[number]) => (stabilized ? (r.a ? marginal : 1 - marginal) : 1) / (r.a ? Math.max(1e-6, r.ps) : Math.max(1e-6, 1 - r.ps)); const weightedMean = (group: typeof kept) => { const total = group.reduce((s, r) => s + weight(r), 0) || 1; return group.reduce((s, r) => s + weight(r) * r.y, 0) / total; }; const estimate = weightedMean(treated) - weightedMean(control); const weightedVariance = (group: typeof kept) => { const m = weightedMean(group); const total = group.reduce((s, r) => s + weight(r), 0) || 1; return group.reduce((s, r) => s + weight(r) ** 2 * (r.y - m) ** 2, 0) / total ** 2; }; const standardError = Math.sqrt(weightedVariance(treated) + weightedVariance(control));
  const smd = (j: number, weighted: boolean) => { const groupMean = (group: typeof kept, a: number) => { const g = group.filter((r) => r.a === a); const total = g.reduce((s, r) => s + (weighted ? weight(r) : 1), 0) || 1; return g.reduce((s, r) => s + (weighted ? weight(r) : 1) * r.x[j], 0) / total; }; const m1 = groupMean(kept, 1), m0 = groupMean(kept, 0); const sd = Math.sqrt((variance(kept.filter((r) => r.a === 1).map((r) => r.x[j])) + variance(kept.filter((r) => r.a === 0).map((r) => r.x[j]))) / 2) || 1; return (m1 - m0) / sd; }; const balanceBefore = Array.from({ length: p }, (_, j) => smd(j, false)); const balanceAfter = Array.from({ length: p }, (_, j) => smd(j, true)); const min = propensity.length ? Math.min(...propensity) : NaN, max = propensity.length ? Math.max(...propensity) : NaN, overlapFraction = n ? kept.length / n : 0; const warnings: string[] = []; if (Number.isFinite(min) && Number.isFinite(max) && (min < 0.01 || max > 0.99)) warnings.push('Extreme propensity scores may produce unstable inverse-probability weights.'); if (overlapFraction < 0.8) warnings.push('Limited propensity-score overlap after trimming.'); if (!treated.length || !control.length) warnings.push('The weighted sample does not retain both treatment groups.'); if (balanceAfter.some((value) => Math.abs(value) > 0.1)) warnings.push('Weighted covariate balance remains above |SMD|=0.1.');
  return { estimate, standardError, propensity, overlap: { min, max, fraction: overlapFraction }, balanceBefore, balanceAfter, warnings, assumptions: ['Consistency and well-defined treatment.', 'Conditional exchangeability given measured covariates.', 'Positivity/overlap.', 'No unmeasured confounding.'], metadata: { method: 'inverse-probability-of-treatment weighting', estimand: 'ATE', stabilized } };
}

export interface SimpsonResult { detected: boolean; marginalDifference: number; withinStrata: Array<{ stratum: string; difference: number; n: number }>; directionReversed: boolean; warning: string | null; }
/** Detects a Simpson reversal by comparing marginal and every non-empty
 * stratum-level treatment contrast. This is a diagnostic, not a causal claim. */
export function detectSimpsonParadox(treatment: (string | number | boolean)[], outcome: number[], strata: (string | number | boolean)[]): SimpsonResult {
  const rows = treatment.map((a, i) => ({ a: String(a), y: outcome[i], s: String(strata[i]) })).filter((r) => Number.isFinite(r.y)); const labels = [...new Set(rows.map((r) => r.a))].slice(0, 2); const meanFor = (set: typeof rows, label: string) => { const values = set.filter((r) => r.a === label).map((r) => r.y); return values.length ? mean(values) : NaN; }; const marginalDifference = labels.length === 2 ? meanFor(rows, labels[1]) - meanFor(rows, labels[0]) : NaN; const withinStrata = [...new Set(rows.map((r) => r.s))].map((s) => { const subset = rows.filter((r) => r.s === s); return { stratum: s, difference: meanFor(subset, labels[1]) - meanFor(subset, labels[0]), n: subset.length }; }).filter((r) => Number.isFinite(r.difference)); const signs = withinStrata.map((r) => Math.sign(r.difference)).filter(Boolean); const directionReversed = Number.isFinite(marginalDifference) && signs.length > 0 && Math.sign(marginalDifference) !== Math.sign(mean(signs)); const detected = directionReversed && signs.every((sign) => sign === signs[0]); return { detected, marginalDifference, withinStrata, directionReversed, warning: detected ? 'Marginal and within-stratum associations reverse direction. Interpret the aggregate comparison with stratification.' : null };
}

export interface RelationEdge { source?: string; target?: string; from?: string; to?: string; weight?: number; }
export interface RelationGraphResult { nodes: string[]; components: string[][]; degree: Record<string, number>; betweenness: Record<string, number>; }
/** Deterministic connected components and unnormalised betweenness/degree
 * centrality for relation edges. Self-loops are ignored. */
export function relationGraphDiagnostics(edges: RelationEdge[]): RelationGraphResult {
  const adjacency = new Map<string, Map<string, number>>(); const add = (id: string) => { if (!adjacency.has(id)) adjacency.set(id, new Map()); }; for (const edge of edges) { const source = edge.source ?? edge.from, target = edge.target ?? edge.to; if (!source || !target || source === target) continue; add(source); add(target); adjacency.get(source)!.set(target, (adjacency.get(source)!.get(target) ?? 0) + (edge.weight ?? 1)); adjacency.get(target)!.set(source, (adjacency.get(target)!.get(source) ?? 0) + (edge.weight ?? 1)); }
  const nodes = [...adjacency.keys()].sort(); const components: string[][] = []; const seen = new Set<string>(); for (const root of nodes) { if (seen.has(root)) continue; const queue = [root], component: string[] = []; seen.add(root); while (queue.length) { const node = queue.shift()!; component.push(node); for (const next of adjacency.get(node)!.keys()) if (!seen.has(next)) { seen.add(next); queue.push(next); } } components.push(component.sort()); }
  const degree = Object.fromEntries(nodes.map((node) => [node, adjacency.get(node)!.size])); const betweenness = Object.fromEntries(nodes.map((node) => [node, 0])); for (const source of nodes) { const stack: string[] = [], predecessors = new Map<string, string[]>(), sigma = new Map<string, number>(nodes.map((n) => [n, 0])), distance = new Map<string, number>(nodes.map((n) => [n, -1])); sigma.set(source, 1); distance.set(source, 0); const queue = [source]; while (queue.length) { const v = queue.shift()!; stack.push(v); for (const w of adjacency.get(v)!.keys()) { if (distance.get(w)! < 0) { queue.push(w); distance.set(w, distance.get(v)! + 1); } if (distance.get(w) === distance.get(v)! + 1) { sigma.set(w, sigma.get(w)! + sigma.get(v)!); predecessors.set(w, [...(predecessors.get(w) ?? []), v]); } } } const dependency = new Map<string, number>(nodes.map((n) => [n, 0])); while (stack.length) { const w = stack.pop()!; for (const v of predecessors.get(w) ?? []) dependency.set(v, dependency.get(v)! + (sigma.get(v)! / Math.max(1, sigma.get(w)!)) * (1 + dependency.get(w)!)); if (w !== source) betweenness[w] += dependency.get(w)!; } } return { nodes, components, degree, betweenness };
}
export const relationCentrality = relationGraphDiagnostics;
export function connectedComponents(edges: RelationEdge[]): string[][] { return relationGraphDiagnostics(edges).components; }

// ── regression diagnostics ─────────────────────────────────────────────────

export interface LogisticRegressionResult { intercept: number; coefficient: number; coefficients: number[]; iterations: number; converged: boolean; logLikelihood: number; accuracy: number; n: number; predict: (x: number) => number; probability: (x: number) => number; }
/** Penalisation-free one-predictor logistic regression, fitted by IRLS. */
export function logisticRegression(xs: number[], ys: number[], options?: { maxIterations?: number; tolerance?: number }): LogisticRegressionResult;
export function logisticRegression(pairs: [number, number][], options?: { maxIterations?: number; tolerance?: number }): LogisticRegressionResult;
export function logisticRegression(input: number[] | [number, number][], targetOrOptions: number[] | { maxIterations?: number; tolerance?: number } = [], maybeOptions: { maxIterations?: number; tolerance?: number } = {}): LogisticRegressionResult {
  const pairs: [number, number][] = Array.isArray(input[0])
    ? (input as [number, number][]).filter(([x, y]) => Number.isFinite(x) && (y === 0 || y === 1))
    : (input as number[]).map((x, i) => [x, Number((targetOrOptions as number[])[i])] as [number, number]).filter(([x, y]) => Number.isFinite(x) && (y === 0 || y === 1));
  const options = (Array.isArray(input[0]) ? targetOrOptions : maybeOptions) as { maxIterations?: number; tolerance?: number };
  const maxIterations = Math.max(1, Math.floor(options.maxIterations ?? 100)); const tolerance = options.tolerance ?? 1e-9;
  let b0 = 0, b1 = 0, converged = false, iterations = 0;
  const sigmoid = (z: number) => z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
  for (iterations = 1; iterations <= maxIterations; iterations++) {
    let g0 = 0, g1 = 0, h00 = 0, h01 = 0, h11 = 0;
    for (const [x, y] of pairs) { const p = sigmoid(b0 + b1 * x); const w = Math.max(1e-12, p * (1 - p)); const e = y - p; g0 += e; g1 += e * x; h00 += w; h01 += w * x; h11 += w * x * x; }
    const det = h00 * h11 - h01 * h01; if (!(det > 1e-20)) break;
    const d0 = (h11 * g0 - h01 * g1) / det, d1 = (-h01 * g0 + h00 * g1) / det; b0 += d0; b1 += d1;
    if (Math.max(Math.abs(d0), Math.abs(d1)) < tolerance) { converged = true; break; }
  }
  const probability = (x: number) => sigmoid(b0 + b1 * x); const predict = (x: number): number => probability(x) >= 0.5 ? 1 : 0;
  const logLikelihood = pairs.reduce((s, [x, y]) => { const p = Math.min(1 - 1e-15, Math.max(1e-15, probability(x))); return s + y * Math.log(p) + (1 - y) * Math.log(1 - p); }, 0);
  const accuracy = pairs.length ? pairs.filter(([x, y]) => predict(x) === y).length / pairs.length : NaN;
  return { intercept: b0, coefficient: b1, coefficients: [b0, b1], iterations, converged, logLikelihood, accuracy, n: pairs.length, predict, probability };
}

function invertMatrix(input: number[][]): number[][] | null {
  const n = input.length; const a = input.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => i === j ? 1 : 0)]);
  for (let col = 0; col < n; col++) { let pivot = col; for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r; if (Math.abs(a[pivot][col]) < 1e-12) return null; [a[col], a[pivot]] = [a[pivot], a[col]]; const d = a[col][col]; a[col] = a[col].map((v) => v / d); for (let r = 0; r < n; r++) if (r !== col) { const f = a[r][col]; a[r] = a[r].map((v, j) => v - f * a[col][j]); } }
  return a.map((row) => row.slice(n));
}
/** Variance inflation factors, one value per predictor column. */
export function vif(matrix: number[][]): number[] {
  if (!matrix.length || !matrix[0]?.length) return [];
  const n = matrix.length, p = matrix[0].length; const means = Array.from({ length: p }, (_, j) => mean(matrix.map((row) => row[j])));
  const covarianceMatrix2 = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => matrix.reduce((s, row) => s + (row[i] - means[i]) * (row[j] - means[j]), 0) / Math.max(1, n - 1)));
  const inv = invertMatrix(covarianceMatrix2); if (!inv) return new Array(p).fill(Infinity);
  return inv.map((row, i) => covarianceMatrix2[i][i] * row[i]);
}

export interface PCAResult { mean: number[]; components: number[][]; eigenvalues: number[]; explainedVariance: number[]; scores: number[][]; }
/** PCA on a complete numeric matrix using a deterministic Jacobi eigensolver. */
export function pca(matrix: number[][], components = matrix[0]?.length ?? 0): PCAResult {
  if (!matrix.length || !matrix[0]?.length) return { mean: [], components: [], eigenvalues: [], explainedVariance: [], scores: [] };
  const n = matrix.length, p = matrix[0].length; const meanVector = Array.from({ length: p }, (_, j) => mean(matrix.map((r) => r[j]))); const centered = matrix.map((r) => r.map((v, j) => v - meanVector[j]));
  let a = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => centered.reduce((s, r) => s + r[i] * r[j], 0) / Math.max(1, n - 1))); const v: number[][] = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => i === j ? 1 : 0));
  for (let iter = 0; iter < 100 * p * p; iter++) { let x = 0, y = 1, largest = 0; for (let i = 0; i < p; i++) for (let j = i + 1; j < p; j++) if (Math.abs(a[i][j]) > largest) { largest = Math.abs(a[i][j]); x = i; y = j; } if (largest < 1e-12) break; const theta = 0.5 * Math.atan2(2 * a[x][y], a[y][y] - a[x][x]); const c = Math.cos(theta), s = Math.sin(theta); const next = a.map((r) => [...r]); for (let i = 0; i < p; i++) { next[i][x] = c * a[i][x] - s * a[i][y]; next[i][y] = s * a[i][x] + c * a[i][y]; } for (let j = 0; j < p; j++) { next[x][j] = c * next[x][j] - s * next[y][j]; next[y][j] = s * next[x][j] + c * next[y][j]; } a = next; for (let i = 0; i < p; i++) { const qx = v[i][x], qy = v[i][y]; v[i][x] = c * qx - s * qy; v[i][y] = s * qx + c * qy; } }
  const order = Array.from({ length: p }, (_, i) => i).sort((i, j) => a[j][j] - a[i][i] || i - j); const k = Math.min(p, Math.max(1, components)); const eigenvalues = order.slice(0, k).map((i) => Math.max(0, a[i][i])); const basis = order.slice(0, k).map((i) => v.map((row) => row[i])); const total = eigenvalues.reduce((s, e) => s + e, 0) || 1; const scores = centered.map((row) => basis.map((axis) => row.reduce((s, x, j) => s + x * axis[j], 0))); return { mean: meanVector, components: basis, eigenvalues, explainedVariance: eigenvalues.map((e) => e / total), scores };
}

// ── missingness, temporal diagnostics ──────────────────────────────────────

export interface MissingnessResult { total: number; missing: number; observed: number; rate: number; }
export function missingness(values: unknown[]): MissingnessResult { const missing = values.filter((v) => v == null || (typeof v === 'number' && !Number.isFinite(v)) || (typeof v === 'string' && v.trim() === '')).length; return { total: values.length, missing, observed: values.length - missing, rate: values.length ? missing / values.length : NaN }; }
export const missingnessSummary = missingness;
export function missingnessByColumn(rows: Array<Record<string, unknown>>): Record<string, MissingnessResult> { const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].sort(); return Object.fromEntries(keys.map((key) => [key, missingness(rows.map((r) => r[key]))])); }

export interface ChangePoint { index: number; statistic: number; beforeMean: number; afterMean: number; }
export function detectChangePoints(xs: number[], options: { minSegmentLength?: number; threshold?: number; maxChanges?: number } = {}): ChangePoint[] {
  const values = xs.filter(Number.isFinite); const minLength = Math.max(2, Math.floor(options.minSegmentLength ?? 5)); const threshold = options.threshold ?? 3; const maxChanges = Math.max(1, Math.floor(options.maxChanges ?? 10)); const found: ChangePoint[] = [];
  const scan = (start: number, end: number) => { let best: ChangePoint | null = null; for (let i = start + minLength; i <= end - minLength; i++) { const left = values.slice(start, i), right = values.slice(i, end); const pooled = Math.sqrt(variance(left, false) / left.length + variance(right, false) / right.length); const statistic = pooled > 0 ? Math.abs(mean(right) - mean(left)) / pooled : (mean(left) === mean(right) ? 0 : Infinity); if (!best || statistic > best.statistic || (statistic === best.statistic && i < best.index)) best = { index: i, statistic, beforeMean: mean(left), afterMean: mean(right) }; } if (!best || best.statistic < threshold || found.length >= maxChanges) return; found.push(best); scan(start, best.index); scan(best.index, end); };
  if (values.length >= 2 * minLength) scan(0, values.length); return found.sort((a, b) => a.index - b.index);
}

/** Autocorrelation function at lags 0..maxLag, using the global sample mean. */
export function autocorrelation(xs: number[], maxLag = Math.max(0, xs.length - 1)): number[] { const values = xs.filter(Number.isFinite); if (!values.length) return []; const lag = Math.min(maxLag, values.length - 1); const m = mean(values); const denom = values.reduce((s, x) => s + (x - m) ** 2, 0); if (denom === 0) return Array.from({ length: lag + 1 }, (_, i) => i === 0 ? 1 : NaN); return Array.from({ length: lag + 1 }, (_, k) => values.slice(k).reduce((s, x, i) => s + (x - m) * (values[i] - m), 0) / denom); }
export const acf = autocorrelation;
export const autocorrelationFunction = autocorrelation;
export const changePoints = detectChangePoints;

/** Change-point scan that preserves the source row index for sparse series. */
export interface IndexedChangePoint extends ChangePoint { sourceIndex: number; }
export function detectIndexedChangePoints(
  values: (number | null)[],
  options: { minSegmentLength?: number; threshold?: number; maxChanges?: number } = {},
): IndexedChangePoint[] {
  const finite = values
    .map((value, sourceIndex) => ({ value, sourceIndex }))
    .filter((item): item is { value: number; sourceIndex: number } => item.value != null && Number.isFinite(item.value));
  const points = detectChangePoints(finite.map((item) => item.value), options);
  return points.map((point) => ({ ...point, sourceIndex: finite[point.index]?.sourceIndex ?? point.index }));
}

export interface TextAuditResult {
  total: number;
  observed: number;
  empty: number;
  unique: number;
  duplicateValues: number;
  averageLength: number;
  languages: Record<string, number>;
  topTerms: Array<{ term: string; count: number }>;
  tfidfTopTerms: Array<{ term: string; score: number }>;
  topCooccurrences: Array<{ terms: [string, string]; count: number }>;
  nearDuplicatePairs: number;
}

/** Local, privacy-preserving text profile. It never returns source text. */
export function auditText(values: (string | null)[], topN = 20): TextAuditResult {
  const texts = values.map((value) => String(value ?? '').trim()).filter(Boolean);
  const normalised = texts.map((value) => value.toLocaleLowerCase().normalize('NFKC'));
  const counts = new Map<string, number>();
  const terms = new Map<string, number>();
  const documentFrequency = new Map<string, number>();
  const documentTerms: string[][] = [];
  const cooccurrences = new Map<string, number>();
  for (const value of normalised) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
    const tokens = [...new Set(value.split(/[^\p{L}\p{N}]+/u).filter((token) => token.length >= 3 && token.length <= 80))];
    documentTerms.push(tokens);
    for (const term of tokens) {
      terms.set(term, (terms.get(term) ?? 0) + 1);
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
    for (let i = 0; i < tokens.length; i++) for (let j = i + 1; j < tokens.length; j++) {
      const pair = `${tokens[i]}\u0000${tokens[j]}`;
      cooccurrences.set(pair, (cooccurrences.get(pair) ?? 0) + 1);
    }
  }
  const languages: Record<string, number> = {};
  for (const value of texts) {
    const lower = value.toLocaleLowerCase();
    const language = /[а-яё]/i.test(lower) ? 'cyrillic' : /[ñáéíóúü¿¡]/i.test(lower) ? 'es-like' : /[àâçéèêëîïôûùüÿœ]/i.test(lower) ? 'latin-diacritics' : 'other-latin';
    languages[language] = (languages[language] ?? 0) + 1;
  }
  const documentCount = Math.max(1, documentTerms.length);
  const tfidf = [...terms.keys()].map((term) => {
    const termFrequency = terms.get(term) ?? 0;
    const df = documentFrequency.get(term) ?? 0;
    return { term, score: termFrequency * Math.log((1 + documentCount) / (1 + df)) };
  }).sort((a, b) => b.score - a.score || a.term.localeCompare(b.term));
  let nearDuplicatePairs = 0;
  const boundedDocs = documentTerms.slice(0, 500);
  for (let i = 0; i < boundedDocs.length; i++) for (let j = i + 1; j < boundedDocs.length; j++) {
    const left = new Set(boundedDocs[i]), right = new Set(boundedDocs[j]);
    const intersection = [...left].filter((term) => right.has(term)).length;
    const union = new Set([...left, ...right]).size;
    if (union && intersection / union >= 0.8) nearDuplicatePairs++;
  }
  return {
    total: values.length,
    observed: texts.length,
    empty: values.length - texts.length,
    unique: counts.size,
    duplicateValues: texts.length - counts.size,
    averageLength: texts.length ? texts.reduce((sum, value) => sum + value.length, 0) / texts.length : NaN,
    languages,
    topTerms: [...terms.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, Math.max(1, Math.floor(topN))).map(([term, count]) => ({ term, count })),
    tfidfTopTerms: tfidf.slice(0, Math.max(1, Math.floor(topN))).map(({ term, score }) => ({ term, score })),
    topCooccurrences: [...cooccurrences.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, Math.max(1, Math.floor(topN))).map(([pair, count]) => ({ terms: pair.split('\u0000') as [string, string], count })),
    nearDuplicatePairs,
  };
}

export interface GeoAuditResult {
  observed: number;
  invalid: number;
  centroid: { latitude: number; longitude: number } | null;
  distancesKm: { median: number; max: number; outliers: number } | null;
}

/** Parse common `{latitude,longitude}`, `[lat, lon]`, and `lat,lon` cells. */
export function auditGeo(values: unknown[]): GeoAuditResult {
  const points: Array<{ latitude: number; longitude: number }> = [];
  let invalid = 0;
  for (const raw of values) {
    let candidate: unknown = raw;
    if (typeof raw === 'string') {
      const text = raw.trim();
      try { candidate = JSON.parse(text); } catch {
        const match = text.match(/(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)/);
        candidate = match ? [Number(match[1]), Number(match[2])] : null;
      }
    }
    const point = Array.isArray(candidate)
      ? { latitude: Number(candidate[0]), longitude: Number(candidate[1]) }
      : candidate && typeof candidate === 'object'
        ? { latitude: Number((candidate as Record<string, unknown>).latitude ?? (candidate as Record<string, unknown>).lat), longitude: Number((candidate as Record<string, unknown>).longitude ?? (candidate as Record<string, unknown>).lon ?? (candidate as Record<string, unknown>).lng) }
        : null;
    if (!point || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) || Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180) { if (raw != null && String(raw).trim()) invalid++; continue; }
    points.push(point);
  }
  if (!points.length) return { observed: 0, invalid, centroid: null, distancesKm: null };
  const centroid = { latitude: mean(points.map((point) => point.latitude)), longitude: mean(points.map((point) => point.longitude)) };
  const distance = (point: { latitude: number; longitude: number }) => {
    const r = Math.PI / 180;
    const dLat = (point.latitude - centroid.latitude) * r;
    const dLon = (point.longitude - centroid.longitude) * r;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(centroid.latitude * r) * Math.cos(point.latitude * r) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  };
  const distances = points.map(distance);
  const q1 = quantile(distances, 0.25), q3 = quantile(distances, 0.75), fence = q3 + 1.5 * (q3 - q1);
  return { observed: points.length, invalid, centroid, distancesKm: { median: median(distances), max: Math.max(...distances), outliers: distances.filter((value) => value > fence).length } };
}
