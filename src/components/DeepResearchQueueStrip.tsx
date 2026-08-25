// The strip above the Deep Research gallery: what is being generated right now,
// how far along it is, and what is waiting behind it.
//
// One durable lane receives reports from this window and from MCP clients. The strip
// only needs their presentation shape and keeps the real job id for cancellation.
import type { DeepResearchProgress } from '@shared/types';
import { deepResearchProgressPercent } from '@shared/deepResearchProgress';
import { Icon } from './ui';
import { t, tx } from '../i18n';

/** One row of the strip, whichever lane it came from. */
export interface QueueStripItem {
  id: string;
  title: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  /** The live progress of this report, already attributed to the right lane. */
  progress: DeepResearchProgress | null;
  error: string | null;
  origin: 'app' | 'mcp';
  enqueuedAt: string;
}

/** Marks a report someone asked for through MCP, so a queue the user did not fill is not a mystery. */
function OriginBadge() {
  return (
    <span
      className="shrink-0 rounded border border-indigo-800/70 bg-indigo-950/40 px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-indigo-300"
      title={t('Pedido desde un cliente MCP')}
    >
      MCP
    </span>
  );
}

export function progressDetail(progress: DeepResearchProgress | null): string | null {
  if (!progress) return null;
  return progress.pagesSoFar != null ? `${progress.message} · ~${progress.pagesSoFar} ${t('pág.')}` : progress.message;
}

/**
 * The bar under the report being generated.
 *
 * A report takes minutes, so a spinner and a sentence left no way to tell one that
 * had just started from one about to land — least of all with several queued behind
 * it. The percentage comes from the phases the pipeline already reports (see
 * shared/deepResearchProgress.ts), so it is measured work, not a timer.
 */
function QueueProgressBar({ progress }: { progress: DeepResearchProgress | null }) {
  const percent = deepResearchProgressPercent(progress);
  return (
    <div
      className="mt-1.5 h-1.5 overflow-hidden rounded bg-neutral-800"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
      aria-label={t('Progreso del informe en curso')}
      data-testid="deep-research-progress"
    >
      <div
        className="h-full bg-indigo-500 transition-all duration-500"
        // A bar at literal 0% looks broken rather than early, so the first sliver is
        // always visible once the report is actually running.
        style={{ width: `${Math.max(percent ?? 0, 3)}%` }}
      />
    </div>
  );
}

export function DeepResearchQueueStrip({
  active,
  failed,
  running,
  onRemove,
  onClearFinished,
}: {
  active: QueueStripItem[];
  failed: QueueStripItem[];
  running: boolean;
  onRemove: (item: QueueStripItem) => void;
  onClearFinished: () => void;
}) {
  return (
    <div className="border-b border-neutral-800 bg-indigo-950/15 px-4 py-2.5">
      <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-indigo-300">
        <Icon name={running ? 'sync' : 'layers'} size={12} className={running ? 'animate-spin' : ''} />
        {tx('Cola de generación · {n} en curso', { n: active.length })}
        {failed.length > 0 && (
          <button className="ml-auto text-[11px] font-medium text-neutral-500 hover:text-neutral-300" onClick={onClearFinished}>
            {t('Limpiar fallidos')}
          </button>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        {active.map((item, index) => {
          const ahead = active.slice(0, index).length;
          const percent = item.status === 'running' ? deepResearchProgressPercent(item.progress) : null;
          return (
            <div key={item.id} className="rounded-md border border-neutral-800 bg-neutral-950/40 px-2.5 py-1.5 text-xs">
              <div className="flex items-center gap-2">
                <Icon
                  name={item.status === 'running' ? 'sync' : 'clock'}
                  size={12}
                  className={item.status === 'running' ? 'animate-spin text-indigo-300' : 'text-neutral-500'}
                />
                <span className="min-w-0 flex-1 truncate text-neutral-300" title={item.title}>{item.title}</span>
                {item.origin === 'mcp' && <OriginBadge />}
                {item.status === 'running' ? (
                  <>
                    <span className="shrink-0 text-[11px] text-indigo-300">{progressDetail(item.progress) ?? t('Generando…')}</span>
                    {percent !== null && (
                      <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-indigo-400">{percent}%</span>
                    )}
                  </>
                ) : (
                  <span className="shrink-0 text-[11px] text-neutral-500">
                    {ahead > 0 ? tx('En cola · {n} por delante', { n: ahead }) : t('En cola')}
                  </span>
                )}
                <button
                  className="shrink-0 rounded p-0.5 text-neutral-500 hover:bg-red-950/50 hover:text-red-400"
                  onClick={() => onRemove(item)}
                  title={t('Quitar de la cola')}
                  aria-label={t('Quitar de la cola')}
                  data-testid={`remove-deep-research-${item.id}`}
                >
                  <Icon name="trash" size={13} />
                </button>
              </div>
              {item.status === 'running' && <QueueProgressBar progress={item.progress} />}
            </div>
          );
        })}
        {failed.map((item) => (
          <div key={item.id} className="flex items-center gap-2 rounded-md border border-red-900/50 bg-red-950/20 px-2.5 py-1.5 text-xs">
            <Icon name="alert" size={12} className="text-red-400" />
            <span className="min-w-0 flex-1 truncate text-red-300" title={item.error ?? item.title}>{item.title}</span>
            {item.origin === 'mcp' && <OriginBadge />}
            <span className="shrink-0 text-[11px] text-red-400/80">{t('Falló')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
