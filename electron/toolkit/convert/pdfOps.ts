// Nodus Toolkit — PDF utilities (category B). Electron-free: pdf-lib for
// structural edits, pdfjs (via the shared loader) for pulling embedded images.
// Heavy deps are imported lazily so the module bundles cleanly for unit tests.
import fs from 'node:fs';
import { parsePageRanges, parsePageOrder } from '@shared/toolkitPages';
import type { ToolkitOpRegistry, ToolkitRunContext } from '../toolkitJobs';
import type { ToolkitProduced } from '@shared/toolkitTypes';
import { openPdf, loadPdfjs } from '../../extraction/pdfjsLoader';

async function loadPdfLib() {
  return import('pdf-lib');
}

function readBytes(filePath: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(filePath));
}

function clampQuality(value: unknown, fallback: number): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(100, Math.max(1, n)) : fallback;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/** Render a pdfjs page to an image buffer, optionally grayscale. `scale` maps
 *  PDF points (72 dpi) to output pixels, so scale = dpi / 72. */
async function renderPageToImage(
  page: any,
  scale: number,
  format: 'png' | 'jpeg',
  quality: number,
  grayscale = false,
): Promise<Buffer> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx as any, viewport }).promise;
  if (grayscale) {
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = image.data;
    for (let i = 0; i < px.length; i += 4) {
      const v = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
      px[i] = px[i + 1] = px[i + 2] = v;
    }
    ctx.putImageData(image, 0, 0);
  }
  return format === 'png' ? canvas.toBuffer('image/png') : canvas.toBuffer('image/jpeg', quality);
}

/** Points-per-inch pages for A4 / US Letter. */
const PAGE_SIZES: Record<string, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

/** B1 — merge every input PDF, in the order given, into one document. */
async function mergePdfs(inputs: string[]): Promise<ToolkitProduced[]> {
  const { PDFDocument } = await loadPdfLib();
  const out = await PDFDocument.create();
  for (const input of inputs) {
    const src = await PDFDocument.load(readBytes(input));
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const page of pages) out.addPage(page);
  }
  return [{ data: await out.save(), ext: 'pdf' }];
}

/** B2 — extract the selected pages into a single PDF, or one PDF per page. */
async function splitPdf(input: string, ctx: ToolkitRunContext): Promise<ToolkitProduced[]> {
  const { PDFDocument } = await loadPdfLib();
  const src = await PDFDocument.load(readBytes(input));
  const total = src.getPageCount();
  const pages = parsePageRanges(String(ctx.options.ranges ?? ''), total);
  if (pages.length === 0) throw new Error('El rango de páginas no selecciona ninguna página válida.');
  const mode = String(ctx.options.mode ?? 'single');
  if (mode === 'perPage') {
    const produced: ToolkitProduced[] = [];
    for (const p of pages) {
      if (ctx.signal.cancelled) break;
      const out = await PDFDocument.create();
      const [copied] = await out.copyPages(src, [p - 1]);
      out.addPage(copied);
      produced.push({ data: await out.save(), ext: 'pdf', suffix: `-p${String(p).padStart(2, '0')}` });
    }
    return produced;
  }
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, pages.map((p) => p - 1));
  for (const page of copied) out.addPage(page);
  return [{ data: await out.save(), ext: 'pdf', suffix: ' (paginas)' }];
}

/** B3 — rotate the selected pages by a multiple of 90°, on top of any existing rotation. */
async function rotatePdf(input: string, ctx: ToolkitRunContext): Promise<ToolkitProduced[]> {
  const { PDFDocument, degrees } = await loadPdfLib();
  const doc = await PDFDocument.load(readBytes(input));
  const total = doc.getPageCount();
  const angle = ((Number(ctx.options.angle ?? 90) % 360) + 360) % 360;
  const targets = new Set(parsePageRanges(String(ctx.options.ranges ?? ''), total));
  doc.getPages().forEach((page, index) => {
    if (!targets.has(index + 1)) return;
    const current = page.getRotation().angle;
    page.setRotation(degrees((current + angle) % 360));
  });
  return [{ data: await doc.save(), ext: 'pdf', suffix: ' (rotado)' }];
}

/** B4 — rebuild the PDF with pages in a new order; omitted pages are dropped. */
async function reorderPdf(input: string, ctx: ToolkitRunContext): Promise<ToolkitProduced[]> {
  const { PDFDocument } = await loadPdfLib();
  const src = await PDFDocument.load(readBytes(input));
  const total = src.getPageCount();
  const order = parsePageOrder(String(ctx.options.order ?? ''), total);
  if (order.length === 0) throw new Error('El nuevo orden no incluye ninguna página válida.');
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, order.map((p) => p - 1));
  for (const page of copied) out.addPage(page);
  return [{ data: await out.save(), ext: 'pdf', suffix: ' (reordenado)' }];
}

/** Convert a pdfjs image object ({width,height,kind,data}) to a PNG buffer. */
async function imageObjToPng(img: any): Promise<Uint8Array | null> {
  if (!img || !img.width || !img.height || !img.data) return null;
  const { createCanvas } = await import('@napi-rs/canvas');
  const { width, height, data, kind } = img;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const out = ctx.createImageData(width, height);
  const dst = out.data;
  const pixels = width * height;
  // pdfjs image kinds: 1 GRAYSCALE_1BPP (packed), 2 RGB_24BPP, 3 RGBA_32BPP.
  if (kind === 3 || data.length >= pixels * 4) {
    dst.set(data.subarray(0, pixels * 4));
  } else if (kind === 2 || data.length >= pixels * 3) {
    for (let i = 0; i < pixels; i++) {
      dst[i * 4] = data[i * 3];
      dst[i * 4 + 1] = data[i * 3 + 1];
      dst[i * 4 + 2] = data[i * 3 + 2];
      dst[i * 4 + 3] = 255;
    }
  } else {
    const rowBytes = Math.ceil(width / 8);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const byte = data[y * rowBytes + (x >> 3)];
        const bit = (byte >> (7 - (x & 7))) & 1;
        const v = bit ? 255 : 0;
        const o = (y * width + x) * 4;
        dst[o] = dst[o + 1] = dst[o + 2] = v;
        dst[o + 3] = 255;
      }
    }
  }
  ctx.putImageData(out, 0, 0);
  return canvas.toBuffer('image/png');
}

/** B5 — pull embedded raster images out of every page as PNGs. */
async function extractImages(input: string, ctx: ToolkitRunContext): Promise<ToolkitProduced[]> {
  const pdfjs = await loadPdfjs();
  const OPS = pdfjs.OPS;
  const pdf = await openPdf(input);
  const produced: ToolkitProduced[] = [];
  let index = 0;
  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      if (ctx.signal.cancelled) break;
      const page = await pdf.getPage(p);
      const opList = await page.getOperatorList();
      const names = new Set<string>();
      for (let i = 0; i < opList.fnArray.length; i++) {
        const fn = opList.fnArray[i];
        if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject || fn === OPS.paintImageXObjectRepeat) {
          const arg = opList.argsArray[i]?.[0];
          if (typeof arg === 'string') names.add(arg);
        }
      }
      for (const name of names) {
        if (ctx.signal.cancelled) break;
        const img = await new Promise<any>((resolve) => {
          try {
            if (page.objs.has(name)) resolve(page.objs.get(name));
            else page.objs.get(name, resolve);
          } catch {
            resolve(null);
          }
        });
        const png = await imageObjToPng(img);
        if (png) {
          index += 1;
          produced.push({ data: png, ext: 'png', suffix: `-img${String(index).padStart(2, '0')}` });
        }
      }
      page.cleanup?.();
      ctx.onPageProgress(p / pdf.numPages);
    }
  } finally {
    await pdf.destroy?.();
  }
  if (produced.length === 0) throw new Error('El PDF no contiene imágenes incrustadas extraíbles.');
  return produced;
}

/** B6 — images → PDF. Page size can fit each image, or be A4/Letter with the image
 *  scaled to fit inside a margin; orientation auto/portrait/landscape. */
async function imagesToPdf(inputs: string[], ctx: ToolkitRunContext): Promise<ToolkitProduced[]> {
  const { PDFDocument } = await loadPdfLib();
  const doc = await PDFDocument.create();
  const pageSize = String(ctx.options.pageSize ?? 'fit');
  const orientation = String(ctx.options.orientation ?? 'auto');
  const margin = Math.max(0, Number(ctx.options.margin ?? 0));
  for (const input of inputs) {
    if (ctx.signal.cancelled) break;
    const bytes = readBytes(input);
    const isJpg = /\.jpe?g$/i.test(input);
    const image = isJpg ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
    if (pageSize === 'fit' || !PAGE_SIZES[pageSize]) {
      const page = doc.addPage([image.width, image.height]);
      page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
      continue;
    }
    let [pw, ph] = PAGE_SIZES[pageSize];
    const landscape = orientation === 'landscape' || (orientation === 'auto' && image.width > image.height);
    if (landscape) [pw, ph] = [ph, pw];
    const page = doc.addPage([pw, ph]);
    const scale = Math.min((pw - 2 * margin) / image.width, (ph - 2 * margin) / image.height);
    const dw = image.width * scale;
    const dh = image.height * scale;
    page.drawImage(image, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh });
  }
  return [{ data: await doc.save(), ext: 'pdf' }];
}

/** PDF → one image per page (JPEG or PNG), for "PDF to JPG"-style export. */
async function pdfToImages(input: string, ctx: ToolkitRunContext): Promise<ToolkitProduced[]> {
  const format = ctx.outputFormat === 'png' ? 'png' : 'jpeg';
  const quality = clampQuality(ctx.options.quality, 90);
  const scale = Math.max(0.5, clampInt(ctx.options.dpi, 150, 36, 600) / 72);
  const pdf = await openPdf(input);
  const produced: ToolkitProduced[] = [];
  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      if (ctx.signal.cancelled) break;
      const page = await pdf.getPage(p);
      const data = await renderPageToImage(page, scale, format, quality);
      page.cleanup?.();
      produced.push({ data, ext: format === 'png' ? 'png' : 'jpg', suffix: `-p${String(p).padStart(2, '0')}` });
      ctx.onPageProgress(p / pdf.numPages);
    }
  } finally {
    await pdf.destroy?.();
  }
  if (produced.length === 0) throw new Error('El PDF no tiene páginas que exportar.');
  return produced;
}

/** Rebuild a PDF by rasterising each page (lossy). Grayscale variant reuses the
 *  same path. Best for scanned PDFs; a note tells the user it is lossy. */
async function rebuildRasterPdf(input: string, ctx: ToolkitRunContext, grayscale: boolean): Promise<ToolkitProduced[]> {
  const { PDFDocument } = await loadPdfLib();
  const quality = clampQuality(ctx.options.quality, grayscale ? 80 : 70);
  const scale = Math.max(0.5, clampInt(ctx.options.dpi, 150, 36, 400) / 72);
  const pdf = await openPdf(input);
  const out = await PDFDocument.create();
  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      if (ctx.signal.cancelled) break;
      const page = await pdf.getPage(p);
      const pointsViewport = page.getViewport({ scale: 1 });
      const jpg = await renderPageToImage(page, scale, 'jpeg', quality, grayscale);
      page.cleanup?.();
      const image = await out.embedJpg(jpg);
      const target = out.addPage([pointsViewport.width, pointsViewport.height]);
      target.drawImage(image, { x: 0, y: 0, width: pointsViewport.width, height: pointsViewport.height });
      ctx.onPageProgress(p / pdf.numPages);
    }
  } finally {
    await pdf.destroy?.();
  }
  return [{ data: await out.save(), ext: 'pdf', suffix: grayscale ? ' (grises)' : ' (comprimido)' }];
}

/** Add page numbers to every page. */
async function pdfPageNumbers(input: string, ctx: ToolkitRunContext): Promise<ToolkitProduced[]> {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const doc = await PDFDocument.load(readBytes(input));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const start = clampInt(ctx.options.start, 1, 0, 100000);
  const size = clampInt(ctx.options.fontSize, 11, 6, 48);
  const position = String(ctx.options.position ?? 'bottom-center');
  const margin = 24;
  doc.getPages().forEach((page, i) => {
    const label = String(start + i);
    const w = page.getWidth();
    const h = page.getHeight();
    const textWidth = font.widthOfTextAtSize(label, size);
    let x = (w - textWidth) / 2;
    if (position.endsWith('right')) x = w - margin - textWidth;
    else if (position.endsWith('left')) x = margin;
    const y = position.startsWith('top') ? h - margin - size : margin;
    page.drawText(label, { x, y, size, font, color: rgb(0, 0, 0) });
  });
  return [{ data: await doc.save(), ext: 'pdf', suffix: ' (numerado)' }];
}

/** Stamp a diagonal text watermark on every page. */
async function pdfWatermark(input: string, ctx: ToolkitRunContext): Promise<ToolkitProduced[]> {
  const { PDFDocument, StandardFonts, rgb, degrees } = await loadPdfLib();
  const text = String(ctx.options.text ?? '').trim() || 'BORRADOR';
  const opacity = Math.min(0.9, Math.max(0.05, Number(ctx.options.opacity ?? 0.2)));
  const angle = clampInt(ctx.options.angle, 45, -90, 90);
  const doc = await PDFDocument.load(readBytes(input));
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.getPages().forEach((page) => {
    const w = page.getWidth();
    const h = page.getHeight();
    const size = Math.max(24, Math.min(w, h) / 8);
    const textWidth = font.widthOfTextAtSize(text, size);
    const rad = (angle * Math.PI) / 180;
    // Anchor so the rotated text runs through the page centre.
    const x = w / 2 - (textWidth / 2) * Math.cos(rad);
    const y = h / 2 - (textWidth / 2) * Math.sin(rad);
    page.drawText(text, { x, y, size, font, color: rgb(0.4, 0.4, 0.4), opacity, rotate: degrees(angle) });
  });
  return [{ data: await doc.save(), ext: 'pdf', suffix: ' (marca de agua)' }];
}

/** Crop every page by a uniform margin (points) via the crop box. */
async function pdfCrop(input: string, ctx: ToolkitRunContext): Promise<ToolkitProduced[]> {
  const { PDFDocument } = await loadPdfLib();
  const doc = await PDFDocument.load(readBytes(input));
  const margin = Math.max(0, Number(ctx.options.margin ?? 20));
  doc.getPages().forEach((page) => {
    const { width, height } = page.getSize();
    const cw = Math.max(1, width - 2 * margin);
    const ch = Math.max(1, height - 2 * margin);
    page.setCropBox(margin, margin, cw, ch);
  });
  return [{ data: await doc.save(), ext: 'pdf', suffix: ' (recortado)' }];
}

/** B7 — write document metadata; empty fields are left unchanged. */
async function editMetadata(input: string, ctx: ToolkitRunContext): Promise<ToolkitProduced[]> {
  const { PDFDocument } = await loadPdfLib();
  const doc = await PDFDocument.load(readBytes(input));
  const set = (value: unknown, apply: (v: string) => void) => {
    const s = typeof value === 'string' ? value.trim() : '';
    if (s) apply(s);
  };
  set(ctx.options.title, (v) => doc.setTitle(v));
  set(ctx.options.author, (v) => doc.setAuthor(v));
  set(ctx.options.subject, (v) => doc.setSubject(v));
  set(ctx.options.keywords, (v) => doc.setKeywords(v.split(',').map((k) => k.trim()).filter(Boolean)));
  return [{ data: await doc.save(), ext: 'pdf', suffix: ' (metadatos)' }];
}

export const pdfOps: ToolkitOpRegistry = {
  'pdf-merge': { arity: 'merge', run: (inputs) => mergePdfs(inputs) },
  'pdf-split': { arity: 'each', run: ([input], ctx) => splitPdf(input, ctx) },
  'pdf-rotate': { arity: 'each', run: ([input], ctx) => rotatePdf(input, ctx) },
  'pdf-reorder': { arity: 'each', run: ([input], ctx) => reorderPdf(input, ctx) },
  'pdf-extract-images': { arity: 'each', run: ([input], ctx) => extractImages(input, ctx) },
  'images-to-pdf': { arity: 'merge', run: (inputs, ctx) => imagesToPdf(inputs, ctx) },
  'pdf-metadata': { arity: 'each', run: ([input], ctx) => editMetadata(input, ctx) },
  'pdf-to-images': { arity: 'each', run: ([input], ctx) => pdfToImages(input, ctx) },
  'pdf-compress': { arity: 'each', run: ([input], ctx) => rebuildRasterPdf(input, ctx, false) },
  'pdf-grayscale': { arity: 'each', run: ([input], ctx) => rebuildRasterPdf(input, ctx, true) },
  'pdf-page-numbers': { arity: 'each', run: ([input], ctx) => pdfPageNumbers(input, ctx) },
  'pdf-watermark': { arity: 'each', run: ([input], ctx) => pdfWatermark(input, ctx) },
  'pdf-crop': { arity: 'each', run: ([input], ctx) => pdfCrop(input, ctx) },
};
