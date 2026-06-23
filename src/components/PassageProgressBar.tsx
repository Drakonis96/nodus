import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { PassageEmbeddingProgress } from '@shared/types';
import { Icon } from './ui';
import { t, tx } from '../i18n';

export function PassageProgressBar() {
  const [progress, setProgress] = useState<PassageEmbeddingProgress | null>(null);

  useEffect(() => {
    void window.nodus.getPassageStatus().then(setProgress);
    return window.nodus.onPassageProgress(setProgress);
  }, []);

  if (!progress || (!progress.running && progress.totalPassages === 0 && !progress.error)) return null;
  const {
    running,
    paused,
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

  return (
    <div className="border-t border-neutral-800 bg-neutral-900/80 backdrop-blur px-4 py-2 text-sm">
      {error && <div className="mb-2 rounded-lg border border-red-800/60 bg-red-950/60 px-3 py-1.5 text-xs text-red-300">{t('Error')}: {error}</div>}
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium whitespace-nowrap text-green-400">{t('Pasajes')}</span>
        <div className="flex-1">
          <div className="mb-1 flex justify-between text-xs text-neutral-400">
            <span>
              {active ? (
                currentWorkTitle ? <>{t('Obra')} {currentWorkIndex + 1}/{totalWorks}: <span className="text-neutral-200">{currentWorkTitle}</span><span className="ml-1 text-green-300">· {t('pasaje')} {currentPassageIndex + 1}/{currentWorkPassages}</span></> : t('Preparando…')
              ) : error ? t('Indexación detenida por error') : tx('{n} pasajes indexados', { n: passagesEmbedded })}
            </span>
            <span>{pct}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-neutral-800"><motion.div className="h-full bg-green-500" animate={{ width: `${pct}%` }} transition={{ ease: 'easeOut', duration: 0.4 }} /></div>
        </div>
        {active && (paused ? <button className="btn btn-ghost" title={t('Reanudar indexación')} onClick={() => window.nodus.resumePassageEmbedding()}><Icon name="play" size={16} /></button> : <button className="btn btn-ghost" title={t('Pausar indexación')} onClick={() => window.nodus.pausePassageEmbedding()}><Icon name="pause" size={16} /></button>)}
        {active && <button className="btn btn-ghost text-red-400 hover:text-red-300" title={t('Detener indexación')} onClick={() => window.nodus.stopPassageEmbedding()}><Icon name="stop" size={16} /></button>}
        {!active && <button className="btn btn-ghost" title={t('Ocultar cola de pasajes terminada')} onClick={() => void window.nodus.clearPassageProgress()}><Icon name="trash" size={16} /></button>}
      </div>
    </div>
  );
}
