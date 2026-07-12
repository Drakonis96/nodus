import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-conflict-'));
const bundle = path.join(outDir, 'conflictDetection.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'shared/conflictDetection.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=es2022',
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);
const { detectPersonConflicts } = require(bundle);

test.after(() => rm(outDir, { recursive: true, force: true }));

test('contradictory birth years across sources are flagged', () => {
  const conflicts = detectPersonConflicts({
    birthDate: '1850',
    deathDate: null,
    events: [
      { type: 'birth', date: '1850' },
      { type: 'baptism', date: '1848' }, // 2y is within window
      { type: 'birth', date: '1845' }, // 5y span → conflict
    ],
  });
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].fact, 'birth');
  assert.equal(conflicts[0].spanYears, 5);
  assert.ok(conflicts[0].values.some((v) => v.label === 'ficha'));
});

test('small differences within the window are not conflicts', () => {
  const conflicts = detectPersonConflicts({
    birthDate: '1850',
    deathDate: null,
    events: [
      { type: 'birth', date: '1850' },
      { type: 'baptism', date: '1851' }, // baptism a year after birth is normal
    ],
  });
  assert.deepEqual(conflicts, []);
});

test('death and burial conflicts detected independently', () => {
  const conflicts = detectPersonConflicts({
    birthDate: null,
    deathDate: '1910',
    events: [{ type: 'burial', date: '1905' }],
  });
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].fact, 'death');
});

test('a single assertion is never a conflict', () => {
  assert.deepEqual(detectPersonConflicts({ birthDate: '1850', deathDate: null, events: [] }), []);
});

test('undated / unparseable events are ignored', () => {
  const conflicts = detectPersonConflicts({
    birthDate: 'c. 1850',
    deathDate: null,
    events: [
      { type: 'birth', date: null },
      { type: 'birth', date: 'en tiempos de Maricastaña' },
    ],
  });
  assert.deepEqual(conflicts, []);
});
