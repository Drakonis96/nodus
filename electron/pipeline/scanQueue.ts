import { v4 as uuid } from 'uuid';
import type { QueueItem, QueueKind, QueueProgress, Work } from '@shared/types';
import { getDb } from '../db/database';
import { getWorkByZoteroKey } from '../db/worksRepo';
import { getSettings } from '../db/settingsRepo';
import { runLightScan } from '../ai/lightScan';
import { runDeepScan } from '../ai/deepScan';
import { resolveWorkText } from '../extraction/textExtractor';
import { getItem } from '../zotero/zoteroClient';
import { AiError } from '../ai/aiClient';

type ProgressListener = (p: QueueProgress) => void;

const MAX_RETRIES = 4;

class ScanQueue {
  private items: QueueItem[] = [];
  private paused = false;
  private running = false;
  private listeners = new Set<ProgressListener>();
  private retries = new Map<string, number>();

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
      total: this.items.length,
      done,
      failed,
      current: current ? { title: current.title, kind: current.kind } : null,
      items: [...this.items],
    };
  }

  enqueue(nodusId: string, title: string, kind: QueueKind): void {
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
    });
    this.sort();
    this.emit();
    void this.run();
  }

  /** Deep jobs run before pending light jobs. */
  private sort(): void {
    const rank = (i: QueueItem) => (i.kind === 'deep' ? 0 : 1);
    this.items.sort((a, b) => rank(a) - rank(b));
  }

  pause(): void {
    this.paused = true;
    this.emit();
  }

  resume(): void {
    this.paused = false;
    this.emit();
    void this.run();
  }

  cancelItem(id: string): void {
    const item = this.items.find((i) => i.id === id);
    if (item && (item.state === 'queued' || item.state === 'paused')) {
      item.state = 'cancelled';
    }
    this.emit();
  }

  clear(): void {
    this.items = this.items.filter((i) => i.state === 'running');
    this.emit();
  }

  private nextQueued(): QueueItem | undefined {
    return this.items.find((i) => i.state === 'queued');
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
        await this.doLight(work);
      } else {
        await this.doDeep(work);
      }
      item.state = 'done';
      item.error = null;
    } catch (e) {
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
      }
    }
    this.emit();
  }

  private async doLight(work: Work): Promise<void> {
    const settings = getSettings();
    let abstract: string | null = null;
    try {
      const item = await getItem(settings.zoteroUserId, work.zotero_key);
      abstract = item?.abstract ?? null;
    } catch {
      abstract = null;
    }
    await runLightScan(work, abstract);
  }

  private async doDeep(work: Work): Promise<void> {
    const settings = getSettings();
    let abstract: string | null = null;
    try {
      const item = await getItem(settings.zoteroUserId, work.zotero_key);
      abstract = item?.abstract ?? null;
    } catch {
      /* offline: rely on stored attachments */
    }
    const doc = await resolveWorkText(
      settings.zoteroUserId,
      work.zotero_key,
      settings.zoteroStoragePath,
      abstract,
      work.doi,
      settings.unpaywallEmail
    );
    await runDeepScan(work, doc);
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
    for (const w of pendingDeep) this.enqueue(w.nodus_id, w.title, 'deep');
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
