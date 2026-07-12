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

const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-gendates-'));
const bundle = path.join(outDir, 'genealogyDates.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'shared/genealogyDates.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=es2022',
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);
const { parseHistoricalDate } = require(bundle);

test.after(() => rm(outDir, { recursive: true, force: true }));

test('bare year, year-month and full ISO dates', () => {
  const y = parseHistoricalDate('1850');
  assert.equal(y.qualifier, 'exact');
  assert.equal(y.sortKey, '1850-01-01');
  assert.equal(y.year, 1850);
  assert.equal(parseHistoricalDate('1850-03').sortKey, '1850-03-01');
  assert.equal(parseHistoricalDate('1850-03-02').sortKey, '1850-03-02');
});

test('spanish and english written dates', () => {
  assert.equal(parseHistoricalDate('2 de marzo de 1850').sortKey, '1850-03-02');
  assert.equal(parseHistoricalDate('2 marzo 1850').display, '2 mar 1850');
  assert.equal(parseHistoricalDate('March 2, 1850').sortKey, '1850-03-02');
  assert.equal(parseHistoricalDate('marzo 1850').sortKey, '1850-03-01');
  assert.equal(parseHistoricalDate('02/03/1850').sortKey, '1850-03-02'); // day-first
});

test('circa qualifiers normalise to c. and sort on the anchor year', () => {
  for (const form of ['c. 1850', 'ca 1850', 'circa 1850', '~1850', 'hacia 1850', 'abt 1850']) {
    const d = parseHistoricalDate(form);
    assert.equal(d.qualifier, 'circa', `${form} → circa`);
    assert.equal(d.sortKey, '1850-01-01', `${form} anchors 1850`);
    assert.equal(d.display, 'c. 1850', `${form} displays as c. 1850`);
  }
});

test('before / after qualifiers', () => {
  const before = parseHistoricalDate('antes de 1880');
  assert.equal(before.qualifier, 'before');
  assert.equal(before.sortKey, '1880-01-01');
  assert.equal(before.display, 'antes de 1880');
  const after = parseHistoricalDate('after 1850');
  assert.equal(after.qualifier, 'after');
  assert.equal(after.display, 'después de 1850');
  assert.equal(parseHistoricalDate('<1900').qualifier, 'before');
  assert.equal(parseHistoricalDate('>1800').qualifier, 'after');
});

test('ranges produce lower and upper sort bounds', () => {
  const r = parseHistoricalDate('between 1850 and 1855');
  assert.equal(r.qualifier, 'between');
  assert.equal(r.sortKey, '1850-01-01');
  assert.equal(r.endSortKey, '1855-12-31');
  assert.equal(r.display, 'entre 1850 y 1855');
  const es = parseHistoricalDate('entre 1850 y 1855');
  assert.equal(es.qualifier, 'between');
  assert.equal(parseHistoricalDate('1850/1855').qualifier, 'between');
});

test('empty and unparseable input degrade to a null sort key', () => {
  const empty = parseHistoricalDate('');
  assert.equal(empty.sortKey, null);
  assert.equal(empty.display, '');
  const junk = parseHistoricalDate('en tiempos de Maricastaña');
  assert.equal(junk.sortKey, null);
  assert.equal(junk.qualifier, 'unknown');
  assert.equal(junk.display, 'en tiempos de Maricastaña'); // preserved for the user
});

test('invalid month/day are rejected rather than stored wrong', () => {
  assert.equal(parseHistoricalDate('1850-13').sortKey, null);
  assert.equal(parseHistoricalDate('1850-02-40').sortKey, null);
});
