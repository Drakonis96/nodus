// How do you click a theme and then a node, when the graph is a WebGL canvas?
//
// Sigma draws nodes and labels into canvases, so there is nothing to select with a
// CSS selector and nothing to click by name. This finds a route that is both
// deterministic and worth filming, and checks the Search view's Meaning tab while
// it is here. Runs against the corpus probe-views.mjs already built.
//
//   node scripts/tutorial/probe-graph.mjs

import { mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const appVersion = require(path.join(repoRoot, 'package.json')).version;
const OUT = path.join(repoRoot, '.tutorial-out', 'academic');
const PROFILE = path.join(OUT, 'probe-profile');
const SHOTS = path.join(OUT, 'probe-graph');
await rm(SHOTS, { recursive: true, force: true });
await mkdir(SHOTS, { recursive: true });

const env = { ...process.env, NODUS_USERDATA: PROFILE, NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available' };
delete env.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env });
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
  await page.reload();
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length), { timeout: 30_000 });
  await page.waitForTimeout(2500);
  await page.locator('.backup-health-dismiss').first().click({ timeout: 2000 }).catch(() => {});

  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `${n}.png`) });

  /** Close any dialog by firing its backdrop's own handler. */
  const closeDialog = async () => {
    await page.evaluate(() => {
      const big = (el) => { const r = el.getBoundingClientRect(); return r.width > 200 && r.height > 200; };
      // Match the backdrop by what it *is* — a fixed, full-screen, stacked layer —
      // rather than by ARIA. Nodus has modals with no role="dialog" at all (the
      // Main themes one is a bare div), and those slipped through every check that
      // looked for the attribute.
      const overlay = [...document.querySelectorAll('div')].find((d) => {
        const cs = getComputedStyle(d);
        if (cs.position !== 'fixed') return false;
        const r = d.getBoundingClientRect();
        return r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.9
          && Number(cs.zIndex || 0) >= 40;
      });
      if (overlay) { overlay.click(); return true; }
      const card = [...document.querySelectorAll('[role="dialog"], .card-modal, [aria-modal="true"]')].find(big);
      if (card) { (card.parentElement ?? card).click(); return true; }
      return false;
    }).catch(() => {});
    await page.waitForTimeout(600);
  };


  // ── the themes overview, straight from the app ───────────────────────────
  const overview = await page.evaluate(() => window.nodus.stellarPage?.({kind:"search",limit:20}) ?? null).catch(() => null);
  if (overview) {
    const nodes = (overview.nodes ?? overview ?? []).slice(0, 12).map((n) => ({
      id: n.id ?? n.theme_id, label: n.label ?? n.name, size: n.size ?? n.count ?? n.ideas,
    }));
    console.log('graph overview from IPC:', JSON.stringify(nodes, null, 1).slice(0, 600));
  } else {
    console.log('no stellarPage');
  }

  await page.locator('[data-tour="nav-graph"]').first().click();
  await page.waitForTimeout(4500);
  await shot('01-graph');

  // ── route A: the graph's own search box ─────────────────────────────────
  const gsearch = page.locator('input[placeholder*="Search the graph"]').first();
  if (await gsearch.isVisible().catch(() => false)) {
    await gsearch.click();
    await gsearch.pressSequentially('Migración', { delay: 60 });
    await page.waitForTimeout(2500);
    await shot('02-graph-search');
    const after = await page.evaluate(() => {
      const main = document.querySelector('main');
      return (main?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 300);
    });
    console.log('after typing in the graph search:', after);

    // Does Enter, or a suggestion, focus the theme?
    await page.keyboard.press('Enter').catch(() => {});
    await page.waitForTimeout(2500);
    await shot('03-graph-search-enter');
    console.log('nodes now:', await page.evaluate(() => (document.body.innerText.match(/(\d+)\s+nodes/) ?? [])[1] ?? '?'));
  } else {
    console.log('no graph search box');
  }

  // ── are the node labels DOM, or painted into the canvas? ────────────────
  const labels = await page.evaluate(() => {
    const wanted = /MIGRACI|HISTORIA SOCIAL|METODOLOG/i;
    const hits = [];
    for (const el of document.querySelectorAll('main *')) {
      if (el.children.length) continue;
      const text = (el.textContent ?? '').trim();
      if (!text || text.length > 40 || !wanted.test(text)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 10) continue;
      hits.push({ text, tag: el.tagName, cls: el.className?.toString().slice(0, 40), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) });
    }
    return hits.slice(0, 10);
  });
  console.log('node labels found in the DOM:', JSON.stringify(labels, null, 1).slice(0, 700));

  // ── route B: the Themes button in the toolbar ───────────────────────────
  await page.locator('button:has-text("Themes")').first().click({ timeout: 5000 }).catch((e) => console.log('Themes button:', e.message.split('\n')[0]));
  await page.waitForTimeout(2500);
  await shot('04-themes-panel');
  const panel = await page.evaluate(() => {
    const main = document.querySelector('main');
    const rows = [...main.querySelectorAll('button, li')]
      .filter((e) => { const r = e.getBoundingClientRect(); return r.height > 20 && r.width > 120; })
      .map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim())
      .filter((t) => t && t.length < 60);
    return rows.slice(0, 16);
  });
  console.log('themes panel rows:', JSON.stringify(panel).slice(0, 400));
  // That button opens a management dialog, not a way to focus a theme — close it.
  await closeDialog();

  // ── the Search view, with the Meaning tab ───────────────────────────────
  await page.locator('[data-tour="nav-search"]').first().click();
  await page.waitForTimeout(2500);
  const meaning = page.locator('button:has-text("Meaning")').first();
  console.log('Meaning tab present:', await meaning.isVisible().catch(() => false));
  await meaning.click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const input = page.locator('main input.input, main input[placeholder]').first();
  await input.fill('');
  await input.pressSequentially('overland trail', { delay: 50 });
  await page.keyboard.press('Enter').catch(() => {});
  await page.waitForTimeout(5000);
  await shot('05-search-meaning');
  console.log('search (meaning):', await page.evaluate(() => {
    const m = document.querySelector('main');
    return (m?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 320);
  }));

  console.log(`\nscreenshots in ${path.relative(repoRoot, SHOTS)}`);
} finally {
  await app.close().catch(() => {});
}
