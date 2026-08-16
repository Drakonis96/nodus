// Real-renderer acceptance test for what a section remembers when you leave it.
//
// The repository tests prove the store and read the wiring; only the running app can
// prove the thing the reader actually notices: that walking out of Deep Research and
// back in lands on the same report, at the same paragraph, with the same gallery
// controls — and that the paragraph is found again by what it says, not by how many
// pixels down the page it happened to be.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-view-snapshots-ui-'));
const childEnv = {
  ...process.env,
  NODUS_USERDATA: userData,
  NODUS_DISABLE_AUTO_UPDATE: '1',
  NODUS_E2E_UPDATE_STATUS: 'not-available',
  NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1',
};
delete childEnv.ELECTRON_RUN_AS_NODE;

/** The block under the top edge of the reader, as the reader would read it. */
const TOP_BLOCK = `(() => {
  const root = document.querySelector('[data-testid="deep-research-reader-document"]');
  const scroller = root?.closest('main');
  if (!root || !scroller) return null;
  const all = Array.from(root.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, table, figure'));
  const blocks = all.filter((block, index) => index + 1 >= all.length || !block.contains(all[index + 1]));
  const edge = scroller.getBoundingClientRect().top + 1;
  const found = blocks.find((block) => block.getBoundingClientRect().bottom > edge) ?? null;
  return found ? (found.textContent ?? '').trim().slice(0, 80) : null;
})()`;

let app;
try {
  app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env: childEnv });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  await page.setViewportSize({ width: 1400, height: 900 });
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

  // The demo's report is one screen long, and a place only means something in a
  // document that does not fit on one. This is the demo report with a long body: same
  // brief, same shape, enough of it to scroll.
  await page.evaluate(async () => {
    const drafts = await window.nodus.listWritingWorkshopDrafts();
    const demo = drafts.find((item) => item.brief.kind === 'deep_research');
    if (!demo) throw new Error('the demo supplies no Deep Research report');
    const body = Array.from({ length: 90 }, (_, index) => (
      `## Sección ${index + 1}\n\nPárrafo ${index + 1} del informe largo, escrito para que la lectura ocupe`
      + ' bastante más que una pantalla y el sitio en el que se dejó signifique algo.'
    )).join('\n\n');
    await window.nodus.saveWritingWorkshopDraft({
      draft: { ...demo.draft, title: 'AAA informe largo de prueba', draftMarkdown: body },
      model: demo.model ?? null,
    });
  });

  const openDeepResearch = () => page.locator('[data-tour="nav-deepResearch"]').click();
  const readerDocument = page.locator('[data-testid="deep-research-reader-document"]');
  const sortSelect = page.locator('select').filter({ hasText: 'Más recientes' });

  // ── The gallery's own controls ──────────────────────────────────────────────
  await openDeepResearch();
  await sortSelect.selectOption('title');

  // ── A report, and a place inside it ─────────────────────────────────────────
  await page.getByRole('button', { name: 'Leer', exact: true }).first().click();
  await readerDocument.waitFor({ state: 'visible' });
  const reportTitle = await page.locator('header .truncate.text-sm.font-semibold').first().innerText();

  // A real wheel, not an assignment to scrollTop: the capture deliberately waits for
  // the reader's own hands before it starts overwriting the stored place.
  await page.mouse.move(700, 500);
  await page.mouse.wheel(0, 1_600);
  await page.waitForTimeout(400);
  const leftAt = await page.evaluate(TOP_BLOCK);
  assert.ok(leftAt, 'the reader is somewhere inside the report');
  const scrolled = await page.evaluate(() => document.querySelector('[data-testid="deep-research-reader-document"]').closest('main').scrollTop);
  assert.ok(scrolled > 200, `the wheel moved the report (scrollTop ${scrolled})`);

  // ── Out of the section, and back in ─────────────────────────────────────────
  await page.locator('[data-tour="nav-ideas"]').click();
  await page.waitForSelector('[data-testid="deep-research-reader-document"]', { state: 'detached' });
  await openDeepResearch();
  await readerDocument.waitFor({ state: 'visible' });

  const backAt = await page.evaluate(TOP_BLOCK);
  assert.equal(backAt, leftAt, 'the report reopens at the paragraph it was left on');
  const backTitle = await page.locator('header .truncate.text-sm.font-semibold').first().innerText();
  assert.equal(backTitle, reportTitle, 'and it is the same report');

  // The same place after a resize, which is the whole reason it is a block and not a
  // pixel offset: the text rewraps and the offset it was read at no longer exists.
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.locator('[data-tour="nav-ideas"]').click();
  await page.waitForSelector('[data-testid="deep-research-reader-document"]', { state: 'detached' });
  await openDeepResearch();
  await readerDocument.waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(TOP_BLOCK), leftAt, 'a narrower window still finds the same paragraph');

  // ── Back to the gallery, with its controls as they were left ────────────────
  await page.getByRole('button', { name: 'Volver a la galería' }).click();
  await page.getByTitle('Vista lista').click();
  await page.locator('[data-tour="nav-ideas"]').click();
  await openDeepResearch();
  await readerDocument.waitFor({ state: 'detached' });
  assert.equal(await sortSelect.inputValue(), 'title', 'the ordering survives leaving the section');
  const listActive = await page.evaluate(() => Boolean(document.querySelector('.space-y-2 [data-anchor-id]')));
  assert.ok(listActive, 'and so does the list/grid choice');
  const firstCard = await page.evaluate(() => document.querySelector('[data-anchor-id]')?.textContent?.includes('AAA informe largo'));
  assert.ok(firstCard, 'the ordering is the restored one, not the default');

  // ── Inmersión: the session that was open, open again ────────────────────────
  //
  // The session carries its own progress, so the only thing lost on the way out is
  // that it was open at all. Reopening it is a read, and it lands on the same step.
  await page.locator('[data-tour="nav-immersion"]').click();
  const immersionExit = page.getByRole('button', { name: 'Salir', exact: true });
  await page.locator('[data-anchor-id]').first().click();
  await immersionExit.waitFor({ state: 'visible' });
  const step = await page.locator('header .text-\\[11px\\]').first().innerText();
  await page.locator('[data-tour="nav-ideas"]').click();
  await immersionExit.waitFor({ state: 'detached' });
  await page.locator('[data-tour="nav-immersion"]').click();
  await immersionExit.waitFor({ state: 'visible' });
  assert.equal(await page.locator('header .text-\\[11px\\]').first().innerText(), step, 'the immersion reopens on the step it was left on');

  // And leaving the player is leaving it: the gallery does not reopen it by itself.
  await immersionExit.click();
  await page.locator('[data-tour="nav-ideas"]').click();
  await page.locator('[data-tour="nav-immersion"]').click();
  await immersionExit.waitFor({ state: 'detached' });

  assert.deepEqual(pageErrors.map((error) => error.message), [], 'no renderer errors');
  console.log('View snapshots e2e passed.');
} finally {
  await app?.close();
  await rm(userData, { recursive: true, force: true });
}
