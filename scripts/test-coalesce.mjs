// Verifies the progress-broadcast coalescer used by the scan queue.
//
// Queue progress is emitted by WORK, not by time: once per extracted PDF page,
// once per AI chunk, once per enqueued item. Each emit copies the whole queue
// and structured-clones it across IPC, so resuming a 3,000-work library sent
// 3,000 messages averaging 1,500 items — millions of cloned objects before the
// window had settled.
//
// The assertions are about counts and ordering, never about elapsed
// milliseconds: the suite runs test files in parallel, so timing thresholds
// flake. Bursts are issued synchronously so the collapse is deterministic.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(path.join(tmpdir(), 'nodus-coalesce-'));
const bundle = path.join(dir, 'coalesce.cjs');

execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'electron/util/coalesce.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=es2022',
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);

const require = createRequire(import.meta.url);
const { coalesce } = require(bundle);

const INTERVAL = 60;
const waitFor = async (predicate, description, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail(`timed out waiting for: ${description}`);
};

try {
  // --- 1. A synchronous burst collapses -----------------------------------
  // This is `resumePending()` on a large library: thousands of emits, no gap.
  {
    let runs = 0;
    const c = coalesce(() => { runs += 1; }, INTERVAL);
    for (let i = 0; i < 3000; i += 1) c.schedule();
    assert.equal(runs, 1, `a synchronous burst must run once immediately, ran ${runs}`);
    assert.ok(c.pending, 'the trailing run must be scheduled');

    await waitFor(() => !c.pending, 'the trailing run to fire');
    assert.equal(runs, 2, `3,000 requests must collapse to 2 runs, got ${runs}`);
  }

  // --- 2. The trailing edge is never lost ---------------------------------
  // Losing it would freeze a progress bar at whatever it showed when the burst
  // began — the failure mode that makes naive throttling unacceptable here.
  {
    let last = null;
    let state = 'start';
    const c = coalesce(() => { last = state; }, INTERVAL);
    c.schedule();              // runs immediately, records 'start'
    assert.equal(last, 'start');
    state = 'middle';
    c.schedule();              // throttled
    state = 'final';
    c.schedule();              // still throttled
    await waitFor(() => last === 'final', 'the trailing run to deliver the latest state');
    assert.equal(last, 'final', 'the last state must always be delivered');
  }

  // --- 3. Spaced-out calls are not delayed --------------------------------
  // Slow work must still feel immediate.
  {
    let runs = 0;
    const c = coalesce(() => { runs += 1; }, INTERVAL);
    for (let i = 0; i < 3; i += 1) {
      c.schedule();
      await new Promise((r) => setTimeout(r, INTERVAL * 2));
    }
    assert.equal(runs, 3, `calls spaced beyond the interval must all run immediately, got ${runs}`);
    assert.ok(!c.pending, 'nothing should remain scheduled');
  }

  // --- 4. flush() delivers immediately ------------------------------------
  {
    let runs = 0;
    const c = coalesce(() => { runs += 1; }, INTERVAL);
    c.schedule();               // immediate
    c.schedule();               // pending
    assert.ok(c.pending);
    c.flush();
    assert.equal(runs, 2, 'flush must run the pending call at once');
    assert.ok(!c.pending, 'flush must clear the pending state');
  }

  // --- 5. flush() with nothing pending is a no-op -------------------------
  {
    let runs = 0;
    const c = coalesce(() => { runs += 1; }, INTERVAL);
    c.flush();
    assert.equal(runs, 0, 'flushing an idle coalescer must not run anything');
  }

  // --- 6. cancel() drops the pending run ----------------------------------
  {
    let runs = 0;
    const c = coalesce(() => { runs += 1; }, INTERVAL);
    c.schedule();
    c.schedule();
    c.cancel();
    assert.ok(!c.pending, 'cancel must clear the pending state');
    await new Promise((r) => setTimeout(r, INTERVAL * 3));
    assert.equal(runs, 1, 'a cancelled trailing run must not fire');
  }

  // --- 7. Sustained work runs at the cadence, not per call ----------------
  // 400 PDF pages arriving fast must not mean 400 broadcasts.
  {
    let runs = 0;
    const c = coalesce(() => { runs += 1; }, INTERVAL);
    const started = Date.now();
    while (Date.now() - started < INTERVAL * 4) {
      c.schedule();
      await new Promise((r) => setTimeout(r, 1));
    }
    c.flush();
    // Bounded by elapsed time over the interval, with slack for scheduling.
    assert.ok(runs <= 10, `sustained scheduling must stay near the cadence, ran ${runs} times`);
    assert.ok(runs >= 2, `sustained scheduling must keep delivering updates, ran ${runs} times`);
  }

  // --- 8. The callback runs even if a previous one threw ------------------
  {
    let runs = 0;
    const c = coalesce(() => {
      runs += 1;
      if (runs === 1) throw new Error('listener blew up');
    }, INTERVAL);
    assert.throws(() => c.schedule(), /listener blew up/);
    await new Promise((r) => setTimeout(r, INTERVAL * 2));
    c.schedule();
    assert.equal(runs, 2, 'a throwing callback must not wedge the coalescer');
  }

  console.log('# coalesce tests passed');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
