// The once-per-vault graph repair fixes what older builds left behind, and nothing else.
//
// Seeds a vault with the real schema and every kind of damage the repair targets — idea
// links and work themes pointing at deleted themes (the orphan-theme sweep before 5.6.0
// ignored idea links), an idea kept awake only by an edge (unreleased builds revived link
// targets), an edge with a missing endpoint and orphan edge traces — next to legitimate
// data it must not touch: a dormant idea other works still link to, a manual idea owned
// by a note, an active idea no edge touches, a pinned theme, and a gap's evidence
// stored without an idea by scans before 2026-09-02. Then checks the counts, the
// resulting state, the flag that keeps it to one run per vault, and that an orphan trace
// no longer fails every later deep analysis.
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
  const repair = require(path.join(repoRoot, 'electron/db/graphIntegrityRepair.ts'));
  const { getDb, closeDb: close } = require(path.join(repoRoot, 'electron/db/database.ts'));
  closeDb = close;
  const db = getDb();
  const now = new Date().toISOString();

  for (const id of ['W1', 'W2']) {
    worksRepo.upsertWork({
      nodus_id: id, zotero_key: `KEY${id}`, zotero_version: 1, title: `Obra ${id}`, authors: ['Autora'],
      year: 2026, item_type: 'journalArticle', doi: null, read_tag: true, zoteroTags: [],
    });
  }
  const idea = (label) => ideasRepo.createIdea({ type: 'claim', label, statement: label, embedding: null }).global_id;
  const held = idea('Sostenida por W1');
  ideasRepo.upsertOccurrence(held, 'W1', 'principal', '', 0.8);
  const zombie = idea('Despierta solo por una arista');
  const dormant = idea('Durmiente con arista ajena');
  db.prepare('UPDATE ideas SET orphaned_at = ? WHERE global_id = ?').run('2026-09-01T00:00:00.000Z', dormant);
  const manual = idea('Idea manual');
  db.prepare("INSERT INTO notes (id, title, source_json, created_at, updated_at) VALUES ('n-manual', 'Nota', ?, ?, ?)")
    .run(JSON.stringify({ note: 'manual-idea', ref: manual }), now, now);
  db.prepare("INSERT INTO notes (id, title, source_json, created_at, updated_at) VALUES ('n-broken', 'Rota', '{no es json', ?, ?)")
    .run(now, now);
  const loose = idea('Activa sin obra ni aristas');

  const addEdge = (id, from, to, withTrace = true) => {
    db.prepare("INSERT INTO edges (id, from_id, to_id, type, basis, confidence, source_work) VALUES (?, ?, ?, 'refines', 'inferred', 0.7, 'W1')")
      .run(id, from, to);
    if (withTrace) db.prepare("INSERT INTO edge_traces (edge_id, method, created_at) VALUES (?, 'fusion', ?)").run(id, now);
  };
  addEdge('e-zombie', held, zombie);
  addEdge('e-hidden', held, dormant);
  addEdge('e-manual', manual, held);
  addEdge('e-ghost', held, 'idea-that-was-deleted');
  db.prepare("INSERT INTO edge_traces (edge_id, method, created_at) VALUES ('e-gone', 'bridge', ?)").run(now);

  const live = themesRepo.getOrCreateTheme('Tema vivo');
  const pinned = themesRepo.addManualTheme('Tema fijado');
  const unused = themesRepo.getOrCreateTheme('Tema sin uso');
  db.prepare("INSERT INTO work_themes (nodus_id, theme_id) VALUES ('W1', ?), ('W2', 'theme-deleted-long-ago'), ('W2', NULL)").run(live);
  db.prepare("INSERT INTO idea_theme_links VALUES ('W1', ?, ?, 0.8, 'explicit'), ('W1', ?, 'theme-deleted-long-ago', 0.8, 'explicit')")
    .run(held, live, held);
  // A gap of a work with no ideas, as scans before 2026-09-02 stored it.
  db.prepare("INSERT INTO evidence (id, global_id, nodus_id, quote, location, kind) VALUES ('ev-blank', '', 'W2', 'cita del hueco', 'p. 3', 'explicit')").run();
  db.prepare("INSERT INTO gaps (id, nodus_id, related_idea, kind, statement, confidence, evidence_id) VALUES ('gap-blank', 'W2', NULL, 'missing_evidence', 'Hueco', 0.5, 'ev-blank')").run();
  db.prepare("UPDATE works SET deep_status = 'error', deep_error = ? WHERE nodus_id = 'W2'")
    .run('Deep analysis integrity check failed for W2: edges→active ideas: 1');

  assert.throws(() => ideasRepo.assertDeepDataIntegrity('W-unrelated'), /edge traces→edges/, 'before the repair, an orphan trace fails any deep analysis');

  const result = repair.repairGraphIntegrity();
  assert.deepEqual(
    { ...result, integrityFailedWorks: undefined },
    {
      danglingThemeLinks: 1,
      danglingWorkThemes: 2,
      sleptIdeas: 1,
      danglingEdges: 1,
      orphanTraces: 2,
      prunedThemes: 1,
      integrityFailedWorks: undefined,
    },
    'repair counts'
  );
  assert.deepEqual(result.integrityFailedWorks.map((work) => work.nodus_id), ['W2'], 'the work that failed the integrity check is listed');
  assert.equal(worksRepo.getWork('W2').deep_status, 'error', 'and left for the user to retry, not requeued');

  const orphanedAt = (id) => db.prepare('SELECT orphaned_at FROM ideas WHERE global_id = ?').get(id).orphaned_at;
  assert.ok(orphanedAt(zombie), 'an idea only an edge kept awake goes to sleep');
  assert.equal(orphanedAt(dormant), '2026-09-01T00:00:00.000Z', 'an idea already asleep keeps its original timestamp');
  assert.equal(orphanedAt(held), null, 'an idea a work holds stays active');
  assert.equal(orphanedAt(manual), null, 'a manual idea owned by a note stays active');
  assert.equal(orphanedAt(loose), null, 'an idea no edge touches is outside the repair');
  const edgeIds = db.prepare('SELECT id FROM edges ORDER BY id').all().map((row) => row.id);
  assert.deepEqual(edgeIds, ['e-hidden', 'e-manual', 'e-zombie'], 'only the edge with a missing endpoint is deleted');
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM visible_edges WHERE id IN ('e-hidden', 'e-zombie')").get().n,
    0,
    'edges into sleeping ideas are hidden, not deleted'
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM edge_traces WHERE edge_id NOT IN (SELECT id FROM edges)').get().n, 0, 'no orphan trace remains');
  assert.deepEqual(
    db.prepare('SELECT theme_id FROM idea_theme_links WHERE global_id = ?').all(held).map((row) => row.theme_id),
    [live],
    'the link to a deleted theme is gone, the valid one stays'
  );
  assert.deepEqual(
    db.prepare('SELECT nodus_id, theme_id FROM work_themes ORDER BY nodus_id').all(),
    [{ nodus_id: 'W1', theme_id: live }],
    'work themes pointing at nothing are gone'
  );
  assert.deepEqual(
    db.prepare("SELECT ev.global_id, ev.quote, g.evidence_id FROM evidence ev JOIN gaps g ON g.evidence_id = ev.id WHERE ev.id = 'ev-blank'").get(),
    { global_id: '', quote: 'cita del hueco', evidence_id: 'ev-blank' },
    "a gap's evidence stored under '' by scans before 2026-09-02 is left as is: the gap still shows its quote, and a rescan replaces it"
  );
  const themeIds = new Set(db.prepare('SELECT theme_id FROM themes').all().map((row) => row.theme_id));
  assert.ok(themeIds.has(live) && themeIds.has(pinned) && !themeIds.has(unused), 'the unused theme is pruned, the pinned and used ones stay');
  assert.doesNotThrow(() => ideasRepo.assertDeepDataIntegrity('W-unrelated'), 'with the orphan trace gone, deep analyses pass again');

  assert.deepEqual(
    { ...repair.repairGraphIntegrity(), integrityFailedWorks: [] },
    { danglingThemeLinks: 0, danglingWorkThemes: 0, sleptIdeas: 0, danglingEdges: 0, orphanTraces: 0, prunedThemes: 0, integrityFailedWorks: [] },
    'a second pass finds nothing left to repair'
  );

  // Once per vault: the first call runs and sets the flag, later calls do nothing, even
  // if something the repair would fix appears afterwards.
  const flag = () => db.prepare("SELECT value FROM settings WHERE key = 'graph_integrity_repair_v1'").get()?.value ?? null;
  assert.equal(flag(), null, 'the flag is unset before the first once-call');
  assert.ok(repair.repairGraphIntegrityOnce(), 'the first once-call runs');
  assert.equal(flag(), '1', 'and records that it ran');
  db.prepare("INSERT INTO idea_theme_links VALUES ('W1', ?, 'another-deleted-theme', 0.8, 'explicit')").run(held);
  assert.equal(repair.repairGraphIntegrityOnce(), null, 'later once-calls return null');
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM idea_theme_links WHERE theme_id = 'another-deleted-theme'").get().n,
    1,
    'and change nothing'
  );

  console.log('✅ the graph repair fixes dangling themes, edge-only ideas, dangling edges and orphan traces, once per vault, and leaves legitimate data alone');
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
