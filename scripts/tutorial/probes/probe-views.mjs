// Work out how the analysis views actually behave, against a vault that is already
// scanned.
//
// Every previous attempt at these beats cost a fifteen-minute recording, because
// the throwaway profile took the scan with it. This keeps one profile on disk: the
// first run does the setup and the scan, every run after that starts from a corpus
// that is already there and can iterate in seconds.
//
//   node scripts/tutorial/probe-views.mjs          # explore
//   node scripts/tutorial/probe-views.mjs --reset  # rebuild the corpus first
//
// Nothing here touches the installed Nodus: the profile lives under .tutorial-out.

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { SCAN_TITLES, TARGET_COLLECTION } from './shots-academic.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const appVersion = require(path.join(repoRoot, 'package.json')).version;
const OUT = path.join(repoRoot, '.tutorial-out', 'academic');
const PROFILE = path.join(OUT, 'probe-profile');
const SHOTS_DIR = path.join(OUT, 'probe-views');

const reset = process.argv.includes('--reset');
if (reset) await rm(PROFILE, { recursive: true, force: true });
const fresh = !existsSync(path.join(PROFILE, 'secrets'));
await mkdir(PROFILE, { recursive: true });
await rm(SHOTS_DIR, { recursive: true, force: true });
await mkdir(SHOTS_DIR, { recursive: true });

const readKey = async (n) => {
  const f = path.join(os.homedir(), '.config', 'nodus', n);
  return existsSync(f) ? (await readFile(f, 'utf8')).trim() : null;
};
const KEYS = { openrouter: await readKey('openrouter-app.key'), gemini: await readKey('gemini-app.key') };

const env = { ...process.env, NODUS_USERDATA: PROFILE, NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available' };
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

  if (fresh) {
    console.log('building the corpus (first run only — this takes a while)…');
    await mkdir(path.join(PROFILE, 'secrets'), { recursive: true });
    for (const p of ['openrouter', 'gemini']) {
      await writeFile(path.join(PROFILE, 'secrets', `ai_key_${p}.bin`),
        `b64:${Buffer.from(KEYS[p], 'utf8').toString('base64')}`, 'utf8');
    }
    await page.evaluate(() => window.nodus.updateSettings({
      modelSettingsMode: 'advanced',
      extractionModel: { provider: 'gemini', model: 'gemini-3.1-flash-lite' },
      synthesisModel: { provider: 'gemini', model: 'gemini-3.1-flash-lite' },
      chatModel: { provider: 'gemini', model: 'gemini-3.1-flash-lite' },
      summaryModel: { provider: 'gemini', model: 'gemini-3.1-flash-lite' },
      visionModel: { provider: 'gemini', model: 'gemini-3.1-flash-lite' },
      embeddingProvider: 'openrouter', embeddingModel: 'baai/bge-m3',
    }));
    await page.reload();
    await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length), { timeout: 30_000 });
    await page.waitForTimeout(2500);

    const cols = await page.evaluate(() => window.nodus.zoteroCollections());
    const target = (cols ?? []).find((c) => c.name === TARGET_COLLECTION) ?? (cols ?? []).find((c) => c.name === 'Nodus Tests');
    if (!target) throw new Error('Zotero must be running with the Nodus Tests collection');
    await page.evaluate((k) => window.nodus.updateSettings({ monitoredCollections: [k] }), target.key);
    await page.evaluate(() => window.nodus.syncNow());
    await page.waitForTimeout(12_000);

    await page.locator('[data-tour="nav-library"]').first().click().catch(() => {});
    await page.waitForTimeout(2000);
    await page.locator('[data-tour="collections"]').first().click().catch(() => {});
    await page.waitForTimeout(4000);
    await page.locator(`span.flex-1.truncate:text-is("${TARGET_COLLECTION}")`).first().click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(3500);
    for (let pass = 0; pass < 12; pass++) {
      const done = await page.evaluate((titles) => {
        let hits = 0;
        for (const label of document.querySelectorAll('div.truncate.text-sm')) {
          const text = (label.textContent ?? '').trim();
          if (!titles.some((t) => text.includes(t))) continue;
          const box = label.closest('div.flex')?.querySelector('input[type="checkbox"]');
          if (box) { if (!box.checked) box.click(); hits++; }
        }
        return hits;
      }, SCAN_TITLES).catch(() => 0);
      if (done >= SCAN_TITLES.length) break;
      await page.evaluate(() => {
        const list = [...document.querySelectorAll('div')].find((d) => d.scrollHeight > d.clientHeight + 40 && d.clientHeight > 200);
        if (list) list.scrollTop += list.clientHeight * 0.8;
      }).catch(() => {});
      await page.waitForTimeout(700);
    }
    await page.waitForTimeout(2500);
    // Close the dialog by firing the backdrop's own handler.
    await page.evaluate(() => {
      const h = [...document.querySelectorAll('h2')].find((x) => /zotero collections/i.test(x.textContent ?? ''));
      let card = h;
      while (card && card.getBoundingClientRect().height < 200) card = card.parentElement;
      card?.parentElement?.click();
    });

    let idle = 0;
    for (let i = 0; i < 400 && idle < 10; i++) {
      await page.waitForTimeout(3000);
      const q = await page.evaluate(() => window.nodus.getQueue()).catch(() => null);
      const running = (q?.items ?? []).find((it) => it.state === 'running');
      const quiet = (q?.total ?? 0) > 0 && (q?.done ?? 0) + (q?.failed ?? 0) >= q.total && !running;
      idle = quiet ? idle + 1 : 0;
      if (i % 10 === 0) console.log(`  ${q?.done ?? 0}/${q?.total ?? 0}` + (running ? ` · ${running.detail ?? running.kind}` : ' · idle'));
    }
    console.log('corpus ready.\n');
  } else {
    console.log('reusing the existing corpus.\n');
  }

  const shot = (n) => page.screenshot({ path: path.join(SHOTS_DIR, `${n}.png`) });

  // ── 1. the graph: themes, and what clicking one does ─────────────────────
  await page.locator('[data-tour="nav-graph"]').first().click();
  await page.waitForTimeout(4000);
  const themes = await page.evaluate(() => {
    const chip = [...document.querySelectorAll('button, div')]
      .find((e) => /themes · click to explore/i.test(e.textContent ?? '') && e.getBoundingClientRect().height < 60);
    return {
      chipText: chip?.textContent?.trim() ?? null,
      chipTag: chip?.tagName ?? null,
      nodeCount: (document.body.innerText.match(/(\d+)\s+nodes/) ?? [])[1] ?? null,
      canvases: document.querySelectorAll('canvas').length,
    };
  });
  console.log('graph:', JSON.stringify(themes));
  await shot('graph');

  // What does the themes chip open?
  await page.locator('text=/themes · click to explore/i').first().click({ timeout: 5000 }).catch((e) => console.log('theme chip:', e.message.split('\n')[0]));
  await page.waitForTimeout(2500);
  const themeList = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('button, li, div')]
      .filter((e) => { const r = e.getBoundingClientRect(); return r.height > 24 && r.height < 90 && r.width > 150; })
      .map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim())
      .filter((t) => t && t.length < 70);
    return rows.slice(0, 14);
  });
  console.log('after clicking the themes chip:', JSON.stringify(themeList, null, 1).slice(0, 700));
  await shot('themes-open');

  // ── 2. search ────────────────────────────────────────────────────────────
  await page.locator('[data-tour="nav-search"]').first().click();
  await page.waitForTimeout(2500);
  for (const q of ['women', 'overland trail', 'food']) {
    const input = page.locator('main input.input, main input[placeholder]').first();
    await input.fill('');
    await input.pressSequentially(q, { delay: 40 });
    await page.keyboard.press('Enter').catch(() => {});
    await page.waitForTimeout(4000);
    const res = await page.evaluate(() => {
      const main = document.querySelector('main');
      const text = (main?.innerText ?? '').replace(/\s+/g, ' ');
      return { chars: text.length, preview: text.slice(0, 220) };
    });
    console.log(`search "${q}": ${res.chars} chars — ${res.preview}`);
    await shot(`search-${q.replace(/\s+/g, '-')}`);
  }

  // ── 3. deep research: is there a report to open? ──────────────────────────
  await page.locator('[data-tour="nav-deepResearch"]').first().click();
  await page.waitForTimeout(3000);
  const dr = await page.evaluate(() => {
    const main = document.querySelector('main');
    return {
      text: (main?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 300),
      cards: [...main.querySelectorAll('button, article, [role="button"]')]
        .filter((e) => e.getBoundingClientRect().height > 60)
        .map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)).slice(0, 6),
    };
  });
  console.log('deep research:', JSON.stringify(dr, null, 1).slice(0, 600));
  await shot('deep-research');

  console.log(`\nscreenshots in ${path.relative(repoRoot, SHOTS_DIR)}`);
} finally {
  await app.close().catch(() => {});
}
