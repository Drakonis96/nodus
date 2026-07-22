// Nodus Translate — PDF facsimile renderer.
//
// Each source page is rendered once, its textual regions are translated with stable
// block IDs, and the translated prose is fitted back into those same regions. Images,
// rules, backgrounds, page geometry, headers and footers therefore remain visually in
// place. The output is intentionally raster-backed: arbitrary PDF content streams and
// subset fonts cannot be edited safely with pdf-lib alone. Pages requiring aggressive
// fitting are reported to the UI instead of being silently presented as perfect.
import { openPdf } from '../../extraction/pdfjsLoader';
import type { OcrBlockLabel, OcrPageResult } from '@shared/aiOcrTypes';
import type { TranslateSegment, TranslateSegmentResult } from '@shared/toolkitTranslateTypes';

export interface FacsimileSignal { cancelled: boolean }

export interface FacsimileProgress {
  stage: 'extracting' | 'translating' | 'rendering';
  done: number;
  total: number;
}

export interface FacsimileOptions {
  translate: (segments: TranslateSegment[]) => Promise<TranslateSegmentResult[]>;
  /** Required when a page has no digital text or image-text translation is enabled. */
  translatePageImage?: (page: { buffer: Buffer; mediaType: string; width: number; height: number; pageNumber: number }) => Promise<OcrPageResult>;
  translateImageText?: boolean;
  signal?: FacsimileSignal;
  onProgress?: (progress: FacsimileProgress) => void;
}

export interface FacsimileResult {
  data: Uint8Array;
  pageCount: number;
  overflowPages: number[];
  warnings: string[];
}

interface PdfTextBlock {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: string;
  label: OcrBlockLabel;
  /** Digital facsimile lines are kept on one visual line and horizontally fitted;
   * paragraph wrapping is reserved for vision boxes and reflow exports. */
  singleLine?: boolean;
  /** Exact source-line rectangles. Erasing these instead of the paragraph's full
   * bounding box preserves rules, arrows, images and coloured cells between lines. */
  eraseRegions?: Array<{ x: number; y: number; width: number; height: number; fontSize: number }>;
  /** Vision OCR translation already returned this block in the target language. */
  alreadyTranslated?: boolean;
}

interface ExtractedPage {
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  canvas: any;
  blocks: PdfTextBlock[];
}

interface RawLine extends PdfTextBlock { baseline: number }

const RENDER_SCALE = 2;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function median(values: number[], fallback = 12): number {
  if (!values.length) return fallback;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function labelFor(fontSize: number, bodySize: number, y: number, pageHeight: number): OcrBlockLabel {
  if (y < pageHeight * 0.07) return 'HEADER';
  if (y > pageHeight * 0.91) return 'FOOTER';
  if (fontSize >= bodySize * 1.25) return 'TITLE';
  if (fontSize <= bodySize * 0.78 && y > pageHeight * 0.66) return 'FOOTNOTE';
  return 'MAIN_TEXT';
}

export function groupDigitalLines(content: any, viewport: any, pageNumber: number): RawLine[] {
  const items = (content.items ?? []).filter((item: any) => typeof item.str === 'string' && item.str.trim());
  const styles = content.styles ?? {};
  const raw = items.map((item: any, index: number) => {
    const transform = item.transform ?? [1, 0, 0, 1, 0, 0];
    const [vx, vy] = viewport.convertToViewportPoint(transform[4], transform[5]);
    const fontSize = Math.max(5, Math.hypot(transform[2], transform[3]) * RENDER_SCALE || Number(item.height) * RENDER_SCALE || 12);
    const width = Math.max(fontSize * 0.25, Number(item.width || 0) * RENDER_SCALE);
    return {
      index,
      text: item.str,
      x: vx,
      baseline: vy,
      y: vy - fontSize,
      width,
      height: fontSize * 1.16,
      fontSize,
      fontFamily: String(styles[item.fontName]?.fontFamily || 'Arial'),
    };
  }).sort((a: any, b: any) => Math.abs(a.baseline - b.baseline) <= 2 ? a.x - b.x : a.baseline - b.baseline);

  const lines: Array<{ items: typeof raw; baseline: number }> = [];
  for (const item of raw) {
    const line = lines.find((candidate) => Math.abs(candidate.baseline - item.baseline) <= Math.max(2.5, item.fontSize * 0.28));
    if (line) {
      line.items.push(item);
      line.baseline = line.items.reduce((sum: number, value: { baseline: number }) => sum + value.baseline, 0) / line.items.length;
    } else {
      lines.push({ items: [item], baseline: item.baseline });
    }
  }
  // A shared baseline does not imply a shared line: tables, diagrams and columns
  // routinely place unrelated text at the same Y coordinate. Split a baseline band
  // whenever the horizontal whitespace is too large to be an ordinary word gap.
  const splitLines = lines.flatMap((line) => {
    const ordered = line.items.sort((a: any, b: any) => a.x - b.x);
    const clusters: typeof raw[] = [];
    let current: typeof raw = [];
    for (const item of ordered) {
      const previous = current.at(-1);
      const gap = previous ? item.x - (previous.x + previous.width) : 0;
      // Ordinary PDF word/run gaps are small. A gap near one glyph height is much
      // more likely to be a column or table-cell boundary and must not be merged.
      const threshold = Math.max(10, Math.max(previous?.fontSize ?? 0, item.fontSize) * 0.72);
      const previousIsListPrefix = Boolean(previous && /^(?:\d+[.)]|[•●▪◦])$/.test(previous.text.trim()));
      if (previous && gap > threshold && !previousIsListPrefix) {
        clusters.push(current);
        current = [];
      }
      current.push(item);
    }
    if (current.length) clusters.push(current);
    return clusters.map((items) => ({ items, baseline: items.reduce((sum: number, item: (typeof raw)[number]) => sum + item.baseline, 0) / items.length }));
  });
  const body = median(raw.map((item: any) => item.fontSize));
  return splitLines.sort((a, b) => Math.abs(a.baseline - b.baseline) <= 2 ? a.items[0].x - b.items[0].x : a.baseline - b.baseline).map((line, index) => {
    const left = Math.min(...line.items.map((item: any) => item.x));
    const right = Math.max(...line.items.map((item: any) => item.x + item.width));
    const top = Math.min(...line.items.map((item: any) => item.y));
    const bottom = Math.max(...line.items.map((item: any) => item.y + item.height));
    const fontSize = Math.max(...line.items.map((item: any) => item.fontSize));
    const text = line.items.map((item: any, itemIndex: number) => {
      if (!itemIndex) return item.text;
      const previous = line.items[itemIndex - 1];
      const gap = item.x - (previous.x + previous.width);
      return `${gap > fontSize * 0.14 ? ' ' : ''}${item.text}`;
    }).join('').replace(/\s+/g, ' ').trim();
    return {
      id: `pdf-p${String(pageNumber).padStart(4, '0')}-l${String(index + 1).padStart(4, '0')}`,
      text, x: left, y: top, width: right - left, height: bottom - top, baseline: line.baseline,
      fontSize, fontFamily: line.items[0]?.fontFamily || 'Arial',
      label: labelFor(fontSize, body, top, viewport.height),
    };
  });
}

function overlapRatio(a: RawLine, b: RawLine): number {
  const overlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  return overlap / Math.max(1, Math.min(a.width, b.width));
}

export function groupParagraphs(lines: RawLine[], pageNumber: number): PdfTextBlock[] {
  const groups: RawLine[][] = [];
  for (const line of [...lines].sort((a, b) => Math.abs(a.y - b.y) <= 2 ? a.x - b.x : a.y - b.y)) {
    let best: { group: RawLine[]; score: number } | null = null;
    for (const group of groups) {
      const prev = group.at(-1)!;
      const gap = line.y - (prev.y + prev.height);
      const sameRole = prev.label === line.label;
      const sameScale = Math.abs(prev.fontSize - line.fontSize) <= Math.max(2, prev.fontSize * 0.22);
      const sameColumn = overlapRatio(prev, line) >= 0.35 || Math.abs(prev.x - line.x) <= prev.fontSize * 1.5;
      const startsNewListItem = /^(?:\d+[.)]|[•●▪◦])\s*/.test(line.text) && group.length > 0;
      if (!sameRole || !sameScale || !sameColumn || startsNewListItem || gap < -Math.max(2, prev.fontSize * 0.18) || gap > Math.max(prev.fontSize * 0.55, 8)) continue;
      const score = Math.abs(gap) + Math.abs(prev.x - line.x) * 0.08;
      if (!best || score < best.score) best = { group, score };
    }
    if (best) best.group.push(line);
    else groups.push([line]);
  }

  return groups.map((current, blockIndex) => {
    const first = current[0];
    const left = Math.min(...current.map((line) => line.x));
    const right = Math.max(...current.map((line) => line.x + line.width));
    const top = Math.min(...current.map((line) => line.y));
    const bottom = Math.max(...current.map((line) => line.y + line.height));
    const text = current.map((line, index) => {
      const previous = current[index - 1];
      if (index && previous.text.endsWith('-') && /^[a-záéíóúüñ]/i.test(line.text)) return line.text;
      return `${index ? ' ' : ''}${line.text}`;
    }).join('').replace(/-\s+(?=[a-záéíóúüñ])/gi, '');
    return {
      id: `pdf-p${String(pageNumber).padStart(4, '0')}-b${String(blockIndex + 1).padStart(4, '0')}`,
      text,
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
      fontSize: median(current.map((line) => line.fontSize), first.fontSize),
      fontFamily: first.fontFamily,
      label: first.label,
      eraseRegions: current.map(({ x, y, width, height, fontSize }) => ({ x, y, width, height, fontSize })),
    };
  }).sort((a, b) => Math.abs(a.y - b.y) <= 2 ? a.x - b.x : a.y - b.y);
}

function ocrBlocks(result: OcrPageResult, width: number, height: number, pageNumber: number): PdfTextBlock[] {
  const usable = result.blocks.filter((block) => block.text.trim());
  return usable.map((block, index) => {
    const box = block.box_2d;
    const fallbackTop = 70 + index * Math.max(35, (height - 140) / Math.max(1, usable.length));
    const x = box ? clamp(box[1], 0, 1000) / 1000 * width : width * 0.08;
    const y = box ? clamp(box[0], 0, 1000) / 1000 * height : fallbackTop;
    const right = box ? clamp(box[3], 0, 1000) / 1000 * width : width * 0.92;
    const bottom = box ? clamp(box[2], 0, 1000) / 1000 * height : Math.min(height - 40, y + 60);
    const blockHeight = Math.max(14, bottom - y);
    return {
      id: `pdf-p${String(pageNumber).padStart(4, '0')}-v${String(index + 1).padStart(4, '0')}`,
      text: block.text,
      x,
      y,
      width: Math.max(24, right - x),
      height: blockHeight,
      fontSize: block.label === 'TITLE' ? Math.min(40, blockHeight * 0.65) : Math.min(24, Math.max(10, blockHeight * 0.35)),
      fontFamily: 'Arial',
      label: block.label,
      alreadyTranslated: true,
    };
  });
}

async function extractPages(inputPath: string, options: FacsimileOptions): Promise<ExtractedPage[]> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const pdf = await openPdf(inputPath);
  const pages: ExtractedPage[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      if (options.signal?.cancelled) break;
      const page = await pdf.getPage(pageNumber);
      try {
        const pointViewport = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: RENDER_SCALE });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx as any, viewport }).promise;
        const content = await page.getTextContent();
        const digitalLines = groupDigitalLines(content, viewport, pageNumber);
        // Paragraph rectangles are useful for reflow, but too destructive for a
        // facsimile: tables and multi-column PDFs can have overlapping paragraph
        // bounds. Keeping exact visual lines prevents translated blocks from
        // crossing cells, images or neighbouring columns.
        const digitalBlocks: PdfTextBlock[] = digitalLines.map(({ baseline: _baseline, ...line }) => ({
          ...line,
          singleLine: true,
          eraseRegions: [{ x: line.x, y: line.y, width: line.width, height: line.height, fontSize: line.fontSize }],
        }));
        const needsVision = options.translateImageText || digitalBlocks.reduce((sum, block) => sum + block.text.length, 0) < 20;
        let blocks = digitalBlocks;
        if (needsVision) {
          if (!options.translatePageImage) {
            if (!digitalBlocks.length) throw new Error(`La página ${pageNumber} necesita un modelo de visión para traducirse.`);
          } else {
            const buffer = canvas.toBuffer('image/jpeg', 90);
            const result = await options.translatePageImage({ buffer, mediaType: 'image/jpeg', width: canvas.width, height: canvas.height, pageNumber });
            blocks = ocrBlocks(result, canvas.width, canvas.height, pageNumber);
          }
        }
        pages.push({
          pageNumber,
          pageWidth: pointViewport.width,
          pageHeight: pointViewport.height,
          canvasWidth: canvas.width,
          canvasHeight: canvas.height,
          canvas,
          blocks,
        });
        options.onProgress?.({ stage: 'extracting', done: pageNumber, total: pdf.numPages });
      } finally {
        page.cleanup?.();
      }
    }
  } finally {
    await pdf.destroy?.();
  }
  return pages;
}

function channelMedian(values: number[], fallback: number): number {
  if (!values.length) return fallback;
  const sorted = values.sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Approximate the source glyph colour before removing it. This keeps white text
 * white on dark banners and retains coloured headings instead of forcing every
 * translated block to black. */
function inferTextColor(ctx: any, block: PdfTextBlock): string {
  const canvas = ctx.canvas;
  const margin = Math.max(4, Math.ceil(block.fontSize * 0.28));
  const left = clamp(Math.floor(block.x - margin), 0, canvas.width - 1);
  const top = clamp(Math.floor(block.y - margin), 0, canvas.height - 1);
  const right = clamp(Math.ceil(block.x + block.width + margin), left + 1, canvas.width);
  const bottom = clamp(Math.ceil(block.y + block.height + margin), top + 1, canvas.height);
  const image = ctx.getImageData(left, top, right - left, bottom - top);
  const { data, width, height } = image;
  const background: number[][] = [[], [], []];
  for (let row = 0; row < height; row += Math.max(1, Math.floor(height / 12))) {
    for (const col of [0, Math.max(0, width - 1)]) {
      const offset = (row * width + col) * 4;
      for (let channel = 0; channel < 3; channel++) background[channel].push(data[offset + channel]);
    }
  }
  for (let col = 0; col < width; col += Math.max(1, Math.floor(width / 20))) {
    for (const row of [0, Math.max(0, height - 1)]) {
      const offset = (row * width + col) * 4;
      for (let channel = 0; channel < 3; channel++) background[channel].push(data[offset + channel]);
    }
  }
  const bg = background.map((values) => channelMedian(values, 255));
  const foreground: Array<{ rgb: [number, number, number]; distance: number }> = [];
  for (let row = margin; row < height - margin; row += 2) {
    for (let col = margin; col < width - margin; col += 2) {
      const offset = (row * width + col) * 4;
      const distance = Math.hypot(data[offset] - bg[0], data[offset + 1] - bg[1], data[offset + 2] - bg[2]);
      if (distance < 72) continue;
      foreground.push({ rgb: [data[offset], data[offset + 1], data[offset + 2]], distance });
    }
  }
  const strongest = foreground.sort((a, b) => b.distance - a.distance).slice(0, Math.max(4, Math.ceil(foreground.length * 0.35)));
  let rgb = foreground.length >= 4
    ? [0, 1, 2].map((channel) => channelMedian(strongest.map((sample) => sample.rgb[channel]), bg[channel]))
    : ((bg[0] * 0.2126 + bg[1] * 0.7152 + bg[2] * 0.0722) < 128 ? [248, 250, 252] : [17, 24, 39]);
  const backgroundLuminance = bg[0] * 0.2126 + bg[1] * 0.7152 + bg[2] * 0.0722;
  const foregroundLuminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  if (Math.abs(backgroundLuminance - foregroundLuminance) < 70) rgb = backgroundLuminance < 128 ? [248, 250, 252] : [17, 24, 39];
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function eraseRegion(ctx: any, block: PdfTextBlock): void {
  const canvas = ctx.canvas;
  // PDF text metrics often end exactly at an antialiased glyph edge. A generous,
  // font-relative margin prevents remnants of accents and final stems from leaking.
  const leftMargin = Math.max(4, block.fontSize * 0.22);
  // PDF.js widths can end before the antialiased edge of the last glyph. The
  // asymmetric right allowance removes those characteristic stray stems while
  // staying well inside an ordinary column gutter.
  const rightMargin = Math.max(10, block.fontSize * 0.52);
  const verticalMargin = Math.max(2.5, block.fontSize * 0.15);
  const left = clamp(Math.floor(block.x - leftMargin), 0, canvas.width - 1);
  const top = clamp(Math.floor(block.y - verticalMargin), 0, canvas.height - 1);
  const right = clamp(Math.ceil(block.x + block.width + rightMargin), left + 1, canvas.width);
  const bottom = clamp(Math.ceil(block.y + block.height + verticalMargin), top + 1, canvas.height);
  const w = right - left;
  const h = bottom - top;
  if (w <= 0 || h <= 0) return;
  const image = ctx.getImageData(left, top, w, h);
  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
  const step = Math.max(1, Math.floor(Math.min(w, h) / 18));
  for (let row = 0; row < h; row += step) {
    for (let col = 0; col < w; col += step) {
      const offset = (row * w + col) * 4;
      const r = image.data[offset]; const g = image.data[offset + 1]; const b = image.data[offset + 2];
      const key = `${Math.round(r / 16)},${Math.round(g / 16)},${Math.round(b / 16)}`;
      const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
      bucket.count += 1; bucket.r += r; bucket.g += g; bucket.b += b;
      buckets.set(key, bucket);
    }
  }
  const background = [...buckets.values()].sort((a, b) => b.count - a.count)[0] ?? { count: 1, r: 255, g: 255, b: 255 };
  ctx.fillStyle = `rgb(${Math.round(background.r / background.count)}, ${Math.round(background.g / background.count)}, ${Math.round(background.b / background.count)})`;
  ctx.fillRect(left, top, w, h);
}

function wordsFor(text: string): string[] {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (/\s/.test(compact)) return compact.split(' ');
  return [...compact];
}

function wrapText(ctx: any, text: string, width: number): string[] {
  const words = wordsFor(text);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const joiner = line && /\s/.test(text) ? ' ' : '';
    const candidate = `${line}${joiner}${word}`;
    if (line && ctx.measureText(candidate).width > width) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawFitted(ctx: any, block: PdfTextBlock, text: string, color: string): { aggressive: boolean; clipped: boolean } {
  const padding = Math.max(1.5, block.fontSize * 0.08);
  const x = block.x + padding;
  const y = block.y + padding;
  const width = Math.max(8, block.width - padding * 2);
  const height = Math.max(8, block.height - padding * 2);
  const startSize = Math.max(7, block.fontSize * (block.label === 'TITLE' ? 0.98 : 0.9));
  const minimum = Math.max(5.2, startSize * 0.54);
  let size = startSize;
  let lines: string[] = [];
  let lineHeight = 0;
  const weight = block.label === 'TITLE' ? '700 ' : '';
  if (block.singleLine) {
    const minimum = Math.max(5.2, startSize * 0.55);
    let singleSize = startSize;
    for (;;) {
      ctx.font = `${weight}${singleSize}px ${block.fontFamily || 'Arial'}, Arial, sans-serif`;
      if (ctx.measureText(text).width <= width || singleSize <= minimum) break;
      singleSize -= 0.5;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(block.x, block.y, block.width, block.height);
    ctx.clip();
    ctx.fillStyle = color;
    ctx.textBaseline = 'top';
    // maxWidth applies a final horizontal fit when even the minimum font is wider;
    // this is preferable to dropping the end of a translated table or heading line.
    ctx.fillText(text, x, y, width);
    ctx.restore();
    return { aggressive: singleSize < startSize * 0.72, clipped: false };
  }
  for (;;) {
    ctx.font = `${weight}${size}px ${block.fontFamily || 'Arial'}, Arial, sans-serif`;
    lineHeight = size * 1.16;
    lines = wrapText(ctx, text, width);
    if (lines.length * lineHeight <= height || size <= minimum) break;
    size -= 0.5;
  }
  const clipped = lines.length * lineHeight > height + 0.5;
  const maxLines = Math.max(1, Math.floor(height / lineHeight));
  const visible = lines.slice(0, maxLines);
  if (clipped && visible.length) {
    let last = visible.at(-1) ?? '';
    while (last && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
    visible[visible.length - 1] = `${last}…`;
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(block.x, block.y, block.width, block.height);
  ctx.clip();
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  visible.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight));
  ctx.restore();
  return { aggressive: size < startSize * 0.72, clipped };
}

export async function buildFacsimilePdf(inputPath: string, options: FacsimileOptions): Promise<FacsimileResult> {
  const warnings: string[] = [];
  const pages = await extractPages(inputPath, options);
  if (options.signal?.cancelled) return { data: new Uint8Array(), pageCount: pages.length, overflowPages: [], warnings };
  const translated = new Map<string, string>();
  const segments = pages.flatMap((page) => page.blocks
    .filter((block) => !block.alreadyTranslated)
    .map((block) => ({ id: block.id, text: block.text, kind: 'plain' as const })));
  for (const page of pages) for (const block of page.blocks) if (block.alreadyTranslated) translated.set(block.id, block.text);
  for (const segment of await options.translate(segments)) translated.set(segment.id, segment.translated);
  options.onProgress?.({ stage: 'translating', done: segments.length, total: segments.length });
  const { PDFDocument } = await import('pdf-lib');
  const output = await PDFDocument.create();
  const overflow = new Set<number>();
  for (const page of pages) {
    if (options.signal?.cancelled) break;
    const ctx = page.canvas.getContext('2d');
    const colors = new Map(page.blocks.map((block) => [block.id, inferTextColor(ctx, block)]));
    for (const block of page.blocks) {
      const regions = block.eraseRegions?.length ? block.eraseRegions : [block];
      for (const region of regions) eraseRegion(ctx, { ...block, ...region });
    }
    for (const block of page.blocks) {
      const result = drawFitted(ctx, block, translated.get(block.id) ?? block.text, colors.get(block.id) ?? '#111827');
      if (result.aggressive || result.clipped) overflow.add(page.pageNumber);
    }
    const jpeg = page.canvas.toBuffer('image/jpeg', 92);
    const image = await output.embedJpg(jpeg);
    const outPage = output.addPage([page.pageWidth, page.pageHeight]);
    outPage.drawImage(image, { x: 0, y: 0, width: page.pageWidth, height: page.pageHeight });
    options.onProgress?.({ stage: 'rendering', done: page.pageNumber, total: pages.length });
  }
  if (overflow.size) warnings.push(`Revisa las páginas ${[...overflow].join(', ')}: el texto necesitó un ajuste tipográfico intenso.`);
  warnings.push('El facsímil conserva la apariencia mediante páginas rasterizadas: el texto deja de ser seleccionable y los enlaces o formularios pueden no seguir siendo interactivos.');
  if (options.translateImageText) warnings.push('El modo de texto en imágenes usa análisis visual de página completa y puede modificar rótulos integrados en gráficos.');
  return {
    data: await output.save(),
    pageCount: pages.length,
    overflowPages: [...overflow],
    warnings,
  };
}

/** Extract a clean, role-aware Markdown representation for reflow exports. */
export async function extractPdfMarkdown(inputPath: string, signal?: FacsimileSignal, onPage?: (done: number, total: number) => void): Promise<string> {
  const pdf = await openPdf(inputPath);
  const parts: string[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      if (signal?.cancelled) break;
      const page = await pdf.getPage(pageNumber);
      try {
        const viewport = page.getViewport({ scale: RENDER_SCALE });
        const lines = groupDigitalLines(await page.getTextContent(), viewport, pageNumber);
        const blocks = groupParagraphs(lines, pageNumber);
        for (const block of blocks) {
          if (block.label === 'HEADER' || block.label === 'FOOTER') parts.push(`> ${block.text}`);
          else if (block.label === 'TITLE') parts.push(`## ${block.text}`);
          else if (block.label === 'FOOTNOTE') parts.push(`[^p${pageNumber}]: ${block.text}`);
          else parts.push(block.text);
        }
        if (pageNumber < pdf.numPages) parts.push('---');
        onPage?.(pageNumber, pdf.numPages);
      } finally {
        page.cleanup?.();
      }
    }
  } finally {
    await pdf.destroy?.();
  }
  return parts.join('\n\n').trim();
}
