// Focused Electron regression for the single-instance lock.
//
// Every vault is a SQLite file plus a registry of which vault is active. Two
// processes on the same profile write to both concurrently — the second one's
// vault switch rewrites the registry underneath the first — which is silent
// data loss, not slowness.
//
// The lock has to refuse a genuine duplicate WITHOUT breaking the two things
// that legitimately run more than one Nodus:
//   - isolated profiles (NODUS_USERDATA) used by tests, verifications and the
//     demo instance, which must still run side by side;
//   - the macOS unsigned updater, whose helper waits for this process to exit
//     and then relaunches, so the lock must be released on quit.
//
// Everything below drives real Electron processes; nothing is simulated in
// JavaScript, because what is being tested is process-level behaviour.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const electronBinary = require('electron');

if (!existsSync(path.join(repoRoot, 'dist-electron/main.js')) || !existsSync(path.join(repoRoot, 'dist/index.html'))) {
  throw new Error('Run `npm run build` before this focused verification.');
}

const profileA = await mkdtemp(path.join(os.tmpdir(), 'nodus-lock-a-'));
const profileB = await mkdtemp(path.join(os.tmpdir(), 'nodus-lock-b-'));
const started = [];

function launch(userData, label) {
  const env = {
    ...process.env,
    NODUS_USERDATA: userData,
    NODUS_DISABLE_AUTO_UPDATE: '1',
    NODUS_E2E_UPDATE_STATUS: 'not-available',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronBinary, [repoRoot], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const state = { child, label, exitCode: undefined, stderr: '' };
  child.stderr.on('data', (chunk) => { state.stderr = `${state.stderr}${chunk}`.slice(-4000); });
  child.stdout.on('data', () => undefined);
  child.on('exit', (code) => { state.exitCode = code ?? 0; });
  started.push(state);
  return state;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll until predicate holds; fail after timeoutMs. Never asserts on elapsed time. */
async function until(predicate, description, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await wait(100);
  }
  assert.fail(`timed out waiting for: ${description}`);
}

const isRunning = (state) => state.exitCode === undefined;

async function stop(state) {
  if (!isRunning(state)) return;
  state.child.kill('SIGTERM');
  const deadline = Date.now() + 8_000;
  while (isRunning(state) && Date.now() < deadline) await wait(100);
  if (isRunning(state)) state.child.kill('SIGKILL');
  while (isRunning(state)) await wait(50);
}

try {
  // --- 1. The first instance of a profile starts and stays up -------------
  const first = launch(profileA, 'A#1');
  await wait(6_000);
  assert.ok(isRunning(first), `the first instance must keep running (exit ${first.exitCode})\n${first.stderr}`);
  console.log('[lock] First instance running');

  // --- 2. A second instance of the SAME profile refuses to run ------------
  // This is the case that used to corrupt the database.
  const duplicate = launch(profileA, 'A#2');
  await until(() => !isRunning(duplicate), 'the duplicate instance to quit on its own');
  assert.equal(duplicate.exitCode, 0, 'the duplicate must exit cleanly, not crash');
  assert.ok(isRunning(first), 'the original instance must survive the duplicate attempt');
  console.log(`[lock] Duplicate on the same profile exited (code ${duplicate.exitCode}) and the original survived`);

  // --- 3. A DIFFERENT profile still runs side by side ---------------------
  // Tests, verification scripts and the demo instance all rely on this; a
  // global lock would have broken every one of them.
  const other = launch(profileB, 'B#1');
  await wait(6_000);
  assert.ok(
    isRunning(other),
    `an isolated profile must still start alongside the first (exit ${other.exitCode})\n${other.stderr}`
  );
  assert.ok(isRunning(first), 'the first profile must be unaffected by the second profile');
  console.log('[lock] Separate profile runs concurrently — isolated test profiles still work');

  // --- 4. The lock is released on exit, so a relaunch works ---------------
  // This is the macOS updater path: its helper waits for the old process to
  // die (`while kill -0 "$PID"`) and only then relaunches.
  await stop(first);
  assert.ok(!isRunning(first), 'the first instance must have exited');
  const relaunched = launch(profileA, 'A#3');
  await wait(6_000);
  assert.ok(
    isRunning(relaunched),
    `relaunching after a clean exit must work — this is the updater path (exit ${relaunched.exitCode})\n${relaunched.stderr}`
  );
  console.log('[lock] Relaunch after exit works — updater path intact');

  // --- 5. And the reclaimed profile still refuses duplicates --------------
  // Proves the lock was genuinely re-acquired, not merely absent.
  const duplicateAgain = launch(profileA, 'A#4');
  await until(() => !isRunning(duplicateAgain), 'the second duplicate to quit');
  assert.equal(duplicateAgain.exitCode, 0, 'the duplicate must exit cleanly');
  assert.ok(isRunning(relaunched), 'the relaunched instance must survive');
  console.log('[lock] Reclaimed profile still refuses duplicates');

  console.log('Single-instance verification passed.');
} finally {
  for (const state of started) await stop(state);
  await rm(profileA, { recursive: true, force: true });
  await rm(profileB, { recursive: true, force: true });
}
