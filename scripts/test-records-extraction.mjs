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

const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-records-'));
const bundle = path.join(outDir, 'recordsExtraction.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'shared/recordsExtraction.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=es2022',
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);
const ex = require(bundle);

test.after(() => rm(outDir, { recursive: true, force: true }));

test('isRecordsChunkResult accepts partial/empty shapes, rejects non-arrays', () => {
  assert.equal(ex.isRecordsChunkResult({}), true);
  assert.equal(ex.isRecordsChunkResult({ persons: [] }), true);
  assert.equal(ex.isRecordsChunkResult({ persons: [{ name: 'X' }], events: [] }), true);
  assert.equal(ex.isRecordsChunkResult({ persons: 'nope' }), false);
  assert.equal(ex.isRecordsChunkResult(null), false);
  assert.equal(ex.isRecordsChunkResult('x'), false);
});

test('normalizeNameKey folds case, accents and punctuation', () => {
  assert.equal(ex.normalizeNameKey('Juan Pérez'), ex.normalizeNameKey('juan perez'));
  assert.equal(ex.normalizeNameKey('  José  María '), 'jose maria');
  assert.equal(ex.normalizeNameKey('Núñez, A.'), 'nunez a');
});

test('normalizers map to enums with safe fallbacks', () => {
  assert.equal(ex.normalizeSex('varón'), 'male');
  assert.equal(ex.normalizeSex('F'), 'female');
  assert.equal(ex.normalizeSex('???'), 'unknown');
  assert.equal(ex.normalizeEventType('marriage'), 'marriage');
  assert.equal(ex.normalizeEventType('boda'), 'other');
  assert.equal(ex.normalizeRole('spouse'), 'spouse');
  assert.equal(ex.normalizeRole('nonsense'), 'principal');
});

test('mergeRecordsResults de-dupes persons across chunks and coalesces fields', () => {
  const merged = ex.mergeRecordsResults([
    { persons: [{ name: 'Juan Pérez', sex: 'male', quote: 'q1', location: 'p. 1' }] },
    { persons: [{ name: 'juan perez', birth: 'c. 1850', quote: 'q2', location: 'p. 9' }] },
  ]);
  assert.equal(merged.persons.length, 1, 'same person collapses to one record');
  const juan = merged.persons[0];
  assert.equal(juan.sex, 'male');
  assert.equal(juan.birth, 'c. 1850', 'birth date coalesced from the second mention');
  assert.equal(juan.evidence.length, 2, 'evidence accumulates across chunks');
});

test('mergeRecordsResults registers event participants as persons and dedupes places', () => {
  const merged = ex.mergeRecordsResults([
    {
      places: [{ name: 'Sevilla', kind: 'municipality' }],
      events: [
        {
          type: 'marriage',
          date: '1875',
          place: 'sevilla',
          participants: [
            { name: 'Juan Pérez', role: 'principal' },
            { name: 'María Ruiz', role: 'spouse' },
          ],
          quote: 'casáronse',
          location: 'p. 3',
        },
      ],
    },
  ]);
  assert.equal(merged.places.length, 1, 'place mentioned twice (list + event) stays single');
  assert.equal(merged.persons.length, 2, 'both spouses become persons even if only in the event');
  assert.equal(merged.events.length, 1);
  assert.equal(merged.events[0].type, 'marriage');
  assert.equal(merged.events[0].participants.length, 2);
  assert.equal(merged.events[0].evidence.location, 'p. 3');
});

test('empty quotes/locations produce no evidence', () => {
  const merged = ex.mergeRecordsResults([{ persons: [{ name: 'Anónimo' }] }]);
  assert.equal(merged.persons[0].evidence.length, 0);
});
