/**
 * White, pink and brown noise, generated locally at first use.
 *
 * Nothing is bundled: the generators are plain DSP over an injectable random source, so
 * the tests can reproduce them exactly. Each colour has its own algorithm (they are not
 * three names for one signal):
 *
 *  - white: independent uniform samples, centred on zero. A flat spectrum.
 *  - pink: Voss-McCartney with 16 rows. Row k is redrawn every 2^k samples, found from the
 *    trailing zeros of a counter, and a fresh white sample is added to every output sample.
 *    The rows sum to a spectrum that falls about 3 dB per octave. The counter, the rows and
 *    the random stream are separate for every channel, so the two ears are uncorrelated.
 *  - brown: a leaky integrator of white noise, y[n] = a*y[n-1] + w[n] with a < 1. The leak
 *    bounds the state (an integrator without one drifts without limit), the spectrum falls
 *    about 6 dB per octave above the leak's corner, and the mean is subtracted afterwards.
 *
 * All colours are DC-free, scaled to the same RMS and kept below the clip level, then made
 * circular with an equal-power crossfade so the 8-second loop has no seam.
 */
import { NOISE_LOOP_SECONDS, type DriftNoiseColor } from '@shared/drift';
import { crossfadeLoop, type AudioBufferLike, type BufferFactory } from './loopBuffer';

/** A uniform random source in [0, 1). */
export type RandomSource = () => number;

/** Reproducible PRNG (mulberry32) for tests; production uses Math.random. */
export function createMulberry32(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const VOSS_MCCARTNEY_ROWS = 16;
/** Leak of the brown-noise integrator: a corner near 15 Hz at 48 kHz. */
export const BROWN_LEAK = 0.998;
export const NOISE_TARGET_RMS = 0.2;
export const NOISE_PEAK_LIMIT = 0.95;
/** Fraction of a second dropped from the start so the integrators are stationary. */
const WARMUP_SECONDS = 1;
/** Seam crossfade of the loop. */
export const NOISE_CROSSFADE_SECONDS = 0.25;

export interface GenerateNoiseOptions {
  sampleRate: number;
  /** Length of the finished loop. */
  seconds?: number;
  channels?: number;
  /** One independent random stream per channel. */
  random?: (channel: number) => RandomSource;
  targetRms?: number;
  crossfadeSeconds?: number;
}

/** Trailing zero bits of a positive 32-bit integer. */
function trailingZeros(value: number): number {
  return 31 - Math.clz32(value & -value);
}

function whiteChannel(frames: number, random: RandomSource): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) out[i] = random() * 2 - 1;
  return out;
}

function pinkChannel(frames: number, random: RandomSource): Float32Array {
  const rows = new Float64Array(VOSS_MCCARTNEY_ROWS);
  let sum = 0;
  for (let k = 0; k < VOSS_MCCARTNEY_ROWS; k++) {
    rows[k] = random() * 2 - 1;
    sum += rows[k];
  }
  // A random starting count keeps the two channels' row updates out of step.
  let counter = (Math.floor(random() * 0x10000) | 1) >>> 0;
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    counter = (counter + 1) >>> 0;
    if (counter === 0) counter = 1;
    const k = trailingZeros(counter);
    if (k < VOSS_MCCARTNEY_ROWS) {
      sum -= rows[k];
      rows[k] = random() * 2 - 1;
      sum += rows[k];
    }
    out[i] = (sum + (random() * 2 - 1)) / (VOSS_MCCARTNEY_ROWS + 1);
  }
  return out;
}

function brownChannel(frames: number, random: RandomSource): Float32Array {
  const out = new Float32Array(frames);
  let state = 0;
  for (let i = 0; i < frames; i++) {
    state = BROWN_LEAK * state + (random() * 2 - 1);
    out[i] = state;
  }
  return out;
}

const GENERATORS: Record<DriftNoiseColor, (frames: number, random: RandomSource) => Float32Array> = {
  white: whiteChannel,
  pink: pinkChannel,
  brown: brownChannel,
};

/** Subtract the mean and scale to the target RMS without exceeding the peak limit. */
function conditionChannel(data: Float32Array, targetRms: number): void {
  let mean = 0;
  for (let i = 0; i < data.length; i++) mean += data[i];
  mean /= data.length;
  let energy = 0;
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i] - mean;
    data[i] = v;
    energy += v * v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  const rms = Math.sqrt(energy / data.length);
  if (rms === 0 || peak === 0) return;
  const scale = Math.min(targetRms / rms, NOISE_PEAK_LIMIT / peak);
  for (let i = 0; i < data.length; i++) data[i] *= scale;
}

/**
 * The samples of one noise loop: `channels` arrays of `seconds * sampleRate` frames.
 * Pure: the same options and random streams give the same samples.
 */
export function generateNoiseChannels(color: DriftNoiseColor, options: GenerateNoiseOptions): Float32Array[] {
  const sampleRate = options.sampleRate;
  const seconds = options.seconds ?? NOISE_LOOP_SECONDS;
  const channelCount = options.channels ?? 2;
  const random = options.random ?? (() => Math.random);
  const targetRms = options.targetRms ?? NOISE_TARGET_RMS;
  const frames = Math.round(seconds * sampleRate);
  const overlap = Math.min(Math.round((options.crossfadeSeconds ?? NOISE_CROSSFADE_SECONDS) * sampleRate), Math.floor((frames - 1) / 2));
  const warmup = Math.round(WARMUP_SECONDS * sampleRate);
  const generate = GENERATORS[color];

  const channels: Float32Array[] = [];
  for (let channel = 0; channel < channelCount; channel++) {
    const raw = generate(warmup + frames + overlap, random(channel));
    const kept = raw.slice(warmup);
    conditionChannel(kept, targetRms);
    channels.push(kept);
  }
  // frames + overlap in, frames out: the crossfade shortens the buffer by exactly the overlap.
  return crossfadeLoop(channels, overlap, 'equal-power');
}

/** Build the AudioBuffer of a noise loop through whatever creates buffers (a context or a fake). */
export function createNoiseBuffer<B extends AudioBufferLike>(
  factory: BufferFactory<B> & { sampleRate: number },
  color: DriftNoiseColor,
  random?: (channel: number) => RandomSource,
): B {
  const channels = generateNoiseChannels(color, { sampleRate: factory.sampleRate, random });
  const buffer = factory.createBuffer(channels.length, channels[0].length, factory.sampleRate);
  channels.forEach((data, channel) => buffer.copyToChannel(data, channel));
  return buffer;
}
