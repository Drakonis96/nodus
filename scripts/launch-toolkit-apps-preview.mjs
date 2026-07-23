// Opens the built app on Nodus Apps with a disposable profile. Intended for
// design review: it never touches the user's normal Nodus data or settings.
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-apps-preview-'));
const childEnv = {
  ...process.env,
  NODUS_USERDATA: userData,
  NODUS_DISABLE_AUTO_UPDATE: '1',
  NODUS_E2E_UPDATE_STATUS: 'not-available',
  NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1',
};
delete childEnv.ELECTRON_RUN_AS_NODE;

let app = null;
try {
  app = await electron.launch({ executablePath: require('electron'), args: [root], env: childEnv });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
  await page.evaluate(() => window.nodus.updateSettings({
    uiLanguage: 'es', promptLanguage: 'es', onboardingComplete: true,
    basicsTutorialVersion: 5, recoverySetupVersion: 1, tourComplete: true,
    advancedTourComplete: true, mascotEnabled: false,
  }));
  await page.reload();
  await page.getByTestId('app-shell').waitFor({ timeout: 30_000 });
  const releaseNotes = page.getByTestId('whats-new-cinematic-modal');
  if (await releaseNotes.isVisible().catch(() => false)) await page.locator('.whats-new-close').click();
  const updateModal = page.getByTestId('startup-update-modal');
  if (await updateModal.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false)) {
    await page.locator('.startup-update-close').click();
  }
  await page.locator('[data-tour="toolkit"]').click();
  await page.getByTestId('toolkit-home').waitFor();
  await page.getByTestId('toolkit-card-apps').click();
  await page.getByTestId('toolkit-apps-catalog').waitFor();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) { win.setSize(1280, 860); win.center(); win.show(); win.focus(); }
  });
  process.stdout.write('Nodus Apps preview is open. Close the window to end the isolated preview.\n');
  await new Promise((resolve) => app.process().once('exit', resolve));
} finally {
  if (app) await app.close().catch(() => undefined);
  await rm(userData, { recursive: true, force: true });
}
