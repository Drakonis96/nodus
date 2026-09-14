import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { installRuntimeHooks } from './lib/tsRuntimeHooks.mjs';
const require = createRequire(import.meta.url);
if (!process.argv.includes('--electron-vault-search')) {
  execFileSync(path.resolve('node_modules/.bin/electron'), [path.resolve('scripts/test-vault-content-search.mjs'), '--electron-vault-search'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}
const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-vault-content-search-'));
installRuntimeHooks(root);
const database = require('../electron/db/database.ts');
try {
  const registry = require('../electron/vaults/vaultRegistry.ts');
  const { searchVaultContent } = require('../electron/ai/vaultContentSearch.ts');
  const useVault = (type) => { database.closeDb(); registry.setActiveVault(registry.createVault(type, type).id); return database.getDb(); };
  useVault('databases');
  const repo = require('../electron/db/databasesRepo.ts');
  const db = repo.createDatabase('Memoria oral');
  const column = repo.createColumn(db.id, 'Título', 'title');
  const row = repo.createRow(db.id);
  repo.setCell(row.id, column.id, 'Memoria oral del barrio');
  const all = await searchVaultContent('memoria oral', ['database', 'row'], false);
  assert.equal(all.results.length, 2);
  assert.equal(all.results[0].kind, 'database');
  assert.equal(all.results.find(hit => hit.kind === 'row').databaseId, db.id);
  assert.equal((await searchVaultContent('memoria oral', ['row'], false)).results[0].id, row.id);
  const page = await searchVaultContent('memoria oral', undefined, false, 1);
  assert.equal(page.results.length, 1);
  assert.equal(page.hasMore, true);
  assert.deepEqual((await searchVaultContent('memoria oral', [], false)).results, []);

  const prosopDb = useVault('prosopography');
  require('../electron/db/prosopDemoRepo.ts').seedProsopDemo();
  const people = await searchVaultContent('María', ['person'], false);
  assert.equal(people.results.length, 1);
  assert.ok(people.results[0].deepLink.includes('/person/'));
  prosopDb.prepare("UPDATE prosop_person_profiles SET privacy_status='restricted' WHERE person_id=?").run(people.results[0].id);
  assert.equal((await searchVaultContent('María', ['person', 'mention'], false)).results.length, 0);

  useVault('worldbuilding');
  const world = require('../electron/db/worldEncyclopediaRepo.ts');
  world.createWorldArticle({ title: 'Memoria oral', body: 'La ciudad recuerda sus orígenes.' });
  assert.equal((await searchVaultContent('orígenes', ['article'], false)).results.length, 1);
  assert.equal((await searchVaultContent('orígenes', ['character'], false)).results.length, 0);

  useVault('academic');
  const searchRepo = require('../electron/db/searchRepo.ts');
  assert.deepEqual(searchRepo.globalSearch('no matches'), []);
  assert.deepEqual(searchRepo.globalSearch('', -1, true), []);
  const saved = require('../electron/db/savedSearchesRepo.ts');
  saved.saveSearch({ name: 'Hybrid', query: 'memoria', mode: 'hybrid', kinds: ['note'] });
  assert.equal(saved.listSavedSearches()[0].mode, 'hybrid');
  console.log('PASS real vault SQL: database rows, pagination, prosopography privacy, world prose, academic queries, saved hybrid searches');
} finally { database.closeDb(); await rm(root, { recursive: true, force: true }); }
