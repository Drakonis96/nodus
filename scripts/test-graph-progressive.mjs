// Progressive graph loading regression: exercise the real overview/theme graph
// builders against a deterministic academic-scale fixture and guard the renderer
// contracts that keep the initial Sigma scene bounded. Runs under Electron-as-Node
// so better-sqlite3 uses the same ABI as the desktop app.
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

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-graph-progressive-'));
try {
  const Database = require('better-sqlite3');
  const db = new Database(path.join(root, 'graph.sqlite'));
  createSchema(db);
  seedAcademicFixture(db);
  globalThis.__graphProgressiveTestDb = db;

  const graphModule = await bundleGraphService();
  const graph = await import(pathToFileURL(graphModule).href);

  const overviewStarted = performance.now();
  const overview = graph.buildIdeaGraphOverview();
  const overviewMs = performance.now() - overviewStarted;
  const overviewBytes = Buffer.byteLength(JSON.stringify(overview));
  assert.equal(overview.nodes.length, 12, 'overview returns one compact node per graph theme');
  assert.ok(overview.nodes.every((node) => node.type === 'theme'), 'overview contains no idea nodes');
  assert.ok(overview.nodes.every((node) => node.statement == null), 'overview omits idea statements');
  assert.ok(overview.nodes.every((node) => node.workIds.length === 0), 'overview omits work-id payloads');
  assert.ok(overview.edges.length > 0, 'overview aggregates cross-theme relations');
  assert.ok(overviewBytes < 100_000, `overview payload remains compact (${overviewBytes} bytes)`);
  assert.ok(overviewMs < 1_500, `overview fixture build remains bounded (${overviewMs.toFixed(1)} ms)`);
  assertGraphIntegrity(overview);

  const themeStarted = performance.now();
  const theme = graph.buildIdeaThemeGraph('Tema 0', 90);
  const themeMs = performance.now() - themeStarted;
  const ideaNodes = theme.nodes.filter((node) => node.type !== 'theme');
  const activeNodes = ideaNodes.filter((node) => node.themes.includes('tema 0'));
  const bridgeNodes = ideaNodes.filter((node) => !node.themes.includes('tema 0'));
  const themeBytes = Buffer.byteLength(JSON.stringify(theme));
  assert.ok(activeNodes.length > 0 && activeNodes.length <= 90, 'theme core respects the requested cap');
  assert.ok(bridgeNodes.length <= 60, 'cross-theme context respects its bridge cap');
  assert.ok(ideaNodes.length <= 150, 'default theme scene never ships more than 150 ideas');
  assert.ok(themeBytes < 1_000_000, `theme payload remains bounded (${themeBytes} bytes)`);
  assert.ok(themeMs < 1_500, `theme fixture build remains bounded (${themeMs.toFixed(1)} ms)`);
  assertGraphIntegrity(theme);

  const clamped = graph.buildIdeaThemeGraph('Tema 0', 1);
  const clampedActive = clamped.nodes.filter(
    (node) => node.type !== 'theme' && node.themes.includes('tema 0')
  );
  assert.ok(clampedActive.length <= 20, 'theme endpoint enforces its lower cap');

  await assertRendererContracts();
  db.close();
  console.log(
    `progressive graph test passed (overview ${overviewMs.toFixed(1)} ms/${overviewBytes} B; `
      + `theme ${themeMs.toFixed(1)} ms/${themeBytes} B/${ideaNodes.length} ideas)`
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
