import type { AudioProvider } from '@shared/types';

// Renderer-side text-to-speech engine abstraction. Every provider runs fully in
// the browser via WebAssembly (onnxruntime-web) so it works identically on macOS
// and Windows and avoids Electron's V8 memory cage. Two model-management styles
// are supported behind one interface:
//   • 'per-voice'    — each voice is its own downloadable model (Piper).
//   • 'single-model' — one shared model powers every voice (Kokoro).

export interface AudioVoice {
  provider: AudioProvider;
  /** Engine-native voice id (e.g. "es_ES-sharvard-medium" or "am_michael"). */
  id: string;
  /** Group label shown in the picker, e.g. "Español (España)" or "English (US)". */
  languageLabel: string;
  /** Display name of the voice. */
  name: string;
  gender: 'male' | 'female' | 'neutral';
  /** Free-text quality tier for the UI (e.g. "medium", "A", "high"). */
  quality: string;
  /** Language tag stored on the clip metadata (e.g. "es_ES", "en-us"). */
  language: string;
  /** Per-voice download size in MB. Omitted for single-model providers. */
  sizeMb?: number;
}

export interface AudioEngine {
  provider: AudioProvider;
  /** Short human label, e.g. "Piper" / "Kokoro". */
  label: string;
  /** One-line description shown under the provider selector. */
  description: string;
  modelStyle: 'per-voice' | 'single-model';
  /** For single-model providers, the shared model's approximate download size (MB). */
  modelSizeMb?: number;
  voices: AudioVoice[];
  /** Voice ids usable right now. Single-model: all voices when the model is
   *  present, otherwise empty. */
  ready(): Promise<Set<string>>;
  /** Download a voice (per-voice) or the shared model (single-model — voiceId is
   *  ignored). `onProgress` receives a 0..1 fraction. */
  download(voiceId: string, onProgress?: (fraction: number) => void): Promise<void>;
  /** Remove a voice (per-voice) or the shared model (single-model). */
  remove(voiceId: string): Promise<void>;
  /** Synthesise text to WAV bytes with the given voice. Playback speed is applied
   *  later on the audio element, so synthesis always runs at natural speed. */
  synthesize(text: string, voiceId: string): Promise<Uint8Array>;
}
