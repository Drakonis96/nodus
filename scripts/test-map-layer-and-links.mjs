import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const [mapView, placesMap, main] = await Promise.all([
  readFile(new URL('../src/views/MapView.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/PlacesMap.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../electron/main.ts', import.meta.url), 'utf8'),
]);

test('map filter toolbar and dropdown stay locally above Leaflet layers', () => {
  assert.match(mapView, /relative z-20[^"\n]*border-b/);
  assert.match(mapView, /data-testid="map-person-filter-dropdown"/);
  assert.match(mapView, /data-testid="map-person-filter"/);
  assert.match(mapView, /absolute z-30/);
  assert.match(mapView, /relative z-0 flex min-h-0 flex-1/);
  assert.doesNotMatch(mapView, /z-\[1000\]|z-\[1100\]/);
});

test('Leaflet attribution links use the safe system-browser bridge', () => {
  assert.match(placesMap, /closest<HTMLAnchorElement>\('a\[href\]'\)/);
  assert.match(placesMap, /href\.startsWith\('#'\)/);
  assert.match(placesMap, /url\.origin === window\.location\.origin/);
  assert.match(placesMap, /window\.nodus\.openExternal\(url\.href\)/);
  assert.match(placesMap, /event\.preventDefault\(\)/);
});

test('map fitting waits for a measurable container and records the resulting zoom', () => {
  assert.match(placesMap, /map\.getSize\(\)/);
  assert.match(placesMap, /size\.x <= 0 \|\| size\.y <= 0/);
  assert.match(placesMap, /requestAnimationFrame/);
  assert.match(placesMap, /fitMapToCurrentPoints\(map\)/);
  assert.match(placesMap, /dataset\.mapFit = 'ready'/);
  assert.match(placesMap, /dataset\.mapZoom = String\(map\.getZoom\(\)\)/);
});

test('the main window rejects external in-app navigation as a safety net', () => {
  assert.match(main, /setWindowOpenHandler/);
  assert.match(main, /webContents\.on\('will-navigate'/);
  assert.match(main, /event\.preventDefault\(\)/);
  assert.match(main, /shell\.openExternal\(url\.trim\(\)\)/);
  assert.match(main, /protectMainWindowNavigation\(mainWindow\)/);
});
