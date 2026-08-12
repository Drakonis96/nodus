// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const addinRoot = path.join(repoRoot, 'word-addin');
const commands = [];
const references = [
  summary('work:perez', 'Análisis cuantitativo de los diarios de pioneros', 'Pérez Burgueño, Jorge', 2023, 'article-journal', '10.18239/vdh_2023.12.21'),
  summary('work:garcia', 'Entre la norma y el deseo', 'García Fernández, Mónica', 2020, 'book', '9788418388282'),
  summary('work:aliaga', 'Mujeres solas en la posguerra', 'Aliaga, María', 2017, 'book-chapter', '9788490455667'),
];

function summary(id, title, author, year, itemType, identifier) {
  const [lastName, firstName] = author.split(', ');
  const metadata = {
    title, itemType, year, creators: [{ creatorType: 'author', firstName, lastName }],
    isbn: itemType === 'article-journal' ? [] : [identifier], issn: [], tags: [],
    ...(itemType === 'article-journal' ? { doi: identifier, publicationTitle: 'Vínculos de Historia' } : {}),
  };
  return {
    id, citationKey: `${lastName}${year}`, title, itemType, author, year,
    publicationTitle: metadata.publicationTitle || null, identifiers: [identifier], tags: [], source: 'nodus',
    snapshot: { citationKey: `${lastName}${year}`, metadata },
  };
}

function json(res, value) {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/addin/')) {
    const relative = url.pathname.slice('/addin/'.length) || 'taskpane.html';
    const file = path.join(addinRoot, relative);
    const ext = path.extname(file);
    let body = await readFile(file);
    if (ext === '.html') body = Buffer.from(body.toString('utf8').replace(/__COPILOT_TOKEN__/g, 'e2e-token').replace(/__COPILOT_LANG__/g, 'es'));
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' }); res.end(body); return;
  }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  assert.equal(req.headers.authorization, 'Bearer e2e-token', `${url.pathname} must remain authenticated`);
  if (url.pathname === '/api/health') return json(res, { ok: true, embeddingsConfigured: true, corpusSize: 3 });
  if (url.pathname === '/api/references/styles') return json(res, { styles: [
    { id: 'apa-7', title: 'APA 7', availableOffline: true, citationFormat: 'author-date' },
    { id: 'institutional-test', title: 'Institutional test', availableOffline: true, citationFormat: 'note' },
  ] });
  if (url.pathname === '/api/references/search') {
    const query = String(body.query || '').toLocaleLowerCase();
    return json(res, { references: references.filter((entry) => !query || `${entry.title} ${entry.author} ${entry.identifiers.join(' ')}`.toLocaleLowerCase().includes(query)) });
  }
  if (url.pathname === '/api/references/format-document') {
    const citations = body.citations.map((citation) => ({
      citationId: citation.citationId, noteIndex: citation.noteIndex,
      itemIds: citation.citationItems.map((entry) => entry.id),
      text: `(${citation.citationItems.map((entry) => `${entry.prefix || ''}${entry.snapshot.metadata.creators[0].lastName}, ${entry.snapshot.metadata.year}${entry.locator ? `, ${entry.label} ${entry.locator}` : ''}${entry.suffix || ''}`).join('; ')})`,
      html: `(${citation.citationItems.map((entry) => `<i>${entry.snapshot.metadata.creators[0].lastName}</i>, ${entry.snapshot.metadata.year}`).join('; ')})`,
    }));
    const bibliographyIds = [...new Set([
      ...body.citations.flatMap((entry) => entry.citationItems.filter((item) => !item.excludeFromBibliography).map((item) => item.id)),
      ...(body.uncitedItemIds || []),
    ])];
    return json(res, {
      style: body.style, styleTitle: 'APA 7', locale: body.locale, citationFormat: 'author-date', citations,
      bibliography: bibliographyIds.length ? { itemIds: bibliographyIds, text: bibliographyIds.join('\n'), html: bibliographyIds.map((id) => `<div>${id}</div>`).join('') } : null,
    });
  }
  if (url.pathname === '/api/editor/state') return json(res, { paragraphText: '', selectionText: '', documentId: 'e2e-writer', references: { documentId: 'e2e-writer', preferences: null, citations: [], bibliographyFieldIds: [], bibliographies: [], selectedFieldId: null } });
  if (url.pathname === '/api/editor/insert') { commands.push(body); return json(res, { ok: true, delivered: true }); }
  res.writeHead(404); res.end();
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});

try {
  const page = await browser.newPage({ viewport: { width: 360, height: 840 }, colorScheme: 'light' });
  await page.route('https://appsforoffice.microsoft.com/**', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: "window.Office={HostType:{Word:'Word'},AsyncResultStatus:{Failed:'failed'},onReady:function(cb){setTimeout(function(){cb({host:null});},0);}};",
  }));
  await page.goto(`http://127.0.0.1:${port}/addin/taskpane.html#references-citation`);
  await page.getByRole('tab', { name: 'References' }).waitFor();
  assert.equal(await page.locator('#analysisControls').evaluate((element) => getComputedStyle(element).display), 'none');
  assert.notEqual(await page.locator('#referenceControls').evaluate((element) => getComputedStyle(element).display), 'none');
  await page.getByRole('button', { name: '+ Add' }).first().waitFor();
  await page.getByRole('button', { name: '+ Add' }).first().click();
  await page.getByRole('button', { name: '+ Add' }).nth(1).click();
  assert.equal(await page.locator('.citation-source').count(), 2);
  await page.locator('.citation-source').first().locator('.citation-source-buttons button').nth(2).click();
  const firstOptions = page.locator('.citation-source').first().locator('.citation-source-options');
  await firstOptions.getByLabel('Value').fill('401');
  await firstOptions.getByLabel('Prefix').fill('see ');
  await firstOptions.getByLabel('Suffix / text after').fill('; compare with ');
  await page.getByRole('button', { name: 'Insert citation' }).click();
  await page.getByText('Live citation inserted').waitFor();
  assert.equal(commands[0].command, 'insert-citation');
  assert.equal(commands[0].field.citation.citationItems.length, 2);
  assert.equal(commands[0].field.citation.citationItems[0].locator, '401');
  assert.equal(commands[0].field.citation.citationItems[0].prefix, 'see ');
  assert.equal(commands[0].field.citation.citationItems[0].suffix, '; compare with ');
  assert.ok(commands[0].field.citation.citationItems[0].snapshot.metadata.title);

  await page.getByRole('button', { name: 'Bibliography only' }).last().click();
  await page.getByRole('button', { name: 'Insert / update' }).click();
  await page.getByText('Live bibliography inserted').waitFor();
  assert.equal(commands[1].command, 'insert-bibliography');
  assert.equal(commands[1].field.uncitedItems.length, 1);

  for (const width of [260, 360, 520]) {
    await page.setViewportSize({ width, height: 840 });
    const geometry = await page.evaluate(() => ({
      body: document.body.scrollWidth, viewport: document.documentElement.clientWidth,
      search: document.querySelector('.search').getBoundingClientRect().width,
      tabs: document.querySelector('.segmented').getBoundingClientRect().width,
      icon: document.querySelector('.mark').getBoundingClientRect().width,
    }));
    assert.ok(geometry.body <= geometry.viewport, `no horizontal clipping at ${width}px`);
    assert.ok(geometry.search > width - 35, `search stays full width at ${width}px`);
    assert.ok(geometry.tabs > width - 35, `three tabs stay balanced at ${width}px`);
    assert.equal(geometry.icon, 28, 'the stylized Nodus mark has the intended visual size');
  }

  await page.emulateMedia({ colorScheme: 'dark' });
  const colors = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return { background: root.getPropertyValue('--bg').trim(), panel: root.getPropertyValue('--panel').trim(), text: root.getPropertyValue('--text').trim() };
  });
  assert.deepEqual(colors, { background: '#1f1f1f', panel: '#2b2b2b', text: '#f3f3f3' });
  console.log('Office references frontend E2E passed in light/dark and 260/360/520px layouts!');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
