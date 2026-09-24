// End-to-end test for the scope of "Extraer ideas" in a vault's Library.
//
// One button, two scopes: with works selected it extracts Ideas from exactly those
// works; with nothing selected it extracts them from the whole filtered library, after
// a confirmation. This drives the real UI and records what reaches the real
// `works:processFullBulk` IPC handler, so the scope is the one the main process gets.
//
// Requires a build (dist/ + dist-electron/); run via `node scripts/e2e-library-extract-scope.mjs`.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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

if (!process.argv.includes('--electron-library-extract-scope')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [fileURLToPath(import.meta.url), '--electron-library-extract-scope'], {
    cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  });
  process.exit(0);
}
if (!existsSync(path.join(repoRoot, 'dist-electron/main.js'))) {
  console.log('[e2e] no build found — running npm run build first…');
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
}

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-e2e-extract-scope-'));
const WORKS = ['e2e-extract-a', 'e2e-extract-b', 'e2e-extract-c'];

async function waitForCondition(label, probe, { timeout = 30_000, interval = 100 } = {}) {
  const deadline = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      if (await probe()) return;
      lastError = null;
    } catch (cause) { lastError = cause; }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(`Tiempo agotado esperando: ${label}.${lastError instanceof Error ? ` Último error: ${lastError.message}` : ''}`);
}

const Database = require('better-sqlite3');
let app = null;
let external = null;
try {
  const childEnv = { ...process.env, NODUS_USERDATA: userData, NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available' };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env: childEnv });

  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !!document.getElementById('root')?.children.length, { timeout: 30_000 });
  await page.evaluate((version) => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    localStorage.setItem(`nodus.mobileTeaserSeen.${version}`, '1');
    // Two announcements introduce themselves over the shell on a profile that has not
    // seen them (keys live in PdfPresenterTutorialAnnouncement / TutorialVideosGuide).
    // This test is about the Library, not about dismissing those.
    localStorage.setItem('nodus.pdfPresenterTutorialSeen.e2js_u-05OA', '1');
    localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
    // The Library presents its own guide the first time it is opened.
    localStorage.setItem('nodus.libraryTutorialSeen.v1', '1');
  }, appVersion);

  // ── A vault with three works that have not been analysed ────────────────────
  const { vault } = await page.evaluate(async () => {
    const created = await window.nodus.createVault({ name: 'E2E extract scope', type: 'academic' });
    const switched = await window.nodus.switchVault(created.vault.id);
    if (!switched.ok) throw new Error(switched.message);
    return created;
  });
  external = new Database(vault.path);
  const insert = external.prepare(`INSERT INTO works(nodus_id,zotero_key,title,authors_json,year,item_type,source_type,archived)
    VALUES(?,?,?,?,?,?,?,0)`);
  WORKS.forEach((id, index) => insert.run(id, `Z-${index}`, `Obra ${index + 1}`, '[]', 2024, 'book', 'pdf'));
  external.close();
  external = null;
  await page.evaluate(() => window.nodus.updateSettings({
    onboardingComplete: true, recoverySetupVersion: 1, tourComplete: true, advancedTourComplete: true,
    basicsTutorialVersion: 5, mascotStyle: 'classic', mascotStyleChosen: true, uiLanguage: 'es',
  }));
  await page.reload();
  await page.getByTestId('app-shell').waitFor({ timeout: 30_000 });
  const startupUpdate = page.getByTestId('startup-update-modal');
  await startupUpdate.waitFor({ timeout: 30_000 }).catch(() => undefined);
  if (await startupUpdate.count()) {
    await startupUpdate.getByRole('button', { name: 'Entendido', exact: false }).click();
    await startupUpdate.waitFor({ state: 'detached' });
  }

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
  try { external?.close(); } catch { /* already closed */ }
  if (app) await app.close().catch(() => undefined);
  await rm(userData, { recursive: true, force: true });
}
