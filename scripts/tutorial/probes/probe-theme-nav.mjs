// Can a theme be entered through the DOM instead of the WebGL canvas?
//
// Clicking a node by pixel-hunting the label canvas found nothing, but the graph
// toolbar is ordinary DOM: a "N themes · click to explore" chip, a search box and
// a Themes button. If any of those drills into the biggest theme, the beat the
// user asked for is reachable without touching the canvas.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const appVersion = require(path.join(repoRoot, 'package.json')).version;
const PROFILE = path.join(repoRoot, '.tutorial-out', 'academic', 'probe-profile');
const env = { ...process.env, NODUS_USERDATA: PROFILE, NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available' };
delete env.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env });
const page = await app.firstWindow();
page.setDefaultTimeout(15_000);
await page.waitForLoadState('domcontentloaded');
await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length), { timeout: 30_000 });
await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0]; w.setContentSize(1600, 900); w.center();
});
await page.addInitScript((v) => {
  localStorage.setItem('nodus.lastSeenVersion', v);
  sessionStorage.setItem('nodus.startupUpdateChecked', '1');
}, appVersion);
await page.reload();
await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length), { timeout: 30_000 });
await page.waitForTimeout(2500);
await page.locator('.backup-health-dismiss').first().click({ timeout: 2000 }).catch(() => {});
await page.locator('[data-tour="nav-graph"]').first().click();
await page.waitForTimeout(4500);

const before = await page.evaluate(() => document.body.innerText.match(/(\d+)\s+nodes/)?.[1] ?? '?');
console.log('nodes before:', before);

const chip = page.locator('button:has-text("click to explore")').first();
console.log('themes chip visible:', await chip.isVisible().catch(() => false));
await chip.click({ timeout: 4000 }).catch((e) => console.log('chip click failed'));
await page.waitForTimeout(2500);
const afterChip = await page.evaluate(() => ({
  nodes: document.body.innerText.match(/(\d+)\s+nodes/)?.[1] ?? '?',
  text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 300),
}));
console.log('after chip:', JSON.stringify(afterChip));
await page.screenshot({ path: path.join(repoRoot, '.tutorial-out', 'academic', 'probe-graph', 'chip.png') });

// Whatever the chip opened, look for the biggest theme as a clickable row.
const rows = await page.evaluate(() => [...document.querySelectorAll('button, [role="button"], li')]
  .map((n) => (n.innerText ?? '').replace(/\s+/g, ' ').trim())
  .filter((t) => t && t.length < 60).slice(0, 40));
console.log('clickable rows:', JSON.stringify(rows).slice(0, 900));
await app.close().catch(() => {});
