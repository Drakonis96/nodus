import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
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
        `export * as analysisReuse from ${JSON.stringify(path.join(repoRoot, 'electron/vaults/vaultAnalysisImport.ts'))};`,
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
const { registry, analysisReuse, database, secrets } = require(bundle);

assert.equal(registry.getActiveVault().id, 'default');
assert.equal(database.dbPath(), path.join(userData, 'nodus.sqlite'));

let db = database.getDb();
seedAnalyzedWork(db);
db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('vault-import-test', 'source-only-setting');
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
db.prepare('INSERT INTO works (nodus_id, zotero_key, title) VALUES (?, ?, ?)').run(
  'work-reused',
  'ZOT-DEFAULT',
  'Default work reused'
);
database.closeDb();

const reused = analysisReuse.reuseVaultAnalysisForWorks(['work-reused']);
assert.equal(reused.requested, 1);
assert.equal(reused.matched, 1);
assert.equal(reused.imported, 1);
const reusedWorkResult = reused.works[0];
assert.equal(reusedWorkResult.matchedVaultId, 'default');
assert.equal(reusedWorkResult.matchedSourceNodusId, 'work-default');
assert.ok(reusedWorkResult.importedRows > 0, 'analysis reuse reports copied rows');
assert.ok(reusedWorkResult.imported.includes('themes'), 'themes are reused');
assert.ok(reusedWorkResult.imported.includes('ideas'), 'ideas are reused');
assert.ok(reusedWorkResult.imported.includes('ideaEmbeddings'), 'idea embeddings are reused');
assert.ok(reusedWorkResult.imported.includes('summary'), 'summaries are reused');
assert.ok(reusedWorkResult.imported.includes('passages'), 'passage embeddings are reused');
assert.equal(reusedWorkResult.tableRows.works, undefined, 'analysis reuse does not copy source works');
registry.setActiveVault(researchVault.id);
db = database.getDb();
assert.deepEqual(workTitles(db), ['Default work reused', 'Research work']);
assert.equal(countWorks(db), 2, 'analysis reuse keeps the target library independent');
assert.equal(countRows(db, 'ideas'), 1, 'reused ideas are available in the target vault');
assert.equal(countRows(db, 'work_summaries'), 1, 'reused summaries are available in the target vault');
assert.equal(countRows(db, 'passages'), 1, 'reused passage embeddings are available in the target vault');
assert.deepEqual(
  db.prepare('SELECT light_status, deep_status, summary_status FROM works WHERE nodus_id = ?').get('work-reused'),
  { light_status: 'done', deep_status: 'done', summary_status: 'done' },
  'reused analysis updates the target work statuses'
);
assert.equal(
  db.prepare('SELECT COUNT(*) AS count FROM idea_occurrences WHERE nodus_id = ?').get('work-reused').count,
  1,
  'reused ideas are attached to the selected target work'
);
assert.equal(
  db.prepare('SELECT nodus_id FROM work_summaries WHERE nodus_id = ?').get('work-reused').nodus_id,
  'work-reused',
  'reused summary is attached to the selected target work'
);
assert.deepEqual(
  db.prepare('SELECT passage_id, nodus_id FROM passages WHERE nodus_id = ?').get('work-reused'),
  { passage_id: 'work-reused#0', nodus_id: 'work-reused' },
  'reused passages are rewritten for the selected target work'
);
assert.equal(
  Buffer.from(db.prepare('SELECT embedding FROM ideas WHERE global_id = ?').get('idea-default').embedding).toString('hex'),
  Buffer.from([1, 2, 3, 4]).toString('hex'),
  'idea embedding blob is preserved'
);
assert.equal(
  db.prepare('SELECT value FROM settings WHERE key = ?').get('vault-import-test'),
  undefined,
  'vault import does not overwrite target settings'
);
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
assert.equal(countWorks(db), 2, 'research vault kept its independent and reused works');
assert.deepEqual(workTitles(db), ['Default work reused', 'Research work']);
database.closeDb();

registry.resetVaultDatabase(researchVault.id);
registry.setActiveVault(researchVault.id);
db = database.getDb();
assert.equal(countWorks(db), 0, 'reset vault recreates an empty database');
assert.equal(secrets.getApiKey('openai'), 'sk-default', 'reset keeps vault API keys available');
database.closeDb();

const removable = registry.createVault('Temporal para borrar');
const removableDir = path.dirname(removable.path);
assert.ok(existsSync(removableDir), 'created vault directory exists before delete');
registry.deleteVault(removable.id, true);
assert.equal(registry.getVault(removable.id), null, 'deleted vault is removed from registry');
assert.equal(existsSync(removableDir), false, 'deleted vault files are removed from disk');

function countWorks(db) {
  return db.prepare('SELECT COUNT(*) AS count FROM works').get().count;
}

function countRows(db, table) {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
}

function workTitle(db) {
  return db.prepare('SELECT title FROM works ORDER BY nodus_id LIMIT 1').get().title;
}

function workTitles(db) {
  return db.prepare('SELECT title FROM works ORDER BY title').all().map((row) => row.title);
}

function seedAnalyzedWork(db) {
  const now = '2026-07-07T00:00:00.000Z';
  db.prepare(
    `INSERT INTO works (
      nodus_id, zotero_key, title, authors_json, light_status, light_at, light_hash,
      deep_status, deep_at, deep_hash, summary_status, summary_at, summary_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'work-default',
    'ZOT-DEFAULT',
    'Default work',
    '[]',
    'done',
    now,
    'light-hash',
    'done',
    now,
    'deep-hash',
    'done',
    now,
    'summary-hash'
  );
  db.prepare('INSERT INTO themes (theme_id, label, created_at) VALUES (?, ?, ?)').run('theme-default', 'Theme', now);
  db.prepare('INSERT INTO work_themes (nodus_id, theme_id) VALUES (?, ?)').run('work-default', 'theme-default');
  db.prepare(
    `INSERT INTO ideas (
      global_id, type, label, statement, embedding, created_at,
      embedding_provider, embedding_model, embedding_dim, embedding_text_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'idea-default',
    'claim',
    'Imported idea',
    'Imported statement',
    Buffer.from([1, 2, 3, 4]),
    now,
    'openai',
    'text-embedding-3-small',
    4,
    'idea-hash'
  );
  db.prepare('INSERT INTO idea_occurrences (global_id, nodus_id, role, development, confidence) VALUES (?, ?, ?, ?, ?)').run(
    'idea-default',
    'work-default',
    'central',
    'development',
    0.9
  );
  db.prepare('INSERT INTO evidence (id, global_id, nodus_id, quote, location, kind) VALUES (?, ?, ?, ?, ?, ?)').run(
    'evidence-default',
    'idea-default',
    'work-default',
    'quote',
    'p. 1',
    'quote'
  );
  db.prepare(
    `INSERT INTO work_summaries (
      nodus_id, summary, source_level, model_json, content_hash, embedding,
      embedding_provider, embedding_model, embedding_dim, embedding_text_hash, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'work-default',
    'Summary',
    'deep',
    '{}',
    'summary-content-hash',
    Buffer.from([5, 6, 7, 8]),
    'openai',
    'text-embedding-3-small',
    4,
    'summary-embedding-hash',
    now,
    now
  );
  db.prepare(
    `INSERT INTO passages (
      passage_id, nodus_id, chunk_index, text, page_label, char_len, content_hash,
      embedding, embedding_provider, embedding_model, embedding_dim, embedding_text_hash, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'passage-default',
    'work-default',
    0,
    'Passage',
    '1',
    7,
    'passage-hash',
    Buffer.from([9, 10, 11, 12]),
    'openai',
    'text-embedding-3-small',
    4,
    'passage-embedding-hash',
    now
  );
}
