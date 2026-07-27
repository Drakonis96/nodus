// The prompt for a map of an invented world.
//
// Two things here decide whether generated maps are usable at all, and neither is
// obvious from reading the output: the ORDER (the world's visual seed has to come before
// everything specific to this map, or the second map of your world is a different world)
// and the LABEL NEGATIVE (image models write illegible text, and a map is mostly text).

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
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-map-prompt-'));
const bundle = path.join(outDir, 'mapPrompt.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [path.join(repoRoot, 'shared/mapPrompt.ts'), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`],
  { cwd: repoRoot, stdio: 'inherit' }
);
const mp = require(bundle);
test.after(() => rm(outDir, { recursive: true, force: true }));

const base = { mode: 'create', kind: 'region', style: 'parchment' };

test('the world seed comes before anything specific to this map', () => {
  // The single biggest complaint about generated art is drift: put the anchor late and
  // the model wanders, and the second map of your world is a different world.
  const prompt = mp.buildMapPrompt({
    ...base,
    worldSeed: 'a cold northern world of black basalt and pine',
    mapSeed: 'the drowned coast east of Aldermoor',
    places: [{ name: 'Aldermoor', kind: 'city', bearing: 'north-west' }],
  });
  const style = prompt.indexOf('parchment');
  const world = prompt.indexOf('black basalt');
  const map = prompt.indexOf('drowned coast');
  const content = prompt.indexOf('Aldermoor');
  assert.ok(style < world, 'style first');
  assert.ok(world < map, 'the world before the map: a map belongs to a world');
  assert.ok(map < content, 'and the anchors before the contents');
});

test('by default the model is told to write NOTHING', () => {
  // Image models write illegible or misspelled text and a map is mostly text. Nodus draws
  // the names itself, from the real ones in the vault, so they end up correct, searchable,
  // translatable and able to follow a renamed place.
  const prompt = mp.buildMapPrompt({ ...base, worldSeed: 'x' });
  assert.match(prompt, /no text, no letters, no words, no place names, no legend, no compass rose, no scale bar/);
  // The compass and the scale bar are drawn natively too — one baked into the image is
  // wrong the moment the map is extended by an edge.
  assert.match(prompt, /no compass rose/);
  assert.match(prompt, /no watermark/);
});

test('opting in flips the labels but keeps the rest of the negatives', () => {
  const prompt = mp.buildMapPrompt({ ...base, worldSeed: 'x', modelLabels: true });
  assert.match(prompt, /Write the place names on the map/);
  assert.doesNotMatch(prompt, /no place names/);
  assert.match(prompt, /no watermark/, 'the always-negatives survive');
});

test('the arrangement is described, so a regenerated map is the SAME world', () => {
  const prompt = mp.buildMapPrompt({
    ...base,
    places: [
      { name: 'Aldermoor', kind: 'walled city', bearing: 'north-west' },
      { name: 'Vael', kind: 'mountain fortress', bearing: 'south-east' },
    ],
  });
  // Without the bearings the model puts them wherever it likes, and the second attempt is
  // a different country with the same place names.
  assert.match(prompt, /Aldermoor, a walled city, to the north-west/);
  assert.match(prompt, /Vael, a mountain fortress, to the south-east/);
});

test('bearings come from normalized coordinates', () => {
  assert.equal(mp.bearingOf(0.1, 0.1), 'north-west');
  assert.equal(mp.bearingOf(0.9, 0.9), 'south-east');
  assert.equal(mp.bearingOf(0.5, 0.5), 'centre');
  assert.equal(mp.bearingOf(0.5, 0.1), 'north');
  assert.equal(mp.bearingOf(0.9, 0.5), 'east');
});

test('the intended extent is in the prompt, because it changes what gets drawn', () => {
  // A model draws very different things for 600 km and for 6 km. Without being told it
  // picks a density at random, which is the commonest failure of a generated map: a
  // continent's worth of mountains inside one valley.
  const wide = mp.buildMapPrompt({ ...base, extent: { distance: 600, unit: 'km' } });
  assert.match(wide, /covers roughly 600 km across/);
  const none = mp.buildMapPrompt({ ...base, extent: null });
  assert.doesNotMatch(none, /covers roughly/);
  assert.doesNotMatch(mp.buildMapPrompt({ ...base, extent: { distance: 0, unit: 'km' } }), /covers roughly/);
});

test('each kind of map is a picture of a different thing', () => {
  assert.match(mp.buildMapPrompt({ ...base, kind: 'city' }), /walled city map seen from directly above/);
  assert.match(mp.buildMapPrompt({ ...base, kind: 'dungeon' }), /chambers, corridors/);
  assert.match(mp.buildMapPrompt({ ...base, kind: 'world' }), /every continent and ocean/);
  // …but the style clause is identical across them, which is what makes an atlas.
  const a = mp.buildMapPrompt({ ...base, kind: 'city', worldSeed: 'seed' });
  const b = mp.buildMapPrompt({ ...base, kind: 'dungeon', worldSeed: 'seed' });
  const styleClause = mp.mapStyle('parchment').clause;
  assert.ok(a.includes(styleClause) && b.includes(styleClause));
  assert.ok(a.includes('The world: seed.') && b.includes('The world: seed.'));
});

test('the image-to-image modes say what must NOT change', () => {
  // Zoom and restyle are only useful if the geography survives them; a model left to its
  // own devices redraws the coastline and the child map stops matching its parent.
  assert.match(mp.buildMapPrompt({ ...base, mode: 'zoom' }), /Preserve its coastlines, rivers, mountains and the position of every feature EXACTLY/);
  assert.match(mp.buildMapPrompt({ ...base, mode: 'restyle' }), /must stay EXACTLY as it is; only the rendering changes/);
  assert.match(mp.buildMapPrompt({ ...base, mode: 'expand', edge: 'north' }), /The existing part must be reproduced unchanged/);
  assert.match(mp.buildMapPrompt({ ...base, mode: 'expand', edge: 'north' }), /new area is to the north/);
  assert.doesNotMatch(mp.buildMapPrompt({ ...base, mode: 'create' }), /reference image/);
});

test('every style is real and distinct', () => {
  assert.equal(mp.MAP_STYLES.length, 10);
  const clauses = mp.MAP_STYLES.map((style) => style.clause);
  assert.equal(new Set(clauses).size, clauses.length, 'a duplicated clause is a style that does nothing');
  assert.ok(mp.MAP_STYLES.every((style) => style.clause.length > 30 && style.label.length > 0));
  // An unknown id falls back rather than producing a prompt with `undefined` in it.
  assert.equal(mp.mapStyle('nonsense').id, mp.MAP_STYLES[0].id);
  assert.equal(mp.mapStyle(null).id, mp.DEFAULT_MAP_STYLE);
});

test('nothing to draw from is detected before a provider is paid', () => {
  assert.equal(mp.hasMapPromptMaterial({ ...base }), false);
  assert.equal(mp.hasMapPromptMaterial({ ...base, worldSeed: '   ' }), false);
  assert.ok(mp.hasMapPromptMaterial({ ...base, worldSeed: 'a world' }));
  assert.ok(mp.hasMapPromptMaterial({ ...base, places: [{ name: 'Vael' }] }));
  assert.ok(mp.hasMapPromptMaterial({ ...base, extra: 'a swamp' }));
});

// ── provider capabilities ───────────────────────────────────────────────────────

test('image-to-image is declared per MODEL on OpenRouter, per provider elsewhere', () => {
  // Declaring the whole of OpenRouter capable fails on most of its catalogue; declaring
  // it incapable wastes the models that can. It is the one provider that must be answered
  // model by model.
  assert.equal(mp.supportsReferenceImage('google', 'gemini-3-pro-image'), true);
  assert.equal(mp.supportsReferenceImage('openai', 'gpt-image-1'), true);
  assert.equal(mp.supportsReferenceImage('openai', 'dall-e-3'), false, 'dall-e-3 has no edit endpoint');
  assert.equal(mp.supportsReferenceImage('openrouter', 'google/gemini-2.5-flash-image'), true);
  assert.equal(mp.supportsReferenceImage('openrouter', 'black-forest-labs/flux-1.1-pro'), false);
  // The local generator is text-to-image only, and offline there is no fallback at all.
  assert.equal(mp.supportsReferenceImage('nodus', 'anything'), false);
});

test('the three modes that need a reference are named in one place', () => {
  assert.deepEqual(mp.REFERENCE_MODES.sort(), ['expand', 'restyle', 'zoom']);
  assert.equal(mp.needsReference('zoom'), true);
  assert.equal(mp.needsReference('expand'), true);
  assert.equal(mp.needsReference('restyle'), true);
  assert.equal(mp.needsReference('create'), false);
  assert.equal(mp.needsReference('variant'), false);
});
