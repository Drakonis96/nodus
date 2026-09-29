/**
 * Seamless loops for continuous recordings.
 *
 * A recording that was not cut as a loop jumps when its last sample meets its first.
 * The fix is a circular crossfade, done ONCE on a copy of the decoded buffer: the tail
 * is blended into the head, the buffer is shortened by the overlap, and playback then
 * uses the native `loop = true`. Nothing is rescheduled per cycle, so no timer or
 * animation frame sustains the loop, and the file on disk is never touched.
 *
 * For N samples and an overlap C (2C < N) the output has N - C samples:
 *
 *     out = x[C .. N-C)                      the middle, N - 2C samples
 *           ++ mix(x[N-C .. N), x[0 .. C))   C samples, tail fading out, head fading in
 *
 * The weights run from exactly 0 to exactly 1 across the mix, so the sample after the
 * middle is the natural continuation x[N-C] and the last mixed sample is x[C-1]. The
 * loop then wraps to x[C], which is x[C-1]'s natural continuation: there is no jump and
 * no fade to zero on every repetition.
 */

export type CrossfadeCurve = 'linear' | 'equal-power';

/** The largest overlap N frames allow: 2C must stay below N. */
export function maxCrossfadeFrames(frames: number): number {
  return Math.max(0, Math.floor((frames - 1) / 2));
}

/** Convert a configured overlap to frames, clamped so the recording keeps most of its length. */
export function crossfadeMsToFrames(ms: number, sampleRate: number, frames: number): number {
  if (!Number.isFinite(ms) || ms <= 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) return 0;
  return Math.max(0, Math.min(Math.round((ms * sampleRate) / 1000), maxCrossfadeFrames(frames)));
}

/**
 * Circular crossfade of every channel. Returns NEW arrays of `N - overlap` samples and
 * never mutates the input. Channels are processed independently and keep their order.
 *
 * `linear` uses complementary gains (g, 1 - g), which is right for correlated material
 * such as a recording. `equal-power` (cos, sin) keeps the level of two UNCORRELATED
 * signals constant, which is what a noise loop needs.
 */
export function crossfadeLoop(channels: readonly Float32Array[], overlap: number, curve: CrossfadeCurve = 'linear'): Float32Array[] {
  if (channels.length === 0) return [];
  const frames = channels[0].length;
  const c = Math.min(Math.max(0, Math.floor(overlap)), maxCrossfadeFrames(frames));
  // An overlap of 0 or 1 sample is no crossfade at all.
  if (c < 2) return channels.map((channel) => channel.slice());

  const length = frames - c;
  const middle = frames - 2 * c;
  const out = channels.map(() => new Float32Array(length));

  // Precompute the gains once: they are identical for every channel.
  const fadeOut = new Float32Array(c);
  const fadeIn = new Float32Array(c);
  for (let i = 0; i < c; i++) {
    const w = i / (c - 1);
    if (curve === 'equal-power') {
      fadeOut[i] = Math.cos((w * Math.PI) / 2);
      fadeIn[i] = Math.sin((w * Math.PI) / 2);
    } else {
      fadeOut[i] = 1 - w;
      fadeIn[i] = w;
    }
  }

  channels.forEach((x, channel) => {
    const y = out[channel];
    y.set(x.subarray(c, frames - c), 0);
    for (let i = 0; i < c; i++) y[middle + i] = x[frames - c + i] * fadeOut[i] + x[i] * fadeIn[i];
  });
  return out;
}

/** The structural part of an AudioBuffer this module needs, so it can be driven by a fake. */
export interface AudioBufferLike {
  readonly length: number;
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  readonly duration: number;
  getChannelData(channel: number): Float32Array;
  copyToChannel(source: Float32Array, channel: number): void;
}

export interface BufferFactory<B extends AudioBufferLike> {
  createBuffer(channels: number, length: number, sampleRate: number): B;
}

/** Decoded PCM size: what the cache is budgeted in (not the size of the MP3). */
export function pcmBytes(buffer: Pick<AudioBufferLike, 'length' | 'numberOfChannels'>): number {
  return buffer.length * buffer.numberOfChannels * 4;
}

/**
 * The buffer to loop. With no crossfade (a prepared loop) the decoded buffer itself is
 * returned untouched; otherwise a processed copy shortened by the overlap.
 */
export function buildLoopBuffer<B extends AudioBufferLike>(
  factory: BufferFactory<B>,
  source: B,
  crossfadeMs: number,
  curve: CrossfadeCurve = 'linear',
): B {
  const overlap = crossfadeMsToFrames(crossfadeMs, source.sampleRate, source.length);
  if (overlap < 2) return source;
  const channels: Float32Array[] = [];
  for (let channel = 0; channel < source.numberOfChannels; channel++) channels.push(source.getChannelData(channel));
  const processed = crossfadeLoop(channels, overlap, curve);
  const buffer = factory.createBuffer(source.numberOfChannels, processed[0].length, source.sampleRate);
  processed.forEach((data, channel) => buffer.copyToChannel(data, channel));
  return buffer;
}
