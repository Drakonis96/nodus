import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Single place to load the pdfjs legacy build (no DOM) and open a document.
// pdfjs is an ESM-only package; dynamic import keeps it external to the main bundle.
export async function loadPdfjs(): Promise<any> {
  // The import() is hidden inside new Function so CJS transpilers (the headless
  // scripts/ harness) don't rewrite it to require(), which crashes on an
  // ESM-only package. But code built by new Function has no module referrer —
  // a bare specifier would resolve from process.cwd(), which is "/" when the
  // packaged app is launched from the desktop. Resolve to an absolute file URL
  // from this module's location first. (__filename exists in both worlds: the
  // vite banner defines it for the ESM main bundle, CJS provides it natively.)
  const entry = createRequire(__filename).resolve('pdfjs-dist/legacy/build/pdf.mjs');
  const dynamicImport = new Function('specifier', 'return import(specifier)');
  return dynamicImport(pathToFileURL(entry).href);
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
