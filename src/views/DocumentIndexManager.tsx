import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DocumentIndexJobPhase, DocumentIndexJobStatus, DocumentIndexProgress, DocumentUnderstandingState } from '@shared/types';
import { Icon } from '../components/ui';
import { ConfirmModal } from '../components/ConfirmModal';
import { t, tx } from '../i18n';

export function DocumentIndexManager({ vaultId, onClose }: { vaultId: string | null; onClose: () => void }) {
  const [progress, setProgress] = useState<DocumentIndexProgress>({ campaigns: [], jobs: [], active: 0, queued: 0, failed: 0 });
  const [states, setStates] = useState<Array<{ nodusId: string; status: DocumentUnderstandingState }>>([]);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const refreshStates = useCallback(() => {
    void window.nodus.getDocumentProfileStatuses().then(setStates);
  }, []);
  useEffect(() => {
    void window.nodus.getDocumentIndexProgress().then(setProgress);
    refreshStates();
    return window.nodus.onDocumentIndexProgress((next) => {
      setProgress(next);
      refreshStates();
    });
  }, [refreshStates]);
  const campaigns = useMemo(() => progress.campaigns.filter((item) => !vaultId || item.vaultId === vaultId), [progress, vaultId]);
  const jobs = useMemo(() => progress.jobs.filter((item) => !vaultId || item.vaultId === vaultId), [progress, vaultId]);
  const live = campaigns.find((item) => ['queued', 'running', 'paused'].includes(item.status)) ?? null;
  const liveError = live
    ? jobs.find((job) => job.campaignId === live.campaignId && job.error && ['paused', 'failed', 'unavailable'].includes(job.status))?.error ?? live.error
    : null;
  const start = async () => { setBusy(true); try { await window.nodus.startDocumentIndexCampaign({ includeArchived }); } finally { setBusy(false); } };
  const setStatus = async (status: 'running' | 'paused' | 'cancelled') => { if (!live) return; setBusy(true); try { await window.nodus.setDocumentIndexCampaignStatus(live.vaultId, live.campaignId, status); } finally { setBusy(false); } };
  const prepared = states.filter((item) => item.status === 'current').length;
  const unprepared = states.filter((item) => item.status === 'missing' || item.status === 'stale').length;
  const active = jobs.filter((job) => job.status === 'running').length;
  const queued = jobs.filter((job) => job.status === 'queued').length;
  const failed = states.filter((item) => item.status === 'failed' || item.status === 'unavailable').length;

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 sm:p-8" role="dialog" aria-modal="true" aria-label={t('Índice documental')} onClick={onClose}>
    <div className="card-modal flex max-h-full w-full max-w-4xl flex-col overflow-hidden" onClick={(event) => event.stopPropagation()}>
      <header className="flex items-center gap-3 border-b border-neutral-800 px-5 py-4"><Icon name="layers" className="text-cyan-300" /><div className="flex-1"><h2 className="font-semibold">{t('Índice documental')}</h2><p className="text-xs text-neutral-500">{t('Comprensión jerárquica y auditada de las obras completas del vault')}</p></div><button onClick={onClose}><Icon name="x" /></button></header>
      <main className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="grid gap-3 sm:grid-cols-5">{[[t('Preparadas'), prepared], [t('Sin analizar'), unprepared], [t('En curso'), active], [t('En cola'), queued], [t('Con incidencias'), failed]].map(([label, value]) => <div key={String(label)} className="rounded-lg border border-neutral-800 p-3"><div className="text-2xl font-semibold tabular-nums">{value}</div><div className="text-xs text-neutral-500">{label}</div></div>)}</div>
        {live && <section className="mt-4 rounded-lg border border-indigo-800/60 bg-indigo-950/20 p-4"><div className="flex items-center justify-between gap-3"><div><div className="text-sm font-medium">{live.mode === 'continuous' ? t('Indexación continua') : t('Campaña documental')}</div><div className="text-xs text-neutral-500">{tx('{done} de {total} obras · {status}', { done: live.completedJobs, total: live.totalJobs, status: campaignStatusLabel(live.status) })}</div></div><div className="flex gap-2">{live.status === 'paused' ? <button className="btn btn-primary" disabled={busy} onClick={() => void setStatus('running')}>{t('Reanudar')}</button> : <button className="btn btn-ghost border border-neutral-700" disabled={busy} onClick={() => void setStatus('paused')}>{t('Pausar')}</button>}<button className="btn btn-ghost document-index-danger border" disabled={busy} onClick={() => setConfirmCancel(true)}>{t('Cancelar')}</button></div></div>{liveError && <div className="document-index-warning mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-5" role="alert" data-testid="document-index-manager-warning"><Icon name="warning" size={14} className="mt-0.5 shrink-0" /><span className="min-w-0 flex-1 break-words">{liveError}</span></div>}<div className="mt-3 h-2 overflow-hidden rounded bg-neutral-800"><div className="h-full bg-indigo-500" style={{ width: `${live.estimatedUnits ? Math.round((live.completedUnits / live.estimatedUnits) * 100) : 0}%` }} /></div></section>}
        {!live && <section className="mt-4 rounded-lg border border-neutral-800 p-4"><h3 className="text-sm font-medium">{t('Escanear el vault completo')}</h3><p className="mt-1 text-xs leading-5 text-neutral-500">{t('El proceso continúa en segundo plano aunque cambies de vault. Las obras ya actuales se omiten y las nuevas versiones solo se publican después de superar la auditoría.')}</p><label className="mt-3 flex items-center gap-2 text-xs text-neutral-400"><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} />{t('Incluir obras archivadas')}</label><button className="btn btn-primary mt-3" disabled={busy} onClick={() => void start()}><Icon name="play" />{t('Iniciar campaña')}</button></section>}
        <section className="mt-5"><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Actividad reciente')}</h3><div className="space-y-1">{jobs.slice(0, 30).map((job) => <div key={job.jobId} className="flex items-center gap-3 rounded border border-neutral-800 px-3 py-2 text-xs"><span className="min-w-0 flex-1 truncate text-neutral-300">{job.title ?? job.nodusId}</span><span className="text-neutral-500">{jobPhaseLabel(job.phase)}</span><span className="w-10 text-right tabular-nums text-neutral-500">{Math.round(job.progress * 100)}%</span><span className={job.status === 'failed' || job.status === 'unavailable' ? 'text-red-300' : job.status === 'completed' ? 'text-emerald-300' : 'text-indigo-300'}>{jobStatusLabel(job.status)}</span></div>)}{jobs.length === 0 && <p className="py-6 text-center text-xs text-neutral-600">{t('Todavía no hay actividad documental.')}</p>}</div></section>
      </main>
    </div>
    {confirmCancel && <ConfirmModal
      title={t('Detener indexación')}
      message={t('Se detendrá el análisis documental pendiente. Las fichas ya publicadas, las correcciones del usuario y las obras completadas se conservarán.')}
      confirmLabel={t('Detener')}
      danger
      onConfirm={() => { setConfirmCancel(false); void setStatus('cancelled'); }}
      onCancel={() => setConfirmCancel(false)}
    />}
  </div>;
}

function campaignStatusLabel(status: 'queued' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed'): string {
  return t({ queued: 'En cola', running: 'En curso', paused: 'En pausa', completed: 'Completado', cancelled: 'Cancelado', failed: 'Falló' }[status]);
}

function jobStatusLabel(status: DocumentIndexJobStatus): string {
  return t({ queued: 'En cola', running: 'En curso', paused: 'En pausa', completed: 'Completado', cancelled: 'Cancelado', failed: 'Falló', unavailable: 'Sin texto completo' }[status]);
}

function jobPhaseLabel(phase: DocumentIndexJobPhase): string {
  return t({
    queued: 'En cola', paused: 'En pausa', waiting_source: 'Resolviendo texto completo', structuring: 'Reconstruyendo estructura',
    analyzing_sections: 'Analizando secciones', synthesizing: 'Sintetizando la obra', auditing: 'Auditando',
    repairing: 'Auditando', embedding: 'Creando vectores', aligning: 'Enlazando ideas', publishing: 'Auditando', done: 'Completado',
  }[phase]);
}
