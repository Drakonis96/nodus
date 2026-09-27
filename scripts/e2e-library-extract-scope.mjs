// End-to-end test for the scope of "Extraer ideas" in a vault's Library.
//
// One button, two scopes: with works selected it extracts Ideas from exactly those
// works; with nothing selected it extracts them from the whole filtered library, after
// a confirmation. This drives the real UI and records what reaches the real
// `works:processFullBulk` IPC handler, so the scope is the one the main process gets.
//
// Runs under the isolated research harness (OS boundary proven first, simulated provider).
// Requires a build (dist/ + dist-electron/); run via `node scripts/e2e-library-extract-scope.mjs`.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createResearchApp, simulatedUpstream } from './lib/research-app-harness.mjs';

const require = createRequire(import.meta.url);
const appVersion = require(path.join(import.meta.dirname, '../package.json')).version;
const WORKS = [];
const PROOFS = ['writeInsideAllowed', 'writeOutsideDenied', 'descendantWriteDenied', 'externalNetworkDenied', 'forbiddenLoopbackPortDenied'];

async function waitForCondition(label, probe, { timeout = 30_000, interval = 100 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await probe().catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(`Tiempo agotado esperando: ${label}.`);
}

// The isolated harness proves the OS boundary before the app starts; no model is called.
const harness = await createResearchApp({ provider: simulatedUpstream() });
assert.ok(PROOFS.every((key) => harness.proof[key] === true), `isolation proof failed: ${JSON.stringify(harness.proof)}`);
try {
  const { app, page } = await harness.launch();
  page.setDefaultTimeout(30_000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await page.evaluate((version) => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    for (const key of [`nodus.mobileTeaserSeen.${version}`, 'nodus.pdfPresenterTutorialSeen.e2js_u-05OA', 'nodus.tutorialVideosAnnouncementSeen.2026-07',
      'nodus.libraryTutorialSeen.v1', 'nodus.platformHighlightsSeen.2026-07', 'nodus.toolkitBetaGuideSeen.2.4.0']) localStorage.setItem(key, '1');
  }, appVersion);
  await page.evaluate(() => window.nodus.setResearchPreparationPolicy({ welcomeVersion: 1, decision: 'declined' }));

  // ── Three works in the vault, through the real Global Library → vault link ───
  const workIds = await page.evaluate(async ({ root, titles }) => {
    await window.nodus.updateSettings({ autoBackupFolder: `${root}/library` });
    const vault = await window.nodus.getActiveVault();
    const ids = [];
    for (const title of titles) ids.push((await window.nodus.createGlobalLibraryItem({ title, itemType: 'book', creators: [] }, [])).id);
    const report = await window.nodus.linkGlobalLibraryItemsToVault(ids, vault.id);
    return report.links.map((link) => link.workId);
  }, { root: harness.root, titles: ['Obra 1', 'Obra 2', 'Obra 3'] });
  assert.equal(workIds.length, 3);
  WORKS.splice(0, WORKS.length, ...workIds);
  await page.evaluate(() => window.nodus.updateSettings({
    onboardingComplete: true, recoverySetupVersion: 1, tourComplete: true, advancedTourComplete: true,
    basicsTutorialVersion: 5, mascotStyle: 'classic', mascotStyleChosen: true, uiLanguage: 'es',
  }));
  await page.reload();
  await page.getByTestId('app-shell').waitFor({ timeout: 30_000 });

  // Record what the real handler receives, without running any model.
  await app.evaluate(({ ipcMain }) => {
    globalThis.extractCalls = [];
    ipcMain.removeHandler('works:processFullBulk');
    ipcMain.handle('works:processFullBulk', (_event, ids, _model, options) => { globalThis.extractCalls.push({ ids: [...ids].sort(), mode: options?.mode ?? null }); });
  });
  const calls = () => app.evaluate(() => globalThis.extractCalls);

  await page.locator('[data-tour="nav-library"]').click();
  for (const id of WORKS) await page.getByTestId(`vault-library-item-${id}`).waitFor({ timeout: 30_000 });
  const extract = page.getByTestId('library-extract-ideas');
  assert.equal(await extract.getAttribute('data-scope'), 'library');
  assert.equal(await page.getByTestId('library-delete-selected').count(), 0, 'no selection, no selection actions');
  assert.equal(await page.getByText('seleccionadas', { exact: false }).count(), 0, 'the old selection ribbon is gone');

  // ── Two selected: exactly those two, and nothing else ───────────────────────
  for (const id of [WORKS[0], WORKS[2]]) await page.locator(`[data-testid="vault-library-item-${id}"] input[type="checkbox"]`).click();
  assert.equal(await extract.getAttribute('data-scope'), 'selection');
  assert.match(await extract.innerText(), /Extraer ideas[\s\S]*2/, 'the button says how many works it will extract');
  for (const id of ['library-delete-selected', 'library-clear-selection']) await page.getByTestId(id).waitFor();
  assert.equal(await page.getByTestId('library-prepare-sources').getAttribute('data-scope'), 'selection');
  await extract.click();
  await waitForCondition('la extracción de la selección llega al proceso principal', async () => (await calls()).length === 1);
  assert.deepEqual((await calls())[0].ids, [WORKS[0], WORKS[2]].sort(), 'only the selected works are extracted');
  assert.equal((await calls())[0].mode, 'if-stale');
  await waitForCondition('la selección se limpia tras encolar', async () => (await extract.getAttribute('data-scope')) === 'library');

  // ── Nothing selected: the whole filtered library, after confirming ──────────
  await extract.click();
  const dialog = page.locator('[role="dialog"][aria-modal="true"]');
  await dialog.waitFor({ timeout: 10_000 });
  assert.match(await dialog.innerText(), /3 obra/);
  assert.equal((await calls()).length, 1, 'nothing is queued before the confirmation');
  await dialog.getByRole('button', { name: 'Continuar', exact: true }).click();
  await waitForCondition('la extracción de toda la biblioteca llega al proceso principal', async () => (await calls()).length === 2);
  assert.deepEqual((await calls())[1].ids, [...WORKS].sort(), 'with nothing selected every filtered work is extracted');

  // ── Clearing a selection returns the button to the whole library ────────────
  await page.locator(`[data-testid="vault-library-item-${WORKS[1]}"] input[type="checkbox"]`).click();
  assert.equal(await extract.getAttribute('data-scope'), 'selection');
  await page.getByTestId('library-clear-selection').click();
  assert.equal(await extract.getAttribute('data-scope'), 'library');
  assert.equal(await page.getByTestId('library-delete-selected').count(), 0);

  assert.deepEqual(pageErrors, [], `the renderer logged no page errors: ${pageErrors.map((error) => error.message).join(' | ')}`);
  console.log('e2e library extract scope passed');
} finally {
  await harness.close();
}
