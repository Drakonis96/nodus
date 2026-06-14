import fs from 'node:fs';

// Single place to load the pdfjs legacy build (no DOM) and open a document.
// pdfjs is an ESM-only package; dynamic import keeps it external to the main bundle.
export async function loadPdfjs(): Promise<any> {
  return import('pdfjs-dist/legacy/build/pdf.mjs');
}

export async function openPdf(filePath: string): Promise<any> {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(fs.readFileSync(filePath));
  const task = pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false, disableFontFace: true });
  return task.promise;
}

/** Concatenate a page's text items into a single string. */
export async function pageText(page: any): Promise<string> {
  const content = await page.getTextContent();
  return content.items
    .map((it: any) => (typeof it.str === 'string' ? it.str : ''))
    .filter(Boolean)
    .join(' ')
    .trim();
}
