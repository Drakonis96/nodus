// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

/** Keep backup-disk persistence and archive parsing away from Electron's main thread. */
import { parentPort } from 'node:worker_threads';
import type { WritingDraftAnnotationInput } from '@shared/types';
import {
  createLibraryReaderAnnotationFromContext,
  deleteLibraryReaderAnnotationFromContext,
  getLibraryReaderAttachmentContentFromTask,
  updateLibraryReaderCommentFromContext,
  type LibraryReaderAnnotationContext,
  type LibraryReaderAttachmentTask,
} from '../libraryReader/libraryReaderWorkerTasks';

type ReaderWorkerRequest =
  | { operation: 'attachment-content'; task: LibraryReaderAttachmentTask }
  | { operation: 'annotation-create'; workId: string; context: LibraryReaderAnnotationContext; input: WritingDraftAnnotationInput }
  | { operation: 'annotation-update-comment'; workId: string; context: LibraryReaderAnnotationContext; id: string; comment: string }
  | { operation: 'annotation-delete'; context: LibraryReaderAnnotationContext; id: string };

async function execute(request: ReaderWorkerRequest): Promise<unknown> {
  switch (request.operation) {
    case 'attachment-content':
      return getLibraryReaderAttachmentContentFromTask(request.task);
    case 'annotation-create':
      return createLibraryReaderAnnotationFromContext(request.workId, request.context, request.input);
    case 'annotation-update-comment':
      return updateLibraryReaderCommentFromContext(request.workId, request.context, request.id, request.comment);
    case 'annotation-delete':
      return deleteLibraryReaderAnnotationFromContext(request.context, request.id);
  }
}

parentPort?.once('message', (request: ReaderWorkerRequest) => {
  void execute(request).then(
    (result) => parentPort!.postMessage({ ok: true, result }),
    (error) => parentPort!.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }),
  );
});
