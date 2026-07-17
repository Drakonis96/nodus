// Pure helpers for page-range expressions like "1-3,5,8-10", shared by the PDF
// utilities. Kept dependency-free so it can be unit-tested directly and reused
// by both the split and rotate operations.

/**
 * Parse a 1-based page-range expression into an ordered, de-duplicated list of
 * 1-based page numbers, clamped to `pageCount`. An empty/whitespace expression
 * means "all pages" (1..pageCount). Invalid tokens are ignored rather than
 * throwing, so a stray character never aborts a batch — but a wholly invalid,
 * non-empty expression yields an empty selection (the caller decides what that
 * means). Reversed ranges ("5-3") are read low→high.
 */
export function parsePageRanges(expr: string, pageCount: number): number[] {
  const trimmed = (expr ?? '').trim();
  if (!trimmed) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const seen = new Set<number>();
  const out: number[] = [];
  for (const rawPart of trimmed.split(',')) {
    const part = rawPart.trim();
    if (!part) continue;
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      let lo = Number(range[1]);
      let hi = Number(range[2]);
      if (lo > hi) [lo, hi] = [hi, lo];
      for (let p = lo; p <= hi; p++) addPage(p, pageCount, seen, out);
      continue;
    }
    if (/^\d+$/.test(part)) addPage(Number(part), pageCount, seen, out);
  }
  return out;
}

function addPage(p: number, pageCount: number, seen: Set<number>, out: number[]): void {
  if (p < 1 || p > pageCount || seen.has(p)) return;
  seen.add(p);
  out.push(p);
}

/**
 * Parse an explicit reorder expression ("3,1,2") into 1-based page numbers. Unlike
 * {@link parsePageRanges} the order is preserved verbatim and duplicates are
 * dropped keeping the first occurrence. An empty expression keeps the original
 * order (1..pageCount). Pages omitted from a non-empty expression are dropped —
 * that is how "eliminate a page" works.
 */
export function parsePageOrder(expr: string, pageCount: number): number[] {
  const trimmed = (expr ?? '').trim();
  if (!trimmed) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const seen = new Set<number>();
  const out: number[] = [];
  for (const rawPart of trimmed.split(',')) {
    const part = rawPart.trim();
    if (!/^\d+$/.test(part)) continue;
    addPage(Number(part), pageCount, seen, out);
  }
  return out;
}
