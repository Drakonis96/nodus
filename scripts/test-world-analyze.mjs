// The pure half of "Analizar": the chain of days, and the threads-and-beats machine.
//
// Pure, bundled and required, so the part that must be right — what happens to everything
// downstream when a scene moves or an anchor changes — is checked without a database.

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
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-scene-days-'));

function load(file) {
  const bundle = path.join(outDir, `${path.basename(file, '.ts')}.cjs`);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [path.join(repoRoot, file), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`],
    { cwd: repoRoot, stdio: 'inherit' }
  );
  return require(bundle);
}

const days = load('shared/worldSceneDays.ts');
test.after(() => rm(outDir, { recursive: true, force: true }));

const scenes = (n) => Array.from({ length: n }, (_, index) => ({ sceneId: `s${index + 1}`, narrativeOrder: index }));
const linkMap = (entries) => new Map(entries.map((entry) => [entry.sceneId, { offsetDays: 0, anchorWorldDay: null, ...entry }]));

test('a manuscript with no declarations at all still has a day line', () => {
  // Every scene inherits the DDL default (offset 0), so they all fall on the same day.
  // Refusing to date them would be defensible and useless: every contradiction this feeds
  // is about the DISTANCE between two scenes.
  const result = days.computeSceneDays(scenes(3), new Map());
  assert.deepEqual([...result.values()], [0, 0, 0]);
});

test('one anchor dates everything after it', () => {
  const result = days.computeSceneDays(
    scenes(4),
    linkMap([
      { sceneId: 's1', mode: 'anchor', anchorWorldDay: 412 },
      { sceneId: 's2', mode: 'offset', offsetDays: 3 },
      { sceneId: 's3', mode: 'same' },
      { sceneId: 's4', mode: 'offset', offsetDays: 1 },
    ])
  );
  assert.deepEqual([...result.values()], [412, 415, 415, 416]);
});

test('a second anchor re-pins the chain rather than adding to it', () => {
  // The head of act two: an anchor is absolute, so what came before it cannot drag it.
  const result = days.computeSceneDays(
    scenes(3),
    linkMap([
      { sceneId: 's1', mode: 'anchor', anchorWorldDay: 10 },
      { sceneId: 's2', mode: 'offset', offsetDays: 5 },
      { sceneId: 's3', mode: 'anchor', anchorWorldDay: 100 },
    ])
  );
  assert.deepEqual([...result.values()], [10, 15, 100]);
});

test('a negative offset is allowed, because a flashback is a real structure', () => {
  const result = days.computeSceneDays(
    scenes(2),
    linkMap([
      { sceneId: 's1', mode: 'anchor', anchorWorldDay: 100 },
      { sceneId: 's2', mode: 'offset', offsetDays: -30 },
    ])
  );
  assert.deepEqual([...result.values()], [100, 70]);
});

test('the chain is read in NARRATIVE order, whatever order the rows arrive in', () => {
  const shuffled = [
    { sceneId: 's3', narrativeOrder: 2 },
    { sceneId: 's1', narrativeOrder: 0 },
    { sceneId: 's2', narrativeOrder: 1 },
  ];
  const result = days.computeSceneDays(
    shuffled,
    linkMap([
      { sceneId: 's1', mode: 'anchor', anchorWorldDay: 0 },
      { sceneId: 's2', mode: 'offset', offsetDays: 1 },
      { sceneId: 's3', mode: 'offset', offsetDays: 1 },
    ])
  );
  assert.equal(result.get('s1'), 0);
  assert.equal(result.get('s2'), 1);
  assert.equal(result.get('s3'), 2);
});

test('an anchor with no day set does not silently reset the chain to zero', () => {
  // Half-filled is the normal state of this form: the author picks "día fijo" and then
  // goes to look the number up. Treating the empty box as day 0 would move every scene
  // after it while they were still thinking.
  const result = days.computeSceneDays(
    scenes(2),
    linkMap([
      { sceneId: 's1', mode: 'offset', offsetDays: 7 },
      { sceneId: 's2', mode: 'anchor', anchorWorldDay: null },
    ])
  );
  assert.deepEqual([...result.values()], [7, 7]);
});

test('reordering renumbers EVERY scene, not just the one that moved', () => {
  // A partial renumber leaves two scenes claiming one slot, and the day of everything
  // after them then depends on which row SQLite happens to return first.
  const next = days.reorderScenes(scenes(4), 's1', 3);
  assert.deepEqual(next, [
    { sceneId: 's2', narrativeOrder: 0 },
    { sceneId: 's3', narrativeOrder: 1 },
    { sceneId: 's4', narrativeOrder: 2 },
    { sceneId: 's1', narrativeOrder: 3 },
  ]);
  assert.equal(new Set(next.map((entry) => entry.narrativeOrder)).size, 4, 'no two scenes share a slot');

  // Out-of-range targets clamp instead of dropping the scene.
  assert.equal(days.reorderScenes(scenes(3), 's2', 99).at(-1).sceneId, 's2');
  assert.equal(days.reorderScenes(scenes(3), 's2', -5)[0].sceneId, 's2');
  assert.equal(days.reorderScenes(scenes(3), 'missing', 0).length, 3, 'an unknown id still renumbers');
});

test('moving a scene changes the days of the scenes it jumped over', () => {
  const links = linkMap([
    { sceneId: 's1', mode: 'anchor', anchorWorldDay: 0 },
    { sceneId: 's2', mode: 'offset', offsetDays: 10 },
    { sceneId: 's3', mode: 'offset', offsetDays: 1 },
  ]);
  const before = days.computeSceneDays(scenes(3), links);
  assert.equal(before.get('s3'), 11);

  const moved = days.reorderScenes(scenes(3), 's3', 0);
  const after = days.computeSceneDays(moved, links);
  // s3 now leads, so its "+1" applies to nothing and s1's anchor re-pins the line.
  assert.equal(after.get('s3'), 1);
  assert.equal(after.get('s1'), 0);
  assert.equal(after.get('s2'), 10);
});

test('coverage is counted in scenes, and knows whether anything is pinned', () => {
  const all = scenes(5);
  assert.deepEqual(days.sceneDayCoverage(all, new Map()), { declared: 0, total: 5, anchored: false });
  const partial = linkMap([
    { sceneId: 's1', mode: 'anchor', anchorWorldDay: 3 },
    { sceneId: 's2', mode: 'offset', offsetDays: 1 },
  ]);
  assert.deepEqual(days.sceneDayCoverage(all, partial), { declared: 2, total: 5, anchored: true });
  // An anchor with no number is not a pin.
  assert.equal(
    days.sceneDayCoverage(all, linkMap([{ sceneId: 's1', mode: 'anchor', anchorWorldDay: null }])).anchored,
    false
  );
});

test('every mode reads as a sentence a writer would say, and stays translatable', () => {
  const describe = (mode, offsetDays = 0, anchorWorldDay = null) =>
    days.describeSceneDay({ sceneId: 's', mode, offsetDays, anchorWorldDay });
  assert.deepEqual(describe('anchor', 0, 412), { key: 'Día fijo: {day}', vars: { day: '412' } });
  assert.deepEqual(describe('same'), { key: 'El mismo día que la anterior' });
  assert.deepEqual(describe('offset', 0), { key: 'El mismo día que la anterior' });
  assert.deepEqual(describe('offset', 1), { key: 'Al día siguiente' });
  assert.deepEqual(describe('offset', 3), { key: '{count} días después', vars: { count: '3' } });
  assert.deepEqual(describe('offset', -2), { key: '{count} días antes', vars: { count: '2' } });
  // A key with no interpolation left in it is what keeps the other six languages honest:
  // a finished sentence here would be invisible to the i18n collector.
  for (const mode of ['anchor', 'same', 'offset']) {
    assert.doesNotMatch(describe(mode, 5, 5).key, /\d/, 'no number is baked into the key');
  }
});

// ── Threads and beats ────────────────────────────────────────────────────────

const threads = load('shared/worldThreads.ts');

function thread(id, kind, extra = {}) {
  return {
    threadId: id,
    kind,
    title: id,
    titleKey: id,
    pitch: null,
    stakes: null,
    scope: 'external',
    status: 'open',
    outcome: null,
    origin: 'author',
    parties: [],
    createdAt: '',
    updatedAt: '',
    ...extra,
  };
}

function beat(threadId, kind, sceneId, mark, order = 0) {
  return {
    threadKind: kind,
    threadId,
    threadTitle: threadId,
    sceneId,
    sceneTitle: sceneId,
    narrativeOrder: order,
    mark,
    text: null,
    subjectKind: null,
    subjectId: null,
    subjectName: null,
    paid: null,
  };
}

const party = (id, side = 'wants') => ({ threadId: 't', partyKind: 'character', partyId: id, partyName: id, side });

test('each kind of thread offers only its own vocabulary', () => {
  assert.deepEqual(threads.marksFor('rule'), ['obeys', 'bends', 'breaks', 'establishes']);
  assert.deepEqual(threads.marksFor('conflict'), ['raise', 'turn', 'ease', 'resolve']);
  assert.deepEqual(threads.marksFor('arc'), ['step', 'turn']);
  for (const kind of ['rule', 'conflict', 'arc']) {
    for (const mark of threads.marksFor(kind)) {
      assert.ok(threads.BEAT_MARK_LABEL[mark], `${mark} has a label`);
    }
  }
  // Only a turn is asked to explain itself; a box on every row is a box nobody fills.
  assert.equal(threads.markNeedsText('turn'), true);
  assert.equal(threads.markNeedsText('raise'), false);
});

test('the character with page time and no stake comes first', () => {
  const input = {
    threads: [thread('t1', 'conflict', { parties: [party('c1')] })],
    beats: [],
    scenes: [],
    // The names deliberately sort the OTHER way round from the scene counts: written the
    // obvious way ("Mucho", "Poco") this test passed with the sort deleted.
    characters: [
      { id: 'c1', name: 'Con', narrativeRole: null, sceneCount: 30 },
      { id: 'c2', name: 'Zoe', narrativeRole: null, sceneCount: 21 },
      { id: 'c3', name: 'Ana', narrativeRole: null, sceneCount: 2 },
      { id: 'c4', name: 'Nadie', narrativeRole: null, sceneCount: 0 },
    ],
  };
  assert.deepEqual(
    threads.charactersWithoutStake(input).map((entry) => entry.name),
    ['Zoe', 'Ana'],
    'sorted by page time; somebody who never appears is not a problem'
  );
});

test('an archived thread does not count as a stake', () => {
  const input = {
    threads: [thread('t1', 'conflict', { status: 'archived', parties: [party('c1')] })],
    beats: [],
    scenes: [],
    characters: [{ id: 'c1', name: 'Solo', narrativeRole: null, sceneCount: 5 }],
  };
  assert.deepEqual(threads.charactersWithoutStake(input).map((entry) => entry.id), ['c1']);
});

test('scenes that move nothing are the cut list, in reading order', () => {
  const input = {
    threads: [],
    beats: [beat('t1', 'conflict', 's2', 'raise', 1)],
    scenes: [
      { sceneId: 's3', title: 'Tres', narrativeOrder: 2 },
      { sceneId: 's1', title: 'Uno', narrativeOrder: 0 },
      { sceneId: 's2', title: 'Dos', narrativeOrder: 1 },
    ],
    characters: [],
  };
  assert.deepEqual(
    threads.scenesThatMoveNothing(input).map((scene) => scene.sceneId),
    ['s1', 's3']
  );
});

test('a thread declared and then forgotten is reported; a closed one is not', () => {
  const input = {
    threads: [
      thread('t1', 'conflict'),
      thread('t2', 'conflict', { status: 'resolved' }),
      thread('t3', 'arc'),
    ],
    beats: [beat('t3', 'arc', 's1', 'step')],
    scenes: [],
    characters: [],
  };
  assert.deepEqual(threads.threadsWithoutBeats(input).map((entry) => entry.threadId), ['t1']);
});

test('a conflict resolved without ever rising is either unearned or unrecorded', () => {
  const input = {
    threads: [
      thread('t1', 'conflict', { status: 'resolved' }),
      thread('t2', 'conflict', { status: 'resolved' }),
      thread('t3', 'arc', { status: 'resolved' }),
    ],
    beats: [
      beat('t1', 'conflict', 's1', 'ease'),
      beat('t2', 'conflict', 's1', 'raise'),
      beat('t2', 'conflict', 's2', 'resolve'),
    ],
    scenes: [],
    characters: [],
  };
  assert.deepEqual(
    threads.threadsResolvedWithoutRising(input).map((entry) => entry.threadId),
    ['t1'],
    'an arc is not judged by this, and a conflict that rose is fine'
  );
});

test('a span is measured in scene positions, never in percentages', () => {
  const span = threads.threadSpan(thread('t1', 'conflict'), [
    beat('t1', 'conflict', 's3', 'raise', 2),
    beat('t1', 'conflict', 's1', 'raise', 0),
    beat('t9', 'conflict', 's5', 'raise', 4),
  ], 48);
  assert.deepEqual(span, { first: 0, last: 2, count: 2, total: 48 });
  assert.deepEqual(threads.threadSpan(thread('t9', 'arc'), [], 10), { first: null, last: null, count: 0, total: 10 });
});

test('beats are grouped by scene so opening one is a single lookup', () => {
  const grouped = threads.beatsByScene([
    beat('t2', 'conflict', 's1', 'raise'),
    beat('t1', 'arc', 's1', 'step'),
    beat('t3', 'conflict', 's2', 'turn'),
  ]);
  assert.deepEqual([...grouped.keys()].sort(), ['s1', 's2']);
  assert.deepEqual(grouped.get('s1').map((entry) => entry.threadId), ['t1', 't2'], 'stable order inside a scene');
});

test('direction tells a rising conflict from a stalled one', () => {
  assert.equal(threads.markDirection('raise'), 1);
  assert.equal(threads.markDirection('breaks'), 1);
  assert.equal(threads.markDirection('ease'), -1);
  assert.equal(threads.markDirection('turn'), 0);
});

// ── Continuity ───────────────────────────────────────────────────────────────

const findings = load('shared/worldFindings.ts');
const continuity = load('shared/worldContinuity.ts');

function presence(personId, personName, placeId, placeName, worldDay, extra = {}) {
  return {
    personId,
    personName,
    placeId,
    placeName,
    worldDay,
    worldYear: null,
    worldOrder: 0,
    source: 'scene',
    sourceId: `src-${placeId}-${worldDay}`,
    label: `escena en ${placeName}`,
    ...extra,
  };
}

function snapshot(over = {}) {
  return {
    characters: [],
    presences: [],
    affiliations: [],
    secrets: [],
    knowers: [],
    places: [],
    scenes: [],
    ...over,
  };
}

function character(personId, displayName, over = {}) {
  return {
    personId,
    displayName,
    birthYear: null,
    deathYear: null,
    lifeStatus: 'alive',
    deathDate: null,
    events: [],
    ...over,
  };
}

test('a fingerprint carries the subjects and NOT the numbers', () => {
  const subjects = [
    { kind: 'character', id: 'c1', title: 'Kaelen' },
    { kind: 'place', id: 'p1', title: 'Vael' },
  ];
  const a = findings.fingerprintOf('presence.bilocation', subjects);
  // Reversed order, same fingerprint: the subjects are sorted.
  const b = findings.fingerprintOf('presence.bilocation', [...subjects].reverse());
  assert.equal(a, b);
  assert.doesNotMatch(a, /\d{3,}/, 'no day number is baked into it');
  // A different check over the same subjects is a different problem.
  assert.notEqual(a, findings.fingerprintOf('travel.impossible', subjects));
});

test('a silence survives the number changing, which is the whole point', () => {
  const before = continuity.findBilocations(
    snapshot({
      presences: [presence('c1', 'Kaelen', 'p1', 'Vael', 412), presence('c1', 'Kaelen', 'p2', 'Puerto', 412)],
    })
  );
  const after = continuity.findBilocations(
    snapshot({
      presences: [presence('c1', 'Kaelen', 'p1', 'Vael', 411), presence('c1', 'Kaelen', 'p2', 'Puerto', 411)],
    })
  );
  assert.equal(before.length, 1);
  assert.equal(before[0].fingerprint, after[0].fingerprint, 'moving the date must not resurrect a judged exception');

  const mute = {
    fingerprint: before[0].fingerprint,
    checkId: before[0].checkId,
    scope: 'finding',
    subjects: [],
    headline: null,
    reasonCode: 'double',
    reason: null,
    createdAt: '',
  };
  assert.deepEqual(findings.applyMutes(after, [mute]), []);
});

test('muting a whole check silences it for the world, not for one row', () => {
  const list = [
    { checkId: 'travel.impossible', family: 'travel', severity: 'contradiction', headline: { key: 'a' }, detail: null, subjects: [], fingerprint: 'f1' },
    { checkId: 'travel.impossible', family: 'travel', severity: 'contradiction', headline: { key: 'b' }, detail: null, subjects: [], fingerprint: 'f2' },
    { checkId: 'presence.bilocation', family: 'presence', severity: 'contradiction', headline: { key: 'c' }, detail: null, subjects: [], fingerprint: 'f3' },
  ];
  const off = { fingerprint: 'check|travel.impossible', checkId: 'travel.impossible', scope: 'check', subjects: [], headline: null, reasonCode: 'deliberate', reason: null, createdAt: '' };
  assert.deepEqual(findings.applyMutes(list, [off]).map((f) => f.fingerprint), ['f3']);
});

test('two places on one day is a contradiction; a home town is not', () => {
  const both = continuity.findBilocations(
    snapshot({
      presences: [presence('c1', 'Kaelen', 'p1', 'Vael', 412), presence('c1', 'Kaelen', 'p2', 'Puerto', 412)],
    })
  );
  assert.equal(both.length, 1);
  assert.equal(both[0].severity, 'contradiction');

  // Same place twice on one day is one stay, not a contradiction.
  assert.deepEqual(
    continuity.findBilocations(
      snapshot({ presences: [presence('c1', 'K', 'p1', 'Vael', 412), presence('c1', 'K', 'p1', 'Vael', 412)] })
    ),
    []
  );
  // An undated residence claims no particular day, so it cannot contradict one. Counting
  // it would make every character with a home town guilty.
  assert.deepEqual(
    continuity.findBilocations(
      snapshot({
        presences: [
          presence('c1', 'K', 'p1', 'Vael', 412),
          presence('c1', 'K', 'p2', 'Puerto', null, { source: 'residence' }),
        ],
      })
    ),
    []
  );
});

test('acting after death is judged in YEARS, because that is what the sheet stores', () => {
  const dated = presence('c1', 'Kaelen', 'p1', 'Vael', null, { worldYear: 1210, label: 'La caída' });
  const found = continuity.findLifespanBreaches(
    snapshot({ characters: [character('c1', 'Kaelen', { deathYear: 1204 })], presences: [dated] })
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].checkId, 'lifespan.afterDeath');

  // A presence the author never placed in a year says nothing about a lifespan, and
  // guessing a year from the day chain would be inventing a date.
  const dayOnly = presence('c1', 'Kaelen', 'p1', 'Vael', 5000);
  assert.deepEqual(
    continuity.findLifespanBreaches(
      snapshot({ characters: [character('c1', 'Kaelen', { deathYear: 1204 })], presences: [dayOnly] })
    ),
    []
  );
});

test('a prologue centuries earlier is NOT an error', () => {
  // Narrative order and chronological order are independent by design. Reporting their
  // disagreement would flag the single most common structure in fiction.
  const found = continuity.runWorldContinuity(
    snapshot({
      scenes: [
        { sceneId: 's1', title: 'Prólogo', worldDay: 10, narrativeOrder: 0 },
        { sceneId: 's2', title: 'Uno', worldDay: 5, narrativeOrder: 1 },
      ],
    })
  );
  assert.deepEqual(found.filter((f) => f.severity === 'contradiction'), []);
});

test('travel asks for the pairs it needs, not for every pair of places', () => {
  const presences = [];
  // 40 places, one journey between two of them: a matrix would be 780 pairs.
  for (let i = 0; i < 40; i += 1) presences.push(presence('cX', 'X', `p${i}`, `P${i}`, 1000 + i));
  const pairs = continuity.travelPairsNeeded(snapshot({ presences }));
  assert.equal(pairs.length, 39, 'one pair per consecutive move, never the cartesian product');

  // A road walked both ways is ONE distance to measure. Without deduplicating the pair
  // direction-agnostically this asks for the same measurement twice.
  const roundTrip = continuity.travelPairsNeeded(
    snapshot({
      presences: [
        presence('c1', 'K', 'p1', 'Vael', 1),
        presence('c1', 'K', 'p2', 'Puerto', 2),
        presence('c1', 'K', 'p1', 'Vael', 3),
      ],
    })
  );
  assert.equal(roundTrip.length, 1);

  const journey = snapshot({
    presences: [presence('c1', 'Kaelen', 'p1', 'Vael', 10), presence('c1', 'Kaelen', 'p2', 'Puerto', 11)],
  });
  // With no measured distance the family stays silent rather than inventing a speed.
  assert.deepEqual(continuity.findTravelBreaches(journey, []), []);
  assert.deepEqual(continuity.findTravelBreaches(journey, [{ fromPlaceId: 'p1', toPlaceId: 'p2', days: 1 }]), []);
  const impossible = continuity.findTravelBreaches(journey, [{ fromPlaceId: 'p1', toPlaceId: 'p2', days: 9 }]);
  assert.equal(impossible.length, 1);
  assert.equal(impossible[0].checkId, 'travel.impossible');
  // The pair is direction-agnostic: the same road measured the other way still counts.
  assert.equal(
    continuity.findTravelBreaches(journey, [{ fromPlaceId: 'p2', toPlaceId: 'p1', days: 9 }]).length,
    1
  );
});

test('a place inside itself is reported once, however long the loop', () => {
  const found = continuity.findContainmentBreaches([
    { placeId: 'a', name: 'A', parentId: 'b' },
    { placeId: 'b', name: 'B', parentId: 'c' },
    { placeId: 'c', name: 'C', parentId: 'a' },
    { placeId: 'd', name: 'D', parentId: null },
  ]);
  assert.equal(found.length, 1, 'a three-place cycle is one problem, not three');
  assert.equal(found[0].subjects.length, 3);
});

test('a knower nobody could have told is a WARNING, not a contradiction', () => {
  const world = snapshot({
    secrets: [{ secretId: 'sec1', title: 'El pacto', ownerPersonId: 'c1', revealedWorldDay: null }],
    knowers: [
      { secretId: 'sec1', personId: 'c1', personName: 'Kaelen', sinceWorldDay: 10 },
      { secretId: 'sec1', personId: 'c2', personName: 'Bruma', sinceWorldDay: 20 },
    ],
    presences: [],
  });
  const found = continuity.findSecretBreaches(world);
  assert.equal(found.length, 1);
  assert.equal(found[0].checkId, 'secret.neverMet');
  assert.equal(found[0].severity, 'warning', 'a letter is a way of learning something too');

  // Learning it before its owner is a real contradiction.
  const early = continuity.findSecretBreaches({
    ...world,
    knowers: [
      { secretId: 'sec1', personId: 'c1', personName: 'Kaelen', sinceWorldDay: 20 },
      { secretId: 'sec1', personId: 'c2', personName: 'Bruma', sinceWorldDay: 10 },
    ],
  });
  assert.equal(early[0].checkId, 'secret.knownTooEarly');
  assert.equal(early[0].severity, 'contradiction');

  // If they were in the same place at the same time, nothing is reported.
  const met = continuity.findSecretBreaches({
    ...world,
    presences: [presence('c1', 'Kaelen', 'p1', 'Vael', 15), presence('c2', 'Bruma', 'p1', 'Vael', 15)],
  });
  assert.deepEqual(met, []);
});

test('undated scenes are a GAP: nothing is wrong, there is just not enough written', () => {
  const found = continuity.coverageGaps(
    snapshot({
      scenes: [
        { sceneId: 's1', title: 'Uno', worldDay: null, narrativeOrder: 0 },
        { sceneId: 's2', title: 'Dos', worldDay: 3, narrativeOrder: 1 },
      ],
    })
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, 'gap');
  assert.deepEqual(found[0].headline.vars, { count: '1' });
});

test('the badge filters the array the screen already loaded', () => {
  const all = continuity.findBilocations(
    snapshot({
      presences: [presence('c1', 'Kaelen', 'p1', 'Vael', 412), presence('c1', 'Kaelen', 'p2', 'Puerto', 412)],
    })
  );
  assert.equal(findings.findingsFor({ kind: 'character', id: 'c1' }, all).length, 1);
  assert.equal(findings.findingsFor({ kind: 'place', id: 'p2' }, all).length, 1);
  assert.equal(findings.findingsFor({ kind: 'character', id: 'otro' }, all).length, 0);
  // A place id that matches a character id must not match: subjects are kind-qualified.
  assert.equal(findings.findingsFor({ kind: 'place', id: 'c1' }, all).length, 0);
});

test('contradictions come first, and the order is predictable', () => {
  const make = (severity, checkId) => ({ checkId, family: 'x', severity, headline: { key: checkId }, detail: null, subjects: [], fingerprint: checkId });
  const sorted = findings.sortFindings([
    make('gap', 'z.gap'),
    make('warning', 'a.warn'),
    make('contradiction', 'm.contra'),
  ]);
  assert.deepEqual(sorted.map((f) => f.severity), ['contradiction', 'warning', 'gap']);
  assert.deepEqual(findings.countBySeverity(sorted), { contradiction: 1, warning: 1, gap: 1 });
});

test('every check in the catalogue can actually fire', () => {
  // A catalogue that lists a check nobody implemented is the section promising to check
  // the world and opening empty.
  // Quote style is NOT assumed: esbuild rewrites single quotes to double on the way
  // through the bundler, and the first version of this test silently matched nothing.
  const source = Object.values(continuity)
    .filter((value) => typeof value === 'function')
    .map((fn) => fn.toString())
    .join('\n');
  for (const check of continuity.CONTINUITY_CHECKS) {
    // `character.*` ids are built from checkCharacterCoherence's own ids at runtime.
    if (check.id.startsWith('character.')) continue;
    assert.ok(source.includes(check.id), `${check.id} is produced by some check`);
  }
  assert.ok(source.includes('presence.bilocation'), 'and the scan itself finds something');
});

// ── Conflicts: the board and its diagnostics ─────────────────────────────────

function castMember(id, name, over = {}) {
  return { personId: id, displayName: name, narrativeRole: null, arcWant: null, arcNeed: null, sceneCount: 1, ...over };
}

function withParties(id, kind, parties, over = {}) {
  return thread(id, kind, {
    ...over,
    parties: parties.map((p) => ({ threadId: id, partyKind: p.kind ?? 'character', partyId: p.id, partyName: p.name ?? p.id, side: p.side })),
  });
}

test('the board puts whoever has page time and nothing at stake at the top', () => {
  const board = threads.threadBoard({
    cast: [
      castMember('c1', 'Con conflicto', { sceneCount: 3 }),
      castMember('c2', 'Zoe', { sceneCount: 21 }),
      castMember('c3', 'Ana', { sceneCount: 2 }),
    ],
    threads: [withParties('t1', 'conflict', [{ id: 'c1', side: 'wants' }])],
  });
  assert.deepEqual(board.rows.map((row) => row.person.displayName), ['Zoe', 'Ana', 'Con conflicto']);
  assert.deepEqual(board.rows.map((row) => row.stakes), [0, 0, 1]);
  // Cells line up with the columns, positionally.
  assert.equal(board.columns.length, 1);
  assert.deepEqual(board.rows.at(-1).cells, ['wants']);
  assert.deepEqual(board.rows[0].cells, [null]);
});

test('an archived conflict is neither a column nor a stake', () => {
  const board = threads.threadBoard({
    cast: [castMember('c1', 'Solo')],
    threads: [withParties('t1', 'conflict', [{ id: 'c1', side: 'wants' }], { status: 'archived' })],
  });
  assert.equal(board.columns.length, 0);
  assert.equal(board.rows[0].stakes, 0);
});

test('an arc is not a column: the board is about conflicts', () => {
  const board = threads.threadBoard({
    cast: [castMember('c1', 'Alguien')],
    threads: [
      withParties('a1', 'arc', [{ id: 'c1', side: 'subject' }]),
      withParties('t1', 'conflict', [{ id: 'c1', side: 'wants' }]),
    ],
  });
  assert.deepEqual(board.columns.map((column) => column.threadId), ['t1']);
});

test('silent and thin are two different notes', () => {
  const gaps = threads.findStakeGaps({
    cast: [
      castMember('c1', 'Nada', { sceneCount: 9 }),
      castMember('c2', 'Solo quiere', { sceneCount: 4, arcWant: 'Volver a casa' }),
      castMember('c3', 'Solo pelea', { sceneCount: 4 }),
      castMember('c4', 'Completo', { sceneCount: 30, arcWant: 'Algo' }),
      castMember('c5', 'No sale', { sceneCount: 0 }),
    ],
    threads: [
      withParties('t1', 'conflict', [{ id: 'c3', side: 'wants' }, { id: 'c4', side: 'opposes' }]),
    ],
  });
  assert.deepEqual(
    gaps.map((gap) => [gap.displayName, gap.kind]),
    [['Nada', 'silent'], ['Solo pelea', 'thin'], ['Solo quiere', 'thin']],
    'silent first, then by page time, then alphabetically; somebody who never appears is not a problem'
  );
});

test('crossed loyalties need OPPOSING sides, not merely a shared thread', () => {
  const war = withParties('t1', 'conflict', [
    { id: 'c1', name: 'Kaelen', side: 'wants' },
    { id: 'g1', name: 'Los Cuervos', kind: 'group', side: 'opposes' },
  ]);
  const affiliations = [{ personId: 'c1', personName: 'Kaelen', groupId: 'g1', groupName: 'Los Cuervos' }];
  const crossed = threads.findCrossedLoyalties([war], affiliations);
  assert.equal(crossed.length, 1);
  assert.equal(crossed[0].personName, 'Kaelen');

  // Same side is loyalty, not a crossing.
  const loyal = withParties('t2', 'conflict', [
    { id: 'c1', name: 'Kaelen', side: 'wants' },
    { id: 'g1', name: 'Los Cuervos', kind: 'group', side: 'wants' },
  ]);
  assert.deepEqual(threads.findCrossedLoyalties([loyal], affiliations), []);
  // And somebody merely caught in the middle is not a traitor.
  const caught = withParties('t3', 'conflict', [
    { id: 'c1', name: 'Kaelen', side: 'caught' },
    { id: 'g1', name: 'Los Cuervos', kind: 'group', side: 'opposes' },
  ]);
  assert.deepEqual(threads.findCrossedLoyalties([caught], affiliations), []);
  // Not a member of the group: nothing to cross.
  assert.deepEqual(threads.findCrossedLoyalties([war], []), []);
});

test('a scene is only suggested when BOTH sides were in the room', () => {
  const war = withParties('t1', 'conflict', [
    { id: 'c1', name: 'Kaelen', side: 'wants' },
    { id: 'c2', name: 'Bruma', side: 'opposes' },
  ]);
  const scenes = [
    { sceneId: 's1', title: 'Los dos', narrativeOrder: 0 },
    { sceneId: 's2', title: 'Solo uno', narrativeOrder: 1 },
    { sceneId: 's3', title: 'Ya etiquetada', narrativeOrder: 2 },
  ];
  const sceneCast = [
    { sceneId: 's1', personId: 'c1', personName: 'Kaelen' },
    { sceneId: 's1', personId: 'c2', personName: 'Bruma' },
    { sceneId: 's2', personId: 'c1', personName: 'Kaelen' },
    { sceneId: 's3', personId: 'c1', personName: 'Kaelen' },
    { sceneId: 's3', personId: 'c2', personName: 'Bruma' },
  ];
  const suggested = threads.suggestThreadScenes({
    thread: war,
    beats: [beat('t1', 'conflict', 's3', 'raise', 2)],
    scenes,
    sceneCast,
    membership: [],
  });
  assert.deepEqual(suggested.map((entry) => entry.sceneId), ['s1'], 'not the one-sided scene, not the tagged one');
  assert.deepEqual(suggested[0].present.sort(), ['Bruma', 'Kaelen']);
});

test('a faction party resolves to its members, or a war matches no scene at all', () => {
  const war = withParties('t1', 'conflict', [
    { id: 'g1', name: 'Los Cuervos', kind: 'group', side: 'wants' },
    { id: 'c2', name: 'Bruma', side: 'opposes' },
  ]);
  const suggested = threads.suggestThreadScenes({
    thread: war,
    beats: [],
    scenes: [{ sceneId: 's1', title: 'El vado', narrativeOrder: 0 }],
    sceneCast: [
      { sceneId: 's1', personId: 'c1', personName: 'Kaelen' },
      { sceneId: 's1', personId: 'c2', personName: 'Bruma' },
    ],
    membership: [{ groupId: 'g1', personId: 'c1' }],
  });
  assert.deepEqual(suggested.map((entry) => entry.sceneId), ['s1']);
  // Without the membership the captain is nobody, and the scene is not suggested.
  assert.deepEqual(
    threads.suggestThreadScenes({
      thread: war,
      beats: [],
      scenes: [{ sceneId: 's1', title: 'El vado', narrativeOrder: 0 }],
      sceneCast: [
        { sceneId: 's1', personId: 'c1', personName: 'Kaelen' },
        { sceneId: 's1', personId: 'c2', personName: 'Bruma' },
      ],
      membership: [],
    }),
    []
  );
});

test('checkThreads names the structural problems, and Continuity only displays them', () => {
  const input = {
    threads: [
      withParties('t1', 'conflict', [{ id: 'c1', side: 'wants' }]),
      withParties('t2', 'conflict', [{ id: 'c1', side: 'wants' }], { status: 'resolved' }),
      withParties('t3', 'conflict', [{ id: 'ghost', name: '—', side: 'opposes' }]),
    ],
    // t3 gets a beat so it produces ONLY the orphan-party finding: without one it is also
    // "declared and forgotten", and the assertion below would be about two things at once.
    beats: [beat('t2', 'conflict', 's1', 'ease', 0), beat('t3', 'conflict', 's1', 'raise', 0)],
    scenes: [],
    characters: [
      { id: 'c1', name: 'Kaelen', narrativeRole: 'protagonist', sceneCount: 5 },
      { id: 'c9', name: 'El Verdugo', narrativeRole: 'antagonist', sceneCount: 7 },
    ],
  };
  const found = threads.checkThreads(input);
  const ids = found.map((finding) => finding.checkId).sort();
  assert.deepEqual(ids, [
    'thread.antagonistUnopposed',
    'thread.noScenes',
    'thread.orphanParty',
    'thread.resolvedFlat',
  ]);
  // Every one of them is a KEY plus vars, never a finished sentence.
  for (const finding of found) {
    assert.equal(typeof finding.headline.key, 'string');
    assert.equal(finding.family, 'thread');
    assert.ok(finding.fingerprint.startsWith(finding.checkId));
  }

  // An antagonist somebody opposes is not reported.
  const opposed = threads.checkThreads({
    ...input,
    threads: [withParties('t9', 'conflict', [{ id: 'c9', side: 'opposes' }, { id: 'c1', side: 'wants' }])],
    beats: [beat('t9', 'conflict', 's1', 'raise', 0)],
  });
  assert.deepEqual(opposed.filter((f) => f.checkId === 'thread.antagonistUnopposed'), []);
});

// ── Arcs: the lanes ──────────────────────────────────────────────────────────

const sceneRank = (id, order, status = 'written') => ({ sceneId: id, title: id.toUpperCase(), narrativeOrder: order, status });

test('the axis is the RANK, never the raw narrative_order', () => {
  // Reordering leaves gaps and duplicates in that column all the time. A lane drawn
  // against the raw integer puts two scenes on top of each other and leaves a hole where
  // one was cut.
  const rank = threads.rankScenes([sceneRank('s1', 0), sceneRank('s2', 7), sceneRank('s3', 90)]);
  assert.deepEqual([...rank.values()], [0, 1, 2]);

  const plotted = threads.plotThreads(
    [thread('a1', 'arc')],
    [beat('a1', 'arc', 's3', 'turn'), beat('a1', 'arc', 's1', 'step')],
    [sceneRank('s1', 0), sceneRank('s2', 7), sceneRank('s3', 90)]
  );
  assert.deepEqual(plotted[0].beats.map((b) => b.position), [0, 2], 'in order, and densely ranked');
  assert.equal(plotted[0].first, 0);
  assert.equal(plotted[0].last, 2);
});

test('a beat whose scene was cut has no position, and is not drawn at zero', () => {
  const plotted = threads.plotThreads(
    [thread('a1', 'arc')],
    [beat('a1', 'arc', 'gone', 'step'), beat('a1', 'arc', 's2', 'step')],
    [sceneRank('s1', 0), sceneRank('s2', 1)]
  );
  assert.deepEqual(plotted[0].beats.map((b) => b.sceneId), ['s2'], 'a phantom milestone at the head would be a lie');
  assert.equal(plotted[0].first, 1);
});

test('lanes are ordered by where each arc starts', () => {
  const scenes = [sceneRank('s1', 0), sceneRank('s2', 1), sceneRank('s3', 2)];
  const plotted = threads.plotThreads(
    [thread('late', 'arc'), thread('early', 'arc'), thread('never', 'arc')],
    [beat('late', 'arc', 's3', 'step'), beat('early', 'arc', 's1', 'step')],
    scenes
  );
  assert.deepEqual(plotted.map((entry) => entry.thread.threadId), ['early', 'late', 'never']);
  assert.equal(plotted.at(-1).first, null, 'an arc with no beats sorts last, not first');
});

test('the density strip counts over the SCENE axis, so a quiet stretch stays visible', () => {
  const scenes = Array.from({ length: 10 }, (_, i) => sceneRank(`s${i}`, i));
  const plotted = threads.plotThreads(
    [thread('a1', 'arc')],
    [beat('a1', 'arc', 's0', 'step'), beat('a1', 'arc', 's1', 'step'), beat('a1', 'arc', 's9', 'turn')],
    scenes
  );
  const bars = threads.beatDensity(plotted, 10, 5);
  assert.equal(bars.length, 5);
  assert.equal(bars[0], 2, 'the two early beats land in the first bucket');
  assert.equal(bars.at(-1), 1);
  assert.deepEqual(bars.slice(1, 4), [0, 0, 0], 'and the quiet middle is visibly empty');
  // No scenes at all must not divide by zero.
  assert.deepEqual(threads.beatDensity([], 0, 3), [0, 0, 0]);
});

test('inert scenes are reported as RUNS, because one quiet scene is breathing', () => {
  const scenes = Array.from({ length: 8 }, (_, i) => sceneRank(`s${i}`, i));
  const runs = threads.findInertScenes(scenes, [
    beat('a1', 'arc', 's0', 'step'),
    beat('a1', 'arc', 's2', 'step'),
    beat('a1', 'arc', 's7', 'step'),
  ]);
  // s1 alone, then s3..s6 together. The long run comes first — that is where the book sags.
  assert.deepEqual(runs.map((run) => run.scenes.length), [4, 1]);
  assert.deepEqual(runs[0].scenes.map((scene) => scene.sceneId), ['s3', 's4', 's5', 's6']);
  assert.equal(runs[0].from, 3);
  assert.equal(runs[0].to, 6);
});

test('scenes still in outline are not counted as inert', () => {
  // Nothing has been written there yet, so having no beat is expected. Counting them
  // would make every unwritten act look like a problem.
  const scenes = [sceneRank('s0', 0), sceneRank('s1', 1, 'outline'), sceneRank('s2', 2, 'outline')];
  assert.deepEqual(threads.findInertScenes(scenes, [beat('a1', 'arc', 's0', 'step')]), []);

  // And an outline scene BETWEEN two written ones breaks the run rather than joining it:
  // "three in a row" has to mean three scenes the reader actually reads.
  const mixed = [sceneRank('s0', 0), sceneRank('s1', 1, 'outline'), sceneRank('s2', 2)];
  const runs = threads.findInertScenes(mixed, []);
  assert.deepEqual(runs.map((run) => run.scenes.map((scene) => scene.sceneId)), [['s0'], ['s2']]);
});

test('the closing order puts what never closes at the END', () => {
  const scenes = [sceneRank('s1', 0), sceneRank('s2', 1)];
  const plotted = threads.plotThreads(
    [thread('cierra', 'arc'), thread('abierto', 'arc')],
    [beat('cierra', 'arc', 's2', 'turn')],
    scenes
  );
  const closing = threads.closingOrder(plotted);
  assert.deepEqual(closing.map((entry) => entry.thread.threadId), ['cierra', 'abierto']);
  assert.equal(closing.at(-1).last, null, 'unfinished business is not the head of a list about endings');
});

test('the milestone sheet is plain text in scene positions, never percentages', () => {
  const scenes = [sceneRank('s1', 0), sceneRank('s2', 1), sceneRank('s3', 2)];
  const plotted = threads.plotThreads(
    [thread('El deshielo', 'arc'), thread('Sin hitos', 'arc')],
    [{ ...beat('El deshielo', 'arc', 's3', 'turn'), text: 'Deja de mentirse' }],
    scenes
  );
  const sheet = threads.milestoneSheet(plotted, 3);
  assert.match(sheet, /3\/3/);
  assert.match(sheet, /Deja de mentirse/);
  assert.match(sheet, /Sin hitos\n {2}—/, 'an arc with no milestones says so instead of vanishing');
  assert.doesNotMatch(sheet, /%/);
});

// ── Rules ────────────────────────────────────────────────────────────────────

const rules = load('shared/worldRules.ts');

function rule(id, over = {}) {
  return {
    ruleId: id,
    title: id,
    titleKey: id,
    statement: null,
    cost: null,
    limits: null,
    hardness: 'costly',
    parentRuleId: null,
    articleId: null,
    scopeKind: 'world',
    scopeId: null,
    fromWorldDay: null,
    toWorldDay: null,
    status: 'canon',
    secretId: null,
    proposedText: null,
    proposedAt: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

const subject = (over = {}) => ({ personId: 'c1', groupIds: [], placePath: [], ...over });
const ruleBeat = (ruleId, sceneId, mark, order, over = {}) => ({
  ...beat(ruleId, 'rule', sceneId, mark, order),
  ...over,
});

test('a rule with no day gets the benefit of the doubt', () => {
  // Most of a manuscript has no world day at all. Treating "I don't know when" as
  // "outside its validity" would silence every check on every undated scene.
  const span = { fromWorldDay: 100, toWorldDay: 200, status: 'canon' };
  assert.equal(rules.ruleInForce(span, null), true);
  assert.equal(rules.ruleInForce(span, 150), true);
  assert.equal(rules.ruleInForce(span, 99), false);
  assert.equal(rules.ruleInForce(span, 201), false);
  // Retired is retired, whatever the day.
  assert.equal(rules.ruleInForce({ ...span, status: 'retired' }, null), false);
});

test('a law of the kingdom reaches the tavern inside the city inside the kingdom', () => {
  const law = rules.toScope(rule('r1', { scopeKind: 'place', scopeId: 'reino' }));
  assert.equal(rules.ruleAppliesTo(law, subject({ placePath: ['taberna', 'ciudad', 'reino'] }), null), true);
  assert.equal(rules.ruleAppliesTo(law, subject({ placePath: ['taberna', 'ciudad'] }), null), false);
  // A scope with no id reaches nobody, rather than everybody.
  const broken = rules.toScope(rule('r2', { scopeKind: 'group', scopeId: null }));
  assert.equal(rules.ruleAppliesTo(broken, subject({ groupIds: ['g1'] }), null), false);
});

test('effectiveRules answers "which one wins", not "which exist"', () => {
  // Exception of exception: the grandmother is bitten by the mother, and the mother by
  // the child. Only the top of the chain is listed, or one situation looks like three
  // contradictory laws.
  const madre = rules.toScope(rule('madre'));
  const excepcion = rules.toScope(rule('excepcion', { parentRuleId: 'madre', scopeKind: 'group', scopeId: 'g1' }));
  const nieta = rules.toScope(rule('nieta', { parentRuleId: 'excepcion', scopeKind: 'group', scopeId: 'g1' }));

  const all = rules.effectiveRules([madre, excepcion, nieta], subject({ groupIds: ['g1'] }), null);
  assert.deepEqual(all.map((entry) => entry.rule.ruleId), ['madre']);
  assert.deepEqual(all[0].overriddenBy.map((entry) => entry.ruleId), ['excepcion']);

  // Somebody outside the guild: the exception never reaches them, so the mother stands
  // alone and unbitten.
  const outsider = rules.effectiveRules([madre, excepcion, nieta], subject({ groupIds: [] }), null);
  assert.deepEqual(outsider.map((entry) => entry.rule.ruleId), ['madre']);
  assert.deepEqual(outsider[0].overriddenBy, []);
});

test('paid has THREE states, and only the explicit no is a problem', () => {
  // The assertion the whole section turns on. `null` means the author has not looked; a
  // freshly marked break must never count as an accusation.
  const unjudged = rules.ruleTally([ruleBeat('r1', 's1', 'breaks', 0, { paid: null })], [], 0);
  assert.equal(unjudged.unpaid, 0);
  assert.equal(unjudged.unjudged, 1);
  assert.equal(rules.ruleHealth(unjudged), 'working', 'not "unpaid", and not an accusation');

  const paid = rules.ruleTally([ruleBeat('r1', 's1', 'breaks', 0, { paid: true })], [], 0);
  assert.equal(paid.unpaid, 0);
  assert.equal(paid.unjudged, 0);

  const unpaid = rules.ruleTally([ruleBeat('r1', 's1', 'breaks', 0, { paid: false })], [], 0);
  assert.equal(unpaid.unpaid, 1);
  assert.equal(rules.ruleHealth(unpaid), 'unpaid');
});

test('health tells untested from working from overrun', () => {
  assert.equal(rules.ruleHealth(rules.ruleTally([], [], 0)), 'untested');
  assert.equal(rules.ruleHealth(rules.ruleTally([ruleBeat('r1', 's1', 'obeys', 0)], [], 0)), 'working');
  // A law whose exceptions are tested more than it is has stopped being the law.
  const eaten = rules.ruleTally(
    [ruleBeat('r1', 's1', 'obeys', 0)],
    [ruleBeat('x', 's2', 'obeys', 1), ruleBeat('x', 's3', 'obeys', 2)],
    0
  );
  assert.equal(rules.ruleHealth(eaten), 'overrun');
});

test('the tally remembers where it was first established and first broken', () => {
  const tally = rules.ruleTally(
    [
      ruleBeat('r1', 's3', 'breaks', 2),
      ruleBeat('r1', 's1', 'breaks', 0),
      ruleBeat('r1', 's2', 'establishes', 1),
    ],
    [],
    0
  );
  assert.equal(tally.firstBroken, 0);
  assert.equal(tally.firstEstablished, 1);
});

test('checkRules only reports an unpaid break the author marked as unpaid', () => {
  const base = {
    rules: [rule('r1', { title: 'La sangre paga' })],
    mentions: new Map([['r1', 1]]),
    context: new Map(),
    liveScopeIds: new Set(),
  };
  // The one the critique demanded seeing fail first: `null` must NOT warn.
  const quiet = rules.checkRules({ ...base, beats: [ruleBeat('r1', 's1', 'breaks', 0, { paid: null })] });
  assert.deepEqual(quiet.filter((f) => f.checkId === 'rule.unpaid'), []);

  const loud = rules.checkRules({ ...base, beats: [ruleBeat('r1', 's1', 'breaks', 0, { paid: false })] });
  assert.equal(loud.filter((f) => f.checkId === 'rule.unpaid').length, 1);
  assert.equal(loud[0].family, 'rule');
});

test('a law broken before it is explained is reported in scene positions', () => {
  const found = rules.checkRules({
    rules: [rule('r1')],
    beats: [ruleBeat('r1', 's1', 'breaks', 3), ruleBeat('r1', 's2', 'establishes', 29)],
    mentions: new Map([['r1', 1]]),
    context: new Map(),
    liveScopeIds: new Set(),
  });
  const finding = found.find((f) => f.checkId === 'rule.brokenBeforeEstablished');
  assert.ok(finding);
  assert.deepEqual(finding.detail.vars, { broken: '4', established: '30' }, 'one-based, as the writer counts');
});

test('a law nobody ever meets is a GAP, and a tentative one says nothing', () => {
  const dead = rules.checkRules({
    rules: [rule('r1')],
    beats: [],
    mentions: new Map(),
    context: new Map(),
    liveScopeIds: new Set(),
  });
  const finding = dead.find((f) => f.checkId === 'rule.dead');
  assert.equal(finding.severity, 'gap', 'nothing is wrong, it just has not been used');

  // A draft the author has not committed to must not be shouted about.
  const tentative = rules.checkRules({
    rules: [rule('r1', { status: 'tentative' })],
    beats: [],
    mentions: new Map(),
    context: new Map(),
    liveScopeIds: new Set(),
  });
  assert.deepEqual(tentative.filter((f) => f.checkId === 'rule.dead'), []);
  // And a retired law is not checked at all.
  const retired = rules.checkRules({
    rules: [rule('r1', { status: 'retired' })],
    beats: [ruleBeat('r1', 's1', 'breaks', 0, { paid: false })],
    mentions: new Map(),
    context: new Map(),
    liveScopeIds: new Set(),
  });
  assert.deepEqual(retired, []);
});

test('"she could not, and did it anyway" needs the membership OF THAT DAY', () => {
  const guildLaw = rule('r1', { scopeKind: 'group', scopeId: 'g1' });
  const beats = [ruleBeat('r1', 's1', 'breaks', 0, { subjectKind: 'character', subjectId: 'c1', subjectName: 'Kaelen' })];

  // A member: nothing to report.
  const member = rules.checkRules({
    rules: [guildLaw],
    beats,
    mentions: new Map([['r1', 1]]),
    context: new Map([['r1:s1', { subject: subject({ groupIds: ['g1'] }), worldDay: 10 }]]),
    liveScopeIds: new Set(['g1']),
  });
  assert.deepEqual(member.filter((f) => f.checkId === 'rule.appliedToOutsider'), []);

  // Not a member THAT DAY: reported. Reading today's membership instead would turn a
  // correct scene into a warning every time somebody changes sides.
  const outsider = rules.checkRules({
    rules: [guildLaw],
    beats,
    mentions: new Map([['r1', 1]]),
    context: new Map([['r1:s1', { subject: subject({ groupIds: [] }), worldDay: 10 }]]),
    liveScopeIds: new Set(['g1']),
  });
  assert.equal(outsider.filter((f) => f.checkId === 'rule.appliedToOutsider').length, 1);

  // Outside its validity window counts too.
  const tooEarly = rules.checkRules({
    rules: [rule('r1', { fromWorldDay: 100 })],
    beats,
    mentions: new Map([['r1', 1]]),
    context: new Map([['r1:s1', { subject: subject(), worldDay: 10 }]]),
    liveScopeIds: new Set(),
  });
  assert.equal(tooEarly.filter((f) => f.checkId === 'rule.appliedToOutsider').length, 1);
});

test('a scope pointing at something deleted is reported', () => {
  const found = rules.checkRules({
    rules: [rule('r1', { scopeKind: 'group', scopeId: 'borrada' })],
    beats: [ruleBeat('r1', 's1', 'obeys', 0)],
    mentions: new Map([['r1', 1]]),
    context: new Map(),
    liveScopeIds: new Set(['g1']),
  });
  assert.equal(found.filter((f) => f.checkId === 'rule.orphanScope').length, 1);
});

test('the suggestions are titles only, never prefilled prose', () => {
  // Prefilled prose has to be DELETED before it can be answered, and it lands in the
  // database outside the reach of i18n — the trap the character templates fell into.
  assert.ok(rules.RULE_SUGGESTIONS.length >= 5);
  for (const suggestion of rules.RULE_SUGGESTIONS) {
    assert.equal(typeof suggestion, 'string');
    assert.ok(suggestion.length < 60, 'a title, not a paragraph');
  }
});

// ── Open questions ───────────────────────────────────────────────────────────
//
// The decisions a world has not taken yet. Almost everything here is about ONE thing —
// `planApply` / `canUndo` — because this is the only code in the whole "Analizar" group
// that writes into somebody's manuscript, and an undo that clobbers a paragraph written
// afterwards is worse than no undo at all.

const questions = load('shared/worldQuestions.ts');

function text(over = {}) {
  return { kind: 'character', id: 'prs_7', title: 'Kaelen', field: 'backstory', text: '', ...over };
}

function storedQuestion(over = {}) {
  return {
    questionId: 'qst_1',
    question: '¿De quién es hija?',
    anchorKind: 'character',
    anchorId: 'prs_7',
    anchorTitle: 'Kaelen',
    anchorField: 'backstory',
    status: 'open',
    origin: 'author',
    originKey: null,
    blocking: false,
    chosenOptionId: null,
    answeredAt: null,
    options: [],
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

function option(over = {}) {
  return {
    optionId: 'qop_1',
    questionId: 'qst_1',
    text: 'Hija del carcelero',
    implications: null,
    origin: 'author',
    applyMode: 'fill_field',
    appliedAt: null,
    replacedText: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

test('the four marks are found, and code is left alone', () => {
  const hits = questions.findPlaceholders([
    text({ text: 'Nació en ??? y creció lejos.' }),
    text({ id: 'prs_8', title: 'Vael', field: 'personality', text: 'Su lealtad es TBD.' }),
    text({ id: 'plc_1', kind: 'place', title: 'Vado', field: 'history', text: 'Fundada en [...]' }),
    // A snippet being SHOWN is not a hole left to decide.
    text({ id: 'prs_9', title: 'Mira', field: 'notes', text: 'El manual dice `TBD` en esa línea.' }),
  ]);
  assert.deepEqual(
    hits.map((hit) => hit.anchor.id).sort(),
    ['plc_1', 'prs_7', 'prs_8']
  );
});

test('three holes in one field are ONE decision, not three', () => {
  // One key per (entry, field): a backstory with three question marks about the same
  // undecided thing is one thing to decide, and three rows would be three parkings.
  const hits = questions.findPlaceholders([text({ text: 'Nació en ???, hija de ??? y de ???.' })]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].occurrences, 3);
  assert.equal(hits[0].originKey, 'ph:character:prs_7:backstory');
});

test('the evidence is the line verbatim, never a paraphrase', () => {
  const [hit] = questions.findPlaceholders([
    text({ text: 'Una primera línea.\n  El nombre de su madre es ???  \nY otra después.' }),
  ]);
  assert.equal(hit.evidence, 'El nombre de su madre es ???');
});

test('a stored row hides the hole it came from, whatever the scan says', () => {
  // The row is the author's: they may have parked it, answered it or rewritten its
  // wording, and a scan that runs on every open must never overrule any of that.
  const derived = questions.findPlaceholders([text({ text: 'Nació en ???' })]);
  const feed = questions.mergeQuestionFeed(
    [storedQuestion({ originKey: 'ph:character:prs_7:backstory', question: 'La reescribí yo' })],
    derived
  );
  assert.equal(feed.length, 1);
  assert.equal(feed[0].question, 'La reescribí yo');
  assert.equal(feed[0].questionId, 'qst_1');
  // And the evidence still comes from today's prose rather than from a stale copy.
  assert.equal(feed[0].evidence, 'Nació en ???');
});

test('a parked hole stays parked, and its row is not offered again', () => {
  const derived = questions.findPlaceholders([text({ text: 'Nació en ???' })]);
  const open = questions.mergeQuestionFeed(
    [storedQuestion({ originKey: 'ph:character:prs_7:backstory', status: 'parked' })],
    derived
  );
  assert.deepEqual(open, [], 'neither the row nor the hole it stands for comes back');
  const settled = questions.mergeQuestionFeed(
    [storedQuestion({ originKey: 'ph:character:prs_7:backstory', status: 'parked' })],
    derived,
    { includeSettled: true }
  );
  assert.equal(settled.length, 1);
});

test('a question whose anchor was deleted becomes a question about the world', () => {
  // Deleting a character must not delete the author's sentence, and it must not leave a
  // button pointing at a sheet nobody can open.
  const [item] = questions.mergeQuestionFeed([storedQuestion({ anchorTitle: null })], []);
  assert.equal(item.anchor, null);
  assert.equal(item.question, '¿De quién es hija?');
});

test('the limit scene is the first UNWRITTEN one that leans on it', () => {
  const scenes = [
    { sceneId: 's1', title: 'El vado', narrativeOrder: 0, written: true, leansOn: ['character:prs_7'] },
    { sceneId: 's2', title: 'La torre', narrativeOrder: 1, written: false, leansOn: ['place:plc_1'] },
    { sceneId: 's3', title: 'El juicio', narrativeOrder: 2, written: false, leansOn: ['character:prs_7'] },
    { sceneId: 's4', title: 'El final', narrativeOrder: 3, written: false, leansOn: ['character:prs_7'] },
  ];
  const blocked = questions.nextBlockedScene({ kind: 'character', id: 'prs_7' }, scenes);
  assert.equal(blocked.sceneId, 's3', 'a finished chapter is a revision, not a block');
  assert.equal(questions.nextBlockedScene(null, scenes), null);
});

test('the ranking puts what blocks you first, and never invents a weight', () => {
  const scenes = [
    { sceneId: 's9', title: 'Tarde', narrativeOrder: 9, written: false, leansOn: ['character:a'] },
    { sceneId: 's2', title: 'Pronto', narrativeOrder: 2, written: false, leansOn: ['character:b'] },
  ];
  // The test data is deliberately ordered AGAINST the expected result: leverage descends
  // as the names ascend, so a missing sort cannot pass by accident.
  const stored = [
    storedQuestion({ questionId: 'q1', question: 'A', anchorId: 'a', anchorTitle: 'A' }),
    storedQuestion({ questionId: 'q2', question: 'B', anchorId: 'b', anchorTitle: 'B' }),
    storedQuestion({ questionId: 'q3', question: 'C', anchorId: 'c', anchorTitle: 'C' }),
    storedQuestion({ questionId: 'q4', question: 'D', anchorId: 'd', anchorTitle: 'D', blocking: true }),
    storedQuestion({ questionId: 'q5', question: 'E', anchorId: 'e', anchorTitle: 'E' }),
  ];
  const ranked = questions.rankQuestionFeed(
    questions.mergeQuestionFeed(stored, [], {
      scenes,
      leverage: new Map([
        ['character:a', 1],
        ['character:b', 1],
        ['character:c', 1],
        ['character:e', 40],
      ]),
    })
  );
  assert.deepEqual(
    ranked.map((item) => item.question),
    ['D', 'B', 'A', 'E', 'C'],
    'blocked by hand, then the scene that arrives first, then what most of the world hangs off'
  );
  assert.deepEqual(
    ranked.map((item) => item.urgency),
    ['blocking', 'soon', 'soon', 'later', 'later']
  );
});

test('answering REPLACES the hole rather than appending under it', () => {
  const write = questions.planApply(
    { question: '¿?', anchor: { kind: 'character', id: 'prs_7', title: 'Kaelen' }, anchorField: 'backstory' },
    option(),
    'Nació en ??? y creció lejos.'
  );
  assert.equal(write.nextText, 'Nació en Hija del carcelero y creció lejos.');
  assert.equal(write.replacedText, 'Nació en ??? y creció lejos.', 'the whole previous field IS the undo');
  assert.equal(write.field, 'backstory');
});

test('with no hole in it, the answer is appended as its own paragraph', () => {
  // Never an overwrite: the field says something else, and something else is prose the
  // author wrote.
  const write = questions.planApply(
    { question: '¿?', anchor: { kind: 'character', id: 'prs_7', title: 'Kaelen' }, anchorField: 'backstory' },
    option(),
    'Creció en el vado.'
  );
  assert.equal(write.nextText, 'Creció en el vado.\n\nHija del carcelero');
});

test('a question about the world at large becomes an article, not a field write', () => {
  const write = questions.planApply(
    { question: '¿La magia deja marca visible?', anchor: null, anchorField: null },
    option({ applyMode: 'create_article', implications: 'Los magos no pueden esconderse.' }),
    null
  );
  assert.equal(write.create, 'article');
  assert.equal(write.title, 'La magia deja marca visible');
  assert.match(write.summary, /Los magos no pueden esconderse/);
});

test('a decision can be taken and simply remembered', () => {
  assert.equal(
    questions.planApply({ question: '¿?', anchor: null, anchorField: null }, option({ applyMode: 'none' }), null),
    null
  );
  // And the mode is INFERRED from where it was captured, never asked in a form.
  assert.equal(questions.inferApplyMode({ kind: 'character' }, 'backstory'), 'fill_field');
  assert.equal(questions.inferApplyMode({ kind: 'character' }, null), 'none');
  assert.equal(questions.inferApplyMode(null, null), 'create_article');
});

test('a fill_field plan refuses to fire without an anchor', () => {
  assert.equal(
    questions.planApply({ question: '¿?', anchor: null, anchorField: 'backstory' }, option(), 'texto'),
    null
  );
  assert.equal(
    questions.planApply(
      { question: '¿?', anchor: { kind: 'character', id: 'prs_7', title: 'K' }, anchorField: 'backstory' },
      option({ text: '   ' }),
      'texto'
    ),
    null
  );
});

test('the undo is offered only while the field still says what was written', () => {
  const applied = option({ appliedAt: '2026-07-28', replacedText: 'Nació en ???' });
  assert.equal(questions.canUndo(applied, 'Nació en Hija del carcelero'), true);
  // Rewritten afterwards: restoring the old paragraph would destroy work done since, so
  // the offer disappears rather than the prose.
  assert.equal(questions.canUndo(applied, 'Nació en la casa del carcelero, aunque nunca lo dijo.'), false);
  assert.equal(questions.canUndo(option({ replacedText: 'x' }), 'Hija del carcelero'), false, 'never applied');
  assert.equal(questions.canUndo({ ...applied, replacedText: null }, 'Hija del carcelero'), false);
});

// ── The two model calls ──────────────────────────────────────────────────────
//
// The IA does not calculate anything in this layer: it drafts one sentence and proposes
// three answers, both under a button and both in quarantine. What is worth testing without
// a provider is exactly that — what the model is TOLD, and what is read back out of it.

const ruleContext = load('shared/worldRuleContext.ts');
const questionContext = load('shared/worldQuestionContext.ts');

function ruleSources(over = {}) {
  return {
    title: 'La sangre paga la sangre',
    hardness: 'Tiene un precio',
    hardnessHint: 'Puede pasar, pero cuesta algo.',
    scope: 'Todo el mundo',
    statement: null,
    cost: null,
    limits: null,
    exceptions: [],
    tests: [],
    mentions: [],
    calendar: null,
    ...over,
  };
}

function questionSources(over = {}) {
  return {
    question: '¿De quién es hija Kaelen?',
    anchorTitle: 'Kaelen Vor',
    anchorKind: 'Personaje',
    fieldLabel: 'Trasfondo',
    evidence: 'Nació en ??? y creció lejos.',
    anchorProse: [],
    existing: [],
    neighbours: [],
    blockedScene: null,
    ...over,
  };
}

test('a bare title is not enough to draft a law from', () => {
  // The blank page is what the button is for, but a title in a vault that has never used
  // the law yields a sentence that would fit any fantasy novel — and an author deletes
  // that once and never presses it again. One more signal, all of them a click away.
  assert.equal(ruleContext.hasWorldRuleMaterial(ruleSources()), false);
  assert.equal(ruleContext.hasWorldRuleMaterial(ruleSources({ statement: 'Algo' })), true);
  assert.equal(ruleContext.hasWorldRuleMaterial(ruleSources({ exceptions: ['Salvo los Cuervos'] })), true);
  assert.equal(
    ruleContext.hasWorldRuleMaterial(ruleSources({ tests: [{ mark: 'la rompe', sceneTitle: 'El vado', text: null, subjectName: null, paid: null }] })),
    true
  );
  assert.equal(ruleContext.hasWorldRuleMaterial(ruleSources({ title: '   ', statement: 'Algo' })), false);
});

test('the law prompt asks for the statement and NOTHING else', () => {
  // The price and the limits are separate fields because each diagnostic asks a different
  // question of each; a model that filled all three would invent two answers to buy one.
  assert.match(ruleContext.WORLD_RULE_SYSTEM, /SOLO el enunciado/);
  assert.match(ruleContext.WORLD_RULE_SYSTEM, /son otros campos de la ficha y NO se escriben aquí/);
  assert.match(ruleContext.WORLD_RULE_SYSTEM, /No introduzcas nombres propios/);
});

test('what the author already wrote is a draft to improve, never a text to replace', () => {
  const composed = ruleContext.composeWorldRuleContext(
    ruleSources({ statement: 'La sangre derramada se cobra en sangre.', cost: 'Un año de vida' })
  );
  assert.match(composed, /ENUNCIADO ACTUAL \(mejóralo, no lo tires\): La sangre derramada/);
  // The other two fields are context, not a target. Saying so is what keeps the accepted
  // proposal from swallowing three fields into one.
  assert.match(composed, /LO QUE CUESTA ROMPERLA \(otro campo; no lo repitas\)/);
});

test('the law prompt carries how the story actually tests it, price included', () => {
  const composed = ruleContext.composeWorldRuleContext(
    ruleSources({
      tests: [
        { mark: 'la rompe', sceneTitle: 'El vado', text: 'Mata sin pagar', subjectName: 'Kaelen', paid: false },
        { mark: 'la obedece', sceneTitle: 'El juicio', text: null, subjectName: null, paid: null },
      ],
    })
  );
  assert.match(composed, /El vado — Kaelen: la rompe: Mata sin pagar \[el precio NO está en la página\]/);
  assert.match(composed, /El juicio — la obedece$/m, 'no invented subject, no invented price');
});

test('a world with no calendar is not handed an empty one', () => {
  assert.doesNotMatch(ruleContext.composeWorldRuleContext(ruleSources()), /CALENDARIO/);
  assert.match(
    ruleContext.composeWorldRuleContext(ruleSources({ calendar: { eras: ['Tercera Era'] } })),
    /CALENDARIO DE ESTE MUNDO \(no uses ningún otro\) — eras: Tercera Era/
  );
});

test('«???» on its own is not a question anybody can answer', () => {
  // The common degenerate case: a field containing nothing but the mark becomes a question
  // whose whole text IS the mark, and answering that produces generic fantasy.
  assert.equal(questionContext.hasWorldQuestionMaterial(questionSources({ question: '???' })), false);
  assert.equal(
    questionContext.hasWorldQuestionMaterial(
      questionSources({ question: '???', anchorProse: [{ field: 'Trasfondo', text: 'Creció en el vado.' }] })
    ),
    true,
    'the sheet it hangs off can carry it instead'
  );
  assert.equal(questionContext.hasWorldQuestionMaterial(questionSources()), true);
});

test('the options prompt asks for three genuinely different answers, in the author’s voice', () => {
  assert.match(questionContext.WORLD_QUESTION_OPTIONS_SYSTEM, /EXACTAMENTE TRES/);
  assert.match(questionContext.WORLD_QUESTION_OPTIONS_SYSTEM, /tres variantes de la misma idea no son una decisión/);
  // Each answer is written verbatim into somebody's sheet, so it has to read like theirs.
  assert.match(questionContext.WORLD_QUESTION_OPTIONS_SYSTEM, /se escribirá tal cual en la ficha/);
});

test('the question context carries the sheet, the hole and what is already written', () => {
  const composed = questionContext.composeWorldQuestionContext(
    questionSources({
      anchorProse: [{ field: 'Trasfondo', text: 'Creció lejos del vado.' }],
      existing: ['Hija del carcelero'],
      neighbours: [{ title: 'Los Cuervos', kind: 'Facción', summary: 'Los espías de la corte' }],
      blockedScene: 'El juicio',
    })
  );
  assert.match(composed, /SOBRE: Kaelen Vor \(Personaje\) — se escribirá en «Trasfondo»/);
  assert.match(composed, /LA FRASE DONDE ESTÁ EL HUECO: Nació en \?\?\? y creció lejos\./);
  assert.match(composed, /BLOQUEA LA ESCENA: El juicio/);
  assert.match(composed, /LO QUE LA FICHA YA DICE[\s\S]*Trasfondo: Creció lejos del vado\./);
  assert.match(composed, /YA HA ESCRITO COMO RESPUESTA \(no lo repitas\)[\s\S]*Hija del carcelero/);
});

test('the parser survives everything a warm model does around its answer', () => {
  const parsed = questionContext.parseQuestionOptions(
    [
      'Claro, aquí van tres posibilidades:',
      '',
      '1. **OPCIÓN:** Hija del carcelero de Vael.',
      '   IMPLICA: los Cuervos la reconocerían al verla.',
      '- OPCION 2: Hija de nadie; la crió el gremio.',
      '  **Implicaciones:** nadie puede reclamarla,',
      '  y el juicio pierde su testigo.',
      'OPCIÓN 3 — Hija de la propia jueza.',
      '',
      'Espero que te sirvan.',
    ].join('\n')
  );
  assert.deepEqual(parsed, [
    { text: 'Hija del carcelero de Vael.', implications: 'los Cuervos la reconocerían al verla.' },
    {
      text: 'Hija de nadie; la crió el gremio.',
      implications: 'nadie puede reclamarla, y el juicio pierde su testigo.',
    },
    // An answer with no implications is KEPT: the answer is the part that reaches the
    // world, and dropping it would be the parser deciding it knows better.
    { text: 'Hija de la propia jueza.', implications: null },
  ]);
});

test('the parser never returns more than three, and never invents one', () => {
  const many = questionContext.parseQuestionOptions(
    ['OPCIÓN: A', 'OPCIÓN: B', 'OPCIÓN: C', 'OPCIÓN: D'].join('\n')
  );
  assert.deepEqual(many.map((option) => option.text), ['A', 'B', 'C']);
  // An IMPLICA with nothing above it belongs to nothing.
  assert.deepEqual(questionContext.parseQuestionOptions('IMPLICA: algo suelto'), []);
  assert.deepEqual(questionContext.parseQuestionOptions('Aquí no hay ninguna opción.'), []);
  assert.deepEqual(questionContext.parseQuestionOptions('OPCIÓN:   '), []);
});
