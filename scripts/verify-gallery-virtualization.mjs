// Focused Electron regression: the Gallery layout must virtualize.
//
// The gallery used to mount a card per row. Each card issues an IPC call for
// its thumbnail and retains a Blob URL, so a 7,000-row database flooded the
// main process and pinned hundreds of megabytes before anything was drawn.
//
// Verified against the real app because none of this is observable from unit
// tests: what matters is how many cards the browser actually mounts.
// Uses a throwaway profile and never touches the user's vaults.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const appVersion = require(path.join(repoRoot, 'package.json')).version;
const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-gallery-'));
const screenshotDir = process.env.SHOT_OUT || os.tmpdir();

const ROW_COUNT = 400;

if (!existsSync(path.join(repoRoot, 'dist-electron/main.js')) || !existsSync(path.join(repoRoot, 'dist/index.html'))) {
  throw new Error('Run `npm run build` before this focused verification.');
}

const childEnv = {
  ...process.env,
  NODUS_USERDATA: userData,
  NODUS_DISABLE_AUTO_UPDATE: '1',
  NODUS_E2E_UPDATE_STATUS: 'not-available',
};
delete childEnv.ELECTRON_RUN_AS_NODE;

async function closeElectronApp(instance) {
  if (!instance) return;
  const child = instance.process();
  let timeout;
  const closed = instance.close().then(() => true, () => false);
  const closedCleanly = await Promise.race([
    closed,
    new Promise((resolve) => { timeout = setTimeout(() => resolve(false), 5_000); }),
  ]);
  clearTimeout(timeout);
  if (!closedCleanly && child.exitCode === null && !child.killed) child.kill('SIGKILL');
}

let app;
try {
  app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env: childEnv });
  console.log('[gallery] Electron launched');
  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
  await page.evaluate((version) => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    sessionStorage.setItem('nodus.startupUpdateChecked', '1');
    // Start from the widest gallery so the assertions below are not sensitive
    // to a persisted column count from another run.
    localStorage.setItem('nodus.db.galleryCols', '5');
  }, appVersion);
  await page.evaluate(async () => {
    await window.nodus.seedDatabasesDemoData();
    await window.nodus.updateSettings({
      onboardingComplete: true,
      basicsTutorialVersion: 5,
      recoverySetupVersion: 1,
      tourComplete: true,
      advancedTourComplete: true,
      databasesTourComplete: true,
      mascotEnabled: false,
      theme: 'light',
      uiLanguage: 'es',
    });
  });

  // A database big enough that mounting every card would be the bug.
  const created = await page.evaluate(async (count) => {
    const database = await window.nodus.createDatabase('Galería grande', null);
    const title = await window.nodus.createDatabaseColumn(database.id, 'Nombre', 'title');
    for (let index = 0; index < count; index += 1) {
      const row = await window.nodus.createDatabaseRow(database.id);
      await window.nodus.setDatabaseCell(row.id, title.id, `Ficha ${String(index).padStart(4, '0')}`);
    }
    return { id: database.id, title: title.id };
  }, ROW_COUNT);

  await page.reload();
  await page.getByTestId('app-shell').waitFor();
  await page.getByText('Galería grande', { exact: true }).first().click();
  await page.getByRole('button', { name: 'Galería', exact: true }).click();

  const cards = page.getByTestId('gallery-card');
  await cards.first().waitFor();
  console.log(`[gallery] Gallery open with ${ROW_COUNT} rows`);

  // --- 1. Only a viewport's worth of cards is mounted ----------------------
  const mounted = await cards.count();
  assert.ok(mounted > 0, 'the gallery must render cards');
  assert.ok(
    mounted < ROW_COUNT / 2,
    `gallery must virtualize: ${mounted} of ${ROW_COUNT} cards mounted`
  );
  console.log(`[gallery] Virtualized: ${mounted}/${ROW_COUNT} cards mounted`);

  // --- 2. The scroll range still covers every row -------------------------
  // A virtualizer that forgets the spacer would let the user scroll past only
  // the mounted cards, silently hiding most of the data.
  const scroller = page.locator('[data-testid="gallery-card"]').first().locator(
    'xpath=ancestor::div[contains(@style,"height") or @class][1]'
  );
  const metrics = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="gallery-card"]');
    let node = card?.parentElement ?? null;
    while (node && node.scrollHeight <= node.clientHeight) node = node.parentElement;
    return node ? { scrollHeight: node.scrollHeight, clientHeight: node.clientHeight } : null;
  });
  assert.ok(metrics, 'the gallery must have a scrollable ancestor');
  assert.ok(
    metrics.scrollHeight > metrics.clientHeight * 4,
    `scroll range must cover all rows (scrollHeight ${metrics.scrollHeight} vs viewport ${metrics.clientHeight})`
  );
  console.log(`[gallery] Scroll range ${metrics.scrollHeight}px over a ${metrics.clientHeight}px viewport`);

  // --- 3. Scrolling mounts different rows, and the last row is reachable ---
  const firstTitles = await cards.allInnerTexts();
  await page.evaluate(() => {
    const card = document.querySelector('[data-testid="gallery-card"]');
    let node = card?.parentElement ?? null;
    while (node && node.scrollHeight <= node.clientHeight) node = node.parentElement;
    if (node) node.scrollTop = node.scrollHeight;
  });
  await page.waitForFunction(
    (previous) => {
      const texts = [...document.querySelectorAll('[data-testid="gallery-card"]')].map((el) => el.innerText);
      return texts.length > 0 && texts[0] !== previous;
    },
    firstTitles[0]
  );
  const lastTitles = await cards.allInnerTexts();
  assert.notDeepEqual(firstTitles, lastTitles, 'scrolling must mount a different set of cards');
  assert.ok(
    lastTitles.some((text) => text.includes(`Ficha ${String(ROW_COUNT - 1).padStart(4, '0')}`)),
    `the final row must be reachable by scrolling (saw: ${lastTitles.slice(-3).join(' | ')})`
  );
  const mountedAtEnd = await cards.count();
  assert.ok(
    mountedAtEnd < ROW_COUNT / 2,
    `scrolling must not accumulate cards: ${mountedAtEnd} mounted at the end`
  );
  console.log(`[gallery] Reached the last row with ${mountedAtEnd} cards mounted`);

  // --- 4. Changing the column count keeps the grid coherent ---------------
  await page.getByTitle('La imagen se ajusta al cuadro (se ve completa)').click();
  const perRow = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="gallery-card"]');
    const grid = card?.parentElement;
    return grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0;
  });
  assert.equal(perRow, 5, `the grid must lay out 5 columns, got ${perRow}`);

  await page.screenshot({ path: path.join(screenshotDir, 'gallery-virtualized.png') });
  console.log(`Gallery virtualization verification passed. Screenshot: ${screenshotDir}`);
} finally {
  await closeElectronApp(app);
  await rm(userData, { recursive: true, force: true });
}
