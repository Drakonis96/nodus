/**
 * Binaural presets: two pure sine tones, one per ear.
 *
 * Left and right are `carrier - beat/2` and `carrier + beat/2` (Delta 2 Hz, Theta 5 Hz,
 * Alpha 10 Hz, Beta 20 Hz and Gamma 40 Hz around a 100 Hz carrier). The two tones must
 * stay on separate channels, so each oscillator goes through its own gain into its own
 * input of a two-input channel merger. Mixing both tones into both ears would produce an
 * ordinary amplitude beat, which is a different thing and is not what is being offered.
 */
import { binauralFrequencies } from '@shared/drift';

/** Amplitude of each tone before the voice, master and limiter stages. */
export const BINAURAL_TONE_LEVEL = 0.5;

/** The parts of the Web Audio API a binaural voice touches, so it can be driven by a fake. */
export interface BinauralContextLike {
  createOscillator(): {
    type: string;
    frequency: { value: number };
    connect(destination: unknown, output?: number, input?: number): unknown;
    disconnect(): void;
    start(when?: number): void;
    stop(when?: number): void;
  };
  createGain(): {
    gain: { value: number };
    connect(destination: unknown, output?: number, input?: number): unknown;
    disconnect(): void;
  };
  createChannelMerger(inputs: number): {
    connect(destination: unknown, output?: number, input?: number): unknown;
    disconnect(): void;
  };
}

export interface BinauralVoiceGraph {
  /** Connect this to the voice's envelope. */
  output: { connect(destination: unknown): unknown; disconnect(): void };
  frequencies: { left: number; right: number };
  start(when: number): void;
  /** Schedule both tones to stop. The graph is single use: build a new one to play again. */
  stop(when: number): void;
  disconnect(): void;
  /** The oscillators, for inspection. */
  oscillators: { left: ReturnType<BinauralContextLike['createOscillator']>; right: ReturnType<BinauralContextLike['createOscillator']> };
}

export function createBinauralVoiceGraph(context: BinauralContextLike, carrierHz: number, beatHz: number): BinauralVoiceGraph {
  const frequencies = binauralFrequencies(carrierHz, beatHz);
  const left = context.createOscillator();
  const right = context.createOscillator();
  left.type = 'sine';
  right.type = 'sine';
  left.frequency.value = frequencies.left;
  right.frequency.value = frequencies.right;

  const leftGain = context.createGain();
  const rightGain = context.createGain();
  leftGain.gain.value = BINAURAL_TONE_LEVEL;
  rightGain.gain.value = BINAURAL_TONE_LEVEL;

  const merger = context.createChannelMerger(2);
  left.connect(leftGain);
  right.connect(rightGain);
  // Mono output 0 of each tone into merger input 0 (left ear) and input 1 (right ear).
  leftGain.connect(merger, 0, 0);
  rightGain.connect(merger, 0, 1);

  return {
    output: merger,
    frequencies,
    oscillators: { left, right },
    start(when) {
      left.start(when);
      right.start(when);
    },
    stop(when) {
      left.stop(when);
      right.stop(when);
    },
    disconnect() {
      left.disconnect();
      right.disconnect();
      leftGain.disconnect();
      rightGain.disconnect();
      merger.disconnect();
    },
  };
}
