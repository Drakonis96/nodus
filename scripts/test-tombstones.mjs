// Phase 2: deletions propagate instead of resurrecting.
//
// The dangerous half of this feature is not "does a delete travel" — it is everything
// that must NOT be treated as a deletion. Several repositories save by clearing and
// rewriting rows with the same ids (the timetable does exactly this), the merge itself
// deletes rows it just inserted when a foreign key dangles, and restoring a superseded
// version re-creates a row that a tombstone says is dead. Any of those leaking into a
// tombstone would delete the user's data on the OTHER machine, which is the worst
// possible outcome for a sync feature.
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

if (!process.argv.includes('--electron-tombstones-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-tombstones.mjs'), '--electron-tombstones-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-tombstones-'));
installRuntimeHooks(root);

try {
  const Database = require('better-sqlite3');
  const { runMigrations, migrations, SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const { ensureTombstoneTriggers, pruneTombstones, packageIsOlderThanHorizon, TOMBSTONE_HORIZON_DAYS } =
    require(path.join(repoRoot, 'electron/db/tombstones.ts'));
  const sync = require(path.join(repoRoot, 'electron/export/syncPackage.ts'));
  const superseded = require(path.join(repoRoot, 'electron/db/syncSupersededRepo.ts'));

  assert.ok(migrations.some((m) => m.version === 89), 'the tombstone migration is 89');

  const useDb = (db) => {
    globalThis.__syncTestDb = db;
  };
  const PASS = 'frase-de-sincronizacion-de-prueba';
  const T0 = '2026-07-01T10:00:00.000Z';
  const T1 = '2026-07-05T10:00:00.000Z';
  const ins = (db, table, row) => {
    const keys = Object.keys(row);
    db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...Object.values(row));
  };
  const makeDbAt = (name, version) => {
    const db = new Database(path.join(root, name));
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    for (const migration of migrations.filter((m) => m.version <= version).sort((a, b) => a.version - b.version)) {
      db.transaction(() => { db.exec(migration.up); db.pragma(`user_version = ${migration.version}`); })();
    }
    return db;
  };
  /** A database opened the way the app opens one: migrated, with triggers installed. */
  const openDb = (name) => {
    const db = new Database(path.join(root, name));
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    useDb(db);
    ensureTombstoneTriggers(db);
    return db;
  };
  const tombstones = (db) => db.prepare('SELECT table_name, row_key, deleted_at FROM sync_tombstones ORDER BY table_name, row_key').all();

  // ══ 1 · The migration must not cost a single row ═══════════════════════════
  const legacy = makeDbAt('legacy.sqlite', 88);
  ins(legacy, 'notes', { id: 'nKeep', folder_id: null, title: 'Previa', kind: 'markdown', content: 'trabajo anterior', order_idx: 0, created_at: T0, updated_at: T1 });
  ins(legacy, 'persons', { person_id: 'perKeep', display_name: 'Antonia', sex: 'female', created_at: T0, updated_at: T1 });
  ins(legacy, 'archive_items', { item_id: 'arcKeep', title: 'Partida', blob: Buffer.from('EVIDENCIA'), created_at: T0, updated_at: T1 });
  const fingerprint = (db) =>
    Object.fromEntries(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
        .map((row) => [row.name, db.prepare(`SELECT COUNT(*) AS n FROM "${row.name}"`).get().n])
    );
  const before = fingerprint(legacy);
  legacy.close();

  const upgraded = new Database(path.join(root, 'legacy.sqlite'));
  upgraded.pragma('foreign_keys = ON');
  runMigrations(upgraded);
  useDb(upgraded);
  ensureTombstoneTriggers(upgraded);
  assert.equal(upgraded.pragma('user_version', { simple: true }), SCHEMA_VERSION, 'upgraded to the current schema');
  assert.equal(upgraded.pragma('integrity_check', { simple: true }), 'ok', 'not corrupt');
  assert.deepEqual(upgraded.pragma('foreign_key_check'), [], 'no broken references');
  for (const [table, count] of Object.entries(before)) {
    assert.equal(fingerprint(upgraded)[table], count, `${table} kept all ${count} row(s)`);
  }
  assert.equal(upgraded.prepare("SELECT blob FROM archive_items WHERE item_id = 'arcKeep'").get().blob.toString(), 'EVIDENCIA', 'evidence bytes intact');
  // Installing triggers must not itself invent deletions.
  assert.deepEqual(tombstones(upgraded), [], 'upgrading writes no tombstones');
  upgraded.close();

  // ══ 2 · A deletion is recorded, and its key matches what the merge writes ══
  const machineA = openDb('a.sqlite');
  const machineB = openDb('b.sqlite');

  ins(machineA, 'notes', { id: 'nDoomed', folder_id: null, title: 'Se borrará', kind: 'markdown', content: 'contenido a borrar', order_idx: 0, created_at: T0, updated_at: T0 });
  ins(machineA, 'notes', { id: 'nAlive', folder_id: null, title: 'Sobrevive', kind: 'markdown', content: 'sigue viva', order_idx: 0, created_at: T0, updated_at: T0 });
  useDb(machineA);
  // First sync: B learns about both notes.
  const seed = sync.buildSyncPackage('test', PASS);
  useDb(machineB);
  sync.mergeSyncPackage(seed.buffer, PASS);
  assert.equal(machineB.prepare('SELECT COUNT(*) AS n FROM notes').get().n, 2, 'both notes reached B');

  // Now A deletes one.
  useDb(machineA);
  machineA.prepare("DELETE FROM notes WHERE id = 'nDoomed'").run();
  const written = tombstones(machineA);
  assert.equal(written.length, 1, 'the deletion left exactly one tombstone');
  assert.equal(written[0].table_name, 'notes');
  // The trigger writes the key with json_array(); the merge writes it with
  // JSON.stringify(). If those ever disagree, tombstones silently stop matching rows.
  assert.equal(written[0].row_key, JSON.stringify(['nDoomed']), 'SQL-written and JS-written keys are identical');

  // ══ 3 · The deletion travels, and what it removes stays recoverable ════════
  const withDeletion = sync.buildSyncPackage('test', PASS);
  useDb(machineB);
  const applied = sync.mergeSyncPackage(withDeletion.buffer, PASS);
  assert.equal(applied.deletionsApplied, 1, 'the deletion was applied on B');
  assert.equal(machineB.prepare("SELECT COUNT(*) AS n FROM notes WHERE id = 'nDoomed'").get().n, 0, 'the note is gone on B');
  assert.equal(machineB.prepare("SELECT COUNT(*) AS n FROM notes WHERE id = 'nAlive'").get().n, 1, 'the other note is untouched');

  // A deletion arriving from another computer is never the end of the story.
  const removed = superseded.listSuperseded().find((entry) => entry.origin === 'deleted-remotely');
  assert.ok(removed, 'the removed row was kept');
  assert.equal(removed.fields.find((f) => f.name === 'content').value, 'contenido a borrar', 'with its content');

  // ══ 4 · And it STAYS deleted — the whole point ═════════════════════════════
  // Re-importing the package built BEFORE the deletion is exactly the situation that
  // used to resurrect the note on every single sync, in both directions, forever.
  useDb(machineB);
  const resurrect = sync.mergeSyncPackage(seed.buffer, PASS);
  assert.equal(machineB.prepare("SELECT COUNT(*) AS n FROM notes WHERE id = 'nDoomed'").get().n, 0, 'an older package does not bring it back');
  assert.equal(resurrect.groups.notes.inserted, 0, 'and reports no insert');
  // Same from A's side, where the deletion originated.
  useDb(machineA);
  sync.mergeSyncPackage(seed.buffer, PASS);
  assert.equal(machineA.prepare("SELECT COUNT(*) AS n FROM notes WHERE id = 'nDoomed'").get().n, 0, 'nor on the machine that deleted it');

  // ══ 5 · An edit made AFTER the deletion wins ══════════════════════════════
  // Deleting is not sacred: if the other machine edited the row later, that edit is the
  // newer fact and the row is genuinely worth bringing back.
  const laterEdit = new Date(Date.now() + 60_000).toISOString();
  const reviveDb = openDb('c.sqlite');
  useDb(reviveDb);
  ins(reviveDb, 'notes', { id: 'nDoomed', folder_id: null, title: 'Reescrita', kind: 'markdown', content: 'editada después del borrado', order_idx: 0, created_at: T0, updated_at: laterEdit });
  const revivePkg = sync.buildSyncPackage('test', PASS);
  useDb(machineB);
  sync.mergeSyncPackage(revivePkg.buffer, PASS);
  assert.equal(
    machineB.prepare("SELECT content FROM notes WHERE id = 'nDoomed'").get()?.content,
    'editada después del borrado',
    'an edit newer than the tombstone revives the row'
  );

  // ══ 6 · Save-by-rewrite must NOT look like a deletion ═════════════════════
  // The timetable clears every period for a year and re-inserts them with the same ids.
  // Without the INSERT trigger clearing the tombstone, an ordinary save would tell the
  // other machine to delete the user's timetable.
  useDb(machineA);
  ins(machineA, 'study_schedule_periods', { id: 'p1', section: 'morning', label: 'Primera', start_time: '08:00', end_time: '09:00', position: 0, academic_year_id: null });
  const tombsBefore = tombstones(machineA).length;
  machineA.transaction(() => {
    machineA.prepare("DELETE FROM study_schedule_periods WHERE academic_year_id IS NULL").run();
    ins(machineA, 'study_schedule_periods', { id: 'p1', section: 'morning', label: 'Primera (editada)', start_time: '08:15', end_time: '09:15', position: 0, academic_year_id: null });
  })();
  assert.equal(
    tombstones(machineA).length,
    tombsBefore,
    'clearing and rewriting a row with the same id leaves no tombstone'
  );
  assert.equal(machineA.prepare("SELECT label FROM study_schedule_periods WHERE id = 'p1'").get().label, 'Primera (editada)', 'and the row is there');

  // A row genuinely removed by such a save IS a deletion and must be recorded.
  ins(machineA, 'study_schedule_periods', { id: 'p2', section: 'morning', label: 'Segunda', start_time: '09:00', end_time: '10:00', position: 1, academic_year_id: null });
  machineA.transaction(() => {
    machineA.prepare("DELETE FROM study_schedule_periods WHERE academic_year_id IS NULL").run();
    ins(machineA, 'study_schedule_periods', { id: 'p1', section: 'morning', label: 'Primera', start_time: '08:00', end_time: '09:00', position: 0, academic_year_id: null });
  })();
  assert.ok(
    tombstones(machineA).some((row) => row.table_name === 'study_schedule_periods' && row.row_key === JSON.stringify(['p2'])),
    'a row that really disappeared in the rewrite is tombstoned'
  );

  // ══ 7 · Cascades are covered ══════════════════════════════════════════════
  useDb(machineA);
  ins(machineA, 'db_databases', { id: 'dbX', short_id: 'DB-X001', name: 'Muestras', position: 0, created_at: T0, updated_at: T1 });
  ins(machineA, 'db_columns', { id: 'colX', database_id: 'dbX', name: 'T', type: 'title', position: 0, created_at: T0 });
  ins(machineA, 'db_rows', { id: 'rowX', database_id: 'dbX', position: 0, created_at: T0, updated_at: T1 });
  machineA.prepare("DELETE FROM db_databases WHERE id = 'dbX'").run();
  const cascade = tombstones(machineA);
  assert.ok(cascade.some((r) => r.table_name === 'db_databases' && r.row_key === JSON.stringify(['dbX'])), 'the database is tombstoned');
  assert.ok(cascade.some((r) => r.table_name === 'db_rows' && r.row_key === JSON.stringify(['rowX'])), 'its cascaded child rows are too');

  // ══ 8 · Restoring a deleted row makes it stick ════════════════════════════
  // Restoring writes a row a tombstone says is dead. Without a fresh timestamp the next
  // sync would delete it again and the user would watch their recovery undo itself.
  useDb(machineB);
  const recoverable = superseded.listSuperseded().find((entry) => entry.origin === 'deleted-remotely');
  assert.ok(recoverable, 'the remotely-deleted row is still recoverable');
  const restored = superseded.restoreSuperseded(recoverable.id);
  assert.equal(restored.ok, true, restored.message);
  assert.equal(machineB.prepare("SELECT COUNT(*) AS n FROM notes WHERE id = 'nDoomed'").get().n, 1, 'the row is back');
  assert.equal(
    machineB.prepare("SELECT COUNT(*) AS n FROM sync_tombstones WHERE table_name = 'notes' AND row_key = ?").get(JSON.stringify(['nDoomed'])).n,
    0,
    'and its tombstone is gone, so the next sync will not re-delete it'
  );
  // Prove it: re-import the package that carries the deletion.
  const restoredContent = machineB.prepare("SELECT content FROM notes WHERE id = 'nDoomed'").get().content;
  sync.mergeSyncPackage(withDeletion.buffer, PASS);
  assert.equal(
    machineB.prepare("SELECT content FROM notes WHERE id = 'nDoomed'").get()?.content,
    restoredContent,
    'the recovered row survives a sync carrying the original deletion'
  );

  // ══ 9 · Housekeeping deletes must not become deletions ════════════════════
  // The merge drops rows it inserted whose foreign keys dangle. That is internal
  // cleanup; if it left a tombstone, the next sync would carry a deletion nobody asked
  // for back to the machine the row came from.
  const orphanSource = openDb('d.sqlite');
  useDb(orphanSource);
  // Seeded with foreign keys off so the child genuinely has no parent to travel with,
  // which is what a partial or hand-edited package looks like on arrival.
  orphanSource.pragma('foreign_keys = OFF');
  ins(orphanSource, 'db_columns', { id: 'colOrphan', database_id: 'noExiste', name: 'T', type: 'title', position: 0, created_at: T0 });
  orphanSource.pragma('foreign_keys = ON');
  const orphanPkg = sync.buildSyncPackage('test', PASS);

  const orphanTarget = openDb('e.sqlite');
  useDb(orphanTarget);
  const orphanResult = sync.mergeSyncPackage(orphanPkg.buffer, PASS);
  assert.ok(orphanResult.conflicts.some((c) => c.reason === 'missing-parent'), 'the dangling row was dropped and reported');
  assert.equal(
    orphanTarget.prepare("SELECT COUNT(*) AS n FROM db_columns WHERE id = 'colOrphan'").get().n,
    0,
    'and it is not left behind'
  );
  assert.deepEqual(
    tombstones(orphanTarget).filter((row) => row.table_name === 'db_columns'),
    [],
    'dropping it left no tombstone to propagate'
  );

  // ══ 10 · The horizon is honest about its own limits ═══════════════════════
  useDb(machineA);
  const old = new Date(Date.now() - (TOMBSTONE_HORIZON_DAYS + 10) * 86400e3).toISOString();
  machineA.prepare('INSERT INTO sync_tombstones (table_name, row_key, deleted_at) VALUES (?, ?, ?)').run('notes', '["ancient"]', old);
  const recent = tombstones(machineA).length;
  assert.equal(pruneTombstones(machineA), 1, 'a tombstone past the horizon is forgotten');
  assert.equal(tombstones(machineA).length, recent - 1, 'and only that one');
  assert.equal(packageIsOlderThanHorizon(old), true, 'a package that old is flagged');
  assert.equal(packageIsOlderThanHorizon(new Date().toISOString()), false, 'a fresh one is not');
  assert.equal(packageIsOlderThanHorizon(null), false, 'and a missing date is not an error');

  machineA.close();
  machineB.close();
  reviveDb.close();
  orphanSource.close();
  orphanTarget.close();
  console.log('tombstones (phase 2) test passed');
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
