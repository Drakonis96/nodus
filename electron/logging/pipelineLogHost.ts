/**
 * The Electron side of the processing log: where the file lives, where the retention policy
 * comes from, and how the renderer hears about a change.
 *
 * This is the only file in the feature that knows about Electron, the settings store and the
 * windows — which is what keeps `pipelineLogCore.ts` importable from a unit test and
 * `pipelineLogStore.ts` drivable against a temp file.
 */

import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import type { PipelineLogChange } from './pipelineLogStore';
import type { PipelineLogLimits } from '@shared/pipelineLogs';
import { normalizePipelineLogMaxEntries, normalizePipelineLogRetention } from '@shared/pipelineLogs';
import { PIPELINE_LOG_FILE, PipelineLogRepository } from './pipelineLogStore';
import { setPipelineLogSink } from './pipelineLogCore';
import { getSettings } from '../db/settingsRepo';

/** Six hours: the log is pruned on read and on write too, this is the idle backstop. */
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1_000;
/**
 * `getSettings()` reads the settings blob out of the vault database, and a corpus run
 * records hundreds of lines a second — so the policy is cached and refreshed on change
 * rather than consulted per line.
 */
const LIMITS_TTL_MS = 10_000;

export function pipelineLogPath(): string {
  return path.join(app.getPath('userData'), PIPELINE_LOG_FILE);
}

let repository: PipelineLogRepository | null = null;
let pruneTimer: NodeJS.Timeout | null = null;
let cachedLimits: PipelineLogLimits | null = null;
let cachedAt = 0;

export function pipelineLogRepository(): PipelineLogRepository {
  if (!repository) repository = new PipelineLogRepository(pipelineLogPath());
  return repository;
}

/** The retention policy in force, read from the app-wide preferences. */
export function pipelineLogLimits(refresh = false): PipelineLogLimits {
  const now = Date.now();
  if (!refresh && cachedLimits && now - cachedAt < LIMITS_TTL_MS) return cachedLimits;
  const settings = getSettings();
  cachedLimits = {
    retention: normalizePipelineLogRetention(settings.pipelineLogRetention),
    maxEntries: normalizePipelineLogMaxEntries(settings.pipelineLogMaxEntries),
  };
  cachedAt = now;
  return cachedLimits;
}

/**
 * Tell the renderer the store changed, at most a few times a second.
 *
 * A corpus run records hundreds of lines a second and the open modal re-queries on this
 * signal, so sending one message per line would spend the whole IPC budget on a view that
 * cannot repaint that fast anyway. A leading send keeps the first line instant; a trailing
 * one guarantees the last line is never missed.
 */
const BROADCAST_INTERVAL_MS = 250;
let lastBroadcastAt = 0;
let broadcastTimer: NodeJS.Timeout | null = null;
let broadcastPending: PipelineLogChange | null = null;

function broadcastNow(): void {
  if (!broadcastPending) return;
  const change = broadcastPending;
  broadcastPending = null;
  lastBroadcastAt = Date.now();
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('logs:changed', change);
  }
}

function broadcast(change: PipelineLogChange): void {
  const since = Date.now() - lastBroadcastAt;
  if (since >= BROADCAST_INTERVAL_MS) {
    broadcastPending = change;
    if (broadcastTimer) { clearTimeout(broadcastTimer); broadcastTimer = null; }
    broadcastNow();
    return;
  }
  broadcastPending = change;
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    broadcastNow();
  }, BROADCAST_INTERVAL_MS - since);
  broadcastTimer.unref?.();
}

/**
 * Wire the log up and prune what the last session left behind. Called once from `main.ts`
 * while the app starts, before any pipeline can run.
 */
export function initPipelineLogs(): void {
  const target = pipelineLogRepository();
  target.setNotifier(broadcast);
  target.prune(pipelineLogLimits());
  if (pruneTimer) clearInterval(pruneTimer);
  pruneTimer = setInterval(() => {
    target.prune(pipelineLogLimits());
  }, PRUNE_INTERVAL_MS);
  pruneTimer.unref();
  setPipelineLogSink({ record: (entry) => { target.record(entry, pipelineLogLimits()); } });
}

/**
 * Retention or the entry cap changed: apply it immediately instead of waiting for the timer,
 * so the number the reader just chose is the number they see.
 */
export function applyPipelineLogLimits(): number {
  const limits = pipelineLogLimits(true);
  return pipelineLogRepository().prune(limits);
}

/** App shutdown cannot await the coalescing timer. */
export function flushPipelineLogs(): void {
  repository?.flushSync();
  if (pruneTimer) {
    clearInterval(pruneTimer);
    pruneTimer = null;
  }
  if (broadcastTimer) {
    clearTimeout(broadcastTimer);
    broadcastTimer = null;
  }
}
