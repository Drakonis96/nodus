// Diagnostic: which Settings search terms actually reveal something, and does the
// add-vault modal show the vault types?
//
// Filming a search that returns nothing is worse than not searching at all — the
// viewer watches text being typed into an empty page. So every term the shot list
// types is verified here first.
//
//   node scripts/tutorial/probe-terms.mjs

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
const appVersion = require(path.join(repoRoot, 'package.json')).version;
const OUT = path.join(repoRoot, '.tutorial-out', 'probe-terms');
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const TERMS = ['embedding', 'model', 'Ollama', 'API key', 'Groq', 'audio', 'MCP', 'voice', 'server', 'Zotero', 'image'];

const zotero = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Last-Modified-Version', '7');
  res.end('[]');
});
zotero.listen(0, '127.0.0.1');
await once(zotero, 'listening');

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-terms-'));
const env = {
  ...process.env,
  NODUS_USERDATA: userData,
  NODUS_DISABLE_AUTO_UPDATE: '1',
  NODUS_E2E_UPDATE_STATUS: 'not-available',
  NODUS_ZOTERO_API_BASE: `http://127.0.0.1:${zotero.address().port}/api`,
};
delete env.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env });
try {
  const page = await app.firstWindow();
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
  await page.reload();
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length), { timeout: 30_000 });
  await page.waitForTimeout(3000);

  // Is the orb skin actually the one on screen?
  const nodi = await page.evaluate(() => {
    const root = document.querySelector('.nodi-companion');
    const anchor = document.querySelector('.nodi-anchor');
    return {
      companion: Boolean(root),
      classes: root?.className ?? null,
      anchorRect: anchor ? anchor.getBoundingClientRect().toJSON() : null,
      orbNodes: document.querySelectorAll('[class*="orb"]').length,
    };
  });
  console.log('nodi:', JSON.stringify(nodi));

  // Settings search terms.
  await page.locator('[data-tour="nav-settings"]').first().click();
  await page.waitForTimeout(2000);
  const search = page.locator('main input[placeholder*="ettings"]').first();
  const results = {};
  for (const term of TERMS) {
    await search.fill('');
    await page.waitForTimeout(300);
    await search.fill(term);
    await page.waitForTimeout(900);
    const info = await page.evaluate(() => {
      const main = document.querySelector('main');
      const text = (main?.innerText ?? '').replace(/\s+/g, ' ').trim();
      const cards = [...main.querySelectorAll('[data-testid]')].filter((e) => {
        const r = e.getBoundingClientRect();
        return r.height > 40 && r.width > 200;
      }).map((e) => e.getAttribute('data-testid'));
      return { chars: text.length, preview: text.slice(0, 110), cards: cards.slice(0, 6) };
    });
    results[term] = info;
    console.log(`${term.padEnd(10)} chars=${String(info.chars).padEnd(6)} cards=${info.cards.join(',') || '-'}`);
    console.log(`${' '.repeat(11)}${info.preview}`);
  }
  await writeFile(path.join(OUT, 'terms.json'), JSON.stringify(results, null, 2), 'utf8');

  // The add-vault modal, which is how a viewer sees the vault types on offer.
  await page.locator('[data-vault-trigger]').first().click({ timeout: 5000 }).catch((e) => console.log('vault trigger:', e.message.split('\n')[0]));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(OUT, 'vault-menu.png') });
  const addBtn = page.locator('button[title="Add vault"]').first();
  console.log(`add-vault button count=${await addBtn.count()}`);
  await addBtn.click({ timeout: 5000 }).catch((e) => console.log('add click:', e.message.split('\n')[0]));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, 'vault-add-modal.png') });
  const modal = await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')];
    const d = dialogs.find((x) => x.getBoundingClientRect().height > 200);
    if (!d) return null;
    return {
      rect: d.getBoundingClientRect().toJSON(),
      text: d.innerText.replace(/\s+/g, ' ').slice(0, 300),
      buttons: [...d.querySelectorAll('button')].map((b) => b.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 14),
    };
  });
  console.log('add modal:', JSON.stringify(modal, null, 2));
} finally {
  await app.close().catch(() => {});
  await new Promise((r) => zotero.close(r));
  await rm(userData, { recursive: true, force: true }).catch(() => {});
}
