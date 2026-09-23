import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { RetrievalChunk } from '@shared/retrievalChunks';

/** No in-process fallback: large source tokenization must not block Electron. */
export function documentaryChunks(text: string, sourceMap: Record<string, string> = {}, signal?: AbortSignal): Promise<RetrievalChunk[]> {
  signal?.throwIfAborted();
  const worker = new Worker(path.join(__dirname, 'documentaryChunkWorker.js'));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, chunks?: RetrievalChunk[]) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      void worker.terminate();
      if (error) reject(error); else resolve(chunks!);
    };
    const abort = () => finish(new Error('documentary_preparation_cancelled'));
    signal?.addEventListener('abort', abort, { once: true });
    worker.once('message', (message: { error?: string; chunks?: RetrievalChunk[] }) => finish(message.error ? new Error(message.error) : undefined, message.chunks));
    worker.once('error', error => finish(error));
    worker.once('exit', () => { if (!settled) finish(new Error('documentary_worker_stopped')); });
    worker.postMessage({ text, sourceMap });
  });
}
