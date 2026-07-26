// Why does the scan pause?
//
// The queue pauses on an AiError flagged as a configuration problem, and the UI
// then tries to translate that error and prints "This message could not be
// translated" — hiding the only useful information. This reproduces the setup the
// recorder performs and reads `pausedReason` straight from the queue instead.
//
//   node scripts/tutorial/probe-scan.mjs

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const appVersion = require(path.join(repoRoot, 'package.json')).version;

const readKey = async (n) => {
  const f = path.join(os.homedir(), '.config', 'nodus', n);
  return existsSync(f) ? (await readFile(f, 'utf8')).trim() : null;
};
const OR = await readKey('openrouter-app.key');
const GEM = await readKey('gemini-app.key');

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-scanprobe-'));
const env = { ...process.env, NODUS_USERDATA: userData, NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available' };
delete env.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env });
// Surface the main process log: the real cause is printed there by scanQueue.
app.process().stderr.on('data', (d) => {
  const line = String(d);
  if (/scanQueue|AiError|configuraci|model|key/i.test(line)) process.stdout.write(`[main] ${line}`);
});

try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(20_000);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length), { timeout: 30_000 });
  await page.addInitScript((v) => {
    localStorage.setItem('nodus.lastSeenVersion', v);
    sessionStorage.setItem('nodus.startupUpdateChecked', '1');
  }, appVersion);
  await page.evaluate(() => window.nodus.updateSettings({
    uiLanguage: 'en', basicsTutorialVersion: 9999, onboardingComplete: true,
    recoverySetupVersion: 9999, mascotStyleChosen: true, tourComplete: true,
    advancedTourComplete: true, genealogyTourComplete: true, databasesTourComplete: true,
    studyTourComplete: true, docenciaTourComplete: true,
  }));

  // Exactly what the recorder does.
  await page.evaluate(async ({ or, gem }) => {
    await window.nodus.setApiKey('openrouter', or);
    await window.nodus.setApiKey('gemini', gem);
  }, { or: OR, gem: GEM });

  await page.evaluate(() => window.nodus.updateSettings({
    modelSettingsMode: 'advanced',
    extractionModel: { provider: 'gemini', model: 'gemini-2.5-flash-lite' },
    synthesisModel: { provider: 'gemini', model: 'gemini-2.5-flash-lite' },
    chatModel: { provider: 'gemini', model: 'gemini-2.5-flash-lite' },
    summaryModel: { provider: 'gemini', model: 'gemini-2.5-flash-lite' },
    visionModel: { provider: 'gemini', model: 'gemini-2.5-flash-lite' },
    embeddingProvider: 'openrouter',
    embeddingModel: 'baai/bge-m3',
  }));
  await page.reload();
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length), { timeout: 30_000 });
  await page.waitForTimeout(2500);

  const settings = await page.evaluate(() => window.nodus.getSettings());
  console.log('\n=== what the app actually stored ===');
  for (const k of ['modelSettingsMode', 'extractionModel', 'synthesisModel', 'summaryModel', 'embeddingProvider', 'embeddingModel']) {
    console.log(` ${k}:`, JSON.stringify(settings[k]));
  }
  const keys = await page.evaluate(() => window.nodus.getProviderKeys?.() ?? null);
  console.log(' provider keys:', JSON.stringify(keys));

  // Monitor the target collection and sync, then scan one work.
  const cols = await page.evaluate(() => window.nodus.zoteroCollections());
  const target = (cols ?? []).find((c) => (c.name ?? '') === 'Nodus Tests');
  console.log('\ntarget collection:', target ? `${target.name} (${target.key})` : 'NOT FOUND');
  if (target) {
    await page.evaluate((k) => window.nodus.updateSettings({ monitoredCollections: [k] }), target.key);
    await page.evaluate(() => window.nodus.syncNow());
    await page.waitForTimeout(12_000);
    const works = await page.evaluate(() => window.nodus.listWorks({}));
    console.log('works imported:', Array.isArray(works) ? works.length : JSON.stringify(works).slice(0,200));
    if (Array.isArray(works) && works.length) {
      // The scan is launched from inside the collections modal — its toolbar has
      // Ideas / Both / Summary — not from the Library, which shows zero works.
      await page.locator('[data-tour="nav-library"]').first().click().catch(() => {});
      await page.waitForTimeout(2500);
      await page.locator('[data-tour="collections"]').first().click().catch(() => {});
      await page.waitForTimeout(4000);
      const row = page.locator('span.flex-1.truncate:text-is("Nodus Tests")').first();
      await row.click({ timeout: 8000 }).catch((e) => console.log('row click:', e.message.split('\n')[0]));
      await page.waitForTimeout(3500);

      // Tick every item in the list, which is what "incorporate and analyse" means.
      const ticked = await page.evaluate(() => {
        const boxes = [...document.querySelectorAll('input[type="checkbox"]')]
          .filter((b) => { const r = b.getBoundingClientRect(); return r.width > 6 && r.y > 300; });
        let n = 0;
        for (const b of boxes) if (!b.checked) { b.click(); n++; }
        return n;
      });
      console.log('items ticked:', ticked);
      await page.waitForTimeout(3000);

      const both = page.locator('button:has-text("Both")').first();
      if (await both.isVisible().catch(() => false)) { await both.click(); console.log('clicked Both'); }
      else console.log('no Both button in modal');

      for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(3000);
        const q = await page.evaluate(() => window.nodus.getQueue());
        if (q?.pausedReason) { console.log('\n*** PAUSED REASON:', q.pausedReason); break; }
        if (i === 1) {
          const detail = await page.evaluate(() => {
            const q = window.nodus.getQueue();
            return q;
          }).then((x) => x).catch(() => null);
          console.log('FULL QUEUE:', JSON.stringify(detail).slice(0, 1500));
        }
        if (i % 3 === 0) console.log(`  t+${i * 3}s total=${q?.total} done=${q?.done} failed=${q?.failed} paused=${q?.paused} current=${q?.current?.state ?? '-'} items=${(q?.items ?? []).length}`);
      }
    }
  }
} finally {
  await app.close().catch(() => {});
  await rm(userData, { recursive: true, force: true }).catch(() => {});
}
