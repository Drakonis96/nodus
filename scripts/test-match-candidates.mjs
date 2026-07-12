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

const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-match-'));
const bundle = path.join(outDir, 'matchCandidates.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'shared/matchCandidates.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=es2022',
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);
const mc = require(bundle);

test.after(() => rm(outDir, { recursive: true, force: true }));

const person = (id, name, birthYear = null, placeKeys = []) => ({
  id,
  displayName: name,
  tokens: name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/),
  birthYear,
  placeKeys,
});

test('editDistance detects single-character variants', () => {
  assert.equal(mc.editDistance('perez', 'peres'), 1);
  assert.equal(mc.editDistance('perez', 'perez'), 0);
  assert.ok(mc.editDistance('juan', 'pedro') > 1, 'unrelated names are far apart');
  assert.equal(mc.editDistance('ana', 'anastasia'), 99, 'large length gap is capped early');
});

test('spelling variants with compatible years are candidates', () => {
  const cands = mc.computeMatchCandidates([
    person('a', 'Juan Pérez', 1850, ['sevilla']),
    person('b', 'Juan Peres', 1852, ['sevilla']),
  ]);
  assert.equal(cands.length, 1);
  assert.equal(cands[0].reasons.includes('nombre similar'), true);
  assert.ok(cands[0].reasons.includes('lugar en común'));
  assert.ok(cands[0].reasons.includes('fechas de nacimiento compatibles'));
  assert.ok(cands[0].score > 1);
});

test('incompatible birth years are never paired', () => {
  const cands = mc.computeMatchCandidates([
    person('a', 'Juan Pérez', 1850),
    person('b', 'Juan Pérez', 1875),
  ]);
  assert.equal(cands.length, 0, 'same name but 25 years apart → different people');
});

test('different given names are not candidates', () => {
  const cands = mc.computeMatchCandidates([person('a', 'Juan Pérez'), person('b', 'Pedro Pérez')]);
  assert.equal(cands.length, 0);
});

test('reordered full names still match', () => {
  const cands = mc.computeMatchCandidates([person('a', 'Juan Pérez'), person('b', 'Pérez Juan')]);
  assert.equal(cands.length, 1);
  assert.equal(cands[0].reasons[0], 'mismo nombre');
});

test('dismissed pairs are excluded', () => {
  const dismissed = new Set([mc.pairKey('a', 'b')]);
  const cands = mc.computeMatchCandidates([person('a', 'Juan Pérez', 1850), person('b', 'Juan Pérez', 1851)], dismissed);
  assert.equal(cands.length, 0);
});

test('unknown years do not block a name match', () => {
  const cands = mc.computeMatchCandidates([person('a', 'Juan Pérez'), person('b', 'Juan Pérez')]);
  assert.equal(cands.length, 1, 'both years null → still a candidate on name alone');
});
