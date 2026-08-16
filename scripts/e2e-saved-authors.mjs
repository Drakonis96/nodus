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

if (!process.argv.includes('--electron-saved-authors-e2e')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/e2e-saved-authors.mjs'), '--electron-saved-authors-e2e'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

if (!existsSync(path.join(repoRoot, 'dist-electron/main.js')) || !existsSync(path.join(repoRoot, 'dist/index.html'))) {
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
}

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-saved-authors-e2e-'));
let app;
try {
  const childEnv = {
    ...process.env,
    NODUS_USERDATA: userData,
    NODUS_DISABLE_AUTO_UPDATE: '1',
    NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1',
  };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    executablePath: require('electron'),
    args: [repoRoot],
    env: childEnv,
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await page.waitForLoadState('domcontentloaded');

  await page.evaluate(async (version) => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    localStorage.setItem('nodus.mobileTeaserSeen.3.2.4', '1');
    localStorage.setItem('nodus.platformHighlightsSeen.2026-07', '1');
    localStorage.setItem('nodus.toolkitBetaGuideSeen.2.4.0', '1');
    localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
    sessionStorage.setItem('nodus.startupUpdateChecked', '1');
    await window.nodus.updateSettings({
      uiLanguage: 'es',
      promptLanguage: 'es',
      onboardingComplete: true,
      basicsTutorialVersion: 5,
      recoverySetupVersion: 1,
      tourComplete: true,
      advancedTourComplete: true,
      mascotStyleChosen: true,
    });
    await window.nodus.seedDemoData();
  }, appVersion);
  await page.reload();
  await page.getByTestId('app-shell').waitFor();
  assert.equal(
    await page.evaluate(() => typeof window.nodus.setAuthorSaved),
    'function',
    'the saved-author bridge is exposed'
  );

  await page.locator('[data-tour="nav-authors"]').click();
  const cards = page.locator('[data-testid^="author-card-"]');
  await cards.first().waitFor();
  const firstCard = cards.first();
  const firstName = (await firstCard.getByTestId('author-name').innerText()).trim().split('\n')[0];
  const surname = (await firstCard.locator('button').nth(1).innerText()).trim();
  const authorName = `${firstName} ${surname}`.trim();
  const saveButton = firstCard.locator('[data-testid^="author-save-"]');
  assert.equal(await saveButton.getAttribute('aria-pressed'), 'false');
  await saveButton.click();
  assert.equal(await saveButton.getAttribute('aria-pressed'), 'true', 'the author card updates after saving');

  await page.getByRole('button', { name: 'Filtros', exact: true }).click();
  await page.getByTestId('authors-tab-saved').click();
  await cards.first().waitFor();
  assert.equal(`${(await cards.first().getByTestId('author-name').innerText()).trim().split('\n')[0]} ${(await cards.first().locator('button').nth(1).innerText()).trim()}`.trim(), authorName);
  assert.equal(await cards.count(), 1, 'the saved workspace only contains the saved author');

  const search = page.getByTestId('authors-search');
  await search.fill(authorName);
  await cards.first().waitFor();
  assert.equal(await cards.count(), 1, 'search finds the saved author');
  await search.fill('author who does not exist');
  await page.getByText('No hay autores guardados que coincidan con los filtros.', { exact: true }).waitFor();
  assert.equal(await cards.count(), 0, 'search never leaks unsaved authors');
  await search.fill('');
  await cards.first().waitFor();

  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-saved-authors-e2e.png'), fullPage: true });

  await page.reload();
  await page.getByTestId('app-shell').waitFor();
  await page.locator('[data-tour="nav-authors"]').click();
  await page.getByRole('button', { name: 'Filtros', exact: true }).click();
  await page.getByTestId('authors-tab-saved').click();
  await cards.first().waitFor();
  assert.equal(await cards.count(), 1, 'the saved author survives an app reload');

  await cards.first().getByTestId('author-name').click();
  const detailSave = page.getByTestId('author-detail-save');
  await detailSave.waitFor();
  assert.equal(await detailSave.getAttribute('aria-pressed'), 'true', 'the dossier header shares the saved state');
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-author-detail-e2e.png'), fullPage: true });
  await detailSave.click();
  await page.getByTestId('authors-tab-dossier').click();
  await page.getByText('No has guardado ningún autor todavía.', { exact: true }).waitFor();
  assert.equal(await cards.count(), 0, 'removing the dossier star updates the saved workspace immediately');
  assert.deepEqual(pageErrors, [], `renderer errors: ${pageErrors.map((error) => error.message).join(' | ')}`);

  console.log(`saved authors e2e passed for ${authorName}`);
} finally {
  if (app) await app.close().catch(() => undefined);
  await rm(userData, { recursive: true, force: true });
}
