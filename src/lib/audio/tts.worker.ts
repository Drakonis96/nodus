import type { AudioProvider } from '@shared/types';
import { piperEngine } from './piper';
import { kokoroEngine } from './kokoro';

// Off-main-thread TTS synthesis. Piper (vits-web) and Kokoro (kokoro-js) both run
// onnxruntime-web WASM inference *synchronously* — on the renderer's main thread a
// single segment blocks the UI for seconds (RTF ~2), so narrating a whole report
// or immersion freezes the window and clicks pile up. Running the synthesis here
// keeps the UI responsive. Model files are read from the same origin-scoped caches
// the main thread already populated (OPFS for Piper, the Cache API for Kokoro), so
// nothing is re-downloaded — the worker just builds its own inference session.
//
// Only the local WASM providers live here; the Hume cloud voice synthesises in the
// main process over IPC (already async), so it never reaches this worker.

interface SynthRequest {
  id: number;
  provider: Exclude<AudioProvider, 'hume'>;
  voiceId: string;
  text: string;
}

// tsconfig does not pull in the WebWorker lib, so type the worker global
// structurally rather than reaching for DedicatedWorkerGlobalScope.
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<SynthRequest>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

const engines = { piper: piperEngine, kokoro: kokoroEngine } as const;

ctx.onmessage = async (e: MessageEvent<SynthRequest>) => {
  const { id, provider, voiceId, text } = e.data;
  try {
    const engine = engines[provider];
    if (!engine) throw new Error(`Proveedor de audio no soportado en el worker: ${provider}`);
    const bytes = await engine.synthesize(text, voiceId);
    // Transfer the WAV buffer to avoid copying the payload back to the main thread.
    ctx.postMessage({ id, ok: true, bytes }, [bytes.buffer]);
  } catch (err) {
    ctx.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
