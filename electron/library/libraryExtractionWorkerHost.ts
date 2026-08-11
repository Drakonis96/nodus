// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { LibraryExtractionOptions, LibraryItemRecord } from '@shared/libraryTypes';
import {
  extractLibraryItem,
  type LibraryExtractionProgressHandler,
  type LibraryExtractionResult,
  type LibraryRemoteOcr,
} from './libraryExtractionEngine';
import { LibraryDiskStore } from './libraryStorage';

export interface LibraryWorkerExtractionInput {
  item: LibraryItemRecord;
  store: LibraryDiskStore;
  extractionOptions?: Partial<LibraryExtractionOptions>;
  onProgress?: LibraryExtractionProgressHandler;
  signal?: AbortSignal;
  remoteOcr?: LibraryRemoteOcr;
}

const activeWorkers = new Set<Worker>();

function workerFile(): string {
  return process.env.NODUS_LIBRARY_EXTRACTION_WORKER_FILE
    || path.join(__dirname, 'libraryExtractionWorker.js');
}

export function libraryExtractionWorkerAvailable(): boolean {
  return process.env.NODUS_DISABLE_LIBRARY_EXTRACTION_WORKER !== '1' && fs.existsSync(workerFile());
}

function abortError(): Error {
  const error = new Error('Library extraction canceled.');
  error.name = 'AbortError';
  return error;
}

/** Run the complete extraction pipeline away from Electron's main event loop. */
export async function extractLibraryItemInWorker(input: LibraryWorkerExtractionInput): Promise<LibraryExtractionResult> {
  if (!libraryExtractionWorkerAvailable()) {
    // Source-level unit tests do not build the worker entry. Production and
    // packaged development builds always include it; retain a functional
    // fallback for those isolated tests and explicit diagnostic opt-outs.
    return extractLibraryItem(input);
  }
  if (input.signal?.aborted) throw abortError();
  const worker = new Worker(workerFile());
  activeWorkers.add(worker);
  worker.unref();
  return new Promise<LibraryExtractionResult>((resolve, reject) => {
    let settled = false;
    let forcedTermination: ReturnType<typeof setTimeout> | null = null;
    const finish = (error?: Error, result?: LibraryExtractionResult): void => {
      if (settled) return;
      settled = true;
      if (forcedTermination) clearTimeout(forcedTermination);
      input.signal?.removeEventListener('abort', cancel);
      activeWorkers.delete(worker);
      void worker.terminate().catch(() => undefined);
      if (error) reject(error);
      else resolve(result!);
    };
    const cancel = (): void => {
      worker.postMessage({ kind: 'cancel' });
      // A synchronous PDF renderer cannot receive its cancel message until it
      // returns to the worker event loop. Terminate after a short grace period;
      // published output is staged atomically, so an abrupt stop cannot replace
      // the last readable extraction.
      forcedTermination = setTimeout(() => finish(abortError()), 750);
      forcedTermination.unref?.();
    };
    input.signal?.addEventListener('abort', cancel, { once: true });
    worker.on('message', (message: any) => {
      if (message?.kind === 'progress') {
        input.onProgress?.(message.progress);
        return;
      }
      if (message?.kind === 'remote-ocr') {
        const respond = (value: { text?: string; error?: string }) => {
          if (!settled) worker.postMessage({ kind: 'remote-ocr-result', requestId: message.requestId, ...value });
        };
        if (!input.remoteOcr) {
          respond({ error: 'Remote OCR is not configured.' });
          return;
        }
        void input.remoteOcr({ page: Number(message.page) || 0, image: Buffer.from(message.image), mimeType: message.mimeType }, input.signal)
          .then((text) => respond({ text }), (error) => respond({ error: error instanceof Error ? error.message : String(error) }));
        return;
      }
      if (message?.kind === 'done') finish(undefined, message.result);
      if (message?.kind === 'error') {
        const error = new Error(message.error ?? 'Library extraction worker failed.');
        error.name = message.name ?? 'Error';
        finish(error);
      }
    });
    worker.once('error', (error) => finish(error));
    worker.once('exit', (code) => {
      if (!settled) finish(input.signal?.aborted ? abortError() : new Error(`Library extraction worker exited with code ${code}.`));
    });
    worker.postMessage({
      kind: 'run',
      item: input.item,
      root: input.store.root,
      deviceId: input.store.deviceId,
      extractionOptions: input.extractionOptions,
    });
  });
}

export function disposeLibraryExtractionWorkers(): void {
  for (const worker of activeWorkers) void worker.terminate().catch(() => undefined);
  activeWorkers.clear();
}
