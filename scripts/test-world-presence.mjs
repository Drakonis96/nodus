// Where a character is, and when.
//
// This is the module the timeline, the map-following and the impossible-journey report
// are all built on, so a wrong answer here is wrong in three places at once. Most of what
// is pinned below is about what must NOT happen: an undated residence must never invent a
// journey, three scenes in one city must not read as three arrivals, and "they both lived
// there at some point" must not be reported as a meeting.

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
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-presence-'));
const bundle = path.join(outDir, 'worldPresence.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [path.join(repoRoot, 'shared/worldPresence.ts'), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`],
  { cwd: repoRoot, stdio: 'inherit' }
);
const wp = require(bundle);
test.after(() => rm(outDir, { recursive: true, force: true }));

let seq = 0;
/** A dated presence, the common case. */
const at = (personId, placeId, worldDay, extra = {}) => ({
  personId,
  personName: personId === 'k' ? 'Kestra' : personId === 'd' ? 'Doran' : personId,
  placeId,
  placeName: placeId.toUpperCase(),
  worldDay,
  worldYear: null,
  worldOrder: 0,
  source: 'scene',
  sourceId: `s${seq += 1}`,
  label: null,
  ...extra,
});

// ── the single number line ──────────────────────────────────────────────────────

test('one sort key, whether or not the world has a calendar', () => {
  // With months defined, `worldDay` is the answer.
  assert.equal(wp.presenceKey({ worldDay: 412, worldYear: 3, worldOrder: 2 }), 412);
  // Without, the year plus its tie-break — scaled far enough apart that an order can
  // never spill into the next year, which would silently reorder a whole chapter.
  assert.equal(wp.presenceKey({ worldDay: null, worldYear: 3, worldOrder: 2 }), 3 * wp.ORDER_SCALE + 2);
  assert.ok(
    wp.presenceKey({ worldDay: null, worldYear: 3, worldOrder: 999_999 }) <
      wp.presenceKey({ worldDay: null, worldYear: 4, worldOrder: 0 }),
    'the tie-break cannot overtake the next year',
  );
  assert.equal(wp.presenceKey({ worldDay: null, worldYear: null, worldOrder: 0 }), null);
});

test('undated presences are kept, at the end, whatever the input order', () => {
  // Dropping them would silently lose a residence; sorting them first would put a
  // character somewhere before they were born.
  //
  // Every arrangement is checked because the first version of this used a comparator
  // that returned a constant for nulls — which is INCONSISTENT (it claims both a<b and
  // b<a) and made the outcome depend on which sort V8 picks for that array length.
  // Measured: flipping the null branch changed nothing for three elements, so a
  // single-arrangement test could not tell correct from broken.
  const cases = [
    ['vael', 'aldermoor', 'north'],
    ['north', 'vael', 'aldermoor'],
    ['aldermoor', 'north', 'vael'],
    ['vael', 'north', 'aldermoor'],
  ];
  for (const order of cases) {
    const input = order.map((id) => at('k', id, id === 'vael' ? null : id === 'aldermoor' ? 200 : 100));
    assert.deepEqual(
      wp.sortPresences(input).map((p) => p.placeId),
      ['north', 'aldermoor', 'vael'],
      `input order ${order.join(',')}`,
    );
  }
  // Two undated ones keep their relative order rather than being shuffled.
  const two = wp.sortPresences([at('k', 'a', null), at('k', 'b', null), at('k', 'c', 5)]);
  assert.deepEqual(two.map((p) => p.placeId), ['c', 'a', 'b']);
});

// ── stays ───────────────────────────────────────────────────────────────────────

test('staying is not moving: consecutive presences at one place collapse', () => {
  const stays = wp.buildStays([
    at('k', 'aldermoor', 100),
    at('k', 'aldermoor', 105),
    at('k', 'aldermoor', 110),
    at('k', 'vael', 200),
  ]);
  // Three scenes in Aldermoor are ONE stay. Three would draw two journeys of zero length
  // and make the pin flicker.
  assert.equal(stays.length, 2);
  assert.deepEqual([stays[0].from, stays[0].to], [100, 110]);
  assert.equal(stays[0].presences.length, 3, 'and it remembers what put them there');
  assert.deepEqual([stays[1].from, stays[1].to], [200, 200]);
});

test('returning to a place later is a NEW stay, not the old one', () => {
  const stays = wp.buildStays([at('k', 'a', 10), at('k', 'b', 20), at('k', 'a', 30)]);
  assert.deepEqual(stays.map((s) => [s.placeId, s.from]), [['a', 10], ['b', 20], ['a', 30]]);
});

// ── journeys ────────────────────────────────────────────────────────────────────

test('the gap between two stays is a journey', () => {
  const stays = wp.buildStays([at('k', 'a', 100), at('k', 'b', 120)]);
  const journeys = wp.buildJourneys(stays);
  assert.equal(journeys.length, 1);
  assert.deepEqual(
    [journeys[0].fromPlaceId, journeys[0].toPlaceId, journeys[0].departs, journeys[0].arrives],
    ['a', 'b', 100, 120],
  );
});

test('an undated residence NEVER invents a journey', () => {
  // The whole reason residences are the background. A trip out of something with no date
  // has no duration and no direction, and drawing one would put a character on the road
  // between two places they were never recorded leaving — and would then feed the
  // impossible-journey report a warning about a trip nobody took.
  const stays = wp.buildStays([
    at('k', 'home', null, { source: 'residence', label: 'residencia' }),
    at('k', 'aldermoor', 100),
  ]);
  const journeys = wp.buildJourneys(stays);
  assert.equal(journeys.length, 0, 'no journey may start or end undated');
  // …and the dated stays around it still connect to each other.
  const mixed = wp.buildStays([at('k', 'a', 10), at('k', 'b', 20), at('k', 'home', null, { source: 'residence' })]);
  assert.equal(wp.buildJourneys(mixed).length, 1);
});

test('a character recorded ONLY at undated places makes no journeys at all', () => {
  // Two residences and nothing else. Without the null guard in `buildJourneys` this
  // produces a journey whose departure and arrival are both null, which then flows into
  // `positionAt` and into the impossible-journey report as a trip nobody ever took.
  const stays = wp.buildStays([
    at('k', 'home', null, { source: 'residence' }),
    at('k', 'inn', null, { source: 'residence' }),
  ]);
  assert.equal(stays.length, 2, 'two different places are still two stays');
  assert.deepEqual(wp.buildJourneys(stays), []);
});

// ── position on the playhead ────────────────────────────────────────────────────

test('a character travels between places instead of teleporting', () => {
  const track = wp.buildTracks([at('k', 'a', 100), at('k', 'b', 120)])[0];
  const half = wp.positionAt(track.stays, track.journeys, 110);
  assert.equal(half.placeId, 'a');
  assert.equal(half.towardsPlaceId, 'b');
  assert.equal(half.progress, 0.5, 'halfway along the road');
  // Endpoints belong to the places, not to the road.
  assert.equal(wp.positionAt(track.stays, track.journeys, 100).towardsPlaceId, null);
  assert.equal(wp.positionAt(track.stays, track.journeys, 100).placeId, 'a');
  assert.equal(wp.positionAt(track.stays, track.journeys, 120).towardsPlaceId, null);
  assert.equal(wp.positionAt(track.stays, track.journeys, 120).placeId, 'b');
  // A quarter of the way.
  assert.equal(wp.positionAt(track.stays, track.journeys, 105).progress, 0.25);
});

test('before their first appearance a character is shown faintly, not vanished', () => {
  const track = wp.buildTracks([at('k', 'a', 100), at('k', 'b', 200)])[0];
  const early = wp.positionAt(track.stays, track.journeys, 50);
  // Popping into existence hides where someone came from; a reader scrubbing backwards
  // wants exactly that.
  assert.equal(early.placeId, 'a');
  assert.equal(early.beforeFirst, true);
  assert.equal(wp.positionAt(track.stays, track.journeys, 150).beforeFirst, false);
});

test('after their last appearance they stay where they were left', () => {
  const track = wp.buildTracks([at('k', 'a', 100), at('k', 'b', 200)])[0];
  assert.equal(wp.positionAt(track.stays, track.journeys, 9999).placeId, 'b');
});

test('with no playhead, the last known place; with nothing at all, null', () => {
  const track = wp.buildTracks([at('k', 'a', 100), at('k', 'b', 200)])[0];
  assert.equal(wp.positionAt(track.stays, track.journeys, null).placeId, 'b');
  assert.equal(wp.positionAt([], [], 100), null);
  // Only an undated residence: they are there, and no playhead position changes that.
  const only = wp.buildTracks([at('k', 'home', null, { source: 'residence' })])[0];
  assert.equal(wp.positionAt(only.stays, only.journeys, 500).placeId, 'home');
});

// ── the span the playhead sweeps ────────────────────────────────────────────────

test('the range is the story, not the calendar', () => {
  // A world may span ten thousand years while the story happens over eleven days. A
  // slider over ten thousand years cannot be dragged anywhere useful.
  const tracks = wp.buildTracks([at('k', 'a', 100), at('k', 'b', 111), at('d', 'a', 105)]);
  assert.deepEqual(wp.trackRange(tracks), { min: 100, max: 111 });
  assert.equal(wp.trackRange([]), null);
  assert.equal(wp.trackRange(wp.buildTracks([at('k', 'home', null)])), null, 'nothing dated, no range');
});

test('"next event" skips the empty stretches', () => {
  const tracks = wp.buildTracks([at('k', 'a', 100), at('k', 'b', 460), at('d', 'c', 220)]);
  const moments = wp.trackMilestones(tracks);
  assert.deepEqual(moments, [100, 220, 460]);
  // In a 360-day year, stepping day by day between two scenes half a year apart is
  // unusable; this is what the skip button walks.
  assert.equal(wp.nextMilestone(moments, 100, 1), 220);
  assert.equal(wp.nextMilestone(moments, 219, 1), 220);
  assert.equal(wp.nextMilestone(moments, 460, 1), null, 'nothing after the last');
  assert.equal(wp.nextMilestone(moments, 300, -1), 220);
  assert.equal(wp.nextMilestone(moments, 100, -1), null);
});

// ── encounters ──────────────────────────────────────────────────────────────────

test('when could these two have met?', () => {
  const tracks = wp.buildTracks([
    at('k', 'aldermoor', 100), at('k', 'aldermoor', 130), at('k', 'vael', 200),
    at('d', 'aldermoor', 120), at('d', 'aldermoor', 160),
  ]);
  const met = wp.findEncounters(tracks);
  assert.equal(met.length, 1);
  assert.equal(met[0].placeId, 'aldermoor');
  // Kestra is there 100–130, Doran 120–160: the overlap is 120–130.
  assert.deepEqual([met[0].from, met[0].to], [120, 130]);
  assert.deepEqual(met[0].people.map((p) => p.personName).sort(), ['Doran', 'Kestra']);
});

test('touching at a single moment counts; missing each other does not', () => {
  const touching = wp.findEncounters(wp.buildTracks([
    at('k', 'a', 100), at('k', 'a', 120),
    at('d', 'a', 120), at('d', 'a', 140),
  ]));
  assert.equal(touching.length, 1, 'one shared day IS a meeting');
  assert.deepEqual([touching[0].from, touching[0].to], [120, 120]);

  const missed = wp.findEncounters(wp.buildTracks([
    at('k', 'a', 100), at('k', 'a', 110),
    at('d', 'a', 200), at('d', 'a', 210),
  ]));
  assert.equal(missed.length, 0, 'the same place eighty days apart is not a meeting');

  const elsewhere = wp.findEncounters(wp.buildTracks([
    at('k', 'a', 100), at('k', 'a', 200),
    at('d', 'b', 100), at('d', 'b', 200),
  ]));
  assert.equal(elsewhere.length, 0);
});

test('"they both lived there at some point" is not an encounter', () => {
  // Reporting undated overlaps would bury the real answers under everyone who has ever
  // shared a home town.
  const tracks = wp.buildTracks([
    at('k', 'home', null, { source: 'residence' }),
    at('d', 'home', null, { source: 'residence' }),
  ]);
  assert.deepEqual(wp.findEncounters(tracks), []);
});

// ── tracks ──────────────────────────────────────────────────────────────────────

test('tracks are per character, sorted by name', () => {
  const tracks = wp.buildTracks([at('d', 'a', 10), at('k', 'b', 20), at('k', 'c', 30)]);
  assert.deepEqual(tracks.map((t) => t.personName), ['Doran', 'Kestra']);
  assert.equal(tracks[1].stays.length, 2);
  assert.equal(tracks[1].journeys.length, 1);
  // One character's presences never leak into another's track.
  assert.ok(tracks[0].stays.every((s) => s.personId === 'd'));
});

// ── which map shows this place (M5) ─────────────────────────────────────────────

/** Room ⊂ Castle ⊂ Aldermoor ⊂ North ⊂ World. */
const PARENTS = { room: 'castle', castle: 'aldermoor', aldermoor: 'north', north: 'world', world: null, vael: 'north' };
const parentOf = (id) => PARENTS[id] ?? null;
const candidate = (mapId, placeId, markerPlaceIds, extra = {}) => ({ mapId, placeId, markerPlaceIds, ...extra });

test('a place with no map of its own shows on the nearest map that draws a container', () => {
  // A scene set in a kitchen must show on the city map if that is as specific as the
  // atlas gets, instead of showing nothing at all.
  const maps = [candidate('m-world', 'world', ['aldermoor', 'vael'])];
  const focus = wp.resolveMapFocus('room', maps, parentOf);
  assert.equal(focus.mapId, 'm-world');
  assert.equal(focus.shownPlaceId, 'aldermoor', 'the nearest container the atlas draws');
  assert.equal(focus.depth, 2, 'room → castle → aldermoor');
});

test('staying on the map already on screen beats everything else', () => {
  // Without this rule the view changes map every other day and the reader is seasick.
  // It is the single thing that makes auto-following usable rather than a strobe.
  // TWO maps draw Aldermoor, and one of them is the map OF Aldermoor. Rule 2 would pick
  // that one; rule 1 must keep the reader where they already are. A single-candidate case
  // proves nothing here, because every rule agrees when there is only one answer.
  const maps = [
    candidate('m-city', 'aldermoor', ['aldermoor', 'castle']),
    candidate('m-north', 'north', ['aldermoor', 'vael']),
  ];
  assert.equal(
    wp.resolveMapFocus('aldermoor', maps, parentOf, { currentMapId: 'm-north' }).mapId,
    'm-north',
    'stays put even though m-city is the map OF Aldermoor',
  );
  assert.equal(wp.resolveMapFocus('aldermoor', maps, parentOf, { currentMapId: 'm-city' }).mapId, 'm-city');
  // …and the current map is only kept if it can actually show them.
  assert.equal(wp.resolveMapFocus('vael', maps, parentOf, { currentMapId: 'm-city' }).mapId, 'm-north');
  // With no current map, rule 2 takes over.
  assert.equal(wp.resolveMapFocus('aldermoor', maps, parentOf, { currentMapId: null }).mapId, 'm-city');
});

test('the map OF a place beats a map that merely has a dot for it', () => {
  const maps = [
    candidate('m-north', 'north', ['aldermoor']),
    candidate('m-city', 'aldermoor', ['aldermoor']),
  ];
  const focus = wp.resolveMapFocus('aldermoor', maps, parentOf, { currentMapId: null });
  assert.equal(focus.mapId, 'm-city');
  assert.equal(focus.depth, 0);
});

test('the most specific level wins over a map that is higher up', () => {
  const maps = [
    candidate('m-world', 'world', ['aldermoor', 'north']),
    candidate('m-city', 'aldermoor', ['castle']),
  ];
  // The castle is drawn on the city map; Aldermoor is drawn on the world map. The castle
  // is one step closer, so the city map wins even though the world map also "works".
  const focus = wp.resolveMapFocus('castle', maps, parentOf, { currentMapId: null });
  assert.equal(focus.mapId, 'm-city');
  assert.equal(focus.depth, 0);
});

test('a map that does not exist yet in this era is not offered', () => {
  // A map can be of a period — "the Empire in year 300". Following a character into a map
  // that does not exist at that moment would show them a world that has not happened.
  const maps = [
    candidate('m-empire', 'north', ['aldermoor'], { fromWorldDay: 300, toWorldDay: 900 }),
    candidate('m-old', 'north', ['aldermoor'], { toWorldDay: 299 }),
  ];
  assert.equal(wp.resolveMapFocus('aldermoor', maps, parentOf, { at: 500 }).mapId, 'm-empire');
  assert.equal(wp.resolveMapFocus('aldermoor', maps, parentOf, { at: 100 }).mapId, 'm-old');
  // With no playhead every map is fair game.
  assert.ok(wp.resolveMapFocus('aldermoor', maps, parentOf, { at: null }));
});

test('nowhere to show them is null, not an arbitrary map', () => {
  // They are somewhere the atlas does not cover. The cast strip has to say so rather than
  // the view jumping to whatever map happened to be first in the list.
  const maps = [candidate('m-city', 'aldermoor', ['castle'])];
  assert.equal(wp.resolveMapFocus('vael', maps, parentOf), null);
  assert.equal(wp.resolveMapFocus('aldermoor', [], parentOf), null);
});

test('a cycle in the place tree cannot hang the playhead', () => {
  // This runs on every tick. A loop in the containment chain would spin forever with no
  // error to follow — the same class of bug the place tree already guards on write.
  const looping = (id) => (id === 'a' ? 'b' : 'a');
  const maps = [candidate('m', null, ['z'])];
  assert.equal(wp.resolveMapFocus('a', maps, looping), null, 'terminates, and finds nothing');
});

test('auto-follow is only for exactly one character', () => {
  // With five characters on four maps, following one means losing the other four, and the
  // view becomes a slideshow nobody asked for.
  assert.equal(wp.shouldAutoFollow(1, true), true);
  assert.equal(wp.shouldAutoFollow(0, true), false);
  assert.equal(wp.shouldAutoFollow(2, true), false);
  assert.equal(wp.shouldAutoFollow(1, false), false, 'and the reader can always switch it off');
});

// ── impossible journeys (M7) ────────────────────────────────────────────────────

/** 400 units apart, and a fastest mode that covers 50 a day. */
const CHECK = {
  distanceBetween: (from, to) => (from === to ? 0 : 400),
  unit: 'km',
  fastest: (distance) => ({ days: distance / 50, modeName: 'A caballo' }),
};

test('a journey the story leaves no time for is reported', () => {
  // The flagship: "Kestra is in Aldermoor on day 120 and in Vael on day 122, but that is
  // 400 leagues — twenty days on horseback."
  const tracks = wp.buildTracks([at('k', 'aldermoor', 120), at('k', 'vael', 122)]);
  const found = wp.findImpossibleJourneys(tracks, CHECK);
  assert.equal(found.length, 1);
  assert.equal(found[0].allowed, 2);
  assert.equal(found[0].needed, 8);
  assert.equal(found[0].distance, 400);
  assert.equal(found[0].modeName, 'A caballo');
  assert.equal(found[0].journey.fromPlaceId, 'aldermoor');
});

test('a journey with enough time is NOT reported', () => {
  const fine = wp.buildTracks([at('k', 'a', 100), at('k', 'b', 130)]);
  assert.deepEqual(wp.findImpossibleJourneys(fine, CHECK), []);
  // Just barely enough, inside the tolerance: a report that cries wolf is unread.
  const tight = wp.buildTracks([at('k', 'a', 100), at('k', 'b', 107)]);
  assert.deepEqual(wp.findImpossibleJourneys(tight, CHECK), [], '8 days needed, 7 allowed is within tolerance');
  const tighter = wp.buildTracks([at('k', 'a', 100), at('k', 'b', 105)]);
  assert.equal(wp.findImpossibleJourneys(tighter, CHECK).length, 1, 'but 5 is not');
});

test('the same day in two places is the case a writer makes most often', () => {
  const sameDay = wp.buildTracks([at('k', 'a', 100), at('k', 'b', 100)]);
  const found = wp.findImpossibleJourneys(sameDay, CHECK);
  assert.equal(found.length, 1);
  assert.equal(found[0].allowed, 0);
});

test('nothing is claimed about what cannot be measured', () => {
  // No scale, a place on no map, or a world whose units cannot be reconciled. Saying
  // something anyway is how a consistency report loses its credibility — and a writer's
  // world is full of dragons, portals and ships nobody has told Nodus about.
  const tracks = wp.buildTracks([at('k', 'a', 100), at('k', 'b', 101)]);
  assert.deepEqual(wp.findImpossibleJourneys(tracks, { ...CHECK, distanceBetween: () => null }), []);
  assert.deepEqual(wp.findImpossibleJourneys(tracks, { ...CHECK, distanceBetween: () => 0 }), []);
  // NaN is the one that gets through a `== null` check and out the other side as a
  // warning about a journey of NaN leagues.
  assert.deepEqual(wp.findImpossibleJourneys(tracks, { ...CHECK, distanceBetween: () => Number.NaN }), []);
  assert.deepEqual(wp.findImpossibleJourneys(tracks, { ...CHECK, fastest: () => null }), []);
  // And an undated residence never produces a journey to check in the first place.
  const residence = wp.buildTracks([at('k', 'home', null, { source: 'residence' }), at('k', 'b', 100)]);
  assert.deepEqual(wp.findImpossibleJourneys(residence, CHECK), []);
});

test('the worst offender comes first', () => {
  // Doran sorts BEFORE Kestra by name, so the merely-tight journey comes first in track
  // order. Only an explicit sort by severity puts the impossible one at the top — which
  // is the whole point of a report a writer reads from the first line.
  const tracks = wp.buildTracks([
    at('d', 'a', 100), at('d', 'b', 106),   // 8 needed, 6 allowed → ratio 1.33
    at('k', 'a', 200), at('k', 'b', 200),   // 8 needed, 0 allowed → ratio 8
  ]);
  assert.deepEqual(tracks.map((track) => track.personName), ['Doran', 'Kestra'], 'track order is by name');
  const found = wp.findImpossibleJourneys(tracks, CHECK);
  assert.equal(found.length, 2);
  assert.equal(found[0].allowed, 0, 'the impossible one, not the merely tight one');
  assert.equal(found[1].allowed, 6);
});
