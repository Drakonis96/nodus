// The map's timeline and the following of characters across maps.
//
// The engine is covered by test-world-presence.mjs. What is pinned here is the wiring:
// that the playhead never round-trips to SQLite, that auto-following is off unless it can
// be useful, and that scrubbing the slider does not yank the map out from under the
// reader.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { readSource } from './ipc-channel-census.mjs';

// readSource resolves the '@main' / '@bridge' / '@api' sentinels to whole surfaces —
// the three former hot files are directories now — and any other path to that file.
const read = async (file) => readSource(file);

test('scrubbing the playhead is arithmetic, not a query', async () => {
  const view = await read('src/views/WorldMapsView.tsx');
  // Presences are loaded ONCE per map and turned into tracks in memory. A query per tick
  // would make playback stutter on a cast of forty and hammer the database for nothing.
  const load = view.slice(view.indexOf('window.nodus.listWorldPresences()'), view.indexOf('const followed'));
  assert.match(load, /buildTracks\(presences\)/);
  assert.match(view, /const placedCast = useMemo\(/);
  // Nothing may fetch inside the per-day computation.
  const placed = view.slice(view.indexOf('const placedCast = useMemo('), view.indexOf('const parentOfPlace'));
  assert.doesNotMatch(placed, /window\.nodus/);
});

test('the playhead steps by a fraction of the range, not by one day', async () => {
  const timeline = await read('src/components/world/mapTimeline.tsx');
  // A story spanning eleven days and one spanning three centuries have to play in about
  // the same time on screen, or the second is unwatchable.
  assert.match(timeline, /const step = Math\.max\(1, Math\.round\(\(range\.max - range\.min\) \/ 240\)\)/);
  // It stops at the end rather than looping: a map that silently restarts makes the
  // reader think they missed something.
  assert.match(timeline, /onChangeRef\.current\(\{ day: range\.max, playing: false \}\)/);
  // The interval reads the CURRENT day from a ref, so it is not rebuilt on every tick.
  assert.match(timeline, /const current = dayRef\.current \?\? range\.min;/);
  // A speed change takes effect at once, not at the next tick.
  assert.match(timeline, /\}, \[state\.playing, state\.speed, range\?\.min, range\?\.max\]\);/);
});

test('the playhead snaps to the START of a new range, not the end', async () => {
  const timeline = await read('src/components/world/mapTimeline.tsx');
  // The author pressed play to watch the story happen; a playhead parked on the last day
  // has nothing left to show.
  assert.match(timeline, /onChangeRef\.current\(\{ day: range\.min \}\)/);
  // And pressing play at the end restarts instead of doing nothing and looking broken.
  assert.match(timeline, /if \(!playing && atEnd\) onDay\(range\.min\)/);
});

test('an empty cast follows nobody, and says why when nothing is dated', async () => {
  const [view, timeline] = await Promise.all([
    read('src/views/WorldMapsView.tsx'),
    read('src/components/world/mapTimeline.tsx'),
  ]);
  // Empty means NOBODY, not everybody: every selected character is a moving label with a
  // route behind it, and forty at once is noise rather than a story.
  assert.match(view, /cast\.size === 0 \? \[\] : tracks\.filter/);
  assert.match(timeline, /data-testid="map-timeline-empty"/);
  assert.match(timeline, /Nada fechado todavía/);
});

test('auto-following is limited to one character and never fights the slider', async () => {
  const view = await read('src/views/WorldMapsView.tsx');
  assert.match(view, /const following = shouldAutoFollow\(followed\.length, autoFollow\)/);
  // The jump happens only while PLAYING. Dragging the slider to look at something must
  // not yank the map out from under the reader.
  assert.match(view, /if \(!following \|\| !timeline\.playing\) return;/);
  assert.match(view, /if \(focus && focus\.mapId !== map\.mapId\) onOpenMap\(focus\.mapId\)/);
  // The toggle is only offered when it can do anything.
  assert.match(view, /followed\.length === 1 && \(\s*\n\s*<ToolButton[\s\S]{0,200}testId="world-map-follow"/);
});

test('with several characters the strip reports, and nothing moves on its own', async () => {
  const [view, timeline] = await Promise.all([
    read('src/views/WorldMapsView.tsx'),
    read('src/components/world/mapTimeline.tsx'),
  ]);
  assert.match(timeline, /data-testid="map-cast-strip"/);
  assert.match(timeline, /data-testid=\{`map-cast-chip-\$\{chip\.personId\}`\}/);
  // A chip for someone on another map is a BUTTON; one for someone here is not, so the
  // strip cannot be clicked into a no-op.
  assert.match(timeline, /disabled=\{!away\}/);
  // Chips are computed for every selected character, not only the followed one — that is
  // the whole reason the strip exists.
  assert.match(view, /const castChips = useMemo<CastChip\[\]>\(\s*\n\s*\(\) =>\s*\n\s*followed\.map/);
  assert.match(timeline, /fuera del atlas/, 'and it says so when the atlas cannot show them');
});

test('a character on an unmapped place is not drawn on the nearest pin', async () => {
  const timeline = await read('src/components/world/mapTimeline.tsx');
  // `point: null` means "not on this map". Snapping them to the closest marker would put
  // a character somewhere they are not, which reads as data rather than as absence.
  assert.match(timeline, /let point: NormPoint \| null = from \? \{ x: from\.x, y: from\.y \} : null;/);
  // Arriving from off-map: they wait outside rather than appearing at the destination early.
  assert.match(timeline, /\} else if \(!from && to && position\.progress != null\) \{[\s\S]{0,200}point = null;/);
});

test('markers obey the playhead, so borders move with the story', async () => {
  const view = await read('src/views/WorldMapsView.tsx');
  // A polygon with a temporal validity IS a border. Passing the day through is what makes
  // an empire expand and a forest burn on the same machinery that moves the characters.
  assert.match(view, /worldDay=\{timeline\.day\}/);
  assert.doesNotMatch(view, /worldDay=\{null\}/);
});

test('map coverage is one query, not one per map per tick', async () => {
  const [repo, view] = await Promise.all([
    read('electron/db/worldMapsRepo.ts'),
    read('src/views/WorldMapsView.tsx'),
  ]);
  // Following asks "which map draws this place?" for a chain of containers on every tick.
  assert.match(repo, /export function worldMapCoverage\(\)/);
  assert.equal((repo.match(/FROM world_maps m\s*\n\s*LEFT JOIN map_markers/g) ?? []).length, 1);
  assert.match(view, /window\.nodus\.mapCoverage\(\)/);
  // `mapCoverage` already means research-map coverage in this codebase; the world-map one
  // carries its own name so the two can never be confused at an import site.
  const ipc = await read('@main');
  assert.match(ipc, /import \{ decomposeQuestion, mapCoverage \} from '\.\/ai\/researchMap'/);
  assert.match(ipc, /worldMapCoverage\(\)/);
});
