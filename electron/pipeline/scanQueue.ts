import { v4 as uuid } from 'uuid';
import type { QueueItem, QueueKind, QueueProgress, Work, ModelRef } from '@shared/types';
import { getDb } from '../db/database';
import { getSettings } from '../db/settingsRepo';
import { runLightScan } from '../ai/lightScan';
import { runDeepScan } from '../ai/deepScan';
import { listThemeLabels } from '../db/themesRepo';
import { resolveWorkText } from '../extraction/textExtractor';
import { getItem } from '../zotero/zoteroClient';
import { setDeepResult } from '../db/worksRepo';
import { purgeDeepData } from '../db/ideasRepo';
import { AiError } from '../ai/aiClient';
import { startPerf } from '../perf';

type ProgressListener = (p: QueueProgress) => void;

const MAX_RETRIES = 4;

class ScanQueue {
  private items: QueueItem[] = [];
  private paused = false;
  /** Set when the queue auto-paused on a misconfiguration; cleared on resume. */
  private pausedReason: string | null = null;
  private running = false;
  private listeners = new Set<ProgressListener>();
  private retries = new Map<string, number>();
  /** Last kind dequeued, used to interleave light/deep so neither starves. */
  private lastKind: QueueKind | null = null;

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

  enqueue(nodusId: string, title: string, kind: QueueKind, model?: ModelRef | null): void {
    // Avoid duplicate pending/running jobs for the same work+kind.
    if (this.items.some((i) => i.nodus_id === nodusId && i.kind === kind && (i.state === 'queued' || i.state === 'running'))) {
      return;
    }
    this.items.push({
      id: uuid(),
      nodus_id: nodusId,
      title,
      kind,
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
    this.lastKind = item.kind === 'deep' ? 'light' : 'deep';
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
    this.paused = false;
    this.pausedReason = null;
    this.emit();
  }

  private resetPendingStatus(item: QueueItem): void {
    const column = item.kind === 'deep' ? 'deep_status' : 'light_status';
    getDb().prepare(`UPDATE works SET ${column} = 'none' WHERE nodus_id = ? AND ${column} = 'pending'`).run(item.nodus_id);
  }

  /**
   * Pick the next job, alternating light/deep so neither layer starves the other.
   * Deep jobs build the idea graph (nodes); light jobs populate themes. Interleaving
   * means the user sees both appear early instead of waiting for one whole layer.
   */
  private nextQueued(): QueueItem | undefined {
    const queued = this.items.filter((i) => i.state === 'queued');
    if (queued.length === 0) return undefined;
    const want: QueueKind = this.lastKind === 'deep' ? 'light' : 'deep';
    const pick = queued.find((i) => i.kind === want) ?? queued[0];
    this.lastKind = pick.kind;
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
    if (!this.paused && this.nextQueued()) void this.run();
  }

  private async process(item: QueueItem): Promise<void> {
    item.state = 'running';
    this.emit();
    const work = getWorkById(item.nodus_id);
    if (!work) {
      item.state = 'failed';
      item.error = 'Obra no encontrada';
      this.emit();
      return;
    }
    try {
      if (item.kind === 'light') {
        await this.doLight(work, item.model ?? null);
      } else {
        await this.doDeep(work, item);
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

  private async doDeep(work: Work, queueItem: QueueItem): Promise<void> {
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
    const doc = await resolveWorkText(settings.zoteroUserId, work.zotero_key, settings.zoteroStoragePath, abstract, work.doi, {
      unpaywallEmail: settings.unpaywallEmail,
      preferZoteroFulltext: settings.preferZoteroFulltext,
      ocr: { enabled: settings.ocrEnabled, languages: settings.ocrLanguages, maxPages: settings.ocrMaxPages },
      perf,
      onProgress: (p) => {
        queueItem.detail = p.detail;
        queueItem.subPct = p.pct;
        this.emit();
      },
    });
    queueItem.detail = 'Analizando con IA…';
    queueItem.subPct = null;
    this.emit();
    await runDeepScan(work, doc, queueItem.model ?? null, (p) => {
      queueItem.detail = p.detail;
      queueItem.subPct = p.pct;
      this.emit();
    });
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
    db.prepare("UPDATE works SET light_status = 'pending' WHERE light_status = 'failed' AND archived = 0").run();
    db.prepare(
      "UPDATE works SET deep_status = 'pending' WHERE deep_status = 'failed' AND archived = 0 AND (read_tag = 1 OR manual_deep = 1)"
    ).run();
    for (const w of failedDeep) {
      purgeDeepData(w.nodus_id);
      this.enqueue(w.nodus_id, w.title, 'deep');
    }
    for (const w of failedLight) this.enqueue(w.nodus_id, w.title, 'light');
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
    for (const w of pendingDeep) {
      purgeDeepData(w.nodus_id);
      this.enqueue(w.nodus_id, w.title, 'deep');
    }
    for (const w of pendingLight) this.enqueue(w.nodus_id, w.title, 'light');
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
