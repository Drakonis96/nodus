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
  const { migrations, runMigrations, SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
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
  assert.ok(SCHEMA_VERSION >= 166, `expected schema v166 or later, got v${SCHEMA_VERSION}`);
  const workColumns = new Set(db.prepare('PRAGMA table_info(works)').all().map((row) => row.name));
  for (const column of ['resolved_source_type', 'resolved_text_hash', 'text_block_reason', 'resolved_text_notes', 'deep_error', 'deep_queued', 'summary_error', 'zotero_title_markup']) {
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
  const dictionaryVersionColumns = new Set(
    db.prepare('PRAGMA table_info(dictionary_versions)').all().map((row) => row.name)
  );
  for (const column of ['outcome', 'degradation_reason', 'generation_attempts', 'generation_problems_json']) {
    assert.ok(dictionaryVersionColumns.has(column), `dictionary_versions.${column} exists`);
  }
  const legacyDictionaryDb = new Database(path.join(root, 'dictionary-v165.sqlite'));
  legacyDictionaryDb.exec(`
    CREATE TABLE dictionary_entries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      aliases_json TEXT NOT NULL DEFAULT '[]',
      focus_prompt TEXT NOT NULL DEFAULT '',
      scope_kind TEXT NOT NULL CHECK (scope_kind IN ('vault','authors','works','tags_collections')),
      scope_json TEXT NOT NULL,
      output_language TEXT NOT NULL DEFAULT 'es',
      detail_level TEXT NOT NULL DEFAULT 'standard' CHECK (detail_level IN ('concise','standard','detailed')),
      tags_json TEXT NOT NULL DEFAULT '[]',
      content_markdown TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
      current_version_id TEXT,
      proposed_version_id TEXT,
      insufficient_evidence INTEGER NOT NULL DEFAULT 0,
      new_evidence_count INTEGER NOT NULL DEFAULT 0,
      last_evidence_scan_at TEXT,
      last_change_seq INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE dictionary_versions (
      id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL,
      content_markdown TEXT NOT NULL,
      evidence_json TEXT NOT NULL DEFAULT '[]',
      evidence_snapshot_json TEXT NOT NULL DEFAULT '[]',
      citations_json TEXT NOT NULL DEFAULT '[]',
      author_summaries_json TEXT NOT NULL DEFAULT '[]',
      focus_prompt TEXT NOT NULL,
      scope_json TEXT NOT NULL,
      output_language TEXT NOT NULL,
      detail_level TEXT NOT NULL,
      model_json TEXT,
      generated_at TEXT NOT NULL,
      trigger TEXT NOT NULL CHECK (trigger IN ('creation','update','regeneration','manual_edit','restore')),
      state TEXT NOT NULL CHECK (state IN ('applied','proposed')),
      insufficient_evidence INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX dictionary_versions_entry_idx ON dictionary_versions(entry_id, generated_at DESC);
    CREATE INDEX dictionary_versions_proposed_idx ON dictionary_versions(entry_id, state, generated_at DESC);
  `);
  const insertLegacyEntry = legacyDictionaryDb.prepare(`INSERT INTO dictionary_entries(
    id,name,normalized_name,scope_kind,scope_json,content_markdown,status,current_version_id,proposed_version_id,created_at,updated_at
  ) VALUES(?,?,?,'vault','{}',?,'active',?,?,?,?)`);
  const legacyFallback = '## Evidencia verificable\n\n> Una retahíla extractiva.';
  insertLegacyEntry.run('legacy-recover','Legacy recover','legacy recover',legacyFallback,'fallback-recover','fallback-recover','2026-01-01','2026-01-03');
  insertLegacyEntry.run('legacy-draft','Legacy draft','legacy draft',legacyFallback,'fallback-draft','fallback-draft','2026-01-01','2026-01-03');
  const insertLegacyVersion = legacyDictionaryDb.prepare(`INSERT INTO dictionary_versions(
    id,entry_id,content_markdown,focus_prompt,scope_json,output_language,detail_level,model_json,generated_at,trigger,state,created_at,updated_at
  ) VALUES(?,?,?,'','{}','es','standard',?,?,?,'applied',?,?)`);
  insertLegacyVersion.run('good-recover','legacy-recover','Una síntesis anterior válida.',null,'2026-01-01','creation','2026-01-01','2026-01-01');
  insertLegacyVersion.run('fallback-recover','legacy-recover',legacyFallback,null,'2026-01-02','regeneration','2026-01-02','2026-01-02');
  insertLegacyVersion.run('fallback-draft','legacy-draft',legacyFallback,null,'2026-01-02','creation','2026-01-02','2026-01-02');
  legacyDictionaryDb.exec(migrations.find((migration) => migration.version === 166).up);
  assert.deepEqual(
    legacyDictionaryDb.prepare(`SELECT state,outcome,degradation_reason FROM dictionary_versions WHERE id='fallback-recover'`).get(),
    { state: 'degraded', outcome: 'degraded', degradation_reason: 'legacy_extractive_fallback' },
    'v166 identifies the legacy extractive fallback even when no explicit model was persisted'
  );
  assert.deepEqual(
    legacyDictionaryDb.prepare(`SELECT current_version_id,proposed_version_id,content_markdown,status FROM dictionary_entries WHERE id='legacy-recover'`).get(),
    { current_version_id: 'good-recover', proposed_version_id: null, content_markdown: 'Una síntesis anterior válida.', status: 'active' },
    'v166 restores the last good synthesis instead of keeping the extractive fallback current'
  );
  assert.deepEqual(
    legacyDictionaryDb.prepare(`SELECT current_version_id,proposed_version_id,content_markdown,status FROM dictionary_entries WHERE id='legacy-draft'`).get(),
    { current_version_id: null, proposed_version_id: null, content_markdown: '', status: 'draft' },
    'v166 returns a first-generation legacy fallback to draft without discarding its version record'
  );
  legacyDictionaryDb.close();

  // v172-v173 upgrade a real v171 vault in place: preserve its sync fingerprint,
  // expose the failure-reason column, and move Zotero markup away from UI text.
  db.exec('ALTER TABLE works DROP COLUMN summary_error; ALTER TABLE works DROP COLUMN zotero_title_markup;');
  const rawRichTitle = '<span style="font-variant:small-caps;">CLE</span> peptides &amp; plant-biotic interactions';
  db.prepare(`INSERT INTO works(nodus_id,zotero_key,zotero_version,zotero_fingerprint,title,summary_status)
    VALUES('migration-173-rich','RICH',0,'stable-fingerprint',?,'failed')`).run(rawRichTitle);
  db.prepare(`INSERT INTO works(nodus_id,title) VALUES('migration-173-empty','<i></i>')`).run();
  db.pragma('user_version = 171');
  runMigrations(db);
  assert.deepEqual(
    db.prepare(`SELECT title,zotero_title_markup,zotero_fingerprint,summary_error
      FROM works WHERE nodus_id='migration-173-rich'`).get(),
    {
      title: 'CLE peptides & plant-biotic interactions',
      zotero_title_markup: rawRichTitle,
      zotero_fingerprint: 'stable-fingerprint',
      summary_error: null,
    },
    'the title migration is display-safe without causing a false Zotero revision',
  );
  assert.deepEqual(
    db.prepare(`SELECT title,zotero_title_markup FROM works WHERE nodus_id='migration-173-empty'`).get(),
    { title: '(sin título)', zotero_title_markup: '<i></i>' },
    'markup-only legacy titles receive a safe fallback while retaining the original value',
  );
  runMigrations(db);
  assert.equal(
    db.prepare(`SELECT zotero_title_markup FROM works WHERE nodus_id='migration-173-rich'`).get().zotero_title_markup,
    rawRichTitle,
    'the data migration is idempotent',
  );
  db.prepare(`DELETE FROM works WHERE nodus_id IN ('migration-173-rich','migration-173-empty')`).run();
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
