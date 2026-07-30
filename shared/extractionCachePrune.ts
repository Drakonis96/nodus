// Which rows of the extracted-text cache to drop.
//
// `extraction_cache` holds the full text pulled out of every PDF ever scanned,
// keyed by file path, written with an upsert and never deleted. On a real library
// it reached 105 MB across 211 rows — a quarter of the whole vault file — and it
// grows with every document the user ever opens. It is also copied verbatim into
// every backup archive.
//
// The policy is deliberately kept out of the repository so it can be tested
// without a database: give it the rows and it says which paths to remove.

export interface ExtractionCacheEntry {
  filePath: string;
  /** Size of the cached text in bytes. */
  bytes: number;
  /** ISO timestamp of the last write for this path. */
  updatedAt: string;
}

export interface ExtractionCachePruneOptions {
  /** Cap for the total cached text kept. */
  maxBytes: number;
}

export interface ExtractionCachePrunePlan {
  /** Paths to delete, in no particular order. */
  remove: string[];
  /** Bytes the deletions free. */
  freedBytes: number;
  /** Bytes left after the deletions. */
  keptBytes: number;
}

/**
 * Decide what to evict: keep entries newest-first until `maxBytes` is reached and
 * drop the rest.
 *
 * Recency here is the last *write*, which is when the text was extracted. There is
 * no read timestamp to do true LRU with, and adding one would mean writing to the
 * database on every cache *hit* — a worse trade than evicting slightly wrong.
 *
 * Deliberately NOT a rule: "drop entries whose document no longer exists". It reads
 * as the obvious first pass, but a Zotero attachment on a cloud-synced or removable
 * volume is missing exactly when the volume is, and throwing its text away costs a
 * full re-extraction — OCR included — for no gain the size cap does not already
 * give. A cache that is merely bounded is enough.
 *
 * Nothing here is load-bearing for correctness: every evicted entry is re-derived
 * from its PDF the next time that document is scanned.
 */
export function planExtractionCacheEviction(
  entries: ExtractionCacheEntry[],
  { maxBytes }: ExtractionCachePruneOptions
): ExtractionCachePrunePlan {
  const remove: string[] = [];
  let freedBytes = 0;
  let keptBytes = 0;

  // Newest first. Ties break on path so the plan is deterministic — two entries
  // written in the same millisecond must not evict differently between runs.
  const ordered = [...entries].sort((a, b) =>
    a.updatedAt === b.updatedAt ? a.filePath.localeCompare(b.filePath) : a.updatedAt < b.updatedAt ? 1 : -1
  );

  for (const entry of ordered) {
    if (keptBytes + entry.bytes <= maxBytes) {
      keptBytes += entry.bytes;
      continue;
    }
    remove.push(entry.filePath);
    freedBytes += entry.bytes;
  }

  return { remove, freedBytes, keptBytes };
}
