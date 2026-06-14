import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { QueueProgress } from '@shared/types';

export function QueueBar() {
  const [progress, setProgress] = useState<QueueProgress | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    void window.nodus.getQueue().then(setProgress);
    return window.nodus.onQueueProgress(setProgress);
  }, []);

  if (!progress || progress.total === 0) return null;
  const { done, failed, total, current, paused, pausedReason, items } = progress;
  const pct = total ? Math.round(((done + failed) / total) * 100) : 0;
  const active = done + failed < total;
  const running = items.find((i) => i.state === 'running');

  return (
    <div className="border-t border-neutral-800 bg-neutral-900/80 backdrop-blur px-4 py-2 text-sm">
      {pausedReason && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-amber-950/60 border border-amber-800/60 px-3 py-1.5 text-amber-300 text-xs">
          <span>⚠</span>
          <span className="flex-1">
            Escaneo en pausa: {pausedReason} Corrígelo en Ajustes y pulsa <b>Reanudar</b>.
          </span>
        </div>
      )}
      <div className="flex items-center gap-3">
        <button className="btn-ghost btn" onClick={() => setExpanded((e) => !e)}>
          {expanded ? '▾' : '▸'} Cola
        </button>
        <div className="flex-1">
          <div className="flex justify-between text-xs text-neutral-400 mb-1">
            <span>
              {current ? (
                <>
                  {done + failed} / {total} — Procesando: <span className="text-neutral-200">{current.title}</span>{' '}
                  <span className="uppercase text-[10px] tracking-wide">({current.kind})</span>
                  {running?.detail && (
                    <span className="text-indigo-300 ml-1">
                      · {running.detail}
                      {running.subPct != null ? ` (${Math.round(running.subPct * 100)}%)` : ''}
                    </span>
                  )}
                </>
              ) : paused ? (
                'Cola en pausa'
              ) : active ? (
                'En cola…'
              ) : (
                `${done} completados${failed ? `, ${failed} fallidos` : ''}`
              )}
            </span>
            <span>{pct}%</span>
          </div>
          <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-indigo-500"
              animate={{ width: `${pct}%` }}
              transition={{ ease: 'easeOut', duration: 0.4 }}
            />
          </div>
        </div>
        {active &&
          (paused ? (
            <button className="btn btn-ghost" onClick={() => window.nodus.resumeQueue()}>
              Reanudar
            </button>
          ) : (
            <button className="btn btn-ghost" onClick={() => window.nodus.pauseQueue()}>
              Pausar
            </button>
          ))}
        {failed > 0 && (
          <button
            className="btn btn-ghost text-amber-300"
            title="Reencola las obras cuyo escaneo falló"
            onClick={() => window.nodus.retryFailed()}
          >
            Reintentar fallidos ({failed})
          </button>
        )}
        <button className="btn btn-ghost" onClick={() => window.nodus.clearQueue()}>
          Limpiar
        </button>
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
                  <span className="truncate flex-1">{it.title}</span>
                  <span className="uppercase text-[10px] text-neutral-500 mx-2">{it.kind}</span>
                  <span
                    className={
                      it.state === 'done'
                        ? 'text-emerald-400'
                        : it.state === 'failed'
                          ? 'text-red-400'
                          : it.state === 'running'
                            ? 'text-indigo-400'
                            : 'text-neutral-500'
                    }
                  >
                    {it.state}
                  </span>
                  {(it.state === 'queued' || it.state === 'paused') && (
                    <button
                      className="ml-2 text-neutral-500 hover:text-red-400"
                      onClick={() => window.nodus.cancelQueueItem(it.id)}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
