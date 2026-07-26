// Diagnostic: visit each view the tutorial films and report what is actually
// on screen, so camera targets are chosen from the real DOM instead of guessed.
//
//   node scripts/tutorial/probe.mjs

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const OUT = path.join(repoRoot, '.tutorial-out', 'probe');
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const zotero = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Last-Modified-Version', '7');
  res.end('[]');
});
zotero.listen(0, '127.0.0.1');
await once(zotero, 'listening');

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-probe-'));
const env = {
  ...process.env,
  NODUS_USERDATA: userData,
  NODUS_DISABLE_AUTO_UPDATE: '1',
  NODUS_E2E_UPDATE_STATUS: 'not-available',
  NODUS_ZOTERO_API_BASE: `http://127.0.0.1:${zotero.address().port}/api`,
};
delete env.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env });
const report = {};
try {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length), { timeout: 30_000 });
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Nodus') ?? BrowserWindow.getAllWindows()[0];
    w.setContentSize(1600, 900);
    w.center();
  });
  const appVersion = require(path.join(repoRoot, 'package.json')).version;
  await page.addInitScript((v) => {
    localStorage.setItem('nodus.lastSeenVersion', v);
    sessionStorage.setItem('nodus.startupUpdateChecked', '1');
  }, appVersion);
  await page.evaluate(() => window.nodus.updateSettings({
    uiLanguage: 'en', basicsTutorialVersion: 9999, onboardingComplete: true,
    recoverySetupVersion: 9999, mascotStyleChosen: true, tourComplete: true,
    advancedTourComplete: true, genealogyTourComplete: true, databasesTourComplete: true,
    studyTourComplete: true, docenciaTourComplete: true,
  }));
  await page.evaluate(() => window.nodus.seedDemoData());
  await page.reload();
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length), { timeout: 30_000 });
  await page.waitForTimeout(3000);

  const inspect = async (label) => {
    const info = await page.evaluate(() => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 4 && r.height > 4;
      };
      const main = document.querySelector('main') ?? document.body;
      return {
        tourAnchors: [...document.querySelectorAll('[data-tour]')].filter(vis).map((e) => e.getAttribute('data-tour')),
        testIds: [...document.querySelectorAll('[data-testid]')].filter(vis).map((e) => e.getAttribute('data-testid')).slice(0, 40),
        inputs: [...main.querySelectorAll('input,textarea')].filter(vis).map((e) => ({
          tag: e.tagName.toLowerCase(), type: e.getAttribute('type'), cls: e.className.slice(0, 60), ph: e.getAttribute('placeholder'),
        })),
        tables: main.querySelectorAll('table').length,
        headings: [...main.querySelectorAll('h1,h2,h3')].filter(vis).map((e) => e.textContent.trim().slice(0, 50)).slice(0, 8),
      };
    });
    report[label] = info;
    await page.screenshot({ path: path.join(OUT, `${label}.png`) });
    console.log(`\n=== ${label} ===`);
    console.log('tour:', info.tourAnchors.join(', ') || '(none)');
    console.log('inputs:', JSON.stringify(info.inputs));
    console.log('headings:', info.headings.join(' | '));
  };

  await inspect('home');

  for (const view of ['library', 'ideas', 'graph', 'search', 'toolkit', 'settings']) {
    const btn = page.locator(`[data-tour="nav-${view}"]`).first();
    if (!(await btn.count())) { console.log(`(no nav for ${view})`); continue; }
    await btn.click().catch((e) => console.log(`nav ${view} click failed: ${e.message}`));
    await page.waitForTimeout(2500);
    await inspect(view);
  }

  // Does the vault menu open, and what does it look like?
  const trigger = page.locator('[data-vault-trigger]').first();
  console.log(`\nvault trigger count=${await trigger.count()} visible=${await trigger.isVisible().catch(() => false)}`);
  await trigger.click({ timeout: 5000 }).catch((e) => console.log(`vault click failed: ${e.message.split('\n')[0]}`));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, 'vault-menu.png') });

  await writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
} finally {
  await app.close().catch(() => {});
  await new Promise((r) => zotero.close(r));
  await rm(userData, { recursive: true, force: true }).catch(() => {});
}
