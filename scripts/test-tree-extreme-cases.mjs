// Extreme-genealogy regression tests: impossible parent cycles, consanguineous
// unions (pedigree collapse via two branches), and half-sibling families must
// never hang the layout or the kinship derivation, and must keep one node per
// person. Born from the genealogy-vault audit (2026-07).
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
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-tree-extreme-'));

function bundle(entry, name) {
  const outfile = path.join(outDir, name);
  execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [
    path.join(root, entry), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${outfile}`,
  ], { cwd: root, stdio: 'inherit' });
  return require(outfile);
}

const { computeTreeLayout } = bundle('shared/treeLayout.ts', 'treeLayout.cjs');
const { deriveTreeKinship, treeKinshipLabel } = bundle('shared/treeKinship.ts', 'treeKinship.cjs');

test.after(() => rm(outDir, { recursive: true, force: true }));

// A → B → C → A parent cycle (impossible data a bad import could produce),
// wired into a normal family below C.
const cycleEdges = [
  { parent: 'cy1', child: 'cy2' },
  { parent: 'cy2', child: 'cy3' },
  { parent: 'cy3', child: 'cy1' },
  { parent: 'cy3', child: 'root' },
  { parent: 'root', child: 'kid' },
];

test('layout: an impossible parent cycle terminates with one node per person', () => {
  const r = computeTreeLayout({ focusId: 'kid', parentEdges: cycleEdges, spouseEdges: [] });
  const ids = r.nodes.map((n) => n.personId);
  assert.equal(ids.length, new Set(ids).size, 'no person is laid out twice');
  assert.deepEqual(new Set(ids), new Set(['cy1', 'cy2', 'cy3', 'root', 'kid']));
});

test('kinship: an impossible parent cycle terminates and labels every member', () => {
  const kin = deriveTreeKinship({ focusId: 'kid', parentEdges: cycleEdges, spouseEdges: [] });
  for (const id of ['cy1', 'cy2', 'cy3', 'root']) {
    const context = kin.get(id);
    assert.ok(context, `${id} got a kinship context`);
    assert.ok(treeKinshipLabel(context, 'es').length > 0);
  }
  assert.equal(kin.get('root')?.role, 'parent', 'the direct parent is still resolved by shortest path');
});

// First cousins marry: their child reaches the shared grandparents through both
// branches (pedigree collapse) and must still see them exactly once.
const consanguine = {
  persons: [
    { id: 'gf', sex: 'male' }, { id: 'gm', sex: 'female' },
    { id: 'p1', sex: 'male' }, { id: 'p2', sex: 'female' },
    { id: 's1', sex: 'female' }, { id: 's2', sex: 'male' },
    { id: 'x', sex: 'male' }, { id: 'y', sex: 'female' }, { id: 'z', sex: 'female' },
  ],
  parentEdges: [
    { parent: 'gf', child: 'p1' }, { parent: 'gm', child: 'p1' },
    { parent: 'gf', child: 'p2' }, { parent: 'gm', child: 'p2' },
    { parent: 'p1', child: 'x' }, { parent: 's1', child: 'x' },
    { parent: 'p2', child: 'y' }, { parent: 's2', child: 'y' },
    { parent: 'x', child: 'z' }, { parent: 'y', child: 'z' },
  ],
  spouseEdges: [
    { a: 'gf', b: 'gm' }, { a: 'p1', b: 's1' }, { a: 'p2', b: 's2' }, { a: 'x', b: 'y' },
  ],
};

test('layout: consanguineous union keeps one node per shared ancestor', () => {
  const r = computeTreeLayout({ focusId: 'z', ...consanguine });
  const ids = r.nodes.map((n) => n.personId);
  assert.equal(ids.length, new Set(ids).size);
  assert.equal(ids.filter((id) => id === 'gf').length, 1, 'the doubly-reachable grandfather appears once');
  const byId = Object.fromEntries(r.nodes.map((n) => [n.personId, n]));
  assert.equal(byId.gf.generation, -3, 'shared ancestor sits at the nearest-path generation');
  assert.equal(byId.x.generation, -1);
  assert.equal(byId.y.generation, -1);
});

test('kinship: the consanguine child sees great-grandparents, cousins-married parents stay parents', () => {
  const kin = deriveTreeKinship({ focusId: 'z', ...consanguine });
  assert.equal(kin.get('x')?.role, 'father');
  assert.equal(kin.get('y')?.role, 'mother');
  assert.equal(kin.get('gf')?.role, 'great_grandfather');
  // From either parent's perspective the other is a first cousin AND a spouse;
  // spouse must win for the focus's own partner.
  const kinFromX = deriveTreeKinship({ focusId: 'x', ...consanguine });
  assert.equal(kinFromX.get('y')?.role, 'wife', 'the married cousin is labelled as spouse for the focus');
});

test('kinship: half siblings resolve as siblings through the one shared parent', () => {
  const kin = deriveTreeKinship({
    focusId: 'a',
    persons: [{ id: 'a', sex: 'male' }, { id: 'b', sex: 'male' }, { id: 'father', sex: 'male' }, { id: 'w1', sex: 'female' }, { id: 'w2', sex: 'female' }],
    parentEdges: [
      { parent: 'father', child: 'a' }, { parent: 'w1', child: 'a' },
      { parent: 'father', child: 'b' }, { parent: 'w2', child: 'b' },
    ],
    spouseEdges: [{ a: 'father', b: 'w1' }, { a: 'father', b: 'w2' }],
  });
  assert.equal(kin.get('b')?.role, 'brother');
  assert.equal(kin.get('w2')?.role, 'stepmother', "the father's other wife is the focus's stepmother");
});

test('layout: 6-generation dense tree stays under a second', () => {
  const parentEdges = [];
  const spouseEdges = [];
  const persons = [];
  let counter = 0;
  let generation = [{ id: 'g0', sex: 'male' }];
  persons.push(generation[0]);
  for (let g = 0; g < 6; g++) {
    const next = [];
    for (const parent of generation) {
      const spouse = { id: `s${++counter}`, sex: g % 2 ? 'male' : 'female' };
      persons.push(spouse);
      spouseEdges.push({ a: parent.id, b: spouse.id });
      for (let c = 0; c < (g < 2 ? 3 : 2); c++) {
        const kid = { id: `k${++counter}`, sex: c % 2 ? 'female' : 'male' };
        persons.push(kid);
        parentEdges.push({ parent: parent.id, child: kid.id });
        parentEdges.push({ parent: spouse.id, child: kid.id });
        next.push(kid);
      }
    }
    generation = next.slice(0, 24);
  }
  const started = Date.now();
  const r = computeTreeLayout({ focusId: 'g0', persons, parentEdges, spouseEdges });
  const elapsed = Date.now() - started;
  assert.ok(r.nodes.length > 200, `dense tree laid out ${r.nodes.length} nodes`);
  assert.ok(elapsed < 1000, `layout finished in ${elapsed}ms`);
});
