/**
 * Host for the vector-math compute worker. Spawns the worker lazily, matches
 * responses to requests by id, and — crucially — degrades gracefully: if the
 * worker file is missing (dev stubs, tests) or the thread dies, every request
 * falls back to the chunked in-process implementation, which yields to the
 * event loop so the app stays responsive. Results are identical either way.
 */
import path from 'node:path';
import fs from 'node:fs';
import { Worker } from 'node:worker_threads';
import { yieldToEventLoop } from '../util/async';
import {
  topMatchesPerCentroidChunked,
  topApproximateNeighborsChunked,
  type CentroidMatch,
  type LabeledVector,
  type NeighborMatch,
} from './similarityCore';

interface Pending {
  resolve: (matches: Array<CentroidMatch | NeighborMatch>) => void;
  reject: (err: Error) => void;
}

let worker: Worker | null = null;
let workerBroken = false;
let nextRequestId = 1;
const pending = new Map<number, Pending>();

const REQUEST_TIMEOUT_MS = 120_000;

function workerFile(): string {
  // Bundled next to main.js by the vite worker entry; __dirname comes from the
  // ESM banner in vite.config.ts.
  return path.join(__dirname, 'computeWorker.js');
}

function workerDisabled(): boolean {
  return process.env.NODUS_DISABLE_COMPUTE_WORKER === '1';
}

function failAllPending(err: Error): void {
  for (const p of pending.values()) p.reject(err);
  pending.clear();
}

function getWorker(): Worker | null {
  if (workerDisabled() || workerBroken) return null;
  if (worker) return worker;
  const file = workerFile();
  if (!fs.existsSync(file)) {
    workerBroken = true;
    return null;
  }
  try {
    worker = new Worker(file);
    worker.unref(); // never keep the app alive just for the compute thread
    worker.on('message', (res: { id: number; ok: boolean; matches?: Array<CentroidMatch | NeighborMatch>; error?: string }) => {
      const p = pending.get(res.id);
      if (!p) return;
      pending.delete(res.id);
      if (res.ok && res.matches) p.resolve(res.matches);
      else p.reject(new Error(res.error ?? 'compute worker error'));
    });
    worker.on('error', (err) => {
      workerBroken = true;
      worker = null;
      failAllPending(err instanceof Error ? err : new Error(String(err)));
    });
    worker.on('exit', (code) => {
      worker = null;
      if (code !== 0) {
        workerBroken = true;
        failAllPending(new Error(`compute worker exited with code ${code}`));
      }
    });
  } catch {
    workerBroken = true;
    worker = null;
  }
  return worker;
}

function runInline(
  centroids: LabeledVector[],
  candidates: LabeledVector[],
  threshold: number,
  maxPerCentroid: number
): Promise<CentroidMatch[]> {
  return topMatchesPerCentroidChunked(centroids, candidates, threshold, maxPerCentroid, yieldToEventLoop);
}

/**
 * Score candidates against centroids off the main thread when possible.
 * Vectors are copied into transferable buffers, so callers keep ownership of
 * the arrays they pass in.
 */
export async function computeThemeMatches(
  centroids: LabeledVector[],
  candidates: LabeledVector[],
  threshold: number,
  maxPerCentroid: number
): Promise<CentroidMatch[]> {
  const w = getWorker();
  if (!w) return runInline(centroids, candidates, threshold, maxPerCentroid);

  const id = nextRequestId++;
  const wire = (list: LabeledVector[]) =>
    list.map((v) => {
      const copy = new Float32Array(v.vector); // detach-safe copy
      return { id: v.id, buffer: copy.buffer };
    });
  const centroidWire = wire(centroids);
  const candidateWire = wire(candidates);
  const transfers = [...centroidWire, ...candidateWire].map((v) => v.buffer);

  try {
    return await new Promise<CentroidMatch[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('compute worker timed out'));
      }, REQUEST_TIMEOUT_MS);
      pending.set(id, {
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as CentroidMatch[]);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      w.postMessage(
        { id, kind: 'themeMatches', centroids: centroidWire, candidates: candidateWire, threshold, maxPerCentroid },
        transfers
      );
    });
  } catch {
    // Worker failed mid-flight: recompute inline so the caller never sees it.
    return runInline(centroids, candidates, threshold, maxPerCentroid);
  }
}

/** Find a bounded approximate top-k off the main thread, with exact cosine scores for returned pairs. */
export async function computeNearestNeighbors(
  queries: LabeledVector[],
  candidates: LabeledVector[],
  threshold: number,
  maxPerQuery: number
): Promise<NeighborMatch[]> {
  const w = getWorker();
  if (!w) {
    return topApproximateNeighborsChunked(
      queries,
      candidates,
      threshold,
      maxPerQuery,
      yieldToEventLoop
    );
  }
  const id = nextRequestId++;
  const wire = (list: LabeledVector[]) =>
    list.map((value) => {
      const copy = new Float32Array(value.vector);
      return { id: value.id, buffer: copy.buffer };
    });
  const queryWire = wire(queries);
  const candidateWire = wire(candidates);
  try {
    return await new Promise<NeighborMatch[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('nearest-neighbor worker timed out'));
      }, REQUEST_TIMEOUT_MS);
      pending.set(id, {
        resolve: (matches) => {
          clearTimeout(timer);
          resolve(matches as NeighborMatch[]);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      w.postMessage(
        {
          id,
          kind: 'nearestNeighbors',
          centroids: queryWire,
          candidates: candidateWire,
          threshold,
          maxPerCentroid: maxPerQuery,
        },
        [...queryWire, ...candidateWire].map((value) => value.buffer)
      );
    });
  } catch {
    return topApproximateNeighborsChunked(
      queries,
      candidates,
      threshold,
      maxPerQuery,
      yieldToEventLoop
    );
  }
}

/** Test/diagnostic hook: report which path computeThemeMatches will take. */
export function computeWorkerAvailable(): boolean {
  return getWorker() !== null;
}
