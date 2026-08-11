// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-zotero-isolated-copy-suite')) process.exit(0);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDatabase = process.env.NODUS_ZOTERO_SQLITE
  ? path.resolve(process.env.NODUS_ZOTERO_SQLITE)
  : path.join(os.homedir(), 'Zotero', 'zotero.sqlite');

if (!existsSync(sourceDatabase)) {
  console.log('Isolated Zotero copy test skipped: no local Zotero database was found.');
  process.exit(0);
}

const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-zotero-readonly-copy-'));
const snapshot = path.join(scratch, 'zotero-copy', 'zotero.sqlite');
const profile = path.join(scratch, 'nodus-profile');
const libraryRoot = path.join(scratch, 'backups', 'nodus-library');
installRuntimeHooks(profile);
const require = createRequire(import.meta.url);

try {
  // The live database is only ever the source of a byte copy. SQLite and Nodus open
  // the temporary snapshot, so tests cannot mutate the user's Zotero library or vault.
  await mkdir(path.dirname(snapshot), { recursive: true });
  await copyFile(sourceDatabase, snapshot);
  for (const suffix of ['-wal', '-shm']) if (existsSync(`${sourceDatabase}${suffix}`)) await copyFile(`${sourceDatabase}${suffix}`, `${snapshot}${suffix}`);
  assert.notEqual(path.resolve(snapshot), path.resolve(sourceDatabase));
  assert.ok(path.resolve(snapshot).startsWith(path.resolve(scratch) + path.sep));

  const Database = require('better-sqlite3');
  const db = new Database(snapshot, { readonly: true, fileMustExist: true });
  assert.deepEqual(db.pragma('quick_check', { simple: false }).map((row) => Object.values(row)[0]), ['ok']);

  const citeable = db.prepare(`
    SELECT i.itemID, i.key, i.version, i.dateAdded, i.dateModified, t.typeName,
           ROW_NUMBER() OVER (PARTITION BY t.typeName ORDER BY i.dateModified DESC, i.itemID DESC) sampleRank
    FROM items i JOIN itemTypes t ON t.itemTypeID=i.itemTypeID
    LEFT JOIN deletedItems d ON d.itemID=i.itemID
    WHERE d.itemID IS NULL AND t.typeName NOT IN ('attachment', 'note', 'annotation')
  `).all();
  const sampleRows = citeable.filter((row) => Number(row.sampleRank) <= 2);
  assert.ok(sampleRows.length > 0, 'the copied Zotero library contains citeable records');

  const dataFor = db.prepare(`
    SELECT f.fieldName, v.value FROM itemData d
    JOIN fieldsCombined f ON f.fieldID=d.fieldID
    JOIN itemDataValues v ON v.valueID=d.valueID WHERE d.itemID=?
  `);
  const creatorsFor = db.prepare(`
    SELECT c.firstName, c.lastName, c.fieldMode, ct.creatorType FROM itemCreators ic
    JOIN creators c ON c.creatorID=ic.creatorID JOIN creatorTypes ct ON ct.creatorTypeID=ic.creatorTypeID
    WHERE ic.itemID=? ORDER BY ic.orderIndex
  `);
  const tagsFor = db.prepare('SELECT t.name FROM itemTags it JOIN tags t ON t.tagID=it.tagID WHERE it.itemID=? ORDER BY t.name');
  const collectionsFor = db.prepare('SELECT c.key FROM collectionItems ci JOIN collections c ON c.collectionID=ci.collectionID WHERE ci.itemID=? ORDER BY c.key');
  const common = new Set(['title', 'abstractNote', 'date', 'language', 'publisher', 'publicationTitle', 'bookTitle', 'proceedingsTitle', 'volume', 'issue', 'pages', 'edition', 'place', 'rights', 'url', 'DOI', 'ISBN', 'ISSN', 'extra']);
  const personal = { type: 'user', id: '0', name: 'My Library (isolated copy)' };
  const items = sampleRows.map((row) => {
    const values = Object.fromEntries(dataFor.all(row.itemID).map((entry) => [entry.fieldName, String(entry.value ?? '')]));
    const date = values.date || null; const year = Number(/\b(\d{4})\b/.exec(date ?? '')?.[1]) || null;
    return {
      key: row.key, itemKey: row.key, library: personal, version: Number(row.version), title: values.title || '(untitled)',
      creators: creatorsFor.all(row.itemID).map((creator) => creator.fieldMode === 1
        ? { creatorType: creator.creatorType, lastName: '', name: creator.lastName }
        : { creatorType: creator.creatorType, firstName: creator.firstName, lastName: creator.lastName }),
      year, itemType: row.typeName, doi: values.DOI || null, abstract: values.abstractNote || null,
      tags: tagsFor.all(row.itemID).map((entry) => entry.name), collections: collectionsFor.all(row.itemID).map((entry) => entry.key),
      publisher: values.publisher || null, publicationTitle: values.publicationTitle || values.bookTitle || values.proceedingsTitle || null,
      isbn: values.ISBN || null, issn: values.ISSN || null, url: values.url || null, date, language: values.language || null,
      volume: values.volume || null, issue: values.issue || null, pages: values.pages || null, edition: values.edition || null,
      place: values.place || null, rights: values.rights || null, extra: values.extra || null,
      fields: Object.fromEntries(Object.entries(values).filter(([name, value]) => !common.has(name) && value)),
      dateAdded: String(row.dateAdded ?? '') || null, dateModified: String(row.dateModified ?? '') || null,
    };
  });

  const collectionRows = db.prepare(`
    SELECT c.collectionID, c.key, c.collectionName, p.key parentKey, c.version,
           (SELECT COUNT(*) FROM collectionItems ci WHERE ci.collectionID=c.collectionID) itemCount,
           (SELECT COUNT(*) FROM collections child WHERE child.parentCollectionID=c.collectionID) subCount
    FROM collections c LEFT JOIN collections p ON p.collectionID=c.parentCollectionID
    WHERE c.libraryID=1 ORDER BY c.collectionID
  `).all();
  const collections = collectionRows.map((row) => ({
    key: row.key, itemKey: row.key, library: personal, name: row.collectionName,
    parentCollection: row.parentKey || false, itemCount: Number(row.itemCount), subCount: Number(row.subCount),
  }));
  const libraryVersion = Number(db.prepare('SELECT version FROM libraries WHERE libraryID=1').pluck().get() ?? 0);

  const { LibraryDiskStore } = require(path.join(repoRoot, 'electron/library/libraryStorage.ts'));
  const { LibraryCatalog } = require(path.join(repoRoot, 'electron/library/libraryCatalog.ts'));
  const { importZoteroLibraries, mapZoteroLibraryItemType } = require(path.join(repoRoot, 'electron/library/zoteroLibraryImport.ts'));
  const store = new LibraryDiskStore(libraryRoot, 'zotero-copy-test-device');
  const catalog = new LibraryCatalog(path.join(profile, 'library', 'catalog.sqlite'));
  const client = {
    async libraries() { return [personal]; },
    async libraryVersion() { return libraryVersion; },
    async allCollections() { return collections; },
    async libraryItems(_library, options = {}) { options.onProgress?.(items.length, items.length); return { items, version: libraryVersion, total: items.length }; },
    async deletedSince() { return { version: libraryVersion, items: [], collections: [] }; },
    async itemAttachments() { throw new Error('attachments must remain disabled for the isolated database test'); },
    async attachmentFilePath() { return null; },
  };
  const report = await importZoteroLibraries({
    requestId: 'isolated-real-copy', store, catalog, client,
    selection: { libraryIds: ['users/0'], includeUnfiled: true, copyAttachments: false, fullRefresh: true },
  });
  assert.equal(report.itemsCreated, items.length);
  assert.equal(report.attachmentsCopied, 0);
  assert.equal(catalog.list({ limit: 500 }).total, items.length);
  for (const sourceItem of items) {
    const imported = store.findItemBySourceIdentity({ source: 'zotero', libraryType: 'user', libraryId: '0', itemKey: sourceItem.itemKey });
    assert.ok(imported, `copied Zotero item ${sourceItem.itemKey} was imported`);
    assert.equal(imported.metadata.itemType, mapZoteroLibraryItemType(sourceItem.itemType));
  }
  assert.equal(statSync(sourceDatabase).isFile(), true, 'the original Zotero database remains outside the test workspace');
  catalog.close(); db.close();
  console.log(`Isolated Zotero copy test passed: ${items.length} sampled records across ${new Set(items.map((item) => item.itemType)).size} real item types and ${collections.length} collections.`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
