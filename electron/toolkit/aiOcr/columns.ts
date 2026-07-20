// Nodus AI OCR — multi-column detection. Electron-free (@napi-rs/canvas loaded lazily).
// Dense two-column scans confuse a single vision pass (it reads across the gutter). This
// analyses a page image for bright vertical gutters, crops each column, and returns one
// image part per column (left-to-right) so each is OCR'd on its own with single-column
// reading order. Falls back to the whole page when the layout is single-column.
import type { VisionImagePart } from '@shared/imageAnalysis';

async function getCanvas() {
  return import('@napi-rs/canvas');
}

const BRIGHT = 200;               // luminance >= this counts as background ("white")
const GUTTER_BRIGHT_FRAC = 0.85;  // a gutter column is at least this fraction background
const MIN_GUTTER_FRAC = 0.015;    // ignore gutters narrower than this (of page width)
const MIN_COLUMN_FRAC = 0.12;     // ignore columns narrower than this
const JPEG_QUALITY = 88;

function whole(buffer: Buffer, mediaType: string): VisionImagePart {
  return { base64: buffer.toString('base64'), mediaType };
}

/** Detect columns and return one image part per column (left-to-right), or a single part
 *  (the whole image) when the page is single-column or detection is inconclusive. */
export async function detectAndCropColumns(buffer: Buffer, mediaType: string): Promise<VisionImagePart[]> {
  const { createCanvas, loadImage } = await getCanvas();
  const image = await loadImage(buffer);
  const w = image.width;
  const h = image.height;
  if (!(w > 0) || !(h > 0) || w < 200) return [whole(buffer, mediaType)];

  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, w, h).data;

  // Per-column fraction of background pixels over the central vertical band (skip the
  // top/bottom where full-width headers and footers would mask the gutter).
  const y0 = Math.floor(h * 0.15);
  const y1 = Math.ceil(h * 0.85);
  const rows = Math.max(1, y1 - y0);
  const bright = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    let count = 0;
    for (let y = y0; y < y1; y++) {
      const i = (y * w + x) * 4;
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (lum >= BRIGHT) count++;
    }
    bright[x] = count / rows;
  }

  // Gutter runs: contiguous background columns, only within the central band so a wide
  // outer margin is never mistaken for a column separator.
  const minGutter = Math.max(2, Math.round(w * MIN_GUTTER_FRAC));
  const minColumn = Math.max(2, Math.round(w * MIN_COLUMN_FRAC));
  const bandStart = Math.round(w * 0.2);
  const bandEnd = Math.round(w * 0.8);
  const gutters: Array<[number, number]> = [];
  let run = -1;
  for (let x = 0; x <= w; x++) {
    const isGutter = x < w && x >= bandStart && x < bandEnd && bright[x] >= GUTTER_BRIGHT_FRAC;
    if (isGutter && run < 0) run = x;
    else if (!isGutter && run >= 0) {
      if (x - run >= minGutter) gutters.push([run, x]);
      run = -1;
    }
  }
  if (gutters.length === 0) return [whole(buffer, mediaType)];

  // Cut at each gutter's centre; keep only columns that are wide enough AND actually
  // carry ink — otherwise an all-white (blank) page would "split" into empty halves.
  const meanBright = (a: number, b: number): number => {
    let sum = 0;
    for (let x = a; x < b; x++) sum += bright[x];
    return sum / Math.max(1, b - a);
  };
  const cuts = gutters.map(([a, b]) => Math.round((a + b) / 2));
  const bounds: Array<[number, number]> = [];
  let prev = 0;
  for (const c of cuts) { bounds.push([prev, c]); prev = c; }
  bounds.push([prev, w]);
  const columns = bounds.filter(([a, b]) => b - a >= minColumn && meanBright(a, b) < 0.97);
  if (columns.length < 2) return [whole(buffer, mediaType)];

  const parts: VisionImagePart[] = [];
  for (const [a, b] of columns) {
    const cw = b - a;
    const cc = createCanvas(cw, h);
    const cctx = cc.getContext('2d');
    cctx.fillStyle = '#ffffff';
    cctx.fillRect(0, 0, cw, h);
    cctx.drawImage(canvas, a, 0, cw, h, 0, 0, cw, h);
    parts.push({ base64: cc.toBuffer('image/jpeg', JPEG_QUALITY).toString('base64'), mediaType: 'image/jpeg' });
  }
  return parts;
}
