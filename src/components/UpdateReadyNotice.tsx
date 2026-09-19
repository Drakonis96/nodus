import { useState } from 'react';
import type { UpdateProgressEvent } from '@shared/types';
import { canInstallUpdate, installUpdateManually, updateInstallBusy, updateStatusMessage } from '../updateStatus';
import { t } from '../i18n';
import { Icon } from './ui';

/** An in-flow banner leaves the workspace usable, including native browser views. */
export function UpdateReadyNotice({ update, onUpdate, onLater, onRecovery }: {
  update: UpdateProgressEvent;
  onUpdate: (update: UpdateProgressEvent) => void;
  onLater: () => void;
  onRecovery: () => void;
}) {
  const [requesting, setRequesting] = useState(false);
  const busy = requesting || updateInstallBusy(update);
  const canInstall = canInstallUpdate(update);
  const downloading = update.status === 'downloading';
  const progress = Math.round(Math.max(0, Math.min(100, update.progress ?? 0)));
  const needsRecovery = update.errorCode === 'pre-update-backup-required' || update.errorCode === 'pre-update-backup-failed';
  const install = async () => {
    if (busy) return;
    setRequesting(true);
    onUpdate(await installUpdateManually(update));
    setRequesting(false);
  };
  return <aside data-testid="update-ready-notice" data-update-status={update.status} aria-label={t('Actualizaciones')} className="flex shrink-0 flex-wrap items-center gap-3 border-b border-indigo-200 bg-indigo-50 px-4 py-2 text-sm text-neutral-900 dark:border-indigo-800 dark:bg-neutral-900 dark:text-neutral-100">
    <Icon name={update.status === 'error' ? 'alert' : update.status === 'checking' || busy ? 'refresh' : 'download'} size={17} className={update.status === 'checking' || busy ? 'animate-spin motion-reduce:animate-none' : ''} />
    <div className="min-w-48 flex-1">
      <p className="text-xs" role="status">{updateStatusMessage(update)}{downloading && update.version && <span className="ml-2 font-semibold">v{update.version}</span>}</p>
      {downloading && <div role="progressbar" aria-label={t('Progreso')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} className="mt-2 h-1 overflow-hidden rounded-full bg-indigo-200 dark:bg-indigo-950">
        <div className="h-full rounded-full bg-indigo-500 transition-[width] duration-300 motion-reduce:transition-none dark:bg-indigo-400" style={{ width: `${progress}%` }} />
      </div>}
    </div>
    {needsRecovery && <button className="btn btn-ghost text-xs" onClick={onRecovery}>{t('Configurar Recuperación')}</button>}
    {canInstall && <button className="btn btn-primary text-xs" disabled={busy} onClick={() => void install()}>{t('Instalar y reiniciar')}</button>}
    {canInstall && !busy && <button className="btn btn-ghost text-xs" onClick={onLater}>{t('Más tarde')}</button>}
  </aside>;
}
