// Visual smoke check for the Primary Sources Home, Search and Archive surfaces.
// Uses a throwaway profile so it never opens or mutates a real vault.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const appVersion = require(path.join(repoRoot, 'package.json')).version;
const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-primary-sources-ui-'));
const outputDir = process.env.NODUS_UI_SCREENSHOT_DIR || os.tmpdir();
const childEnv = {
  ...process.env,
  NODUS_USERDATA: userData,
  NODUS_DISABLE_AUTO_UPDATE: '1',
};
delete childEnv.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({
  executablePath: require('electron'),
  args: [repoRoot],
  env: childEnv,
});

try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  page.on('pageerror', (error) => console.error('[primary-sources-ui][pageerror]', error));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
  await page.evaluate((version) => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    localStorage.setItem('nodus.platformHighlightsSeen.2026-07', '1');
    localStorage.setItem('nodus.toolkitBetaGuideSeen.2.4.0', '1');
    localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
    localStorage.setItem('nodus.websiteLaunchSeen.2026-08', '1');
    localStorage.setItem(`nodus.mobileTeaserSeen.${version}`, '1');
  }, appVersion);
  await page.evaluate(async () => {
    const created = await window.nodus.createVault({
      name: 'Primary Sources visual check',
      type: 'primary_sources',
    });
    const switched = await window.nodus.switchVault(created.vault.id);
    if (!switched.ok) throw new Error(switched.message);
    await window.nodus.updateSettings({
      onboardingComplete: true,
      basicsTutorialVersion: 5,
      recoverySetupVersion: 1,
      tourComplete: true,
      advancedTourComplete: true,
      primarySourcesTourComplete: true,
      theme: 'light',
      mascotEnabled: false,
      mascotStyleChosen: true,
    });
  });
  await page.reload();
  const whatsNew = page.getByTestId('whats-new-cinematic-modal');
  if (await whatsNew.isVisible().catch(() => false)) {
    await whatsNew.getByRole('button', { name: 'Cerrar', exact: true }).click();
  }
  await page.waitForTimeout(1_000);
  if (await page.getByTestId('primary-sources-home').count() === 0) {
    throw new Error(`Primary Sources home did not mount. Visible UI: ${(await page.locator('body').innerText()).slice(0, 1_200)}`);
  }
  await page.getByTestId('primary-sources-home').waitFor();
  const startupUpdate = page.getByTestId('startup-update-modal');
  if (await startupUpdate.isVisible().catch(() => false)) {
    await startupUpdate.getByRole('button', { name: 'Cerrar', exact: true }).click();
  }

  const demoOffer = page.getByTestId('primary-sources-demo-offer');
  await demoOffer.waitFor();
  await page.getByRole('button', { name: 'Cargar demo de fuentes primarias', exact: true }).waitFor();
  const demoColors = await demoOffer.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, border: style.borderColor };
  });
  assert.notEqual(demoColors.background, 'rgba(0, 0, 0, 0)', 'the shared demo card has a visible light surface');
  await page.screenshot({ path: path.join(outputDir, 'primary-sources-home.png') });

  await page.getByRole('button', { name: 'Buscar', exact: true }).first().click();
  const search = page.getByTestId('primary-sources-search');
  await search.waitFor();
  assert.equal(await search.locator('aside').count(), 0, 'search does not render a filter sidebar');

  const input = page.getByTestId('primary-sources-search-input');
  const inputGeometry = await input.evaluate((element) => {
    const inputRect = element.getBoundingClientRect();
    const icon = element.previousElementSibling;
    const iconRect = icon?.getBoundingClientRect();
    return {
      paddingLeft: Number.parseFloat(getComputedStyle(element).paddingLeft),
      inputLeft: inputRect.left,
      iconRight: iconRect?.right ?? inputRect.left,
    };
  });
  assert.ok(inputGeometry.paddingLeft >= 30, `search input reserves icon space (${inputGeometry.paddingLeft}px)`);
  assert.ok(
    inputGeometry.iconRight <= inputGeometry.inputLeft + inputGeometry.paddingLeft,
    'search icon finishes before the text content begins'
  );

  await page.getByTestId('primary-sources-search-filter-toggle').click();
  await page.getByTestId('primary-sources-search-filters').waitFor();
  await page.getByLabel('Desde', { exact: true }).fill('1850');
  await page.getByTestId('primary-sources-search-active-filters').waitFor();
  await page.screenshot({ path: path.join(outputDir, 'primary-sources-search-filters.png') });

  const seeded = await page.evaluate(() => window.nodus.seedPrimarySourcesDemoData());
  assert.equal(seeded, true, 'the isolated vault receives the fictional document corpus');
  await page.locator('[data-tour="nav-archive"]').click();
  const archive = page.getByTestId('primary-sources-archive');
  const sidebar = page.getByTestId('primary-sources-archive-sidebar');
  await archive.waitFor();
  await sidebar.waitFor();
  const grid = page.getByTestId('primary-sources-archive-grid');
  await grid.waitFor();
  const rows = page.locator('[data-testid^="primary-source-archive-row-"]');
  await rows.first().waitFor();
  assert.ok(await rows.count() >= 8, 'the database view exposes the complete demo catalogue');
  const thumbnails = page.locator('[data-testid^="primary-source-thumbnail-"]');
  await thumbnails.first().waitFor();
  assert.ok(await thumbnails.count() >= 1, 'image documents render a thumbnail in the database row');
  const openSidebarWidth = await sidebar.evaluate((element) => element.getBoundingClientRect().width);
  assert.ok(openSidebarWidth >= 270, `archive sidebar is visibly open (${openSidebarWidth}px)`);
  await page.screenshot({ path: path.join(outputDir, 'primary-sources-archive-catalog.png') });

  await rows.first().click();
  const dossierModal = page.getByTestId('primary-source-dossier-modal');
  await dossierModal.waitFor();
  await archive.waitFor();
  assert.ok(await archive.isVisible(), 'the Archive remains visible behind the document modal');
  await dossierModal.getByRole('button', { name: 'Cerrar ficha', exact: true }).waitFor();
  await page.screenshot({ path: path.join(outputDir, 'primary-source-document-modal-source.png') });

  await dossierModal.getByRole('tab', { name: 'Descripción', exact: true }).click();
  const descriptionForm = dossierModal.getByTestId('primary-source-description-form');
  await descriptionForm.waitFor();
  await descriptionForm.getByTestId('primary-source-document-icon-picker').waitFor();
  const provenanceSelect = descriptionForm.getByTestId('primary-source-provenance-place-select');
  await provenanceSelect.waitFor();
  assert.notEqual(
    await provenanceSelect.inputValue(),
    '',
    'every demo source exposes its selected place of provenance in the document record',
  );
  assert.ok(
    await provenanceSelect.locator('option').count() >= 4,
    'the dropdown is connected to the shared geographic catalogue',
  );
  assert.ok(
    await descriptionForm.getByText('Usa el mismo catálogo documental que el Archivo de Genealogía.', { exact: true }).isVisible(),
    'the modal uses the shared Genealogy document catalogue'
  );
  await page.screenshot({ path: path.join(outputDir, 'primary-source-document-modal-description.png') });

  await descriptionForm.getByTestId('document-type-picker-trigger').click();
  const typePopover = page.getByTestId('document-type-picker-popover');
  await typePopover.waitFor();
  assert.equal(await typePopover.evaluate((element) => getComputedStyle(element).zIndex), '201');
  await page.keyboard.press('Escape');
  await descriptionForm.getByTestId('primary-source-document-icon-picker').click();
  await page.getByRole('dialog', { name: 'Seleccionar icono', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Cerrar', exact: true }).last().click();
  await dossierModal.getByRole('button', { name: 'Cerrar ficha', exact: true }).click();
  await dossierModal.waitFor({ state: 'detached' });

  await page.getByTestId('primary-sources-archive-sidebar-toggle').click();
  assert.equal(await sidebar.count(), 0, 'archive sidebar is removed from the layout when collapsed');
  const revealSidebar = page.getByTestId('primary-sources-archive-sidebar-toggle');
  await revealSidebar.waitFor();
  assert.equal(await revealSidebar.getAttribute('aria-label'), 'Mostrar panel lateral');
  assert.equal(
    await page.evaluate(() => sessionStorage.getItem('nodus.primarySources.archiveSidebarCollapsed')),
    '1',
    'collapsed state is remembered for the session'
  );
  await page.screenshot({ path: path.join(outputDir, 'primary-sources-archive-sidebar-collapsed.png') });

  await revealSidebar.click();
  await sidebar.waitFor();
  assert.equal(
    await page.evaluate(() => sessionStorage.getItem('nodus.primarySources.archiveSidebarCollapsed')),
    '0',
    'expanded state is remembered for the session'
  );

  await page.getByRole('button', { name: 'Mapa', exact: true }).first().click();
  const provenanceMap = page.getByTestId('primary-sources-provenance-map-view');
  await provenanceMap.waitFor();
  await provenanceMap.getByRole('heading', { name: 'Mapa de procedencia', exact: true }).waitFor();
  assert.ok(
    await provenanceMap.getByText('Las ciudades mencionadas en su contenido no aparecen en este mapa.', { exact: false }).isVisible(),
    'the map explains that content mentions do not define provenance',
  );
  await provenanceMap.getByRole('button', { name: 'Tabla accesible', exact: true }).click();
  const provenanceRows = provenanceMap.locator('[data-testid^="primary-source-provenance-point-"]');
  await provenanceRows.first().waitFor();
  assert.equal(await provenanceRows.count(), 10, 'the map table contains one provenance row per demo source');
  assert.equal(
    (await provenanceMap.getByTestId('primary-sources-map-table').innerText()).includes('San Martín'),
    false,
    'a city mentioned inside a document is absent when it is not the source provenance',
  );
  await page.screenshot({ path: path.join(outputDir, 'primary-sources-provenance-map.png') });

  console.log(
    `[primary-sources-ui] screenshots: ${[
      'primary-sources-home.png',
      'primary-sources-search-filters.png',
      'primary-sources-archive-catalog.png',
      'primary-source-document-modal-source.png',
      'primary-source-document-modal-description.png',
      'primary-sources-archive-sidebar-collapsed.png',
      'primary-sources-provenance-map.png',
    ].map((file) => path.join(outputDir, file)).join(', ')}`
  );
} finally {
  await app.close().catch(() => {});
  await rm(userData, { recursive: true, force: true });
}
