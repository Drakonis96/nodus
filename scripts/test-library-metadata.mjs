import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-library-metadata-suite')) process.exit(0);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-library-metadata-'));
const userData = path.join(scratch, 'user-data');
const root = path.join(scratch, 'backups', 'nodus-library');
installRuntimeHooks(userData);
const require = createRequire(import.meta.url);

const jsonResponse = (value) => new Response(JSON.stringify(value), {
  status: 200, headers: { 'content-type': 'application/json' },
});

try {
  const { resolveLibraryMetadata } = require(path.join(repoRoot, 'electron/library/libraryMetadataResolver.ts'));
  const { parseRis, parseBibtex, parseCslJson } = require(path.join(repoRoot, 'electron/library/libraryBibliographyImport.ts'));
  const { LibraryDiskStore } = require(path.join(repoRoot, 'electron/library/libraryStorage.ts'));
  const { LibraryCatalog } = require(path.join(repoRoot, 'electron/library/libraryCatalog.ts'));
  const { LibraryOperations } = require(path.join(repoRoot, 'electron/library/libraryOperations.ts'));

  const requested = [];
  const fetcher = async (input) => {
    const url = new URL(String(input)); requested.push(url);
    if (url.hostname === 'openlibrary.org') return jsonResponse({ docs: [{
      key: '/works/OL1W', title: 'Historia de las mujeres', author_name: ['María Pérez'], first_publish_year: 2017,
      publisher: ['Editorial Sur'], isbn: ['9788400000000'], language: ['spa'], subject: ['Historia'],
    }] });
    if (url.pathname.includes('/journals/')) return jsonResponse({ message: { items: [{
      DOI: '10.5555/revista.2', title: ['Otro artículo'], type: 'journal-article', author: [{ given: 'Ana', family: 'López' }],
      issued: { 'date-parts': [[2021, 3]] }, ISSN: ['1234-567X'], URL: 'https://doi.org/10.5555/revista.2',
    }] } });
    return jsonResponse({ message: {
      DOI: '10.5555/norma.1', title: ['Entre norma y deseo'], type: 'journal-article',
      author: [{ given: 'Mónica', family: 'García Fernández' }], abstract: '<jats:p>Texto   limpio</jats:p>',
      issued: { 'date-parts': [[2020, 5, 2]] }, publisher: 'CSIC', 'container-title': ['Arenal'],
      ISSN: ['1134-6396'], URL: 'https://doi.org/10.5555/norma.1',
    } });
  };

  const doi = await resolveLibraryMetadata('doi', 'https://doi.org/10.5555/norma.1', { fetcher });
  assert.equal(doi.value, '10.5555/norma.1');
  assert.equal(doi.candidates[0].metadata.title, 'Entre norma y deseo');
  assert.equal(doi.candidates[0].metadata.creators[0].lastName, 'García Fernández');
  assert.equal(doi.candidates[0].metadata.abstract, 'Texto limpio');
  assert.equal(doi.candidates[0].metadata.year, 2020);
  assert.match(requested[0].pathname, /works\/10\.5555%2Fnorma\.1/);

  const isbn = await resolveLibraryMetadata('isbn', '978-84-0000-000-0', { fetcher });
  assert.equal(isbn.candidates[0].source, 'open-library');
  assert.equal(isbn.candidates[0].metadata.itemType, 'book');
  assert.equal(isbn.candidates[0].metadata.publisher, 'Editorial Sur');
  assert.equal(requested.at(-1).searchParams.get('isbn'), '9788400000000');

  const issn = await resolveLibraryMetadata('issn', '1234-567X', { fetcher });
  assert.equal(issn.candidates[0].metadata.doi, '10.5555/revista.2');
  assert.equal(requested.at(-1).searchParams.get('rows'), '10');
  await assert.rejects(resolveLibraryMetadata('doi', 'not-a-doi', { fetcher }), /formato válido/);
  await assert.rejects(resolveLibraryMetadata('isbn', '1234', { fetcher }), /10 o 13/);

  const ris = parseRis(`TY  - JOUR
ID  - Garcia2020
TI  - Entre norma y deseo
AU  - García Fernández, Mónica
PY  - 2020
DO  - 10.5555/norma.1
SN  - 1134-6396
KW  - género
ER  -
TY  - BOOK
TI  - Mujeres solas
AU  - Aliaga, Nuria
PY  - 2017
SN  - 9788400000000
ER  -`);
  assert.equal(ris.length, 2);
  assert.equal(ris[0].citationKey, 'Garcia2020');
  assert.equal(ris[0].metadata.creators[0].lastName, 'García Fernández');
  assert.deepEqual(ris[1].metadata.isbn, ['9788400000000']);

  const bibtex = parseBibtex(`@article{garcia2020,
    title = {Entre {norma} y deseo},
    author = {García Fernández, Mónica and Pérez, Ana},
    year = {2020}, doi = {10.5555/norma.1},
    journal = {Arenal}, keywords = {género; historia}
  }`);
  assert.equal(bibtex[0].citationKey, 'garcia2020');
  assert.equal(bibtex[0].metadata.title, 'Entre norma y deseo');
  assert.equal(bibtex[0].metadata.creators.length, 2);

  const csl = parseCslJson(JSON.stringify([{ id: 'csl-1', type: 'book', title: 'Libro CSL', author: [{ given: 'Irene', family: 'Ruiz' }], issued: { 'date-parts': [[2019]] }, ISBN: '9788400000000' }]));
  assert.equal(csl[0].source, 'csl-json');
  assert.equal(csl[0].metadata.year, 2019);
  const mendeley = parseCslJson(JSON.stringify({ documents: [{ citation_key: 'men-1', type: 'journal', title: 'Exportación Mendeley', authors: [{ first_name: 'Eva', last_name: 'Gil' }], year: 2022, identifiers: { doi: '10.9/mendeley' } }] }));
  assert.equal(mendeley[0].source, 'mendeley');
  assert.equal(mendeley[0].citationKey, 'men-1');

  const store = new LibraryDiskStore(root, 'metadata-test-device');
  const catalog = new LibraryCatalog(path.join(userData, 'library', 'catalog.sqlite'));
  const operations = new LibraryOperations(store, catalog);
  const collection = operations.createCollection('Importadas', null);
  const risFile = path.join(scratch, 'references.ris');
  await writeFile(risFile, `TY  - JOUR\nTI  - Una referencia importada\nAU  - Pérez, Laura\nPY  - 2023\nDO  - 10.7777/import.1\nER  -\n`);
  const imported = operations.importBibliographyFiles([risFile], collection.id);
  assert.equal(imported.created, 1);
  assert.equal(catalog.list({ collectionId: collection.id }).total, 1);
  assert.equal(operations.importBibliographyFiles([risFile], collection.id).duplicates, 1);

  const canonical = store.upsertItem({
    id: 'nodus:canonical', storageId: 'nodus:canonical', source: 'nodus',
    metadata: { title: 'Documento duplicado', itemType: 'document', creators: [{ creatorType: 'author', name: 'Laura Pérez' }], year: 2020, doi: '10.8888/duplicate', isbn: [], issn: [], tags: ['principal'] },
    collectionIds: [collection.id], attachments: [], files: { annotations: 'annotations.json' }, extraction: { status: 'pending' }, deletedAt: null,
  });
  const duplicateFolder = store.itemFolder('zotero:DUP'); await mkdir(path.join(duplicateFolder, 'attachments'), { recursive: true });
  const payload = 'duplicate attachment'; const hash = createHash('sha256').update(payload).digest('hex');
  await writeFile(path.join(duplicateFolder, 'attachments', 'original.pdf'), payload);
  await writeFile(path.join(duplicateFolder, 'reader.md'), '# Documento duplicado\n\nTexto limpio.\n');
  await writeFile(path.join(duplicateFolder, 'annotations.json'), JSON.stringify([{ id: 'note-1', documentId: 'zotero:DUP', comment: 'Conservar' }]));
  store.upsertItem({
    id: 'zotero:DUP', storageId: 'zotero:DUP', source: 'zotero', sourceLibraryId: 'users/0', sourceKey: 'DUP',
    metadata: { title: 'Documento duplicado', itemType: 'article-journal', creators: [{ creatorType: 'author', name: 'Laura Pérez' }], year: 2020, doi: 'https://doi.org/10.8888/duplicate', isbn: [], issn: ['1111-2222'], tags: ['zotero'], publisher: 'Editorial' },
    collectionIds: ['zotero:C'], attachments: [{ id: 'attachment:DUP', title: 'Original', fileName: 'original.pdf', relativePath: 'attachments/original.pdf', mimeType: 'application/pdf', byteSize: payload.length, sha256: hash, role: 'original' }],
    files: { original: 'attachments/original.pdf', reader: 'reader.md', annotations: 'annotations.json' }, extraction: { status: 'ready', progress: 1, engine: 'fixture' }, deletedAt: null,
  });
  catalog.rebuild(store);
  const groups = operations.listDuplicateGroups();
  assert.ok(groups.some((group) => group.reason === 'doi' && group.items.length === 2));
  const merged = operations.mergeItems(canonical.id, ['zotero:DUP']);
  assert.equal(merged.extraction.status, 'ready');
  assert.equal(merged.metadata.publisher, 'Editorial');
  assert.deepEqual(new Set(merged.metadata.tags), new Set(['principal', 'zotero']));
  assert.deepEqual(new Set(merged.collectionIds), new Set([collection.id, 'zotero:C']));
  assert.equal(merged.attachments.length, 1);
  assert.ok(existsSync(path.join(store.itemFolder(merged.storageId), merged.files.reader)));
  const annotations = JSON.parse(await readFile(path.join(store.itemFolder(merged.storageId), merged.files.annotations), 'utf8'));
  assert.equal(annotations[0].documentId, merged.storageId);
  assert.ok(store.readMaterializedItem('zotero:DUP').deletedAt);
  assert.equal(catalog.list().items.some((item) => item.id === 'zotero:DUP'), false);

  catalog.close();
  console.log('Metadata resolution, bibliography imports, local overrides and duplicate merge tests passed!');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
