import { passageVisible } from '../queueActivity';
import { motion } from 'framer-motion';
import type { PassageEmbeddingProgress } from '@shared/types';
import { Icon } from './ui';
import { t, tr, tx } from '../i18n';
import { elapsedTimeLabel } from '@shared/elapsedTime';
import { useElapsedClock } from '../useElapsedClock';

export function PassageProgressBar({ progress }: { progress: PassageEmbeddingProgress | null }) {


  const now = useElapsedClock(Boolean(progress && (progress.running || progress.paused)));
  if (!progress || !passageVisible(progress)) return null;
  const {
    running,
    paused,
    cancelled,
    startedAt,
    finishedAt,
    currentWorkStartedAt,
    currentWorkFinishedAt,
    totalWorks,
    currentWorkTitle,
    passagesEmbedded,
    totalPassages,
    currentWorkIndex,
    currentPassageIndex,
    currentWorkPassages,
    error,
  } = progress;
  const pct = totalPassages > 0 ? Math.round((passagesEmbedded / totalPassages) * 100) : 0;
  const active = running || paused;
  const totalElapsed = elapsedTimeLabel(startedAt, finishedAt, now);
  const workElapsed = elapsedTimeLabel(currentWorkStartedAt, currentWorkFinishedAt, now);

  return (
    <div className="border-t border-neutral-200 bg-neutral-100/80 backdrop-blur px-4 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-900/80" data-testid="passages-progress-bar">
      {error && <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700 dark:border-red-800/60 dark:bg-red-950/60 dark:text-red-300">{t('Error')}: {tr(error)}</div>}
      <div className="flex flex-wrap items-center gap-3">
        <span className="mr-auto text-xs font-medium whitespace-nowrap text-green-400">{t('Pasajes')}</span>
        <div className="order-last min-w-0 basis-full">
          <div className="mb-1 flex flex-wrap justify-between gap-2 text-xs text-neutral-400">
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">
              {active ? (
                currentWorkTitle ? <>{t('Obra')} {currentWorkIndex + 1}/{totalWorks}: <span className="text-neutral-200">{currentWorkTitle}</span><span className="ml-1 text-green-300">· {currentWorkPassages > 0 ? <>{t('pasaje')} {currentPassageIndex + 1}/{currentWorkPassages}</> : t('Preparando…')}</span>{workElapsed && <span className="ml-1 tabular-nums text-neutral-500">· {t('Obra')} {workElapsed}</span>}</> : t('Preparando…')
              ) : error ? t('Indexación detenida por error') : cancelled ? t('Indexación cancelada') : tx('{n} pasajes indexados', { n: passagesEmbedded })}
            </span>
            <span className="shrink-0 tabular-nums">{totalElapsed && <span className="mr-3">{t('Total')} {totalElapsed}</span>}{pct}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-neutral-800"><motion.div className="h-full bg-green-500" animate={{ width: `${pct}%` }} transition={{ ease: 'easeOut', duration: 0.4 }} /></div>
        </div>
        {active && (paused ? <button className="btn btn-ghost" title={t('Reanudar indexación')} onClick={() => window.nodus.resumePassageEmbedding()}><Icon name="play" size={16} /></button> : <button className="btn btn-ghost" title={t('Pausar indexación')} onClick={() => window.nodus.pausePassageEmbedding()}><Icon name="pause" size={16} /></button>)}
        {active && <button className="btn btn-ghost text-red-400 hover:text-red-300" title={t('Detener indexación')} onClick={() => window.nodus.stopPassageEmbedding()}><Icon name="stop" size={16} /></button>}
        {!active && <button className={`btn btn-ghost ${error ? 'text-amber-400' : cancelled ? 'text-neutral-400' : 'text-emerald-400'}`} title={t('Ocultar cola de pasajes terminada')} aria-label={t('Ocultar cola de pasajes terminada')} onClick={() => void window.nodus.clearPassageProgress()}><Icon name={error ? 'warning' : cancelled ? 'x' : 'check'} size={17} /></button>}
      </div>
    </div>
  );
}
