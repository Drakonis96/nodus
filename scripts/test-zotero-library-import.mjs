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
    extra: 'Citation Key: garciafernandezEntreNormaDeseo2020', fields: { series: 'Historia contemporánea', numPages: '312' }, dateAdded: '2026-01-01', dateModified: '2026-02-01',
    ...overrides,
  };
}

try {
  await mkdir(sourceFiles, { recursive: true });
  const pdf = path.join(sourceFiles, 'norma.pdf');
  const image = path.join(sourceFiles, 'figura.png');
  const epub = path.join(sourceFiles, 'grupo.epub');
  const localNote = path.join(sourceFiles, 'local.txt');
  await writeFile(pdf, '%PDF-1.4\nfixture-pdf\n');
  await writeFile(image, 'fixture-image');
  await writeFile(epub, 'fixture-epub');
  await writeFile(localNote, 'local attachment retained by Nodus');
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
    async libraries() { state.calls.push('libraries'); return state.availableLibraries ?? [personal, group]; },
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
    async itemNotes(_userId, key) { return key === 'A' ? [{ key: 'NOTE1', title: 'Nota Zotero', html: '<h2>Fuente</h2><p>No editable</p>', version: 1 }] : []; },
    async attachmentFilePath(_userId, key) { return fileMap.get(key) ?? null; },
  };

  const { LibraryDiskStore } = require(path.join(repoRoot, 'electron/library/libraryStorage.ts'));
  const { LibraryCatalog } = require(path.join(repoRoot, 'electron/library/libraryCatalog.ts'));
  const { LibraryOperations } = require(path.join(repoRoot, 'electron/library/libraryOperations.ts'));
  const { importZoteroLibraries, previewZoteroLibraries } = require(path.join(repoRoot, 'electron/library/zoteroLibraryImport.ts'));
  const { ZoteroSyncSessionStore } = require(path.join(repoRoot, 'electron/library/libraryZoteroSyncSessions.ts'));
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
  assert.equal(first.partial, true, 'an unavailable Zotero file produces an explicit partial result');
  const sessionStore = new ZoteroSyncSessionStore(root);
  assert.equal(sessionStore.get('first').status, 'completed');
  assert.equal(sessionStore.get('first').report.attachmentsUnavailable, 1);
  const canonicalAId = catalog.resolveItemId('zotero:A');
  assert.ok(canonicalAId?.startsWith('nodus:'), 'a manager key is an alias, never the canonical Nodus ID');
  assert.deepEqual(catalog.list({ collectionId: 'zotero:ROOT' }).items.map((entry) => entry.id), [canonicalAId]);

  const storedA = store.findItemByIdOrAlias(canonicalAId);
  assert.equal(storedA.id, canonicalAId);
  assert.equal(storedA.sourceLibraryId, 'users/0');
  assert.equal(storedA.metadata.issn[0], '1234-5678');
  assert.equal(storedA.metadata.extra['Citation Key'], 'garciafernandezEntreNormaDeseo2020');
  assert.equal(storedA.metadata.extra['Zotero field: series'], 'Historia contemporánea');
  assert.equal(storedA.metadata.extra['Zotero field: numPages'], '312');
  assert.equal(storedA.attachments[0].sourceKey, 'PDF', 'PDF wins original-format priority even if Zotero returned an image first');
  assert.equal(storedA.attachments[0].role, 'original');
  assert.equal(storedA.notes[0].source, 'zotero');
  assert.equal(storedA.notes[0].readOnly, true);
  assert.match(storedA.notes[0].markdown, /## Fuente/);
  assert.ok(existsSync(path.join(store.itemFolder(storedA.storageId), storedA.files.original)));
  const storedGroup = store.findItemBySourceIdentity({ source: 'zotero', libraryType: 'group', libraryId: '42', itemKey: 'G1' });
  assert.ok(existsSync(path.join(store.itemFolder(storedGroup.storageId), 'attachments', 'EPUB-grupo.epub')));
  assert.equal(catalog.getImportSource('zotero:users/0').version, 10);
  assert.equal(catalog.getImportSource('zotero:groups/42').version, 7);

  const operations = new LibraryOperations(store, catalog);
  operations.updateItemMetadata('zotero:A', { publisher: 'Corrección local de Nodus', language: 'ca', rights: undefined });
  operations.addAttachments('zotero:A', [localNote]);
  operations.patchItemTags(['zotero:A'], { add: ['revisión Nodus'], remove: ['historia'] });
  assert.equal(store.findItemByIdOrAlias(canonicalAId).metadataOverrides.publisher, 'Corrección local de Nodus');
  assert.equal(store.findItemByIdOrAlias(canonicalAId).metadataOverrides.rights, null, 'cleared manager fields use an explicit durable tombstone');

  const groupRevision = storedGroup.clock.revision;
  state.personalVersion = 12;
  state.personalItems = [item({ version: 12, title: 'Norma y deseo — revisado', dateModified: '2026-03-01' })];
  state.deletedPersonal = ['B'];
  const second = await importZoteroLibraries({ requestId: 'refresh', store, catalog, client });
  assert.equal(second.itemsCreated, 0);
  assert.equal(second.itemsUpdated, 1);
  assert.equal(second.itemsDeleted, 0, 'legacy deletion counters stay at zero because source disappearance is not local deletion');
  assert.equal(second.itemsSourceMissing, 1);
  assert.equal(second.conflicts, 1, 'a changed source version reports preserved Nodus corrections as a conflict');
  assert.equal(second.attachmentsCopied, 0);
  assert.equal(second.attachmentsUnchanged, 2);
  assert.equal(store.findItemByIdOrAlias(canonicalAId).metadata.title, 'Norma y deseo — revisado');
  assert.equal(store.findItemByIdOrAlias(canonicalAId).metadata.publisher, 'Corrección local de Nodus', 'a Zotero refresh preserves local metadata corrections');
  assert.equal(store.findItemByIdOrAlias(canonicalAId).metadata.language, 'ca');
  assert.equal(store.findItemByIdOrAlias(canonicalAId).metadata.rights, undefined);
  assert.deepEqual(store.findItemByIdOrAlias(canonicalAId).metadata.tags, ['revisión Nodus'], 'Nodus tag additions and source-tag suppression survive refresh');
  const missingB = store.findItemByIdOrAlias(catalog.resolveItemId('zotero:B') ?? 'zotero:B')
    ?? store.scanMaterializedItems().records.find((entry) => entry.aliases.includes('zotero:B'));
  assert.equal(missingB.deletedAt, null);
  assert.equal(missingB.sourceState, 'source-missing');
  assert.ok(missingB.sourceMissingAt);
  assert.equal(catalog.list().items.find((entry) => entry.id === missingB.id).sourceState, 'source-missing');
  const refreshedA = store.findItemByIdOrAlias(canonicalAId);
  assert.ok(refreshedA.attachments.some((entry) => entry.sourceKey === undefined && entry.fileName === 'local.txt'), 'Zotero refresh retains local Nodus attachments');
  assert.equal(store.findItemByIdOrAlias(storedGroup.id).clock.revision, groupRevision, 'an unchanged group item receives no phantom revision');
  assert.equal(catalog.list().total, 3, 'source-missing items remain visible and recoverable');
  assert.equal(catalog.getImportSource('zotero:users/0').version, 12);

  const currentA = store.findItemByIdOrAlias(canonicalAId);
  const currentComponents = Object.fromEntries(Object.entries(currentA.contentRevision.components).map(([name, component]) => [name, {
    ...component, freshness: 'current', fingerprint: `${name}-before-zotero-file-change`, generatedAt: new Date().toISOString(), reason: null,
  }]));
  store.upsertItem({ ...currentA, contentRevision: {
    ...currentA.contentRevision, revision: currentA.contentRevision.revision + 1, components: currentComponents,
  } }, currentA.clock.revision);
  await writeFile(pdf, '%PDF-1.4\nchanged-fixture-pdf\n');
  state.personalVersion = 13;
  state.personalItems = [item({ version: 13, title: 'Norma y deseo — revisado', dateModified: '2026-03-02' })];
  state.deletedPersonal = [];
  const attachmentRefresh = await importZoteroLibraries({ requestId: 'attachment-refresh', selection: { libraryIds: ['users/0'] }, store, catalog, client });
  assert.equal(attachmentRefresh.attachmentsChanged, 1);
  assert.equal(attachmentRefresh.attachmentsCopied, 1);
  const changedA = store.findItemByIdOrAlias(canonicalAId);
  assert.equal(changedA.contentRevision.components.extraction.freshness, 'queued');
  for (const component of ['deep', 'passages', 'ideas', 'embeddings', 'summary']) {
    assert.equal(changedA.contentRevision.components[component].freshness, 'stale', `${component} cannot remain current after Zotero changes the primary file`);
  }

  fileMap.delete('PDF');
  state.personalVersion = 14;
  state.personalItems = [item({ version: 14, title: 'Norma y deseo — revisado', dateModified: '2026-03-03' })];
  const unavailableRefresh = await importZoteroLibraries({ requestId: 'attachment-unavailable', selection: { libraryIds: ['users/0'] }, store, catalog, client });
  assert.equal(unavailableRefresh.attachmentsUnavailable, 1);
  const unavailableA = store.findItemByIdOrAlias(canonicalAId);
  assert.equal(unavailableA.attachments.find((entry) => entry.sourceKey === 'PDF').sourceState, 'not-downloaded');
  assert.ok(unavailableA.attachments.some((entry) => entry.fileName === 'local.txt'));

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
  assert.equal(canceledCatalogCount, 3);
  assert.equal(catalog.list().total, 3, 'canceling file transfer keeps the already durable catalog');
  assert.equal(sessionStore.get('cancel').status, 'canceled');

  state.availableLibraries = [personal];
  const missingLibrary = await importZoteroLibraries({
    requestId: 'missing-library', selection: { libraryIds: ['groups/42'] }, store, catalog, client,
  });
  assert.equal(missingLibrary.partial, true);
  assert.deepEqual(missingLibrary.librariesMissing, ['groups/42']);
  assert.equal(missingLibrary.failures[0].code, 'library-missing');
  assert.equal(store.findItemByIdOrAlias(storedGroup.id).sourceState, 'library-missing');
  assert.equal(sessionStore.get('missing-library').status, 'failed');
  assert.equal(sessionStore.list()[0].id, 'missing-library');

  const sourceAfter = await Promise.all([pdf, image, epub].map((file) => readFile(file, 'utf8')));
  assert.equal(sourceAfter[1], sourceBefore[1]);
  assert.equal(sourceAfter[2], sourceBefore[2]);
  catalog.close();
  console.log('Global one-way Zotero import, differential refresh, attachments and cancellation tests passed!');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
