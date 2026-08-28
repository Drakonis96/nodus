import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

test('published map detail reuses the Desktop Leaflet canvas contract', async () => {
  const source = await readFile(path.join(root, 'src/serverWeb/vaults/index.tsx'), 'utf8');
  assert.match(source, /WorldMapCanvas map=\{dto\} imageUrl=\{hash \? api\.assetUrl\(spaceId, hash\) : null\}/);
  assert.match(source, /frame\.toCanvas\(\{ x, y \}\)/, 'markers use the shared normalized-to-canvas projection');
  assert.match(source, /L\.circle\(/, 'circle marker geometry is retained');
  assert.match(source, /L\.polygon\(/, 'polygon marker geometry is retained');
  assert.match(source, /L\.polyline\(/, 'path marker geometry is retained');
  assert.match(source, /bindTooltip\(label/);
  assert.match(source, /child_map_id/);
  assert.match(source, /onOpenRecord\?\.\('world-maps', childMapId\)/, 'child map navigation remains available');
  assert.match(source, /world-map-time-control/);
});

test('published map visibility and temporal filters preserve stored state', async () => {
  const source = await readFile(path.join(root, 'src/serverWeb/vaults/index.tsx'), 'utf8');
  assert.match(source, /layer\.visible === false/);
  assert.match(source, /marker\.from_world_day/);
  assert.match(source, /marker\.to_world_day/);
  assert.match(source, /world-scenes/);
  const mapSurface = source.slice(source.indexOf('function MapCatalog'), source.indexOf('type StudyCalendarMode'));
  assert.doesNotMatch(mapSurface, /index \* 37|index \* 71|index \* 47/, 'map coordinates must never be fabricated');
});
