// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionRoot = path.join(root, 'browser-extension');
const output = path.join(root, 'output', 'browser-connector');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const english = JSON.parse(await readFile(path.join(extensionRoot, '_locales/en/messages.json'), 'utf8'));

const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
const staticServer = createServer(async (request, response) => {
  try {
    const relative = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname).replace(/^\/+/, '') || 'popup.html';
    const target = path.resolve(extensionRoot, relative);
    if (!target.startsWith(`${extensionRoot}${path.sep}`)) throw new Error('outside root');
    response.writeHead(200, { 'Content-Type': contentTypes[path.extname(target)] || 'application/octet-stream' });
    response.end(await readFile(target));
  } catch {
    response.writeHead(404); response.end();
  }
});
await new Promise((resolve) => staticServer.listen(0, '127.0.0.1', resolve));
const port = staticServer.address().port;

const snapshot = {
  title: 'Women and migration after war', url: 'https://journal.example/article/42', lang: 'en', contentType: 'text/html', html: '<!doctype html><html><body><article>Readable text</article></body></html>',
  jsonLd: [], coins: [], anchors: [], links: [], metas: [
    { name: 'citation_title', content: 'Women and migration after war' },
    { name: 'citation_author', content: 'Miranda, Alicia' },
    { name: 'citation_journal_title', content: 'Historical Test Review' },
    { name: 'citation_publication_date', content: '2017' },
    { name: 'citation_pdf_url', content: 'https://journal.example/article/42.pdf' },
  ],
};
const collections = [
  { id: 'history', parentId: null, name: 'History', position: 0, source: 'nodus', directItemCount: 4 },
  { id: 'women', parentId: 'history', name: 'Women', position: 0, source: 'nodus', directItemCount: 2 },
  { id: 'postwar', parentId: 'women', name: 'Postwar', position: 0, source: 'nodus', directItemCount: 1 },
];

async function exercise(colorScheme) {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const context = await browser.newContext({ viewport: { width: 420, height: 600 }, colorScheme });
  const page = await context.newPage();
  await page.addInitScript(({ messages, detected }) => {
    const values = { port: 4323, token: 'visual-test-token', lastCollectionId: 'women' };
    globalThis.chrome = {
      i18n: { getUILanguage: () => 'es-ES', getMessage: (key, substitutions) => {
        const entry = messages[key]; if (!entry) return key;
        let value = entry.message; const args = Array.isArray(substitutions) ? substitutions : substitutions == null ? [] : [substitutions];
        for (const [name, placeholder] of Object.entries(entry.placeholders || {})) {
          const index = Number(/^\$(\d+)$/.exec(placeholder.content)?.[1] || 0) - 1;
          if (index >= 0) value = value.replaceAll(`$${name.toUpperCase()}$`, String(args[index] ?? ''));
        }
        for (const [index, arg] of args.entries()) value = value.replaceAll(`$${index + 1}`, String(arg));
        return value;
      } },
      tabs: { query: async () => [{ id: 7, title: detected.title, url: detected.url }] },
      scripting: { executeScript: async () => [{ result: detected }] },
      storage: { local: { get: async (defaults) => ({ ...defaults, ...values }), set: async (input) => Object.assign(values, input), remove: async (keys) => { for (const key of keys) delete values[key]; } } },
      permissions: { request: async () => true },
      runtime: { getManifest: () => ({ version: '4.0.0' }), getURL: (path = '') => `chrome-extension://abcdefghijklmnopabcdefghijklmnop/${path}`, openOptionsPage: async () => undefined },
    };
  }, { messages: english, detected: snapshot });
  await page.route('http://127.0.0.1:4323/api/browser/**', (route) => route.abort('connectionrefused'));
  await page.route('http://127.0.0.1:4321/api/browser/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/health')) return route.fulfill({ json: { ok: true, app: 'nodus', enabled: true, paired: true, libraryReady: true } });
    if (url.endsWith('/catalog')) return route.fulfill({ json: { collections, tags: [{ name: 'migración', itemCount: 12 }, { name: 'women', itemCount: 8 }] } });
    if (url.endsWith('/preview')) return route.fulfill({ json: { metadata: { ...snapshotMetadata(), abstract: 'Metadata enriched locally.' }, warnings: [] } });
    if (url.endsWith('/save')) return route.fulfill({ json: { ok: true, itemId: 'nodus:test-item', attachmentCount: 1, warnings: [], pendingUploads: [] } });
    if (url.endsWith('/open')) return route.fulfill({ json: { ok: true } });
    return route.fulfill({ status: 404, json: { error: 'not found' } });
  });
  await page.goto(`http://127.0.0.1:${port}/popup.html`);
  await page.locator('#capture-view:not(.hidden)').waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.equal(await page.locator('#pair-port').inputValue(), '4321');
  assert.equal(await page.evaluate(() => chrome.storage.local.get({ port: 0 }).then((value) => value.port)), 4321);
  assert.equal(await page.locator('#document-title').textContent(), snapshot.title);
  assert.equal(await page.locator('#item-type').inputValue(), 'journal-article');
  assert.ok((await page.locator('#document-byline').textContent()).includes('Miranda'));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  assert.equal(await page.locator('#collection-label').textContent(), 'Women');

  await page.locator('#collection-button').click();
  await page.locator('#collection-search').fill('postwar');
  const row = page.locator('.collection-row', { hasText: 'Postwar' });
  assert.equal(await row.count(), 1);
  assert.ok((await row.getAttribute('title')).includes('History / Women / Postwar'));
  await row.click();
  assert.equal(await page.locator('#collection-label').textContent(), 'Postwar');
  await page.locator('#tag-input').fill('migracion');
  await page.locator('.tag-suggestion', { hasText: 'migración' }).click();
  assert.equal(await page.locator('.tag-chip').count(), 1);
  await page.screenshot({ path: path.join(output, `popup-${colorScheme}.png`), fullPage: true });
  await page.locator('#save-button').click();
  await page.locator('#success-view:not(.hidden)').waitFor();
  assert.match(await page.locator('#success-summary').textContent(), /1 file/);
  await browser.close();
}

function snapshotMetadata() {
  return {
    title: snapshot.title, itemType: 'journal-article', creators: [{ creatorType: 'author', firstName: 'Alicia', lastName: 'Miranda', fieldMode: 0 }],
    year: 2017, date: '2017', publicationTitle: 'Historical Test Review', url: snapshot.url, isbn: [], issn: [], tags: [],
  };
}

try {
  await mkdir(output, { recursive: true });
  await exercise('light');
  await exercise('dark');
  console.log(`Browser connector popup passed in light and dark mode. Screenshots: ${output}`);
} finally {
  await new Promise((resolve) => staticServer.close(resolve));
}
