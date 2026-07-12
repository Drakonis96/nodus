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

const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-map-'));
const bundle = path.join(outDir, 'mapProjection.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'shared/mapProjection.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=es2022',
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);
const mp = require(bundle);

test.after(() => rm(outDir, { recursive: true, force: true }));

test('equirectangular projection maps corners and centre', () => {
  assert.deepEqual(mp.projectEquirectangular({ lat: 90, lon: -180 }, 360, 180), { x: 0, y: 0 });
  assert.deepEqual(mp.projectEquirectangular({ lat: -90, lon: 180 }, 360, 180), { x: 360, y: 180 });
  assert.deepEqual(mp.projectEquirectangular({ lat: 0, lon: 0 }, 360, 180), { x: 180, y: 90 });
});

test('projection clamps out-of-range coordinates', () => {
  const p = mp.projectEquirectangular({ lat: 200, lon: -400 }, 360, 180);
  assert.equal(p.x, 0);
  assert.equal(p.y, 0);
});

test('migration path orders by date and collapses consecutive same-place stays', () => {
  const stops = [
    { placeId: 'sev', placeName: 'Sevilla', date: '1875', sortKey: '1875-01-01', lat: 37.4, lon: -6 },
    { placeId: 'sev', placeName: 'Sevilla', date: '1877', sortKey: '1877-01-01', lat: 37.4, lon: -6 },
    { placeId: 'mad', placeName: 'Madrid', date: '1880', sortKey: '1880-01-01', lat: 40.4, lon: -3.7 },
    { placeId: 'bcn', placeName: 'Barcelona', date: 'c. 1850', sortKey: '1850-01-01', lat: 41.4, lon: 2.2 },
  ];
  const pathStops = mp.buildMigrationPath(stops);
  assert.deepEqual(
    pathStops.map((s) => s.placeName),
    ['Barcelona', 'Sevilla', 'Madrid'],
    'chronological, with the 1877 Sevilla stay collapsed'
  );
});

test('undated located events sort after dated ones', () => {
  const stops = [
    { placeId: 'a', placeName: 'A', date: null, sortKey: null, lat: 0, lon: 0 },
    { placeId: 'b', placeName: 'B', date: '1900', sortKey: '1900-01-01', lat: 0, lon: 0 },
  ];
  assert.deepEqual(
    mp.buildMigrationPath(stops).map((s) => s.placeName),
    ['B', 'A']
  );
});

test('boundsForPoints: empty → world; single point gets a minimum span', () => {
  const world = mp.boundsForPoints([]);
  assert.ok(world.maxLon - world.minLon > 300, 'no points falls back to the whole world');
  const one = mp.boundsForPoints([{ latitude: 37.4, longitude: -5.6 }]);
  assert.ok(one.maxLat - one.minLat >= 6, 'a lone place still shows its surroundings');
  assert.ok(one.minLat < 37.4 && one.maxLat > 37.4, 'the point is inside the bounds');
});

test('boundsForPoints: adapts to far-flung points (village → world scale)', () => {
  const near = mp.boundsForPoints([
    { latitude: 37.4, longitude: -5.6 },
    { latitude: 37.5, longitude: -5.0 },
  ]);
  const far = mp.boundsForPoints([
    { latitude: 37.4, longitude: -5.6 },
    { latitude: -34.6, longitude: -58.4 }, // Buenos Aires — an emigrant
  ]);
  assert.ok(far.maxLon - far.minLon > near.maxLon - near.minLon, 'a distant place widens the view');
  assert.ok(far.minLat < 0 && far.maxLat > 0, 'both hemispheres are framed');
});

test('projectorFor maps the bounds window into the pixel box', () => {
  const b = { minLat: 0, maxLat: 10, minLon: 0, maxLon: 10 };
  const project = mp.projectorFor(b, 1000, 500);
  assert.deepEqual(project(10, 0), { x: 0, y: 0 }, 'top-left corner');
  assert.deepEqual(project(0, 10), { x: 1000, y: 500 }, 'bottom-right corner');
});

test('year helpers: parse, range and chronological slider filter', () => {
  assert.equal(mp.yearFromSortKey('1889-03-12'), 1889);
  assert.equal(mp.yearFromSortKey(null), null);
  const pts = [{ sortKey: '1865-01-01' }, { sortKey: '1912-01-01' }, { sortKey: null }];
  assert.deepEqual(mp.pointsYearRange(pts), { min: 1865, max: 1912 });
  assert.equal(mp.pointsYearRange([{ sortKey: null }]), null, 'no dated points → no range');
  // Up to 1900: keep 1865, drop 1912; keep the undated one by default.
  assert.equal(mp.filterPointsByYear(pts, 1900).length, 2);
  assert.equal(mp.filterPointsByYear(pts, 1900, false).length, 1, 'undated excluded when asked');
  assert.equal(mp.filterPointsByYear(pts, null).length, 3, 'null year shows everything');
});
