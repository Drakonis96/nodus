import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-tree-families-'));
const bundle = path.join(outDir, 'treeFamilies.cjs');
execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [
  path.join(root, 'shared/treeFamilies.ts'), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`,
], { cwd: root, stdio: 'inherit' });
const { buildTreeFamilies, treeDescendantLineIds, treeFamilyConnectorRole, treeFamilyLaneY } = require(bundle);
test.after(() => rm(outDir, { recursive: true, force: true }));

const nodes = [
  { personId: 'pgf', generation: -2, x: 0, y: 0 },
  { personId: 'pgm', generation: -2, x: 180, y: 0 },
  { personId: 'mgf', generation: -2, x: 360, y: 0 },
  { personId: 'mgm', generation: -2, x: 540, y: 0 },
  { personId: 'father', generation: -1, x: 0, y: 220 },
  { personId: 'mother', generation: -1, x: 180, y: 220 },
  { personId: 'focus', generation: 0, x: 0, y: 440 },
  { personId: 'sister', generation: 0, x: 180, y: 440 },
].map((node) => ({ ...node, coupleSide: 'none' }));

const parentEdges = [
  { parent: 'pgf', child: 'father' }, { parent: 'pgm', child: 'father' },
  { parent: 'mgf', child: 'mother' }, { parent: 'mgm', child: 'mother' },
  { parent: 'father', child: 'focus' }, { parent: 'mother', child: 'focus' },
  { parent: 'father', child: 'sister' }, { parent: 'mother', child: 'sister' },
];

test('unrelated paternal and maternal grandparents become separate family units and lanes', () => {
  const families = buildTreeFamilies(parentEdges, nodes);
  assert.equal(families.length, 3);
  const paternal = families.find((family) => family.childIds.includes('father'));
  const maternal = families.find((family) => family.childIds.includes('mother'));
  assert.deepEqual(paternal.parentIds, ['pgf', 'pgm']);
  assert.deepEqual(maternal.parentIds, ['mgf', 'mgm']);
  assert.equal(paternal.laneCount, 2);
  assert.equal(maternal.laneCount, 2);
  assert.notEqual(paternal.laneIndex, maternal.laneIndex, 'unrelated families must never share a routing lane');
});

test('siblings with the same parents share one trunk and one sibling group', () => {
  const family = buildTreeFamilies(parentEdges, nodes).find((candidate) => candidate.childIds.includes('focus'));
  assert.deepEqual(family.parentIds, ['father', 'mother']);
  assert.deepEqual(family.childIds, ['focus', 'sister']);
});

test('shared trunks distinguish a parental merge from the focus descendant line', () => {
  const families = buildTreeFamilies(parentEdges, nodes);
  const focusFamily = families.find((candidate) => candidate.childIds.includes('focus'));
  const branchByPerson = { father: 'paternal', mother: 'maternal', focus: 'neutral', sister: 'neutral' };
  assert.equal(treeFamilyConnectorRole(focusFamily, treeDescendantLineIds('focus', parentEdges), branchByPerson), 'parental_merge');

  const descendants = {
    parentIds: ['focus', 'partner'], parentGeneration: 0, childGeneration: 1,
  };
  const descendantEdges = [
    { parent: 'focus', child: 'child' },
    { parent: 'partner', child: 'child' },
    { parent: 'child', child: 'grandchild' },
  ];
  const focusLine = treeDescendantLineIds('focus', descendantEdges);
  assert.deepEqual([...focusLine], ['focus', 'child', 'grandchild']);
  assert.equal(
    treeFamilyConnectorRole(descendants, focusLine, { focus: 'neutral', partner: 'neutral' }),
    'focus_descendants',
    'the focus descendant line takes the genealogy gold role even with a co-parent'
  );
  assert.equal(
    treeFamilyConnectorRole(
      { parentIds: ['child', 'child_partner'], parentGeneration: 1, childGeneration: 2 },
      focusLine,
      { child: 'neutral', child_partner: 'neutral' }
    ),
    'focus_descendants',
    'the gold line continues through grandchildren and later generations'
  );
  assert.equal(
    treeFamilyConnectorRole(descendants, treeDescendantLineIds('partner', descendantEdges), { focus: 'neutral', partner: 'neutral' }),
    'focus_descendants',
    're-focusing the co-parent recalculates the same descendant family as gold'
  );
});

test('family lanes stay below labels and above the next generation in both orientations', () => {
  const normalFamily = buildTreeFamilies(parentEdges, nodes).find((candidate) => candidate.childIds.includes('focus'));
  const normalLane = treeFamilyLaneY(normalFamily, nodes, 176, 40);
  assert.ok(normalLane > 220 + 40 + 176, 'normal lane starts below the complete parent card');
  assert.ok(normalLane < 440 + 40, 'normal lane ends before the child frame');

  const invertedNodes = nodes.map((node) => ({ ...node, y: 440 - node.y }));
  const invertedFamily = buildTreeFamilies(parentEdges, invertedNodes).find((candidate) => candidate.childIds.includes('focus'));
  const invertedLane = treeFamilyLaneY(invertedFamily, invertedNodes, 176, 40);
  assert.ok(invertedLane > 0 + 40 + 176, 'inverted lane starts below the upper child card');
  assert.ok(invertedLane < 220 + 40, 'inverted lane ends before the lower parent frame');
});
