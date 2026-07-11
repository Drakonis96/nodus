import { v4 as uuid } from 'uuid';
import type { QueueItem, QueueKind, QueueProgress, Work, ModelRef, SourceType } from '@shared/types';
import { getDb } from '../db/database';
import { getSettings } from '../db/settingsRepo';
import { runLightScan } from '../ai/lightScan';
import { runDeepScan } from '../ai/deepScan';
import { runSummaryScan } from '../ai/summaryScan';
import { reprocessConnections } from '../ai/reprocessConnections';
import { listThemeLabels } from '../db/themesRepo';
import { resolveWorkText } from '../extraction/textExtractor';
import { getItem } from '../zotero/zoteroClient';
import { setDeepResult, setSummaryPending } from '../db/worksRepo';
import { failedSummaryWorks, pendingSummaryWorks } from '../db/workSummariesRepo';
import { purgeDeepData } from '../db/ideasRepo';
import { AiError } from '../ai/aiClient';
import { discoverSemanticBridges } from '../ai/semanticBridges';
import { startEmbedding, getEmbeddingSnapshot } from '../ai/embeddingPipeline';
import { startPassageEmbedding, getPassageSnapshot } from '../ai/passageEmbeddingPipeline';
import { startPerf } from '../perf';

type ProgressListener = (p: QueueProgress) => void;

const MAX_RETRIES = 4;
// A deep scan that degraded to abstract-only may simply have raced a just-attached
// file. Re-scan once after this delay so the full text is picked up automatically
// once Zotero has finished landing the attachment.
const DEGRADED_RETRY_DELAY_MS = 90_000;

class ScanQueue {
  private items: QueueItem[] = [];
  private paused = false;
  /** Set when the queue auto-paused on a misconfiguration; cleared on resume. */
  private pausedReason: string | null = null;
  private running = false;
  private listeners = new Set<ProgressListener>();
  private retries = new Map<string, number>();
  /** Last scan kind dequeued, used to interleave deep/light/summary fairly. */
  private lastKind: 'light' | 'deep' | 'summary' | null = null;
  /** True if at least one deep scan completed since the last reprocess run. */
  private deepSinceReprocess = false;
  /** Guards against concurrent reprocess runs. */
  private reprocessing = false;
  /** Works whose deep scan completed this cycle, awaiting (re-)indexing on drain. */
  private pendingIndexWorks = new Set<string>();
  /** Works already given a delayed re-scan after degrading to abstract-only, so a
   *  work is retried at most once per session (the re-scan itself is idempotent). */
  private degradedRetryScheduled = new Set<string>();
  /** True when a completed deep scan requested semantic bridge discovery on drain. */
  private bridgeAfterDrain = false;

  onProgress(cb: ProgressListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(): void {
    const p = this.snapshot();
    for (const l of this.listeners) l(p);
  }

  snapshot(): QueueProgress {
    const done = this.items.filter((i) => i.state === 'done').length;
    const failed = this.items.filter((i) => i.state === 'failed').length;
    const current = this.items.find((i) => i.state === 'running');
    return {
      paused: this.paused,
      pausedReason: this.pausedReason,
      total: this.items.length,
      done,
      failed,
      current: current ? { title: current.title, kind: current.kind } : null,
      items: [...this.items],
    };
  }

  isBusy(): boolean {
    return this.running || this.items.some((item) => item.state === 'queued' || item.state === 'running');
  }

  /** Keep active/pending work at the top and completed history at the bottom. */
  private insertPending(item: QueueItem): void {
    const firstTerminal = this.items.findIndex((candidate) =>
      candidate.state === 'done' || candidate.state === 'failed' || candidate.state === 'cancelled'
    );
    this.items.splice(firstTerminal >= 0 ? firstTerminal : this.items.length, 0, item);
  }

  private moveRunningToFront(item: QueueItem): void {
    const index = this.items.indexOf(item);
    if (index < 0) return;
    this.items.splice(index, 1);
    const firstNonRunning = this.items.findIndex((candidate) => candidate.state !== 'running');
    this.items.splice(firstNonRunning >= 0 ? firstNonRunning : this.items.length, 0, item);
  }

  private moveTerminalToEnd(item: QueueItem): void {
    const index = this.items.indexOf(item);
    if (index < 0) return;
    this.items.splice(index, 1);
    this.items.push(item);
  }

  enqueue(nodusId: string, title: string, kind: QueueKind, model?: ModelRef | null, opts?: { chain?: boolean }): void {
    // Avoid duplicate pending/running jobs for the same work+kind.
    const existing = this.items.find(
      (i) => i.nodus_id === nodusId && i.kind === kind && (i.state === 'queued' || i.state === 'running')
    );
    if (existing) {
      // Preserve a chain request even when the job is already queued.
      if (opts?.chain) existing.chain = true;
      return;
    }
    this.insertPending({
      id: uuid(),
      nodus_id: nodusId,
      title,
      kind,
      state: 'queued',
      error: null,
      enqueued_at: new Date().toISOString(),
      model: model ?? null,
      chain: opts?.chain ?? false,
    });
    this.emit();
    void this.run();
  }

  enqueueBridge(model?: ModelRef | null): void {
    if (this.items.some((i) => i.kind === 'bridge' && (i.state === 'queued' || i.state === 'running'))) {
      return;
    }
    this.insertPending({
      id: uuid(),
      nodus_id: '',
      title: 'Descubrir relaciones semánticas',
      kind: 'bridge',
      state: 'queued',
      error: null,
      enqueued_at: new Date().toISOString(),
      model: model ?? null,
    });
    this.emit();
    void this.run();
  }

  pause(): void {
    this.paused = true;
    this.emit();
  }

  resume(): void {
    this.paused = false;
    this.pausedReason = null;
    this.emit();
    void this.run();
  }

  cancelItem(id: string): void {
    const item = this.items.find((i) => i.id === id);
    if (item && (item.state === 'queued' || item.state === 'paused')) {
      item.state = 'cancelled';
      this.resetPendingStatus(item);
      this.moveTerminalToEnd(item);
    }
    this.emit();
  }

  moveToTop(id: string): void {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx < 0 || this.items[idx].state !== 'queued') return;
    const [item] = this.items.splice(idx, 1);
    const firstQueued = this.items.findIndex((i) => i.state === 'queued');
    const insertAt = firstQueued >= 0 ? firstQueued : this.items.length;
    this.items.splice(insertAt, 0, item);
    if (item.kind !== 'bridge') {
      const order: Array<'deep' | 'light' | 'summary'> = ['deep', 'light', 'summary'];
      this.lastKind = order[(order.indexOf(item.kind) + order.length - 1) % order.length];
    }
    this.emit();
  }

  clear(): void {
    for (const item of this.items) {
      if (item.state === 'queued' || item.state === 'cancelled' || item.state === 'paused') {
        this.resetPendingStatus(item);
      }
    }
    this.items = this.items.filter((i) => i.state === 'running');
    this.emit();
  }

  /**
   * Stop and remove a single item — including one that's currently running. The
   * in-flight scan can't be truly aborted, so it's abandoned: we detach the item
   * from the list and reset its pending status so it isn't resumed on restart.
   */
  removeItem(id: string): void {
    const item = this.items.find((i) => i.id === id);
    if (!item) return;
    this.resetPendingStatus(item);
    this.retries.delete(item.id);
    this.items = this.items.filter((i) => i.id !== id);
    this.emit();
  }

  /**
   * Stop everything and empty the queue, including the running job. Resets the
   * paused state so future enqueues run, and clears pending DB statuses so the
   * abandoned work isn't auto-resumed.
   */
  stopAll(): void {
    for (const item of this.items) this.resetPendingStatus(item);
    this.items = [];
    this.retries.clear();
    this.lastKind = null;
    this.pendingIndexWorks.clear();
    this.degradedRetryScheduled.clear();
    this.bridgeAfterDrain = false;
    this.deepSinceReprocess = false;
    this.paused = false;
    this.pausedReason = null;
    this.emit();
  }

  private resetPendingStatus(item: QueueItem): void {
    if (item.kind === 'bridge') return;
    const column = item.kind === 'deep' ? 'deep_status' : item.kind === 'summary' ? 'summary_status' : 'light_status';
    getDb().prepare(`UPDATE works SET ${column} = 'none' WHERE nodus_id = ? AND ${column} = 'pending'`).run(item.nodus_id);
  }

  /**
   * Pick the next job by rotating deep/light/summary so no independent scan kind
   * starves the others. Bridge jobs remain a valid fallback without entering rotation.
   */
  private nextQueued(): QueueItem | undefined {
    const queued = this.items.filter((i) => i.state === 'queued');
    if (queued.length === 0) return undefined;
    const order: Array<'deep' | 'light' | 'summary'> = ['deep', 'light', 'summary'];
    const nextIndex = this.lastKind === null ? 0 : (order.indexOf(this.lastKind) + 1) % order.length;
    const pick = queued.find((item) => item.kind === order[nextIndex]) ?? queued[0];
    if (pick.kind !== 'bridge') this.lastKind = pick.kind;
    return pick;
  }

  private async run(): Promise<void> {
    if (this.running || this.paused) return;
    this.running = true;
    try {
      const concurrency = Math.max(1, getSettings().concurrency || 1);
      // Sequential by default (concurrency=1); honour the configured limit.
      const inFlight: Promise<void>[] = [];
      let next: QueueItem | undefined;
      while (!this.paused && (next = this.nextQueued())) {
        const job = next;
        const promise = this.process(job).finally(() => {
          const idx = inFlight.indexOf(promise);
          if (idx >= 0) inFlight.splice(idx, 1);
        });
        inFlight.push(promise);
        if (inFlight.length >= concurrency) await Promise.race(inFlight);
      }
      await Promise.all(inFlight);
    } finally {
      this.running = false;
    }
    if (!this.paused && this.nextQueued()) {
      void this.run();
    } else if (!this.paused && this.deepSinceReprocess && !this.reprocessing) {
      // Queue drained after deep scans → re-trace relations, (re-)index and
      // discover semantic bridges so the global graph stays connected.
      void this.runPostBatch();
    }
  }

  /**
   * Post-batch chain that runs once the queue drains after deep scans: re-trace
   * inter-work relations + theme memberships, (re-)index the just-scanned works
   * (idea embeddings + full-text passages), then discover semantic bridges. Each
   * step is best-effort; failures are logged and never block the queue.
   */
  private async runPostBatch(): Promise<void> {
    await this.autoReprocessConnections();
    const ids = Array.from(this.pendingIndexWorks);
    this.pendingIndexWorks.clear();
    await this.autoIndex(ids);
    if (this.bridgeAfterDrain) {
      this.bridgeAfterDrain = false;
      this.maybeEnqueueBridge();
    }
  }

  /**
   * Chain the remaining pipeline steps after a deep scan finishes: regenerate the
   * orientation summary (so it reflects the fresh analysis), schedule the work for
   * re-indexing, and arm bridge discovery for the next drain. `item.chain` forces
   * the chain even when the auto-* settings are off (used by "Procesar todo").
   */
  private chainAfterDeep(work: Work, item: QueueItem): void {
    try {
      const settings = getSettings();
      this.pendingIndexWorks.add(work.nodus_id);
      if (item.chain || settings.autoBridgeAfterQueue) this.bridgeAfterDrain = true;
      if (item.chain || settings.autoSummaryAfterDeep) {
        setSummaryPending(work.nodus_id);
        this.enqueue(work.nodus_id, work.title, 'summary', item.model ?? null);
      }
    } catch (e) {
      console.error('[scanQueue] encadenado tras profundo falló:', e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Automatically re-run connection reprocessing (themes + inter-work idea
   * relations) after a batch of deep scans completes. Runs once per drain cycle;
   * failures are logged but never block the queue.
   */
  private async autoReprocessConnections(): Promise<void> {
    if (this.reprocessing) return;
    this.reprocessing = true;
    try {
      await reprocessConnections({ relations: true });
    } catch (e) {
      console.error('[scanQueue] reprocess automático falló:', e instanceof Error ? e.message : String(e));
    } finally {
      this.deepSinceReprocess = false;
      this.reprocessing = false;
    }
  }

  /** True when an embedding provider + model are configured for indexing. */
  private embeddingConfigured(): boolean {
    const settings = getSettings();
    return Boolean(settings.embeddingProvider || settings.embeddingModel);
  }

  /**
   * Index the given works after their deep scan: idea embeddings first (needed by
   * bridge discovery), then full-text passages. Awaits completion so a subsequent
   * bridge job runs against fresh embeddings. Skips when there is nothing to index
   * or no embedding model is configured; each pipeline is best-effort.
   */
  private async autoIndex(nodusIds: string[]): Promise<void> {
    if (nodusIds.length === 0 || !this.embeddingConfigured()) return;
    try {
      if (!getEmbeddingSnapshot().running) await startEmbedding(nodusIds);
    } catch (e) {
      console.error('[scanQueue] auto-indexación de ideas falló:', e instanceof Error ? e.message : String(e));
    }
    try {
      if (!getPassageSnapshot().running) await startPassageEmbedding(nodusIds);
    } catch (e) {
      console.error('[scanQueue] auto-indexación de pasajes falló:', e instanceof Error ? e.message : String(e));
    }
  }

  /** Enqueue semantic bridge discovery once indexing is done, if configured. */
  private maybeEnqueueBridge(): void {
    if (!this.embeddingConfigured()) return;
    const settings = getSettings();
    this.enqueueBridge(settings.synthesisModel ?? null);
  }

  private async process(item: QueueItem): Promise<void> {
    item.state = 'running';
    this.moveRunningToFront(item);
    this.emit();
    if (item.kind === 'bridge') {
      try {
        await this.doBridge(item);
        item.state = 'done';
        item.error = null;
      } catch (e) {
        item.state = 'failed';
        item.error = (e as Error).message;
      }
      this.moveTerminalToEnd(item);
      this.emit();
      return;
    }
    const work = getWorkById(item.nodus_id);
    if (!work) {
      item.state = 'failed';
      item.error = 'Obra no encontrada';
      this.moveTerminalToEnd(item);
      this.emit();
      return;
    }
    try {
      if (item.kind === 'light') {
        await this.doLight(work, item.model ?? null);
      } else if (item.kind === 'deep') {
        const deepInfo = await this.doDeep(work, item);
        this.deepSinceReprocess = true;
        this.maybeScheduleDegradedRetry(work, deepInfo);
      } else {
        await this.doSummary(work, item);
      }
      item.state = 'done';
      item.error = null;
      item.detail = null;
      item.subPct = null;
    } catch (e) {
      // A misconfiguration (no model / no key / invalid key) fails identically for
      // every job, so pause the queue once and surface it instead of marking the
      // entire library as failed. The job stays queued and resumes after the fix.
      if (e instanceof AiError && e.config) {
        item.state = 'queued';
        item.error = null;
        this.pausedReason = (e as Error).message;
        console.error(`[scanQueue] configuración: ${this.pausedReason} — cola en pausa`);
        this.pause();
        return;
      }
      const retriable = e instanceof AiError && e.retriable;
      const attempts = (this.retries.get(item.id) ?? 0) + 1;
      this.retries.set(item.id, attempts);
      if (retriable && attempts <= MAX_RETRIES) {
        const backoff = 2000 * 2 ** (attempts - 1);
        item.state = 'queued';
        item.error = `Reintentando (${attempts}/${MAX_RETRIES})…`;
        this.emit();
        await delay(backoff);
      } else {
        item.state = 'failed';
        item.error = (e as Error).message;
        console.error(`[scanQueue] ${item.kind} falló: ${item.title} -> ${(e as Error).message}`);
        // Persist deep-scan failure so it's visible in the library and not
        // re-enqueued forever by resumePending(). (Light scans already persist.)
        if (item.kind === 'deep') {
          purgeDeepData(work.nodus_id);
          setDeepResult(work.nodus_id, 'failed', null, null, (e as Error).message);
        }
      }
    }
    // After a successful deep scan, chain the rest of the pipeline (summary now;
    // index + bridge on drain). Kept outside the try/catch so a chaining hiccup
    // can never re-mark the completed deep scan as failed.
    if (item.kind === 'deep' && item.state === 'done') this.chainAfterDeep(work, item);
    if (item.state === 'done' || item.state === 'failed') this.moveTerminalToEnd(item);
    this.emit();
  }

  private async doLight(work: Work, model: ModelRef | null): Promise<void> {
    const settings = getSettings();
    let abstract: string | null = null;
    try {
      const item = await getItem(settings.zoteroUserId, work.zotero_key);
      abstract = item?.abstract ?? null;
    } catch {
      abstract = null;
    }
    // When the user has locked the main themes, constrain assignment to that set.
    const lockedLabels = settings.themesLocked ? listThemeLabels() : null;
    await runLightScan(work, abstract, model, { lockedLabels });
  }

  private async doDeep(
    work: Work,
    queueItem: QueueItem
  ): Promise<{ sourceType: SourceType | null; hadTextAttachment: boolean }> {
    const settings = getSettings();
    const perf = { nodusId: work.nodus_id, title: work.title };
    let abstract: string | null = null;
    const metadataDone = startPerf('abstract/Zotero metadata', perf);
    try {
      const item = await getItem(settings.zoteroUserId, work.zotero_key);
      abstract = item?.abstract ?? null;
      metadataDone({ abstract: Boolean(abstract) });
    } catch (e) {
      metadataDone({ status: 'error', error: e instanceof Error ? e.message : String(e) });
      /* offline: rely on stored attachments */
    }
    const doc = await resolveWorkText(
      settings.zoteroUserId,
      work.zotero_key,
      settings.zoteroStoragePath,
      abstract,
      work.doi,
      {
        unpaywallEmail: settings.unpaywallEmail,
        preferZoteroFulltext: settings.preferZoteroFulltext,
        ocr: { enabled: settings.ocrEnabled, languages: settings.ocrLanguages, maxPages: settings.ocrMaxPages },
        perf,
        onProgress: (p) => {
          queueItem.detail = p.detail;
          queueItem.subPct = p.pct;
          this.emit();
        },
      },
      work.item_type
    );
    queueItem.detail = 'Analizando con IA…';
    queueItem.subPct = null;
    this.emit();
    await runDeepScan(work, doc, queueItem.model ?? null, (p) => {
      queueItem.detail = p.detail;
      queueItem.subPct = p.pct;
      this.emit();
    });
    return { sourceType: doc.sourceType, hadTextAttachment: Boolean(doc.hadTextAttachment) };
  }

  /**
   * A deep scan that fell back to the abstract (source_type abstract_only/none)
   * while the Zotero item *does* expose a document attachment usually just raced a
   * file that landed in storage moments after the text was resolved. Schedule one
   * delayed re-scan so the full text is picked up automatically. Re-running is
   * idempotent — if the resolved text is unchanged, runDeepScan is a no-op — and
   * each work is retried at most once per session to prevent loops.
   */
  private maybeScheduleDegradedRetry(
    work: Work,
    info: { sourceType: SourceType | null; hadTextAttachment: boolean }
  ): void {
    const degraded = info.sourceType === 'abstract_only' || info.sourceType === 'none';
    if (!degraded || !info.hadTextAttachment || this.degradedRetryScheduled.has(work.nodus_id)) return;
    this.degradedRetryScheduled.add(work.nodus_id);
    setTimeout(() => {
      const current = getWorkById(work.nodus_id);
      // Skip if the work is gone, failed meanwhile, or already recovered full text
      // (source_type is no longer abstract-only) — a re-scan would only be a no-op.
      if (!current || current.deep_status === 'failed') return;
      if (current.source_type !== 'abstract_only' && current.source_type !== 'none') return;
      this.enqueue(current.nodus_id, current.title, 'deep');
    }, DEGRADED_RETRY_DELAY_MS);
  }

  private async doSummary(work: Work, item: QueueItem): Promise<void> {
    item.detail = 'Resumiendo…';
    item.subPct = null;
    this.emit();
    await runSummaryScan(work, item.model ?? null);
  }

  private async doBridge(item: QueueItem): Promise<void> {
    item.detail = 'Escaneando pares semánticos…';
    item.subPct = null;
    this.emit();
    const result = await discoverSemanticBridges(item.model ?? null, (p) => {
      if (p.phase === 'validation') {
        item.detail = `${p.label} (${p.current}/${p.total})`;
        item.subPct = p.total > 0 ? p.current / p.total : null;
      } else if (p.phase === 'scan') {
        item.detail = p.label;
        item.subPct = null;
      } else if (p.phase === 'done') {
        item.detail = p.label;
        item.subPct = 1;
      }
      this.emit();
    });
    item.detail = `${result.added} nuevas · ${result.validated} validados · ${result.candidatesScanned} escaneados`;
    item.subPct = 1;
    this.emit();
  }

  /**
   * Re-enqueue works whose last scan failed — manual recovery after the user fixes
   * the configuration (e.g. selects a model). Resets them to pending and resumes.
   */
  retryFailed(): void {
    const db = getDb();
    const failedLight = db
      .prepare("SELECT nodus_id, title FROM works WHERE light_status = 'failed' AND archived = 0")
      .all() as { nodus_id: string; title: string }[];
    const failedDeep = db
      .prepare(
        "SELECT nodus_id, title FROM works WHERE deep_status = 'failed' AND archived = 0 AND (read_tag = 1 OR manual_deep = 1)"
      )
      .all() as { nodus_id: string; title: string }[];
    const failedSummary = failedSummaryWorks();
    db.prepare("UPDATE works SET light_status = 'pending' WHERE light_status = 'failed' AND archived = 0").run();
    db.prepare(
      "UPDATE works SET deep_status = 'pending' WHERE deep_status = 'failed' AND archived = 0 AND (read_tag = 1 OR manual_deep = 1)"
    ).run();
    for (const w of failedSummary) setSummaryPending(w.nodus_id);
    for (const w of failedDeep) {
      purgeDeepData(w.nodus_id);
      this.enqueue(w.nodus_id, w.title, 'deep');
    }
    for (const w of failedLight) this.enqueue(w.nodus_id, w.title, 'light');
    for (const w of failedSummary) this.enqueue(w.nodus_id, w.title, 'summary');
    this.resume();
  }

  /** Re-enqueue any work left in a pending state, so scans resume after restart. */
  resumePending(): void {
    const db = getDb();
    const pendingLight = db
      .prepare("SELECT nodus_id, title FROM works WHERE light_status = 'pending' AND archived = 0")
      .all() as { nodus_id: string; title: string }[];
    const pendingDeep = db
      .prepare(
        "SELECT nodus_id, title FROM works WHERE deep_status = 'pending' AND archived = 0 AND (read_tag = 1 OR manual_deep = 1)"
      )
      .all() as { nodus_id: string; title: string }[];
    const pendingSummary = pendingSummaryWorks();
    for (const w of pendingDeep) {
      purgeDeepData(w.nodus_id);
      this.enqueue(w.nodus_id, w.title, 'deep');
    }
    for (const w of pendingLight) this.enqueue(w.nodus_id, w.title, 'light');
    for (const w of pendingSummary) this.enqueue(w.nodus_id, w.title, 'summary');
  }
}

function getWorkById(nodusId: string): Work | null {
  const row = getDb().prepare('SELECT * FROM works WHERE nodus_id = ?').get(nodusId) as Work | undefined;
  return row ?? null;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export const scanQueue = new ScanQueue();
