// Keeping semantic search off the event loop.
//
// The server is one Node process with one event loop, and a semantic query is a brute-force
// pass over the whole corpus matrix: 52 ms for 33,016 passages at 1024 dimensions on an idle
// laptop, and several times that on a machine with anything else to do — the same call
// measured 195 ms on a host under load, which is exactly when a class is using the server.
// Run on the main thread that is 52 ms in which nothing else is answered: a health check, a
// phone opening a screen, somebody else's search, all of it waits.
//
// scripts/bench-server-search.mjs measures what that costs. Eight concurrent searches against
// that corpus, while polling /healthz: 14 health checks answered inline, 873 on threads.
//
// So the arithmetic moves to worker threads and the main loop stays free. The matrix is
// shared rather than copied (see `withSharedMatrix`), so posting a job costs the same whether
// the corpus has a thousand passages or a hundred thousand.
//
// The queue is deliberately unbounded. Before this existed, concurrent searches did not queue
// — they blocked the entire server one after another — so anything that waits here is
// already an improvement, and a queued job is a SharedArrayBuffer handle plus a query vector,
// a few kilobytes. Adding a rejection path would invent a failure the server never had.

import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { scoreVectors, withSharedMatrix } from './vectors.mjs';

const WORKER_URL = new URL('./vectorSearchWorker.mjs', import.meta.url);

/**
 * How many threads do the multiplying.
 *
 * One is enough to fix what this module is for: the main loop stops blocking either way, and
 * further workers only help when several people search at the same second. Two is the default
 * on anything with cores to spare because the matrix is shared, so the second worker costs a
 * thread and no memory. `0` runs the search inline, which is the escape hatch for a runtime
 * where threads are unavailable or unwanted.
 *
 * Validated at import, not at first search, so a typo stops the boot with a readable message
 * instead of failing one request an hour later.
 */
function configuredWorkers() {
  const configured = String(process.env.NODUS_VECTOR_WORKERS ?? '').trim();
  if (!configured) return Math.max(1, Math.min(2, availableParallelism() - 1));
  const value = Number(configured);
  if (!Number.isSafeInteger(value) || value < 0 || value > 64) {
    throw new Error('NODUS_VECTOR_WORKERS must be a whole number of threads between 0 and 64.');
  }
  return value;
}

const POOL_SIZE = configuredWorkers();

/**
 * The shared copy of each matrix, keyed by the decoded set the route already caches.
 *
 * A WeakMap rather than a cache of its own: when the route drops a set because its file
 * changed, the shared matrix goes with it and nothing has to remember to say so.
 */
const sharedMatrices = new WeakMap();

const workers = [];
const queue = [];
let nextJobId = 1;
/** Set when a thread cannot be created at all, after which every search runs inline. */
let threadsUnavailable = false;

function sharedMatrix(set) {
  let matrix = sharedMatrices.get(set);
  if (!matrix) {
    matrix = withSharedMatrix(set).matrix;
    sharedMatrices.set(set, matrix);
  }
  return matrix;
}

function retire(slot, error) {
  const index = workers.indexOf(slot);
  if (index >= 0) workers.splice(index, 1);
  // A worker that died mid-job leaves a promise nobody will ever settle. Reject it so the
  // request answers, and let the next search spawn a replacement.
  if (slot.job) {
    slot.job.reject(error instanceof Error ? error : new Error(String(error)));
    slot.job = null;
  }
  slot.worker.terminate().catch(() => { /* already gone */ });
  // Whatever was queued behind this worker is still waiting, and the pool is now one thread
  // short: without this, a single crash leaves those jobs parked forever.
  pump();
}

function spawn() {
  const worker = new Worker(WORKER_URL);
  const slot = { worker, job: null };
  worker.on('message', (message) => {
    const job = slot.job;
    slot.job = null;
    if (job && job.id === message.id) {
      if (message.error) job.reject(new Error(message.error));
      else job.resolve(message.matches);
    }
    pump();
  });
  worker.on('error', (error) => retire(slot, error));
  worker.on('exit', (code) => {
    if (slot.job) retire(slot, new Error(`The vector search worker exited with code ${code}.`));
  });
  // The HTTP listener is what keeps this process alive; an idle pool must not.
  worker.unref();
  workers.push(slot);
  return slot;
}

function pump() {
  while (queue.length > 0) {
    let slot = workers.find((candidate) => !candidate.job);
    if (!slot && workers.length < POOL_SIZE) {
      try {
        slot = spawn();
      } catch (error) {
        threadsUnavailable = true;
        // Nothing is lost: the queued jobs run inline below, as they did before this module.
        for (const job of queue.splice(0)) {
          try { job.resolve(scoreVectors(job.set, job.query, job.options)); }
          catch (failure) { job.reject(failure); }
        }
        return;
      }
    }
    if (!slot) return;
    const job = queue.shift();
    slot.job = job;
    slot.worker.postMessage({
      id: job.id,
      matrix: sharedMatrix(job.set),
      dim: job.set.dim,
      count: job.set.count,
      query: job.query,
      limit: job.options.limit,
      threshold: job.options.threshold,
    });
  }
}

/**
 * Search a decoded vector set without blocking the event loop.
 *
 * Returns what `searchVectors` returns — `{ id, score }`, best first — so the route reads the
 * same either way. The ids stay on this thread: the worker answers with row numbers, and
 * resolving them here avoids cloning the id table into the worker on every query.
 */
export async function searchVectorsOffThread(set, queryVector, { limit = 20, threshold = 0 } = {}) {
  const options = { limit, threshold };
  const matches = POOL_SIZE === 0 || threadsUnavailable
    ? scoreVectors(set, queryVector, options)
    : await new Promise((resolve, reject) => {
      queue.push({ id: nextJobId++, set, query: Float32Array.from(queryVector), options, resolve, reject });
      pump();
    });
  return matches.map(({ row, score }) => ({ id: set.ids[row], score }));
}

/** Stop every thread. For tests and for anything that wants a clean exit. */
export async function shutdownVectorSearch() {
  const slots = workers.splice(0);
  queue.length = 0;
  await Promise.all(slots.map((slot) => slot.worker.terminate().catch(() => { /* already gone */ })));
}

/** What the pool is doing, for tests and for the deployment report. */
export function vectorSearchPoolState() {
  return { size: POOL_SIZE, threads: workers.length, queued: queue.length, threadsUnavailable };
}
