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

const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-kininf-'));
const bundle = path.join(outDir, 'kinshipInference.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'shared/kinshipInference.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=es2022',
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);
const {
  deriveKinFromEvents,
  deriveKinFromClaims,
  normalizeClaimRelation,
  aggregateCandidates,
  strengthForScore,
  SURFACE_MIN_SCORE,
} = require(bundle);

test.after(() => rm(outDir, { recursive: true, force: true }));

test('baptism → parent edges to the baptised child (principal is the child)', () => {
  const cands = deriveKinFromEvents([
    {
      type: 'baptism',
      quote: 'bautizo de Ana, hija de Juan y María',
      location: 'p. 3',
      participants: [
        { personId: 'child', role: 'principal' },
        { personId: 'dad', role: 'father' },
        { personId: 'mom', role: 'mother' },
      ],
    },
  ]);
  const parents = cands.filter((c) => c.type === 'parent');
  assert.equal(parents.length, 2, 'father→child and mother→child');
  assert.ok(parents.every((c) => c.toPerson === 'child' && c.signal === 'record_role' && c.weight === 1));
  assert.ok(parents.some((c) => c.fromPerson === 'dad'));
  assert.ok(parents.some((c) => c.fromPerson === 'mom'));
  assert.ok(parents.every((c) => c.quote === 'bautizo de Ana, hija de Juan y María'));
});

test('marriage → a spouse edge between the two principals, no parent edges', () => {
  const cands = deriveKinFromEvents([
    {
      type: 'marriage',
      participants: [
        { personId: 'groom', role: 'principal' },
        { personId: 'bride', role: 'spouse' },
        { personId: 'groomdad', role: 'father' },
      ],
    },
  ]);
  const spouses = cands.filter((c) => c.type === 'spouse');
  const parents = cands.filter((c) => c.type === 'parent');
  assert.equal(spouses.length, 1, 'one spouse edge');
  assert.equal(spouses[0].weight, 1);
  // A father named in a marriage is NOT auto-linked as a parent of either spouse
  // (ambiguous which spouse), so no parent edge is fabricated.
  assert.equal(parents.length, 0, 'no fabricated parent edge from a marriage');
});

test('census father/mother/child → weaker parent edges (0.6)', () => {
  const cands = deriveKinFromEvents([
    {
      type: 'census',
      participants: [
        { personId: 'p_dad', role: 'father' },
        { personId: 'p_mom', role: 'mother' },
        { personId: 'p_kid', role: 'child' },
        { personId: 'p_head', role: 'principal' },
      ],
    },
  ]);
  const parents = cands.filter((c) => c.type === 'parent');
  // father→kid, mother→kid (principal is NOT treated as a child outside birth/baptism).
  assert.equal(parents.length, 2);
  assert.ok(parents.every((c) => c.toPerson === 'p_kid' && c.weight === 0.6));
});

test('explicit claims map subject/relation/object to directed edges', () => {
  const cands = deriveKinFromClaims([
    { subjectId: 'juan', objectId: 'ana', relation: 'padre', quote: 'mi padre Juan', location: null },
    { subjectId: 'ana', objectId: 'luis', relation: 'hija', quote: 'Ana, hija de Luis', location: null },
    { subjectId: 'juan', objectId: 'maria', relation: 'esposa', quote: 'su esposa María', location: null },
    { subjectId: 'x', objectId: 'y', relation: 'hermano', quote: 'su hermano', location: null },
  ]);
  // padre: juan→ana ; hija: luis→ana ; esposa: juan~maria ; hermano: dropped.
  const parent = cands.filter((c) => c.type === 'parent');
  const spouse = cands.filter((c) => c.type === 'spouse');
  assert.deepEqual(
    parent.map((c) => `${c.fromPerson}->${c.toPerson}`).sort(),
    ['juan->ana', 'luis->ana']
  );
  assert.equal(spouse.length, 1);
  assert.ok(cands.every((c) => c.signal === 'explicit_claim' && c.weight === 0.8));
  assert.equal(cands.length, 3, 'sibling claim produces no edge (never invents a shared parent)');
});

test('normalizeClaimRelation folds accents and languages', () => {
  assert.equal(normalizeClaimRelation('Padre'), 'parent');
  assert.equal(normalizeClaimRelation('mother'), 'parent');
  assert.equal(normalizeClaimRelation('hija'), 'child');
  assert.equal(normalizeClaimRelation('cónyuge'), 'spouse');
  assert.equal(normalizeClaimRelation('primo'), null);
});

test('spouse pairs are order-normalised so (A,B) and (B,A) collapse', () => {
  const cands = deriveKinFromClaims([
    { subjectId: 'b', objectId: 'a', relation: 'esposo', quote: 'q1', location: null },
    { subjectId: 'a', objectId: 'b', relation: 'esposa', quote: 'q2', location: null },
  ]);
  const agg = aggregateCandidates(cands);
  assert.equal(agg.length, 1, 'one spouse suggestion for the pair');
  assert.equal(agg[0].fromPerson, 'a');
  assert.equal(agg[0].toPerson, 'b');
});

test('accumulation: two corroborating sources raise strength above one', () => {
  const single = aggregateCandidates([
    { fromPerson: 'p', toPerson: 'c', type: 'parent', subtype: null, signal: 'record_role', weight: 0.6, quote: 'census 1875', location: null },
  ]);
  assert.equal(single[0].strength, strengthForScore(0.6));
  assert.ok(single[0].score < 1);

  const two = aggregateCandidates([
    { fromPerson: 'p', toPerson: 'c', type: 'parent', subtype: null, signal: 'record_role', weight: 0.6, quote: 'census 1875', location: null },
    { fromPerson: 'p', toPerson: 'c', type: 'parent', subtype: null, signal: 'explicit_claim', weight: 0.8, quote: 'diario: mi hijo', location: null },
  ]);
  assert.equal(two.length, 1);
  assert.ok(two[0].score >= 1 && two[0].strength === 'alta', 'corroboration lifts confidence');
  assert.equal(two[0].candidates.length, 2, 'both evidences retained');
});

test('duplicate evidence (same signal + quote) does not inflate the score', () => {
  const agg = aggregateCandidates([
    { fromPerson: 'p', toPerson: 'c', type: 'parent', subtype: null, signal: 'record_role', weight: 1, quote: 'same', location: null },
    { fromPerson: 'p', toPerson: 'c', type: 'parent', subtype: null, signal: 'record_role', weight: 1, quote: 'same', location: null },
  ]);
  assert.equal(agg[0].score, 1, 'identical evidence counted once');
  assert.equal(agg[0].candidates.length, 1);
});

test('SURFACE_MIN_SCORE holds back a single weak signal', () => {
  const weak = aggregateCandidates([
    { fromPerson: 'a', toPerson: 'b', type: 'spouse', subtype: null, signal: 'record_role', weight: 0.5, quote: 'residence', location: null },
  ]);
  assert.ok(weak[0].score < SURFACE_MIN_SCORE, 'a lone 0.5 signal stays below the surfacing threshold');
});
