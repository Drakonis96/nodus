import type { KokoroTTS } from 'kokoro-js';
import type { AudioEngine, AudioVoice } from './types';
import { encodeWavPcm16 } from './wav';

// Kokoro provider: one shared 82M model (StyleTTS2) powers many high-quality
// English voices (US + UK). Runs via kokoro-js on onnxruntime-web (WASM). The
// model is downloaded once and cached by the browser; individual voices are just
// selectable embeddings, so there is no per-voice download.

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const DTYPE = 'q8' as const; // ~86 MB, good quality/size balance for WASM
const READY_KEY = 'nodus.audio.kokoro.ready';

const VOICES: AudioVoice[] = [
  { provider: 'kokoro', id: 'af_heart', languageLabel: 'English (US)', name: 'Heart', gender: 'female', quality: 'A', language: 'en-us' },
  { provider: 'kokoro', id: 'af_bella', languageLabel: 'English (US)', name: 'Bella', gender: 'female', quality: 'A-', language: 'en-us' },
  { provider: 'kokoro', id: 'af_nicole', languageLabel: 'English (US)', name: 'Nicole', gender: 'female', quality: 'B-', language: 'en-us' },
  { provider: 'kokoro', id: 'am_michael', languageLabel: 'English (US)', name: 'Michael', gender: 'male', quality: 'B-', language: 'en-us' },
  { provider: 'kokoro', id: 'am_fenrir', languageLabel: 'English (US)', name: 'Fenrir', gender: 'male', quality: 'B-', language: 'en-us' },
  { provider: 'kokoro', id: 'am_puck', languageLabel: 'English (US)', name: 'Puck', gender: 'male', quality: 'B-', language: 'en-us' },
  { provider: 'kokoro', id: 'bf_emma', languageLabel: 'English (UK)', name: 'Emma', gender: 'female', quality: 'B-', language: 'en-gb' },
  { provider: 'kokoro', id: 'bf_isabella', languageLabel: 'English (UK)', name: 'Isabella', gender: 'female', quality: 'C', language: 'en-gb' },
  { provider: 'kokoro', id: 'bm_george', languageLabel: 'English (UK)', name: 'George', gender: 'male', quality: 'C', language: 'en-gb' },
  { provider: 'kokoro', id: 'bm_fable', languageLabel: 'English (UK)', name: 'Fable', gender: 'male', quality: 'C', language: 'en-gb' },
];

let instance: KokoroTTS | null = null;
let loading: Promise<KokoroTTS> | null = null;

function markReady(ready: boolean): void {
  try {
    if (ready) localStorage.setItem(READY_KEY, '1');
    else localStorage.removeItem(READY_KEY);
  } catch {
    /* storage may be unavailable; ready() then just reports the in-memory state */
  }
}

async function loadModel(onProgress?: (fraction: number) => void): Promise<KokoroTTS> {
  if (instance) return instance;
  if (loading) return loading;
  const { KokoroTTS } = await import('kokoro-js');
  loading = KokoroTTS.from_pretrained(MODEL_ID, {
    dtype: DTYPE,
    device: 'wasm',
    progress_callback: (p: { status?: string; file?: string; progress?: number }) => {
      if (p.status === 'progress' && p.file && p.file.endsWith('.onnx') && typeof p.progress === 'number') {
        onProgress?.(Math.min(1, p.progress / 100));
      }
    },
  })
    .then((m) => {
      instance = m;
      markReady(true);
      return m;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

export const kokoroEngine: AudioEngine = {
  provider: 'kokoro',
  label: 'Kokoro',
  description: 'Un solo modelo (inglés) con muchas voces de alta calidad. Se descarga una vez.',
  licenseLabel: 'Apache-2.0',
  licenseUrl: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX',
  modelStyle: 'single-model',
  modelSizeMb: 86,
  voices: VOICES,

  async ready() {
    const isReady = instance != null || (() => {
      try {
        return localStorage.getItem(READY_KEY) === '1';
      } catch {
        return false;
      }
    })();
    return isReady ? new Set(VOICES.map((v) => v.id)) : new Set();
  },

  async download(_voiceId, onProgress) {
    await loadModel(onProgress);
    onProgress?.(1);
  },

  async remove() {
    instance = null;
    markReady(false);
    // Best-effort: drop the transformers.js browser cache so storage is reclaimed.
    try {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => /transformers/i.test(n)).map((n) => caches.delete(n)));
    } catch {
      /* nothing to reclaim / Cache API unavailable */
    }
  },

  async synthesize(text, voiceId) {
    const model = await loadModel();
    // kokoro-js types `voice` as a literal union of voice ids; our curated ids are
    // valid members but arrive as plain strings, so widen through the options type.
    const options = { voice: voiceId, speed: 1 } as unknown as Parameters<KokoroTTS['generate']>[1];
    const audio = await model.generate(text, options);
    // RawAudio.toBlob() writes 32-bit float WAV, which Chromium's <audio> cannot
    // play; re-encode the raw samples as 16-bit PCM WAV instead.
    return encodeWavPcm16(audio.audio as Float32Array, audio.sampling_rate);
  },
};
