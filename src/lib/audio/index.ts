import type { AudioProvider } from '@shared/types';
import type { AudioEngine, AudioVoice } from './types';
import { piperEngine } from './piper';
import { kokoroEngine } from './kokoro';

export type { AudioEngine, AudioVoice } from './types';

/** All local TTS engines, in the order they should appear in the picker. */
export const AUDIO_ENGINES: AudioEngine[] = [piperEngine, kokoroEngine];

export const AUDIO_PROVIDERS: AudioProvider[] = AUDIO_ENGINES.map((e) => e.provider);

export function getEngine(provider: AudioProvider): AudioEngine {
  return AUDIO_ENGINES.find((e) => e.provider === provider) ?? piperEngine;
}

/** Look up a voice across every provider (used for clip metadata + labels). */
export function findVoice(provider: AudioProvider, voiceId: string): AudioVoice | undefined {
  return getEngine(provider).voices.find((v) => v.id === voiceId);
}
