// Run one semantic search and report whether the event loop survived it.
//
// Spawned twice by scripts/test-server-vector-pool.mjs, once with threads and once with
// `NODUS_VECTOR_WORKERS=0`, because the pool size is read at import: the two answers cannot
// be produced in one process. Prints a single JSON line on stdout.

import { searchVectorsOffThread, shutdownVectorSearch, vectorSearchPoolState } from '../../server/lib/core/vectorSearchPool.mjs';

const DIM = 512;
const COUNT = 20_000;

/** A deterministic corpus: no Math.random, so a failure can be reproduced exactly. */
function corpus() {
  const matrix = new Int8Array(COUNT * DIM);
  let state = 1;
  for (let index = 0; index < matrix.length; index += 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    matrix[index] = (state % 255) - 127;
  }
  const ids = Array.from({ length: COUNT }, (_, row) => `row-${row}`);
  return { dim: DIM, count: COUNT, matrix, ids };
}

function query() {
  const vector = new Float32Array(DIM);
  let state = 7;
  for (let index = 0; index < DIM; index += 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    vector[index] = (state / 2147483648) * 2 - 1;
  }
  return vector;
}

const set = corpus();

// A heartbeat on the macrotask queue. Nothing here can run while synchronous work holds the
// thread, which is exactly the property under test: the count is how many times the server
// could have answered somebody else while this search was in flight.
let ticks = 0;
let beating = true;
const beat = () => {
  if (!beating) return;
  ticks += 1;
  setImmediate(beat);
};
setImmediate(beat);

const matches = await searchVectorsOffThread(set, query(), { limit: 5 });
beating = false;

process.stdout.write(`${JSON.stringify({ ticks, matches, pool: vectorSearchPoolState() })}\n`);
await shutdownVectorSearch();
