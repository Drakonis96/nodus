import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-library-identity-v2-suite')) process.exit(0);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-library-identity-v2-'));
const userData = path.join(scratch, 'user-data');
const root = path.join(scratch, 'backups', 'nodus-library');
installRuntimeHooks(userData);
const require = createRequire(import.meta.url);

function zoteroItem(library, title) {
  return {
    key: 'SAMEKEY', itemKey: 'SAMEKEY', library, version: 1, title,
    creators: [], year: 2026, itemType: 'journalArticle', doi: null, abstract: null,
    tags: [], collections: ['SAMECOLL'], publisher: null, publicationTitle: null,
    isbn: null, issn: null, url: null, date: '2026', language: 'es', volume: null,
    issue: null, pages: null, edition: null, place: null, rights: null, extra: null,
    dateAdded: '2026-08-10', dateModified: '2026-08-10',
  };
}

try {
  const { LibraryDiskStore } = require(path.join(repoRoot, 'electron/library/libraryStorage.ts'));
  const { LibraryCatalog } = require(path.join(repoRoot, 'electron/library/libraryCatalog.ts'));
  const { importZoteroLibraries } = require(path.join(repoRoot, 'electron/library/zoteroLibraryImport.ts'));
  const { recordContentHash } = require(path.join(repoRoot, 'electron/library/libraryRecord.ts'));
  const { safeLibraryFolderName } = require(path.join(repoRoot, 'electron/library/libraryPaths.ts'));

  const store = new LibraryDiskStore(root, 'identity-v2-device');
  store.initialize();
  assert.equal(JSON.parse(await readFile(path.join(root, 'library.json'), 'utf8')).formatVersion, 2);

  // v1 remains readable and migrates in place on the next normal write.
  const legacyFolder = store.itemFolder('legacy-folder');
  await mkdir(legacyFolder, { recursive: true });
  const legacyBase = {
    format: 'nodus.library-item', formatVersion: 1, id: 'zotero:LEGACY', storageId: 'legacy-folder',
    source: 'zotero', sourceLibraryId: 'users/9', sourceKey: 'LEGACY',
    metadata: { title: 'Legacy v1', itemType: 'document', creators: [], year: null, isbn: [], issn: [], tags: [] },
    collectionIds: [], attachments: [], extraction: { status: 'pending' },
    createdAt: '2025-01-01T00:00:00.000Z', deletedAt: null,
  };
  await writeFile(path.join(legacyFolder, 'metadata.json'), `${JSON.stringify({
    ...legacyBase,
    clock: { deviceId: 'legacy-device', revision: 1, baseRevision: 0, updatedAt: '2025-01-01T00:00:00.000Z', contentHash: recordContentHash(legacyBase) },
  }, null, 2)}\n`);
  const legacy = store.readMaterializedItem('legacy-folder');
  assert.equal(legacy.formatVersion, 2);
  assert.deepEqual(legacy.sourceIdentities, [{ source: 'zotero', libraryType: 'user', libraryId: '9', itemKey: 'LEGACY' }]);
  store.upsertItem({ ...legacy, metadata: { ...legacy.metadata, title: 'Legacy v2' } }, legacy.clock.revision);
  const migrated = JSON.parse(await readFile(path.join(legacyFolder, 'metadata.json'), 'utf8'));
  assert.equal(migrated.formatVersion, 2);
  assert.equal(migrated.storageId, 'legacy-folder', 'v1 migration never renames the existing folder');

  assert.notEqual(safeLibraryFolderName('CON'), 'CON', 'Windows device names are encoded');
  assert.notEqual(safeLibraryFolderName('CON'), safeLibraryFolderName('_CON'), 'reserved-name encoding is collision-free');
  assert.notEqual(safeLibraryFolderName('NUL.txt').toUpperCase(), 'NUL.TXT');
  assert.match(safeLibraryFolderName('Historia española/研究'), /^Historia%20espa%C3%B1ola%2F/);
  assert.notEqual(safeLibraryFolderName('..'), '..');

  const personal = { type: 'user', id: '7', name: 'Personal' };
  const group = { type: 'group', id: '7', name: 'Group' };
  const client = {
    async libraries() { return [personal, group]; },
    async libraryVersion() { return 1; },
    async allCollections(library) {
      return [{ key: 'SAMECOLL', itemKey: 'SAMECOLL', library, name: `${library.name} collection`, parentCollection: false, itemCount: 1, subCount: 0 }];
    },
    async libraryItems(library, options = {}) {
      const items = options.since ? [] : [zoteroItem(library, `${library.name} item`)];
      options.onProgress?.(items.length, items.length);
      return { items, version: 1, total: items.length };
    },
    async deletedSince() { return { version: 1, items: [], collections: [] }; },
    async itemAttachments() { return []; },
    async attachmentFilePath() { return null; },
  };
  const catalogFile = path.join(userData, 'library', 'catalog.sqlite');
  let catalog = new LibraryCatalog(catalogFile);
  catalog.rebuild(store);
  const first = await importZoteroLibraries({ requestId: 'identity-first', store, catalog, client });
  assert.equal(first.itemsCreated, 2);
  assert.equal(catalog.list().total, 3);
  const userIdentity = { source: 'zotero', libraryType: 'user', libraryId: '7', itemKey: 'SAMEKEY' };
  const groupIdentity = { source: 'zotero', libraryType: 'group', libraryId: '7', itemKey: 'SAMEKEY' };
  const userItem = store.findItemBySourceIdentity(userIdentity);
  const groupItem = store.findItemBySourceIdentity(groupIdentity);
  assert.ok(userItem && groupItem);
  assert.notEqual(userItem.id, groupItem.id, 'equal item keys in different libraries never collide');
  assert.notEqual(userItem.storageId, groupItem.storageId);
  assert.equal(catalog.findItemIdBySourceIdentity(userIdentity), userItem.id);
  assert.equal(catalog.findItemIdBySourceIdentity(groupIdentity), groupItem.id);
  assert.notEqual(catalog.resolveCollectionId('zotero:collection:user:7:SAMECOLL'), catalog.resolveCollectionId('zotero:collection:group:7:SAMECOLL'));

  const revisions = new Map([userItem, groupItem].map((item) => [item.id, item.clock.revision]));
  const second = await importZoteroLibraries({ requestId: 'identity-second', selection: { fullRefresh: true }, store, catalog, client });
  assert.equal(second.itemsCreated, 0);
  assert.equal(second.itemsUpdated, 0);
  for (const item of [userItem, groupItem]) assert.equal(store.findItemByIdOrAlias(item.id).clock.revision, revisions.get(item.id));

  // SQLite is only a cache: identities and aliases return after a complete rebuild.
  catalog.close();
  await rm(catalogFile, { force: true });
  await rm(`${catalogFile}-wal`, { force: true });
  await rm(`${catalogFile}-shm`, { force: true });
  catalog = new LibraryCatalog(catalogFile);
  catalog.rebuild(store);
  assert.equal(catalog.findItemIdBySourceIdentity(userIdentity), userItem.id);
  assert.equal(catalog.resolveItemId('zotero:item:user:7:SAMEKEY'), userItem.id);
  catalog.close();

  console.log('Library manifest v2, canonical identity, alias, Unicode and reserved-path tests passed!');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
