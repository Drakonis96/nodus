import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-library-migration-session-suite')) process.exit(0);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-library-migration-session-'));
const userData = path.join(scratch, 'profile');
installRuntimeHooks(userData);
const require = createRequire(import.meta.url);

function createVault(file, count) {
  const Database = require('better-sqlite3');
  const db = new Database(file);
  db.exec(`
    CREATE TABLE works (
      nodus_id TEXT PRIMARY KEY, zotero_key TEXT, title TEXT, authors_json TEXT,
      creators_json TEXT, year INTEGER, item_type TEXT, doi TEXT, notes TEXT,
      light_status TEXT, deep_status TEXT, summary_status TEXT, archived INTEGER
    );
    CREATE TABLE collections (collection_key TEXT PRIMARY KEY, name TEXT, parent_key TEXT);
  `);
  db.prepare('INSERT INTO collections VALUES (?, ?, ?)').run('ROOT', 'Research', null);
  const insert = db.prepare('INSERT INTO works VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (let index = 0; index < count; index += 1) {
    insert.run(`work-${index}`, `ITEM${String(index).padStart(4, '0')}`, `Document ${index}`, '["Researcher"]', '[]', 2026,
      'journalArticle', `10.1000/${index}`, index === 0 ? 'Preserved note' : null, 'done', 'none', 'done', 0);
  }
  db.close();
}

try {
  const { LibraryDiskStore } = require(path.join(repoRoot, 'electron/library/libraryStorage.ts'));
  const { LibraryCatalog } = require(path.join(repoRoot, 'electron/library/libraryCatalog.ts'));
  const { LibraryMigrationSessionManager } = require(path.join(repoRoot, 'electron/library/libraryMigrationSessions.ts'));
  const vaultFile = path.join(scratch, 'academic.sqlite');
  const teachingFile = path.join(scratch, 'teaching.sqlite');
  createVault(vaultFile, 12);
  createVault(teachingFile, 1);
  const before = await readFile(vaultFile);
  const beforeStat = await stat(vaultFile);
  const root = path.join(scratch, 'backups', 'nodus-library');
  const store = new LibraryDiskStore(root, 'migration-session-device');
  const catalog = new LibraryCatalog(path.join(userData, 'library', 'catalog.sqlite'));
  const vaults = [
    { id: 'academic', name: 'Academic vault', path: vaultFile, type: 'academic', origin: 'local', remote: null, active: true, legacy: false, createdAt: '', lastOpenedAt: '', apiKeyProviders: [] },
    { id: 'teaching', name: 'Teaching vault', path: teachingFile, type: 'teaching', origin: 'local', remote: null, active: false, legacy: false, createdAt: '', lastOpenedAt: '', apiKeyProviders: [] },
  ];
  let manager;
  let canceled = false;
  manager = new LibraryMigrationSessionManager(store, catalog, () => vaults, (progress) => {
    if (!canceled && progress.phase === 'items' && progress.processedItems >= 1) {
      canceled = manager.cancel(progress.sessionId);
    }
  });

  const preview = manager.preview();
  assert.deepEqual(preview.selectedVaultIds, ['academic'], 'all local academic vaults are selected initially');
  assert.equal(preview.totalItems, 12);
  assert.equal(preview.vaults.find((vault) => vault.id === 'teaching').defaultSelected, false);
  assert.ok(preview.estimatedAdditionalBytes > 0);

  const interrupted = await manager.start({ preview, selectedVaultIds: ['academic'] });
  assert.equal(canceled, true);
  assert.equal(interrupted.status, 'canceled');
  assert.ok(interrupted.createdRecords.length > 0, 'every partial mutation is journaled for rollback');
  assert.ok(manager.list().some((session) => session.id === interrupted.id && session.status === 'canceled'));
  assert.equal(Buffer.compare(await readFile(vaultFile), before), 0, 'source vault bytes remain untouched');
  assert.equal((await stat(vaultFile)).mtimeMs, beforeStat.mtimeMs, 'the source is opened read-only');

  const sessionFile = path.join(root, '.nodus', 'migrations', `${interrupted.id}.json`);
  const crashedSession = JSON.parse(await readFile(sessionFile, 'utf8'));
  crashedSession.status = 'running';
  await writeFile(sessionFile, `${JSON.stringify(crashedSession, null, 2)}\n`, 'utf8');
  manager = new LibraryMigrationSessionManager(store, catalog, () => vaults);
  assert.equal(manager.list().find((session) => session.id === interrupted.id)?.status, 'canceled', 'an orphaned running checkpoint becomes resumable after a process crash');
  const completed = await manager.resume(interrupted.id);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.checkpoint.percent, 100);
  assert.deepEqual(completed.verification, {
    catalogMatches: true, manifestsValid: true, filesPresent: true, linksValid: true,
    checkedAt: completed.verification.checkedAt,
  });
  assert.equal(catalog.list().total, 12);
  assert.equal(completed.report.itemsDiscovered, 12);
  assert.equal(catalog.listVaultLinks().length, 12);
  catalog.rebuild(store);
  assert.equal(catalog.listVaultLinks().length, 12, 'an atomic catalog rebuild retains links for closed vaults');

  const protectedRecord = completed.createdRecords.find((record) => record.kind === 'item');
  assert.ok(protectedRecord?.storageId);
  const current = store.readMaterializedItem(protectedRecord.storageId);
  store.upsertItem({ ...current, metadata: { ...current.metadata, title: 'Edited after migration' } }, current.clock.revision);
  const rolledBack = manager.rollback(completed.id);
  assert.equal(rolledBack.status, 'rolled-back');
  assert.ok(rolledBack.rollbackConflicts.includes(`item:${protectedRecord.id}`), 'post-migration edits are retained as conflicts');
  assert.ok(store.findItemByIdOrAlias(protectedRecord.id), 'the modified record survives rollback');
  assert.equal(catalog.list().total, 1, 'all untouched records created by the session are removed');
  assert.equal(Buffer.compare(await readFile(vaultFile), before), 0);
  assert.match(await readFile(sessionFile, 'utf8'), /"rolled-back"/);
  catalog.close();
  console.log('Opt-in Library migration session tests passed!');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
