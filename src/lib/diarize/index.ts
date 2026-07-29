import { diarizationFromSpans, type DiarizationResult, type RawDiarizationSpan } from '@shared/testimonyDiarization';
import { decodeWhisperAudio } from '../stt/localWhisper';

// El cliente del worker de segmentación. Misma forma que `localWhisper`: un worker vivo,
// peticiones con id y progreso de descarga, porque la primera vez baja un modelo.

type Pending = {
  resolve: (value: RawDiarizationSpan[]) => void;
  reject: (error: Error) => void;
  onProgress?: (fraction: number) => void;
};

let worker: Worker | null = null;
const pending = new Map<string, Pending>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./diarize.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<{ id: string; type: 'progress' | 'result' | 'error'; fraction?: number; result?: RawDiarizationSpan[]; error?: string }>) => {
    const current = pending.get(event.data.id);
    if (!current) return;
    if (event.data.type === 'progress') current.onProgress?.(event.data.fraction ?? 0);
    if (event.data.type === 'result') { pending.delete(event.data.id); current.resolve(event.data.result ?? []); }
    if (event.data.type === 'error') { pending.delete(event.data.id); current.reject(new Error(event.data.error ?? 'La detección de hablantes falló.')); }
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || 'La detección de hablantes falló.');
    pending.forEach((current) => current.reject(error));
    pending.clear();
  };
  return worker;
}

function request(message: Record<string, unknown>, transfer: Transferable[], onProgress?: (fraction: number) => void): Promise<RawDiarizationSpan[]> {
  const id = crypto.randomUUID();
  return new Promise<RawDiarizationSpan[]>((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ ...message, id }, transfer);
  });
}

export function isDiarizationModelReady(): boolean {
  return localStorage.getItem('nodus.diarize.model') === '1';
}

export async function ensureDiarizationModel(onProgress?: (fraction: number) => void): Promise<void> {
  await request({ type: 'ensure' }, [], onProgress);
  localStorage.setItem('nodus.diarize.model', '1');
}

/**
 * Cuántas voces hay y dónde habla cada una.
 *
 * Devuelve turnos anónimos. Quién es cada voz no lo decide esto: lo dice quien entrevistó.
 */
export async function diarizeAudio(blob: Blob, onProgress?: (fraction: number) => void): Promise<DiarizationResult> {
  const samples = await decodeWhisperAudio(blob);
  const spans = await request({ type: 'diarize', samples }, [samples.buffer], onProgress);
  localStorage.setItem('nodus.diarize.model', '1');
  return diarizationFromSpans(spans);
}

export function cancelDiarization(): void {
  const error = new Error('Detección de hablantes cancelada.');
  pending.forEach((current) => current.reject(error));
  pending.clear();
  worker?.terminate();
  worker = null;
}
