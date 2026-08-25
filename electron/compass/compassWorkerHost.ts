import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { CompassWorkerOperation } from '../workers/compassWorker';

let tail: Promise<unknown> = Promise.resolve();
const active = new Set<Worker>();
function workerFile(): string { return process.env.NODUS_COMPASS_WORKER_FILE || path.join(__dirname, 'compassWorker.js'); }
export function compassWorkerAvailable(): boolean { return process.env.NODUS_DISABLE_COMPASS_WORKER !== '1' && fs.existsSync(workerFile()); }
export function runCompassWorker<T>(operation: CompassWorkerOperation, args: unknown[], storeFile?: string, fallback?: () => T): Promise<T> {
  const execute = async (): Promise<T> => { if (!compassWorkerAvailable()) { if (fallback) return fallback(); throw new Error('Compass worker is unavailable.'); } const worker = new Worker(workerFile()); active.add(worker); return new Promise<T>((resolve, reject) => { let settled = false; const finish = (error?: Error, value?: T) => { if (settled) return; settled = true; active.delete(worker); void worker.terminate().catch(() => undefined); if (error) reject(error); else resolve(value!); }; worker.once('message', (m: { ok: boolean; result?: T; error?: string }) => m.ok ? finish(undefined, m.result) : finish(new Error(m.error || 'Compass worker failed.'))); worker.once('error', finish); worker.once('exit', (code) => { if (!settled) finish(new Error(`Compass worker exited with code ${code}.`)); }); worker.postMessage({ operation, args, storeFile }); }); };
  const task = tail.then(execute, execute); tail = task.then(() => undefined, () => undefined); return task;
}
export function disposeCompassWorkers(): void { for (const worker of active) void worker.terminate().catch(() => undefined); active.clear(); }
