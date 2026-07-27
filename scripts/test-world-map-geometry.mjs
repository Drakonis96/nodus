// The geometry of an invented map.
//
// Everything here fails silently when it is wrong, which is why it is all pinned down:
// a distance that ignores the aspect ratio looks perfectly fine and is off by 40%; a
// canvas growth that forgets one coordinate leaves a map whose pins are half-moved and
// that the author cannot repair by hand; an uncalibrated map that returns 0 instead of
// null puts "0 km" on screen where "sin escala" belongs.

import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-map-geometry-'));

function load(file) {
  const bundle = path.join(outDir, `${path.basename(file, '.ts')}.cjs`);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [path.join(repoRoot, file), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`],
    { cwd: repoRoot, stdio: 'inherit' }
  );
  return require(bundle);
}

const geo = load('shared/worldMapGeometry.ts');
test.after(() => rm(outDir, { recursive: true, force: true }));

/** A 2000×1000 map whose full width is 400 km. */
function wideMap(overrides = {}) {
  return {
    widthPx: 2000,
    heightPx: 1000,
    projection: 'flat',
    scaleFrom: { x: 0, y: 0.5 },
    scaleTo: { x: 1, y: 0.5 },
    scaleDistance: 400,
    scaleUnit: 'km',
    ...overrides,
  };
}

const close = (actual, expected, tolerance, message) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);

// ── units ───────────────────────────────────────────────────────────────────────

test('units convert, and `custom` refuses rather than guessing', () => {
  close(geo.convertDistance(1, 'km', 'm'), 1000, 1e-9, 'km→m');
  close(geo.convertDistance(1, 'mi', 'km'), 1.609344, 1e-9, 'mi→km');
  close(geo.convertDistance(1, 'league', 'km'), 4, 1e-9, 'a land league is 4 km');
  assert.equal(geo.convertDistance(7, 'km', 'km'), 7, 'same unit is the identity');
  // A world's own unit has no defined relation to a metre. Returning a number here
  // would put a confidently wrong distance on screen.
  assert.equal(geo.convertDistance(1, 'custom', 'km'), null);
  assert.equal(geo.convertDistance(1, 'km', 'custom'), null);
  assert.equal(geo.convertDistance(3, 'custom', 'custom'), 3, 'custom measures in itself');
  assert.ok(geo.isMapDistanceUnit('league'));
  assert.equal(geo.isMapDistanceUnit('parsec'), false);
});

// ── measuring ───────────────────────────────────────────────────────────────────

test('distance corrects for the aspect ratio', () => {
  const map = wideMap();
  // Full width = 400 km by construction.
  close(geo.measureDistance(map, { x: 0, y: 0.5 }, { x: 1, y: 0.5 }), 400, 1e-6, 'across');
  // The map is twice as wide as it is tall, so the SAME normalized delta down the y
  // axis is half the distance. Ignoring the aspect ratio would return 400 here — the
  // bug this test exists for.
  close(geo.measureDistance(map, { x: 0, y: 0 }, { x: 0, y: 1 }), 200, 1e-6, 'down');
  // 3-4-5 triangle in pixels: 0.3 of 2000 px and 0.4 of 1000 px is 600×400.
  const diagonal = geo.measureDistance(map, { x: 0, y: 0 }, { x: 0.3, y: 0.4 });
  close(diagonal, (Math.hypot(600, 400) / 2000) * 400, 1e-6, 'diagonal');
});

test('an uncalibrated map measures NOTHING, and says so', () => {
  for (const patch of [
    { scaleFrom: null },
    { scaleTo: null },
    { scaleDistance: null },
    { scaleDistance: 0 },
    { scaleUnit: null },
    { scaleFrom: { x: 0.5, y: 0.5 }, scaleTo: { x: 0.5, y: 0.5 } }, // zero-length segment
  ]) {
    const map = wideMap(patch);
    assert.equal(geo.isCalibrated(map), false, `${JSON.stringify(patch)} is not a calibration`);
    assert.equal(geo.unitsPerPixel(map), null);
    assert.equal(geo.mapDistanceUnit(map), null);
    // Null, never 0 — the interface has to show "sin escala", not "0 km".
    assert.equal(geo.measureDistance(map, { x: 0, y: 0 }, { x: 1, y: 1 }), null);
    assert.equal(geo.measurePath(map, [{ x: 0, y: 0 }, { x: 1, y: 1 }]), null);
    assert.equal(geo.radiusToDistance(map, 0.1), null);
    assert.equal(geo.distanceToRadius(map, 10), null);
  }
});

test('the calibration segment may be any segment, not just the full width', () => {
  // A scale bar drawn in a corner: 0.1 of the width (200 px) is 25 km.
  const map = wideMap({ scaleFrom: { x: 0.8, y: 0.9 }, scaleTo: { x: 0.9, y: 0.9 }, scaleDistance: 25 });
  close(geo.measureDistance(map, { x: 0, y: 0.5 }, { x: 1, y: 0.5 }), 250, 1e-6, 'implied full width');
});

test('a path measures leg by leg, and a lone point is zero', () => {
  const map = wideMap();
  close(geo.measurePath(map, [{ x: 0, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0.5 }]), 400, 1e-6, 'two legs');
  assert.equal(geo.measurePath(map, [{ x: 0.2, y: 0.2 }]), 0);
  assert.equal(geo.measurePath(map, []), 0);
});

test('a circle radius round-trips through world units', () => {
  const map = wideMap();
  close(geo.radiusToDistance(map, 0.25), 100, 1e-6, '0.25 of 400 km');
  close(geo.distanceToRadius(map, 100), 0.25, 1e-9, 'and back');
  // The round trip is what the radius field in the sheet does on every keystroke.
  for (const km of [1, 17, 250]) {
    close(geo.radiusToDistance(map, geo.distanceToRadius(map, km)), km, 1e-6, `${km} km round-trips`);
  }
});

test('a globe measures by great circle, not by paper', () => {
  const map = wideMap({ projection: 'globe', planetRadius: 6371, planetRadiusUnit: 'km' });
  assert.ok(geo.isCalibrated(map), 'a radius IS the calibration of a globe');
  // Quarter of the equator.
  close(geo.measureDistance(map, { x: 0.25, y: 0.5 }, { x: 0.5, y: 0.5 }), (2 * Math.PI * 6371) / 4, 1, 'equator quarter');
  // The same paper distance near the pole is far shorter on the ground. This is the
  // entire reason `globe` exists, so it is asserted rather than assumed.
  const atEquator = geo.measureDistance(map, { x: 0.25, y: 0.5 }, { x: 0.35, y: 0.5 });
  const nearPole = geo.measureDistance(map, { x: 0.25, y: 0.03 }, { x: 0.35, y: 0.03 });
  assert.ok(nearPole < atEquator * 0.2, `near the pole (${nearPole}) must be far shorter than at the equator (${atEquator})`);
  // A globe with no radius still measures, on an Earth-sized default, rather than
  // returning null: a world map with no planet size is the common case.
  const noRadius = wideMap({ projection: 'globe', planetRadius: null });
  assert.ok(geo.measureDistance(noRadius, { x: 0, y: 0.5 }, { x: 0.5, y: 0.5 }) > 0);
});

// ── travel ──────────────────────────────────────────────────────────────────────

test('travel time crosses units, and refuses what it cannot convert', () => {
  const horse = { modeId: 'h', name: 'a caballo', distancePerDay: 50, unit: 'km' };
  close(geo.travelDays(400, 'km', horse), 8, 1e-9, '400 km at 50 km/day');
  close(geo.travelDays(100, 'league', horse), (100 * 4) / 50, 1e-9, 'leagues against a km/day pace');
  assert.equal(geo.travelDays(400, 'custom', horse), null, 'a custom unit cannot be paced in km');
  assert.equal(geo.travelDays(400, 'km', { ...horse, distancePerDay: 0 }), null, 'a mode that never arrives');
});

// ── parent ↔ child ──────────────────────────────────────────────────────────────

test('a point projects into a child map, and OUTSIDE means outside', () => {
  const footprint = { x0: 0.5, y0: 0.25, x1: 0.75, y1: 0.75 };
  assert.deepEqual(geo.projectIntoChild({ x: 0.5, y: 0.25 }, footprint), { x: 0, y: 0 });
  assert.deepEqual(geo.projectIntoChild({ x: 0.75, y: 0.75 }, footprint), { x: 1, y: 1 });
  assert.deepEqual(geo.projectIntoChild({ x: 0.625, y: 0.5 }, footprint), { x: 0.5, y: 0.5 });
  // Null rather than clamped: clamping would pile every distant city onto the border of
  // the new map, which looks like data rather than like an error.
  assert.equal(geo.projectIntoChild({ x: 0.2, y: 0.5 }, footprint), null);
  assert.equal(geo.projectIntoChild({ x: 0.625, y: 0.9 }, footprint), null);
  // A rectangle dragged right-to-left is still a rectangle.
  const backwards = { x0: 0.75, y0: 0.75, x1: 0.5, y1: 0.25 };
  assert.deepEqual(geo.projectIntoChild({ x: 0.625, y: 0.5 }, backwards), { x: 0.5, y: 0.5 });
  // A degenerate footprint has no inside.
  assert.equal(geo.projectIntoChild({ x: 0.5, y: 0.5 }, { x0: 0.5, y0: 0.5, x1: 0.5, y1: 0.5 }), null);
});

test('child and parent projections are inverses', () => {
  const footprint = { x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.9 };
  for (const point of [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }, { x: 0.13, y: 0.87 }]) {
    const back = geo.projectIntoChild(geo.projectIntoParent(point, footprint), footprint);
    close(back.x, point.x, 1e-9, 'x round-trips');
    close(back.y, point.y, 1e-9, 'y round-trips');
  }
});

test('a child inherits a usable scale from its parent', () => {
  const parent = wideMap(); // 400 km across
  // A quarter of the width → the child is 100 km across.
  const inherited = geo.inheritScale(parent, { x0: 0.25, y0: 0.25, x1: 0.5, y1: 0.5 });
  assert.deepEqual(inherited.from, { x: 0, y: 0.5 });
  assert.deepEqual(inherited.to, { x: 1, y: 0.5 });
  close(inherited.distance, 100, 1e-6, 'a quarter of 400 km');
  assert.equal(inherited.unit, 'km');
  // An uncalibrated parent has nothing to hand down.
  assert.equal(geo.inheritScale(wideMap({ scaleDistance: null }), { x0: 0, y0: 0, x1: 1, y1: 1 }), null);
});

test('a scale that disagrees with the footprint is reported', () => {
  const parent = wideMap(); // 400 km across
  const footprint = { x0: 0, y0: 0, x1: 0.1, y1: 0.1 }; // → 40 km of ground
  // A city map that says it is 4 km across is off by ten. This is the warning that
  // catches the error months before a chase scene does.
  const wrong = geo.checkScaleAgreement(
    wideMap({ widthPx: 1000, heightPx: 1000, scaleDistance: 4 }),
    parent,
    footprint,
  );
  assert.ok(wrong, 'ten times off must be reported');
  close(wrong.ratio, 0.1, 1e-6, 'child ÷ parent');
  close(wrong.parentWidth, 40, 1e-6, 'what the footprint implies');
  close(wrong.childWidth, 4, 1e-6, 'what the child claims');
  // Agreement, and near-agreement, say nothing: a warning that cries wolf is ignored.
  assert.equal(geo.checkScaleAgreement(wideMap({ scaleDistance: 40 }), parent, footprint), null);
  assert.equal(geo.checkScaleAgreement(wideMap({ scaleDistance: 44 }), parent, footprint), null, 'within tolerance');
  assert.ok(geo.checkScaleAgreement(wideMap({ scaleDistance: 90 }), parent, footprint), 'twice off is reported');
  // Units are reconciled before comparing: 40 km and 10 leagues are the same thing.
  assert.equal(geo.checkScaleAgreement(wideMap({ scaleDistance: 10, scaleUnit: 'league' }), parent, footprint), null);
});

// ── growing the canvas ──────────────────────────────────────────────────────────

test('growing an edge puts the old image where it belongs', () => {
  // Extend north by half: the old image occupies the bottom two thirds.
  const north = geo.growthForEdge('north', 0.5);
  close(north.y0, 1 / 3, 1e-9, 'old top edge');
  close(north.y1, 1, 1e-9, 'old bottom edge unchanged');
  assert.deepEqual([north.x0, north.x1], [0, 1], 'north does not touch x');
  const west = geo.growthForEdge('west', 1);
  close(west.x0, 0.5, 1e-9, 'doubling westwards halves the old image');
  const south = geo.growthForEdge('south', 0.5);
  close(south.y1, 2 / 3, 1e-9, 'south grows downwards');
  // Growing by nothing is the identity.
  assert.deepEqual(geo.growthForEdge('east', 0), { x0: 0, y0: 0, x1: 1, y1: 1 });
});

test('a canvas growth moves EVERY coordinate the map holds', () => {
  const growth = geo.growthForEdge('north', 1); // old image in the bottom half
  const state = {
    markers: [
      { markerId: 'pin', x: 0.5, y: 0.5, radius: null, points: null },
      { markerId: 'circle', x: 0.25, y: 0, radius: 0.2, points: null },
      { markerId: 'shape', x: 0.5, y: 0.5, radius: null, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] },
    ],
    scaleFrom: { x: 0, y: 1 },
    scaleTo: { x: 1, y: 1 },
    footprint: null,
  };
  const grown = geo.applyCanvasGrowth(state, growth);

  // The pin: x untouched, y compressed into the bottom half.
  close(grown.markers[0].x, 0.5, 1e-9, 'pin x');
  close(grown.markers[0].y, 0.75, 1e-9, 'pin y');
  // The circle radius scales with X, which north did not change.
  close(grown.markers[1].radius, 0.2, 1e-9, 'radius under a vertical growth');
  // Every vertex of a polygon, not just the anchor. Forgetting these is the bug.
  assert.deepEqual(
    grown.markers[2].points.map((p) => [Number(p.x.toFixed(6)), Number(p.y.toFixed(6))]),
    [[0, 0.5], [1, 0.5], [1, 1]],
  );
  // Both ends of the calibration segment — this is what makes the scale survive.
  assert.deepEqual(grown.scaleFrom, { x: 0, y: 1 });
  assert.deepEqual(grown.scaleTo, { x: 1, y: 1 });
});

test('growing sideways scales the circle radius too', () => {
  const growth = geo.growthForEdge('east', 1); // width doubles
  const grown = geo.applyCanvasGrowth(
    { markers: [{ markerId: 'c', x: 1, y: 0.5, radius: 0.4, points: null }], scaleFrom: null, scaleTo: null, footprint: null },
    growth,
  );
  close(grown.markers[0].radius, 0.2, 1e-9, 'the ground it covers did not change');
  close(grown.markers[0].x, 0.5, 1e-9, 'and the centre moved with the canvas');
});

test('the scale SURVIVES an outpaint, which is the point of storing two points', () => {
  const before = wideMap(); // 400 km across a 2000×1000 image
  const growth = geo.growthForEdge('east', 1);
  const grown = geo.applyCanvasGrowth(
    { markers: [], scaleFrom: before.scaleFrom, scaleTo: before.scaleTo, footprint: null },
    growth,
  );
  const size = geo.grownSize(before.widthPx, before.heightPx, growth);
  assert.deepEqual(size, { width: 4000, height: 1000 });
  const after = {
    ...before,
    widthPx: size.width,
    heightPx: size.height,
    scaleFrom: grown.scaleFrom,
    scaleTo: grown.scaleTo,
  };
  // The two cities that were 100 km apart are STILL 100 km apart.
  const a = { x: 0.1, y: 0.5 };
  const b = { x: 0.35, y: 0.5 };
  const wasApart = geo.measureDistance(before, a, b);
  const nowApart = geo.measureDistance(after, geo.growPoint(a, growth), geo.growPoint(b, growth));
  close(nowApart, wasApart, 1e-6, 'the ground did not move');
  close(wasApart, 100, 1e-6, 'and it was 100 km');
});

// ── the scale bar ───────────────────────────────────────────────────────────────

test('the scale bar shows round numbers', () => {
  // 0.37 km per screen pixel over ~120 px ≈ 44 km → the bar reads 20 km.
  const step = geo.niceScaleStep(0.37, 120);
  assert.equal(step.distance, 20);
  close(step.pixels, 20 / 0.37, 1e-9, 'and is drawn at its true width');
  for (const [perPixel, target, expected] of [
    [1, 100, 100],
    [0.001, 100, 0.1],
    [12345, 100, 1000000],
    [0.6, 120, 50],
  ]) {
    const nice = geo.niceScaleStep(perPixel, target);
    assert.equal(nice.distance, expected, `${perPixel} per pixel over ${target}px`);
    assert.ok(nice.pixels <= target, 'the bar never overflows its budget');
  }
  // Junk in, null out — never a bar of NaN pixels.
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(geo.niceScaleStep(bad, 120), null, `${bad} has no bar`);
  }
});

test('distances are formatted for a reader, not for a float', () => {
  assert.equal(geo.formatDistance(400, 'km', 'km'), '400 km');
  assert.equal(geo.formatDistance(47.3218, 'km', 'km'), '47.3 km');
  assert.equal(geo.formatDistance(0.4271, 'km', 'km'), '0.43 km');
  assert.equal(geo.formatDistance(12.0, 'league', 'leguas'), '12 leguas');
  assert.doesNotMatch(geo.formatDistance(1 / 3, 'km', 'km'), /\d{4}/, 'no float tails');
});

// ── the viewer's coordinate frame ───────────────────────────────────────────────

test("the viewer frame mirrors y, because Leaflet's axis points the other way", () => {
  // A 2:1 image. Leaflet's lat grows upwards, an image's y grows downwards, so the top of
  // the image (y = 0) is the TOP of the canvas (lat = height). Getting this backwards
  // flips every pin about the equator and reads as corrupted data, not as a projection.
  const frame = geo.canvasFrame(2000, 1000);
  assert.equal(frame.aspect, 2);
  assert.equal(frame.height, geo.CANVAS_SPAN);
  assert.equal(frame.width, geo.CANVAS_SPAN * 2);
  assert.deepEqual(frame.toCanvas({ x: 0, y: 0 }), [1000, 0], 'top-left of the image');
  assert.deepEqual(frame.toCanvas({ x: 1, y: 1 }), [0, 2000], 'bottom-right');
  assert.deepEqual(frame.toCanvas({ x: 0.5, y: 0.5 }), [500, 1000], 'centre');
  assert.deepEqual(frame.bounds, [[0, 0], [1000, 2000]]);
});

test('the frame round-trips every point, both ways', () => {
  for (const [w, h] of [[2000, 1000], [1000, 2000], [512, 512], [4096, 2731]]) {
    const frame = geo.canvasFrame(w, h);
    for (const point of [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0.13, y: 0.87 }, { x: 0.5, y: 0.5 }]) {
      const [lat, lng] = frame.toCanvas(point);
      const back = frame.fromCanvas(lat, lng);
      close(back.x, point.x, 1e-9, `x round-trips on ${w}x${h}`);
      close(back.y, point.y, 1e-9, `y round-trips on ${w}x${h}`);
    }
  }
});

test('a map with no image still has a frame to render into', () => {
  // The stage has to draw something before the author uploads anything, and dividing by
  // a zero height would produce NaN coordinates for every pin placed on it.
  const frame = geo.canvasFrame(0, 0);
  assert.ok(Number.isFinite(frame.aspect) && frame.aspect > 0);
  assert.ok(frame.toCanvas({ x: 0.5, y: 0.5 }).every(Number.isFinite));
});

// ── clamping ────────────────────────────────────────────────────────────────────

test('normalized coordinates stay normalized', () => {
  assert.equal(geo.clamp01(-0.4), 0);
  assert.equal(geo.clamp01(1.7), 1);
  assert.equal(geo.clamp01(0.3), 0.3);
  assert.deepEqual(geo.clampPoint({ x: -2, y: 3 }), { x: 0, y: 1 });
});
