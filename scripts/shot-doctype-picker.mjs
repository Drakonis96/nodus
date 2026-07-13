import { mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const OUT = process.env.SHOT_OUT || '/tmp';
const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-shotdp-'));
const env = { ...process.env, NODUS_USERDATA: userData, NODUS_DISABLE_AUTO_UPDATE: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env });
const waitRoot = (page) => page.waitForFunction(() => !!document.getElementById('root')?.children.length, { timeout: 30_000 });

try {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await waitRoot(page);
  await page.evaluate(() => localStorage.setItem('nodus.lastSeenVersion', '9999.0.0'));
  await page.evaluate(() => window.nodus.updateSettings({ onboardingComplete: true, tourComplete: true }));
  await page.evaluate(() => window.nodus.seedGenealogyDemoData());
  await page.reload();
  await waitRoot(page);
  await page.waitForTimeout(1200);
  for (let i = 0; i < 4; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(150); }
  await page.getByText('Archivo', { exact: true }).first().click({ timeout: 8000 });
  await page.waitForTimeout(800);

  // Open New entry → click the doc-type picker button (default "Notas").
  await page.getByText('Nueva entrada', { exact: true }).first().click({ timeout: 6000 });
  await page.waitForTimeout(500);
  const modal = page.locator('.card-modal');
  await modal.getByText('Notas', { exact: true }).first().click({ timeout: 5000 });
  await page.waitForTimeout(400);
  // Synonym query — "tumba" should surface Lápida / Sepulcro / Panteón, none literally named "tumba".
  await page.getByPlaceholder('Buscar tipo de documento…').first().fill('tumba');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/dp-synonym.png` });
  console.log('[shot] dp-synonym.png');

  // Choose "Lápida / losa sepulcral" → adapted monument form.
  await page.getByText('Lápida / losa sepulcral', { exact: false }).first().click({ timeout: 5000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/dp-monument-form.png` });
  console.log('[shot] dp-monument-form.png');

  await app.close();
} catch (e) {
  console.error(e);
  await app.close();
  process.exit(1);
}
