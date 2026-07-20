import type { VoiceId } from '@diffusionstudio/vits-web';
import type { AudioEngine, AudioVoice } from './types';

// Piper provider: native-sounding, per-language single-speaker voices (VITS) run
// via vits-web (onnxruntime-web). Each voice is its own downloadable model, cached
// in the browser's Origin-Private File System and reused offline.

const VOICES: AudioVoice[] = [
  // Sharvard is a dual-speaker model (speaker_id_map {"M": 0, "F": 1}), but vits-web
  // hardcodes speaker id 0, so it always renders the *male* speaker regardless of
  // what we label it — it was mislabelled 'female'. There is no way to select the
  // female speaker through vits-web's API, so it is correctly a male voice here; the
  // female Spanish option is es_MX-claude-high (Mexico).
  { provider: 'piper', id: 'es_ES-sharvard-medium', languageLabel: 'Español (España)', name: 'Sharvard', gender: 'male', quality: 'medium', sizeMb: 63, language: 'es_ES', licenseLabel: 'CC BY 3.0', licenseUrl: 'https://huggingface.co/diffusionstudio/piper-voices/blob/main/es/es_ES/sharvard/medium/MODEL_CARD' },
  { provider: 'piper', id: 'es_ES-davefx-medium', languageLabel: 'Español (España)', name: 'Davefx', gender: 'male', quality: 'medium', sizeMb: 63, language: 'es_ES', licenseLabel: 'CC0', licenseUrl: 'https://huggingface.co/diffusionstudio/piper-voices/blob/main/es/es_ES/davefx/medium/MODEL_CARD' },
  { provider: 'piper', id: 'es_ES-carlfm-x_low', languageLabel: 'Español (España)', name: 'Carlfm', gender: 'male', quality: 'x_low', sizeMb: 28, language: 'es_ES', licenseLabel: 'Dominio público', licenseUrl: 'https://huggingface.co/diffusionstudio/piper-voices/blob/main/es/es_ES/carlfm/x_low/MODEL_CARD' },
  { provider: 'piper', id: 'es_MX-claude-high', languageLabel: 'Español (México)', name: 'Claude', gender: 'female', quality: 'high', sizeMb: 114, language: 'es_MX', licenseLabel: 'Apache-2.0', licenseUrl: 'https://huggingface.co/diffusionstudio/piper-voices/blob/main/es/es_MX/claude/high/MODEL_CARD' },
  { provider: 'piper', id: 'es_MX-ald-medium', languageLabel: 'Español (México)', name: 'Ald', gender: 'male', quality: 'medium', sizeMb: 63, language: 'es_MX', licenseLabel: 'Unlicense', licenseUrl: 'https://huggingface.co/diffusionstudio/piper-voices/blob/main/es/es_MX/ald/medium/MODEL_CARD' },
  { provider: 'piper', id: 'en_US-hfc_female-medium', languageLabel: 'English (US)', name: 'HFC Female', gender: 'female', quality: 'medium', sizeMb: 63, language: 'en_US', licenseLabel: 'CC BY-NC-SA 4.0 · no comercial', licenseUrl: 'https://huggingface.co/diffusionstudio/piper-voices/blob/main/en/en_US/hfc_female/medium/MODEL_CARD' },
  { provider: 'piper', id: 'en_US-ryan-high', languageLabel: 'English (US)', name: 'Ryan', gender: 'male', quality: 'high', sizeMb: 114, language: 'en_US', licenseLabel: 'CC BY-NC-SA 4.0 · no comercial', licenseUrl: 'https://huggingface.co/diffusionstudio/piper-voices/blob/main/en/en_US/ryan/high/MODEL_CARD' },
  { provider: 'piper', id: 'en_GB-alba-medium', languageLabel: 'English (UK)', name: 'Alba', gender: 'female', quality: 'medium', sizeMb: 63, language: 'en_GB', licenseLabel: 'CC BY 4.0', licenseUrl: 'https://huggingface.co/diffusionstudio/piper-voices/blob/main/en/en_GB/alba/medium/MODEL_CARD' },
];

async function engine() {
  return import('@diffusionstudio/vits-web');
}

export const piperEngine: AudioEngine = {
  provider: 'piper',
  label: 'Piper',
  description: 'Voces locales por idioma, con español nativo. Cada voz se descarga por separado.',
  licenseLabel: 'VITS Web MIT · eSpeak NG GPL-3.0 · licencia propia por voz',
  licenseUrl: 'https://github.com/espeak-ng/espeak-ng',
  modelStyle: 'per-voice',
  voices: VOICES,

  async ready() {
    try {
      return new Set(await (await engine()).stored());
    } catch {
      return new Set();
    }
  },

  async download(voiceId, onProgress) {
    const tts = await engine();
    await tts.download(voiceId as VoiceId, (p) => {
      if (p.total > 0) onProgress?.(Math.min(1, p.loaded / p.total));
    });
  },

  async remove(voiceId) {
    await (await engine()).remove(voiceId as VoiceId);
  },

  async synthesize(text, voiceId) {
    const tts = await engine();
    const wav = await tts.predict({ text, voiceId: voiceId as VoiceId });
    return new Uint8Array(await wav.arrayBuffer());
  },
};
