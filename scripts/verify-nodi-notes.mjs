// End-to-end verification of the Nodi quick-notes panel against the real app:
// create → format → save → search → preview → delete, in dark and light themes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';

const repoRoot = process.env.NODUS_REPO_ROOT ?? path.resolve(import.meta.dirname, '..');
const shots = process.env.NODUS_VERIFY_SHOTS ?? path.join(os.tmpdir(), 'nodus-notes-shots');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--child')) {
  execFileSync(require('electron'), [import.meta.filename, '--child'], {
    cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  });
  process.exit(0);
}

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-notes-'));
await mkdir(shots, { recursive: true });
const childEnv = { ...process.env, NODUS_USERDATA: userData, NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available' };
delete childEnv.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env: childEnv });
const log = (...a) => console.log('[verify]', ...a);
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !!document.getElementById('root')?.children.length, { timeout: 30_000 });
  const applyTheme = async (theme) => {
    await page.evaluate((t) => window.nodus.updateSettings({
      onboardingComplete: true, recoverySetupVersion: 1, tourComplete: true, advancedTourComplete: true,
      basicsTutorialVersion: 3, uiLanguage: 'es', mascotEnabled: true, mascotAlwaysOnTop: false,
      mascotStyle: 'classic', reduceMotion: true, theme: t,
    }), theme);
  };
  await applyTheme('dark');
  await page.reload();
  await page.getByTestId('app-shell').waitFor();

  // Fresh verification profiles can legitimately see the release/update startup
  // sequence before Nodi. Dismiss it through the same controls a user sees.
  const whatsNew = page.getByTestId('whats-new-cinematic-modal');
  if (await whatsNew.isVisible().catch(() => false)) {
    await whatsNew.getByRole('button', { name: /Explorar las novedades/ }).click();
  }
  const updateModal = page.getByTestId('startup-update-modal');
  if (await updateModal.isVisible().catch(() => false)) {
    await updateModal.getByRole('button', { name: /Entendido/ }).click();
  }
  const styleModal = page.getByTestId('nodi-style-modal');
  if (await styleModal.isVisible().catch(() => false)) {
    await page.getByTestId('nodi-style-classic').click();
  }

  const figure = page.locator('.nodi-figure');
  await figure.waitFor({ timeout: 30_000 });

  const openMenu = async () => {
    if (await page.locator('.nodi-node.open').count() > 0) return;
    await figure.click();
    await page.waitForFunction(() => document.querySelector('.nodi-node')?.classList.contains('open') ?? false);
  };

  const dragFigureTo = async (x, y) => {
    const box = await figure.boundingBox();
    assert.ok(box, 'Nodi figure has no bounding box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 6 });
    await page.mouse.up();
  };

  const assertRadialGeometry = async (horizontal, vertical) => {
    await page.waitForFunction(
      ([h, v]) => document.querySelector('.nodi-anchor')?.classList.contains(`open-${h}`)
        && document.querySelector('.nodi-anchor')?.classList.contains(`open-${v}`),
      [horizontal, vertical],
    );
    await page.waitForTimeout(450);
    const metrics = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('.nodi-node.open')];
      const centres = nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          dx: Number.parseFloat(style.getPropertyValue('--dx')),
          dy: Number.parseFloat(style.getPropertyValue('--dy')),
        };
      });
      return {
        centres,
        gaps: centres.slice(1).map((point, i) => Math.hypot(point.x - centres[i].x, point.y - centres[i].y)),
      };
    });
    assert.equal(metrics.centres.length, 4, 'main-window Nodi should expose four radial actions');
    metrics.gaps.forEach((gap) => assert.ok(gap >= 57 && gap <= 59, `radial centre gap should be 58px, got ${gap}`));
    metrics.centres.forEach(({ dx, dy }) => {
      assert.ok(horizontal === 'left' ? dx <= 0 : dx >= 0, `wrong ${horizontal} radial direction`);
      assert.ok(vertical === 'up' ? dy <= 0 : dy >= 0, `wrong ${vertical} radial direction`);
    });
    log(`radial ${horizontal}/${vertical} ->`, metrics.gaps.map((gap) => gap.toFixed(1)).join(', '));
  };

  // Exercise all four adaptive quadrants. This catches asymmetric spacing when the
  // mascot is dragged to a different corner, not just the default bottom-right.
  await openMenu();
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const corners = [
    { x: 90, y: 100, horizontal: 'right', vertical: 'down' },
    { x: viewport.width - 90, y: 100, horizontal: 'left', vertical: 'down' },
    { x: 90, y: viewport.height - 100, horizontal: 'right', vertical: 'up' },
    { x: viewport.width - 90, y: viewport.height - 100, horizontal: 'left', vertical: 'up' },
  ];
  for (const corner of corners) {
    await dragFigureTo(corner.x, corner.y);
    await assertRadialGeometry(corner.horizontal, corner.vertical);
  }
  await page.screenshot({ path: `${shots}/notes-0-radial-spacing.png` });

  // ── Open the notes panel ───────────────────────────────────────────────────
  await page.locator('[data-nodi-action="notes"]').click();
  await page.locator('.nodi-notes-panel').waitFor();
  log('notes panel open');
  // Empty state
  assert.equal(await page.locator('.nodi-notes-panel .nodi-empty').count(), 1, 'expected empty-state copy');

  // ── Create + format + save ─────────────────────────────────────────────────
  await page.locator('.nodi-notes-panel .nodi-panel-head button[title="Nueva nota"]').click();
  const ta = page.locator('.nodi-note-textarea');
  await ta.waitFor();
  await ta.fill('Lista de la compra\n\nComprar leche y pan');
  // Select the word "leche" and bold it via the toolbar.
  await page.evaluate(() => {
    const el = document.querySelector('.nodi-note-textarea');
    const i = el.value.indexOf('leche');
    el.focus();
    el.setSelectionRange(i, i + 5);
  });
  await page.locator('.nodi-note-tool[data-format="bold"]').click();
  const afterBold = await ta.inputValue();
  assert.ok(afterBold.includes('**leche**'), `bold did not wrap selection: ${afterBold}`);
  log('bold formatting applied:', JSON.stringify(afterBold));
  await page.locator('.nodi-note-save').click();
  await page.waitForFunction(() => document.querySelector('.nodi-note-state')?.textContent === 'Guardado');
  log('note saved');

  // ── Back to list: the note shows with derived title + snippet ───────────────
  await page.locator('.nodi-notes-panel .nodi-panel-head button[title="Volver"]').click();
  await page.locator('.nodi-note-row').first().waitFor();
  const title = await page.locator('.nodi-note-title').first().innerText();
  assert.equal(title, 'Lista de la compra', `unexpected list title: ${title}`);
  const snippet = await page.locator('.nodi-note-snippet').first().innerText();
  assert.ok(snippet.toLowerCase().includes('comprar leche'), `unexpected snippet: ${snippet}`);
  log('list shows note:', JSON.stringify({ title, snippet }));
  await page.screenshot({ path: `${shots}/notes-1-list-dark.png` });

  // Add a second note so search has something to filter out.
  await page.locator('.nodi-notes-panel .nodi-panel-head button[title="Nueva nota"]').click();
  await ta.fill('Ideas para el proyecto\n\nProbar el modo oscuro');
  await page.locator('.nodi-note-save').click();
  await page.waitForFunction(() => document.querySelector('.nodi-note-state')?.textContent === 'Guardado');
  await page.locator('.nodi-notes-panel .nodi-panel-head button[title="Volver"]').click();
  assert.equal(await page.locator('.nodi-note-row').count(), 2, 'expected 2 notes');

  // ── Search ──────────────────────────────────────────────────────────────────
  await page.locator('.nodi-notes-search input').fill('proyecto');
  await page.waitForFunction(() => document.querySelectorAll('.nodi-note-row').length === 1);
  assert.equal(await page.locator('.nodi-note-title').first().innerText(), 'Ideas para el proyecto');
  log('search "proyecto" -> 1 result');
  await page.screenshot({ path: `${shots}/notes-2-search-dark.png` });
  await page.locator('.nodi-notes-search input').fill('');
  await page.waitForFunction(() => document.querySelectorAll('.nodi-note-row').length === 2);

  // ── Preview a note ──────────────────────────────────────────────────────────
  await page.locator('.nodi-note-row', { hasText: 'Lista de la compra' }).locator('.nodi-note-open').click();
  await ta.waitFor();
  await page.locator('.nodi-notes-panel .nodi-panel-head button[title="Vista previa"]').click();
  await page.locator('.nodi-note-preview').waitFor();
  assert.ok((await page.locator('.nodi-note-preview strong', { hasText: 'leche' }).count()) >= 1, 'preview should render bold');
  log('preview renders markdown');
  await page.screenshot({ path: `${shots}/notes-3-preview-dark.png` });

  // ── Delete with confirmation ────────────────────────────────────────────────
  await page.locator('.nodi-notes-panel .nodi-panel-head button[title="Editar"]').click(); // leave preview
  await page.locator('.nodi-note-remove').click();
  await page.locator('.nodi-confirm-dialog').waitFor();
  await page.screenshot({ path: `${shots}/notes-4-confirm-dark.png` });
  await page.locator('.nodi-confirm-dialog button.danger').click();
  await page.waitForFunction(() => document.querySelectorAll('.nodi-note-row').length === 1);
  log('note deleted -> 1 remaining');

  // ── Light theme screenshot ──────────────────────────────────────────────────
  await applyTheme('light');
  await page.waitForFunction(() => document.querySelector('.nodi-notes-panel')?.classList.contains('nodi-light') ?? false, undefined, { timeout: 10_000 });
  await page.locator('.nodi-note-row').first().waitFor();
  await page.screenshot({ path: `${shots}/notes-5-list-light.png` });
  // open editor in light mode
  await page.locator('.nodi-note-open').first().click();
  await ta.waitFor();
  await page.screenshot({ path: `${shots}/notes-6-editor-light.png` });
  log('light theme verified');

  // ── Always-on-top overlay ─────────────────────────────────────────────────
  // The same persisted note must be reachable from Nodi's independent desktop
  // window, where the extra "Open Nodus" action brings the radial count to five.
  await page.evaluate(() => window.nodus.updateSettings({ mascotAlwaysOnTop: true, theme: 'dark' }));
  let overlay = null;
  for (let i = 0; i < 40 && !overlay; i++) {
    overlay = app.windows().find((candidate) => candidate.url().includes('mascot'));
    if (!overlay) await page.waitForTimeout(250);
  }
  assert.ok(overlay, 'always-on-top Nodi window never appeared');
  overlay.setDefaultTimeout(30_000);
  await overlay.waitForLoadState('domcontentloaded');
  const overlayFigure = overlay.locator('.nodi-figure');
  await overlayFigure.waitFor();
  await overlayFigure.click();
  await overlay.waitForFunction(() => document.querySelectorAll('.nodi-node.open').length === 5);
  await overlay.waitForTimeout(450);
  const overlayGaps = await overlay.evaluate(() => {
    const centres = [...document.querySelectorAll('.nodi-node.open')].map((node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    return centres.slice(1).map((point, i) => Math.hypot(point.x - centres[i].x, point.y - centres[i].y));
  });
  overlayGaps.forEach((gap) => assert.ok(gap >= 57 && gap <= 59, `overlay radial centre gap should be 58px, got ${gap}`));
  await overlay.locator('[data-nodi-action="notes"]').click();
  await overlay.locator('.nodi-notes-panel').waitFor();
  assert.equal(await overlay.locator('.nodi-note-row').count(), 1, 'saved note should be shared with the overlay');
  await overlay.screenshot({ path: `${shots}/notes-7-overlay-dark.png` });
  log('always-on-top overlay verified ->', overlayGaps.map((gap) => gap.toFixed(1)).join(', '));

  log('ALL CHECKS PASSED. Shots in', shots);
} finally {
  const closed = await Promise.race([
    app.close().then(() => true).catch(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 5_000)),
  ]);
  if (!closed) app.process().kill('SIGKILL');
}
// Electron may leave helper handles alive briefly after its last window closes.
// This process owns only the disposable verification instance, so finish cleanly
// once every assertion and teardown step above has completed.
process.exit(0);
