import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
if (!process.argv.includes('--electron-migration-160-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-migration-160-baseline.mjs'), '--electron-migration-160-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-migration-160-'));
installTsHook();
try {
  const Database = require('better-sqlite3');
  const { runMigrations, SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const source = process.env.NODUS_BASELINE_DB;
  const target = path.join(root, 'baseline.sqlite');
  if (source) await copyFile(source, target);
  const db = new Database(target);
  if (!source) runMigrations(db);
  const before = source ? counts(db) : null;
  const hasDocumentJobs = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='document_index_jobs'").get();
  const recoverableLegacyIds = source && hasDocumentJobs
    ? db.prepare(`SELECT nodus_id FROM document_index_jobs
        WHERE campaign_id IS NULL AND reason='deep-research' AND status='paused'
          AND error LIKE 'La fuente cambió repetidamente durante el análisis.%'`).all().map((row) => row.nodus_id)
    : [];
  runMigrations(db);
  assert.equal(db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  assert.equal(SCHEMA_VERSION, 165);
  const workColumns = new Set(db.prepare('PRAGMA table_info(works)').all().map((row) => row.name));
  for (const column of ['resolved_source_type', 'resolved_text_hash', 'text_block_reason', 'resolved_text_notes', 'deep_error', 'deep_queued']) {
    assert.ok(workColumns.has(column), `works.${column} exists`);
  }
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='work_text_sources'").get());
  for (const table of ['evidence', 'passages']) {
    const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
    assert.ok(columns.has('source_ref'));
    assert.ok(columns.has('page_number'));
  }
  for (const table of ['document_sections', 'document_profile_support']) {
    const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
    for (const column of ['source_ref', 'page_start_number', 'page_end_number']) assert.ok(columns.has(column), `${table}.${column} exists`);
  }
  if (before) assert.deepEqual(counts(db), before, 'additive migration preserves corpus row counts');
  assert.deepEqual(db.pragma('quick_check'), [{ quick_check: 'ok' }]);
  assert.equal(db.pragma('foreign_key_check').length, 0);
  for (const nodusId of recoverableLegacyIds) {
    assert.deepEqual(
      db.prepare('SELECT status, attempts, error FROM document_index_jobs WHERE nodus_id=?').get(nodusId),
      { status: 'queued', attempts: 0, error: null },
      `legacy Deep Research profile job ${nodusId} is recovered on the copied vault`
    );
    assert.deepEqual(
      db.prepare('SELECT status, stale_reason, error FROM document_profile_state WHERE nodus_id=?').get(nodusId),
      { status: 'queued', stale_reason: 'legacy_text_fingerprint_recovered', error: null },
      `recovered job ${nodusId} has matching profile state`
    );
  }

  // A database built by a differently-numbered build can sit above the version that
  // introduced the text inventory without ever having created it. That is why the table
  // lives in a CREATE-only body (migration 162) and carries no cascading key: only such
  // a body may be replayed to put it back. Simulate the hole and let the repair run.
  // A database built by an EARLIER build of this branch already ran 160 and 161, so a
  // column appended to 160 afterwards would never reach it: runMigrations only executes
  // bodies above user_version, and the CREATE-only backfill cannot replay an ALTER. Every
  // later column therefore needs its own migration, and this is that database.
  db.exec('ALTER TABLE works DROP COLUMN deep_queued');
  for (const column of ['running_jobs', 'queued_jobs', 'paused_jobs']) {
    db.exec(`ALTER TABLE document_index_campaigns DROP COLUMN ${column}`);
  }
  for (const column of ['progress_message', 'current_unit', 'total_units']) {
    db.exec(`ALTER TABLE document_index_jobs DROP COLUMN ${column}`);
  }
  db.pragma('user_version = 161');
  runMigrations(db);
  assert.ok(
    new Set(db.prepare('PRAGMA table_info(works)').all().map((row) => row.name)).has('deep_queued'),
    'a column added after 160 shipped still reaches a database that stopped at 161'
  );
  assert.equal(db.pragma('user_version', { simple: true }), SCHEMA_VERSION);

  db.prepare('DROP TABLE work_text_sources').run();
  runMigrations(db);
  assert.ok(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='work_text_sources'").get(),
    'the missing text inventory is backfilled without a version bump'
  );
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_work_text_sources_attachment'").get());
  assert.equal(db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  if (before) assert.deepEqual(counts(db), before, 'the repair pass changes no corpus row');

  // v164 repairs exactly the standalone Deep Research jobs affected by the legacy
  // text-fingerprint comparison. A different pause — including a user-paused
  // campaign with the same last error — must remain untouched.
  for (const suffix of ['recover', 'other', 'campaign']) {
    db.prepare('INSERT INTO works(nodus_id, title) VALUES(?, ?)').run(`migration-164-${suffix}`, suffix);
    db.prepare(`INSERT INTO document_profile_state(
      nodus_id,status,stale_reason,error,updated_at
    ) VALUES(?, 'paused', 'source_changed_during_analysis', 'old state error', ?)`).run(
      `migration-164-${suffix}`, new Date().toISOString()
    );
  }
  db.prepare(`INSERT INTO document_index_campaigns(
    campaign_id,vault_id,mode,status,created_at,updated_at
  ) VALUES('migration-164-campaign-id','vault','manual','paused',?,?)`).run(
    new Date().toISOString(), new Date().toISOString()
  );
  const insertPausedJob = db.prepare(`INSERT INTO document_index_jobs(
    job_id,campaign_id,vault_id,nodus_id,reason,status,phase,progress,attempts,max_attempts,error,created_at,updated_at
  ) VALUES(?,?,?,?,?,'paused','failed',0.7,5,5,?,?,?)`);
  const sourceChanged = 'La fuente cambió repetidamente durante el análisis. La campaña se ha pausado para evitar reintentos indefinidos.';
  const now = new Date().toISOString();
  insertPausedJob.run('migration-164-recover-job', null, 'vault', 'migration-164-recover', 'deep-research', sourceChanged, now, now);
  insertPausedJob.run('migration-164-other-job', null, 'vault', 'migration-164-other', 'deep-research', 'El proveedor no respondió.', now, now);
  insertPausedJob.run('migration-164-campaign-job', 'migration-164-campaign-id', 'vault', 'migration-164-campaign', 'deep-research', sourceChanged, now, now);
  for (const column of ['running_jobs', 'queued_jobs', 'paused_jobs']) {
    db.exec(`ALTER TABLE document_index_campaigns DROP COLUMN ${column}`);
  }
  for (const column of ['progress_message', 'current_unit', 'total_units']) {
    db.exec(`ALTER TABLE document_index_jobs DROP COLUMN ${column}`);
  }
  db.pragma('user_version = 163');
  runMigrations(db);
  const recoveredJob = db.prepare("SELECT status, phase, progress, attempts, error FROM document_index_jobs WHERE job_id='migration-164-recover-job'").get();
  assert.deepEqual(recoveredJob, { status: 'queued', phase: 'queued', progress: 0, attempts: 0, error: null });
  assert.deepEqual(
    db.prepare("SELECT status, stale_reason, error FROM document_profile_state WHERE nodus_id='migration-164-recover'").get(),
    { status: 'queued', stale_reason: 'legacy_text_fingerprint_recovered', error: null }
  );
  assert.equal(db.prepare("SELECT status FROM document_index_jobs WHERE job_id='migration-164-other-job'").get().status, 'paused');
  assert.equal(db.prepare("SELECT status FROM document_index_jobs WHERE job_id='migration-164-campaign-job'").get().status, 'paused');
  db.close();
} finally {
  await rm(root, { recursive: true, force: true });
}

function counts(db) {
  return Object.fromEntries(['works', 'work_aliases', 'ideas', 'idea_occurrences', 'evidence', 'scan_checkpoints']
    .map((table) => [table, db.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count]));
}

function installTsHook() {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true, resolveJsonModule: true, skipLibCheck: true },
    }).outputText;
    module._compile(output, filename);
  };
}
