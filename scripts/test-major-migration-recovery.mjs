// Schema migration recovery against real SQLite. Runs under Electron-as-Node so the
// native driver exactly matches the desktop runtime.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-major-migration-recovery')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [fileURLToPath(import.meta.url), '--electron-major-migration-recovery'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' },
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-major-migration-'));
installRuntimeHooks();
const Database = require('better-sqlite3');
const { migrations, runMigrations, SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
const { migrateDatabaseSafely, listMigrationRecoverySnapshots, MAJOR_SCHEMA_VERSIONS } = require(
  path.join(repoRoot, 'electron/db/migrationSafety.ts'),
);

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function databaseAt(version, name) {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'nodus.sqlite');
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  for (const migration of migrations.filter((item) => item.version <= version).sort((a, b) => a.version - b.version)) {
    db.transaction(() => {
      db.exec(migration.up);
      migration.after?.(db);
      db.pragma(`user_version = ${migration.version}`);
    })();
  }
  return { file, db };
}

function seedDatabase(db, version = 133) {
  const now = '2026-08-14T00:00:00.000Z';
  db.prepare('INSERT INTO db_databases (id, short_id, name, position, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)')
    .run('db1', 'DB-QA01', 'Muestras históricas', now, now);
  db.prepare('INSERT INTO db_columns (id, database_id, name, type, position, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('title', 'db1', 'Nombre', 'title', 0, now);
  db.prepare('INSERT INTO db_rows (id, database_id, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('row1', 'db1', 0, now, now);
  db.prepare('INSERT INTO db_rows (id, database_id, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('row2', 'db1', 1, now, now);
  db.prepare('INSERT INTO db_cells (row_id, column_id, value_text) VALUES (?, ?, ?)').run('row1', 'title', 'Valor irreemplazable');
  if (version >= 47) {
    db.prepare('INSERT INTO db_columns (id, database_id, name, type, position, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('attachment', 'db1', 'Archivo', 'attachment', 1, now);
    db.prepare('INSERT INTO db_attachments (id, row_id, column_id, file_name, bytes, blob, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('att1', 'row1', 'attachment', 'prueba.bin', 8, Buffer.from('BLOB-QA!'), 'hash-qa', now);
  }
  if (version >= 48) {
    db.prepare('INSERT INTO db_columns (id, database_id, name, type, position, config_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('relation', 'db1', 'Relacionado', 'relation', 2, JSON.stringify({ relationTargetKind: 'db_row', relationTargetDatabaseId: 'db1' }), now);
    db.prepare('INSERT INTO db_relations (id, row_id, column_id, target_kind, target_id, position, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)')
      .run('rel1', 'row1', 'relation', 'db_row', 'row2', now);
  }
  if (version >= 49) {
    db.prepare('INSERT INTO db_views (id, database_id, name, layout, position, created_at) VALUES (?, ?, ?, ?, 0, ?)')
      .run('view1', 'db1', 'Todas', 'table', now);
  }
}

try {
  assert.ok(SCHEMA_VERSION >= 135, 'this test tracks the current Notion-parity major boundary');
  assert.ok(MAJOR_SCHEMA_VERSIONS.includes(134));
  assert.ok(MAJOR_SCHEMA_VERSIONS.includes(135));

  // Representative fixtures cover the databases-mode boundary and every later schema era.
  for (const historicalVersion of [46, 47, 48, 49, 51, 87, 104, 120, 129, 133]) {
    const success = databaseAt(historicalVersion, `success-v${historicalVersion}`);
    seedDatabase(success.db, historicalVersion);
    success.db.pragma('wal_checkpoint(TRUNCATE)');
    const originalHash = sha256(success.file);
    let migrated = migrateDatabaseSafely(success.db, success.file, SCHEMA_VERSION, runMigrations);
    assert.equal(migrated.pragma('user_version', { simple: true }), SCHEMA_VERSION);
    assert.equal(migrated.prepare("SELECT value_text FROM db_cells WHERE row_id='row1' AND column_id='title'").get().value_text, 'Valor irreemplazable');
    if (historicalVersion >= 47) assert.equal(migrated.prepare("SELECT data FROM db_blobs WHERE hash = (SELECT blob_hash FROM db_attachments WHERE id='att1')").get().data.toString(), 'BLOB-QA!');
    if (historicalVersion >= 48) assert.equal(migrated.prepare('SELECT COUNT(*) AS n FROM db_relations').get().n, 1);
    if (historicalVersion >= 49) assert.equal(migrated.prepare('SELECT COUNT(*) AS n FROM db_views').get().n, 1);
    assert.deepEqual(migrated.pragma('foreign_key_check'), []);
    migrated.close();

    const snapshots = listMigrationRecoverySnapshots(success.file);
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].sha256, originalHash, `v${historicalVersion} snapshot is byte-for-byte exact`);
    assert.equal(snapshots[0].quickCheck, 'ok');
    assert.equal(snapshots[0].immutable, true);
    assert.equal(fs.statSync(snapshots[0].databasePath).mode & 0o222, 0, 'snapshot has no writable bits');
  }

  // Failure path: even a deliberately non-transactional partial migration is undone.
  const failure = databaseAt(134, 'failure.sqlite');
  seedDatabase(failure.db, 134);
  failure.db.pragma('wal_checkpoint(TRUNCATE)');
  const failureOriginalHash = sha256(failure.file);
  assert.throws(
    () => migrateDatabaseSafely(failure.db, failure.file, SCHEMA_VERSION, (db) => {
      db.exec('CREATE TABLE migration_should_disappear (id TEXT PRIMARY KEY)');
      db.pragma(`user_version = ${SCHEMA_VERSION}`);
      throw new Error('fallo provocado por la prueba');
    }),
    /restauró automáticamente/,
  );
  assert.equal(sha256(failure.file), failureOriginalHash, 'automatic restore is the exact original bytes');
  const restored = new Database(failure.file, { readonly: true, fileMustExist: true });
  assert.equal(restored.pragma('user_version', { simple: true }), 134);
  assert.equal(restored.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='migration_should_disappear'").get().n, 0);
  assert.equal(restored.prepare("SELECT value_text FROM db_cells WHERE row_id='row1' AND column_id='title'").get().value_text, 'Valor irreemplazable');
  assert.equal(restored.pragma('quick_check', { simple: true }), 'ok');
  restored.close();

  const reportsDir = path.join(path.dirname(failure.file), '.nodus', 'migrations');
  const reports = fs.readdirSync(reportsDir).filter((name) => name.startsWith('report-'));
  const failedReport = reports.map((name) => JSON.parse(fs.readFileSync(path.join(reportsDir, name), 'utf8')))
    .find((report) => report.sourceDatabasePath === failure.file);
  assert.equal(failedReport.status, 'failed-restored');
  assert.equal(failedReport.before.tables.db_cells, 1);

  console.log('Major migration recovery test passed!');
} finally {
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks() {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
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
