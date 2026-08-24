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
  runMigrations(db);
  assert.equal(db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  assert.equal(SCHEMA_VERSION, 161);
  const workColumns = new Set(db.prepare('PRAGMA table_info(works)').all().map((row) => row.name));
  for (const column of ['resolved_source_type', 'resolved_text_hash', 'text_block_reason', 'resolved_text_notes', 'deep_error']) {
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
