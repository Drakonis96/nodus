/** Pure database analysis engine shared by Desktop and the read-only Server adapter. */
import { assignColumns } from './analysisCatalog';
import type { AnalysisRequest, AnalysisResult, DescriptiveColumn, GroupMetric, ScatterPoint, SeriesLine } from './analysisSpec';
import type { DatabaseColumn, DatabaseRow } from './databases';
import { computeProfile } from './dataProfile';
import { boxplot, categoryValues, categoryValuesMulti, chiSquare, contingencyTable, correlationMatrix, covarianceMatrix, crosstab, dateValues, describe, finitePairs, frequencies, groupBy, linearRegression, numericValues, pearson, round, spearman, timeSeries } from './stats';

const finite = (values: (number | null)[]): number[] => values.filter((value): value is number => value != null && Number.isFinite(value));
const histogram = (values: number[], buckets = 10): { label: string; count: number }[] => {
  if (!values.length) return [];
  const min = Math.min(...values); const max = Math.max(...values);
  if (min === max) return [{ label: String(round(min, 2)), count: values.length }];
  const count = Math.min(buckets, values.length); const width = (max - min) / count; const counts = new Array(count).fill(0) as number[];
  values.forEach((value) => { counts[Math.min(count - 1, Math.floor((value - min) / width))] += 1; });
  return counts.map((value, index) => ({ label: `${round(min + width * index, 2)}–${round(index === count - 1 ? max : min + width * (index + 1), 2)}`, count: value }));
};
const sample = (pairs: [number, number][], max = 600): [number, number][] => {
  if (pairs.length <= max) return pairs;
  const stride = pairs.length / max;
  return Array.from({ length: max }, (_, index) => pairs[Math.floor(index * stride)]);
};

export function computeDatabaseAnalysis(columns: DatabaseColumn[], rows: DatabaseRow[], request: AnalysisRequest): AnalysisResult {
  const byId = new Map(columns.map((column) => [column.id, column]));
  const column = (id: string): DatabaseColumn => { const value = byId.get(id); if (!value) throw new Error(`Columna inexistente: ${id}`); return value; };
  const groups = assignColumns(request.kind, request.columns).assigned;
  const matrix = (ids: string[]) => (ids.length ? ids.map(column) : columns.filter((item) => item.type === 'number' || item.type === 'relation')).map((item) => ({ key: item.id, label: item.name, values: numericValues(item, rows) }));
  switch (request.kind) {
    case 'descriptive': {
      const result: DescriptiveColumn[] = [];
      for (const id of groups[0]) { const c = column(id); const values = finite(numericValues(c, rows)); if (values.length) result.push({ column: id, columnName: c.name, stats: describe(values), boxplot: boxplot(values), histogram: histogram(values) }); }
      if (!result.length) throw new Error('Ninguna columna elegida tiene valores numéricos.');
      return { kind: 'descriptive', columns: result };
    }
    case 'correlation': { const x = column(request.columns[0]); const y = column(request.columns[1]); const pairs = finitePairs(numericValues(x, rows), numericValues(y, rows)); const points: ScatterPoint[] = sample(pairs).map(([px, py]) => ({ x: round(px, 4), y: round(py, 4) })); return { kind: 'correlation', xColumn: x.id, yColumn: y.id, xName: x.name, yName: y.name, pearson: pearson(pairs), spearman: spearman(pairs), regression: linearRegression(pairs), points }; }
    case 'correlation_matrix': return { kind: 'correlation_matrix', matrix: correlationMatrix(matrix(groups[0])) };
    case 'covariance_matrix': return { kind: 'covariance_matrix', matrix: covarianceMatrix(matrix(groups[0])) };
    case 'chi_square': { const x = column(request.columns[0]); const y = column(request.columns[1]); return { kind: 'chi_square', rowColumn: x.id, colColumn: y.id, rowName: x.name, colName: y.name, result: chiSquare(contingencyTable(categoryValues(x, rows), categoryValues(y, rows))) }; }
    case 'crosstab': { const x = column(groups[0][0]); const y = column(groups[1][0]); const v = groups[2][0] ? column(groups[2][0]) : null; const aggregate = request.options?.aggregate ?? (v ? 'mean' : 'count'); const table = crosstab(categoryValues(x, rows), categoryValues(y, rows), v ? numericValues(v, rows) : null, aggregate); return { kind: 'crosstab', rowColumn: x.id, colColumn: y.id, valueColumn: v?.id ?? null, rowName: x.name, colName: y.name, valueName: v?.name ?? null, aggregate, rowLabels: table.rowLabels, colLabels: table.colLabels, values: table.values, rowTotals: table.rowTotals, colTotals: table.colTotals, total: table.total }; }
    case 'group_compare': { const group = column(groups[0][0]); const cats = categoryValues(group, rows); const metrics: GroupMetric[] = groups[1].map((id) => { const value = column(id); const values = numericValues(value, rows); const result = groupBy(cats, values); const byLabel = new Map<string, number[]>(); cats.forEach((label, index) => { const number = values[index]; if (label != null && number != null && Number.isFinite(number)) byLabel.set(label, [...(byLabel.get(label) ?? []), number]); }); return { valueColumn: id, valueName: value.name, result, boxplots: result.groups.map((item) => ({ label: item.label, box: boxplot(byLabel.get(item.label) ?? []) })) }; }); return { kind: 'group_compare', groupColumn: group.id, groupName: group.name, metrics }; }
    case 'top_values': { const c = column(request.columns[0]); const freq = frequencies(categoryValuesMulti(c, rows), request.options?.topN ?? 15); return { kind: 'top_values', column: c.id, columnName: c.name, items: freq.items, distinct: freq.distinct, total: freq.total }; }
    case 'time_series': { const date = column(groups[0][0]); const ids = groups[1]; const bucket = request.options?.bucket ?? 'month'; const metric = request.options?.metric ?? (ids.length ? 'mean' : 'count'); const pick = (item: { count: number; sum: number; mean: number }) => metric === 'count' ? item.count : metric === 'sum' ? item.sum : item.mean; const series: SeriesLine[] = ids.length ? ids.map((id) => { const value = column(id); return { label: value.name, points: timeSeries(dateValues(date, rows), numericValues(value, rows), bucket).map((item) => ({ bucket: item.bucket, value: pick(item) })) }; }) : [{ label: date.name, points: timeSeries(dateValues(date, rows), null, bucket).map((item) => ({ bucket: item.bucket, value: item.count })) }]; return { kind: 'time_series', dateColumn: date.id, dateName: date.name, metric, bucket, series }; }
    case 'data_quality': { const profileById = new Map(computeProfile(columns, rows).columns.map((item) => [item.columnId, item])); return { kind: 'data_quality', rowCount: rows.length, columns: columns.map((item) => { const profile = profileById.get(item.id); const fillRate = profile?.fillRate ?? 0; const distinct = profile?.distinct ?? profile?.distribution?.length ?? null; const issues: string[] = []; if (fillRate === 0) issues.push('Columna vacía'); else if (fillRate < .5) issues.push('Muy incompleta'); if (distinct != null && rows.length > 1) { if (distinct === 1) issues.push('Valor constante'); else if (distinct === rows.length && (item.type === 'text' || item.type === 'title')) issues.push('Casi único (¿identificador?)'); } return { column: item.id, name: item.name, type: item.type, filled: profile?.filled ?? 0, fillRate, distinct, issues }; }) }; }
    default: throw new Error(`Análisis no soportado: ${request.kind}`);
  }
}
