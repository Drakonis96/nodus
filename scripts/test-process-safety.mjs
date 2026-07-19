// Verifies the main-process safety net actually keeps the process alive.
//
// The check is behavioural, not structural: Node >= 15 terminates on an
// unhandled rejection, so the only honest test is to spawn a real child that
// throws the way Nodus's timers throw and assert on its exit code. The child
// loads the real compiled electron/util/processSafety.ts — not a copy — so the
// test cannot drift away from the shipped module.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(path.join(tmpdir(), 'nodus-safety-'));
const netPath = path.join(dir, 'processSafety.cjs');

// Bundle the real module (same approach as test-archive-filters.mjs).
const built = spawnSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'electron/util/processSafety.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=es2022',
    `--outfile=${netPath}`,
  ],
  { cwd: repoRoot, encoding: 'utf8' }
);
assert.equal(built.status, 0, `esbuild failed: ${built.stderr}`);

let caseId = 0;

/** Run a snippet in a child process, optionally with the real net installed. */
function run(body, { install = true } = {}) {
  const preamble = install
    ? `require(${JSON.stringify(netPath)}).installProcessSafetyNet();\n`
    : '';
  const file = path.join(dir, `case-${caseId++}.cjs`);
  writeFileSync(file, preamble + body);
  return spawnSync(process.execPath, [file], { encoding: 'utf8' });
}

try {
  // --- Control: prove the hazard is real without the net -------------------
  const bare = run(
    `Promise.reject(new Error('backup failed'));\nsetTimeout(() => { console.log('SURVIVED'); }, 50);`,
    { install: false }
  );
  assert.notEqual(bare.status, 0, 'baseline: an unhandled rejection must be fatal without the net');
  assert.ok(!bare.stdout.includes('SURVIVED'), 'baseline: process must die before the next tick');

  // --- 1. Unhandled rejection is survivable --------------------------------
  // This is the auto-backup case: main.ts fires a void promise on a 30 min timer.
  const rejected = run(
    `Promise.reject(new Error('backup failed'));\nsetTimeout(() => { console.log('SURVIVED'); }, 50);`
  );
  assert.equal(rejected.status, 0, `rejection should not be fatal, got status ${rejected.status}`);
  assert.ok(rejected.stdout.includes('SURVIVED'), 'process must keep running after a rejection');
  assert.ok(rejected.stderr.includes('[fault] unhandledRejection'), 'fault must be logged');
  assert.ok(rejected.stderr.includes('backup failed'), 'log must carry the original message');

  // --- 2. Synchronous throw in a timer is survivable -----------------------
  // This is studyCalendarReminders.ts:40 — a sync callback on a 30 s interval.
  const threw = run(
    `setTimeout(() => { throw new Error('reminder tick failed'); }, 10);\n` +
      `setTimeout(() => { console.log('SURVIVED'); }, 60);`
  );
  assert.equal(threw.status, 0, 'a throw inside a timer must not kill the process');
  assert.ok(threw.stdout.includes('SURVIVED'), 'later timers must still run');
  assert.ok(threw.stderr.includes('[fault] uncaughtException'), 'fault must be logged');

  // --- 3. Non-Error rejections are reported, not swallowed -----------------
  const nonError = run(`Promise.reject({ code: 'SQLITE_BUSY' });\nsetTimeout(() => {}, 20);`);
  assert.equal(nonError.status, 0);
  assert.ok(nonError.stderr.includes('SQLITE_BUSY'), 'non-Error payload must survive into the log');

  // --- 4. A failing repeat does not flood the log --------------------------
  // A broken 30 s timer must not write the same stack forever.
  const flood = run(
    `let n = 0;\n` +
      `const id = setInterval(() => { n++; Promise.reject(new Error('tick')); if (n === 64) clearInterval(id); }, 1);`
  );
  assert.equal(flood.status, 0);
  const lines = flood.stderr.split('\n').filter((l) => l.startsWith('[fault]')).length;
  assert.ok(lines <= 8, `64 identical faults should collapse to <=8 lines, got ${lines}`);
  assert.ok(lines >= 3, `collapse must still report early occurrences, got ${lines}`);
  assert.ok(flood.stderr.includes('(x'), 'collapsed reports must show the repeat count');

  // --- 5. Distinct faults are not collapsed into each other ----------------
  const distinct = run(
    `Promise.reject(new Error('alpha'));\n` +
      `setTimeout(() => Promise.reject(new Error('beta')), 10);\n` +
      `setTimeout(() => {}, 40);`
  );
  assert.ok(distinct.stderr.includes('alpha'), 'first distinct fault must report');
  assert.ok(distinct.stderr.includes('beta'), 'second distinct fault must not be collapsed away');

  // --- 6. Installing twice must not double-report --------------------------
  const twice = run(
    `require(${JSON.stringify(netPath)}).installProcessSafetyNet();\n` +
      `Promise.reject(new Error('once'));\nsetTimeout(() => {}, 30);`
  );
  const onceLines = twice.stderr.split('\n').filter((l) => l.includes('[fault]')).length;
  assert.equal(onceLines, 1, `re-installing must not duplicate handlers, got ${onceLines} lines`);

  console.log('# process safety net tests passed');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
