// Real-renderer acceptance test for the clean Library reader. The fixture lives in
// an isolated backup folder so the test exercises the same nodus-library contract as
// a Zotero import without touching a user's documents.
import assert from 'node:assert/strict';
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
const screenshotPath = path.join(os.tmpdir(), 'nodus-library-reader-e2e.png');
const childEnv = {
  ...process.env,
  NODUS_USERDATA: userData,
  NODUS_DISABLE_AUTO_UPDATE: '1',
  NODUS_E2E_UPDATE_STATUS: 'not-available',
  NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1',
};
delete childEnv.ELECTRON_RUN_AS_NODE;

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNkYPj/n4GBgYGJAQoAHgQCAcL7reQAAAAASUVORK5CYII=',
  'base64',
);

let app;
try {
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
  await writeFile(path.join(documentFolder, 'annotations.json'), '[]\n', 'utf8');
  const now = new Date().toISOString();
  const globalItemId = `zotero:${work.zotero_key}`;
  await writeFile(path.join(documentFolder, 'metadata.json'), `${JSON.stringify({
    format: 'nodus.library-item', formatVersion: 1,
    id: globalItemId, storageId: work.zotero_key, source: 'zotero', sourceLibraryId: 'users/0', sourceKey: work.zotero_key,
    citationKey: 'readerFixture2026',
    metadata: {
      title: work.title, itemType: 'article-journal', year: work.year,
      creators: work.authors.map((name) => ({ creatorType: 'author', name })), isbn: [], issn: [], tags: ['lector'],
    },
    collectionIds: [], attachments: [{ id: 'zotero:READERPDF', title: 'PDF', fileName: 'original.pdf', relativePath: 'original.pdf', mimeType: 'application/pdf', byteSize: 1, sha256: 'a'.repeat(64), role: 'original' }],
    files: { reader: 'reader.md', original: 'original.pdf', sourceMap: 'source-map.json' },
    extraction: { status: 'ready' }, createdAt: now, deletedAt: null,
    clock: { deviceId: 'reader-e2e-device', revision: 1, baseRevision: 0, updatedAt: now, contentHash: 'b'.repeat(64) },
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(documentFolder, 'source-map.json'), `${JSON.stringify({
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
  const globalRow = page.getByTestId(`global-library-item-${globalItemId}`);
  await globalRow.waitFor({ state: 'visible' });
  await globalRow.getByRole('button').click();
  await page.getByTestId('global-library-detail').getByRole('button', { name: 'Leer', exact: true }).click();
  const documentRoot = page.getByTestId('library-reader-document');
  await documentRoot.waitFor({ state: 'visible' });

  assert.match(await documentRoot.innerText(), /Texto introductorio/);
  assert.equal(await documentRoot.locator('img').count(), 1, 'local extracted images render inside the clean document');
  assert.equal(await documentRoot.locator('table').count(), 1, 'Markdown tables remain structured');
  assert.equal(await page.locator('.library-reader-outline nav button').count(), 6, 'three headings expose a title and page action each');
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
  await page.getByRole('button', { name: 'Abrir original completo' }).waitFor();

  await page.getByRole('button', { name: 'Ver página 1' }).click();
  const originalPreview = page.getByTestId('library-original-preview');
  await originalPreview.waitFor({ state: 'visible' });
  await originalPreview.locator('canvas').waitFor({ state: 'visible' });
  assert.equal(await originalPreview.locator('canvas').getAttribute('data-page'), '1');
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
  await readerSidebar.getByRole('tab', { name: 'Chat' }).click();
  const chatInput = page.getByTestId('library-reader-chat-input');
  await chatInput.waitFor();
  await chatInput.fill('¿Cuál es la tesis principal?');
  assert.equal(await page.getByTestId('library-reader-chat-send').isEnabled(), true, 'the embedded contextual chat composer is interactive');
  await chatInput.fill('');
  await readerSidebar.getByRole('tab', { name: 'Notas' }).click();

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
  assert.equal(diskAnnotations.length, 3);
  assert.ok(diskAnnotations.every((item) => item.documentId === work.zotero_key), 'annotations retain the stable Zotero identifier');

  await readerSidebar.getByRole('tab', { name: 'Chat' }).click();
  await page.getByTestId('library-reader-chat-input').waitFor();
  await page.screenshot({ path: screenshotPath, fullPage: true });
  assert.deepEqual(pageErrors, [], pageErrors.map((error) => error.stack ?? String(error)).join('\n'));
  console.log(`library reader UI test passed; screenshot: ${screenshotPath}`);
} finally {
  if (app) await app.close().catch(() => undefined);
  await rm(testRoot, { recursive: true, force: true });
}
