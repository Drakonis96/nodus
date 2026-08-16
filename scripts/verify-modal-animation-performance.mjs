// Real-window regression coverage for the two cinematic startup modals.
// Run after `npm run build`: node scripts/verify-modal-animation-performance.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';

const repoRoot = process.env.NODUS_REPO_ROOT ?? path.resolve(import.meta.dirname, '..');
const shots = process.env.NODUS_VERIFY_SHOTS ?? path.join(os.tmpdir(), 'nodus-modal-performance-shots');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--child')) {
  execFileSync(require('electron'), [import.meta.filename, '--child'], {
    cwd: repoRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
  });
  process.exit(0);
}

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-modal-performance-'));
await mkdir(shots, { recursive: true });
const childEnv = {
  ...process.env,
  NODUS_USERDATA: userData,
  NODUS_DISABLE_AUTO_UPDATE: '1',
  NODUS_E2E_UPDATE_STATUS: 'not-available',
};
delete childEnv.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env: childEnv });
const step = (message) => console.log(`[modal-performance] ${message}`);

async function assertAvatarPaused(modal, expectedState, label) {
  const avatar = modal.locator('svg.nodi-svg, svg.nodi-orb');
  await avatar.waitFor();
  await modal.locator('svg.nodi-at-rest').waitFor({ timeout: 10_000 });
  const snapshot = await avatar.evaluate((svg) => {
    const animated = [svg, ...svg.querySelectorAll('*')]
      .map((element) => {
        const style = getComputedStyle(element);
        return { name: style.animationName, playState: style.animationPlayState };
      })
      .filter(({ name }) => name !== 'none');
    return {
      state: svg.getAttribute('data-state'),
      atRest: svg.classList.contains('nodi-at-rest'),
      animatedCount: animated.length,
      running: animated.filter(({ playState }) => playState !== 'paused'),
    };
  });
  assert.equal(snapshot.state, expectedState, `${label} should keep its authored pose`);
  assert.equal(snapshot.atRest, true, `${label} should enter the shared rest state`);
  assert.ok(snapshot.animatedCount > 0, `${label} must exercise a genuinely animated avatar`);
  assert.deepEqual(snapshot.running, [], `${label} left SVG animations running`);
  step(`${label}: ${snapshot.animatedCount} SVG animations are paused`);
}

try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !!document.getElementById('root')?.children.length);

  await page.evaluate(() => window.nodus.updateSettings({
    onboardingComplete: true,
    recoverySetupVersion: 1,
    tourComplete: true,
    advancedTourComplete: true,
    basicsTutorialVersion: 5,
    uiLanguage: 'es',
    mascotEnabled: true,
    mascotAlwaysOnTop: false,
    mascotStyle: 'classic',
    mascotStyleChosen: true,
    reduceMotion: false,
  }));
  await page.evaluate(() => {
    localStorage.removeItem('nodus.lastSeenVersion');
    localStorage.setItem('nodus.platformHighlightsSeen.2026-07', '1');
    localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
    sessionStorage.clear();
  });
  await page.reload();
  await page.getByTestId('app-shell').waitFor();

  const whatsNew = page.getByTestId('whats-new-cinematic-modal');
  await whatsNew.waitFor();
  const firstCommit = await whatsNew.evaluate((modal) => ({
    avatarPresent: Boolean(modal.querySelector('svg.nodi-svg, svg.nodi-orb')),
    atRest: Boolean(modal.querySelector('svg.nodi-at-rest')),
  }));
  assert.deepEqual(firstCommit, { avatarPresent: true, atRest: true }, "What's New must commit Nodi already rendered and paused");
  await assertAvatarPaused(whatsNew, 'celebrating', "What's New classic Nodi");

  // The same pause contract must cover the alternate, filter-heavy orb.
  await page.evaluate(() => window.nodus.updateSettings({ mascotStyle: 'orb' }));
  await whatsNew.locator('svg.nodi-orb.nodi-at-rest').waitFor();
  const lightweightOrb = await whatsNew.locator('svg.nodi-orb').evaluate((svg) => ({
    lightweight: svg.classList.contains('nodi-orb-lightweight'),
    turbulenceFilters: svg.querySelectorAll('feTurbulence').length,
    celebrationParticles: svg.querySelectorAll('.party').length,
  }));
  assert.deepEqual(lightweightOrb, { lightweight: true, turbulenceFilters: 0, celebrationParticles: 0 });
  await assertAvatarPaused(whatsNew, 'celebrating', "What's New orb Nodi");
  await page.screenshot({ path: path.join(shots, 'whats-new-paused.png') });
  await whatsNew.getByRole('button', { name: /Explorar las novedades/ }).click();
  await whatsNew.waitFor({ state: 'detached' });

  const updateModal = page.getByTestId('startup-update-modal');
  await updateModal.waitFor();
  await page.waitForFunction(() => (
    document.querySelector('[data-testid="startup-update-modal"]')?.getAttribute('data-update-status') === 'not-available'
  ));
  await assertAvatarPaused(updateModal, 'celebrating', 'startup update orb Nodi');
  await page.screenshot({ path: path.join(shots, 'startup-update-paused.png') });
  await updateModal.getByRole('button', { name: /Entendido/ }).click();
  await updateModal.waitFor({ state: 'detached' });
  await page.waitForTimeout(400);
  assert.equal(await page.getByTestId('startup-update-modal').count(), 0, 'the closed update modal remounted');
  step('startup update modal detaches cleanly after close');
} finally {
  await app.close();
}
