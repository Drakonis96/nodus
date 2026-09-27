import type { ResearchPreparationCampaign, ResearchPreparationJob, ResearchPreparationProgress } from '@shared/researchCorpus';

export type PreparationItemState = ResearchPreparationJob['state'];
export interface PreparationQueueItem {
  documentId: string;
  title: string;
  state: PreparationItemState;
  stage: ResearchPreparationJob['stage'];
  completedPassages: number;
  totalPassages: number | null;
  currentPage?: number | null;
  totalPages?: number | null;
  error: string | null;
  /** Campaigns where this document can be retried or stopped from its row. */
  retryCampaignId: string | null;
  liveCampaignIds: string[];
  embedding: ResearchPreparationCampaign['embedding'];
}
export interface PreparationQueueSummary {
  items: PreparationQueueItem[];
  total: number;
  /** Documents that reached an end: indexed, failed, blocked or cancelled. */
  settled: number;
  failed: number;
  running: PreparationQueueItem | null;
  percent: number;
  live: boolean;
  paused: boolean;
}

const LIVE = new Set<PreparationItemState>(['queued', 'running', 'paused']);
// Which campaign's view of a document the row shows when several campaigns hold it.
const RANK: Record<PreparationItemState, number> = { running: 0, queued: 1, paused: 2, complete: 3, blocked: 4, failed: 5, cancelled: 6 };

/** One queue entry for all indexing: one row per document, however many campaigns
 * asked for it, and one progress figure for the whole set. */
export function summarizePreparationQueue(progress: ResearchPreparationProgress): PreparationQueueSummary {
  const byDocument = new Map<string, PreparationQueueItem>();
  // Newest campaign first, so its model is the one named when states tie.
  for (const campaign of [...progress.campaigns].sort((a, b) => b.createdAt - a.createdAt)) {
    for (const job of campaign.jobs) {
      const current = byDocument.get(job.documentId);
      const retryable = ['failed', 'blocked', 'cancelled'].includes(job.state);
      if (!current || RANK[job.state] < RANK[current.state]) {
        byDocument.set(job.documentId, {
          documentId: job.documentId, title: job.title, state: job.state, stage: job.stage,
          completedPassages: job.completedPassages, totalPassages: job.totalPassages,
          currentPage: job.currentPage, totalPages: job.totalPages, error: job.error,
          retryCampaignId: retryable ? campaign.id : current?.retryCampaignId ?? null,
          liveCampaignIds: [...(current?.liveCampaignIds ?? []), ...(LIVE.has(job.state) ? [campaign.id] : [])],
          embedding: campaign.embedding,
        });
      } else {
        if (retryable && !current.retryCampaignId) current.retryCampaignId = campaign.id;
        if (LIVE.has(job.state)) current.liveCampaignIds.push(campaign.id);
      }
    }
  }
  const items = [...byDocument.values()].sort((a, b) => RANK[a.state] - RANK[b.state] || a.title.localeCompare(b.title));
  const settledStates = new Set<PreparationItemState>(['complete', 'failed', 'blocked', 'cancelled']);
  const settled = items.filter(item => settledStates.has(item.state)).length;
  const running = items.find(item => item.state === 'running') ?? null;
  const partial = running && running.stage === 'embeddings' && running.totalPassages ? Math.min(1, running.completedPassages / running.totalPassages) : 0;
  const live = items.some(item => LIVE.has(item.state));
  const percent = items.length ? Math.round(((settled + partial) / items.length) * 100) : 0;
  return {
    items, total: items.length, settled, running, live,
    failed: items.filter(item => item.state === 'failed' || item.state === 'blocked').length,
    // A live set never reads 100% until its last document settles.
    percent: live ? Math.min(percent, 99) : percent,
    paused: progress.paused || (live && items.filter(item => LIVE.has(item.state)).every(item => item.state === 'paused')),
  };
}
