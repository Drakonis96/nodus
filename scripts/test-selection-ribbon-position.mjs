// Selection ribbon — it belongs above the pointer, not above the selection box.
//
// Dragging a selection down a page leaves the bounding box starting at the first
// click, so placing the ribbon over that box parks it far from the pointer that
// finished the selection. These tests fix the arithmetic of the placement and
// the offset correction applied over Milkdown's own positioner.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const outDir = await mkdtemp(path.join(repoRoot, 'node_modules', '.nodus-ribbon-'));
test.after(async () => { await rm(outDir, { recursive: true, force: true }); });

function loadModule(file) {
  const bundle = path.join(outDir, `${path.basename(file).replace(/\.tsx?$/, '')}.cjs`);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [
      path.join(repoRoot, file),
      '--bundle',
      '--platform=node',
      '--format=cjs',
      '--target=es2022',
      `--alias:@shared=${path.join(repoRoot, 'shared')}`,
      `--outfile=${bundle}`,
    ],
    { cwd: repoRoot, stdio: 'inherit' },
  );
  return require(bundle);
}

const {
  RIBBON_GAP,
  RIBBON_MARGIN,
  intersectRibbonBounds,
  pointerAnchor,
  selectionRibbonOffset,
  selectionRibbonPosition,
} = loadModule('src/selectionRibbonPosition.ts');

const screen = { left: RIBBON_MARGIN, top: RIBBON_MARGIN, right: 1440 - RIBBON_MARGIN, bottom: 900 - RIBBON_MARGIN };
const ribbon = { width: 350, height: 41 };

test('the ribbon is centred on the pointer and clears the line above it', () => {
  const { left, top } = selectionRibbonPosition(pointerAnchor(700, 480), ribbon, screen);
  assert.equal(left, 700 - ribbon.width / 2);
  assert.equal(top, 480 - 12 - RIBBON_GAP - ribbon.height);
});

test('a selection dragged down the page follows the pointer, not its first line', () => {
  // Pointer released on the last line; the selection box still starts at 120.
  const pointer = selectionRibbonPosition(pointerAnchor(700, 620), ribbon, screen);
  const box = selectionRibbonPosition({ x: 700, top: 120, bottom: 640 }, ribbon, screen);
  assert.ok(pointer.top > box.top + 400, `${pointer.top} should be far below ${box.top}`);
});

test('near the top edge the ribbon drops below the anchored line', () => {
  const { top } = selectionRibbonPosition({ x: 400, top: 30, bottom: 54 }, ribbon, screen);
  assert.equal(top, 54 + RIBBON_GAP);
});

test('the ribbon stays inside its bounds on both sides', () => {
  assert.equal(selectionRibbonPosition(pointerAnchor(4, 500), ribbon, screen).left, screen.left);
  assert.equal(
    selectionRibbonPosition(pointerAnchor(1438, 500), ribbon, screen).left,
    screen.right - ribbon.width,
  );
});

test('a ribbon as wide as its bounds is pinned to their left edge', () => {
  // The note editor's toolbar is nearly as wide as the text column it lives in.
  const column = { left: 384, top: 100, right: 384 + 618, bottom: 800 };
  assert.equal(selectionRibbonPosition(pointerAnchor(900, 500), { width: 618, height: 44 }, column).left, 384);
});

test('the editor column narrows the screen bounds without inverting them', () => {
  const column = intersectRibbonBounds(screen, { left: 384, top: 40, right: 1002, bottom: 700 });
  assert.deepEqual(column, { left: 384, top: 40, right: 1002, bottom: 700 });
  const offscreen = intersectRibbonBounds(screen, { left: 2000, top: 2000, right: 2400, bottom: 2400 });
  assert.ok(offscreen.right >= offscreen.left && offscreen.bottom >= offscreen.top, 'bounds never invert');
});

test('the pointer band is the assumed line around the pointer', () => {
  const anchor = pointerAnchor(200, 300);
  assert.equal(anchor.x, 200);
  assert.ok(anchor.top < 300 && anchor.bottom > 300);
});

test('the offset moves a floating element by the drift of its own answer', () => {
  // The element carries a translate of 20/10 and sits at 260/140; it belongs at 300/90.
  const next = selectionRibbonOffset({ x: 20, y: 10 }, { left: 260, top: 140 }, { left: 300, top: 90 });
  assert.deepEqual(next, { x: 60, y: -40 });
});

test('the ribbon is anchored to the pointer in the reader and in the editor', () => {
  const reader = fs.readFileSync(path.join(repoRoot, 'src/components/ReaderSelectionActions.tsx'), 'utf8');
  // Matched across line breaks: the formatter may wrap the ternary, but the rule
  // it encodes -- the pointer wins over the selection box -- must stay.
  assert.match(reader, /pointer\s*\?\s*pointerAnchor\(pointer\.x, pointer\.y\)\s*:\s*focusAnchor\(/);
  assert.match(reader, /const onPointerUp = \(event: PointerEvent\)/);
  assert.match(reader, /document\.addEventListener\(['"]pointerup['"], onPointerUp, true\)/);
  assert.match(reader, /target\.closest\(['"]\[data-reader-selection-actions\]['"]\)/);
  const editor = fs.readFileSync(path.join(repoRoot, 'src/components/editor/StudyEditor.tsx'), 'utf8');
  assert.match(editor, /anchorToolbarToPointer\(root\.parentElement \?\? root, toolbar\)/);
});

test('a highlight the reader clicks offers the whole ribbon, plus the trash', () => {
  const reader = fs.readFileSync(path.join(repoRoot, 'src/components/ReaderSelectionActions.tsx'), 'utf8');
  // One target covers both a loose selection and a stored highlight, so copy,
  // comment, bookmark and quote reach a painted passage too.
  assert.match(reader, /const target: \{\s*anchor: ReaderAnchor;\s*highlight: WritingDraftAnnotation \| null/);
  assert.match(reader, /target\.highlight\s*\n\s*\? recolorHighlight\(target\.highlight, item\.id\)/);
  assert.match(reader, /\{target\.highlight && \(/);
  // Recolouring writes the new highlight before dropping the old one.
  const recolor = reader.slice(reader.indexOf('const recolorHighlight'), reader.indexOf('const deleteHighlight'));
  assert.ok(recolor.indexOf('onCreateAnnotation(') < recolor.indexOf('onDeleteAnnotation('), 'the new colour is written first');
});

test('the editor toolbar keeps out of sight until the pointer is released', () => {
  const anchored = fs.readFileSync(path.join(repoRoot, 'src/components/editor/pointerAnchoredToolbar.ts'), 'utf8');
  // Milkdown shows its toolbar on every selection change; while the button is
  // down the selection is still growing and the toolbar must not follow it.
  assert.match(anchored, /write\('visibility', dragging \? 'hidden' : ''\)/);
  assert.match(anchored, /if \(dragging \|\| !pointer \|\| toolbar\.dataset\.show !== 'true'\) return/);
  assert.match(anchored, /dragging = true/);
  assert.match(anchored, /addEventListener\('pointerup', onPointerUp, true\)/);
  // floating-ui rewrites left/top on every recompute, so the correction is kept
  // in the transform it never touches.
  assert.match(anchored, /write\('transform', `translate\(/);
  assert.doesNotMatch(anchored, /toolbar\.style\.left =/);
});
