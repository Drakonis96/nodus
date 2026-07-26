// Diagnostic for the academic-vault tutorial.
//
// This one runs against the *real* Zotero local API, because the tutorial films a
// real collection being imported and scanned. That makes two things non-negotiable
// and this probe exists to verify both before a single frame is recorded:
//
//   1. API keys must never be legible on screen. The provider fields are checked
//      for masking, and what they actually render is reported.
//   2. Only the "Nodus Tests" collection may be readable. Every other collection
//      in the picker has to be blurred, so the picker's markup is dumped here to
//      find a selector that can reach the rows.
//
// It uses a throwaway NODUS_USERDATA, so the developer's installed vaults are
// never touched.
//
//   node scripts/tutorial/probe-academic.mjs

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const appVersion = require(path.join(repoRoot, 'package.json')).version;
const OUT = path.join(repoRoot, '.tutorial-out', 'probe-academic');
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const keyFile = async (name) => {
  const f = path.join(os.homedir(), '.config', 'nodus', name);
  return existsSync(f) ? (await readFile(f, 'utf8')).trim() : null;
};
const orKey = await keyFile('openrouter-app.key');
const geminiKey = await keyFile('gemini-app.key');
console.log(`keys present — openrouter: ${Boolean(orKey)}, gemini: ${Boolean(geminiKey)}`);

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-acad-probe-'));
// No NODUS_ZOTERO_API_BASE here on purpose: this must reach the real Zotero.
const env = {
  ...process.env,
  NODUS_USERDATA: userData,
  NODUS_DISABLE_AUTO_UPDATE: '1',
  NODUS_E2E_UPDATE_STATUS: 'not-available',
};
delete env.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env });
const report = {};
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
    uiLanguage: 'en', basicsTutorialVersion: 9999, onboardingComplete: true, recoverySetupVersion: 9999,
    mascotStyleChosen: true, mascotStyle: 'orb', tourComplete: true, advancedTourComplete: true,
    genealogyTourComplete: true, databasesTourComplete: true, studyTourComplete: true, docenciaTourComplete: true,
  }));
  await page.reload();
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length), { timeout: 30_000 });
  await page.waitForTimeout(2500);

  // ------------------------------------------------- 1. key field masking
  await page.locator('[data-tour="nav-settings"]').first().click();
  await page.waitForTimeout(2000);
  for (const provider of ['openrouter', 'gemini']) {
    await page.locator(`[data-testid="provider-${provider}"]`).first().click().catch(() => {});
    await page.waitForTimeout(1200);
    const info = await page.evaluate((p) => {
      const row = document.querySelector(`[data-testid="provider-${p}"]`)?.parentElement;
      if (!row) return null;
      const inputs = [...row.querySelectorAll('input')].map((i) => ({
        type: i.getAttribute('type'), placeholder: i.getAttribute('placeholder'), cls: i.className.slice(0, 40),
      }));
      const buttons = [...row.querySelectorAll('button')].map((b) => b.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 12);
      return { inputs, buttons };
    }, provider);
    report[`provider_${provider}`] = info;
    console.log(`\n=== provider ${provider} ===`);
    console.log(' inputs :', JSON.stringify(info?.inputs));
    console.log(' buttons:', info?.buttons.join(' | '));
  }

  // Type a decoy into the OpenRouter field and confirm it cannot be read back
  // visually — this is the check that protects the key on camera.
  const orField = page.locator('[data-testid="provider-openrouter"]').locator('xpath=..').locator('input[type="password"], input').first();
  await orField.fill('DECOY-1234567890').catch(() => {});
  await page.waitForTimeout(400);
  const masking = await page.evaluate(() => {
    const el = [...document.querySelectorAll('input')].find((i) => i.value.includes('DECOY'));
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    return { found: true, type: el.getAttribute('type'), rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
  });
  report.masking = masking;
  console.log('\n=== masking check ===');
  console.log(JSON.stringify(masking));
  await page.screenshot({ path: path.join(OUT, 'key-field.png') });
  await orField.fill('').catch(() => {});

  // ------------------------------------------------ 2. collections picker
  await page.locator('[data-tour="collections"]').first().click().catch((e) => console.log('collections click:', e.message.split('\n')[0]));
  await page.waitForTimeout(3500);
  await page.screenshot({ path: path.join(OUT, 'collections-raw.png') });
  report.collections = await page.evaluate(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"], .card-modal')].find((d) => d.getBoundingClientRect().height > 200);
    if (!dialog) return null;
    const rows = [...dialog.querySelectorAll('label, li, div')].filter((e) => {
      const t = e.innerText?.trim() ?? '';
      return t.length > 0 && t.length < 60 && e.querySelector('input[type="checkbox"]');
    });
    return {
      rowCount: rows.length,
      sampleTags: rows.slice(0, 5).map((e) => `${e.tagName.toLowerCase()}.${e.className.toString().slice(0, 50)}`),
      sampleText: rows.slice(0, 8).map((e) => e.innerText.replace(/\s+/g, ' ').trim().slice(0, 40)),
      hasNodusTests: rows.some((e) => /nodus tests/i.test(e.innerText)),
      searchInputs: [...dialog.querySelectorAll('input:not([type="checkbox"])')].map((i) => i.getAttribute('placeholder')),
    };
  });
  console.log('\n=== collections picker ===');
  console.log(JSON.stringify(report.collections, null, 2)?.slice(0, 900));

  await writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(`\nscreenshots in ${path.relative(repoRoot, OUT)}`);
} finally {
  await app.close().catch(() => {});
  await rm(userData, { recursive: true, force: true }).catch(() => {});
}
