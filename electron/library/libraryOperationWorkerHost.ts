// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { LibraryWorkerOperation } from '../workers/libraryOperationWorker';

interface LibraryWorkerContext {
  root: string;
  deviceId: string;
  catalogFile: string;
}

let operationTail: Promise<unknown> = Promise.resolve();
const activeWorkers = new Set<Worker>();

function workerFile(): string {
  return process.env.NODUS_LIBRARY_OPERATION_WORKER_FILE
    || path.join(__dirname, 'libraryOperationWorker.js');
}

export function libraryOperationWorkerAvailable(): boolean {
  return process.env.NODUS_DISABLE_LIBRARY_OPERATION_WORKER !== '1' && fs.existsSync(workerFile());
}

export interface LibraryWorkerRunOptions {
  signal?: AbortSignal;
  onProgress?: (value: unknown) => void;
}

function executeWorker<T>(context: LibraryWorkerContext, operation: LibraryWorkerOperation, args: unknown[], options: LibraryWorkerRunOptions = {}): Promise<T> {
  const worker = new Worker(workerFile());
  worker.unref();
  activeWorkers.add(worker);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, result?: T): void => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', abort);
      activeWorkers.delete(worker);
      void worker.terminate().catch(() => undefined);
      if (error) reject(error); else resolve(result!);
    };
    const abort = (): void => {
      // Library mutations are intentionally canceled at chunk boundaries.
      // Terminating between the atomic metadata write and SQLite indexing can
      // leave an orphaned disk record, while a Compass chunk is bounded to 25.
    };
    if (options.signal?.aborted) { finish(new Error(`Library ${operation} worker canceled.`)); return; }
    options.signal?.addEventListener('abort', abort, { once: true });
    worker.on('message', (message: { ok?: boolean; result?: T; error?: string; type?: string; value?: unknown }) => {
      if (message.type === 'progress') { options.onProgress?.(message.value); return; }
      if (message.ok) finish(undefined, message.result);
      else finish(new Error(message.error ?? `Library ${operation} worker failed.`));
    });
    worker.once('error', (error) => finish(error));
    worker.once('exit', (code) => { if (!settled) finish(new Error(`Library ${operation} worker exited with code ${code}.`)); });
    worker.postMessage({ ...context, operation, args });
  });
}

/**
 * Serialize background mutations so independent SQLite connections never race.
 * The work runs on a worker thread; serialization does not block Electron.
 */
export function runLibraryOperationInWorker<T>(
  context: LibraryWorkerContext,
  operation: LibraryWorkerOperation,
  args: unknown[],
  fallback: () => T,
  options: LibraryWorkerRunOptions = {},
): Promise<T> {
  const execute = () => libraryOperationWorkerAvailable()
    ? executeWorker<T>(context, operation, args, options)
    : Promise.resolve().then(fallback);
  const task = operationTail.then(execute, execute);
  operationTail = task.then(() => undefined, () => undefined);
  return task;
}

export function disposeLibraryOperationWorkers(): void {
  for (const worker of activeWorkers) void worker.terminate().catch(() => undefined);
  activeWorkers.clear();
}
