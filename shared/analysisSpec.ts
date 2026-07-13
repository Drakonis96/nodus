/**
 * The contract between the AI planner and the deterministic engine. The AI returns a
 * ranked list of AnalysisSuggestion (which analysis, over which real columns, and why);
 * the engine turns each into an AnalysisResult computed from the rows (shared/stats.ts).
 *
 * Pure so parsing/validation of the model output is unit-tested — same pattern as
 * shared/chartSpec.ts. `parseAnalysisSuggestions` only checks *shape*; whether the
 * chosen columns are valid for the kind is enforced against the real schema in
 * shared/analysisCatalog.ts (validateRequest).
 */

import type {
  Aggregate,
  BoxplotStats,
  ChiSquareResult,
  CorrelationMatrix,
  CorrelationResult,
  Descriptive,
  FrequencyItem,
  GroupByResult,
  RegressionResult,
  DateBucket,
} from './stats';

export const ANALYSIS_KINDS = [
  'descriptive',
  'correlation',
  'correlation_matrix',
  'covariance_matrix',
  'chi_square',
  'crosstab',
  'group_compare',
  'top_values',
  'time_series',
  'data_quality',
] as const;

export type AnalysisKind = (typeof ANALYSIS_KINDS)[number];

export function isAnalysisKind(v: unknown): v is AnalysisKind {
  return typeof v === 'string' && (ANALYSIS_KINDS as readonly string[]).includes(v);
}

export interface AnalysisOptions {
  bucket?: DateBucket;
  metric?: 'count' | 'mean' | 'sum';
  aggregate?: Aggregate;
  topN?: number;
}

/** A request to run one analysis. `columns` are column ids in a kind-specific order. */
export interface AnalysisRequest {
  kind: AnalysisKind;
  columns: string[];
  options?: AnalysisOptions;
}

/** A request plus the AI's rationale/title, as surfaced in the suggestions list. */
export interface AnalysisSuggestion extends AnalysisRequest {
  title: string;
  rationale: string;
}

export function isAnalysisRequest(v: unknown): v is AnalysisRequest {
  if (!v || typeof v !== 'object') return false;
  const r = v as AnalysisRequest;
  return isAnalysisKind(r.kind) && Array.isArray(r.columns) && r.columns.every((c) => typeof c === 'string');
}

// ── results (discriminated by `kind`) ────────────────────────────────────────

export interface ScatterPoint {
  x: number;
  y: number;
  /** Optional category label for colour-coding. */
  group?: string;
}

export interface DescriptiveColumn {
  column: string;
  columnName: string;
  stats: Descriptive;
  boxplot: BoxplotStats;
  histogram: { label: string; count: number }[];
}

export interface DescriptiveResult {
  kind: 'descriptive';
  /** One entry per selected numeric column (comparison table + box plots). */
  columns: DescriptiveColumn[];
}

export interface CorrelationResultOut {
  kind: 'correlation';
  xColumn: string;
  yColumn: string;
  xName: string;
  yName: string;
  pearson: CorrelationResult;
  spearman: CorrelationResult;
  regression: RegressionResult;
  points: ScatterPoint[];
}

export interface CorrelationMatrixResult {
  kind: 'correlation_matrix';
  matrix: CorrelationMatrix;
}

export interface CovarianceMatrixResult {
  kind: 'covariance_matrix';
  /** Reuses the CorrelationMatrix shape; values are covariances (diagonal = variance). */
  matrix: CorrelationMatrix;
}

export interface ChiSquareResultOut {
  kind: 'chi_square';
  rowColumn: string;
  colColumn: string;
  rowName: string;
  colName: string;
  result: ChiSquareResult;
}

export interface CrosstabResult {
  kind: 'crosstab';
  rowColumn: string;
  colColumn: string;
  valueColumn: string | null;
  rowName: string;
  colName: string;
  valueName: string | null;
  aggregate: Aggregate;
  rowLabels: string[];
  colLabels: string[];
  values: number[][];
  rowTotals: number[];
  colTotals: number[];
  total: number;
}

export interface GroupMetric {
  valueColumn: string;
  valueName: string;
  result: GroupByResult;
  /** Box-plot per group, aligned with result.groups by label. */
  boxplots: { label: string; box: BoxplotStats }[];
}

export interface GroupCompareResult {
  kind: 'group_compare';
  groupColumn: string;
  groupName: string;
  /** One metric block per selected numeric value column. */
  metrics: GroupMetric[];
}

export interface TopValuesResult {
  kind: 'top_values';
  column: string;
  columnName: string;
  items: FrequencyItem[];
  distinct: number;
  total: number;
}

export interface SeriesLine {
  label: string;
  points: { bucket: string; value: number }[];
}

export interface TimeSeriesResult {
  kind: 'time_series';
  dateColumn: string;
  dateName: string;
  metric: 'count' | 'mean' | 'sum';
  bucket: DateBucket;
  /** One line per selected numeric column, or a single count line when none. */
  series: SeriesLine[];
}

export interface DataQualityColumn {
  column: string;
  name: string;
  type: string;
  filled: number;
  fillRate: number;
  distinct: number | null;
  issues: string[];
}

export interface DataQualityResult {
  kind: 'data_quality';
  rowCount: number;
  columns: DataQualityColumn[];
}

export type AnalysisResult =
  | DescriptiveResult
  | CorrelationResultOut
  | CorrelationMatrixResult
  | CovarianceMatrixResult
  | ChiSquareResultOut
  | CrosstabResult
  | GroupCompareResult
  | TopValuesResult
  | TimeSeriesResult
  | DataQualityResult;

// ── parse the model's suggestions ────────────────────────────────────────────

/** Best-effort extraction of the first JSON array in the model's reply. */
function extractJsonArray(text: string): unknown {
  const fenced = /```(?:json)?\s*\n?([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Parse the AI reply into shape-valid suggestions. Invalid entries are dropped; column
 * validity for the kind is checked later (validateRequest). Returns [] on total failure.
 */
export function parseAnalysisSuggestions(text: string): AnalysisSuggestion[] {
  const parsed = extractJsonArray(text);
  if (!Array.isArray(parsed)) return [];
  const out: AnalysisSuggestion[] = [];
  for (const item of parsed) {
    if (!isAnalysisRequest(item)) continue;
    const s = item as Partial<AnalysisSuggestion> & AnalysisRequest;
    out.push({
      kind: s.kind,
      columns: s.columns,
      options: s.options && typeof s.options === 'object' ? s.options : undefined,
      title: typeof s.title === 'string' && s.title.trim() ? s.title.trim() : defaultTitle(s.kind),
      rationale: typeof s.rationale === 'string' ? s.rationale.trim() : '',
    });
  }
  return out;
}

function defaultTitle(kind: AnalysisKind): string {
  return kind;
}
