import { loadPdfjs, pageText } from './pdfjsLoader';

/** Under this many characters a page carries no usable text layer. */
export const TEXTLESS_PAGE_CHARACTERS = 50;
/** Pages read up front, spread across the document, before any full pass. */
export const SCAN_SAMPLE_PAGES = 16;
/** Below this average a document with image pages is a scan with a residual text layer
 * (running heads, page numbers). The sparsest digital book among real deferred sources,
 * a photography history, averaged 390 characters per page. */
export const SCAN_CHARACTERS_PER_PAGE = 200;

export async function pagePaintsImage(page: any): Promise<boolean> {
  const pdfjs = await loadPdfjs();
  const operators = await page.getOperatorList();
  return operators.fnArray.some((op: number) => [pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintImageMaskXObject, pdfjs.OPS.paintJpegXObject].includes(op));
}

/** A PDF waits for OCR only when it paints image-only pages and most pages have no text
 * layer, or the text it has is too sparse to be the document. A cover, a plate or a
 * photograph does not make a digital book a scan: a digitized travel book or a history
 * of photography keeps its text, and its image-only pages simply have none. Measured on
 * real deferred sources, the old any-page rule set aside 47 of 52 digital books. */
export function isScannedDocument(counts: { pages: number; textless: number; imageOnly: number; characters: number }): boolean {
  return counts.imageOnly > 0 && (counts.textless * 2 > counts.pages || counts.characters < counts.pages * SCAN_CHARACTERS_PER_PAGE);
}

/** The first and last pages and evenly spaced ones between them, in order. */
export function scanSamplePages(pages: number, size = SCAN_SAMPLE_PAGES): number[] {
  if (pages <= size) return Array.from({ length: pages }, (_, index) => index + 1);
  return [...new Set(Array.from({ length: size }, (_, index) => 1 + Math.round(index * (pages - 1) / (size - 1))))];
}

/** Decide from a spread sample instead of reading a whole scan page by page: a scan is
 * image-only nearly everywhere, a digital document has text nearly everywhere. A
 * document no longer than the sample is decided exactly; a mixed one stays undecided and
 * is counted in full by the caller. */
export async function sampleScanVerdict(pdf: any, signal?: AbortSignal): Promise<'scan' | 'digital' | 'undecided'> {
  const sample = scanSamplePages(pdf.numPages);
  let textless = 0, imageOnly = 0, characters = 0;
  for (const number of sample) {
    signal?.throwIfAborted();
    const page = await pdf.getPage(number);
    try {
      const length = (await pageText(page)).trim().length;
      characters += length;
      if (length >= TEXTLESS_PAGE_CHARACTERS) continue;
      textless += 1;
      if (await pagePaintsImage(page)) imageOnly += 1;
    } finally { page.cleanup?.(); }
  }
  if (sample.length === pdf.numPages) return isScannedDocument({ pages: pdf.numPages, textless, imageOnly, characters }) ? 'scan' : 'digital';
  if (imageOnly > 0 && textless * 4 >= sample.length * 3) return 'scan';
  // Only a clear margin settles a digital document early; anything closer is counted in full.
  if (textless * 4 <= sample.length && characters >= sample.length * SCAN_CHARACTERS_PER_PAGE * 2) return 'digital';
  return 'undecided';
}
