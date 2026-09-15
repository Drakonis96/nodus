// Visual verification for the Library's selection-bar actions.
//
// Boots the built app against a throwaway profile, puts four works in an academic vault
// (one analysed, one untouched, one half-analysed, one failed) and selects all of them,
// which is the state both new actions are designed around: "Retry what is missing" is
// offered only while some selected work has something left to finish, and "Delete
// selection" only while there is a selection.
//
// It asserts the parts a screenshot alone cannot prove — the retry count, the computed
// red of the destructive action, the wording of the confirmation — and writes the
// screenshots into docs/verification/library-selection-actions/ for the pull request.
//
// Run with a build in place: `node scripts/verify-library-selection-actions.mjs`.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const appVersion = require(path.join(repoRoot, 'package.json')).version;
const output = path.join(repoRoot, 'docs/verification/library-selection-actions');

if (!process.argv.includes('--electron-verify-selection-actions')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [fileURLToPath(import.meta.url), '--electron-verify-selection-actions'], {
    cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  });
  process.exit(0);
}
if (!existsSync(path.join(repoRoot, 'dist-electron/main.js'))) {
  console.log('[verify] no build found — running npm run build first…');
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
}
mkdirSync(output, { recursive: true });

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-verify-selection-actions-'));
const Database = require('better-sqlite3');
let app = null;
let external = null;

// Four works, four states: the bar counts the works with something left, not the rows.
const WORKS = [
  { id: 'va-1', key: 'ZVA1', title: 'Folclore e identidad en el franquismo: algunos apuntes sobre el caso español', author: 'Llorente Aucejo, Z.', year: 2025, light: 'done', deep: 'done', summary: 'done' },
  { id: 'va-2', key: 'ZVA2', title: 'Introducción. Movilidad y cultura material en España (siglos XIX y XX)', author: 'Fuentes Vega, A.', year: 2025, light: 'none', deep: 'none', summary: 'none' },
  { id: 'va-3', key: 'ZVA3', title: 'La imagen de España a través de sus carteles turísticos', author: 'Villaverde Izquierdo, J.', year: 2025, light: 'done', deep: 'none', summary: 'none' },
  { id: 'va-4', key: 'ZVA4', title: '«Vaya usted con Dio-o-o-ol»: mediadores de hospitalidad y asimetría', author: 'Galant, I.', year: 2025, light: 'failed', deep: 'none', summary: 'none' },
];

try {
  const childEnv = { ...process.env, NODUS_USERDATA: userData, NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available' };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env: childEnv });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !!document.getElementById('root')?.children.length, { timeout: 30_000 });
  // Every one-time announcement is suppressed by the key its own component owns, so what
  // is captured is the Library and nothing else.
  await page.evaluate((version) => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    localStorage.setItem(`nodus.mobileTeaserSeen.${version}`, '1');
    localStorage.setItem('nodus.pdfPresenterTutorialSeen.e2js_u-05OA', '1');
    localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
    localStorage.setItem('nodus.libraryTutorialSeen.v1', '1');
  }, appVersion);

  const { vault } = await page.evaluate(async () => {
    const created = await window.nodus.createVault({ name: 'Selection actions', type: 'academic' });
    const switched = await window.nodus.switchVault(created.vault.id);
    if (!switched.ok) throw new Error(switched.message);
    return created;
  });
  assert.ok(vault?.path, 'the created vault reports its database file');

  external = new Database(vault.path);
  const insert = external.prepare(`INSERT INTO works(
    nodus_id,zotero_key,title,authors_json,year,item_type,source_type,archived,
    light_status,deep_status,summary_status
  ) VALUES(?,?,?,?,?,?,'pdf',0,?,?,?)`);
  for (const work of WORKS) {
    insert.run(work.id, work.key, work.title, JSON.stringify([work.author]), work.year, 'journalArticle', work.light, work.deep, work.summary);
  }
  external.close();
  external = null;

  await page.evaluate(() => window.nodus.updateSettings({
    onboardingComplete: true, recoverySetupVersion: 1, tourComplete: true, advancedTourComplete: true,
    basicsTutorialVersion: 5, mascotStyle: 'classic', mascotStyleChosen: true, uiLanguage: 'es', theme: 'light',
  }));
  await page.reload();
  await page.getByTestId('app-shell').waitFor({ timeout: 30_000 });
  const startupUpdate = page.getByTestId('startup-update-modal');
  await startupUpdate.waitFor({ timeout: 20_000 }).catch(() => undefined);
  if (await startupUpdate.count()) {
    await startupUpdate.getByRole('button', { name: 'Entendido', exact: false }).click();
    await startupUpdate.waitFor({ state: 'detached' });
  }

  await page.locator('[data-tour="nav-library"]').click();
  await page.getByTestId(`vault-library-item-${WORKS[0].id}`).waitFor({ timeout: 30_000 });

  // With nothing selected, neither action is offered.
  assert.equal(await page.getByTestId('library-retry-missing-selected').count(), 0);
  assert.equal(await page.getByTestId('library-delete-selected').count(), 0);

  for (const work of WORKS) {
    await page.locator(`[data-testid="vault-library-item-${work.id}"] input[type="checkbox"]`).click();
  }
  const retryButton = page.getByTestId('library-retry-missing-selected');
  const deleteButton = page.getByTestId('library-delete-selected');
  await deleteButton.waitFor({ timeout: 10_000 });

  assert.match(await retryButton.innerText(), /Reintentar lo que falta\s*·\s*4 obra\(s\)/,
    'the repair action counts the selected works that have something left to finish');
  assert.equal(await deleteButton.innerText(), 'Eliminar selección');
  assert.equal(
    await deleteButton.evaluate((node) => getComputedStyle(node).backgroundColor), 'rgb(220, 38, 38)',
    'the destructive action is painted red in the running theme'
  );
  const bar = page.locator('div.mb-3.rounded-lg.border-indigo-800\\/70').first();
  const shot = async (name, locator = bar) => {
    await locator.screenshot({ path: path.join(output, `${name}.png`) });
    console.log(`[verify] ${name}.png`);
  };

  await shot('bar-light');
  await page.screenshot({ path: path.join(output, 'window-light.png') });

  // The confirmation, in light mode. Cancelled: this script never deletes anything.
  await deleteButton.click();
  const dialog = page.locator('[role="dialog"][aria-modal="true"]');
  await dialog.waitFor({ timeout: 10_000 });
  const dialogText = await dialog.innerText();
  assert.match(dialogText, /Eliminar las 4 obras seleccionadas/);
  assert.match(dialogText, /ideas extraídas, sus pasajes, sus embeddings/);
  assert.match(dialogText, /que compartan con otras obras se conservan/);
  assert.match(dialogText, /no se puede deshacer/);
  await shot('confirm-light', dialog);
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });

  await page.evaluate(() => window.nodus.updateSettings({ theme: 'dark' }));
  await page.waitForTimeout(600);
  await shot('bar-dark');
  await page.screenshot({ path: path.join(output, 'window-dark.png') });
  await deleteButton.click();
  await dialog.waitFor({ timeout: 10_000 });
  await shot('confirm-dark', dialog);
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });

  // Nothing was deleted, so the vault still holds its four works.
  const remaining = await page.evaluate(async () => (await window.nodus.listWorks()).length);
  assert.equal(remaining, 4, 'the verification cancels the confirmation and deletes nothing');
  assert.deepEqual(pageErrors, [], `the renderer logged no page errors: ${pageErrors.join(' | ')}`);
  console.log(`[verify] library selection actions ok -> ${path.relative(repoRoot, output)}`);
} finally {
  try { external?.close(); } catch { /* already closed */ }
  if (app) await app.close().catch(() => undefined);
  await rm(userData, { recursive: true, force: true });
}
