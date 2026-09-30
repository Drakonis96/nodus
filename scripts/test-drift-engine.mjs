// Nodus Drift: the audio engine, driven through a faithful Web Audio double.
//
// The double enforces what the real API enforces (a source node cannot be started twice,
// a disconnected node leaves the graph, an audio context only advances while running,
// decodeAudioData rejects garbage), and it records every node, connection and automation,
// so these tests assert on the graph the engine really built.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadTs, repoRoot } from './drift-test-utils.mjs';
import { FakeContext, FakeTimers, deferred, fakeAudioBytes, flush, makeTransport } from './drift-audio-fakes.mjs';

// DRIFT_ENGINE_FILE lets the mutation experiment run this same suite against a broken copy of the engine.
const engineModule = loadTs(process.env.DRIFT_ENGINE_FILE || 'src/components/drift/audio/DriftAudioEngine.ts');
const noise = loadTs('src/components/drift/audio/noise.ts');
const { DRIFT_SOUNDS } = loadTs('shared/driftCatalog.ts');
const { DriftAudioEngine, DriftEngineError, classifyError } = engineModule;

const SR = 48000;
const VERIFIED = { licenseStatus: 'verified', licenseId: 'LicenseRef-test', evidenceRefs: ['test'], distributionReview: 'approved', reviewRef: 'test' };

/** A file-backed test sound. `seconds` and `crossfadeMs` are what the catalogue would say. */
function fileDef(id, { seconds = 1, crossfadeMs = 0 } = {}) {
  return {
    id, nameKey: id, descriptionKey: id, categoryId: 'things', icon: 'clock',
    source: { kind: 'file', asset: `things/${id}.mp3`, sha256: 'a'.repeat(64), bytes: 1000, durationSeconds: seconds, loop: true, crossfadeMs },
    provenance: VERIFIED,
  };
}

/**
 * A fresh engine on fake time, a fake context and a scripted transport.
 * `files`: id -> { seconds, channels, crossfadeMs } | deferred | Error
 */
function setup({ files = {}, sampleRate = SR, engineOptions = {}, extraDefs = [] } = {}) {
  const log = [];
  const contexts = [];
  const timers = new FakeTimers();
  const defs = new Map(DRIFT_SOUNDS.map((definition) => [definition.id, definition]));
  const bytes = new Map();
  for (const [id, spec] of Object.entries(files)) {
    if (spec instanceof Error || (spec && spec.promise)) { bytes.set(id, spec); defs.set(id, fileDef(id)); continue; }
    const { seconds = 1, channels = 2, crossfadeMs = 0, bad = false } = spec;
    defs.set(id, fileDef(id, { seconds, crossfadeMs }));
    bytes.set(id, fakeAudioBytes({ frames: Math.round(seconds * sampleRate), channels, sampleRate, bad }));
  }
  for (const definition of extraDefs) defs.set(definition.id, definition);
  const transport = makeTransport(bytes, log);
  const t = {
    log, contexts, timers, transport, defs, bytes,
    get ctx() { return contexts[0]; },
    get created() { return contexts.length; },
  };
  const engine = new DriftAudioEngine({
    createContext: () => {
      const context = new FakeContext({ sampleRate, log });
      contexts.push(context);
      log.push('createContext');
      return context;
    },
    readAudio: transport.read,
    resolveSound: (id) => defs.get(id),
    setTimer: timers.set,
    clearTimer: timers.clear,
    random: (channel) => noise.createMulberry32(4242 + channel * 7919),
    ...engineOptions,
  });
  t.engine = engine;
  /** Step the fake clock through a fade and let the resulting promises settle. */
  t.settle = async (ms = 200) => { timers.advance(ms); await flush(); };
  return t;
}

/** The nodes of the graph by role, found from how they are wired. */
function graph(ctx) {
  const limiter = ctx.of('compressor')[0];
  const master = ctx.of('gain').find((node) => node.connections.some((c) => c.to === limiter));
  const voiceGains = ctx.of('gain').filter((node) => master && node.connections.some((c) => c.to === master));
  const envelopes = ctx.of('gain').filter((node) => node.connections.some((c) => voiceGains.includes(c.to)));
  return { limiter, master, voiceGains, envelopes };
}

const statuses = (engine) => engine.snapshot().voices.map((v) => `${v.id}:${v.status}`);

// ── construction and restoring ─────────────────────────────────────────────

test('constructing and restoring a mix creates no context, reads nothing and is silent', () => {
  const t = setup({ files: { 'rain-a': { seconds: 1 } } });
  assert.equal(t.created, 0);
  t.engine.restore({ ids: ['rain-a', 'white-noise'], volumes: { 'rain-a': 0.6 }, master: 0.5 });
  assert.equal(t.created, 0, 'restoring does not create an AudioContext');
  assert.deepEqual(t.transport.calls, [], 'nothing is fetched');
  const snapshot = t.engine.snapshot();
  assert.deepEqual(snapshot.voices.map((v) => [v.id, v.status, v.volume]), [['rain-a', 'paused', 0.6], ['white-noise', 'paused', 0.25]]);
  assert.equal(snapshot.master, 0.5);
  assert.equal(snapshot.wantPlaying, false);
  assert.equal(snapshot.playing, false);
  assert.equal(snapshot.contextState, 'none');
});

test('restore ignores garbage volumes and is a no-op once the engine has started', async () => {
  const t = setup({ files: { 'rain-a': { seconds: 1 } } });
  t.engine.restore({ ids: ['rain-a'], volumes: { 'rain-a': NaN }, master: Infinity });
  assert.equal(t.engine.snapshot().voices[0].volume, 0.25);
  assert.equal(t.engine.snapshot().master, 0.35);
  await t.engine.playAll();
  t.engine.restore({ ids: ['white-noise'], volumes: {}, master: 0.9 });
  assert.deepEqual(t.engine.snapshot().voices.map((v) => v.id), ['rain-a']);
});

test('doing nothing creates nothing: play, pause and clear on an empty engine', async () => {
  const t = setup();
  await t.engine.playAll();
  await t.engine.pauseAll();
  await t.engine.clearAll();
  t.engine.removeSound('nothing');
  assert.equal(t.created, 0);
});

// ── starting ───────────────────────────────────────────────────────────────

test('loading presets stays silent before first play and cancels a previous pending load in the same context', async () => {
  const slow = deferred();
  const t = setup({ files: { 'slow-file': slow } });
  t.engine.loadMix({ ids: ['brown-noise'], volumes: { 'brown-noise': 0.6 }, master: 0.7 });
  assert.equal(t.created, 0);
  assert.deepEqual(statuses(t.engine), ['brown-noise:paused']);
  const pending = t.engine.selectSound('slow-file');
  await flush();
  t.engine.loadMix({ ids: ['white-noise'], volumes: { 'white-noise': 0.4 }, master: 0.5 });
  slow.resolve(fakeAudioBytes());
  await pending;
  await t.settle();
  assert.deepEqual(statuses(t.engine), ['white-noise:paused'], 'stale decoding cannot resurrect the old mix');
  assert.equal(t.engine.snapshot().contextState, 'suspended');
  assert.equal(t.created, 1);
  await t.engine.playAll();
  assert.deepEqual(statuses(t.engine), ['white-noise:playing']);
  assert.equal(t.created, 1);
  await t.engine.dispose();
});

test('activating a sound creates and resumes the context BEFORE anything is read or decoded', async () => {
  const t = setup({ files: { 'rain-a': { seconds: 1 } } });
  await t.engine.selectSound('rain-a');
  const at = (entry) => t.log.indexOf(entry);
  assert.ok(at('createContext') >= 0 && at('resume') >= 0 && at('read:rain-a') >= 0 && at('decode') >= 0);
  assert.ok(at('createContext') < at('resume'), 'the context exists before it is resumed');
  assert.ok(at('resume') < at('read:rain-a'), 'resume is requested before the read is awaited');
  assert.ok(at('read:rain-a') < at('decode'));
  assert.equal(t.created, 1);
  assert.deepEqual(statuses(t.engine), ['rain-a:playing']);
  assert.equal(t.engine.snapshot().contextState, 'running');
});

test('the graph is source -> envelope -> voice gain -> master -> limiter -> destination', async () => {
  const t = setup({ files: { 'rain-a': { seconds: 1 } } });
  await t.engine.selectSound('rain-a');
  const { limiter, master, voiceGains, envelopes } = graph(t.ctx);
  assert.equal(t.ctx.sources.length, 1);
  const source = t.ctx.sources[0];
  assert.equal(source.loop, true, 'recordings loop natively');
  assert.equal(source.startCalls.length, 1);
  const envelope = source.connections[0].to;
  assert.deepEqual(envelopes, [envelope]);
  assert.equal(voiceGains.length, 1);
  assert.equal(envelope.connections[0].to, voiceGains[0]);
  assert.equal(voiceGains[0].connections[0].to, master);
  assert.equal(master.connections[0].to, limiter);
  assert.equal(limiter.connections[0].to, t.ctx.destination);
  // the fade in is an AudioParam ramp from silence, not a timer
  assert.deepEqual(envelope.gain.events.map((e) => [e[0], e[1]]), [['set', 0], ['ramp', 1]]);
  assert.ok(Math.abs(envelope.gain.events[1][2] - envelope.gain.events[0][2] - 0.15) < 1e-9);
  // default levels leave headroom: voice 0.25 x master 0.35
  assert.equal(voiceGains[0].gain.value, 0.25);
  assert.equal(master.gain.value, 0.35);
});

test('two concurrent activations of one sound create one voice, one read and one source', async () => {
  const gate = deferred();
  const t = setup({ files: { 'rain-a': gate } });
  const first = t.engine.selectSound('rain-a');
  const second = t.engine.selectSound('rain-a');
  gate.resolve(fakeAudioBytes({ frames: SR }));
  await Promise.all([first, second]);
  assert.equal(t.transport.calls.filter((id) => id === 'rain-a').length, 1);
  assert.equal(t.ctx.sources.length, 1);
  assert.deepEqual(statuses(t.engine), ['rain-a:playing']);
});

test('the status stays "loading" until the source has actually started', async () => {
  const gate = deferred();
  const t = setup({ files: { 'rain-a': gate } });
  // Every time an observer is told "playing", a source must already be running behind it.
  const claims = [];
  t.engine.subscribe((snapshot) => {
    if (snapshot.playing) claims.push(t.ctx.sources.length > 0 && t.ctx.sources.every((s) => s.startCalls.length === 1));
  });
  const pending = t.engine.selectSound('rain-a');
  await flush();
  assert.deepEqual(statuses(t.engine), ['rain-a:loading']);
  assert.equal(t.engine.snapshot().playing, false, 'loading is not playing');
  assert.equal(t.engine.snapshot().loading, true);
  assert.equal(t.ctx.sources.length, 0, 'nothing has started yet');
  gate.resolve(fakeAudioBytes({ frames: SR }));
  await pending;
  assert.equal(t.engine.snapshot().playing, true);
  assert.equal(t.engine.snapshot().loading, false);
  assert.ok(claims.length > 0 && claims.every(Boolean), 'no snapshot claimed playback before a source had started');
});

// ── pause, resume, clear, remove ───────────────────────────────────────────

test('pause keeps the selection and volumes, saves the position and suspends after the fade', async () => {
  const t = setup({ files: { 'rain-a': { seconds: 1 } } });
  await t.engine.selectSound('rain-a');
  t.engine.setSoundVolume('rain-a', 0.7);
  t.ctx.currentTime = 0.4;
  const first = t.ctx.sources[0];
  const pause = t.engine.pauseAll();
  assert.deepEqual(statuses(t.engine), ['rain-a:paused']);
  assert.equal(t.engine.snapshot().wantPlaying, false);
  assert.ok(Math.abs(first.stopCalls[0] - 0.55) < 1e-9, 'the source stops at the end of the fade');
  const envelope = first.connections[0].to;
  assert.deepEqual(envelope.gain.events.slice(-3).map((e) => e[0]), ['cancel', 'set', 'ramp']);
  assert.equal(envelope.gain.events.at(-1)[1], 0);
  assert.equal(t.ctx.suspendCalls, 0, 'not suspended while it is still fading');
  await t.settle();
  await pause;
  assert.equal(t.ctx.suspendCalls, 1);
  assert.equal(t.engine.snapshot().contextState, 'suspended');
  assert.ok(first.disconnectCount > 0, 'the old nodes are released');
  assert.equal(t.engine.snapshot().voices[0].volume, 0.7, 'the volume survives the pause');

  // resume: a NEW source at the saved position; the old one is never started again
  await t.engine.playAll();
  assert.equal(t.ctx.sources.length, 2);
  assert.deepEqual(t.ctx.sources[1].startCalls, [{ when: 0.4, offset: 0.4 }]);
  assert.equal(first.startCalls.length, 1);
  assert.deepEqual(statuses(t.engine), ['rain-a:playing']);
  assert.equal(t.created, 1, 'the same context is reused');
});

test('every source node is started once: pause and play never restart a node', async () => {
  const t = setup({ files: { 'rain-a': { seconds: 1 } } });
  await t.engine.selectSound('rain-a');
  for (let i = 0; i < 3; i++) {
    const pause = t.engine.pauseAll();
    await t.settle();
    await pause;
    await t.engine.playAll();
  }
  assert.equal(t.ctx.sources.length, 4);
  assert.ok(t.ctx.sources.every((source) => source.startCalls.length === 1), 'no node was started twice');
  assert.equal(t.transport.calls.length, 1, 'the decoded buffer is reused from the cache');
  assert.equal(t.ctx.decodeCalls, 1);
});

test('activating a sound resumes a paused mix; the position of the others is kept', async () => {
  const t = setup({ files: { 'rain-a': { seconds: 1 }, 'rain-b': { seconds: 1 } } });
  await t.engine.selectSound('rain-a');
  t.ctx.currentTime = 0.25;
  const pause = t.engine.pauseAll();
  await t.settle();
  await pause;
  await t.engine.selectSound('rain-b');
  assert.deepEqual(statuses(t.engine), ['rain-a:playing', 'rain-b:playing']);
  assert.equal(t.ctx.resumeCalls, 2);
  const resumedA = t.ctx.sources.find((s) => s.startCalls[0].offset === 0.25);
  assert.ok(resumedA, 'rain-a came back where it stopped');
});

test('clearing empties the mix, drops the decoded audio and suspends the context', async () => {
  const t = setup({ files: { 'rain-a': { seconds: 1 }, 'rain-b': { seconds: 1 } } });
  await t.engine.selectSound('rain-a');
  await t.engine.selectSound('rain-b');
  assert.ok(t.engine.snapshot().cachedBytes > 0);
  const clear = t.engine.clearAll();
  assert.deepEqual(t.engine.snapshot().voices, []);
  await t.settle();
  await clear;
  assert.equal(t.engine.snapshot().cachedBytes, 0, 'nothing keeps decoded audio for an empty mix');
  assert.equal(t.ctx.suspendCalls, 1);
  assert.ok(t.ctx.sources.every((s) => s.disconnectCount > 0 && s.stopCalls.length === 1));
  assert.equal(t.timers.pending, 0);
});

test('clearing a mix that is already paused frees the decoded audio too, at once', async () => {
  // No instance is fading here, so nothing else would ever release the buffers.
  const t = setup({ files: { 'rain-a': { seconds: 1 }, 'rain-b': { seconds: 1 } } });
  await t.engine.selectSound('rain-a');
  await t.engine.selectSound('rain-b');
  const pause = t.engine.pauseAll();
  await t.settle();
  await pause;
  assert.ok(t.engine.snapshot().cachedBytes > 0, 'a paused mix keeps its buffers for a quick resume');
  const clear = t.engine.clearAll();
  assert.equal(t.engine.snapshot().cachedBytes, 0, 'released synchronously, not after a timer that no longer exists');
  await t.settle();
  await clear;
  assert.deepEqual(t.engine.snapshot().voices, []);
});

test('the three guards against a late start (voice token, global epoch, wantPlaying) each hold on their own scenario', async () => {
  // token: the voice was removed and the same sound added again while the first load is in flight
  {
    const gate = deferred();
    const t = setup({ files: { 'rain-a': gate } });
    const first = t.engine.selectSound('rain-a');
    await flush();
    t.engine.removeSound('rain-a');
    const second = t.engine.selectSound('rain-a');
    gate.resolve(fakeAudioBytes({ frames: SR }));
    await Promise.all([first, second]);
    assert.equal(t.ctx.sources.length, 1, 'one voice, one source: the stale attempt did not start a second');
    assert.equal(t.ctx.sources[0].startCalls.length, 1);
  }
  // epoch + wantPlaying: pause while loading, and the load finishes while paused
  {
    const gate = deferred();
    const t = setup({ files: { 'rain-a': gate } });
    const pending = t.engine.selectSound('rain-a');
    await flush();
    const pause = t.engine.pauseAll();
    gate.resolve(fakeAudioBytes({ frames: SR }));
    await t.settle();
    await Promise.all([pending, pause]);
    assert.equal(t.ctx.sources.length, 0, 'nothing plays while the mix is paused');
    assert.deepEqual(statuses(t.engine), ['rain-a:paused']);
    assert.ok(t.engine.snapshot().cachedBytes > 0, 'but the decoded audio is kept, so Play is quick');
    await t.engine.playAll();
    assert.equal(t.ctx.sources.length, 1);
    assert.equal(t.transport.calls.length, 1, 'and it did not have to be read again');
  }
});

test('the context is created and resumed before the catalogue is even awaited (header Play on a restored mix)', async () => {
  const gate = deferred();
  const log = [];
  const t = setup({ files: { 'rain-a': { seconds: 1 } }, engineOptions: { ready: async () => { log.push('ready-called'); await gate.promise; log.push('ready-done'); } } });
  t.engine.restore({ ids: ['rain-a'], volumes: {}, master: 0.35 });
  const started = t.engine.playAll();
  // synchronously, inside the click: the context exists and has been asked to run
  assert.equal(t.created, 1);
  assert.equal(t.ctx.resumeCalls, 1);
  assert.deepEqual(t.transport.calls, [], 'no audio has been read yet');
  await flush();
  assert.deepEqual(t.engine.snapshot().voices.map((v) => v.status), ['loading']);
  assert.equal(t.ctx.sources.length, 0);
  gate.resolve();
  await started;
  assert.deepEqual(statuses(t.engine), ['rain-a:playing']);
  assert.deepEqual(log, ['ready-called', 'ready-done']);
});

test('removing one voice fades it and leaves the others playing and unsuspended', async () => {
  const t = setup({ files: { 'rain-a': { seconds: 1 }, 'rain-b': { seconds: 1 } } });
  await t.engine.selectSound('rain-a');
  await t.engine.selectSound('rain-b');
  const [a, b] = t.ctx.sources;
  t.engine.removeSound('rain-a');
  assert.deepEqual(statuses(t.engine), ['rain-b:playing']);
  assert.equal(a.stopCalls.length, 1);
  assert.equal(b.stopCalls.length, 0, 'the other voice is not touched');
  await t.settle();
  assert.equal(t.ctx.suspendCalls, 0);
  assert.equal(t.engine.snapshot().contextState, 'running');
  // removing the last one lets the context sleep
  t.engine.removeSound('rain-b');
  await t.settle();
  assert.equal(t.ctx.suspendCalls, 1);
  assert.equal(t.engine.snapshot().wantPlaying, false);
});

test('a pause that a new play overtakes does not hang and does not suspend', async () => {
  const t = setup({ files: { 'rain-a': { seconds: 1 } } });
  await t.engine.selectSound('rain-a');
  const pause = t.engine.pauseAll();
  await t.engine.playAll();
  await pause;
  await t.settle();
  assert.equal(t.ctx.suspendCalls, 0);
  assert.equal(t.engine.snapshot().contextState, 'running');
  assert.deepEqual(statuses(t.engine), ['rain-a:playing']);
});

test('pause then play twice quickly builds one source per play, never two voices', async () => {
  const t = setup({ files: { 'rain-a': { seconds: 1 } } });
  await t.engine.selectSound('rain-a');
  const pause = t.engine.pauseAll();
  await Promise.all([t.engine.playAll(), t.engine.playAll()]);
  await pause;
  assert.equal(t.ctx.sources.length, 2);
  assert.equal(t.engine.snapshot().voices.length, 1);
});

// ── limits and volumes ─────────────────────────────────────────────────────

test('at most six voices; the seventh is refused and the mix, the context and the play state stay as they were', async () => {
  const ids = ['rain-a', 'rain-b', 'rain-c', 'rain-d', 'rain-e', 'rain-f', 'rain-g'];
  const t = setup({ files: Object.fromEntries(ids.map((id) => [id, { seconds: 0.5 }])) });
  for (const id of ids.slice(0, 6)) await t.engine.selectSound(id);
  const pause = t.engine.pauseAll();
  await t.settle();
  await pause;
  const before = { sources: t.ctx.sources.length, resumes: t.ctx.resumeCalls, reads: t.transport.calls.length };
  await assert.rejects(t.engine.selectSound('rain-g'), (error) => error instanceof DriftEngineError && error.code === 'limit');
  assert.equal(t.engine.snapshot().voices.length, 6);
  assert.equal(t.ctx.sources.length, before.sources);
  assert.equal(t.ctx.resumeCalls, before.resumes, 'a refused voice does not wake the context');
  assert.equal(t.transport.calls.length, before.reads, 'and is never read');
  assert.equal(t.engine.snapshot().wantPlaying, false);
});

test('an unknown sound is refused before anything is created', async () => {
  const t = setup();
  await assert.rejects(t.engine.selectSound('no-such-sound'), (error) => error instanceof DriftEngineError && error.code === 'unknown-sound');
  await assert.rejects(t.engine.selectSound('../../etc/passwd'), DriftEngineError);
  assert.equal(t.created, 0);
});

test('volumes must be finite numbers between 0 and 1; slider moves are AudioParam ramps', async () => {
  const t = setup({ files: { 'rain-a': { seconds: 1 }, 'rain-b': { seconds: 1 } } });
  await t.engine.selectSound('rain-a');
  await t.engine.selectSound('rain-b');
  for (const bad of [NaN, Infinity, -Infinity, -0.01, 1.01, '0.5', null, undefined, {}]) {
    assert.throws(() => t.engine.setSoundVolume('rain-a', bad), RangeError, `voice volume ${String(bad)}`);
    assert.throws(() => t.engine.setMasterVolume(bad), RangeError, `master volume ${String(bad)}`);
  }
  const { master, voiceGains } = graph(t.ctx);
  const [gainA, gainB] = voiceGains;
  const untouched = gainB.gain.events.length;
  const masterBefore = master.gain.events.length;
  t.engine.setSoundVolume('rain-a', 0.6);
  assert.deepEqual(gainA.gain.events.slice(-3).map((e) => e[0]), ['cancel', 'set', 'ramp']);
  assert.equal(gainA.gain.events.at(-1)[1], 0.6);
  assert.equal(gainB.gain.events.length, untouched, 'another voice is not affected');
  assert.equal(master.gain.events.length, masterBefore, 'neither is the master');
  t.engine.setMasterVolume(0.8);
  assert.equal(master.gain.events.at(-1)[1], 0.8);
  assert.equal(gainA.gain.events.at(-1)[1], 0.6, 'the master does not rewrite the voices');
  t.engine.setSoundVolume('not-in-the-mix', 0.5);
  assert.equal(t.engine.snapshot().voices.length, 2);
  assert.doesNotThrow(() => { t.engine.setSoundVolume('rain-a', 0); t.engine.setSoundVolume('rain-a', 1); t.engine.setMasterVolume(0); });
});

test('volume acts only inside the Drift bus: the engine has no path to the device or to Browser', () => {
  const source = readFileSync(path.join(repoRoot, 'src/components/drift/audio/DriftAudioEngine.ts'), 'utf8');
  assert.doesNotMatch(source, /setBrowserDeviceVolume|getBrowserDeviceVolume|browserMediaCommand|window\.nodus|navigator\.|HTMLMediaElement|new Audio\(/);
  assert.doesNotMatch(source, /setInterval|requestAnimationFrame/, 'no render timer sustains playback');
});

// ── generators ─────────────────────────────────────────────────────────────

test('a binaural preset uses two tones on two channels; a new preset replaces it and keeps the rest', async () => {
  const t = setup({ sampleRate: 8000 });
  await t.engine.selectSound('binaural-alpha');
  await t.engine.selectSound('white-noise');
  assert.deepEqual(t.ctx.oscillators.map((o) => o.frequency.value), [95, 105]);
  const merger = t.ctx.of('merger')[0];
  assert.equal(merger.numberOfInputs, 2);
  const noiseSource = t.ctx.sources[0];

  await t.engine.selectSound('binaural-gamma');
  assert.deepEqual(t.engine.snapshot().voices.map((v) => v.id), ['binaural-gamma', 'white-noise'], 'the replacement keeps the slot');
  assert.deepEqual(t.ctx.oscillators.map((o) => o.frequency.value), [95, 105, 80, 120]);
  const [oldLeft, oldRight, newLeft, newRight] = t.ctx.oscillators;
  assert.equal(oldLeft.stopCalls.length, 1);
  assert.equal(oldRight.stopCalls.length, 1);
  assert.equal(newLeft.startCalls.length, 1);
  assert.equal(newRight.startCalls.length, 1);
  assert.equal(newLeft.stopCalls.length, 0);
  assert.equal(noiseSource.stopCalls.length, 0, 'the other voice was not interrupted');
  await t.settle();
  assert.ok(oldLeft.disconnectCount > 0 && oldRight.disconnectCount > 0, 'the replaced preset is released');
  assert.deepEqual(statuses(t.engine), ['binaural-gamma:playing', 'white-noise:playing']);
});

test('noise loops are generated once per colour, reused, and differ between colours', async () => {
  const t = setup({ sampleRate: 8000 });
  await t.engine.selectSound('white-noise');
  await t.engine.selectSound('pink-noise');
  assert.equal(t.ctx.buffersCreated.length, 2);
  const [white, pink] = t.ctx.buffersCreated;
  assert.equal(white.length, 8 * 8000, 'an 8 second loop');
  assert.equal(white.numberOfChannels, 2);
  assert.notDeepEqual(white.channels[0], pink.channels[0], 'pink is not white under another name');
  const pause = t.engine.pauseAll();
  await t.settle();
  await pause;
  await t.engine.playAll();
  assert.equal(t.ctx.buffersCreated.length, 2, 'pausing and resuming reuse the generated buffers');
  assert.equal(t.engine.snapshot().cachedBytes, 2 * white.length * 2 * 4);
  assert.equal(t.ctx.sources.every((s) => s.buffer === white || s.buffer === pink), true);

  // an emptied mix releases them; the next use generates again
  const clear = t.engine.clearAll();
  await t.settle();
  await clear;
  assert.equal(t.engine.snapshot().cachedBytes, 0);
  await t.engine.selectSound('white-noise');
  assert.equal(t.ctx.buffersCreated.length, 3);
});

// ── recordings: loops ──────────────────────────────────────────────────────

test('a continuous recording is crossfaded ONCE and looped natively; a prepared loop is used as decoded', async () => {
  const t = setup({ files: { smooth: { seconds: 2, crossfadeMs: 500 }, prepared: { seconds: 2, crossfadeMs: 0 } } });
  await t.engine.selectSound('smooth');
  const processed = t.ctx.sources[0].buffer;
  assert.equal(processed.length, 2 * SR - Math.round(0.5 * SR), 'shortened by the overlap');
  assert.equal(processed.numberOfChannels, 2);
  assert.equal(processed.sampleRate, SR);
  assert.equal(t.ctx.buffersCreated.length, 1, 'one processed copy');
  // on the ramp the wrapped step is the natural one: the seam is continuous
  const data = processed.channels[0];
  assert.ok(Math.abs((data[0] - data[data.length - 1]) - 1 / (2 * SR)) < 1e-9);

  await t.engine.selectSound('prepared');
  const decoded = t.ctx.sources[1].buffer;
  assert.equal(decoded.length, 2 * SR, 'a prepared loop keeps its full length');
  assert.equal(t.ctx.buffersCreated.length, 1, 'and no copy is made for it');
  for (const source of t.ctx.sources) {
    assert.equal(source.loop, true);
    assert.equal(source.loopStart, 0);
    assert.equal(source.loopEnd, 0, 'the whole buffer loops; nothing is rescheduled');
  }

  // pause/play reuses the processed buffer: not decoded or processed again
  const pause = t.engine.pauseAll();
  await t.settle();
  await pause;
  await t.engine.playAll();
  assert.equal(t.ctx.decodeCalls, 2);
  assert.equal(t.ctx.buffersCreated.length, 1);
});

test('nothing keeps the loops alive: no pending timer, no new source while it plays', async () => {
  const t = setup({ files: { smooth: { seconds: 2, crossfadeMs: 500 } } });
  await t.engine.selectSound('smooth');
  await t.settle(5000);
  t.ctx.advance(30);
  assert.equal(t.timers.pending, 0, 'no timer is armed while a loop plays');
  assert.equal(t.ctx.sources.length, 1, 'the loop is the browser\'s, not rescheduled by the engine');
});

// ── races ──────────────────────────────────────────────────────────────────

test('removing a voice while it decodes can never start it late', async () => {
  for (const stage of ['read', 'decode']) {
    const gate = deferred();
    const t = setup({ files: { 'rain-a': stage === 'read' ? gate : { seconds: 1 } } });
    if (stage === 'decode') {
      const decode = t.contextDecode = deferred();
      const original = FakeContext.prototype.decodeAudioData;
      FakeContext.prototype.decodeAudioData = async function (buffer) { await decode.promise; return original.call(this, buffer); };
      t.restoreDecode = () => { FakeContext.prototype.decodeAudioData = original; };
    }
    try {
      const pending = t.engine.selectSound('rain-a');
      await flush();
      t.engine.removeSound('rain-a');
      if (stage === 'read') gate.resolve(fakeAudioBytes({ frames: SR })); else t.contextDecode.resolve();
      await pending;
      await flush();
      assert.equal(t.ctx.sources.length, 0, `${stage}: no source was started for a removed voice`);
      assert.deepEqual(t.engine.snapshot().voices, []);
    } finally {
      t.restoreDecode?.();
    }
  }
});

test('pausing, clearing or disposing while a load is in flight can never start it late', async () => {
  for (const action of ['pause', 'clear', 'dispose']) {
    const gate = deferred();
    const t = setup({ files: { 'rain-a': gate } });
    const pending = t.engine.selectSound('rain-a');
    await flush();
    const done = action === 'pause' ? t.engine.pauseAll() : action === 'clear' ? t.engine.clearAll() : t.engine.dispose();
    gate.resolve(fakeAudioBytes({ frames: SR }));
    await t.settle();
    await Promise.all([pending, done]);
    await flush();
    assert.equal(t.ctx.sources.length, 0, `${action}: nothing started late`);
    if (action === 'pause') assert.deepEqual(statuses(t.engine), ['rain-a:paused']);
  }
});

test('pause then play during one load makes exactly one read and one source', async () => {
  const gate = deferred();
  const t = setup({ files: { 'rain-a': gate } });
  const first = t.engine.selectSound('rain-a');
  await flush();
  const pause = t.engine.pauseAll();
  const second = t.engine.playAll();
  gate.resolve(fakeAudioBytes({ frames: SR }));
  await Promise.all([first, second, pause]);
  await t.settle();
  assert.equal(t.transport.calls.length, 1, 'the in-flight read is joined, not repeated');
  assert.equal(t.ctx.sources.length, 1);
  assert.deepEqual(statuses(t.engine), ['rain-a:playing']);
});

// ── memory ─────────────────────────────────────────────────────────────────

test('the cache is budgeted in decoded PCM bytes, not in the size of the file', async () => {
  const t = setup({ files: { stereo: { seconds: 1, channels: 2 }, mono: { seconds: 1, channels: 1 } } });
  await t.engine.selectSound('stereo');
  assert.equal(t.engine.snapshot().cachedBytes, SR * 2 * 4);
  await t.engine.selectSound('mono');
  assert.equal(t.engine.snapshot().cachedBytes, SR * 2 * 4 + SR * 1 * 4);
  assert.notEqual(t.engine.snapshot().cachedBytes, t.defs.get('stereo').source.bytes, 'the file size (1000) is not what is counted');
});

test('inactive buffers are evicted first; an active voice is never evicted', async () => {
  const one = SR * 2 * 4;
  const t = setup({
    files: { a: { seconds: 1 }, b: { seconds: 1 }, c: { seconds: 1 } },
    engineOptions: { maxDecodedBytes: Math.round(2.4 * one) },
  });
  await t.engine.selectSound('a');
  await t.engine.selectSound('b');
  assert.equal(t.engine.snapshot().cachedBytes, 2 * one);
  // c does not fit next to two active voices: refused, and a and b keep playing
  await t.engine.selectSound('c');
  const snapshot = t.engine.snapshot();
  assert.deepEqual(snapshot.voices.map((v) => [v.id, v.status, v.error]), [['a', 'playing', null], ['b', 'playing', null], ['c', 'error', 'capacity']]);
  assert.equal(t.ctx.sources.filter((s) => s.stopCalls.length > 0).length, 0, 'no active voice was silenced to make room');
  assert.equal(snapshot.cachedBytes, 2 * one, 'their buffers are still there');

  // free a voice: its buffer becomes inactive, and c can now take its place
  t.engine.removeSound('a');
  await t.settle();
  await t.engine.retrySound('c');
  const after = t.engine.snapshot();
  assert.deepEqual(after.voices.map((v) => [v.id, v.status]), [['b', 'playing'], ['c', 'playing']]);
  assert.equal(after.cachedBytes, 2 * one, 'a was evicted, not b');
});

test('a load that cannot fit is refused BEFORE its bytes are read', async () => {
  const t = setup({
    files: { long: { seconds: 2, crossfadeMs: 500 } },
    engineOptions: { maxDecodedBytes: 1_000_000 },
  });
  await t.engine.selectSound('long');
  assert.deepEqual(t.engine.snapshot().voices.map((v) => [v.status, v.error]), [['error', 'capacity']]);
  assert.deepEqual(t.transport.calls, [], 'nothing was read for a voice that would not fit');
  assert.equal(t.engine.snapshot().playing, false, 'and no false playing indicator');
  assert.equal(t.engine.snapshot().cachedBytes, 0, 'the reservation is released');
});

test('a processed loop counts at its final size once decoding is done', async () => {
  const t = setup({ files: { long: { seconds: 2, crossfadeMs: 500 } } });
  await t.engine.selectSound('long');
  const overlap = Math.round(0.5 * SR);
  assert.equal(t.engine.snapshot().cachedBytes, (2 * SR - overlap) * 2 * 4);
});

test('at most two loads run at once, one request per sound', async () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const gates = Object.fromEntries(ids.map((id) => [id, deferred()]));
  const t = setup({ files: gates });
  const pending = ids.map((id) => t.engine.selectSound(id));
  await flush();
  assert.equal(t.transport.calls.length, 2, 'only two reads have started');
  assert.equal(t.transport.active, 2);
  for (const id of ids) {
    gates[id].resolve(fakeAudioBytes({ frames: SR / 2 }));
    await flush();
  }
  await Promise.all(pending);
  assert.equal(t.transport.maxActive, 2);
  assert.deepEqual(t.transport.calls.slice().sort(), ids);
  assert.equal(statuses(t.engine).every((s) => s.endsWith(':playing')), true);
});

// ── failures ───────────────────────────────────────────────────────────────

test('a failed recording shows its reason on that voice; the others carry on; retry works', async () => {
  const t = setup({
    files: {
      good: { seconds: 1 },
      missing: new Error('Error invoking remote method: Error: drift-audio:missing: The recording is not there.'),
      corrupt: { seconds: 1, bad: true },
    },
  });
  await t.engine.selectSound('good');
  await t.engine.selectSound('missing');
  await t.engine.selectSound('corrupt');
  const snapshot = t.engine.snapshot();
  assert.deepEqual(snapshot.voices.map((v) => [v.id, v.status, v.error]), [
    ['good', 'playing', null], ['missing', 'error', 'missing'], ['corrupt', 'error', 'decode'],
  ]);
  assert.equal(snapshot.playing, true, 'the healthy voice keeps playing');
  assert.equal(t.ctx.sources.length, 1);

  // the file appears: only an explicit retry tries again
  t.bytes.set('missing', fakeAudioBytes({ frames: SR }));
  await t.engine.retrySound('missing');
  assert.deepEqual(statuses(t.engine), ['good:playing', 'missing:playing', 'corrupt:error']);
  await t.engine.retrySound('good');
  assert.equal(t.ctx.sources.length, 2, 'retrying a healthy voice does nothing');
});

test('when every voice fails nothing claims to be playing', async () => {
  const t = setup({ files: { gone: new Error('drift-audio:missing: nope'), bad: { seconds: 1, bad: true } } });
  await t.engine.selectSound('gone');
  await t.engine.selectSound('bad');
  const snapshot = t.engine.snapshot();
  assert.equal(snapshot.playing, false);
  assert.equal(snapshot.loading, false);
  assert.equal(t.ctx.sources.length, 0);
});

test('a context that refuses to start never produces a false "playing"', async () => {
  const t = setup({ sampleRate: 8000 });
  const failing = (context) => Promise.reject(Object.assign(new Error('The play() request was not allowed'), { name: 'NotAllowedError', context }));
  const original = FakeContext.prototype.resume;
  FakeContext.prototype.resume = function () { this.resumeCalls += 1; return failing(this); };
  try {
    await t.engine.selectSound('white-noise');
  } finally {
    FakeContext.prototype.resume = original;
  }
  assert.deepEqual(t.engine.snapshot().voices.map((v) => [v.status, v.error]), [['error', 'unknown']]);
  assert.equal(t.engine.snapshot().playing, false);
  assert.equal(t.ctx.sources.length, 0, 'no source was started on a context that is not running');
  await t.engine.retrySound('white-noise');
  assert.deepEqual(statuses(t.engine), ['white-noise:playing']);
});

test('errors are classified into the reasons the interface has copy for', () => {
  assert.equal(classifyError(new Error('Error invoking remote method \'drift:read-audio\': Error: drift-audio:missing: x')), 'missing');
  assert.equal(classifyError(new Error('drift-audio:corrupt: hash')), 'corrupt');
  assert.equal(classifyError(new Error('drift-audio:too-large: 13 MiB')), 'too-large');
  assert.equal(classifyError(new Error('drift-audio:unavailable: pending review')), 'unavailable');
  assert.equal(classifyError(new DriftEngineError('capacity')), 'capacity');
  assert.equal(classifyError(new DriftEngineError('limit')), 'unavailable');
  assert.equal(classifyError(Object.assign(new Error('Unable to decode audio data'), { name: 'EncodingError' })), 'decode');
  assert.equal(classifyError(new Error('something else')), 'unknown');
  assert.equal(classifyError('a string'), 'unknown');
  assert.equal(classifyError(undefined), 'unknown');
});

// ── lifecycle ──────────────────────────────────────────────────────────────

test('dispose is safe and idempotent, and releases every node, timer and listener', async () => {
  const t = setup({ files: { 'rain-a': { seconds: 1 } } });
  await t.engine.selectSound('rain-a');
  await t.engine.selectSound('binaural-delta');
  const seen = [];
  t.engine.subscribe((snapshot) => seen.push(snapshot));
  t.engine.removeSound('rain-a');
  assert.ok(t.timers.pending > 0, 'a release timer is pending');
  const first = t.engine.dispose();
  const second = t.engine.dispose();
  assert.equal(first, second, 'the same promise: disposing twice is one dispose');
  await first;
  assert.equal(t.ctx.closeCalls, 1);
  assert.equal(t.timers.pending, 0);
  assert.equal(t.ctx.listenerCount(), 0);
  const graphNodes = t.ctx.nodes.filter((node) => node.kind !== 'destination');
  assert.ok(graphNodes.every((node) => node.disconnectCount > 0), 'every node was disconnected');
  const snapshot = t.engine.snapshot();
  assert.equal(snapshot.disposed, true);
  assert.deepEqual(snapshot.voices, []);
  assert.equal(snapshot.cachedBytes, 0);

  const nodesBefore = t.ctx.nodes.length;
  seen.length = 0;
  await t.engine.selectSound('white-noise');
  await t.engine.playAll();
  await t.engine.pauseAll();
  await t.engine.clearAll();
  t.engine.removeSound('binaural-delta');
  t.engine.setMasterVolume(0.5);
  await t.engine.dispose();
  assert.equal(t.ctx.nodes.length, nodesBefore, 'a disposed engine builds nothing');
  assert.equal(t.created, 1, 'and never creates a second context');
  assert.deepEqual(seen, [], 'observers are gone');
});

test('a pause awaited during dispose is released, not left hanging', async () => {
  const t = setup({ files: { 'rain-a': { seconds: 1 } } });
  await t.engine.selectSound('rain-a');
  const pause = t.engine.pauseAll();
  await t.engine.dispose();
  await pause;
});

test('StrictMode shape: a disposed engine never leaks a live one or a closed context', async () => {
  const t = setup({ sampleRate: 8000 });
  // React mounts, unmounts and mounts again: the first engine is disposed unused
  await t.engine.dispose();
  assert.equal(t.created, 0, 'the throw-away engine never created a context');
  const second = new DriftAudioEngine({
    createContext: () => { const context = new FakeContext({ sampleRate: 8000, log: t.log }); t.contexts.push(context); return context; },
    readAudio: t.transport.read,
    resolveSound: (id) => t.defs.get(id),
    setTimer: t.timers.set,
    clearTimer: t.timers.clear,
  });
  await second.selectSound('brown-noise');
  assert.equal(t.created, 1, 'exactly one live engine, one context');
  assert.equal(t.ctx.sources.length, 1, 'one voice for one sound');
  await second.dispose();
  assert.equal(t.ctx.state, 'closed');

  const third = new DriftAudioEngine({
    createContext: () => { const context = new FakeContext({ sampleRate: 8000, log: t.log }); t.contexts.push(context); return context; },
    readAudio: t.transport.read,
    resolveSound: (id) => t.defs.get(id),
    setTimer: t.timers.set,
    clearTimer: t.timers.clear,
  });
  await third.selectSound('brown-noise');
  assert.equal(t.created, 2, 'a new engine gets a NEW context: a closed one is never reused');
  assert.equal(t.contexts[1].state, 'running');
  await third.dispose();
});

test('observers see every change; a throwing observer cannot break playback', async () => {
  const t = setup({ files: { 'rain-a': { seconds: 1 } } });
  const seen = [];
  t.engine.subscribe(() => { throw new Error('a broken observer'); });
  const off = t.engine.subscribe((snapshot) => seen.push(snapshot.voices.map((v) => v.status).join()));
  await t.engine.selectSound('rain-a');
  assert.deepEqual(statuses(t.engine), ['rain-a:playing']);
  assert.ok(seen.includes('loading') && seen.includes('playing'));
  off();
  const count = seen.length;
  t.engine.setSoundVolume('rain-a', 0.5);
  assert.equal(seen.length, count, 'an unsubscribed observer is not called');
});

test('restoring then playing starts the saved mix with its saved levels, in order', async () => {
  const t = setup({ files: { 'rain-a': { seconds: 1 } }, sampleRate: 8000 });
  t.engine.restore({ ids: ['white-noise', 'rain-a'], volumes: { 'white-noise': 0.9, 'rain-a': 0.1 }, master: 0.5 });
  await t.engine.playAll();
  assert.deepEqual(statuses(t.engine), ['white-noise:playing', 'rain-a:playing']);
  const { master, voiceGains } = graph(t.ctx);
  assert.equal(master.gain.value, 0.5);
  assert.deepEqual(voiceGains.map((g) => g.gain.value).sort(), [0.1, 0.9]);
});
