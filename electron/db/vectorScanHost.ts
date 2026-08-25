import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

export interface VectorScanWorkerInput {
  table: string;
  sql: string;
  params: unknown[];
  query: number[];
  threshold: number;
  limit: number;
}
interface WorkerReply {
  id: number;
  ok: boolean;
  rows?: unknown[];
  error?: string;
}

interface Pending {
  resolve: (rows: unknown[]) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const REQUEST_TIMEOUT_MS = 180_000;
let worker: Worker | null = null;
let workerUnavailable = false;
let nextRequestId = 1;
const pending = new Map<number, Pending>();

function workerFile(): string {
  return process.env.NODUS_VECTOR_SCAN_WORKER_FILE
    || path.join(__dirname, 'vectorScanWorker.cjs');
}

function rejectPending(error: Error): void {
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(error);
  }
  pending.clear();
}

function abandonWorker(error: Error): void {
  const current = worker;
  worker = null;
  if (current) void current.terminate().catch(() => undefined);
  rejectPending(error);
}

function getWorker(): Worker | null {
  if (workerUnavailable || process.env.NODUS_DISABLE_VECTOR_SCAN_WORKER === '1') return null;
  if (worker) return worker;
  const file = workerFile();
  if (!fs.existsSync(file)) return null;
  try {
    worker = new Worker(file);
    worker.unref();
    worker.on('message', (reply: WorkerReply) => {
      const request = pending.get(reply.id);
      if (!request) return;
      pending.delete(reply.id);
      clearTimeout(request.timer);
      if (reply.ok && reply.rows) request.resolve(reply.rows);
      else request.reject(new Error(reply.error || 'El worker de búsqueda vectorial falló.'));
    });
    worker.on('error', (error) => {
      workerUnavailable = true;
      abandonWorker(error instanceof Error ? error : new Error(String(error)));
    });
    worker.on('exit', (code) => {
      worker = null;
      if (code !== 0) {
        workerUnavailable = true;
        rejectPending(new Error(`El worker de búsqueda vectorial terminó con código ${code}.`));
      }
    });
  } catch {
    worker = null;
    workerUnavailable = true;
  }
  return worker;
}

/**
 * Runs one similarity scan on a persistent read-only SQLite worker. Returning null
 * means the packaged worker is unavailable (source-only tests/dev stubs), so the
 * caller should use its cooperative in-process implementation.
 */
export async function scanSimilarInWorker<T>(
  databasePath: string,
  scan: VectorScanWorkerInput,
): Promise<T[] | null> {
  if (!path.isAbsolute(databasePath) || !fs.existsSync(databasePath)) return null;
  const current = getWorker();
  if (!current) return null;
  const id = nextRequestId++;
  try {
    return await new Promise<T[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        abandonWorker(new Error('La búsqueda vectorial en segundo plano agotó el tiempo de espera.'));
        reject(new Error('La búsqueda vectorial en segundo plano agotó el tiempo de espera.'));
      }, REQUEST_TIMEOUT_MS);
      pending.set(id, {
        timer,
        resolve: (rows) => resolve(rows as T[]),
        reject,
      });
      current.postMessage({ id, databasePath, scan });
    });
  } catch {
    // A missing/crashed worker must not make search unavailable. The caller's
    // paged implementation remains responsive and produces the same ranking.
    return null;
  }
}
