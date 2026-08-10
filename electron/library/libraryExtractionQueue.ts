import { randomUUID } from 'node:crypto';
import type {
  LibraryExtractionEnqueueResult,
  LibraryExtractionJob,
  LibraryExtractionOptions,
  LibraryExtractionProgress,
  LibraryItemRecord,
} from '@shared/libraryTypes';
import { LibraryCatalog } from './libraryCatalog';
import {
  DEFAULT_LIBRARY_EXTRACTION_OPTIONS,
  extractLibraryItem,
  type LibraryRemoteOcr,
} from './libraryExtractionEngine';
import { LibraryDiskStore } from './libraryStorage';
import { failLibraryExtractionRevision, markLibraryExtractionRevision } from './libraryRevision';

type ExtractFn = typeof extractLibraryItem;

export interface LibraryExtractionQueueOptions {
  store: LibraryDiskStore;
  catalog: LibraryCatalog;
  concurrency?: number;
  extract?: ExtractFn;
  remoteOcr?: LibraryRemoteOcr;
  onProgress?: (progress: LibraryExtractionProgress) => void;
}

export class LibraryExtractionQueue {
  private readonly store: LibraryDiskStore;
  private readonly catalog: LibraryCatalog;
  private readonly concurrency: number;
  private readonly extract: ExtractFn;
  private readonly remoteOcr?: LibraryRemoteOcr;
  private readonly onProgress?: (progress: LibraryExtractionProgress) => void;
  private readonly active = new Map<string, AbortController>();
  private scheduled = false;
  private disposed = false;

  constructor(options: LibraryExtractionQueueOptions) {
    this.store = options.store;
    this.catalog = options.catalog;
    this.concurrency = Math.max(1, Math.min(4, Math.trunc(options.concurrency ?? 1)));
    this.extract = options.extract ?? extractLibraryItem;
    this.remoteOcr = options.remoteOcr;
    this.onProgress = options.onProgress;
    this.catalog.resumeInterruptedExtractionJobs();
    this.schedule();
  }

  private emit(job: LibraryExtractionJob, message: string): void {
    this.onProgress?.({ ...job, message });
  }

  private item(itemId: string): LibraryItemRecord | null {
    return this.store.scanMaterializedItems().records.find((entry) => entry.id === itemId && !entry.deletedAt) ?? null;
  }

  enqueue(
    itemIds: string[],
    partialOptions: Partial<LibraryExtractionOptions> = {},
    priority = 0,
  ): LibraryExtractionEnqueueResult {
    const options = { ...DEFAULT_LIBRARY_EXTRACTION_OPTIONS, ...partialOptions };
    const result: LibraryExtractionEnqueueResult = { queued: 0, skipped: 0, jobIds: [] };
    const now = new Date().toISOString();
    for (const itemId of [...new Set(itemIds)]) {
      const item = this.item(itemId);
      const active = this.catalog.findActiveExtractionJob(itemId);
      if (!item || active || (!options.force && item.extraction?.status === 'ready')) {
        result.skipped += 1;
        if (active) result.jobIds.push(active.id);
        continue;
      }
      const job: LibraryExtractionJob = {
        id: randomUUID(), itemId, status: 'queued', phase: 'queued', progress: 0,
        priority: Math.trunc(priority), options, attempts: 0, error: null,
        createdAt: now, updatedAt: now,
      };
      this.catalog.putExtractionJob(job);
      this.emit(job, 'Documento añadido a la cola de extracción.');
      result.queued += 1;
      result.jobIds.push(job.id);
    }
    this.schedule();
    return result;
  }

  list(): LibraryExtractionJob[] {
    return this.catalog.listExtractionJobs();
  }

  cancel(jobId: string): boolean {
    const job = this.catalog.getExtractionJob(jobId);
    if (!job || !['queued', 'processing'].includes(job.status)) return false;
    this.active.get(jobId)?.abort();
    const canceled: LibraryExtractionJob = {
      ...job, status: 'canceled', phase: job.phase, error: null, updatedAt: new Date().toISOString(),
    };
    this.catalog.putExtractionJob(canceled);
    this.emit(canceled, 'Extracción cancelada.');
    return true;
  }

  retry(jobId: string): boolean {
    const job = this.catalog.getExtractionJob(jobId);
    if (!job || !['failed', 'canceled'].includes(job.status)) return false;
    const queued: LibraryExtractionJob = {
      ...job, status: 'queued', phase: 'queued', progress: 0, error: null, updatedAt: new Date().toISOString(),
    };
    this.catalog.putExtractionJob(queued);
    this.emit(queued, 'Extracción preparada para reintento.');
    this.schedule();
    return true;
  }

  private schedule(): void {
    if (this.scheduled || this.disposed) return;
    this.scheduled = true;
    setImmediate(() => {
      this.scheduled = false;
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.disposed) return;
    const available = this.concurrency - this.active.size;
    if (available <= 0) return;
    const queued = this.catalog.listExtractionJobs('queued').slice(0, available);
    for (const job of queued) void this.run(job);
  }

  private async run(initial: LibraryExtractionJob): Promise<void> {
    if (this.active.has(initial.id) || this.disposed) return;
    const controller = new AbortController();
    this.active.set(initial.id, controller);
    let job: LibraryExtractionJob = {
      ...initial, status: 'processing', phase: 'analyze', progress: 0.01,
      attempts: initial.attempts + 1, error: null, updatedAt: new Date().toISOString(),
    };
    this.catalog.putExtractionJob(job);
    this.emit(job, 'Iniciando extracción…');
    try {
      const item = this.item(job.itemId);
      if (!item) throw new Error('El documento ya no existe en la biblioteca.');
      const current = this.store.readMaterializedItem(item.storageId) ?? item;
      if (current.extraction?.status !== 'processing') {
        const now = new Date().toISOString();
        this.store.upsertItem({
          ...current,
          contentRevision: markLibraryExtractionRevision(current, 'running', 'A replacement extraction is running.', now),
          extraction: { ...current.extraction, status: 'processing', progress: 0, error: undefined, updatedAt: now },
        }, current.clock.revision, now);
      }
      await this.extract({
        item: this.store.readMaterializedItem(item.storageId) ?? item,
        store: this.store,
        extractionOptions: job.options,
        signal: controller.signal,
        remoteOcr: this.remoteOcr,
        onProgress: (value) => {
          const live = this.catalog.getExtractionJob(job.id);
          if (!live || live.status === 'canceled') return;
          job = {
            ...live, status: 'processing', phase: value.phase,
            progress: Math.max(live.progress, Math.min(0.99, value.progress)), updatedAt: new Date().toISOString(),
          };
          this.catalog.putExtractionJob(job);
          this.emit(job, value.message);
        },
      });
      const live = this.catalog.getExtractionJob(job.id);
      if (live?.status === 'canceled' || controller.signal.aborted) return;
      job = { ...job, status: 'done', phase: 'done', progress: 1, error: null, updatedAt: new Date().toISOString() };
      this.catalog.putExtractionJob(job);
      this.catalog.rebuild(this.store);
      this.emit(job, 'Extracción completada.');
    } catch (error) {
      const live = this.catalog.getExtractionJob(job.id);
      if (controller.signal.aborted || live?.status === 'canceled' || (error instanceof Error && error.name === 'AbortError')) {
        if (live?.status !== 'canceled') {
          job = { ...job, status: 'canceled', error: null, updatedAt: new Date().toISOString() };
          this.catalog.putExtractionJob(job);
          this.emit(job, 'Extracción cancelada.');
        }
        const item = this.item(job.itemId);
        if (item) {
          const current = this.store.readMaterializedItem(item.storageId) ?? item;
          if (current.extraction?.status === 'processing') {
            const now = new Date().toISOString();
            this.store.upsertItem({
              ...current,
              contentRevision: markLibraryExtractionRevision(current, 'queued', 'Replacement extraction was canceled.', now),
              extraction: { ...current.extraction, status: 'pending', progress: job.progress, error: undefined, updatedAt: now },
            }, current.clock.revision, now);
          }
          this.catalog.rebuild(this.store);
        }
      } else {
        const message = error instanceof Error ? error.message : String(error);
        job = { ...job, status: 'failed', error: message, updatedAt: new Date().toISOString() };
        this.catalog.putExtractionJob(job);
        const item = this.item(job.itemId);
        if (item) {
          const current = this.store.readMaterializedItem(item.storageId) ?? item;
          this.store.upsertItem({
            ...current,
            contentRevision: failLibraryExtractionRevision(current, message, job.updatedAt),
            extraction: {
              ...current.extraction,
              status: 'failed', progress: job.progress, updatedAt: job.updatedAt, error: message,
            },
          }, current.clock.revision, job.updatedAt);
          this.catalog.rebuild(this.store);
        }
        this.emit(job, message);
      }
    } finally {
      this.active.delete(initial.id);
      this.schedule();
    }
  }

  async waitForIdle(timeoutMs = 30_000): Promise<void> {
    const started = Date.now();
    while (this.active.size || this.catalog.listExtractionJobs('queued').length) {
      if (Date.now() - started > timeoutMs) throw new Error('La cola de extracción no terminó a tiempo.');
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const controller of this.active.values()) controller.abort();
    this.active.clear();
  }
}
