/**
 * Where a work's text came from, read back from the extraction notes the text extractor writes
 * (Spanish, as all internal notes): pages recovered by OCR, pages the OCR page cap left out, and
 * pages with no text at all. Used to mark scanned books in the library and in cited evidence.
 */
export interface TextProvenance {
  /** Pages whose text came from OCR. */
  ocrPages: number;
  /** Pages not processed because the document exceeded the OCR page cap. */
  cappedPages: number;
  /** The cap those pages exceeded, when the note says. */
  cap: number | null;
  /** Pages with no text that OCR did not recover. */
  blankPages: number;
}

export function parseTextNotes(notes: string | null | undefined): TextProvenance {
  const text = notes ?? '';
  const sum = (pattern: RegExp) => [...text.matchAll(pattern)].reduce((total, match) => total + Number(match[1]), 0);
  const ocrPages = sum(/(\d+)\s+página\(s\)\s+recuperadas por OCR/g);
  let cappedPages = sum(/(\d+)\s+página\(s\)\s+no procesadas:\s+superan el límite de OCR/g);
  let blankPages = sum(/(\d+)\s+página\(s\)\s+sin texto omitidas/g);
  let cap = Number(/límite de OCR \((\d+) páginas/.exec(text)?.[1] ?? NaN);
  // Notes written before the cap was reported separately: OCR stopping at a round figure (the
  // 300 default, or 1,000) with pages still left over means the cap cut the book short.
  if (!cappedPages && blankPages > 0 && ocrPages >= 300 && ocrPages % 100 === 0) {
    cappedPages = blankPages;
    blankPages = 0;
    cap = ocrPages;
  }
  return { ocrPages, cappedPages, cap: Number.isFinite(cap) ? cap : null, blankPages };
}

/** A work read mostly through OCR: at least half of its known pages. `pageCount` is the highest
 *  page number among its passages, when known. */
export function isScannedWork(provenance: TextProvenance, pageCount: number | null): boolean {
  if (!provenance.ocrPages) return false;
  const pages = Math.max(pageCount ?? 0, provenance.ocrPages + provenance.cappedPages);
  return provenance.ocrPages / Math.max(1, pages) >= 0.5;
}
