// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

import type {
  LibraryItemRecord,
  LibraryMetadataBatchEntry,
  LibraryMetadataIdentifierKind,
  LibraryMetadataLookupResult,
} from '@shared/libraryTypes';

export function libraryItemIdentifier(item: LibraryItemRecord): { kind: LibraryMetadataIdentifierKind; value: string } | null {
  if (item.metadata.doi) return { kind: 'doi', value: item.metadata.doi };
  if (item.metadata.pmid) return { kind: 'pmid', value: item.metadata.pmid };
  if (item.metadata.pmcid) return { kind: 'pmcid', value: item.metadata.pmcid };
  if (item.metadata.arxiv) return { kind: 'arxiv', value: item.metadata.arxiv };
  if (item.metadata.isbn?.[0]) return { kind: 'isbn', value: item.metadata.isbn[0] };
  if (item.metadata.issn?.[0]) return { kind: 'issn', value: item.metadata.issn[0] };
  return null;
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Canceled', 'AbortError')); return; }
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Canceled', 'AbortError')); }, { once: true });
  });
}

export async function runLibraryMetadataBatch(
  items: Array<{ itemId: string; item: LibraryItemRecord | null }>,
  options: {
    signal: AbortSignal;
    rateLimitMs: number;
    resolve: (kind: LibraryMetadataIdentifierKind, value: string, signal: AbortSignal) => Promise<LibraryMetadataLookupResult>;
    onStep?: (entry: LibraryMetadataBatchEntry | null, itemId: string) => void;
  },
): Promise<{ status: 'ready' | 'canceled'; entries: LibraryMetadataBatchEntry[] }> {
  const entries: LibraryMetadataBatchEntry[] = [];
  try {
    for (let index = 0; index < items.length; index += 1) {
      const { itemId, item } = items[index]; if (options.signal.aborted) throw new DOMException('Canceled', 'AbortError');
      options.onStep?.(null, itemId); const detected = item ? libraryItemIdentifier(item) : null;
      let entry: LibraryMetadataBatchEntry;
      if (!item) entry = { itemId, kind: null, value: null, candidate: null, error: 'El documento ya no existe.', applied: false };
      else if (!detected) entry = { itemId, kind: null, value: null, candidate: null, error: 'No hay DOI, ISBN, ISSN, PMID, PMCID ni arXiv.', applied: false };
      else {
        try {
          const lookup = await options.resolve(detected.kind, detected.value, options.signal);
          entry = { itemId, ...detected, candidate: lookup.candidates[0] ?? null, error: lookup.candidates.length ? null : 'Sin resultados.', applied: false };
        } catch (error) {
          if (options.signal.aborted) throw error;
          entry = { itemId, ...detected, candidate: null, error: error instanceof Error ? error.message : String(error), applied: false };
        }
      }
      entries.push(entry); options.onStep?.(entry, itemId);
      if (index < items.length - 1) await delay(Math.max(0, Math.min(10_000, options.rateLimitMs)), options.signal);
    }
    return { status: 'ready', entries };
  } catch (error) {
    if (!options.signal.aborted) throw error;
    return { status: 'canceled', entries };
  }
}
