// The one dormancy rule (electron/db/ideaDormancy.ts) holds on every path that adds or
// removes occurrences, on the real schema:
//
// - A malformed note or a manual-idea note without a ref no longer breaks it. json_extract
//   threw on the first and aborted every purge (and the startup prune); the NULL a missing
//   ref put in a NOT IN list stopped every idea from ever going dormant.
// - The 30-day prune spares a dormant idea that user content still points at, for every
//   table in USER_IDEA_REFERENCES, and still prunes one nothing points at.
// - Every schema column that can hold an idea id is classified, so a new one cannot slip
//   past the prune: graph-derived, a user reference, or a documented exception.
// - Merging ideas wakes the kept idea when it takes over occurrences; merging works moves
//   edge ownership to the kept work.
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

if (!process.argv.includes('--electron-idea-dormancy-test')) {
  execFileSync(require('electron'),
    [fileURLToPath(import.meta.url), '--electron-idea-dormancy-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-idea-dormancy-'));
installRuntimeHooks(root);

/** Schema columns that can hold an idea id (the same net the census below casts). */
const IDEA_ID_COLUMN = /(^|_)(idea|ideas)(_|$)|global_id|^from_id$|^to_id$|related_idea|from_idea|^target_id$|^ref_id$/;
/** Graph-derived columns: rewritten by scans, cleaned by purge, deletion and the repair. */
const GRAPH_DERIVED = new Set([
  'ideas.global_id', 'idea_occurrences.global_id', 'evidence.global_id', 'edges.from_id', 'edges.to_id',
  'gaps.related_idea', 'external_refs.from_idea', 'idea_theme_links.global_id',
  // Cascades from ideas(global_id).
  'document_idea_links.global_id',
]);
/** Matches the net but holds no idea of this graph, or is a derived index rebuilt on its own. */
const EXCEPTIONS = new Map([
  ['tutor_saved_routes.total_ideas', 'a count'],
  ['research_questions.corpus_ideas', 'a count'],
  ['dictionary_retrieval_state.idea_floor', 'a cursor'],
  ['project_chapter_idea_relations.chapter_idea_id', 'a project chapter idea, not a graph idea'],
  ['record_evidence.target_id', 'records lens: persons, places, events'],
  ['social_relations.target_id', 'genealogy contacts and persons'],
  ['study_style_associations.target_id', 'study styles'],
  ['study_idea_occurrences.idea_id', "the study vault's own study_ideas"],
  ['study_idea_edges.from_id', "the study vault's own study_ideas"],
  ['study_idea_edges.to_id', "the study vault's own study_ideas"],
  ['prosop_sources.target_id', 'prosopography'],
  ['prosop_proposals.target_id', 'prosopography'],
  ['testimony_note_links.target_id', 'testimony vault'],
  ['dictionary_evidence.ref_id', 'dictionary index, rebuilt from dictionary_corpus_changes'],
  ['dictionary_corpus_changes.ref_id', 'change log of the dictionary index'],
  ['document_profile_support.target_id', 'document profile fields and sections'],
  ['document_idea_links.target_id', 'document profile fields and sections'],
]);

let closeDb = () => undefined;
try {
  const worksRepo = require(path.join(repoRoot, 'electron/db/worksRepo.ts'));
  const ideasRepo = require(path.join(repoRoot, 'electron/db/ideasRepo.ts'));
  const dormancy = require(path.join(repoRoot, 'electron/db/ideaDormancy.ts'));
  const ideaDedupe = require(path.join(repoRoot, 'electron/db/ideaDedupe.ts'));
  const dedupe = require(path.join(repoRoot, 'electron/db/dedupe.ts'));
  const { getDb, closeDb: close } = require(path.join(repoRoot, 'electron/db/database.ts'));
  closeDb = close;
  const db = getDb();
  const now = new Date().toISOString();
  const longAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

  // ── 1. Census of every column that can hold an idea id ───────────────────────
  const userRefs = new Set(dormancy.USER_IDEA_REFERENCES.map((ref) => `${ref.table}.${ref.column}`));
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((row) => row.name);
  const unclassified = [];
  for (const table of tables) {
    for (const { name } of db.prepare(`PRAGMA table_info("${table}")`).all()) {
      const key = `${table}.${name}`;
      if (!IDEA_ID_COLUMN.test(name) || GRAPH_DERIVED.has(key) || userRefs.has(key) || EXCEPTIONS.has(key)) continue;
      unclassified.push(key);
    }
  }
  assert.deepEqual(unclassified, [], 'every column that can hold an idea id is classified (graph-derived, user reference or exception)');
  for (const key of userRefs) {
    const [table, column] = key.split('.');
    assert.ok(tables.includes(table) && db.prepare(`PRAGMA table_info("${table}")`).all().some((row) => row.name === column), `${key} exists in the schema`);
  }

  worksRepo.upsertWork({
    nodus_id: 'W1', zotero_key: 'KEYW1', zotero_version: 1, title: 'Obra 1', authors: ['Autora'],
    year: 2026, item_type: 'journalArticle', doi: null, read_tag: true, zoteroTags: [],
  });
  const idea = (label) => ideasRepo.createIdea({ type: 'claim', label, statement: label, embedding: null }).global_id;
  const orphanedAt = (id) => db.prepare('SELECT orphaned_at FROM ideas WHERE global_id = ?').get(id)?.orphaned_at;
  const exists = (id) => Boolean(db.prepare('SELECT 1 FROM ideas WHERE global_id = ?').get(id));

  // ── 2. Malformed notes no longer break the rule ───────────────────────────────
  db.prepare("INSERT INTO notes (id, title, source_json, created_at, updated_at) VALUES ('n-broken', 'Rota', '{no es json', ?, ?)").run(now, now);
  db.prepare("INSERT INTO notes (id, title, source_json, created_at, updated_at) VALUES ('n-noref', 'Sin ref', ?, ?, ?)")
    .run(JSON.stringify({ note: 'manual-idea' }), now, now);
  const manual = idea('Manual con ref');
  db.prepare("INSERT INTO notes (id, title, source_json, created_at, updated_at) VALUES ('n-manual', 'Nota', ?, ?, ?)")
    .run(JSON.stringify({ note: 'manual-idea', ref: manual }), now, now);
  const held = idea('Tenida por W1');
  ideasRepo.upsertOccurrence(held, 'W1', 'principal', '', 0.8);
  ideasRepo.purgeDeepData('W1');
  assert.ok(orphanedAt(held), 'a purge still puts the idea to sleep despite a malformed note and a manual-idea note without ref');
  assert.equal(orphanedAt(manual), null, 'the manual idea its note owns stays awake');

  // ── 3. The long-dormancy prune spares ideas user content points at ─────────────
  db.pragma('foreign_keys = OFF');
  const referenced = [];
  for (const ref of dormancy.USER_IDEA_REFERENCES) {
    const target = idea(`Referenciada por ${ref.table}.${ref.column}`);
    db.prepare('UPDATE ideas SET orphaned_at = ? WHERE global_id = ?').run(longAgo, target);
    insertReference(db, ref, target, now);
    referenced.push([`${ref.table}.${ref.column}`, target]);
  }
  db.pragma('foreign_keys = ON');
  const unreferenced = idea('Sin referencias');
  db.prepare('UPDATE ideas SET orphaned_at = ? WHERE global_id IN (?, ?)').run(longAgo, unreferenced, held);
  ideasRepo.pruneDormantIdeas(30);
  for (const [key, target] of referenced) assert.ok(exists(target), `a dormant idea ${key} points at is not pruned`);
  assert.equal(exists(unreferenced), false, 'a dormant idea nothing points at is still pruned');
  assert.equal(exists(held), false);
  assert.ok(exists(manual), 'a manual idea is never pruned');

  // ── 4. Merging ideas into a dormant one wakes it ──────────────────────────────
  const sleeping = idea('Canónica dormida');
  db.prepare('UPDATE ideas SET orphaned_at = ? WHERE global_id = ?').run(now, sleeping);
  const awake = idea('Duplicada activa');
  ideasRepo.upsertOccurrence(awake, 'W1', 'principal', '', 0.8);
  assert.equal(ideaDedupe.mergeIdeas(db, sleeping, [awake]), 1);
  assert.equal(orphanedAt(sleeping), null, 'the kept idea took over an occurrence, so it wakes');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM idea_occurrences WHERE global_id = ?').get(sleeping).n, 1);

  // ── 5. Merging works moves edge ownership to the kept work ────────────────────
  worksRepo.upsertWork({
    nodus_id: 'W2', zotero_key: 'KEYW2', zotero_version: 1, title: 'Obra 1 (duplicada)', authors: ['Autora'],
    year: 2026, item_type: 'journalArticle', doi: null, read_tag: true, zoteroTags: [],
  });
  const other = idea('Otra');
  ideasRepo.upsertOccurrence(other, 'W2', 'principal', '', 0.8);
  db.prepare("INSERT INTO edges (id, from_id, to_id, type, basis, confidence, source_work) VALUES ('e-dup', ?, ?, 'refines', 'inferred', 0.7, 'W2')").run(other, sleeping);
  assert.equal(dedupe.mergeWorks(db, 'W1', ['W2']), 1);
  assert.equal(db.prepare("SELECT source_work FROM edges WHERE id = 'e-dup'").get().source_work, 'W1', "the duplicate's edge now belongs to the kept work, so its next rescan replaces it");

  console.log('✅ the dormancy rule survives malformed notes, spares ideas user content points at, and holds through merges');
} finally {
  try { closeDb(); } catch { /* ignore */ }
  await rm(root, { recursive: true, force: true });
}

/** Insert one row of `ref.table` whose `ref.column` points at `ideaId`, filling the rest. */
function insertReference(db, ref, ideaId, now) {
  const columns = db.prepare(`PRAGMA table_info("${ref.table}")`).all();
  const values = new Map();
  for (const column of columns) {
    if (column.dflt_value !== null && !column.pk) continue;
    if (!column.notnull && !column.pk) continue;
    const type = String(column.type).toUpperCase();
    values.set(column.name, type.includes('INT') || type.includes('REAL') ? 0 : `${ref.table}-${column.name}-${ideaId}`);
  }
  for (const column of columns) if (/_at$/.test(column.name) && values.has(column.name)) values.set(column.name, now);
  values.set(ref.column, ideaId);
  // The where clause names the kind columns: `kind = 'idea'`, `target_vault_id IS NULL`.
  for (const clause of (ref.where ?? '').split(/\s+AND\s+/i).filter(Boolean)) {
    const equals = clause.match(/^(\w+)\s*=\s*'([^']*)'$/);
    const isNull = clause.match(/^(\w+)\s+IS NULL$/i);
    if (equals) values.set(equals[1], equals[2]);
    else if (isNull) values.set(isNull[1], null);
  }
  if (ref.table === 'edge_feedback') {
    values.set('verdict', 'confirmed');
    values.set(ref.column === 'from_id' ? 'to_id' : 'from_id', `other-${ideaId}`);
  }
  const names = [...values.keys()];
  db.prepare(`INSERT INTO "${ref.table}" (${names.map((name) => `"${name}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`)
    .run(...names.map((name) => values.get(name)));
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
