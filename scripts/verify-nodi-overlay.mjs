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
    basicsTutorialVersion: 3, uiLanguage: 'es', mascotEnabled: true, mascotAlwaysOnTop: true,
    mascotStyle: 'orb', reduceMotion: false,
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
  const nativeOverlay = await app.browserWindow(overlay);
  assert.equal(
    await nativeOverlay.evaluate((win) => win.webContents.getBackgroundThrottling()),
    false,
    'Nodi overlay must keep compositing while another macOS app is active',
  );
  // Playwright's synthetic click does not perform AppKit's real mouse-window
  // activation. A physical click does, so reproduce that native precondition before
  // exercising the menu; otherwise the overlay's blur dismissal immediately wins.
  await nativeOverlay.evaluate((win) => win.focus());
  const figure = overlay.locator('.nodi-figure');
  await figure.waitFor({ timeout: 30_000 });
  const figureScreenPosition = async () => {
    const [bounds, box] = await Promise.all([
      nativeOverlay.evaluate((win) => win.getBounds()),
      figure.boundingBox(),
    ]);
    if (!box) throw new Error('Nodi figure has no bounding box');
    return { x: Math.round(bounds.x + box.x), y: Math.round(bounds.y + box.y) };
  };
  const setMenuOpen = async (open) => {
    const current = await overlay.locator('.nodi-node.open').count() > 0;
    if (current === open) return;
    await figure.click();
    await overlay.waitForFunction((expected) => (
      document.querySelector('.nodi-node')?.classList.contains('open') ?? false
    ) === expected, open);
  };

  /** How far the radial buttons stick out of the window, in px. */
  const overflow = () => overlay.evaluate(() => {
    // Include Nodi itself as well as every radial action.
    const nodes = [...document.querySelectorAll('.nodi-node, .nodi-figure')];
    let worst = 0;
    for (const n of nodes) {
      const r = n.getBoundingClientRect();
      worst = Math.max(worst, -r.left, -r.top, r.right - window.innerWidth, r.bottom - window.innerHeight);
    }
    return { viewport: [window.innerWidth, window.innerHeight], clippedBy: Math.round(worst) };
  });

  const beforeOpenPosition = await figureScreenPosition();
  await setMenuOpen(true);
  const afterOpenPosition = await figureScreenPosition();
  assert.deepEqual(afterOpenPosition, beforeOpenPosition, 'opening the radial menu moved Nodi on screen');
  await overlay.waitForTimeout(700);
  assert.equal(await overlay.locator('.nodi-orb').getAttribute('data-state'), 'idle', 'opening the orb menu must not replace its continuous float animation');
  const open = await overflow();
  console.log('[verify] menu OPEN  ->', JSON.stringify(open));
  assert.deepEqual(open.viewport, [600, 520]);
  assert.equal(open.clippedBy, 0);
  await overlay.screenshot({ path: `${shots}/overlay-1-open.png` });

  await setMenuOpen(false);
  let elapsed = 0;
  for (const ms of [60, 140, 260, 420, 700]) {
    await overlay.waitForTimeout(ms - elapsed);
    elapsed = ms;
    const o = await overflow();
    console.log(`[verify] +${ms}ms after collapse ->`, JSON.stringify(o));
    assert.equal(o.clippedBy, 0, `a radial button was clipped at ${ms} ms`);
    assert.deepEqual(await figureScreenPosition(), beforeOpenPosition, `closing the radial menu moved Nodi at ${ms} ms`);
    await overlay.screenshot({ path: `${shots}/overlay-2-collapse-${ms}.png` });
  }
  assert.deepEqual((await overflow()).viewport, [600, 520], 'the native host resized after collapse');

  // A little hand jitter must still produce a click instead of being mistaken for a
  // drag. This also exercises reactivating Nodi from transparent-area passthrough.
  const figureBox = await figure.boundingBox();
  if (!figureBox) throw new Error('Nodi figure has no bounding box');
  const clickX = figureBox.x + figureBox.width / 2;
  const clickY = figureBox.y + figureBox.height / 2;
  await overlay.mouse.move(clickX, clickY);
  await overlay.mouse.down();
  await overlay.mouse.move(clickX + 4, clickY + 2);
  await overlay.mouse.up();
  await overlay.waitForFunction(() => document.querySelector('.nodi-node')?.classList.contains('open') ?? false);
  console.log('[verify] passthrough first click + pointer jitter -> menu open');
  await setMenuOpen(false);
  await overlay.waitForTimeout(700);

  const moveNodi = async (screenX, screenY) => {
    await overlay.evaluate(async ([x, y]) => {
      await window.nodus.nodiBeginWindowDrag(0, 0);
      await window.nodus.nodiDragWindow(x, y);
      await window.nodus.nodiEndWindowDrag();
    }, [screenX, screenY]);
    await overlay.waitForTimeout(100);
  };
  const bottomButtonHits = () => overlay.evaluate(() => Object.fromEntries(
    ['Chat', 'Abrir Nodus'].map((title) => {
      const button = document.querySelector(`.nodi-node[title="${title}"]`);
      if (!(button instanceof HTMLElement)) return [title, null];
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return [title, {
        rect: [Math.round(rect.left), Math.round(rect.top), Math.round(rect.right), Math.round(rect.bottom)],
        target: hit?.closest('.nodi-node')?.getAttribute('title')
          ?? (hit?.closest('.nodi-figure') ? 'nodi-figure' : hit?.getAttribute('class') ?? hit?.tagName ?? null),
      }];
    }),
  ));
  const verifyTopCorner = async (corner) => {
    await setMenuOpen(true);
    await overlay.waitForTimeout(700);
    const hits = await bottomButtonHits();
    const radii = await overlay.evaluate(() => {
      const figureRect = document.querySelector('.nodi-figure')?.getBoundingClientRect();
      if (!figureRect) return [];
      const core = {
        x: figureRect.left + figureRect.width * 130 / 270,
        y: figureRect.top + figureRect.height * 140 / 300,
      };
      return [...document.querySelectorAll('.nodi-node')].map((node) => {
        const rect = node.getBoundingClientRect();
        return Math.round(Math.hypot(rect.left + rect.width / 2 - core.x, rect.top + rect.height / 2 - core.y));
      });
    });
    console.log(`[verify] ${corner} button hits/radii ->`, JSON.stringify({ hits, radii }));
    await overlay.screenshot({ path: `${shots}/overlay-3-${corner}.png` });
    assert.equal(hits.Chat?.target, 'Chat', `Nodi's figure intercepts Chat in the ${corner} corner`);
    assert.equal(hits['Abrir Nodus']?.target, 'Abrir Nodus', `Nodi's figure intercepts Abrir Nodus in the ${corner} corner`);
    assert.ok(radii.every((radius) => radius >= 126), `downward controls are too close to Nodi in the ${corner} corner: ${radii}`);
    await setMenuOpen(false);
    await overlay.waitForTimeout(700);
  };

  await moveNodi(-10_000, -10_000);
  await verifyTopCorner('top-left');
  await moveNodi(10_000, 0);
  await verifyTopCorner('top-right');
  await moveNodi(-10_000, 10_000);
  const lowerLeftSamples = [];
  await overlay.evaluate(async () => window.nodus.nodiBeginWindowDrag(0, 0));
  for (let index = 0; index < 8; index += 1) {
    await overlay.evaluate(async () => window.nodus.nodiDragWindow(-10_000, 10_000));
    lowerLeftSamples.push(await nativeOverlay.evaluate((win) => win.getBounds()));
  }
  await overlay.evaluate(async () => window.nodus.nodiEndWindowDrag());
  console.log('[verify] lower-left native bounds ->', JSON.stringify(lowerLeftSamples));
  assert.equal(new Set(lowerLeftSamples.map(({ x }) => x)).size, 1, 'the stable panel rebounds horizontally at the left edge');
  console.log('[verify] shots in', shots);
} finally {
  await app.close().catch(() => {});
  await rm(userData, { recursive: true, force: true });
}
