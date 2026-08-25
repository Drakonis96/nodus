import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
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
  const requireFromHere = createRequire(__filename);
  const pdfjsRoot = path.dirname(requireFromHere.resolve('pdfjs-dist/package.json'));
  const data = new Uint8Array(fs.readFileSync(filePath));
  // Supplying PDF.js' bundled standard fonts is essential for raster output.
  // Without it, PDFs using Helvetica/Times can expose a valid text layer while
  // rendering blank glyphs in the Node canvas used by facsimile translation.
  const standardFontDataUrl = pathToFileURL(path.join(pdfjsRoot, 'standard_fonts') + path.sep).href;
  const task = pdfjs.getDocument({ data, useSystemFonts: true, standardFontDataUrl, isEvalSupported: false, disableFontFace: true });
  return task.promise;
}

/** Rebuild page lines before normalising them. Flattening every PDF.js item with a
 * space destroys real line endings, prevents safe de-hyphenation and can split words. */
export async function pageText(page: any): Promise<string> {
  const content = await page.getTextContent();
  const lines: string[] = [];
  let line = '';
  let lastY: number | null = null;
  let lastEndX: number | null = null;
  let lineHeight = 8;
  const flush = () => {
    const value = line.replace(/[\t ]+/g, ' ').trim();
    if (value) lines.push(value);
    line = '';
    lastEndX = null;
  };
  for (const item of content.items as any[]) {
    const value = typeof item?.str === 'string' ? item.str : '';
    if (!value) {
      if (item?.hasEOL) flush();
      continue;
    }
    const transform = Array.isArray(item.transform) ? item.transform : [];
    const x = Number(transform[4]);
    const y = Number(transform[5]);
    const height = Math.abs(Number(item.height) || Number(transform[3]) || lineHeight);
    const changedLine = lastY !== null && Number.isFinite(y) && Math.abs(y - lastY) > Math.max(2, Math.min(lineHeight, height) * 0.45);
    if (changedLine) flush();
    const gap = lastEndX !== null && Number.isFinite(x) ? x - lastEndX : Number.POSITIVE_INFINITY;
    const needsSpace = Boolean(line) && (gap > Math.max(0.5, height * 0.08) || /\s$/u.test(line) || /^\s/u.test(value));
    line += `${needsSpace ? ' ' : ''}${value.trim()}`;
    lastY = Number.isFinite(y) ? y : lastY;
    lastEndX = Number.isFinite(x) ? x + Math.max(0, Number(item.width) || 0) : null;
    lineHeight = height || lineHeight;
    if (item?.hasEOL) flush();
  }
  flush();

  const joined: string[] = [];
  for (const current of lines) {
    const previous = joined.at(-1);
    if (previous && /\p{L}-$/u.test(previous) && /^\p{Ll}/u.test(current)) {
      joined[joined.length - 1] = `${previous.slice(0, -1)}${current}`;
    } else {
      joined.push(current);
    }
  }
  return joined.join('\n').trim();
}
