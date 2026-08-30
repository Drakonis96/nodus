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
import { ITEM_TYPES, byline, typeGlyph, typeLabel } from '../browser-extension/lib/presentation.js';

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

test('treats an extensionless Dialnet full-text link as a resolvable original PDF', () => {
  const result = detectCapture({
    ...base,
    title: 'Dialnet record',
    url: 'https://dialnet.unirioja.es/servlet/articulo?codigo=9012474',
    contentType: 'text/html',
    html: '<html><body>catalogue snapshot, not the paper</body></html>',
    metas: [
      { name: 'citation_title', content: 'Análisis cuantitativo de los diarios de pioneros' },
      { name: 'citation_author', content: 'Jorge Pérez Burgueño' },
      { name: 'citation_date', content: '2023' },
      { name: 'citation_journal_title', content: 'Vínculos de Historia' },
    ],
    anchors: [{
      href: 'https://dialnet.unirioja.es/servlet/articulo?codigo=9012474&orden=0&info=link',
      text: 'Texto completo',
      title: 'Acceder al texto completo del artículo',
      type: '',
    }],
  });
  assert.equal(result.metadataSource, 'highwire');
  assert.equal(result.attachments.length, 1);
  assert.deepEqual(result.attachments[0], {
    url: 'https://dialnet.unirioja.es/servlet/articulo?codigo=9012474&orden=0&info=link',
    title: 'Full text PDF', fileName: 'full-text.pdf', mimeType: 'application/pdf',
    role: 'original', resolveFullText: true,
  });
  assert.equal(result.snapshotAvailable, true, 'the user may still opt into a supplementary snapshot');
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

test('Connector presentation rules are shared by Chrome and the integrated Browser surface', () => {
  assert.equal(typeLabel('journal-article'), 'Journal article');
  assert.equal(typeLabel('journal-article', true), 'Artículo académico');
  assert.equal(typeGlyph('book'), 'B');
  assert.equal(typeGlyph('webpage'), 'W');
  assert.equal(byline({
    itemType: 'journal-article', title: 'Memory', creators: [{ firstName: 'María', lastName: 'García' }],
    year: 2026, publicationTitle: 'Historical Methods',
  }), 'María García · 2026 · Historical Methods');
  assert.ok(ITEM_TYPES.some(([value]) => value === 'dataset'));

  const popup = readFileSync(path.join(root, 'browser-extension/popup.js'), 'utf8');
  const integrated = readFileSync(path.join(root, 'src/components/browser/BrowserCaptureModal.tsx'), 'utf8');
  const toolbar = readFileSync(path.join(root, 'src/views/NodusBrowserView.tsx'), 'utf8');
  const architecture = readFileSync(path.join(root, 'docs/architecture/browser-connector.md'), 'utf8');

  for (const source of [popup, integrated]) {
    assert.match(source, /lib\/presentation\.js/, 'both Connector adapters must import shared presentation rules');
    assert.match(source, /lib\/collections\.js/, 'both Connector adapters must import shared collection/tag rules');
  }
  assert.match(integrated, /listGlobalLibraryCollections\(\)/);
  assert.match(integrated, /listGlobalLibraryTags\(\)/);
  assert.match(integrated, /selectedAttachments/);
  assert.match(integrated, /snapshotAvailable/);
  assert.match(integrated, /onOpenInNodus/);
  assert.match(toolbar, /dataTestId="browser-connector-button"/);
  assert.match(toolbar, /browser-extension\/icons\/icon\.svg/);
  assert.match(architecture, /any Connector capability, field, state or review-flow change must be applied\s+to both adapters/);
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
    headers: {
      Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
      'X-Nodus-Extension-Origin': 'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
    },
  }, async (url, options) => {
    Object.assign(observed, { url, options });
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, app: 'nodus' }) };
  });

  assert.deepEqual(observed, {
    url: 'http://127.0.0.1:4321/api/browser/health',
    options: { headers: {
      Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
      'X-Nodus-Extension-Origin': 'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
    } },
  });
  assert.deepEqual(response, { ok: true, status: 200, data: { ok: true, app: 'nodus' } });
});

test('Manifest V3 package minimizes permission and contains no remote executable code', () => {
  const manifest = JSON.parse(readFileSync(path.join(root, 'browser-extension/manifest.json'), 'utf8'));
  const englishMessages = JSON.parse(readFileSync(path.join(root, 'browser-extension/_locales/en/messages.json'), 'utf8'));
  const spanishMessages = JSON.parse(readFileSync(path.join(root, 'browser-extension/_locales/es/messages.json'), 'utf8'));
  const options = readFileSync(path.join(root, 'browser-extension/options.html'), 'utf8');
  assert.equal(manifest.manifest_version, 3);
  assert.equal(englishMessages.extensionName.message, 'Nodus Research Connector');
  assert.equal(spanishMessages.extensionName.message, 'Nodus Research Connector');
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage']);
  assert.equal(manifest.host_permissions.includes('<all_urls>'), false);
  assert.deepEqual(manifest.optional_host_permissions, ['https://*/*', 'http://*/*']);
  assert.match(manifest.content_security_policy.extension_pages, /script-src 'self'/);
  assert.doesNotMatch(manifest.content_security_policy.extension_pages, /https?:/);
  for (const size of [16, 32, 48, 128]) assert.ok(existsSync(path.join(root, `browser-extension/icons/icon-${size}.png`)));
  for (const locale of ['en', 'es']) JSON.parse(readFileSync(path.join(root, `browser-extension/_locales/${locale}/messages.json`), 'utf8'));
  const popup = readFileSync(path.join(root, 'browser-extension/popup.html'), 'utf8');
  const popupScript = readFileSync(path.join(root, 'browser-extension/popup.js'), 'utf8');
  assert.doesNotMatch(popup, /<script[^>]+src=["']https?:/i);
  assert.match(popupScript, /chrome\.i18n\.getUILanguage\(\)\.split/);
  assert.match(popupScript, /ITEM_TYPE_LABELS_ES|spanishUi/);
  assert.match(popupScript, /snapshotAvailable && !state\.capture\.attachments\.length/, 'a detected full text keeps the HTML snapshot off by default');
  assert.match(popupScript, /if \(!state\.token\) await pair\(\)/, 'opening the popup establishes the local token automatically');
  assert.match(options, /href="https:\/\/nodusresearch\.com"/);
});

test('Settings recommends the Chrome Web Store while preserving the manual ZIP download', () => {
  const settings = readFileSync(path.join(root, 'src/views/Settings.tsx'), 'utf8');
  const storeLogo = readFileSync(path.join(root, 'src/assets/brands/chrome-web-store.svg'), 'utf8');
  const storeAction = settings.indexOf('data-testid="browser-connector-install-store"');
  const zipAction = settings.indexOf('data-testid="browser-connector-download-zip"');

  assert.match(settings, /const CHROME_WEB_STORE_URL = 'https:\/\/chromewebstore\.google\.com\/detail\/ilcclajjhofhieoljdjmikmfopfbamej\?utm_source=item-share-cb'/);
  assert.match(settings, /import chromeWebStoreLogo from '\.\.\/assets\/brands\/chrome-web-store\.svg'/);
  assert.ok(storeAction >= 0, 'the recommended Chrome Web Store action must be rendered');
  assert.ok(zipAction > storeAction, 'the manual ZIP download must remain available after the recommended store action');
  assert.match(settings.slice(storeAction, zipAction), /openExternal\(CHROME_WEB_STORE_URL\)/);
  assert.match(settings.slice(zipAction), /downloadBrowserConnectorZip\(\)/);
  assert.match(storeLogo, /<title>Chrome Web Store<\/title>/);

  for (const locale of ['en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr']) {
    const translations = readFileSync(path.join(root, `src/i18n.${locale}.ts`), 'utf8');
    assert.match(translations, /"Instalar desde Chrome Web Store":/);
    assert.match(translations, /"Recomendado":/);
  }
});

test('browser pairing is a cancel-first translated renderer modal', () => {
  const server = readFileSync(path.join(root, 'electron/zotero-plugin/server.ts'), 'utf8');
  const host = readFileSync(path.join(root, 'src/components/BrowserConnectorPairingRequestHost.tsx'), 'utf8');
  const translations = readFileSync(path.join(root, 'src/i18n.browserConnector.ts'), 'utf8');

  assert.doesNotMatch(server, /dialog\.showMessageBox/);
  assert.match(server, /webContents\.send\('browserConnector:pairing:request'/);
  assert.match(host, /data-testid="browser-connector-pairing-modal"/);
  assert.match(host, /autoFocusConfirm=\{false\}/);
  assert.match(host, /resolveBrowserConnectorPairingRequest\(requestId, allow\)/);
  for (const locale of ['en', 'fr', 'de', 'pt', "'pt-BR'", 'it', 'tr']) {
    assert.match(translations, new RegExp(`(?:^|\\n)  ${locale.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}: table\\(`));
  }
});
