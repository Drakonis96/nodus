// Focused Electron smoke test for the prosopography vault. It uses an isolated
// profile, creates the vault through the real preload bridge, seeds the
// methodological demo through the renderer, and exercises the layered network
// in both colour schemes.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const appVersion = require(path.join(repoRoot, 'package.json')).version;
const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-prosop-e2e-'));
const screenshotDir = process.env.NODUS_PROSOPOGRAPHY_SCREENSHOT_DIR || os.tmpdir();
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
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
  await page.evaluate((version) => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    localStorage.setItem('nodus.mobileTeaserSeen.3.2.4', '1');
    localStorage.setItem('nodus.platformHighlightsSeen.2026-07', '1');
    localStorage.setItem('nodus.toolkitBetaGuideSeen.2.4.0', '1');
    localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
  }, appVersion);

  const bridge = await page.evaluate(() => ({
    createVault: typeof window.nodus?.createVault === 'function',
    switchVault: typeof window.nodus?.switchVault === 'function',
    seedDemo: typeof window.nodus?.seedProsopDemo === 'function',
    networks: typeof window.nodus?.getProsopNetworksWorkspace === 'function',
    exportLong: typeof window.nodus?.exportProsopLongRows === 'function',
    integrity: typeof window.nodus?.auditProsopIntegrity === 'function',
  }));
  assert.deepEqual(bridge, {
    createVault: true,
    switchVault: true,
    seedDemo: true,
    networks: true,
    exportLong: true,
    integrity: true,
  });

  await page.evaluate(async () => {
    const created = await window.nodus.createVault({ name: 'Prosopography E2E', type: 'prosopography' });
    const switched = await window.nodus.switchVault(created.vault.id);
    if (!switched.ok) throw new Error(switched.message);
    await window.nodus.updateSettings({
      onboardingComplete: true,
      basicsTutorialVersion: 5,
      recoverySetupVersion: 1,
      tourComplete: true,
      advancedTourComplete: true,
      mascotStyle: 'classic',
      mascotStyleChosen: true,
      theme: 'light',
    });
  });
  // The test deliberately validates the startup update modal after vault setup.
  // Treat this reload as a fresh app session, matching the dedicated smoke test.
  await page.evaluate(() => sessionStorage.removeItem('nodus.startupUpdateChecked'));
  await page.reload();
  await page.getByTestId('prosopography-home').waitFor();
  await page.getByTestId('prosopography-sidebar').waitFor();
  const startupUpdateModal = page.getByTestId('startup-update-modal');
  await startupUpdateModal.waitFor();
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="startup-update-modal"]')?.getAttribute('data-update-status') === 'not-available'
  );
  await startupUpdateModal.getByRole('button', { name: 'Entendido', exact: false }).click();
  await startupUpdateModal.waitFor({ state: 'detached' });

  for (const label of ['Buscar', 'Población', 'Personas', 'Fuentes', 'Análisis', 'Redes', 'Notas']) {
    assert.equal(await page.getByRole('button', { name: label, exact: true }).count(), 1, `${label} appears once`);
  }
  assert.equal(await page.getByRole('button', { name: 'Árbol', exact: true }).count(), 0, 'genealogy tree is absent');
  assert.equal(await page.getByTestId('nodus-logo').getAttribute('data-vault-logo'), 'prosopography');

  await page.getByRole('button', { name: 'Crear demo metodológica', exact: true }).click();
  await page.getByRole('status').waitFor();
  await page.getByRole('button', { name: 'Redes', exact: true }).click();
  await page.getByTestId('prosop-networks-view').waitFor();
  await page.getByRole('img', { name: 'Grafo prosopográfico por capas', exact: true }).waitFor();
  assert.ok(await page.locator('svg line').count() > 0, 'the demo renders evidence-backed edges');
  assert.ok(await page.getByText('Explícita', { exact: true }).count() > 0, 'explicit edge legend is visible');
  assert.ok(await page.getByText('Derivada', { exact: true }).count() > 0, 'derived edge legend is visible');
  assert.ok(await page.getByText('Hipótesis', { exact: true }).count() > 0, 'hypothesis edge legend is visible');

  const lightPath = path.join(screenshotDir, 'prosopography-e2e-light.png');
  await page.screenshot({ path: lightPath, fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('light')), true);

  await page.evaluate(() => window.nodus.updateSettings({ theme: 'dark' }));
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const darkPath = path.join(screenshotDir, 'prosopography-e2e-dark.png');
  await page.screenshot({ path: darkPath, fullPage: true });

  const audit = await page.evaluate(() => window.nodus.auditProsopIntegrity());
  assert.equal(audit.ok, true, `integrity audit: ${JSON.stringify(audit.issues)}`);
  assert.deepEqual(pageErrors, [], `renderer errors: ${pageErrors.map((error) => error.message).join(' | ')}`);
  console.log(`prosopography Electron smoke passed\nlight=${lightPath}\ndark=${darkPath}`);
} finally {
  if (app) await app.close().catch(() => {});
  await rm(userData, { recursive: true, force: true });
}
