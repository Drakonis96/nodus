import type { EvidenceLocator, OpenEvidenceAtPageResult } from '@shared/types';
import type { LibraryScope } from '@shared/libraryTypes';

/**
 * Every "open the source of this citation" action goes through here.
 *
 * A citation knows its page (`[[p. N]]` locations, passage page labels, study
 * material markers), but the page is only useful if the click lands on it. The
 * main process decides what can honour it — Zotero's reader when the work has a
 * PDF attachment there, otherwise the library copy — and this module finishes
 * the job for the cases the main process cannot do itself, because opening the
 * in-app reader means navigating the renderer.
 */

export const OPEN_LIBRARY_DOCUMENT_EVENT = 'nodus:open-library-document';

export interface OpenLibraryDocumentDetail {
  itemId: string;
  scope: LibraryScope;
  page: number | null;
  attachmentId?: string | null;
}

/** Ask the app shell to open a library document in the reader, at `page` when given. */
export function requestLibraryDocumentOpen(detail: OpenLibraryDocumentDetail): void {
  window.dispatchEvent(new CustomEvent<OpenLibraryDocumentDetail>(OPEN_LIBRARY_DOCUMENT_EVENT, { detail }));
}

/**
 * Open the exact point a citation points at. Resolves to what happened so callers
 * can fall back further; failures never throw.
 */
export async function openEvidenceAtPage(
  nodusId: string,
  locator: EvidenceLocator | string | null,
): Promise<OpenEvidenceAtPageResult> {
  const nothing: OpenEvidenceAtPageResult = { ok: false, mode: 'none', page: null, local: null };
  let result = nothing;
  try {
    result = await window.nodus.openEvidenceAtPage(nodusId, locator);
  } catch {
    // A refused custom scheme (Zotero not installed) or an IPC fault must degrade
    // to the library copy, not to a dead click.
  }
  if (result.mode === 'local' && result.local) {
    requestLibraryDocumentOpen({ itemId: result.local.itemId, scope: result.local.scope, page: result.page });
    return result;
  }
  if (result.ok) return result;
  await openLibraryCopy(nodusId, result.page);
  return result;
}

/**
 * Last resort: the corpus copy, which is what the citation modal's "local
 * library" action has always opened. Without a page-capable document this is a
 * document opener, not a page jump.
 */
async function openLibraryCopy(nodusId: string, page: number | null): Promise<void> {
  let scope: LibraryScope | null = null;
  try {
    const [globalItem, reader] = await Promise.allSettled([
      window.nodus.getGlobalLibraryItem(nodusId),
      window.nodus.getLibraryReaderDocument(nodusId),
    ]);
    const item = globalItem.status === 'fulfilled' ? globalItem.value : null;
    const document = reader.status === 'fulfilled' ? reader.value : null;
    if (item && (item.attachments.length > 0 || Boolean(item.files?.reader))) scope = 'global';
    else if (document && (document.cleanAvailable || document.originalAvailable)) scope = 'vault';
  } catch {
    return;
  }
  if (!scope) return;
  requestLibraryDocumentOpen({ itemId: nodusId, scope, page });
}

/** Locator for one anchored evidence row. */
export function evidenceLocator(item: {
  location?: string | null;
  source_ref?: string | null;
  page_number?: number | null;
}): EvidenceLocator {
  return {
    location: item.location ?? null,
    sourceRef: item.source_ref ?? null,
    pageNumber: item.page_number ?? null,
  };
}
