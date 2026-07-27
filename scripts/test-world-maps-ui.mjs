// The maps section of a worldbuilding vault: the viewer, the routing and the CSS
// exemptions the genealogy map would otherwise break.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('worldbuilding gets its own map section, and genealogy keeps its own', async () => {
  const app = await read('src/App.tsx');
  // The genealogy map projects lat/lon onto OpenStreetMap tiles. An invented world has no
  // gazetteer coordinates, so that view renders an empty planet every single time — it is
  // not "worse", it cannot work. One entry in the sidebar, two implementations behind it.
  assert.match(app, /view === 'map' && \(isWorldbuilding \? <WorldMapsView \/> : <MapView \/>\)/);
  assert.match(app, /import \{ WorldMapsView \} from '\.\/views\/WorldMapsView'/);
  // And no second entry was added to the sidebar for it.
  const sidebar = await read('src/components/WorldbuildingSidebar.tsx');
  assert.equal((sidebar.match(/view: 'map'/g) ?? []).length, 1, 'exactly one Mapa entry');
});

test('the viewer is CRS.Simple over an image, not a tile server', async () => {
  const canvas = await read('src/components/world/WorldMapCanvas.tsx');
  assert.match(canvas, /crs: L\.CRS\.Simple/);
  assert.match(canvas, /L\.imageOverlay\(/);
  // No tiles, no attribution, no network: an invented world has no OpenStreetMap.
  assert.doesNotMatch(canvas, /tileLayer|openstreetmap|tile\.osm/i);
  assert.match(canvas, /attributionControl: false/);
});

test('the y-axis mirror lives in the pure geometry module, not in the view', async () => {
  const [canvas, geometry] = await Promise.all([
    read('src/components/world/WorldMapCanvas.tsx'),
    read('shared/worldMapGeometry.ts'),
  ]);
  // Leaflet's y points up, an image's points down. That mirror is the single easiest
  // thing here to get backwards and the hardest to notice, so it lives in one pure,
  // unit-tested function instead of inside a component nothing can call from a test.
  assert.match(geometry, /toCanvas: \(point\) => \[height - point\.y \* height, point\.x \* width\]/);
  assert.match(geometry, /fromCanvas: \(lat, lng\) => \(\{ x: lng \/ width, y: \(height - lat\) \/ height \}\)/);
  assert.match(canvas, /canvasFrame\(map\.widthPx, map\.heightPx\)/);
  // The view must not grow its own copy of the conversion.
  assert.doesNotMatch(canvas, /height - .*\.y \* height|height - latlng\.lat/);
});

test("dark mode must never invert an author's map", async () => {
  const css = await read('src/index.css');
  // The genealogy map inverts OSM tiles for dark mode. Applied to a hand-painted or
  // AI-generated map that turns parchment into a photographic negative. `.leaflet-tile`
  // does not match an imageOverlay today, so this rule is not fixing a bug — it makes the
  // exemption explicit so that widening the filter later is already overruled.
  assert.match(css, /\.pm-dark \.leaflet-tile \{\s*\n?\s*filter:/, 'the genealogy inversion still exists');
  assert.match(css, /\.world-map-image[\s\S]{0,120}filter: none !important/);
  const canvas = await read('src/components/world/WorldMapCanvas.tsx');
  assert.match(canvas, /className: 'world-map-image'/, 'the overlay carries the class the rule targets');
  // The stage does NOT carry `pm-dark`, which is what scopes the tile filter to genealogy.
  assert.doesNotMatch(canvas, /pm-dark/);
});

test('a map is a canvas, not a place — both relations are offered', async () => {
  const view = await read('src/views/WorldMapsView.tsx');
  // "The map OF a place" (placeId) and "inside this other map" (parentMapId) are
  // different relations. Offering only the first makes a trade-route map impossible;
  // offering only the second makes "as many maps as places" impossible.
  assert.match(view, /data-testid="world-map-place"/);
  assert.match(view, /placeId: placeId \|\| null/);
  assert.match(view, /parentMapId: parentMapId \|\| null/);
  // The breadcrumb is loaded from the main process, where the loop guard lives.
  assert.match(view, /window\.nodus\.mapAncestry\(map\.mapId\)/);
  assert.match(view, /data-testid="world-map-breadcrumb"/);
});

test('deleting a map says what survives it', async () => {
  const view = await read('src/views/WorldMapsView.tsx');
  // Children are detached, not deleted, and places are never touched. A destructive
  // dialog that does not say so gets dismissed by people who assume the worst.
  const dialog = view.slice(view.indexOf('¿Eliminar este mapa?'), view.indexOf('¿Eliminar este mapa?') + 400);
  assert.match(dialog, /NO se borran/);
  assert.match(dialog, /lugares/i);
  assert.match(dialog, /danger: true/);
});

test('cards use the thumbnail, never the full map', async () => {
  const view = await read('src/views/WorldMapsView.tsx');
  // A base map is megabytes. Drawing a grid of thirty from the full blobs would push
  // hundreds of megabytes through the bridge to render postage stamps.
  const card = view.slice(view.indexOf('function MapCard'), view.indexOf('function MapWorkbench'));
  assert.match(card, /getMapThumbnail\(map\.mapId\)/);
  assert.doesNotMatch(card, /getMapImageBlob/);
  assert.match(card, /revokeObjectURL/, 'and the object URL is released');
});

test('every icon the maps section names exists', async () => {
  const [view, ui, repo] = await Promise.all([
    read('src/views/WorldMapsView.tsx'),
    read('src/components/ui.tsx'),
    read('electron/db/mapMarkersRepo.ts'),
  ]);
  const known = new Set([...ui.matchAll(/^ {2}([A-Za-z0-9_]+):\s*'/gm)].map((m) => m[1]));
  // An unknown name renders an empty box, which reads as a broken build rather than a
  // missing glyph — and nothing in TypeScript catches it.
  for (const [, name] of view.matchAll(/icon: '([a-zA-Z]+)'/g)) {
    assert.ok(known.has(name), `MAP_KINDS icon "${name}" is not in the Icon set`);
  }
  // Scoped to the seeded travel modes: elsewhere in the repo `icon: 'icon'` is a
  // field-to-column mapping, not a glyph name.
  const modes = repo.slice(repo.indexOf('DEFAULT_TRAVEL_MODES'), repo.indexOf('export function ensureTravelModes'));
  const seeded = [...modes.matchAll(/icon: '([a-zA-Z]+)'/g)].map((m) => m[1]);
  assert.ok(seeded.length >= 4, 'the default paces are seeded with icons');
  for (const name of seeded) {
    assert.ok(known.has(name), `travel mode icon "${name}" is not in the Icon set`);
  }
});
