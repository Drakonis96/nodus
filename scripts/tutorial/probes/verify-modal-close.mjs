// Does the dialog actually close?
//
// Three attempts at this failed while reporting success: a coordinate click that
// landed on the macOS window controls, a "✕" search that found the monitoring
// chip, and a guard that probed a point covered by the backdrop rather than the
// dialog. Each left the Zotero dialog open with the recording clicking into it.
//
// So this proves the routine on the real dialog before a take is spent.
//
//   node scripts/tutorial/verify-modal-close.mjs

import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const appVersion = require(path.join(repoRoot, 'package.json')).version;

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-modalclose-'));
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
    uiLanguage: 'en', theme: 'light', basicsTutorialVersion: 9999, onboardingComplete: true,
    recoverySetupVersion: 9999, mascotStyleChosen: true, mascotStyle: 'orb', tourComplete: true,
    advancedTourComplete: true, genealogyTourComplete: true, databasesTourComplete: true,
    studyTourComplete: true, docenciaTourComplete: true,
  }));
  await page.reload();
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length), { timeout: 30_000 });
  await page.waitForTimeout(2500);

  const isOpen = () => page.evaluate(() =>
    Boolean([...document.querySelectorAll('[role="dialog"], .card-modal, [aria-modal="true"]')]
      .find((d) => { const r = d.getBoundingClientRect(); return r.width > 200 && r.height > 200; })
      || [...document.querySelectorAll('h2')].some((h) => /zotero collections/i.test(h.textContent ?? ''))));

  await page.locator('[data-tour="nav-library"]').first().click();
  await page.waitForTimeout(2000);
  await page.locator('[data-tour="collections"]').first().click();
  await page.waitForTimeout(3500);
  console.log('dialog open after clicking Collections:', await isOpen());

  // The routine under test, verbatim.
  const closed = await page.evaluate(() => {
    const big = (el) => { const r = el.getBoundingClientRect(); return r.width > 200 && r.height > 200; };
    const heading = [...document.querySelectorAll('h2, h3')]
      .find((h) => /zotero collections|new report/i.test(h.textContent ?? ''));
    let card = heading ?? [...document.querySelectorAll('[role="dialog"], .card-modal, [aria-modal="true"]')].find(big);
    if (!card) return 'no dialog found';
    while (card && !big(card)) card = card.parentElement;
    if (!card) return 'no sized card';
    const backdrop = card.parentElement;
    if (!backdrop) return 'no backdrop';
    const cls = backdrop.className?.toString() ?? '';
    if (!/fixed/.test(cls)) return `backdrop is not fixed: ${cls.slice(0, 60)}`;
    backdrop.click();
    return 'clicked backdrop';
  });
  console.log('close attempt:', closed);
  await page.waitForTimeout(900);
  const after = await isOpen();
  console.log('dialog open after close:', after);

  // And prove navigation works again, which is what actually matters.
  const navOk = await page.locator('[data-tour="nav-graph"]').first().click({ timeout: 5000 })
    .then(() => true).catch(() => false);
  console.log('could navigate afterwards:', navOk);
  console.log(after || !navOk ? '\n*** STILL BLOCKED ***' : '\nclosed cleanly and navigation works');
} finally {
  await app.close().catch(() => {});
  await rm(userData, { recursive: true, force: true }).catch(() => {});
}
