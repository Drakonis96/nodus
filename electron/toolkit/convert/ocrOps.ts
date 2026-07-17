// Nodus Toolkit — OCR (category C). Electron-free: tesseract.js for recognition
// (its language traineddata is the Toolkit's only network call, opt-in and cached),
// pdfjs + @napi-rs/canvas for rendering scanned pages, pd-lib for the searchable
// sandwich. Heavy deps load lazily. The traineddata cache location is taken from
// NODUS_TESSDATA_CACHE (main sets it to userData; tests point it at a repo cache).
import fs from 'node:fs';
import type { ToolkitOpRegistry, ToolkitRunContext } from '../toolkitJobs';
import type { ToolkitProduced } from '@shared/toolkitTypes';
import { openPdf } from '../../extraction/pdfjsLoader';

const enc = new TextEncoder();

async function getCanvas() {
  return import('@napi-rs/canvas');
}

function languagesFrom(ctx: ToolkitRunContext): string {
  const value = String(ctx.options.languages ?? '').trim();
  return value || 'spa+eng';
}

async function makeWorker(languages: string): Promise<any> {
  const Tesseract: any = await import('tesseract.js');
  const cachePath = process.env.NODUS_TESSDATA_CACHE?.trim();
  const options: any = {};
  if (cachePath) options.cachePath = cachePath;
  return Tesseract.createWorker(languages, undefined, options);
}

interface OcrWord {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

/** Flatten tesseract.js v5 nested output (blocks → paragraphs → lines → words). */
function flattenWords(data: any): OcrWord[] {
  const words: OcrWord[] = [];
  for (const block of data?.blocks ?? []) {
    for (const para of block?.paragraphs ?? []) {
      for (const line of para?.lines ?? []) {
        for (const word of line?.words ?? []) {
          if (word?.text && word.bbox) words.push({ text: word.text, bbox: word.bbox });
        }
      }
    }
  }
  return words;
}

async function renderPageToPng(page: any, scale: number): Promise<Buffer> {
  const { createCanvas } = await getCanvas();
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx as any, viewport }).promise;
  return canvas.toBuffer('image/png');
}

/** C1 — a standalone image to plain text. */
async function ocrImageToTxt(input: string, ctx: ToolkitRunContext): Promise<ToolkitProduced[]> {
  const worker = await makeWorker(languagesFrom(ctx));
  try {
    const { data } = await worker.recognize(input);
    ctx.onPageProgress(1);
    return [{ data: enc.encode((data?.text ?? '').trim() + '\n'), ext: 'txt' }];
  } finally {
    await worker.terminate();
  }
}

/** C2 — every page of a scanned PDF to plain text. */
async function ocrPdfToTxt(input: string, ctx: ToolkitRunContext): Promise<ToolkitProduced[]> {
  const worker = await makeWorker(languagesFrom(ctx));
  const pdf = await openPdf(input);
  const parts: string[] = [];
  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      if (ctx.signal.cancelled) break;
      const page = await pdf.getPage(p);
      const png = await renderPageToPng(page, 2.5);
      page.cleanup?.();
      const { data } = await worker.recognize(png);
      parts.push((data?.text ?? '').trim());
      ctx.onPageProgress(p / pdf.numPages);
    }
  } finally {
    await pdf.destroy?.();
    await worker.terminate();
  }
  return [{ data: enc.encode(parts.join('\n\n').trim() + '\n'), ext: 'txt' }];
}

// WinAnsi-safe text for the invisible layer: pd-lib's standard fonts can't encode
// arbitrary Unicode, and the layer only needs to be searchable, not legible.
function sanitizeForFont(text: string): string {
  // ASCII printable + Latin-1 supplement (covers Spanish accents); drop the rest.
  return text.replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '').trim();
}

/** C3 — a scanned PDF to a searchable PDF: keep the original pages, overlay an
 *  invisible OCR text layer positioned by Tesseract word boxes. */
async function ocrPdfSearchable(input: string, ctx: ToolkitRunContext): Promise<ToolkitProduced[]> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const worker = await makeWorker(languagesFrom(ctx));
  const scale = 2;
  const doc = await PDFDocument.load(new Uint8Array(fs.readFileSync(input)));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pdf = await openPdf(input);
  try {
    const pages = doc.getPages();
    const count = Math.min(pages.length, pdf.numPages);
    for (let i = 0; i < count; i++) {
      if (ctx.signal.cancelled) break;
      const pdfjsPage = await pdf.getPage(i + 1);
      const png = await renderPageToPng(pdfjsPage, scale);
      pdfjsPage.cleanup?.();
      const { data } = await worker.recognize(png);
      const page = pages[i];
      const heightPts = page.getHeight();
      for (const word of flattenWords(data)) {
        const text = sanitizeForFont(word.text);
        if (!text) continue;
        const x = word.bbox.x0 / scale;
        const y = heightPts - word.bbox.y1 / scale;
        const size = Math.max(1, (word.bbox.y1 - word.bbox.y0) / scale);
        try {
          page.drawText(text, { x, y, size, font, color: rgb(0, 0, 0), opacity: 0 });
        } catch {
          /* skip a word the standard font cannot encode */
        }
      }
      ctx.onPageProgress((i + 1) / count);
    }
  } finally {
    await pdf.destroy?.();
    await worker.terminate();
  }
  return [{ data: await doc.save(), ext: 'pdf', suffix: ' (buscable)' }];
}

/** Otsu threshold from a 256-bin grayscale histogram. */
function otsuThreshold(histogram: number[], total: number): number {
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * histogram[t];
  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += histogram[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * histogram[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) {
      maxVar = between;
      threshold = t;
    }
  }
  return threshold;
}

/** C4 — grayscale or Otsu-binarize an image (preprocessing for OCR). */
async function preprocessImage(input: string, ctx: ToolkitRunContext): Promise<ToolkitProduced[]> {
  const { createCanvas, loadImage } = await getCanvas();
  const mode = String(ctx.options.mode ?? 'grayscale');
  const image = await loadImage(fs.readFileSync(input));
  const width = image.width;
  const height = image.height;
  const canvas = createCanvas(width, height);
  const cctx = canvas.getContext('2d');
  cctx.drawImage(image, 0, 0);
  const imageData = cctx.getImageData(0, 0, width, height);
  const px = imageData.data;
  const gray = new Uint8Array(width * height);
  const histogram = new Array(256).fill(0);
  for (let i = 0, g = 0; i < px.length; i += 4, g++) {
    const value = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
    gray[g] = value;
    histogram[value]++;
  }
  if (mode === 'binarize') {
    const threshold = otsuThreshold(histogram, width * height);
    for (let i = 0, g = 0; i < px.length; i += 4, g++) {
      const v = gray[g] >= threshold ? 255 : 0;
      px[i] = px[i + 1] = px[i + 2] = v;
      px[i + 3] = 255;
    }
  } else {
    for (let i = 0, g = 0; i < px.length; i += 4, g++) {
      px[i] = px[i + 1] = px[i + 2] = gray[g];
      px[i + 3] = 255;
    }
  }
  cctx.putImageData(imageData, 0, 0);
  ctx.onPageProgress(1);
  return [{ data: canvas.toBuffer('image/png'), ext: 'png', suffix: mode === 'binarize' ? ' (binarizado)' : ' (grises)' }];
}

export const ocrOps: ToolkitOpRegistry = {
  'ocr-image-to-txt': { arity: 'each', run: ([input], ctx) => ocrImageToTxt(input, ctx) },
  'ocr-pdf-to-txt': { arity: 'each', run: ([input], ctx) => ocrPdfToTxt(input, ctx) },
  'ocr-pdf-searchable': { arity: 'each', run: ([input], ctx) => ocrPdfSearchable(input, ctx) },
  'image-preprocess': { arity: 'each', run: ([input], ctx) => preprocessImage(input, ctx) },
};
