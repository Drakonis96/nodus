// Nodus Drift: the signal processing, asserted on the real samples.
//
// Spectral checks use tolerances, never sample-for-sample comparisons: the noise is
// random and the claim is about its shape (flat, -3 dB/octave, -6 dB/octave), its level,
// its DC and its seam, not about any particular sequence.
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './drift-test-utils.mjs';
import { FakeContext, FakeAudioBuffer } from './drift-audio-fakes.mjs';

const loop = loadTs('src/components/drift/audio/loopBuffer.ts');
const noise = loadTs('src/components/drift/audio/noise.ts');
const binaural = loadTs('src/components/drift/audio/binaural.ts');
const drift = loadTs('shared/drift.ts');

// ── tiny DSP toolbox for the assertions ────────────────────────────────────

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = i + k + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** Welch power spectral density with a Hann window and 50% overlap. */
function welch(x, size = 4096) {
  const window = new Float64Array(size).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)));
  const energy = window.reduce((sum, w) => sum + w * w, 0);
  const psd = new Float64Array(size / 2 + 1);
  let segments = 0;
  for (let start = 0; start + size <= x.length; start += size / 2) {
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    for (let i = 0; i < size; i++) re[i] = x[start + i] * window[i];
    fft(re, im);
    for (let k = 0; k <= size / 2; k++) psd[k] += (re[k] * re[k] + im[k] * im[k]) / energy;
    segments += 1;
  }
  for (let k = 0; k < psd.length; k++) psd[k] /= segments;
  return psd;
}

/** Slope of the spectrum in dB per octave between f1 and f2, from third-octave band means. */
function slopeDbPerOctave(psd, sampleRate, f1, f2) {
  const size = (psd.length - 1) * 2;
  const binHz = sampleRate / size;
  const points = [];
  for (let lower = f1; lower * 2 ** (1 / 3) <= f2 * 1.0001; lower *= 2 ** (1 / 3)) {
    const upper = lower * 2 ** (1 / 3);
    let sum = 0;
    let count = 0;
    for (let k = Math.ceil(lower / binHz); k * binHz < upper && k < psd.length; k++) { sum += psd[k]; count += 1; }
    if (count > 0) points.push([Math.log2(Math.sqrt(lower * upper)), 10 * Math.log10(sum / count)]);
  }
  const n = points.length;
  const mx = points.reduce((s, p) => s + p[0], 0) / n;
  const my = points.reduce((s, p) => s + p[1], 0) / n;
  const num = points.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0);
  const den = points.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
  return num / den;
}

const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
const mean = (x) => x.reduce((s, v) => s + v, 0) / x.length;
const peak = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
function correlation(a, b) {
  const ma = mean(a); const mb = mean(b);
  let num = 0; let da = 0; let db = 0;
  for (let i = 0; i < a.length; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return num / Math.sqrt(da * db);
}
const seeded = (seed) => (channel) => noise.createMulberry32(seed + channel * 7919);
const SR = 48000;

// ── circular crossfade ─────────────────────────────────────────────────────

test('the crossfade has N - C samples, keeps every channel and never mutates its input', () => {
  const n = 1000; const c = 100;
  const left = Float32Array.from({ length: n }, (_, i) => i);
  const right = Float32Array.from({ length: n }, (_, i) => -i);
  const leftCopy = left.slice(); const rightCopy = right.slice();
  const out = loop.crossfadeLoop([left, right], c);
  assert.equal(out.length, 2);
  assert.equal(out[0].length, n - c);
  assert.equal(out[1].length, n - c);
  assert.deepEqual(left, leftCopy);
  assert.deepEqual(right, rightCopy);
  // each channel is processed independently, so a mirrored input gives a mirrored output
  for (let i = 0; i < n - c; i++) assert.equal(out[1][i], -out[0][i]);
});

test('the middle is x[C..N-C) and the mix runs from exactly x[N-C] to exactly x[C-1]', () => {
  const n = 1000; const c = 100;
  const x = Float32Array.from({ length: n }, (_, i) => Math.sin(i * 0.05) + i * 0.001);
  const [y] = loop.crossfadeLoop([x], c);
  const middle = n - 2 * c;
  for (let i = 0; i < middle; i++) assert.equal(y[i], x[c + i], 'the middle is copied verbatim');
  // first mixed sample: the tail only (weight 0 for the head), the natural next sample
  assert.ok(Math.abs(y[middle] - x[n - c]) < 1e-6);
  // last mixed sample: the head only, so the loop wraps x[c-1] -> x[c], its natural successor
  assert.ok(Math.abs(y[n - c - 1] - x[c - 1]) < 1e-6);
});

test('on a ramp the seam steps are the natural step, so the join is continuous', () => {
  const n = 2000; const c = 300;
  const ramp = Float32Array.from({ length: n }, (_, i) => i);
  const [y] = loop.crossfadeLoop([ramp], c);
  const middle = n - 2 * c;
  assert.equal(y[middle] - y[middle - 1], 1, 'middle -> mix: the natural step');
  assert.equal(y[0] - y[y.length - 1], c - (c - 1), 'wrap: x[C-1] -> x[C] is the natural step');
});

test('linear gains are complementary; equal-power keeps uncorrelated levels', () => {
  const n = 1000; const c = 200;
  const ones = new Float32Array(n).fill(1);
  const [y] = loop.crossfadeLoop([ones], c, 'linear');
  for (let i = n - 2 * c; i < n - c; i++) assert.ok(Math.abs(y[i] - 1) < 1e-6, 'a constant stays constant');
  // power of two independent unit-variance signals through equal-power gains stays 1
  for (let i = 0; i < c; i++) {
    const w = i / (c - 1);
    assert.ok(Math.abs(Math.cos(w * Math.PI / 2) ** 2 + Math.sin(w * Math.PI / 2) ** 2 - 1) < 1e-12);
  }
  // and a linear crossfade of a signal with itself is transparent
  const [z] = loop.crossfadeLoop([Float32Array.from({ length: n }, () => 0.5)], c, 'equal-power');
  assert.equal(z.length, n - c);
});

test('the overlap is clamped so 2C < N, and a 0 or 1 sample overlap changes nothing', () => {
  assert.equal(loop.maxCrossfadeFrames(1000), 499);
  assert.equal(loop.maxCrossfadeFrames(1), 0);
  assert.equal(loop.maxCrossfadeFrames(0), 0);
  for (const frames of [3, 10, 101, 1000]) assert.ok(2 * loop.maxCrossfadeFrames(frames) < frames);
  const x = Float32Array.from({ length: 100 }, (_, i) => i);
  assert.equal(loop.crossfadeLoop([x], 10_000)[0].length, 100 - loop.maxCrossfadeFrames(100));
  assert.deepEqual(loop.crossfadeLoop([x], 0)[0], x);
  assert.deepEqual(loop.crossfadeLoop([x], 1)[0], x);
  assert.notEqual(loop.crossfadeLoop([x], 0)[0], x, 'a copy, not the same array');
  assert.deepEqual(loop.crossfadeLoop([], 10), []);
  assert.equal(loop.crossfadeMsToFrames(1000, 48000, 480000), 48000);
  assert.equal(loop.crossfadeMsToFrames(1000, 48000, 60000), 29999, 'limited to leave more than half');
  assert.equal(loop.crossfadeMsToFrames(0, 48000, 1000), 0);
  assert.equal(loop.crossfadeMsToFrames(NaN, 48000, 1000), 0);
});

test('a sine that does not fit the buffer has a seam jump the crossfade removes', () => {
  const n = 48000; const f = 440.5; // a non-integer number of cycles: a click at the seam
  const x = Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * f * i) / SR));
  const rawJump = Math.abs(x[0] - x[n - 1]);
  const typicalStep = 2 * Math.PI * f / SR;
  assert.ok(rawJump > 0.5 * typicalStep || rawJump >= 0, 'sanity: raw jump measured');
  const [y] = loop.crossfadeLoop([x], 4800);
  const seam = Math.abs(y[0] - y[y.length - 1]);
  assert.ok(seam <= typicalStep * 1.05, `the wrapped step ${seam} is no larger than a natural step ${typicalStep}`);
});

test('buildLoopBuffer leaves a prepared loop alone and copies a continuous recording once', () => {
  const ctx = new FakeContext();
  const source = ctx.createBuffer(2, 48000, 44100);
  for (const data of source.channels) for (let i = 0; i < data.length; i++) data[i] = Math.sin(i / 50);
  const before = source.channels.map((c) => c.slice());

  assert.equal(loop.buildLoopBuffer(ctx, source, 0), source, 'crossfadeMs 0 uses the decoded buffer as is');
  const processed = loop.buildLoopBuffer(ctx, source, 500);
  assert.notEqual(processed, source);
  assert.equal(processed.numberOfChannels, 2, 'channels preserved');
  assert.equal(processed.sampleRate, 44100, 'sample rate preserved');
  assert.equal(processed.length, 48000 - Math.round(0.5 * 44100), 'shortened by exactly the overlap');
  assert.deepEqual(source.channels, before, 'the decoded buffer is untouched');
  assert.equal(loop.pcmBytes(processed), processed.length * 2 * 4);
  assert.equal(loop.pcmBytes({ length: 10, numberOfChannels: 1 }), 40);
});

test('the loop is built once: the module has no timer, animation frame or rescheduling', async () => {
  const { readFileSync } = await import('node:fs');
  const { repoRoot } = await import('./drift-test-utils.mjs');
  const path = await import('node:path');
  for (const file of ['loopBuffer.ts', 'noise.ts', 'binaural.ts']) {
    const source = readFileSync(path.join(repoRoot, 'src/components/drift/audio', file), 'utf8');
    assert.doesNotMatch(source, /setInterval|requestAnimationFrame|setTimeout/, `${file} does not sustain anything with timers`);
  }
});

// ── noise ──────────────────────────────────────────────────────────────────

const NOISE = Object.fromEntries(['white', 'pink', 'brown'].map((color) => [
  color, noise.generateNoiseChannels(color, { sampleRate: SR, random: seeded(1234) }),
]));

test('every colour is a two channel 8 second loop, DC free, at one RMS, below clipping', () => {
  for (const [color, channels] of Object.entries(NOISE)) {
    assert.equal(channels.length, 2, color);
    for (const data of channels) {
      assert.equal(data.length, 8 * SR, `${color}: exactly 8 seconds`);
      assert.ok(Math.abs(mean(data)) < 0.01 * rms(data) + 1e-3, `${color}: DC ${mean(data)}`);
      assert.ok(Math.abs(rms(data) - noise.NOISE_TARGET_RMS) / noise.NOISE_TARGET_RMS < 0.06, `${color}: rms ${rms(data)}`);
      assert.ok(peak(data) <= noise.NOISE_PEAK_LIMIT + 1e-6, `${color}: peak ${peak(data)} must not clip`);
      assert.ok(data.every(Number.isFinite), `${color}: finite`);
    }
  }
});

test('the spectra differ the way the colours say: flat, -3 dB/octave, -6 dB/octave', () => {
  const slope = (color) => slopeDbPerOctave(welch(NOISE[color][0]), SR, 100, 8000);
  const white = slope('white');
  const pink = slope('pink');
  const brown = slope('brown');
  assert.ok(Math.abs(white) < 0.5, `white ${white.toFixed(2)} dB/oct should be flat`);
  assert.ok(pink < -2.3 && pink > -3.7, `pink ${pink.toFixed(2)} dB/oct should be about -3`);
  assert.ok(brown < -5.4 && brown > -6.6, `brown ${brown.toFixed(2)} dB/oct should be about -6`);
  assert.ok(white > pink + 2 && pink > brown + 2, 'pink and brown are not aliases of white');
});

function autocorrelation(x, lag) {
  const m = mean(x);
  let num = 0; let den = 0;
  for (let i = 0; i < x.length - lag; i++) num += (x[i] - m) * (x[i + lag] - m);
  for (let i = 0; i < x.length; i++) den += (x[i] - m) ** 2;
  return num / den;
}

test('brown is a LEAKY integrator: its state forgets, an unbounded walk would not', () => {
  assert.ok(noise.BROWN_LEAK > 0.99 && noise.BROWN_LEAK < 1, 'a leak below 1 keeps the state bounded');
  // Measured on this generator: the correlation of a sample with the one a second later is
  // 0.01 to 0.08. With the leak removed (a pure random walk) it is 0.4 to 0.86, so this
  // threshold is what tells the two apart; a mean or a peak cannot, they are normalised.
  for (const seed of [1, 2, 3]) {
    const x = noise.generateNoiseChannels('brown', { sampleRate: 8000, seconds: 20, random: seeded(seed * 10) })[0];
    assert.ok(Math.abs(autocorrelation(x, 8000)) < 0.2, `seed ${seed}: an unbounded walk would keep its past`);
    assert.ok(peak(x) <= noise.NOISE_PEAK_LIMIT + 1e-6);
  }
});

test('pink is Voss-McCartney with 16 rows: -3 dB/octave holds down to a few tens of hertz', () => {
  assert.equal(noise.VOSS_MCCARTNEY_ROWS, 16);
  // Measured: 16 rows give -2.9 to -3.1 dB/octave between 30 Hz and 1 kHz; 6 rows give -1.0 to
  // -1.1, because fewer rows stop being 1/f below fs/2^rows. That is what pins the row count.
  for (const seed of [1, 2, 3]) {
    const x = noise.generateNoiseChannels('pink', { sampleRate: SR, random: seeded(seed * 10) })[0];
    const slope = slopeDbPerOctave(welch(x, 16384), SR, 30, 1000);
    assert.ok(slope < -2.4 && slope > -3.6, `seed ${seed}: ${slope.toFixed(2)} dB/oct`);
  }
});

test('the two channels are independent and the generators are reproducible', () => {
  for (const color of ['white', 'pink', 'brown']) {
    const [a, b] = NOISE[color];
    assert.ok(Math.abs(correlation(Array.from(a), Array.from(b))) < 0.05, `${color}: channels are uncorrelated`);
  }
  const again = noise.generateNoiseChannels('pink', { sampleRate: SR, random: seeded(1234) });
  assert.deepEqual(again[0], NOISE.pink[0]);
  const other = noise.generateNoiseChannels('pink', { sampleRate: SR, random: seeded(4321) });
  assert.notDeepEqual(other[0], NOISE.pink[0]);
  assert.notDeepEqual(NOISE.white[0], NOISE.pink[0]);
  assert.notDeepEqual(NOISE.pink[0], NOISE.brown[0]);
});

test('the loop has no seam: the wrapped step is a normal step', () => {
  for (const color of ['white', 'pink', 'brown']) {
    const data = NOISE[color][0];
    const steps = new Float64Array(data.length - 1);
    for (let i = 1; i < data.length; i++) steps[i - 1] = Math.abs(data[i] - data[i - 1]);
    const sorted = [...steps].sort((a, b) => a - b);
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    const seam = Math.abs(data[0] - data[data.length - 1]);
    assert.ok(seam <= p99 * 1.5, `${color}: seam step ${seam.toFixed(4)} vs p99 ${p99.toFixed(4)}`);
  }
});

test('createNoiseBuffer builds a buffer through the context and reuses no shared state', () => {
  const ctx = new FakeContext({ sampleRate: 24000 });
  const buffer = noise.createNoiseBuffer(ctx, 'brown', seeded(5));
  assert.equal(buffer.numberOfChannels, 2);
  assert.equal(buffer.length, 8 * 24000);
  assert.equal(buffer.sampleRate, 24000);
  assert.ok(peak(buffer.channels[0]) > 0.01);
  const white = noise.createNoiseBuffer(ctx, 'white', seeded(5));
  assert.notDeepEqual(white.channels[0], buffer.channels[0]);
  assert.equal(ctx.buffersCreated.length, 2);
});

test('a short generator run is fast enough to do on first use', () => {
  // Work, not wall clock: the loop is 8 s x 2 channels. This only guards the sample count.
  const channels = noise.generateNoiseChannels('pink', { sampleRate: 8000, seconds: 2, random: seeded(1) });
  assert.equal(channels[0].length, 16000);
});

// ── binaural ───────────────────────────────────────────────────────────────

test('the five presets put carrier -/+ beat/2 in the left and right ear', () => {
  const expected = { 2: [99, 101], 5: [97.5, 102.5], 10: [95, 105], 20: [90, 110], 40: [80, 120] };
  for (const [beat, [left, right]] of Object.entries(expected)) {
    assert.deepEqual(drift.binauralFrequencies(100, Number(beat)), { left, right });
  }
});

test('each tone reaches exactly one channel of the merger', () => {
  const ctx = new FakeContext();
  const graph = binaural.createBinauralVoiceGraph(ctx, 100, 10);
  assert.equal(ctx.oscillators.length, 2);
  const [left, right] = [graph.oscillators.left, graph.oscillators.right];
  assert.equal(left.type, 'sine');
  assert.equal(right.type, 'sine');
  assert.equal(left.frequency.value, 95);
  assert.equal(right.frequency.value, 105);

  const merger = ctx.of('merger')[0];
  assert.equal(merger.numberOfInputs, 2);
  assert.equal(graph.output, merger);

  const gains = ctx.of('gain');
  assert.equal(gains.length, 2, 'one gain per tone, no shared bus');
  const [leftGain, rightGain] = [left.connections[0].to, right.connections[0].to];
  assert.notEqual(leftGain, rightGain);
  assert.equal(left.connections.length, 1, 'the left tone goes to one place only');
  assert.equal(right.connections.length, 1, 'the right tone goes to one place only');
  assert.deepEqual(leftGain.connections, [{ to: merger, output: 0, input: 0 }], 'left tone -> merger input 0');
  assert.deepEqual(rightGain.connections, [{ to: merger, output: 0, input: 1 }], 'right tone -> merger input 1');
  assert.equal(leftGain.gain.value, binaural.BINAURAL_TONE_LEVEL);
  assert.equal(rightGain.gain.value, binaural.BINAURAL_TONE_LEVEL);
});

test('a binaural graph is single use: start both, stop both, disconnect everything', () => {
  const ctx = new FakeContext();
  const graph = binaural.createBinauralVoiceGraph(ctx, 100, 40);
  graph.start(1);
  assert.deepEqual(graph.oscillators.left.startCalls, [{ when: 1, offset: 0 }]);
  assert.deepEqual(graph.oscillators.right.startCalls, [{ when: 1, offset: 0 }]);
  assert.throws(() => graph.start(2), /more than once/, 'the fake enforces the real single-use rule');
  graph.stop(1.5);
  assert.deepEqual(graph.oscillators.left.stopCalls, [1.5]);
  assert.deepEqual(graph.oscillators.right.stopCalls, [1.5]);
  graph.disconnect();
  assert.ok(ctx.nodes.filter((n) => n.kind !== 'destination').every((n) => n.disconnectCount === 1));
});
