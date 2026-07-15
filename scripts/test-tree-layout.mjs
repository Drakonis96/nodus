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

const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-tree-'));
const bundle = path.join(outDir, 'treeLayout.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'shared/treeLayout.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=es2022',
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);
const { computeTreeLayout } = require(bundle);

test.after(() => rm(outDir, { recursive: true, force: true }));

const byId = (r) => Object.fromEntries(r.nodes.map((n) => [n.personId, n]));

test('generations: focus 0, ancestors negative, descendants positive', () => {
  const r = computeTreeLayout({
    focusId: 'focus',
    persons: [
      { id: 'focus', sex: 'male' },
      { id: 'spouse', sex: 'female' },
    ],
    parentEdges: [
      { parent: 'gp1', child: 'parent' },
      { parent: 'gp2', child: 'parent' },
      { parent: 'parent', child: 'focus' },
      { parent: 'focus', child: 'child' },
      { parent: 'spouse', child: 'child' },
    ],
    spouseEdges: [
      { a: 'gp1', b: 'gp2' },
      { a: 'focus', b: 'spouse' },
    ],
  });
  const g = byId(r);
  assert.equal(g.focus.generation, 0);
  assert.equal(g.spouse.generation, 0);
  assert.equal(g.parent.generation, -1);
  assert.equal(g.gp1.generation, -2);
  assert.equal(g.child.generation, 1);
});

test('no generation limit: a deep ancestor chain is fully laid out', () => {
  // Six generations up + six down from the focus; nothing may be pruned by default.
  const parentEdges = [];
  for (let i = 1; i <= 6; i++) parentEdges.push({ parent: `a${i}`, child: i === 1 ? 'focus' : `a${i - 1}` });
  for (let i = 1; i <= 6; i++) parentEdges.push({ parent: i === 1 ? 'focus' : `d${i - 1}`, child: `d${i}` });
  const r = computeTreeLayout({ focusId: 'focus', parentEdges, spouseEdges: [] });
  const g = byId(r);
  assert.equal(g.a6.generation, -6, 'sixth-generation ancestor is present, unpruned');
  assert.equal(g.d6.generation, 6, 'sixth-generation descendant is present, unpruned');
});

test('hetero couple: adjacent, man on the left, coupleSide assigned', () => {
  const r = computeTreeLayout({
    focusId: 'h',
    persons: [
      { id: 'h', sex: 'male' },
      { id: 'w', sex: 'female' },
    ],
    parentEdges: [],
    spouseEdges: [{ a: 'h', b: 'w' }],
  });
  const g = byId(r);
  assert.ok(g.h.x < g.w.x, 'man is left of woman');
  assert.equal(Math.abs(g.h.x - g.w.x), 160 + 28, 'spouses are adjacent (one column apart)');
  assert.equal(g.h.coupleSide, 'left');
  assert.equal(g.w.coupleSide, 'right');
});

test('same-sex couple orders by birth year, sides derive from position', () => {
  const r = computeTreeLayout({
    focusId: 'a',
    persons: [
      { id: 'a', sex: 'male', birthYear: 1850 },
      { id: 'b', sex: 'male', birthYear: 1848 },
    ],
    parentEdges: [],
    spouseEdges: [{ a: 'a', b: 'b' }],
  });
  const g = byId(r);
  assert.ok(g.b.x < g.a.x, 'earlier-born spouse placed left');
  assert.equal(g.b.coupleSide, 'left');
  assert.equal(g.a.coupleSide, 'right');
});

test('unmarried co-parents (no spouse edge) are grouped adjacent', () => {
  const r = computeTreeLayout({
    focusId: 'kid',
    persons: [
      { id: 'dad', sex: 'male' },
      { id: 'mom', sex: 'female' },
      { id: 'kid', sex: 'female' },
    ],
    parentEdges: [
      { parent: 'dad', child: 'kid' },
      { parent: 'mom', child: 'kid' },
    ],
    spouseEdges: [], // never married
  });
  const g = byId(r);
  assert.equal(Math.abs(g.dad.x - g.mom.x), 160 + 28, 'co-parents sit adjacent');
  assert.ok(g.dad.x < g.mom.x, 'father left, mother right');
  assert.notEqual(g.dad.coupleSide, 'none');
});

test('remarriage: a twice-married person appears once with both spouses present', () => {
  // First wife (deceased) and second wife, children in both marriages.
  const r = computeTreeLayout({
    focusId: 'man',
    persons: [
      { id: 'man', sex: 'male' },
      { id: 'w1', sex: 'female' },
      { id: 'w2', sex: 'female' },
    ],
    parentEdges: [
      { parent: 'man', child: 'c1' },
      { parent: 'w1', child: 'c1' },
      { parent: 'man', child: 'c2' },
      { parent: 'w2', child: 'c2' },
    ],
    spouseEdges: [
      { a: 'man', b: 'w1' },
      { a: 'man', b: 'w2' },
    ],
  });
  const g = byId(r);
  assert.equal(r.nodes.filter((n) => n.personId === 'man').length, 1, 'the man appears exactly once');
  assert.ok(g.w1 && g.w2, 'both spouses are placed');
  assert.equal(g.w1.generation, 0);
  assert.equal(g.w2.generation, 0);
  // Both children present in the next generation.
  assert.equal(g.c1.generation, 1);
  assert.equal(g.c2.generation, 1);
});

test('pedigree collapse: a person reachable by two paths gets one node', () => {
  const r = computeTreeLayout({
    focusId: 'focus',
    parentEdges: [
      { parent: 'A', child: 'B' },
      { parent: 'A', child: 'C' },
      { parent: 'B', child: 'focus' },
      { parent: 'C', child: 'spouse' },
      { parent: 'focus', child: 'kid' },
      { parent: 'spouse', child: 'kid' },
    ],
    spouseEdges: [{ a: 'focus', b: 'spouse' }],
  });
  assert.equal(r.nodes.filter((n) => n.personId === 'A').length, 1);
});

test('depth limits prune far generations; empty focus is empty', () => {
  const r = computeTreeLayout({
    focusId: 'focus',
    parentEdges: [
      { parent: 'gp', child: 'parent' },
      { parent: 'parent', child: 'focus' },
      { parent: 'focus', child: 'child' },
    ],
    spouseEdges: [],
    ancestorDepth: 1,
    descendantDepth: 1,
  });
  const ids = new Set(r.nodes.map((n) => n.personId));
  assert.ok(ids.has('parent') && !ids.has('gp'));
  assert.ok(ids.has('child'));
  assert.deepEqual(computeTreeLayout({ focusId: '', parentEdges: [], spouseEdges: [] }).nodes, []);
});

test('ancestors are above by default and the optional inverted view mirrors vertical order', () => {
  const input = {
    focusId: 'child',
    parentEdges: [{ parent: 'parent', child: 'child' }],
    spouseEdges: [],
  };
  const normal = byId(computeTreeLayout(input));
  const inverted = byId(computeTreeLayout({ ...input, orientation: 'ancestors_bottom' }));
  assert.ok(normal.parent.y < normal.child.y, 'default puts the parent above the child');
  assert.ok(inverted.parent.y > inverted.child.y, 'inverted view puts the parent below the child');
});

test('explicit siblings stay in the same generation and receive a sibling connector', () => {
  const r = computeTreeLayout({
    focusId: 'a',
    parentEdges: [],
    spouseEdges: [],
    siblingEdges: [{ a: 'a', b: 'b' }],
  });
  const nodes = byId(r);
  assert.equal(nodes.a.generation, nodes.b.generation);
  assert.equal(nodes.a.y, nodes.b.y);
  assert.deepEqual(r.edges.filter((edge) => edge.kind === 'sibling'), [{ from: 'a', to: 'b', kind: 'sibling' }]);
});

test('paternal and maternal extended families remain in separate horizontal blocks', () => {
  const r = computeTreeLayout({
    focusId: 'focus',
    persons: [
      { id: 'focus', sex: 'male' }, { id: 'father', sex: 'male' }, { id: 'mother', sex: 'female' },
      { id: 'paternal-uncle', sex: 'male' }, { id: 'paternal-aunt', sex: 'female' },
      { id: 'maternal-uncle', sex: 'male' }, { id: 'maternal-aunt', sex: 'female' },
    ],
    parentEdges: [
      { parent: 'father', child: 'focus' }, { parent: 'mother', child: 'focus' },
    ],
    spouseEdges: [],
    siblingEdges: [
      { a: 'father', b: 'paternal-uncle' }, { a: 'father', b: 'paternal-aunt' },
      { a: 'mother', b: 'maternal-uncle' }, { a: 'mother', b: 'maternal-aunt' },
    ],
    branchByPerson: {
      father: 'paternal', 'paternal-uncle': 'paternal', 'paternal-aunt': 'paternal',
      mother: 'maternal', 'maternal-uncle': 'maternal', 'maternal-aunt': 'maternal',
      focus: 'neutral',
    },
  });
  const nodes = byId(r);
  const paternalMax = Math.max(nodes['paternal-uncle'].x, nodes['paternal-aunt'].x);
  const maternalMin = Math.min(nodes['maternal-uncle'].x, nodes['maternal-aunt'].x);
  assert.ok(paternalMax < nodes.father.x, 'paternal siblings stay outside and left of the father');
  assert.ok(nodes.father.x < nodes.mother.x, 'the parental couple preserves its centre seam');
  assert.ok(nodes.mother.x < maternalMin, 'maternal siblings stay outside and right of the mother');
});
