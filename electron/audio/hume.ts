import { getAudioKey, hasAudioKey, setAudioKey, clearAudioKey } from '../secrets/secretStore';

// Hume Octave text-to-speech (cloud). Unlike the local WASM providers, synthesis
// happens in the main process because it needs the user's API key (stored
// encrypted-at-rest, BYO-key) and network access. The renderer only ever sees
// voice metadata and the resulting audio bytes — never the key.

const API_BASE = 'https://api.hume.ai/v0/tts';
const KEY_NAME = 'hume';

type HumeSubProvider = 'HUME_AI' | 'CUSTOM_VOICE';

export interface HumeVoice {
  id: string;
  name: string;
  /** Which Hume library the voice belongs to (needed to synthesize with it). */
  humeProvider: HumeSubProvider;
}

export function humeHasKey(): boolean {
  return hasAudioKey(KEY_NAME);
}

export function setHumeKey(key: string): void {
  setAudioKey(KEY_NAME, key);
}

export function clearHumeKey(): void {
  clearAudioKey(KEY_NAME);
}

function requireKey(): string {
  const key = getAudioKey(KEY_NAME);
  if (!key) throw new Error('Falta la clave de Hume. Añádela en Ajustes → IA → Audio y voz.');
  return key;
}

async function listForProvider(provider: HumeSubProvider, key: string): Promise<HumeVoice[]> {
  const out: HumeVoice[] = [];
  for (let page = 0; page < 20; page++) {
    const url = `${API_BASE}/voices?provider=${provider}&page_number=${page}&page_size=100`;
    const res = await fetch(url, { headers: { 'X-Hume-Api-Key': key } });
    if (res.status === 401 || res.status === 403) throw new Error('La clave de Hume no es válida.');
    if (!res.ok) throw new Error(`Hume: no se pudieron listar las voces (HTTP ${res.status}).`);
    const data = (await res.json()) as {
      total_pages?: number;
      voices_page?: Array<{ id: string; name: string }>;
    };
    for (const v of data.voices_page ?? []) {
      if (v.id && v.name) out.push({ id: v.id, name: v.name, humeProvider: provider });
    }
    if (!data.total_pages || page + 1 >= data.total_pages) break;
  }
  return out;
}

/** All voices available to this key: Hume's shared library plus the user's own. */
export async function listHumeVoices(): Promise<HumeVoice[]> {
  const key = requireKey();
  const [library, custom] = await Promise.all([
    listForProvider('HUME_AI', key),
    listForProvider('CUSTOM_VOICE', key).catch(() => [] as HumeVoice[]),
  ]);
  return [...library, ...custom];
}

/** Synthesise one utterance with a saved voice, returning WAV bytes. */
export async function synthesizeHume(voiceId: string, provider: HumeSubProvider, text: string): Promise<Buffer> {
  const key = requireKey();
  const res = await fetch(`${API_BASE}/file`, {
    method: 'POST',
    headers: { 'X-Hume-Api-Key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      utterances: [{ text, voice: { id: voiceId, provider } }],
      format: { type: 'wav' },
      num_generations: 1,
    }),
  });
  if (res.status === 401 || res.status === 403) throw new Error('La clave de Hume no es válida.');
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Hume: fallo al generar el audio (HTTP ${res.status}). ${detail.slice(0, 200)}`.trim());
  }
  return Buffer.from(await res.arrayBuffer());
}
