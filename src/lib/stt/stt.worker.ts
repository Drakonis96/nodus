/// <reference lib="webworker" />
import { env, pipeline } from '@huggingface/transformers';
import { whisperLanguageName } from '@shared/sttModels';

env.allowLocalModels = false;
env.useBrowserCache = true;

type WorkerRequest =
  | { id: string; type: 'ensure'; model: string }
  | { id: string; type: 'transcribe'; model: string; samples: Float32Array; language?: string | null };

type AsrPipeline = (samples: Float32Array, options: Record<string, unknown>) => Promise<{
  text?: string;
  chunks?: Array<{ text?: string; timestamp?: [number | null, number | null] }>;
}>;
const pipelines = new Map<string, AsrPipeline>();

async function getPipeline(id: string, model: string) {
  const existing = pipelines.get(model);
  if (existing) return existing;
  const created = await pipeline('automatic-speech-recognition', model, {
    device: 'wasm',
    dtype: 'q8',
    progress_callback: (progress: { status?: string; progress?: number; loaded?: number; total?: number }) => {
      const fraction = typeof progress.progress === 'number'
        ? progress.progress / 100
        : progress.total ? (progress.loaded ?? 0) / progress.total : 0;
      self.postMessage({ id, type: 'progress', fraction: Math.max(0, Math.min(1, fraction)) });
    },
  });
  const transcriber = created as unknown as AsrPipeline;
  pipelines.set(model, transcriber);
  return transcriber;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    const transcriber = await getPipeline(request.id, request.model);
    if (request.type === 'ensure') {
      self.postMessage({ id: request.id, type: 'result', result: true });
      return;
    }
    const output = await transcriber(request.samples, {
      language: request.language ? whisperLanguageName(request.language) : undefined,
      task: 'transcribe',
      chunk_length_s: 25,
      stride_length_s: 4,
      return_timestamps: true,
    });
    self.postMessage({
      id: request.id,
      type: 'result',
      result: {
        text: output.text?.trim() ?? '',
        chunks: (output.chunks ?? []).map((chunk) => ({
          text: chunk.text?.trim() ?? '',
          timestamp: chunk.timestamp ?? null,
        })),
      },
    });
  } catch (error) {
    self.postMessage({ id: request.id, type: 'error', error: error instanceof Error ? error.message : String(error) });
  }
};

export {};
