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

  // ── Machine B: its own note, a NEWER copy of n2, an OLDER verdict ──────────
  dbB.prepare('INSERT INTO notes VALUES (?, NULL, ?, ?, ?, NULL, 0, ?, ?)').run('n2', 'Compartida', 'markdown', 'versión nueva de B', T0, T1);
  dbB.prepare('INSERT INTO notes VALUES (?, NULL, ?, ?, ?, NULL, 0, ?, ?)').run('n3', 'Solo B', 'markdown', 'local de B', T0, T0);
  dbB.prepare("INSERT INTO edge_feedback VALUES ('iB', 'iA', 'contradicts', 'confirmed', '', ?)").run(T0);

  // ── Export from A, merge into B ─────────────────────────────────────────────
  useDb(dbA);
  const pkg = sync.buildSyncPackage('test');
  assert.equal(pkg.counts.notes, 2, 'A exports its two notes');
  assert.equal(pkg.counts.note_folders, 2);

  useDb(dbB);
  const summary = sync.mergeSyncPackage(pkg.buffer);
  assert.deepEqual(summary.noteFolders, { inserted: 2, updated: 0, skipped: 0 }, 'folder tree arrives whole');
  assert.deepEqual(summary.notes, { inserted: 1, updated: 0, skipped: 1 }, 'n1 inserted; newer local n2 kept');
  assert.deepEqual(summary.writingDrafts, { inserted: 1, updated: 0, skipped: 0 });
  assert.deepEqual(summary.savedSearches, { inserted: 1, updated: 0, skipped: 0 });
  assert.deepEqual(summary.edgeFeedback, { inserted: 0, updated: 1, skipped: 0 }, 'newer rejection overrides older confirm (direction-agnostic)');

  assert.equal(dbB.prepare("SELECT content FROM notes WHERE id = 'n2'").get().content, 'versión nueva de B', 'local newer content preserved');
  assert.equal(dbB.prepare("SELECT folder_id FROM notes WHERE id = 'n1'").get().folder_id, 'f2', 'note keeps its folder');
  assert.equal(dbB.prepare("SELECT parent_id FROM note_folders WHERE id = 'f2'").get().parent_id, 'f1', 'hierarchy preserved');
  assert.equal(dbB.prepare('SELECT COUNT(*) AS n FROM notes').get().n, 3, 'nothing local deleted');
  assert.equal(dbB.prepare('SELECT verdict FROM edge_feedback').get().verdict, 'rejected', 'verdict now matches machine A');

  // ── Idempotence: merging the same package again changes nothing ────────────
  const again = sync.mergeSyncPackage(pkg.buffer);
  assert.equal(again.notes.inserted + again.notes.updated, 0, 'second merge is a no-op for notes');
  assert.equal(again.edgeFeedback.updated, 0, 'second merge is a no-op for feedback');
  assert.equal(dbB.prepare('SELECT COUNT(*) AS n FROM notes').get().n, 3, 'row counts stable');

  // ── Reverse direction: B's layer flows back to A ────────────────────────────
  useDb(dbB);
  const pkgB = sync.buildSyncPackage('test');
  useDb(dbA);
  const back = sync.mergeSyncPackage(pkgB.buffer);
  assert.equal(back.notes.inserted, 1, 'n3 arrives on A');
  assert.equal(back.notes.updated, 1, 'A adopts B’s newer n2');
  assert.equal(dbA.prepare("SELECT content FROM notes WHERE id = 'n2'").get().content, 'versión nueva de B', 'A converges to newest n2');
  assert.equal(back.edgeFeedback.skipped, 1, 'verdict already newest on A');

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
          api.onResolve({ filter: /\.\.\/db\/database$/ }, () => ({ path: stub }));
        },
      },
    ],
  });
  return out;
}
