// Real-renderer acceptance test for Deep Research annotations. It covers the pieces a
// repository test cannot: browser selections, the persistent top-bar highlighter, CSS
// highlights, margin icons, comment editing/confirmation, and the margin bookmark.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
/** The six ribbon colours, in the order READER_ANNOTATION_COLORS renders them. */
const READER_COLORS = ['yellow', 'rose', 'blue', 'mint', 'lavender', 'peach'];
const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-dr-annotations-ui-'));
const childEnv = {
  ...process.env,
  NODUS_USERDATA: userData,
  NODUS_DISABLE_AUTO_UPDATE: '1',
  NODUS_E2E_UPDATE_STATUS: 'not-available',
  NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1',
};
delete childEnv.ELECTRON_RUN_AS_NODE;

let app;
try {
  app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env: childEnv });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));

  await page.evaluate(async (version) => {
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
    });
    await window.nodus.seedDemoData();
  }, require(path.join(repoRoot, 'package.json')).version);
  await page.reload();
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
  const updateModal = page.getByTestId('startup-update-modal');
  if (await updateModal.count()) {
    await page.waitForFunction(() => document.querySelector('[data-testid="startup-update-modal"]')?.getAttribute('data-update-status') === 'not-available');
    await updateModal.getByRole('button', { name: 'Entendido', exact: false }).click();
    await updateModal.waitFor({ state: 'detached' });
  }

  await page.locator('[data-tour="nav-deepResearch"]').click();
  await page.getByRole('button', { name: 'Leer', exact: true }).first().click();
  const documentRoot = page.locator('[data-testid="deep-research-reader-document"]');
  await documentRoot.waitFor({ state: 'visible' });
  const draftId = await page.evaluate(async () => (
    (await window.nodus.listWritingWorkshopDrafts()).find((item) => item.brief.kind === 'deep_research')?.id
  ));
  assert.ok(draftId, 'the demo supplies a saved Deep Research report');

  async function selectCandidate(index, releaseInGutter = false, readerTestId = 'deep-research-reader-document') {
    return page.evaluate(({ candidateIndex, releaseInGutter, readerTestId }) => {
      const root = document.querySelector(`[data-testid="${readerTestId}"]`);
      if (!(root instanceof HTMLElement)) throw new Error('reader document missing');
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const candidates = [];
      let node = walker.nextNode();
      while (node) {
        const text = node.data;
        const start = text.search(/\S/);
        if (start >= 0 && text.slice(start).trim().length >= 8) {
          const range = document.createRange();
          range.setStart(node, start);
          range.setEnd(node, Math.min(text.length, start + 8));
          const rect = range.getBoundingClientRect();
          if (rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight) candidates.push({ node, start });
        }
        node = walker.nextNode();
      }
      const candidate = candidates[candidateIndex % candidates.length];
      if (!candidate) throw new Error('no selectable reader text');
      const range = document.createRange();
      range.setStart(candidate.node, candidate.start);
      range.setEnd(candidate.node, Math.min(candidate.node.data.length, candidate.start + 8));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      const releaseRect = range.getBoundingClientRect();
      // A real selection ends under the pointer, and the ribbon is placed there.
      const rootRect = root.getBoundingClientRect();
      const release = releaseInGutter
        ? { x: Math.max(1, rootRect.left - 24), y: releaseRect.top + releaseRect.height / 2 }
        : { x: releaseRect.right, y: releaseRect.top + releaseRect.height / 2 };
      const releaseTarget = releaseInGutter ? document.elementFromPoint(release.x, release.y) ?? document.body : root;
      releaseTarget.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: release.x, clientY: release.y }));
      return { text: range.toString(), release };
    }, { candidateIndex: index, releaseInGutter, readerTestId });
  }

  async function annotations() {
    return page.evaluate((id) => window.nodus.listWritingDraftAnnotations(id), draftId);
  }

  // Contextual selection: exactly six pastel choices and one click persists a highlight.
  const firstSelection = await selectCandidate(0);
  const selectionBar = page.locator('.reader-selection-actions');
  await selectionBar.waitFor({ state: 'visible' });
  assert.equal(await selectionBar.locator('.reader-selection-color').count(), 6);
  // The ribbon belongs over the pointer that finished the selection, not over the
  // box of the whole selection, which starts wherever the drag began.
  const ribbonBox = await selectionBar.boundingBox();
  assert.ok(Math.abs(ribbonBox.x + ribbonBox.width / 2 - firstSelection.release.x) <= 2, `ribbon centred on the pointer (${ribbonBox.x + ribbonBox.width / 2} vs ${firstSelection.release.x})`);
  assert.ok(ribbonBox.y + ribbonBox.height <= firstSelection.release.y, 'ribbon sits above the pointer');
  await selectionBar.locator('.reader-selection-color').first().click();
  await page.waitForFunction(async (id) => (await window.nodus.listWritingDraftAnnotations(id)).filter((item) => item.kind === 'highlight').length === 1, draftId);
  await page.waitForFunction(() => CSS.highlights?.get('nodus-reader-yellow')?.size === 1);

  // Font reflow must leave the annotation layer attached to the same live text
  // nodes. This used to freeze the renderer and make highlights, comments and
  // the contextual ribbon blink in and out after using either typography button.
  const initialFontSize = await documentRoot.locator('.md').evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
  await page.getByTestId('deep-research-font-increase').click();
  await page.waitForFunction((expected) => {
    const prose = document.querySelector('[data-testid="deep-research-reader-document"] .md');
    return prose && parseFloat(getComputedStyle(prose).fontSize) === expected;
  }, initialFontSize + 1);
  assert.equal(
    await page.evaluate(() => CSS.highlights?.get('nodus-reader-yellow')?.size),
    1,
    'font increase keeps the stored highlight registered',
  );
  await page.getByTestId('deep-research-font-decrease').click();
  await page.waitForFunction((expected) => {
    const prose = document.querySelector('[data-testid="deep-research-reader-document"] .md');
    return prose && parseFloat(getComputedStyle(prose).fontSize) === expected;
  }, initialFontSize);
  await selectCandidate(5);
  await selectionBar.waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');

  // Releasing in the blank gutter still completes a selection made in the
  // report and opens the ribbon at the edge of the viewport.
  const gutterSelection = await selectCandidate(4, true);
  await selectionBar.waitFor({ state: 'visible' });
  const gutterRibbonBox = await selectionBar.boundingBox();
  assert.ok(gutterRibbonBox.x >= 0, 'gutter selection ribbon stays inside the viewport');
  assert.ok(gutterRibbonBox.x <= gutterSelection.release.x + 1, 'gutter selection ribbon follows the release side');
  await page.keyboard.press('Escape');

  // Fixed mode remains active while two separate selections are made.
  const fixedHighlighter = page.locator('[data-testid="deep-research-fixed-highlighter"]');
  await fixedHighlighter.click();
  await page.locator('.reader-highlighter-palette button').nth(2).click();
  assert.equal(await fixedHighlighter.getAttribute('aria-pressed'), 'true');
  await selectCandidate(1);
  await page.waitForFunction(async (id) => (await window.nodus.listWritingDraftAnnotations(id)).filter((item) => item.kind === 'highlight').length === 2, draftId);
  assert.equal(await fixedHighlighter.getAttribute('aria-pressed'), 'true', 'fixed highlighter stays active after a selection');
  await fixedHighlighter.click();
  await page.locator('.reader-highlighter-off').click();

  // Clicking painted text reopens the whole ribbon over that passage — the colour it
  // already has is marked, and the trash is added. Deletion is immediate and
  // deliberately does not open the confirmation dialog reserved for comments.
  const firstHighlight = (await annotations()).find((item) => item.kind === 'highlight');
  const highlightPoint = await page.evaluate((annotation) => {
    const root = document.querySelector('[data-testid="deep-research-reader-document"]');
    if (!(root instanceof HTMLElement)) throw new Error('reader document missing');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let offset = 0;
    let started = false;
    let node = walker.nextNode();
    while (node) {
      const next = offset + node.data.length;
      if (!started && annotation.startOffset >= offset && annotation.startOffset <= next) {
        range.setStart(node, annotation.startOffset - offset);
        started = true;
      }
      if (started && annotation.endOffset >= offset && annotation.endOffset <= next) {
        range.setEnd(node, annotation.endOffset - offset);
        break;
      }
      offset = next;
      node = walker.nextNode();
    }
    range.startContainer.parentElement?.scrollIntoView({ block: 'center' });
    const rect = range.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, firstHighlight);
  await page.mouse.click(highlightPoint.x, highlightPoint.y);
  await selectionBar.waitFor({ state: 'visible' });
  assert.equal(await selectionBar.locator('.reader-selection-color').count(), 6);
  assert.equal(await selectionBar.locator('.reader-selection-color.is-active').count(), 1, 'the stored colour is marked');
  await selectionBar.getByRole('button', { name: 'Copiar' }).waitFor({ state: 'visible' });
  // A colour on a stored highlight recolours it instead of stacking a second one.
  const recoloured = READER_COLORS.findIndex((color) => color !== firstHighlight.color);
  await selectionBar.locator('.reader-selection-color').nth(recoloured).click();
  await page.waitForFunction(async ({ id, color }) => {
    const highlights = (await window.nodus.listWritingDraftAnnotations(id)).filter((item) => item.kind === 'highlight');
    return highlights.length === 2 && highlights.some((item) => item.color === color);
  }, { id: draftId, color: READER_COLORS[recoloured] });

  await page.mouse.click(highlightPoint.x, highlightPoint.y);
  await selectionBar.waitFor({ state: 'visible' });
  await selectionBar.locator('button[data-tone="danger"]').click();
  await page.waitForFunction(async (id) => (await window.nodus.listWritingDraftAnnotations(id)).filter((item) => item.kind === 'highlight').length === 1, draftId);
  assert.equal(await page.getByRole('dialog').count(), 0, 'highlight deletion never asks for confirmation');

  // Comments appear in the margin, reopen for editing, and require confirmation to delete.
  await selectCandidate(2);
  await selectionBar.waitFor({ state: 'visible' });
  await selectionBar.getByRole('button', { name: 'Añadir comentario' }).click();
  const commentEditor = page.locator('.reader-comment-editor');
  await commentEditor.locator('textarea').fill('Primera observación');
  await commentEditor.getByRole('button', { name: 'Guardar', exact: true }).click();
  await page.waitForFunction(async (id) => (await window.nodus.listWritingDraftAnnotations(id)).some((item) => item.comment === 'Primera observación'), draftId);
  const commentMarker = page.locator('.reader-margin-marker-comment');
  await commentMarker.waitFor({ state: 'visible' });
  await commentMarker.click();
  await commentEditor.locator('textarea').fill('Observación revisada');
  await commentEditor.getByRole('button', { name: 'Guardar', exact: true }).click();
  await page.waitForFunction(async (id) => (await window.nodus.listWritingDraftAnnotations(id)).some((item) => item.comment === 'Observación revisada'), draftId);

  // The reading bookmark now uses an aligned margin icon instead of painting the text.
  await selectCandidate(3);
  await selectionBar.waitFor({ state: 'visible' });
  await selectionBar.getByRole('button', { name: 'Añadir marcador de lectura' }).click();
  const bookmarkMarker = page.locator('.reader-margin-marker-bookmark');
  await bookmarkMarker.waitFor({ state: 'visible' });
  await bookmarkMarker.click();
  await selectionBar.locator('button[data-tone="danger"]').click();
  await bookmarkMarker.waitFor({ state: 'detached' });

  await commentMarker.click();
  await commentEditor.getByRole('button', { name: 'Eliminar', exact: true }).click();
  const confirmation = page.getByRole('dialog').filter({ hasText: '¿Eliminar esta anotación? No se puede deshacer.' });
  await confirmation.getByRole('button', { name: 'Eliminar', exact: true }).click();
  await page.waitForFunction(async (id) => !(await window.nodus.listWritingDraftAnnotations(id)).some((item) => item.kind === 'comment'), draftId);

  // Inmersión uses the same complete annotation contract, persisted under the
  // session and isolated by player step.
  await page.locator('[data-tour="nav-immersion"]').click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).first().click();
  const immersionRoot = page.getByTestId('immersion-reader-document');
  await immersionRoot.waitFor({ state: 'visible' });
  const immersionDocumentId = 'immersion:demo-immersion-session';

  await selectCandidate(0, false, 'immersion-reader-document');
  await selectionBar.waitFor({ state: 'visible' });
  await selectionBar.locator('.reader-selection-color').first().click();
  await page.waitForFunction(async (id) => (await window.nodus.listWritingDraftAnnotations(id)).some((item) => item.kind === 'highlight'), immersionDocumentId);

  await selectCandidate(1, false, 'immersion-reader-document');
  await selectionBar.waitFor({ state: 'visible' });
  await selectionBar.getByRole('button', { name: 'Añadir comentario' }).click();
  await commentEditor.locator('textarea').fill('Comentario persistente de Inmersión');
  await commentEditor.getByRole('button', { name: 'Guardar', exact: true }).click();
  await page.waitForFunction(async (id) => (await window.nodus.listWritingDraftAnnotations(id)).some((item) => item.comment === 'Comentario persistente de Inmersión'), immersionDocumentId);
  await commentMarker.waitFor({ state: 'visible' });

  await page.getByRole('button', { name: 'Salir', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).first().click();
  await immersionRoot.waitFor({ state: 'visible' });
  await commentMarker.waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => Boolean(CSS.highlights?.get('nodus-reader-yellow'))), true, 'the immersion highlight is painted after reopening');
  await commentMarker.click();
  assert.equal(await commentEditor.locator('textarea').inputValue(), 'Comentario persistente de Inmersión');

  assert.deepEqual(pageErrors, [], pageErrors.map((error) => error.stack ?? String(error)).join('\n'));
  const final = await annotations();
  assert.equal(final.filter((item) => item.kind === 'highlight').length, 1);
  console.log('deep research annotation UI test passed');
} finally {
  if (app) await app.close().catch(() => undefined);
  await rm(userData, { recursive: true, force: true });
}
