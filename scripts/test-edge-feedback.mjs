// Edge-audit feedback: migration 27 (edge_feedback + visible_edges view), the
// REAL edgeFeedbackRepo functions, and the rescan-survival property that
// motivates the whole design — a rejected relation stays hidden even after the
// pipeline deletes and recreates edge rows with new ids. Runs under
// Electron-as-Node so better-sqlite3 matches the app ABI.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-edge-feedback-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-edge-feedback.mjs'), '--electron-edge-feedback-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-edge-feedback-'));
try {
  const Database = require('better-sqlite3');
  const db = new Database(path.join(root, 'edges.sqlite'));
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE ideas (global_id TEXT PRIMARY KEY, label TEXT);
    CREATE TABLE edges (
      id TEXT PRIMARY KEY, from_id TEXT, to_id TEXT, type TEXT,
      basis TEXT, confidence REAL, source_work TEXT
    );
  `);
  db.exec(await migration27Sql());
  assert.ok(tableExists(db, 'edge_feedback'), 'edge_feedback table exists');
  assert.ok(viewExists(db, 'visible_edges'), 'visible_edges view exists');

  // ── Drive the REAL repo functions against this DB ──────────────────────────
  const repoModule = await bundleRepoWithStubbedDb();
  globalThis.__edgeFeedbackTestDb = db;
  const repo = await import(pathToFileURL(repoModule).href);

  db.prepare("INSERT INTO ideas VALUES ('A', 'Idea A'), ('B', 'Idea B'), ('C', 'Idea C')").run();
  const addEdge = (id, from, to, type) =>
    db.prepare("INSERT INTO edges VALUES (?, ?, ?, ?, 'explicit', 0.9, NULL)").run(id, from, to, type);
  addEdge('e1', 'A', 'B', 'contradicts');
  addEdge('e2', 'B', 'A', 'contradicts'); // reverse direction of the same dispute
  addEdge('e3', 'B', 'C', 'supports');

  const visibleIds = () => db.prepare('SELECT id FROM visible_edges ORDER BY id').all().map((r) => r.id);
  assert.deepEqual(visibleIds(), ['e1', 'e2', 'e3'], 'no feedback → everything visible');

  // Reject A↔B contradicts: hides BOTH directions, leaves the supports edge alone.
  repo.setEdgeFeedback('A', 'B', 'contradicts', 'rejected', 'sinónimos mal leídos');
  assert.deepEqual(visibleIds(), ['e3'], 'rejection hides both directions of the pair');

  // Confirm B→C supports: stays visible and the verdict is readable both ways.
  repo.setEdgeFeedback('B', 'C', 'supports', 'confirmed');
  assert.deepEqual(visibleIds(), ['e3'], 'confirmation never hides');
  assert.equal(repo.getEdgeFeedback('C', 'B', 'supports')?.verdict, 'confirmed', 'lookup is direction-agnostic');

  // Re-setting from the opposite direction replaces, never duplicates.
  repo.setEdgeFeedback('B', 'A', 'contradicts', 'rejected');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM edge_feedback').get().n, 2, 'one row per pair+type');

  // The annotation map exposes both directions.
  const map = repo.edgeFeedbackMap();
  assert.equal(map.get('A|B|contradicts'), 'rejected');
  assert.equal(map.get('B|A|contradicts'), 'rejected');
  assert.equal(map.get('B|C|supports'), 'confirmed');

  // Listing joins labels and orders newest first.
  const listed = repo.listEdgeFeedback();
  assert.equal(listed.length, 2);
  assert.ok(listed.every((r) => r.from_label.startsWith('Idea')), 'labels resolved');

  // ── Rescan survival: pipeline wipes and recreates edges with new ids ───────
  db.prepare('DELETE FROM edges').run();
  addEdge('rescan-1', 'A', 'B', 'contradicts');
  addEdge('rescan-2', 'B', 'C', 'supports');
  assert.deepEqual(visibleIds(), ['rescan-2'], 'rejection survives a full edge rebuild');

  // Same pair, DIFFERENT relation type is untouched by the veto.
  addEdge('rescan-3', 'A', 'B', 'extends');
  assert.deepEqual(visibleIds(), ['rescan-2', 'rescan-3'], 'veto is scoped to the relation type');

  // ── Undo restores the derived state ────────────────────────────────────────
  repo.setEdgeFeedback('A', 'B', 'contradicts', null);
  assert.deepEqual(visibleIds(), ['rescan-1', 'rescan-2', 'rescan-3'], 'clearing the verdict restores the edge');

  // ── Drift guard: UI/AI read paths must select from visible_edges ───────────
  const readers = [
    ['electron/graph/graphService.ts', 6],
    ['electron/db/ideasRepo.ts', 1],
    ['electron/ai/argumentMap.ts', 2],
    ['electron/ai/researchMap.ts', 1],
    ['electron/ai/immersion.ts', 1],
    ['electron/ai/folderIdeaSuggestions.ts', 1],
    ['electron/db/authorsRepo.ts', 1],
    ['electron/ai/workIdeaSynthesis.ts', 1],
  ];
  for (const [file, min] of readers) {
    const source = await readFile(path.join(repoRoot, file), 'utf8');
    const count = (source.match(/visible_edges/g) ?? []).length;
    assert.ok(count >= min, `${file} should read visible_edges (found ${count}, expected ≥ ${min})`);
  }

  db.close();
  console.log('edge feedback (audit + visible_edges) test passed');
} finally {
  await rm(root, { recursive: true, force: true });
}

async function migration27Sql() {
  const source = await readFile(path.join(repoRoot, 'electron/db/migrations.ts'), 'utf8');
  const match = source.match(/version:\s*27,\s*up:\s*\/\*\s*sql\s*\*\/\s*`([\s\S]*?)`\s*,\s*}\s*(?:,|];)/);
  assert.ok(match?.[1], 'Could not find migration 27 SQL');
  return match[1];
}

/** Bundle the real edgeFeedbackRepo with './database' redirected to a global-injected stub. */
async function bundleRepoWithStubbedDb() {
  const stub = path.join(root, 'database-stub.js');
  await writeFile(stub, 'export function getDb() { return globalThis.__edgeFeedbackTestDb; }\n');
  const out = path.join(root, 'edgeFeedbackRepo.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'electron/db/edgeFeedbackRepo.ts')],
    outfile: out,
    bundle: true,
    format: 'esm',
    platform: 'node',
    plugins: [
      {
        name: 'stub-database',
        setup(buildApi) {
          buildApi.onResolve({ filter: /^\.\/database$/ }, () => ({ path: stub }));
        },
      },
    ],
  });
  return out;
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function viewExists(db, name) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'view' AND name = ?").get(name));
}
