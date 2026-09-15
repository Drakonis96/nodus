/**
 * The on-disk half of the processing log: one JSON file under userData that holds the
 * lines the pipeline recorded.
 *
 * It is NOT vault content. A corpus run crosses vaults and the Library while this file is
 * single and global, and it is local diagnostics: excluded from backups and sync, exactly
 * like the Browser history. The file also carries a 0600 mode, because a provider error can
 * quote a request body.
 *
 * Two deliberate separations keep this testable:
 *   - the age/count limits are *passed in* on every call instead of read from Settings, so
 *     this module never touches the database and `scripts/test-pipeline-logs-store.mjs` can
 *     drive it against a temp file;
 *   - writes are coalesced (a corpus run records hundreds of lines a second, and one
 *     fsync'd rename per line would be its own performance bug) with `flushSync()` for
 *     app shutdown, where promises cannot be awaited.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  PipelineLogEntry,
  PipelineLogFilter,
  PipelineLogLimits,
  PipelineLogQuery,
  PipelineLogResult,
  PipelineLogStore,
} from '@shared/pipelineLogs';
import {
  appendPipelineLogEntries,
  deletePipelineLogs,
  emptyPipelineLogStore,
  normalizePipelineLogStore,
  prunePipelineLogs,
  queryPipelineLogs,
} from '@shared/pipelineLogs';

export const PIPELINE_LOG_FILE = 'nodus-logs.json';

/**
 * A change the renderer has to hear about. It carries no entries on purpose: grouping,
 * pruning and deletion all mutate rows the reader may already be showing, so the open
 * modal re-queries (debounced) instead of trying to reconcile a delta it did not compute.
 */
export interface PipelineLogChange {
  revision: number;
  total: number;
}

export interface PipelineLogStats {
  entries: number;
  oldestAt: string | null;
  newestAt: string | null;
  bytes: number;
}

export class PipelineLogRepository {
  private loaded = false;
  private store: PipelineLogStore = emptyPipelineLogStore();
  private writeTimer: NodeJS.Timeout | null = null;
  private writePending = false;
  private notifier: ((change: PipelineLogChange) => void) | null = null;

  constructor(
    private readonly file: string,
    private readonly writeDelayMs = 250,
  ) {}

  setNotifier(notifier: ((change: PipelineLogChange) => void) | null): void {
    this.notifier = notifier;
  }

  private readOnce(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      this.store = normalizePipelineLogStore(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch {
      // A missing file is the first run; a corrupt one must not cost the user the app.
      this.store = emptyPipelineLogStore();
    }
  }

  private notify(): void {
    if (!this.notifier) return;
    try {
      this.notifier({ revision: this.store.revision, total: this.store.entries.length });
    } catch {
      // A renderer that went away must not break the pipeline that was logging.
    }
  }

  private scheduleWrite(): void {
    if (this.writeTimer) return;
    this.writePending = true;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.writeNow();
    }, this.writeDelayMs);
    this.writeTimer.unref?.();
  }

  private writeNow(): void {
    if (!this.writePending) return;
    this.writePending = false;
    const payload = `${JSON.stringify(this.store)}\n`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.tmp-${process.pid}-${randomUUID()}`;
      try {
        fs.writeFileSync(temporary, payload, { encoding: 'utf8', mode: 0o600 });
        fs.renameSync(temporary, this.file);
      } finally {
        try {
          fs.rmSync(temporary, { force: true });
        } catch {
          // The rename already succeeded or the temp file never existed.
        }
      }
    } catch {
      // Disk full or read-only volume: the in-memory log still serves the open modal.
    }
  }

  /** App shutdown cannot await a timer. */
  flushSync(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    this.writeNow();
  }

  /** Append one line. Returns the stored entry, or null when the line was dropped. */
  record(entry: PipelineLogEntry, limits: PipelineLogLimits): PipelineLogEntry | null {
    this.readOnce();
    const next = appendPipelineLogEntries(this.store, [entry], limits);
    const stored = next.entries.find((item) => item.id === entry.id) ?? null;
    if (next.revision !== this.store.revision) {
      this.store = next;
      this.scheduleWrite();
    }
    // A grouped repeat mutates the existing row instead of adding one, and the reader still
    // has to hear about it or the ×N counter would sit stale until the next line arrives.
    this.notify();
    return stored;
  }

  /** Prune and persist. Returns how many lines were dropped. */
  prune(limits: PipelineLogLimits, now = Date.now()): number {
    this.readOnce();
    const next = prunePipelineLogs(this.store, limits, now);
    if (next.revision === this.store.revision) return 0;
    const dropped = this.store.entries.length - next.entries.length;
    this.store = next;
    this.scheduleWrite();
    this.notify();
    return dropped;
  }

  query(query: PipelineLogQuery, limits: PipelineLogLimits, now = Date.now()): PipelineLogResult {
    this.readOnce();
    // Reading is also the moment to enforce the horizon: a log left untouched for weeks
    // must not report entries the retention policy has already expired.
    const pruned = prunePipelineLogs(this.store, limits, now);
    if (pruned.revision !== this.store.revision) {
      this.store = pruned;
      this.scheduleWrite();
    }
    return queryPipelineLogs(this.store, query);
  }

  delete(filter: PipelineLogFilter, limits: PipelineLogLimits, now = Date.now()): number {
    this.readOnce();
    const next = deletePipelineLogs(prunePipelineLogs(this.store, limits, now), filter);
    const removed = this.store.entries.length - next.entries.length;
    if (next.revision !== this.store.revision) {
      this.store = next;
      this.scheduleWrite();
      this.notify();
    }
    return removed;
  }

  clear(): void {
    this.readOnce();
    if (this.store.entries.length === 0) return;
    this.store = { version: 1, revision: this.store.revision + 1, entries: [] };
    this.scheduleWrite();
    this.notify();
  }

  stats(): PipelineLogStats {
    this.readOnce();
    const entries = this.store.entries;
    let bytes = 0;
    try {
      bytes = fs.statSync(this.file).size;
    } catch {
      bytes = 0;
    }
    return {
      entries: entries.length,
      oldestAt: entries.length ? entries[entries.length - 1].at : null,
      newestAt: entries.length ? entries[0].at : null,
      bytes,
    };
  }
}
