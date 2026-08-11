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
  const { parseRis, parseBibtex, parseCslJson, parseEndNoteXml, parseZoteroRdf, parseBibliographyCsv, parseBibliographyMarkdown } = require(path.join(repoRoot, 'electron/library/libraryBibliographyImport.ts'));
  const { exportLibraryBibliography, formatLibraryCitation, generateCitationKey } = require(path.join(repoRoot, 'electron/library/libraryCitation.ts'));
  const { runLibraryMetadataBatch } = require(path.join(repoRoot, 'electron/library/libraryMetadataBatch.ts'));
  const { mergeLibraryMetadataCandidate } = require(path.join(repoRoot, 'shared/libraryMetadata.ts'));
  const { detectLibraryMetadataIdentifier, LIBRARY_COLUMNS, LIBRARY_ITEM_TYPES } = require(path.join(repoRoot, 'shared/libraryBibliography.ts'));
  const languageTables = {
    en: require(path.join(repoRoot, 'src/i18n.en.ts')).EN,
    fr: require(path.join(repoRoot, 'src/i18n.fr.ts')).FR,
    de: require(path.join(repoRoot, 'src/i18n.de.ts')).DE,
    pt: require(path.join(repoRoot, 'src/i18n.pt.ts')).PT,
    'pt-BR': require(path.join(repoRoot, 'src/i18n.pt-BR.ts')).PT_BR,
    it: require(path.join(repoRoot, 'src/i18n.it.ts')).IT,
    tr: require(path.join(repoRoot, 'src/i18n.tr.ts')).TR,
  };
  const { mapZoteroLibraryItemType } = require(path.join(repoRoot, 'electron/library/zoteroLibraryImport.ts'));
  const { LibraryDiskStore } = require(path.join(repoRoot, 'electron/library/libraryStorage.ts'));
  const { LibraryCatalog } = require(path.join(repoRoot, 'electron/library/libraryCatalog.ts'));
  const { LibraryOperations } = require(path.join(repoRoot, 'electron/library/libraryOperations.ts'));
  const { normalizeLibraryMetadata } = require(path.join(repoRoot, 'electron/library/libraryRecord.ts'));

  assert.equal(normalizeLibraryMetadata({ title: 'Undated', itemType: 'document', creators: [], year: null }).year, null, 'an empty year never becomes year zero');

  const zoteroTypes = LIBRARY_ITEM_TYPES.filter((entry) => entry.zoteroType);
  assert.equal(zoteroTypes.length, 37, 'every current citeable Zotero type is available');
  assert.equal(zoteroTypes.find((entry) => entry.zoteroType === 'bookSection').id, 'book-chapter');
  assert.equal(zoteroTypes.find((entry) => entry.zoteroType === 'bookSection').label, 'Capítulo de libro');
  for (const definition of zoteroTypes) assert.notEqual(mapZoteroLibraryItemType(definition.zoteroType), 'other', definition.zoteroType);
  for (const [locale, translations] of Object.entries(languageTables)) {
    for (const definition of LIBRARY_ITEM_TYPES) assert.ok(translations[definition.label], `${locale} translates item type ${definition.label}`);
    for (const column of LIBRARY_COLUMNS) assert.ok(translations[column.label], `${locale} translates column ${column.label}`);
  }
  assert.equal(mapZoteroLibraryItemType('preprint'), 'preprint');
  assert.equal(mapZoteroLibraryItemType('standard'), 'standard');
  assert.ok(LIBRARY_COLUMNS.some((column) => column.id === 'doi'));
  assert.ok(LIBRARY_COLUMNS.some((column) => column.id === 'edition'));
  assert.ok(LIBRARY_COLUMNS.every((column) => column.sort), 'every visible bibliography column supports header sorting');
  assert.deepEqual(detectLibraryMetadataIdentifier('https://doi.org/10.5555/norma.1').kind, 'doi');
  assert.deepEqual(detectLibraryMetadataIdentifier('978-0-306-40615-7').kind, 'isbn');
  assert.deepEqual(detectLibraryMetadataIdentifier('ISSN: 1234-567X').kind, 'issn');
  assert.deepEqual(detectLibraryMetadataIdentifier('PMID: 12345678').kind, 'pmid');
  assert.deepEqual(detectLibraryMetadataIdentifier('PMC7654321').kind, 'pmcid');
  assert.deepEqual(detectLibraryMetadataIdentifier('arXiv:2401.01234').kind, 'arxiv');
  assert.equal(detectLibraryMetadataIdentifier('not an identifier'), null);

  const requested = [];
  const fetcher = async (input) => {
    const url = new URL(String(input)); requested.push(url);
    if (url.hostname === 'eutils.ncbi.nlm.nih.gov') return jsonResponse({ result: { '12345678': {
      uid: '12345678', title: 'A PubMed paper', authors: [{ name: 'Pérez M' }], pubdate: '2024 Jan', fulljournalname: 'Medical History',
      volume: '12', issue: '2', pages: '10-18', issn: '1234-5678', articleids: [{ idtype: 'doi', value: '10.5555/pubmed.1' }, { idtype: 'pubmed', value: '12345678' }, { idtype: 'pmc', value: 'PMC7654321' }],
    } } });
    if (url.hostname === 'www.ncbi.nlm.nih.gov') return jsonResponse({ records: [{ pmid: '12345678', pmcid: 'PMC7654321', doi: '10.5555/pubmed.1' }] });
    if (url.hostname === 'export.arxiv.org') return new Response(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom"><entry><id>https://arxiv.org/abs/2401.01234</id><published>2024-01-03T00:00:00Z</published><title>  A clean arXiv title </title><summary>Double   spaces cleaned.</summary><author><name>Ana López</name></author><arxiv:doi>10.5555/arxiv.1</arxiv:doi></entry></feed>`, { status: 200, headers: { 'content-type': 'application/atom+xml' } });
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
  const pmid = await resolveLibraryMetadata('pmid', 'PMID: 12345678', { fetcher });
  assert.equal(pmid.candidates[0].source, 'pubmed');
  assert.equal(pmid.candidates[0].metadata.pmcid, 'PMC7654321');
  assert.equal(pmid.candidates[0].metadata.title, 'A PubMed paper');
  const pmcid = await resolveLibraryMetadata('pmcid', 'PMC7654321', { fetcher });
  assert.equal(pmcid.candidates[0].metadata.pmid, '12345678');
  const arxiv = await resolveLibraryMetadata('arxiv', 'https://arxiv.org/abs/2401.01234', { fetcher });
  assert.equal(arxiv.candidates[0].source, 'arxiv');
  assert.equal(arxiv.candidates[0].metadata.abstract, 'Double spaces cleaned.');
  assert.equal(arxiv.candidates[0].metadata.arxiv, '2401.01234');
  await assert.rejects(resolveLibraryMetadata('pmcid', '7654', { fetcher }), /formato PMC/);
  const mergedCandidate = mergeLibraryMetadataCandidate(
    { title: 'Local title', itemType: 'article-journal', creators: [{ creatorType: 'author', name: 'Local Author' }], year: 2020, isbn: ['LOCAL'], issn: [], tags: ['local'], extra: { local: 'kept' } },
    { title: 'Resolved title', itemType: 'article-journal', creators: [], year: 2024, isbn: [], issn: ['REMOTE'], tags: ['remote'], extra: { remote: 'kept' } },
  );
  assert.equal(mergedCandidate.creators[0].name, 'Local Author');
  assert.deepEqual(mergedCandidate.tags, ['local', 'remote']);
  assert.deepEqual(mergedCandidate.extra, { local: 'kept', remote: 'kept' });

  const ris = parseRis(`TY  - JOUR
ID  - Garcia2020
TI  - Entre norma y deseo
AU  - García Fernández, Mónica
PY  - 2020
DO  - 10.5555/norma.1
SN  - 1134-6396
KW  - género
M3  - campo conservado
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
  assert.equal(ris[0].metadata.extra['ris:M3'], 'campo conservado');
  assert.deepEqual(ris[1].metadata.isbn, ['9788400000000']);

  const bibtex = parseBibtex(`@article{garcia2020,
    title = {Entre {norma} y deseo},
    author = {García Fernández, Mónica and Pérez, Ana},
    year = {2020}, doi = {10.5555/norma.1},
    journal = {Arenal}, keywords = {género; historia}, customfield = {campo conservado}
  }`);
  assert.equal(bibtex[0].citationKey, 'garcia2020');
  assert.equal(bibtex[0].metadata.title, 'Entre norma y deseo');
  assert.equal(bibtex[0].metadata.creators.length, 2);
  assert.equal(bibtex[0].metadata.extra['bibtex:customfield'], 'campo conservado');

  const csl = parseCslJson(JSON.stringify([{ id: 'csl-1', type: 'book', title: 'Libro CSL', author: [{ given: 'Irene', family: 'Ruiz' }], issued: { 'date-parts': [[2019]] }, ISBN: '9788400000000', customfield: 'campo conservado' }]));
  assert.equal(csl[0].source, 'csl-json');
  assert.equal(csl[0].metadata.year, 2019);
  assert.equal(csl[0].metadata.extra['csl:customfield'], 'campo conservado');
  const mendeley = parseCslJson(JSON.stringify({ documents: [{ citation_key: 'men-1', type: 'journal', title: 'Exportación Mendeley', authors: [{ first_name: 'Eva', last_name: 'Gil' }], year: 2022, identifiers: { doi: '10.9/mendeley' } }] }));
  assert.equal(mendeley[0].source, 'mendeley');
  assert.equal(mendeley[0].citationKey, 'men-1');

  const endnote = parseEndNoteXml(`<?xml version="1.0"?><xml><records><record><rec-number>End2024</rec-number><ref-type name="Journal Article"/><contributors><authors><author>Pérez, María</author></authors></contributors><titles><title>EndNote title</title><secondary-title>Journal</secondary-title></titles><dates><year>2024</year></dates><electronic-resource-num>10.1/endnote</electronic-resource-num><custom7>unknown value</custom7></record></records></xml>`);
  assert.equal(endnote[0].citationKey, 'End2024');
  assert.equal(endnote[0].metadata.title, 'EndNote title');
  assert.equal(endnote[0].metadata.extra['endnote:custom7'], 'unknown value');
  const rdf = parseZoteroRdf(`<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:bib="http://purl.org/net/biblio#" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:z="http://www.zotero.org/namespaces/export#"><bib:Article rdf:about="urn:nodus:Rdf2024"><z:itemType>journalArticle</z:itemType><dc:title>RDF title</dc:title><dc:creator>Ana López</dc:creator><dc:date>2024</dc:date><dc:identifier>doi:10.1/rdf</dc:identifier><dc:relation>campo conservado</dc:relation></bib:Article></rdf:RDF>`);
  assert.equal(rdf[0].citationKey, 'Rdf2024');
  assert.equal(rdf[0].metadata.creators[0].name, 'Ana López');
  assert.equal(rdf[0].metadata.extra['zotero-rdf:dc:relation'], 'campo conservado');
  const csv = parseBibliographyCsv('citationKey,type,title,authors,year,doi,extra.custom\nCsv2024,article,CSV title,"Pérez, María",2024,10.1/csv,kept\n');
  assert.equal(csv[0].citationKey, 'Csv2024'); assert.equal(csv[0].metadata.extra.custom, 'kept');
  const markdown = parseBibliographyMarkdown('---\ncitationKey: "Md2024"\ntype: "book"\ntitle: "Markdown title"\nauthors: "Ana López"\nyear: "2024"\nextra.custom: "kept"\n---\n\n# Markdown title\n');
  assert.equal(markdown[0].metadata.extra.custom, 'kept');
  const recordFrom = (entry, id) => ({
    format: 'nodus.library-item', formatVersion: 2, id, storageId: id, aliases: [], sourceIdentities: [], source: entry.source,
    citationKey: entry.citationKey, metadata: entry.metadata, collectionIds: [], attachments: [], createdAt: new Date(0).toISOString(), deletedAt: null,
    clock: { deviceId: 'test', revision: 1, baseRevision: 0, updatedAt: new Date(0).toISOString(), contentHash: 'a'.repeat(64) },
  });
  for (const [format, entry, parser, extraKey] of [
    ['ris', ris[0], parseRis, 'ris:M3'], ['bibtex', bibtex[0], parseBibtex, 'bibtex:customfield'],
    ['csl-json', csl[0], parseCslJson, 'csl:customfield'], ['endnote-xml', endnote[0], parseEndNoteXml, 'endnote:custom7'],
    ['zotero-rdf', rdf[0], parseZoteroRdf, 'zotero-rdf:dc:relation'], ['csv', csv[0], parseBibliographyCsv, 'custom'],
    ['markdown', markdown[0], parseBibliographyMarkdown, 'custom'],
  ]) {
    const restored = parser(exportLibraryBibliography([recordFrom(entry, `roundtrip:${format}`)], format))[0];
    assert.equal(restored.metadata.extra[extraKey], entry.metadata.extra[extraKey], `${format} preserves unknown fields`);
  }

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
  const importedRecord = store.readMaterializedItem(imported.itemIds[0]);
  assert.ok(importedRecord.citationKey, 'imports always receive a stable citation key');
  const generated = generateCitationKey(importedRecord.metadata, [importedRecord.citationKey], importedRecord.citationKey);
  assert.notEqual(generated, importedRecord.citationKey);
  const cslExport = exportLibraryBibliography([importedRecord], 'csl-json');
  assert.equal(parseCslJson(cslExport)[0].metadata.title, importedRecord.metadata.title);
  const roundTrips = [
    ['ris', parseRis], ['bibtex', parseBibtex], ['biblatex', (text) => parseBibtex(text, 'biblatex')],
    ['endnote-xml', parseEndNoteXml], ['zotero-rdf', parseZoteroRdf], ['csv', parseBibliographyCsv], ['markdown', parseBibliographyMarkdown],
  ];
  for (const [format, parser] of roundTrips) {
    const parsed = parser(exportLibraryBibliography([importedRecord], format));
    assert.equal(parsed.length, 1, `${format} export can be imported`);
    assert.equal(parsed[0].metadata.title, importedRecord.metadata.title, `${format} preserves title`);
    assert.equal(parsed[0].citationKey, importedRecord.citationKey, `${format} preserves citation key`);
  }
  for (const style of ['apa-7', 'chicago-author-date', 'mla-9', 'ieee', 'vancouver']) {
    const bibliography = formatLibraryCitation([importedRecord], style, 'bibliography');
    assert.match(bibliography.text, /Una referencia importada/);
    assert.equal(bibliography.style, style);
    assert.ok(formatLibraryCitation([importedRecord], style, 'citation').text.length > 2);
  }
  const withoutIdentifier = operations.createItem({ title: 'No identifier', itemType: 'document', creators: [], year: null, isbn: [], issn: [], tags: [] });
  const batchController = new AbortController();
  const batch = await runLibraryMetadataBatch([{ itemId: importedRecord.id, item: importedRecord }, { itemId: withoutIdentifier.id, item: withoutIdentifier }], {
    signal: batchController.signal, rateLimitMs: 0,
    resolve: async (kind, value) => ({ kind, value, candidates: [{ id: 'preview', source: 'crossref', confidence: 1, sourceUrl: null, metadata: importedRecord.metadata }], queriedAt: new Date().toISOString() }),
  });
  assert.equal(batch.status, 'ready'); assert.ok(batch.entries[0].candidate); assert.match(batch.entries[1].error, /No hay DOI/);
  const cancelController = new AbortController();
  const canceled = await runLibraryMetadataBatch([{ itemId: importedRecord.id, item: importedRecord }, { itemId: importedRecord.id, item: importedRecord }], {
    signal: cancelController.signal, rateLimitMs: 1,
    resolve: async (kind, value) => ({ kind, value, candidates: [{ id: 'partial', source: 'crossref', confidence: 1, sourceUrl: null, metadata: importedRecord.metadata }], queriedAt: new Date().toISOString() }),
    onStep: (entry) => { if (entry) cancelController.abort(); },
  });
  assert.equal(canceled.status, 'canceled'); assert.equal(canceled.entries.length, 1, 'cancellation returns verified partial results');

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
  assert.ok(merged.aliases.includes('zotero:DUP'), 'merged IDs remain permanent aliases of the canonical record');
  assert.equal(catalog.resolveItemId('zotero:DUP'), canonical.id);
  assert.equal(catalog.list().items.some((item) => item.id === 'zotero:DUP'), false);

  catalog.close();
  console.log('Metadata resolution, bibliography imports, local overrides and duplicate merge tests passed!');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
