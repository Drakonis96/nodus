// Regression verification for the always-on-top Nodi overlay: the native window
// must not clip radial buttons while they animate back to the mascot.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';

const repoRoot = process.env.NODUS_REPO_ROOT ?? path.resolve(import.meta.dirname, '..');
const shots = process.env.NODUS_VERIFY_SHOTS ?? path.join(os.tmpdir(), 'nodus-overlay-shots');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--child')) {
  execFileSync(require('electron'), [import.meta.filename, '--child'], {
    cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  });
  process.exit(0);
}

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-overlay-'));
await mkdir(shots, { recursive: true });
const childEnv = { ...process.env, NODUS_USERDATA: userData, NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available' };
delete childEnv.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env: childEnv });
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !!document.getElementById('root')?.children.length, { timeout: 30_000 });
  await page.evaluate(() => window.nodus.updateSettings({
    onboardingComplete: true, recoverySetupVersion: 1, tourComplete: true, advancedTourComplete: true,
    basicsTutorialVersion: 3, uiLanguage: 'es', mascotEnabled: true, mascotAlwaysOnTop: true, reduceMotion: false,
  }));
  await page.reload();
  await page.getByTestId('app-shell').waitFor();

  // The overlay is its own window.
  let overlay = null;
  for (let i = 0; i < 40 && !overlay; i++) {
    overlay = app.windows().find((w) => w.url().includes('mascot'));
    if (!overlay) await page.waitForTimeout(250);
  }
  if (!overlay) throw new Error('overlay window never appeared');
  await overlay.waitForLoadState('domcontentloaded');
  const figure = overlay.locator('.nodi-figure');
  await figure.waitFor({ timeout: 30_000 });

  /** How far the radial buttons stick out of the window, in px. */
  const overflow = () => overlay.evaluate(() => {
    const nodes = [...document.querySelectorAll('.nodi-node')];
    let worst = 0;
    for (const n of nodes) {
      const r = n.getBoundingClientRect();
      worst = Math.max(worst, -r.left, -r.top, r.right - window.innerWidth, r.bottom - window.innerHeight);
    }
    return { viewport: [window.innerWidth, window.innerHeight], clippedBy: Math.round(worst) };
  });

  await figure.click();                       // open the radial menu
  await overlay.waitForTimeout(700);
  const open = await overflow();
  console.log('[verify] menu OPEN  ->', JSON.stringify(open));
  assert.deepEqual(open.viewport, [600, 520]);
  assert.equal(open.clippedBy, 0);
  await overlay.screenshot({ path: `${shots}/overlay-1-open.png` });

  await figure.click();                       // collapse it again
  let elapsed = 0;
  for (const ms of [60, 140, 260, 420, 700]) {
    await overlay.waitForTimeout(ms - elapsed);
    elapsed = ms;
    const o = await overflow();
    console.log(`[verify] +${ms}ms after collapse ->`, JSON.stringify(o));
    assert.equal(o.clippedBy, 0, `a radial button was clipped at ${ms} ms`);
    if (ms === 700) {
      assert.deepEqual(o.viewport, [212, 232]);
    }
    await overlay.screenshot({ path: `${shots}/overlay-2-collapse-${ms}.png` });
  }
  console.log('[verify] shots in', shots);
} finally {
  await app.close().catch(() => {});
  await rm(userData, { recursive: true, force: true });
}
