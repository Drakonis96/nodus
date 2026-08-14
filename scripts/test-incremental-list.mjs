// Paging budget for the long, unbounded lists (debates, argument routes).
//
// Opening those sections used to paint every card in one render — measured on a
// real corpus, 128k DOM nodes for the argument routes and 90k for the debates —
// which blocked the renderer for one to two seconds. A click on another sidebar
// section was not even processed until the paint finished, so the section could
// not be left again while it loaded. The views now render one page at a time.
//
// Two rules carry that fix and both are asserted here, plus the wiring in the
// views themselves, which is where the first attempt went wrong: paging by
// debate *cluster* still let one connected component paint every contradiction
// inside it.
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
const outDir = await mkdtemp(path.join(repoRoot, 'node_modules', '.nodus-inclist-'));
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

const { incrementalSliceLength } = loadModule('src/incrementalList.ts');
const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('an unweighted list is cut at the budget, never above the list itself', () => {
  const routes = Array.from({ length: 8_498 }, (_, i) => i);
  assert.equal(incrementalSliceLength(routes, 40), 40);
  assert.equal(incrementalSliceLength(routes, 80), 80);
  assert.equal(incrementalSliceLength(routes.slice(0, 12), 40), 12);
  assert.equal(incrementalSliceLength([], 40), 0);
});

test('weight counts what an item actually paints, not how many items there are', () => {
  // 30 debates spread over clusters of three: six blocks fill a 25-card page,
  // not twenty-five blocks (which would have painted 75 cards).
  const blocks = Array.from({ length: 10 }, () => ({ debates: [1, 2, 3] }));
  const weight = (block) => block.debates.length;
  const taken = incrementalSliceLength(blocks, 25, weight);
  assert.equal(taken, 9, `expected the budget to stop at nine blocks, got ${taken}`);
  const painted = blocks.slice(0, taken).reduce((sum, b) => sum + b.debates.length, 0);
  assert.ok(painted <= 25 + 3, `a page must not overshoot by more than one block, painted ${painted}`);
});

test('the first item always renders, however heavy it is', () => {
  // The pathological corpus: one connected component holding every contradiction.
  const blocks = [{ debates: Array.from({ length: 900 }, (_, i) => i) }, { debates: [1] }];
  const taken = incrementalSliceLength(blocks, 25, (b) => b.debates.length);
  assert.equal(taken, 1, 'a single over-budget block must still render, and alone');
});

test('a zero or negative weight cannot stall the page', () => {
  const blocks = Array.from({ length: 500 }, () => ({ debates: [] }));
  const taken = incrementalSliceLength(blocks, 25, (b) => b.debates.length);
  assert.equal(taken, 25, `an empty-weight item must still cost one, got ${taken}`);
});

test('the debates view pages by cards, not by cluster', () => {
  const source = read('src/views/DebateView.tsx');
  assert.match(
    source,
    /useIncrementalList\(blocks, DEBATES_PAGE_SIZE, blockWeight\)/,
    'DebateView must page the render blocks with a weight, or one big cluster paints every card in it'
  );
  assert.match(source, /shownBlocks\.map/, 'DebateView must render the paged slice, not the full list');
  assert.doesNotMatch(
    source,
    /\{clusters\.map|\{filtered\.map|\{debates\.map/,
    'DebateView must not map the unpaged list anywhere in its JSX'
  );
});

test('the argument route picker pages its suggestions', () => {
  const source = read('src/views/ArgumentMapView.tsx');
  // Trailing arguments are open on purpose: the list also opens wide enough to reach
  // a restored anchor. What matters here is that it still pages at all.
  assert.match(source, /useIncrementalList<ArgumentRouteSuggestion>\(filteredSuggestions, ROUTES_PAGE_SIZE[,)]/);
  assert.match(source, /\{shownSuggestions\.map/, 'the picker must render the paged slice');
  assert.doesNotMatch(
    source,
    /\{filteredSuggestions\.map/,
    'the picker must not map the full filtered list'
  );
});

test('only a manual click spins the refresh button', () => {
  // Entering the section discovers routes automatically and shows its own
  // indicator. Wiring the button icon to the same flag spun both at once, which
  // read as if the app were refreshing on its own.
  const source = read('src/views/ArgumentMapView.tsx');
  assert.match(
    source,
    /className=\{refreshing \? 'animate-spin' : ''\}/,
    'the refresh icon must spin on the manual-refresh flag'
  );
  assert.match(source, /onClick=\{\(\) => discoverRoutes\(true\)\}/, 'the button must ask for a manual refresh');
  // The app header carries its own icon-only «Actualizar» (Zotero sync), so this
  // button needs an identity of its own for anything driving the real window.
  assert.match(source, /data-testid="argument-routes-refresh"/, 'the refresh button must be addressable');
  assert.match(
    source,
    /if \(manual\) setRefreshing\(true\)/,
    'discoverRoutes must only raise the manual flag when asked to'
  );
  assert.doesNotMatch(
    source,
    /name="sync" className=\{suggestionsLoading \? 'animate-spin' : ''\}/,
    'the refresh icon must no longer follow the automatic discovery flag'
  );
});

test('the seed picker query waits for the mode that uses it', () => {
  // The section opens in automatic mode, where there is no seed picker. Loading
  // it on mount cost a second blocking main-process round trip on entry.
  const source = read('src/views/ArgumentMapView.tsx');
  assert.match(
    source,
    /if \(mode !== 'ai' \|\| pickerRequested\.current\) return;/,
    'listPickerIdeas must be deferred until the IA mode is selected, and asked for once'
  );
});
