import { parentPort } from 'node:worker_threads';
import { planRetrievalChunks } from '@shared/retrievalChunks';
parentPort?.on('message', (input: { text: string; sourceMap: Record<string, string> }) => {
  try { parentPort!.postMessage({ chunks: planRetrievalChunks(input.text, { sourceMap: input.sourceMap }) }); }
  catch { parentPort!.postMessage({ error: 'documentary_chunking_failed' }); }
});
