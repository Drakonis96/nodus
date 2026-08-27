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
let referenceSearchRequests = 0;
const synonymRequests = [];
const chatRequests = [];
let editorSelection = '';
let editorParagraph = '';
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
    referenceSearchRequests += 1;
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
  if (url.pathname === '/api/prompts' && req.method === 'GET') return json(res, {
    styles: [
      { id: 'builtin:academic', name: 'Academic', description: 'Academic register and explicit transitions.', color: '#0f766e', builtIn: true },
      { id: 'builtin:clear', name: 'Clear', description: 'Make dense sentences easier to follow.', color: '#0284c7', builtIn: true },
    ],
    models: [
      { provider: 'openai', model: 'gpt-e2e', label: 'OpenAI · gpt-e2e' },
      { provider: 'ollama', model: 'local-e2e', label: 'Ollama · local-e2e' },
    ],
    defaultStyleId: 'builtin:academic',
    defaultModel: { provider: 'openai', model: 'gpt-e2e' },
  });
  if (url.pathname === '/api/prompts/apply' && req.method === 'POST') return json(res, {
    text: `Clear proposal: ${body.selectionText}`,
    warnings: [],
    styleId: body.styleId,
    model: body.model,
  });
  if (url.pathname === '/api/synonyms' && req.method === 'POST') {
    synonymRequests.push(body);
    const round = synonymRequests.length;
    return json(res, {
      alternatives: Array.from({ length: 5 }, (_, index) => ({
        target: body.selectedText,
        replacement: `${round === 1 ? 'Alternative' : 'Fresh'} ${index + 1}`,
        from: body.selectionFrom,
        to: body.selectionTo,
      })),
      modelProvider: 'openai',
      modelName: 'gpt-e2e',
    });
  }
  if (url.pathname === '/api/chat/catalogue' && req.method === 'GET') return json(res, {
    models: [
      { provider: 'openai', model: 'gpt-e2e', label: 'OpenAI · gpt-e2e' },
      { provider: 'ollama', model: 'local-e2e', label: 'Ollama · local-e2e' },
    ],
    defaultModel: { provider: 'openai', model: 'gpt-e2e' },
  });
  if (url.pathname === '/api/chat/stream' && req.method === 'POST') {
    chatRequests.push(body);
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
    res.write(`${JSON.stringify({ type: 'delta', text: 'Grounded answer ' })}\n`);
    res.write(`${JSON.stringify({ type: 'delta', text: '**from Word**.' })}\n`);
    res.end(`${JSON.stringify({ type: 'done' })}\n`);
    return;
  }
  if (url.pathname === '/api/editor/state') return json(res, { paragraphText: editorParagraph || editorSelection, selectionText: editorSelection, documentId: 'e2e-writer', references: { documentId: 'e2e-writer', preferences: null, citations: [], bibliographyFieldIds: [], bibliographies: [], selectedFieldId: null } });
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
  await page.getByText('Search to show references from the global library.').waitFor();
  assert.equal(await page.locator('.reference-result').count(), 0, 'References starts without default works');
  assert.equal(referenceSearchRequests, 0, 'opening References with an empty query makes no search request');
  await page.locator('#searchBox').fill('a');
  await page.locator('#searchBtn').click();
  await page.getByRole('button', { name: '+ Add' }).first().waitFor();
  assert.equal(referenceSearchRequests, 1);
  await page.locator('#searchBox').fill('');
  await page.locator('#searchBtn').click();
  await page.getByText('Search to show references from the global library.').waitFor();
  assert.equal(await page.locator('.reference-result').count(), 0, 'clearing the query removes prior reference results');
  assert.equal(referenceSearchRequests, 1, 'clearing the query makes no empty search request');
  await page.locator('#searchBox').fill('a');
  await page.locator('#searchBtn').click();
  await page.getByRole('button', { name: '+ Add' }).first().waitFor();
  assert.equal(referenceSearchRequests, 2);
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
  await page.getByText('Style manager opened in Nodus').waitFor();
  assert.deepEqual(nodusOpenRequests.at(-1), { destination: 'citation-styles' });
  await page.getByRole('button', { name: '+ Add' }).first().click();
  await page.getByRole('button', { name: '+ Add' }).nth(1).click();
  assert.equal(await page.locator('.citation-source').count(), 2);
  await page.locator('.citation-source').first().locator('.citation-source-buttons button').nth(2).click();
  const firstOptions = page.locator('.citation-source').first().locator('.citation-source-options');
  await firstOptions.getByLabel('Value').fill('401');
  await firstOptions.getByLabel('Prefix').fill('see ');
  await firstOptions.getByLabel('Suffix / text after').fill('; compare with ');
  await page.waitForTimeout(1700);
  assert.equal(await firstOptions.getByLabel('Value').inputValue(), '401', 'Writer polling must not rebuild a citation while its details are being edited');
  assert.equal(await firstOptions.getByLabel('Prefix').inputValue(), 'see ');
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

  // Saved workspace prompts generate a reviewable proposal and never mutate the
  // editor until the explicit Paste action.
  editorSelection = 'The original Word selection stays untouched during generation.';
  await page.getByRole('tab', { name: 'AI Edition' }).click();
  await page.locator('#promptStyle option[value="builtin:academic"]').waitFor({ state: 'attached' });
  await page.waitForFunction(() => document.querySelector('#promptSelection')?.textContent?.includes('original Word selection'));
  assert.notEqual(await page.locator('.seg.active .seg-label').evaluate((element) => getComputedStyle(element).display), 'none');
  assert.notEqual(await page.locator('.seg:not(.active) .seg-label').first().evaluate((element) => getComputedStyle(element).display), 'none');
  await page.locator('#promptStyle').selectOption('builtin:clear');
  await page.locator('#promptModel').selectOption({ label: 'Ollama · local-e2e' });
  await page.locator('#applyPrompt').click();
  await page.locator('#promptOutputWrap:not([hidden])').waitFor();
  assert.equal(await page.locator('#promptOutput').inputValue(), `Clear proposal: ${editorSelection}`);
  assert.equal(commands.length, 2, 'generation itself must not insert anything into the editor');
  await page.locator('#pastePromptOutput').click();
  await page.getByText('Selection replaced').waitFor();
  assert.equal(commands[2].replace, true);
  assert.equal(commands[2].text, `Clear proposal: ${editorSelection}`);

  // The contextual thesaurus sends the whole sentence even when one word is
  // selected, presents five choices, excludes them on regeneration, and only
  // replaces text after the user chooses an alternative.
  editorParagraph = 'The central argument is solid and convincing.';
  editorSelection = 'solid';
  await page.waitForTimeout(1700);
  await page.getByRole('tab', { name: 'Synonyms' }).click();
  await page.getByRole('button', { name: 'Apply: Alternative 1' }).waitFor();
  assert.equal(await page.locator('#synonymRounds .synonym-option').count(), 5);
  assert.equal(await page.locator('#synonymContext').textContent(), editorParagraph);
  assert.equal(await page.locator('#synonymContext mark').textContent(), editorSelection);
  assert.equal(synonymRequests[0].sentence, editorParagraph);
  assert.equal(synonymRequests[0].selectedText, editorSelection);
  assert.equal(editorParagraph.slice(synonymRequests[0].selectionFrom, synonymRequests[0].selectionTo), editorSelection);
  await page.locator('#generateSynonyms').click();
  await page.getByRole('button', { name: 'Apply: Fresh 1' }).waitFor();
  assert.equal(synonymRequests[1].previousAlternatives.length, 5);
  assert.equal(await page.locator('#synonymRounds .synonym-option').count(), 10);
  await page.getByRole('button', { name: 'Apply: Fresh 1' }).click();
  await page.getByText('Alternative applied').waitFor();
  assert.equal(commands.at(-1).replace, true);
  assert.equal(commands.at(-1).text, 'Fresh 1');

  // Chat mirrors the Zotero conversation flow, but grounds every turn in the
  // fresh Word scope and always carries the currently selected passage too.
  editorParagraph = 'The complete editor document explains workers’ autonomy and clandestine organization.';
  editorSelection = 'workers’ autonomy';
  await page.waitForTimeout(1700);
  await page.getByRole('tab', { name: 'Chat' }).click();
  await page.locator('#chatSelection:not([hidden])').waitFor();
  assert.equal(await page.locator('#chatSelectionText').textContent(), editorSelection);
  await page.locator('#chatScopeDocument').check();
  await page.locator('#chatInput').fill('What does the selection mean?');
  await page.locator('#chatInput').press('Enter');
  await page.locator('.word-chat-message--assistant strong').getByText('from Word').waitFor();
  assert.equal(chatRequests.length, 1);
  assert.equal(chatRequests[0].context.scope, 'document');
  assert.equal(chatRequests[0].context.text, editorParagraph);
  assert.equal(chatRequests[0].context.selectionText, editorSelection);
  assert.deepEqual(chatRequests[0].messages, [{ role: 'user', content: 'What does the selection mean?' }]);

  await page.locator('#chatInput').fill('Summarize it.');
  await page.locator('#chatSend').click();
  await page.locator('.word-chat-message--assistant').last().locator('strong').getByText('from Word').waitFor();
  assert.equal(chatRequests[1].messages.length, 3, 'the second request carries the preceding conversation');
  assert.deepEqual(chatRequests[1].messages.map((message) => message.role), ['user', 'assistant', 'user']);
  const regenerated = page.waitForResponse((response) => response.url().endsWith('/api/chat/stream'));
  await page.locator('.word-chat-message--assistant').last().getByRole('button', { name: 'Regenerate' }).click();
  await regenerated;
  await page.locator('.word-chat-message--assistant').last().locator('strong').getByText('from Word').waitFor();
  assert.equal(chatRequests.length, 3);
  assert.equal(chatRequests[2].messages.at(-1).content, 'Summarize it.');
  await page.getByRole('button', { name: 'Conversations' }).click();
  await page.locator('.word-chat-conversation').first().waitFor();
  assert.match(await page.locator('.word-chat-conversation-title').first().textContent(), /What does the selection mean/);
  await page.locator('#chatHistoryClose').click();
  const chatStorageKeys = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('nodus.word-chat.conversations.')));
  assert.equal(chatStorageKeys.some((key) => key === 'nodus.word-chat.conversations.v1'), false, 'unscoped legacy history must not remain readable');
  assert.equal(chatStorageKeys.filter((key) => key.startsWith('nodus.word-chat.conversations.v2.')).length, 1, 'history must use a document-scoped namespace');

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } });
    document.execCommand = () => true;
  });
  await page.locator('.word-chat-message--assistant').last().getByRole('button', { name: 'Copy' }).click();
  await page.locator('.word-chat-message--assistant').last().getByRole('button', { name: 'Copied' }).waitFor();

  editorSelection = 'x'.repeat(40_500);
  editorParagraph = 'A short editor context for the oversized selection test.';
  await page.waitForTimeout(1700);
  await page.getByRole('button', { name: 'New conversation' }).click();
  await page.locator('#chatInput').fill('Use this long selection.');
  await page.locator('#chatSend').click();
  await page.locator('.word-chat-message--assistant strong').getByText('from Word').waitFor();
  assert.equal(chatRequests.at(-1).context.selectionText.length, 40_000);
  assert.equal(chatRequests.at(-1).context.selectionTruncated, true);
  await page.getByText(/selection is too long/i).waitFor();

  // Exercise the actual Office.js branch too. This mock follows Microsoft's
  // WordApiDesktop 1.2 PageCollection/Page.getRange contract, so both scope
  // choices are verified independently from the standalone Writer bridge.
  const wordContext = await browser.newContext({ viewport: { width: 360, height: 840 }, colorScheme: 'light' });
  const wordPage = await wordContext.newPage();
  await wordPage.route('https://appsforoffice.microsoft.com/**', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `
      (function () {
        var pageRange = { text: 'Only the seventh Word page is used here.', load: function () {} };
        var page = { index: 7, load: function () {}, getRange: function () { return pageRange; } };
        window.__failWordPages = false;
        function selection() { return {
          text: 'seventh Word page', load: function () {},
          pages: { items: window.__failWordPages ? [] : [page], load: function () {} },
          paragraphs: { getFirst: function () { return { text: 'A paragraph long enough for startup analysis.', load: function () {} }; } }
        }; }
        window.Word = {
          FieldType: { addin: 'addin' }, InsertLocation: { replace: 'replace' },
          run: function (callback) {
            var context = {
              document: { body: { text: 'The complete Word document includes every section.', load: function () {} }, getSelection: selection },
              sync: function () { return Promise.resolve(); }
            };
            return Promise.resolve(callback(context));
          }
        };
        window.Office = {
          HostType: { Word: 'Word' }, EventType: { OfficeThemeChanged: 'theme', DocumentSelectionChanged: 'selection' }, AsyncResultStatus: { Failed: 'failed' },
          context: {
            officeTheme: { bodyBackgroundColor: '#ffffff', bodyForegroundColor: '#111111', controlBackgroundColor: '#ffffff', controlForegroundColor: '#111111', addHandlerAsync: function () {} },
            requirements: { isSetSupported: function () { return true; } },
            document: { addHandlerAsync: function () {}, settings: { get: function () { return null; }, set: function () {}, saveAsync: function (callback) { callback({ status: 'ok' }); } } }
          },
          onReady: function (callback) { setTimeout(function () { callback({ host: 'Word' }); }, 0); }
        };
      })();
    `,
  }));
  await wordPage.goto(`http://127.0.0.1:${port}/addin/taskpane.html`);
  await wordPage.getByRole('tab', { name: 'Chat' }).click();
  await wordPage.locator('#chatModel option[value="openai::gpt-e2e"]').waitFor({ state: 'attached' });
  const wordChatStart = chatRequests.length;
  await wordPage.locator('#chatInput').fill('Use the current page.');
  await wordPage.locator('#chatSend').click();
  await wordPage.locator('.word-chat-message--assistant strong').getByText('from Word').waitFor();
  assert.equal(chatRequests[wordChatStart].context.scope, 'page');
  assert.equal(chatRequests[wordChatStart].context.label, 'Page 7');
  assert.equal(chatRequests[wordChatStart].context.text, 'Only the seventh Word page is used here.');
  assert.equal(chatRequests[wordChatStart].context.selectionText, 'seventh Word page');
  await wordPage.locator('#chatScopeDocument').check();
  await wordPage.locator('#chatInput').fill('Now use the whole document.');
  await wordPage.locator('#chatSend').click();
  await wordPage.locator('.word-chat-message--assistant').last().locator('strong').getByText('from Word').waitFor();
  assert.equal(chatRequests[wordChatStart + 1].context.scope, 'document');
  assert.equal(chatRequests[wordChatStart + 1].context.text, 'The complete Word document includes every section.');
  await wordPage.evaluate(() => { window.__failWordPages = true; });
  await wordPage.locator('#chatScopePage').check();
  await wordPage.locator('#chatInput').fill('Fall back safely.');
  await wordPage.locator('#chatSend').click();
  await wordPage.locator('.word-chat-message--assistant').last().locator('strong').getByText('from Word').waitFor();
  assert.equal(chatRequests[wordChatStart + 2].context.scope, 'document');
  assert.equal(chatRequests[wordChatStart + 2].context.pageFallback, true);
  await wordPage.getByText(/current page could not be read/i).waitFor();
  if (screenshotDir) {
    await mkdir(screenshotDir, { recursive: true });
    await wordPage.evaluate(() => document.body.classList.add('dark'));
    await wordPage.waitForTimeout(250);
    await wordPage.screenshot({ path: path.join(screenshotDir, 'copilot-chat-dark.png'), fullPage: true });
  }
  await wordContext.close();

  await page.getByRole('tab', { name: 'References' }).click();
  await page.getByRole('button', { name: '+ Add' }).first().waitFor();

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
    assert.ok(geometry.tabs > width - 35, `tabs stay balanced at ${width}px`);
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
  assert.deepEqual({ background: colors.background, panel: colors.panel, text: colors.text }, { background: '#1c1c22', panel: '#2b2b2b', text: '#e7e6ee' });
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
  console.log('Office add-in frontend E2E passed: references, prompts, synonyms, grounded streaming chat, dark mode, and responsive layouts.');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
