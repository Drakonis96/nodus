import type { AudioEngine, AudioVoice } from './types';

// Hume Octave provider (cloud). The API key lives in the main process; here we
// only ask it to list voices, report whether a key exists, and synthesise (which
// the main process performs, returning WAV bytes). Voices are fetched on demand
// and cached so `ready()`/`synthesize()` don't re-hit the network each time.

let cache: Map<string, AudioVoice> | null = null;

function toVoice(v: { id: string; name: string; humeProvider: 'HUME_AI' | 'CUSTOM_VOICE' }): AudioVoice {
  return {
    provider: 'hume',
    id: v.id,
    languageLabel: v.humeProvider === 'CUSTOM_VOICE' ? 'Mis voces (Hume)' : 'Biblioteca de Hume',
    name: v.name,
    gender: 'neutral',
    quality: 'octave',
    language: 'multi',
    humeProvider: v.humeProvider,
  };
}

async function ensureVoices(): Promise<Map<string, AudioVoice>> {
  if (cache) return cache;
  const list = await window.nodus.humeVoices();
  cache = new Map(list.map((v) => [v.id, toVoice(v)]));
  return cache;
}

export const humeEngine: AudioEngine = {
  provider: 'hume',
  label: 'Hume',
  description: 'Voces de estudio en la nube (Octave). Requiere tu propia clave de API; se factura a tu cuenta.',
  modelStyle: 'cloud',
  voices: [],

  async ready() {
    if (!(await window.nodus.humeStatus()).hasKey) {
      cache = null;
      return new Set();
    }
    try {
      return new Set((await ensureVoices()).keys());
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
    const voice = (await ensureVoices()).get(voiceId);
    if (!voice) throw new Error('La voz de Hume seleccionada ya no está disponible.');
    return window.nodus.humeSynthesize(voiceId, voice.humeProvider ?? 'HUME_AI', text);
  },

  async listVoices() {
    cache = null; // force a fresh fetch when the user explicitly reloads
    return [...(await ensureVoices()).values()];
  },

  async keyStatus() {
    return (await window.nodus.humeStatus()).hasKey;
  },

  async setKey(key) {
    await window.nodus.humeSetKey(key);
    cache = null;
  },

  async clearKey() {
    await window.nodus.humeClearKey();
    cache = null;
  },
};
