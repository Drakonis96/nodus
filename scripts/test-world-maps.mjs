// Maps of an invented world: schema v97, the repos, and the image pipeline.
//
// Runs against a REAL database under Electron (better-sqlite3 is built for Electron's
// ABI, not for plain node), so the migration is exercised the way a vault exercises it.
//
// What is pinned here is what fails silently otherwise: a canvas growth that misses one
// coordinate leaves a map whose pins are half-moved, a delete that cascades takes every
// city map with the continent, and a WebP encoded at quality 0.88 instead of 88 looks
// perfectly fine in a card and turns to mush the moment the author zooms in.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-world-maps-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-world-maps.mjs'), '--electron-world-maps-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-world-maps-'));
installRuntimeHooks(root);

const close = (actual, expected, tolerance, message) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);

try {
  const maps = require(path.join(repoRoot, 'electron/db/worldMapsRepo.ts'));
  const markers = require(path.join(repoRoot, 'electron/db/mapMarkersRepo.ts'));
  const entities = require(path.join(repoRoot, 'electron/db/entitiesRepo.ts'));
  const store = require(path.join(repoRoot, 'electron/maps/mapImageStore.ts'));
  const { getDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const { SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));

  // ── the migration ──────────────────────────────────────────────────────────
  assert.equal(getDb().pragma('user_version', { simple: true }), SCHEMA_VERSION, `migrated to v${SCHEMA_VERSION}`);
  assert.ok(SCHEMA_VERSION >= 97, 'maps arrived at v97');
  for (const table of ['world_maps', 'map_images', 'map_layers', 'map_markers', 'map_travel_modes']) {
    const row = getDb().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table);
    assert.ok(row, `${table} exists`);
  }
  // The calibration is TWO POINTS, not a length — the whole reason it survives a
  // regeneration at another resolution and an outpaint.
  const mapColumns = getDb().prepare('PRAGMA table_info(world_maps)').all().map((c) => c.name);
  for (const column of ['scale_x0', 'scale_y0', 'scale_x1', 'scale_y1', 'scale_distance', 'scale_unit', 'model_labels']) {
    assert.ok(mapColumns.includes(column), `world_maps.${column}`);
  }
  assert.equal(getDb().pragma('foreign_key_check').length, 0, 'no dangling references');

  // ── maps, the tree, and what a delete does ─────────────────────────────────
  const world = maps.createWorldMap({ name: 'El Mundo Conocido', kind: 'world' });
  const north = maps.createWorldMap({
    name: 'El Norte', kind: 'region', parentMapId: world.mapId,
    parentX0: 0.1, parentY0: 0.1, parentX1: 0.4, parentY1: 0.5,
  });
  const city = maps.createWorldMap({ name: 'Aldermoor', kind: 'city', parentMapId: north.mapId });
  assert.equal(maps.listWorldMaps().length, 3);
  assert.deepEqual(maps.mapAncestry(city.mapId).map((m) => m.name), ['Aldermoor', 'El Norte', 'El Mundo Conocido']);
  assert.deepEqual(maps.childMaps(world.mapId).map((m) => m.name), ['El Norte']);

  // A loop makes the breadcrumb walk forever, and a hang has no error to follow. The
  // reparent is REFUSED and the old parent kept, rather than the write failing.
  assert.equal(maps.wouldCycleMaps(world.mapId, city.mapId), true, 'world inside its own grandchild');
  assert.equal(maps.wouldCycleMaps(world.mapId, world.mapId), true, 'a map inside itself');
  assert.equal(maps.wouldCycleMaps(city.mapId, world.mapId), false, 'the legitimate direction');
  const refused = maps.updateWorldMap(world.mapId, { parentMapId: city.mapId });
  assert.equal(refused.parentMapId, null, 'the cycle was refused, not written');
  assert.equal(maps.mapAncestry(city.mapId).length, 3, 'and the tree still terminates');

  // ── markers ────────────────────────────────────────────────────────────────
  const place = entities.createPlace({ name: 'Aldermoor', kind: 'city' });
  const layer = markers.createMapLayer(world.mapId, { name: 'Político', kind: 'political', color: '#b30333' });
  const pin = markers.createMapMarker({ mapId: world.mapId, placeId: place.placeId, layerId: layer.layerId, x: 0.25, y: 0.3 });
  assert.equal(pin.geometryKind, 'point');
  assert.equal(pin.placeName, 'Aldermoor', 'the place name travels with the marker');
  assert.equal(pin.placeKind, 'city');

  // Coordinates are normalized: anything outside 0..1 is a bug upstream, and storing it
  // would put a pin off the edge of a map nobody can drag it back onto.
  const offMap = markers.createMapMarker({ mapId: world.mapId, x: 1.8, y: -0.4 });
  assert.deepEqual([offMap.x, offMap.y], [1, 0], 'clamped on write');
  markers.deleteMapMarker(offMap.markerId);

  // point → circle → polygon is ONE tool: the outline is seeded AROUND the circle so the
  // author dents a shape they already have instead of tracing a coastline from nothing.
  markers.updateMapMarker(pin.markerId, { geometryKind: 'circle', radius: 0.1 });
  const asPolygon = markers.circleToPolygon(pin.markerId, 2, 8);
  assert.equal(asPolygon.geometryKind, 'polygon');
  assert.equal(asPolygon.points.length, 8);
  assert.equal(asPolygon.radius, null, 'the radius is gone once it is a shape');
  assert.equal(asPolygon.placeId, place.placeId, 'and the place, label and layer survive the upgrade');
  assert.equal(asPolygon.layerId, layer.layerId);
  // Seeded around the centre, with the aspect ratio applied so it is drawn as a circle.
  close(asPolygon.points[0].x, 0.35, 1e-6, 'first vertex is due east of the centre');
  close(asPolygon.points[0].y, 0.3, 1e-6, 'and level with it');
  close(asPolygon.points[2].y, 0.3 + 0.1 * 2, 1e-6, 'due south, stretched by the aspect ratio');
  assert.equal(markers.circleToPolygon(asPolygon.markerId, 2), null, 'a polygon is not a circle');
  assert.equal(markers.minimumVertices('polygon'), 3);
  assert.equal(markers.minimumVertices('path'), 2);

  // Deleting a layer DETACHES its markers. Hiding a layer and losing everything on it are
  // very different intentions and only one of them is ever meant.
  markers.deleteMapLayer(layer.layerId);
  assert.equal(markers.getMapMarker(pin.markerId).layerId, null, 'marker survived its layer');
  assert.ok(markers.getMapMarker(pin.markerId).placeId, 'and kept its place');

  // ── the reverse question: where is this place drawn? ───────────────────────
  markers.createMapMarker({ mapId: north.mapId, placeId: place.placeId, x: 0.5, y: 0.5 });
  const appearances = maps.placeMapAppearances(place.placeId);
  assert.deepEqual(appearances.map((a) => a.mapName).sort(), ['El Mundo Conocido', 'El Norte']);
  assert.ok(appearances.every((a) => typeof a.x === 'number'), 'with the coordinates to draw a crop');

  // ── growing the canvas: the dangerous one ──────────────────────────────────
  maps.setMapImage(world.mapId, 'img_fake', 2000, 1000);
  maps.updateWorldMap(world.mapId, {
    scaleX0: 0, scaleY0: 0.5, scaleX1: 1, scaleY1: 0.5, scaleDistance: 400, scaleUnit: 'km',
  });
  const shapeBefore = markers.getMapMarker(pin.markerId);
  const growth = { x0: 0, y0: 0, x1: 0.5, y1: 1 }; // double the width, eastwards
  const grown = maps.growMapCanvas(world.mapId, growth);
  assert.deepEqual([grown.widthPx, grown.heightPx], [4000, 1000], 'the canvas doubled');
  // EVERY coordinate: the anchor, every vertex, and both ends of the calibration.
  const shapeAfter = markers.getMapMarker(pin.markerId);
  close(shapeAfter.x, shapeBefore.x / 2, 1e-9, 'anchor moved');
  assert.equal(shapeAfter.points.length, shapeBefore.points.length);
  for (const [index, point] of shapeAfter.points.entries()) {
    close(point.x, shapeBefore.points[index].x / 2, 1e-9, `vertex ${index} x`);
    close(point.y, shapeBefore.points[index].y, 1e-9, `vertex ${index} y untouched by a horizontal growth`);
  }
  close(grown.scaleX1, 0.5, 1e-9, 'the calibration moved with the image');
  // …and because it did, the map still measures the same ground.
  const geo = require(path.join(repoRoot, 'shared/worldMapGeometry.ts'));
  const spec = {
    widthPx: grown.widthPx, heightPx: grown.heightPx, projection: 'flat',
    scaleFrom: { x: grown.scaleX0, y: grown.scaleY0 }, scaleTo: { x: grown.scaleX1, y: grown.scaleY1 },
    scaleDistance: grown.scaleDistance, scaleUnit: grown.scaleUnit,
  };
  close(geo.measureDistance(spec, { x: 0, y: 0.5 }, { x: 0.5, y: 0.5 }), 400, 1e-6, 'the old width is still 400 km');

  // ── deleting a map ─────────────────────────────────────────────────────────
  const markerCountBefore = markers.listMapMarkers(world.mapId).length;
  assert.ok(markerCountBefore > 0);
  maps.deleteWorldMap(world.mapId);
  assert.equal(markers.listMapMarkers(world.mapId).length, 0, 'markers cascade with their map');
  // Children are DETACHED, never deleted: removing the continent must not silently take
  // every city map with it.
  assert.ok(maps.getWorldMap(north.mapId), 'the child map survived');
  assert.equal(maps.getWorldMap(north.mapId).parentMapId, null, 'orphaned, not destroyed');
  assert.ok(maps.getWorldMap(city.mapId), 'and its own child too');
  assert.ok(entities.getPlace(place.placeId), 'and the place is not a map');

  // ── travel modes ───────────────────────────────────────────────────────────
  assert.deepEqual(markers.listTravelModes(), [], 'nothing is seeded until asked for');
  const seeded = markers.ensureTravelModes();
  assert.equal(seeded.length, 4);
  assert.deepEqual(seeded.map((m) => m.name), ['A pie', 'A caballo', 'Carro', 'Barco']);
  assert.equal(markers.ensureTravelModes().length, 4, 'seeding is idempotent');
  const horse = seeded.find((m) => m.name === 'A caballo');
  assert.equal(markers.updateTravelMode(horse.modeId, { distancePerDay: 60 }).distancePerDay, 60);
  markers.deleteTravelMode(horse.modeId);
  assert.equal(markers.listTravelModes().length, 3);

  // ── the image pipeline ─────────────────────────────────────────────────────
  const { createCanvas } = require('@napi-rs/canvas');
  const source = createCanvas(6000, 3000);
  const context = source.getContext('2d');
  // Noise, so the encoder cannot cheat: a flat fill compresses to nothing at any quality
  // and would hide the 0.88-vs-88 bug this asserts against.
  const noise = context.createImageData(6000, 3000);
  let seed = 7;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < noise.data.length; i += 4) {
    noise.data[i] = rnd() * 255;
    noise.data[i + 1] = rnd() * 255;
    noise.data[i + 2] = rnd() * 255;
    noise.data[i + 3] = 255;
  }
  context.putImageData(noise, 0, 0);
  const png = source.toBuffer('image/png');

  const prepared = await store.prepareMapImage(png);
  assert.equal(prepared.mimeType, 'image/webp');
  // Capped at 4096 on the long side — NOT at the 1280 the decorative pipeline uses, which
  // is the whole reason this module exists.
  assert.equal(prepared.width, store.MAX_MAP_DIMENSION, 'capped at the map limit');
  assert.equal(prepared.height, store.MAX_MAP_DIMENSION / 2, 'and the aspect ratio held');
  assert.ok(prepared.width > 1280, 'a map is not a decorative header');
  assert.ok(prepared.thumbnail && prepared.thumbnail.length < prepared.blob.length, 'the thumbnail is smaller');
  // The quality scale on @napi-rs/canvas is 0–100. Encoded at 0.88 this image would be a
  // few dozen KB of mush; at 88 it is hundreds. The floor catches the mistake.
  assert.ok(prepared.blob.length > 200_000, `a 4096px map must not be mush (${prepared.blob.length} bytes)`);

  // A crop is the no-AI half of "ampliación": exact, instant, offline.
  const cropped = await store.cropMapImage(prepared.blob, { x0: 0.25, y0: 0, x1: 0.75, y1: 0.5 });
  close(cropped.width / cropped.height, (prepared.width * 0.5) / (prepared.height * 0.5), 0.02, 'the crop keeps its shape');
  // A rectangle dragged right-to-left is still a rectangle.
  const backwards = await store.cropMapImage(prepared.blob, { x0: 0.75, y0: 0.5, x1: 0.25, y1: 0 });
  assert.equal(backwards.width, cropped.width);

  // Extending the canvas must agree, pixel for pixel, with what growMapCanvas did to the
  // coordinates — the two are given the SAME growth object for exactly this reason.
  const extended = await store.extendMapCanvas(cropped.blob, { x0: 0, y0: 0, x1: 0.5, y1: 1 });
  close(extended.width / extended.height, (cropped.width * 2) / cropped.height, 0.02, 'the canvas doubled sideways');

  await assert.rejects(() => store.prepareMapImage(Buffer.alloc(0)), /vacío/);
  await assert.rejects(() => store.readMapImageFile('/tmp/whatever.pdf'), /\.pdf/);

  console.log('world maps: OK');
} finally {
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: {
      getPath: () => userDataPath,
      getVersion: () => '0.0.0-test',
      getAppPath: () => repoRoot,
      isPackaged: false,
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (v) => Buffer.from(String(v), 'utf8'),
      decryptString: (v) => Buffer.from(v).toString('utf8'),
    },
    dialog: {},
    shell: {},
    BrowserWindow: class {},
  };

  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) {
      return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        resolveJsonModule: true,
        skipLibCheck: true,
      },
    }).outputText;
    module._compile(output, filename);
  };
}
