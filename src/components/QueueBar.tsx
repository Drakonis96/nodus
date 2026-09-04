import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { QueueProgress, QueueKind } from '@shared/types';
import { Icon } from './ui';
import { ConfirmModal } from './ConfirmModal';
import { t, tr, tx } from '../i18n';
import { elapsedTimeLabel } from '@shared/elapsedTime';
import { useElapsedClock } from '../useElapsedClock';

const KIND_LABELS: Record<QueueKind, string> = {
  light: 'LIGERO',
  deep: 'PROFUNDO',
  summary: 'RESUMEN',
  bridge: 'PUENTES',
};

const STATE_LABELS = {
  queued: 'En cola',
  running: 'En curso',
  done: 'Completado',
  failed: 'Fallido',
  cancelled: 'Cancelado',
  paused: 'Pausado',
} as const;

function queueTitle(item: { kind: QueueKind; title: string }): string {
  return item.kind === 'bridge' ? tr(item.title) : item.title;
}

export function QueueBar() {
  const [progress, setProgress] = useState<QueueProgress | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [confirm, setConfirm] = useState<null | 'clear' | 'stop'>(null);

  useEffect(() => {
    void window.nodus.getQueue().then(setProgress);
    return window.nodus.onQueueProgress(setProgress);
  }, []);

  const ticking = Boolean(progress && (
    progress.maintenanceRunning
    || progress.items.some((item) => item.state === 'queued' || item.state === 'running' || item.state === 'paused')
  ));
  const now = useElapsedClock(ticking);

  if (!progress || (progress.total === 0 && !progress.maintenanceError && !progress.maintenanceRunning)) return null;
  const {
    done, failed, total, current, paused, pausedReason, maintenanceError,
    maintenanceRunning, maintenanceDetail, startedAt, finishedAt, items,
  } = progress;
  const terminalItems = items.filter((item) => item.state === 'done' || item.state === 'failed' || item.state === 'cancelled').length;
  const itemPct = total ? Math.round((terminalItems / total) * 100) : 0;
  // Finished scan rows are followed by required graph maintenance. Holding at
  // 99% makes it clear that semantic validation is still live; 100% and the
  // dismiss tick arrive together only after the whole pipeline has settled.
  const pct = maintenanceRunning ? (total ? Math.min(itemPct, 99) : 99) : itemPct;
  const workActive = items.some((item) => item.state === 'queued' || item.state === 'running' || item.state === 'paused');
  const active = workActive || maintenanceRunning;
  const terminal = !active && !maintenanceError;
  const running = items.find((i) => i.state === 'running');
  const totalElapsed = elapsedTimeLabel(startedAt, finishedAt, now);
  const itemElapsed = elapsedTimeLabel(running?.started_at, running?.finished_at, now);

  return (
    <div className="border-t border-neutral-200 bg-neutral-100/80 backdrop-blur px-4 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-900/80">
      {pausedReason && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-1.5 text-amber-700 text-xs dark:bg-amber-950/60 dark:border-amber-800/60 dark:text-amber-300">
          <Icon name="warning" size={14} className="shrink-0" />
          <span className="flex-1">
            {t('Escaneo en pausa:')} {tr(pausedReason)} {t('Corrígelo en Ajustes y pulsa')} <b>{t('Reanudar')}</b>.
          </span>
        </div>
      )}
      {maintenanceError && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/60 dark:text-amber-300">
          <Icon name="warning" size={14} className="shrink-0" />
          <span className="flex-1">{t('Postprocesado del grafo pendiente:')} {tr(maintenanceError)}</span>
          <button className="btn btn-ghost h-7 px-2" onClick={() => window.nodus.resumeQueue()}>{t('Reintentar')}</button>
        </div>
      )}
      <div className="flex items-center gap-3">
        <button className="btn-ghost btn" onClick={() => setExpanded((e) => !e)}>
          {expanded ? '▾' : '▸'} {t('Cola')}
        </button>
        <div className="flex-1">
          <div className="flex justify-between text-xs text-neutral-400 mb-1">
            <span>
              {current ? (
                <>
                  {done + failed} / {total} — {t('Procesando:')} <span className="text-neutral-200">{queueTitle(current)}</span>{' '}
                  <span className="uppercase text-[10px] tracking-wide">({t(KIND_LABELS[current.kind]) ?? current.kind})</span>
                  {running?.detail && (
                    <span className="text-indigo-300 ml-1">
                      · {tr(running.detail)}
                      {running.subPct != null ? ` (${Math.round(running.subPct * 100)}%)` : ''}
                    </span>
                  )}
                  {itemElapsed && <span className="ml-1 tabular-nums text-neutral-500">· {t('Obra')} {itemElapsed}</span>}
                </>
              ) : maintenanceRunning ? (
                <>{tr(maintenanceDetail ?? 'Postprocesando relaciones del grafo…')}</>
              ) : paused ? (
                t('Cola en pausa')
              ) : active ? (
                t('En cola…')
              ) : (
                `${done} ${t('completados')}${failed ? `, ${failed} ${t('fallidos')}` : ''}`
              )}
            </span>
            <span className="shrink-0 tabular-nums">
              {totalElapsed && <span className="mr-3">{t('Total')} {totalElapsed}</span>}
              {pct}%
            </span>
          </div>
          <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-indigo-500"
              animate={{ width: `${pct}%` }}
              transition={{ ease: 'easeOut', duration: 0.4 }}
            />
          </div>
        </div>
        {workActive &&
          (paused ? (
            <button
              className="btn btn-ghost"
              title={t('Reanudar la cola')}
              aria-label={t('Reanudar la cola')}
              onClick={() => window.nodus.resumeQueue()}
            >
              <Icon name="play" size={16} />
            </button>
          ) : (
            <button
              className="btn btn-ghost"
              title={t('Pausar la cola')}
              aria-label={t('Pausar la cola')}
              onClick={() => window.nodus.pauseQueue()}
            >
              <Icon name="pause" size={16} />
            </button>
          ))}
        {failed > 0 && (
          <button
            className="btn btn-ghost text-amber-300"
            title={tx('Reencolar {n} obra(s) cuyo escaneo falló', { n: failed })}
            aria-label={tx('Reintentar {n} fallidos', { n: failed })}
            onClick={() => window.nodus.retryFailed()}
          >
            <Icon name="refresh" size={15} /> {failed}
          </button>
        )}
        {workActive && (
          <button
            className="btn btn-ghost"
            title={t('Limpiar la cola (quita los elementos pendientes y terminados)')}
            aria-label={t('Limpiar la cola')}
            onClick={() => setConfirm('clear')}
          >
            <Icon name="trash" size={16} />
          </button>
        )}
        {terminal && (
          <button
            className={`btn btn-ghost ${failed > 0 ? 'text-amber-400' : 'text-emerald-400'}`}
            title={failed > 0 ? t('Finalizado con fallos · ocultar') : t('Completado · ocultar')}
            aria-label={failed > 0 ? t('Finalizado con fallos · ocultar') : t('Completado · ocultar')}
            onClick={() => void window.nodus.clearQueue()}
          >
            <Icon name={failed > 0 ? 'warning' : 'check'} size={17} />
          </button>
        )}
        {workActive && (
          <button
            className="btn btn-ghost text-red-400 hover:text-red-300"
            title={t('Detener y eliminar todos los elementos de la cola')}
            aria-label={t('Detener y vaciar la cola')}
            onClick={() => setConfirm('stop')}
          >
            <Icon name="stop" size={16} />
          </button>
        )}
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-2 max-h-48 overflow-y-auto divide-y divide-neutral-800">
              {items.map((it) => (
                <div key={it.id} className="flex items-center justify-between py-1 text-xs">
                  <span className="truncate flex-1">{queueTitle(it)}</span>
                  <span className="uppercase text-[10px] text-neutral-500 mx-2">{t(KIND_LABELS[it.kind]) ?? it.kind}</span>
                  <span
                    // The queue has always carried why an item failed and never shown it,
                    // so a failure read as a bare "Fallido" and the reason lived only in
                    // the DevTools console. Hover the state to read it.
                    title={it.error ? tr(it.error) : undefined}
                    className={
                      it.state === 'done'
                        ? 'text-emerald-400'
                        : it.state === 'failed'
                          ? 'cursor-help text-red-400 underline decoration-dotted underline-offset-2'
                          : it.state === 'running'
                            ? 'text-indigo-400'
                            : 'text-neutral-500'
                    }
                  >
                    <span className="inline-flex items-center gap-1">
                      {it.state === 'done' && <Icon name="check" size={12} />}
                      {t(STATE_LABELS[it.state])}
                    </span>
                  </span>
                  {elapsedTimeLabel(it.started_at, it.finished_at, now) && (
                    <span className="ml-2 min-w-[5.5rem] text-right tabular-nums text-neutral-500">
                      {elapsedTimeLabel(it.started_at, it.finished_at, now)}
                    </span>
                  )}
                  {it.state === 'queued' && (
                    <button
                      className="ml-2 inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-800 hover:text-indigo-300"
                      title={t('Mover al principio de la cola')}
                      aria-label={`${t('Mover al principio de la cola')}: ${it.title}`}
                      onClick={() => window.nodus.moveQueueItemToTop(it.id)}
                    >
                      <Icon name="arrowUp" size={13} />
                    </button>
                  )}
                  {(it.state === 'queued' || it.state === 'paused' || it.state === 'running') && (
                    <button
                      className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-800 hover:text-red-400"
                      title={it.state === 'running' ? t('Detener y eliminar de la cola') : t('Eliminar de la cola')}
                      aria-label={`${it.state === 'running' ? t('Detener y eliminar de la cola') : t('Eliminar de la cola')}: ${it.title}`}
                      onClick={() => window.nodus.removeQueueItem(it.id)}
                    >
                      <Icon name={it.state === 'running' ? 'stop' : 'x'} size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {confirm === 'clear' && (
        <ConfirmModal
          title={t('Limpiar la cola')}
          message={t('Se quitarán de la cola los elementos pendientes y los ya terminados. El elemento en curso seguirá procesándose.')}
          confirmLabel={t('Limpiar')}
          onConfirm={() => {
            void window.nodus.clearQueue();
            setConfirm(null);
          }}
          onCancel={() => setConfirm(null)}
        />
      )}

      {confirm === 'stop' && (
        <ConfirmModal
          title={t('Detener y vaciar la cola')}
          message={t('Se detendrá el escaneo en curso y se eliminarán todos los elementos de la cola. Esta acción no se puede deshacer.')}
          confirmLabel={t('Detener y vaciar')}
          danger
          onConfirm={() => {
            void window.nodus.stopQueue();
            setConfirm(null);
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
