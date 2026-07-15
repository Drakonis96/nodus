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
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-kinship-'));
const bundle = path.join(outDir, 'kinshipRelations.cjs');
execFileSync(path.join(repoRoot, 'node_modules/.bin/esbuild'), [
  path.join(repoRoot, 'shared/kinshipRelations.ts'), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`,
], { cwd: repoRoot, stdio: 'inherit' });
const { kinshipRelationshipSpecs, parentAgeWarning } = require(bundle);

test.after(() => rm(outDir, { recursive: true, force: true }));

test('child-of stores both known parents in canonical parent-to-child direction', () => {
  assert.deepEqual(kinshipRelationshipSpecs('child', 'child_of', 'mother', 'father'), [
    { fromPerson: 'mother', toPerson: 'child', type: 'parent', subtype: null },
    { fromPerson: 'father', toPerson: 'child', type: 'parent', subtype: null },
  ]);
});

test('child-of accepts one known parent and deduplicates repeated selections', () => {
  assert.equal(kinshipRelationshipSpecs('child', 'child_of', 'parent').length, 1);
  assert.equal(kinshipRelationshipSpecs('child', 'child_of', 'parent', 'parent').length, 1);
});

test('parent, sibling and spouse choices preserve their direction/symmetry types', () => {
  assert.deepEqual(kinshipRelationshipSpecs('person', 'parent_of', 'child', '', true), [
    { fromPerson: 'person', toPerson: 'child', type: 'parent', subtype: 'adoptive' },
  ]);
  assert.equal(kinshipRelationshipSpecs('person', 'sibling_of', 'other')[0].type, 'sibling');
  assert.equal(kinshipRelationshipSpecs('person', 'spouse_of', 'other')[0].type, 'spouse');
});

test('parent chronology flags inverted/implausible edges without guessing missing dates', () => {
  assert.equal(parentAgeWarning('1996', '1968'), 'parent_not_older');
  assert.equal(parentAgeWarning('1965', '1968'), 'parent_too_young');
  assert.equal(parentAgeWarning('1968', '2000'), null);
  assert.equal(parentAgeWarning(null, '2000'), null);
});
