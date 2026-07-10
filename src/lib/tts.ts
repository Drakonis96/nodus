import type { VoiceId } from '@diffusionstudio/vits-web';

// Renderer-side Piper text-to-speech, running fully in-browser via WebAssembly
// (onnxruntime-web) so it works identically on macOS and Windows and sidesteps
// the Electron V8 memory-cage restriction that blocks native TTS addons. Models
// are stored by the engine in the browser's Origin-Private File System and reused
// across sessions. vits-web (and onnxruntime-web) are imported lazily so the ~MB
// WASM runtime is only pulled in when the user actually uses audio.

export interface AudioVoice {
  id: VoiceId;
  languageLabel: string;
  name: string;
  gender: 'male' | 'female' | 'neutral';
  quality: string;
  /** Approximate download size in MB (for the settings UI). */
  sizeMb: number;
  /** BCP-47-ish language code stored on the clip metadata. */
  language: string;
}

/** Curated, Spanish-first subset of Piper voices. Kept small on purpose; the full
 *  Piper catalogue has 100+ voices, most irrelevant to this app's users. */
export const AUDIO_VOICES: AudioVoice[] = [
  { id: 'es_ES-sharvard-medium', languageLabel: 'Español (España)', name: 'Sharvard', gender: 'female', quality: 'medium', sizeMb: 63, language: 'es_ES' },
  { id: 'es_ES-davefx-medium', languageLabel: 'Español (España)', name: 'Davefx', gender: 'male', quality: 'medium', sizeMb: 63, language: 'es_ES' },
  { id: 'es_ES-carlfm-x_low', languageLabel: 'Español (España)', name: 'Carlfm', gender: 'male', quality: 'x_low', sizeMb: 28, language: 'es_ES' },
  { id: 'es_MX-claude-high', languageLabel: 'Español (México)', name: 'Claude', gender: 'female', quality: 'high', sizeMb: 114, language: 'es_MX' },
  { id: 'es_MX-ald-medium', languageLabel: 'Español (México)', name: 'Ald', gender: 'male', quality: 'medium', sizeMb: 63, language: 'es_MX' },
  { id: 'en_US-hfc_female-medium', languageLabel: 'English (US)', name: 'HFC Female', gender: 'female', quality: 'medium', sizeMb: 63, language: 'en_US' },
  { id: 'en_US-ryan-high', languageLabel: 'English (US)', name: 'Ryan', gender: 'male', quality: 'high', sizeMb: 114, language: 'en_US' },
  { id: 'en_GB-alba-medium', languageLabel: 'English (UK)', name: 'Alba', gender: 'female', quality: 'medium', sizeMb: 63, language: 'en_GB' },
];

export function findVoice(id: string): AudioVoice | undefined {
  return AUDIO_VOICES.find((v) => v.id === id);
}

async function engine() {
  return import('@diffusionstudio/vits-web');
}

/** Voice ids already downloaded to local (OPFS) storage. */
export async function storedVoices(): Promise<string[]> {
  try {
    return await (await engine()).stored();
  } catch {
    return [];
  }
}

export async function downloadVoice(id: VoiceId, onProgress?: (fraction: number) => void): Promise<void> {
  const tts = await engine();
  await tts.download(id, (p) => {
    if (p.total > 0) onProgress?.(Math.min(1, p.loaded / p.total));
  });
}

export async function removeVoice(id: VoiceId): Promise<void> {
  await (await engine()).remove(id);
}

/** Synthesise text to WAV bytes with a downloaded voice. */
export async function synthesize(text: string, voiceId: VoiceId): Promise<Uint8Array> {
  const tts = await engine();
  const wav = await tts.predict({ text, voiceId });
  return new Uint8Array(await wav.arrayBuffer());
}
