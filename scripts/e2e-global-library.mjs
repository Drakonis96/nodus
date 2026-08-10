import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const testRoot = await mkdtemp(path.join(os.tmpdir(), 'nodus-global-library-ui-'));
const userData = path.join(testRoot, 'profile');
const backupRoot = path.join(testRoot, 'backups');
const screenshotPath = path.join(os.tmpdir(), 'nodus-global-library-e2e.png');
const itemId = 'zotero:E7FGXJFE';
const storageId = 'E7FGXJFE';
const childEnv = {
  ...process.env,
  NODUS_USERDATA: userData,
  NODUS_DISABLE_AUTO_UPDATE: '1',
  NODUS_E2E_UPDATE_STATUS: 'not-available',
  NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1',
};
delete childEnv.ELECTRON_RUN_AS_NODE;

let app;
async function closeElectronApp(instance) {
  if (!instance) return;
  const child = instance.process();
  let timer;
  const closed = instance.close().then(() => true, () => false);
  const clean = await Promise.race([closed, new Promise((resolve) => { timer = setTimeout(() => resolve(false), 5_000); })]);
  clearTimeout(timer);
  if (!clean && child.exitCode === null && !child.killed) child.kill('SIGKILL');
}

try {
  app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env: childEnv });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  await page.setViewportSize({ width: 1540, height: 940 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));

  const collections = await page.evaluate(async ({ version, backup }) => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    localStorage.setItem('nodus.mobileTeaserSeen.3.2.4', '1');
    localStorage.setItem('nodus.platformHighlightsSeen.2026-07', '1');
    localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
    localStorage.setItem('nodus.toolkitBetaGuideSeen.2.4.0', '1');
    await window.nodus.updateSettings({
      onboardingComplete: true, basicsTutorialVersion: 999, recoverySetupVersion: 999,
      tourComplete: true, advancedTourComplete: true, uiLanguage: 'es', mascotStyle: 'orb',
      mascotStyleChosen: true, mascotEnabled: false, reduceMotion: true, autoBackupFolder: backup,
    });
    await window.nodus.getGlobalLibraryStatus();
    const root = await window.nodus.createGlobalLibraryCollection('Historia contemporánea', null);
    const child = await window.nodus.createGlobalLibraryCollection('Mujeres y posguerra', root.id);
    return { root, child };
  }, { version: require(path.join(repoRoot, 'package.json')).version, backup: backupRoot });
  console.log('[global-library-e2e] profile and nested collections ready');

  const itemFolder = path.join(backupRoot, 'nodus-library', storageId);
  const now = new Date().toISOString();
  const markdown = '# Mujeres solas en la posguerra\n\n## Introducción\n\nTexto limpio de una fuente histórica.\n';
  await mkdir(itemFolder, { recursive: true });
  await writeFile(path.join(itemFolder, 'reader.md'), markdown, 'utf8');
  await writeFile(path.join(itemFolder, 'original.md'), markdown, 'utf8');
  await writeFile(path.join(itemFolder, 'annotations.json'), '[]\n', 'utf8');
  await writeFile(path.join(itemFolder, 'metadata.json'), `${JSON.stringify({
    format: 'nodus.library-item', formatVersion: 1, id: itemId, storageId,
    source: 'zotero', sourceLibraryId: 'users/0', sourceKey: storageId,
    metadata: {
      title: 'Mujeres solas en la posguerra', itemType: 'article-journal',
      creators: [{ creatorType: 'author', firstName: 'María', lastName: 'Aliaga' }],
      date: '2017', year: 2017, publicationTitle: 'Arenal', doi: '10.0000/nodus.fixture',
      isbn: [], issn: ['1134-6396'], tags: ['mujeres', 'posguerra'],
      abstract: 'Resumen de prueba para comprobar el panel de metadatos.',
    },
    collectionIds: [collections.child.id],
    attachments: [{
      id: 'zotero:ATTACHMENT', title: 'Texto completo', fileName: 'original.md',
      relativePath: 'original.md', mimeType: 'text/markdown', byteSize: Buffer.byteLength(markdown),
      sha256: 'a'.repeat(64), role: 'original',
    }],
    files: { original: 'original.md', reader: 'reader.md', annotations: 'annotations.json' },
    extraction: { status: 'ready', engineVersion: 'e2e', completedAt: now },
    createdAt: now, deletedAt: null,
    clock: { deviceId: 'e2e-device-0001', revision: 1, baseRevision: 0, updatedAt: now, contentHash: 'b'.repeat(64) },
  }, null, 2)}\n`, 'utf8');

  await page.evaluate(() => window.nodus.rebuildGlobalLibrary());
  console.log('[global-library-e2e] fixture catalog rebuilt');
  await page.reload();
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
  const updateModal = page.getByTestId('startup-update-modal');
  if (await updateModal.count()) {
    await page.waitForFunction(() => document.querySelector('[data-testid="startup-update-modal"]')?.getAttribute('data-update-status') === 'not-available');
    await updateModal.getByRole('button', { name: 'Entendido', exact: false }).click();
    await updateModal.waitFor({ state: 'detached' });
  }

  await page.locator('[data-tour="nav-library"]').click();
  const scopeSwitcher = page.getByTestId('library-scope-switcher');
  await scopeSwitcher.waitFor({ state: 'visible' });
  assert.equal(await page.getByTestId('library-scope-vault').getAttribute('aria-pressed'), 'true', 'a v3-style profile starts in the unchanged vault corpus');
  await page.getByRole('button', { name: 'Colecciones de Zotero', exact: true }).waitFor();
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-scope-vault-dark-wide.png'), fullPage: true });
  await page.getByTestId('library-scope-global').click();
  const library = page.getByTestId('global-library-view');
  await library.waitFor({ state: 'visible' });
  assert.equal(await page.getByTestId('library-scope-global').getAttribute('aria-pressed'), 'true');
  const scopeSettings = await page.evaluate(() => window.nodus.getSettings());
  assert.equal(scopeSettings.libraryGlobalEnabled, true, 'global activation is opt-in');
  assert.equal(scopeSettings.libraryScope, 'global', 'the chosen scope is remembered');
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-scope-global-dark-wide.png'), fullPage: true });
  await page.evaluate(() => {
    document.documentElement.classList.add('light');
    document.documentElement.classList.remove('dark');
  });
  await page.setViewportSize({ width: 760, height: 900 });
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-scope-global-light-narrow.png'), fullPage: true });
  await page.getByTestId('library-scope-vault').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="library-scope-shell"]')?.getAttribute('data-library-scope') === 'vault');
  await page.evaluate(() => {
    document.documentElement.classList.add('light');
    document.documentElement.classList.remove('dark');
  });
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-scope-vault-light-narrow.png'), fullPage: true });
  await page.getByTestId('library-scope-global').click();
  await library.waitFor({ state: 'visible' });
  await page.evaluate(() => {
    document.documentElement.classList.add('dark');
    document.documentElement.classList.remove('light');
  });
  await page.setViewportSize({ width: 1540, height: 940 });
  await page.reload();
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
  await page.locator('[data-tour="nav-library"]').click();
  await page.getByTestId('global-library-view').waitFor({ state: 'visible' });
  assert.equal(await page.getByTestId('library-scope-global').getAttribute('aria-pressed'), 'true', 'Global remains selected after a renderer restart');
  console.log('[global-library-e2e] global Library visible');
  await page.getByTestId('open-library-migration').click();
  const migrationDialog = page.getByTestId('library-migration-dialog');
  await migrationDialog.waitFor({ state: 'visible' });
  await migrationDialog.getByText('Creando inventario de solo lectura…').waitFor({ state: 'detached' });
  assert.ok(await migrationDialog.locator('input[type="checkbox"]:checked').count(), 'academic vaults are selected by default');
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-migration-preview-dark-wide.png'), fullPage: true });
  await page.evaluate(() => { document.documentElement.classList.add('light'); document.documentElement.classList.remove('dark'); });
  await page.setViewportSize({ width: 760, height: 900 });
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-migration-preview-light-narrow.png'), fullPage: true });
  await page.evaluate(() => { document.documentElement.classList.add('dark'); document.documentElement.classList.remove('light'); });
  await page.setViewportSize({ width: 1540, height: 940 });
  await page.getByTestId('start-library-migration').click();
  await migrationDialog.getByText('Migración verificada', { exact: true }).waitFor();
  const migrationSessions = await page.evaluate(() => window.nodus.listLibraryMigrationSessions());
  assert.equal(migrationSessions[0]?.status, 'completed');
  assert.equal(Object.values(migrationSessions[0]?.verification ?? {}).filter((value) => value === false).length, 0);
  await migrationDialog.getByRole('button', { name: 'Cerrar', exact: true }).last().click();
  await migrationDialog.waitFor({ state: 'detached' });
  await page.getByText('Historia contemporánea', { exact: true }).waitFor();
  await page.getByText('Mujeres y posguerra', { exact: true }).click();
  const row = page.getByTestId(`global-library-item-${itemId}`);
  await row.waitFor({ state: 'visible' });
  assert.match(await row.innerText(), /Mujeres solas en la posguerra/);
  assert.match(await row.innerText(), /María Aliaga/);

  await row.getByRole('button').click();
  const detail = page.getByTestId('global-library-detail');
  await detail.waitFor({ state: 'visible' });
  console.log('[global-library-e2e] metadata detail visible');
  assert.match(await detail.innerText(), /10\.0000\/nodus\.fixture/);
  assert.match(await detail.innerText(), /1134-6396/);
  assert.match(await detail.innerText(), /Markdown disponible/);

  await page.getByTestId('add-library-item-to-vault').click();
  const vaultDialog = page.getByTestId('global-library-vault-dialog');
  await vaultDialog.waitFor({ state: 'visible' });
  await page.getByTestId('confirm-global-library-vault-link').click();
  await vaultDialog.waitFor({ state: 'detached' });
  const reuseBadges = detail.locator('[data-testid^="vault-reuse-"]');
  await reuseBadges.waitFor({ state: 'visible' });
  assert.equal(await reuseBadges.locator('span[title]').count(), 6, 'every reusable component exposes state and cause');
  await reuseBadges.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-library-reuse-status-dark-wide.png'), fullPage: true });

  await page.getByTestId('edit-library-metadata').click();
  const metadataEditor = page.getByTestId('library-metadata-editor');
  await metadataEditor.waitFor({ state: 'visible' });
  await metadataEditor.getByLabel('Editorial', { exact: true }).fill('Editorial corregida en Nodus');
  await metadataEditor.getByRole('button', { name: 'Guardar metadatos' }).click();
  await metadataEditor.waitFor({ state: 'detached' });
  await page.getByText('Editorial corregida en Nodus', { exact: true }).waitFor();
  assert.equal((await page.evaluate((id) => window.nodus.getGlobalLibraryItem(id), itemId)).metadata.publisher, 'Editorial corregida en Nodus');
  console.log('[global-library-e2e] local metadata correction persisted');

  await page.getByTestId('open-library-duplicates').click();
  const duplicatesDialog = page.getByTestId('library-duplicates-dialog');
  await duplicatesDialog.waitFor({ state: 'visible' });
  await duplicatesDialog.getByText('No se han detectado duplicados.').waitFor();
  await duplicatesDialog.getByRole('button').first().click();
  await duplicatesDialog.waitFor({ state: 'detached' });

  await row.locator('input[type="checkbox"]').check();
  await page.getByTestId('global-library-bulk-actions').waitFor({ state: 'visible' });
  await page.getByTestId('global-library-search').fill('resultado inexistente');
  await page.waitForTimeout(350);
  await row.waitFor({ state: 'detached' });
  await page.getByTestId('global-library-search').fill('Mujeres');
  await page.waitForTimeout(350);
  await page.getByTestId(`global-library-item-${itemId}`).waitFor({ state: 'visible' });

  await page.getByTestId('open-zotero-global-import').click();
  await page.getByTestId('zotero-global-import-dialog').waitFor({ state: 'visible' });
  assert.match(await page.getByTestId('zotero-global-import-dialog').innerText(), /solo lectura/);
  await page.keyboard.press('Escape');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  assert.deepEqual(pageErrors, [], pageErrors.map((error) => error.stack ?? String(error)).join('\n'));
  console.log(`global Library UI test passed; screenshot: ${screenshotPath}`);
} finally {
  await closeElectronApp(app);
  await rm(testRoot, { recursive: true, force: true });
}
