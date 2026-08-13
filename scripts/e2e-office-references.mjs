// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const addinRoot = path.join(repoRoot, 'word-addin');
const screenshotDir = process.env.NODUS_SCREENSHOT_DIR || '';
const commands = [];
const nodusOpenRequests = [];
let styleRequests = 0;
const styleCatalogue = [
  { id: 'apa-7', title: 'APA 7', availableOffline: true, citationFormat: 'author-date' },
  { id: 'institutional-test', title: 'Institutional test', availableOffline: true, citationFormat: 'note' },
];
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
    if (ext === '.html') body = Buffer.from(body.toString('utf8').replace(/__COPILOT_TOKEN__/g, 'e2e-token').replace(/__COPILOT_LANG__/g, url.searchParams.get('lang') === 'es' ? 'es' : 'en'));
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' }); res.end(body); return;
  }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  assert.equal(req.headers.authorization, 'Bearer e2e-token', `${url.pathname} must remain authenticated`);
  if (url.pathname === '/api/health') return json(res, { ok: true, embeddingsConfigured: true, corpusSize: 3 });
  if (url.pathname === '/api/references/styles') { styleRequests += 1; return json(res, { styles: styleCatalogue }); }
  if (url.pathname === '/api/search') return json(res, { ideas: [
    { globalId: 'idea:e2e', label: 'Las comisiones obreras como autonomía organizada', workCount: 2, authorYear: 'Di Febo, 2018', statement: 'Las Comisiones Obreras combinaron acción clandestina, organización autónoma y presencia dentro de los sindicatos verticales.', similarity: .82 },
    { globalId: 'idea:e2e-2', label: 'Una nueva vanguardia obrera', workCount: 1, authorYear: 'Fontana Lázaro, 2000', statement: 'La organización actuó con autonomía respecto a los partidos sin perder su capacidad de articulación política.', similarity: .74 },
  ] });
  if (url.pathname === '/api/passages') {
    const cleanPassage = { passageId: 'passage:clean', nodusId: 'work:perez', workTitle: 'Movimiento obrero y cambio político', authorYear: 'Sánchez Vigil, 2001', pageLabel: 'p. 64', similarity: .84, snippet: 'Las comisiones articularon reivindicaciones laborales y demandas políticas en los espacios de negociación disponibles.', text: 'Las comisiones articularon reivindicaciones laborales y demandas políticas en los espacios de negociación disponibles.' };
    const brokenPassage = { passageId: 'passage:broken', nodusId: 'work:broken', workTitle: 'Extracción pendiente de revisión', authorYear: 'Archivo, 1974', pageLabel: 'p. 12', similarity: .54, snippet: '���� ���� ����', text: '���� ���� ����' };
    return json(res, { available: true, indexed: true, passages: String(body.query || '').includes('broken') ? [brokenPassage] : [cleanPassage] });
  }
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
  if (url.pathname === '/api/nodus/open') { nodusOpenRequests.push(body); return json(res, { ok: true }); }
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
  const styleSearch = page.locator('#referenceStyleSearch');
  await styleSearch.click();
  await styleSearch.fill('institutional');
  await page.getByRole('option', { name: /Institutional test/ }).click();
  assert.equal(await page.locator('#referenceStyle').inputValue(), 'institutional-test');
  styleCatalogue.push({ id: 'custom-live', title: 'Custom live style', availableOffline: true, citationFormat: 'author-date' });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await styleSearch.click();
  await styleSearch.fill('custom live');
  await page.getByRole('option', { name: /Custom live style/ }).waitFor();
  assert.ok(styleRequests >= 2, 'the installed CSL catalogue refreshes after the pane regains focus');
  await page.keyboard.press('Escape');
  await page.locator('#referenceStyleManager').click();
  assert.deepEqual(nodusOpenRequests.at(-1), { destination: 'citation-styles' });
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
  await page.evaluate(() => document.body.classList.add('dark'));
  const colors = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    const activeTab = getComputedStyle(document.querySelector('.seg.active'));
    const card = getComputedStyle(document.querySelector('.card'));
    return { background: body.getPropertyValue('--bg').trim(), panel: body.getPropertyValue('--panel').trim(), text: body.getPropertyValue('--text').trim(), activeBackground: activeTab.backgroundColor, activeText: activeTab.color, cardBackground: card.backgroundColor };
  });
  assert.deepEqual({ background: colors.background, panel: colors.panel, text: colors.text }, { background: '#1f1f1f', panel: '#2b2b2b', text: '#f3f3f3' });
  assert.notEqual(colors.activeBackground, 'rgb(255, 255, 255)', 'the selected tab is never white in dark mode');
  assert.notEqual(colors.cardBackground, 'rgb(255, 255, 255)', 'result cards are never white in dark mode');
  assert.notEqual(colors.activeText, colors.activeBackground, 'the selected tab keeps readable contrast');

  if (screenshotDir) {
    await mkdir(screenshotDir, { recursive: true });
    const visual = await browser.newPage({ viewport: { width: 430, height: 900 }, colorScheme: 'dark' });
    await visual.route('https://appsforoffice.microsoft.com/**', (route) => route.fulfill({
      contentType: 'text/javascript',
      body: "window.Word={FieldType:{addin:'addin'}};window.Office={HostType:{Word:'Word'},EventType:{OfficeThemeChanged:'theme',DocumentSelectionChanged:'selection'},AsyncResultStatus:{Failed:'failed'},context:{officeTheme:{bodyBackgroundColor:'#1f1f1f',bodyForegroundColor:'#f3f3f3',controlBackgroundColor:'#ffffff',controlForegroundColor:'#ffffff',addHandlerAsync:function(){}},requirements:{isSetSupported:function(){return true;}},document:{addHandlerAsync:function(){},settings:{get:function(){return null;},set:function(){},saveAsync:function(cb){cb({status:'ok'});}}}},onReady:function(cb){setTimeout(function(){cb({host:'Word'});},0);}};",
    }));
    await visual.goto(`http://127.0.0.1:${port}/addin/taskpane.html?lang=es#references-citation`);
    await visual.getByRole('tab', { name: 'Referencias' }).waitFor();
    await visual.locator('#searchBox').fill('comisiones obreras');
    await visual.getByRole('tab', { name: 'Ideas' }).click();
    await visual.getByText('Las comisiones obreras como autonomía organizada').waitFor();
    await visual.locator('#status.ok').waitFor();
    await visual.screenshot({ path: path.join(screenshotDir, 'copilot-ideas-dark.png'), fullPage: true });
    await visual.getByRole('tab', { name: 'Pasajes' }).click();
    await visual.locator('#searchBtn').click();
    await visual.getByText('Movimiento obrero y cambio político').waitFor();
    await visual.screenshot({ path: path.join(screenshotDir, 'copilot-passages-dark.png'), fullPage: true });
    await visual.locator('#searchBox').fill('broken');
    await visual.locator('#searchBtn').click();
    await visual.getByText('Este pasaje no contiene texto Unicode legible. Reconstruye su texto limpio en Nodus.').waitFor();
    assert.equal(await visual.getByText('���� ���� ����').count(), 0, 'corrupt PDF glyphs are never rendered');
    await visual.locator('#searchBox').fill('comisiones obreras');
    await visual.getByRole('tab', { name: 'Referencias' }).click();
    await visual.locator('#referenceStyleSearch').click();
    await visual.locator('#referenceStyleSearch').fill('');
    await visual.getByRole('option', { name: /APA 7/ }).waitFor();
    await visual.screenshot({ path: path.join(screenshotDir, 'copilot-references-dark.png'), fullPage: true });
    await visual.close();
  }
  console.log('Office references frontend E2E passed: live searchable styles, Nodus manager link, readable passages, dark mode, and 260/360/520px layouts.');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
