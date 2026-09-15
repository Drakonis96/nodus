import { motion } from 'framer-motion';
import type { ZoteroImportProgress } from '@shared/libraryTypes';
import { Icon } from './ui';
import { t, tr } from '../i18n';
import { elapsedTimeLabel } from '@shared/elapsedTime';
import { useElapsedClock } from '../useElapsedClock';

const PHASE_LABEL: Record<ZoteroImportProgress['phase'], string> = {
  inventory: 'Inventariando Zotero…',
  connecting: 'Conectando con Zotero…',
  collections: 'Leyendo colecciones…',
  catalog: 'Catalogando…',
  notes: 'Leyendo notas…',
  attachments: 'Copiando archivos…',
  rebuild: 'Verificando el índice local…',
  verification: 'Comprobando integridad de la importación…',
  complete: 'Importación completada',
  canceled: 'Importación cancelada',
  failed: 'No se pudo completar la importación',
};

const FINISHED: ZoteroImportProgress['phase'][] = ['complete', 'canceled', 'failed'];

/**
 * The import runs in the main process and outlives the dialog that started it, but
 * until now its only readout WAS that dialog: close it and a multi-hour Zotero import
 * became invisible. Worse, the catalogue is published before a single file is copied,
 * so every item shows "No file" while the copy is still running — with nothing on
 * screen saying so, a healthy import in progress is indistinguishable from a broken
 * one. This bar is that missing readout, and it counts files, not just records.
 */
export function ZoteroImportProgressBar({ progress, onDismiss }: { progress: ZoteroImportProgress | null; onDismiss: () => void }) {
  const live = Boolean(progress && !FINISHED.includes(progress.phase));
  const now = useElapsedClock(live);
  if (!progress) return null;

  const { phase, percent, libraryName, message, processedItems, totalItems, processedAttachments, totalAttachments } = progress;
  const done = FINISHED.includes(phase);
  const failed = phase === 'failed';
  const cancelled = phase === 'canceled';
  const totalElapsed = elapsedTimeLabel(progress.startedAt, progress.finishedAt, now);
  const itemElapsed = elapsedTimeLabel(progress.currentItemStartedAt, null, now);

  return (
    <div className="border-t border-neutral-200 bg-neutral-100/80 px-4 py-2 text-sm backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/80" data-testid="zotero-progress-bar">
      <div className="flex flex-wrap items-center gap-3">
        <span className="mr-auto whitespace-nowrap text-xs font-medium text-amber-500">{t('Zotero')}</span>
        <div className="order-last min-w-0 basis-full">
          <div className="mb-1 flex flex-col gap-2 text-xs text-neutral-400">
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">
              <span className={failed ? 'text-red-400' : done ? 'text-emerald-400' : 'text-neutral-200'}>{t(PHASE_LABEL[phase])}</span>
              {libraryName && <span className="ml-1 text-neutral-500">· {libraryName}</span>}
              {!done && message && <span className="ml-1 text-neutral-600">· {tr(message)}</span>}
            </span>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
              {/* Both counters, always: the catalogue finishing is not the import
                  finishing, and the file count is the half users were missing. */}
              <span>{t('Documentos')} {processedItems.toLocaleString()}/{totalItems.toLocaleString()}</span>
              {!done && progress.currentItem && itemElapsed && (
                <span className="max-w-52 truncate" title={progress.currentItem}>
                  {t('Elemento')} {itemElapsed}
                </span>
              )}
              <span className={phase === 'attachments' ? 'text-amber-400' : ''}>
                {t('Archivos')} {processedAttachments.toLocaleString()}
                {totalAttachments > processedAttachments ? `/${totalAttachments.toLocaleString()}` : ''}
              </span>
              {totalElapsed && <span>{t('Total')} {totalElapsed}</span>}
              <span>{percent}%</span>
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-neutral-800">
            <motion.div
              className={`h-full ${failed ? 'bg-red-500' : done ? 'bg-emerald-500' : 'bg-amber-500'}`}
              animate={{ width: `${percent}%` }}
              transition={{ ease: 'easeOut', duration: 0.4 }}
            />
          </div>
        </div>
        {!done && (
          <button
            className="btn btn-ghost text-red-400 hover:text-red-300"
            title={t('Cancelar importación')}
            aria-label={t('Cancelar importación')}
            onClick={() => void window.nodus.cancelZoteroLibraryImport(progress.requestId)}
          >
            <Icon name="stop" size={16} />
          </button>
        )}
        {done && (
          <button
            className={`btn btn-ghost ${failed ? 'text-amber-400' : cancelled ? 'text-neutral-400' : 'text-emerald-400'}`}
            title={t('Ocultar la importación terminada')}
            aria-label={t('Ocultar la importación terminada')}
            onClick={onDismiss}
          >
            <Icon name={failed ? 'warning' : cancelled ? 'x' : 'check'} size={17} />
          </button>
        )}
      </div>
    </div>
  );
}
