// Launch the built app in a throwaway profile, seed the genealogy demo, and capture
// screenshots of the new map surfaces (general map with the person filter + timeline
// slider, a single-person migration, and the per-person map inside the dossier). Does
// NOT touch the user's real vaults. Outputs PNGs to /tmp.
//
//   node scripts/shot-map.mjs

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

if (!existsSync(path.join(repoRoot, 'dist-electron/main.js'))) {
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
}

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-shot-'));
const env = { ...process.env, NODUS_USERDATA: userData, NODUS_DISABLE_AUTO_UPDATE: '1' };
delete env.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env });
try {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !!document.getElementById('root')?.children.length, { timeout: 30_000 });
  await page.evaluate(() => localStorage.setItem('nodus.lastSeenVersion', '9999.0.0'));
  await page.evaluate(() => window.nodus.updateSettings({ onboardingComplete: true, tourComplete: true, genealogyTourComplete: true }));

  // Seed the genealogy demo (flips the vault to genealogy) and reload into it.
  const seeded = await page.evaluate(() => window.nodus.seedGenealogyDemoData());
  console.log('[shot] seeded genealogy demo:', seeded);
  await page.reload();
  await page.waitForFunction(() => !!document.getElementById('root')?.children.length, { timeout: 30_000 });
  await page.evaluate(() => localStorage.setItem('nodus.lastSeenVersion', '9999.0.0'));
  // Dismiss the genealogy tour overlay if present.
  await page.evaluate(() => window.nodus.updateSettings({ genealogyTourComplete: true })).catch(() => {});
  await page.reload();
  await page.waitForFunction(() => !!document.getElementById('root')?.children.length, { timeout: 30_000 });

  const clickNav = async (label) => {
    const btn = page.getByRole('button', { name: label, exact: true }).first();
    if (await btn.count()) await btn.click({ timeout: 8000 });
    else await page.locator(`text=${label}`).first().click({ timeout: 8000 });
    await page.waitForTimeout(1400);
  };

  // General map (dark).
  await clickNav('Mapa');
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${OUT}/map-general.png` });
  console.log('[shot] map-general.png');

  // General map (light theme) — reload so App re-applies the theme classes.
  await page.evaluate(() => window.nodus.updateSettings({ theme: 'light' }));
  await page.reload();
  await page.waitForFunction(() => !!document.getElementById('root')?.children.length, { timeout: 30_000 });
  await clickNav('Mapa');
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${OUT}/map-general-light.png` });
  console.log('[shot] map-general-light.png');
  await page.evaluate(() => window.nodus.updateSettings({ theme: 'dark' }));
  await page.reload();
  await page.waitForFunction(() => !!document.getElementById('root')?.children.length, { timeout: 30_000 });

  // Personas → open a person with movements (Rafael) → capture the dossier map.
  await clickNav('Personas');
  await page.locator('text=Rafael Serrano').first().click({ timeout: 8000 });
  await page.waitForTimeout(1600);
  // Scroll the dossier to the Lugares/map section.
  await page.locator('text=Lugares').first().scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/map-person-dossier.png` });
  console.log('[shot] map-person-dossier.png');

  console.log('[shot] done');
} finally {
  await app.close();
}
