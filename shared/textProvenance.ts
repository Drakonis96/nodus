/**
 * Where a work's text came from, read back from the extraction notes the text extractor writes
 * (Spanish, as all internal notes): pages recovered by OCR, pages the OCR page cap left out, and
 * pages without recovered text. Historical notes do not establish why text is missing.
 */
export interface TextProvenance {
  /** Pages whose text came from OCR. */
  ocrPages: number;
  /** Pages not processed because the document exceeded the OCR page cap. */
  cappedPages: number;
  /** The cap, only when every capped attachment reports the same known limit. */
  cap: number | null;
  /** Pages without recovered text. Older notes do not establish whether OCR tried them. */
  blankPages: number;
  /** Pages without recovered text for which OCR did not produce a page result. */
  unresolvedPages: number;
  /** The extraction explicitly reported that OCR did not complete. */
  ocrFailed: boolean;
}

export function parseTextNotes(notes: string | null | undefined): TextProvenance {
  const text = notes ?? '';
  const sum = (pattern: RegExp) => [...text.matchAll(pattern)].reduce((total, match) => total + Number(match[1]), 0);
  const ocrPages = sum(/(\d+)\s+página\(s\)\s+recuperadas por OCR/g);
  const cappedNotes = [...text.matchAll(/(\d+)\s+página\(s\)\s+no procesadas:\s+superan el límite de OCR(?:\s+\((\d+) páginas por documento\))?/g)];
  const cappedPages = cappedNotes.reduce((total, match) => total + Number(match[1]), 0);
  const caps = new Set(cappedNotes.map((match) => match[2] ? Number(match[2]) : null));
  const reportedCap = caps.size === 1 ? [...caps][0] : null;
  // Recovered pages are successes, not the number attempted or the configured limit.
  // The old "sin texto omitidas" note cannot distinguish a cap from an unreadable page.
  return {
    ocrPages,
    cappedPages,
    cap: reportedCap !== null && Number.isFinite(reportedCap) && reportedCap > 0 ? reportedCap : null,
    blankPages: sum(/(\d+)\s+página\(s\)\s+sin texto omitidas/g),
    unresolvedPages: sum(/(\d+)\s+página\(s\)\s+sin texto recuperado/g),
    ocrFailed: /OCR no completado\./.test(text),
  };
}

/** At least half of the work's actual total pages were recovered through OCR.
 * `pageCount` must cover every source, including pages without passages; unknown totals
 * and inconsistent inventories are not enough to classify a work as scanned. */
export function isScannedWork(provenance: TextProvenance, pageCount: number | null): boolean {
  if (pageCount === null || !Number.isInteger(pageCount) || pageCount <= 0 || !provenance.ocrPages) return false;
  const reportedPages = provenance.ocrPages + provenance.cappedPages + provenance.blankPages + provenance.unresolvedPages;
  return pageCount >= reportedPages && provenance.ocrPages / pageCount >= 0.5;
}
