import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { ZoteroImportProgress } from '@shared/libraryTypes';
import { Icon } from './ui';
import { t } from '../i18n';

const PHASE_LABEL: Record<ZoteroImportProgress['phase'], string> = {
  connecting: 'Conectando con Zotero…',
  collections: 'Leyendo colecciones…',
  catalog: 'Catalogando…',
  notes: 'Leyendo notas…',
  attachments: 'Copiando archivos…',
  rebuild: 'Verificando el índice local…',
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
export function ZoteroImportProgressBar() {
  const [progress, setProgress] = useState<ZoteroImportProgress | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    // A session is only worth restoring while it is genuinely alive: the import dies
    // with the process, so a "running" session left behind by a crash must not put a
    // frozen bar on screen for the rest of the session.
    void window.nodus.listZoteroSyncSessions().then((sessions) => {
      const live = sessions.find((session) => session.status === 'running'
        && Date.now() - Date.parse(session.updatedAt) < 60_000);
      if (live) setProgress((current) => current ?? live.progress);
    }).catch(() => undefined);
    return window.nodus.onZoteroImportProgress(setProgress);
  }, []);

  if (!progress || dismissed === progress.requestId) return null;

  const { phase, percent, libraryName, message, processedItems, totalItems, processedAttachments, totalAttachments } = progress;
  const done = FINISHED.includes(phase);
  const failed = phase === 'failed';

  return (
    <div className="border-t border-neutral-200 bg-neutral-100/80 px-4 py-2 text-sm backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/80">
      <div className="flex items-center gap-3">
        <span className="whitespace-nowrap text-xs font-medium text-amber-500">Zotero</span>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex justify-between gap-4 text-xs text-neutral-400">
            <span className="min-w-0 truncate">
              <span className={failed ? 'text-red-400' : done ? 'text-emerald-400' : 'text-neutral-200'}>{t(PHASE_LABEL[phase])}</span>
              {libraryName && <span className="ml-1 text-neutral-500">· {libraryName}</span>}
              {!done && message && <span className="ml-1 text-neutral-600">· {message}</span>}
            </span>
            <span className="flex shrink-0 items-center gap-3 tabular-nums">
              {/* Both counters, always: the catalogue finishing is not the import
                  finishing, and the file count is the half users were missing. */}
              <span>{t('Documentos')} {processedItems.toLocaleString()}/{totalItems.toLocaleString()}</span>
              <span className={phase === 'attachments' ? 'text-amber-400' : ''}>
                {t('Archivos')} {processedAttachments.toLocaleString()}
                {totalAttachments > processedAttachments ? `/${totalAttachments.toLocaleString()}` : ''}
              </span>
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
            className="btn btn-ghost"
            title={t('Ocultar la importación terminada')}
            aria-label={t('Ocultar la importación terminada')}
            onClick={() => setDismissed(progress.requestId)}
          >
            <Icon name="trash" size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
