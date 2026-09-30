// PR #998 review regressions: cancelled work must not retain audio, and preparing a
// crossfaded loop must allocate only the final PCM destination beside the decoded source.
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './drift-test-utils.mjs';
import { FakeAudioBuffer, FakeContext, FakeTimers, deferred, fakeAudioBytes, flush, makeTransport } from './drift-audio-fakes.mjs';

const { DriftAudioEngine } = loadTs('src/components/drift/audio/DriftAudioEngine.ts');
const { buildLoopBuffer, crossfadeLoop, pcmBytes } = loadTs('src/components/drift/audio/loopBuffer.ts');
const SR = 8000;
const bytes = (seconds = 1) => fakeAudioBytes({ frames: Math.round(seconds * SR), sampleRate: SR });

function setup(t, { ids = ['rain-a'], files, seconds = 1, crossfadeMs = 0, options = {} } = {}) {
  const definitions = new Map(ids.map((id) => [id, {
    id, nameKey: id, descriptionKey: id, categoryId: 'rain', icon: 'cloudRain',
    source: { kind: 'file', asset: `rain/${id}.mp3`, bytes: 1000, sha256: 'a'.repeat(64), durationSeconds: seconds, loop: true, crossfadeMs },
    provenance: { licenseStatus: 'verified', licenseId: 'LicenseRef-test', evidenceRefs: ['test'], distributionReview: 'approved', reviewRef: 'test' },
  }]));
  const timers = new FakeTimers();
  const context = new FakeContext({ sampleRate: SR });
  const transport = makeTransport(files ?? new Map(ids.map((id) => [id, bytes(seconds)])));
  const engine = new DriftAudioEngine({
    createContext: () => context,
    readAudio: transport.read,
    resolveSound: (id) => definitions.get(id),
    setTimer: timers.set,
    clearTimer: timers.clear,
    ...options,
  });
  t.after(() => engine.dispose());
  return { engine, context, transport, timers, settle: async () => { timers.advance(200); await flush(); } };
}

for (const action of ['clear', 'remove']) {
  test(`${action} during a read discards its bytes without decoding or caching`, async (t) => {
    const gate = deferred();
    const s = setup(t, { files: new Map([['rain-a', gate]]) });
    const pending = s.engine.selectSound('rain-a');
    await flush();
    assert.deepEqual(s.transport.calls, ['rain-a']);
    const stopped = action === 'clear' ? s.engine.clearAll() : s.engine.removeSound('rain-a');
    await s.settle();
    await stopped;
    gate.resolve(bytes());
    await pending;
    assert.equal(s.context.decodeCalls, 0, 'a discarded read must not start a decoder');
    assert.deepEqual(s.engine.snapshot().voices, []);
    assert.equal(s.engine.snapshot().cachedBytes, 0);
    assert.equal(s.context.sources.length, 0);
    assert.equal(s.context.state, 'suspended');
  });
}

test('Clear during decode discards the result before allocating a crossfade or caching it', async (t) => {
  const s = setup(t, { seconds: 2, crossfadeMs: 250 });
  const gate = deferred();
  const decode = s.context.decodeAudioData.bind(s.context);
  let decoding = false;
  s.context.decodeAudioData = async (data) => {
    const result = await decode(data);
    decoding = true;
    await gate.promise;
    return result;
  };
  const pending = s.engine.selectSound('rain-a');
  await flush();
  assert.equal(decoding, true);
  const cleared = s.engine.clearAll();
  await s.settle();
  await cleared;
  gate.resolve();
  await pending;
  assert.equal(s.context.buffersCreated.length, 0, 'no processed destination is allocated for a removed voice');
  assert.equal(s.engine.snapshot().cachedBytes, 0);
  assert.deepEqual(s.engine.snapshot().voices, []);
  assert.equal(s.context.sources.length, 0);
});

test('Clear before the catalogue resolves creates no read, decoder or cached buffer', async (t) => {
  const ready = deferred();
  const s = setup(t, { options: { ready: () => ready.promise } });
  const pending = s.engine.selectSound('rain-a');
  await flush();
  const cleared = s.engine.clearAll();
  await s.settle();
  await cleared;
  ready.resolve();
  await pending;
  assert.deepEqual(s.transport.calls, []);
  assert.equal(s.context.decodeCalls, 0);
  assert.equal(s.engine.snapshot().cachedBytes, 0);
});

test('Clear discards queued reads as well as the in-flight read', async (t) => {
  const gate = deferred();
  const ids = ['rain-a', 'rain-b', 'rain-c'];
  const s = setup(t, { ids, files: new Map([['rain-a', gate], ['rain-b', bytes()], ['rain-c', bytes()]]), options: { maxConcurrentLoads: 1 } });
  const pending = ids.map((id) => s.engine.selectSound(id));
  await flush();
  assert.deepEqual(s.transport.calls, ['rain-a']);
  const cleared = s.engine.clearAll();
  await s.settle();
  await cleared;
  gate.resolve(bytes());
  await Promise.all(pending);
  assert.deepEqual(s.transport.calls, ['rain-a'], 'queued sounds are not read after Clear');
  assert.equal(s.context.decodeCalls, 0);
  assert.equal(s.engine.snapshot().cachedBytes, 0);
});

test('Dispose settles queued requests rather than abandoning their promises', { timeout: 2000 }, async (t) => {
  const gate = deferred();
  const ids = ['rain-a', 'rain-b', 'rain-c'];
  const s = setup(t, { ids, files: new Map([['rain-a', gate], ['rain-b', bytes()], ['rain-c', bytes()]]), options: { maxConcurrentLoads: 1 } });
  const pending = ids.map((id) => s.engine.selectSound(id));
  await flush();
  await s.engine.dispose();
  gate.resolve(bytes());
  // Keep a real timer alive so the pre-fix abandoned promise fails this test, rather
  // than cancelling the entire file when the fake scheduler leaves Node idle.
  let deadline;
  try {
    await Promise.race([
      Promise.all(pending),
      new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('queued request was never settled')), 1000); }),
    ]);
  } finally {
    clearTimeout(deadline);
  }
  assert.deepEqual(s.transport.calls, ['rain-a']);
  assert.equal(s.engine.snapshot().cachedBytes, 0);
  assert.equal(s.context.state, 'closed');
});

test('removing a queued sound and selecting it again immediately starts exactly one replacement', async (t) => {
  const gate = deferred();
  const s = setup(t, { ids: ['rain-a', 'rain-b'], files: new Map([['rain-a', gate], ['rain-b', bytes()]]), options: { maxConcurrentLoads: 1 } });
  const a = s.engine.selectSound('rain-a');
  const oldB = s.engine.selectSound('rain-b');
  await flush();
  s.engine.removeSound('rain-b');
  const newB = s.engine.selectSound('rain-b');
  gate.resolve(bytes());
  await Promise.all([a, oldB, newB]);
  assert.deepEqual(s.transport.calls, ['rain-a', 'rain-b']);
  assert.deepEqual(s.engine.snapshot().voices.map((v) => [v.id, v.status]), [['rain-a', 'playing'], ['rain-b', 'playing']]);
  assert.equal(s.context.sources.length, 2);
});

test('removing and reselecting an in-flight sound still shares the useful read', async (t) => {
  const gate = deferred();
  const s = setup(t, { files: new Map([['rain-a', gate]]) });
  const first = s.engine.selectSound('rain-a');
  await flush();
  s.engine.removeSound('rain-a');
  const second = s.engine.selectSound('rain-a');
  gate.resolve(bytes());
  await Promise.all([first, second]);
  assert.deepEqual(s.transport.calls, ['rain-a']);
  assert.equal(s.context.sources.length, 1);
  assert.equal(s.engine.snapshot().playing, true);
});

test('Pause remains a consumer: a pending read is cached for a single-read resume', async (t) => {
  const gate = deferred();
  const s = setup(t, { files: new Map([['rain-a', gate]]) });
  const pending = s.engine.selectSound('rain-a');
  await flush();
  const paused = s.engine.pauseAll();
  await s.settle();
  await paused;
  gate.resolve(bytes());
  await pending;
  assert.equal(s.context.sources.length, 0);
  assert.equal(s.engine.snapshot().cachedBytes, SR * 2 * 4);
  await s.engine.playAll();
  assert.deepEqual(s.transport.calls, ['rain-a']);
  assert.equal(s.context.sources.length, 1);
  assert.equal(s.engine.snapshot().playing, true);
});

test('removing an in-flight voice does not retain its result or disturb another voice', async (t) => {
  const gate = deferred();
  const s = setup(t, { ids: ['rain-a', 'rain-b'], files: new Map([['rain-a', bytes()], ['rain-b', gate]]) });
  await s.engine.selectSound('rain-a');
  const a = s.context.sources[0];
  const pending = s.engine.selectSound('rain-b');
  await flush();
  s.engine.removeSound('rain-b');
  gate.resolve(bytes());
  await pending;
  assert.equal(s.engine.snapshot().cachedBytes, SR * 2 * 4);
  assert.equal(s.context.decodeCalls, 1);
  assert.deepEqual(a.stopCalls, []);
  assert.equal(s.engine.snapshot().playing, true);
});

for (const curve of ['linear', 'equal-power']) {
  test(`crossfade ${curve} writes directly into the final buffer without another PCM allocation`, () => {
    const input = new FakeAudioBuffer(2, 4 * SR, SR);
    input.channels.forEach((data, channel) => { for (let i = 0; i < data.length; i++) data[i] = Math.sin(i / (17 + channel * 7)); });
    const original = input.channels.map((channel) => channel.slice());
    const expected = crossfadeLoop(original, SR / 4, curve);
    const Float32 = globalThis.Float32Array;
    let allocated = 0;
    // Count storage, not subarray views. The destination itself is allocated by the fake
    // factory through the same constructor; the decoded input already exists.
    globalThis.Float32Array = new Proxy(Float32, {
      construct(target, args) {
        const result = Reflect.construct(target, args);
        if (!(args[0] instanceof ArrayBuffer)) allocated += result.byteLength;
        return result;
      },
    });
    let output;
    try {
      const context = new FakeContext({ sampleRate: SR });
      output = buildLoopBuffer(context, input, 250, curve);
      assert.equal(context.buffersCreated.length, 1);
    } finally {
      globalThis.Float32Array = Float32;
    }
    assert.equal(allocated, pcmBytes(output), 'only the final AudioBuffer channels allocate PCM storage');
    assert.deepEqual(output.channels, expected);
    assert.deepEqual(input.channels, original, 'the source is never modified');
  });
}

test('crossfade checks its actual peak before allocating the final AudioBuffer', async (t) => {
  const s = setup(t, {
    seconds: 1, crossfadeMs: 250,
    // The estimate fits, but this deliberately longer decoded fixture does not.
    files: new Map([['rain-a', bytes(1.5)]]),
    options: { maxDecodedBytes: Math.round(SR * 2 * 4 * 2.1) },
  });
  await s.engine.selectSound('rain-a');
  assert.equal(s.context.decodeCalls, 1);
  assert.equal(s.context.buffersCreated.length, 0, 'the budget is checked before createBuffer');
  assert.equal(s.engine.snapshot().cachedBytes, 0);
  assert.equal(s.engine.snapshot().voices[0].error, 'capacity');
});
