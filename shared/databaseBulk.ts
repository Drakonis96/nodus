/**
 * Pure helpers for the bulk file upload: matching a set of file names against a
 * database's rows by a reference column's value. Dependency-free so the matching is
 * unit-tested without a database or the filesystem.
 */

export function normalizeKey(s: string): string {
  return s.trim().toLowerCase();
}

/** A file's match key: its base name without the extension, normalized. */
export function fileMatchKey(fileName: string): string {
  return normalizeKey(fileName.replace(/\.[^.]+$/, ''));
}

export interface BulkRowRef {
  rowId: string;
  /** The reference column's display value for this row. */
  refValue: string | null;
}

export interface BulkMatch {
  fileName: string;
  rowId: string | null;
}

/**
 * Match each file to a row: a file matches when its full name OR its name without the
 * extension equals a row's reference value (case-insensitive, trimmed). The first row
 * with a given value wins; a file with no match gets rowId=null.
 */
export function matchFilesToRows(fileNames: string[], rows: BulkRowRef[]): BulkMatch[] {
  const byKey = new Map<string, string>();
  for (const r of rows) {
    const v = r.refValue?.trim();
    if (!v) continue;
    const k = normalizeKey(v);
    if (!byKey.has(k)) byKey.set(k, r.rowId);
  }
  return fileNames.map((fileName) => {
    const withExt = normalizeKey(fileName);
    const noExt = fileMatchKey(fileName);
    const rowId = byKey.get(withExt) ?? byKey.get(noExt) ?? null;
    return { fileName, rowId };
  });
}

export function countMatches(matches: BulkMatch[]): { matched: number; unmatched: number } {
  let matched = 0;
  for (const m of matches) if (m.rowId) matched++;
  return { matched, unmatched: matches.length - matched };
}
