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
  assert.ok(pooled.ticks > 0, 'the pooled search must leave the loop running at all');

  // Not a tick count: how many times a loop comes around in a given window is a property of
  // the machine, and on a loaded build runner the same healthy loop manages a fraction of
  // what an idle laptop does — which is how a threshold of ten came to fail at eight.
  //
  // What the fix was actually for is that the server keeps answering, so that is what is
  // measured: the longest the loop went unable to run anything. Compared against the arm
  // that blocks outright, on the same machine in the same run, so a slow host slows both.
  // Against what this machine manages with nothing running, not against a number written
  // here. How many times a loop comes around in a given window belongs to the host: an idle
  // laptop and a build runner sharing its cores differ by more than the margin any fixed
  // threshold can hold, which is how "at least ten" came to fail at eight on a green tree.
  //
  // The ratio does not have that problem. Blocked is zero however slow the host is, and a
  // loop that is merely busy keeps a large share of its own capacity: measured at 0.84 idle
  // and 0.43 with four of these running at once, against a tenth required here.
  const shareOf = arm => arm.ticks / Math.max(arm.idleTicks, 1);
  // The control for the threshold, from the arm that is the defect: it is zero, and stays
  // zero on any host, because no macrotask runs while synchronous code holds the thread.
  assert.equal(shareOf(inline), 0, 'the blocked arm is what this threshold is drawn to exclude');

  const share = shareOf(pooled);
  assert.ok(
    share >= 0.1,
    `the pooled search left the loop ${(share * 100).toFixed(0)}% of the capacity it has when idle`
    + ` (${pooled.ticks} ticks against ${pooled.idleTicks}, longest pause ${pooled.longestGapMs.toFixed(1)} ms)`,
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
