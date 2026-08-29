import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// The header's vault badge used to be pinned at a hard left:50%, so anything that
// widened the action rail — the "configure an AI model" alert, "Actualizando…", a
// hovered button revealing its label, a dragged-wide sidebar — slid the rail under
// the badge and the two overlapped. These assert the geometry that replaced it:
// centred when there is room, clamped into the free band when there is not, and
// never within the gap of either rail. The real rendered header is checked by the
// header steps in scripts/e2e-smoke.mjs.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const appSource = await readFile(path.join(repoRoot, 'src/App.tsx'), 'utf8');
const styles = await readFile(path.join(repoRoot, 'src/index.css'), 'utf8');
const serverSource = await readFile(path.join(repoRoot, 'src/serverWeb/App.tsx'), 'utf8');
const serverStyles = await readFile(path.join(repoRoot, 'src/serverWeb/serverDesktop.css'), 'utf8');

const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-header-layout-'));
const bundle = path.join(outDir, 'headerLayout.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'src/headerLayout.ts'),
    '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);
const { placeHeaderBadge, HEADER_BADGE_GAP } = require(bundle);
test.after(() => rm(outDir, { recursive: true, force: true }));

/** The real shell at 1400px: 176px sidebar-width logo, a ~140px badge. */
const BASE = { headerWidth: 1400, logoWidth: 176, actionsWidth: 320, badgeWidth: 140 };

const right = (p, m) => p.left + m.badgeWidth;

test('with room to spare the badge sits exactly on the window centre', () => {
  const placement = placeHeaderBadge(BASE);
  assert.equal(placement.fits, true);
  // Centre of the badge === centre of the header.
  assert.equal(placement.left + BASE.badgeWidth / 2, BASE.headerWidth / 2);
});

test('the centre is preserved regardless of how lopsided the rails are', () => {
  // A wide rail on one side must not drag a still-fitting badge off centre.
  for (const actionsWidth of [120, 320, 480]) {
    const metrics = { ...BASE, actionsWidth };
    const placement = placeHeaderBadge(metrics);
    assert.equal(placement.fits, true, `fits with a ${actionsWidth}px rail`);
    assert.equal(
      placement.left + metrics.badgeWidth / 2,
      metrics.headerWidth / 2,
      `stays centred with a ${actionsWidth}px rail`
    );
  }
});

test('a growing action rail pushes the badge left instead of overlapping it', () => {
  // A centred badge spans 630→770. The band ends at 1400 - 660 - 12 = 728, so the
  // rail would cross it and the clamp has to give way.
  const metrics = { ...BASE, actionsWidth: 660 };
  const placement = placeHeaderBadge(metrics);
  assert.equal(placement.fits, true);
  const centred = metrics.headerWidth / 2 - metrics.badgeWidth / 2;
  assert.ok(placement.left < centred, 'the badge gave way to the rail');
  assert.equal(right(placement, metrics), metrics.headerWidth - metrics.actionsWidth - HEADER_BADGE_GAP);
});

test('a wide sidebar pushes the badge right instead of hiding under the logo', () => {
  const metrics = { ...BASE, logoWidth: 700 };
  const placement = placeHeaderBadge(metrics);
  assert.equal(placement.fits, true);
  const centred = metrics.headerWidth / 2 - metrics.badgeWidth / 2;
  assert.ok(placement.left > centred, 'the badge gave way to the logo');
  assert.equal(placement.left, metrics.logoWidth + HEADER_BADGE_GAP);
});

test('the badge never enters either rail, across a sweep of real-world layouts', () => {
  // Every combination the shell can actually produce: window widths from the xl
  // breakpoint (where the badge appears) up to a large display, the sidebar's full
  // resize range, and rails from icon-only to every label pinned open.
  let clamped = 0;
  let hidden = 0;
  for (const headerWidth of [1280, 1400, 1600, 1920, 2560]) {
    for (const logoWidth of [176, 260, 360]) {
      for (const actionsWidth of [220, 320, 420, 560, 700, 900]) {
        for (const badgeWidth of [96, 140, 220]) {
          const metrics = { headerWidth, logoWidth, actionsWidth, badgeWidth };
          const placement = placeHeaderBadge(metrics);
          const label = JSON.stringify(metrics);
          if (!placement.fits) { hidden++; continue; }
          assert.ok(
            placement.left >= logoWidth + HEADER_BADGE_GAP - 0.001,
            `badge clears the logo ${label} (left ${placement.left})`
          );
          assert.ok(
            right(placement, metrics) <= headerWidth - actionsWidth - HEADER_BADGE_GAP + 0.001,
            `badge clears the action rail ${label} (right ${right(placement, metrics)})`
          );
          const centred = headerWidth / 2 - badgeWidth / 2;
          if (Math.abs(placement.left - centred) > 0.001) clamped++;
        }
      }
    }
  }
  // The sweep has to exercise both branches, or it would prove nothing about the
  // clamp: some layouts must be centred, some clamped, some too tight.
  assert.ok(clamped > 0, 'the sweep includes layouts where the clamp engages');
  assert.ok(hidden > 0, 'the sweep includes layouts too tight for the badge');
});

test('the badge is dropped rather than squeezed when the band cannot hold it', () => {
  // Band = 1280 - 360 - 700 - 24 = 196 < 220.
  const placement = placeHeaderBadge({ headerWidth: 1280, logoWidth: 360, actionsWidth: 700, badgeWidth: 220 });
  assert.equal(placement.fits, false);
});

test('a band exactly the width of the badge still fits, one pixel less does not', () => {
  // Off-by-one at the boundary decides between a badge kissing both rails and a
  // badge that quietly disappears, so both sides are pinned down.
  const exact = { headerWidth: 1000, logoWidth: 100, actionsWidth: 100, badgeWidth: 776 };
  const exactPlacement = placeHeaderBadge(exact);
  assert.equal(exactPlacement.fits, true, '776 = 1000 - 100 - 100 - 24 fits exactly');
  assert.equal(exactPlacement.left, exact.logoWidth + HEADER_BADGE_GAP);
  assert.equal(right(exactPlacement, exact), exact.headerWidth - exact.actionsWidth - HEADER_BADGE_GAP);

  assert.equal(placeHeaderBadge({ ...exact, badgeWidth: 777 }).fits, false, 'one pixel more does not');
});

test('unmeasured boxes report unfit instead of a nonsense coordinate', () => {
  // Before the first paint the refs measure 0; the badge must stay hidden rather
  // than flash at a position it is about to leave.
  assert.equal(placeHeaderBadge({ headerWidth: 0, logoWidth: 0, actionsWidth: 0, badgeWidth: 0 }).fits, false);
  assert.equal(placeHeaderBadge({ ...BASE, badgeWidth: 0 }).fits, false, 'a badge of width 0 is not placed');
  assert.equal(placeHeaderBadge({ ...BASE, headerWidth: 0 }).fits, false, 'a header of width 0 places nothing');
});

test('the gap is configurable and is honoured on both sides', () => {
  const metrics = { ...BASE, actionsWidth: 660, gap: 40 };
  const placement = placeHeaderBadge(metrics);
  assert.equal(right(placement, metrics), metrics.headerWidth - metrics.actionsWidth - 40);
  assert.equal(HEADER_BADGE_GAP, 12, 'the default gap is the shipped one');
});

test('the expanded vault badge has a dedicated light-theme surface', () => {
  assert.match(appSource, /aria-expanded=\{Boolean\(vaultAnchor\)\}/);
  assert.match(appSource, /className="header-vault-badge /);
  assert.match(
    styles,
    /\.light \.app-titlebar button\.header-vault-badge\[aria-expanded='true'\]/
  );
  assert.match(
    styles,
    /background-color: color-mix\(in srgb, var\(--vault-accent, #6366f1\) 11%, white\)/
  );
});

test('the action rail cannot widen the document in a compact window', () => {
  assert.match(appSource, /data-testid="header-actions" className="header-action-rail flex min-w-0[^\"]*overflow-hidden/);
  assert.match(styles, /\.header-action-rail\s*\{[^}]*max-width:\s*100%/s);
  assert.match(
    styles,
    /@media \(max-width: 1100px\)[\s\S]*?\.header-action-rail \.header-action > span\s*\{[\s\S]*?max-width:\s*0 !important/s,
    'compact titlebars collapse pinned labels before they can push actions outside the window'
  );
  assert.match(styles, /html,\s*\nbody,\s*\n#root\s*\{[^}]*overflow:\s*hidden/s);
});

test('notification badges stay fully inside the clipped action rail', () => {
  const badgeRules = styles.match(/\.header-action-badge\s*\{([^}]+)\}/s)?.[1] ?? '';
  assert.match(badgeRules, /top:\s*2px/);
  assert.doesNotMatch(badgeRules, /top:\s*-/);
  assert.match(badgeRules, /box-shadow:\s*0 0 0 2px/);
});

test('Server reuses the Desktop action rail and measured vault badge geometry', () => {
  assert.match(serverSource, /HoverLabelButton/);
  assert.match(serverSource, /ref=\{setHeaderEl\}/);
  assert.match(serverSource, /ref=\{setHeaderActionsEl\}/);
  assert.match(serverSource, /data-badge-fits=\{\s*vaultBadgePlacement/);
  assert.match(serverStyles, /\.server-header-action:not\(\.bg-indigo-600\):hover/);
});

test('Server intro card has a readable light-theme counterpart', () => {
  assert.match(serverSource, /server-home-intro/);
  assert.match(serverStyles, /html\.light \.server-desktop-surface \.server-home-intro/);
  assert.match(serverStyles, /background:\s*#eef2ff/);
});
