// Verifies migration 52: the genealogy Archive's single-parent folders become a
// "Carpeta" multi-select backed by archive_item_folders, and EVERY existing folder
// assignment is preserved (nothing lost). Builds a DB at schema v51, inserts legacy
// folder/item rows, then applies migration 52 and asserts the backfill.

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

if (!process.argv.includes('--electron-migration-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-archive-migration-52.mjs'), '--electron-migration-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-migration52-test-'));
installTsHook();

try {
  const Database = require('better-sqlite3');
  const { migrations, runMigrations, SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  assert.ok(SCHEMA_VERSION >= 52, 'this test requires schema v52 or later');

  const dbPath = path.join(root, 'v51.sqlite');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  // Apply everything up to and including v51 (the state before this migration).
  for (const m of migrations.filter((x) => x.version <= 51).sort((a, b) => a.version - b.version)) {
    db.exec(m.up);
    db.pragma(`user_version = ${m.version}`);
  }
  assert.equal(db.pragma('user_version', { simple: true }), 51, 'DB is at v51');
  assert.equal(hasTable(db, 'archive_item_folders'), false, 'join table absent before migration');

  // Seed legacy data: two folders, three items (two filed, one unfiled).
  const now = new Date().toISOString();
  db.prepare('INSERT INTO archive_folders (folder_id, name, parent_id, created_at) VALUES (?, ?, NULL, ?)').run('f_a', 'Censos', now);
  db.prepare('INSERT INTO archive_folders (folder_id, name, parent_id, created_at) VALUES (?, ?, NULL, ?)').run('f_b', 'Partidas', now);
  const insItem = db.prepare(
    `INSERT INTO archive_items (item_id, folder_id, title, kind, bytes, created_at, updated_at)
     VALUES (?, ?, ?, 'other', 0, ?, ?)`
  );
  insItem.run('i_1', 'f_a', 'Hoja censal', now, now);
  insItem.run('i_2', 'f_b', 'Partida de Juan', now, now);
  insItem.run('i_3', null, 'Nota suelta', now, now); // unfiled

  // Apply migration 52 and every later append-only migration.
  runMigrations(db);
  assert.equal(db.pragma('user_version', { simple: true }), SCHEMA_VERSION, `DB migrated through v${SCHEMA_VERSION}`);
  assert.equal(hasTable(db, 'archive_item_folders'), true, 'join table created');

  // Every filed item keeps its folder; the unfiled item gets no membership.
  const memberships = db
    .prepare('SELECT item_id, folder_id FROM archive_item_folders ORDER BY item_id')
    .all();
  assert.deepEqual(
    memberships,
    [
      { item_id: 'i_1', folder_id: 'f_a' },
      { item_id: 'i_2', folder_id: 'f_b' },
    ],
    'folder assignments backfilled with zero loss; unfiled item has no membership'
  );

  // Re-running is a no-op (idempotent) and does not duplicate memberships.
  runMigrations(db);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS c FROM archive_item_folders').get().c,
    2,
    're-running migrations does not duplicate memberships'
  );

  db.close();
  console.log('Archive migration 52 test passed!');
} finally {
  await rm(root, { recursive: true, force: true });
}

function hasTable(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name));
}

function installTsHook() {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) {
      return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        esModuleInterop: true,
        resolveJsonModule: true,
        skipLibCheck: true,
      },
    }).outputText;
    module._compile(output, filename);
  };
}
