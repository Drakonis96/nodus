import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = await mkdtemp(path.join(os.tmpdir(), 'nodus-elapsed-time-'));
const bundle = path.join(output, 'elapsed.mjs');
await build({
  entryPoints: [path.join(repoRoot, 'shared/elapsedTime.ts')],
  outfile: bundle,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
});
const { elapsedTimeLabel, elapsedTimeMs, formatElapsedTime } = await import(pathToFileURL(bundle));

test('elapsed labels cover seconds, minutes and arbitrarily long hours', () => {
  assert.equal(formatElapsedTime(0), '0 s');
  assert.equal(formatElapsedTime(59_999), '59 s');
  assert.equal(formatElapsedTime(60_000), '1 min 00 s');
  assert.equal(formatElapsedTime(3_723_000), '1 h 02 min 03 s');
  assert.equal(formatElapsedTime(99 * 3_600_000 + 7_000), '99 h 00 min 07 s');
});

test('completed work freezes at its main-process finish timestamp', () => {
  const start = '2026-08-30T10:00:00.000Z';
  const finish = '2026-08-30T11:02:03.000Z';
  assert.equal(elapsedTimeMs(start, finish, Date.parse('2026-09-01T00:00:00.000Z')), 3_723_000);
  assert.equal(elapsedTimeLabel(start, finish, Date.parse('2026-09-01T00:00:00.000Z')), '1 h 02 min 03 s');
});

test('invalid timestamps never masquerade as a zero-second task', () => {
  assert.equal(elapsedTimeLabel(null, null), null);
  assert.equal(elapsedTimeLabel('not-a-date', null), null);
  assert.equal(elapsedTimeMs('2026-08-30T10:00:00.000Z', null, Date.parse('2026-08-30T09:59:00.000Z')), 0);
});

test.after(() => rm(output, { recursive: true, force: true }));
