// Check the three reworked beats before spending a take on them.
//
// Runs against the corpus probe-views.mjs built, so it costs seconds rather than a
// fifteen-minute recording:
//
//   1. opening an idea shows its source and supporting passage
//   2. the Meaning tab plus "overland trail" actually returns results
//   3. a Deep Research report card can be opened
//
//   node scripts/tutorial/probe-fixes.mjs

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
const SHOTS = path.join(OUT, 'probe-fixes');
await rm(SHOTS, { recursive: true, force: true });
await mkdir(SHOTS, { recursive: true });

const env = { ...process.env, NODUS_USERDATA: PROFILE, NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available' };
delete env.ELECTRON_RUN_AS_NODE;

const ok = (label, pass, extra = '') => console.log(`${pass ? '  ok  ' : ' FAIL '} ${label}${extra ? ' — ' + extra : ''}`);

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

  // ── 1. an idea, with its evidence ────────────────────────────────────────
  await page.locator('[data-tour="nav-ideas"]').first().click();
  await page.waitForTimeout(2500);
  const cards = await page.locator('main button.card').count();
  await page.locator('main button.card').first().click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(1800);
  const detail = await page.evaluate(() => {
    const t = document.querySelector('main')?.innerText ?? '';
    return {
      hasDetail: /detail/i.test(t),
      hasEvidence: /anchored evidence|evidencia/i.test(t),
      hasSource: /works that develop it|zotero/i.test(t),
      excerpt: t.replace(/\s+/g, ' ').slice(0, 200),
    };
  });
  ok('idea cards present', cards > 0, `${cards} cards`);
  ok('detail panel opened', detail.hasDetail);
  ok('shows supporting evidence', detail.hasEvidence);
  ok('shows the source work', detail.hasSource);
  await page.screenshot({ path: path.join(SHOTS, 'idea.png') });

  // ── 2. semantic search ───────────────────────────────────────────────────
  await page.locator('[data-tour="nav-search"]').first().click();
  await page.waitForTimeout(2200);
  const meaningTab = page.locator('main button:has-text("Meaning")').first();
  ok('Meaning tab present', await meaningTab.isVisible().catch(() => false));
  await meaningTab.click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(900);
  const input = page.locator('main input.input, main input[placeholder]').first();
  await input.click();
  await input.fill('');
  await input.pressSequentially('overland trail', { delay: 45 });
  await page.keyboard.press('Enter').catch(() => {});
  await page.waitForTimeout(5000);
  const hits = await page.evaluate(() => {
    const t = document.querySelector('main')?.innerText ?? '';
    return { n: Number((t.match(/(\d+)\s+result/i) ?? [])[1] ?? 0), excerpt: t.replace(/\s+/g, ' ').slice(0, 200) };
  });
  ok('search returns results', hits.n > 0, `${hits.n} results`);
  await page.screenshot({ path: path.join(SHOTS, 'search.png') });

  // ── 3. the Deep Research report ──────────────────────────────────────────
  await page.locator('[data-tour="nav-deepResearch"]').first().click();
  await page.waitForTimeout(2500);
  const dr = await page.evaluate(() => {
    const t = document.querySelector('main')?.innerText ?? '';
    return { empty: /no reports yet/i.test(t), excerpt: t.replace(/\s+/g, ' ').slice(0, 160) };
  });
  if (dr.empty) {
    console.log('  --   no report in the probe corpus (the tutorial creates one) — card opening untested here');
  } else {
    const card = page.locator('main button, main article, main [role="button"]')
      .filter({ hasNotText: /^(new report|tutorial|most recent|oldest|by title)/i }).first();
    const box = await card.boundingBox().catch(() => null);
    await card.click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const opened = await page.evaluate(() => (document.querySelector('main')?.innerText ?? '').length);
    ok('report card opens', Boolean(box) && opened > 400, `${opened} chars`);
  }
  await page.screenshot({ path: path.join(SHOTS, 'deep-research.png') });

  console.log(`\nscreenshots in ${path.relative(repoRoot, SHOTS)}`);
} finally {
  await app.close().catch(() => {});
}
