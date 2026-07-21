// Verifies runMigrations() self-heals a database whose user_version does not match the
// objects actually present — the state left behind when a vault was migrated by a build
// whose migration numbering differed (a pre-release, or a feature branch later reordered
// on main). Two symptoms are reproduced from the REAL migration list:
//
//   (a) a "future" CREATE-only migration's objects already exist while user_version sits
//       one below it. The old runMigrations threw "table ... already exists" and the
//       vault could not be opened (this is the reported bug).
//   (b) a purely-additive table below the version line was never created here, because
//       the differing numbering carried user_version past it. It stays silently absent.
//
// The fix must, in both cases, finish without throwing, reach SCHEMA_VERSION, create only
// what is missing, and never duplicate an object. It must also leave a healthy database
// completely untouched.

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
    [path.join(repoRoot, 'scripts/test-migration-renumber-recovery.mjs'), '--electron-migration-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-renumber-test-'));
installTsHook();

try {
  const Database = require('better-sqlite3');
  const { migrations, runMigrations, SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));

  // The migrations that create the two tables the real corruption involved. Found by
  // content, not by hard-coded version, so this test survives future append-only work.
  const protectMig = migrations.find((m) => /CREATE\s+TABLE\s+protect_copies\b/i.test(m.up));
  const supersededMig = migrations.find((m) => /CREATE\s+TABLE\s+sync_superseded\b/i.test(m.up));
  assert.ok(protectMig, 'expected a migration that creates protect_copies');
  assert.ok(supersededMig, 'expected a migration that creates sync_superseded');

  // The splitter and CREATE-only recovery assume no migration body carries a trigger or a
  // BEGIN...END block (the only source of nested semicolons). Guard that invariant here so
  // a future migration that breaks it fails loudly rather than silently mis-splitting.
  for (const m of migrations) {
    assert.ok(!/CREATE\s+TRIGGER/i.test(m.up), `migration v${m.version} must not define a trigger`);
  }

  // -- Scenario (a): future CREATE-only migration's objects already present -------------
  {
    const dbPath = path.join(root, 'crash.sqlite');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    for (const m of migrations.filter((x) => x.version < protectMig.version).sort((x, y) => x.version - y.version)) {
      db.exec(m.up);
      db.pragma(`user_version = ${m.version}`);
    }
    // The differing build already created this table; user_version stays one below it.
    db.exec(protectMig.up);
    assert.equal(hasTable(db, 'protect_copies'), true, 'setup: protect_copies pre-exists');
    assert.equal(db.pragma('user_version', { simple: true }), protectMig.version - 1, 'setup: version is one below');

    // Old code threw "table protect_copies already exists" here.
    assert.doesNotThrow(() => runMigrations(db), 'switch must not crash when the table already exists');
    assert.equal(db.pragma('user_version', { simple: true }), SCHEMA_VERSION, 'reaches current schema');
    assert.equal(tableCount(db, 'protect_copies'), 1, 'protect_copies is not duplicated');
    db.close();
  }

  // -- Scenario (b) ---------------------------------------------------------------------
  {
    const dbPath = path.join(root, 'skipped.sqlite');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    runMigrations(db); // fully healthy at SCHEMA_VERSION
    assert.equal(db.pragma('user_version', { simple: true }), SCHEMA_VERSION, 'setup: healthy DB');

    // Simulate the additive table having been skipped by a differing numbering: it is gone
    // yet user_version stays at the top, so the normal `version > current` loop never
    // reconsiders it.
    db.exec('DROP TABLE sync_superseded');
    assert.equal(hasTable(db, 'sync_superseded'), false, 'setup: additive table missing');

    runMigrations(db);
    assert.equal(hasTable(db, 'sync_superseded'), true, 'missing additive table is backfilled');
    assert.equal(db.pragma('user_version', { simple: true }), SCHEMA_VERSION, 'version unchanged');
    db.close();
  }

  // -- Healthy database is untouched, and running twice is a no-op -----------------------
  {
    const db = new Database(path.join(root, 'healthy.sqlite'));
    db.pragma('journal_mode = WAL');
    runMigrations(db);
    const before = objectFingerprint(db);
    runMigrations(db);
    const after = objectFingerprint(db);
    assert.deepEqual(after, before, 'a second run changes nothing on a healthy DB');
    assert.equal(tableCount(db, 'protect_copies'), 1, 'no duplicated objects on a healthy DB');
    db.close();
  }

  console.log('Migration renumber recovery test passed!');
} finally {
  await rm(root, { recursive: true, force: true });
}

function hasTable(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name));
}

function tableCount(db, name) {
  return db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name = ?").get(name).c;
}

function objectFingerprint(db) {
  return db
    .prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
    .all();
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
