// Verifies the auto-backup heartbeat's scheduling behaviour.
//
// A backup snapshots every vault into memory, so on a large library one run can
// hold several full copies of the database at once and can outlast the 30-minute
// heartbeat. Three properties matter, and none of them held before:
//   1. Overlapping runs are refused    — otherwise peak RAM multiplies.
//   2. A failure is caught             — an unhandled rejection killed the app,
//                                        unattended, every 30 minutes.
//   3. Ticks stop at shutdown          — getDb() reopens lazily, so a late tick
//                                        resurrects the DB on a quitting process.
//
// The tick body is reproduced here because main.ts is the Electron entry point
// and cannot be imported headlessly; the assertions below are what the shape of
// that body has to satisfy.
import assert from 'node:assert/strict';

/**
 * A promise the test resolves by hand.
 *
 * Deliberately not `setTimeout`: asserting that N sleeps fit inside another
 * sleep makes the test a race that loses under parallel CI load. Controlling
 * completion explicitly makes the overlap deterministic.
 */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Build a tick with the same guards as main.ts's autoBackupTick. */
function makeTick(runBackup) {
  const state = { running: false, quitting: false, started: 0, skipped: 0, failures: [] };
  const tick = () => {
    if (state.running) {
      state.skipped += 1;
      return;
    }
    if (state.quitting) return;
    state.running = true;
    state.started += 1;
    return Promise.resolve()
      .then(runBackup)
      .catch((error) => {
        state.failures.push(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        state.running = false;
      });
  };
  return { tick, state };
}

// --- 1. A tick arriving mid-run is dropped, not queued ----------------------
{
  const gate = deferred();
  const { tick, state } = makeTick(() => gate.promise);
  const first = tick();
  tick(); // arrives while the first is still running
  tick();
  assert.equal(state.started, 1, 'only one backup may run at a time');
  assert.equal(state.skipped, 2, 'overlapping ticks must be dropped, not queued');

  gate.resolve();
  await first;

  // Once it finishes, the next tick is allowed through again.
  await tick();
  assert.equal(state.started, 2, 'a later tick must run once the previous finished');
}

// --- 2. A failing backup is caught and does not wedge the guard -------------
{
  let attempt = 0;
  const { tick, state } = makeTick(() => {
    attempt += 1;
    if (attempt === 1) throw new Error('disk full');
    return undefined;
  });

  await tick();
  assert.deepEqual(state.failures, ['disk full'], 'the failure must be caught and recorded');
  assert.equal(state.running, false, 'the guard must be released even when the backup throws');

  // The critical part: a failure must not disable all future backups.
  await tick();
  assert.equal(state.started, 2, 'a backup must still run after a previous one failed');
  assert.equal(state.failures.length, 1, 'the second run succeeded');
}

// --- 3. A rejected promise (not just a throw) is also caught ---------------
{
  const { tick, state } = makeTick(() => Promise.reject(new Error('vault locked')));
  await tick();
  assert.deepEqual(state.failures, ['vault locked'], 'async rejections must be caught too');
  assert.equal(state.running, false, 'the guard must be released after a rejection');
}

// --- 4. Ticks after shutdown starts are refused -----------------------------
{
  const { tick, state } = makeTick(() => undefined);
  state.quitting = true;
  await tick();
  assert.equal(state.started, 0, 'a tick that lands during shutdown must not reopen the database');
}

// --- 5. A long backup spanning several heartbeats runs exactly once ---------
{
  const gate = deferred();
  const { tick, state } = makeTick(() => gate.promise);
  const run = tick();
  // Five heartbeats land while the slow backup is still going. The backup only
  // completes when the test says so, so this cannot race.
  for (let i = 0; i < 5; i++) tick();
  assert.equal(state.started, 1, 'a slow backup must not be joined by its own heartbeats');
  assert.equal(state.skipped, 5, 'every overlapping heartbeat must be accounted for');

  gate.resolve();
  await run;
  assert.equal(state.running, false, 'the guard must clear once the long backup finishes');
}

console.log('# auto-backup schedule tests passed');
