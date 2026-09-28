// The graph audit and repair (electron/db/graphIntegrity.ts) fix what older builds left
// behind, and nothing else.
//
// Seeds a vault with the real schema and every finding the audit knows — rows of deleted
// works (their edges between ideas that still exist are reported, not deleted), idea links and work themes pointing at deleted themes (the sweep before 5.6.0),
// an idea kept awake only by an edge, an idea a work holds that sleeps, an edge with a
// missing endpoint, orphan traces, an unused theme, rows naming ideas that are gone —
// next to legitimate data the repair must not touch: a dormant idea other works link to,
// a manual idea and its 'manual' theme link and ''-work evidence, bridge edges with no
// work, a pinned theme, legacy gap evidence. Then checks the audit before and after, the
// exact repair counts, the works queued for theme reassignment, the once-per-vault flag,
// and that an orphan trace no longer fails every later deep analysis.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-graph-integrity-repair-test')) {
  execFileSync(require('electron'),
    [fileURLToPath(import.meta.url), '--electron-graph-integrity-repair-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-graph-repair-'));
installRuntimeHooks(root);

let closeDb = () => undefined;
try {
  const worksRepo = require(path.join(repoRoot, 'electron/db/worksRepo.ts'));
  const ideasRepo = require(path.join(repoRoot, 'electron/db/ideasRepo.ts'));
  const themesRepo = require(path.join(repoRoot, 'electron/db/themesRepo.ts'));
  const integrity = require(path.join(repoRoot, 'electron/db/graphIntegrity.ts'));
  const once = require(path.join(repoRoot, 'electron/db/graphIntegrityRepair.ts'));
  const { getDb, closeDb: close } = require(path.join(repoRoot, 'electron/db/database.ts'));
  closeDb = close;
  const db = getDb();
  const now = new Date().toISOString();

  for (const id of ['W1', 'W2', 'W3']) {
    worksRepo.upsertWork({
      nodus_id: id, zotero_key: `KEY${id}`, zotero_version: 1, title: `Obra ${id}`, authors: ['Autora'],
      year: 2026, item_type: 'journalArticle', doi: null, read_tag: true, zoteroTags: [],
    });
  }
  const idea = (label) => ideasRepo.createIdea({ type: 'claim', label, statement: label, embedding: null }).global_id;
  const held = idea('Sostenida por W1');
  ideasRepo.upsertOccurrence(held, 'W1', 'principal', '', 0.8);
  const heldW3 = idea('Sostenida por W3');
  ideasRepo.upsertOccurrence(heldW3, 'W3', 'principal', '', 0.8);
  const zombie = idea('Despierta solo por una arista');
  const dormant = idea('Durmiente con arista ajena');
  db.prepare('UPDATE ideas SET orphaned_at = ? WHERE global_id = ?').run('2026-09-01T00:00:00.000Z', dormant);
  const hiddenHeld = idea('Oculta pero W2 la contiene');
  ideasRepo.upsertOccurrence(hiddenHeld, 'W2', 'principal', '', 0.8);
  db.prepare('UPDATE ideas SET orphaned_at = ? WHERE global_id = ?').run('2026-09-01T00:00:00.000Z', hiddenHeld);
  const manual = idea('Idea manual');
  db.prepare("INSERT INTO notes (id, title, source_json, created_at, updated_at) VALUES ('n-manual', 'Nota', ?, ?, ?)")
    .run(JSON.stringify({ note: 'manual-idea', ref: manual }), now, now);
  db.prepare("INSERT INTO notes (id, title, source_json, created_at, updated_at) VALUES ('n-broken', 'Rota', '{no es json', ?, ?)")
    .run(now, now);
  const loose = idea('Activa sin obra ni aristas');

  const addEdge = (id, from, to, sourceWork = 'W1', type = 'refines', withTrace = true) => {
    db.prepare("INSERT INTO edges (id, from_id, to_id, type, basis, confidence, source_work) VALUES (?, ?, ?, ?, 'inferred', 0.7, ?)")
      .run(id, from, to, type, sourceWork);
    if (withTrace) db.prepare("INSERT INTO edge_traces (edge_id, method, created_at) VALUES (?, 'fusion', ?)").run(id, now);
  };
  addEdge('e-zombie', held, zombie);
  addEdge('e-hidden', held, dormant);
  addEdge('e-manual', manual, held, 'manual');
  addEdge('e-bridge', held, heldW3, null);
  addEdge('e-ghost', held, 'idea-that-was-deleted');
  addEdge('e-merged-away', held, heldW3, 'W-merged-away', 'supports');
  db.prepare("INSERT INTO edge_traces (edge_id, method, created_at) VALUES ('e-gone', 'bridge', ?)").run(now);

  const live = themesRepo.getOrCreateTheme('Tema vivo');
  const pinned = themesRepo.addManualTheme('Tema fijado');
  const unused = themesRepo.getOrCreateTheme('Tema sin uso');
  db.prepare("INSERT INTO work_themes (nodus_id, theme_id) VALUES ('W1', ?), ('W2', 'theme-deleted-long-ago'), ('W2', NULL), ('W-gone', ?)").run(live, live);
  db.prepare(`INSERT INTO idea_theme_links VALUES
      ('W1', ?, ?, 0.8, 'explicit'), ('W1', ?, 'theme-deleted-long-ago', 0.8, 'explicit'),
      ('W3', ?, 'theme-deleted-long-ago', 0.8, 'explicit'), ('manual', ?, ?, 1, 'explicit')`)
    .run(held, live, held, heldW3, manual, live);
  // A work deleted by older code: its rows stayed behind.
  db.prepare("INSERT INTO idea_occurrences (global_id, nodus_id, role, development, confidence) VALUES (?, 'W-gone', 'principal', '', 0.5)").run(held);
  db.prepare("INSERT INTO evidence (id, global_id, nodus_id, quote, location, kind) VALUES ('ev-gone', ?, 'W-gone', 'cita', 'p. 1', 'explicit')").run(held);
  // Manual evidence carries no work, and legacy gap evidence carries no idea: both legitimate.
  db.prepare("INSERT INTO evidence (id, global_id, nodus_id, quote, location, kind) VALUES ('ev-manual', ?, '', 'cita manual', NULL, 'explicit')").run(manual);
  db.prepare("INSERT INTO evidence (id, global_id, nodus_id, quote, location, kind) VALUES ('ev-blank', '', 'W2', 'cita del hueco', 'p. 3', 'explicit')").run();
  db.prepare("INSERT INTO gaps (id, nodus_id, related_idea, kind, statement, confidence, evidence_id) VALUES ('gap-blank', 'W2', NULL, 'missing_evidence', 'Hueco', 0.5, 'ev-blank')").run();
  // Only a new analysis can rebuild W3's gap pointing at an idea that no longer exists.
  db.prepare("INSERT INTO gaps (id, nodus_id, related_idea, kind, statement, confidence, evidence_id) VALUES ('gap-dead', 'W3', 'idea-gone', 'missing_evidence', 'Hueco', 0.5, NULL)").run();
  // User content pointing at an idea pruned long ago: reported, never deleted.
  db.prepare("INSERT INTO edge_feedback (from_id, to_id, type, verdict, note, created_at) VALUES ('idea-pruned', ?, 'refines', 'confirmed', '', ?)").run(held, now);
  db.prepare("UPDATE works SET deep_status = 'error', deep_error = ? WHERE nodus_id = 'W2'")
    .run('Deep analysis integrity check failed for W2: edges→active ideas: 1');

  const count = (report, id) => report.checks.find((check) => check.id === id).count;
  const before = integrity.auditGraphIntegrity(db);
  assert.deepEqual(
    Object.fromEntries(before.checks.map((check) => [check.id, check.count])),
    {
      rows_of_missing_works: 3, // occurrence, evidence and work theme of W-gone
      theme_links_missing_theme: 2,
      work_themes_missing_theme: 2,
      dormant_ideas_with_works: 1,
      active_ideas_without_works: 2, // the edge-only idea and the loose one
      edges_missing_endpoint: 1,
      orphan_edge_traces: 1,
      unused_themes: 1,
      rows_missing_idea: 1,
      rows_missing_evidence: 0,
      edges_of_missing_works: 1, // a relation whose work is gone but whose two ideas are held: kept
      hidden_edges: 1,
      legacy_gap_evidence: 1,
      user_refs_missing_idea: 1,
      stuck_document_jobs: 0,
    },
    'the audit sees every seeded finding, and only those'
  );
  assert.deepEqual(before.rescanWorks.map((work) => work.nodus_id), ['W3'], 'the work to analyse again is named');
  assert.throws(() => ideasRepo.assertDeepDataIntegrity('W-unrelated'), /edge traces→edges/, 'before the repair, an orphan trace fails any deep analysis');

  const repaired = integrity.repairGraphIntegrity(db, now);
  assert.deepEqual(repaired.counts, {
    rowsOfMissingWorks: 3,
    danglingThemeLinks: 2,
    danglingWorkThemes: 2,
    wokenIdeas: 1,
    sleptIdeas: 2,
    danglingEdges: 1,
    orphanTraces: 2, // e-gone, plus the trace of the edge with a missing endpoint
    prunedThemes: 1,
  }, 'repair counts');
  assert.deepEqual([...repaired.themeWorks].sort(), ['W1', 'W3'], 'works whose idea themes were removed');
  assert.deepEqual(repaired.integrityFailedWorks.map((work) => work.nodus_id), ['W2'], 'the work that failed the integrity check is listed, not requeued');
  assert.equal(worksRepo.getWork('W2').deep_status, 'error');

  const after = integrity.auditGraphIntegrity(db);
  assert.equal(after.totals.repairable, 0, 'nothing repairable is left');
  assert.equal(count(after, 'rows_missing_idea'), 1, 'what needs a new analysis is still reported');
  assert.equal(count(after, 'hidden_edges'), 2, 'edges into sleeping ideas stay, hidden (the dormant one and the edge-only one)');
  assert.equal(count(after, 'legacy_gap_evidence'), 1);
  assert.equal(count(after, 'edges_of_missing_works'), 1, 'reported, never deleted');
  assert.equal(count(after, 'user_refs_missing_idea'), 1, "the user's own content is never deleted");
  assert.deepEqual(after.pendingThemeWorks.map((work) => work.nodus_id).sort(), ['W1', 'W3'], 'the works wait for their themes to be reassigned');

  const orphanedAt = (id) => db.prepare('SELECT orphaned_at FROM ideas WHERE global_id = ?').get(id).orphaned_at;
  assert.equal(orphanedAt(zombie), now, 'an idea only an edge kept awake goes to sleep');
  assert.equal(orphanedAt(loose), now, 'an active idea no work holds goes to sleep, as a purge would do');
  assert.equal(orphanedAt(dormant), '2026-09-01T00:00:00.000Z', 'an idea already asleep keeps its timestamp');
  assert.equal(orphanedAt(hiddenHeld), null, 'an idea a work holds wakes up');
  assert.equal(orphanedAt(held), null);
  assert.equal(orphanedAt(manual), null, 'a manual idea owned by a note stays active, despite a malformed note beside it');
  assert.deepEqual(
    db.prepare('SELECT id FROM edges ORDER BY id').all().map((row) => row.id),
    ['e-bridge', 'e-hidden', 'e-manual', 'e-merged-away', 'e-zombie'],
    'only the edge with a missing endpoint is gone; the relation of a deleted work between two held ideas stays'
  );
  assert.deepEqual(
    db.prepare("SELECT nodus_id FROM idea_theme_links ORDER BY nodus_id").all().map((row) => row.nodus_id),
    ['W1', 'manual'],
    "valid links stay, including the manual idea's"
  );
  assert.deepEqual(db.prepare('SELECT nodus_id, theme_id FROM work_themes').all(), [{ nodus_id: 'W1', theme_id: live }]);
  assert.deepEqual(
    db.prepare("SELECT id FROM evidence ORDER BY id").all().map((row) => row.id),
    ['ev-blank', 'ev-manual'],
    "manual evidence and legacy gap evidence stay; the deleted work's evidence goes"
  );
  const themeIds = new Set(db.prepare('SELECT theme_id FROM themes').all().map((row) => row.theme_id));
  assert.ok(themeIds.has(live) && themeIds.has(pinned) && !themeIds.has(unused), 'the unused theme is pruned, the pinned and used ones stay');
  assert.doesNotThrow(() => ideasRepo.assertDeepDataIntegrity('W-unrelated'), 'with the orphan trace gone, deep analyses pass again');

  const again = integrity.repairGraphIntegrity(db, now);
  assert.ok(Object.values(again.counts).every((n) => n === 0), 'a second pass finds nothing left to repair');
  assert.deepEqual(again.themeWorks, []);

  // Pending theme works: dismissing clears them; deleted works drop out on their own.
  integrity.setPendingThemeRepairWorkIds(db, ['W1', 'W3', 'W-gone']);
  assert.deepEqual(integrity.pendingThemeRepairWorkIds(db).sort(), ['W1', 'W3'], 'a deleted work never shows as pending');
  once.dismissPendingThemeWorks();
  assert.deepEqual(once.pendingThemeWorkIds(), []);

  // Once per vault: the first call runs, records the flag and queues the theme works;
  // later calls do nothing, even if something the repair would fix appears afterwards.
  db.prepare("INSERT INTO idea_theme_links VALUES ('W1', ?, 'another-deleted-theme', 0.8, 'explicit')").run(held);
  const flag = () => db.prepare("SELECT value FROM settings WHERE key = 'graph_integrity_repair_v1'").get()?.value ?? null;
  assert.equal(flag(), null, 'the flag is unset before the first once-call');
  const first = once.repairGraphIntegrityOnce();
  assert.ok(first, 'the first once-call runs');
  assert.equal(first.counts.danglingThemeLinks, 1);
  assert.equal(flag(), '1', 'and records that it ran');
  assert.deepEqual(once.pendingThemeWorkIds(), ['W1'], 'and queues the work whose themes it removed');
  db.prepare("INSERT INTO idea_theme_links VALUES ('W1', ?, 'yet-another-deleted-theme', 0.8, 'explicit')").run(held);
  assert.equal(once.repairGraphIntegrityOnce(), null, 'later once-calls return null');
  assert.equal(count(once.checkGraphIntegrity(), 'theme_links_missing_theme'), 1, 'and change nothing; the on-demand audit still sees it');
  const manualRun = once.runGraphIntegrityRepair();
  assert.equal(manualRun.counts.danglingThemeLinks, 1, 'the on-demand repair fixes it');
  assert.equal(manualRun.report.totals.repairable, 0, 'and returns the audit after the repair');

  console.log('✅ the graph audit and repair find every seeded finding, repair exactly the repairable ones, leave legitimate data alone, and run once per vault');
} finally {
  try { closeDb(); } catch { /* ignore */ }
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: { getPath: () => userDataPath, getVersion: () => '0.0.0-test', getAppPath: () => repoRoot, isPackaged: false },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: (v) => Buffer.from(String(v)), decryptString: (v) => Buffer.from(v).toString() },
    dialog: {}, shell: {}, BrowserWindow: class {}, ipcMain: { handle: () => undefined, on: () => undefined },
  };
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function (module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    module._compile(ts.transpileModule(source, { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true, skipLibCheck: true } }).outputText, filename);
  };
}
