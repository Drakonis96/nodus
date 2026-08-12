// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

/** Run disk-heavy Library maintenance away from Electron's main thread. */
import fs from 'node:fs';
import { parentPort } from 'node:worker_threads';
import { LibraryCatalog } from '../library/libraryCatalog';
import { LibraryOperations } from '../library/libraryOperations';
import { LibraryDiskStore } from '../library/libraryStorage';

export type LibraryWorkerOperation =
  | 'rebuild'
  | 'ensure-citation-keys'
  | 'import-files'
  | 'import-bibliography'
  | 'duplicate-item'
  | 'update-collection'
  | 'delete-collection'
  | 'patch-item-collections'
  | 'set-items-deleted'
  | 'add-attachments'
  | 'update-attachment'
  | 'replace-attachment'
  | 'remove-attachment'
  | 'patch-tags'
  | 'audit-recovery'
  | 'list-duplicates'
  | 'trash-impact'
  | 'purge-trash'
  | 'merge-impact'
  | 'merge-items'
  | 'bibliography-records'
  | 'export-bibliography'
  | 'probe-reading';

interface OperationRequest {
  operation: LibraryWorkerOperation;
  root: string;
  deviceId: string;
  catalogFile: string;
  args: unknown[];
}

async function execute(operations: LibraryOperations, catalog: LibraryCatalog, store: LibraryDiskStore, request: OperationRequest): Promise<unknown> {
  const args = request.args as any[];
  switch (request.operation) {
    case 'rebuild': return catalog.rebuild(store);
    case 'ensure-citation-keys': return operations.ensureCitationKeys();
    case 'import-files': return operations.importLocalFiles(args[0], args[1]);
    case 'import-bibliography': return operations.importBibliographyFiles(args[0], args[1]);
    case 'duplicate-item': return operations.duplicateItem(args[0]);
    case 'update-collection': return operations.updateCollection(args[0], args[1]);
    case 'delete-collection': return operations.deleteCollection(args[0], args[1]);
    case 'patch-item-collections': return operations.patchItemCollections(args[0], args[1]);
    case 'set-items-deleted': return operations.setItemsDeleted(args[0], args[1]);
    case 'add-attachments': return operations.addAttachments(args[0], args[1]);
    case 'update-attachment': return operations.updateAttachment(args[0], args[1], args[2]);
    case 'replace-attachment': return operations.replaceAttachment(args[0], args[1], args[2]);
    case 'remove-attachment': return operations.removeAttachment(args[0], args[1]);
    case 'patch-tags': return operations.patchItemTags(args[0], args[1]);
    case 'audit-recovery': return operations.auditRecovery();
    case 'list-duplicates': return operations.listDuplicateGroups();
    case 'trash-impact': return operations.trashImpact(args[0]);
    case 'purge-trash': return operations.purgeTrash(args[0]);
    case 'merge-impact': return operations.mergeImpact(args[0], args[1]);
    case 'merge-items': return operations.mergeItems(args[0], args[1]);
    case 'bibliography-records':
      operations.ensureCitationKeys();
      return operations.bibliographyRecords(args[0]);
    case 'export-bibliography':
      operations.ensureCitationKeys();
      return operations.exportBibliography(args[0]);
    case 'probe-reading': {
      const file = String(args[0] ?? '');
      const mimeType = String(args[1] ?? '');
      if (mimeType !== 'application/pdf') return { pageCount: null };
      const { PDFDocument } = await import('pdf-lib');
      const pdf = await PDFDocument.load(fs.readFileSync(file), { ignoreEncryption: true, updateMetadata: false });
      return { pageCount: pdf.getPageCount() };
    }
  }
}

parentPort?.once('message', (request: OperationRequest) => {
  const catalog = new LibraryCatalog(request.catalogFile);
  try {
    const store = new LibraryDiskStore(request.root, request.deviceId);
    const operations = new LibraryOperations(store, catalog);
    void execute(operations, catalog, store, request)
      .then((result) => { catalog.close(); parentPort!.postMessage({ ok: true, result }); })
      .catch((error) => { catalog.close(); parentPort!.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }); });
  } catch (error) {
    catalog.close();
    parentPort!.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});
