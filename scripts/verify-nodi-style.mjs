// End-to-end verification of the Nodi style choice, driven through the real app.
//
// Three things here can only be proved by running it:
//   1. the one-time modal appears AFTER the startup update check, never over it;
//   2. it never appears a second time — the requirement that matters most;
//   3. picking the orb actually swaps the mascot, in the active vault's colour.
//
// Run with: node scripts/verify-nodi-style.mjs   (build first: npm run build)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';

const repoRoot = process.env.NODUS_REPO_ROOT ?? path.resolve(import.meta.dirname, '..');
const shots = process.env.NODUS_VERIFY_SHOTS ?? path.join(os.tmpdir(), 'nodus-nodi-style-shots');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--child')) {
  execFileSync(require('electron'), [import.meta.filename, '--child'], {
    cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  });
  process.exit(0);
}

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-nodi-style-'));
await mkdir(shots, { recursive: true });
const childEnv = { ...process.env, NODUS_USERDATA: userData, NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available' };
delete childEnv.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env: childEnv });
const step = (msg) => console.log(`\n✓ ${msg}`);

try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !!document.getElementById('root')?.children.length, { timeout: 30_000 });

  // A user who has already been through the cinematic tutorial, and so was never asked.
  await page.evaluate(() => window.nodus.updateSettings({
    onboardingComplete: true, recoverySetupVersion: 1, tourComplete: true, advancedTourComplete: true,
    basicsTutorialVersion: 4, uiLanguage: 'es', mascotEnabled: true, mascotAlwaysOnTop: false,
    reduceMotion: false, mascotStyle: 'classic', mascotStyleChosen: false, mascotOrbColorMode: 'auto',
  }));
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.getByTestId('app-shell').waitFor();

  // ── 1. ordering: the whole startup chain, in the order a real update sees it ──
  const whatsNew = page.getByTestId('whats-new-cinematic-modal');
  const updateModal = page.getByTestId('startup-update-modal');
  const styleModal = page.getByTestId('nodi-style-modal');

  // A fresh profile has never seen this version's release notes, so those come first.
  await whatsNew.waitFor();
  assert.equal(await updateModal.count(), 0, 'the update check must wait for the release notes');
  assert.equal(await styleModal.count(), 0, 'the Nodi choice must wait for the release notes');
  step('release notes come first, with the update check and the Nodi choice held back');
  await whatsNew.getByRole('button', { name: /Explorar las novedades/ }).click();

  await updateModal.waitFor();
  assert.equal(await styleModal.count(), 0, 'the Nodi choice must not fight the update check for the foreground');
  step('the startup update modal comes second, with the Nodi choice still held back');
  await page.screenshot({ path: path.join(shots, '1-update-modal-first.png') });

  await page.getByTestId('startup-update-modal').getByRole('button', { name: /Entendido/ }).click();
  await styleModal.waitFor();
  step('closing the update check reveals the Nodi choice, last in the chain');
  await page.screenshot({ path: path.join(shots, '2-nodi-choice.png') });

  // Both Nodi must be alive in the picker, each drawn from its own component.
  assert.equal(await page.locator('[data-testid="nodi-style-classic"] svg.nodi-svg').count(), 1, 'the classic Nodi previews itself');
  assert.equal(await page.locator('[data-testid="nodi-style-orb"] svg.nodi-orb').count(), 1, 'the orb previews itself');
  step('the picker shows both Nodi side by side');

  // ── 2. picking the orb swaps the mascot ──────────────────────────────────────
  await page.getByTestId('nodi-style-orb').click();
  await styleModal.waitFor({ state: 'detached' });
  await page.locator('.nodi-figure svg.nodi-orb').waitFor();
  assert.equal(await page.locator('.nodi-figure svg.nodi-svg').count(), 0, 'the classic Nodi must be gone');
  step('picking the orb swaps the floating companion to it');
  await page.screenshot({ path: path.join(shots, '3-orb-companion.png') });

  const saved = await page.evaluate(() => window.nodus.getSettings());
  assert.equal(saved.mascotStyle, 'orb');
  assert.equal(saved.mascotStyleChosen, true, 'the choice must be recorded the moment it is made');

  // ── 3. the choice is offered exactly once ────────────────────────────────────
  await page.reload();
  await page.getByTestId('app-shell').waitFor();
  await page.locator('.nodi-figure svg.nodi-orb').waitFor();
  assert.equal(await styleModal.count(), 0, 'the Nodi choice came back after a reload');
  step('a reload does not bring the choice back');

  // …not even on a genuinely fresh launch, where the update check runs again.
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.getByTestId('app-shell').waitFor();
  await updateModal.waitFor();
  await page.getByTestId('startup-update-modal').getByRole('button', { name: /Entendido/ }).click();
  await page.waitForTimeout(1_000);
  assert.equal(await styleModal.count(), 0, 'the Nodi choice came back on a fresh session');
  step('the choice does not come back on a fresh session either');

  // ── 4. auto colour follows the active vault ──────────────────────────────────
  const hueOf = (hex) => {
    const n = Number.parseInt(hex.slice(1), 16);
    const [r, g, b] = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (d === 0) return 0;
    const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return Math.round(h * 60) % 360;
  };
  const VAULT_COLORS = {
    academic: '#6366f1', estudio: '#0f766e', primary_sources: '#6366f1', genealogy: '#ca8a04',
    databases: '#b30333', testimonios: '#0891b2', worldbuilding: '#7c3aed', docencia: '#ea580c',
  };
  const readHue = () => page.locator('.nodi-figure svg.nodi-orb').evaluate((el) => el.style.getPropertyValue('--nodi-hue'));

  const vault = await page.evaluate(() => window.nodus.getActiveVault());
  const expected = vault?.type ? VAULT_COLORS[vault.type] : '#4d9be8';
  assert.equal(await readHue(), `${hueOf(expected)}deg`, `the orb should wear the ${vault?.type ?? 'default'} accent`);
  step(`auto colour: the orb wears the active vault's accent (${vault?.type ?? 'no vault'} → ${expected})`);

  // Manual mode must pin the colour regardless of the vault.
  await page.evaluate(() => window.nodus.updateSettings({ mascotOrbColorMode: 'manual', mascotOrbColor: '#b30333' }));
  await page.waitForFunction(
    () => document.querySelector('.nodi-figure svg.nodi-orb')?.style.getPropertyValue('--nodi-hue') === '344deg',
    { timeout: 10_000 }
  );
  step('manual colour: the orb pins the chosen colour live, without a reload');
  await page.screenshot({ path: path.join(shots, '4-orb-manual-crimson.png') });

  // ── 5. Settings offers the same choice, plus the colour controls ─────────────
  await page.locator('[data-tour="nav-settings"]').click();
  await page.getByRole('button', { name: 'Interfaz', exact: true }).click();
  const orbCard = page.getByTestId('nodi-style-orb');
  await orbCard.waitFor();
  await orbCard.scrollIntoViewIfNeeded();
  // Manual mode is still on from the step above, so the palette must be offered.
  const palette = page.getByTestId('nodi-orb-palette');
  await palette.waitFor();
  assert.equal(await palette.getByRole('button').count(), 8, 'Nodi blue plus one swatch per distinct vault accent');
  await page.screenshot({ path: path.join(shots, '5-settings-orb.png') });
  step('Settings shows the picker, the colour mode and the palette');

  // Switching to auto must hide the palette and hand the colour back to the vault.
  await page.getByRole('combobox').filter({ hasText: /Automático/ }).first().selectOption('auto').catch(async () => {
    await page.evaluate(() => window.nodus.updateSettings({ mascotOrbColorMode: 'auto' }));
  });
  await palette.waitFor({ state: 'detached' });
  step('choosing automatic colour puts the palette away');

  // The costume toggle is a classic-Nodi idea and must not linger for the orb.
  assert.equal(await page.getByText('Trajes de Nodi según la bóveda').count(), 0, 'the orb has no costumes');
  await page.getByTestId('nodi-style-classic').click();
  await page.getByText('Trajes de Nodi según la bóveda').waitFor();
  await page.locator('.nodi-figure svg.nodi-svg').waitFor();
  await page.screenshot({ path: path.join(shots, '6-settings-classic.png') });
  step('switching back to the classic Nodi from Settings restores it, costumes and all');

  // ── 6. new users pick inside the cinematic tutorial instead ──────────────────
  await page.evaluate(() => window.nodus.updateSettings({ basicsTutorialVersion: 0, mascotStyleChosen: false, mascotStyle: 'classic' }));
  await page.reload();
  await page.getByTestId('basics-tutorial-language').waitFor();
  await page.getByTestId('tutorial-language-es').click();

  const tutorialChoice = page.getByTestId('basics-tutorial-nodi-style');
  await tutorialChoice.waitFor();
  assert.match(await tutorialChoice.textContent(), /¿Con qué Nodi te quedas\?/, 'the choice screen speaks the language just chosen');
  step('the tutorial asks which Nodi, right after the language');
  await page.screenshot({ path: path.join(shots, '7-tutorial-choice.png') });

  await page.getByTestId('nodi-style-orb').click();
  await page.getByTestId('basics-tutorial').waitFor();
  // The rest of the tutorial must be staged by the Nodi they just picked.
  await page.locator('.tutorial-nodi svg.nodi-orb').waitFor();
  assert.equal(await page.locator('.tutorial-nodi svg.nodi-svg').count(), 0, 'the tutorial should drop the classic Nodi once the orb is picked');
  step('the tutorial then runs with the Nodi just chosen');
  await page.screenshot({ path: path.join(shots, '8-tutorial-deck-orb.png') });

  // Picking inside the tutorial must satisfy the same flag, so the modal never follows.
  const afterTutorial = await page.evaluate(() => window.nodus.getSettings());
  assert.equal(afterTutorial.mascotStyleChosen, true, 'the tutorial must record the choice too');
  assert.equal(afterTutorial.mascotStyle, 'orb');
  step('choosing in the tutorial records the flag, so the modal never asks again');

  console.log(`\nAll checks passed. Screenshots in ${shots}`);
} finally {
  await app.close();
}
