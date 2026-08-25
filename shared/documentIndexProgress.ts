import type { DocumentIndexJob } from './types';

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
