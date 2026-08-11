// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Dedicated worker for clean-document extraction.
 *
 * PDF.js layout analysis, Canvas rendering, image reconstruction and local OCR
 * are CPU-heavy even though their APIs are asynchronous. Keeping the complete
 * pipeline in this worker prevents those phases from starving Electron's main
 * event loop and producing an operating-system "application not responding"
 * state while the Library is open.
 */
import { parentPort } from 'node:worker_threads';
import type { LibraryExtractionOptions, LibraryItemRecord } from '@shared/libraryTypes';
import { extractLibraryItem } from '../library/libraryExtractionEngine';
import { LibraryDiskStore } from '../library/libraryStorage';

interface RunRequest {
  kind: 'run';
  item: LibraryItemRecord;
  root: string;
  deviceId: string;
  extractionOptions?: Partial<LibraryExtractionOptions>;
}

interface CancelRequest { kind: 'cancel' }
interface RemoteOcrResult {
  kind: 'remote-ocr-result';
  requestId: number;
  text?: string;
  error?: string;
}

type WorkerRequest = RunRequest | CancelRequest | RemoteOcrResult;

let controller: AbortController | null = null;
let nextRemoteRequestId = 1;
const remotePending = new Map<number, { resolve: (text: string) => void; reject: (error: Error) => void }>();

function abortError(): Error {
  const error = new Error('Library extraction canceled.');
  error.name = 'AbortError';
  return error;
}

function remoteOcr(page: number, image: Buffer, mimeType: 'image/png'): Promise<string> {
  const requestId = nextRemoteRequestId++;
  return new Promise<string>((resolve, reject) => {
    remotePending.set(requestId, { resolve, reject });
    parentPort!.postMessage({ kind: 'remote-ocr', requestId, page, image, mimeType });
  });
}

async function run(request: RunRequest): Promise<void> {
  if (controller) throw new Error('The extraction worker is already busy.');
  controller = new AbortController();
  try {
    const store = new LibraryDiskStore(request.root, request.deviceId);
    const result = await extractLibraryItem({
      item: request.item,
      store,
      extractionOptions: request.extractionOptions,
      signal: controller.signal,
      remoteOcr: ({ page, image, mimeType }) => remoteOcr(page, image, mimeType),
      onProgress: (progress) => parentPort!.postMessage({ kind: 'progress', progress }),
    });
    parentPort!.postMessage({ kind: 'done', result });
  } catch (error) {
    parentPort!.postMessage({
      kind: 'error',
      error: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : 'Error',
    });
  } finally {
    controller = null;
    for (const pending of remotePending.values()) pending.reject(abortError());
    remotePending.clear();
  }
}

parentPort?.on('message', (request: WorkerRequest) => {
  if (request.kind === 'cancel') {
    controller?.abort();
    for (const pending of remotePending.values()) pending.reject(abortError());
    remotePending.clear();
    return;
  }
  if (request.kind === 'remote-ocr-result') {
    const pending = remotePending.get(request.requestId);
    if (!pending) return;
    remotePending.delete(request.requestId);
    if (request.error) pending.reject(new Error(request.error));
    else pending.resolve(request.text ?? '');
    return;
  }
  void run(request);
});
