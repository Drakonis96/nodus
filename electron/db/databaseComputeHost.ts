import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { v4 as uuid } from 'uuid';
import { getDb } from './database';
import { recomputeDatabaseDerived } from './databasesRepo';
import type { DatabaseCalculationProgress } from '@shared/databases';

const active = new Map<string, { worker: Worker | null; cancel: Int32Array }>();

function workerFile(): string {
  return process.env.NODUS_DATABASE_COMPUTE_WORKER_FILE || path.join(__dirname, 'databaseComputeWorker.cjs');
}

export function getDatabaseCalculationStatus(databaseId: string): DatabaseCalculationProgress | null {
  const row = getDb().prepare(
    `SELECT id AS jobId, database_id AS databaseId, status, done, total, message
     FROM db_compute_jobs WHERE database_id = ? ORDER BY updated_at DESC LIMIT 1`,
  ).get(databaseId) as DatabaseCalculationProgress | undefined;
  return row ?? null;
}

export function cancelDatabaseCalculation(jobId: string): boolean {
  const running = active.get(jobId);
  if (!running) return false;
  Atomics.store(running.cancel, 0, 1);
  // The worker owns terminal state. Marking it cancelled here creates a race where
  // its initial/running update can arrive afterwards; it publishes `cancelled` only
  // once the savepoint has actually been rolled back.
  return true;
}

export function startDatabaseCalculation(
  databasePath: string,
  databaseId: string,
  onProgress?: (progress: DatabaseCalculationProgress) => void,
): { jobId: string } {
  const db = getDb();
  const jobId = `dcalc_${uuid()}`;
  const timestamp = new Date().toISOString();
  db.prepare(
    `INSERT INTO db_compute_jobs (id, database_id, status, done, total, created_at, updated_at)
     VALUES (?, ?, 'queued', 0, 0, ?, ?)`,
  ).run(jobId, databaseId, timestamp, timestamp);
  const buffer = new SharedArrayBuffer(4);
  const cancel = new Int32Array(buffer);
  const file = workerFile();
  if (fs.existsSync(file)) {
    const worker = new Worker(file, { workerData: { nodusDatabasePath: databasePath, databaseId, jobId, cancelBuffer: buffer } });
    active.set(jobId, { worker, cancel });
    worker.unref();
    worker.on('message', (message: DatabaseCalculationProgress & { type: string }) => {
      onProgress?.(message);
      if (message.type === 'complete') active.delete(jobId);
    });
    const fail = (error: Error) => {
      active.delete(jobId);
      const message = error.message;
      db.prepare("UPDATE db_compute_jobs SET status = 'failed', message = ?, updated_at = ? WHERE id = ?")
        .run(message, new Date().toISOString(), jobId);
      onProgress?.({ jobId, databaseId, status: 'failed', done: 0, total: 0, message });
    };
    worker.once('error', fail);
    worker.once('exit', (code) => {
      if (code !== 0 && active.has(jobId)) fail(new Error(`database compute worker exited with code ${code}`));
    });
  } else {
    active.set(jobId, { worker: null, cancel });
    setImmediate(() => {
      try {
        db.prepare("UPDATE db_compute_jobs SET status = 'running', updated_at = ? WHERE id = ?").run(new Date().toISOString(), jobId);
        const result = recomputeDatabaseDerived(databaseId, (done, total) => {
          const progress: DatabaseCalculationProgress = { jobId, databaseId, status: 'running', done, total, message: null };
          onProgress?.(progress);
        }, () => Atomics.load(cancel, 0) === 1);
        const status = result.cancelled ? 'cancelled' : 'completed';
        db.prepare('UPDATE db_compute_jobs SET status = ?, done = ?, total = ?, updated_at = ? WHERE id = ?')
          .run(status, result.done, result.total, new Date().toISOString(), jobId);
        onProgress?.({ jobId, databaseId, status, done: result.done, total: result.total, message: null });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        db.prepare("UPDATE db_compute_jobs SET status = 'failed', message = ?, updated_at = ? WHERE id = ?")
          .run(message, new Date().toISOString(), jobId);
        onProgress?.({ jobId, databaseId, status: 'failed', done: 0, total: 0, message });
      } finally {
        active.delete(jobId);
      }
    });
  }
  return { jobId };
}
