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
