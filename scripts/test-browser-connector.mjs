// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { filterCollectionRows, hierarchicalCollections, normalizeTags } from '../browser-extension/lib/collections.js';
import { DEFAULT_NODUS_PORT, connectorPortCandidates, discoverNodus, extensionOrigin, normalizeConnectorPort, requestLocalJson } from '../browser-extension/lib/connection.js';
import { detectCapture } from '../browser-extension/lib/detector.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = { lang: 'en', links: [], anchors: [], coins: [], jsonLd: [], metas: [], html: '' };

test('detects a Highwire journal article and its full-text PDF', () => {
  const result = detectCapture({
    ...base,
    title: 'Publisher page',
    url: 'https://journal.example/article/42',
    contentType: 'text/html',
    metas: [
      { name: 'citation_title', content: 'Evidence and public memory' },
      { name: 'citation_author', content: 'García Fernández, María' },
      { name: 'citation_author', content: 'Ana Miranda' },
      { name: 'citation_journal_title', content: 'Historical Methods' },
      { name: 'citation_publication_date', content: '2024-05-10' },
      { name: 'citation_doi', content: 'https://doi.org/10.1234/HM.42' },
      { name: 'citation_pdf_url', content: '/article/42.pdf' },
    ],
  });
  assert.equal(result.metadataSource, 'highwire');
  assert.equal(result.metadata.itemType, 'journal-article');
  assert.equal(result.metadata.title, 'Evidence and public memory');
  assert.equal(result.metadata.doi, '10.1234/HM.42');
  assert.equal(result.metadata.creators.length, 2);
  assert.equal(result.metadata.publicationTitle, 'Historical Methods');
  assert.equal(result.attachments[0].url, 'https://journal.example/article/42.pdf');
});

test('detects a JSON-LD book chapter and preserves book identifiers', () => {
  const result = detectCapture({
    ...base,
    title: 'Chapter',
    url: 'https://books.example/chapter/7',
    contentType: 'text/html',
    jsonLd: [JSON.stringify({
      '@context': 'https://schema.org', '@type': 'Chapter', name: 'Women after the war',
      author: [{ '@type': 'Person', givenName: 'Alicia', familyName: 'Miranda' }],
      isPartOf: { '@type': 'Book', name: 'Postwar lives' }, isbn: '978-1-4028-9462-6',
      datePublished: '2017', publisher: { '@type': 'Organization', name: 'Example Press' },
    })],
  });
  assert.equal(result.metadataSource, 'json-ld');
  assert.equal(result.metadata.itemType, 'book-chapter');
  assert.deepEqual(result.metadata.isbn, ['978-1-4028-9462-6']);
  assert.equal(result.metadata.creators[0].lastName, 'Miranda');
  assert.equal(result.metadata.publicationTitle, 'Postwar lives');
});

test('detects COinS and direct documents without injecting into Chrome PDF viewer', () => {
  const coins = detectCapture({
    ...base, title: 'Search result', url: 'https://catalog.example/item', contentType: 'text/html',
    coins: ['ctx_ver=Z39.88-2004&rft.genre=book&rft.btitle=Entre+norma+y+deseo&rft.au=Garc%C3%ADa+Fern%C3%A1ndez%2C+M.&rft.isbn=9788400000000'],
  });
  assert.equal(coins.metadataSource, 'coins');
  assert.equal(coins.metadata.itemType, 'book');
  assert.equal(coins.metadata.title, 'Entre norma y deseo');

  const pdf = detectCapture({ ...base, title: '', url: 'https://archive.example/clean-paper.pdf', contentType: '' });
  assert.equal(pdf.metadataSource, 'direct-file');
  assert.equal(pdf.metadata.itemType, 'document');
  assert.equal(pdf.attachments[0].role, 'original');
  assert.equal(pdf.attachments[0].mimeType, 'application/pdf');

  const epub = detectCapture({ ...base, title: 'Monograph', url: 'https://archive.example/book.epub', contentType: 'application/epub+zip' });
  assert.equal(epub.metadata.itemType, 'book');
});

test('deduplicates attachment candidates and supports a generic readable snapshot', () => {
  const result = detectCapture({
    ...base, title: 'Research project', url: 'https://example.org/project', contentType: 'text/html', html: '<html><body>Research</body></html>',
    metas: [{ property: 'og:title', content: 'Research project' }],
    links: [{ rel: 'alternate', type: 'application/pdf', href: '/paper.pdf', title: 'PDF' }],
    anchors: [{ href: 'https://example.org/paper.pdf', text: 'Download', type: 'application/pdf' }],
  });
  assert.equal(result.metadata.itemType, 'webpage');
  assert.equal(result.attachments.length, 1);
  assert.equal(result.snapshotAvailable, true);
});

test('collection paths remain hierarchical and searchable without losing context', () => {
  const collections = [
    { id: 'history', parentId: null, name: 'History', position: 0 },
    { id: 'women', parentId: 'history', name: 'Women', position: 0 },
    { id: 'postwar', parentId: 'women', name: 'Postwar', position: 0 },
    { id: 'methods', parentId: 'history', name: 'Methods', position: 1 },
  ];
  assert.deepEqual(hierarchicalCollections(collections).map((entry) => entry.depth), [0, 1, 2, 1]);
  assert.equal(filterCollectionRows(collections, 'women postwar').length, 0);
  assert.equal(filterCollectionRows(collections, 'Women / Postwar')[0].collection.id, 'postwar');
  assert.deepEqual(normalizeTags([' Memory ', 'memory', 'Women', '', 'Women ']), ['Memory', 'Women']);
});

test('recovers from a stale connector port by probing the Nodus default', async () => {
  assert.equal(normalizeConnectorPort('4323'), 4323);
  assert.equal(normalizeConnectorPort('invalid'), DEFAULT_NODUS_PORT);
  assert.deepEqual(connectorPortCandidates(4323), [4323, DEFAULT_NODUS_PORT]);
  assert.deepEqual(connectorPortCandidates(DEFAULT_NODUS_PORT), [DEFAULT_NODUS_PORT]);
  const attempted = [];
  const connection = await discoverNodus(4323, async (port) => {
    attempted.push(port);
    if (port === 4323) throw new TypeError('Failed to fetch');
    return { ok: true, app: 'nodus', enabled: true };
  });
  assert.deepEqual(attempted, [4323, DEFAULT_NODUS_PORT]);
  assert.deepEqual(connection, { port: DEFAULT_NODUS_PORT, health: { ok: true, app: 'nodus', enabled: true } });
});

test('preserves the installed extension origin on local connector requests', async () => {
  assert.equal(extensionOrigin((path) => `chrome-extension://abcdefghijklmnopabcdefghijklmnop/${path}`), 'chrome-extension://abcdefghijklmnopabcdefghijklmnop');

  const observed = {};
  const response = await requestLocalJson('http://127.0.0.1:4321/api/browser/health', {
    headers: { Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' },
  }, () => ({
    status: 0,
    responseText: '',
    open(method, url, async) { Object.assign(observed, { method, url, async }); },
    setRequestHeader(name, value) { (observed.headers ||= {})[name] = value; },
    send(body) {
      observed.body = body;
      this.status = 200;
      this.responseText = JSON.stringify({ ok: true, app: 'nodus' });
      queueMicrotask(() => this.onload());
    },
  }));

  assert.deepEqual(observed, {
    method: 'GET', url: 'http://127.0.0.1:4321/api/browser/health', async: true,
    headers: { Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' }, body: null,
  });
  assert.deepEqual(response, { ok: true, status: 200, data: { ok: true, app: 'nodus' } });

  const legacyResponse = await requestLocalJson('http://127.0.0.1:4321/api/browser/health', {
    headers: { Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' },
  }, () => ({
    status: 0,
    responseText: '',
    open() {},
    setRequestHeader(name) { if (name === 'Origin') throw new DOMException('Refused unsafe header'); },
    send() {
      this.status = 200;
      this.responseText = '{"ok":true}';
      queueMicrotask(() => this.onload());
    },
  }));
  assert.equal(legacyResponse.ok, true, 'older Chromium falls back to the Origin automatically supplied by XHR');
});

test('Manifest V3 package minimizes permission and contains no remote executable code', () => {
  const manifest = JSON.parse(readFileSync(path.join(root, 'browser-extension/manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage']);
  assert.equal(manifest.host_permissions.includes('<all_urls>'), false);
  assert.deepEqual(manifest.optional_host_permissions, ['https://*/*', 'http://*/*']);
  assert.match(manifest.content_security_policy.extension_pages, /script-src 'self'/);
  assert.doesNotMatch(manifest.content_security_policy.extension_pages, /https?:/);
  for (const size of [16, 32, 48, 128]) assert.ok(existsSync(path.join(root, `browser-extension/icons/icon-${size}.png`)));
  JSON.parse(readFileSync(path.join(root, 'browser-extension/_locales/en/messages.json'), 'utf8'));
  assert.equal(existsSync(path.join(root, 'browser-extension/_locales/es/messages.json')), false, 'the connector must stay English-only');
  const popup = readFileSync(path.join(root, 'browser-extension/popup.html'), 'utf8');
  const popupScript = readFileSync(path.join(root, 'browser-extension/popup.js'), 'utf8');
  assert.doesNotMatch(popup, /<script[^>]+src=["']https?:/i);
  assert.match(popupScript, /document\.documentElement\.lang = 'en'/);
  assert.doesNotMatch(popupScript, /ITEM_TYPE_LABELS_ES|spanishUi/);
});
