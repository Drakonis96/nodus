// Generating and enlarging maps.
//
// The prompt itself is covered by test-map-prompt.mjs. What is pinned here is the part
// that would mislead an author rather than break: a provider that cannot take a reference
// must SAY so instead of quietly producing something that does not match, the crop must be
// offered before the AI, and the pixels of an outpaint must be driven by the same growth
// as the coordinates — or the map is silently, permanently wrong.

import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (file) => readFile(path.join(repoRoot, file), 'utf8');
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-map-gen-'));
test.after(() => rm(outDir, { recursive: true, force: true }));

/** `parseSuggestions` is pure; lift it out so it can be exercised without Electron. */
const source = await read('electron/maps/mapGeneration.ts');
const parseSource = source.slice(source.indexOf('export function parseSuggestions'));
await writeFile(path.join(outDir, 'parse.ts'), `interface SuggestedMarker { name: string; kind: string | null; x: number; y: number }\n${parseSource}`);
const bundle = path.join(outDir, 'parse.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [path.join(outDir, 'parse.ts'), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`],
  { cwd: repoRoot, stdio: 'inherit' }
);
const { parseSuggestions } = require(bundle);

// ── the honest degradation ──────────────────────────────────────────────────────

test('a provider that cannot take a reference degrades, and SAYS so', async () => {
  // Simulating image-to-image in silence would be the single most misleading thing this
  // feature could do: the author would get a map that does not match their world and no
  // hint as to why.
  assert.match(source, /const capable = wantsReference && supportsReferenceImage\(provider, model\)/);
  assert.match(source, /const described = await describeReference\(reference!\);/);
  assert.match(source, /degraded = true;/);
  assert.match(source, /no puede partir de una referencia/);
  // A provider we BELIEVED capable and that refused is still a degradation, not an error:
  // the author gets a map plus a notice instead of a dead end.
  assert.match(source, /if \(!\(error instanceof Error\) \|\| error\.message !== 'reference-unsupported'\) throw error;/);
  // The notice reaches the interface.
  const panel = await read('src/components/world/mapGenerate.tsx');
  assert.match(panel, /data-testid="map-degraded-notice"/);
  assert.match(panel, /if \(result\?\.notice\) setNotice\(result\.notice\)/);
});

test('the crop is offered BEFORE the AI, and needs no provider at all', async () => {
  const panel = await read('src/components/world/mapGenerate.tsx');
  const zoom = panel.slice(panel.indexOf('map-pick-region'), panel.indexOf('Extender el lienzo'));
  const cropAt = zoom.indexOf('map-zoom-crop');
  const aiAt = zoom.indexOf('map-zoom-ai');
  assert.ok(cropAt > 0 && cropAt < aiAt, 'the exact, instant, offline path comes first');
  // …and it is the primary button, not a footnote.
  assert.match(zoom.slice(0, aiAt), /btn btn-primary[\s\S]{0,400}map-zoom-crop/);
  // In the main process, cropOnly must not touch a provider.
  assert.match(source, /if \(!request\.cropOnly\) \{/);
  assert.match(source, /const models = request\.cropOnly \? null : imageModel\(\);/);
});

test('a zoom reprojects the markers inside the box, and only those', async () => {
  // This is what makes enlarging feel like magic rather than like work: the three cities
  // already pinned turn up in the right places on the new map, untouched by hand.
  assert.match(source, /const local = projectIntoChild\(\{ x: marker\.x, y: marker\.y \}, region\);\s*\n\s*if \(!local\) continue;/);
  assert.match(source, /createMapMarker\(\{\s*\n\s*mapId: child\.mapId,/);
  // …and the child inherits a usable scale, so it is measurable without calibrating it.
  assert.match(source, /const inherited = inheritedScaleFor\(parent, region\);/);
});

test('an outpaint drives the pixels and the coordinates from the SAME growth', async () => {
  // THE invariant of the whole feature. If the image were computed from a different
  // growth than the coordinates, every pin would be permanently, silently wrong — and the
  // author would have no way to tell, let alone repair it.
  const expand = source.slice(source.indexOf('export async function expandMapCanvas'), source.indexOf('// ── annotating'));
  assert.match(expand, /const growth: CanvasGrowth = growthForEdge\(edge, fraction\);/);
  assert.match(expand, /extendMapCanvas\(source\.bytes, growth\)/);
  assert.match(expand, /growMapCanvas\(map\.mapId, growth\)/);
  assert.equal((expand.match(/growthForEdge\(/g) ?? []).length, 1, 'the growth is computed once');
  // Coordinates first: if the write throws, the map keeps its old image AND its old
  // coordinates, which is consistent. The reverse order would not be.
  const coordsAt = expand.indexOf('growMapCanvas(map.mapId, growth)');
  const imageAt = expand.indexOf('saveMapImage({');
  assert.ok(coordsAt > 0 && coordsAt < imageAt, 'coordinates before the image');
});

test('map images never go through the 1280px decorative pipeline', async () => {
  // The comment naming it is fine; an import or a call is not.
  assert.doesNotMatch(source, /import \{[^}]*optimizedJpegs/);
  assert.doesNotMatch(source, /optimizedJpegs\(/);
  assert.match(source, /prepareMapImage\(/);
  const store = await read('electron/maps/mapImageStore.ts');
  assert.match(store, /MAX_MAP_DIMENSION = 4096/);
});

test('regenerating keeps the previous image, but only one', async () => {
  const repo = await read('electron/db/worldMapsRepo.ts');
  // A map is megabytes; an unbounded history of them would quietly triple the vault, and
  // those bytes travel in every backup and every sync package.
  assert.match(repo, /DELETE FROM map_images WHERE map_id = \? AND role = 'previous'/);
  assert.match(repo, /UPDATE map_images SET role = 'previous' WHERE map_id = \? AND role = 'base'/);
});

test('the world seed is inherited, not stored a second time', async () => {
  // A world already has somewhere to say what it looks like — the seed of its world map.
  // A settings field for the same fact would be a second answer that drifts.
  assert.match(source, /function worldVisualSeed\(map: WorldMap\): string \| null/);
  assert.match(source, /while \(current && !seen\.has\(current\.mapId\)\)/, 'and the walk cannot loop');
  assert.doesNotMatch(source, /worldVisualSeed:/, 'no settings field was invented for it');
});

// ── vision suggestions: everything the model returns is untrusted ───────────────

test('a vision suggestion is parsed defensively, or dropped', () => {
  const good = parseSuggestions('Sure! {"places":[{"name":"Aldermoor","kind":"city","x":0.25,"y":0.4}]} hope that helps');
  assert.deepEqual(good, [{ name: 'Aldermoor', kind: 'city', x: 0.25, y: 0.4 }]);

  // Everything below is a normal answer from a vision model, and none of it may reach the
  // map: a pin at x=4 is off the image, and a nameless one is a label with nothing on it.
  const junk = parseSuggestions(JSON.stringify({
    places: [
      { name: 'Off map', x: 4, y: 0.5 },
      { name: 'Negative', x: -0.2, y: 0.5 },
      { name: 'NaN', x: 'north', y: 0.5 },
      { name: '', x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.5 },
      null,
      'a string',
      { name: 'Good', x: 0.5, y: 0.5 },
    ],
  }));
  assert.deepEqual(junk.map((s) => s.name), ['Good']);
  assert.equal(junk[0].kind, null, 'a missing kind is null, not undefined');

  // Not JSON at all, or the wrong shape: an empty list, never a throw.
  for (const bad of ['', 'I cannot see the map.', '{}', '{"places":"lots"}', '{"places":', 'null']) {
    assert.deepEqual(parseSuggestions(bad), [], JSON.stringify(bad));
  }
  // Capped, so a runaway answer cannot flood the map.
  const many = parseSuggestions(JSON.stringify({
    places: Array.from({ length: 60 }, (_, i) => ({ name: `P${i}`, x: 0.5, y: 0.5 })),
  }));
  assert.equal(many.length, 30);
});

test('accepting a suggestion creates the place, not a floating label', async () => {
  const panel = await read('src/components/world/mapGenerate.tsx');
  // A pin with a name and no place is an annotation; a pin linked to a place is a map.
  assert.match(panel, /createWorldPlace\(\{ name: suggestion\.name, kind: suggestion\.kind \|\| null \}\)/);
  assert.match(panel, /createMapMarker\(\{ mapId: map\.mapId, placeId: place\.placeId/);
  // One at a time, so a wrong suggestion costs one click.
  assert.match(panel, /data-testid="map-suggestions"/);
  assert.match(panel, /setSuggestions\(\(current\) => current\?\.filter\(\(entry\) => entry !== suggestion\)/);
});

test('the label opt-out warns before it is taken', async () => {
  const panel = await read('src/components/world/mapGenerate.tsx');
  assert.match(panel, /data-testid="map-model-labels"/);
  assert.match(panel, /Los modelos de imagen escriben texto ilegible o con faltas/);
});
