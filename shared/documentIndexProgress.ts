import type { DocumentIndexCampaign, DocumentIndexJob, DocumentIndexJobStatus, DocumentIndexProgress } from './types';

/**
 * A live queue must not reorder itself every time one worker emits progress.
 * `updatedAt` is intentionally ignored for live jobs: it changes on every chunk.
 */
export function compareDocumentIndexJobsForDisplay(a: DocumentIndexJob, b: DocumentIndexJob): number {
  const rank = (job: DocumentIndexJob): number => {
    if (job.status === 'running') return 0;
    if (job.status === 'paused') return 1;
    if (job.status === 'queued') return 2;
    return 3;
  };
  const statusOrder = rank(a) - rank(b);
  if (statusOrder) return statusOrder;
  if (rank(a) < 3) {
    return b.priority - a.priority
      || a.createdAt.localeCompare(b.createdAt)
      || a.jobId.localeCompare(b.jobId);
  }
  return b.updatedAt.localeCompare(a.updatedAt) || a.jobId.localeCompare(b.jobId);
}

export function documentIndexPercentLabel(fraction: number): string {
  const percent = Math.max(0, Math.min(1, fraction)) * 100;
  if (percent === 0 || percent === 100) return `${Math.round(percent)}%`;
  if (percent < 1) return `${percent.toFixed(2)}%`;
  if (percent < 10) return `${percent.toFixed(1)}%`;
  return `${Math.round(percent)}%`;
}

const LIVE_CAMPAIGN_STATUSES = new Set<DocumentIndexCampaign['status']>(['queued', 'running', 'paused']);
const LIVE_JOB_STATUSES = new Set<DocumentIndexJobStatus>(['queued', 'running', 'paused']);
const RETRYABLE_JOB_STATUSES = new Set<DocumentIndexJobStatus>(['failed', 'unavailable']);

export interface DocumentIndexRailSummary {
  /** False when there is nothing to show; the rail then renders nothing. */
  visible: boolean;
  campaigns: DocumentIndexCampaign[];
  jobs: DocumentIndexJob[];
  /** Standalone rows the rail renders (live, or failed/unavailable so they can be retried). */
  standalone: DocumentIndexJob[];
  /** Standalone rows queued/running/paused right now. */
  standaloneLive: number;
  /** Standalone rows failed or unavailable. */
  standaloneFailed: number;
  current: DocumentIndexJob | null;
  error: string | null;
  total: number;
  completed: number;
  failed: number;
  estimatedUnits: number;
  completedUnits: number;
  allPaused: boolean;
}

const EMPTY_RAIL: DocumentIndexRailSummary = {
  visible: false, campaigns: [], jobs: [], standalone: [], standaloneLive: 0, standaloneFailed: 0,
  current: null, error: null, total: 0, completed: 0, failed: 0, estimatedUnits: 0, completedUnits: 0, allPaused: false,
};

/**
 * What the Documentary Index rail must show for one progress snapshot.
 *
 * A job with no campaign is created by a per-work scan (`enqueueDocumentProfile`) or
 * by Deep Research preparation (`ensureProfiles`). The rail used to keep only the jobs
 * of live campaigns, so those standalone jobs had no surface at all: pressing retry
 * enqueued real work that the reader could not see, and a failure left nothing to
 * retry from. Standalone jobs are therefore included — live ones so a retry shows up,
 * and failed/unavailable ones so there is a place to start the retry.
 *
 * Campaign totals come from the campaign counters (they stay exact for large vaults
 * whose job rows are capped in transit); standalone totals are counted from the rows.
 */
export function summarizeDocumentIndexRail(progress: DocumentIndexProgress | null): DocumentIndexRailSummary {
  if (!progress) return EMPTY_RAIL;
  const campaigns = progress.campaigns.filter((campaign) => LIVE_CAMPAIGN_STATUSES.has(campaign.status));
  const liveCampaignIds = new Set(campaigns.map((campaign) => campaign.campaignId));
  const standalone = progress.jobs.filter((job) =>
    !job.campaignId && (LIVE_JOB_STATUSES.has(job.status) || RETRYABLE_JOB_STATUSES.has(job.status)));
  const jobs = [
    ...progress.jobs.filter((job) => job.campaignId && liveCampaignIds.has(job.campaignId)),
    ...standalone,
  ].sort(compareDocumentIndexJobsForDisplay);
  const standaloneFailed = standalone.filter((job) => RETRYABLE_JOB_STATUSES.has(job.status)).length;
  const standaloneCompletedUnits = standalone.reduce(
    (sum, job) => sum + (LIVE_JOB_STATUSES.has(job.status) ? Math.max(0, Math.min(1, job.progress)) : 1),
    0,
  );
  return {
    visible: campaigns.length > 0 || standalone.length > 0,
    campaigns,
    jobs,
    standalone,
    standaloneLive: standalone.filter((job) => LIVE_JOB_STATUSES.has(job.status)).length,
    standaloneFailed,
    current: jobs.find((job) => job.status === 'running')
      ?? jobs.find((job) => job.status === 'paused')
      ?? jobs.find((job) => job.status === 'queued')
      ?? null,
    error: jobs.find((job) => job.error && (job.status === 'paused' || RETRYABLE_JOB_STATUSES.has(job.status)))?.error ?? null,
    total: campaigns.reduce((sum, campaign) => sum + campaign.totalJobs, 0) + standalone.length,
    completed: campaigns.reduce((sum, campaign) => sum + campaign.completedJobs, 0),
    failed: campaigns.reduce((sum, campaign) => sum + campaign.failedJobs, 0) + standaloneFailed,
    estimatedUnits: campaigns.reduce((sum, campaign) => sum + campaign.estimatedUnits, 0) + standalone.length,
    completedUnits: campaigns.reduce((sum, campaign) => sum + campaign.completedUnits, 0) + standaloneCompletedUnits,
    allPaused: campaigns.length > 0 && campaigns.every((campaign) => campaign.status === 'paused'),
  };
}

/**
 * The three signals the queue panel needs from the document lane alone: whether the
 * lane has anything to show, whether something is live (the header badge count), and
 * whether something needs attention (the red badge).
 *
 * These used to be derived from `documents.campaigns` only, so a standalone job — one
 * with no campaign, from a per-work scan or Deep Research preparation — was invisible
 * to all three: the panel could show its rail while still claiming "no tasks or queues
 * in progress", and a retry never lit the header badge. The lane now answers with the
 * same selection the rail renders.
 */
export function documentLaneActivity(documents: DocumentIndexProgress | null): {
  visible: boolean;
  active: boolean;
  attention: boolean;
} {
  if (!documents) return { visible: false, active: false, attention: false };
  const rail = summarizeDocumentIndexRail(documents);
  return {
    // A finished campaign is still history the panel lists, so its raw presence counts;
    // a standalone job only counts while the rail renders it.
    visible: documents.campaigns.length > 0 || rail.standalone.length > 0,
    active: documents.campaigns.some((campaign) => LIVE_CAMPAIGN_STATUSES.has(campaign.status))
      || rail.standaloneLive > 0,
    attention: documents.campaigns.some((campaign) =>
      campaign.status !== 'cancelled' && (campaign.status === 'failed' || campaign.failedJobs > 0 || Boolean(campaign.error)))
      || rail.standaloneFailed > 0,
  };
}
