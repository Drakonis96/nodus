// Verify the two privacy controls before any frame of the academic tutorial is
// recorded, by producing the exact images a viewer would see.
//
// This exists because the first attempt at blurring silently matched nothing: the
// selector was scoped to an ancestor the modal does not have, so every one of the
// author's collections was legible in the diagnostic screenshot. A privacy control
// that fails open has to be checked by looking, not by reading the code.
//
//   node scripts/tutorial/verify-privacy.mjs
//
// Writes .tutorial-out/privacy/collections-blurred.png and key-shield.png

import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { CURSOR_CSS, installCursor } from './cursor.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const appVersion = require(path.join(repoRoot, 'package.json')).version;
const OUT = path.join(repoRoot, '.tutorial-out', 'privacy');
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const TARGET = 'Nodus Tests';
const keyFile = path.join(os.homedir(), '.config', 'nodus', 'openrouter-app.key');
const KEY = existsSync(keyFile) ? (await readFile(keyFile, 'utf8')).trim() : 'sk-or-v1-EXAMPLE';

const PRIVACY_CSS = `
.nodus-blur { filter: blur(6px) !important; }
#nodus-key-shield {
  position: fixed; z-index: 2147483000; border-radius: 10px;
  background: repeating-linear-gradient(45deg, #2a2145, #2a2145 10px, #3a2f5c 10px, #3a2f5c 20px);
  display: grid; place-items: center; color: #cfc7ee;
  font: 600 13px Inter, system-ui, sans-serif; letter-spacing: .04em;
}
`;

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-privacy-'));
const env = { ...process.env, NODUS_USERDATA: userData, NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available' };
delete env.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env });
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(20_000);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length), { timeout: 30_000 });
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Nodus') ?? BrowserWindow.getAllWindows()[0];
    w.setContentSize(1600, 900);
    w.center();
  });
  await page.addInitScript((v) => {
    localStorage.setItem('nodus.lastSeenVersion', v);
    sessionStorage.setItem('nodus.startupUpdateChecked', '1');
  }, appVersion);
  await page.evaluate(() => window.nodus.updateSettings({
    uiLanguage: 'en', basicsTutorialVersion: 9999, onboardingComplete: true,
    recoverySetupVersion: 9999, mascotStyleChosen: true, mascotStyle: 'orb', tourComplete: true,
    advancedTourComplete: true, genealogyTourComplete: true, databasesTourComplete: true,
    studyTourComplete: true, docenciaTourComplete: true,
  }));
  await page.reload();
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length), { timeout: 30_000 });
  await page.waitForTimeout(2500);
  await page.evaluate((css) => { window.__TUTORIAL_CURSOR_CSS__ = css; }, CURSOR_CSS + PRIVACY_CSS);
  await page.evaluate(installCursor);

  // ── 1. the key shield ────────────────────────────────────────────────────
  await page.locator('[data-tour="nav-settings"]').first().click();
  await page.waitForTimeout(1800);
  await page.locator('[data-testid="provider-openrouter"]').first().click().catch(() => {});
  await page.waitForTimeout(1200);
  const field = page.locator('input[type="password"]').first();
  const box = await field.boundingBox().catch(() => null);
  if (box) {
    await page.evaluate((r) => {
      const shield = document.createElement('div');
      shield.id = 'nodus-key-shield';
      shield.style.left = `${r.x - 4}px`;
      shield.style.top = `${r.y - 4}px`;
      shield.style.width = `${r.width + 8}px`;
      shield.style.height = `${r.height + 8}px`;
      shield.textContent = 'API KEY — HIDDEN';
      document.body.appendChild(shield);
    }, box);
    await field.fill(KEY);
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, 'key-shield.png') });
    const leaked = (await page.evaluate(() => document.body.innerText)).includes(KEY.slice(0, 18));
    console.log(`key visible in page text: ${leaked ? 'YES — FAIL' : 'no'}`);
    await page.evaluate(() => document.getElementById('nodus-key-shield')?.remove());
  } else {
    console.log('no password field found');
  }

  // ── 2. the collection blur ───────────────────────────────────────────────
  await page.locator('[data-tour="nav-library"]').first().click();
  await page.waitForTimeout(2000);
  await page.locator('[data-tour="collections"]').first().click({ timeout: 8000 }).catch((e) => console.log('collections:', e.message.split('\n')[0]));
  await page.waitForTimeout(4000);

  const blurred = await page.evaluate((target) => {
    // Scope to the modal: the same span class is used by the sidebar's Toolkit
    // entries, and blurring those would leave them smeared for the whole video.
    const modalRoot = () => {
      const heading = [...document.querySelectorAll('h2')]
        .find((h) => /zotero collections/i.test(h.textContent ?? ''));
      let root = heading;
      while (root && root.getBoundingClientRect().height < 200) root = root.parentElement;
      return root;
    };
    const apply = () => {
      const root = modalRoot();
      if (!root) return;
      for (const span of root.querySelectorAll('span.flex-1.truncate')) {
        const name = (span.textContent ?? '').trim();
        if (!name) continue;
        span.classList.toggle('nodus-blur', name !== target);
      }
    };
    apply();
    window.setInterval(apply, 250);
    const root = modalRoot();
    if (!root) return [];
    return [...root.querySelectorAll('span.flex-1.truncate')].map((s) => ({
      name: (s.textContent ?? '').trim(),
      blurred: s.classList.contains('nodus-blur'),
    }));
  }, TARGET);

  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, 'collections-blurred.png') });

  console.log('\ncollection rows found:', blurred.length);
  for (const row of blurred) console.log(`  ${row.blurred ? 'blurred ' : 'VISIBLE '} ${row.name}`);
  const leaks = blurred.filter((r) => !r.blurred && r.name !== TARGET);
  console.log(leaks.length ? `\n*** ${leaks.length} COLLECTION(S) NOT BLURRED ***` : '\nall non-target collections blurred');

  await writeFile(path.join(OUT, 'report.json'), JSON.stringify(blurred, null, 2), 'utf8');
  console.log(`\nimages in ${path.relative(repoRoot, OUT)}`);
} finally {
  await app.close().catch(() => {});
  await rm(userData, { recursive: true, force: true }).catch(() => {});
}
