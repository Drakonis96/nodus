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

  async function selectCandidate(index) {
    return page.evaluate((candidateIndex) => {
      const root = document.querySelector('[data-testid="deep-research-reader-document"]');
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
      root.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      return range.toString();
    }, index);
  }

  async function annotations() {
    return page.evaluate((id) => window.nodus.listWritingDraftAnnotations(id), draftId);
  }

  // Contextual selection: exactly six pastel choices and one click persists a highlight.
  await selectCandidate(0);
  const selectionBar = page.locator('.reader-selection-actions');
  await selectionBar.waitFor({ state: 'visible' });
  assert.equal(await selectionBar.locator('.reader-selection-color').count(), 6);
  await selectionBar.locator('.reader-selection-color').first().click();
  await page.waitForFunction(async (id) => (await window.nodus.listWritingDraftAnnotations(id)).filter((item) => item.kind === 'highlight').length === 1, draftId);

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

  // Clicking painted text exposes only the trash action; deletion is immediate and
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
  assert.equal(await selectionBar.locator('.reader-selection-color').count(), 0);
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

  assert.deepEqual(pageErrors, [], pageErrors.map((error) => error.stack ?? String(error)).join('\n'));
  const final = await annotations();
  assert.equal(final.filter((item) => item.kind === 'highlight').length, 1);
  console.log('deep research annotation UI test passed');
} finally {
  if (app) await app.close().catch(() => undefined);
  await rm(userData, { recursive: true, force: true });
}
