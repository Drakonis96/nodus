// Real-renderer acceptance test for the tabbed citation workspace shared by
// Deep Research and Immersion. It also produces the handoff screenshot when a
// destination path is passed as the first argument.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const screenshotPath = process.argv[2] ? path.resolve(process.argv[2]) : null;
const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-source-citation-ui-'));
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
  await page.setViewportSize({ width: 1440, height: 1000 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));

  await page.evaluate(async (version) => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    localStorage.setItem('nodus.mobileTeaserSeen.3.2.4', '1');
    localStorage.setItem('nodus.platformHighlightsSeen.2026-07', '1');
    localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
    localStorage.setItem('nodus.toolkitBetaGuideSeen.2.4.0', '1');
    localStorage.setItem('nodus.documentUnderstandingConsent.2026-08', '1');
    await window.nodus.updateSettings({
      onboardingComplete: true,
      basicsTutorialVersion: 999,
      recoverySetupVersion: 999,
      tourComplete: true,
      advancedTourComplete: true,
      theme: 'light',
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
  }

  await page.locator('[data-tour="nav-immersion"]').click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).first().click();
  await page.getByTestId('immersion-reader-document').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: /Ver idea de origen/ }).click();

  const modal = page.getByTestId('source-citation-modal');
  await modal.waitFor({ state: 'visible' });
  await modal.getByTestId('source-citation-idea').waitFor({ state: 'visible' });
  assert.equal(await modal.getByTestId('source-citation-linked-works').count(), 1, 'the idea groups linked works');
  assert.equal(await modal.getByTestId('source-citation-evidence').count(), 1, 'the idea groups anchored evidence');
  assert.equal(await modal.getByText(/Ver en grafo|Ver conexiones en grafo/i).count(), 0, 'the citation workspace has no graph actions');

  const connectionLabel = modal.getByText('La recuperación activa supera a la relectura', { exact: true });
  await connectionLabel.hover();
  assert.equal(
    await connectionLabel.evaluate((element) => getComputedStyle(element).color),
    'rgb(67, 56, 202)',
    'idea links use the readable indigo-700 hover colour in the light theme',
  );

  const workLink = modal.getByTestId('source-citation-work-link-demo-w1');
  await workLink.locator('button').first().click();
  await modal.getByTestId('source-citation-work').waitFor({ state: 'visible' });
  assert.equal(await modal.locator('[role="tab"]').count(), 2, 'opening a work adds a second tab');

  const authorButton = modal.getByRole('button', { name: 'Roediger, H. L.', exact: true });
  await authorButton.waitFor({ state: 'visible' });
  await authorButton.click();
  await modal.getByTestId('source-citation-author').waitFor({ state: 'visible' });
  assert.equal(await modal.locator('[role="tab"]').count(), 3, 'opening an author adds a third tab');

  // Return to the cited idea for the capture: the three-tab path remains visible,
  // while the requested idea → works → evidence hierarchy is on screen.
  await modal.getByTestId('source-citation-tab-idea:demo-i1').click();
  await modal.getByTestId('source-citation-idea').waitFor({ state: 'visible' });
  if (screenshotPath) {
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await modal.screenshot({ path: screenshotPath });
  }

  await modal.getByTestId('source-citation-close-tab-work:demo-w1').click();
  assert.equal(await modal.locator('[role="tab"]').count(), 2, 'tabs can be closed independently');
  assert.deepEqual(pageErrors, [], `renderer errors: ${pageErrors.map((error) => error.message).join(' | ')}`);
  console.log(`Source citation modal E2E passed${screenshotPath ? `; screenshot: ${screenshotPath}` : ''}.`);
} finally {
  if (app) await app.close();
  await rm(userData, { recursive: true, force: true });
}
