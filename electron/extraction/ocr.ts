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

export interface OcrLayoutLine {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  fontSize: number;
  paragraphBreakBefore: boolean;
}

export interface OcrPageResult {
  text: string;
  width: number;
  height: number;
  lines: OcrLayoutLine[];
}

let canvasModPromise: Promise<any> | null = null;
async function getCanvas(): Promise<any> {
  if (!canvasModPromise) canvasModPromise = import('@napi-rs/canvas');
  return canvasModPromise;
}

async function createOcrWorker(languages: string): Promise<any> {
  const Tesseract: any = await import('tesseract.js');
  const cachePath = process.env.NODUS_TESSDATA_CACHE?.trim();
  return Tesseract.createWorker(languages, undefined, cachePath ? { cachePath } : {});
}

/** Render one pdfjs page to a PNG buffer at a DPI suitable for OCR. */
async function renderPageToPng(page: any, scale = 2.5): Promise<{ png: Buffer; width: number; height: number }> {
  const { createCanvas } = await getCanvas();
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx as any, viewport }).promise;
  return { png: canvas.toBuffer('image/png'), width: canvas.width, height: canvas.height };
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Tesseract may return the lines of two newspaper-style columns interleaved by
 * their vertical coordinate. Keep spanning headings first, then read each
 * column from top to bottom. This mirrors the digital-PDF reading-order pass.
 */
export function orderOcrLayoutLines(lines: OcrLayoutLine[], width: number): OcrLayoutLine[] {
  const available = [...lines];
  const middle = width / 2;
  const left = available.filter((line) => line.bbox.x0 < middle - 35 && line.bbox.x1 <= middle + 75 && line.bbox.x1 - line.bbox.x0 < width * 0.7);
  const right = available.filter((line) => line.bbox.x0 >= middle - 75 && line.bbox.x1 - line.bbox.x0 < width * 0.7);
  if (left.length < 4 || right.length < 4) return available.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  const spanning = available.filter((line) => !left.includes(line) && !right.includes(line)).sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const output: OcrLayoutLine[] = [];
  let bandTop = Number.NEGATIVE_INFINITY;
  const appendBand = (bandBottom: number): void => {
    const leftBand = left.filter((line) => line.bbox.y0 >= bandTop && line.bbox.y0 < bandBottom);
    const rightBand = right.filter((line) => line.bbox.y0 >= bandTop && line.bbox.y0 < bandBottom);
    const occupied = [...leftBand, ...rightBand].sort((a, b) => a.bbox.y0 - b.bbox.y0);
    const typicalHeight = median(occupied.map((line) => line.bbox.y1 - line.bbox.y0).filter((height) => height > 0)) || 20;
    const breaks: number[] = [];
    let occupiedBottom = occupied[0]?.bbox.y1 ?? bandTop;
    for (const line of occupied.slice(1)) {
      if (line.bbox.y0 - occupiedBottom >= typicalHeight * 3.2) breaks.push((line.bbox.y0 + occupiedBottom) / 2);
      occupiedBottom = Math.max(occupiedBottom, line.bbox.y1);
    }
    const boundaries = [bandTop, ...breaks, bandBottom];
    for (let index = 1; index < boundaries.length; index += 1) {
      const top = boundaries[index - 1];
      const bottom = boundaries[index];
      output.push(
        ...leftBand.filter((line) => line.bbox.y0 >= top && line.bbox.y0 < bottom).sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0),
        ...rightBand.filter((line) => line.bbox.y0 >= top && line.bbox.y0 < bottom).sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0),
      );
    }
  };
  for (const line of spanning) {
    appendBand(line.bbox.y0);
    output.push(line);
    bandTop = Math.max(bandTop, line.bbox.y1);
  }
  appendBand(Number.POSITIVE_INFINITY);
  return output;
}

function structuredPage(data: any, width: number, height: number): OcrPageResult {
  const paragraphs = Array.isArray(data?.paragraphs) ? data.paragraphs : [];
  const rawLines = paragraphs.flatMap((paragraph: any) => Array.isArray(paragraph?.lines) ? paragraph.lines : []);
  const multiColumnPage = rawLines.filter((line: any) => line?.bbox && Number(line.bbox.x1) - Number(line.bbox.x0) >= width * 0.82).length >= 4;
  const lines: OcrLayoutLine[] = [];
  const seen = new Set<string>();
  for (const paragraph of paragraphs) {
    const paragraphLines = Array.isArray(paragraph?.lines) ? paragraph.lines : [];
    for (let index = 0; index < paragraphLines.length; index += 1) {
      const line = paragraphLines[index];
      const words = (Array.isArray(line?.words) ? line.words : [])
        .filter((word: any) => String(word?.text ?? '').trim() && word?.bbox)
        .sort((left: any, right: any) => Number(left.bbox.x0) - Number(right.bbox.x0));
      let groups: any[][] = words.length ? [words] : [];
      if (multiColumnPage && words.length >= 2) {
        let splitIndex = -1;
        let splitGap = 0;
        const gutterDivider = words.findIndex((word: any) => {
          const center = (Number(word.bbox.x0) + Number(word.bbox.x1)) / 2;
          return /^[—–|~]+$/.test(String(word.text ?? '').trim()) && center >= width * 0.46 && center <= width * 0.54;
        });
        if (gutterDivider > 0 && gutterDivider < words.length - 1) splitIndex = gutterDivider + 1;
        for (let wordIndex = 1; wordIndex < words.length; wordIndex += 1) {
          const left = words[wordIndex - 1].bbox;
          const right = words[wordIndex].bbox;
          const gap = Number(right.x0) - Number(left.x1);
          const crossesGutter = Number(left.x1) <= width * 0.57 && Number(right.x0) >= width * 0.43;
          if (splitIndex < 0 && crossesGutter && gap >= width * 0.018 && gap > splitGap) {
            splitIndex = wordIndex;
            splitGap = gap;
          }
        }
        if (splitIndex > 0) {
          const leftWords = words.slice(0, splitIndex);
          const divider = leftWords.at(-1);
          if (divider && /^[—–|~]+$/.test(String(divider.text ?? '').trim())) leftWords.pop();
          groups = [leftWords, words.slice(splitIndex)].filter((group) => group.length);
        }
      }
      if (!groups.length && line?.bbox) groups = [[{ text: line.text, bbox: line.bbox, font_size: 0 }]];
      for (const group of groups) {
        const text = group.map((word: any) => String(word.text ?? '').trim()).filter(Boolean).join(' ');
        if (!text) continue;
        const bbox = {
          x0: Math.min(...group.map((word: any) => Number(word.bbox.x0) || 0)),
          y0: Math.min(...group.map((word: any) => Number(word.bbox.y0) || 0)),
          x1: Math.max(...group.map((word: any) => Number(word.bbox.x1) || 0)),
          y1: Math.max(...group.map((word: any) => Number(word.bbox.y1) || 0)),
        };
        const key = `${bbox.x0}:${bbox.y0}:${bbox.x1}:${bbox.y1}:${text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const wordSizes = group.map((word: any) => Number(word?.font_size)).filter((value: number) => Number.isFinite(value) && value > 0);
        lines.push({
          text, bbox,
          fontSize: median(wordSizes) || Math.max(1, (bbox.y1 - bbox.y0) * 0.72),
          paragraphBreakBefore: index === 0,
        });
      }
    }
  }
  if (!lines.length) {
    for (const line of Array.isArray(data?.lines) ? data.lines : []) {
      const text = String(line?.text ?? '').replace(/\s+/g, ' ').trim();
      const bbox = line?.bbox;
      if (!text || !bbox) continue;
      lines.push({
        text,
        bbox: { x0: Number(bbox.x0) || 0, y0: Number(bbox.y0) || 0, x1: Number(bbox.x1) || 0, y1: Number(bbox.y1) || 0 },
        fontSize: Math.max(1, (Number(bbox.y1) - Number(bbox.y0)) * 0.72),
        paragraphBreakBefore: true,
      });
    }
  }
  for (const line of lines) {
    const dropCap = /^(\p{Lu})\s+(.+)$/u.exec(line.text);
    if (!dropCap) continue;
    const firstLine = lines.find((candidate) => candidate !== line
      && candidate.bbox.x0 > line.bbox.x0
      && Math.abs(candidate.bbox.y0 - line.bbox.y0) <= Math.max(8, candidate.bbox.y1 - candidate.bbox.y0)
      && /^\p{Lu}{2}\s/u.test(candidate.text));
    if (!firstLine) continue;
    firstLine.text = `${dropCap[1]}${firstLine.text}`;
    firstLine.bbox.x0 = Math.min(firstLine.bbox.x0, line.bbox.x0);
    line.text = dropCap[2];
  }
  const ordered = orderOcrLayoutLines(lines, width);
  let text = '';
  for (const line of ordered) {
    const separator = !text ? '' : line.paragraphBreakBefore ? '\n\n' : /[-‐‑‒–—]$/.test(text) ? '' : ' ';
    text += `${separator}${line.text}`;
  }
  return { text: text.trim() || String(data?.text ?? '').trim(), width, height, lines: ordered };
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
  const worker = await createOcrWorker(languages);
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
): Promise<Map<number, OcrPageResult>> {
  const worker = await createOcrWorker(languages);
  const out = new Map<number, OcrPageResult>();
  try {
    let done = 0;
    for (const n of pageNumbers) {
      const page = await pdf.getPage(n);
      const rendered = await renderPageToPng(page);
      page.cleanup?.();
      const { data } = await worker.recognize(rendered.png, {}, { blocks: true, text: true });
      out.set(n, structuredPage(data, rendered.width, rendered.height));
      done++;
      onProgress?.({ page: done, totalPages: pageNumbers.length });
    }
  } finally {
    await worker.terminate();
  }
  return out;
}
