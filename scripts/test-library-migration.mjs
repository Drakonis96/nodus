import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-library-migration-suite')) process.exit(0);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-library-migration-'));
const userData = path.join(scratch, 'user-data');
const root = path.join(scratch, 'backup', 'nodus-library');
installRuntimeHooks(userData);
const require = createRequire(import.meta.url);

function makeVault(file, variant) {
  const Database = require('better-sqlite3');
  const db = new Database(file);
  db.exec(`
    CREATE TABLE works (
      nodus_id TEXT PRIMARY KEY, zotero_key TEXT, title TEXT, authors_json TEXT,
      creators_json TEXT, year INTEGER, item_type TEXT, doi TEXT, notes TEXT,
      light_status TEXT, deep_status TEXT, summary_status TEXT, archived INTEGER
    );
    CREATE TABLE collections (collection_key TEXT PRIMARY KEY, name TEXT, parent_key TEXT);
    CREATE TABLE work_collections (nodus_id TEXT, collection_key TEXT);
    CREATE TABLE zotero_tags (tag_id INTEGER PRIMARY KEY, label TEXT);
    CREATE TABLE work_zotero_tags (nodus_id TEXT, tag_id INTEGER);
    CREATE TABLE idea_occurrences (global_id TEXT, nodus_id TEXT);
    CREATE TABLE passages (passage_id TEXT, nodus_id TEXT);
    CREATE TABLE evidence (id TEXT, nodus_id TEXT);
    CREATE TABLE gaps (id TEXT, nodus_id TEXT);
    CREATE TABLE work_summaries (nodus_id TEXT, summary TEXT);
  `);
  db.prepare('INSERT INTO collections VALUES (?, ?, ?)').run('ROOTCOLL', 'Historia', null);
  db.prepare('INSERT INTO collections VALUES (?, ?, ?)').run('SUBCOLL', 'Posguerra', 'ROOTCOLL');
  const common = variant === 1
    ? ['work-a', 'SAME1234', 'Mujeres solas', '["Noelia de la Cruz"]', '[]', 2017, 'journalArticle', '10.1000/mujeres', 'Nota analítica', 'done', 'done', 'done', 0]
    : ['work-b', 'SAME1234', 'Mujeres solas en la posguerra', '["Noelia de la Cruz"]', '[{"creatorType":"author","firstName":"Noelia","lastName":"de la Cruz"}]', 2017, 'journalArticle', '10.1000/mujeres', null, 'done', 'none', 'none', 0];
  db.prepare('INSERT INTO works VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(...common);
  db.prepare('INSERT INTO work_collections VALUES (?, ?)').run(common[0], 'SUBCOLL');
  db.prepare('INSERT INTO zotero_tags VALUES (?, ?)').run(variant, variant === 1 ? 'posguerra' : 'mujeres');
  db.prepare('INSERT INTO work_zotero_tags VALUES (?, ?)').run(common[0], variant);
  if (variant === 1) {
    db.prepare('INSERT INTO idea_occurrences VALUES (?, ?)').run('idea-1', 'work-a');
    db.prepare('INSERT INTO passages VALUES (?, ?)').run('passage-1', 'work-a');
    db.prepare('INSERT INTO evidence VALUES (?, ?)').run('evidence-1', 'work-a');
    db.prepare('INSERT INTO gaps VALUES (?, ?)').run('gap-1', 'work-a');
    db.prepare('INSERT INTO work_summaries VALUES (?, ?)').run('work-a', 'Resumen preservado');
    db.prepare('INSERT INTO works VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      'local-a', null, 'Documento local', '["Autora local"]', '[]', 2026, 'report', null, null,
      'pending', 'none', 'none', 0,
    );
  }
  db.close();
}

try {
  const { LibraryDiskStore } = require(path.join(repoRoot, 'electron/library/libraryStorage.ts'));
  const { LibraryCatalog } = require(path.join(repoRoot, 'electron/library/libraryCatalog.ts'));
  const { migrateVaultLibraries } = require(path.join(repoRoot, 'electron/library/libraryMigration.ts'));

  const firstDb = path.join(scratch, 'first.sqlite');
  const secondDb = path.join(scratch, 'second.sqlite');
  makeVault(firstDb, 1);
  makeVault(secondDb, 2);

  // A clean reader made before the global migration must survive byte-for-byte.
  const existingFolder = path.join(root, 'SAME1234');
  await mkdir(existingFolder, { recursive: true });
  await writeFile(path.join(existingFolder, 'reader.md'), '# Mujeres solas\n\nVersión limpia ya revisada.\n');
  await writeFile(path.join(existingFolder, 'original.pdf'), '%PDF-1.4 existing original\n');
  await writeFile(path.join(existingFolder, 'metadata.json'), `${JSON.stringify({
    storageId: 'SAME1234', citationKey: 'aliamirandaMujeresSolasPosguerra2017',
    title: 'Mujeres solas', authors: ['Noelia de la Cruz'], year: 2017,
    zotero: { itemKey: 'SAME1234' }, files: { reader: 'reader.md', original: 'original.pdf' },
  }, null, 2)}\n`);

  const store = new LibraryDiskStore(root, 'migration-device-0001');
  const catalog = new LibraryCatalog(path.join(userData, 'library', 'catalog.sqlite'));
  const vaults = [
    { id: 'vault-a', name: 'Investigación', path: firstDb, type: 'academic' },
    { id: 'vault-b', name: 'Docencia', path: secondDb, type: 'teaching' },
  ];
  const progress = [];
  const report = await migrateVaultLibraries({ vaults, store, catalog, onProgress: (value) => progress.push(value) });
  assert.equal(report.vaultsScanned, 2);
  assert.equal(report.itemsDiscovered, 3, 'two vault rows merge into one Zotero item; the local work stays separate');
  assert.equal(report.vaultLinks, 3);
  assert.equal(report.preservedAnalyses, 1);
  assert.equal(report.warnings.length, 0);
  assert.ok(progress.every((value, index) => index === 0 || value.percent >= progress[index - 1].percent));
  assert.equal(progress.at(-1).phase, 'complete');
  assert.equal(progress.at(-1).percent, 100);

  const page = catalog.list({ search: 'posguerra' });
  assert.equal(page.total, 1);
  assert.equal(catalog.list().total, 2, 'global catalog deduplicates the shared Zotero item');
  assert.deepEqual(new Set(page.items[0].tags), new Set(['posguerra', 'mujeres']));
  assert.deepEqual(new Set(page.items[0].collectionIds), new Set([catalog.resolveCollectionId('zotero:SUBCOLL')]));
  const links = catalog.listVaultLinks('zotero:SAME1234');
  assert.equal(links.length, 2);
  assert.equal(links.find((link) => link.vaultId === 'vault-a').analysis.ideaCount, 1);
  assert.equal(links.find((link) => link.vaultId === 'vault-a').analysis.hasSummary, true);
  assert.equal(await readFile(path.join(existingFolder, 'reader.md'), 'utf8'), '# Mujeres solas\n\nVersión limpia ya revisada.\n');
  assert.ok(existsSync(path.join(existingFolder, 'original.pdf')));
  const localRecord = store.scanMaterializedItems().records.find((item) => item.metadata.title === 'Documento local');
  assert.equal(localRecord.vaultWorkIds['vault-a'], 'local-a', 'a migrated Nodus work keeps its original vault workId for relinking');
  assert.equal(localRecord.formatVersion, 2);

  // Source databases are read-only inputs: every analysis row remains where it was.
  const Database = require('better-sqlite3');
  const source = new Database(firstDb, { readonly: true });
  assert.equal(source.prepare('SELECT COUNT(*) AS n FROM idea_occurrences').get().n, 1);
  assert.equal(source.prepare('SELECT summary FROM work_summaries').get().summary, 'Resumen preservado');
  source.close();

  const revision = store.readMaterializedItem('SAME1234').clock.revision;
  const second = await migrateVaultLibraries({ vaults, store, catalog });
  assert.equal(second.itemsCreated, 0);
  assert.equal(second.itemsUpdated, 0);
  assert.equal(second.itemsUnchanged, 3);
  assert.equal(store.readMaterializedItem('SAME1234').clock.revision, revision, 'idempotent rerun writes no phantom version');
  assert.equal(second.collectionsCreated, 0);
  assert.equal(second.collectionsUpdated, 0);
  assert.equal(second.collectionsUnchanged, 4);
  catalog.close();

  console.log('Cross-vault library migration and analysis-preservation tests passed!');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
