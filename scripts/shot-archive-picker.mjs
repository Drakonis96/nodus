// Interaction check for the PersonLinkPicker outside-click fix: open the "+ vincular"
// popover in the Archive grid, then click elsewhere and confirm it closes.
import { mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const OUT = process.env.SHOT_OUT || '/tmp';

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-pickchk-'));
const env = { ...process.env, NODUS_USERDATA: userData, NODUS_DISABLE_AUTO_UPDATE: '1' };
delete env.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env });
const waitRoot = async (page) =>
  page.waitForFunction(() => !!document.getElementById('root')?.children.length, { timeout: 30_000 });

try {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await waitRoot(page);
  await page.evaluate(() => localStorage.setItem('nodus.lastSeenVersion', '9999.0.0'));
  await page.evaluate(() => window.nodus.updateSettings({ onboardingComplete: true, tourComplete: true }));
  await page.evaluate(() => window.nodus.seedGenealogyDemoData());
  await page.reload();
  await waitRoot(page);
  await page.evaluate(() => localStorage.setItem('nodus.lastSeenVersion', '9999.0.0'));
  await page.waitForTimeout(1200);
  // Dismiss any first-run modal (tour / what's new / portrait prompt).
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
  await page.getByText('Archivo', { exact: true }).first().click({ timeout: 8000 });
  await page.waitForTimeout(1000);
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }

  // Open the picker.
  await page.getByText('vincular', { exact: false }).first().click({ timeout: 8000 });
  await page.waitForTimeout(400);
  const openVisible = await page.getByPlaceholder('Buscar miembro…').first().isVisible().catch(() => false);
  await page.screenshot({ path: `${OUT}/picker-open.png` });

  // Click on empty space away from the popover — it must close.
  await page.mouse.click(760, 240);
  await page.waitForTimeout(400);
  const stillVisible = await page.getByPlaceholder('Buscar miembro…').first().isVisible().catch(() => false);
  await page.screenshot({ path: `${OUT}/picker-after-outside-click.png` });

  console.log(JSON.stringify({ openVisible, closedAfterOutsideClick: !stillVisible }));
  if (!openVisible || stillVisible) {
    console.error('PICKER CLOSE CHECK FAILED');
    await app.close();
    process.exit(1);
  }
  console.log('Picker outside-click close check passed!');
  await app.close();
} catch (e) {
  console.error(e);
  await app.close();
  process.exit(1);
}
