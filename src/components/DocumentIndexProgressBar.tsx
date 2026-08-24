import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { DocumentIndexCampaign, DocumentIndexJob, DocumentIndexJobPhase, DocumentIndexProgress } from '@shared/types';
import { ConfirmModal } from './ConfirmModal';
import { Icon } from './ui';
import { t, tx } from '../i18n';

const LIVE = new Set<DocumentIndexCampaign['status']>(['queued', 'running', 'paused']);
const TERMINAL = new Set<DocumentIndexJob['status']>(['completed', 'failed', 'unavailable', 'cancelled']);

function phaseLabel(phase: DocumentIndexJobPhase): string {
  return t({
    queued: 'En cola',
    paused: 'En pausa',
    waiting_source: 'Resolviendo texto completo',
    structuring: 'Reconstruyendo estructura',
    analyzing_sections: 'Analizando secciones',
    synthesizing: 'Sintetizando la obra',
    auditing: 'Auditando',
    repairing: 'Reparando',
    embedding: 'Creando vectores',
    aligning: 'Enlazando ideas',
    publishing: 'Publicando',
    done: 'Completado',
  }[phase]);
}

export function DocumentIndexProgressBar() {
  const [progress, setProgress] = useState<DocumentIndexProgress | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);

  useEffect(() => {
    void window.nodus.getDocumentIndexProgress().then(setProgress);
    return window.nodus.onDocumentIndexProgress(setProgress);
  }, []);

  const liveCampaigns = useMemo(
    () => progress?.campaigns.filter((campaign) => LIVE.has(campaign.status)) ?? [],
    [progress],
  );
  const campaignIds = useMemo(() => new Set(liveCampaigns.map((campaign) => campaign.campaignId)), [liveCampaigns]);
  const jobs = useMemo(
    () => progress?.jobs.filter((job) => job.campaignId && campaignIds.has(job.campaignId)) ?? [],
    [progress, campaignIds],
  );

  if (!progress || liveCampaigns.length === 0) return null;

  const total = liveCampaigns.reduce((sum, campaign) => sum + campaign.totalJobs, 0);
  const completed = liveCampaigns.reduce((sum, campaign) => sum + campaign.completedJobs, 0);
  const failed = liveCampaigns.reduce((sum, campaign) => sum + campaign.failedJobs, 0);
  const estimatedUnits = liveCampaigns.reduce((sum, campaign) => sum + campaign.estimatedUnits, 0);
  const completedUnits = liveCampaigns.reduce((sum, campaign) => sum + campaign.completedUnits, 0);
  const fraction = estimatedUnits ? Math.max(0, Math.min(1, completedUnits / estimatedUnits)) : 1;
  const pct = Math.round(fraction * 100);
  const current = jobs.find((job) => job.status === 'running')
    ?? jobs.find((job) => job.status === 'paused')
    ?? jobs.find((job) => job.status === 'queued')
    ?? null;
  const allPaused = liveCampaigns.every((campaign) => campaign.status === 'paused');
  const error = jobs.find((job) => job.error && ['paused', 'failed', 'unavailable'].includes(job.status))?.error ?? null;

  const applyStatus = async (status: 'running' | 'paused' | 'cancelled') => {
    setBusy(true);
    try {
      const targets = status === 'running'
        ? liveCampaigns.filter((campaign) => campaign.status === 'paused')
        : liveCampaigns.filter((campaign) => campaign.status !== 'paused' || status === 'cancelled');
      await Promise.all(targets.map((campaign) =>
        window.nodus.setDocumentIndexCampaignStatus(campaign.vaultId, campaign.campaignId, status)
      ));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="border-t border-neutral-200 bg-neutral-100/80 px-4 py-2 text-sm backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/80"
      data-testid="document-index-progress-bar"
    >
      {error && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/60 dark:text-amber-300" role="alert">
          <Icon name="warning" size={14} />
          <span className="flex-1">{error}</span>
        </div>
      )}
      <div className="flex items-center gap-3">
        <button className="btn btn-ghost shrink-0" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
          {expanded ? '▾' : '▸'} {t('Índice documental')}
        </button>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex justify-between gap-3 text-xs text-neutral-500 dark:text-neutral-400">
            <span className="min-w-0 truncate">
              {allPaused ? t('Análisis documental en pausa') : current ? (
                <>{tx('{done} de {total} obras', { done: completed + failed, total })} — <span className="text-neutral-800 dark:text-neutral-200">{current.title ?? current.nodusId}</span> · <span className="text-cyan-700 dark:text-cyan-300">{phaseLabel(current.phase)} ({Math.round(current.progress * 100)}%)</span></>
              ) : tx('{done} de {total} obras', { done: completed + failed, total })}
            </span>
            <span className="shrink-0 tabular-nums" data-testid="document-index-progress-percent">{pct}%</span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-neutral-300 dark:bg-neutral-800"
            role="progressbar"
            aria-label={t('Índice documental')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-valuetext={`${pct}% · ${tx('{done} de {total} obras', { done: completed + failed, total })}`}
          >
            <motion.div className="h-full bg-cyan-500" animate={{ width: `${pct}%` }} transition={{ ease: 'easeOut', duration: 0.3 }} />
          </div>
          <span className="sr-only" aria-live="polite">{pct}% · {phaseLabel(current?.phase ?? 'queued')}</span>
        </div>
        {allPaused ? (
          <button className="btn btn-ghost" disabled={busy} title={t('Reanudar indexación')} aria-label={t('Reanudar indexación')} onClick={() => void applyStatus('running')}>
            <Icon name="play" size={16} />
          </button>
        ) : (
          <button className="btn btn-ghost" disabled={busy} title={t('Pausar indexación')} aria-label={t('Pausar indexación')} onClick={() => void applyStatus('paused')}>
            <Icon name="pause" size={16} />
          </button>
        )}
        <button className="btn btn-ghost text-red-400 hover:text-red-300" disabled={busy} title={t('Detener indexación')} aria-label={t('Detener indexación')} onClick={() => setConfirmStop(true)}>
          <Icon name="stop" size={16} />
        </button>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-2 max-h-40 divide-y divide-neutral-800 overflow-y-auto">
              {jobs.filter((job) => !TERMINAL.has(job.status) || job.status === 'failed' || job.status === 'unavailable').slice(0, 50).map((job) => (
                <div key={job.jobId} className="flex items-center gap-3 py-1.5 text-xs">
                  <span className="min-w-0 flex-1 truncate">{job.title ?? job.nodusId}</span>
                  <span className="text-neutral-500">{phaseLabel(job.phase)}</span>
                  <span className="w-10 text-right tabular-nums text-neutral-500">{Math.round(job.progress * 100)}%</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {confirmStop && (
        <ConfirmModal
          title={t('Detener indexación')}
          message={t('Se detendrá el análisis documental pendiente. Las fichas ya publicadas, las correcciones del usuario y las obras completadas se conservarán.')}
          confirmLabel={t('Detener')}
          danger
          onConfirm={() => { setConfirmStop(false); void applyStatus('cancelled'); }}
          onCancel={() => setConfirmStop(false)}
        />
      )}
    </div>
  );
}
