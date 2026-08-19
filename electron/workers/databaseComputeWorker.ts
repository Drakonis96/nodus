import { parentPort, workerData } from 'node:worker_threads';
import { getDb } from '../db/database';
// The query suffix gives this worker an isolated Rollup graph. vite.config replaces
// that graph's database/cross-vault imports with worker-safe implementations.
// @ts-expect-error Vite resolves the query variant to the typed source module.
import { recomputeDatabaseDerived } from '../db/databasesRepo?compute-worker';

interface WorkerInput {
  nodusDatabasePath: string;
  databaseId: string;
  jobId: string;
  cancelBuffer: SharedArrayBuffer;
}

const input = workerData as WorkerInput;
const cancel = new Int32Array(input.cancelBuffer);
const db = getDb();
const update = db.prepare('UPDATE db_compute_jobs SET status = ?, done = ?, total = ?, message = ?, updated_at = ? WHERE id = ?');
const qaDelay = process.env.NODUS_QA_ROOT && process.env.NODUS_QA_DATABASE_COMPUTE_DELAY_MS
  ? Math.max(0, Math.min(2_000, Number(process.env.NODUS_QA_DATABASE_COMPUTE_DELAY_MS) || 0))
  : 0;
const delaySignal = new Int32Array(new SharedArrayBuffer(4));
try {
  update.run('running', 0, 0, null, new Date().toISOString(), input.jobId);
  const result = recomputeDatabaseDerived(input.databaseId, (done: number, total: number) => {
    update.run('running', done, total, null, new Date().toISOString(), input.jobId);
    parentPort?.postMessage({ type: 'progress', jobId: input.jobId, databaseId: input.databaseId, status: 'running', done, total });
    if (qaDelay) Atomics.wait(delaySignal, 0, 0, qaDelay);
  }, () => Atomics.load(cancel, 0) === 1);
  const status = result.cancelled ? 'cancelled' : 'completed';
  update.run(status, result.done, result.total, null, new Date().toISOString(), input.jobId);
  parentPort?.postMessage({ type: 'complete', jobId: input.jobId, databaseId: input.databaseId, status, done: result.done, total: result.total });
} catch (error) {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  update.run('failed', 0, 0, message, new Date().toISOString(), input.jobId);
  parentPort?.postMessage({ type: 'complete', jobId: input.jobId, databaseId: input.databaseId, status: 'failed', done: 0, total: 0, message });
} finally {
  db.close();
}
