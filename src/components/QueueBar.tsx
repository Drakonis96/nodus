import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { QueueProgress, QueueKind } from '@shared/types';
import { Icon } from './ui';
import { ConfirmModal } from './ConfirmModal';
import { t, tx } from '../i18n';

const KIND_LABELS: Record<QueueKind, string> = {
  light: 'LIGERO',
  deep: 'PROFUNDO',
  summary: 'RESUMEN',
  bridge: 'PUENTES',
};

export function QueueBar() {
  const [progress, setProgress] = useState<QueueProgress | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [confirm, setConfirm] = useState<null | 'clear' | 'stop'>(null);

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
            {t('Escaneo en pausa:')} {pausedReason} {t('Corrígelo en Ajustes y pulsa')} <b>{t('Reanudar')}</b>.
          </span>
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
                  {done + failed} / {total} — {t('Procesando:')} <span className="text-neutral-200">{current.title}</span>{' '}
                  <span className="uppercase text-[10px] tracking-wide">({t(KIND_LABELS[current.kind]) ?? current.kind})</span>
                  {running?.detail && (
                    <span className="text-indigo-300 ml-1">
                      · {running.detail}
                      {running.subPct != null ? ` (${Math.round(running.subPct * 100)}%)` : ''}
                    </span>
                  )}
                </>
              ) : paused ? (
                t('Cola en pausa')
              ) : active ? (
                t('En cola…')
              ) : (
                `${done} ${t('completados')}${failed ? `, ${failed} ${t('fallidos')}` : ''}`
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
        <button
          className="btn btn-ghost"
          title={t('Limpiar la cola (quita los elementos pendientes y terminados)')}
          aria-label={t('Limpiar la cola')}
          onClick={() => setConfirm('clear')}
        >
          <Icon name="trash" size={16} />
        </button>
        {active && (
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
                  <span className="truncate flex-1">{it.title}</span>
                  <span className="uppercase text-[10px] text-neutral-500 mx-2">{t(KIND_LABELS[it.kind]) ?? it.kind}</span>
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
