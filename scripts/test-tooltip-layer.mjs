import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Every `title` in the main window used to be a native macOS tooltip: a long OS delay,
// no theme, and nothing at all while the window was not key. src/tooltipLayer.ts shows
// them in one themed popover instead. These pin the geometry that keeps it on screen
// and off the Browser's native page view, and the wiring that makes it app-wide.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const styles = await readFile(path.join(repoRoot, 'src/index.css'), 'utf8');
const mainSource = await readFile(path.join(repoRoot, 'src/main.tsx'), 'utf8');
const layerSource = await readFile(path.join(repoRoot, 'src/tooltipLayer.ts'), 'utf8');

const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-tooltip-layer-'));
const bundle = path.join(outDir, 'tooltipLayer.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'src/tooltipLayer.ts'),
    '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);
const { placeTooltip } = require(bundle);
test.after(() => rm(outDir, { recursive: true, force: true }));

const VIEWPORT = { width: 1200, height: 800 };
const SIZE = { width: 160, height: 28 };
const box = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height });
const inside = (spot, size = SIZE, viewport = VIEWPORT) =>
  spot.left >= 8 && spot.top >= 8 && spot.left + size.width <= viewport.width - 8 && spot.top + size.height <= viewport.height - 8;

test('a button in the middle of the window gets its tooltip centred above it', () => {
  const anchor = box(500, 400, 32, 32);
  const spot = placeTooltip(anchor, SIZE, VIEWPORT, 'top', null);
  assert.equal(spot.placement, 'top');
  assert.equal(spot.left + SIZE.width / 2, 516);
  assert.equal(spot.top + SIZE.height, anchor.top - 6);
});

test('a titlebar button flips below instead of leaving the window', () => {
  const spot = placeTooltip(box(600, 4, 32, 32), SIZE, VIEWPORT, 'top', null);
  assert.equal(spot.placement, 'bottom');
  assert.equal(spot.top, 42);
});

test('a button against the right edge keeps the whole tooltip on screen', () => {
  const spot = placeTooltip(box(1180, 400, 16, 16), SIZE, VIEWPORT, 'top', null);
  assert.equal(spot.placement, 'top');
  assert.ok(inside(spot), JSON.stringify(spot));
  assert.equal(spot.left + SIZE.width, VIEWPORT.width - 8);
});

test('a requested side is honoured, and swapped for its opposite when it has no room', () => {
  assert.equal(placeTooltip(box(500, 400, 32, 32), SIZE, VIEWPORT, 'right', null).placement, 'right');
  assert.equal(placeTooltip(box(1150, 400, 32, 32), SIZE, VIEWPORT, 'right', null).placement, 'left');
});

test('the Browser page view is avoided, and the native tooltip takes over when nothing else fits', () => {
  // Browser toolbar button: above is off-window, below is the native WebContentsView.
  const page = box(0, 52, 1200, 748);
  const toolbarButton = box(600, 20, 28, 28);
  // A one-line tooltip still fits beside it, inside the toolbar band.
  const beside = placeTooltip(toolbarButton, SIZE, VIEWPORT, 'top', page);
  assert.equal(beside.placement, 'left');
  assert.ok(beside.top + SIZE.height <= page.top, JSON.stringify(beside));
  // A two-line one does not fit anywhere the page would not paint over it.
  assert.equal(placeTooltip(toolbarButton, { width: 160, height: 48 }, VIEWPORT, 'top', page), null);
  // With room above, it stays out of the page's way.
  const lower = box(600, 120, 28, 28);
  const spot = placeTooltip(lower, SIZE, VIEWPORT, 'bottom', box(0, 160, 1200, 640));
  assert.equal(spot.placement, 'top');
});

test('a tooltip larger than the window is still clamped inside it', () => {
  const huge = { width: 400, height: 900 };
  const spot = placeTooltip(box(500, 400, 32, 32), huge, VIEWPORT, 'top', null);
  assert.ok(spot);
  assert.ok(spot.left >= 8 && spot.left + huge.width <= VIEWPORT.width - 8);
  assert.equal(spot.top, 8);
});

test('the layer is installed once for the whole main window', () => {
  assert.match(mainSource, /import \{ installTooltipLayer \} from '\.\/tooltipLayer';/);
  assert.match(mainSource, /\ninstallTooltipLayer\(\);\n/);
});

test('the native tooltip is blanked with "" and restored from memory, never deleted', () => {
  // Removing the attribute would hide React's own removals from the MutationObserver
  // and bring a stale title back on restore.
  assert.match(layerSource, /node\.setAttribute\('title', ''\)/);
  assert.doesNotMatch(layerSource, /removeAttribute\('title'\)/);
  // Keyboard focus must not blank the accessible name of title-only buttons.
  assert.match(layerSource, /if \(from === 'pointer'\) blankTitles\(element\);/);
});

test('the tooltip has light, dark, custom-theme and high-contrast styling', () => {
  for (const selector of [
    '.nodus-tooltip {',
    '.light .nodus-tooltip {',
    'html.theme-active.dark .nodus-tooltip {',
    'html.theme-active.light .nodus-tooltip {',
    '.high-contrast .nodus-tooltip {',
    '.high-contrast.light .nodus-tooltip {',
  ]) assert.ok(styles.includes(selector), `missing ${selector}`);
  // A popover box: the UA's centred, Canvas-coloured defaults must be reset.
  const base = styles.slice(styles.indexOf('.nodus-tooltip {'), styles.indexOf('}', styles.indexOf('.nodus-tooltip {')));
  for (const rule of ['inset: auto;', 'margin: 0;', 'pointer-events: none;', 'max-width: min(22rem, calc(100vw - 16px));']) {
    assert.ok(base.includes(rule), `missing ${rule}`);
  }
  assert.match(styles, /\.nodus-tooltip-text \{[^}]*-webkit-line-clamp: 14;[^}]*white-space: pre-line;[^}]*overflow-wrap: anywhere;/);
});
