// Diagnostic for the rewritten tutorial: find the real anchors for every new beat
// in one run, so the shot list is written against the actual DOM.
//
// Covers: the vault-type cards (highlighted one at a time), the Ideas detail panel,
// the Nodi settings section, the basic/advanced model switch, and the OpenRouter
// model list once a key is loaded.
//
//   node scripts/tutorial/probe-ui.mjs

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const appVersion = require(path.join(repoRoot, 'package.json')).version;
const OUT = path.join(repoRoot, '.tutorial-out', 'probe-ui');
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

// The app-demo key is deliberately a different one from the narration key, so
// filming model lists cannot eat the text-to-speech budget.
const appKeyFile = path.join(os.homedir(), '.config', 'nodus', 'openrouter-app.key');
const appKey = existsSync(appKeyFile) ? (await readFile(appKeyFile, 'utf8')).trim() : null;

const zotero = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Last-Modified-Version', '7');
  res.end('[]');
});
zotero.listen(0, '127.0.0.1');
await once(zotero, 'listening');

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-probeui-'));
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
  page.setDefaultTimeout(15_000);
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
  await page.evaluate(() => window.nodus.seedDemoData());
  if (appKey) {
    // Loaded through IPC on purpose: the key must never be typed on camera.
    const ok = await page.evaluate(async (k) => {
      try { await window.nodus.setApiKey('openrouter', k); return true; } catch (e) { return String(e); }
    }, appKey);
    console.log('setApiKey(openrouter):', ok);
  }
  await page.reload();
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length), { timeout: 30_000 });
  await page.waitForTimeout(2500);

  const rect = async (sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), visible: r.width > 4 && r.height > 4 };
  }, sel);

  // ---------------------------------------------------------- vault types
  await page.locator('[data-vault-trigger]').first().click();
  await page.waitForTimeout(900);
  await page.locator('button[title="Add vault"]').first().click();
  await page.waitForTimeout(1200);
  report.vaultCards = await page.evaluate(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].find((d) => d.getBoundingClientRect().height > 200);
    if (!dialog) return null;
    return [...dialog.querySelectorAll('button')]
      .map((b, i) => ({ i, text: b.innerText.replace(/\s+/g, ' ').trim().slice(0, 48), r: (({ x, y, width, height }) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(width), h: Math.round(height) }))(b.getBoundingClientRect()) }))
      .filter((b) => b.r.h > 60);
  });
  console.log('\n=== vault type cards ===');
  for (const c of report.vaultCards ?? []) console.log(` [${c.i}] ${c.text.padEnd(50)} ${JSON.stringify(c.r)}`);
  await page.screenshot({ path: path.join(OUT, 'vault-modal.png') });
  await page.locator('[role="dialog"] button:text-is("Cancel")').first().click().catch(() => {});
  await page.waitForTimeout(600);

  // --------------------------------------------------------------- ideas
  await page.locator('[data-tour="nav-ideas"]').first().click();
  await page.waitForTimeout(2200);
  report.ideaRows = await page.evaluate(() => {
    const main = document.querySelector('main');
    const rows = [...main.querySelectorAll('button, li, [role="button"]')].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.height > 30 && r.height < 200 && r.width > 300 && r.y > 100;
    });
    return rows.slice(0, 4).map((e) => ({
      tag: e.tagName.toLowerCase(),
      cls: e.className.toString().slice(0, 70),
      text: e.innerText.replace(/\s+/g, ' ').trim().slice(0, 60),
    }));
  });
  console.log('\n=== candidate idea rows ===');
  for (const r of report.ideaRows ?? []) console.log(` ${r.tag}.${r.cls}\n   "${r.text}"`);
  // Click the first plausible row and see what appears.
  const firstRow = page.locator('main button').filter({ hasNotText: /^$/ }).nth(3);
  await firstRow.click({ timeout: 4000 }).catch((e) => console.log('idea click failed:', e.message.split('\n')[0]));
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(OUT, 'idea-detail.png') });
  report.ideaPanelHeadings = await page.evaluate(() =>
    [...document.querySelectorAll('main h2, main h3, main [class*="font-semibold"]')]
      .map((e) => e.textContent.trim().slice(0, 50)).filter(Boolean).slice(0, 10));
  console.log('\n=== after clicking an idea ===');
  console.log(' headings:', report.ideaPanelHeadings.join(' | '));

  // ------------------------------------------------------------- settings
  await page.locator('[data-tour="nav-settings"]').first().click();
  await page.waitForTimeout(2000);
  const search = page.locator('main input[placeholder*="ettings"]').first();

  for (const [label, term] of [['nodi', 'Nodi'], ['models', 'model'], ['embeddings', 'embedding'], ['server', 'server'], ['mcp', 'MCP']]) {
    await search.fill('');
    await page.waitForTimeout(250);
    await search.pressSequentially(term, { delay: 30 });
    await page.waitForTimeout(1100);
    const info = await page.evaluate(() => {
      const main = document.querySelector('main');
      return {
        value: main.querySelector('input[placeholder*="ettings"]')?.value,
        chars: (main.innerText ?? '').replace(/\s+/g, ' ').length,
        sections: [...main.querySelectorAll('[data-testid]')].filter((e) => e.getBoundingClientRect().height > 40).map((e) => e.getAttribute('data-testid')).slice(0, 8),
        headings: [...main.querySelectorAll('h2,h3')].map((e) => e.textContent.trim().slice(0, 40)).filter(Boolean).slice(0, 6),
      };
    });
    report[`settings_${label}`] = info;
    console.log(`\n=== settings "${term}" (field="${info.value}") ===`);
    console.log(' sections:', info.sections.join(', ') || '-');
    console.log(' headings:', info.headings.join(' | '));
    await page.screenshot({ path: path.join(OUT, `settings-${label}.png`) });
  }

  // basic vs advanced switch
  report.modeSwitch = await rect('[data-testid="model-settings-mode"]');
  console.log('\nmodel-settings-mode rect:', JSON.stringify(report.modeSwitch));
  report.modeButtons = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="model-settings-mode"]');
    return el ? [...el.querySelectorAll('button')].map((b) => b.innerText.trim()) : null;
  });
  console.log('mode buttons:', JSON.stringify(report.modeButtons));

  // OpenRouter provider row and its model list, now that a key is loaded
  await search.fill('');
  await page.waitForTimeout(300);
  await page.locator('[data-testid="provider-openrouter"]').first().click({ timeout: 5000 }).catch((e) => console.log('openrouter click:', e.message.split('\n')[0]));
  await page.waitForTimeout(3500);
  await page.screenshot({ path: path.join(OUT, 'openrouter-open.png') });
  report.openrouter = await page.evaluate(() => {
    const row = document.querySelector('[data-testid="provider-openrouter"]');
    const scope = row?.parentElement ?? document;
    return {
      rowText: row?.innerText.replace(/\s+/g, ' ').slice(0, 120),
      inputs: [...scope.querySelectorAll('input')].map((i) => ({ ph: i.getAttribute('placeholder'), type: i.getAttribute('type'), cls: i.className.slice(0, 40) })).slice(0, 6),
      testids: [...scope.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid')).slice(0, 12),
      modelCount: scope.querySelectorAll('[class*="model"]').length,
    };
  });
  console.log('\n=== openrouter row ===');
  console.log(JSON.stringify(report.openrouter, null, 2).slice(0, 1200));

  await writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(`\nscreenshots in ${path.relative(repoRoot, OUT)}`);
} finally {
  await app.close().catch(() => {});
  await new Promise((r) => zotero.close(r));
  await rm(userData, { recursive: true, force: true }).catch(() => {});
}
