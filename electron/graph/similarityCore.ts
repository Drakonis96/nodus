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

export interface NeighborMatch {
  queryId: string;
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

function coarseCosine(a: Float32Array, b: Float32Array, maxDimensions: number): number {
  const n = Math.min(a.length, b.length);
  const stride = Math.max(1, Math.floor(n / Math.max(1, maxDimensions)));
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i += stride) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Two-stage nearest-neighbour search: a cheap 64-dimension projection selects a
 * bounded shortlist, then exact cosine ranks that shortlist. This avoids the
 * previous full-dimensional O(N²) scans while preserving exact scores for every
 * returned pair.
 */
export function topApproximateNeighbors(
  queries: LabeledVector[],
  candidates: LabeledVector[],
  threshold: number,
  maxPerQuery: number,
  shortlistSize = 64,
  coarseDimensions = 64
): NeighborMatch[] {
  const out: NeighborMatch[] = [];
  const shortlistLimit = Math.max(maxPerQuery, shortlistSize);
  for (const query of queries) {
    const shortlist = candidates
      .filter((candidate) => candidate.id !== query.id)
      .map((candidate) => ({ candidate, coarse: coarseCosine(query.vector, candidate.vector, coarseDimensions) }))
      .sort((a, b) => b.coarse - a.coarse)
      .slice(0, shortlistLimit);
    const exact = shortlist
      .map(({ candidate }) => ({ queryId: query.id, candidateId: candidate.id, similarity: cosineF32(query.vector, candidate.vector) }))
      .filter((match) => match.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, maxPerQuery);
    out.push(...exact);
  }
  return out;
}

export async function topApproximateNeighborsChunked(
  queries: LabeledVector[],
  candidates: LabeledVector[],
  threshold: number,
  maxPerQuery: number,
  yieldFn: () => Promise<void>,
  shortlistSize = 64,
  coarseDimensions = 64,
  chunkSize = 256
): Promise<NeighborMatch[]> {
  const out: NeighborMatch[] = [];
  const shortlistLimit = Math.max(maxPerQuery, shortlistSize);
  let sinceYield = 0;
  for (const query of queries) {
    const coarse: Array<{ candidate: LabeledVector; coarse: number }> = [];
    for (const candidate of candidates) {
      if (candidate.id !== query.id) {
        coarse.push({ candidate, coarse: coarseCosine(query.vector, candidate.vector, coarseDimensions) });
      }
      if (++sinceYield >= chunkSize) {
        sinceYield = 0;
        await yieldFn();
      }
    }
    const exact = coarse
      .sort((a, b) => b.coarse - a.coarse)
      .slice(0, shortlistLimit)
      .map(({ candidate }) => ({ queryId: query.id, candidateId: candidate.id, similarity: cosineF32(query.vector, candidate.vector) }))
      .filter((match) => match.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, maxPerQuery);
    out.push(...exact);
  }
  return out;
}
