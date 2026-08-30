// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Strict live oracle for the Zotero -> Nodus importer.
 *
 * The default mode is deliberately cheap: it only checks that Zotero is up and
 * prints the independent inventory. `--all` performs the complete import into
 * a fresh temporary directory, then reconciles every work, note and file by
 * source identity and SHA-256. `--dry-run --all` builds the same oracle without
 * importing, which is useful before an expensive real-library run.
 *
 * This file never writes Zotero and never writes the user's vault or Zotero
 * profile. The only writes are under a fresh OS temporary directory.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

// `requireElectronRuntime` keeps the native SQLite ABI isolated by re-executing
// this file under Electron. Preserve the audit flags across that hop; the helper
// intentionally passes only its private runtime marker on argv.
if (!process.argv.includes('--electron-zotero-live-audit')) {
  process.env.NODUS_ZOTERO_AUDIT_ARGS = JSON.stringify(process.argv.slice(2));
}
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-zotero-live-audit')) process.exit(0);

const cliArgs = (() => {
  try { return JSON.parse(process.env.NODUS_ZOTERO_AUDIT_ARGS ?? '[]'); } catch { return []; }
})();

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-zotero-audit-'));
const userData = path.join(scratch, 'user-data');
installRuntimeHooks(userData);
const require = createRequire(import.meta.url);

const API_HEADERS = {
  'Zotero-Allowed-Request': '1',
  'Zotero-API-Version': '3',
};
const FILE_MODES = new Set(['imported_file', 'imported_url', 'linked_file']);

function usage() {
  console.log(`Usage: node scripts/audit-zotero-live-import.mjs [--all] [--dry-run]\n\n  --all       inventory and reconcile every available Zotero library\n  --dry-run   do not import; only print the independent oracle inventory\n\nWithout --all this command only performs a non-mutating connectivity check.`);
}

function arg(name) { return cliArgs.includes(name); }

function sourceLibraryId(library) {
  return library.type === 'group' ? `groups/${library.id}` : `users/${library.id || '0'}`;
}

// Match the canonical source identity written by the importer. Keeping the
// provider type and transport library id separate also prevents a user key and
// a group key with the same eight-character Zotero key from colliding.
function identity(library, itemKey) { return `${library.type}:${library.id || '0'}:${itemKey}`; }

function storedIdentity(source, itemKey) {
  return `${source.libraryType}:${source.libraryId || '0'}:${itemKey}`;
}

function collectionIdentity(libraryId, collectionKey) { return `${libraryId}:${collectionKey}`; }

function rawKey(raw) { return String(raw?.data?.key ?? raw?.key ?? ''); }

const SUPPLEMENTARY_ATTACHMENT = /supplement|supporting[\s_-]+information|appendix|annex/i;

function oracleAttachmentPriority(attachment) {
  const mime = String(attachment.contentType ?? '').toLowerCase();
  const extension = path.extname(attachment.filename ?? '').toLowerCase();
  const format = mime === 'application/pdf' || extension === '.pdf' ? 0
    : mime.includes('epub') || extension === '.epub' ? 1
      : ['.md', '.markdown', '.jats', '.xml', '.html', '.htm'].includes(extension) ? 2
        : ['.docx', '.odt', '.rtf'].includes(extension) ? 3
          : mime.startsWith('text/plain') || extension === '.txt' ? 4
            : ['.csv', '.tsv', '.xlsx', '.xls', '.ods'].includes(extension) ? 5
              : String(attachment.linkMode).toLowerCase().includes('snapshot') ? 6
                : mime.startsWith('image/') ? 7 : 8;
  return format + (SUPPLEMENTARY_ATTACHMENT.test(`${attachment.title ?? ''} ${attachment.filename ?? ''}`) ? 0.5 : 0);
}

function oracleAttachmentRole(attachment, index) {
  if (index === 0) return 'original';
  if (String(attachment.linkMode).toLowerCase().includes('snapshot')) return 'snapshot';
  if (String(attachment.contentType).toLowerCase().startsWith('image/')) return 'image';
  return 'supplement';
}

async function readJsonPage(url) {
  const response = await fetch(url, { headers: API_HEADERS });
  if (!response.ok) throw new Error(`Zotero oracle HTTP ${response.status}: ${url}`);
  return { data: await response.json(), response };
}

/** Read `/items` directly, independently of the importer/client mapper. */
async function readLibraryVersion(base, library) {
  const prefix = library.type === 'group' ? `groups/${encodeURIComponent(library.id)}` : `users/${encodeURIComponent(library.id || '0')}`;
  const { response } = await readJsonPage(`${base}/${prefix}/items?limit=1`);
  return Number(response.headers.get('Last-Modified-Version')) || 0;
}

async function readRawPages(base, library, resource) {
  const prefix = library.type === 'group' ? `groups/${encodeURIComponent(library.id)}` : `users/${encodeURIComponent(library.id || '0')}`;
  const items = [];
  const versions = [];
  let start = 0;
  const limit = 100;
  for (;;) {
    const sort = resource === 'items' ? '&sort=dateModified&direction=asc' : '&sort=title';
    const { data, response } = await readJsonPage(`${base}/${prefix}/${resource}?limit=${limit}&start=${start}${sort}`);
    assert.ok(Array.isArray(data), `Zotero oracle returned a non-array page for ${sourceLibraryId(library)}`);
    items.push(...data);
    const version = Number(response.headers.get('Last-Modified-Version'));
    if (Number.isFinite(version) && version > 0) versions.push(version);
    const totalHeader = response.headers.get('Total-Results');
    const total = totalHeader === null ? null : Number(totalHeader);
    start += data.length;
    if (!data.length || data.length < limit || (Number.isFinite(total) && start >= total)) break;
  }
  return { entries: items, versions };
}

async function filePathFromZotero(base, library, itemKey) {
  const prefix = library.type === 'group' ? `groups/${encodeURIComponent(library.id)}` : `users/${encodeURIComponent(library.id || '0')}`;
  const response = await fetch(`${base}/${prefix}/items/${encodeURIComponent(itemKey)}/file`, {
    headers: API_HEADERS, redirect: 'manual',
  });
  const location = response.headers.get('location');
  if (!location?.startsWith('file:')) return null;
  try {
    const declaredPath = fileURLToPath(location);
    if (existsSync(declaredPath) && (await stat(declaredPath)).isFile()) return declaredPath;
    const directory = path.dirname(declaredPath);
    if (!existsSync(directory) || !(await stat(directory)).isDirectory()) return null;
    const candidates = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
      .map((entry) => path.join(directory, entry.name));
    const extension = path.extname(declaredPath).toLocaleLowerCase();
    if (candidates.length === 1
      && (!extension || path.extname(candidates[0]).toLocaleLowerCase() === extension)) return candidates[0];
    const sameExtension = extension
      ? candidates.filter((candidate) => path.extname(candidate).toLocaleLowerCase() === extension)
      : [];
    return sameExtension.length === 1 ? sameExtension[0] : null;
  } catch { return null; }
}

async function sha256(file) {
  const hash = createHash('sha256');
  hash.update(await readFile(file));
  return hash.digest('hex');
}

/**
 * Build the expected state from raw Zotero JSON. No `libraryItems`,
 * `itemAttachments`, or Nodus code is used here, so a shared mapper cannot
 * make both sides agree while dropping an object.
 */
async function buildOracle(base, library, { hashFiles = false } = {}) {
  let raw = [];
  let rawCollections = [];
  let snapshotVersion = 0;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const startVersion = await readLibraryVersion(base, library);
    const itemPage = await readRawPages(base, library, 'items');
    const collectionPage = await readRawPages(base, library, 'collections');
    const endVersion = await readLibraryVersion(base, library);
    const observed = [...itemPage.versions, ...collectionPage.versions];
    if (startVersion === endVersion && observed.every((version) => version === startVersion)) {
      raw = itemPage.entries;
      rawCollections = collectionPage.entries;
      snapshotVersion = endVersion;
      break;
    }
    if (attempt === 3) throw new Error(`Zotero changed ${library.name} during the independent oracle inventory.`);
  }
  const references = new Map();
  const standalone = new Map();
  const attachments = [];
  const notes = [];
  for (const entry of raw) {
    const data = entry?.data ?? {};
    const key = rawKey(entry);
    if (!key) continue;
    const parent = data.parentItem ? String(data.parentItem) : null;
    if (data.itemType === 'note') {
      if (parent) notes.push({ key, parent, parentIdentity: identity(library, parent), identity: identity(library, key), sourceLibraryId: sourceLibraryId(library), title: String(data.title || 'Zotero note'),
        html: String(data.note || ''), version: Number(data.version ?? entry.version ?? 0) });
      continue;
    }
    if (data.itemType === 'annotation') continue;
    if (data.itemType === 'attachment') {
      const file = !parent && FILE_MODES.has(String(data.linkMode));
      attachments.push({
        key, parent, parentIdentity: identity(library, parent || key), identity: identity(library, key), file,
        title: String(data.title || data.filename || 'Adjunto'),
        linkedUrl: data.linkMode === 'linked_url', linkMode: data.linkMode ?? null, filename: data.filename ?? null,
        contentType: data.contentType ?? null, version: Number(data.version ?? entry.version ?? 0),
        dateModified: data.dateModified ?? null, sourcePath: null, sourceSha256: null,
      });
      if (file) standalone.set(key, { key, identity: identity(library, key), sourceLibraryId: sourceLibraryId(library), raw: data });
      continue;
    }
    if (!parent) references.set(key, { key, identity: identity(library, key), sourceLibraryId: sourceLibraryId(library), raw: data });
  }
  const items = new Map([...references, ...standalone]);
  const itemKeys = new Set(items.keys());
  const expectedFiles = attachments.filter((entry) => !entry.linkedUrl && (entry.parent ? itemKeys.has(entry.parent) : entry.file));
  const filesByParent = new Map();
  for (const attachment of expectedFiles) filesByParent.set(attachment.parentIdentity, [...(filesByParent.get(attachment.parentIdentity) ?? []), attachment]);
  for (const entries of filesByParent.values()) {
    entries.sort((a, b) => oracleAttachmentPriority(a) - oracleAttachmentPriority(b) || a.key.localeCompare(b.key));
    entries.forEach((entry, index) => { entry.position = index; entry.role = oracleAttachmentRole(entry, index); });
  }
  const expectedNotes = notes.filter((entry) => itemKeys.has(entry.parent));
  if (hashFiles) {
    for (const attachment of expectedFiles) {
      attachment.sourcePath = await filePathFromZotero(base, library, attachment.key);
      if (attachment.sourcePath && existsSync(attachment.sourcePath)) {
        const sourceStat = await stat(attachment.sourcePath);
        if (sourceStat.isFile()) attachment.sourceSha256 = await sha256(attachment.sourcePath);
      }
    }
    const afterHashVersion = await readLibraryVersion(base, library);
    if (afterHashVersion !== snapshotVersion) {
      throw new Error(`Zotero changed ${library.name} while the oracle hashed files (${snapshotVersion} -> ${afterHashVersion}).`);
    }
  }
  const collections = rawCollections.flatMap((entry) => {
    const key = rawKey(entry);
    const data = entry?.data ?? {};
    return key ? [{ key, identity: collectionIdentity(sourceLibraryId(library), key), name: String(data.name ?? entry.name ?? ''),
      parentKey: data.parentCollection ? String(data.parentCollection) : null }] : [];
  });
  return {
    library,
    sourceLibraryId: sourceLibraryId(library),
    rawCount: raw.length,
    references: [...references.values()],
    standalone: [...standalone.values()],
    items: [...items.values()],
    attachments,
    expectedFiles,
    notes: expectedNotes,
    collections,
    version: snapshotVersion,
  };
}

function attachmentRecords(record) {
  return (record.attachments ?? []).filter((entry) => entry.sourceKey && entry.sourceState !== 'source-missing');
}

const REPRESENTED_ZOTERO_FIELDS = new Set([
  'key', 'version', 'itemType', 'title', 'shortTitle', 'creators', 'date', 'DOI', 'abstractNote', 'tags', 'collections',
  'publisher', 'publicationTitle', 'bookTitle', 'proceedingsTitle', 'ISBN', 'ISSN', 'url', 'language', 'volume', 'issue',
  'pages', 'edition', 'place', 'rights', 'extra', 'dateAdded', 'dateModified', 'relations',
]);

function expectedItemMetadata(raw) {
  const d = raw.raw ?? {};
  const title = String(d.title ?? d.shortTitle ?? '(sin título)').trim() || 'Documento sin título';
  const creators = (d.creators ?? []).map((creator) => ({
    creatorType: creator.creatorType || 'author',
    ...(String(creator.firstName ?? '').trim() ? { firstName: String(creator.firstName).trim() } : {}),
    ...(String(creator.lastName ?? '').trim() ? { lastName: String(creator.lastName).trim() } : {}),
    ...(String(creator.name ?? '').trim() ? { name: String(creator.name).trim() } : {}),
    fieldMode: String(creator.name ?? '').trim() ? 1 : 0,
  }));
  const extra = {};
  for (const line of String(d.extra ?? '').split(/\r?\n/)) {
    const match = /^([^:]{1,100}):\s*(.+)$/.exec(line.trim());
    if (match) extra[match[1].trim()] = match[2].trim();
  }
  extra['Zotero item type'] = String(d.itemType ?? '');
  extra['Zotero version'] = String(d.version ?? raw.version ?? 0);
  for (const [name, value] of Object.entries(d)) {
    if (REPRESENTED_ZOTERO_FIELDS.has(name) || !['string', 'number', 'boolean'].includes(typeof value)) continue;
    const clean = String(value).trim();
    if (clean) extra[`Zotero field: ${name}`] = clean;
  }
  for (const name of ['shortTitle', 'bookTitle', 'proceedingsTitle']) {
    const clean = typeof d[name] === 'string' ? d[name].trim() : '';
    if (clean) extra[`Zotero field: ${name}`] = clean;
  }
  if (d.relations && typeof d.relations === 'object' && Object.keys(d.relations).length) {
    extra['Zotero field: relations'] = JSON.stringify(d.relations);
  }
  if (Array.isArray(d.tags) && d.tags.some((tag) => tag && typeof tag === 'object' && 'type' in tag)) {
    extra['Zotero field: tags'] = JSON.stringify(d.tags);
  }
  if (d.dateAdded) extra['Zotero date added'] = String(d.dateAdded);
  if (d.dateModified) extra['Zotero date modified'] = String(d.dateModified);
  const mapType = String(d.itemType ?? '').toLowerCase().replace(/[^a-z]/g, '');
  const mapped = { journalarticle: 'journal-article', articlejournal: 'journal-article', magazinearticle: 'magazine-article', newspaperarticle: 'newspaper-article', book: 'book', booksection: 'book-chapter', chapter: 'book-chapter', conferencepaper: 'conference-paper', proceedings: 'conference-paper', thesis: 'thesis', report: 'report', manuscript: 'manuscript', presentation: 'presentation', interview: 'interview', letter: 'letter', email: 'email', instantmessage: 'instant-message', encyclopediaarticle: 'encyclopedia-article', dictionaryentry: 'dictionary-entry', case: 'case', hearing: 'hearing', bill: 'bill', statute: 'statute', patent: 'patent', artwork: 'artwork', map: 'map', film: 'film', audiorecording: 'audio-recording', videorecording: 'video-recording', radiobroadcast: 'radio-broadcast', tvbroadcast: 'tv-broadcast', podcast: 'podcast', blogpost: 'blog-post', forumpost: 'forum-post', computerprogram: 'computer-program', webpage: 'webpage', dataset: 'dataset', document: 'document', preprint: 'preprint', standard: 'standard' }[mapType] ?? (mapType ? 'document' : 'other');
  const cleanTags = [...new Set((d.tags ?? []).map((tag) => String(tag.tag ?? '').trim()).filter(Boolean))].sort();
  return { title, itemType: mapped, creators, abstract: optionalString(d.abstractNote), date: optionalString(d.date), publisher: optionalString(d.publisher),
    publicationTitle: optionalString(d.publicationTitle ?? d.bookTitle ?? d.proceedingsTitle), volume: optionalString(d.volume), issue: optionalString(d.issue),
    pages: optionalString(d.pages), edition: optionalString(d.edition), place: optionalString(d.place), rights: optionalString(d.rights), url: optionalString(d.url),
    doi: optionalString(d.DOI), language: optionalString(d.language), year: d.date && /\d{4}/.test(String(d.date)) ? Number(String(d.date).match(/\d{4}/)[0]) : null,
    isbn: d.ISBN == null ? [] : [String(d.ISBN)], issn: d.ISSN == null ? [] : [String(d.ISSN)], tags: cleanTags,
    extra: Object.keys(extra).length ? extra : undefined, collections: (d.collections ?? []).map(String).sort() };
}

function sameJson(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function markdownFromNote(html, turndown) {
  return turndown.turndown(html).trim();
}

function splitIdentifiers(value) {
  return [...new Set(String(value ?? '').split(/[;,\n]+/).map((entry) => entry.trim()).filter(Boolean))];
}

function optionalString(value) {
  if (value === null || value === undefined) return null;
  const clean = String(value).trim();
  return clean || null;
}

async function reconcile({ stores, oracles, report, session }) {
  const expectedItems = new Map(oracles.flatMap((oracle) => oracle.items.map((entry) => [entry.identity, entry])));
  const expectedCollections = new Map(oracles.flatMap((oracle) => oracle.collections.map((entry) => [entry.identity, entry])));
  const expectedNotes = new Map(oracles.flatMap((oracle) => oracle.notes.map((entry) => [entry.identity, entry])));
  const expectedFiles = new Map(oracles.flatMap((oracle) => oracle.expectedFiles.map((entry) => [entry.identity, entry])));
  const storedItems = stores.flatMap((store) => store.scanMaterializedItems().records)
    .filter((record) => record.source === 'zotero' && !record.deletedAt && record.sourceState !== 'source-missing' && record.sourceState !== 'library-missing');
  const storedByIdentity = new Map();
  const duplicateItems = [];
  for (const record of storedItems) {
    for (const source of record.sourceIdentities ?? []) {
      if (source.source !== 'zotero') continue;
      const key = storedIdentity(source, source.itemKey);
      if (storedByIdentity.has(key)) duplicateItems.push(key);
      else storedByIdentity.set(key, record);
    }
  }
  const missingItems = [...expectedItems.keys()].filter((key) => !storedByIdentity.has(key));
  const extraItems = [...storedByIdentity.keys()].filter((key) => !expectedItems.has(key));
  const storedCollections = new Map();
  const duplicateCollections = [];
  for (const record of stores.flatMap((store) => store.scanMaterializedCollections().records)
    .filter((entry) => entry.source === 'zotero' && !entry.deletedAt && entry.sourceState !== 'source-missing' && entry.sourceState !== 'library-missing')) {
    const identity = collectionIdentity(record.sourceLibraryId, record.sourceKey);
    if (storedCollections.has(identity)) duplicateCollections.push(identity);
    else storedCollections.set(identity, record);
  }
  const missingCollections = [...expectedCollections.keys()].filter((key) => !storedCollections.has(key));
  const extraCollections = [...storedCollections.keys()].filter((key) => !expectedCollections.has(key));
  const storedNotes = new Map();
  const storedFiles = new Map();
  const duplicateNotes = [];
  const duplicateFiles = [];
  for (const [key, record] of storedByIdentity) {
    for (const note of record.notes ?? []) {
      if (note.source === 'zotero' && note.sourceKey) {
        const noteKey = `${key.split(':').slice(0, -1).join(':')}:${note.sourceKey}`;
        if (storedNotes.has(noteKey)) duplicateNotes.push(noteKey);
        else storedNotes.set(noteKey, { note, parentIdentity: key });
      }
    }
    for (const attachment of attachmentRecords(record)) {
      const fileKey = `${key.split(':').slice(0, -1).join(':')}:${attachment.sourceKey}`;
      if (storedFiles.has(fileKey)) duplicateFiles.push(fileKey);
      else storedFiles.set(fileKey, { attachment, record, parentIdentity: key });
    }
  }
  const missingNotes = [...expectedNotes.keys()].filter((key) => !storedNotes.has(key));
  const extraNotes = [...storedNotes.keys()].filter((key) => !expectedNotes.has(key));
  const missingFiles = [...expectedFiles.keys()].filter((key) => !storedFiles.has(key));
  const extraFiles = [...storedFiles.keys()].filter((key) => !expectedFiles.has(key));
  const hashMismatches = [];
  for (const [key, expected] of expectedFiles) {
    const stored = storedFiles.get(key);
    if (!stored) continue;
    if (!expected.sourceSha256) { hashMismatches.push({ key, reason: 'zotero-file-unavailable', path: expected.sourcePath }); continue; }
    const folder = stores[0].itemFolder(stored.record.storageId);
    const target = path.resolve(folder, stored.attachment.relativePath);
    if (!target.startsWith(`${path.resolve(folder)}${path.sep}`) || !existsSync(target)) {
      hashMismatches.push({ key, reason: 'nodus-file-missing', path: stored.attachment.relativePath });
      continue;
    }
    const actual = await sha256(target);
    if (actual !== expected.sourceSha256 || stored.attachment.sha256 !== expected.sourceSha256) {
      hashMismatches.push({ key, reason: 'sha256-mismatch', expected: expected.sourceSha256, actual, metadata: stored.attachment.sha256 });
    }
  }
  const semanticMismatches = [];
  let turndown;
  try {
    const TurndownService = require('turndown');
    turndown = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-' });
  } catch (error) {
    semanticMismatches.push({ kind: 'notes', reason: `turndown-unavailable: ${error.message}` });
  }
  for (const expected of expectedItems.values()) {
    const actual = storedByIdentity.get(expected.identity);
    if (!actual) continue;
    const expectedMetadata = expectedItemMetadata(expected);
    const actualMetadata = actual.metadata ?? {};
    for (const field of ['title', 'itemType', 'abstract', 'date', 'publisher', 'publicationTitle', 'volume', 'issue', 'pages', 'edition', 'place', 'rights', 'url', 'doi', 'language', 'year']) {
      if (!sameJson(actualMetadata[field] ?? null, expectedMetadata[field] ?? null)) semanticMismatches.push({ kind: 'metadata', identity: expected.identity, field, expected: expectedMetadata[field] ?? null, actual: actualMetadata[field] ?? null });
    }
    const actualCreators = (actualMetadata.creators ?? []).map((creator) => ({ creatorType: creator.creatorType, firstName: creator.firstName, lastName: creator.lastName, name: creator.name, fieldMode: creator.fieldMode })).map((creator) => JSON.stringify(creator));
    const expectedCreators = expectedMetadata.creators.map((creator) => JSON.stringify(creator));
    if (!sameJson(actualCreators, expectedCreators)) semanticMismatches.push({ kind: 'metadata', identity: expected.identity, field: 'creators', expected: expectedMetadata.creators, actual: actualMetadata.creators });
    for (const field of ['isbn', 'issn']) {
      const actualValues = splitIdentifiers(actualMetadata[field]).sort();
      const expectedValues = splitIdentifiers(expectedMetadata[field]).sort();
      if (!sameJson(actualValues, expectedValues)) semanticMismatches.push({ kind: 'metadata', identity: expected.identity, field, expected: expectedValues, actual: actualValues });
    }
    if (!sameJson([...(actualMetadata.tags ?? [])].map(String).sort(), expectedMetadata.tags)) semanticMismatches.push({ kind: 'metadata', identity: expected.identity, field: 'tags', expected: expectedMetadata.tags, actual: actualMetadata.tags });
    if (!sameJson(actualMetadata.extra ?? {}, expectedMetadata.extra ?? {})) semanticMismatches.push({ kind: 'metadata', identity: expected.identity, field: 'extra', expected: expectedMetadata.extra ?? {}, actual: actualMetadata.extra ?? {} });
    if (actual.sourceKey !== expected.key || actual.sourceVersion !== Number(expected.raw.version ?? 0)) {
      semanticMismatches.push({ kind: 'provenance', identity: expected.identity, expected: { sourceKey: expected.key, sourceVersion: Number(expected.raw.version ?? 0) }, actual: { sourceKey: actual.sourceKey, sourceVersion: actual.sourceVersion } });
    }
    const expectedCitationKey = String(expected.raw.citationKey ?? '').trim();
    if (expectedCitationKey && actual.citationKey !== expectedCitationKey) {
      semanticMismatches.push({ kind: 'citation-key', identity: expected.identity, expected: expectedCitationKey, actual: actual.citationKey ?? null });
    }
    const expectedMemberships = expectedMetadata.collections
      .filter((key) => expectedCollections.has(collectionIdentity(expected.sourceLibraryId, key))).sort();
    const actualMemberships = (actual.collectionIds ?? []).flatMap((collectionId) => {
      const collection = storedCollections.get(collectionId) ?? [...storedCollections.values()].find((entry) => entry.id === collectionId);
      return collection?.sourceLibraryId === expected.sourceLibraryId ? [collection.sourceKey] : [];
    }).filter(Boolean).sort();
    if (!sameJson(actualMemberships, expectedMemberships)) semanticMismatches.push({ kind: 'membership', identity: expected.identity, expected: expectedMemberships, actual: actualMemberships });
  }
  for (const expected of expectedCollections.values()) {
    const actual = storedCollections.get(expected.identity);
    if (!actual) continue;
    const oracle = oracles.find((entry) => entry.collections.some((collection) => collection.identity === expected.identity));
    const collection = oracle?.collections.find((entry) => entry.identity === expected.identity);
    if (collection && String(actual.name) !== collection.name) semanticMismatches.push({ kind: 'collection', identity: expected.identity, field: 'name', expected: collection.name, actual: actual.name });
    const actualParent = actual.parentId ? [...storedCollections.values()].find((entry) => entry.id === actual.parentId)?.sourceKey ?? null : null;
    if (collection && actualParent !== collection.parentKey) semanticMismatches.push({ kind: 'collection', identity: expected.identity, field: 'parent', expected: collection.parentKey, actual: actualParent });
  }
  for (const expected of expectedNotes.values()) {
    const stored = storedNotes.get(expected.identity);
    if (!stored) continue;
    const actual = stored.note;
    if (stored.parentIdentity !== expected.parentIdentity) semanticMismatches.push({ kind: 'note', identity: expected.identity, field: 'parent', expected: expected.parentIdentity, actual: stored.parentIdentity });
    if (actual.title !== expected.title) semanticMismatches.push({ kind: 'note', identity: expected.identity, field: 'title', expected: expected.title, actual: actual.title });
    if (actual.sourceVersion !== expected.version) semanticMismatches.push({ kind: 'note', identity: expected.identity, field: 'version', expected: expected.version, actual: actual.sourceVersion });
    if (actual.readOnly !== true) semanticMismatches.push({ kind: 'note', identity: expected.identity, field: 'readOnly', expected: true, actual: actual.readOnly });
    if (turndown && actual.markdown !== markdownFromNote(expected.html, turndown)) semanticMismatches.push({ kind: 'note', identity: expected.identity, field: 'markdown', expected: markdownFromNote(expected.html, turndown), actual: actual.markdown });
  }
  for (const [key, expected] of expectedFiles) {
    const stored = storedFiles.get(key);
    if (!stored) continue;
    const actual = stored.attachment;
    if (stored.parentIdentity !== expected.parentIdentity) semanticMismatches.push({ kind: 'attachment', identity: key, field: 'parent', expected: expected.parentIdentity, actual: stored.parentIdentity });
    if (actual.title !== expected.title) semanticMismatches.push({ kind: 'attachment', identity: key, field: 'title', expected: expected.title, actual: actual.title });
    if (actual.mimeType !== (expected.contentType || 'application/octet-stream')) semanticMismatches.push({ kind: 'attachment', identity: key, field: 'mimeType', expected: expected.contentType || 'application/octet-stream', actual: actual.mimeType });
    const expectedFileName = expected.sourcePath ? path.basename(expected.sourcePath) : expected.filename || 'adjunto';
    if (actual.fileName !== expectedFileName) semanticMismatches.push({ kind: 'attachment', identity: key, field: 'fileName', expected: expectedFileName, actual: actual.fileName });
    if (actual.sourceVersion !== expected.version) semanticMismatches.push({ kind: 'attachment', identity: key, field: 'sourceVersion', expected: expected.version, actual: actual.sourceVersion });
    if (expected.dateModified && actual.sourceModifiedAt !== expected.dateModified) semanticMismatches.push({ kind: 'attachment', identity: key, field: 'sourceModifiedAt', expected: expected.dateModified, actual: actual.sourceModifiedAt });
    if (actual.role !== expected.role) semanticMismatches.push({ kind: 'attachment', identity: key, field: 'role', expected: expected.role, actual: actual.role });
    if (actual.position !== expected.position) semanticMismatches.push({ kind: 'attachment', identity: key, field: 'position', expected: expected.position, actual: actual.position });
  }
  const mismatchCount = missingCollections.length + extraCollections.length + duplicateCollections.length
    + missingItems.length + extraItems.length + duplicateItems.length
    + missingNotes.length + extraNotes.length + duplicateNotes.length + missingFiles.length + extraFiles.length + duplicateFiles.length + hashMismatches.length;
  const totalMismatches = mismatchCount + semanticMismatches.length;
  const verification = { ok: mismatchCount === 0,
    expectedCollections: expectedCollections.size, importedCollections: storedCollections.size,
    missingCollections, extraCollections, duplicateCollections,
    expectedItems: expectedItems.size, importedItems: storedByIdentity.size,
    expectedNotes: expectedNotes.size, importedNotes: storedNotes.size, expectedFiles: expectedFiles.size,
    importedFiles: storedFiles.size, missingItems, extraItems, duplicateItems, missingNotes, extraNotes, duplicateNotes,
    missingFiles, extraFiles, duplicateFiles, hashMismatches, semanticMismatches };
  verification.ok = totalMismatches === 0;
  console.log('\n--- independent reconciliation ---');
  console.log(JSON.stringify(verification, null, 2));
  assert.equal(totalMismatches, 0, 'the Nodus store does not exactly match the Zotero oracle');
  assert.equal(report.failures?.length ?? 0, 0, 'the import report contains failures');
  assert.equal(report.partial, false, 'the import report is partial');
  if (report.verification) {
    assert.notEqual(report.verification.ok, false, 'the importer verification is blocked');
    assert.notEqual(report.verification.status, 'blocked', 'the importer verification is blocked');
    assert.notEqual(report.verification.status, 'failed', 'the importer verification failed');
    assert.equal(report.verification.mismatches?.length ?? 0, 0, 'the importer reported verification mismatches');
  }
  assert.ok(session, 'the import session was not persisted');
  assert.equal(session.status, 'completed', `unexpected session status: ${session.status}`);
  assert.equal(session.report?.partial, false, 'the persisted session report is partial');
  return verification;
}

async function main() {
  if (arg('--help') || arg('-h')) { usage(); return; }
  const zotero = require(path.join(repoRoot, 'electron/zotero/zoteroClient.ts'));
  const { LibraryDiskStore } = require(path.join(repoRoot, 'electron/library/libraryStorage.ts'));
  const { LibraryCatalog } = require(path.join(repoRoot, 'electron/library/libraryCatalog.ts'));
  const { ZoteroSyncSessionStore } = require(path.join(repoRoot, 'electron/library/libraryZoteroSyncSessions.ts'));
  const { importZoteroLibraries } = require(path.join(repoRoot, 'electron/library/zoteroLibraryImport.ts'));
  const ping = await zotero.ping();
  if (!ping.ok) { console.log(`SKIP: Zotero local API is not answering (${ping.reason}).`); return; }
  if (!arg('--all')) {
    console.log(`Zotero is up (library version ${ping.version ?? 'unknown'}). Use --all for the strict audit.`);
    return;
  }
  const libraries = await zotero.libraries();
  assert.ok(libraries.length, 'Zotero returned no libraries');
  const oracles = [];
  for (const library of libraries) {
    const oracle = await buildOracle(zotero.ZOTERO_API_BASE, library, { hashFiles: !arg('--dry-run') });
    oracles.push(oracle);
    console.log(`${oracle.sourceLibraryId} ${library.name} @ v${oracle.version}: ${oracle.references.length} references + ${oracle.standalone.length} standalone files; ${oracle.collections.length} collections; ${oracle.expectedFiles.length} file attachments; ${oracle.notes.length} notes (raw objects ${oracle.rawCount})`);
  }
  if (arg('--dry-run')) { console.log('\nDry run complete: no import was executed and no user data was modified.'); return; }
  const storeRoot = path.join(scratch, 'library');
  const store = new LibraryDiskStore(storeRoot, 'zotero-live-audit');
  const catalog = new LibraryCatalog(path.join(userData, 'library', 'catalog.sqlite'));
  const requestId = 'zotero-live-audit';
  try {
    const events = [];
    const report = await importZoteroLibraries({ requestId,
      selection: { fullRefresh: true, includeStandaloneFiles: true, includeUnfiled: true },
      store, catalog, onProgress: (event) => events.push(event) });
    const session = new ZoteroSyncSessionStore(storeRoot).get(requestId);
    console.log('\n--- importer report ---');
    console.log(JSON.stringify({ status: report.status, libraries: report.libraries, itemsDiscovered: report.itemsDiscovered,
      itemsCreated: report.itemsCreated, attachmentsCopied: report.attachmentsCopied, attachmentsUnavailable: report.attachmentsUnavailable,
      attachmentsLinkOnly: report.attachmentsLinkOnly, failures: report.failures, partial: report.partial,
      verification: report.verification, finalPhase: events.at(-1)?.phase }, null, 2));
    await reconcile({ stores: [store], oracles, report, session });
    catalog.close();
    console.log('\nSTRICT PASS: Zotero and Nodus match for every imported library, note and file.');
  } finally {
    try { catalog.close(); } catch { /* already closed */ }
  }
}

try {
  await main();
} catch (error) {
  console.error(`\nSTRICT FAIL: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await rm(scratch, { recursive: true, force: true });
}
