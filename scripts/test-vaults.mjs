import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (!process.argv.includes('--electron-vaults-test')) {
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-vaults-build-'));
  const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-vaults-userdata-'));
  try {
    const entry = path.join(outDir, 'vault-test-entry.ts');
    const bundle = path.join(outDir, 'vault-test-entry.cjs');
    await writeFile(
      entry,
      [
        `export * as registry from ${JSON.stringify(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'))};`,
        `export * as database from ${JSON.stringify(path.join(repoRoot, 'electron/db/database.ts'))};`,
        `export * as secrets from ${JSON.stringify(path.join(repoRoot, 'electron/secrets/secretStore.ts'))};`,
      ].join('\n'),
      'utf8'
    );
    execFileSync(
      path.join(repoRoot, 'node_modules/.bin/esbuild'),
      [
        entry,
        '--bundle',
        '--platform=node',
        '--format=cjs',
        '--target=es2022',
        `--outfile=${bundle}`,
        `--alias:electron=${path.join(repoRoot, 'scripts/stub-electron.mjs')}`,
        '--external:better-sqlite3',
      ],
      { cwd: repoRoot, stdio: 'inherit' }
    );

    execFileSync(
      path.join(repoRoot, 'node_modules/.bin/electron'),
      [path.join(repoRoot, 'scripts/test-vaults.mjs'), '--electron-vaults-test', bundle, userData],
      {
        cwd: repoRoot,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODUS_TEST_USERDATA: userData },
        stdio: 'inherit',
      }
    );
  } finally {
    await rm(outDir, { recursive: true, force: true });
    await rm(userData, { recursive: true, force: true });
  }
  process.exit(0);
}

const [, , , bundle, userData] = process.argv;
process.env.NODE_PATH = [path.join(repoRoot, 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
Module._initPaths();
const require = createRequire(import.meta.url);
const { registry, database, secrets } = require(bundle);

assert.equal(registry.getActiveVault().id, 'default');
assert.equal(database.dbPath(), path.join(userData, 'nodus.sqlite'));

let db = database.getDb();
db.prepare('INSERT INTO works (nodus_id, zotero_key, title) VALUES (?, ?, ?)').run('work-default', 'ZOT-DEFAULT', 'Default work');
secrets.setApiKey('openai', 'sk-default');
assert.equal(secrets.getApiKey('openai'), 'sk-default');
database.closeDb();

const researchVault = registry.createVault('Investigación separada');
assert.equal(registry.listVaults().length, 2);
assert.deepEqual(secrets.copyApiKeysBetweenVaults('default', researchVault.id), ['openai']);
assert.deepEqual(secrets.listApiKeyProvidersForVault(researchVault.id), ['openai']);

registry.setActiveVault(researchVault.id);
assert.equal(database.dbPath(), researchVault.path);
assert.equal(secrets.getApiKey('openai'), 'sk-default');
db = database.getDb();
assert.equal(countWorks(db), 0, 'new vault starts with an empty library');
db.prepare('INSERT INTO works (nodus_id, zotero_key, title) VALUES (?, ?, ?)').run('work-research', 'ZOT-RESEARCH', 'Research work');
database.closeDb();

registry.setActiveVault('default');
db = database.getDb();
assert.equal(countWorks(db), 1, 'default vault kept its work');
assert.equal(workTitle(db), 'Default work');
assert.equal(secrets.getApiKey('openai'), 'sk-default');

registry.renameVault(researchVault.id, 'Archivo 2026');
assert.equal(registry.getVault(researchVault.id).name, 'Archivo 2026');

const snapshotPath = path.join(userData, 'default-snapshot.sqlite');
await db.backup(snapshotPath);
const duplicate = registry.createVaultFromDatabaseFile(snapshotPath, 'Principal duplicada');
secrets.copyApiKeysBetweenVaults('default', duplicate.id);
database.closeDb();

registry.setActiveVault(duplicate.id);
db = database.getDb();
assert.equal(countWorks(db), 1, 'duplicated vault preserves data');
assert.equal(workTitle(db), 'Default work');
assert.equal(secrets.getApiKey('openai'), 'sk-default');
database.closeDb();

registry.setActiveVault(researchVault.id);
db = database.getDb();
assert.equal(countWorks(db), 1, 'research vault kept its independent work');
assert.equal(workTitle(db), 'Research work');
database.closeDb();

function countWorks(db) {
  return db.prepare('SELECT COUNT(*) AS count FROM works').get().count;
}

function workTitle(db) {
  return db.prepare('SELECT title FROM works ORDER BY nodus_id LIMIT 1').get().title;
}
