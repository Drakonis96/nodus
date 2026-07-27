// Pins, shapes and vertex editing.
//
// Editing vertices by hand instead of pulling in `leaflet-editable` only pays if four
// things are right. Each one of them is invisible when broken — the outline just quietly
// degrades, or undo becomes useless — so each is pinned here.

import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (file) => readFile(path.join(repoRoot, file), 'utf8');
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-map-markers-'));
test.after(() => rm(outDir, { recursive: true, force: true }));

/** The pure helpers, bundled away from React and Leaflet. */
const bundle = path.join(outDir, 'helpers.cjs');
const source = (await read('src/components/world/mapMarkers.tsx'))
  .slice(0, (await read('src/components/world/mapMarkers.tsx')).indexOf('// ── drawing the markers'));
const { writeFileSync } = await import('node:fs');
writeFileSync(path.join(outDir, 'helpers.ts'), source.replace(/^import[\s\S]*?;\n/gm, ''));
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [path.join(outDir, 'helpers.ts'), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`],
  { cwd: repoRoot, stdio: 'inherit' }
);
const helpers = require(bundle);

// ── the pure geometry of editing ────────────────────────────────────────────────

test('midpoints sit between vertices, and a polygon wraps but a path does not', () => {
  const square = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  // A closed shape has as many edges as vertices; an open one has one fewer. Getting this
  // backwards puts a phantom handle across the gap of an unclosed route.
  assert.equal(helpers.midpoints(square, true).length, 4);
  assert.equal(helpers.midpoints(square, false).length, 3);
  const first = helpers.midpoints(square, true)[0];
  assert.deepEqual(first.point, { x: 0.5, y: 0 });
  // The insertion index is AFTER the vertex the edge starts at.
  assert.equal(first.index, 1);
  const wrap = helpers.midpoints(square, true)[3];
  assert.deepEqual(wrap.point, { x: 0, y: 0.5 }, 'the closing edge');
});

test('dragging a midpoint inserts the vertex where the edge was', () => {
  const line = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  const inserted = helpers.insertVertex(line, 1, { x: 0.5, y: 0.5 });
  assert.deepEqual(inserted, [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }]);
  assert.equal(line.length, 2, 'the original is not mutated');
});

test('a shape cannot be deleted below what it can still be drawn with', () => {
  // Alt+click removes a vertex. Below three a polygon is a line and below two a path is
  // nothing — both are shapes Leaflet renders as an invisible artefact the author cannot
  // click on to fix.
  assert.equal(helpers.minimumVertices('polygon'), 3);
  assert.equal(helpers.minimumVertices('path'), 2);
  assert.equal(helpers.minimumVertices('point'), 0);
  const triangle = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }];
  assert.equal(helpers.removeVertex(triangle, 0, 'polygon'), triangle, 'refused, and the same array back');
  const square = [...triangle, { x: 0, y: 1 }];
  assert.equal(helpers.removeVertex(square, 1, 'polygon').length, 3);
  const line = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  assert.equal(helpers.removeVertex(line, 0, 'path'), line);
});

test('a marker is drawn only while it is valid at the playhead', () => {
  // Temporal validity is not only for pins: a polygon with a period IS a border, so this
  // is what expands an empire and burns a forest as the playhead moves.
  const border = { markerId: 'b', fromWorldDay: 100, toWorldDay: 300, layerId: null };
  assert.equal(helpers.markerVisibleAt(border, null), true, 'no playhead shows everything');
  assert.equal(helpers.markerVisibleAt(border, 99), false);
  assert.equal(helpers.markerVisibleAt(border, 100), true, 'inclusive at the start');
  assert.equal(helpers.markerVisibleAt(border, 300), true, 'inclusive at the end');
  assert.equal(helpers.markerVisibleAt(border, 301), false);
  const forever = { markerId: 'f', fromWorldDay: null, toWorldDay: null, layerId: null };
  assert.equal(helpers.markerVisibleAt(forever, 5000), true);
  // Open-ended in one direction only.
  assert.equal(helpers.markerVisibleAt({ fromWorldDay: 100, toWorldDay: null }, 9999), true);
  assert.equal(helpers.markerVisibleAt({ fromWorldDay: null, toWorldDay: 100 }, 9999), false);
});

test('a hidden layer hides its markers, and only its own', () => {
  const layers = [{ layerId: 'a', visible: false }, { layerId: 'b', visible: true }];
  const markers = [
    { markerId: '1', layerId: 'a', fromWorldDay: null, toWorldDay: null },
    { markerId: '2', layerId: 'b', fromWorldDay: null, toWorldDay: null },
    { markerId: '3', layerId: null, fromWorldDay: null, toWorldDay: null },
  ];
  // A marker with no layer is always visible: hiding "political" must not take the
  // unfiled pins with it.
  assert.deepEqual(helpers.visibleMarkers(markers, layers, null).map((m) => m.markerId), ['2', '3']);
});

// ── the four things that make hand-rolled editing worth it ──────────────────────

test('undo is per GESTURE: one commit on release, never one per mousemove', async () => {
  const file = await read('src/components/world/mapMarkers.tsx');
  const editor = file.slice(file.indexOf('export function VertexEditor'), file.indexOf('// ── the marker sheet'));
  // Committing per mousemove makes undoing a thirty-point outline thirty keystrokes, and
  // writes to SQLite thirty times a second.
  assert.match(editor, /const onUp = \(\) => \{[\s\S]*?if \(moved\) commitRef\.current\(pointsRef\.current\);/);
  const onMove = editor.slice(editor.indexOf('const onMove'), editor.indexOf('const onUp'));
  assert.doesNotMatch(onMove, /commitRef\.current/, 'the drag must not commit');
  assert.match(onMove, /applyPoints\(next\)/, 'it only moves the local working copy');
});

test('the committed geometry is written by the GESTURE, not read from a render', async () => {
  const file = await read('src/components/world/mapMarkers.tsx');
  // Found by dragging a vertex, not by a test. `pointsRef.current = points` assigned on
  // each render looks equivalent to writing the ref inside the gesture, and is not: React
  // had not flushed the last `setPoints` of a drag by the time `mouseup` fired, so the
  // commit sent the ORIGINAL outline. The shape moved on screen, the gesture reported
  // exactly once, and nothing was saved — no error anywhere.
  assert.match(file, /const applyPoints = \(next: NormPoint\[\]\) => \{\s*\n\s*pointsRef\.current = next;\s*\n\s*setPoints\(next\);/);
  const editor = file.slice(file.indexOf('export function VertexEditor'), file.indexOf('// ── the marker sheet'));
  // `applyPoints` is the ONE place that may call setPoints; everything else goes through it.
  const outsideHelper = editor.replace(/const applyPoints[\s\S]*?\n  \};\n/, '');
  assert.doesNotMatch(outsideHelper, /setPoints\(/, 'every write goes through applyPoints');
  assert.doesNotMatch(editor, /pointsRef\.current = points;/, 'the ref must not be assigned during render');
});

test('a click does not nudge the vertex it selects', async () => {
  const file = await read('src/components/world/mapMarkers.tsx');
  // Without a threshold, a click to select moves the vertex a pixel or two and the
  // outline degrades just from being looked at.
  assert.match(file, /export const DRAG_THRESHOLD_PX = 4;/);
  assert.match(file, /if \(!moved && origin\.distanceTo\(current\) < DRAG_THRESHOLD_PX\) return;/);
});

test('handles are sized in SCREEN pixels, not map units', async () => {
  const file = await read('src/components/world/mapMarkers.tsx');
  // `L.circleMarker` takes a radius in screen pixels; `L.circle` takes map units and
  // would make every handle unreachable the moment the author zooms out.
  const editor = file.slice(file.indexOf('export function VertexEditor'), file.indexOf('// ── the marker sheet'));
  assert.match(editor, /L\.circleMarker\(/);
  assert.doesNotMatch(editor, /L\.circle\(/, 'a handle in map units vanishes at low zoom');
});

test('Alt+click removes, and map panning is suspended during a drag', async () => {
  const file = await read('src/components/world/mapMarkers.tsx');
  assert.match(file, /if \(event\.originalEvent\.altKey\) \{[\s\S]{0,200}removeVertex\(/);
  // Without this the whole map slides while the author drags a vertex.
  assert.match(file, /leaflet\.dragging\.disable\(\)/);
  assert.match(file, /leaflet\.dragging\.enable\(\)/);
});

// ── the ladder ──────────────────────────────────────────────────────────────────

test('point → circle → shape is one tool, and each rung starts from the one below', async () => {
  const [sheet, repo] = await Promise.all([
    read('src/components/world/mapMarkers.tsx'),
    read('electron/db/mapMarkersRepo.ts'),
  ]);
  assert.match(sheet, /data-testid="map-marker-to-circle"/);
  assert.match(sheet, /data-testid="map-marker-to-polygon"/);
  // The outline is seeded AROUND the circle: nobody traces a coastline from nothing, they
  // dent a shape they already have.
  assert.match(sheet, /window\.nodus\.circleToPolygon\(marker\.markerId, map\.widthPx \/ Math\.max\(1, map\.heightPx\)\)/);
  assert.match(repo, /Math\.sin\(angle\) \* marker\.radius \* aspect/, 'the seed is a circle on screen, not an ellipse');
  // And the identity survives the upgrade — that is the whole point of one table.
  assert.doesNotMatch(sheet, /deleteMapMarker[\s\S]{0,80}createMapMarker/);
});

test('a dropped pin is selected immediately', async () => {
  const view = await read('src/views/WorldMapsView.tsx');
  // The next thing the author wants is to say WHICH place this is. Making them hunt for
  // the pin they just dropped is one click of pure friction.
  const pin = view.slice(view.indexOf("if (tool === 'pin')"), view.indexOf("if (tool === 'none') return;"));
  assert.match(pin, /createMapMarker\(\{ mapId: map\.mapId, x: point\.x, y: point\.y/);
  assert.match(pin, /setSelectedMarkerId\(created\.markerId\)/);
  assert.match(view, /testId="world-map-tool-pin"/);
});

test('a pin points at a saved place, and can lead into another map', async () => {
  const sheet = await read('src/components/world/mapMarkers.tsx');
  // "Clicking a pin adds one of the places you already saved" — the whole reason the
  // marker table has a nullable place_id rather than a name.
  assert.match(sheet, /data-testid="map-marker-place"/);
  assert.match(sheet, /data-testid="map-marker-child"/);
  assert.match(sheet, /pin\.on\('dblclick'/);
});

test('deleting a layer detaches its markers rather than deleting them', async () => {
  const repo = await read('electron/db/mapMarkersRepo.ts');
  const migration = await read('electron/db/migrations.ts');
  // Hiding a layer and losing everything on it are very different intentions.
  assert.match(migration, /layer_id\s+TEXT REFERENCES map_layers\(layer_id\) ON DELETE SET NULL/);
  assert.match(repo, /Its markers are DETACHED, not deleted/);
});
