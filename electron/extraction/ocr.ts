// Local OCR for scanned PDFs without a text layer. Heavy deps (tesseract.js +
// @napi-rs/canvas) are imported lazily so the app works without them — if they are
// unavailable the caller catches the error and marks the work `skipped_no_text`.
//
// NOTE: Tesseract.js downloads its language traineddata on first use. This is the
// one outbound call outside the AI provider, it is OPT-IN (ocrEnabled, default off),
// and the data is cached locally afterwards.

export interface OcrProgress {
  page: number;
  totalPages: number;
}

let canvasModPromise: Promise<any> | null = null;
async function getCanvas(): Promise<any> {
  if (!canvasModPromise) canvasModPromise = import('@napi-rs/canvas');
  return canvasModPromise;
}

/** Render one pdfjs page to a PNG buffer at a DPI suitable for OCR. */
async function renderPageToPng(page: any, scale = 2.5): Promise<Buffer> {
  const { createCanvas } = await getCanvas();
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx as any, viewport }).promise;
  return canvas.toBuffer('image/png');
}

/**
 * OCR the given 1-based page numbers of an already-open pdfjs document.
 * Returns a map of pageNumber -> recognized text.
 */
/**
 * OCR a standalone image file (PNG/JPEG/TIFF/…). Simpler than the PDF path — no
 * page rendering — since Tesseract reads the image file directly. Returns the
 * recognised text (trimmed), or throws if the OCR deps are unavailable (the caller
 * degrades to no text).
 */
export async function ocrImageFile(filePath: string, languages: string): Promise<string> {
  const Tesseract: any = await import('tesseract.js');
  const worker = await Tesseract.createWorker(languages);
  try {
    const { data } = await worker.recognize(filePath);
    return (data?.text ?? '').trim();
  } finally {
    await worker.terminate();
  }
}

export async function ocrPdfPages(
  pdf: any,
  pageNumbers: number[],
  languages: string,
  onProgress?: (p: OcrProgress) => void
): Promise<Map<number, string>> {
  const Tesseract: any = await import('tesseract.js');
  const worker = await Tesseract.createWorker(languages);
  const out = new Map<number, string>();
  try {
    let done = 0;
    for (const n of pageNumbers) {
      const page = await pdf.getPage(n);
      const png = await renderPageToPng(page);
      page.cleanup?.();
      const { data } = await worker.recognize(png);
      out.set(n, (data?.text ?? '').trim());
      done++;
      onProgress?.({ page: done, totalPages: pageNumbers.length });
    }
  } finally {
    await worker.terminate();
  }
  return out;
}
