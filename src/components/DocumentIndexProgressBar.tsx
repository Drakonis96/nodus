import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { DocumentIndexJob, DocumentIndexJobPhase, DocumentIndexProgress } from '@shared/types';
import { ConfirmModal } from './ConfirmModal';
import { Icon } from './ui';
import { t, tr, tx, errorText } from '../i18n';
import { documentIndexPercentLabel, summarizeDocumentIndexRail } from '@shared/documentIndexProgress';
import { elapsedTimeLabel } from '@shared/elapsedTime';
import { useElapsedClock } from '../useElapsedClock';

const TERMINAL = new Set<DocumentIndexJob['status']>(['completed', 'failed', 'unavailable', 'cancelled']);
const RETRYABLE = new Set<DocumentIndexJob['status']>(['failed', 'unavailable']);
const LIVE = new Set<DocumentIndexJob['status']>(['queued', 'running', 'paused']);

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

export function DocumentIndexProgressBar({ progress }: { progress: DocumentIndexProgress | null }) {
  const [expanded, setExpanded] = useState(false);
  // Per-action pending keys (bulk, retry:<jobId>, cancel:<jobId>): one slow IPC
  // must never freeze the whole rail, and a failure must be shown, not swallowed.
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  // Standalone jobs (a per-work scan, or Deep Research preparation) have no campaign
  // and were invisible here, so a retry could not be seen. The summary includes them.
  const view = useMemo(() => summarizeDocumentIndexRail(progress), [progress]);
  const liveCampaigns = view.campaigns;
  const now = useElapsedClock(view.visible);

  if (!view.visible) return null;

  const { jobs, current, error, total, completed, failed, estimatedUnits, completedUnits, allPaused } = view;
  const fraction = estimatedUnits ? Math.max(0, Math.min(1, completedUnits / estimatedUnits)) : 1;
  const pctValue = fraction * 100;
  const pct = documentIndexPercentLabel(fraction);
  const campaignStartedAt = liveCampaigns.reduce<string | null>(
    (earliest, campaign) => !earliest || campaign.createdAt < earliest ? campaign.createdAt : earliest,
    null,
  );
  const totalElapsed = elapsedTimeLabel(campaignStartedAt, null, now);
  const itemElapsed = elapsedTimeLabel(current?.createdAt, null, now);

  const runAction = async (key: string, fn: () => Promise<void>) => {
    setPending((current) => new Set(current).add(key));
    setActionError(null);
    try {
      await fn();
    } catch (error) {
      setActionError(errorText(error));
    } finally {
      setPending((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  const applyStatus = async (status: 'running' | 'paused' | 'cancelled') => {
    await runAction('bulk', async () => {
      const targets = status === 'running'
        ? liveCampaigns.filter((campaign) => campaign.status === 'paused')
        : liveCampaigns.filter((campaign) => campaign.status !== 'paused' || status === 'cancelled');
      await Promise.all(targets.map((campaign) =>
        window.nodus.setDocumentIndexCampaignStatus(campaign.vaultId, campaign.campaignId, status)
      ));
      // Standalone jobs (per-work scans, Deep Research preparation) belong to no
      // campaign, so a bulk stop used to leave them running while the campaigns
      // disappeared — reading as "stop does nothing". Cancel them explicitly.
      if (status === 'cancelled') {
        const standaloneLive = view.standalone.filter((job) => LIVE.has(job.status));
        await Promise.all(standaloneLive.map((job) =>
          window.nodus.cancelDocumentIndexJob(job.jobId, job.vaultId)
        ));
      }
    });
  };

  /** Retry one job from the rail; the row flips back to queued in place. */
  const retryJob = async (job: DocumentIndexJob) => {
    await runAction(`retry:${job.jobId}`, async () => {
      await window.nodus.enqueueDocumentProfile(job.nodusId, job.vaultId);
    });
  };

  const cancelJob = async (job: DocumentIndexJob) => {
    await runAction(`cancel:${job.jobId}`, async () => {
      await window.nodus.cancelDocumentIndexJob(job.jobId, job.vaultId);
    });
  };

  return (
    <div
      className="border-t border-neutral-200 bg-neutral-100/80 px-4 py-2 text-sm backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/80"
      data-testid="document-index-progress-bar"
    >
      {error && (
        <div className="document-index-warning mb-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-5" role="alert">
          <Icon name="warning" size={14} className="mt-0.5 shrink-0" />
          <span className="min-w-0 flex-1 break-words">{tr(error)}</span>
        </div>
      )}
      {actionError && (
        <div className="document-index-warning mb-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-5" role="alert">
          <Icon name="warning" size={14} className="mt-0.5 shrink-0" />
          <span className="min-w-0 flex-1 break-words">{actionError}</span>
          <button className="btn btn-ghost shrink-0 px-1 py-0" onClick={() => setActionError(null)} aria-label={t('Cerrar')}>
            <Icon name="x" size={12} />
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-ghost shrink-0" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
          {expanded ? '▾' : '▸'} {t('Índice documental')}
        </button>
        <div className="order-last min-w-0 basis-full">
          <div className="mb-1 flex flex-wrap justify-between gap-2 text-xs text-neutral-500 dark:text-neutral-400">
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">
              {allPaused ? t('Análisis documental en pausa') : current ? (
                <>{tx('{done} de {total} obras', { done: completed + failed, total })} — <span className="text-neutral-800 dark:text-neutral-200">{current.title ?? current.nodusId}</span> · <span className="text-cyan-800 dark:text-cyan-300">{jobPhaseDetail(current)} ({Math.round(current.progress * 100)}%)</span>{itemElapsed && <span className="ml-1 tabular-nums text-neutral-500">· {t('Obra')} {itemElapsed}</span>}</>
              ) : tx('{done} de {total} obras', { done: completed + failed, total })}
            </span>
            <span className="shrink-0 tabular-nums" data-testid="document-index-progress-percent">{totalElapsed && <span className="mr-3">{t('Total')} {totalElapsed}</span>}{pct}</span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-neutral-300 dark:bg-neutral-800"
            role="progressbar"
            aria-label={t('Índice documental')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pctValue}
            aria-valuetext={`${pct} · ${tx('{done} de {total} obras', { done: completed + failed, total })}`}
          >
            <motion.div className="h-full bg-cyan-500" animate={{ width: `${Math.max(pctValue, jobs.some((job) => job.status === 'running') ? 0.2 : 0)}%` }} transition={{ ease: 'easeOut', duration: 0.3 }} />
          </div>
          <span className="sr-only" aria-live="polite">{pct} · {jobPhaseDetail(current)}</span>
        </div>
        {liveCampaigns.length > 0 && <>
          {allPaused ? (
            <button className="btn btn-ghost" disabled={pending.has('bulk')} title={t('Reanudar indexación')} aria-label={t('Reanudar indexación')} onClick={() => void applyStatus('running')}>
              <Icon name="play" size={16} />
            </button>
          ) : (
            <button className="btn btn-ghost" disabled={pending.has('bulk')} title={t('Pausar indexación')} aria-label={t('Pausar indexación')} onClick={() => void applyStatus('paused')}>
              <Icon name="pause" size={16} />
            </button>
          )}
          <button className="btn btn-ghost document-index-danger" disabled={pending.has('bulk')} title={t('Detener indexación')} aria-label={t('Detener indexación')} onClick={() => setConfirmStop(true)}>
            <Icon name="stop" size={16} />
          </button>
        </>}
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-2 max-h-40 divide-y divide-neutral-800 overflow-y-auto" data-testid="document-index-rail-list">
              {jobs.filter((job) => !TERMINAL.has(job.status) || RETRYABLE.has(job.status)).slice(0, 50).map((job) => (
                <div key={job.jobId} className={`flex items-center gap-3 py-1.5 text-xs ${job.status === 'running' ? 'text-neutral-100' : ''}`} data-testid={`document-index-rail-job-${job.jobId}`}>
                  <span className={`w-5 shrink-0 text-center font-semibold tabular-nums ${job.status === 'running' ? 'text-cyan-300' : 'text-neutral-500'}`} aria-label={job.status === 'queued' ? `${t('En cola')} ${queuedPosition(jobs, job.jobId)}` : undefined}>
                    {job.status === 'running' ? '●' : job.status === 'queued' ? queuedPosition(jobs, job.jobId) : '—'}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{job.title ?? job.nodusId}</span>
                  <span className={job.status === 'running' ? 'text-cyan-300' : job.status === 'failed' || job.status === 'unavailable' ? 'text-red-500 dark:text-red-300' : 'text-neutral-500'}>{jobStatusText(job)}</span>
                  <span className="min-w-[5.5rem] text-right tabular-nums text-neutral-500">{elapsedTimeLabel(job.createdAt, TERMINAL.has(job.status) ? job.updatedAt : null, now)}</span>
                  <span className="w-10 text-right tabular-nums text-neutral-500">{Math.round(job.progress * 100)}%</span>
                  {/* Every visible row owns its actions: a campaign job cancelled here
                      leaves its campaign running for the remaining works, and a
                      failed campaign job retries as a standalone re-scan. */}
                  <span className="flex shrink-0 items-center">
                    {RETRYABLE.has(job.status) && (
                      <button
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-800 hover:text-cyan-300"
                        disabled={pending.has(`retry:${job.jobId}`)}
                        title={t('Reintentar')}
                        aria-label={`${t('Reintentar')}: ${job.title ?? job.nodusId}`}
                        data-testid={`document-index-rail-retry-${job.jobId}`}
                        onClick={() => void retryJob(job)}
                      >
                        <Icon name="refresh" size={13} />
                      </button>
                    )}
                    {!TERMINAL.has(job.status) && (
                      <button
                        className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-800 hover:text-red-400"
                        disabled={pending.has(`cancel:${job.jobId}`)}
                        title={t('Cancelar')}
                        aria-label={`${t('Cancelar')}: ${job.title ?? job.nodusId}`}
                        data-testid={`document-index-rail-cancel-${job.jobId}`}
                        onClick={() => void cancelJob(job)}
                      >
                        <Icon name="x" size={13} />
                      </button>
                    )}
                  </span>
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

function queuedPosition(jobs: DocumentIndexJob[], jobId: string): number {
  return jobs.filter((job) => job.status === 'queued').findIndex((job) => job.jobId === jobId) + 1;
}

function jobPhaseDetail(job: DocumentIndexJob | null): string {
  if (!job) return phaseLabel('queued');
  const phase = phaseLabel(job.phase);
  if (job.phase !== 'analyzing_sections' || !job.currentUnit || !job.totalUnits) return phase;
  return `${phase} · ${job.currentUnit}/${job.totalUnits}`;
}

/** A failed job's phase is `done`, so the phase name would read "Completed"; say what happened instead. */
function jobStatusText(job: DocumentIndexJob): string {
  if (job.status === 'failed') return t('Falló');
  if (job.status === 'unavailable') return t('Sin texto completo');
  return jobPhaseDetail(job);
}
