import type { AudioProvider } from '@shared/types';
import { getEngine } from './index';

// Main-thread proxy for TTS synthesis. Local WASM voices (Piper/Kokoro) run their
// onnxruntime-web inference in a Web Worker (`tts.worker.ts`) so the heavy, fully
// synchronous compute never blocks the renderer's event loop — the window stays
// clickable while a report or immersion is narrated. The Hume cloud voice already
// synthesises in the main process over IPC, so it stays on this thread.

interface SynthResponse {
  id: number;
  ok: boolean;
  bytes?: Uint8Array;
  error?: string;
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (b: Uint8Array) => void; reject: (e: Error) => void }>();

function rejectAll(err: Error): void {
  for (const entry of pending.values()) entry.reject(err);
  pending.clear();
}

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./tts.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<SynthResponse>) => {
    const { id, ok, bytes, error } = e.data;
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (ok && bytes) entry.resolve(bytes);
    else entry.reject(new Error(error || 'Fallo al sintetizar el audio.'));
  };
  w.onerror = (e) => {
    // A worker-level failure rejects everything in flight; the worker is dropped so
    // the next request spawns a fresh one.
    rejectAll(new Error(e.message || 'El worker de audio falló.'));
    w.terminate();
    if (worker === w) worker = null;
  };
  worker = w;
  return w;
}

/**
 * Synthesise one segment to WAV bytes. Piper/Kokoro run in the worker; Hume runs
 * on the main thread (its synthesis is a non-blocking IPC call to the main process).
 */
export async function synthesizeSegment(
  provider: AudioProvider,
  voiceId: string,
  text: string
): Promise<Uint8Array> {
  if (provider === 'hume') return getEngine('hume').synthesize(text, voiceId);
  const id = ++seq;
  const w = getWorker();
  return new Promise<Uint8Array>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, provider, voiceId, text });
  });
}
