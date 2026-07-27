// Measuring an invented world: what the interface says when it CAN'T measure.
//
// The arithmetic is covered by test-world-map-geometry.mjs. What is pinned here is the
// other half, which is the half that misleads a writer: an uncalibrated map must read
// "sin escala", never "0 km", and a travel time that cannot be converted must read "—",
// never a number. The impossible-journey report is built on top of these, so a fabricated
// zero here becomes a confidently wrong warning later.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('the scale bar and the compass are drawn natively, not baked into the image', async () => {
  const tools = await read('src/components/world/mapTools.tsx');
  // A scale bar drawn by an image model is wrong the moment the map is extended by an
  // edge, and a compass rose it drew points wherever it felt like.
  assert.match(tools, /data-testid="map-scale-bar"/);
  assert.match(tools, /data-testid="map-compass"/);
  assert.match(tools, /<svg /, 'the compass is an SVG we control');
  // The bar re-rounds on every zoom: its length in SCREEN pixels is what the reader
  // measures against, so one drawn at the initial zoom is a lie at every other.
  assert.match(tools, /leaflet\.on\('zoomend moveend'/);
  assert.match(tools, /niceScaleStep\(/);
  assert.match(tools, /latLngToContainerPoint/, 'measured in screen pixels, not canvas units');
});

test('the scale bar recomputes on the tick VALUE, not on the stable setter', async () => {
  const tools = await read('src/components/world/mapTools.tsx');
  // Found by looking at it, not by a test: `useMemo(..., [.., setTick])` compiles, reads
  // correctly and never recomputes, because React guarantees the setter is stable. The
  // bar kept saying "50 km" over 125 px while the reader zoomed in and the ground under
  // those pixels shrank to a fifth. It looks right and it is a lie.
  assert.match(tools, /const \[tick, setTick\] = useState\(0\)/);
  const memo = tools.slice(tools.indexOf('const bar = useMemo('), tools.indexOf('const unit = map.projection'));
  assert.match(memo, /\}, \[geometry, leaflet, frame, tick\]\);/);
  assert.doesNotMatch(memo, /setTick\]/, 'depending on the setter freezes the bar forever');
});

test('an uncalibrated map says so instead of inventing a number', async () => {
  const tools = await read('src/components/world/mapTools.tsx');
  assert.match(tools, /data-testid="map-no-scale"/);
  assert.match(tools, /data-testid="map-ruler-uncalibrated"/);
  // The scale bar renders the "sin escala" branch when `niceScaleStep` returns null, and
  // the ruler renders its warning when `measureDistance` does. Neither may fall back to 0.
  assert.match(tools, /if \(!isCalibrated\(geometry\)\) return null;/);
  assert.match(tools, /distance == null \?/);
  assert.doesNotMatch(tools, /measureDistance\([^)]*\) \?\? 0/, 'never a fabricated zero');
  assert.doesNotMatch(tools, /unitsPerPixel\([^)]*\) \?\? 0/);
});

test('a travel time that cannot be converted shows a dash', async () => {
  const tools = await read('src/components/world/mapTools.tsx');
  // `travelDays` returns null for a `custom` unit paced in km. Printing 0, or NaN, or the
  // raw distance would each look like an answer.
  assert.match(tools, /days == null \? '—'/);
  // …and the calibration panel warns before the author picks that unit, rather than
  // letting them find out when every travel time is a dash.
  assert.match(tools, /«Unidades» mide en sí misma/);
});

test('calibration stores the two endpoints, never a length', async () => {
  const view = await read('src/views/WorldMapsView.tsx');
  // Two points survive a regeneration at another resolution (they are still the same two
  // points of the drawing) and survive an outpaint (they transform with everything else).
  // A stored length survives neither.
  assert.match(view, /scaleX0: segment\.from\.x,\s*\n\s*scaleY0: segment\.from\.y,\s*\n\s*scaleX1: segment\.to\.x,\s*\n\s*scaleY1: segment\.to\.y,/);
  assert.match(view, /scaleDistance: distance,\s*\n\s*scaleUnit: unit,/);
});

test('the two-click tools share one segment, and leaving one clears it', async () => {
  const view = await read('src/views/WorldMapsView.tsx');
  // Calibrate and measure ask the map the same question — "these two points" — and differ
  // only in what they do with the answer.
  assert.match(view, /type MapTool = 'none' \| 'calibrate' \| 'measure'/);
  assert.match(view, /const \[segment, setSegment\] = useState<PendingSegment \| null>\(null\)/);
  // A half-drawn segment left behind means re-entering the tool starts from a point the
  // author does not remember clicking.
  assert.match(view, /const setToolAndReset = \(next: MapTool\) => \{\s*\n\s*setSegment\(null\);/);
  // The second click completes the segment; the third starts a new one.
  assert.match(view, /current && !current\.to \? \{ \.\.\.current, to: point \} : \{ from: point, to: null \}/);
});

test('travel modes are seeded on first use, not at vault creation', async () => {
  const [view, repo] = await Promise.all([
    read('src/views/WorldMapsView.tsx'),
    read('electron/db/mapMarkersRepo.ts'),
  ]);
  // A writer who never measures anything should not find four rows they did not ask for.
  assert.match(view, /window\.nodus\.ensureTravelModes\(\)/);
  assert.match(repo, /export function ensureTravelModes/);
  assert.match(repo, /if \(existing\.length > 0\) return existing;/, 'seeding is idempotent');
});
