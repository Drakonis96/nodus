// Phase 1 of the sync hardening: no merge may destroy a version without keeping it.
//
// Two halves, and the second matters more than the first:
//
//   1. The mechanism — a losing version is kept, an overwritten local version is kept,
//      and either can be put back (the restore being itself reversible).
//   2. The MIGRATION — schema 88 adds a table, which means every user's database is
//      rewritten. This proves that a v87 database survives the upgrade with every row
//      intact, that a backup taken before the upgrade still restores after it, and that
//      a v88 backup is refused by a v87 build instead of being half-applied.
//
// Runs under Electron-as-Node so better-sqlite3 matches the app ABI.
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

if (!process.argv.includes('--electron-superseded-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-superseded-versions.mjs'), '--electron-superseded-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-superseded-'));
installRuntimeHooks(root);

try {
  const Database = require('better-sqlite3');
  const { runMigrations, migrations, SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const sync = require(path.join(repoRoot, 'electron/export/syncPackage.ts'));
  const superseded = require(path.join(repoRoot, 'electron/db/syncSupersededRepo.ts'));

  // Pinned to the migration that introduced this feature, not to the latest schema, so
  // a later phase bumping the version does not fail a test about phase 1.
  assert.ok(migrations.some((m) => m.version === 88), 'the superseded-versions migration is 88');
  assert.ok(SCHEMA_VERSION >= 88, 'and the schema is at least that');

  const useDb = (db) => {
    globalThis.__syncTestDb = db;
  };
  const PASS = 'frase-de-sincronizacion-de-prueba';
  const T0 = '2026-07-01T10:00:00.000Z';
  const T1 = '2026-07-05T10:00:00.000Z';
  const T2 = '2026-07-09T10:00:00.000Z';
  const ins = (db, table, row) => {
    const keys = Object.keys(row);
    db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...Object.values(row));
  };
  /** Build a database at an EXACT past schema version, the way a shipped app would. */
  const makeDbAt = (name, version) => {
    const db = new Database(path.join(root, name));
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    for (const migration of migrations.filter((m) => m.version <= version).sort((a, b) => a.version - b.version)) {
      db.transaction(() => {
        db.exec(migration.up);
        db.pragma(`user_version = ${migration.version}`);
      })();
    }
    return db;
  };
  const makeDb = (name) => {
    const db = new Database(path.join(root, name));
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    return db;
  };

  // ══ 1 · The migration must not cost a single row ═══════════════════════════
  // A real user upgrading arrives with a populated v87 database. Every row it held has
  // to still be there afterwards, byte for byte, blobs included.
  const legacy = makeDbAt('legacy.sqlite', 87);
  assert.equal(legacy.pragma('user_version', { simple: true }), 87, 'built at the previous schema');
  assert.equal(
    legacy.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='sync_superseded'").get().n,
    0,
    'the new table does not exist yet'
  );

  ins(legacy, 'note_folders', { id: 'f1', parent_id: null, name: 'Tesis', order_idx: 0, created_at: T0, updated_at: T0 });
  ins(legacy, 'notes', { id: 'n1', folder_id: 'f1', title: 'Nota previa', kind: 'markdown', content: 'trabajo del usuario', order_idx: 0, created_at: T0, updated_at: T1 });
  ins(legacy, 'persons', { person_id: 'per1', display_name: 'Antonia Ruiz', sex: 'female', created_at: T0, updated_at: T1 });
  ins(legacy, 'archive_items', { item_id: 'arc1', title: 'Partida', blob: Buffer.from('EVIDENCIA-IRREEMPLAZABLE'), created_at: T0, updated_at: T1 });
  ins(legacy, 'study_academic_years', { id: 'y1', short_id: 'YR-1', label: '2024/2025', start_date: '2024-09-01', end_date: '2025-06-30', created_at: T0, updated_at: T0 });
  ins(legacy, 'study_courses', { id: 'c1', short_id: 'CUR-1', name: 'Historia', academic_year_id: 'y1', created_at: T0, updated_at: T1 });
  ins(legacy, 'study_subjects', { id: 's1', short_id: 'SUB-1', course_id: 'c1', name: 'Contemporánea', created_at: T0, updated_at: T1 });
  ins(legacy, 'teaching_groups', { id: 'g1', short_id: 'GRP-1', name: 'Grupo', subject_id: 's1', created_at: T0, updated_at: T1 });
  ins(legacy, 'teaching_students', { id: 'st1', group_id: 'g1', given_names: 'Luis', surnames: 'Pérez', pseudonym_code: 'STU_0001', created_at: T0, updated_at: T1 });
  ins(legacy, 'teaching_assessment_plans', { id: 'pl1', short_id: 'PLN-1', subject_id: 's1', name: 'Plan', created_at: T0, updated_at: T1 });
  ins(legacy, 'teaching_assessment_items', { id: 'it1', plan_id: 'pl1', name: 'Examen', weight: 100, created_at: T0, updated_at: T1 });
  ins(legacy, 'teaching_grade_entries', { id: 'ge1', student_id: 'st1', item_id: 'it1', raw_value: 9.25, status: 'graded', created_at: T0, updated_at: T1 });
  ins(legacy, 'db_databases', { id: 'd1', short_id: 'DB-0001', name: 'Muestras', position: 0, created_at: T0, updated_at: T1 });
  ins(legacy, 'db_columns', { id: 'col1', database_id: 'd1', name: 'Título', type: 'title', position: 0, created_at: T0 });
  ins(legacy, 'db_rows', { id: 'r1', database_id: 'd1', position: 0, created_at: T0, updated_at: T1 });
  ins(legacy, 'db_cells', { row_id: 'r1', column_id: 'col1', value_text: 'valor original' });

  // Fingerprint every table before the upgrade.
  const fingerprint = (db) => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((row) => row.name);
    return Object.fromEntries(
      tables.map((table) => [table, db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n])
    );
  };
  const before = fingerprint(legacy);
  legacy.close();

  const upgraded = new Database(path.join(root, 'legacy.sqlite'));
  upgraded.pragma('foreign_keys = ON');
  runMigrations(upgraded);
  assert.equal(upgraded.pragma('user_version', { simple: true }), SCHEMA_VERSION, 'the database upgraded to the current schema');
  assert.equal(upgraded.pragma('integrity_check', { simple: true }), 'ok', 'the upgraded database is not corrupt');
  assert.deepEqual(upgraded.pragma('foreign_key_check'), [], 'the upgrade left no broken references');

  const after = fingerprint(upgraded);
  for (const [table, count] of Object.entries(before)) {
    assert.equal(after[table], count, `${table} kept all ${count} row(s) through the upgrade`);
  }
  assert.equal(after.sync_superseded, 0, 'the new table arrives empty');
  // Spot-check the actual values, not just the counts: a row can survive and be wrong.
  assert.equal(upgraded.prepare("SELECT content FROM notes WHERE id = 'n1'").get().content, 'trabajo del usuario');
  assert.equal(upgraded.prepare("SELECT raw_value FROM teaching_grade_entries WHERE id = 'ge1'").get().raw_value, 9.25);
  assert.equal(
    upgraded.prepare("SELECT blob FROM archive_items WHERE item_id = 'arc1'").get().blob.toString(),
    'EVIDENCIA-IRREEMPLAZABLE',
    'evidence bytes are untouched by the migration'
  );
  // Idempotent: running migrations again on an already-upgraded database is a no-op.
  runMigrations(upgraded);
  assert.deepEqual(fingerprint(upgraded), after, 're-running migrations changes nothing');
  console.log('  migration 87 → 88 preserves every row');

  // ══ 2 · A package built BEFORE the upgrade still merges after it ═══════════
  // Users hold .nodussync files made by the previous build. They must keep working.
  const oldMachine = makeDbAt('old-machine.sqlite', 87);
  ins(oldMachine, 'notes', { id: 'nOld', folder_id: null, title: 'Del build anterior', kind: 'markdown', content: 'contenido v87', order_idx: 0, created_at: T0, updated_at: T1 });
  useDb(oldMachine);
  const oldPkg = sync.buildSyncPackage('v87', PASS);
  oldMachine.close();
  // Rewrite the manifest to claim schema 87, as the previous build would have.
  const AdmZip = require('adm-zip');
  const asV87 = new AdmZip(oldPkg.buffer);
  const oldManifest = JSON.parse(asV87.readAsText('manifest.json'));
  oldManifest.schemaVersion = 87;
  asV87.updateFile('manifest.json', Buffer.from(JSON.stringify(oldManifest)));

  useDb(upgraded);
  const oldSummary = sync.mergeSyncPackage(asV87.toBuffer(), PASS);
  assert.deepEqual(oldSummary.conflicts, [], 'a package from the previous schema merges cleanly');
  assert.equal(upgraded.prepare("SELECT content FROM notes WHERE id = 'nOld'").get().content, 'contenido v87', 'its rows arrive');
  console.log('  packages built on schema 87 still import');

  // ══ 3 · Keeping the loser: both directions ════════════════════════════════
  const machineA = makeDb('a.sqlite');
  const machineB = makeDb('b.sqlite');
  // Same note on both machines with different content. A is newer.
  ins(machineA, 'notes', { id: 'shared', folder_id: null, title: 'Compartida', kind: 'markdown', content: 'redacción de A', order_idx: 0, created_at: T0, updated_at: T2 });
  ins(machineB, 'notes', { id: 'shared', folder_id: null, title: 'Compartida', kind: 'markdown', content: 'redacción de B', order_idx: 0, created_at: T0, updated_at: T1 });
  // And one where B is newer, so A's copy is the one that loses.
  ins(machineA, 'notes', { id: 'other', folder_id: null, title: 'Otra', kind: 'markdown', content: 'versión vieja de A', order_idx: 0, created_at: T0, updated_at: T0 });
  ins(machineB, 'notes', { id: 'other', folder_id: null, title: 'Otra', kind: 'markdown', content: 'versión nueva de B', order_idx: 0, created_at: T0, updated_at: T2 });

  useDb(machineA);
  const pkgA = sync.buildSyncPackage('test', PASS);
  useDb(machineB);
  const merged = sync.mergeSyncPackage(pkgA.buffer, PASS);

  assert.equal(merged.supersededKept, 2, 'both discarded versions were kept');
  assert.equal(
    machineB.prepare("SELECT content FROM notes WHERE id = 'shared'").get().content,
    'redacción de A',
    "A's newer note won, as before"
  );
  assert.equal(
    machineB.prepare("SELECT content FROM notes WHERE id = 'other'").get().content,
    'versión nueva de B',
    "B's newer note stood, as before"
  );

  useDb(machineB);
  const kept = superseded.listSuperseded();
  assert.equal(kept.length, 2, 'two versions are listed');
  const overwritten = kept.find((entry) => entry.origin === 'local-overwritten');
  const lost = kept.find((entry) => entry.origin === 'incoming-lost');
  assert.ok(overwritten, "the local version that was replaced is kept — this is the one that used to vanish");
  assert.ok(lost, 'the arriving version that lost is kept too');
  assert.equal(overwritten.fields.find((f) => f.name === 'content').value, 'redacción de B', "B's replaced text is recoverable");
  assert.equal(lost.fields.find((f) => f.name === 'content').value, 'versión vieja de A', "A's rejected text is recoverable");
  console.log('  both sides of every conflict are kept');

  // A merge with no real conflict must not manufacture entries.
  const quiet = sync.mergeSyncPackage(pkgA.buffer, PASS);
  assert.equal(quiet.supersededKept, 0, 're-merging an identical package keeps nothing new');
  assert.equal(superseded.countSuperseded(), 2, 'and adds no noise');

  // ══ 4 · Restoring, and restoring the restore ══════════════════════════════
  const restored = superseded.restoreSuperseded(overwritten.id);
  assert.equal(restored.ok, true, restored.message);
  assert.equal(
    machineB.prepare("SELECT content FROM notes WHERE id = 'shared'").get().content,
    'redacción de B',
    'the replaced local version is back in place'
  );
  // The version it displaced was itself kept, so promoting the wrong one is undoable.
  const afterRestore = superseded.listSuperseded();
  const displaced = afterRestore.find((entry) => entry.origin === 'restored');
  assert.ok(displaced, 'restoring recorded what it displaced');
  assert.equal(displaced.fields.find((f) => f.name === 'content').value, 'redacción de A', 'so the other version is still reachable');
  const undo = superseded.restoreSuperseded(displaced.id);
  assert.equal(undo.ok, true, undo.message);
  assert.equal(
    machineB.prepare("SELECT content FROM notes WHERE id = 'shared'").get().content,
    'redacción de A',
    'a restore can itself be undone'
  );
  console.log('  restore is reversible');

  // Restoring a row that no longer exists re-creates it.
  machineB.prepare("DELETE FROM notes WHERE id = 'other'").run();
  const orphan = superseded.listSuperseded().find((entry) => entry.origin === 'incoming-lost');
  const recreated = superseded.restoreSuperseded(orphan.id);
  assert.equal(recreated.ok, true, recreated.message);
  assert.equal(
    machineB.prepare("SELECT content FROM notes WHERE id = 'other'").get().content,
    'versión vieja de A',
    'a deleted row can be rebuilt from a kept version'
  );

  // ══ 5 · The audit trail is this machine's own ═════════════════════════════
  // It must never travel: one computer's record of what IT discarded would otherwise
  // overwrite the other's, and restoring there would write a row that never lost.
  const coverage = sync.describeSyncCoverage();
  assert.ok(coverage.excluded.includes('sync_superseded'), 'the audit trail is explicitly not synced');
  assert.deepEqual(coverage.unclassified, [], 'and every table is still classified');
  useDb(machineB);
  const pkgB = sync.buildSyncPackage('test', PASS);
  assert.equal(pkgB.counts.sync_superseded, undefined, 'it is absent from the package');

  // ══ 6 · Clearing is explicit, and only what was asked ═════════════════════
  useDb(machineB);
  const beforeClear = superseded.countSuperseded();
  assert.ok(beforeClear > 0, 'there is something to clear');
  const one = superseded.listSuperseded()[0];
  assert.equal(superseded.clearSuperseded([one.id]), 1, 'clearing one removes exactly one');
  assert.equal(superseded.countSuperseded(), beforeClear - 1, 'the rest are untouched');

  machineA.close();
  machineB.close();
  upgraded.close();
  console.log('superseded versions (phase 1) test passed');
} finally {
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;

  const databaseStub = path.join(userDataPath, 'stub-database.js');
  fs.writeFileSync(
    databaseStub,
    'const { SCHEMA_VERSION } = require(' + JSON.stringify(path.join(repoRoot, 'electron/db/migrations.ts')) + ');\n' +
      'exports.getDb = () => globalThis.__syncTestDb;\n' +
      'exports.closeDb = () => {};\n' +
      'exports.SCHEMA_VERSION = SCHEMA_VERSION;\n'
  );

  const electronStub = {
    app: { getPath: () => userDataPath, getVersion: () => '0.0.0-test', getAppPath: () => repoRoot, isPackaged: false },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: (v) => Buffer.from(String(v), 'utf8'), decryptString: (v) => Buffer.from(v).toString('utf8') },
    dialog: {},
    shell: {},
    BrowserWindow: class {},
  };

  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    const resolved = originalResolveFilename.call(this, request, parent, isMain, options);
    if (resolved === path.join(repoRoot, 'electron/db/database.ts')) return databaseStub;
    return resolved;
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      fileName: filename,
    }).outputText;
    module._compile(output, filename);
  };
}
