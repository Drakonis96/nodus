// Walk every Nodi interaction the tutorial needs, on a copy of the indexed corpus.
//
// No screencast, no narration, no TTS — the point is to find out what actually
// works before anything is paid for. Each step prints ok/FAIL so a broken beat is
// named here instead of being discovered in a finished take.
//
//   node scripts/tutorial/probe-nodi.mjs

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const appVersion = require(path.join(repoRoot, 'package.json')).version;
const PROFILE = path.join(repoRoot, '.tutorial-out', 'nodi', 'profile');
const SHOTS = path.join(repoRoot, '.tutorial-out', 'nodi', 'probe');

const env = { ...process.env, NODUS_USERDATA: PROFILE, NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available' };
delete env.ELECTRON_RUN_AS_NODE;

const ok = (label, pass, extra = '') => console.log(`${pass ? '  ok  ' : ' FAIL '} ${label}${extra ? ' — ' + extra : ''}`);
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});

const app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env });
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15_000);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length), { timeout: 30_000 });
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Nodus') ?? BrowserWindow.getAllWindows()[0];
    w.setContentSize(1600, 900); w.center();
  });
  await page.addInitScript((v) => {
    localStorage.setItem('nodus.lastSeenVersion', v);
    sessionStorage.setItem('nodus.startupUpdateChecked', '1');
  }, appVersion);
  // English UI and English AI output — two separate settings, as the academic take
  // proved the hard way.
  await page.evaluate(() => window.nodus.updateSettings({
    uiLanguage: 'en', promptLanguage: 'en', theme: 'light',
    mascotEnabled: true, mascotStyle: 'orb', mascotStyleChosen: true,
    basicsTutorialVersion: 9999, recoverySetupVersion: 9999,
  })).catch(() => {});
  await page.reload();
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length), { timeout: 30_000 });
  await page.waitForTimeout(2500);
  await page.locator('.backup-health-dismiss').first().click({ timeout: 2000 }).catch(() => {});

  // ── the settings section ────────────────────────────────────────────────
  await page.locator('[data-tour="nav-settings"], button[title="Settings"], button[aria-label="Settings"]').first().click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const searchBox = page.locator('input[placeholder*="earch"]').first();
  if (await searchBox.isVisible().catch(() => false)) {
    await searchBox.fill('Nodi');
    await page.waitForTimeout(1500);
  }
  const section = page.locator('text=/Nodi/i').first();
  ok('settings reachable', await section.isVisible().catch(() => false));
  await shot(page, '01-settings');

  const controls = await page.evaluate(() => {
    const txt = document.body.innerText;
    return {
      hasStyleSelect: Boolean([...document.querySelectorAll('select')].length),
      selects: [...document.querySelectorAll('select')].map((s) => s.value).slice(0, 6),
      swatches: document.querySelectorAll('button[style*="background"]').length,
      mentionsColour: /colou?r|color/i.test(txt),
    };
  });
  ok('style/colour controls present', controls.hasStyleSelect, JSON.stringify(controls));

  // ── the orb colour: manual swatches, then auto ──────────────────────────
  const setMode = async (mode) => page.evaluate((m) => window.nodus.updateSettings({ mascotOrbColorMode: m }), mode).catch(() => {});
  await setMode('manual');
  await page.waitForTimeout(1200);
  const swatches = page.locator('button[style*="background"]');
  const nSw = await swatches.count().catch(() => 0);
  ok('colour swatches clickable', nSw > 0, `${nSw} swatches`);
  for (const i of [1, 3, 5].filter((i) => i < nSw)) {
    await swatches.nth(i).click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(900);
  }
  const colour = await page.evaluate(async () => (await window.nodus.getSettings())?.mascotOrbColor);
  ok('orb colour changed', Boolean(colour), String(colour));
  await shot(page, '02-colours');
  await setMode('auto');
  await page.waitForTimeout(1200);
  await shot(page, '03-auto');

  // ── the radial menu and its four panels ─────────────────────────────────
  await page.locator('[data-tour="nav-graph"]').first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const figure = page.locator('.nodi-companion .nodi-figure, .nodi-figure').first();
  ok('Nodi on screen', await figure.isVisible().catch(() => false));
  await figure.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1600);
  const nodes = await page.locator('.nodi-node').count().catch(() => 0);
  ok('radial menu opens', nodes > 0, `${nodes} buttons`);
  await shot(page, '04-radial');

  // Help renders a speech bubble, the rest render panels — one selector for all
  // three was why "who am I" read as broken when it was working.
  const openRadial = async () => {
    if ((await page.locator('.nodi-node').count().catch(() => 0)) > 0) return;
    await figure.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1500);
  };
  const closeSurface = async () => {
    const x = page.locator('.nodi-bubble-x, .nodi-panel-head button').last();
    if (await x.isVisible().catch(() => false)) await x.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(1200);
  };

  for (const [i, name, sel] of [[0, 'who-am-i', '.nodi-bubble'], [1, 'notifications', '.nodi-panel'], [3, 'quick-notes', '.nodi-panel']]) {
    await openRadial();
    await page.locator('.nodi-node').nth(i).click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await shot(page, `05-${name}`);
    ok(`panel: ${name}`, await page.locator(sel).first().isVisible().catch(() => false));
    await closeSurface();
  }

  // ── chat: a real question against the indexed corpus ────────────────────
  await openRadial();
  await page.locator('.nodi-node').nth(2).click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const chatInput = page.locator('textarea.nodi-chat-input').first();
  ok('chat input present', await chatInput.isVisible().catch(() => false));

  const ask = async (question, label) => {
    await chatInput.click().catch(() => {});
    await chatInput.pressSequentially(question, { delay: 25 }).catch(() => {});
    await page.keyboard.press('Enter').catch(() => {});
    // Streaming: wait for the send button to come back rather than a flat sleep.
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(1500);
      const busy = await page.locator('.nodi-chat-send[disabled]').count().catch(() => 0);
      const text = await page.evaluate(() => (document.querySelector('.nodi-chat-panel')?.innerText ?? '').length);
      if (!busy && text > 200) break;
    }
    const answer = await page.evaluate(() => (document.querySelector('.nodi-chat-panel')?.innerText ?? '').replace(/\s+/g, ' ').slice(-600));
    const refused = /cannot verify|no puedo verificar/i.test(answer);
    ok(`chat: ${label}`, answer.length > 150 && !refused, answer.slice(-260));
    return answer;
  };

  // 1. The app question — answered from the built-in documentation context.
  await ask('How do I import a Zotero collection into Nodus?', 'about the app');
  await shot(page, '06a-chat-app');

  // 2. The corpus question — needs the vault context, which is the semantic
  //    retrieval that the embeddings pay for.
  await page.locator('.nodi-context-button').first().click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const vaultBox = page.locator('.nodi-context-grid label').nth(2).locator('input');
  await vaultBox.check({ timeout: 4000 }).catch(() => {});
  ok('vault context selected', await vaultBox.isChecked().catch(() => false));
  await page.locator('.nodi-context-button').first().click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(1000);
  await ask('What dangers did emigrants face on the Overland Trail?', 'about the corpus');
  await shot(page, '06-chat');

  // ── right-click, then close ─────────────────────────────────────────────
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(1000);
  await figure.click({ button: 'right', timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const menu = page.locator('.nodi-context-menu');
  ok('context menu opens', await menu.isVisible().catch(() => false));
  await shot(page, '07-context');
  await menu.locator('button').first().click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const gone = await page.evaluate(() => !document.querySelector('.nodi-figure'));
  ok('Nodi closes', gone);
  await shot(page, '08-closed');

  console.log(`\nscreenshots in ${path.relative(repoRoot, SHOTS)}`);
} finally {
  await app.close().catch(() => {});
}
