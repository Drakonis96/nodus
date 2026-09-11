import { useMemo } from 'react';
import katex from 'katex';
import type { ViewChartSeries, ViewNode, ViewPassageMark, ViewTreeItem } from '@shared/capabilities';
import { t } from '../i18n';

/** The result kinds that are pure data: a formula, a chart, a hierarchy, a marked-up
 *  passage, two versions of a text.
 *
 *  None of them needs a permission, a host channel or an attachment — the capability
 *  states values and the core draws them. That is the whole point: every chart in the
 *  application is drawn by the same code, so it themes, scales and reads the same
 *  wherever it came from, and a package cannot ship a drawing that behaves differently
 *  from the rest of the interface. */

type Node<K extends ViewNode['kind']> = Extract<ViewNode, { kind: K }>;

// ---------------------------------------------------------------- formula

export function ViewMath({ node }: { node: Node<'math'> }) {
  // KaTeX in strict mode with `trust` off: no `\includegraphics`, no `\href`, no macro
  // that could reach a file or a URL. A formula that uses one is shown as an error
  // rather than quietly rendering something else.
  const rendered = useMemo(() => {
    try {
      return { html: katex.renderToString(node.tex, { displayMode: node.display !== false, throwOnError: true, strict: 'error', trust: false, output: 'html' }), failed: false };
    } catch {
      return { html: '', failed: true };
    }
  }, [node.tex, node.display]);

  if (rendered.failed) {
    return <p className="capability-view-math-error" role="note" title={node.tex}>{node.alt}</p>;
  }
  return <div
    className="capability-view-math"
    data-display={node.display !== false ? 'block' : 'inline'}
    role="math"
    aria-label={node.alt}
    // KaTeX's own output, from TeX the contract bounded and strict mode accepted. No
    // capability-authored markup reaches this.
    dangerouslySetInnerHTML={{ __html: rendered.html }}
  />;
}

// ---------------------------------------------------------------- chart

const TONE_COLOURS: Record<string, string> = {
  neutral: '#94a3b8', info: '#60a5fa', success: '#4ade80', warning: '#fbbf24', danger: '#f87171',
};
const SERIES_COLOURS = ['#818cf8', '#4ade80', '#fbbf24', '#f87171', '#22d3ee', '#c084fc', '#fb923c', '#a3e635', '#f472b6', '#38bdf8', '#facc15', '#2dd4bf'];

export function ViewChart({ node }: { node: Node<'chart'> }) {
  const geometry = useMemo(() => chartGeometry(node), [node]);
  if (!geometry) return <p className="capability-view-math-error" role="note">{node.alt}</p>;

  const { width, height, plot, xOf, yOf, ticks, categories } = geometry;
  return <figure className="capability-view-chart">
    <figcaption>{node.title}</figcaption>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={node.alt} preserveAspectRatio="xMidYMid meet">
      <g className="capability-view-chart-grid">
        {ticks.map(tick => <g key={tick.value}>
          <line x1={plot.left} x2={plot.left + plot.width} y1={yOf(tick.value)} y2={yOf(tick.value)} />
          <text x={plot.left - 6} y={yOf(tick.value)} textAnchor="end" dominantBaseline="middle">{tick.label}</text>
        </g>)}
      </g>

      {node.series.map((series, index) => <g key={series.label} className="capability-view-chart-series">
        {renderSeries(node.chartType, series, index, { plot, xOf, yOf, seriesCount: node.series.length })}
      </g>)}

      <g className="capability-view-chart-axis">
        <line x1={plot.left} x2={plot.left + plot.width} y1={plot.top + plot.height} y2={plot.top + plot.height} />
        <line x1={plot.left} x2={plot.left} y1={plot.top} y2={plot.top + plot.height} />
        {categories.map(category => <text key={category.label} x={category.x} y={plot.top + plot.height + 16} textAnchor="middle">{category.label}</text>)}
        {node.xLabel && <text x={plot.left + plot.width / 2} y={height - 4} textAnchor="middle" className="capability-view-chart-axis-label">{node.xLabel}</text>}
        {node.yLabel && <text x={10} y={plot.top + plot.height / 2} textAnchor="middle" transform={`rotate(-90 10 ${plot.top + plot.height / 2})`} className="capability-view-chart-axis-label">{node.yLabel}</text>}
      </g>
    </svg>

    {node.series.length > 1 && <ul className="capability-view-chart-legend">
      {node.series.map((series, index) => <li key={series.label}>
        <span style={{ background: colourOf(series, index) }} aria-hidden="true" />{series.label}
      </li>)}
    </ul>}
  </figure>;
}

const colourOf = (series: ViewChartSeries, index: number) =>
  series.tone ? TONE_COLOURS[series.tone] : SERIES_COLOURS[index % SERIES_COLOURS.length];

/** Lays the chart out once, in view-box units, so the SVG scales with the column rather
 *  than needing a measurement pass. */
function chartGeometry(node: Node<'chart'>) {
  const width = 640;
  const height = 320;
  const plot = { left: 52, top: 16, width: width - 72, height: height - 56 };

  const categorical = typeof node.series[0]?.points[0]?.[0] === 'string';
  const labels = categorical
    ? [...new Set(node.series.flatMap(series => series.points.map(point => String(point[0]))))]
    : [];

  const xs = categorical ? [] : node.series.flatMap(series => series.points.map(point => Number(point[0])));
  const ys = node.series.flatMap(series => series.points.map(point => point[1]));
  if (!ys.length) return null;

  const minX = categorical ? 0 : Math.min(...xs);
  const maxX = categorical ? Math.max(labels.length - 1, 1) : Math.max(...xs);
  // A flat series still deserves an axis rather than a division by zero.
  const spanX = maxX - minX || 1;
  const rawMin = Math.min(...ys, 0);
  const rawMax = Math.max(...ys, 0);
  const spanY = rawMax - rawMin || 1;
  const minY = rawMin - spanY * 0.05;
  const maxY = rawMax + spanY * 0.05;

  const xOf = (value: number | string) => {
    const position = categorical ? labels.indexOf(String(value)) : Number(value);
    const ratio = categorical ? (labels.length > 1 ? position / (labels.length - 1) : 0.5) : (position - minX) / spanX;
    return plot.left + ratio * plot.width;
  };
  const yOf = (value: number) => plot.top + plot.height - ((value - minY) / (maxY - minY)) * plot.height;

  const ticks = Array.from({ length: 5 }, (_, index) => {
    const value = minY + ((maxY - minY) * index) / 4;
    return { value, label: formatTick(value) };
  });

  const categories = categorical
    ? labels.map(label => ({ label, x: xOf(label) }))
    : [minX, maxX].map(value => ({ label: formatTick(value), x: xOf(value) }));

  return { width, height, plot, xOf, yOf, ticks, categories };
}

function formatTick(value: number): string {
  if (Math.abs(value) >= 10_000 || (value !== 0 && Math.abs(value) < 0.01)) return value.toExponential(1);
  return String(Math.round(value * 100) / 100);
}

function renderSeries(
  chartType: Node<'chart'>['chartType'],
  series: ViewChartSeries,
  index: number,
  layout: { plot: { left: number; top: number; width: number; height: number }; xOf: (value: number | string) => number; yOf: (value: number) => number; seriesCount: number },
) {
  const colour = colourOf(series, index);
  const points = series.points.map(([x, y]) => ({ x: layout.xOf(x), y: layout.yOf(y) }));

  if (chartType === 'scatter') {
    return points.map((point, at) => <circle key={at} cx={point.x} cy={point.y} r={3} fill={colour} />);
  }
  if (chartType === 'bar') {
    // Bars share the slot between neighbouring x positions, so several series sit beside
    // each other instead of on top of one another.
    const slot = points.length > 1 ? Math.abs(points[1].x - points[0].x) : layout.plot.width / 2;
    const barWidth = Math.max((slot * 0.7) / layout.seriesCount, 1);
    const base = layout.yOf(0);
    return points.map((point, at) => <rect
      key={at}
      x={point.x - (slot * 0.35) + index * barWidth}
      y={Math.min(point.y, base)}
      width={barWidth}
      height={Math.max(Math.abs(base - point.y), 1)}
      fill={colour}
    />);
  }

  const path = points.map((point, at) => `${at ? 'L' : 'M'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
  const baseline = layout.plot.top + layout.plot.height;
  return <>
    {chartType === 'area' && <path d={`${path} L${points[points.length - 1].x.toFixed(2)} ${baseline} L${points[0].x.toFixed(2)} ${baseline} Z`} fill={colour} opacity={0.25} />}
    <path d={path} fill="none" stroke={colour} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
  </>;
}

// ---------------------------------------------------------------- hierarchy

export function ViewTree({ node }: { node: Node<'tree'> }) {
  return <section className="capability-view-tree" aria-label={node.alt}>
    {node.title && <h4>{node.title}</h4>}
    <TreeLevel items={node.roots} />
  </section>;
}

function TreeLevel({ items }: { items: ViewTreeItem[] }) {
  return <ul>
    {items.map((item, index) => <li key={`${item.label}-${index}`} data-tone={item.tone ?? 'neutral'}>
      <span className="capability-view-tree-label">{item.label}</span>
      {item.detail && <span className="capability-view-tree-detail">{item.detail}</span>}
      {item.children?.length ? <TreeLevel items={item.children} /> : null}
    </li>)}
  </ul>;
}

// ---------------------------------------------------------------- marked-up passage

export function ViewPassage({ node }: { node: Node<'passage'> }) {
  const pieces = useMemo(() => splitMarks(node.text, node.marks), [node.text, node.marks]);
  return <figure className="capability-view-passage">
    {node.title && <figcaption>{node.title}</figcaption>}
    <p>
      {pieces.map((piece, index) => piece.mark
        ? <mark key={index} data-tone={piece.mark.tone ?? 'info'} title={piece.mark.label}>
          {piece.text}<span className="capability-view-passage-label">{piece.mark.label}</span>
        </mark>
        : <span key={index}>{piece.text}</span>)}
    </p>
  </figure>;
}

/** Cuts the text at every mark boundary. Overlapping marks are resolved by taking the
 *  one that starts first — showing both would mean nesting, and a nested highlight reads
 *  as a third, different thing. */
export function splitMarks(text: string, marks: ViewPassageMark[]): Array<{ text: string; mark?: ViewPassageMark }> {
  const ordered = [...marks].sort((a, b) => a.start - b.start || b.end - a.end);
  const pieces: Array<{ text: string; mark?: ViewPassageMark }> = [];
  let cursor = 0;
  for (const mark of ordered) {
    if (mark.start < cursor) continue;
    if (mark.start > cursor) pieces.push({ text: text.slice(cursor, mark.start) });
    pieces.push({ text: text.slice(mark.start, mark.end), mark });
    cursor = mark.end;
  }
  if (cursor < text.length) pieces.push({ text: text.slice(cursor) });
  return pieces;
}

// ---------------------------------------------------------------- comparison

export function ViewComparison({ node }: { node: Node<'comparison'> }) {
  const hunks = useMemo(
    () => diff(node.before.text, node.after.text, node.granularity ?? 'line'),
    [node.before.text, node.after.text, node.granularity],
  );
  const changed = hunks.some(hunk => hunk.kind !== 'same');

  return <figure className="capability-view-comparison">
    {node.title && <figcaption>{node.title}</figcaption>}
    <div className="capability-view-comparison-heads">
      <span>{node.before.label}</span><span>{node.after.label}</span>
    </div>
    {!changed && <p className="capability-view-comparison-identical" role="status">{t('Los dos textos son idénticos.')}</p>}
    <div className="capability-view-comparison-body">
      {hunks.map((hunk, index) => <span key={index} data-change={hunk.kind}>{hunk.text}</span>)}
    </div>
  </figure>;
}

/** The differences, found here rather than described by the capability.
 *
 *  A longest-common-subsequence walk over lines or words — the standard approach, and
 *  small enough to keep in one place so that every comparison in the application marks
 *  changes the same way. Quadratic in the number of tokens, which the contract's length
 *  ceiling already bounds. */
export function diff(before: string, after: string, granularity: 'line' | 'word'): Array<{ kind: 'same' | 'added' | 'removed'; text: string }> {
  const split = (value: string) => granularity === 'line' ? value.split(/(?<=\n)/) : value.split(/(?<=\s)/);
  const a = split(before);
  const b = split(after);

  // Common prefix and suffix first: most comparisons differ in one place, and trimming
  // them keeps the table small enough to build.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA -= 1; endB -= 1; }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const table: number[][] = Array.from({ length: midA.length + 1 }, () => new Array(midB.length + 1).fill(0));
  for (let i = midA.length - 1; i >= 0; i -= 1) {
    for (let j = midB.length - 1; j >= 0; j -= 1) {
      table[i][j] = midA[i] === midB[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const hunks: Array<{ kind: 'same' | 'added' | 'removed'; text: string }> = [];
  const push = (kind: 'same' | 'added' | 'removed', text: string) => {
    if (!text) return;
    const last = hunks[hunks.length - 1];
    if (last && last.kind === kind) last.text += text;
    else hunks.push({ kind, text });
  };

  push('same', a.slice(0, start).join(''));
  let i = 0;
  let j = 0;
  while (i < midA.length && j < midB.length) {
    if (midA[i] === midB[j]) { push('same', midA[i]); i += 1; j += 1; }
    else if (table[i + 1][j] >= table[i][j + 1]) { push('removed', midA[i]); i += 1; }
    else { push('added', midB[j]); j += 1; }
  }
  while (i < midA.length) { push('removed', midA[i]); i += 1; }
  while (j < midB.length) { push('added', midB[j]); j += 1; }
  push('same', a.slice(endA).join(''));

  return hunks;
}
