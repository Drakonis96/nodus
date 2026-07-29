/// <reference lib="webworker" />
import { AutoModelForAudioFrameClassification, AutoProcessor, env } from '@huggingface/transformers';
import type { RawDiarizationSpan } from '@shared/testimonyDiarization';

// La segmentación acústica corre en el renderer, igual que Whisper: es el único sitio de
// la aplicación con runtime ONNX y con caché de modelos, y significa además que EL AUDIO
// NO SALE DEL EQUIPO para detectar quién habla. En un vault de historia oral eso no es un
// detalle de rendimiento: mandar la voz de un narrador a un servidor ajeno para saber
// cuántas personas hablan sería justo lo que su acuerdo no autoriza.

env.allowLocalModels = false;
env.useBrowserCache = true;

/** pyannote 3.0 convertido a ONNX. Es el modelo de segmentación, no de identificación. */
const MODEL_ID = 'onnx-community/pyannote-segmentation-3.0';

type WorkerRequest =
  | { id: string; type: 'ensure' }
  | { id: string; type: 'diarize'; samples: Float32Array };

interface Loaded {
  model: {
    (inputs: unknown): Promise<{ logits: unknown }>;
    config: { id2label: Record<number, string> };
  };
  processor: {
    (samples: Float32Array): Promise<unknown>;
    post_process_speaker_diarization: (
      logits: unknown,
      length: number,
    ) => Array<Array<{ id: number; start: number; end: number; confidence: number }>>;
  };
}

let loaded: Loaded | null = null;

async function load(id: string): Promise<Loaded> {
  if (loaded) return loaded;
  const progress = (event: { status?: string; progress?: number; loaded?: number; total?: number }) => {
    const fraction = typeof event.progress === 'number'
      ? event.progress / 100
      : event.total ? (event.loaded ?? 0) / event.total : 0;
    self.postMessage({ id, type: 'progress', fraction: Math.max(0, Math.min(1, fraction)) });
  };
  const model = await AutoModelForAudioFrameClassification.from_pretrained(MODEL_ID, {
    dtype: 'fp32',
    progress_callback: progress,
  });
  const processor = await AutoProcessor.from_pretrained(MODEL_ID, { progress_callback: progress });
  loaded = { model, processor } as unknown as Loaded;
  return loaded;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    const { model, processor } = await load(request.id);
    if (request.type === 'ensure') {
      self.postMessage({ id: request.id, type: 'result', result: [] });
      return;
    }
    const inputs = await processor(request.samples);
    const { logits } = await model(inputs);
    const raw = processor.post_process_speaker_diarization(logits, request.samples.length)[0] ?? [];
    const spans: RawDiarizationSpan[] = raw.map((span) => ({
      start: span.start,
      end: span.end,
      label: model.config.id2label[span.id] ?? String(span.id),
      confidence: span.confidence,
    }));
    self.postMessage({ id: request.id, type: 'result', result: spans });
  } catch (error) {
    self.postMessage({
      id: request.id,
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
