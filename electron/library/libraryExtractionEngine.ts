import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import type TurndownServiceType from 'turndown';
import type {
  LibraryExtractionOptions,
  LibraryItemRecord,
  LibraryQualityReport,
  LibrarySourceAnchor,
  LibrarySourceBlock,
  LibrarySourceMap,
} from '@shared/libraryTypes';
import { openPdf, loadPdfjs } from '../extraction/pdfjsLoader';
import { ocrPdfPages } from '../extraction/ocr';
import { csvFileToText, xlsxFileToText } from '../extraction/tabular';
import { atomicWriteFile, atomicWriteJson, assertInside, safeLibraryFolderName } from './libraryPaths';
import { LibraryDiskStore } from './libraryStorage';
import {
  extractionFingerprint,
  LIBRARY_EXTRACTION_PIPELINE,
  publishLibraryContentRevision,
} from './libraryRevision';
import { reanchorLibraryAnnotations } from './libraryAnnotationReanchor';

export const DEFAULT_LIBRARY_EXTRACTION_OPTIONS: LibraryExtractionOptions = {
  ocrMode: 'local',
  ocrLanguages: 'spa+eng',
  maxOcrPages: 500,
  extractImages: true,
  detectTables: true,
  force: false,
};

interface PositionedItem {
  text: string;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  size: number;
}

interface LayoutLine {
  text: string;
  page: number;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  size: number;
  items: PositionedItem[];
}

interface OutputBlock {
  kind: LibrarySourceBlock['kind'];
  text: string;
  markdown: string;
  anchors: LibrarySourceAnchor[];
  order?: number;
}

interface PageLayout {
  page: number;
  width: number;
  height: number;
  lines: LayoutLine[];
}

export interface LibraryExtractionResult {
  item: LibraryItemRecord;
  quality: LibraryQualityReport;
  sourceMap: LibrarySourceMap;
}

export type LibraryExtractionProgressHandler = (value: {
  phase: 'analyze' | 'extract' | 'ocr' | 'assets' | 'write';
  progress: number;
  message: string;
}) => void;

export interface LibraryRemoteOcrPage {
  page: number;
  image: Buffer;
  mimeType: 'image/png';
}

export type LibraryRemoteOcr = (input: LibraryRemoteOcrPage, signal?: AbortSignal) => Promise<string>;

type TurndownConstructor = typeof TurndownServiceType;
let turndownConstructor: TurndownConstructor | null = null;

function createTurndown(): TurndownServiceType {
  if (!turndownConstructor) {
    // The package's Node fallback contains a real CommonJS require(), so load it
    // through Node's module bridge instead of embedding it in the ESM main bundle.
    const packageName = ['turn', 'down'].join('');
    const loaded = createRequire(import.meta.url)(packageName) as TurndownConstructor | { default: TurndownConstructor };
    turndownConstructor = 'default' in loaded ? loaded.default : loaded;
  }
  return new turndownConstructor({ headingStyle: 'atx', bulletListMarker: '-' });
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Extracción cancelada', 'AbortError');
}

function sha256Buffer(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function sha256File(file: string): string {
  const hash = createHash('sha256');
  const descriptor = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (!read) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

export function cleanInlineText(value: string): string {
  return value
    .normalize('NFC')
    .replace(/\u00ad/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\t ]+/g, ' ')
    .replace(/\s+([,.;:!?%)\]}»”])/g, '$1')
    .replace(/([¿¡([{«“])\s+/g, '$1')
    .trim();
}

function dehyphenatingJoin(left: string, right: string): string {
  const first = left.trimEnd();
  const second = right.trimStart();
  if (!first) return second;
  if (!second) return first;
  if (/\p{L}{2,}-$/u.test(first) && /^\p{Ll}/u.test(second)) return cleanInlineText(`${first.slice(0, -1)}${second}`);
  return cleanInlineText(`${first} ${second}`);
}

export function normalizeCleanMarkdown(value: string): string {
  const input = value.replace(/\r\n?/g, '\n').normalize('NFC').replace(/\u00ad/g, '');
  const output: string[] = [];
  let fenced = false;
  for (const raw of input.split('\n')) {
    if (/^\s*```/.test(raw)) { fenced = !fenced; output.push(raw.trimEnd()); continue; }
    if (fenced) { output.push(raw.trimEnd()); continue; }
    if (!raw.trim()) { output.push(''); continue; }
    const prefix = raw.match(/^\s*(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+|\[\^[^\]]+\]:\s*)/)?.[0] ?? '';
    const body = cleanInlineText(raw.slice(prefix.length));
    output.push(`${prefix.trimStart()}${body}`.trimEnd());
  }
  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function anchor(line: LayoutLine): LibrarySourceAnchor {
  return { page: line.page, bbox: [rounded(line.x0), rounded(line.top), rounded(line.x1), rounded(line.bottom)] };
}

function mergeAnchors(lines: LayoutLine[]): LibrarySourceAnchor[] {
  const pages = new Map<number, [number, number, number, number]>();
  for (const line of lines) {
    const current = pages.get(line.page);
    if (!current) pages.set(line.page, [line.x0, line.top, line.x1, line.bottom]);
    else pages.set(line.page, [Math.min(current[0], line.x0), Math.min(current[1], line.top), Math.max(current[2], line.x1), Math.max(current[3], line.bottom)]);
  }
  return [...pages].sort(([a], [b]) => a - b).map(([page, box]) => ({ page, bbox: box.map(rounded) as LibrarySourceAnchor['bbox'] }));
}

function joinLineItems(items: PositionedItem[]): string {
  const ordered = [...items].sort((a, b) => a.x0 - b.x0);
  let text = '';
  let previous: PositionedItem | null = null;
  for (const item of ordered) {
    if (!item.text.trim()) continue;
    const gap = previous ? item.x0 - previous.x1 : 0;
    const average = previous ? Math.max(2, (previous.x1 - previous.x0) / Math.max(1, previous.text.length)) : 4;
    const separator = previous && gap > average * 0.35 ? ' ' : '';
    text += `${separator}${item.text}`;
    previous = item;
  }
  return cleanInlineText(text);
}

async function pageLayout(page: any, number: number): Promise<PageLayout> {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent({ includeMarkedContent: true });
  const positioned: PositionedItem[] = [];
  for (const raw of content.items ?? []) {
    if (typeof raw?.str !== 'string' || !raw.str.trim() || !Array.isArray(raw.transform)) continue;
    const x0 = Number(raw.transform[4]) || 0;
    const baseline = Number(raw.transform[5]) || 0;
    const size = Math.max(1, Math.abs(Number(raw.transform[3]) || Number(raw.height) || 10));
    const width = Math.max(0, Number(raw.width) || raw.str.length * size * 0.45);
    positioned.push({
      text: raw.str, x0, x1: x0 + width,
      top: viewport.height - baseline - size,
      bottom: viewport.height - baseline + size * 0.25,
      size,
    });
  }
  positioned.sort((a, b) => a.top - b.top || a.x0 - b.x0);
  const groups: PositionedItem[][] = [];
  for (const item of positioned) {
    let group: PositionedItem[] | undefined;
    for (let index = groups.length - 1; index >= 0; index -= 1) {
      const candidate = groups[index];
      if (Math.abs(median(candidate.map((entry) => entry.top)) - item.top) <= Math.max(2.5, item.size * 0.28)) { group = candidate; break; }
    }
    if (group) group.push(item); else groups.push([item]);
  }
  const lines = groups.map((items) => ({
    text: joinLineItems(items), page: number,
    x0: Math.min(...items.map((entry) => entry.x0)), x1: Math.max(...items.map((entry) => entry.x1)),
    top: Math.min(...items.map((entry) => entry.top)), bottom: Math.max(...items.map((entry) => entry.bottom)),
    size: median(items.map((entry) => entry.size)), items: [...items].sort((a, b) => a.x0 - b.x0),
  })).filter((line) => line.text);
  return { page: number, width: viewport.width, height: viewport.height, lines };
}

function repeatedChrome(pages: PageLayout[]): Set<string> {
  const counts = new Map<string, Set<number>>();
  for (const page of pages) {
    for (const line of page.lines.filter((entry) => entry.top < page.height * 0.1 || entry.bottom > page.height * 0.9)) {
      const key = cleanInlineText(line.text).toLocaleLowerCase().replace(/\d+/g, '#');
      if (key.length < 3 || key.length > 180) continue;
      counts.set(key, new Set([...(counts.get(key) ?? []), page.page]));
    }
  }
  const threshold = Math.max(3, Math.ceil(pages.length * 0.45));
  return new Set([...counts].filter(([, pageSet]) => pageSet.size >= threshold).map(([key]) => key));
}

function readingOrder(page: PageLayout): LayoutLine[] {
  const lines = [...page.lines];
  const middle = page.width / 2;
  const left = lines.filter((line) => line.x0 < middle - 15 && line.x1 <= middle + 30 && line.x1 - line.x0 < page.width * 0.7);
  const right = lines.filter((line) => line.x0 >= middle - 30 && line.x1 - line.x0 < page.width * 0.7);
  if (left.length < 4 || right.length < 4) return lines.sort((a, b) => a.top - b.top || a.x0 - b.x0);
  const spanning = lines.filter((line) => !left.includes(line) && !right.includes(line)).sort((a, b) => a.top - b.top);
  const firstColumnTop = Math.min(...left.map((line) => line.top), ...right.map((line) => line.top));
  const header = spanning.filter((line) => line.bottom <= firstColumnTop + 5);
  const footer = spanning.filter((line) => !header.includes(line));
  return [
    ...header,
    ...left.sort((a, b) => a.top - b.top || a.x0 - b.x0),
    ...right.sort((a, b) => a.top - b.top || a.x0 - b.x0),
    ...footer,
  ];
}

function rowCells(line: LayoutLine): string[] {
  if (line.items.length < 2) return [];
  const cells: string[] = [];
  let current = '';
  let previous: PositionedItem | null = null;
  for (const item of line.items) {
    const gap = previous ? item.x0 - previous.x1 : 0;
    const average = previous ? (previous.x1 - previous.x0) / Math.max(1, previous.text.length) : 4;
    if (previous && gap > Math.max(16, average * 3)) {
      cells.push(cleanInlineText(current));
      current = item.text;
    } else current = current ? `${current} ${item.text}` : item.text;
    previous = item;
  }
  if (current) cells.push(cleanInlineText(current));
  return cells.filter(Boolean);
}

function detectTableRuns(lines: LayoutLine[]): Array<{ lines: LayoutLine[]; rows: string[][] }> {
  const output: Array<{ lines: LayoutLine[]; rows: string[][] }> = [];
  let run: Array<{ line: LayoutLine; cells: string[] }> = [];
  const flush = (): void => {
    if (run.length >= 2) {
      const widthCounts = new Map<number, number>();
      for (const entry of run) widthCounts.set(entry.cells.length, (widthCounts.get(entry.cells.length) ?? 0) + 1);
      const width = [...widthCounts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
      const stable = run.filter((entry) => entry.cells.length === width);
      if (width >= 2 && stable.length >= 2) output.push({ lines: stable.map((entry) => entry.line), rows: stable.map((entry) => entry.cells) });
    }
    run = [];
  };
  for (const line of lines) {
    const cells = rowCells(line);
    if (cells.length >= 2 && cells.length <= 12) run.push({ line, cells }); else flush();
  }
  flush();
  return output;
}

function renderTable(rows: string[][]): string {
  const width = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => [...row, ...Array(Math.max(0, width - row.length)).fill('')].map((cell) => cell.replace(/\|/g, '\\|')));
  return [
    `| ${normalized[0].join(' | ')} |`,
    `| ${Array(width).fill('---').join(' | ')} |`,
    ...normalized.slice(1).map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function pageBlocks(page: PageLayout, chrome: Set<string>, detectTables: boolean, isFirstPage: boolean): OutputBlock[] {
  let lines = readingOrder(page).filter((line) => !chrome.has(cleanInlineText(line.text).toLocaleLowerCase().replace(/\d+/g, '#')));
  const lineOrder = new Map(lines.map((line, index) => [line, index]));
  const bodySize = median(lines.filter((line) => line.text.length > 20).map((line) => line.size)) || median(lines.map((line) => line.size)) || 10;
  const blocks: OutputBlock[] = [];
  const tables = detectTables ? detectTableRuns(lines) : [];
  const tableLines = new Set(tables.flatMap((table) => table.lines));
  for (const table of tables) {
    blocks.push({
      kind: 'table', text: table.rows.flat().join(' '), markdown: renderTable(table.rows), anchors: mergeAnchors(table.lines),
      order: Math.min(...table.lines.map((line) => lineOrder.get(line) ?? Number.MAX_SAFE_INTEGER)),
    });
  }
  lines = lines.filter((line) => !tableLines.has(line));
  let paragraph: LayoutLine[] = [];
  const flush = (): void => {
    if (!paragraph.length) return;
    let text = paragraph[0].text;
    for (const line of paragraph.slice(1)) text = dehyphenatingJoin(text, line.text);
    blocks.push({
      kind: 'paragraph', text, markdown: text, anchors: mergeAnchors(paragraph),
      order: Math.min(...paragraph.map((line) => lineOrder.get(line) ?? Number.MAX_SAFE_INTEGER)),
    });
    paragraph = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const short = line.text.length <= 180;
    const heading = short && line.size >= bodySize * 1.17 && !/[.;,]$/.test(line.text);
    if (heading) {
      flush();
      const title = isFirstPage && blocks.every((block) => block.kind !== 'title') && line.size >= bodySize * 1.35;
      blocks.push({
        kind: title ? 'title' : 'heading', text: line.text, markdown: `${title ? '#' : '##'} ${line.text}`,
        anchors: [anchor(line)], order: lineOrder.get(line),
      });
      continue;
    }
    const previous = paragraph.at(-1);
    const gap = previous ? line.top - previous.bottom : 0;
    const columnJump = previous && (line.x0 > previous.x1 + 30 || previous.x0 > line.x1 + 30);
    const startsList = /^([•●▪◦*-]|\d+[.)])\s+/.test(line.text);
    if (previous && (gap > bodySize * 1.15 || columnJump || startsList)) flush();
    paragraph.push(line);
  }
  flush();
  return blocks.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

async function imageObjToPng(image: any): Promise<Buffer | null> {
  if (!image?.width || !image?.height || !image?.data || image.width * image.height < 40_000) return null;
  const { createCanvas } = await import('@napi-rs/canvas');
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  const data = context.createImageData(image.width, image.height);
  const target = data.data;
  const source = image.data as Uint8Array;
  const pixels = image.width * image.height;
  if (image.kind === 3 || source.length >= pixels * 4) target.set(source.subarray(0, pixels * 4));
  else if (image.kind === 2 || source.length >= pixels * 3) {
    for (let index = 0; index < pixels; index += 1) {
      target[index * 4] = source[index * 3];
      target[index * 4 + 1] = source[index * 3 + 1];
      target[index * 4 + 2] = source[index * 3 + 2];
      target[index * 4 + 3] = 255;
    }
  } else return null;
  context.putImageData(data, 0, 0);
  return canvas.toBuffer('image/png');
}

async function renderPdfPage(page: any, scale = 2): Promise<Buffer> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  await page.render({ canvasContext: context as any, viewport }).promise;
  return canvas.toBuffer('image/png');
}

async function extractPdfAssets(pdf: any, folder: string, layouts: PageLayout[], signal?: AbortSignal): Promise<OutputBlock[]> {
  const pdfjs = await loadPdfjs();
  const results: OutputBlock[] = [];
  const seen = new Set<string>();
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    abortIfNeeded(signal);
    const page = await pdf.getPage(pageNumber);
    const operators = await page.getOperatorList();
    const names = new Set<string>();
    for (let index = 0; index < operators.fnArray.length; index += 1) {
      if ([pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintJpegXObject, pdfjs.OPS.paintImageXObjectRepeat].includes(operators.fnArray[index])) {
        const name = operators.argsArray[index]?.[0];
        if (typeof name === 'string') names.add(name);
      }
    }
    for (const name of names) {
      const image = await new Promise<any>((resolve) => {
        try {
          if (page.objs.has(name)) resolve(page.objs.get(name));
          else page.objs.get(name, resolve);
        } catch { resolve(null); }
      });
      const png = await imageObjToPng(image);
      if (!png) continue;
      const hash = sha256Buffer(png);
      if (seen.has(hash)) continue;
      seen.add(hash);
      const fileName = `figure-p${String(pageNumber).padStart(4, '0')}-${hash.slice(0, 12)}.png`;
      const target = assertInside(folder, path.join(folder, 'assets', fileName));
      if (!fs.existsSync(target)) atomicWriteFile(target, png);
      const layout = layouts[pageNumber - 1];
      const captionLine = layout?.lines.find((line) => /^(fig(?:ura|ure)?|gr[aá]fic[oa]|mapa|table|tabla)\b/i.test(line.text));
      const caption = captionLine?.text ?? `Figura de la página ${pageNumber}`;
      results.push({
        kind: 'figure', text: caption,
        markdown: `![${caption.replaceAll('[', '').replaceAll(']', '')}](assets/${fileName})`,
        anchors: captionLine ? [anchor(captionLine)] : [{ page: pageNumber, bbox: [0, rounded((layout?.height ?? 0) / 2), rounded(layout?.width ?? 0), rounded(layout?.height ?? 0)] }],
        order: captionLine && layout ? readingOrder(layout).indexOf(captionLine) + 0.5 : Number.MAX_SAFE_INTEGER,
      });
    }
    page.cleanup?.();
  }
  return results;
}

function plainTextBlocks(text: string, page = 1): OutputBlock[] {
  const cleaned = text.replace(/\r\n?/g, '\n').normalize('NFC').replace(/\u00ad/g, '');
  const parts = cleaned.split(/\n\s*\n+/).map((part) => part.split('\n').reduce(dehyphenatingJoin, '')).map(cleanInlineText).filter(Boolean);
  return parts.map((part, index) => {
    const heading = part.length < 160 && index < 20 && !/[.!?]$/.test(part);
    return {
      kind: heading ? (index === 0 ? 'title' : 'heading') : 'paragraph',
      text: part,
      markdown: heading ? `${index === 0 ? '#' : '##'} ${part}` : part,
      anchors: [{ page, bbox: [0, 0, 0, 0] }],
    };
  });
}

function markdownBlocks(markdown: string): OutputBlock[] {
  const normalized = normalizeCleanMarkdown(markdown);
  const blocks: OutputBlock[] = [];
  let cursor = 0;
  for (const part of normalized.trim().split(/\n{2,}/)) {
    const heading = /^(#{1,6})\s+(.+)$/.exec(part);
    const table = /^\|.+\|\n\|(?:\s*:?-+:?\s*\|)+/m.test(part);
    const image = /^!\[/.test(part);
    const kind: OutputBlock['kind'] = heading ? (heading[1].length === 1 && cursor === 0 ? 'title' : 'heading') : table ? 'table' : image ? 'figure' : part.startsWith('>') ? 'quote' : 'paragraph';
    blocks.push({ kind, text: heading?.[2] ?? part.replace(/[*_`>#|[\]()!-]/g, ' '), markdown: part, anchors: [{ page: 1, bbox: [0, 0, 0, 0] }] });
    cursor += part.length + 2;
  }
  return blocks;
}

function copyZipAssets(zip: AdmZip, folder: string, matcher: RegExp): Array<{ source: string; target: string }> {
  const copied: Array<{ source: string; target: string }> = [];
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !matcher.test(entry.entryName)) continue;
    const bytes = entry.getData();
    const extension = path.extname(entry.entryName).toLowerCase() || '.bin';
    const name = `${safeLibraryFolderName(path.basename(entry.entryName, extension))}-${sha256Buffer(bytes).slice(0, 12)}${extension}`;
    const target = assertInside(folder, path.join(folder, 'assets', name));
    if (!fs.existsSync(target)) atomicWriteFile(target, bytes);
    copied.push({ source: entry.entryName.replace(/\\/g, '/'), target: `assets/${name}` });
  }
  return copied;
}

/**
 * Older Library versions encoded every dot when a storage filename contained
 * Unicode or another unsafe character (for example `An%C3%A1lisis%2Epdf`). Keep
 * those immutable paths in place, but recover the real suffix for extraction.
 */
function sourceExtension(source: string): string {
  const literal = path.extname(source).toLowerCase();
  if (literal) return literal;
  try { return path.extname(decodeURIComponent(path.basename(source))).toLowerCase(); }
  catch { return ''; }
}

async function nonPdfBlocks(source: string, folder: string): Promise<{ blocks: OutputBlock[]; pages: LibrarySourceMap['pages'] }> {
  const extension = sourceExtension(source);
  if (['.md', '.markdown'].includes(extension)) return { blocks: markdownBlocks(fs.readFileSync(source, 'utf8')), pages: [{ page: 1, width: 0, height: 0 }] };
  if (['.txt', '.rtf'].includes(extension)) return { blocks: plainTextBlocks(fs.readFileSync(source, 'utf8')), pages: [{ page: 1, width: 0, height: 0 }] };
  if (extension === '.csv' || extension === '.tsv') return { blocks: markdownBlocks(csvFileToText(source)), pages: [{ page: 1, width: 0, height: 0 }] };
  if (['.xlsx', '.xls', '.ods'].includes(extension)) return { blocks: markdownBlocks(xlsxFileToText(source)), pages: [{ page: 1, width: 0, height: 0 }] };
  if (extension === '.docx') {
    const mammoth: any = await import('mammoth');
    const html = String((await mammoth.convertToHtml({ path: source })).value ?? '');
    const zip = new AdmZip(source);
    const assets = copyZipAssets(zip, folder, /^word\/media\//i);
    const service = createTurndown();
    let markdown = service.turndown(html);
    if (assets.length) markdown += `\n\n## Recursos extraídos\n\n${assets.map((asset, index) => `![Recurso ${index + 1}](${asset.target})`).join('\n\n')}`;
    return { blocks: markdownBlocks(markdown), pages: [{ page: 1, width: 0, height: 0 }] };
  }
  if (extension === '.epub') {
    const zip = new AdmZip(source);
    const assets = copyZipAssets(zip, folder, /\.(png|jpe?g|gif|webp|svg)$/i);
    const lookup = new Map(assets.map((asset) => [asset.source, asset.target]));
    const service = createTurndown();
    const chapters = zip.getEntries().filter((entry) => !entry.isDirectory && /\.(xhtml|html?)$/i.test(entry.entryName) && !/(^|\/)(nav|toc)\./i.test(entry.entryName));
    const markdown = chapters.map((entry) => {
      let html = entry.getData().toString('utf8');
      html = html.replace(/(<img\b[^>]*\bsrc=["'])([^"']+)(["'])/gi, (_all, prefix, raw, suffix) => {
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(entry.entryName), raw));
        return `${prefix}${lookup.get(resolved) ?? raw}${suffix}`;
      });
      return service.turndown(html);
    }).filter(Boolean).join('\n\n');
    return { blocks: markdownBlocks(markdown), pages: [{ page: 1, width: 0, height: 0 }] };
  }
  if (['.html', '.htm', '.xml', '.jats'].includes(extension)) {
    const service = createTurndown();
    return { blocks: markdownBlocks(service.turndown(fs.readFileSync(source, 'utf8'))), pages: [{ page: 1, width: 0, height: 0 }] };
  }
  throw new Error(`Formato de extracción no compatible: ${extension || '(sin extensión)'}`);
}

async function pdfBlocks(
  source: string,
  folder: string,
  options: LibraryExtractionOptions,
  onProgress?: LibraryExtractionProgressHandler,
  signal?: AbortSignal,
  remoteOcr?: LibraryRemoteOcr,
): Promise<{ blocks: OutputBlock[]; pages: LibrarySourceMap['pages']; ocrPages: number; blankPages: number }> {
  const pdf = await openPdf(source);
  const layouts: PageLayout[] = [];
  const blank: number[] = [];
  let ocrPages = 0;
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      abortIfNeeded(signal);
      const page = await pdf.getPage(pageNumber);
      const layout = await pageLayout(page, pageNumber);
      layouts.push(layout);
      if (layout.lines.reduce((sum, line) => sum + line.text.length, 0) < 50) blank.push(pageNumber);
      page.cleanup?.();
      onProgress?.({ phase: 'extract', progress: 0.08 + (pageNumber / pdf.numPages) * 0.47, message: `Extrayendo página ${pageNumber} de ${pdf.numPages}…` });
    }
    if (blank.length && options.ocrMode !== 'off') {
      const pages = blank.slice(0, options.maxOcrPages);
      if (options.ocrMode === 'local') {
        const recognized = await ocrPdfPages(pdf, pages, options.ocrLanguages, ({ page, totalPages }) => onProgress?.({
          phase: 'ocr', progress: 0.55 + (page / totalPages) * 0.2, message: `OCR local ${page} de ${totalPages}…`,
        }));
        for (const [pageNumber, text] of recognized) {
          if (!text.trim()) continue;
          const layout = layouts[pageNumber - 1];
          layout.lines = plainTextBlocks(text, pageNumber).map((block, index) => ({
            text: block.text, page: pageNumber, x0: 0, x1: layout.width,
            top: index * 12, bottom: index * 12 + 10, size: 10, items: [],
          }));
          ocrPages += 1;
        }
      } else {
        if (!remoteOcr) throw new Error('El OCR remoto solo puede usarse tras elegir explícitamente un modelo de visión.');
        for (let index = 0; index < pages.length; index += 1) {
          abortIfNeeded(signal);
          const pageNumber = pages[index];
          const page = await pdf.getPage(pageNumber);
          const image = await renderPdfPage(page);
          page.cleanup?.();
          const text = await remoteOcr({ page: pageNumber, image, mimeType: 'image/png' }, signal);
          if (text.trim()) {
            const layout = layouts[pageNumber - 1];
            layout.lines = plainTextBlocks(text, pageNumber).map((block, line) => ({ text: block.text, page: pageNumber, x0: 0, x1: layout.width, top: line * 12, bottom: line * 12 + 10, size: 10, items: [] }));
            ocrPages += 1;
          }
          onProgress?.({ phase: 'ocr', progress: 0.55 + ((index + 1) / pages.length) * 0.2, message: `OCR remoto ${index + 1} de ${pages.length}…` });
        }
      }
    }
    const chrome = repeatedChrome(layouts);
    const blocks = layouts.flatMap((layout, index) => pageBlocks(layout, chrome, options.detectTables, index === 0));
    if (options.extractImages) {
      onProgress?.({ phase: 'assets', progress: 0.78, message: 'Extrayendo imágenes y figuras…' });
      blocks.push(...await extractPdfAssets(pdf, folder, layouts, signal));
    }
    blocks.sort((a, b) => a.anchors[0].page - b.anchors[0].page || (a.order ?? 0) - (b.order ?? 0));
    return {
      blocks,
      pages: layouts.map((layout) => ({ page: layout.page, width: rounded(layout.width), height: rounded(layout.height) })),
      ocrPages,
      blankPages: blank.length - ocrPages,
    };
  } finally {
    await pdf.destroy?.();
  }
}

function qualityReport(markdown: string, blocks: OutputBlock[], ocrPages: number, blankPages: number): LibraryQualityReport {
  const prose = markdown.replace(/https?:\/\/\S+/g, '');
  const warnings: string[] = [];
  const doubleSpaces = (prose.match(/(?<!\n) {2,}/g) ?? []).length;
  const decomposedUnicodeMarks = [...markdown].filter((character) => /\p{M}/u.test(character)).length;
  const softHyphens = (markdown.match(/\u00ad/g) ?? []).length;
  const brokenWordLineWraps = (markdown.match(/\p{L}-\n\p{Ll}/gu) ?? []).length;
  if (blankPages) warnings.push(`${blankPages} página(s) quedaron sin texto.`);
  if (doubleSpaces) warnings.push('El texto contiene espacios dobles inesperados.');
  if (brokenWordLineWraps) warnings.push('Quedan palabras partidas al final de línea.');
  if (markdown.trim().length < 100) warnings.push('La extracción contiene muy poco texto.');
  const status = warnings.length === 0 ? 'passed' : markdown.trim().length >= 100 ? 'needs-review' : 'failed';
  return {
    status, characters: markdown.length, words: (markdown.match(/[\p{L}\p{N}]+/gu) ?? []).length,
    blocks: blocks.length, headings: blocks.filter((block) => ['title', 'heading'].includes(block.kind)).length,
    figures: blocks.filter((block) => block.kind === 'figure').length,
    tables: blocks.filter((block) => block.kind === 'table').length,
    ocrPages, blankPages, doubleSpaces, decomposedUnicodeMarks, softHyphens, brokenWordLineWraps, warnings,
  };
}

function originalPath(item: LibraryItemRecord, store: LibraryDiskStore): string {
  const folder = store.itemFolder(item.storageId);
  const candidates = [
    item.files?.original,
    ...[...item.attachments].sort((a, b) => (a.role === 'original' ? -1 : b.role === 'original' ? 1 : 0)).map((attachment) => attachment.relativePath),
  ].filter((value): value is string => !!value);
  for (const relative of candidates) {
    const file = assertInside(folder, path.join(folder, relative));
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  }
  throw new Error('El documento no tiene un original local compatible para extraer.');
}

export async function extractLibraryItem(options: {
  item: LibraryItemRecord;
  store: LibraryDiskStore;
  extractionOptions?: Partial<LibraryExtractionOptions>;
  onProgress?: LibraryExtractionProgressHandler;
  signal?: AbortSignal;
  remoteOcr?: LibraryRemoteOcr;
}): Promise<LibraryExtractionResult> {
  const { store, signal, onProgress } = options;
  const settings = { ...DEFAULT_LIBRARY_EXTRACTION_OPTIONS, ...(options.extractionOptions ?? {}) };
  const source = originalPath(options.item, store);
  const folder = store.itemFolder(options.item.storageId);
  const extractionRoot = assertInside(folder, path.join(folder, '.nodus', 'extractions'));
  const staging = assertInside(extractionRoot, path.join(extractionRoot, `.staging-${randomUUID()}`));
  fs.mkdirSync(staging, { recursive: true });
  try {
    abortIfNeeded(signal);
    onProgress?.({ phase: 'analyze', progress: 0.02, message: `Analizando ${path.basename(source)}…` });
    const extracted = sourceExtension(source) === '.pdf'
      ? await pdfBlocks(source, staging, settings, onProgress, signal, options.remoteOcr)
      : { ...(await nonPdfBlocks(source, staging)), ocrPages: 0, blankPages: 0 };
    abortIfNeeded(signal);
    const blocks = extracted.blocks.filter((block) => block.markdown.trim());
    if (!blocks.length) throw new Error('No se pudo recuperar texto ni contenido legible del original.');
    const rendered: string[] = [];
    const sourceBlocks: LibrarySourceBlock[] = [];
    let cursor = 0;
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      const markdown = normalizeCleanMarkdown(block.markdown).trim();
      if (!markdown) continue;
      const chunk = `${markdown}\n\n`;
      sourceBlocks.push({
        id: `${safeLibraryFolderName(options.item.storageId).slice(0, 20)}-${sha256Buffer(`${block.kind}\0${index}\0${block.text}`).slice(0, 16)}`,
        kind: block.kind, markdown: { start: cursor, end: cursor + markdown.length },
        anchors: block.anchors, textSha256: sha256Buffer(block.text),
      });
      rendered.push(chunk);
      cursor += chunk.length;
    }
    const markdown = normalizeCleanMarkdown(rendered.join(''));
    const quality = qualityReport(markdown, blocks, extracted.ocrPages, extracted.blankPages);
    const readableBefore = store.readMaterializedItem(options.item.storageId) ?? options.item;
    if (quality.status === 'failed' && readableBefore.files?.reader) {
      throw new Error(quality.warnings.join(' ') || 'La extracción no produjo una copia legible.');
    }
    const sourceSha256 = sha256File(source);
    const cleanContentFingerprint = sha256Buffer(markdown);
    const cleanExtractionFingerprint = extractionFingerprint({ sourceSha256, options: settings });
    const versionFolder = assertInside(extractionRoot, path.join(extractionRoot, cleanExtractionFingerprint));
    const readerFile = path.join(staging, 'reader.md');
    const mapFile = path.join(staging, 'source-map.json');
    const reportFile = path.join(staging, 'quality-report.json');
    onProgress?.({ phase: 'write', progress: 0.96, message: 'Guardando Markdown y trazabilidad…' });
    atomicWriteFile(readerFile, markdown);
    const sourceMap: LibrarySourceMap = {
      version: 1,
      source: { file: path.relative(folder, source), sha256: sourceSha256 },
      reader: { file: 'reader.md', sha256: cleanContentFingerprint },
      pages: extracted.pages,
      blocks: sourceBlocks,
    };
    atomicWriteJson(mapFile, sourceMap);
    atomicWriteJson(reportFile, quality);
    abortIfNeeded(signal);
    if (fs.existsSync(versionFolder)) fs.rmSync(staging, { recursive: true, force: true });
    else fs.renameSync(staging, versionFolder);
    const relativeVersion = path.relative(folder, versionFolder).split(path.sep).join('/');
    const now = new Date().toISOString();
    const current = store.readMaterializedItem(options.item.storageId) ?? options.item;
    const files = {
      ...(current.files ?? {}),
      reader: path.join(relativeVersion, 'reader.md'),
      sourceMap: path.join(relativeVersion, 'source-map.json'),
      qualityReport: path.join(relativeVersion, 'quality-report.json'),
      annotations: current.files?.annotations ?? 'annotations.json',
      orphanedAnnotations: current.files?.orphanedAnnotations ?? 'orphaned-annotations.json',
    };
    let contentRevision = publishLibraryContentRevision({
      item: current,
      extractionFingerprint: cleanExtractionFingerprint,
      contentFingerprint: cleanContentFingerprint,
      files,
      now,
    });
    if (quality.status === 'failed') contentRevision = {
      ...contentRevision,
      components: {
        ...contentRevision.components,
        extraction: {
          ...contentRevision.components.extraction,
          freshness: 'failed',
          reason: quality.warnings.join(' ') || 'The extraction did not produce a complete readable copy.',
        },
      },
    };
    const annotationsFile = assertInside(folder, path.join(folder, files.annotations));
    const orphanedFile = assertInside(folder, path.join(folder, files.orphanedAnnotations));
    const priorReader = current.files?.reader
      ? assertInside(folder, path.join(folder, current.files.reader))
      : null;
    if (fs.existsSync(annotationsFile)) reanchorLibraryAnnotations({
      annotationsFile,
      orphanedFile,
      oldText: priorReader && fs.existsSync(priorReader) ? fs.readFileSync(priorReader, 'utf8') : '',
      newText: markdown,
      contentFingerprint: cleanContentFingerprint,
      now,
    });
    const item = store.upsertItem({
      ...current,
      files,
      contentRevision,
      extraction: {
        status: quality.status === 'passed' ? 'ready' : quality.status === 'needs-review' ? 'needs-review' : 'failed',
        progress: 1,
        engine: `${LIBRARY_EXTRACTION_PIPELINE} (${settings.ocrMode})`,
        updatedAt: now,
        ...(quality.status === 'failed' ? { error: quality.warnings.join(' ') } : {
          lastSuccessfulAt: now,
          lastSuccessfulFingerprint: cleanExtractionFingerprint,
        }),
      },
    }, current.clock.revision, now);
    return { item, quality, sourceMap };
  } finally {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
  }
}
