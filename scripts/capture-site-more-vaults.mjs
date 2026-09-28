// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only
/*
Captures the screenshots the home page's "More ways to work with Nodus" cards step
through, from the real Electron interface, into docs/screenshots/more/.

Every mode is a vault of its own type, seeded with the demo data the app already
ships (the same entry points the app's own "seed demo" buttons call), so a capture
is a real screen of the product and never a mock-up. The throwaway profile keeps
the run reproducible and never touches a user's vaults.

Run: npm run capture:site-more-vaults
Then: npm run site:screenshots  (mirrors them into site/assets/screenshots as WebP)

The frames on the page are 16:10, so the window is 1440x900 and the shots are
written at CSS scale — the same size and shape scripts/capture-site-gallery.mjs
uses for Teaching, Study and Databases.
*/
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(repoRoot, 'docs', 'screenshots', 'more');
const require = createRequire(import.meta.url);
const appVersion = require(path.join(repoRoot, 'package.json')).version;

/** One entry per mode on the page, in the order its card shows it. `seed` is the
 *  preload method the app's own demo button calls; `views` is the order the card's
 *  carousel steps through, named by the sidebar id the capture clicks.
 *
 *  Two views a reader might expect are absent on purpose. The map is out because its
 *  tiles come from OpenStreetMap, which refuses this kind of client, so a capture of
 *  it shows "Access blocked" placeholders instead of a map. Genealogy carries five
 *  views rather than seven because its social graph, its Library and its search
 *  results hold a single row each on the seeded demo — an empty screen is worse than
 *  a shorter carousel. The archive record itself is left out too: its field labels
 *  still render in Spanish in the English interface (shared/archiveDocTypes.ts). */
export const MODES = [
  {
    key: 'genealogy',
    type: 'genealogy',
    name: 'Family papers',
    seed: 'seedGenealogyDemoData',
    views: ['tree', 'persons', 'archive', 'timeline', 'deepResearch'],
  },
  {
    key: 'worldbuilding',
    type: 'worldbuilding',
    name: 'The Ashen Tides',
    seed: 'seedWorldbuildingDemoData',
    views: ['characters', 'encyclopedia', 'places', 'factions', 'cultures', 'timeline', 'scenes'],
  },
  {
    key: 'primary-sources',
    type: 'primary_sources',
    name: 'Municipal archive',
    seed: 'seedPrimarySourcesDemoData',
    views: ['archive', 'timeline'],
  },
  {
    key: 'testimony',
    type: 'testimonios',
    name: 'Oral history',
    seed: 'seedTestimonyDemoData',
    views: ['testimonyInterviews', 'testimonyParticipants'],
  },
  {
    key: 'prosopography',
    type: 'prosopography',
    name: 'Notaries of Jerez',
    seed: 'seedProsopDemo',
    views: ['prosopPersons', 'prosopPopulation'],
  },
];

if (!existsSync(path.join(repoRoot, 'dist-electron', 'main.js')) || !existsSync(path.join(repoRoot, 'dist', 'index.html'))) {
  throw new Error('Run `npm run build` before capturing the "More ways" screenshots.');
}

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-site-more-'));
const childEnv = {
  ...process.env,
  NODUS_USERDATA: userData,
  NODUS_DISABLE_AUTO_UPDATE: '1',
  NODUS_E2E_UPDATE_STATUS: 'not-available',
  NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1',
};
delete childEnv.ELECTRON_RUN_AS_NODE;

const settings = {
  onboardingComplete: true,
  basicsTutorialVersion: 999,
  recoverySetupVersion: 999,
  tourComplete: true,
  advancedTourComplete: true,
  genealogyTourComplete: true,
  databasesTourComplete: true,
  studyTourComplete: true,
  docenciaTourComplete: true,
  testimonyTourComplete: true,
  primarySourcesTourComplete: true,
  worldbuildingTourComplete: true,
  theme: 'light',
  uiLanguage: 'en',
  promptLanguage: 'en',
  mascotEnabled: false,
  mascotStyleChosen: true,
  reduceMotion: true,
  demoMode: false,
  sidebarCustomized: true,
  sidebarHidden: [],
  sidebarOrder: [],
};

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

const app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env: childEnv });
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  await app.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((candidate) => candidate.getTitle() === 'Nodus') ?? BrowserWindow.getAllWindows()[0];
    main.setContentSize(1440, 900);
    main.center();
  });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));

  /** The app's own screenshots carry no tour, no demo banner and no mascot: every
   *  notice that only exists to steer a first run is silenced here, not in the markup. */
  async function applyDocumentationSettings() {
    await page.evaluate(({ version, nextSettings }) => {
      localStorage.setItem('nodus.lastSeenVersion', version);
      localStorage.setItem('nodus.sidebarWidth', '208');
      localStorage.setItem('nodus.mobileTeaserSeen.3.2.4', '1');
      localStorage.setItem('nodus.platformHighlightsSeen.2026-07', '1');
      localStorage.setItem('nodus.toolkitBetaGuideSeen.2.4.0', '1');
      localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
      localStorage.setItem('nodus.pdfPresenterTutorialSeen.e2js_u-05OA', '1');
      sessionStorage.setItem('nodus.startupUpdateChecked', '1');
      return window.nodus.updateSettings(nextSettings);
    }, { version: appVersion, nextSettings: settings });
  }

  /** Two first-run dialogs share the .toolkit-guide-backdrop shell — the toolkit video
   *  guide and the Library tutorial — and either will swallow every click behind it.
   *  Both are dismissed through the app's own buttons; a stray backdrop falls back to
   *  Escape so a new dialog can never hang the run. */
  async function dismissOverlays() {
    for (const testId of ['library-tutorial-close', 'tutorial-videos-tour-complete']) {
      const button = page.locator(`[data-testid="${testId}"]`);
      if (await button.count() > 0 && await button.first().isVisible()) {
        await button.first().click();
        await page.waitForTimeout(300);
      }
    }
    const backdrop = page.locator('.toolkit-guide-backdrop');
    if (await backdrop.count() > 0 && await backdrop.first().isVisible()) {
      await page.keyboard.press('Escape');
      await backdrop.first().waitFor({ state: 'detached', timeout: 3_000 }).catch(() => {});
    }
  }

  async function settle() {
    await applyDocumentationSettings();
    await page.reload();
    await page.getByTestId('app-shell').waitFor({ state: 'visible' });
    await page.waitForFunction(() => (
      document.documentElement.classList.contains('light') && document.documentElement.lang === 'en'
    ));
    await dismissOverlays();
    const dismiss = page.locator('.backup-health-dismiss');
    if (await dismiss.count() === 1 && await dismiss.isVisible()) await dismiss.click();
  }

  for (const mode of MODES) {
    const created = await page.evaluate(({ vaultName, vaultType }) => window.nodus.createVault({ name: vaultName, type: vaultType }), { vaultName: mode.name, vaultType: mode.type });
    const switched = await page.evaluate((id) => window.nodus.switchVault(id), created.vault.id);
    assert.equal(switched.ok, true, switched.message);
    await applyDocumentationSettings();

    const seeded = await page.evaluate((method) => window.nodus[method](), mode.seed);
    assert.ok(seeded === true || seeded?.seeded === true, `${mode.seed} must seed the isolated vault for ${mode.key}`);
    await settle();

    for (const view of mode.views) {
      await dismissOverlays();
      const button = page.locator(`[data-tour="nav-${view}"]`);
      assert.equal(await button.count(), 1, `navigation target ${view} must be available once in ${mode.key}`);
      await button.click();
      // Most sidebars mark the active entry with bg-indigo-600; the prosopography
      // one uses bg-blue-600. Either is the page's own signal that the view moved.
      await page.waitForFunction((target) => {
        const entry = document.querySelector(`[data-tour="nav-${target}"]`);
        return Boolean(entry) && (entry.classList.contains('bg-indigo-600') || entry.classList.contains('bg-blue-600'));
      }, view);
      await page.locator('main').evaluate((element) => {
        element.scrollTop = 0;
      }).catch(() => {});
      await page.waitForTimeout(['map', 'tree', 'relations', 'prosopNetworks'].includes(view) ? 1_500 : 700);
      // The seeded portraits are generated, so on a slow first render the cards are
      // still silhouettes when the view settles. Wait for every image to have loaded
      // before the shutter, and never let a missing one hang the run.
      if (['tree', 'persons', 'characters', 'testimonyParticipants'].includes(view)) {
        await page.waitForFunction(() => [...document.images].every((image) => image.complete), null, { timeout: 20_000 }).catch(() => {});
        await page.waitForTimeout(1_500);
      }
      await page.evaluate(() => document.fonts.ready);
      // Opening a view can raise a dialog of its own — the Library tutorial, for one.
      await dismissOverlays();
      await page.waitForTimeout(400);

      const target = path.join(outputRoot, `${mode.key}-${view}.png`);
      await page.screenshot({ path: target, animations: 'disabled', type: 'png', scale: 'css' });
      console.log(`[more] ${mode.key}-${view}.png`);
    }
  }
  console.log(`Captured ${MODES.reduce((total, mode) => total + mode.views.length, 0)} views in ${outputRoot}`);
} finally {
  await app.close();
  await rm(userData, { recursive: true, force: true });
}
