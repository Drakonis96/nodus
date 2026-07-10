import type {
  DeepResearchProgress,
  DeepResearchReport,
  DeepResearchRequest,
  ImmersionBuildProgress,
  ImmersionRequest,
  ImmersionScope,
  ImmersionSession,
  WritingWorkshopSavedDraft,
} from '@shared/types';

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
      const savedDraft = await window.nodus.saveWritingWorkshopDraft({ draft: report.draft, model: currentRequest.model });
      return { report, savedDraft, saveError: null };
    } catch (error) {
      return { report, savedDraft: null, saveError: messageFromError(error) };
    }
  });
}
