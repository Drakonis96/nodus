// Screenshot the genealogy UI fixes: the Home AI-config card ("pendiente" size),
// a person dossier (portrait buttons + icon edit/delete), and the backup schedule
// editor in Settings. Isolated throwaway profile — never touches real vaults.
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
const OUT = '/tmp';

if (!existsSync(path.join(repoRoot, 'dist-electron/main.js'))) execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-shotui-'));
const env = { ...process.env, NODUS_USERDATA: userData, NODUS_DISABLE_AUTO_UPDATE: '1' };
delete env.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env });
try {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !!document.getElementById('root')?.children.length, { timeout: 30_000 });
  await page.evaluate(() => localStorage.setItem('nodus.lastSeenVersion', '9999.0.0'));
  await page.evaluate(() => window.nodus.updateSettings({ onboardingComplete: true, tourComplete: true }));
  await page.evaluate(() => window.nodus.seedGenealogyDemoData());
  // The demo seed re-arms the genealogy tour; disable it so it doesn't overlay clicks.
  await page.evaluate(() => window.nodus.updateSettings({ onboardingComplete: true, tourComplete: true, genealogyTourComplete: true }));
  await page.reload();
  await page.waitForFunction(() => !!document.getElementById('root')?.children.length, { timeout: 30_000 });
  await page.evaluate(() => localStorage.setItem('nodus.lastSeenVersion', '9999.0.0'));

  const nav = async (label) => {
    await page.getByRole('button', { name: label, exact: true }).first().click({ timeout: 8000 });
    await page.waitForTimeout(1200);
  };

  // Home (genealogy) — the AI-config "pendiente" card.
  await nav('Inicio');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/ui-home.png`, fullPage: true });
  console.log('[shot] ui-home.png');

  // Person dossier — portrait buttons + icon edit/delete.
  await nav('Personas');
  await page.locator('text=Rafael Serrano').first().click({ timeout: 8000 });
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${OUT}/ui-dossier.png` });
  console.log('[shot] ui-dossier.png');

  // Backup schedule editor (enable auto-backup so the schedule shows).
  await nav('Ajustes');
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Backup / copia de seguridad', exact: true }).first().click({ timeout: 8000 });
  await page.waitForTimeout(500);
  // Enable automatic backups in-UI so the schedule editor renders.
  await page.locator('input[type=checkbox]').last().check({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find((n) => n.textContent?.trim() === 'Días');
    el?.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/ui-backup.png` });
  console.log('[shot] ui-backup.png');

  console.log('[shot] done');
} finally {
  await app.close();
}
