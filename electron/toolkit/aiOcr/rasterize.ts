// Nodus AI OCR — rasterization. Electron-free (like the convert/ ops): pdfjs (via the
// shared loader) + @napi-rs/canvas turn a PDF page or a source image into a JPEG buffer
// suitable for a vision model. Heavy deps load lazily so the module bundles cleanly for
// unit tests. The longest edge is capped (downscale only, never upscale) to keep the
// image within a vision model's practical token budget — smaller for local models.
import fs from 'node:fs';
import { parsePageRanges } from '@shared/toolkitPages';
import { openPdf } from '../../extraction/pdfjsLoader';

/** A rendered page image ready to hand to a vision model. */
export interface RasterPage {
  /** 1-based page number (always 1 for a single source image). */
  pageNumber: number;
  mediaType: string;
  buffer: Buffer;
  width: number;
  height: number;
}

export interface RasterizeOptions {
  /** Longest output edge in pixels (downscale cap). Default 2200; lower it for
   *  small-context local models so a page image doesn't overflow the window. */
  maxEdge?: number;
  /** JPEG quality 1..100. Default 88. */
  jpegQuality?: number;
  /** Requested pdfjs render scale before the edge cap is applied. Default 2. */
  pdfBaseScale?: number;
  /** Only render these 1-based pages, e.g. "1-3,5" (empty/undefined = every page). */
  pageRange?: string;
}

const DEFAULT_MAX_EDGE = 2200;
const DEFAULT_JPEG_QUALITY = 88;
const DEFAULT_PDF_BASE_SCALE = 2;

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

async function getCanvas() {
  return import('@napi-rs/canvas');
}

/** Cooperative cancellation, matching the toolkit engine's signal shape. */
export interface RasterizeSignal {
  cancelled: boolean;
}

/** Render every page of a PDF to a JPEG buffer, page by page (bounded memory). */
export async function rasterizePdf(
  filePath: string,
  options: RasterizeOptions = {},
  onPage?: (page: RasterPage, done: number, total: number) => void | Promise<void>,
  signal?: RasterizeSignal,
): Promise<RasterPage[]> {
  const maxEdge = clampNumber(options.maxEdge, DEFAULT_MAX_EDGE, 64, 8192);
  const quality = clampNumber(options.jpegQuality, DEFAULT_JPEG_QUALITY, 1, 100);
  const baseScale = clampNumber(options.pdfBaseScale, DEFAULT_PDF_BASE_SCALE, 0.25, 6);
  const { createCanvas } = await getCanvas();
  const pdf = await openPdf(filePath);
  const pages: RasterPage[] = [];
  try {
    const total = pdf.numPages;
    const selected = options.pageRange?.trim() ? new Set(parsePageRanges(options.pageRange, total)) : null;
    for (let p = 1; p <= total; p++) {
      if (signal?.cancelled) break;
      if (selected && !selected.has(p)) continue; // outside the requested page range
      const page = await pdf.getPage(p);
      try {
        const base = page.getViewport({ scale: 1 });
        const longest = Math.max(base.width, base.height);
        if (!(longest > 0)) throw new Error(`Dimensiones de página no válidas en la página ${p}.`);
        const scale = Math.min(baseScale, maxEdge / longest);
        const viewport = page.getViewport({ scale });
        const width = Math.max(1, Math.ceil(viewport.width));
        const height = Math.max(1, Math.ceil(viewport.height));
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');
        // Flatten onto white so transparent PDF regions don't become black in JPEG.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        await page.render({ canvasContext: ctx as any, viewport }).promise;
        const rendered: RasterPage = {
          pageNumber: p,
          mediaType: 'image/jpeg',
          buffer: canvas.toBuffer('image/jpeg', quality),
          width,
          height,
        };
        pages.push(rendered);
        if (onPage) await onPage(rendered, p, total);
      } finally {
        page.cleanup?.();
      }
    }
  } finally {
    await pdf.destroy?.();
  }
  return pages;
}

/** Rasterize a single source image to a JPEG buffer, downscaled to the edge cap and
 *  flattened onto white. Normalizes any decodable format to a vision-safe JPEG. */
export async function rasterizeImage(filePath: string, options: RasterizeOptions = {}): Promise<RasterPage> {
  const maxEdge = clampNumber(options.maxEdge, DEFAULT_MAX_EDGE, 64, 8192);
  const quality = clampNumber(options.jpegQuality, DEFAULT_JPEG_QUALITY, 1, 100);
  const { createCanvas, loadImage } = await getCanvas();
  const image = await loadImage(fs.readFileSync(filePath));
  const srcW = image.width;
  const srcH = image.height;
  if (!(srcW > 0) || !(srcH > 0)) throw new Error('La imagen no tiene dimensiones válidas.');
  const scale = Math.min(1, maxEdge / Math.max(srcW, srcH)); // downscale only
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  return {
    pageNumber: 1,
    mediaType: 'image/jpeg',
    buffer: canvas.toBuffer('image/jpeg', quality),
    width,
    height,
  };
}
