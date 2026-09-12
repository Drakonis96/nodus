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
//
// The count alone is a throughput number, and throughput depends on the machine — a busy
// build runner turns "how many" into a coin toss. The gaps between beats are recorded too,
// and so is what this loop manages with nothing running. Neither is a threshold: both were
// tried as one and both failed on a healthy tree, for reasons the test sets out. They are
// reported so that a failure of the one thing that is exact — blocked is zero, off-thread is
// not — can be read without guessing at the machine it happened on.
let ticks = 0;
let beating = true;
let last = performance.now();
let longestGapMs = 0;
const beat = () => {
  if (!beating) return;
  const now = performance.now();
  ticks += 1;
  // The first beats include the worker being created; a gap is only meaningful once the
  // search is actually running.
  if (ticks > 2) longestGapMs = Math.max(longestGapMs, now - last);
  last = now;
  setImmediate(beat);
};
setImmediate(beat);

const started = performance.now();
const matches = await searchVectorsOffThread(set, query(), { limit: 5 });
const elapsedMs = performance.now() - started;
beating = false;

// The same heartbeat again with nothing running, for the same length of time. This is what
// the loop manages on this machine right now, which on a build runner sharing its cores
// with other jobs is nothing like what it manages on an idle laptop. Comparing the search
// against it instead of against a number written here is what keeps the test about the code.
const idle = await new Promise(resolve => {
  let idleTicks = 0, idleLongestGapMs = 0, idleLast = performance.now();
  const until = performance.now() + elapsedMs;
  const idleBeat = () => {
    const now = performance.now();
    idleTicks += 1;
    if (idleTicks > 2) idleLongestGapMs = Math.max(idleLongestGapMs, now - idleLast);
    idleLast = now;
    if (now >= until) resolve({ idleTicks, idleLongestGapMs });
    else setImmediate(idleBeat);
  };
  setImmediate(idleBeat);
});

process.stdout.write(`${JSON.stringify({ ticks, longestGapMs, elapsedMs, ...idle, matches, pool: vectorSearchPoolState() })}\n`);
await shutdownVectorSearch();
