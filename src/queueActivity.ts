import { useEffect, useState } from 'react';
import { clearBackgroundJob, subscribeBackgroundJobs, type AnyJob } from './backgroundJobs';
import type { OcrDocProgress } from '@shared/aiOcrTypes';
import type { DeepResearchJobRecord, DocumentIndexProgress, EmbeddingPipelineProgress, PassageEmbeddingProgress, QueueProgress } from '@shared/types';
import type { DictionaryProgress } from '@shared/dictionary';
import type { LibraryExtractionJob, ZoteroImportProgress } from '@shared/libraryTypes';

export const DOCUMENT_LIVE = new Set(['queued', 'running', 'paused']);
export const ZOTERO_FINISHED = new Set(['complete', 'canceled', 'failed']);
export const DICTIONARY_FINISHED = new Set(['done', 'degraded', 'failed']);
export const embeddingVisible = (p: EmbeddingPipelineProgress | null) => Boolean(p && (p.running || p.paused || p.cancelled || p.totalIdeas > 0 || p.error));
export const passageVisible = (p: PassageEmbeddingProgress | null) => Boolean(p && (p.running || p.paused || p.cancelled || p.totalPassages > 0 || p.error));

interface QueueSnapshot {
  queue: QueueProgress | null;
  zotero: ZoteroImportProgress | null;
  documents: DocumentIndexProgress | null;
  embeddings: EmbeddingPipelineProgress | null;
  passages: PassageEmbeddingProgress | null;
  extraction: (LibraryExtractionJob & { message?: string })[];
  research: DeepResearchJobRecord[];
  dictionary: DictionaryProgress[];
  background: AnyJob[];
  ocr: (OcrDocProgress & { id: string; name?: string; updatedAt?: number })[];
}
export function backgroundFailure(job: AnyJob): string | number | null {
  if (job.error) return job.error;
  if (!job.result || typeof job.result !== 'object') return null;
  const result = job.result as Record<string, unknown>;
  if (typeof result.saveError === 'string') return result.saveError;
  if (typeof result.failed === 'number' && result.failed > 0) return result.failed;
  if (Array.isArray(result.files)) {
    const failed = result.files.filter((file: { error?: unknown }) => file.error);
    if (failed.length) return failed.length;
  }
  return null;
}
const activeFirst = (a: boolean, b: boolean) => Number(b) - Number(a);
const EMPTY: QueueSnapshot = { queue: null, zotero: null, documents: null, embeddings: null, passages: null, extraction: [], research: [], dictionary: [], background: [], ocr: [] };
const DISMISSED_STORAGE_KEY = 'nodus.queue.dismissed.v1';
export const researchVersion = (job: DeepResearchJobRecord) => `${job.status}:${job.finishedAt ?? ''}:${job.saveError ?? ''}`;
export const ocrVersion = (job: QueueSnapshot['ocr'][number]) => `${job.status}:${job.doneCount}:${job.errorCount}:${job.error ?? ''}`;
const scanVersion = (job: QueueProgress['items'][number]) => `${job.state}:${job.enqueued_at}:${job.finished_at}:${job.error ?? ''}`;
const pipelineVersion = (progress: EmbeddingPipelineProgress | PassageEmbeddingProgress) => JSON.stringify(progress);

function readDismissed(): Record<string, string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(DISMISSED_STORAGE_KEY) ?? '{}');
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value).filter(([, version]) => typeof version === 'string'));
    }
  } catch { /* A damaged or unavailable preference must not break the queue. */ }
  return {};
}

/** Persisted result lists are history, not fresh notifications. Failures remain actionable. */
function taskStates(snapshot: Partial<QueueSnapshot>) {
  return [
    ...(snapshot.extraction ?? []).map((job) => ({ key: `extraction:${job.id}`, version: `${job.status}:${job.updatedAt}`, active: job.status === 'queued' || job.status === 'processing', settled: job.status === 'canceled' || (job.status === 'done' && !job.error), updatedAt: job.updatedAt })),
    ...(snapshot.documents?.campaigns ?? []).map((job) => ({ key: `documents:${job.campaignId}`, version: `${job.status}:${job.updatedAt}`, active: DOCUMENT_LIVE.has(job.status), settled: job.status === 'cancelled' || (job.status === 'completed' && !job.failedJobs && !job.error), updatedAt: job.updatedAt })),
    ...(snapshot.research ?? []).map((job) => ({ key: `research:${job.id}`, version: researchVersion(job), active: job.status === 'queued' || job.status === 'running', settled: !job.saveError && (job.status === 'cancelled' || (job.status === 'completed' && !job.error)), updatedAt: job.finishedAt ?? job.enqueuedAt })),
    ...(snapshot.ocr ?? []).map((job) => ({ key: `ocr:${job.id}`, version: ocrVersion(job), active: job.status === 'pending' || job.status === 'processing', settled: job.status === 'cancelled' || (job.status === 'done' && !job.errorCount && !job.error), updatedAt: job.updatedAt })),
    ...(snapshot.dictionary ?? []).map((job) => ({ key: `dictionary:${job.entryId}`, version: job.phase, active: !DICTIONARY_FINISHED.has(job.phase), settled: job.phase === 'done' && !job.error, updatedAt: undefined })),
    // These session progress channels only participate in explicit dismissal.
    ...(snapshot.queue?.items ?? []).map((job) => ({ key: `scan:${job.id}`, version: scanVersion(job), active: DOCUMENT_LIVE.has(job.state), settled: false, updatedAt: undefined })),
    ...(snapshot.zotero ? [{ key: 'zotero', version: `${snapshot.zotero.requestId}:${snapshot.zotero.phase}`, active: !ZOTERO_FINISHED.has(snapshot.zotero.phase), settled: false, updatedAt: undefined }] : []),
    ...(embeddingVisible(snapshot.embeddings ?? null) && snapshot.embeddings ? [{ key: 'embeddings', version: pipelineVersion(snapshot.embeddings), active: snapshot.embeddings.running || snapshot.embeddings.paused, settled: false, updatedAt: undefined }] : []),
    ...(passageVisible(snapshot.passages ?? null) && snapshot.passages ? [{ key: 'passages', version: pipelineVersion(snapshot.passages), active: snapshot.passages.running || snapshot.passages.paused, settled: false, updatedAt: undefined }] : []),
  ];
}

/** One owner for all progress: closing the dropdown never drops an event. */
export function useQueueActivity() {
  const [snapshot, setSnapshot] = useState<QueueSnapshot>(EMPTY);
  const [dismissed, setDismissed] = useState(readDismissed);
  useEffect(() => {
    try { localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(dismissed)); }
    catch { /* Queue controls still work when preference storage is unavailable. */ }
  }, [dismissed]);
  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();
    const observed = new Set<string>();
    const off: (() => void)[] = [];
    const restoreDismissed = (key: string) => setDismissed((current) => {
      if (!(key in current)) return current;
      const next = { ...current }; delete next[key]; return next;
    });
    const observe = (value: Partial<QueueSnapshot>, initial: boolean) => {
      if (cancelled) return;
      const historical: Record<string, string> = {};
      for (const task of taskStates(value)) {
        // Whole-list broadcasts can contain old results alongside a new task.
        // Once observed, a task's subsequent completion belongs to this session.
        const updatedAt = typeof task.updatedAt === 'number' ? task.updatedAt : task.updatedAt ? Date.parse(task.updatedAt) : NaN;
        const fromHistory = Number.isFinite(updatedAt) ? updatedAt < startedAt : initial;
        if (!observed.has(task.key) && task.settled && fromHistory) {
          historical[task.key] = task.version;
        }
        observed.add(task.key);
        if (task.active) restoreDismissed(task.key);
      }
      if (Object.keys(historical).length) setDismissed((current) => ({ ...current, ...historical }));
    };
    function watch<K extends keyof QueueSnapshot>(key: K, read: () => Promise<QueueSnapshot[K]>, subscribe: (cb: (value: QueueSnapshot[K]) => void) => () => void) {
      let received = false;
      off.push(subscribe((value) => {
        received = true;
        observe({ [key]: value }, false);
        if (!cancelled) setSnapshot((current) => ({ ...current, [key]: value }));
      }));
      void read().then((value) => {
        // An IPC snapshot requested before a broadcast must not overwrite it later.
        if (!cancelled && !received) {
          observe({ [key]: value }, true);
          setSnapshot((current) => ({ ...current, [key]: value }));
        }
      }).catch((error: unknown) => console.warn(`Queue snapshot (${key})`, error));
    }
    const api = window.nodus;
    watch('queue', () => api.getQueue(), (cb) => api.onQueueProgress(cb));
    watch('documents', () => api.getDocumentIndexProgress(), (cb) => api.onDocumentIndexProgress(cb));
    watch('embeddings', () => api.getEmbeddingStatus(), (cb) => api.onEmbeddingProgress(cb));
    watch('passages', () => api.getPassageStatus(), (cb) => api.onPassageProgress(cb));
    watch('zotero', async () => {
      const sessions = await api.listZoteroSyncSessions();
      return sessions.find((s) => s.status === 'running' && Date.now() - Date.parse(s.updatedAt) < 60_000)?.progress ?? null;
    }, (cb) => api.onZoteroImportProgress(cb));
    watch('research', () => api.listDeepResearchJobs(), (cb) => api.onDeepResearchQueue(cb));

    // These channels publish individual jobs, rather than whole snapshots.
    function watchJobs<K extends 'extraction' | 'dictionary' | 'ocr', T extends QueueSnapshot[K][number]>(key: K, read: () => Promise<T[]>, subscribe: (cb: (value: T) => void) => () => void, id: (value: T) => string) {
      const updates = new Map<string, T>();
      off.push(subscribe((value) => {
        updates.set(id(value), value);
        observe({ [key]: [value] }, false);
        if (!cancelled) setSnapshot((current) => ({ ...current, [key]: [...(current[key] as T[]).filter((job) => id(job) !== id(value)), { ...(current[key] as T[]).find((job) => id(job) === id(value)), ...value }] }));
      }));
      void read().then((values) => {
        observe({ [key]: values.filter((value) => !updates.has(id(value))) }, true);
        if (!cancelled) setSnapshot((current) => ({ ...current, [key]: [...values.map((value) => ({ ...value, ...updates.get(id(value)) })), ...[...updates.values()].filter((value) => !values.some((initial) => id(initial) === id(value)))] }));
      }).catch((error: unknown) => console.warn(`Queue snapshot (${key})`, error));
    }
    watchJobs('extraction', () => api.listLibraryExtractionJobs(), (cb: (p: LibraryExtractionJob & { message?: string }) => void) => api.onLibraryExtractionProgress(cb), (p) => p.id);
    off.push(subscribeBackgroundJobs((background) => { if (!cancelled) setSnapshot((current) => ({ ...current, background })); }));
    watchJobs<'ocr', QueueSnapshot['ocr'][number]>('ocr', async () => (await api.listOcrDocs()).map((job) => ({ ...job, docId: job.id })), (cb: (p: OcrDocProgress & { id: string; name?: string }) => void) => api.onOcrEvent((id, p) => cb({ ...p, id })), (p) => p.id);
    watchJobs('dictionary', () => api.listDictionaryGenerationJobs(), (cb) => api.onDictionaryProgress(cb), (p) => p.entryId);
    return () => { cancelled = true; off.forEach((unsubscribe) => unsubscribe()); };
  }, []);

  const zotero = snapshot.zotero && dismissed.zotero !== `${snapshot.zotero.requestId}:${snapshot.zotero.phase}` ? snapshot.zotero : null;
  const extraction = snapshot.extraction.filter((job) => dismissed[`extraction:${job.id}`] !== `${job.status}:${job.updatedAt}`).sort((a, b) => activeFirst(a.status === 'processing' || a.status === 'queued', b.status === 'processing' || b.status === 'queued'));
  const research = snapshot.research.filter((job) => dismissed[`research:${job.id}`] !== researchVersion(job)).sort((a, b) => activeFirst(a.status === 'running' || a.status === 'queued', b.status === 'running' || b.status === 'queued'));
  const dictionary = snapshot.dictionary.filter((job) => dismissed[`dictionary:${job.entryId}`] !== job.phase).sort((a, b) => activeFirst(!DICTIONARY_FINISHED.has(a.phase), !DICTIONARY_FINISHED.has(b.phase)));
  const ocr = snapshot.ocr.filter((job) => dismissed[`ocr:${job.id}`] !== ocrVersion(job)).sort((a, b) => activeFirst(a.status === 'processing' || a.status === 'pending', b.status === 'processing' || b.status === 'pending'));
  const background = [...snapshot.background].sort((a, b) => activeFirst(a.status === 'running', b.status === 'running'));
  const embeddings = snapshot.embeddings && (snapshot.embeddings.running || snapshot.embeddings.paused || dismissed.embeddings !== pipelineVersion(snapshot.embeddings)) ? snapshot.embeddings : null;
  const passages = snapshot.passages && (snapshot.passages.running || snapshot.passages.paused || dismissed.passages !== pipelineVersion(snapshot.passages)) ? snapshot.passages : null;
  const items = snapshot.queue?.items.filter((job) => DOCUMENT_LIVE.has(job.state) || dismissed[`scan:${job.id}`] !== scanVersion(job)) ?? [];
  const queue = snapshot.queue && items.length !== snapshot.queue.items.length
    ? { ...snapshot.queue, items, total: items.length, done: items.filter((job) => job.state === 'done').length, failed: items.filter((job) => job.state === 'failed').length }
    : snapshot.queue;
  const documents = snapshot.documents && { ...snapshot.documents, campaigns: snapshot.documents.campaigns.filter((job) => dismissed[`documents:${job.campaignId}`] !== `${job.status}:${job.updatedAt}`) };
  const queueActive = Boolean(queue && (queue.maintenanceRunning || queue.items.some((item) => DOCUMENT_LIVE.has(item.state))));
  const documentsActive = Boolean(documents?.campaigns.some((campaign) => DOCUMENT_LIVE.has(campaign.status)));
  const visible = Number(Boolean(queue && (queue.total > 0 || queue.maintenanceRunning || queue.maintenanceError)))
    + Number(Boolean(zotero)) + Number(Boolean(documents?.campaigns.length)) + Number(embeddingVisible(embeddings)) + Number(passageVisible(passages))
    + Number(extraction.length > 0) + Number(research.length > 0) + Number(dictionary.length > 0) + Number(ocr.length > 0) + Number(background.length > 0);
  const live = Number(queueActive) + Number(Boolean(zotero && !ZOTERO_FINISHED.has(zotero.phase)))
    + Number(documentsActive) + Number(Boolean(embeddings && (embeddings.running || embeddings.paused)))
    + Number(Boolean(passages && (passages.running || passages.paused)))
    + Number(extraction.some((job) => job.status === 'queued' || job.status === 'processing'))
    + Number(research.some((job) => job.status === 'queued' || job.status === 'running'))
    + Number(dictionary.some((job) => !DICTIONARY_FINISHED.has(job.phase)))
    + Number(ocr.some((job) => job.status === 'pending' || job.status === 'processing')) + Number(background.some((job) => job.status === 'running'));
  const attention = Boolean(queue?.maintenanceError || queue?.failed || queue?.pausedReason || embeddings?.error || passages?.error
    || zotero?.phase === 'failed' || documents?.campaigns.some((job) => job.status !== 'cancelled' && (job.status === 'failed' || job.failedJobs > 0 || job.error))
    || extraction.some((job) => job.status === 'failed') || research.some((job) => job.status === 'failed' || job.saveError)
    || dictionary.some((job) => job.phase === 'failed' || job.phase === 'degraded') || ocr.some((job) => job.status !== 'cancelled' && (job.status === 'error' || job.errorCount > 0 || job.error)) || background.some((job) => job.status === 'failed' || backgroundFailure(job)));
  const finished = taskStates(snapshot).filter((task) => !task.active && dismissed[task.key] !== task.version);
  const finishedBackground = background.filter((job) => job.status !== 'running');
  return { ...snapshot, queue, embeddings, passages, documents, zotero, extraction, research, dictionary, ocr, background, visible, live, attention,
    canClearFinished: finished.length > 0 || finishedBackground.length > 0,
    clearFinished: () => {
      setDismissed((current) => ({ ...current, ...Object.fromEntries(finished.map((task) => [task.key, task.version])) }));
      for (const job of finishedBackground) clearBackgroundJob(job.key, job.id);
    },
    dismiss: (key: string, version: string) => setDismissed((current) => ({ ...current, [key]: version })),
  };
}
export type QueueActivity = ReturnType<typeof useQueueActivity>;
