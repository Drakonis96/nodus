// The walk's app-loss recovery, pinned without a model or an app.
//
// Issue #892 was a long documentation walk that died ninety answers in: the app went away,
// the walk threw the rest of the queue away, and the log never said whether the app had
// quit, crashed or been killed. scripts/lib/walk-app-instance.mjs is the part of the walk
// that decides what to do about that, and this is the part that can be tested in CI — the
// live walk itself needs a provider key.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createInstanceKeeper, lossReason } from './lib/walk-app-instance.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const walk = readFileSync(path.join(root, 'scripts/verify-nodi-documentation.mjs'), 'utf8');

/** A keeper over a fake app: `state.up` flips to false to simulate the instance dying. */
function fakeKeeper({ limit = 4 } = {}) {
  const state = { up: true, launches: 0, closes: 0, log: [] };
  const keeper = createInstanceKeeper({
    limit,
    isUp: () => state.up,
    launch: async () => { state.launches++; state.up = true; },
    close: async () => { state.closes++; },
    log: (message) => state.log.push(message),
  });
  return { keeper, state };
}

/** An instance that dies under its first answer, then answers. */
function diesOnce(state) {
  let died = false;
  return async () => {
    if (!died) {
      died = true;
      state.up = false;
      throw new Error('page.evaluate: Application exited');
    }
    return 'ok';
  };
}

test('a loss is reported as the reason, not as the browser log behind it', () => {
  // Playwright appends its whole browser log to a closed-target error; the walk's output
  // and its report want the first line.
  assert.equal(
    lossReason(new Error('page.evaluate: Application exited\n\nBrowser logs:\n\n<launching> electron')),
    'page.evaluate: Application exited',
  );
});

test('a question lost with the app is asked again on the fresh instance', async () => {
  const { keeper, state } = fakeKeeper();
  assert.equal(await keeper.ask(diesOnce(state)), 'ok');
  assert.equal(state.launches, 1, 'one replacement instance was launched');
  assert.equal(keeper.losses.length, 1);
  assert.match(state.log[0], /re-asked on a fresh instance/);
});

test('three workers noticing the same loss record it once and launch one instance', async () => {
  const { keeper, state } = fakeKeeper();
  let deaths = 0;
  const question = async () => {
    if (deaths < 3) {
      deaths++;
      state.up = false;
      throw new Error('page.evaluate: Target page, context or browser has been closed');
    }
    return 'ok';
  };
  assert.deepEqual(await Promise.all([1, 2, 3].map(() => keeper.ask(question))), ['ok', 'ok', 'ok']);
  assert.equal(state.launches, 1, 'the relaunch is single-flight');
  assert.equal(keeper.losses.length, 1, 'the loss is recorded once');
});

test('a failure that is not an app loss is the caller\'s', async () => {
  const { keeper, state } = fakeKeeper();
  await assert.rejects(keeper.ask(async () => { throw new Error('Falta la clave de IA'); }), /Falta la clave/);
  assert.equal(state.launches, 0);
  assert.equal(keeper.losses.length, 0);
});

test('an instance that is still up keeps its own failures', async () => {
  const { keeper, state } = fakeKeeper();
  // The app is demonstrably alive, so a closed-target error is not a loss to recover from —
  // retrying it would spin, and recording it would spend a relaunch on an app that never
  // died.
  await assert.rejects(
    keeper.ask(async () => { throw new Error('page.evaluate: Target page, context or browser has been closed'); }),
    /has been closed/,
  );
  assert.equal(state.launches, 0);
  assert.equal(keeper.losses.length, 0);
});

test('a page that crashed is recovered even though the app process is alive', async () => {
  const { keeper, state } = fakeKeeper();
  assert.equal(await keeper.ask(diesOnce(state)), 'ok');
  assert.equal(state.launches, 1);
});

test('a killed app that surfaces as an internal Playwright error is still a loss', async () => {
  const { keeper, state } = fakeKeeper();
  let died = false;
  // The state decides, not the wording: a SIGKILLed app can reject an in-flight evaluate
  // with a TypeError from inside Playwright, and the answer never arrived either way.
  const answer = await keeper.ask(async () => {
    if (!died) {
      died = true;
      state.up = false;
      throw new TypeError("Cannot read properties of undefined (reading '_object')");
    }
    return 'ok';
  });
  assert.equal(answer, 'ok');
  assert.equal(state.launches, 1);
  assert.equal(keeper.losses.length, 1);
});

test('a state probe that throws means the instance is gone', async () => {
  // Playwright's own handles throw once their app is gone — app.process() reads a
  // dispatcher that no longer exists — so "cannot say" must be read as "gone" rather than
  // thrown at the walk.
  let healthy = true;
  let first = true;
  const keeper = createInstanceKeeper({
    limit: 2,
    isUp: () => {
      if (!healthy) throw new TypeError("Cannot read properties of undefined (reading '_object')");
      return true;
    },
    launch: async () => { healthy = true; },
    close: async () => {},
  });
  assert.equal(await keeper.ask(async () => {
    if (first) {
      first = false;
      healthy = false; // the app dies under this answer, and so does the state probe
      throw new TypeError("Cannot read properties of undefined (reading '_object')");
    }
    return 'ok';
  }), 'ok');
});

test('the walk gives up loudly after the relaunch limit', async () => {
  const { keeper, state } = fakeKeeper({ limit: 2 });
  let calls = 0;
  await assert.rejects(
    keeper.ask(async () => {
      calls++;
      state.up = false;
      throw new Error('page.evaluate: Application exited');
    }),
    /needs a human/,
  );
  assert.equal(state.launches, 2, 'two replacements, as the limit says');
  assert.equal(calls, 3, 'the question is asked on the initial instance and once per relaunch');
  assert.equal(keeper.losses.length, 3, 'and the loss that ends the walk is recorded too');
});

test('the walk reports the app\'s exit code and signal, and re-asks what was lost', () => {
  // The evidence #892 lacked: without the code and signal, quitting, crashing and being
  // killed all look alike in the log.
  assert.match(walk, /app exited \(code=\$\{code \?\? 'null'\} signal=\$\{signal \?\? 'null'\}\)/);
  assert.match(walk, /createInstanceKeeper\(/);
  assert.match(walk, /--kill-app-after/, 'the recovery path has a self-test switch');
  assert.doesNotMatch(walk, /includes\('exited'\)\) queue\.length = 0/, 'an app loss no longer discards the queue');
});
