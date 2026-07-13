// Native, code-free renderers for the deterministic AnalysisResult shapes (heatmaps,
// scatter+regression, box plots, grouped bars, line charts). No code execution, so they
// satisfy the CSP the same way ChartFromSpec does. AnalysisResultCard dispatches a
// result to the right renderer and surfaces the key figures + an optional AI reading.

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './ui';
import { BarList } from './DatabaseChart';
import { useAnchoredCoords } from './dbGrid';
import { Markdown } from './Markdown';
import { t, tx } from '../i18n';
import type {
  AnalysisResult,
  ChiSquareResultOut,
  CorrelationMatrixResult,
  CovarianceMatrixResult,
  CorrelationResultOut,
  CrosstabResult,
  DataQualityResult,
  DescriptiveResult,
  GroupCompareResult,
  ScatterPoint,
  SeriesLine,
  TimeSeriesResult,
  TopValuesResult,
} from '@shared/types';
import type { BoxplotStats } from '@shared/stats';

const ACCENT = '#b30333';
const BLUE = '#3b82f6';
const SERIES_PALETTE = ['#b30333', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#ef4444'];

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '–';
  return Math.abs(n) >= 1000 || (n !== 0 && Math.abs(n) < 0.01) ? n.toPrecision(3) : String(Math.round(n * 1000) / 1000);
}

// ── heatmap (correlation matrix + contingency) ───────────────────────────────

/** Cell colour: diverging red/blue for correlation, sequential accent for counts. */
function cellColor(v: number, mode: 'correlation' | 'count', max: number): string {
  if (!Number.isFinite(v)) return 'transparent';
  if (mode === 'correlation') {
    const a = Math.min(1, Math.abs(v));
    return v >= 0 ? `rgba(179,3,51,${a})` : `rgba(59,130,246,${a})`;
  }
  const a = max > 0 ? (v / max) * 0.85 + (v > 0 ? 0.08 : 0) : 0;
  return `rgba(179,3,51,${a})`;
}

export function Heatmap({
  rowLabels,
  colLabels,
  values,
  mode,
  cellText = true,
}: {
  rowLabels: string[];
  colLabels: string[];
  values: number[][];
  mode: 'correlation' | 'count';
  cellText?: boolean;
}) {
  const max = Math.max(1, ...values.flat().filter((v) => Number.isFinite(v)));
  return (
    <div className="overflow-x-auto">
      <table className="border-separate" style={{ borderSpacing: 2 }}>
        <thead>
          <tr>
            <th />
            {colLabels.map((c) => (
              <th key={c} className="text-[10px] text-neutral-400 font-normal px-1 pb-1 max-w-[80px] truncate" title={c}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowLabels.map((r, i) => (
            <tr key={r}>
              <td className="text-[10px] text-neutral-400 pr-2 text-right max-w-[100px] truncate" title={r}>
                {r}
              </td>
              {colLabels.map((c, j) => {
                const v = values[i]?.[j];
                return (
                  <td
                    key={c}
                    className="text-center text-[10px] tabular-nums rounded"
                    style={{ backgroundColor: cellColor(v, mode, max), minWidth: 34, height: 26, color: Math.abs(v) > 0.6 || (mode === 'count' && v > max * 0.6) ? '#fff' : undefined }}
                    title={`${r} · ${c}: ${fmt(v)}`}
                  >
                    {cellText && Number.isFinite(v) ? fmt(v) : ''}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── scatter with regression line ─────────────────────────────────────────────

export function ScatterPlot({
  points,
  regression,
  xLabel,
  yLabel,
}: {
  points: ScatterPoint[];
  regression?: { slope: number; intercept: number } | null;
  xLabel: string;
  yLabel: string;
}) {
  const W = 340;
  const H = 240;
  const pad = { l: 40, r: 12, t: 12, b: 30 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const sx = (x: number) => pad.l + ((x - xMin) / (xMax - xMin || 1)) * (W - pad.l - pad.r);
  const sy = (y: number) => H - pad.b - ((y - yMin) / (yMax - yMin || 1)) * (H - pad.t - pad.b);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-md" role="img" aria-label={`${xLabel} vs ${yLabel}`}>
      {/* axes */}
      <line x1={pad.l} y1={H - pad.b} x2={W - pad.r} y2={H - pad.b} stroke="currentColor" className="text-neutral-700" strokeWidth={1} />
      <line x1={pad.l} y1={pad.t} x2={pad.l} y2={H - pad.b} stroke="currentColor" className="text-neutral-700" strokeWidth={1} />
      {/* regression line */}
      {regression && Number.isFinite(regression.slope) && (
        <line
          x1={sx(xMin)}
          y1={sy(regression.slope * xMin + regression.intercept)}
          x2={sx(xMax)}
          y2={sy(regression.slope * xMax + regression.intercept)}
          stroke={ACCENT}
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
      )}
      {/* points */}
      {points.map((p, i) => (
        <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={2.6} fill={BLUE} fillOpacity={0.65} />
      ))}
      {/* tick labels */}
      <text x={pad.l} y={H - 8} className="fill-neutral-500" fontSize={9}>{fmt(xMin)}</text>
      <text x={W - pad.r} y={H - 8} textAnchor="end" className="fill-neutral-500" fontSize={9}>{fmt(xMax)}</text>
      <text x={pad.l - 4} y={H - pad.b} textAnchor="end" className="fill-neutral-500" fontSize={9}>{fmt(yMin)}</text>
      <text x={pad.l - 4} y={pad.t + 8} textAnchor="end" className="fill-neutral-500" fontSize={9}>{fmt(yMax)}</text>
      <text x={(W + pad.l) / 2} y={H - 1} textAnchor="middle" className="fill-neutral-400" fontSize={10}>{xLabel}</text>
      <text x={10} y={H / 2} textAnchor="middle" transform={`rotate(-90 10 ${H / 2})`} className="fill-neutral-400" fontSize={10}>{yLabel}</text>
    </svg>
  );
}

// ── box plots (single or grouped) ────────────────────────────────────────────

export function BoxPlotChart({ boxes }: { boxes: { label: string; box: BoxplotStats }[] }) {
  const valid = boxes.filter((b) => b.box && Number.isFinite(b.box.median));
  if (!valid.length) return null;
  const W = 360;
  const rowH = 40;
  const H = valid.length * rowH + 24;
  const pad = { l: 90, r: 16, t: 8 };
  const allVals = valid.flatMap((b) => [b.box.whiskerLow, b.box.whiskerHigh, ...b.box.outliers]);
  const lo = Math.min(...allVals);
  const hi = Math.max(...allVals);
  const sx = (v: number) => pad.l + ((v - lo) / (hi - lo || 1)) * (W - pad.l - pad.r);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-lg" role="img" aria-label="box plot">
      {valid.map((b, i) => {
        const cy = pad.t + i * rowH + rowH / 2;
        const box = b.box;
        return (
          <g key={b.label}>
            <text x={pad.l - 6} y={cy + 3} textAnchor="end" className="fill-neutral-400" fontSize={10}>
              {b.label.length > 14 ? b.label.slice(0, 13) + '…' : b.label}
            </text>
            {/* whiskers */}
            <line x1={sx(box.whiskerLow)} y1={cy} x2={sx(box.q1)} y2={cy} stroke="currentColor" className="text-neutral-600" />
            <line x1={sx(box.q3)} y1={cy} x2={sx(box.whiskerHigh)} y2={cy} stroke="currentColor" className="text-neutral-600" />
            <line x1={sx(box.whiskerLow)} y1={cy - 6} x2={sx(box.whiskerLow)} y2={cy + 6} stroke="currentColor" className="text-neutral-600" />
            <line x1={sx(box.whiskerHigh)} y1={cy - 6} x2={sx(box.whiskerHigh)} y2={cy + 6} stroke="currentColor" className="text-neutral-600" />
            {/* box */}
            <rect x={sx(box.q1)} y={cy - 10} width={Math.max(1, sx(box.q3) - sx(box.q1))} height={20} fill={ACCENT} fillOpacity={0.22} stroke={ACCENT} />
            <line x1={sx(box.median)} y1={cy - 10} x2={sx(box.median)} y2={cy + 10} stroke={ACCENT} strokeWidth={2} />
            {/* outliers */}
            {box.outliers.map((o, k) => (
              <circle key={k} cx={sx(o)} cy={cy} r={2} fill={BLUE} fillOpacity={0.7} />
            ))}
          </g>
        );
      })}
      <text x={pad.l} y={H - 4} className="fill-neutral-500" fontSize={9}>{fmt(lo)}</text>
      <text x={W - pad.r} y={H - 4} textAnchor="end" className="fill-neutral-500" fontSize={9}>{fmt(hi)}</text>
    </svg>
  );
}

// ── line chart (time series) ─────────────────────────────────────────────────

export function LineChart({ series }: { series: SeriesLine[] }) {
  // Union of buckets across all series, in first-seen order (series share the x axis).
  const buckets: string[] = [];
  const seen = new Set<string>();
  for (const s of series) {
    for (const p of s.points) {
      if (!seen.has(p.bucket)) {
        seen.add(p.bucket);
        buckets.push(p.bucket);
      }
    }
  }
  buckets.sort();
  if (buckets.length < 2) return <p className="text-xs text-neutral-500">{t('Muy pocos puntos para una serie.')}</p>;
  const idxOf = new Map(buckets.map((b, i) => [b, i]));
  const allVals = series.flatMap((s) => s.points.map((p) => p.value));
  const W = 380;
  const H = 210;
  const pad = { l: 40, r: 12, t: 12, b: 40 };
  const yMin = Math.min(0, ...allVals);
  const yMax = Math.max(1, ...allVals);
  const sx = (i: number) => pad.l + (i / (buckets.length - 1)) * (W - pad.l - pad.r);
  const sy = (v: number) => H - pad.b - ((v - yMin) / (yMax - yMin || 1)) * (H - pad.t - pad.b);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-lg" role="img" aria-label="serie temporal">
        <line x1={pad.l} y1={H - pad.b} x2={W - pad.r} y2={H - pad.b} stroke="currentColor" className="text-neutral-700" />
        <line x1={pad.l} y1={pad.t} x2={pad.l} y2={H - pad.b} stroke="currentColor" className="text-neutral-700" />
        {series.map((s, si) => {
          const color = SERIES_PALETTE[si % SERIES_PALETTE.length];
          const pts = s.points.slice().sort((a, b) => (a.bucket < b.bucket ? -1 : 1));
          const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(idxOf.get(p.bucket) ?? 0)},${sy(p.value)}`).join(' ');
          return (
            <g key={s.label}>
              <path d={path} fill="none" stroke={color} strokeWidth={1.8} />
              {pts.map((p) => (
                <circle key={p.bucket} cx={sx(idxOf.get(p.bucket) ?? 0)} cy={sy(p.value)} r={2.2} fill={color} />
              ))}
            </g>
          );
        })}
        <text x={pad.l} y={H - pad.b + 14} className="fill-neutral-500" fontSize={9}>{buckets[0]}</text>
        <text x={W - pad.r} y={H - pad.b + 14} textAnchor="end" className="fill-neutral-500" fontSize={9}>{buckets[buckets.length - 1]}</text>
        <text x={pad.l - 4} y={pad.t + 8} textAnchor="end" className="fill-neutral-500" fontSize={9}>{fmt(yMax)}</text>
        <text x={pad.l - 4} y={H - pad.b} textAnchor="end" className="fill-neutral-500" fontSize={9}>{fmt(yMin)}</text>
      </svg>
      {series.length > 1 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-xs">
          {series.map((s, si) => (
            <span key={s.label} className="flex items-center gap-1 text-neutral-400">
              <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: SERIES_PALETTE[si % SERIES_PALETTE.length] }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── figure chips ─────────────────────────────────────────────────────────────

function Figures({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {items.map((it) => (
        <div key={it.label} className="px-2 py-1 rounded bg-neutral-800/50 text-xs">
          <span className="text-neutral-500">{it.label}</span> <span className="tabular-nums font-medium">{it.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── per-kind bodies ──────────────────────────────────────────────────────────

const DESC_STAT_COLS: { key: string; label: string }[] = [
  { key: 'n', label: 'n' },
  { key: 'mean', label: 'Media' },
  { key: 'median', label: 'Mediana' },
  { key: 'stdev', label: 'Desv.' },
  { key: 'variance', label: 'Varianza' },
  { key: 'cv', label: 'CV' },
  { key: 'min', label: 'Mín' },
  { key: 'max', label: 'Máx' },
  { key: 'q1', label: 'Q1' },
  { key: 'q3', label: 'Q3' },
  { key: 'skewness', label: 'Asimetría' },
  { key: 'kurtosis', label: 'Curtosis' },
];

function DescriptiveBody({ r }: { r: DescriptiveResult }) {
  const multi = r.columns.length > 1;
  return (
    <>
      {/* Comparison table across the selected columns. */}
      <div className="overflow-x-auto mt-2">
        <table className="text-xs w-full">
          <thead>
            <tr className="text-neutral-500 text-left">
              <th className="font-normal pr-3 pb-1">{t('Columna')}</th>
              {DESC_STAT_COLS.map((c) => (
                <th key={c.key} className="font-normal px-2 pb-1 text-right whitespace-nowrap">{c.key === 'n' ? c.label : t(c.label)}</th>
              ))}
              <th className="font-normal px-2 pb-1 text-right">{t('Atípicos')}</th>
            </tr>
          </thead>
          <tbody>
            {r.columns.map((col) => (
              <tr key={col.column} className="border-t border-neutral-800/60">
                <td className="pr-3 py-1 font-medium truncate max-w-[140px]" title={col.columnName}>{col.columnName}</td>
                {DESC_STAT_COLS.map((c) => {
                  const v = (col.stats as unknown as Record<string, number | null>)[c.key];
                  return <td key={c.key} className="px-2 py-1 text-right tabular-nums">{v == null ? '–' : fmt(v as number)}</td>;
                })}
                <td className="px-2 py-1 text-right tabular-nums">{col.stats.outliers.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!multi && (
        <div className="mt-3">
          <BarList items={r.columns[0].histogram.map((h) => ({ label: h.label, count: h.count }))} />
        </div>
      )}
      <div className="mt-3">
        <BoxPlotChart boxes={r.columns.map((c) => ({ label: c.columnName, box: c.boxplot }))} />
      </div>
    </>
  );
}

function CorrelationBody({ r }: { r: CorrelationResultOut }) {
  return (
    <>
      <Figures
        items={[
          { label: t('Pearson r'), value: fmt(r.pearson.r) },
          { label: t('Spearman'), value: fmt(r.spearman.r) },
          { label: 'R²', value: fmt(r.regression.r2) },
          { label: t('Pendiente de la recta'), value: fmt(r.regression.slope) },
          { label: 'p', value: r.pearson.p == null ? '–' : fmt(r.pearson.p) },
          { label: 'n', value: String(r.pearson.n) },
        ]}
      />
      <div className="mt-3">
        <ScatterPlot points={r.points} regression={r.regression} xLabel={r.xName} yLabel={r.yName} />
      </div>
    </>
  );
}

function CorrelationMatrixBody({ r }: { r: CorrelationMatrixResult }) {
  return <div className="mt-2"><Heatmap rowLabels={r.matrix.labels} colLabels={r.matrix.labels} values={r.matrix.matrix} mode="correlation" /></div>;
}

function CovarianceMatrixBody({ r }: { r: CovarianceMatrixResult }) {
  return (
    <div className="mt-2">
      <Heatmap rowLabels={r.matrix.labels} colLabels={r.matrix.labels} values={r.matrix.matrix} mode="count" />
      <p className="text-[11px] text-neutral-500 mt-2">{t('La diagonal es la varianza de cada columna.')}</p>
    </div>
  );
}

function CrosstabBody({ r }: { r: CrosstabResult }) {
  const aggLabel = r.aggregate === 'count' ? t('Recuento') : r.aggregate === 'sum' ? t('Suma') : t('Media');
  return (
    <>
      <Figures
        items={[
          { label: t('Agregado'), value: r.valueName ? `${aggLabel} · ${r.valueName}` : aggLabel },
          { label: t('Total'), value: fmt(r.total) },
        ]}
      />
      <div className="mt-3">
        <Heatmap rowLabels={r.rowLabels} colLabels={r.colLabels} values={r.values} mode="count" />
      </div>
      <p className="text-[11px] text-neutral-500 mt-2">{tx('Filas: {r} · Columnas: {c}', { r: r.rowName, c: r.colName })}</p>
    </>
  );
}

function ChiSquareBody({ r }: { r: ChiSquareResultOut }) {
  const cs = r.result;
  return (
    <>
      <Figures
        items={[
          { label: 'χ²', value: fmt(cs.chi2) },
          { label: t('gl'), value: String(cs.dof) },
          { label: t("V de Cramér"), value: fmt(cs.cramersV) },
          { label: 'p', value: cs.p == null ? '–' : fmt(cs.p) },
          { label: 'n', value: String(cs.table.total) },
        ]}
      />
      <div className="mt-3">
        <Heatmap rowLabels={cs.table.rowLabels} colLabels={cs.table.colLabels} values={cs.table.counts} mode="count" />
      </div>
      <p className="text-[11px] text-neutral-500 mt-2">{tx('Filas: {r} · Columnas: {c}', { r: r.rowName, c: r.colName })}</p>
    </>
  );
}

function GroupCompareBody({ r }: { r: GroupCompareResult }) {
  return (
    <div className="flex flex-col gap-4">
      {r.metrics.map((m) => {
        const anova = m.result.anova;
        return (
          <div key={m.valueColumn} className={r.metrics.length > 1 ? 'pt-1' : ''}>
            {r.metrics.length > 1 && <div className="text-sm font-medium mb-1">{m.valueName}</div>}
            {anova && (
              <Figures
                items={[
                  { label: 'F', value: fmt(anova.f) },
                  { label: 'p', value: anova.p == null ? '–' : fmt(anova.p) },
                  { label: 'η²', value: fmt(anova.etaSquared) },
                  { label: t('Grupos'), value: String(m.result.groups.length) },
                ]}
              />
            )}
            <div className="mt-3">
              <BarList items={m.result.groups.map((g) => ({ label: `${g.label} (${g.count})`, count: g.mean }))} />
            </div>
            <div className="mt-3">
              <BoxPlotChart boxes={m.boxplots} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DataQualityBody({ r }: { r: DataQualityResult }) {
  return (
    <>
      <Figures items={[{ label: t('Filas'), value: String(r.rowCount) }, { label: t('Columnas'), value: String(r.columns.length) }]} />
      <div className="overflow-x-auto mt-3">
        <table className="text-xs w-full">
          <thead>
            <tr className="text-neutral-500 text-left">
              <th className="font-normal pr-3 pb-1">{t('Columna')}</th>
              <th className="font-normal px-2 pb-1 text-right">{t('Relleno')}</th>
              <th className="font-normal px-2 pb-1 text-right">{t('Distintos')}</th>
              <th className="font-normal px-2 pb-1 text-left">{t('Avisos')}</th>
            </tr>
          </thead>
          <tbody>
            {r.columns.map((c) => {
              const pct = Math.round(c.fillRate * 100);
              return (
                <tr key={c.column} className="border-t border-neutral-800/60">
                  <td className="pr-3 py-1 font-medium truncate max-w-[160px]" title={c.name}>{c.name}</td>
                  <td className="px-2 py-1 text-right tabular-nums" style={{ color: pct < 50 ? '#f59e0b' : undefined }}>{pct}%</td>
                  <td className="px-2 py-1 text-right tabular-nums">{c.distinct ?? '–'}</td>
                  <td className="px-2 py-1 text-left">
                    {c.issues.length ? (
                      <span className="inline-flex flex-wrap gap-1">
                        {c.issues.map((iss) => (
                          <span key={iss} className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500 text-[10px]">{t(iss)}</span>
                        ))}
                      </span>
                    ) : (
                      <span className="text-emerald-500/80 text-[10px]">✓</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function TopValuesBody({ r }: { r: TopValuesResult }) {
  return (
    <>
      <Figures items={[{ label: t('Distintos'), value: String(r.distinct) }, { label: t('Total'), value: String(r.total) }]} />
      <div className="mt-3">
        <BarList items={r.items.map((it) => ({ label: it.label, count: it.count }))} />
      </div>
    </>
  );
}

function TimeSeriesBody({ r }: { r: TimeSeriesResult }) {
  const metricLabel = r.metric === 'count' ? t('Recuento') : r.metric === 'sum' ? t('Suma') : t('Media');
  return (
    <div className="mt-2">
      <Figures items={[{ label: t('Métrica'), value: metricLabel }, { label: t('Agrupado por'), value: t(r.bucket === 'day' ? 'Día' : r.bucket === 'year' ? 'Año' : 'Mes') }]} />
      <div className="mt-2">
        <LineChart series={r.series} />
      </div>
    </div>
  );
}

function ResultBody({ result }: { result: AnalysisResult }) {
  switch (result.kind) {
    case 'descriptive':
      return <DescriptiveBody r={result} />;
    case 'correlation':
      return <CorrelationBody r={result} />;
    case 'correlation_matrix':
      return <CorrelationMatrixBody r={result} />;
    case 'covariance_matrix':
      return <CovarianceMatrixBody r={result} />;
    case 'chi_square':
      return <ChiSquareBody r={result} />;
    case 'crosstab':
      return <CrosstabBody r={result} />;
    case 'group_compare':
      return <GroupCompareBody r={result} />;
    case 'top_values':
      return <TopValuesBody r={result} />;
    case 'time_series':
      return <TimeSeriesBody r={result} />;
    case 'data_quality':
      return <DataQualityBody r={result} />;
  }
}

// ── card ─────────────────────────────────────────────────────────────────────

export function AnalysisResultCard({
  title,
  icon,
  result,
  onExplain,
  narrative,
  explaining,
}: {
  title: string;
  icon?: string;
  result: AnalysisResult;
  onExplain?: () => void;
  narrative?: string | null;
  explaining?: boolean;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2">
        {icon && <Icon name={icon} size={15} className="text-indigo-400" />}
        <h3 className="font-medium text-sm truncate">{title}</h3>
        <div className="flex-1" />
        {onExplain && (
          <button className="btn btn-ghost gap-1.5 text-xs px-2 py-1" onClick={onExplain} disabled={explaining}>
            <Icon name={explaining ? 'sync' : 'wand'} size={12} className={explaining ? 'animate-spin' : ''} />
            {explaining ? t('Explicando…') : t('Explicar con IA')}
          </button>
        )}
      </div>
      <ResultBody result={result} />
      {narrative && (
        <div className="mt-3 pt-3 border-t border-neutral-800">
          <Markdown content={narrative} className="text-sm" />
        </div>
      )}
    </div>
  );
}

// ── styled column picker (single or multi) for the manual builder ────────────

export interface ColumnOption {
  id: string;
  name: string;
}

/**
 * A themed dropdown that portals its panel to the body (so it isn't clipped) and,
 * when `multi`, lets the user tick several columns — shown as removable chips.
 */
export function ColumnSelect({
  options,
  value,
  onChange,
  multi,
  placeholder,
}: {
  options: ColumnOption[];
  value: string[];
  onChange: (next: string[]) => void;
  multi?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const coords = useAnchoredCoords(open, ref, null, 200, 'below');
  const selected = options.filter((o) => value.includes(o.id));

  const toggle = (id: string) => {
    if (multi) {
      onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
    } else {
      onChange([id]);
      setOpen(false);
    }
  };

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="input flex items-center gap-1 min-w-[150px] max-w-[280px] text-left"
      >
        <span className="flex-1 flex flex-wrap gap-1 min-w-0">
          {selected.length === 0 && <span className="text-neutral-500 truncate">{placeholder ?? t('Elegir…')}</span>}
          {multi
            ? selected.map((o) => (
                <span key={o.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-600/20 text-xs">
                  {o.name}
                  <span
                    role="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(o.id);
                    }}
                    className="opacity-60 hover:opacity-100"
                  >
                    <Icon name="x" size={10} />
                  </span>
                </span>
              ))
            : selected[0] && <span className="truncate">{selected[0].name}</span>}
        </span>
        <Icon name="chevronDown" size={13} className="opacity-50 shrink-0" />
      </button>
      {open &&
        coords &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[55]" onClick={() => setOpen(false)} />
            <div
              className="fixed z-[56] card p-1 max-h-[50vh] overflow-y-auto shadow-xl"
              style={{ top: coords.top, left: coords.left, width: coords.width }}
            >
              {options.length === 0 && <div className="px-2 py-1.5 text-xs text-neutral-500">{t('Sin columnas')}</div>}
              {options.map((o) => {
                const on = value.includes(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => toggle(o.id)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left hover:bg-neutral-800/60 ${on ? 'text-indigo-300' : ''}`}
                  >
                    <span className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0 ${on ? 'bg-indigo-600 border-indigo-600' : 'border-neutral-600'}`}>
                      {on && <Icon name="check" size={10} className="text-white" />}
                    </span>
                    <span className="truncate">{o.name}</span>
                  </button>
                );
              })}
            </div>
          </>,
          document.body
        )}
    </>
  );
}
