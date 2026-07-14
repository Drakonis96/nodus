// User-layer sync package: drives the REAL buildSyncPackage/mergeSyncPackage
// against two scratch databases ("machine A" and "machine B") and proves the
// merge contract: additive, newest-wins per row, folder hierarchy preserved,
// idempotent, and never deletes anything local. Runs under Electron-as-Node so
// better-sqlite3 matches the app ABI.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-sync-package-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-sync-package.mjs'), '--electron-sync-package-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-sync-package-'));
try {
  const Database = require('better-sqlite3');
  const schema = `
    CREATE TABLE note_folders (
      id TEXT PRIMARY KEY, parent_id TEXT, name TEXT NOT NULL,
      order_idx INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY (parent_id) REFERENCES note_folders(id) ON DELETE CASCADE
    );
    CREATE TABLE notes (
      id TEXT PRIMARY KEY, folder_id TEXT, title TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'markdown', content TEXT NOT NULL DEFAULT '',
      source_json TEXT, order_idx INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY (folder_id) REFERENCES note_folders(id) ON DELETE CASCADE
    );
    CREATE TABLE writing_saved_drafts (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, brief_json TEXT NOT NULL,
      selection_json TEXT NOT NULL, model_json TEXT, draft_json TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE saved_searches (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, query TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'semantic', kinds_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL
    );
    CREATE TABLE edge_feedback (
      from_id TEXT NOT NULL, to_id TEXT NOT NULL, type TEXT NOT NULL,
      verdict TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
      PRIMARY KEY (from_id, to_id, type)
    );
    CREATE TABLE db_databases (
      id TEXT PRIMARY KEY, short_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      icon TEXT, position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE db_columns (
      id TEXT PRIMARY KEY, database_id TEXT NOT NULL REFERENCES db_databases(id) ON DELETE CASCADE,
      name TEXT NOT NULL, type TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0,
      config_json TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE db_select_options (
      id TEXT PRIMARY KEY, column_id TEXT NOT NULL REFERENCES db_columns(id) ON DELETE CASCADE,
      label TEXT NOT NULL, color TEXT, position INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE db_rows (
      id TEXT PRIMARY KEY, database_id TEXT NOT NULL REFERENCES db_databases(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE db_cells (
      row_id TEXT NOT NULL REFERENCES db_rows(id) ON DELETE CASCADE,
      column_id TEXT NOT NULL REFERENCES db_columns(id) ON DELETE CASCADE,
      value_text TEXT, PRIMARY KEY (row_id, column_id)
    );
    CREATE TABLE db_attachments (
      id TEXT PRIMARY KEY, row_id TEXT NOT NULL REFERENCES db_rows(id) ON DELETE CASCADE,
      column_id TEXT NOT NULL REFERENCES db_columns(id) ON DELETE CASCADE,
      file_name TEXT, mime_type TEXT, bytes INTEGER NOT NULL DEFAULT 0, blob BLOB,
      content_hash TEXT, extracted_text TEXT, description TEXT,
      ai_generated INTEGER NOT NULL DEFAULT 0, ai_prompt TEXT,
      position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    );
    CREATE TABLE db_relations (
      id TEXT PRIMARY KEY, row_id TEXT NOT NULL REFERENCES db_rows(id) ON DELETE CASCADE,
      column_id TEXT NOT NULL REFERENCES db_columns(id) ON DELETE CASCADE,
      target_kind TEXT NOT NULL, target_id TEXT NOT NULL, target_vault_id TEXT,
      position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    );
    CREATE TABLE db_views (
      id TEXT PRIMARY KEY, database_id TEXT NOT NULL REFERENCES db_databases(id) ON DELETE CASCADE,
      name TEXT NOT NULL, layout TEXT NOT NULL DEFAULT 'table', filter_json TEXT, sort_json TEXT,
      position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    );
    CREATE TABLE study_courses (
      id TEXT PRIMARY KEY, short_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE study_docs (
      id TEXT PRIMARY KEY, short_id TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
      content_markdown TEXT NOT NULL DEFAULT '', embedding BLOB,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE study_placements (
      id TEXT PRIMARY KEY, short_id TEXT NOT NULL UNIQUE,
      document_id TEXT NOT NULL REFERENCES study_docs(id) ON DELETE CASCADE,
      course_id TEXT REFERENCES study_courses(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE study_materials (
      id TEXT PRIMARY KEY, short_id TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
      content_blob BLOB, content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE study_material_placements (
      id TEXT PRIMARY KEY, short_id TEXT NOT NULL UNIQUE,
      material_id TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
      document_id TEXT REFERENCES study_docs(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `;
  const dbA = new Database(path.join(root, 'machine-a.sqlite'));
  const dbB = new Database(path.join(root, 'machine-b.sqlite'));
  dbA.pragma('foreign_keys = ON');
  dbB.pragma('foreign_keys = ON');
  dbA.exec(schema);
  dbB.exec(schema);

  const mod = await bundleSyncPackage();
  const useDb = (db) => {
    globalThis.__syncTestDb = db;
  };
  const sync = require(mod); // CJS bundle: adm-zip needs real require()

  const T0 = '2026-07-01T10:00:00.000Z';
  const T1 = '2026-07-05T10:00:00.000Z';
  const T2 = '2026-07-09T10:00:00.000Z';

  // ── Machine A: a folder tree, two notes, a draft, a search, a rejection ────
  dbA.prepare('INSERT INTO note_folders VALUES (?, NULL, ?, 0, ?, ?)').run('f1', 'Tesis', T0, T0);
  dbA.prepare('INSERT INTO note_folders VALUES (?, ?, ?, 0, ?, ?)').run('f2', 'f1', 'Capítulo 1', T0, T0);
  dbA.prepare('INSERT INTO notes VALUES (?, ?, ?, ?, ?, NULL, 0, ?, ?)').run('n1', 'f2', 'Nota A', 'markdown', 'contenido A', T0, T1);
  dbA.prepare('INSERT INTO notes VALUES (?, NULL, ?, ?, ?, NULL, 0, ?, ?)').run('n2', 'Compartida', 'markdown', 'versión vieja de A', T0, T0);
  dbA.prepare("INSERT INTO writing_saved_drafts VALUES ('d1', 'Borrador', '{}', '{}', NULL, '{}', ?, ?)").run(T0, T1);
  dbA.prepare("INSERT INTO saved_searches VALUES ('s1', 'Memoria', 'memoria', 'semantic', '[]', ?)").run(T0);
  dbA.prepare("INSERT INTO edge_feedback VALUES ('iA', 'iB', 'contradicts', 'rejected', '', ?)").run(T2);

  // Study data includes a dependency tree and binary payloads. It is merged
  // row-by-row (newest wins) while each blob-bearing row stays atomic.
  dbA.prepare("INSERT INTO study_courses VALUES ('courseA', 'CUR-A', 'Historia', ?, ?)").run(T0, T1);
  dbA.prepare("INSERT INTO study_docs VALUES ('docShared', 'DOC-A', 'Tema 1', '# versión A', ?, ?, ?)")
    .run(Buffer.from('EMBED-A'), T0, T1);
  dbA.prepare("INSERT INTO study_placements VALUES ('placementA', 'PLC-A', 'docShared', 'courseA', ?, ?)").run(T0, T1);
  dbA.prepare("INSERT INTO study_materials VALUES ('materialA', 'MAT-A', 'Diapositivas', ?, 'hash-a', ?, ?)")
    .run(Buffer.from('MATERIAL-A'), T0, T1);
  dbA.prepare("INSERT INTO study_material_placements VALUES ('materialPlacementA', 'MPL-A', 'materialA', 'docShared', ?, ?)").run(T0, T1);

  // ── Machine A: a whole Databases-vault database (columns, options, cell,
  //    attachment blob, relation, saved view) — an atomic sync unit at T1 ──────
  dbA.prepare('INSERT INTO db_databases VALUES (?, ?, ?, NULL, 0, ?, ?)').run('dbShared', 'DB-A001', 'Muestras', T0, T1);
  dbA.prepare("INSERT INTO db_columns VALUES ('colA', 'dbShared', 'Título', 'title', 0, NULL, ?)").run(T0);
  dbA.prepare("INSERT INTO db_columns VALUES ('colS', 'dbShared', 'Estado', 'select', 1, NULL, ?)").run(T0);
  dbA.prepare("INSERT INTO db_select_options VALUES ('optS', 'colS', 'Activo', 'crimson', 0)").run();
  dbA.prepare('INSERT INTO db_rows VALUES (?, ?, 0, ?, ?)').run('rowA', 'dbShared', T0, T1);
  dbA.prepare("INSERT INTO db_cells VALUES ('rowA', 'colA', 'from A')").run();
  dbA.prepare("INSERT INTO db_cells VALUES ('rowA', 'colS', 'optS')").run();
  dbA.prepare('INSERT INTO db_attachments VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, NULL, 0, ?)').run(
    'attA', 'rowA', 'colA', 'muestra.png', 'image/png', 7, Buffer.from('PNGDATA'), 'h1', T0
  );
  dbA.prepare("INSERT INTO db_relations VALUES ('relA', 'rowA', 'colA', 'db_row', 'other-row', NULL, 0, ?)").run(T0);
  dbA.prepare("INSERT INTO db_views VALUES ('viewA', 'dbShared', 'Todo', 'table', NULL, NULL, 0, ?)").run(T0);

  // ── Machine B: its own note, a NEWER copy of n2, an OLDER verdict ──────────
  dbB.prepare('INSERT INTO notes VALUES (?, NULL, ?, ?, ?, NULL, 0, ?, ?)').run('n2', 'Compartida', 'markdown', 'versión nueva de B', T0, T1);
  dbB.prepare('INSERT INTO notes VALUES (?, NULL, ?, ?, ?, NULL, 0, ?, ?)').run('n3', 'Solo B', 'markdown', 'local de B', T0, T0);
  dbB.prepare("INSERT INTO edge_feedback VALUES ('iB', 'iA', 'contradicts', 'confirmed', '', ?)").run(T0);
  dbB.prepare("INSERT INTO study_docs VALUES ('docShared', 'DOC-A', 'Tema local más nuevo', '# versión B', ?, ?, ?)")
    .run(Buffer.from('EMBED-B'), T0, T2);

  // ── Machine B: an OLDER copy of the same database (must be replaced whole),
  //    plus a B-only database (must never be touched by A's package) ──────────
  dbB.prepare('INSERT INTO db_databases VALUES (?, ?, ?, NULL, 0, ?, ?)').run('dbShared', 'DB-A001', 'Muestras (viejo)', T0, T0);
  dbB.prepare("INSERT INTO db_columns VALUES ('colBold', 'dbShared', 'X', 'title', 0, NULL, ?)").run(T0);
  dbB.prepare('INSERT INTO db_rows VALUES (?, ?, 0, ?, ?)').run('rowBold', 'dbShared', T0, T0);
  dbB.prepare("INSERT INTO db_cells VALUES ('rowBold', 'colBold', 'old B')").run();
  dbB.prepare('INSERT INTO db_databases VALUES (?, ?, ?, NULL, 1, ?, ?)').run('dbLocalB', 'DB-B999', 'Solo B', T0, T0);
  dbB.prepare("INSERT INTO db_columns VALUES ('colLB', 'dbLocalB', 'Y', 'title', 0, NULL, ?)").run(T0);
  dbB.prepare('INSERT INTO db_rows VALUES (?, ?, 0, ?, ?)').run('rowLB', 'dbLocalB', T0, T0);
  dbB.prepare("INSERT INTO db_cells VALUES ('rowLB', 'colLB', 'local only')").run();

  // ── Export from A, merge into B ─────────────────────────────────────────────
  useDb(dbA);
  const pkg = sync.buildSyncPackage('test');
  assert.equal(pkg.counts.notes, 2, 'A exports its two notes');
  assert.equal(pkg.counts.note_folders, 2);
  assert.equal(pkg.counts.databases, 1, 'A exports its one database as a unit');
  assert.equal(pkg.counts.study_courses, 1, 'study tables are included in the portable package');
  assert.equal(pkg.counts.study_materials, 1, 'study material blobs are included');

  useDb(dbB);
  const summary = sync.mergeSyncPackage(pkg.buffer);
  assert.deepEqual(summary.noteFolders, { inserted: 2, updated: 0, skipped: 0 }, 'folder tree arrives whole');
  assert.deepEqual(summary.notes, { inserted: 1, updated: 0, skipped: 1 }, 'n1 inserted; newer local n2 kept');
  assert.deepEqual(summary.writingDrafts, { inserted: 1, updated: 0, skipped: 0 });
  assert.deepEqual(summary.savedSearches, { inserted: 1, updated: 0, skipped: 0 });
  assert.deepEqual(summary.edgeFeedback, { inserted: 0, updated: 1, skipped: 0 }, 'newer rejection overrides older confirm (direction-agnostic)');
  assert.deepEqual(summary.databases, { inserted: 0, updated: 1, skipped: 0 }, 'newer database replaces the whole older local tree');
  assert.deepEqual(summary.study, { inserted: 4, updated: 0, skipped: 1 }, 'study dependencies insert; newer local document wins');

  // The shared database is now A's newer copy, whole (columns, options, cell, blob, relation, view).
  assert.equal(dbB.prepare("SELECT name FROM db_databases WHERE id = 'dbShared'").get().name, 'Muestras', 'database name adopted from A');
  assert.equal(dbB.prepare("SELECT updated_at FROM db_databases WHERE id = 'dbShared'").get().updated_at, T1, 'database updated_at adopted from A');
  assert.equal(dbB.prepare("SELECT COUNT(*) AS n FROM db_columns WHERE database_id = 'dbShared'").get().n, 2, 'both A columns present (old B column gone)');
  assert.equal(dbB.prepare("SELECT label FROM db_select_options WHERE id = 'optS'").get().label, 'Activo', 'select option survived');
  assert.equal(dbB.prepare("SELECT value_text FROM db_cells WHERE row_id = 'rowA' AND column_id = 'colA'").get().value_text, 'from A', 'cell value from A');
  assert.equal(dbB.prepare("SELECT blob FROM db_attachments WHERE id = 'attA'").get().blob.toString(), 'PNGDATA', 'attachment blob restored byte-for-byte');
  assert.equal(dbB.prepare("SELECT COUNT(*) AS n FROM db_relations WHERE row_id = 'rowA'").get().n, 1, 'relation survived');
  assert.equal(dbB.prepare("SELECT COUNT(*) AS n FROM db_views WHERE database_id = 'dbShared'").get().n, 1, 'saved view survived');
  assert.equal(dbB.prepare("SELECT COUNT(*) AS n FROM db_rows WHERE id = 'rowBold'").get().n, 0, 'stale B row replaced away');
  // B's own database is untouched — nothing local deleted.
  assert.equal(dbB.prepare("SELECT name FROM db_databases WHERE id = 'dbLocalB'").get().name, 'Solo B', 'B-only database left intact');
  assert.equal(dbB.prepare("SELECT title FROM study_docs WHERE id = 'docShared'").get().title, 'Tema local más nuevo', 'newer local study row is preserved');
  assert.equal(dbB.prepare("SELECT embedding FROM study_docs WHERE id = 'docShared'").get().embedding.toString(), 'EMBED-B', 'newer local embedding stays byte-exact');
  assert.equal(dbB.prepare("SELECT content_blob FROM study_materials WHERE id = 'materialA'").get().content_blob.toString(), 'MATERIAL-A', 'study material blob restores byte-for-byte');
  assert.equal(dbB.prepare("SELECT course_id FROM study_placements WHERE id = 'placementA'").get().course_id, 'courseA', 'study foreign-key tree survives out-of-order table merge');

  assert.equal(dbB.prepare("SELECT content FROM notes WHERE id = 'n2'").get().content, 'versión nueva de B', 'local newer content preserved');
  assert.equal(dbB.prepare("SELECT folder_id FROM notes WHERE id = 'n1'").get().folder_id, 'f2', 'note keeps its folder');
  assert.equal(dbB.prepare("SELECT parent_id FROM note_folders WHERE id = 'f2'").get().parent_id, 'f1', 'hierarchy preserved');
  assert.equal(dbB.prepare('SELECT COUNT(*) AS n FROM notes').get().n, 3, 'nothing local deleted');
  assert.equal(dbB.prepare('SELECT verdict FROM edge_feedback').get().verdict, 'rejected', 'verdict now matches machine A');

  // ── Idempotence: merging the same package again changes nothing ────────────
  const again = sync.mergeSyncPackage(pkg.buffer);
  assert.equal(again.notes.inserted + again.notes.updated, 0, 'second merge is a no-op for notes');
  assert.equal(again.edgeFeedback.updated, 0, 'second merge is a no-op for feedback');
  assert.deepEqual(again.databases, { inserted: 0, updated: 0, skipped: 1 }, 'equal-timestamp database skipped on re-merge');
  assert.equal(again.study.inserted + again.study.updated, 0, 'second study merge is idempotent');
  assert.equal(dbB.prepare('SELECT COUNT(*) AS n FROM notes').get().n, 3, 'row counts stable');
  assert.equal(dbB.prepare('SELECT COUNT(*) AS n FROM db_databases').get().n, 2, 'database count stable (shared + B-only)');

  // ── Reverse direction: B's layer flows back to A ────────────────────────────
  useDb(dbB);
  const pkgB = sync.buildSyncPackage('test');
  useDb(dbA);
  const back = sync.mergeSyncPackage(pkgB.buffer);
  assert.equal(back.notes.inserted, 1, 'n3 arrives on A');
  assert.equal(back.notes.updated, 1, 'A adopts B’s newer n2');
  assert.equal(dbA.prepare("SELECT content FROM notes WHERE id = 'n2'").get().content, 'versión nueva de B', 'A converges to newest n2');
  assert.equal(back.edgeFeedback.skipped, 1, 'verdict already newest on A');
  assert.deepEqual(back.databases, { inserted: 1, updated: 0, skipped: 1 }, 'B-only database flows to A; shared one already newest');
  assert.equal(dbA.prepare("SELECT name FROM db_databases WHERE id = 'dbLocalB'").get().name, 'Solo B', 'A now has B’s database');
  assert.equal(dbA.prepare("SELECT value_text FROM db_cells WHERE row_id = 'rowLB'").get().value_text, 'local only', 'B-only database arrived whole');

  // ── Tampered packages are refused ───────────────────────────────────────────
  const AdmZip = require('adm-zip');
  const bad = new AdmZip(pkg.buffer);
  const manifest = JSON.parse(bad.readAsText('manifest.json'));
  manifest.counts.notes = 99;
  bad.updateFile('manifest.json', Buffer.from(JSON.stringify(manifest)));
  assert.throws(() => sync.mergeSyncPackage(bad.toBuffer()), /recuento/, 'count mismatch rejected');
  assert.throws(() => sync.mergeSyncPackage(Buffer.from('garbage')), /ilegible|inválido/i, 'garbage rejected');

  dbA.close();
  dbB.close();
  console.log('sync package (two-machine merge) test passed');
} finally {
  await rm(root, { recursive: true, force: true });
}

/** Bundle the real syncPackage module with '../db/database' stubbed to a switchable test DB. */
async function bundleSyncPackage() {
  const stub = path.join(root, 'stub-database.js');
  await writeFile(
    stub,
    'export function getDb() { return globalThis.__syncTestDb; }\nexport const SCHEMA_VERSION = 28;\n'
  );
  // databasesRepo imports ./crossVault (better-sqlite3 + the vault registry / electron).
  // The sync package never exercises cross-vault relations, so stub it out to keep the
  // bundle free of native/electron deps.
  const crossVaultStub = path.join(root, 'stub-crossvault.js');
  await writeFile(
    crossVaultStub,
    'export function searchEntitiesAcrossVaults() { return []; }\n' +
      'export function resolveEntityLabel(_k, id) { return { label: id, broken: true }; }\n' +
      'export function closeCrossVaultConnections() {}\n'
  );
  const out = path.join(root, 'syncPackage.cjs');
  await build({
    entryPoints: [path.join(repoRoot, 'electron/export/syncPackage.ts')],
    outfile: out,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    alias: { '@shared': path.join(repoRoot, 'shared') },
    plugins: [
      {
        name: 'stub-db',
        setup(api) {
          // syncPackage imports '../db/database'; databasesRepo (pulled in transitively)
          // imports './database' — both resolve to the switchable test DB stub.
          api.onResolve({ filter: /\/database$/ }, () => ({ path: stub }));
          api.onResolve({ filter: /\/crossVault$/ }, () => ({ path: crossVaultStub }));
        },
      },
    ],
  });
  return out;
}
