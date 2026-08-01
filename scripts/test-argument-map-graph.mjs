// Argument map — the structural (automatic) map of a HUB idea.
//
// Reported against a real corpus: a route advertising «119 conexiones · 14
// debates» opened into 7 blocks — the seed and six leaves — headed «79
// connection(s) · 9 debate(s)». Three separate faults produced that:
//
//   1. the local walk expanded neighbours in row order and only then cut to the
//      idea budget, so a capped subgraph kept an arbitrary slice and lost 5 of
//      the 14 debates the route had promised;
//   2. it kept only the edges the walk itself crossed. For a hub the walk stops
//      after one level, so not one neighbour↔neighbour edge survived and every
//      branch was necessarily a leaf, whatever the depth limit said;
//   3. the header counts were read off that capped subgraph, so the map
//      contradicted the list it had just been opened from.
//
// The fixture reproduces that shape — one hub wired to more neighbours than the
// budget, those neighbours wired onwards — and runs the REAL
// buildStructuralArgumentMap over a real SQLite database. Runs under
// Electron-as-Node so better-sqlite3 matches the app ABI.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-argmap-graph-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-argument-map-graph.mjs'), '--electron-argmap-graph-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const HUB = 'g-hub';
/** Relation mix of the reported route, neighbour for neighbour. */
const HUB_LINKS = [
  ...Array.from({ length: 13 }, (_, i) => ({ type: 'contradicts', confidence: 0.8 - i * 0.01 })),
  { type: 'refutes', confidence: 0.72 },
  ...Array.from({ length: 46 }, (_, i) => ({ type: 'supports', confidence: 0.85 - i * 0.005 })),
  ...Array.from({ length: 45 }, (_, i) => ({ type: 'refines', confidence: 0.9 - i * 0.005 })),
  ...Array.from({ length: 9 }, (_, i) => ({ type: 'applies_to', confidence: 0.6 - i * 0.01 })),
  { type: 'variant_of', confidence: 0.55 },
  { type: 'variant_of', confidence: 0.54 },
  { type: 'extends', confidence: 0.5 },
  { type: 'extends', confidence: 0.49 },
  { type: 'precondition_of', confidence: 0.45 },
];
const HUB_DEGREE = HUB_LINKS.length; // 119, as reported
const HUB_DEBATES = HUB_LINKS.filter((l) => l.type === 'contradicts' || l.type === 'refutes').length; // 14
/** Neighbours of neighbours, so the subgraph has somewhere to ramify to. */
const OUTER_PER_NEIGHBOUR = 4;

const SCHEMA = `
  CREATE TABLE ideas (global_id TEXT PRIMARY KEY, type TEXT, label TEXT, statement TEXT, created_at TEXT);
  CREATE TABLE edges (id TEXT PRIMARY KEY, from_id TEXT, to_id TEXT, type TEXT, basis TEXT, confidence REAL);
  CREATE TABLE edge_feedback (from_id TEXT, to_id TEXT, type TEXT, verdict TEXT);
  CREATE VIEW visible_edges AS
    SELECT e.* FROM edges e
    WHERE NOT EXISTS (
      SELECT 1 FROM edge_feedback f
      WHERE f.verdict = 'rejected' AND f.type = e.type
        AND ((f.from_id = e.from_id AND f.to_id = e.to_id)
          OR (f.from_id = e.to_id AND f.to_id = e.from_id))
    );
`;

/** Bundle electron/ai/argumentMap.ts with its Electron-only imports stubbed. */
async function loadArgumentMap(outDir) {
  const bundle = path.join(outDir, 'argumentMap.cjs');
  const stubs = {
    '../db/database': 'module.exports = { getDb: () => globalThis.__nodusTestDb };',
    "../db/settingsRepo": "module.exports = { getSettings: () => ({ uiLanguage: 'es' }) };",
    '../db/ideasRepo': `module.exports = { getIdeaSummary: (id) => globalThis.__nodusTestDb
      .prepare('SELECT global_id, type, label, statement, created_at FROM ideas WHERE global_id = ?').get(id) ?? null };`,
    './aiClient': `module.exports = { completeJson: () => { throw new Error('the automatic map must not call the model'); } };`,
  };
  await build({
    entryPoints: [path.join(repoRoot, 'electron/ai/argumentMap.ts')],
    bundle: true, platform: 'node', format: 'cjs', target: 'es2022', outfile: bundle,
    alias: { '@shared': path.join(repoRoot, 'shared') },
    plugins: [{
      name: 'stub-electron-deps',
      setup(build) {
        const names = Object.keys(stubs).map((s) => s.replace(/[./]/g, '\\$&')).join('|');
        build.onResolve({ filter: new RegExp(`^(${names})$`) }, (args) => ({ path: args.path, namespace: 'stub' }));
        build.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: stubs[args.path], loader: 'js' }));
      },
    }],
  });
  return require(bundle);
}

function walk(block, depth = 0, acc = []) {
  acc.push({ block, depth });
  for (const child of block.children) walk(child, depth + 1, acc);
  return acc;
}

const familyOf = (rel) =>
  rel === 'contradicts' || rel === 'refutes' ? 'debate'
  : rel === 'supports' || rel === 'extends' || rel === 'precondition_of' ? 'support'
  : 'other';

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-argmap-graph-'));
try {
  const Database = require('better-sqlite3');
  const db = new Database(path.join(root, 'fixture.sqlite'));
  db.exec(SCHEMA);
  const addIdea = db.prepare('INSERT INTO ideas VALUES (?,?,?,?,?)');
  const addEdge = db.prepare('INSERT INTO edges VALUES (?,?,?,?,?,?)');
  // Rows go in with the debates LAST, as in the corpus this was reported from.
  // Trimming in row order therefore drops precisely the links the route was
  // opened for — the failure mode is invisible if the fixture stores them first.
  const insertionOrder = HUB_LINKS
    .map((link, i) => ({ link, i }))
    .sort((a, b) => Number(familyOf(a.link.type) === 'debate') - Number(familyOf(b.link.type) === 'debate'));
  db.transaction(() => {
    addIdea.run(HUB, 'claim', 'idea central', 'La idea semilla del recorrido.', '2026-01-01');
    insertionOrder.forEach(({ link, i }) => {
      const id = `g-n${i}`;
      addIdea.run(id, 'claim', `vecina ${i}`, `Enunciado de la vecina ${i}.`, '2026-01-01');
      addEdge.run(`e-hub-${i}`, HUB, id, link.type, 'basis', link.confidence);
      for (let k = 0; k < OUTER_PER_NEIGHBOUR; k++) {
        const outer = `g-o${i}-${k}`;
        addIdea.run(outer, 'claim', `derivada ${i}.${k}`, `Enunciado derivado ${i}.${k}.`, '2026-01-01');
        addEdge.run(`e-out-${i}-${k}`, id, outer, k === 0 ? 'contradicts' : 'refines', 'basis', 0.7 - k * 0.05);
      }
      if (i > 0) addEdge.run(`e-sib-${i}`, `g-n${i - 1}`, id, 'supports', 'basis', 0.4);
    });
  })();

  globalThis.__nodusTestDb = db;
  const { buildStructuralArgumentMap, discoverArgumentRoutes } = await loadArgumentMap(root);

  const map = buildStructuralArgumentMap(HUB);
  const nodes = walk(map.root);
  const branches = map.root.children;

  // ── The three reported faults ──────────────────────────────────────────────

  const route = discoverArgumentRoutes().find((r) => r.ideaId === HUB);
  assert.equal(route.degree, HUB_DEGREE, 'the fixture reproduces the reported hub');
  assert.equal(route.debateCount, HUB_DEBATES);
  // The header used to quote the post-cap figures (79 / 9 for the real route),
  // so the map appeared to have lost connections the list had just promised.
  assert.equal(map.root.summary, `${HUB_DEGREE} conexiones · ${HUB_DEBATES} debate(s)`,
    'the map header reports the seed\'s real connectivity, matching the route list');
  assert.match(map.overview, new RegExp(`articula ${HUB_DEGREE} conexiones`), 'and so does the overview');
  assert.match(map.overview, new RegExp(`${HUB_DEBATES} son debates`));

  const maxDepth = Math.max(...nodes.map((n) => n.depth));
  assert.ok(maxDepth >= 2, `the map reaches depth ${maxDepth}; it used to stop at 1 for every hub`);
  const ramifying = branches.filter((c) => c.children.length > 0).length;
  assert.ok(ramifying >= branches.length - 1,
    `${ramifying} of ${branches.length} top branches ramify — a hub map is not a list of leaves`);

  // Depth-first, the branch walked first consumed the whole block budget and its
  // siblings came out bare. Level-order growth keeps them comparable.
  const sizes = branches.map((c) => walk(c).length);
  assert.ok(sizes.length > 1);
  assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 2,
    `branch sizes ${JSON.stringify(sizes)} must not be lopsided`);

  // The strongest debate, support and refinement of the hub are what a reader
  // opens the route for; row-order trimming dropped whichever the rows happened
  // to store late — here, every debate.
  const drawn = new Set(branches.map((c) => c.label));
  assert.ok(drawn.has('vecina 0'), 'the strongest contradiction is drawn');
  assert.ok(drawn.has('vecina 14'), 'the strongest support is drawn');
  assert.ok(drawn.has('vecina 60'), 'the strongest refinement is drawn');
  assert.deepEqual(
    branches.filter((c) => familyOf(c.relation) === 'debate').map((c) => c.label),
    ['vecina 0', 'vecina 1', 'vecina 2', 'vecina 3'],
    'and the debate branches are the strongest debates, in order — not an arbitrary slice',
  );

  // Debates carry a +1.5 ranking bonus, so ranking alone handed every slot to
  // them: a hub with 46 supports rendered as pure contradiction.
  assert.deepEqual([...new Set(branches.map((c) => familyOf(c.relation)))].sort(),
    ['debate', 'other', 'support'], 'the seed shows every side of the argument');

  // ── Invariants the fix must not break ──────────────────────────────────────

  const ids = nodes.map((n) => n.block.ideaId);
  assert.equal(new Set(ids).size, ids.length, 'the map stays a tree: no idea is drawn twice');
  assert.equal(map.ideaCount, ids.length, 'and ideaCount counts what is actually drawn');

  assert.ok(nodes.length <= 160, `the map stays paintable: ${nodes.length} blocks`);
  assert.ok(maxDepth <= 3, 'and no deeper than the walk allows');

  assert.equal(map.root.hiddenChildren, HUB_DEGREE - branches.length,
    'the seed says how many connections it left undrawn');
  for (const { block } of nodes) {
    if (block.hiddenChildren === undefined) continue;
    assert.ok(Number.isInteger(block.hiddenChildren) && block.hiddenChildren > 0,
      'undrawn counts are positive integers or absent');
  }

  console.log(
    `[argmap] hub ${HUB_DEGREE} conns / ${HUB_DEBATES} debates → ${nodes.length} blocks, ` +
    `${branches.length} branches (${branches.map((c) => familyOf(c.relation)).join(',')}), depth ${maxDepth}`
  );

  // A lone idea still yields a readable single-block map.
  const lone = new Database(path.join(root, 'lone.sqlite'));
  lone.exec(`${SCHEMA}\nINSERT INTO ideas VALUES ('g-lone','claim','sola','Sin conexiones.','2026-01-01');`);
  globalThis.__nodusTestDb = lone;
  const solo = buildStructuralArgumentMap('g-lone');
  assert.equal(solo.root.children.length, 0);
  assert.equal(solo.ideaCount, 1);
  assert.equal(solo.root.hiddenChildren, undefined, 'nothing was left out, so nothing is claimed');
  assert.match(solo.overview, /no tiene conexiones directas/);
  assert.throws(() => buildStructuralArgumentMap('g-nope'), /no existe en el grafo/,
    'an unknown seed is rejected rather than mapped');
  lone.close();
  db.close();

  console.log('[argmap] structural hub map OK');
} finally {
  await rm(root, { recursive: true, force: true });
}
