import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-zotero-library-import-suite')) process.exit(0);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-zotero-library-'));
const userData = path.join(scratch, 'user-data');
const root = path.join(scratch, 'backups', 'nodus-library');
const sourceFiles = path.join(scratch, 'zotero-storage');
installRuntimeHooks(userData);
const require = createRequire(import.meta.url);

function item(overrides) {
  return {
    key: 'A', itemKey: 'A', library: { type: 'user', id: '0', name: 'Mi biblioteca' }, version: 10,
    title: 'Norma y deseo', creators: [{ creatorType: 'author', firstName: 'Ana', lastName: 'García' }],
    year: 2020, itemType: 'journalArticle', doi: '10.1234/norma', abstract: 'Un resumen limpio.',
    tags: ['historia'], collections: ['ROOT'], publisher: 'Editorial', publicationTitle: 'Revista',
    isbn: '978-84-0000-000-0', issn: '1234-5678', url: 'https://example.test/a', date: '2020-05-10',
    language: 'es', volume: '4', issue: '2', pages: '10-30', edition: null, place: 'Madrid', rights: 'CC BY',
    extra: 'Citation Key: garciafernandezEntreNormaDeseo2020', dateAdded: '2026-01-01', dateModified: '2026-02-01',
    ...overrides,
  };
}

try {
  await mkdir(sourceFiles, { recursive: true });
  const pdf = path.join(sourceFiles, 'norma.pdf');
  const image = path.join(sourceFiles, 'figura.png');
  const epub = path.join(sourceFiles, 'grupo.epub');
  await writeFile(pdf, '%PDF-1.4\nfixture-pdf\n');
  await writeFile(image, 'fixture-image');
  await writeFile(epub, 'fixture-epub');
  const sourceBefore = await Promise.all([pdf, image, epub].map((file) => readFile(file, 'utf8')));

  const personal = { type: 'user', id: '0', name: 'Mi biblioteca' };
  const group = { type: 'group', id: '42', name: 'Grupo Historia' };
  const state = {
    personalVersion: 10,
    groupVersion: 7,
    personalItems: [
      item({}),
      item({ key: 'B', itemKey: 'B', title: 'Documento sin fichero', collections: [], doi: null, isbn: null, issn: null }),
    ],
    groupItems: [item({
      key: 'groups:42:G1', itemKey: 'G1', library: group, version: 7, title: 'Libro del grupo',
      itemType: 'book', collections: ['groups:42:GC'], doi: null,
    })],
    deletedPersonal: [],
    calls: [],
  };
  const attachmentMap = new Map([
    ['A', [
      { key: 'IMG', itemKey: 'IMG', library: personal, title: 'Figura', contentType: 'image/png', linkMode: 'imported_file', filename: 'figura.png', available: true },
      { key: 'PDF', itemKey: 'PDF', library: personal, title: 'Texto completo', contentType: 'application/pdf', linkMode: 'imported_file', filename: 'norma.pdf', available: true },
    ]],
    ['B', [{ key: 'MISS', itemKey: 'MISS', library: personal, title: 'Perdido', contentType: 'application/pdf', linkMode: 'imported_file', filename: 'missing.pdf', available: true }]],
    ['groups:42:G1', [{ key: 'groups:42:EPUB', itemKey: 'EPUB', library: group, title: 'EPUB', contentType: 'application/epub+zip', linkMode: 'imported_file', filename: 'grupo.epub', available: true }]],
  ]);
  const fileMap = new Map([['PDF', pdf], ['IMG', image], ['groups:42:EPUB', epub]]);
  const client = {
    async libraries() { state.calls.push('libraries'); return [personal, group]; },
    async libraryVersion(_userId, library) { return library.type === 'group' ? state.groupVersion : state.personalVersion; },
    async allCollections(library) {
      if (library.type === 'group') return [{ key: 'groups:42:GC', itemKey: 'GC', library, name: 'Grupo', parentCollection: false, itemCount: 1, subCount: 0 }];
      return [
        { key: 'ROOT', itemKey: 'ROOT', library, name: 'Historia', parentCollection: false, itemCount: 1, subCount: 1 },
        { key: 'CHILD', itemKey: 'CHILD', library, name: 'Mujeres', parentCollection: 'ROOT', itemCount: 0, subCount: 0 },
      ];
    },
    async libraryItems(library, options = {}) {
      const version = library.type === 'group' ? state.groupVersion : state.personalVersion;
      let items = library.type === 'group' ? state.groupItems : state.personalItems;
      if (options.since) items = items.filter((entry) => entry.version > options.since);
      options.onProgress?.(items.length, items.length);
      return { items, version, total: items.length };
    },
    async deletedSince(library, since) {
      return { version: library.type === 'group' ? state.groupVersion : state.personalVersion, items: library.type === 'group' || since <= 0 ? [] : state.deletedPersonal, collections: [] };
    },
    async itemAttachments(_userId, key) { return attachmentMap.get(key) ?? []; },
    async attachmentFilePath(_userId, key) { return fileMap.get(key) ?? null; },
  };

  const { LibraryDiskStore } = require(path.join(repoRoot, 'electron/library/libraryStorage.ts'));
  const { LibraryCatalog } = require(path.join(repoRoot, 'electron/library/libraryCatalog.ts'));
  const { importZoteroLibraries, previewZoteroLibraries } = require(path.join(repoRoot, 'electron/library/zoteroLibraryImport.ts'));
  const store = new LibraryDiskStore(root, 'zotero-import-device-0001');
  const catalog = new LibraryCatalog(path.join(userData, 'library', 'catalog.sqlite'));
  const preview = await previewZoteroLibraries(catalog, client);
  assert.deepEqual(preview.map((entry) => [entry.id, entry.lastImportedVersion]), [['users/0', 0], ['groups/42', 0]]);

  const events = [];
  let catalogVisibleBeforeFiles = false;
  const first = await importZoteroLibraries({
    requestId: 'first', store, catalog, client,
    onProgress(value) {
      events.push(value);
      if (value.phase === 'attachments' && catalog.list().total === 3) catalogVisibleBeforeFiles = true;
    },
  });
  assert.equal(first.itemsCreated, 3);
  assert.equal(first.attachmentsCopied, 3);
  assert.equal(first.attachmentsUnavailable, 1);
  assert.equal(catalog.list().total, 3);
  assert.equal(catalogVisibleBeforeFiles, true, 'the searchable catalog is committed before file copies');
  assert.ok(events.every((value, index) => index === 0 || value.percent >= events[index - 1].percent), 'progress is monotonic across personal and group libraries');
  assert.equal(events.at(-1).phase, 'complete');
  assert.equal(events.at(-1).percent, 100);
  assert.deepEqual(catalog.list({ collectionId: 'zotero:ROOT' }).items.map((entry) => entry.id), ['zotero:A']);

  const storedA = store.readMaterializedItem('A');
  assert.equal(storedA.id, 'zotero:A');
  assert.equal(storedA.sourceLibraryId, 'users/0');
  assert.equal(storedA.metadata.issn[0], '1234-5678');
  assert.equal(storedA.metadata.extra['Citation Key'], 'garciafernandezEntreNormaDeseo2020');
  assert.equal(storedA.attachments[0].sourceKey, 'PDF', 'PDF wins original-format priority even if Zotero returned an image first');
  assert.equal(storedA.attachments[0].role, 'original');
  assert.ok(existsSync(path.join(store.itemFolder('A'), storedA.files.original)));
  assert.ok(existsSync(path.join(store.itemFolder('groups:42:G1'), 'attachments', 'EPUB-grupo.epub')));
  assert.equal(catalog.getImportSource('zotero:users/0').version, 10);
  assert.equal(catalog.getImportSource('zotero:groups/42').version, 7);

  const groupRevision = store.readMaterializedItem('groups:42:G1').clock.revision;
  state.personalVersion = 12;
  state.personalItems = [item({ version: 12, title: 'Norma y deseo — revisado', dateModified: '2026-03-01' })];
  state.deletedPersonal = ['B'];
  const second = await importZoteroLibraries({ requestId: 'refresh', store, catalog, client });
  assert.equal(second.itemsCreated, 0);
  assert.equal(second.itemsUpdated, 1);
  assert.equal(second.itemsDeleted, 1);
  assert.equal(second.attachmentsCopied, 0);
  assert.equal(second.attachmentsUnchanged, 2);
  assert.equal(store.readMaterializedItem('A').metadata.title, 'Norma y deseo — revisado');
  assert.ok(store.readMaterializedItem('B').deletedAt);
  assert.equal(store.readMaterializedItem('groups:42:G1').clock.revision, groupRevision, 'an unchanged group item receives no phantom revision');
  assert.equal(catalog.list().total, 2);
  assert.equal(catalog.getImportSource('zotero:users/0').version, 12);

  const controller = new AbortController();
  let canceledCatalogCount = 0;
  const canceled = await importZoteroLibraries({
    requestId: 'cancel', selection: { fullRefresh: true }, store, catalog, client, signal: controller.signal,
    onProgress(value) {
      if (value.phase === 'attachments') {
        canceledCatalogCount = catalog.list().total;
        controller.abort();
      }
    },
  });
  assert.equal(canceled.canceled, true);
  assert.equal(canceledCatalogCount, 2);
  assert.equal(catalog.list().total, 2, 'canceling file transfer keeps the already durable catalog');

  const sourceAfter = await Promise.all([pdf, image, epub].map((file) => readFile(file, 'utf8')));
  assert.deepEqual(sourceAfter, sourceBefore, 'the importer never modifies Zotero attachment storage');
  catalog.close();
  console.log('Global one-way Zotero import, differential refresh, attachments and cancellation tests passed!');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
