// Screenshot the expanded Archive document-type picker (searchable, semantic,
// bilingual) + heritage facet filters + genealogy default. Isolated throwaway profile.
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const OUT = process.env.SHOT_OUT || '/tmp';
if (!existsSync(path.join(repoRoot, 'dist-electron/main.js'))) execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-shotdt-'));
const env = { ...process.env, NODUS_USERDATA: userData, NODUS_DISABLE_AUTO_UPDATE: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env });
const waitRoot = (page) => page.waitForFunction(() => !!document.getElementById('root')?.children.length, { timeout: 30_000 });

async function openArchive(page) {
  for (let i = 0; i < 4; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(150); }
  await page.getByText('Archivo', { exact: true }).first().click({ timeout: 8000 });
  await page.waitForTimeout(900);
}

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
  await openArchive(page);

  // Full grid — the Genealogy facet should be pre-selected (badge on its filter chip).
  await page.screenshot({ path: `${OUT}/dt-grid.png`, fullPage: true });
  console.log('[shot] dt-grid.png');

  // Open a Tipo cell → the searchable picker; type a SYNONYM ("tumba").
  const tipoCell = page.getByText('Sin tipo', { exact: true }).first();
  if (await tipoCell.count()) {
    await tipoCell.click({ timeout: 5000 });
    await page.waitForTimeout(400);
    await page.getByPlaceholder('Buscar tipo de documento…').first().fill('tumba');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/dt-picker-synonym.png` });
    console.log('[shot] dt-picker-synonym.png');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  } else {
    console.log('[shot] no empty Tipo cell; opening picker from a New entry instead');
  }

  // New entry modal → pick a monument type → adapted form.
  await page.keyboard.press('Escape');
  await page.getByText('Nueva entrada', { exact: true }).first().click({ timeout: 6000 });
  await page.waitForTimeout(500);
  // The modal's DocTypePicker button (shows current type or "Notas").
  await page.screenshot({ path: `${OUT}/dt-newentry.png` });
  console.log('[shot] dt-newentry.png');

  // Switch to English and re-open the archive to verify bilingual labels.
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.nodus.updateSettings({ uiLanguage: 'en' }));
  await page.reload();
  await waitRoot(page);
  await page.waitForTimeout(1000);
  await page.getByText('Archive', { exact: true }).first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/dt-grid-en.png`, fullPage: true });
  console.log('[shot] dt-grid-en.png');

  await app.close();
} catch (e) {
  console.error(e);
  await app.close();
  process.exit(1);
}
