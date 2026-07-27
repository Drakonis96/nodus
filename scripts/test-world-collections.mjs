// The pure foundations of the worldbuilding collections: faceted filtering and the place
// vocabulary with its containment scale.
//
// Both are the kind of code whose bugs are invisible rather than loud. A filter that
// combines its dimensions with OR instead of AND returns almost everything and reads as a
// broken filter; a cycle check that misses a case hangs the renderer with no error at all.
// Half the assertions below pin down what must NOT happen.

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
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-world-collections-'));

function load(file) {
  const bundle = path.join(outDir, `${path.basename(file, '.ts')}.cjs`);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [path.join(repoRoot, file), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`],
    { cwd: repoRoot, stdio: 'inherit' }
  );
  return require(bundle);
}

const f = load('shared/worldFilters.ts');
const pk = load('shared/placeKinds.ts');

test.after(() => rm(outDir, { recursive: true, force: true }));

// ── Faceted filtering ────────────────────────────────────────────────────────

const CAST = [
  { id: 'a', name: 'Kaelen Vor', role: 'protagonist', culture: 'vael', species: 'Semielfo', tags: ['corte', 'espía'] },
  { id: 'b', name: 'Serel', role: 'antagonist', culture: 'vael', species: 'Humano', tags: ['corte'] },
  { id: 'c', name: 'Thorgrim', role: 'secondary', culture: 'norte', species: 'Humano', tags: [] },
  { id: 'd', name: 'Sin cultura', role: 'protagonist', culture: null, species: null, tags: [] },
];

const accessors = {
  facets: (item) => ({ role: item.role, culture: item.culture, species: item.species, tags: item.tags }),
  searchText: (item) => [item.name],
};

const filter = (facets, search = '') => f.applyWorldFilter(CAST, { search, facets }, accessors).map((item) => item.id);

test('an empty filter returns everything', () => {
  assert.deepEqual(filter({}), ['a', 'b', 'c', 'd']);
  assert.equal(f.isFiltering(f.EMPTY_WORLD_FILTER), false);
});

test('values within one dimension combine with OR', () => {
  assert.deepEqual(filter({ role: ['protagonist', 'antagonist'] }), ['a', 'b', 'd']);
});

test('dimensions combine with AND — the rule that makes a facet bar useful', () => {
  // Protagonist OR antagonist, AND culture Vael. If these combined with OR instead, 'c'
  // would come back too and the filter would look broken.
  assert.deepEqual(filter({ role: ['protagonist', 'antagonist'], culture: ['vael'] }), ['a', 'b']);
  assert.deepEqual(filter({ role: ['secondary'], culture: ['vael'] }), [], 'no overlap means no results');
});

test('an item with no value in a dimension does NOT match that dimension', () => {
  // 'd' has no culture. It must not appear under "Culture: Vael" just because it is empty.
  assert.deepEqual(filter({ culture: ['vael'] }), ['a', 'b']);
  assert.ok(!filter({ culture: ['vael'] }).includes('d'));
});

test('multi-value dimensions match on any of their values', () => {
  assert.deepEqual(filter({ tags: ['espía'] }), ['a']);
  assert.deepEqual(filter({ tags: ['corte'] }), ['a', 'b']);
});

test('an empty selection does not filter, and is not stored', () => {
  assert.deepEqual(filter({ role: [] }), ['a', 'b', 'c', 'd']);
  const state = f.setFacet({ search: '', facets: { role: ['protagonist'] } }, 'role', []);
  assert.deepEqual(state.facets, {}, 'a cleared facet is removed, not left as an empty array');
  assert.equal(f.isFiltering(state), false);
});

test('search ignores accents and case, and combines with the facets', () => {
  assert.deepEqual(filter({}, 'kaëlen'), ['a']);
  assert.deepEqual(filter({}, 'THORGRIM'), ['c']);
  assert.deepEqual(filter({ culture: ['vael'] }, 'serel'), ['b'], 'search narrows the faceted result');
  assert.deepEqual(filter({ culture: ['norte'] }, 'serel'), [], 'and cannot widen it');
});

test('toggling a value adds and removes it', () => {
  let state = f.EMPTY_WORLD_FILTER;
  state = f.toggleFacetValue(state, 'role', 'protagonist');
  assert.deepEqual(state.facets.role, ['protagonist']);
  state = f.toggleFacetValue(state, 'role', 'antagonist');
  assert.deepEqual(state.facets.role, ['protagonist', 'antagonist']);
  state = f.toggleFacetValue(state, 'role', 'protagonist');
  assert.deepEqual(state.facets.role, ['antagonist']);
  assert.equal(f.activeFacetCount(state), 1);
  state = f.toggleFacetValue(state, 'role', 'antagonist');
  assert.deepEqual(state.facets, {}, 'removing the last value clears the dimension');
});

test('clearing keeps the search box — they are separate controls', () => {
  const cleared = f.clearFilters({ search: 'kaelen', facets: { role: ['protagonist'] } });
  assert.equal(cleared.search, 'kaelen');
  assert.deepEqual(cleared.facets, {});
});

test('distinct options come with counts, most common first', () => {
  const options = f.distinctOptions(CAST.map(accessors.facets), 'species');
  assert.deepEqual(options, [
    { id: 'Humano', label: 'Humano', count: 2 },
    { id: 'Semielfo', label: 'Semielfo', count: 1 },
  ]);
  // Multi-value dimensions count each value, not each item.
  assert.deepEqual(f.distinctOptions(CAST.map(accessors.facets), 'tags'), [
    { id: 'corte', label: 'corte', count: 2 },
    { id: 'espía', label: 'espía', count: 1 },
  ]);
});

// ── Place kinds and the containment scale ────────────────────────────────────

test('the vocabulary is coherent: unique ids, a label and a group each', () => {
  const ids = pk.PLACE_KINDS.map((kind) => kind.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate ids');
  for (const kind of pk.PLACE_KINDS) {
    assert.ok(kind.label.trim(), `${kind.id} has a label`);
    assert.ok(kind.group.trim(), `${kind.id} has a group`);
    assert.ok(Number.isInteger(kind.scale), `${kind.id} has an integer scale`);
  }
  // Groups must stay contiguous, or the picker renders the same heading twice.
  const groups = pk.placeKindGroups().map((entry) => entry.group);
  assert.equal(new Set(groups).size, groups.length, 'each group appears once');
});

test('the scale ranks containment the way a reader expects', () => {
  const scaleOf = (id) => pk.placeKind(id).scale;
  assert.ok(scaleOf('universe') < scaleOf('planet'));
  assert.ok(scaleOf('planet') < scaleOf('continent'));
  assert.ok(scaleOf('continent') < scaleOf('country'));
  assert.ok(scaleOf('country') < scaleOf('city'));
  assert.ok(scaleOf('city') < scaleOf('district'));
  assert.ok(scaleOf('district') < scaleOf('room'));
});

test('a child kind is suggested from the parent, one step down', () => {
  assert.equal(pk.placeKind(pk.suggestedChildKind('city')).scale, pk.placeKind('district').scale);
  assert.equal(pk.placeKind(pk.suggestedChildKind('country')).scale, pk.placeKind('province').scale);
  // With no parent it suggests nothing rather than guessing.
  assert.equal(pk.suggestedChildKind(null), null);
  assert.equal(pk.suggestedChildKind('desconocido'), null);
  // The deepest kind has nothing below it.
  assert.equal(pk.suggestedChildKind('other'), null);
});

test('a place containing something bigger than itself is warned about', () => {
  const warning = pk.checkPlaceScale('continent', 'city');
  assert.ok(warning);
  assert.equal(warning.values.child, 'Continente');
  assert.equal(warning.values.parent, 'Ciudad');
});

test('the scale check stays quiet on everything that is ordinary', () => {
  // The normal direction.
  assert.equal(pk.checkPlaceScale('district', 'city'), null);
  assert.equal(pk.checkPlaceScale('city', 'country'), null);
  // Equal scales: a Region inside a Region, a District inside a District. Common enough
  // that warning would make the check noise.
  assert.equal(pk.checkPlaceScale('region', 'forest'), null);
  assert.equal(pk.checkPlaceScale('city', 'town'), null);
  // Unknown or absent kinds cannot be judged.
  assert.equal(pk.checkPlaceScale(null, 'city'), null);
  assert.equal(pk.checkPlaceScale('city', null), null);
  assert.equal(pk.checkPlaceScale('city', 'municipality'), null, 'a genealogy kind is not judged');
});

test('cycles in the place tree are caught before they can hang the render', () => {
  // a → b → c (c is the root)
  const parents = { a: 'b', b: 'c', c: null };
  const parentOf = (id) => parents[id] ?? null;
  assert.equal(pk.wouldCycle('a', 'c', parentOf), false, 'reparenting further up the same branch is fine');
  assert.equal(pk.wouldCycle('c', 'a', parentOf), true, 'making the root a child of its own descendant closes a loop');
  assert.equal(pk.wouldCycle('a', 'a', parentOf), true, 'a place cannot contain itself');
  assert.equal(pk.wouldCycle('a', null, parentOf), false, 'detaching is always allowed');
  // An already-corrupt chain must terminate rather than loop forever.
  const broken = { x: 'y', y: 'x' };
  assert.equal(pk.wouldCycle('z', 'x', (id) => broken[id] ?? null), true);
});
