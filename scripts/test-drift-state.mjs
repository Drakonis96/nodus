// Nodus Drift: the persisted configuration, its reducer and its storage.
//
// The properties that matter to the user: a restored mix is always paused and holds
// nothing but settings; a corrupt or hostile stored value never throws and never
// exceeds the limits; and writing to storage is debounced and can fail silently.
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './drift-test-utils.mjs';

const state = loadTs('src/components/drift/driftState.ts');
const catalog = loadTs('shared/driftCatalog.ts');
const { DRIFT_SOUNDS } = catalog;

const entry = (id) => ({ ...DRIFT_SOUNDS.find((sound) => sound.id === id), availability: 'available' });
const meta = (id) => state.driftMetaFromEntry(entry(id));
const select = (current, id) => state.driftReducer(current, { type: 'select', id, meta: meta(id) });
const fresh = () => state.normalizeDriftState(null);

test('named presets snapshot a mix, survive restart, edit only metadata and delete independently', () => {
  let current = select(select(fresh(), 'light-rain'), 'brown-noise');
  current = state.driftReducer(current, { type: 'setVolume', id: 'light-rain', value: 0.6 });
  current = state.driftReducer(current, { type: 'setMaster', value: 0.7 });
  current = state.driftReducer(current, { type: 'savePreset', id: 'reading', name: '  Lectura  ', icon: 'bookOpen' });
  const saved = structuredClone(current.presets[0]);
  assert.equal(saved.name, 'Lectura');
  assert.equal(saved.volumes['light-rain'], 0.6);
  current = state.driftReducer(current, { type: 'clear' });
  current = state.driftReducer(current, { type: 'setVolume', id: 'light-rain', value: 0.1 });
  current = state.parseStoredDriftState(state.serializeDriftState(current));
  assert.deepEqual(current.presets[0], saved, 'later mix changes never alter a saved preset');
  current = state.driftReducer(current, { type: 'editPreset', id: 'reading', name: 'Noche', icon: 'moon' });
  assert.deepEqual(current.presets[0], { ...saved, name: 'Noche', icon: 'moon' });
  current = state.driftReducer(current, { type: 'applyPreset', id: 'reading' });
  assert.deepEqual(current.selection, saved.selection);
  assert.equal(current.volumes['light-rain'], 0.6);
  assert.equal(current.master, 0.7);
  assert.equal(current.filter, 'active');
  current = state.driftReducer(current, { type: 'deletePreset', id: 'reading' });
  assert.deepEqual(current.presets, []);
  assert.deepEqual(current.selection, saved.selection, 'deleting a preset keeps the current mix');
});

test('old profiles and hostile preset data are bounded and normalized without nested payloads', () => {
  assert.deepEqual(state.normalizeDriftState({ version: 1, selection: ['light-rain'] }).presets, []);
  const value = { id: 'valid', name: ' X ', icon: 'untrusted-icon', selection: ['light-rain', 'binaural-alpha', 'binaural-gamma'], volumes: { 'light-rain': 99 }, master: -1,
    snapshot: { 'binaural-alpha': meta('binaural-alpha'), 'binaural-gamma': meta('binaural-gamma') }, presets: [{ selection: ['evil'] }] };
  const raw = { version: 1, presets: [null, {}, { ...value, id: '../escape' }, { ...value, name: '  ' }, value, value, ...Array.from({ length: 100 }, (_, i) => ({ ...value, id: `id-${i}` }))] };
  const parsed = state.normalizeDriftState(raw);
  assert.equal(parsed.presets.length, state.MAX_DRIFT_PRESETS);
  assert.equal(parsed.presets[0].icon, 'drift');
  assert.deepEqual(parsed.presets[0].selection, ['light-rain', 'binaural-gamma']);
  assert.equal(parsed.presets[0].volumes['light-rain'], 1);
  assert.equal(parsed.presets[0].master, 0);
  assert.ok(!('presets' in parsed.presets[0]));
  assert.equal(state.driftReducer(fresh(), { type: 'savePreset', id: 'empty', name: 'Empty', icon: 'drift' }).presets.length, 0);
});

test('defaults: empty, quiet and paused by construction', () => {
  const s = fresh();
  assert.deepEqual(s.selection, []);
  assert.equal(s.master, 0.35);
  assert.equal(s.filter, 'all');
  assert.equal(s.sort, 'recommended');
  assert.deepEqual(s.usage, {});
  assert.equal(state.driftVolumeOf(s, 'anything'), 0.25);
  // There is no play flag in the persisted model at all: restoring cannot start audio.
  assert.ok(!('playing' in s) && !('isPlaying' in s) && !('loading' in s));
});

test('unreadable storage falls back to the defaults without throwing', () => {
  for (const text of [null, undefined, '', 'not json', '{', '[]', '"x"', '42', 'null', '{"version":2}', '{"version":"1"}', '{"selection":["light-rain"]}']) {
    const s = state.parseStoredDriftState(text);
    assert.deepEqual(s.selection, [], `text ${JSON.stringify(text)}`);
    assert.equal(s.master, 0.35);
  }
  // storage that throws on read
  const hostile = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); } };
  assert.deepEqual(state.readStoredDriftState(hostile).selection, []);
  assert.deepEqual(state.readStoredDriftState(null).selection, []);
});

test('a stored mix is normalised: unknown ids kept syntactically, duplicates dropped, six at most, one binaural', () => {
  const raw = {
    version: 1,
    selection: ['light-rain', 'light-rain', 'river', '../etc/passwd', 'HAS SPACES', 42, null, 'binaural-alpha', 'binaural-delta', 'wind', 'birds', 'cafe', 'clock', 'crickets'],
    volumes: {},
    master: 0.5,
    favorites: [],
    filter: 'all',
    snapshot: {
      'binaural-alpha': { nameKey: 'Alpha 10 Hz', icon: 'sine', categoryId: 'binaural', kind: 'binaural' },
      'binaural-delta': { nameKey: 'Delta 2 Hz', icon: 'sine', categoryId: 'binaural', kind: 'binaural' },
    },
  };
  const s = state.normalizeDriftState(raw);
  assert.ok(s.selection.length <= 6);
  assert.equal(new Set(s.selection).size, s.selection.length);
  assert.ok(!s.selection.includes('../etc/passwd') && !s.selection.includes('HAS SPACES'));
  assert.equal(s.selection.filter((id) => id.startsWith('binaural')).length, 1, 'only one binaural preset');
  // The shared policy is applied in order, as if the user had picked them one after another:
  // the later preset takes the earlier one's place, so the stored mix ends up with Delta.
  assert.deepEqual(s.selection.slice(0, 3), ['light-rain', 'river', 'binaural-delta']);
});

test('volumes: NaN, Infinity and text never survive; out-of-range values are clamped', () => {
  const s = state.normalizeDriftState({
    version: 1, selection: ['light-rain'], master: 'loud', favorites: [], filter: 'all', snapshot: {},
    volumes: { 'light-rain': 'x', river: 9, wind: -4, birds: null, cafe: 0.4, clock: 0 },
  });
  assert.equal(s.master, 0.35, 'a non-number master is the default');
  assert.equal(s.volumes['light-rain'], undefined);
  assert.equal(s.volumes.birds, undefined);
  assert.equal(s.volumes.river, 1);
  assert.equal(s.volumes.wind, 0);
  assert.equal(s.volumes.cafe, 0.4);
  assert.equal(s.volumes.clock, 0);
  assert.equal(state.normalizeDriftState({ version: 1, master: Infinity }).master, 0.35);
  assert.equal(state.normalizeDriftState({ version: 1, master: NaN }).master, 0.35);
  // JSON cannot carry NaN or Infinity, it turns them into null: also the default.
  assert.equal(state.parseStoredDriftState('{"version":1,"master":null}').master, 0.35);
});

test('the filter and the snapshot are validated', () => {
  assert.equal(state.normalizeDriftState({ version: 1, filter: 'rain' }).filter, 'rain');
  assert.equal(state.normalizeDriftState({ version: 1, filter: 'favorites' }).filter, 'favorites');
  assert.equal(state.normalizeDriftState({ version: 1, filter: 'active' }).filter, 'active');
  assert.equal(state.normalizeDriftState({ version: 1, filter: 'weather' }).filter, 'all');
  const s = state.normalizeDriftState({
    version: 1, selection: ['light-rain', 'river'], favorites: ['wind'], master: 0.3, volumes: {}, filter: 'all',
    snapshot: {
      'light-rain': { nameKey: 'Lluvia ligera', icon: 'cloudDrizzle', categoryId: 'rain', kind: 'file' },
      river: { nameKey: '', icon: 'waves', categoryId: 'nature', kind: 'file' },
      wind: { nameKey: 'Viento', icon: 'wind', categoryId: 'nature', kind: 'teleport' },
      ghost: { nameKey: 'Fantasma', icon: 'x', categoryId: 'nature', kind: 'file' },
    },
  });
  assert.deepEqual(Object.keys(s.snapshot), ['light-rain'], 'invalid entries and ids outside the mix are dropped');
});

test('serialisation keeps configuration only', () => {
  let s = fresh();
  s = select(s, 'brown-noise');
  s = state.driftReducer(s, { type: 'setVolume', id: 'brown-noise', value: 0.6 });
  s = state.driftReducer(s, { type: 'toggleFavorite', id: 'light-rain', meta: meta('light-rain') });
  const text = state.serializeDriftState(s);
  const parsed = JSON.parse(text);
  assert.deepEqual(Object.keys(parsed).sort(), ['favorites', 'filter', 'master', 'presetUsage', 'presets', 'selection', 'snapshot', 'sort', 'usage', 'version', 'volumes']);
  assert.ok(!/playing|loading|buffer|bytes|path|blob|context|https?:|file:/i.test(text.replace(/"nameKey":"[^"]*"/g, '')));
  assert.deepEqual(state.parseStoredDriftState(text).selection, ['brown-noise']);
  assert.equal(state.parseStoredDriftState(text).volumes['brown-noise'], 0.6);
  assert.deepEqual(state.parseStoredDriftState(text).favorites, ['light-rain']);
  // It round-trips.
  assert.deepEqual(state.parseStoredDriftState(text), state.normalizeDriftState(parsed));
});

test('sort and usage survive restart; old profiles remain recommended and hostile counts are ignored', () => {
  assert.equal(state.normalizeDriftState({ version: 1 }).sort, 'recommended');
  assert.equal(state.normalizeDriftState({ version: 1, sort: 'foreign' }).sort, 'recommended');
  let s = select(fresh(), 'brown-noise');
  s = state.driftReducer(s, { type: 'setSort', sort: 'usage' });
  s = state.driftReducer(s, { type: 'recordUse', ids: ['brown-noise', 'brown-noise', 'not-selected'] });
  s = state.driftReducer(s, { type: 'recordUse', ids: ['brown-noise'] });
  s = state.driftReducer(s, { type: 'savePreset', id: 'reading', name: 'Lectura', icon: 'bookOpen' });
  s = state.driftReducer(s, { type: 'applyPreset', id: 'reading' });
  const restored = state.parseStoredDriftState(state.serializeDriftState(s));
  assert.equal(restored.sort, 'usage');
  assert.deepEqual(restored.usage, { 'brown-noise': 2 });
  assert.deepEqual(restored.presetUsage, { reading: 1 });
  assert.deepEqual(state.driftReducer(restored, { type: 'deletePreset', id: 'reading' }).presetUsage, {});
  const hostile = state.normalizeDriftState({ version: 1, usage: { 'brown-noise': 2, '../path': 5, wind: Infinity, river: -1, birds: 1.5, cafe: '2' }, presetUsage: { missing: 2 } });
  assert.deepEqual(hostile.usage, { 'brown-noise': 2 });
  assert.deepEqual(hostile.presetUsage, {});
  const many = state.normalizeDriftState({ version: 1, usage: Object.fromEntries(Array.from({ length: 600 }, (_, i) => [`sound-${i}`, 1])) });
  assert.ok(Object.keys(many.usage).length <= 256);
  const saturated = state.normalizeDriftState({ version: 1, selection: ['brown-noise'], usage: { 'brown-noise': Number.MAX_SAFE_INTEGER } });
  assert.equal(state.driftReducer(saturated, { type: 'recordUse', ids: ['brown-noise'] }).usage['brown-noise'], Number.MAX_SAFE_INTEGER);
  const prototypeId = state.normalizeDriftState({ version: 1, selection: ['constructor'] });
  assert.equal(state.driftReducer(prototypeId, { type: 'recordUse', ids: ['constructor'] }).usage.constructor, 1);
});

test('the reducer: select, double select, the seventh voice, binaural replacement', () => {
  let s = fresh();
  s = select(s, 'brown-noise');
  const same = select(s, 'brown-noise');
  assert.equal(same, s, 'selecting what is selected is a no-op (same object)');
  for (const id of ['light-rain', 'river', 'wind', 'birds', 'cafe']) s = select(s, id);
  assert.equal(s.selection.length, 6);
  const refused = select(s, 'clock');
  assert.equal(refused, s, 'the seventh voice leaves the mix untouched');

  // binaural replaces in place; it never adds a second one
  let b = select(fresh(), 'light-rain');
  b = select(b, 'binaural-alpha');
  b = select(b, 'river');
  b = select(b, 'binaural-gamma');
  assert.deepEqual(b.selection, ['light-rain', 'binaural-gamma', 'river']);
  // ...and the replaced preset keeps its own volume preference
  const tuned = state.driftReducer(select(fresh(), 'binaural-alpha'), { type: 'setVolume', id: 'binaural-alpha', value: 0.7 });
  assert.equal(select(tuned, 'binaural-gamma').volumes['binaural-alpha'], 0.7);
});

test('the reducer: remove, clear, volumes, master, favorites, filter', () => {
  let s = select(select(fresh(), 'light-rain'), 'river');
  s = state.driftReducer(s, { type: 'remove', id: 'light-rain' });
  assert.deepEqual(s.selection, ['river']);
  assert.equal(state.driftReducer(s, { type: 'remove', id: 'ghost' }), s, 'removing what is absent is a no-op');
  s = state.driftReducer(s, { type: 'clear' });
  assert.deepEqual(s.selection, []);
  assert.equal(state.driftReducer(s, { type: 'clear' }), s);

  for (const bad of [NaN, Infinity, -Infinity, '0.5', undefined]) {
    assert.equal(state.driftReducer(s, { type: 'setVolume', id: 'river', value: bad }), s, `volume ${String(bad)} ignored`);
    assert.equal(state.driftReducer(s, { type: 'setMaster', value: bad }), s, `master ${String(bad)} ignored`);
  }
  assert.equal(state.driftReducer(s, { type: 'setVolume', id: 'river', value: 2 }).volumes.river, 1);
  assert.equal(state.driftReducer(s, { type: 'setMaster', value: 0.8 }).master, 0.8);

  let f = state.driftReducer(fresh(), { type: 'toggleFavorite', id: 'wind', meta: meta('wind') });
  assert.deepEqual(f.favorites, ['wind']);
  assert.ok(f.snapshot.wind);
  f = state.driftReducer(f, { type: 'toggleFavorite', id: 'wind' });
  assert.deepEqual(f.favorites, []);
  assert.equal(state.driftReducer(fresh(), { type: 'setFilter', filter: 'rain' }).filter, 'rain');
});

test('reconciling with the authoritative catalogue prunes ghosts and refreshes metadata', () => {
  let s = fresh();
  s = select(s, 'light-rain');
  s = state.driftReducer(s, { type: 'toggleFavorite', id: 'river', meta: meta('river') });
  // pretend an older install remembered a sound this catalogue no longer has
  s = { ...s, selection: [...s.selection, 'retired-sound'], favorites: [...s.favorites, 'retired-fav'], volumes: { ...s.volumes, 'retired-sound': 0.3, 'light-rain': 0.5 } };
  const reconciled = state.driftReducer(s, {
    type: 'reconcile',
    sounds: DRIFT_SOUNDS.map((sound) => ({ ...sound, availability: 'available' })),
    isKnownIcon: (icon) => icon !== 'cloudDrizzle',
  });
  assert.deepEqual(reconciled.selection, ['light-rain']);
  assert.deepEqual(reconciled.favorites, ['river']);
  assert.equal(reconciled.volumes['retired-sound'], undefined);
  assert.equal(reconciled.volumes['light-rain'], 0.5);
  assert.equal(reconciled.snapshot['light-rain'].icon, 'drift', 'an icon Nodus does not have falls back to the tool icon');
  assert.equal(reconciled.snapshot.river.icon, 'waves');
});

test('storage writes are debounced to one, flushable, and never throw', () => {
  const timers = [];
  const fakeTimers = {
    set(callback, ms) { const handle = { callback, ms, cleared: false }; timers.push(handle); return handle; },
    clear(handle) { handle.cleared = true; },
  };
  const writes = [];
  const storage = { getItem: () => null, setItem: (key, value) => writes.push([key, value]) };
  const persistence = state.createDriftPersistence(storage, 300, fakeTimers);

  let s = fresh();
  for (const value of [0.1, 0.2, 0.3, 0.4, 0.5]) {
    s = state.driftReducer(s, { type: 'setMaster', value });
    persistence.schedule(s);
  }
  assert.equal(writes.length, 0, 'nothing is written while the slider moves');
  assert.equal(timers.filter((timer) => !timer.cleared).length, 1, 'only the last timer stays armed');
  assert.equal(timers.at(-1).ms, 300);
  timers.at(-1).callback();
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], 'nodus:drift:v1');
  assert.equal(JSON.parse(writes[0][1]).master, 0.5);

  // flush writes what is pending now (page hide / unmount)
  persistence.schedule(state.driftReducer(s, { type: 'setMaster', value: 0.9 }));
  assert.equal(persistence.pending, true);
  persistence.flush();
  assert.equal(writes.length, 2);
  assert.equal(JSON.parse(writes[1][1]).master, 0.9);
  assert.equal(persistence.pending, false);
  persistence.flush();
  assert.equal(writes.length, 2, 'flushing with nothing pending writes nothing');

  // cancel drops the pending write
  persistence.schedule(s);
  persistence.cancel();
  persistence.flush();
  assert.equal(writes.length, 2);

  // a failing storage never surfaces
  const failing = state.createDriftPersistence({ getItem: () => null, setItem() { throw new Error('QuotaExceededError'); } }, 300, fakeTimers);
  failing.schedule(s);
  assert.doesNotThrow(() => failing.flush());
  assert.doesNotThrow(() => state.createDriftPersistence(null, 300, fakeTimers).flush());
});

test('the storage key and the debounce are the specified ones', () => {
  assert.equal(state.DRIFT_STORAGE_KEY, 'nodus:drift:v1');
  assert.equal(state.DRIFT_PERSIST_DEBOUNCE_MS, 300);
});
