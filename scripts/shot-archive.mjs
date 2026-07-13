// Screenshot the genealogy Archive's new database-style grid (inline-editable fixed
// columns + Carpeta multi-select) and the full-record modal. Isolated throwaway
// profile — never touches real vaults.
import { execFileSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const OUT = process.env.SHOT_OUT || '/tmp';

if (!existsSync(path.join(repoRoot, 'dist-electron/main.js'))) execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-shotarchive-'));
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

  // Seed the genealogy demo (flips the vault to genealogy + persons + archive items).
  await page.evaluate(() => window.nodus.seedGenealogyDemoData());
  await page.reload();
  await waitRoot(page);
  await page.evaluate(() => localStorage.setItem('nodus.lastSeenVersion', '9999.0.0'));
  await page.waitForTimeout(1200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // Navigate to the Archive.
  await page.getByText('Archivo', { exact: true }).first().click({ timeout: 8000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/archive-grid.png`, fullPage: true });
  console.log('[shot] archive-grid.png');

  // Open a folder (Carpeta) cell dropdown to show the multi-select.
  try {
    await page.getByText('Carpeta…', { exact: true }).first().click({ timeout: 3000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/archive-folder-dropdown.png` });
    console.log('[shot] archive-folder-dropdown.png');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  } catch {
    console.log('[shot] folder dropdown skipped');
  }

  // Open the full-record modal via the gutter expand button.
  try {
    await page.getByTitle('Abrir ficha').first().click({ timeout: 4000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/archive-record.png` });
    console.log('[shot] archive-record.png');
  } catch {
    console.log('[shot] record modal skipped');
  }

  await app.close();
} catch (e) {
  console.error(e);
  await app.close();
  process.exit(1);
}
