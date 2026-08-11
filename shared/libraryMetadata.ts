// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

import type { LibraryItemMetadata } from './libraryTypes';

/** Apply a resolver candidate without erasing user-owned values absent from that source. */
export function mergeLibraryMetadataCandidate(current: LibraryItemMetadata, candidate: LibraryItemMetadata): LibraryItemMetadata {
  const populated = Object.fromEntries(Object.entries(candidate)
    .filter(([, value]) => value != null && (!Array.isArray(value) || value.length > 0))) as Partial<LibraryItemMetadata>;
  return {
    ...current,
    ...populated,
    isbn: [...new Set([...(current.isbn ?? []), ...(candidate.isbn ?? [])])],
    issn: [...new Set([...(current.issn ?? []), ...(candidate.issn ?? [])])],
    tags: [...new Set([...(current.tags ?? []), ...(candidate.tags ?? [])])],
    extra: { ...(current.extra ?? {}), ...(candidate.extra ?? {}) },
  };
}
