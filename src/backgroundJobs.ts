import type {
  DeepResearchProgress,
  DeepResearchReport,
  DeepResearchRequest,
  ImmersionBuildProgress,
  ImmersionRequest,
  ImmersionScope,
  ImmersionSession,
  WritingWorkshopSavedDraft,
  ToolkitJobRequest,
  ToolkitJobProgress,
  ToolkitJobResult,
} from '@shared/types';
import type { DatabaseAttachment, DatabaseRow } from '@shared/databases';

export type BackgroundJobStatus = 'running' | 'completed' | 'failed';

/**
 * Renderer-wide snapshot of a long generation. The store lives outside React,
 * so changing views only detaches a subscriber; it never owns or cancels the
 * underlying Electron request.
 */
export interface BackgroundJob<Request, Progress, Result> {
  id: string;
  key: string;
  request: Request;
  status: BackgroundJobStatus;
  progress: Progress | null;
  result: Result | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

type AnyJob = BackgroundJob<unknown, unknown, unknown>;
type AnyListener = (job: AnyJob | null) => void;

const jobs = new Map<string, AnyJob>();
const listeners = new Map<string, Set<AnyListener>>();
let jobSequence = 0;

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function notify(key: string): void {
  const snapshot = jobs.get(key) ?? null;
  for (const listener of listeners.get(key) ?? []) listener(snapshot);
}

function replaceJob(job: AnyJob): void {
  jobs.set(job.key, job);
  notify(job.key);
}

export function getBackgroundJob<Request, Progress, Result>(key: string): BackgroundJob<Request, Progress, Result> | null {
  return (jobs.get(key) as BackgroundJob<Request, Progress, Result> | undefined) ?? null;
}

export function findLatestBackgroundJob<Request, Progress, Result>(
  keyPrefix: string
): BackgroundJob<Request, Progress, Result> | null {
  const matches = [...jobs.values()]
    .filter((job) => job.key.startsWith(keyPrefix))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return (matches[0] as BackgroundJob<Request, Progress, Result> | undefined) ?? null;
}

/** Subscribe and immediately receive the current snapshot, including completed jobs. */
export function subscribeBackgroundJob<Request, Progress, Result>(
  key: string,
  listener: (job: BackgroundJob<Request, Progress, Result> | null) => void
): () => void {
  const wrapped = listener as AnyListener;
  const bucket = listeners.get(key) ?? new Set<AnyListener>();
  bucket.add(wrapped);
  listeners.set(key, bucket);
  listener(getBackgroundJob<Request, Progress, Result>(key));
  return () => {
    const current = listeners.get(key);
    current?.delete(wrapped);
    if (current?.size === 0) listeners.delete(key);
  };
}

/** Completed/failed jobs can be dismissed; running work is deliberately retained. */
export function clearBackgroundJob(key: string, expectedId?: string): boolean {
  const current = jobs.get(key);
  if (!current || current.status === 'running' || (expectedId && current.id !== expectedId)) return false;
  jobs.delete(key);
  notify(key);
  return true;
}

export function startBackgroundJob<Request, Progress, Result>(
  key: string,
  request: Request,
  run: (request: Request, onProgress: (progress: Progress) => void) => Promise<Result>
): BackgroundJob<Request, Progress, Result> {
  const existing = getBackgroundJob<Request, Progress, Result>(key);
  if (existing?.status === 'running') return existing;

  const job: BackgroundJob<Request, Progress, Result> = {
    id: `${Date.now()}-${++jobSequence}`,
    key,
    request,
    status: 'running',
    progress: null,
    result: null,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  replaceJob(job as AnyJob);

  void Promise.resolve()
    .then(() =>
      run(request, (progress) => {
        const current = getBackgroundJob<Request, Progress, Result>(key);
        if (!current || current.id !== job.id || current.status !== 'running') return;
        replaceJob({ ...current, progress } as AnyJob);
      })
    )
    .then((result) => {
      const current = getBackgroundJob<Request, Progress, Result>(key);
      if (!current || current.id !== job.id) return;
      replaceJob({
        ...current,
        status: 'completed',
        result,
        error: null,
        finishedAt: new Date().toISOString(),
      } as AnyJob);
    })
    .catch((error: unknown) => {
      const current = getBackgroundJob<Request, Progress, Result>(key);
      if (!current || current.id !== job.id) return;
      replaceJob({
        ...current,
        status: 'failed',
        error: messageFromError(error),
        finishedAt: new Date().toISOString(),
      } as AnyJob);
    });

  return job;
}

export const IMMERSION_GENERATION_JOB_KEY = 'immersion:generate';

export interface ImmersionGenerationInput {
  scope: ImmersionScope;
  request: ImmersionRequest;
}

export type ImmersionGenerationJob = BackgroundJob<ImmersionGenerationInput, ImmersionBuildProgress, ImmersionSession>;

export function startImmersionGeneration(input: ImmersionGenerationInput): ImmersionGenerationJob {
  return startBackgroundJob(IMMERSION_GENERATION_JOB_KEY, input, ({ request }, onProgress) =>
    window.nodus.generateImmersionSession(request, { onProgress })
  );
}

// ── Nodus Toolkit (Convert) ──────────────────────────────────────────────────
// A single active conversion job at a time, under a shared key, so its progress
// survives navigation and the Convert view re-subscribes on return.
export const TOOLKIT_JOB_KEY = 'toolkit:convert';

export type ToolkitConvertJob = BackgroundJob<ToolkitJobRequest, ToolkitJobProgress, ToolkitJobResult>;

export function startToolkitJob(request: ToolkitJobRequest): ToolkitConvertJob {
  return startBackgroundJob(TOOLKIT_JOB_KEY, request, (currentRequest, onProgress) =>
    window.nodus.runToolkitJob(currentRequest, { onProgress }),
  );
}

// ── Database AI cells ───────────────────────────────────────────────────────
// Each cell has its own renderer-wide key. The actual generation runs through
// Electron's main process; keeping the promise snapshot here lets any remounted
// database view re-attach without starting the request again.

export interface DatabaseAiCellJobRequest {
  rowId: string;
  columnId: string;
}

export interface DatabaseColumnJobRequest {
  databaseId: string;
  columnId: string;
}

export interface DatabaseColumnJobProgress {
  done: number;
  total: number;
}

export function databaseAiTextCellJobKey(rowId: string, columnId: string): string {
  return `database:ai:text:${rowId}:${columnId}`;
}

export function databaseAiImageCellJobKey(rowId: string, columnId: string): string {
  return `database:ai:image:${rowId}:${columnId}`;
}

export type DatabaseAiTextCellJob = BackgroundJob<DatabaseAiCellJobRequest, never, string>;
export type DatabaseAiImageCellJob = BackgroundJob<DatabaseAiCellJobRequest, never, DatabaseAttachment>;
export type DatabaseComparisonCellJob = BackgroundJob<DatabaseAiCellJobRequest, never, DatabaseRow | null>;
export type DatabaseAiColumnJob = BackgroundJob<DatabaseColumnJobRequest, DatabaseColumnJobProgress, { done: number; failed: number }>;
export type DatabaseComparisonColumnJob = BackgroundJob<DatabaseColumnJobRequest, DatabaseColumnJobProgress, { done: number }>;

export function startDatabaseAiTextCellJob(rowId: string, columnId: string): DatabaseAiTextCellJob {
  const request = { rowId, columnId };
  return startBackgroundJob(databaseAiTextCellJobKey(rowId, columnId), request, (current) =>
    window.nodus.runDatabaseAiCell(current.rowId, current.columnId)
  );
}

export function startDatabaseAiImageCellJob(rowId: string, columnId: string): DatabaseAiImageCellJob {
  const request = { rowId, columnId };
  return startBackgroundJob(databaseAiImageCellJobKey(rowId, columnId), request, (current) =>
    window.nodus.generateDatabaseAiImage(current.rowId, current.columnId)
  );
}

export function databaseComparisonCellJobKey(rowId: string, columnId: string): string {
  return `database:comparison:cell:${rowId}:${columnId}`;
}

export function databaseComparisonColumnJobKey(databaseId: string, columnId: string): string {
  return `database:comparison:column:${databaseId}:${columnId}`;
}

export function databaseAiTextColumnJobKey(databaseId: string, columnId: string): string {
  return `database:ai:text:column:${databaseId}:${columnId}`;
}

export function databaseAiImageColumnJobKey(databaseId: string, columnId: string): string {
  return `database:ai:image:column:${databaseId}:${columnId}`;
}

export function startDatabaseComparisonCellJob(rowId: string, columnId: string): DatabaseComparisonCellJob {
  const request = { rowId, columnId };
  return startBackgroundJob(databaseComparisonCellJobKey(rowId, columnId), request, (current) =>
    window.nodus.runDatabaseComparisonCell(current.rowId, current.columnId)
  );
}

export function startDatabaseComparisonColumnJob(databaseId: string, columnId: string): DatabaseComparisonColumnJob {
  const request = { databaseId, columnId };
  return startBackgroundJob(databaseComparisonColumnJobKey(databaseId, columnId), request, async (current, onProgress) => {
    const unsubscribe = window.nodus.onDatabaseComparisonProgress((progress) => {
      if (progress.databaseId === current.databaseId && progress.columnId === current.columnId) {
        onProgress({ done: progress.done, total: progress.total });
      }
    });
    try {
      return await window.nodus.runDatabaseComparisonColumn(current.databaseId, current.columnId);
    } finally {
      unsubscribe();
    }
  });
}

function startDatabaseAiColumnJob(
  key: string,
  databaseId: string,
  columnId: string,
  run: (databaseId: string, columnId: string) => Promise<{ done: number; failed: number }>
): DatabaseAiColumnJob {
  const request = { databaseId, columnId };
  return startBackgroundJob(key, request, async (current, onProgress) => {
    const unsubscribe = window.nodus.onDatabaseAiProgress((progress) => {
      if (progress.databaseId === current.databaseId && progress.columnId === current.columnId) {
        onProgress({ done: progress.done, total: progress.total });
      }
    });
    try {
      return await run(current.databaseId, current.columnId);
    } finally {
      unsubscribe();
    }
  });
}

export function startDatabaseAiTextColumnJob(databaseId: string, columnId: string): DatabaseAiColumnJob {
  return startDatabaseAiColumnJob(
    databaseAiTextColumnJobKey(databaseId, columnId),
    databaseId,
    columnId,
    (dbId, colId) => window.nodus.runDatabaseAiColumn(dbId, colId)
  );
}

export function startDatabaseAiImageColumnJob(databaseId: string, columnId: string): DatabaseAiColumnJob {
  return startDatabaseAiColumnJob(
    databaseAiImageColumnJobKey(databaseId, columnId),
    databaseId,
    columnId,
    (dbId, colId) => window.nodus.generateDatabaseAiImageColumn(dbId, colId)
  );
}

export const DEEP_RESEARCH_MAIN_JOB_KEY = 'deep-research:main';
export const IMMERSION_DOSSIER_JOB_PREFIX = 'deep-research:immersion:';

export function immersionDossierJobKey(sessionId: string): string {
  return `${IMMERSION_DOSSIER_JOB_PREFIX}${sessionId}`;
}

export interface DeepResearchGenerationResult {
  report: DeepResearchReport;
  savedDraft: WritingWorkshopSavedDraft | null;
  saveError: string | null;
}

export type DeepResearchGenerationJob = BackgroundJob<DeepResearchRequest, DeepResearchProgress, DeepResearchGenerationResult>;

/**
 * Deep Research results are auto-saved after generation. The in-memory job
 * restores the live view; the saved draft makes the finished report durable.
 */
export function startDeepResearchGeneration(key: string, request: DeepResearchRequest): DeepResearchGenerationJob {
  return startBackgroundJob(key, request, async (currentRequest, onProgress) => {
    const report = await window.nodus.generateDeepResearchReport(currentRequest, { onProgress });
    try {
      const savedDraft = await window.nodus.saveWritingWorkshopDraft({
        draft: report.draft,
        model: currentRequest.model,
        decorativeImage: currentRequest.decorativeImage,
      });
      return { report, savedDraft, saveError: null };
    } catch (error) {
      return { report, savedDraft: null, saveError: messageFromError(error) };
    }
  });
}

// ── Deep Research queue: chained sequential generation ───────────────────────
//
// Reports are queued and generated one after another. The controller lives at
// module scope (not inside a view) so a queue keeps draining while the user
// navigates elsewhere. Only one report runs at a time, under the shared main
// job key, so the existing progress subscription keeps working unchanged.

export type DeepResearchQueueStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface DeepResearchQueueItem {
  id: string;
  request: DeepResearchRequest;
  title: string;
  status: DeepResearchQueueStatus;
  error: string | null;
  savedDraftId: string | null;
  enqueuedAt: string;
}

const deepQueue: DeepResearchQueueItem[] = [];
const deepQueueListeners = new Set<(items: DeepResearchQueueItem[]) => void>();
let deepQueueSeq = 0;
let deepQueueDraining = false;

function snapshotDeepQueue(): DeepResearchQueueItem[] {
  return deepQueue.map((item) => ({ ...item }));
}

function notifyDeepQueue(): void {
  const snapshot = snapshotDeepQueue();
  for (const listener of deepQueueListeners) listener(snapshot);
}

export function subscribeDeepResearchQueue(listener: (items: DeepResearchQueueItem[]) => void): () => void {
  deepQueueListeners.add(listener);
  listener(snapshotDeepQueue());
  return () => {
    deepQueueListeners.delete(listener);
  };
}

export function getDeepResearchQueue(): DeepResearchQueueItem[] {
  return snapshotDeepQueue();
}

function objectivePreview(objective: string): string {
  const clean = objective.replace(/\s+/g, ' ').trim();
  return clean.length > 100 ? `${clean.slice(0, 100)}…` : clean || 'Informe sin título';
}

export function enqueueDeepResearch(request: DeepResearchRequest): DeepResearchQueueItem {
  const item: DeepResearchQueueItem = {
    id: `drq-${Date.now()}-${++deepQueueSeq}`,
    request,
    title: objectivePreview(request.objective),
    status: 'queued',
    error: null,
    savedDraftId: null,
    enqueuedAt: new Date().toISOString(),
  };
  deepQueue.push(item);
  notifyDeepQueue();
  drainDeepQueue();
  return item;
}

/** Remove a still-queued item. A running report is never dropped mid-flight. */
export function removeQueuedDeepResearch(id: string): boolean {
  const index = deepQueue.findIndex((item) => item.id === id);
  if (index === -1 || deepQueue[index].status !== 'queued') return false;
  deepQueue.splice(index, 1);
  notifyDeepQueue();
  return true;
}

/** Drop finished (completed/failed) entries the user has acknowledged. */
export function clearFinishedDeepResearch(): void {
  for (let i = deepQueue.length - 1; i >= 0; i--) {
    if (deepQueue[i].status === 'completed' || deepQueue[i].status === 'failed') deepQueue.splice(i, 1);
  }
  notifyDeepQueue();
}

function drainDeepQueue(): void {
  if (deepQueueDraining) return;
  const next = deepQueue.find((item) => item.status === 'queued');
  if (!next) return;
  deepQueueDraining = true;
  next.status = 'running';
  notifyDeepQueue();

  const job = startDeepResearchGeneration(DEEP_RESEARCH_MAIN_JOB_KEY, next.request);
  const unsubscribe = subscribeBackgroundJob<DeepResearchRequest, DeepResearchProgress, DeepResearchGenerationResult>(
    DEEP_RESEARCH_MAIN_JOB_KEY,
    (current) => {
      if (!current || current.id !== job.id) return;
      if (current.status === 'completed') {
        next.status = 'completed';
        next.savedDraftId = current.result?.savedDraft?.id ?? null;
        finish();
      } else if (current.status === 'failed') {
        next.status = 'failed';
        next.error = current.error;
        finish();
      }
    }
  );

  function finish(): void {
    unsubscribe();
    deepQueueDraining = false;
    notifyDeepQueue();
    drainDeepQueue();
  }
}
