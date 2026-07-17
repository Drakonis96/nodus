// Progressive graph loading regression: exercise the real overview/theme graph
// builders against a deterministic academic-scale fixture and guard the renderer
// contracts that keep the initial Sigma scene bounded. Runs under Electron-as-Node
// so better-sqlite3 uses the same ABI as the desktop app.
//
// The builders must stay linear in the corpus so they cannot starve the main
// process (the starvation that moved this work onto a worker thread in v1.3.0).
// That bound is asserted with the work counters in `meterDb`, never with elapsed
// ms — see the comment there for the measurements behind that choice.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-graph-progressive-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-graph-progressive.mjs'), '--electron-graph-progressive-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

// Ceiling on how many times a builder may touch each row it reads out of the
// database. Today the overview sits at ~2.7 and a theme scene at ~6.0, which leaves
// room for another linear pass or two; a pairwise scan over the corpus lands at
// ~6,400. See `meterDb` for why this is the bound under test rather than elapsed ms.
const MAX_FIELD_READS_PER_ROW = 12;

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-graph-progressive-'));
try {
  const Database = require('better-sqlite3');
  const db = new Database(path.join(root, 'graph.sqlite'));
  createSchema(db);
  seedAcademicFixture(db);
  const meter = meterDb(db);
  globalThis.__graphProgressiveTestDb = meter.db;

  const graphModule = await bundleGraphService();
  const graph = await import(pathToFileURL(graphModule).href);

  const overviewWork = meter.measure(() => graph.buildIdeaGraphOverview());
  const overview = overviewWork.result;
  const overviewBytes = Buffer.byteLength(JSON.stringify(overview));
  assert.equal(overview.nodes.length, 12, 'overview returns one compact node per graph theme');
  assert.ok(overview.nodes.every((node) => node.type === 'theme'), 'overview contains no idea nodes');
  assert.ok(overview.nodes.every((node) => node.statement == null), 'overview omits idea statements');
  assert.ok(overview.nodes.every((node) => node.workIds.length === 0), 'overview omits work-id payloads');
  assert.ok(overview.edges.length > 0, 'overview aggregates cross-theme relations');
  assert.ok(overviewBytes < 100_000, `overview payload remains compact (${overviewBytes} bytes)`);
  assert.equal(
    overviewWork.statements,
    4,
    'overview reads the corpus with four fixed queries (themes, explicit and inferred '
      + 'memberships, visible edges) rather than one per theme or per idea'
  );
  assert.ok(
    overviewWork.readsPerRow < MAX_FIELD_READS_PER_ROW,
    `overview work stays linear in the corpus (${overviewWork.readsPerRow.toFixed(1)} field `
      + `reads across ${overviewWork.rows} rows)`
  );
  assertGraphIntegrity(overview);

  const themeWork = meter.measure(() => graph.buildIdeaThemeGraph('Tema 0', 90));
  const theme = themeWork.result;
  const ideaNodes = theme.nodes.filter((node) => node.type !== 'theme');
  const activeNodes = ideaNodes.filter((node) => node.themes.includes('tema 0'));
  const bridgeNodes = ideaNodes.filter((node) => !node.themes.includes('tema 0'));
  const themeBytes = Buffer.byteLength(JSON.stringify(theme));
  assert.ok(activeNodes.length > 0 && activeNodes.length <= 90, 'theme core respects the requested cap');
  assert.ok(bridgeNodes.length <= 60, 'cross-theme context respects its bridge cap');
  assert.ok(ideaNodes.length <= 150, 'default theme scene never ships more than 150 ideas');
  assert.ok(themeBytes < 1_000_000, `theme payload remains bounded (${themeBytes} bytes)`);
  assert.equal(
    themeWork.statements,
    7,
    'theme scene reads the corpus with seven fixed queries (the overview four plus ideas, '
      + 'occurrences and edge feedback) rather than one per selected idea'
  );
  assert.ok(
    themeWork.readsPerRow < MAX_FIELD_READS_PER_ROW,
    `theme work stays linear in the corpus (${themeWork.readsPerRow.toFixed(1)} field `
      + `reads across ${themeWork.rows} rows)`
  );
  assertGraphIntegrity(theme);

  const clamped = graph.buildIdeaThemeGraph('Tema 0', 1);
  const clampedActive = clamped.nodes.filter(
    (node) => node.type !== 'theme' && node.themes.includes('tema 0')
  );
  assert.ok(clampedActive.length <= 20, 'theme endpoint enforces its lower cap');

  await assertRendererContracts();
  db.close();
  console.log(
    `progressive graph test passed (overview ${overviewBytes} B/${overviewWork.rows} rows/`
      + `${overviewWork.readsPerRow.toFixed(1)} reads per row; theme ${themeBytes} B/`
      + `${ideaNodes.length} ideas/${themeWork.readsPerRow.toFixed(1)} reads per row)`
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

function createSchema(db) {
  db.exec(`
    CREATE TABLE themes (
      theme_id TEXT PRIMARY KEY, label TEXT NOT NULL, created_at TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE works (
      nodus_id TEXT PRIMARY KEY, archived INTEGER NOT NULL, deep_status TEXT NOT NULL,
      year INTEGER, authors_json TEXT NOT NULL, read_tag INTEGER NOT NULL
    );
    CREATE TABLE work_themes (nodus_id TEXT NOT NULL, theme_id TEXT NOT NULL);
    CREATE TABLE ideas (
      global_id TEXT PRIMARY KEY, type TEXT NOT NULL, label TEXT NOT NULL,
      statement TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE idea_occurrences (
      global_id TEXT NOT NULL, nodus_id TEXT NOT NULL, confidence REAL, development TEXT NOT NULL
    );
    CREATE TABLE idea_theme_links (
      nodus_id TEXT NOT NULL, global_id TEXT NOT NULL, theme_id TEXT NOT NULL,
      confidence REAL NOT NULL, basis TEXT NOT NULL
    );
    CREATE TABLE edges (
      id TEXT PRIMARY KEY, from_id TEXT NOT NULL, to_id TEXT NOT NULL, type TEXT NOT NULL,
      basis TEXT NOT NULL, confidence REAL NOT NULL, source_work TEXT
    );
    CREATE TABLE edge_feedback (
      from_id TEXT NOT NULL, to_id TEXT NOT NULL, type TEXT NOT NULL, verdict TEXT NOT NULL
    );
    CREATE VIEW visible_edges AS SELECT * FROM edges;
  `);
}

function seedAcademicFixture(db) {
  const insertTheme = db.prepare('INSERT INTO themes VALUES (?, ?, ?, 1)');
  const insertWork = db.prepare("INSERT INTO works VALUES (?, 0, 'done', ?, ?, ?)");
  const insertWorkTheme = db.prepare('INSERT INTO work_themes VALUES (?, ?)');
  const insertIdea = db.prepare('INSERT INTO ideas VALUES (?, ?, ?, ?, ?)');
  const insertOccurrence = db.prepare('INSERT INTO idea_occurrences VALUES (?, ?, ?, ?)');
  const insertIdeaTheme = db.prepare("INSERT INTO idea_theme_links VALUES (?, ?, ?, 0.95, 'explicit')");
  const insertEdge = db.prepare("INSERT INTO edges VALUES (?, ?, ?, ?, 'inferred', ?, NULL)");
  const types = ['claim', 'finding', 'construct', 'method', 'framework'];
  const now = '2026-01-01T00:00:00.000Z';

  db.transaction(() => {
    for (let theme = 0; theme < 12; theme++) {
      const themeId = `t${theme}`;
      insertTheme.run(themeId, `tema ${theme}`, now);
      for (let index = 0; index < 200; index++) {
        const ideaId = `i${theme}-${String(index).padStart(3, '0')}`;
        const workId = `w${theme}-${String(index).padStart(3, '0')}`;
        insertWork.run(workId, 2000 + (index % 25), JSON.stringify([`Autor ${index % 40}`]), index % 2);
        insertWorkTheme.run(workId, themeId);
        insertIdea.run(
          ideaId,
          types[index % types.length],
          `Idea ${theme}.${index}`,
          `Planteamiento académico ${theme}.${index}`,
          now
        );
        insertOccurrence.run(ideaId, workId, 0.8 + (index % 10) / 100, 'Desarrollo de prueba');
        insertIdeaTheme.run(workId, ideaId, themeId);
        if (index > 0) {
          insertEdge.run(`within-${theme}-${index}`, `i${theme}-${String(index - 1).padStart(3, '0')}`, ideaId, 'supports', 0.8);
        }
        const nextTheme = (theme + 1) % 12;
        insertEdge.run(
          `cross-${theme}-${index}`,
          ideaId,
          `i${nextTheme}-${String(index).padStart(3, '0')}`,
          'extends',
          0.7
        );
      }
    }
  })();
}

/** Counts the work a graph builder does, in units that do not depend on the machine
 * running the test.
 *
 * This replaces a pair of `performance.now()` budgets (`< 1_500` ms each), which
 * could not do the job they were written for. Measured against this fixture on an
 * idle M-series laptop: the honest overview builder takes ~110 ms, and injecting the
 * exact regression the budget existed to catch — an O(N^2) pairwise scan over the
 * 7,200 rows, the shape that starved the main process before v1.3.0 — takes ~200 ms
 * and passed the 1,500 ms budget comfortably. On the maintainer's machine the honest
 * builder measured 1,013–2,345 ms across three idle runs, so it failed that same
 * budget about a third of the time on its own, and near-always under the parallel
 * load of `npm test` (~130 files at once, on a shared macos runner in CI). A 10x
 * machine spread and a 2x run-to-run spread cannot resolve a 1.8x regression: the
 * elapsed ms measured the runner, not the builder, at any threshold.
 *
 * Rows are handed out wrapped in counting proxies, so `readsPerRow` tracks how many
 * times a builder walks the corpus it loaded: ~2.7 for the overview and ~6.0 for a
 * theme scene, against ~6,400 for the pairwise scan above. Every counter here is
 * identical on every machine and on every run. The one blind spot: it sees reads of
 * rows the database handed out, so a builder that first copied rows into private
 * objects and then scanned those pairwise would not register.
 */
function meterDb(db) {
  let statements = 0;
  let rows = 0;
  let fieldReads = 0;

  const meterRow = (row) => new Proxy(row, {
    get(target, prop) {
      if (typeof prop === 'string') fieldReads++;
      return target[prop];
    },
  });
  const meterStatement = (statement) => new Proxy(statement, {
    get(target, prop) {
      const value = target[prop];
      if (typeof value !== 'function') return value;
      if (prop !== 'all' && prop !== 'get') return value.bind(target);
      return (...args) => {
        statements++;
        const result = value.apply(target, args);
        if (Array.isArray(result)) {
          rows += result.length;
          return result.map(meterRow);
        }
        if (result && typeof result === 'object') {
          rows++;
          return meterRow(result);
        }
        return result;
      };
    },
  });

  return {
    db: new Proxy(db, {
      get(target, prop) {
        if (prop === 'prepare') return (...args) => meterStatement(target.prepare(...args));
        const value = target[prop];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }),
    measure(run) {
      const before = { statements, rows, fieldReads };
      const result = run();
      const used = {
        result,
        statements: statements - before.statements,
        rows: rows - before.rows,
        fieldReads: fieldReads - before.fieldReads,
      };
      return { ...used, readsPerRow: used.rows ? used.fieldReads / used.rows : 0 };
    },
  };
}

function assertGraphIntegrity(graph) {
  const ids = new Set(graph.nodes.map((node) => node.id));
  assert.equal(ids.size, graph.nodes.length, 'graph nodes have unique ids');
  for (const edge of graph.edges) {
    assert.ok(ids.has(edge.source), `edge source exists: ${edge.source}`);
    assert.ok(ids.has(edge.target), `edge target exists: ${edge.target}`);
  }
}

async function bundleGraphService() {
  const databaseStub = path.join(root, 'database-stub.js');
  const ideasStub = path.join(root, 'ideas-stub.js');
  const computeStub = path.join(root, 'compute-stub.js');
  await writeFile(databaseStub, 'export function getDb() { return globalThis.__graphProgressiveTestDb; }\n');
  await writeFile(
    ideasStub,
    'export const getEdgeDetail=()=>null,getEdgeTrace=()=>null,getIdeaDetail=()=>null; export const currentEmbeddingConfig=()=>null;\n'
  );
  await writeFile(computeStub, 'export async function computeThemeMatches() { return []; }\n');
  const out = path.join(root, 'graphService.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'electron/graph/graphService.ts')],
    outfile: out,
    bundle: true,
    format: 'esm',
    platform: 'node',
    plugins: [{
      name: 'graph-progressive-stubs',
      setup(buildApi) {
        buildApi.onResolve({ filter: /database$/ }, () => ({ path: databaseStub }));
        buildApi.onResolve({ filter: /ideasRepo$/ }, () => ({ path: ideasStub }));
        buildApi.onResolve({ filter: /computeHost$/ }, () => ({ path: computeStub }));
      },
    }],
  });
  return out;
}

async function assertRendererContracts() {
  const graphView = await readFile(path.join(repoRoot, 'src/views/GraphView.tsx'), 'utf8');
  const sigmaGraph = await readFile(path.join(repoRoot, 'src/views/graph/SigmaGraph.tsx'), 'utf8');
  const preload = await readFile(path.join(repoRoot, 'electron/preload.ts'), 'utf8');
  const ipc = await readFile(path.join(repoRoot, 'electron/ipc.ts'), 'utf8');

  assert.match(graphView, /if \(USE_SIGMA\) return \[\];/, 'Sigma path skips legacy Cytoscape elements');
  assert.match(graphView, /getGraphOverview\(\)/, 'initial scene uses the compact overview endpoint');
  assert.match(graphView, /getGraphTheme\(/, 'theme drill-down uses the bounded endpoint');
  assert.doesNotMatch(graphView, /!USE_SIGMA\s*&&\s*graphLoading/, 'Sigma loading state remains visible');
  assert.match(sigmaGraph, /overrideModel \?\? buildGraphModel/, 'override scenes skip the full model build');
  assert.equal((sigmaGraph.match(/ensureClusters\(\);/g) ?? []).length, 1, 'Louvain only remains on the lazy LOD path');
  assert.match(preload, /graph:overview/, 'overview IPC is exposed by preload');
  assert.match(preload, /graph:theme/, 'theme IPC is exposed by preload');
  assert.match(ipc, /graph:overview/, 'overview IPC handler is registered');
  assert.match(ipc, /graph:theme/, 'theme IPC handler is registered');
}
