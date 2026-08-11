// Real-renderer acceptance test for the clean Library reader. The fixture lives in
// an isolated backup folder so the test exercises the same nodus-library contract as
// a Zotero import without touching a user's documents.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { buildTextPdf } from './toolkit-fixtures.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const testRoot = await mkdtemp(path.join(os.tmpdir(), 'nodus-library-reader-ui-'));
const userData = path.join(testRoot, 'profile');
const backupRoot = path.join(testRoot, 'backups');
const screenshotDirectory = path.join(repoRoot, 'output', 'library-reader-e2e');
const screenshotPath = path.join(screenshotDirectory, '01-clean-reader-chat-dark.png');
const originalScreenshotPath = path.join(screenshotDirectory, '02-original-page-preview.png');
const pdfScreenshotPath = path.join(screenshotDirectory, '03-pdf-reader.png');
const epubScreenshotPath = path.join(screenshotDirectory, '04-epub-reader-highlight.png');
const imageScreenshotPath = path.join(screenshotDirectory, '05-image-region-highlight.png');
const docxScreenshotPath = path.join(screenshotDirectory, '06-docx-reader.png');
const spreadsheetScreenshotPath = path.join(screenshotDirectory, '07-spreadsheet-reader.png');
const citationScreenshotPath = path.join(screenshotDirectory, '08-csl-style-manager.png');
const lightScreenshotPath = path.join(screenshotDirectory, '09-clean-reader-light-narrow.png');
const responsiveChatScreenshotPath = path.join(screenshotDirectory, '10-reader-chat-responsive.png');
const lightControlsScreenshotPath = path.join(screenshotDirectory, '11-reader-controls-light.png');
const childEnv = {
  ...process.env,
  NODUS_USERDATA: userData,
  NODUS_DISABLE_AUTO_UPDATE: '1',
  NODUS_E2E_UPDATE_STATUS: 'not-available',
  NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1',
  HOME: testRoot,
  USERPROFILE: testRoot,
};
delete childEnv.ELECTRON_RUN_AS_NODE;

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNkYPj/n4GBgYGJAQoAHgQCAcL7reQAAAAASUVORK5CYII=',
  'base64',
);

function writeZip(file, entries) {
  const AdmZip = require('adm-zip'); const zip = new AdmZip();
  for (const [name, value] of Object.entries(entries)) zip.addFile(name, Buffer.from(value));
  zip.writeZip(file);
}

let app;
try {
  await mkdir(screenshotDirectory, { recursive: true });
  const zoteroStyles = path.join(testRoot, 'Zotero', 'styles');
  await mkdir(zoteroStyles, { recursive: true });
  await writeFile(path.join(zoteroStyles, 'casa-velazquez-e2e.csl'), `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" class="in-text"><info><title>Casa de Velázquez — E2E</title><id>http://www.zotero.org/styles/casa-velazquez-e2e</id><rights license="https://creativecommons.org/licenses/by-sa/3.0/">CC BY-SA 3.0</rights><updated>2026-08-11T00:00:00+00:00</updated></info><citation><layout prefix="[" suffix="]"><text variable="title"/></layout></citation><bibliography><layout suffix="."><text variable="title"/></layout></bibliography></style>`, 'utf8');
  app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env: childEnv });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  await page.setViewportSize({ width: 1500, height: 980 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));

  const work = await page.evaluate(async ({ version, backup }) => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    localStorage.setItem('nodus.mobileTeaserSeen.3.2.4', '1');
    localStorage.setItem('nodus.platformHighlightsSeen.2026-07', '1');
    localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
    localStorage.setItem('nodus.toolkitBetaGuideSeen.2.4.0', '1');
    await window.nodus.updateSettings({
      onboardingComplete: true,
      basicsTutorialVersion: 999,
      recoverySetupVersion: 999,
      tourComplete: true,
      advancedTourComplete: true,
      uiLanguage: 'es',
      mascotStyle: 'orb',
      mascotStyleChosen: true,
      mascotEnabled: false,
      reduceMotion: true,
      autoBackupFolder: backup,
      favorites: [
        { provider: 'openai', model: 'gpt-5.2' },
        { provider: 'anthropic', model: 'claude-sonnet-4-5' },
      ],
      nodiModel: { provider: 'openai', model: 'gpt-5.2' },
    });
    await window.nodus.seedDemoData();
    return (await window.nodus.listWorksPage(undefined, { offset: 0, limit: 1 })).items[0];
  }, { version: require(path.join(repoRoot, 'package.json')).version, backup: backupRoot });
  assert.ok(work?.nodus_id && work?.zotero_key, 'the demo provides a work with a stable Zotero id');

  const documentFolder = path.join(backupRoot, 'nodus-library', work.zotero_key);
  const markdown = `# ${work.title}

Texto introductorio para comprobar una lectura limpia, cómoda y persistente.

## Introducción

Este fragmento se puede subrayar y anotar sin modificar el PDF original. La selección conserva su posición y su contexto.

![Figura de prueba](assets/figura.png)

*Figura 1. Recurso extraído junto al documento.*

## Resultados

| Dimensión | Resultado |
| --- | ---: |
| Claridad | 95 |
| Fidelidad | 98 |

La segunda sección permite comprobar el índice, la página de origen y el marcador de lectura.
`;
  const titleOffset = markdown.indexOf('# ');
  const introOffset = markdown.indexOf('## Introducción');
  const resultsOffset = markdown.indexOf('## Resultados');
  await mkdir(path.join(documentFolder, 'assets'), { recursive: true });
  await writeFile(path.join(documentFolder, 'reader.md'), markdown, 'utf8');
  await buildTextPdf(documentFolder, 'original.pdf');
  await writeFile(path.join(documentFolder, 'assets', 'figura.png'), tinyPng);
  await writeFile(path.join(documentFolder, 'figure.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="560" viewBox="0 0 960 560"><rect width="960" height="560" fill="#111827"/><rect x="70" y="70" width="820" height="420" rx="24" fill="#312e81"/><text x="110" y="150" fill="#e0e7ff" font-family="sans-serif" font-size="38">Figura preservada</text><path d="M120 410 L300 250 L455 360 L640 180 L840 410" fill="none" stroke="#a5b4fc" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/><circle cx="640" cy="180" r="28" fill="#fbbf24"/></svg>`, 'utf8');
  writeZip(path.join(documentFolder, 'reader.epub'), {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'OEBPS/content.opf': '<?xml version="1.0"?><package><manifest><item id="intro" href="intro.xhtml" media-type="application/xhtml+xml"/><item id="results" href="results.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="intro"/><itemref idref="results"/></spine></package>',
    'OEBPS/intro.xhtml': '<html><head><title>Introducción EPUB</title></head><body><h1>Introducción EPUB</h1><p>Este texto refluye y admite subrayados independientes del Markdown limpio.</p></body></html>',
    'OEBPS/results.xhtml': '<html><head><title>Resultados EPUB</title></head><body><h1>Resultados</h1><p>El segundo capítulo conserva su propio contexto de anotación.</p></body></html>',
  });
  writeZip(path.join(documentFolder, 'reader.docx'), {
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Documento Word abierto dentro de Nodus.</w:t></w:r></w:p><w:p><w:r><w:t>Su texto también se puede seleccionar, subrayar y anotar.</w:t></w:r></w:p></w:body></w:document>',
  });
  writeZip(path.join(documentFolder, 'reader.xlsx'), {
    'xl/sharedStrings.xml': '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Dimensión</t></si><si><t>Resultado</t></si><si><t>Claridad</t></si><si><t>95</t></si><si><t>Fidelidad</t></si><si><t>98</t></si></sst>',
    'xl/worksheets/sheet1.xml': '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row><row r="3"><c r="A3" t="s"><v>4</v></c><c r="B3" t="s"><v>5</v></c></row></sheetData></worksheet>',
  });
  const now = new Date().toISOString();
  const contentFingerprint = createHash('sha256').update(markdown).digest('hex');
  const components = Object.fromEntries(['extraction', 'light', 'deep', 'passages', 'ideas', 'embeddings', 'summary'].map((component) => [component, {
    freshness: component === 'extraction' ? 'current' : 'none',
    fingerprint: component === 'extraction' ? 'c'.repeat(64) : null,
    reason: null,
    generatedAt: component === 'extraction' ? now : null,
  }]));
  await writeFile(path.join(documentFolder, 'annotations.json'), `${JSON.stringify([{
    id: 'orphaned-fixture', documentId: work.zotero_key, scope: 'source', kind: 'comment', color: null,
    startOffset: 0, endOffset: 16, selectedText: 'Fragmento antiguo', prefix: '', suffix: '',
    comment: 'Comentario recuperable', anchorStatus: 'orphaned', contentFingerprint,
    orphanReason: 'The quoted text could not be located in the new clean Markdown.', createdAt: now, updatedAt: now,
  }], null, 2)}\n`, 'utf8');
  const globalItemId = `zotero:${work.zotero_key}`;
  await writeFile(path.join(documentFolder, 'chat.json'), `${JSON.stringify([{
    id: 'assistant:grounded-fixture', role: 'assistant', createdAt: now,
    content: `La lectura distingue la introducción del bloque de resultados ([§ Introducción](nodus://reader/${encodeURIComponent(globalItemId)}/section/reader-section-2)). El documento abierto sigue siendo la fuente verificable ([${work.authors[0]}, ${work.year}](nodus://work/${globalItemId})).`,
  }], null, 2)}\n`, 'utf8');
  await writeFile(path.join(documentFolder, 'metadata.json'), `${JSON.stringify({
    format: 'nodus.library-item', formatVersion: 1,
    id: globalItemId, storageId: work.zotero_key, source: 'zotero', sourceLibraryId: 'users/0', sourceKey: work.zotero_key,
    citationKey: 'readerFixture2026',
    metadata: {
      title: work.title, itemType: 'article-journal', year: work.year,
      creators: work.authors.map((name) => ({ creatorType: 'author', name })), url: 'https://doi.org/10.0000/nodus-reader-fixture', isbn: [], issn: [], tags: ['lector'],
    },
    collectionIds: [], attachments: [
      { id: 'zotero:READERPDF', title: 'PDF original', fileName: 'original.pdf', relativePath: 'original.pdf', mimeType: 'application/pdf', byteSize: 1, sha256: 'a'.repeat(64), role: 'original', position: 0 },
      { id: 'local:READEREPUB', title: 'EPUB original', fileName: 'reader.epub', relativePath: 'reader.epub', mimeType: 'application/epub+zip', byteSize: 1, sha256: 'b'.repeat(64), role: 'original', position: 1 },
      { id: 'local:READERIMAGE', title: 'Figura original', fileName: 'figure.svg', relativePath: 'figure.svg', mimeType: 'image/svg+xml', byteSize: 1, sha256: 'c'.repeat(64), role: 'image', position: 2 },
      { id: 'local:READERDOCX', title: 'Documento Word', fileName: 'reader.docx', relativePath: 'reader.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', byteSize: 1, sha256: 'd'.repeat(64), role: 'supplement', position: 3 },
      { id: 'local:READERXLSX', title: 'Datos XLSX', fileName: 'reader.xlsx', relativePath: 'reader.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', byteSize: 1, sha256: 'e'.repeat(64), role: 'supplement', position: 4 },
    ],
    files: { reader: 'reader.md', original: 'original.pdf', sourceMap: 'source-map.json', annotations: 'annotations.json', orphanedAnnotations: 'orphaned-annotations.json', chat: 'chat.json' },
    extraction: { status: 'ready', lastSuccessfulAt: now, lastSuccessfulFingerprint: 'c'.repeat(64) },
    contentRevision: {
      format: 'nodus.library-content-revision', formatVersion: 1, revision: 1,
      extractionFingerprint: 'c'.repeat(64), bibliographicFingerprint: 'd'.repeat(64), contentFingerprint,
      embeddingFingerprint: null, summaryFingerprint: null, components, previousReadable: null,
      pendingInvalidations: [], updatedAt: now,
    }, createdAt: now, deletedAt: null,
    clock: { deviceId: 'reader-e2e-device', revision: 1, baseRevision: 0, updatedAt: now, contentHash: 'b'.repeat(64) },
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(documentFolder, 'source-map.json'), `${JSON.stringify({
    reader: { file: 'reader.md', sha256: contentFingerprint },
    pages: [{ page: 1, width: 612, height: 792 }, { page: 2, width: 612, height: 792 }],
    blocks: [
      { kind: 'title', markdown: { start: titleOffset, end: titleOffset + work.title.length + 2 }, anchors: [{ page: 1 }] },
      { kind: 'heading', markdown: { start: introOffset, end: introOffset + 16 }, anchors: [{ page: 1 }] },
      { kind: 'heading', markdown: { start: resultsOffset, end: resultsOffset + 13 }, anchors: [{ page: 2 }] },
    ],
  }, null, 2)}\n`, 'utf8');

  await page.evaluate(() => window.nodus.rebuildGlobalLibrary());

  await page.reload();
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
  const updateModal = page.getByTestId('startup-update-modal');
  if (await updateModal.count()) {
    await page.waitForFunction(() => document.querySelector('[data-testid="startup-update-modal"]')?.getAttribute('data-update-status') === 'not-available');
    await updateModal.getByRole('button', { name: 'Entendido', exact: false }).click();
    await updateModal.waitFor({ state: 'detached' });
  }

  const globalPage = await page.evaluate(() => window.nodus.listGlobalLibraryItems({ limit: 10, offset: 0 }));
  assert.equal(globalPage.total, 1, `expected the isolated global reader fixture; catalog contained ${JSON.stringify(globalPage.items)}`);
  assert.equal(globalPage.items[0]?.id, globalItemId);

  await page.locator('[data-tour="nav-library"]').click();
  await page.getByTestId('library-scope-global').click();
  const globalRow = page.getByTestId(`global-library-item-${globalItemId}`);
  await globalRow.waitFor({ state: 'visible' });
  await globalRow.getByRole('button').click();
  await page.getByTestId('global-library-detail').getByRole('button', { name: 'Leer', exact: true }).click();
  const documentRoot = page.getByTestId('library-reader-document');
  await documentRoot.waitFor({ state: 'visible' });
  assert.match(await page.getByTestId('library-reader-freshness').innerText(), /Markdown limpio/);

  assert.match(await documentRoot.innerText(), /Texto introductorio/);
  assert.equal(await documentRoot.locator('img').count(), 1, 'local extracted images render inside the clean document');
  assert.equal(await documentRoot.locator('table').count(), 1, 'Markdown tables remain structured');
  const readerOutline = page.locator('.library-reader-outline');
  assert.match(await readerOutline.innerText(), /Índice del documento[\s\S]*Introducción[\s\S]*Resultados/i, 'traced headings lead the reader rail');
  const filesToggle = page.getByTestId('library-reader-files-toggle');
  assert.equal(await filesToggle.getAttribute('aria-expanded'), 'false', 'preserved files start in one compact control');
  assert.equal(await page.getByTestId('library-reader-files').count(), 0);
  await filesToggle.click();
  assert.equal(await page.getByTestId('library-reader-files').getByRole('button').count(), 6, 'the compact file control reveals every preserved source');
  assert.equal(await filesToggle.getAttribute('aria-expanded'), 'true');
  assert.equal(await page.getByTestId('library-reader-source-picker').locator('option').count(), 6, 'clean Markdown and five preserved attachments are directly selectable');
  const darkReaderColors = await page.evaluate(() => {
    const surface = document.querySelector('.library-reader-clean-surface');
    const paper = document.querySelector('.library-reader-paper');
    const text = document.querySelector('.library-reader-document .md');
    if (!surface || !paper || !text) throw new Error('clean reader colors unavailable');
    return {
      surface: getComputedStyle(surface).backgroundColor,
      paper: getComputedStyle(paper).backgroundColor,
      text: getComputedStyle(text).color,
    };
  });
  assert.notEqual(darkReaderColors.paper, 'rgb(255, 255, 255)', 'dark mode never renders a white clean page');
  assert.match(darkReaderColors.surface, /rgb\((?:9, 9, 11|10, 10, 10)\)/);
  const outlineToggle = page.getByTestId('library-reader-outline-toggle');
  assert.equal(await outlineToggle.getAttribute('aria-expanded'), 'true');
  await outlineToggle.click();
  await page.locator('.library-reader-outline').waitFor({ state: 'detached' });
  assert.equal(await outlineToggle.getAttribute('aria-expanded'), 'false');
  await outlineToggle.click();
  await page.locator('.library-reader-outline').waitFor({ state: 'visible' });

  const sidebarToggle = page.getByTestId('library-reader-sidebar-toggle');
  assert.equal(await sidebarToggle.getAttribute('aria-expanded'), 'true');
  await sidebarToggle.click();
  await page.getByTestId('library-reader-sidebar').waitFor({ state: 'detached' });
  assert.equal(await sidebarToggle.getAttribute('aria-expanded'), 'false');
  await sidebarToggle.click();
  await page.getByTestId('library-reader-sidebar').waitFor({ state: 'visible' });
  await page.getByText(work.zotero_key, { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Preguntar al chat' }).waitFor();

  await page.getByRole('button', { name: 'Ver página 1' }).click();
  const originalPreview = page.getByTestId('library-original-preview');
  await originalPreview.waitFor({ state: 'visible' });
  await originalPreview.locator('canvas').waitFor({ state: 'visible' });
  assert.equal(await originalPreview.locator('canvas').getAttribute('data-page'), '1');
  assert.equal((await originalPreview.getByRole('button', { name: 'Anterior' }).innerText()).trim(), '', 'page navigation uses an icon-only previous control');
  assert.equal((await originalPreview.getByRole('button', { name: 'Siguiente' }).innerText()).trim(), '', 'page navigation uses an icon-only next control');
  await page.screenshot({ path: originalScreenshotPath, fullPage: true });
  await originalPreview.getByRole('button', { name: 'Cerrar' }).click();

  const readerSidebar = page.getByTestId('library-reader-sidebar');
  const notesTab = readerSidebar.getByRole('tab', { name: 'Notas' });
  const infoTab = readerSidebar.getByRole('tab', { name: 'Info' });
  assert.equal((await notesTab.innerText()).trim(), 'Notas', 'the active sidebar tab shows its label');
  assert.equal((await infoTab.innerText()).trim(), '', 'inactive sidebar tabs stay icon-only');
  await infoTab.click();
  assert.equal((await infoTab.innerText()).trim(), 'Info', 'the selected information tab reveals its compact label');
  assert.equal((await notesTab.innerText()).trim(), '', 'the previous tab collapses back to its icon');
  assert.match(await page.getByTestId('library-reader-metadata').innerText(), new RegExp(work.zotero_key));
  await page.getByTestId('library-reader-online-source').waitFor({ state: 'visible' });
  assert.match(await page.getByTestId('library-reader-online-source').innerText(), /doi\.org/);
  const provenance = page.getByTestId('library-reader-provenance');
  assert.match(await provenance.innerText(), new RegExp(contentFingerprint));
  await readerSidebar.getByRole('tab', { name: 'Chat' }).click();
  const readerCitation = page.getByTestId('library-reader-chat').locator('[data-citation-kind="reader"]');
  await readerCitation.waitFor({ state: 'visible' });
  assert.match(await readerCitation.innerText(), /Introducción/);
  await readerCitation.click();
  await page.waitForFunction(() => (document.querySelector('.library-reader-clean-surface')?.scrollTop ?? 0) > 0);
  await page.locator('.library-reader-clean-surface').evaluate((element) => element.scrollTo({ top: 0 }));
  const chatModel = page.getByTestId('library-reader-chat-model');
  await chatModel.getByRole('button', { name: /OpenAI · gpt-5.2/ }).click();
  assert.equal(await chatModel.getByRole('option').count(), 2, 'the reader model menu lists the configured featured models');
  await chatModel.getByRole('option', { name: /Anthropic · claude-sonnet-4-5/ }).click();
  assert.match(await chatModel.innerText(), /Anthropic · claude-sonnet-4-5/);
  const chatInput = page.getByTestId('library-reader-chat-input');
  await chatInput.waitFor();
  await chatInput.fill('¿Cuál es la tesis principal?');
  assert.equal(await page.getByTestId('library-reader-chat-send').isEnabled(), true, 'the embedded contextual chat composer is interactive');
  await chatInput.fill('');
  await page.setViewportSize({ width: 1120, height: 680 });
  const responsiveSidebar = await readerSidebar.boundingBox();
  const responsiveComposer = await page.getByTestId('library-reader-chat-input').boundingBox();
  assert.ok(responsiveSidebar && responsiveComposer);
  assert.ok(responsiveSidebar.y >= 0 && responsiveSidebar.y + responsiveSidebar.height <= 681, 'the resized right rail remains inside the reader viewport');
  assert.ok(responsiveComposer.y + responsiveComposer.height <= responsiveSidebar.y + responsiveSidebar.height, 'the chat composer remains fully reachable after resizing');
  const toastStack = await page.getByTestId('app-toast-stack').boundingBox();
  if (toastStack && toastStack.width > 0 && toastStack.height > 0) {
    assert.ok(toastStack.x + toastStack.width <= responsiveSidebar.x, 'transient notifications do not cover the reader chat rail');
  }
  await page.screenshot({ path: responsiveChatScreenshotPath, fullPage: true });
  await page.setViewportSize({ width: 1500, height: 980 });
  await readerSidebar.getByRole('tab', { name: 'Notas' }).click();
  await page.getByTestId('library-reader-orphaned-annotations').waitFor({ state: 'visible' });
  assert.match(await page.getByTestId('library-reader-orphaned-annotations').innerText(), /Comentario recuperable/);

  async function selectCandidate(index) {
    return page.evaluate((candidateIndex) => {
      const root = document.querySelector('[data-testid="library-reader-document"]');
      if (!(root instanceof HTMLElement)) throw new Error('reader document missing');
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const candidates = [];
      let node = walker.nextNode();
      while (node) {
        const start = node.data.search(/\S/);
        if (start >= 0 && node.data.slice(start).trim().length >= 16) candidates.push({ node, start });
        node = walker.nextNode();
      }
      const candidate = candidates[candidateIndex % candidates.length];
      if (!candidate) throw new Error('no selectable reader text');
      const range = document.createRange();
      range.setStart(candidate.node, candidate.start);
      range.setEnd(candidate.node, Math.min(candidate.node.data.length, candidate.start + 16));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      root.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      return range.toString();
    }, index);
  }

  await selectCandidate(1);
  const selectionBar = page.locator('.reader-selection-actions');
  await selectionBar.waitFor({ state: 'visible' });
  assert.equal(await selectionBar.locator('.reader-selection-color').count(), 6);
  await selectionBar.locator('.reader-selection-color').first().click();
  await page.waitForFunction(async (id) => (await window.nodus.listLibraryReaderAnnotations(id)).some((item) => item.kind === 'highlight'), globalItemId);

  await selectCandidate(2);
  await selectionBar.waitFor({ state: 'visible' });
  await selectionBar.getByRole('button', { name: 'Añadir comentario' }).click();
  const commentEditor = page.locator('.reader-comment-editor');
  await commentEditor.locator('textarea').fill('Una nota vinculada al fragmento seleccionado.');
  await commentEditor.getByRole('button', { name: 'Guardar', exact: true }).click();
  await page.waitForFunction(async (id) => (await window.nodus.listLibraryReaderAnnotations(id)).some((item) => item.kind === 'comment'), globalItemId);

  const bookmarkMenu = page.getByTestId('library-reader-bookmark-menu');
  await bookmarkMenu.click();
  await page.getByRole('menuitem', { name: 'Marcar esta sección' }).click();
  await page.waitForFunction(async (id) => (await window.nodus.listLibraryReaderAnnotations(id)).some((item) => item.kind === 'bookmark'), globalItemId);
  await bookmarkMenu.click();
  const goToBookmark = page.getByRole('menuitem', { name: 'Ir al marcador de lectura' });
  assert.equal(await goToBookmark.isEnabled(), true, 'the bookmark menu exposes navigation once a mark exists');
  await goToBookmark.click();
  assert.match(await page.locator('.library-reader-notes').innerText(), /2 fragmentos guardados/);

  const diskAnnotations = JSON.parse(await readFile(path.join(documentFolder, 'annotations.json'), 'utf8'));
  assert.equal(diskAnnotations.length, 4);
  assert.ok(diskAnnotations.every((item) => item.documentId === work.zotero_key), 'annotations retain the stable Zotero identifier');

  await readerSidebar.getByRole('tab', { name: 'Chat' }).click();
  await page.getByTestId('library-reader-chat-input').waitFor();
  await page.locator('.library-reader-clean-surface').evaluate((element) => element.scrollTo({ top: 0 }));
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const sourceChooser = page.getByTestId('library-reader-source-picker').locator('select');
  await sourceChooser.selectOption('zotero:READERPDF');
  const pdfViewer = page.getByTestId('library-reader-pdf-viewer');
  await pdfViewer.waitFor({ state: 'visible' });
  await pdfViewer.locator('canvas').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="library-reader-pdf-viewer"] .textLayer span').length > 0);
  assert.match(await page.getByTestId('library-reader-freshness').innerText(), /Archivo original/);
  assert.match(await page.locator('.library-reader-outline').innerText(), /Introducción[\s\S]*Resultados/, 'the clean-document outline remains available while the PDF is open');
  assert.equal((await pdfViewer.getByRole('button', { name: 'Anterior' }).innerText()).trim(), '');
  assert.equal((await pdfViewer.getByRole('button', { name: 'Siguiente' }).innerText()).trim(), '');
  await page.evaluate(() => {
    const span = document.querySelector('[data-testid="library-reader-pdf-viewer"] .textLayer span');
    if (!(span instanceof HTMLElement) || !span.firstChild?.textContent) throw new Error('PDF text layer is empty');
    const range = document.createRange(); range.selectNodeContents(span.firstChild); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    span.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });
  await page.locator('.reader-selection-actions').waitFor({ state: 'visible' });
  await page.locator('.reader-selection-actions .reader-selection-color').first().click();
  await page.waitForFunction(async (id) => (await window.nodus.listLibraryReaderAnnotations(id)).some((item) => item.scope === 'attachment:zotero:READERPDF:page:1'), globalItemId);
  await page.screenshot({ path: pdfScreenshotPath, fullPage: true });

  await sourceChooser.selectOption('local:READEREPUB');
  const epubViewer = page.getByTestId('library-reader-epub-viewer');
  await epubViewer.waitFor({ state: 'visible' });
  assert.match(await epubViewer.innerText(), /Este texto refluye/);
  await page.evaluate(() => {
    const root = document.querySelector('[data-testid="library-reader-epub-content"] .library-attachment-text');
    if (!(root instanceof HTMLElement)) throw new Error('EPUB text surface missing');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let node = walker.nextNode();
    while (node && !node.textContent?.includes('Este texto')) node = walker.nextNode();
    if (!node?.textContent) throw new Error('EPUB text missing'); const start = node.textContent.indexOf('Este texto');
    const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + 28); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    root.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });
  await page.locator('.reader-selection-actions').waitFor({ state: 'visible' });
  await page.locator('.reader-selection-actions .reader-selection-color').nth(2).click();
  await page.waitForFunction(async (id) => (await window.nodus.listLibraryReaderAnnotations(id)).some((item) => item.scope.startsWith('attachment:local:READEREPUB:chapter:')), globalItemId);
  await page.screenshot({ path: epubScreenshotPath, fullPage: true });

  await sourceChooser.selectOption('local:READERIMAGE');
  const imageViewer = page.getByTestId('library-reader-image-viewer');
  await imageViewer.waitFor({ state: 'visible' });
  const image = imageViewer.locator('img'); await image.waitFor(); await image.evaluate((element) => element.complete || new Promise((resolve) => element.addEventListener('load', resolve, { once: true })));
  await imageViewer.getByRole('button', { name: 'Marcar región' }).click();
  const imageBox = await image.boundingBox(); assert.ok(imageBox);
  await page.mouse.move(imageBox.x + imageBox.width * .18, imageBox.y + imageBox.height * .2);
  await page.mouse.down(); await page.mouse.move(imageBox.x + imageBox.width * .68, imageBox.y + imageBox.height * .7, { steps: 8 }); await page.mouse.up();
  await page.waitForFunction(async (id) => (await window.nodus.listLibraryReaderAnnotations(id)).some((item) => item.target?.type === 'region' && item.target.attachmentId === 'local:READERIMAGE'), globalItemId);
  await page.screenshot({ path: imageScreenshotPath, fullPage: true });

  await sourceChooser.selectOption('local:READERDOCX');
  const textViewer = page.getByTestId('library-reader-text-viewer');
  await textViewer.waitFor({ state: 'visible' });
  assert.match(await textViewer.innerText(), /Documento Word abierto dentro de Nodus/);
  await page.screenshot({ path: docxScreenshotPath, fullPage: true });

  await sourceChooser.selectOption('local:READERXLSX');
  await textViewer.waitFor({ state: 'visible' });
  assert.match(await textViewer.innerText(), /Claridad[\s\S]*95/);
  await page.screenshot({ path: spreadsheetScreenshotPath, fullPage: true });

  await page.getByTestId('library-scope-shell').getByRole('button', { name: 'Biblioteca', exact: true }).click();
  const detail = page.getByTestId('global-library-detail'); await detail.waitFor({ state: 'visible' });
  await detail.getByTestId('cite-library-item').click();
  const citationDialog = page.getByTestId('library-citation-export-dialog'); await citationDialog.waitFor({ state: 'visible' });
  await citationDialog.getByRole('button', { name: 'Gestionar estilos' }).click();
  await citationDialog.getByTestId('import-zotero-csl').click();
  await citationDialog.locator('b').filter({ hasText: 'Casa de Velázquez — E2E' }).waitFor();
  await citationDialog.getByTestId('library-citation-style').selectOption('casa-velazquez-e2e');
  await citationDialog.getByTestId('copy-library-citation').click();
  await citationDialog.locator('pre').filter({ hasText: work.title }).waitFor();
  await page.screenshot({ path: citationScreenshotPath, fullPage: true });
  await citationDialog.locator('header button').click();

  await detail.getByRole('button', { name: 'Leer', exact: true }).click();
  const lightSourcePicker = page.getByTestId('library-reader-source-picker');
  const lightSourceSelect = lightSourcePicker.locator('select');
  await lightSourceSelect.selectOption('clean');
  await page.getByTestId('library-reader-sidebar').getByRole('tab', { name: 'Notas' }).click();
  await page.evaluate(() => { document.documentElement.classList.add('light'); document.documentElement.classList.remove('dark'); });
  await page.setViewportSize({ width: 1500, height: 820 });
  const sourcePickerGeometry = await lightSourcePicker.evaluate((picker) => {
    const select = picker.querySelector('select');
    const icon = picker.querySelector('svg');
    if (!(select instanceof HTMLSelectElement) || !(icon instanceof SVGElement)) throw new Error('source picker controls missing');
    const selectRect = select.getBoundingClientRect();
    const iconRect = icon.getBoundingClientRect();
    return {
      iconRight: iconRect.right,
      textStart: selectRect.left + Number.parseFloat(getComputedStyle(select).paddingLeft),
      paddingLeft: Number.parseFloat(getComputedStyle(select).paddingLeft),
    };
  });
  assert.ok(sourcePickerGeometry.paddingLeft >= 32, 'the source picker reserves a leading-icon gutter');
  assert.ok(sourcePickerGeometry.iconRight + 4 <= sourcePickerGeometry.textStart, 'the source icon never overlaps the selected filename');

  await lightSourceSelect.selectOption('zotero:READERPDF');
  await page.getByTestId('library-reader-pdf-viewer').waitFor({ state: 'visible' });
  const lightSourceBadge = page.getByTestId('library-reader-freshness');
  assert.equal(await lightSourceBadge.getAttribute('data-source-kind'), 'original');
  const originalBadgeColors = await lightSourceBadge.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color };
  });
  assert.deepEqual(originalBadgeColors, { background: 'rgb(255, 255, 255)', color: 'rgb(82, 82, 91)' }, 'the original-file badge uses the light semantic palette');

  const lightFilesToggle = page.getByTestId('library-reader-files-toggle');
  if (await lightFilesToggle.getAttribute('aria-expanded') !== 'true') await lightFilesToggle.click();
  const activeOriginal = page.getByTestId('library-reader-file-zotero:READERPDF');
  const activeFileColors = await activeOriginal.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color };
  });
  assert.deepEqual(activeFileColors, { background: 'rgb(238, 242, 255)', color: 'rgb(67, 56, 202)' }, 'the selected file remains light and legible');

  const highlighter = page.getByTestId('deep-research-fixed-highlighter');
  await highlighter.click();
  const cursorMode = page.locator('.reader-highlighter-palette .reader-highlighter-off');
  await cursorMode.hover();
  const cursorColors = await cursorMode.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color };
  });
  assert.deepEqual(cursorColors, { background: 'rgb(238, 242, 255)', color: 'rgb(67, 56, 202)' }, 'the light highlighter menu keeps the cursor arrow visible');
  await page.screenshot({ path: lightControlsScreenshotPath, fullPage: true });
  await highlighter.click();

  await lightSourceSelect.selectOption('clean');
  await page.setViewportSize({ width: 860, height: 820 });
  await page.screenshot({ path: lightScreenshotPath, fullPage: true });
  assert.deepEqual(pageErrors, [], pageErrors.map((error) => error.stack ?? String(error)).join('\n'));
  console.log(`library reader UI test passed; screenshots: ${screenshotDirectory}`);
} finally {
  if (app) await app.close().catch(() => undefined);
  await rm(testRoot, { recursive: true, force: true });
}
