// Regenerate every screenshot embedded in README.md and docs/GETTING_STARTED.md.
//
// The capture contract is intentionally explicit: the real Electron app, an isolated
// throwaway profile, English UI, light theme, Nodi's orb, and demo mode in every shot.
// This keeps the public documentation reproducible without touching a developer's
// actual vaults or depending on their current preferences.
//
//   npm run build && node scripts/capture-doc-screenshots.mjs

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const screenshotsDir = path.join(repoRoot, 'docs', 'screenshots');
const require = createRequire(import.meta.url);

if (!existsSync(path.join(repoRoot, 'dist-electron', 'main.js')) || !existsSync(path.join(repoRoot, 'dist', 'index.html'))) {
  throw new Error('Run `npm run build` before capturing documentation screenshots.');
}

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-doc-shots-'));
const appVersion = require(path.join(repoRoot, 'package.json')).version;
const childEnv = {
  ...process.env,
  NODUS_USERDATA: userData,
  NODUS_DISABLE_AUTO_UPDATE: '1',
  NODUS_E2E_UPDATE_STATUS: 'not-available',
  NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1',
};
delete childEnv.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env: childEnv });

try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  await app.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((candidate) => candidate.getTitle() === 'Nodus')
      ?? BrowserWindow.getAllWindows()[0];
    main.setContentSize(1440, 900);
    main.center();
  });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));

  const publicSettings = {
    onboardingComplete: true,
    basicsTutorialVersion: 999,
    recoverySetupVersion: 999,
    tourComplete: true,
    advancedTourComplete: true,
    genealogyTourComplete: true,
    databasesTourComplete: true,
    studyTourComplete: true,
    docenciaTourComplete: true,
    theme: 'light',
    uiLanguage: 'en',
    mascotStyle: 'orb',
    mascotStyleChosen: true,
    mascotEnabled: true,
    mascotAlwaysOnTop: false,
    reduceMotion: true,
  };

  async function prepareCurrentVault() {
    await page.evaluate((version) => localStorage.setItem('nodus.lastSeenVersion', version), appVersion);
    await page.evaluate((settings) => window.nodus.updateSettings(settings), publicSettings);
  }

  async function settleAfterSeed() {
    await page.evaluate((settings) => window.nodus.updateSettings(settings), publicSettings);
    await page.reload();
    await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
    await page.waitForFunction(() => (
      document.documentElement.classList.contains('light')
      && document.documentElement.lang === 'en'
      && Boolean(document.querySelector('.nodi-figure .nodi-orb'))
      && document.body.innerText.includes('Demo mode:')
    ));
    const backupWarningDismiss = page.locator('.backup-health-dismiss');
    if (await backupWarningDismiss.count() === 1 && await backupWarningDismiss.isVisible()) {
      await backupWarningDismiss.click();
      await backupWarningDismiss.waitFor({ state: 'hidden' });
    }
  }

  async function openView(view, readySelector) {
    const button = page.locator(`[data-tour="nav-${view}"]`);
    assert.equal(await button.count(), 1, `navigation target ${view} must be unique`);
    await button.click();
    await page.waitForFunction((target) => (
      document.querySelector(`[data-tour="nav-${target}"]`)?.classList.contains('bg-indigo-600')
    ), view);
    if (readySelector) await page.locator(readySelector).waitFor({ state: 'visible' });
    await page.waitForTimeout(view === 'graph' || view === 'tree' ? 1_200 : 350);
  }

  async function assertCaptureContract() {
    const state = await page.evaluate(() => ({
      light: document.documentElement.classList.contains('light'),
      lang: document.documentElement.lang,
      orb: Boolean(document.querySelector('.nodi-figure .nodi-orb')),
      demo: document.body.innerText.includes('Demo mode:'),
    }));
    assert.deepEqual(state, { light: true, lang: 'en', orb: true, demo: true });
  }

  async function capture(filename, options = {}) {
    await assertCaptureContract();
    const target = path.join(screenshotsDir, filename);
    const jpeg = filename.endsWith('.jpg');
    await page.screenshot({
      path: target,
      animations: 'disabled',
      ...(jpeg ? { type: 'jpeg', quality: 86 } : { type: 'png' }),
      ...options,
    });
    console.log(`[docs] ${filename}`);
  }

  async function createAndSwitch(name, type) {
    const result = await page.evaluate(({ vaultName, vaultType }) => (
      window.nodus.createVault({ name: vaultName, type: vaultType })
    ), { vaultName: name, vaultType: type });
    const switched = await page.evaluate((id) => window.nodus.switchVault(id), result.vault.id);
    assert.equal(switched.ok, true, switched.message);
    await prepareCurrentVault();
    return result.vault;
  }

  // Academic demo: it supplies the complete screenshot set for the getting-started
  // guide plus the two README images that showcase the graph and Nodi itself.
  await prepareCurrentVault();
  assert.equal(await page.evaluate(() => window.nodus.seedDemoData()), true);
  await settleAfterSeed();

  await openView('home');
  await capture('01-home.png');
  await openView('graph', 'canvas.sigma-nodes');
  await capture('02-graph.png');
  await capture('readme-academic-demo.jpg');

  const figure = page.locator('.nodi-figure');
  assert.equal(await figure.count(), 1, 'Nodi orb must have one interactive figure');
  await figure.click();
  const aboutNodi = page.locator('[data-nodi-action="help"]');
  assert.equal(await aboutNodi.count(), 1, 'Nodi help action must be unique');
  await aboutNodi.click();
  await page.getByText('Hi! I am Nodi', { exact: true }).waitFor({ state: 'visible' });
  await capture('readme-nodi-demo.jpg');
  const closeNodiHelp = page.locator('.nodi-bubble-x');
  assert.equal(await closeNodiHelp.count(), 1, 'Nodi help close button must be unique');
  await closeNodiHelp.click();

  await openView('ideas');
  await capture('03-ideas.png');
  await openView('debate');
  await capture('04-debates.png');
  await openView('gaps');
  await capture('05-gaps.png');
  await openView('notes');
  await capture('06-notes.png');
  await openView('library');
  await capture('07-library.png');
  await openView('writing');
  await capture('08-writing.png');
  await openView('argument');
  await capture('09-argument-map.png');

  // The remaining README shots use their own vaults and built-in sample datasets.
  await createAndSwitch('Genealogy demo', 'genealogy');
  const genealogySeed = await page.evaluate(() => window.nodus.seedGenealogyDemoData());
  assert.equal(genealogySeed.seeded, true);
  await settleAfterSeed();
  await openView('tree');
  await capture('readme-genealogy-demo.jpg');

  await createAndSwitch('Databases demo', 'databases');
  assert.equal(await page.evaluate(() => window.nodus.seedDatabasesDemoData()), true);
  await settleAfterSeed();
  const fieldSamples = page.getByRole('button', { name: 'Field samples', exact: true });
  assert.equal(await fieldSamples.count(), 1, 'the demo table must be unique in the sidebar');
  await fieldSamples.click();
  await page.locator('[data-tour="db-table"]').waitFor({ state: 'visible' });
  await capture('readme-databases-demo.jpg');

  await createAndSwitch('Study demo', 'estudio');
  assert.equal(await page.evaluate(() => window.nodus.seedStudyDemoData()), true);
  await settleAfterSeed();
  await openView('home');
  await capture('readme-study-demo.jpg');

  await createAndSwitch('Teaching demo', 'docencia');
  assert.equal(await page.evaluate(() => window.nodus.seedTeachingDemoData()), true);
  await settleAfterSeed();
  await openView('home');
  await capture('readme-teaching-demo.jpg');

  console.log(`Documentation screenshots updated in ${screenshotsDir}`);
} finally {
  await app.close();
  await rm(userData, { recursive: true, force: true });
}
