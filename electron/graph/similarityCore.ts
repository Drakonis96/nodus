/**
 * Pure vector-similarity math shared by the compute worker and the in-process
 * fallback. No imports from electron/db here: everything operates on plain
 * Float32Arrays so it can run in a worker_thread or be unit-tested headlessly.
 */

export interface LabeledVector {
  id: string;
  vector: Float32Array;
}

export interface CentroidMatch {
  centroidId: string;
  candidateId: string;
  similarity: number;
}

export function cosineF32(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Mean of equal-length vectors; null when the list is empty. */
export function centroidF32(vectors: Float32Array[]): Float32Array | null {
  if (vectors.length === 0) return null;
  const dim = vectors[0].length;
  const sum = new Float32Array(dim);
  for (const v of vectors) {
    const n = Math.min(dim, v.length);
    for (let i = 0; i < n; i++) sum[i] += v[i];
  }
  for (let i = 0; i < dim; i++) sum[i] /= vectors.length;
  return sum;
}

/**
 * For each centroid, score every candidate and keep the best `maxPerCentroid`
 * whose cosine clears `threshold`, sorted by similarity descending. This is the
 * O(centroids × candidates) loop that used to run as per-theme vec_cosine()
 * table scans on the main thread.
 */
export function topMatchesPerCentroid(
  centroids: LabeledVector[],
  candidates: LabeledVector[],
  threshold: number,
  maxPerCentroid: number
): CentroidMatch[] {
  const out: CentroidMatch[] = [];
  for (const c of centroids) {
    const scored: CentroidMatch[] = [];
    for (const cand of candidates) {
      const sim = cosineF32(c.vector, cand.vector);
      if (sim >= threshold) scored.push({ centroidId: c.id, candidateId: cand.id, similarity: sim });
    }
    scored.sort((a, b) => b.similarity - a.similarity);
    out.push(...scored.slice(0, maxPerCentroid));
  }
  return out;
}

/**
 * Chunked variant for the in-process fallback: identical results to
 * topMatchesPerCentroid, but calls `yieldFn` between chunks so a long scan on
 * the main thread never starves the event loop.
 */
export async function topMatchesPerCentroidChunked(
  centroids: LabeledVector[],
  candidates: LabeledVector[],
  threshold: number,
  maxPerCentroid: number,
  yieldFn: () => Promise<void>,
  chunkSize = 2048
): Promise<CentroidMatch[]> {
  const out: CentroidMatch[] = [];
  let sinceYield = 0;
  for (const c of centroids) {
    const scored: CentroidMatch[] = [];
    for (const cand of candidates) {
      const sim = cosineF32(c.vector, cand.vector);
      if (sim >= threshold) scored.push({ centroidId: c.id, candidateId: cand.id, similarity: sim });
      if (++sinceYield >= chunkSize) {
        sinceYield = 0;
        await yieldFn();
      }
    }
    scored.sort((a, b) => b.similarity - a.similarity);
    out.push(...scored.slice(0, maxPerCentroid));
  }
  return out;
}
