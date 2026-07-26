// What is actually in the "Main themes" modal, and how does it close?
//
// Three closing strategies have now failed in a row — a coordinate click, a "✕"
// text search, and firing the backdrop's click handler — each written from a guess
// about the markup. This dumps the real DOM instead: the overlay, its computed
// style, and every control inside it with the attributes that identify it.
//
//   node scripts/tutorial/probe-modal-dom.mjs

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

  await page.locator('[data-tour="nav-graph"]').first().click();
  await page.waitForTimeout(4000);
  await page.waitForTimeout(500);

  // What does the app expose about the graph, and what happens when the canvas is
  // clicked where a theme node is drawn? Labels are not in the DOM, so the only
  // route is coordinates — and those have to come from the app, not from guessing.
  const overview = await page.evaluate(async () => {
    const g = await window.nodus.getGraphOverview();
    const nodes = (g?.nodes ?? g ?? []).map((n) => ({
      id: n.id, label: n.label, type: n.type, size: n.size, x: n.x, y: n.y, ideas: n.ideas ?? n.count,
    }));
    return { count: nodes.length, sample: nodes.slice(0, 8), keys: Object.keys((g?.nodes ?? g ?? [])[0] ?? {}) };
  }).catch((e) => ({ error: String(e) }));
  console.log('graph overview:', JSON.stringify(overview, null, 1).slice(0, 1200));

  const canvases = await page.evaluate(() => [...document.querySelectorAll('canvas')].map((c) => {
    const r = c.getBoundingClientRect();
    return { cls: c.className?.toString().slice(0, 40), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }));
  console.log('canvases:', JSON.stringify(canvases).slice(0, 500));

  // No DOM handle, no coordinates from IPC, no suggestions, no chip. The labels are
  // painted onto a 2D canvas, though — and that one can be read. Find the label
  // clusters, and the node sits just to their left.
  const found = await page.evaluate(() => {
    const canvas = [...document.querySelectorAll('canvas')].find((c) => /sigma-labels/.test(c.className));
    if (!canvas) return { error: 'no sigma-labels canvas' };
    const ctx = canvas.getContext('2d');
    if (!ctx) return { error: 'no 2d context' };
    const rect = canvas.getBoundingClientRect();
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;

    // Ink = any reasonably opaque, dark pixel. Labels are dark text.
    const step = 4;
    const cells = new Map();
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const i = (y * width + x) * 4;
        const a = data[i + 3];
        if (a < 120) continue;
        const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
        if (lum > 120) continue;
        const key = `${Math.floor(x / 60)}:${Math.floor(y / 30)}`;
        const cell = cells.get(key) ?? { n: 0, sx: 0, sy: 0 };
        cell.n++; cell.sx += x; cell.sy += y;
        cells.set(key, cell);
      }
    }
    const scaleX = rect.width / width;
    const scaleY = rect.height / height;
    const clusters = [...cells.values()]
      .filter((c) => c.n > 12)
      .map((c) => ({ n: c.n, x: Math.round(rect.x + (c.sx / c.n) * scaleX), y: Math.round(rect.y + (c.sy / c.n) * scaleY) }))
      .sort((a, b) => b.n - a.n);
    return { canvasSize: { width, height }, rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }, clusters: clusters.slice(0, 10) };
  });
  console.log('label clusters:', JSON.stringify(found, null, 1).slice(0, 900));

  if (found?.clusters?.length) {
    // The dot sits a little to the left of its label.
    const target = found.clusters[0];
    await page.mouse.move(target.x - 90, target.y, { steps: 12 });
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(repoRoot, '.tutorial-out', 'academic', 'hover-node.png') });
    await page.mouse.click(target.x - 90, target.y);
    await page.waitForTimeout(2500);
    const after = await page.evaluate(() => {
      const main = document.querySelector('main');
      return { nodes: (document.body.innerText.match(/(\d+)\s+nodes/) ?? [])[1] ?? '?', text: (main?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 220) };
    });
    console.log('after clicking near the biggest label:', JSON.stringify(after));
    await page.screenshot({ path: path.join(repoRoot, '.tutorial-out', 'academic', 'node-clicked.png') });
  }

} finally {
  await app.close().catch(() => {});
}
