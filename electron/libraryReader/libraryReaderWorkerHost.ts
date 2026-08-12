// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { LibraryReaderAttachmentContent, WritingDraftAnnotation, WritingDraftAnnotationInput } from '@shared/types';
import {
  createLibraryReaderAnnotation,
  deleteLibraryReaderAnnotation,
  getLibraryReaderAttachmentContent,
  libraryReaderAnnotationContext,
  libraryReaderAttachmentTask,
  updateLibraryReaderComment,
} from './libraryReaderStore';

type ReaderWorkerRequest =
  | { operation: 'attachment-content'; task: NonNullable<ReturnType<typeof libraryReaderAttachmentTask>> }
  | { operation: 'annotation-create'; workId: string; context: NonNullable<ReturnType<typeof libraryReaderAnnotationContext>>; input: WritingDraftAnnotationInput }
  | { operation: 'annotation-update-comment'; workId: string; context: NonNullable<ReturnType<typeof libraryReaderAnnotationContext>>; id: string; comment: string }
  | { operation: 'annotation-delete'; context: NonNullable<ReturnType<typeof libraryReaderAnnotationContext>>; id: string };

let mutationTail: Promise<unknown> = Promise.resolve();
const activeWorkers = new Set<Worker>();

function workerFile(): string {
  return process.env.NODUS_LIBRARY_READER_WORKER_FILE || path.join(__dirname, 'libraryReaderWorker.js');
}

export function libraryReaderWorkerAvailable(): boolean {
  return process.env.NODUS_DISABLE_LIBRARY_READER_WORKER !== '1' && fs.existsSync(workerFile());
}

function executeWorker<T>(request: ReaderWorkerRequest): Promise<T> {
  const worker = new Worker(workerFile());
  worker.unref();
  activeWorkers.add(worker);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, result?: T): void => {
      if (settled) return;
      settled = true;
      activeWorkers.delete(worker);
      void worker.terminate().catch(() => undefined);
      if (error) reject(error); else resolve(result!);
    };
    worker.once('message', (message: { ok: boolean; result?: T; error?: string }) => {
      if (message.ok) finish(undefined, message.result);
      else finish(new Error(message.error ?? `Library reader ${request.operation} worker failed.`));
    });
    worker.once('error', (error) => finish(error));
    worker.once('exit', (code) => { if (!settled) finish(new Error(`Library reader ${request.operation} worker exited with code ${code}.`)); });
    worker.postMessage(request);
  });
}

function runMutation<T>(request: ReaderWorkerRequest, fallback: () => T): Promise<T> {
  const execute = async () => {
    const delay = Number(process.env.NODUS_E2E_LIBRARY_READER_WRITE_DELAY_MS || 0);
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(delay, 5_000)));
    return libraryReaderWorkerAvailable() ? executeWorker<T>(request) : Promise.resolve().then(fallback);
  };
  const task = mutationTail.then(execute, execute);
  mutationTail = task.then(() => undefined, () => undefined);
  return task;
}

export async function getLibraryReaderAttachmentContentInWorker(documentId: string, attachmentId: string): Promise<LibraryReaderAttachmentContent | null> {
  const task = libraryReaderAttachmentTask(documentId, attachmentId);
  if (!task) return null;
  return libraryReaderWorkerAvailable()
    ? executeWorker<LibraryReaderAttachmentContent | null>({ operation: 'attachment-content', task })
    : getLibraryReaderAttachmentContent(documentId, attachmentId);
}

export function createLibraryReaderAnnotationInWorker(workId: string, input: WritingDraftAnnotationInput): Promise<WritingDraftAnnotation> {
  const context = libraryReaderAnnotationContext(workId);
  if (!context) return Promise.reject(new Error('La versión de lectura ya no existe.'));
  return runMutation({ operation: 'annotation-create', workId, context, input }, () => createLibraryReaderAnnotation(workId, input));
}

export function updateLibraryReaderCommentInWorker(workId: string, id: string, comment: string): Promise<WritingDraftAnnotation | null> {
  const context = libraryReaderAnnotationContext(workId);
  if (!context) return Promise.resolve(null);
  return runMutation({ operation: 'annotation-update-comment', workId, context, id, comment }, () => updateLibraryReaderComment(workId, id, comment));
}

export function deleteLibraryReaderAnnotationInWorker(workId: string, id: string): Promise<boolean> {
  const context = libraryReaderAnnotationContext(workId);
  if (!context) return Promise.resolve(false);
  return runMutation({ operation: 'annotation-delete', context, id }, () => deleteLibraryReaderAnnotation(workId, id));
}

export function disposeLibraryReaderWorkers(): void {
  for (const worker of activeWorkers) void worker.terminate().catch(() => undefined);
  activeWorkers.clear();
}
