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

/** B6 — one image per page, page sized to the image. */
async function imagesToPdf(inputs: string[]): Promise<ToolkitProduced[]> {
  const { PDFDocument } = await loadPdfLib();
  const doc = await PDFDocument.create();
  for (const input of inputs) {
    const bytes = readBytes(input);
    const isJpg = /\.jpe?g$/i.test(input);
    const image = isJpg ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
    const page = doc.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  }
  return [{ data: await doc.save(), ext: 'pdf' }];
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
  'images-to-pdf': { arity: 'merge', run: (inputs) => imagesToPdf(inputs) },
  'pdf-metadata': { arity: 'each', run: ([input], ctx) => editMetadata(input, ctx) },
};
