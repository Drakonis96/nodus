import type { HumeVoiceInfo } from '@shared/types';
import type { AudioEngine, AudioVoice } from './types';

// Hume Octave provider (cloud). The API key lives in the main process; here we
// only ask it to list voices, report whether a key exists, and synthesise (which
// the main process performs, returning WAV bytes). Every voice ever fetched is
// merged into a cache so `ready()`/`synthesize()` can resolve a selected voice
// even after the settings list has been filtered down.

// Languages Octave can filter by (used by the settings language dropdown). These
// map to Hume's LANGUAGE tag values (case-sensitive English names).
const HUME_LANGUAGES = [
  'English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese',
  'Russian', 'Hindi', 'Arabic', 'Japanese', 'Korean', 'Chinese',
];

const cache = new Map<string, AudioVoice>();

function toVoice(v: HumeVoiceInfo): AudioVoice {
  return {
    provider: 'hume',
    id: v.id,
    languageLabel: v.humeProvider === 'CUSTOM_VOICE' ? 'Mis voces (Hume)' : 'Biblioteca de Hume',
    name: v.name,
    gender: 'neutral',
    quality: v.models?.[0] ?? 'octave',
    language: 'multi',
    humeProvider: v.humeProvider,
    models: v.models ?? [],
  };
}

async function fetchVoices(language?: string): Promise<AudioVoice[]> {
  const list = await window.nodus.humeVoices(language);
  const voices = list.map(toVoice);
  for (const v of voices) cache.set(v.id, v); // merge so filters never lose a selected voice
  return voices;
}

async function ensureAll(): Promise<Map<string, AudioVoice>> {
  if (cache.size === 0) await fetchVoices();
  return cache;
}

export const humeEngine: AudioEngine = {
  provider: 'hume',
  label: 'Hume',
  description: 'Voces de estudio en la nube (Octave). Requiere tu propia clave de API; se factura a tu cuenta.',
  modelStyle: 'cloud',
  voices: [],
  languages: HUME_LANGUAGES,

  async ready() {
    if (!(await window.nodus.humeStatus()).hasKey) {
      cache.clear();
      return new Set();
    }
    try {
      return new Set((await ensureAll()).keys());
    } catch {
      return new Set();
    }
  },

  async download() {
    /* cloud: nothing to download */
  },

  async remove() {
    /* cloud: nothing to remove */
  },

  async synthesize(text, voiceId) {
    const voice = (await ensureAll()).get(voiceId);
    if (!voice) throw new Error('La voz de Hume seleccionada ya no está disponible.');
    return window.nodus.humeSynthesize(voiceId, voice.humeProvider ?? 'HUME_AI', text);
  },

  async listVoices(opts) {
    return fetchVoices(opts?.language);
  },

  async keyStatus() {
    return (await window.nodus.humeStatus()).hasKey;
  },

  async setKey(key) {
    await window.nodus.humeSetKey(key);
    cache.clear();
  },

  async clearKey() {
    await window.nodus.humeClearKey();
    cache.clear();
  },
};
