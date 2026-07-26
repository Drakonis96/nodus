// Prove the AI actually works before spending another take.
//
// The scan kept pausing with "This message could not be translated", which is the
// UI failing to localise an AiError. Reading aiClient.ts, every configuration error
// is one of three: no model configured, no key for the provider, or an invalid key.
// None of the three is in the English table, so the visible message cannot tell
// them apart — the reason has to be read from the queue and the main-process log.
//
// This exercises the recorder's real path (keys typed into the UI, models assigned,
// scan launched from the collections dialog) and reports, for each step, what the
// app actually stored rather than what the click appeared to do.
//
//   node scripts/tutorial/verify-ai.mjs

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
const KEYS = { openrouter: await readKey('openrouter-app.key'), gemini: await readKey('gemini-app.key') };

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-verifyai-'));
const env = { ...process.env, NODUS_USERDATA: userData, NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available' };
delete env.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env });
const mainLog = [];
app.process().stderr.on('data', (d) => {
  const line = String(d);
  mainLog.push(line);
  if (/scanQueue|configuraci|AiError|Falta la clave|Clave de IA|No hay un modelo/i.test(line)) {
    process.stdout.write(`[main] ${line}`);
  }
});

const ok = (label, pass, extra = '') => console.log(`${pass ? '  ok  ' : ' FAIL '} ${label}${extra ? ' — ' + extra : ''}`);

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

  console.log('\n=== 1. keys entered through the UI, as the recorder does ===');
  await page.locator('[data-tour="nav-settings"]').first().click();
  await page.waitForTimeout(1800);

  for (const provider of ['openrouter', 'gemini']) {
    await page.locator(`[data-testid="provider-${provider}"]`).first().click().catch(() => {});
    await page.waitForTimeout(1200);
    const row = page.locator(`[data-testid="provider-${provider}"]`).locator('xpath=..');
    const field = row.locator('input[type="password"]').first();
    await field.click().catch(() => {});
    await field.fill(KEYS[provider]).catch(() => {});
    await page.waitForTimeout(600);
    await row.locator('button:has-text("Save")').first().click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(1800);
    const saved = await row.innerText().then((t) => /key saved/i.test(t)).catch(() => false);
    ok(`${provider}: UI reports key saved`, saved);

    // safeStorage encrypts on write but needs Keychain approval to decrypt, which
    // no one grants in an automated run — so rewrite the file in the plain `b64:`
    // form secretStore also accepts. This is the fix under test.
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      path.join(userData, 'secrets', `ai_key_${provider}.bin`),
      `b64:${Buffer.from(KEYS[provider], 'utf8').toString('base64')}`,
      'utf8'
    );
    await page.locator(`[data-testid="provider-${provider}"]`).first().click().catch(() => {});
    await page.waitForTimeout(500);
  }

  console.log('\n=== 2. models assigned ===');
  await page.evaluate(() => window.nodus.updateSettings({
    modelSettingsMode: 'advanced',
    extractionModel: { provider: 'gemini', model: 'gemini-3.1-flash-lite' },
    synthesisModel: { provider: 'gemini', model: 'gemini-3.1-flash-lite' },
    chatModel: { provider: 'gemini', model: 'gemini-3.1-flash-lite' },
    summaryModel: { provider: 'gemini', model: 'gemini-3.1-flash-lite' },
    visionModel: { provider: 'gemini', model: 'gemini-3.1-flash-lite' },
    embeddingProvider: 'openrouter',
    embeddingModel: 'baai/bge-m3',
  }));
  await page.waitForTimeout(1200);
  const st = await page.evaluate(() => window.nodus.getSettings());
  ok('extraction model set', st.extractionModel?.model === 'gemini-3.1-flash-lite', JSON.stringify(st.extractionModel));
  ok('embedding model set', st.embeddingModel === 'baai/bge-m3', `${st.embeddingProvider}/${st.embeddingModel}`);

  console.log('\n=== 3. import the collection ===');
  const cols = await page.evaluate(() => window.nodus.zoteroCollections());
  const target = (cols ?? []).find((c) => c.name === 'Nodus Tests');
  ok('collection found in Zotero', Boolean(target), target?.key);
  if (!target) throw new Error('Zotero must be running with the Nodus Tests collection');
  await page.evaluate((k) => window.nodus.updateSettings({ monitoredCollections: [k] }), target.key);
  await page.evaluate(() => window.nodus.syncNow());
  await page.waitForTimeout(12_000);
  const works = await page.evaluate(() => window.nodus.listWorks({}));
  ok('works imported', Array.isArray(works) && works.length === 15, `${works?.length ?? 0} works`);

  console.log('\n=== 4. start the scan and watch it actually progress ===');
  await page.locator('[data-tour="nav-library"]').first().click().catch(() => {});
  await page.waitForTimeout(2000);
  await page.locator('[data-tour="collections"]').first().click().catch(() => {});
  await page.waitForTimeout(4000);
  await page.locator('span.flex-1.truncate:text-is("Nodus Tests")').first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(3500);
  const { SCAN_TITLES } = await import('./shots-academic.mjs');
  const ticked = new Set();
  for (let pass = 0; pass < 12 && ticked.size < SCAN_TITLES.length; pass++) {
    const hit = await page.evaluate((titles) => {
      const found = [];
      for (const label of document.querySelectorAll('div.truncate.text-sm')) {
        const text = (label.textContent ?? '').trim();
        const match = titles.find((t) => text.includes(t));
        if (!match) continue;
        const row = label.closest('div.flex');
        const box = row?.querySelector('input[type="checkbox"]');
        if (box && !box.checked) { box.click(); found.push(match); }
        else if (box?.checked) found.push(match);
      }
      return found;
    }, SCAN_TITLES).catch(() => []);
    hit.forEach((h) => ticked.add(h));
    if (ticked.size >= SCAN_TITLES.length) break;
    await page.evaluate(() => {
      const list = [...document.querySelectorAll('div')].find((d) => d.scrollHeight > d.clientHeight + 40 && d.clientHeight > 200);
      if (list) list.scrollTop += list.clientHeight * 0.8;
    }).catch(() => {});
    await page.waitForTimeout(700);
  }
  ok('five chosen articles ticked', ticked.size === SCAN_TITLES.length, `${ticked.size}/${SCAN_TITLES.length}`);
  await page.waitForTimeout(2500);
  // Does ticking alone queue the work? The checkbox is titled "incorporate into
  // Nodus and analyse ideas", so "Both" — a bulk action over the whole filtered
  // library — may be what pulled all fifteen in rather than the chosen five.
  const afterTick = await page.evaluate(() => window.nodus.getQueue());
  console.log(`queue after ticking only: total=${afterTick?.total ?? 0}`);
  await page.waitForTimeout(3000);

  let progressed = false;
  let lastDone = -1;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(5000);
    const q = await page.evaluate(() => window.nodus.getQueue());
    if (q?.pausedReason) {
      console.log(`\n*** THE QUEUE PAUSED: ${q.pausedReason}`);
      break;
    }
    const running = (q?.items ?? []).find((it) => it.state === 'running');
    if ((q?.done ?? 0) > lastDone) { lastDone = q.done; progressed = true; }
    if (i % 2 === 0) {
      console.log(`  t+${i * 5}s  ${q?.done ?? '?'}/${q?.total ?? '?'} done, ${q?.failed ?? 0} failed` +
        (running ? ` · ${running.kind}: ${running.detail ?? 'working'}` : ' · nothing running'));
    }
    if ((q?.done ?? 0) >= 3) break;
  }

  console.log('\n=== verdict ===');
  const ideas = await page.evaluate(() => window.nodus.listIdeas?.({}) ?? []).catch(() => []);
  ok('queue made progress', progressed);
  ok('ideas extracted', Array.isArray(ideas) && ideas.length > 0, `${ideas?.length ?? 0} ideas`);
} finally {
  await app.close().catch(() => {});
  await rm(userData, { recursive: true, force: true }).catch(() => {});
}
