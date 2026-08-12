// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-office-references-suite')) process.exit(0);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-office-references-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
const { writeGlobalPrefsRaw } = require(path.join(repoRoot, 'electron/db/appPrefs.ts'));
writeGlobalPrefsRaw({ autoBackupFolder: path.join(scratch, 'backups') });
const { formatLibraryOfficeDocumentCsl, importLibraryCitationStyleFiles } = require(path.join(repoRoot, 'electron/library/libraryCslStyles.ts'));
const libraryService = require(path.join(repoRoot, 'electron/library/libraryService.ts'));

try {

function record(id, citationKey, metadata) {
  const now = '2026-08-12T00:00:00.000Z';
  return {
    format: 'nodus.library-item', formatVersion: 2, id, storageId: id, aliases: [],
    sourceIdentities: [], source: 'nodus', citationKey, metadata, collectionIds: [],
    attachments: [], createdAt: now, deletedAt: null,
    clock: { deviceId: 'office-test', revision: 1, baseRevision: 0, updatedAt: now, contentHash: '' },
  };
}

const records = [
  record('work:perez', 'perezBuruenoAnalisis2023', {
    title: 'Análisis cuantitativo de los diarios de pioneros', itemType: 'article-journal', year: 2023,
    date: '2023', publicationTitle: 'Vínculos de Historia', volume: '12', pages: '388–407',
    doi: '10.18239/vdh_2023.12.21', creators: [{ creatorType: 'author', firstName: 'Jorge', lastName: 'Pérez Burgueño' }],
    isbn: [], issn: ['2254-6901'], tags: ['migration'],
  }),
  record('work:garcia', 'garciafernandezEntreNormaDeseo2020', {
    title: 'Entre la norma y el deseo', itemType: 'book', year: 2020, publisher: 'Sílex', place: 'Madrid',
    creators: [{ creatorType: 'author', firstName: 'Mónica', lastName: 'García Fernández' }],
    isbn: ['9788418388282'], issn: [], tags: ['gender'],
  }),
  record('work:aliaga', 'aliamirandaMujeresSolasPosguerra2017', {
    title: 'Mujeres solas en la posguerra', itemType: 'book-chapter', year: 2017, pages: '91–114',
    publicationTitle: 'Mujeres, género y violencia',
    creators: [
      { creatorType: 'author', firstName: 'María', lastName: 'Aliaga' },
      { creatorType: 'editor', firstName: 'Ana', lastName: 'Miranda' },
    ],
    isbn: ['9788490455667'], issn: [], tags: [],
  }),
];

const snapshot = (item) => ({ citationKey: item.citationKey, metadata: item.metadata });
const request = {
  style: 'apa-7', locale: 'es-ES',
  citations: [
    {
      citationId: 'citation-1', noteIndex: 0, placement: 'in-text',
      citationItems: [
        { id: 'work:perez', locator: '388', label: 'page', prefix: 'véase ', suffix: '; contexto', snapshot: snapshot(records[0]) },
        { id: 'work:garcia', locator: '2', label: 'chapter', snapshot: snapshot(records[1]) },
      ],
    },
    {
      citationId: 'citation-2', noteIndex: 0, placement: 'in-text',
      citationItems: [{ id: 'work:aliaga', suppressAuthor: true, snapshot: snapshot(records[2]) }],
    },
  ],
  uncitedItems: [{ id: 'work:garcia', snapshot: snapshot(records[1]) }],
  excludedItemIds: ['work:aliaga'],
};

const apa = await formatLibraryOfficeDocumentCsl(records, request);
assert.equal(apa.citations.length, 2);
assert.match(apa.citations[0].text, /Pérez Burgueño/);
assert.match(apa.citations[0].text, /388/);
assert.match(apa.citations[0].text, /véase/);
assert.match(apa.citations[0].text, /contexto/);
assert.match(apa.citations[1].text, /2017/);
assert.doesNotMatch(apa.citations[1].text, /Aliaga/, 'omit-author must reach citeproc');
assert.ok(apa.citations.every((entry) => entry.html.length > 0), 'Word/Writer receive rich HTML as well as plain text');
assert.ok(apa.bibliography);
assert.deepEqual(new Set(apa.bibliography.itemIds), new Set(['work:perez', 'work:garcia']));
assert.match(apa.bibliography.text, /Análisis cuantitativo/);
assert.match(apa.bibliography.text, /Entre la norma/);
assert.doesNotMatch(apa.bibliography.text, /Mujeres solas/, 'explicit bibliography exclusion must be respected');

const note = await formatLibraryOfficeDocumentCsl(records, {
  style: 'chicago-author-date', locale: 'es-ES',
  citations: [{
    citationId: 'note-1', noteIndex: 1, placement: 'footnote',
    citationItems: [{ id: 'work:perez', locator: '401', label: 'page', snapshot: snapshot(records[0]) }],
  }],
});
assert.equal(note.citations[0].noteIndex, 1);
assert.match(note.citations[0].text, /Pérez Burgueño/);
assert.match(note.citations[0].text, /401/);
assert.match(note.bibliography.text, /Vínculos de Historia/);

const customNoteStyle = path.join(scratch, 'nodus-office-test-note.csl');
await writeFile(customNoteStyle, `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" class="note">
  <info>
    <title>Nodus office note test</title>
    <id>https://example.invalid/styles/nodus-office-test-note</id>
    <category citation-format="note"/>
    <updated>2026-08-12T00:00:00+00:00</updated>
  </info>
  <citation><layout suffix="."><text variable="title"/></layout></citation>
  <bibliography><layout><text variable="title"/></layout></bibliography>
</style>`, 'utf8');
const importedStyle = importLibraryCitationStyleFiles([customNoteStyle], 'file');
assert.equal(importedStyle.imported, 1);
const noteCategory = await formatLibraryOfficeDocumentCsl(records, {
  style: 'nodus-office-test-note', locale: 'en-US',
  citations: [{ citationId: 'note-format-1', noteIndex: 1, placement: 'footnote', citationItems: [{ id: 'work:perez' }] }],
});
assert.equal(noteCategory.citationFormat, 'note', 'custom and Zotero-imported note styles must advertise note placement');

const reordered = await formatLibraryOfficeDocumentCsl(records, {
  ...request,
  citations: [request.citations[1], request.citations[0]],
});
assert.deepEqual(reordered.citations.map((entry) => entry.citationId), ['citation-2', 'citation-1']);

const created = records.map((item) => libraryService.createGlobalLibraryItem(item.metadata));
const byDoi = await libraryService.searchGlobalLibraryOfficeReferences('10.18239/vdh_2023.12.21', 10);
assert.equal(byDoi.length, 1);
assert.equal(byDoi[0].id, created[0].id);
assert.equal(byDoi[0].snapshot.metadata.title, records[0].metadata.title);
const byAuthor = await libraryService.searchGlobalLibraryOfficeReferences('García Fernández', 10);
assert.equal(byAuthor.length, 1);
assert.equal(byAuthor[0].snapshot.metadata.isbn[0], '9788418388282');
const byCitationKey = await libraryService.searchGlobalLibraryOfficeReferences(created[0].citationKey, 10);
assert.equal(byCitationKey.length, 1, 'the office picker must search stable citation keys as documented');
assert.equal(byCitationKey[0].id, created[0].id);

const portable = await libraryService.formatGlobalLibraryOfficeDocument({
  style: 'apa-7', locale: 'es-ES',
  citations: [{
    citationId: 'portable-1', noteIndex: 0, placement: 'in-text',
    citationItems: [{ id: 'source-not-installed', snapshot: snapshot(records[2]) }],
  }],
});
assert.match(portable.citations[0].text, /Aliaga/);
assert.match(portable.bibliography.text, /Mujeres solas/);

  console.log('Office live citation, locator, note, exclusion, bibliography, and rich-output tests passed!');
} finally {
  libraryService.closeGlobalLibrary();
  await rm(scratch, { recursive: true, force: true });
}
