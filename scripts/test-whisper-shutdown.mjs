// Verifies that quitting Nodus kills running whisper.cpp transcriptions.
//
// whisper-cli is spawned with up to 8 threads and is NOT in the app's process
// group, so it survives the parent unless we signal it explicitly. Before the
// fix, quitting mid-transcription left it saturating those cores with no UI
// left to stop it, and every run added another orphan.
//
// The real electron/stt/whisperCpp.ts is bundled with the electron stub so the
// shipped `stopAllWhisperCpp` is what runs here, not a copy of its logic. The
// children are stand-ins for whisper-cli: what matters is that they are real
// OS processes that outlive their bookkeeping.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(path.join(tmpdir(), 'nodus-whisper-'));
const bundle = path.join(dir, 'whisperCpp.cjs');

// better-sqlite3 in this tree is built for Electron's ABI and will not load
// under plain Node. The shutdown path never touches the database, so the driver
// is stubbed out rather than dragging Electron into this test.
const sqliteStub = path.join(dir, 'stub-sqlite.mjs');
writeFileSync(
  sqliteStub,
  'class Database { constructor() {} prepare() { return { get: () => undefined, all: () => [], run: () => undefined }; } ' +
    'exec() {} pragma() { return []; } transaction(fn) { return fn; } close() {} }\nexport default Database;\n'
);

execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'electron/stt/whisperCpp.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=es2022',
    `--outfile=${bundle}`,
    `--alias:electron=${path.join(repoRoot, 'scripts/stub-electron.mjs')}`,
    `--alias:better-sqlite3=${sqliteStub}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);

const require = createRequire(import.meta.url);
const whisper = require(bundle);

/** True while the OS still has this pid. Signal 0 tests liveness without signalling. */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Poll until `predicate` holds, or fail after `timeoutMs`.
 *
 * Fixed sleeps make process-lifecycle tests race under parallel CI load: the
 * assertion is about whether the OS reaps the child at all, not about how many
 * milliseconds it takes.
 */
async function until(predicate, description, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await wait(20);
  }
  assert.fail(`timed out after ${timeoutMs}ms waiting for: ${description}`);
}

/** A stand-in for whisper-cli: a real process that runs far longer than the test. */
function spawnLongRunningChild() {
  return spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * Reach into the module's private registry the same way the transcribe path
 * does. `__testRegisterWhisperChild` is exported purely for this.
 */
function register(id, child) {
  whisper.__testRegisterWhisperChild(id, child);
}

try {
  // --- Control: an unsignalled child really does outlive its bookkeeping ----
  {
    const child = spawnLongRunningChild();
    await until(() => alive(child.pid), 'the stand-in child to start');
    // Simulate the pre-fix shutdown: forget about it and walk away.
    await wait(250);
    assert.ok(
      alive(child.pid),
      'baseline: a child that is merely forgotten keeps running — this is the orphan bug'
    );
    child.kill('SIGKILL');
    await until(() => !alive(child.pid), 'the control child to be reaped');
  }

  // --- The fix: stopAllWhisperCpp signals every registered child -----------
  {
    const children = [spawnLongRunningChild(), spawnLongRunningChild(), spawnLongRunningChild()];
    children.forEach((c, i) => register(`req-${i}`, c));
    await until(() => children.every((c) => alive(c.pid)), 'all three children to start');

    assert.equal(whisper.activeWhisperCppCount(), 3, 'three transcriptions should be registered');

    const killed = whisper.stopAllWhisperCpp();
    assert.equal(killed, 3, `all three children should be signalled, got ${killed}`);

    await until(
      () => children.every((c) => !alive(c.pid)),
      'every child to die after shutdown'
    );
    assert.equal(whisper.activeWhisperCppCount(), 0, 'registry must be empty after shutdown');
  }

  // --- Already-exited children must not be double-signalled ----------------
  {
    const done = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
    await new Promise((r) => done.on('close', r));
    register('finished', done);

    const killed = whisper.stopAllWhisperCpp();
    assert.equal(killed, 0, 'a child that already exited must not be signalled again');
    assert.equal(whisper.activeWhisperCppCount(), 0, 'registry must still be cleared');
  }

  // --- Shutdown with nothing running is a no-op ----------------------------
  {
    assert.equal(whisper.stopAllWhisperCpp(), 0, 'quitting with no transcription must be harmless');
  }

  console.log('# whisper shutdown tests passed');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
