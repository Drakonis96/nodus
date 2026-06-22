import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { EmbeddingPipelineProgress } from '@shared/types';
import { Icon } from './ui';
import { t, tx } from '../i18n';

export function EmbeddingProgressBar() {
  const [progress, setProgress] = useState<EmbeddingPipelineProgress | null>(null);

  useEffect(() => {
    void window.nodus.getEmbeddingStatus().then(setProgress);
    return window.nodus.onEmbeddingProgress(setProgress);
  }, []);

  if (!progress || (!progress.running && progress.totalIdeas === 0 && !progress.error)) return null;

  const { running, paused, totalWorks, currentWorkTitle, ideasEmbedded, totalIdeas, currentWorkIndex, currentIdeaIndex, currentWorkIdeas, error } = progress;
  const pct = totalIdeas > 0 ? Math.round((ideasEmbedded / totalIdeas) * 100) : 0;
  const active = running || paused;

  return (
    <div className="border-t border-neutral-800 bg-neutral-900/80 backdrop-blur px-4 py-2 text-sm">
      {error && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-red-950/60 border border-red-800/60 px-3 py-1.5 text-red-300 text-xs">
          <span>{t('Error')}: {error}</span>
        </div>
      )}
      <div className="flex items-center gap-3">
        <span className="text-xs text-cyan-400 font-medium whitespace-nowrap">Embeddings</span>
        <div className="flex-1">
          <div className="flex justify-between text-xs text-neutral-400 mb-1">
            <span>
              {active ? (
                <>
                  {currentWorkTitle ? (
                    <>
                      {t('Obra')} {currentWorkIndex + 1}/{totalWorks}:{' '}
                      <span className="text-neutral-200">{currentWorkTitle}</span>
                      <span className="text-cyan-300 ml-1">
                        · {t('idea')} {currentIdeaIndex + 1}/{currentWorkIdeas}
                      </span>
                    </>
                  ) : (
                    t('Preparando…')
                  )}
                </>
              ) : error ? (
                t('Indexación detenida por error')
              ) : (
                tx('{n} ideas indexadas', { n: ideasEmbedded })
              )}
            </span>
            <span>{pct}%</span>
          </div>
          <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-cyan-500"
              animate={{ width: `${pct}%` }}
              transition={{ ease: 'easeOut', duration: 0.4 }}
            />
          </div>
        </div>
        {active &&
          (paused ? (
            <button
              className="btn btn-ghost"
              title={t('Reanudar indexación')}
              aria-label={t('Reanudar indexación')}
              onClick={() => window.nodus.resumeEmbedding()}
            >
              <Icon name="play" size={16} />
            </button>
          ) : (
            <button
              className="btn btn-ghost"
              title={t('Pausar indexación')}
              aria-label={t('Pausar indexación')}
              onClick={() => window.nodus.pauseEmbedding()}
            >
              <Icon name="pause" size={16} />
            </button>
          ))}
        {active && (
          <button
            className="btn btn-ghost text-red-400 hover:text-red-300"
            title={t('Detener indexación')}
            aria-label={t('Detener indexación')}
            onClick={() => window.nodus.stopEmbedding()}
          >
            <Icon name="stop" size={16} />
          </button>
        )}
        {!active && (
          <button
            className="btn btn-ghost"
            title={t('Ocultar cola de embeddings terminada')}
            aria-label={t('Ocultar cola de embeddings terminada')}
            onClick={() => void window.nodus.clearEmbeddingProgress()}
          >
            <Icon name="trash" size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
