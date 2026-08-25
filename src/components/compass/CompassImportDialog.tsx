import { Icon } from '../ui';
import { compassT } from '../../i18n.compass';
import type { CompassImportEvent } from './types';
import { useCompassModal } from './useCompassModal';

export function CompassImportDialog({ progress, onCancel, onRetry, onClose }: { progress: CompassImportEvent | null; onCancel: () => void; onRetry: () => void; onClose: () => void }) {
  const modal = useCompassModal(!!progress, onClose);
  if (!progress) return null;
  const { job } = progress;
  const running = job.state === 'queued' || job.state === 'running';
  const percent = job.total ? Math.min(100, Math.round((job.completed / job.total) * 100)) : 0;
  return <div ref={modal.dialogRef} tabIndex={-1} onKeyDown={modal.onKeyDown} className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-labelledby="compass-import-title">
    <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-5 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
      <div className="flex items-start justify-between"><div><h2 id="compass-import-title" className="text-base font-semibold">{compassT('Importando…')}</h2><p className="mt-1 text-xs text-neutral-500">{job.completed} / {job.total} · {job.failed} {compassT('Fallidos')}</p></div><button type="button" className="icon-btn" aria-label={compassT('Cerrar')} onClick={onClose}><Icon name="x" size={15} /></button></div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800"><div className="h-full rounded-full bg-indigo-600 transition-[width]" style={{ width: `${percent}%` }} /></div>
      <div className="mt-4 flex justify-end gap-2">{running && <button type="button" className="btn btn-ghost h-8 text-xs" onClick={onCancel}>{compassT('Cancelar')}</button>}{job.state === 'failed' && <button type="button" className="btn btn-primary h-8 text-xs" onClick={onRetry}>{compassT('Reintentar')}</button>}{!running && <button type="button" className="btn btn-primary h-8 text-xs" onClick={onClose}>{compassT('Cerrar')}</button>}</div>
    </div>
  </div>;
}
