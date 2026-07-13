// Screenshot the Databases mode: the crimson-themed Notion-like table workspace and
// the databases Home launcher. Isolated throwaway profile — never touches real vaults.
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

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-shotdb-'));
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

  // Seed the real Databases-mode demo (flips the vault to databases + 3 sample DBs).
  await page.evaluate(() => window.nodus.seedDatabasesDemoData());
  await page.reload();
  await waitRoot(page);
  await page.evaluate(() => localStorage.setItem('nodus.lastSeenVersion', '9999.0.0'));
  await page.waitForTimeout(1400);

  // The databases tutorial auto-shows on first launch — capture it.
  await page.screenshot({ path: `${OUT}/db-demo-tour.png`, fullPage: true });
  console.log('[shot] db-demo-tour.png');

  // Dismiss the tour and open the first database → crimson logo + grouped sidebar + table.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  await page.getByText('Muestras de campo').first().click({ timeout: 8000 });
  await page.waitForTimeout(1000);
  // Table now shows the view tabs row (Todas + / ) and the Filter/Sort/Bulk header buttons.
  await page.screenshot({ path: `${OUT}/db-demo-table.png` });
  console.log('[shot] db-demo-table.png');

  // Export menu (CSV / Excel / JSON) — best-effort.
  try {
    await page.getByTitle('Exportar').first().click({ timeout: 4000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/db-demo-export.png` });
    console.log('[shot] db-demo-export.png');
    await page.mouse.click(20, 700);
    await page.waitForTimeout(300);
  } catch {
    console.log('[shot] export menu skipped');
  }

  // Filter popover (best-effort — the feature is covered by unit + e2e tests).
  try {
    await page.getByTitle('Filtrar').first().click({ timeout: 4000 });
    await page.waitForTimeout(400);
    await page.getByText('Añadir filtro', { exact: true }).first().click({ timeout: 3000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/db-demo-filter.png` });
    console.log('[shot] db-demo-filter.png');
    await page.mouse.click(20, 700);
    await page.waitForTimeout(300);
  } catch {
    console.log('[shot] filter popover skipped');
  }

  // Open the Especie select cell → Notion-style search/create dropdown.
  await page.getByText('Musgo', { exact: true }).first().click({ timeout: 8000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/db-demo-select.png` });
  console.log('[shot] db-demo-select.png');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // Switch to the Gallery view.
  await page.getByRole('button', { name: 'Galería', exact: true }).first().click({ timeout: 8000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/db-demo-gallery.png` });
  console.log('[shot] db-demo-gallery.png');

  // Open a record card → detail modal (all fields + attachment + AI summary field).
  await page.getByText('Musgo alpino', { exact: true }).first().click({ timeout: 8000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/db-demo-record.png` });
  console.log('[shot] db-demo-record.png');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // Experiments database → the relation column ("Muestra") shows linked-row chips.
  await page.getByText('Experimentos', { exact: true }).first().click({ timeout: 8000 });
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: 'Tabla', exact: true }).first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/db-demo-relations.png` });
  console.log('[shot] db-demo-relations.png');

  // Analysis view — deterministic stats + native charts (AI report needs a key).
  await page.getByText('Análisis', { exact: true }).first().click({ timeout: 8000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/db-demo-analysis.png`, fullPage: true });
  console.log('[shot] db-demo-analysis.png');

  // Data chat — DB selector + starter prompts (streaming needs an AI key).
  await page.getByText('Chat de datos', { exact: true }).first().click({ timeout: 8000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/db-demo-chat.png` });
  console.log('[shot] db-demo-chat.png');

  await app.close();
} catch (e) {
  console.error(e);
  await app.close();
  process.exit(1);
}
