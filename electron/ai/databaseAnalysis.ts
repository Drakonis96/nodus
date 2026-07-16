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

import { getDatabase, getColumns, listRows } from '../db/databasesRepo';
import { computeProfile, profileToText } from '@shared/dataProfile';
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
import type { DatabaseProfile } from '@shared/dataProfile';
import type { AnalysisRequest, AnalysisResult, AnalysisSuggestion, DescriptiveColumn, GroupMetric, ScatterPoint, SeriesLine } from '@shared/analysisSpec';
import type { DatabaseColumn, DatabaseRow, ModelRef } from '@shared/types';

export interface DatabaseProfileResult {
  databaseName: string;
  profile: DatabaseProfile;
}

/** The deterministic profile for a database (fill rates, numeric summaries, distributions). */
export function getDatabaseProfile(databaseId: string): DatabaseProfileResult | null {
  const database = getDatabase(databaseId);
  if (!database) return null;
  const columns = getColumns(databaseId);
  const rows = listRows(databaseId);
  return { databaseName: database.name, profile: computeProfile(columns, rows) };
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

/** Load the rows and compute the requested analysis. Validates the request first. */
export function runDatabaseAnalysis(databaseId: string, request: AnalysisRequest): RunAnalysisResult {
  const database = getDatabase(databaseId);
  if (!database) throw new Error('Base de datos no encontrada.');
  const columns = getColumns(databaseId);
  const rows = listRows(databaseId);
  const profile = computeProfile(columns, rows);
  const v = validateRequest(request, profile);
  if (!v.ok || !v.normalized) throw new Error(v.error ?? 'Solicitud de análisis no válida.');
  return { databaseName: database.name, request: v.normalized, result: computeAnalysis(columns, rows, v.normalized) };
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
