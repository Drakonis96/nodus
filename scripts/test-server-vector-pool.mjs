// Semantic search must not stop the server.
//
// A brute-force pass over a real corpus matrix is tens of milliseconds of straight-line
// arithmetic: 52 ms for 33,016 passages at 1024 dimensions on an idle laptop, and 195 ms for
// the same call on a host under load. Run on the main thread that is time in which this
// process answers nothing at all: not the health check the container polls every 30 s, not a
// phone opening a screen, not a second person's search. That is the defect these tests
// describe.
//
// The measurement is not a stopwatch. A heartbeat on the macrotask queue counts how many
// times the event loop came around while the search was in flight, which is a count of the
// work the server could still have done. Blocked, that count is zero — deterministically, not
// approximately, because no macrotask can run while synchronous code holds the thread.
//
// Both arms run in child processes because `NODUS_VECTOR_WORKERS` is read at import.

import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { scoreVectors, withSharedMatrix } from '../server/lib/core/vectors.mjs';

const run = promisify(execFile);
const PROBE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lib', 'vectorSearchProbe.mjs');

async function probe(workers) {
  const { stdout } = await run(process.execPath, [PROBE], {
    env: { ...process.env, NODUS_VECTOR_WORKERS: workers },
    maxBuffer: 4 * 1024 * 1024,
  });
  return JSON.parse(stdout.trim().split('\n').at(-1));
}

test('a search on worker threads leaves the event loop free, and inline does not', async () => {
  const [pooled, inline] = await Promise.all([probe('2'), probe('0')]);

  // Zero is the whole point, and it is exact: the inline search occupies the thread from the
  // call to the return, so the heartbeat scheduled before it cannot fire even once. This arm
  // is the "before" of the fix, kept as a test so the regression cannot come back quietly.
  assert.equal(inline.ticks, 0, `inline search let the loop tick ${inline.ticks} times, expected none`);
  assert.equal(inline.pool.threads, 0, 'NODUS_VECTOR_WORKERS=0 must not start a thread');

  assert.ok(pooled.pool.threads >= 1, 'the pooled arm must actually have used a thread');

  // No threshold on how much of the loop was left, because there is no honest one.
  //
  // Two have now been tried and both failed on a healthy tree. "At least ten ticks" failed
  // at eight. Its replacement compared the search against what the same machine manages
  // idle, on the reasoning that a ratio survives a slow host -- and it failed at 8% on a
  // macOS runner whose longest pause was 3.9 ms, which is a loop answering every four
  // milliseconds reported as a defect.
  //
  // The ratio was wrong for a specific reason worth keeping: the two windows are not
  // comparable. The search window has a worker saturating a core and the idle window has
  // nothing, so where cores are already spoken for the ratio measures how many are free
  // rather than whether the loop was blocked. The longest pause is no better -- measured
  // here under deliberate oversubscription it reached 72.8 ms on a run whose loop ticked
  // 883 times, because the operating system descheduled the whole process, which is not a
  // property of this code. Under that same load the share ranged from 0.26 to 1.33.
  //
  // What is exact on every host is the boundary, and it is asserted above in both
  // directions: blocked is zero ticks, and it is zero because no macrotask can run while
  // synchronous code holds the thread -- not nearly zero, not usually zero. Off the thread
  // is more than zero. That is the defect and its fix, and it is the whole of what a shared
  // build runner can be asked. The numbers below travel with a failure so a real regression
  // can be read, and they are reported rather than thresholded.
  const shareOfIdle = pooled.ticks / Math.max(pooled.idleTicks, 1);
  assert.ok(
    pooled.ticks > 0,
    `the pooled search blocked the loop as completely as the inline one:`
    + ` ${pooled.ticks} ticks against ${pooled.idleTicks} idle`
    + ` (${(shareOfIdle * 100).toFixed(0)}% of idle capacity, longest pause`
    + ` ${pooled.longestGapMs.toFixed(1)} ms, search ${pooled.elapsedMs.toFixed(0)} ms)`,
  );
});

test('moving the arithmetic to a thread does not move the answer', async () => {
  const [pooled, inline] = await Promise.all([probe('2'), probe('0')]);
  assert.deepEqual(pooled.matches, inline.matches, 'the worker returned different results than the inline search');
  assert.equal(pooled.matches.length, 5);
  assert.ok(pooled.matches.every((match) => typeof match.id === 'string' && Number.isFinite(match.score)));
  // Best first, which is what every caller slices.
  const scores = pooled.matches.map((match) => match.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
});

test('a shared matrix is the same matrix', () => {
  const matrix = new Int8Array([3, -4, 5, -6, 7, -8]);
  const set = { dim: 3, count: 2, matrix, ids: ['a', 'b'] };
  const shared = withSharedMatrix(set);

  assert.ok(shared.matrix.buffer instanceof SharedArrayBuffer, 'the copy must live in shared memory');
  assert.deepEqual([...shared.matrix], [...matrix]);
  // Sharing an already-shared set has to be free, or every query would copy the corpus again.
  assert.equal(withSharedMatrix(shared), shared);

  const query = new Float32Array([1, 0, 0]);
  assert.deepEqual(scoreVectors(set, query, { limit: 2 }), scoreVectors(shared, query, { limit: 2 }));
});

test('NODUS_VECTOR_WORKERS refuses a value it cannot use', async () => {
  await assert.rejects(
    () => probe('two'),
    (error) => /NODUS_VECTOR_WORKERS must be a whole number of threads/.test(String(error.stderr ?? error)),
    'a typo has to stop the boot, not degrade a request an hour later',
  );
});
