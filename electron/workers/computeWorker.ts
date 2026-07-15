/**
 * Dedicated worker_thread for CPU-heavy vector math. The main process sends
 * embeddings (Float32Array buffers travel as transferables), the worker runs
 * the O(N×M) similarity loops from similarityCore and posts the matches back.
 * It never touches the database: keeping SQLite single-connection avoids any
 * journal-mode / locking changes while still unblocking the main thread.
 */
import { parentPort } from 'node:worker_threads';
import { topApproximateNeighbors, topMatchesPerCentroid, type LabeledVector } from '../graph/similarityCore';

export interface WireVector {
  id: string;
  buffer: ArrayBuffer;
}

export interface ComputeRequest {
  id: number;
  kind: 'themeMatches' | 'nearestNeighbors';
  centroids: WireVector[];
  candidates: WireVector[];
  threshold: number;
  maxPerCentroid: number;
}

export interface ComputeResponse {
  id: number;
  ok: boolean;
  matches?: Array<{
    centroidId?: string;
    queryId?: string;
    candidateId: string;
    similarity: number;
  }>;
  error?: string;
}

function revive(vectors: WireVector[]): LabeledVector[] {
  return vectors.map((v) => ({ id: v.id, vector: new Float32Array(v.buffer) }));
}

if (parentPort) {
  parentPort.on('message', (req: ComputeRequest) => {
    const reply = (res: ComputeResponse) => parentPort!.postMessage(res);
    try {
      const matches = req.kind === 'themeMatches'
        ? topMatchesPerCentroid(revive(req.centroids), revive(req.candidates), req.threshold, req.maxPerCentroid)
        : topApproximateNeighbors(revive(req.centroids), revive(req.candidates), req.threshold, req.maxPerCentroid);
      reply({ id: req.id, ok: true, matches });
    } catch (e) {
      reply({ id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
}
