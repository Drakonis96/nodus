// Analysis for a database. Three layers, all keeping the guiding rule that the AI never
// invents figures:
//  1. getDatabaseProfile / generateAnalysisReport — the univariate profile + an AI
//     narrative written over it (unchanged).
//  2. suggestDatabaseAnalyses — the AI *plans*: given the profile + the catalog of
//     analyses the app can compute (shared/analysisCatalog.ts), it returns a ranked list
//     of concrete analyses over real columns. Every suggestion is validated against the
//     schema before it is surfaced.
//  3. runDatabaseAnalysis — the engine *computes*: it loads the rows and produces an
//     AnalysisResult deterministically (shared/stats.ts), returning aggregates only —
//     raw rows never reach the model. narrateAnalysisResult writes optional prose over a
//     computed result.
// All completions are injectable so the logic is unit-tested without a provider.

import { getDatabase, getColumns, queryDatabaseRows } from '../db/databasesRepo';
import { getDb } from '../db/database';
import { computeProfile, profileToText } from '@shared/dataProfile';
import { comparableType } from '@shared/databaseFormula';
import { applicableAnalyses, assignColumns, catalogManifest, kindMeta, validateRequest } from '@shared/analysisCatalog';
import { parseAnalysisSuggestions } from '@shared/analysisSpec';
import {
  boxplot,
  categoryValues,
  categoryValuesMulti,
  chiSquare,
  contingencyTable,
  correlationMatrix,
  covarianceMatrix,
  crosstab,
  dateValues,
  describe,
  finitePairs,
  frequencies,
  groupBy,
  linearRegression,
  numericValues,
  pearson,
  round,
  spearman,
  timeSeries,
} from '@shared/stats';
import type { ColumnProfile, DatabaseProfile, DistributionSlice, HistogramBucket, NumberStats } from '@shared/dataProfile';
import type { AnalysisRequest, AnalysisResult, AnalysisSuggestion, DescriptiveColumn, GroupMetric, ScatterPoint, SeriesLine } from '@shared/analysisSpec';
import type { DatabaseColumn, DatabaseRow, ModelRef } from '@shared/types';

export interface DatabaseProfileResult {
  databaseName: string;
  profile: DatabaseProfile;
}

const profileRound = (value: number, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/** SQL-backed profile: aggregate state is bounded by columns/buckets, not row count. */
function computeDatabaseProfileSql(databaseId: string, columns: DatabaseColumn[]): DatabaseProfile {
  const db = getDb();
  const rowCount = Number((db.prepare('SELECT COUNT(*) AS count FROM db_rows WHERE database_id = ?').get(databaseId) as { count: number }).count);
  const profiles: ColumnProfile[] = [];
  for (const column of columns) {
    const valueType = comparableType(column);
    const table = column.type === 'formula' || column.type === 'rollup' ? 'db_computed_cells' : 'db_cells';
    const base = { columnId: column.id, name: column.name, type: column.type, valueType };
    if (valueType === 'number') {
      const expression = 'COALESCE(value_number, value_integer, CAST(value_text AS REAL))';
      const stats = db.prepare(
        `WITH values_list(value) AS (
           SELECT ${expression} FROM ${table}
           WHERE database_id = ? AND column_id = ?
             AND COALESCE(value_number, value_integer, value_text) IS NOT NULL
         ), aggregate AS (
           SELECT COUNT(*) AS count, MIN(value) AS min, MAX(value) AS max,
                  AVG(value) AS mean, SUM(value) AS sum, AVG(value * value) AS mean_square
           FROM values_list
         ), ranked AS (
           SELECT value, ROW_NUMBER() OVER (ORDER BY value) AS row_number,
                  COUNT(*) OVER () AS total FROM values_list
         )
         SELECT aggregate.*, (SELECT AVG(value) FROM ranked
           WHERE row_number IN ((total + 1) / 2, (total + 2) / 2)) AS median
         FROM aggregate`,
      ).get(databaseId, column.id) as { count: number; min: number | null; max: number | null; mean: number | null; sum: number | null; mean_square: number | null; median: number | null };
      let number: NumberStats | undefined;
      if (stats.count > 0 && stats.min != null && stats.max != null && stats.mean != null && stats.sum != null && stats.median != null) {
        const buckets = Math.min(8, Math.max(1, stats.count));
        let histogram: HistogramBucket[];
        if (stats.min === stats.max) histogram = [{ label: String(profileRound(stats.min)), count: stats.count }];
        else {
          const width = (stats.max - stats.min) / buckets;
          const counts = db.prepare(
            `SELECT MIN(?, CAST((${expression} - ?) / ? AS INTEGER)) AS bucket, COUNT(*) AS count
             FROM ${table}
             WHERE database_id = ? AND column_id = ?
               AND COALESCE(value_number, value_integer, value_text) IS NOT NULL
             GROUP BY bucket ORDER BY bucket`,
          ).all(buckets - 1, stats.min, width, databaseId, column.id) as Array<{ bucket: number; count: number }>;
          const byBucket = new Map(counts.map((entry) => [entry.bucket, entry.count]));
          histogram = Array.from({ length: buckets }, (_, index) => {
            const low = stats.min! + width * index;
            const high = index === buckets - 1 ? stats.max! : stats.min! + width * (index + 1);
            return { label: `${profileRound(low)}–${profileRound(high)}`, count: byBucket.get(index) ?? 0 };
          });
        }
        const variance = Math.max(0, (stats.mean_square ?? 0) - stats.mean * stats.mean);
        number = {
          count: stats.count, min: profileRound(stats.min), max: profileRound(stats.max),
          mean: profileRound(stats.mean), median: profileRound(stats.median), sum: profileRound(stats.sum),
          stdev: profileRound(Math.sqrt(variance)), histogram,
        };
      }
      profiles.push({ ...base, filled: stats.count, fillRate: rowCount ? stats.count / rowCount : 0, number });
      continue;
    }
    if (valueType === 'select' || valueType === 'multi_select') {
      const multi = valueType === 'multi_select';
      const counts = multi
        ? db.prepare(
          `SELECT CAST(item.value AS TEXT) AS id, COUNT(*) AS count
           FROM db_cells cell, json_each(CASE WHEN json_valid(COALESCE(cell.value_json, cell.value_text))
             THEN COALESCE(cell.value_json, cell.value_text) ELSE '[]' END) item
           WHERE cell.database_id = ? AND cell.column_id = ? GROUP BY item.value`,
        ).all(databaseId, column.id) as Array<{ id: string; count: number }>
        : db.prepare(
          `SELECT COALESCE(value_reference, value_text) AS id, COUNT(*) AS count
           FROM db_cells WHERE database_id = ? AND column_id = ?
             AND COALESCE(value_reference, value_text, '') <> '' GROUP BY id`,
        ).all(databaseId, column.id) as Array<{ id: string; count: number }>;
      const byId = new Map(counts.map((entry) => [entry.id, entry.count]));
      const distribution: DistributionSlice[] = column.options.map((option) => ({
        id: option.id, label: option.label, color: option.color, count: byId.get(option.id) ?? 0,
      })).filter((entry) => entry.count > 0).sort((a, b) => b.count - a.count);
      const filled = multi
        ? Number((db.prepare(
          `SELECT COUNT(*) AS count FROM db_cells WHERE database_id = ? AND column_id = ?
           AND json_valid(COALESCE(value_json, value_text)) AND json_array_length(COALESCE(value_json, value_text)) > 0`,
        ).get(databaseId, column.id) as { count: number }).count)
        : counts.reduce((sum, entry) => sum + entry.count, 0);
      profiles.push({ ...base, filled, fillRate: rowCount ? filled / rowCount : 0, distinct: distribution.length, distribution });
      continue;
    }
    if (valueType === 'checkbox') {
      const checked = Number((db.prepare(
        `SELECT COUNT(*) AS count FROM db_cells WHERE database_id = ? AND column_id = ?
         AND COALESCE(value_integer, CAST(value_text AS INTEGER), 0) = 1`,
      ).get(databaseId, column.id) as { count: number }).count);
      profiles.push({ ...base, filled: rowCount, fillRate: 1, checkbox: { checked, unchecked: rowCount - checked } });
      continue;
    }
    if (valueType === 'date' || valueType === 'time') {
      const range = db.prepare(
        `SELECT COUNT(*) AS filled, MIN(COALESCE(value_date, value_text)) AS min,
                MAX(COALESCE(value_date, value_text)) AS max
         FROM ${table} WHERE database_id = ? AND column_id = ?
           AND COALESCE(value_date, value_text, '') <> ''`,
      ).get(databaseId, column.id) as { filled: number; min: string | null; max: string | null };
      profiles.push({ ...base, filled: range.filled, fillRate: rowCount ? range.filled / rowCount : 0,
        dateRange: range.min && range.max ? { min: range.min, max: range.max } : undefined });
      continue;
    }
    if (valueType === 'attachment') {
      const result = db.prepare(
        `SELECT COUNT(DISTINCT row_id) AS filled FROM db_attachments WHERE database_id = ? AND column_id = ?`,
      ).get(databaseId, column.id) as { filled: number };
      profiles.push({ ...base, filled: result.filled, fillRate: rowCount ? result.filled / rowCount : 0 });
      continue;
    }
    if (valueType === 'relation') {
      const result = db.prepare(
        `SELECT COUNT(DISTINCT row_id) AS filled, COUNT(*) AS links
         FROM db_relations WHERE database_id = ? AND column_id = ?`,
      ).get(databaseId, column.id) as { filled: number; links: number };
      profiles.push({ ...base, filled: result.filled, fillRate: rowCount ? result.filled / rowCount : 0, relationLinks: result.links });
      continue;
    }
    const result = db.prepare(
      `SELECT COUNT(*) AS filled, COUNT(DISTINCT value_text) AS distinct_count
       FROM ${table} WHERE database_id = ? AND column_id = ? AND TRIM(COALESCE(value_text, '')) <> ''`,
    ).get(databaseId, column.id) as { filled: number; distinct_count: number };
    profiles.push({ ...base, filled: result.filled, fillRate: rowCount ? result.filled / rowCount : 0, distinct: result.distinct_count });
  }
  return { rowCount, columns: profiles };
}

/** The deterministic profile for a database (fill rates, numeric summaries, distributions). */
export function getDatabaseProfile(databaseId: string): DatabaseProfileResult | null {
  const database = getDatabase(databaseId);
  if (!database) return null;
  const columns = getColumns(databaseId);
  if (columns.some((column) => column.type === 'formula' || column.type === 'rollup')) {
    queryDatabaseRows({ databaseId, limit: 1 });
  }
  return { databaseName: database.name, profile: computeDatabaseProfileSql(databaseId, columns) };
}

const ANALYSIS_SYSTEM = `Eres un analista de datos. Recibes el PERFIL ESTADÍSTICO de una base de datos (ya calculado: recuentos, medias, distribuciones). Escribe un informe breve y claro en Markdown que: (1) resuma el tamaño y la completitud de los datos, (2) destaque los patrones y valores atípicos que se deduzcan de las cifras, (3) señale posibles problemas de calidad (columnas poco rellenas, valores dominantes). Usa ÚNICAMENTE las cifras del perfil; no inventes datos ni cifras que no aparezcan. Sé conciso.`;

export interface AnalysisDeps {
  complete?: (opts: { system: string; user: string; plainContext?: boolean; temperature?: number; maxTokens?: number }, model?: ModelRef | null) => Promise<string>;
  model?: ModelRef | null;
}

export interface AnalysisReport {
  databaseName: string;
  profileText: string;
  report: string;
}

async function defaultComplete(opts: { system: string; user: string; plainContext?: boolean; temperature?: number; maxTokens?: number }, m?: ModelRef | null): Promise<string> {
  const { completeText } = await import('./aiClient');
  const { getSettings } = await import('../db/settingsRepo');
  const s = getSettings();
  return completeText(opts, m ?? s.chatModel ?? s.synthesisModel ?? null);
}

/** Generate the AI narrative report for a database over its statistical profile. */
export async function generateAnalysisReport(databaseId: string, deps: AnalysisDeps = {}): Promise<AnalysisReport> {
  const result = getDatabaseProfile(databaseId);
  if (!result) throw new Error('Base de datos no encontrada.');
  const profileText = profileToText(result.databaseName, result.profile);
  const complete = deps.complete ?? defaultComplete;
  const report = await complete(
    { system: ANALYSIS_SYSTEM, user: `=== PERFIL DE DATOS ===\n${profileText}\n\nEscribe el informe.`, plainContext: true, temperature: 0.3, maxTokens: 1200 },
    deps.model ?? null
  );
  return { databaseName: result.databaseName, profileText, report: report.trim() };
}

// ── suggest (AI plans) ────────────────────────────────────────────────────────

const SUGGEST_SYSTEM = `Eres un analista de datos experto. Recibes el PERFIL de una base de datos y el CATÁLOGO de análisis que la aplicación puede calcular (con los ids de columna válidos por rol). Tu tarea es PROPONER los análisis más reveladores, NO calcularlos.

Devuelve ÚNICAMENTE un array JSON (sin texto adicional, sin markdown) con entre 4 y 7 objetos, ordenados del más al menos interesante, con esta forma exacta:
[{"kind":"<uno del catálogo>","columns":["<id>","<id>"],"title":"<título corto y humano>","rationale":"<por qué es interesante, 1 frase>"}]

Reglas estrictas:
- Usa SOLO los ids de columna que aparecen en el catálogo, y respeta el rol de cada hueco (numeric/category/lowCard/date). En el catálogo, un rol con "+" admite VARIAS columnas y con "?" es opcional.
- Aprovecha la multi-selección cuando aporte: "descriptive" y "group_compare" y "time_series" pueden llevar varias numéricas; "correlation_matrix"/"covariance_matrix" con "columns":[] usan todas, o un subconjunto de ≥2.
- "chi_square"/"crosstab": dos categóricas distintas; "crosstab" admite una 3ª numérica opcional para agregar (media/suma).
- "data_quality" lleva "columns": [].
- Prioriza relaciones entre columnas (correlaciones, chi-cuadrado, tablas cruzadas, comparación de grupos) sobre resúmenes de una sola columna.
- No repitas el mismo análisis con las mismas columnas.
- title y rationale en el idioma del perfil (español).`;

export interface SuggestionResult {
  databaseName: string;
  suggestions: AnalysisSuggestion[];
}

/** Ask the AI to plan the most insightful analyses; validate each against the schema. */
export async function suggestDatabaseAnalyses(databaseId: string, deps: AnalysisDeps = {}): Promise<SuggestionResult> {
  const result = getDatabaseProfile(databaseId);
  if (!result) throw new Error('Base de datos no encontrada.');
  const profile = result.profile;
  const manifest = catalogManifest(profile);
  const profileText = profileToText(result.databaseName, profile);
  const complete = deps.complete ?? defaultComplete;

  const reply = await complete(
    { system: SUGGEST_SYSTEM, user: `=== PERFIL DE DATOS ===\n${profileText}\n\n${manifest}\n\nDevuelve el array JSON de análisis sugeridos.`, plainContext: true, temperature: 0.4, maxTokens: 900 },
    deps.model ?? null
  );

  const parsed = parseAnalysisSuggestions(reply);
  const suggestions: AnalysisSuggestion[] = [];
  const seen = new Set<string>();
  for (const s of parsed) {
    const v = validateRequest({ kind: s.kind, columns: s.columns, options: s.options }, profile);
    if (!v.ok || !v.normalized) continue;
    const key = `${v.normalized.kind}:${v.normalized.columns.join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    suggestions.push({ ...v.normalized, title: s.title, rationale: s.rationale });
  }

  // Fallback: if the model produced nothing usable, seed with deterministic defaults.
  if (suggestions.length === 0) {
    for (const req of applicableAnalyses(profile)) {
      const v = validateRequest(req, profile);
      if (v.ok && v.normalized) suggestions.push({ ...v.normalized, title: kindMeta(req.kind).label, rationale: '' });
    }
  }
  return { databaseName: result.databaseName, suggestions };
}

// ── run (engine computes) ──────────────────────────────────────────────────────

const MAX_SCATTER_POINTS = 600;

/**
 * Thin a scatter down to a drawable number of dots by walking the whole set at an even
 * stride, rather than taking the first N. The statistics always run on every pair — this only
 * decides which dots get drawn — but taking a prefix samples whatever the rows happen to be
 * ordered by (in a photo catalogue, the earliest folders), so the cloud would misrepresent a
 * range the caption still reports in full. An even stride keeps the picture honest.
 */
function scatterSample(pairs: [number, number][]): [number, number][] {
  if (pairs.length <= MAX_SCATTER_POINTS) return pairs;
  const stride = pairs.length / MAX_SCATTER_POINTS;
  const out: [number, number][] = [];
  for (let i = 0; i < MAX_SCATTER_POINTS; i++) out.push(pairs[Math.floor(i * stride)]);
  return out;
}

function histogram(values: number[], buckets = 10): { label: string; count: number }[] {
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return [{ label: String(round(min, 2)), count: values.length }];
  const k = Math.min(buckets, Math.max(1, values.length));
  const width = (max - min) / k;
  const counts = new Array(k).fill(0);
  for (const v of values) {
    let idx = Math.floor((v - min) / width);
    if (idx >= k) idx = k - 1;
    counts[idx]++;
  }
  return counts.map((count, i) => {
    const lo = min + width * i;
    const hi = i === k - 1 ? max : min + width * (i + 1);
    return { label: `${round(lo, 2)}–${round(hi, 2)}`, count };
  });
}

function nonNull(values: (number | null)[]): number[] {
  return values.filter((v): v is number => v != null && Number.isFinite(v));
}

/** Compute one analysis from the columns + rows. Pure (no DB access) → unit-testable. */
export function computeAnalysis(columns: DatabaseColumn[], rows: DatabaseRow[], request: AnalysisRequest): AnalysisResult {
  const byId = new Map(columns.map((c) => [c.id, c]));
  const col = (id: string): DatabaseColumn => {
    const c = byId.get(id);
    if (!c) throw new Error(`Columna inexistente: ${id}`);
    return c;
  };

  const groups = assignColumns(request.kind, request.columns).assigned;
  /** Numeric columns to use for a matrix: the explicit subset, or all numeric when empty. */
  const matrixSeries = (ids: string[]) => {
    const cols = ids.length ? ids.map(col) : columns.filter((c) => c.type === 'number' || c.type === 'relation');
    return cols.map((c) => ({ key: c.id, label: c.name, values: numericValues(c, rows) }));
  };

  switch (request.kind) {
    case 'descriptive': {
      const out: DescriptiveColumn[] = [];
      for (const id of groups[0]) {
        const c = col(id);
        const values = nonNull(numericValues(c, rows));
        if (!values.length) continue;
        out.push({ column: c.id, columnName: c.name, stats: describe(values), boxplot: boxplot(values), histogram: histogram(values) });
      }
      if (!out.length) throw new Error('Ninguna columna elegida tiene valores numéricos.');
      return { kind: 'descriptive', columns: out };
    }
    case 'correlation': {
      const cx = col(request.columns[0]);
      const cy = col(request.columns[1]);
      const pairs = finitePairs(numericValues(cx, rows), numericValues(cy, rows));
      const points: ScatterPoint[] = scatterSample(pairs).map(([x, y]) => ({ x: round(x, 4), y: round(y, 4) }));
      return { kind: 'correlation', xColumn: cx.id, yColumn: cy.id, xName: cx.name, yName: cy.name, pearson: pearson(pairs), spearman: spearman(pairs), regression: linearRegression(pairs), points };
    }
    case 'correlation_matrix':
      return { kind: 'correlation_matrix', matrix: correlationMatrix(matrixSeries(groups[0])) };
    case 'covariance_matrix':
      return { kind: 'covariance_matrix', matrix: covarianceMatrix(matrixSeries(groups[0])) };
    case 'chi_square': {
      const cr = col(request.columns[0]);
      const cc = col(request.columns[1]);
      const table = contingencyTable(categoryValues(cr, rows), categoryValues(cc, rows));
      return { kind: 'chi_square', rowColumn: cr.id, colColumn: cc.id, rowName: cr.name, colName: cc.name, result: chiSquare(table) };
    }
    case 'crosstab': {
      const cr = col(groups[0][0]);
      const cc = col(groups[1][0]);
      const cv = groups[2][0] ? col(groups[2][0]) : null;
      const aggregate = request.options?.aggregate ?? (cv ? 'mean' : 'count');
      const ct = crosstab(categoryValues(cr, rows), categoryValues(cc, rows), cv ? numericValues(cv, rows) : null, aggregate);
      return { kind: 'crosstab', rowColumn: cr.id, colColumn: cc.id, valueColumn: cv?.id ?? null, rowName: cr.name, colName: cc.name, valueName: cv?.name ?? null, aggregate, rowLabels: ct.rowLabels, colLabels: ct.colLabels, values: ct.values, rowTotals: ct.rowTotals, colTotals: ct.colTotals, total: ct.total };
    }
    case 'group_compare': {
      const cg = col(groups[0][0]);
      const cats = categoryValues(cg, rows);
      const metrics: GroupMetric[] = [];
      for (const id of groups[1]) {
        const cv = col(id);
        const vals = numericValues(cv, rows);
        const result = groupBy(cats, vals);
        const byLabel = new Map<string, number[]>();
        for (let i = 0; i < rows.length; i++) {
          const label = cats[i];
          const v = vals[i];
          if (label == null || v == null || !Number.isFinite(v)) continue;
          if (!byLabel.has(label)) byLabel.set(label, []);
          byLabel.get(label)!.push(v);
        }
        const boxplots = result.groups.map((g) => ({ label: g.label, box: boxplot(byLabel.get(g.label) ?? []) }));
        metrics.push({ valueColumn: cv.id, valueName: cv.name, result, boxplots });
      }
      return { kind: 'group_compare', groupColumn: cg.id, groupName: cg.name, metrics };
    }
    case 'top_values': {
      const c = col(request.columns[0]);
      const freq = frequencies(categoryValuesMulti(c, rows), request.options?.topN ?? 15);
      return { kind: 'top_values', column: c.id, columnName: c.name, items: freq.items, distinct: freq.distinct, total: freq.total };
    }
    case 'time_series': {
      const cd = col(groups[0][0]);
      const bucket = request.options?.bucket ?? 'month';
      const valueIds = groups[1];
      const metric = request.options?.metric ?? (valueIds.length ? 'mean' : 'count');
      const dates = dateValues(cd, rows);
      const pick = (p: { count: number; sum: number; mean: number }) => (metric === 'count' ? p.count : metric === 'sum' ? p.sum : p.mean);
      let series: SeriesLine[];
      if (!valueIds.length) {
        series = [{ label: cd.name, points: timeSeries(dates, null, bucket).map((p) => ({ bucket: p.bucket, value: p.count })) }];
      } else {
        series = valueIds.map((id) => {
          const cv = col(id);
          return { label: cv.name, points: timeSeries(dates, numericValues(cv, rows), bucket).map((p) => ({ bucket: p.bucket, value: pick(p) })) };
        });
      }
      return { kind: 'time_series', dateColumn: cd.id, dateName: cd.name, metric, bucket, series };
    }
    case 'data_quality': {
      const profileById = new Map(computeProfile(columns, rows).columns.map((c) => [c.columnId, c]));
      const cols = columns.map((c) => {
        const p = profileById.get(c.id);
        const fillRate = p?.fillRate ?? 0;
        const distinct = p?.distinct ?? p?.distribution?.length ?? null;
        const issues: string[] = [];
        if (fillRate === 0) issues.push('Columna vacía');
        else if (fillRate < 0.5) issues.push('Muy incompleta');
        if (distinct != null && rows.length > 1) {
          if (distinct === 1) issues.push('Valor constante');
          else if (distinct === rows.length && (c.type === 'text' || c.type === 'title')) issues.push('Casi único (¿identificador?)');
        }
        return { column: c.id, name: c.name, type: c.type, filled: p?.filled ?? 0, fillRate, distinct, issues };
      });
      return { kind: 'data_quality', rowCount: rows.length, columns: cols };
    }
    default: {
      const _exhaustive: never = request.kind;
      throw new Error(`Análisis no soportado: ${_exhaustive}`);
    }
  }
}

export interface RunAnalysisResult {
  databaseName: string;
  request: AnalysisRequest;
  result: AnalysisResult;
}

interface AnalysisVectors {
  rowCount: number;
  numeric: Map<string, (number | null)[]>;
  category: Map<string, (string | null)[]>;
  multi: Map<string, (string | null)[]>;
  date: Map<string, (string | null)[]>;
}

/**
 * Scan the database in bounded pages and retain only the primitive vectors used by the
 * selected analysis. The hydrated 500-row page is discarded before requesting the next
 * one, so analyses never turn the complete table into DatabaseRow objects.
 */
function loadAnalysisVectors(databaseId: string, columns: DatabaseColumn[], request: AnalysisRequest): AnalysisVectors {
  const byId = new Map(columns.map((column) => [column.id, column]));
  const groups = assignColumns(request.kind, request.columns).assigned;
  const numericIds = new Set<string>();
  const categoryIds = new Set<string>();
  const multiIds = new Set<string>();
  const dateIds = new Set<string>();
  switch (request.kind) {
    case 'descriptive':
      groups[0].forEach((id) => numericIds.add(id));
      break;
    case 'correlation':
      request.columns.forEach((id) => numericIds.add(id));
      break;
    case 'correlation_matrix':
    case 'covariance_matrix':
      (groups[0].length ? groups[0] : columns.filter((column) => column.type === 'number' || column.type === 'relation').map((column) => column.id))
        .forEach((id) => numericIds.add(id));
      break;
    case 'chi_square':
      request.columns.forEach((id) => categoryIds.add(id));
      break;
    case 'crosstab':
      groups[0].forEach((id) => categoryIds.add(id));
      groups[1].forEach((id) => categoryIds.add(id));
      groups[2].forEach((id) => numericIds.add(id));
      break;
    case 'group_compare':
      groups[0].forEach((id) => categoryIds.add(id));
      groups[1].forEach((id) => numericIds.add(id));
      break;
    case 'top_values':
      request.columns.forEach((id) => multiIds.add(id));
      break;
    case 'time_series':
      groups[0].forEach((id) => dateIds.add(id));
      groups[1].forEach((id) => numericIds.add(id));
      break;
    case 'data_quality':
      break;
  }
  const result: AnalysisVectors = {
    rowCount: 0,
    numeric: new Map([...numericIds].map((id) => [id, []])),
    category: new Map([...categoryIds].map((id) => [id, []])),
    multi: new Map([...multiIds].map((id) => [id, []])),
    date: new Map([...dateIds].map((id) => [id, []])),
  };
  let cursor: string | null = null;
  do {
    const page = queryDatabaseRows({ databaseId, cursor, limit: 500 });
    result.rowCount += page.rows.length;
    for (const id of numericIds) result.numeric.get(id)!.push(...numericValues(byId.get(id)!, page.rows));
    for (const id of categoryIds) result.category.get(id)!.push(...categoryValues(byId.get(id)!, page.rows));
    for (const id of multiIds) result.multi.get(id)!.push(...categoryValuesMulti(byId.get(id)!, page.rows));
    for (const id of dateIds) result.date.get(id)!.push(...dateValues(byId.get(id)!, page.rows));
    cursor = page.nextCursor;
  } while (cursor);
  return result;
}

function computeAnalysisFromVectors(
  columns: DatabaseColumn[],
  vectors: AnalysisVectors,
  profile: DatabaseProfile,
  request: AnalysisRequest,
): AnalysisResult {
  const byId = new Map(columns.map((column) => [column.id, column]));
  const col = (id: string): DatabaseColumn => {
    const column = byId.get(id);
    if (!column) throw new Error(`Columna inexistente: ${id}`);
    return column;
  };
  const numbers = (id: string) => vectors.numeric.get(id) ?? [];
  const categories = (id: string) => vectors.category.get(id) ?? [];
  const groups = assignColumns(request.kind, request.columns).assigned;
  const matrixSeries = (ids: string[]) => {
    const selected = ids.length ? ids.map(col) : columns.filter((column) => column.type === 'number' || column.type === 'relation');
    return selected.map((column) => ({ key: column.id, label: column.name, values: numbers(column.id) }));
  };

  switch (request.kind) {
    case 'descriptive': {
      const out: DescriptiveColumn[] = [];
      for (const id of groups[0]) {
        const column = col(id);
        const values = nonNull(numbers(id));
        if (values.length) out.push({ column: id, columnName: column.name, stats: describe(values), boxplot: boxplot(values), histogram: histogram(values) });
      }
      if (!out.length) throw new Error('Ninguna columna elegida tiene valores numéricos.');
      return { kind: 'descriptive', columns: out };
    }
    case 'correlation': {
      const x = col(request.columns[0]);
      const y = col(request.columns[1]);
      const pairs = finitePairs(numbers(x.id), numbers(y.id));
      const points: ScatterPoint[] = scatterSample(pairs).map(([px, py]) => ({ x: round(px, 4), y: round(py, 4) }));
      return { kind: 'correlation', xColumn: x.id, yColumn: y.id, xName: x.name, yName: y.name, pearson: pearson(pairs), spearman: spearman(pairs), regression: linearRegression(pairs), points };
    }
    case 'correlation_matrix':
      return { kind: 'correlation_matrix', matrix: correlationMatrix(matrixSeries(groups[0])) };
    case 'covariance_matrix':
      return { kind: 'covariance_matrix', matrix: covarianceMatrix(matrixSeries(groups[0])) };
    case 'chi_square': {
      const row = col(request.columns[0]);
      const column = col(request.columns[1]);
      const table = contingencyTable(categories(row.id), categories(column.id));
      return { kind: 'chi_square', rowColumn: row.id, colColumn: column.id, rowName: row.name, colName: column.name, result: chiSquare(table) };
    }
    case 'crosstab': {
      const row = col(groups[0][0]);
      const column = col(groups[1][0]);
      const value = groups[2][0] ? col(groups[2][0]) : null;
      const aggregate = request.options?.aggregate ?? (value ? 'mean' : 'count');
      const table = crosstab(categories(row.id), categories(column.id), value ? numbers(value.id) : null, aggregate);
      return { kind: 'crosstab', rowColumn: row.id, colColumn: column.id, valueColumn: value?.id ?? null, rowName: row.name, colName: column.name, valueName: value?.name ?? null, aggregate, rowLabels: table.rowLabels, colLabels: table.colLabels, values: table.values, rowTotals: table.rowTotals, colTotals: table.colTotals, total: table.total };
    }
    case 'group_compare': {
      const groupColumn = col(groups[0][0]);
      const labels = categories(groupColumn.id);
      const metrics: GroupMetric[] = groups[1].map((id) => {
        const valueColumn = col(id);
        const values = numbers(id);
        const result = groupBy(labels, values);
        const byLabel = new Map<string, number[]>();
        for (let index = 0; index < labels.length; index += 1) {
          const label = labels[index];
          const value = values[index];
          if (label == null || value == null || !Number.isFinite(value)) continue;
          const items = byLabel.get(label) ?? [];
          items.push(value);
          byLabel.set(label, items);
        }
        return { valueColumn: id, valueName: valueColumn.name, result, boxplots: result.groups.map((group) => ({ label: group.label, box: boxplot(byLabel.get(group.label) ?? []) })) };
      });
      return { kind: 'group_compare', groupColumn: groupColumn.id, groupName: groupColumn.name, metrics };
    }
    case 'top_values': {
      const column = col(request.columns[0]);
      const freq = frequencies(vectors.multi.get(column.id) ?? [], request.options?.topN ?? 15);
      return { kind: 'top_values', column: column.id, columnName: column.name, items: freq.items, distinct: freq.distinct, total: freq.total };
    }
    case 'time_series': {
      const dateColumn = col(groups[0][0]);
      const dates = vectors.date.get(dateColumn.id) ?? [];
      const bucket = request.options?.bucket ?? 'month';
      const valueIds = groups[1];
      const metric = request.options?.metric ?? (valueIds.length ? 'mean' : 'count');
      const pick = (point: { count: number; sum: number; mean: number }) => metric === 'count' ? point.count : metric === 'sum' ? point.sum : point.mean;
      const series: SeriesLine[] = valueIds.length
        ? valueIds.map((id) => ({ label: col(id).name, points: timeSeries(dates, numbers(id), bucket).map((point) => ({ bucket: point.bucket, value: pick(point) })) }))
        : [{ label: dateColumn.name, points: timeSeries(dates, null, bucket).map((point) => ({ bucket: point.bucket, value: point.count })) }];
      return { kind: 'time_series', dateColumn: dateColumn.id, dateName: dateColumn.name, metric, bucket, series };
    }
    case 'data_quality': {
      const profileById = new Map(profile.columns.map((column) => [column.columnId, column]));
      return { kind: 'data_quality', rowCount: profile.rowCount, columns: columns.map((column) => {
        const columnProfile = profileById.get(column.id);
        const fillRate = columnProfile?.fillRate ?? 0;
        const distinct = columnProfile?.distinct ?? columnProfile?.distribution?.length ?? null;
        const issues: string[] = [];
        if (fillRate === 0) issues.push('Columna vacía');
        else if (fillRate < 0.5) issues.push('Muy incompleta');
        if (distinct != null && profile.rowCount > 1) {
          if (distinct === 1) issues.push('Valor constante');
          else if (distinct === profile.rowCount && (column.type === 'text' || column.type === 'title')) issues.push('Casi único (¿identificador?)');
        }
        return { column: column.id, name: column.name, type: column.type, filled: columnProfile?.filled ?? 0, fillRate, distinct, issues };
      }) };
    }
  }
}

/** Validate with SQL aggregates, scan bounded pages and compute from primitive vectors. */
export function runDatabaseAnalysis(databaseId: string, request: AnalysisRequest): RunAnalysisResult {
  const database = getDatabase(databaseId);
  if (!database) throw new Error('Base de datos no encontrada.');
  const columns = getColumns(databaseId);
  const profile = computeDatabaseProfileSql(databaseId, columns);
  const v = validateRequest(request, profile);
  if (!v.ok || !v.normalized) throw new Error(v.error ?? 'Solicitud de análisis no válida.');
  const vectors = loadAnalysisVectors(databaseId, columns, v.normalized);
  return { databaseName: database.name, request: v.normalized, result: computeAnalysisFromVectors(columns, vectors, profile, v.normalized) };
}

// ── narrate (AI prose over a computed result) ─────────────────────────────────

const NARRATE_SYSTEM = `Eres un analista de datos. Recibes el RESULTADO ya calculado de un análisis estadístico. Explícalo en 2-4 frases claras en Markdown: qué mide, qué muestran las cifras (correlación, significación, diferencias entre grupos, atípicos…) y una lectura prudente. Usa ÚNICAMENTE las cifras dadas; recuerda que correlación no implica causalidad y que los p-valores son aproximados. Sé conciso.`;

/** Compact textual summary of a computed result for the narration prompt. */
export function resultToText(r: AnalysisResult): string {
  switch (r.kind) {
    case 'descriptive':
      return r.columns
        .map((c) => `Descriptiva de "${c.columnName}": n=${c.stats.n}, media=${c.stats.mean}, mediana=${c.stats.median}, varianza=${c.stats.variance}, desv=${c.stats.stdev}, CV=${c.stats.cv}, Q1=${c.stats.q1}, Q3=${c.stats.q3}, asimetría=${c.stats.skewness}, curtosis=${c.stats.kurtosis}, atípicos=${c.stats.outliers.length}.`)
        .join('\n');
    case 'correlation':
      return `Correlación "${r.xName}" vs "${r.yName}": Pearson r=${r.pearson.r} (n=${r.pearson.n}, p=${r.pearson.p}), Spearman=${r.spearman.r}, regresión pendiente=${r.regression.slope}, R²=${r.regression.r2}.`;
    case 'correlation_matrix':
    case 'covariance_matrix': {
      const pairs: string[] = [];
      for (let i = 0; i < r.matrix.labels.length; i++)
        for (let j = i + 1; j < r.matrix.labels.length; j++) pairs.push(`${r.matrix.labels[i]}~${r.matrix.labels[j]}=${r.matrix.matrix[i][j]}`);
      const noun = r.kind === 'covariance_matrix' ? 'covarianza' : 'correlación';
      return `Matriz de ${noun} (${r.matrix.labels.length} numéricas): ${pairs.join(', ')}.`;
    }
    case 'chi_square':
      return `Chi-cuadrado "${r.rowName}" x "${r.colName}": χ²=${r.result.chi2}, gl=${r.result.dof}, V de Cramér=${r.result.cramersV}, p=${r.result.p}, n=${r.result.table.total}.`;
    case 'crosstab': {
      const rowsTxt = r.rowLabels.map((rl, i) => `${rl}: [${r.colLabels.map((cl, j) => `${cl}=${r.values[i][j]}`).join(', ')}]`).join('; ');
      return `Tabla cruzada "${r.rowName}" x "${r.colName}" (${r.aggregate}${r.valueName ? ` de ${r.valueName}` : ''}): ${rowsTxt}. Total=${r.total}.`;
    }
    case 'group_compare':
      return r.metrics
        .map((m) => {
          const g = m.result.groups.map((x) => `${x.label}: media=${x.mean} (n=${x.count})`).join('; ');
          const a = m.result.anova ? ` ANOVA F=${m.result.anova.f}, p=${m.result.anova.p}, η²=${m.result.anova.etaSquared}.` : '';
          return `Comparación de "${m.valueName}" por "${r.groupName}": ${g}.${a}`;
        })
        .join('\n');
    case 'top_values':
      return `Valores más frecuentes de "${r.columnName}" (${r.distinct} distintos, ${r.total} total): ${r.items.map((i) => `${i.label} (${i.count})`).join(', ')}.`;
    case 'time_series':
      return `Serie temporal de "${r.dateName}" (${r.metric}, por ${r.bucket}): ${r.series.map((s) => `${s.label}: ${s.points.map((p) => `${p.bucket}=${p.value}`).join(', ')}`).join(' | ')}.`;
    case 'data_quality': {
      const flagged = r.columns.filter((c) => c.issues.length);
      return `Calidad de datos (${r.rowCount} filas, ${r.columns.length} columnas): ${flagged.length ? flagged.map((c) => `${c.name} (relleno ${Math.round(c.fillRate * 100)}%: ${c.issues.join(', ')})`).join('; ') : 'sin problemas detectados; todas las columnas suficientemente completas'}.`;
    }
  }
}

/** Write a short prose reading of an already-computed analysis result. */
export async function narrateAnalysisResult(result: AnalysisResult, deps: AnalysisDeps = {}): Promise<string> {
  const complete = deps.complete ?? defaultComplete;
  const text = await complete(
    { system: NARRATE_SYSTEM, user: `=== RESULTADO ===\n${resultToText(result)}\n\nExplícalo.`, plainContext: true, temperature: 0.3, maxTokens: 400 },
    deps.model ?? null
  );
  return text.trim();
}
