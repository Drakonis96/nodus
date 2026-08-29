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
if (!existsSync(path.join(repoRoot, 'dist-electron/main.js'))) throw new Error('Run npm run build before this E2E test.');

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-document-controls-e2e-'));
const env = {
  ...process.env,
  NODUS_USERDATA: userData,
  NODUS_DISABLE_AUTO_UPDATE: '1',
  NODUS_E2E_UPDATE_STATUS: 'not-available',
  NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1',
};
delete env.ELECTRON_RUN_AS_NODE;

let app;
try {
  app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
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
      documentIndexingEnabled: false,
    });
    await window.nodus.seedDemoData();
  }, require(path.join(repoRoot, 'package.json')).version);
  await page.reload();
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));

  const update = page.getByTestId('startup-update-modal');
  if (await update.count()) {
    await page.waitForFunction(() => document.querySelector('[data-testid="startup-update-modal"]')?.getAttribute('data-update-status') === 'not-available');
    await update.getByRole('button', { name: 'Entendido', exact: false }).click();
    await update.waitFor({ state: 'detached' });
  }

  // Document understanding is started explicitly from the app, never by a startup
  // dialog, so the campaign is launched the same way the Library control does.
  assert.equal(
    await page.getByTestId('document-understanding-consent').count(),
    0,
    'no startup consent modal precedes the document index',
  );
  await page.evaluate(() => window.nodus.startDocumentIndexCampaign({ includeArchived: false }));

  const bar = page.getByTestId('document-index-progress-bar');
  await bar.waitFor({ state: 'visible' });
  const progress = bar.getByRole('progressbar');
  assert.equal(await progress.getAttribute('aria-valuemin'), '0');
  assert.equal(await progress.getAttribute('aria-valuemax'), '100');

  await bar.getByRole('button', { name: 'Pausar indexación' }).click();
  await page.waitForFunction(async () => {
    const snapshot = await window.nodus.getDocumentIndexProgress();
    return snapshot.campaigns.some((campaign) => campaign.status === 'paused');
  });
  await bar.getByRole('button', { name: 'Reanudar indexación' }).click();
  await page.waitForFunction(async () => {
    const snapshot = await window.nodus.getDocumentIndexProgress();
    return snapshot.campaigns.some((campaign) => campaign.status === 'running' || campaign.status === 'queued');
  });

  await bar.getByRole('button', { name: 'Detener indexación' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Detener indexación' });
  await confirmation.waitFor({ state: 'visible' });
  assert.match(await confirmation.innerText(), /fichas ya publicadas.*correcciones.*completadas/is);
  await confirmation.getByRole('button', { name: 'Detener', exact: true }).click();
  await page.waitForFunction(async () => {
    const snapshot = await window.nodus.getDocumentIndexProgress();
    return !snapshot.campaigns.some((campaign) => ['queued', 'running', 'paused'].includes(campaign.status));
  });
  await bar.waitFor({ state: 'detached' });

  console.log('Document index real renderer pause/resume/stop E2E passed!');
} finally {
  if (app) await app.close().catch(() => undefined);
  await rm(userData, { recursive: true, force: true });
}
