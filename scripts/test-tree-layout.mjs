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

// Family: grandparents (gp1+gp2) → parent → focus; focus+spouse → child.
const parentEdges = [
  { parent: 'gp1', child: 'parent' },
  { parent: 'gp2', child: 'parent' },
  { parent: 'parent', child: 'focus' },
  { parent: 'focus', child: 'child' },
  { parent: 'spouse', child: 'child' },
];
const spouseEdges = [
  { a: 'gp1', b: 'gp2' },
  { a: 'focus', b: 'spouse' },
];

test('generations: focus 0, ancestors negative, descendants positive', () => {
  const { nodes } = computeTreeLayout({ focusId: 'focus', parentEdges, spouseEdges });
  const gen = Object.fromEntries(nodes.map((n) => [n.personId, n.generation]));
  assert.equal(gen.focus, 0);
  assert.equal(gen.spouse, 0, 'spouse sits in the focus generation');
  assert.equal(gen.parent, -1);
  assert.equal(gen.gp1, -2);
  assert.equal(gen.gp2, -2);
  assert.equal(gen.child, 1);
});

test('every included edge connects two placed nodes', () => {
  const { nodes, edges } = computeTreeLayout({ focusId: 'focus', parentEdges, spouseEdges });
  const ids = new Set(nodes.map((n) => n.personId));
  for (const e of edges) {
    assert.ok(ids.has(e.from) && ids.has(e.to), 'edge endpoints are present');
  }
  assert.ok(edges.some((e) => e.kind === 'spouse'), 'spouse edges included');
  assert.ok(edges.some((e) => e.kind === 'parent'), 'parent edges included');
});

test('pedigree collapse: a person reachable by two paths gets one node', () => {
  // Cousins marry: p shares ancestry through two lines but must appear once.
  const edges = [
    { parent: 'A', child: 'B' },
    { parent: 'A', child: 'C' },
    { parent: 'B', child: 'focus' },
    { parent: 'C', child: 'spouse' },
    { parent: 'focus', child: 'kid' },
    { parent: 'spouse', child: 'kid' },
  ];
  const { nodes } = computeTreeLayout({ focusId: 'focus', parentEdges: edges, spouseEdges: [{ a: 'focus', b: 'spouse' }] });
  const aNodes = nodes.filter((n) => n.personId === 'A');
  assert.equal(aNodes.length, 1, 'shared ancestor A appears exactly once');
});

test('depth limits prune far generations', () => {
  const { nodes } = computeTreeLayout({
    focusId: 'focus',
    parentEdges,
    spouseEdges,
    ancestorDepth: 1,
    descendantDepth: 1,
  });
  const ids = new Set(nodes.map((n) => n.personId));
  assert.ok(ids.has('parent'), 'one generation up kept');
  assert.ok(!ids.has('gp1'), 'grandparents pruned beyond ancestorDepth 1');
  assert.ok(ids.has('child'), 'one generation down kept');
});

test('empty focus yields an empty layout', () => {
  const r = computeTreeLayout({ focusId: '', parentEdges, spouseEdges });
  assert.deepEqual(r.nodes, []);
});
