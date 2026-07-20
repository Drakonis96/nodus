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
  /** Per-voice download size in MB. Omitted for single-model / cloud providers. */
  sizeMb?: number;
  /** Upstream model/dataset terms shown before a local voice is downloaded. */
  licenseLabel?: string;
  licenseUrl?: string;
  /** Cloud (Hume) only: which Hume library the voice belongs to. */
  humeProvider?: 'HUME_AI' | 'CUSTOM_VOICE';
  /** Cloud (Hume) only: compatible model versions (e.g. ["octave-2"]). */
  models?: string[];
}

export interface AudioEngine {
  provider: AudioProvider;
  /** Short human label, e.g. "Piper" / "Kokoro" / "Hume". */
  label: string;
  /** One-line description shown under the provider selector. */
  description: string;
  /** Terms for a locally downloaded shared runtime/model, when applicable. */
  licenseLabel?: string;
  licenseUrl?: string;
  //   'per-voice'    — each voice is its own downloadable model (Piper)
  //   'single-model' — one shared model powers every voice (Kokoro)
  //   'cloud'        — a hosted API; needs a key, voices are fetched (Hume)
  modelStyle: 'per-voice' | 'single-model' | 'cloud';
  /** For single-model providers, the shared model's approximate download size (MB). */
  modelSizeMb?: number;
  /** Static voice catalog (local providers). Empty for cloud providers, which
   *  fetch their voices via `listVoices()`. */
  voices: AudioVoice[];
  /** Voice ids usable right now. Single-model: all voices when the model is
   *  present. Cloud: the fetched voices when a key is set. */
  ready(): Promise<Set<string>>;
  /** Download a voice (per-voice) or the shared model (single-model). No-op for cloud. */
  download(voiceId: string, onProgress?: (fraction: number) => void): Promise<void>;
  /** Remove a voice (per-voice) or the shared model (single-model). No-op for cloud. */
  remove(voiceId: string): Promise<void>;
  /** Synthesise text to WAV bytes with the given voice. Playback speed is applied
   *  later on the audio element, so synthesis always runs at natural speed. */
  synthesize(text: string, voiceId: string): Promise<Uint8Array>;

  // ── Cloud-only surface (present when modelStyle === 'cloud') ────────────────
  /** Fetch the available voices from the provider (requires a key), optionally
   *  filtered by language (applied server-side where the provider supports it). */
  listVoices?(opts?: { language?: string }): Promise<AudioVoice[]>;
  /** Languages the provider can filter by, for the settings language dropdown. */
  languages?: string[];
  /** Whether an API key is stored for this provider. */
  keyStatus?(): Promise<boolean>;
  setKey?(key: string): Promise<void>;
  clearKey?(): Promise<void>;
}
