import type { ChartSpec } from '@shared/types';

const CHART_PALETTE = ['#b30333', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#ef4444'];

/** A horizontal bar list — the building block for distributions, histograms and charts. */
export function BarList({ items }: { items: { label: string; count: number; color?: string | null }[] }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div className="flex flex-col gap-1">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span className="w-28 truncate text-neutral-400 shrink-0" title={it.label}>
            {it.label}
          </span>
          <div className="flex-1 h-4 rounded bg-neutral-800/60 overflow-hidden">
            <div className="h-full rounded" style={{ width: `${(it.count / max) * 100}%`, backgroundColor: it.color || CHART_PALETTE[i % CHART_PALETTE.length] }} />
          </div>
          <span className="w-8 text-right text-neutral-500 shrink-0">{it.count}</span>
        </div>
      ))}
    </div>
  );
}

/** A native, code-free renderer for a model-provided chart spec. */
export function ChartFromSpec({ spec }: { spec: ChartSpec }) {
  const items = spec.items.map((it, i) => ({ ...it, color: it.color || CHART_PALETTE[i % CHART_PALETTE.length] }));
  const total = items.reduce((s, it) => s + Math.max(0, it.value), 0) || 1;
  return (
    <div className="card p-3 my-2">
      {spec.title && <div className="text-sm font-medium mb-2">{spec.title}</div>}
      {spec.type === 'pie' ? (
        <>
          <div className="flex h-4 rounded overflow-hidden">
            {items.map((it, i) => (
              <div key={i} title={`${it.label}: ${it.value}`} style={{ width: `${(Math.max(0, it.value) / total) * 100}%`, backgroundColor: it.color ?? undefined }} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs">
            {items.map((it, i) => (
              <span key={i} className="flex items-center gap-1 text-neutral-400">
                <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: it.color ?? undefined }} />
                {it.label} · {Math.round((Math.max(0, it.value) / total) * 100)}%
              </span>
            ))}
          </div>
        </>
      ) : (
        <BarList items={items.map((it) => ({ label: it.label, count: it.value, color: it.color }))} />
      )}
    </div>
  );
}
