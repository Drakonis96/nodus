/* Nodus Protect document engine — local-only loader, compositor, exporter and
 * verifier. Algorithms are ported from IDprotector v0.4.1 (MIT). */
import { PDFDocument } from 'pdf-lib';
import { GlobalWorkerOptions, OPS, getDocument, type PDFPageProxy } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type {
  AppLanguage,
  ProtectArtifact,
  ProtectExportFooter,
  ProtectFilePayload,
  ProtectIssuedCopy,
  ProtectTraceOptions,
  ProtectWatermark,
} from '@shared/types';
import { paintProtectPage, rotatedSize, type ProtectPage } from './editor';
import {
  IDPROTECTOR_PNG_KEYWORD,
  buildIdpsPayload,
  decodeIdps,
  embedIdpsIntoCanvas,
  idpsAvailable,
  isPng,
  pngInsertTextChunk,
  randomCopyId,
  readIdpsPngMetadata,
  toHex,
  type IdpsDecodeResult,
  type IdpsMetadata,
} from './stego';
import { renderWatermark, type WatermarkCopy } from './watermark';

GlobalWorkerOptions.workerSrc = pdfWorker;

export const PROTECT_MAX_IMAGE_DIMENSION = 2600;
export const PROTECT_PDF_TARGET_WIDTH = 1600;
export const PROTECT_DECODED_PAGE_CACHE_SIZE = 3;
const WATERMARK_REFERENCE_WIDTH = 1000;
const decodedPageLru: ProtectPage[] = [];

export interface ProtectAuthority {
  code: string;
  country: string;
  name: string;
  url: string;
}

export const PROTECT_AUTHORITIES: readonly ProtectAuthority[] = [
  { code: 'AT', country: 'Austria', name: 'Österreichische Datenschutzbehörde (DSB)', url: 'https://www.dsb.gv.at/' },
  { code: 'BE', country: 'Belgium', name: 'Autorité de protection des données / Gegevensbeschermingsautoriteit (APD-GBA)', url: 'https://www.autoriteprotectiondonnees.be/' },
  { code: 'BG', country: 'Bulgaria', name: 'Commission for Personal Data Protection (CPDP)', url: 'https://www.cpdp.bg/' },
  { code: 'HR', country: 'Croatia', name: 'Agencija za zaštitu osobnih podataka (AZOP)', url: 'https://azop.hr/' },
  { code: 'CY', country: 'Cyprus', name: 'Office of the Commissioner for Personal Data Protection', url: 'https://www.dataprotection.gov.cy/' },
  { code: 'CZ', country: 'Czech Republic', name: 'Úřad pro ochranu osobních údajů (ÚOOÚ)', url: 'https://uoou.gov.cz/' },
  { code: 'DK', country: 'Denmark', name: 'Datatilsynet', url: 'https://www.datatilsynet.dk/' },
  { code: 'EE', country: 'Estonia', name: 'Andmekaitse Inspektsioon (AKI)', url: 'https://www.aki.ee/' },
  { code: 'FI', country: 'Finland', name: 'Tietosuojavaltuutetun toimisto', url: 'https://tietosuoja.fi/' },
  { code: 'FR', country: 'France', name: "Commission Nationale de l'Informatique et des Libertés (CNIL)", url: 'https://www.cnil.fr/' },
  { code: 'DE', country: 'Germany', name: 'Die Bundesbeauftragte für den Datenschutz und die Informationsfreiheit (BfDI)', url: 'https://www.bfdi.bund.de/' },
  { code: 'GR', country: 'Greece', name: 'Αρχή Προστασίας Δεδομένων Προσωπικού Χαρακτήρα (HDPA)', url: 'https://www.dpa.gr/' },
  { code: 'HU', country: 'Hungary', name: 'Nemzeti Adatvédelmi és Információszabadság Hatóság (NAIH)', url: 'https://naih.hu/' },
  { code: 'IS', country: 'Iceland', name: 'Persónuvernd', url: 'https://www.personuvernd.is/' },
  { code: 'IE', country: 'Ireland', name: 'Data Protection Commission (DPC)', url: 'https://www.dataprotection.ie/' },
  { code: 'IT', country: 'Italy', name: 'Garante per la protezione dei dati personali', url: 'https://www.garanteprivacy.it/' },
  { code: 'LV', country: 'Latvia', name: 'Datu valsts inspekcija (DVI)', url: 'https://www.dvi.gov.lv/' },
  { code: 'LI', country: 'Liechtenstein', name: 'Datenschutzstelle (DSS)', url: 'https://www.datenschutzstelle.li/' },
  { code: 'LT', country: 'Lithuania', name: 'Valstybinė duomenų apsaugos inspekcija (VDAI)', url: 'https://vdai.lrv.lt/' },
  { code: 'LU', country: 'Luxembourg', name: 'Commission nationale pour la protection des données (CNPD)', url: 'https://cnpd.public.lu/' },
  { code: 'MT', country: 'Malta', name: 'Information and Data Protection Commissioner (IDPC)', url: 'https://idpc.org.mt/' },
  { code: 'NL', country: 'Netherlands', name: 'Autoriteit Persoonsgegevens (AP)', url: 'https://www.autoriteitpersoonsgegevens.nl/' },
  { code: 'NO', country: 'Norway', name: 'Datatilsynet', url: 'https://www.datatilsynet.no/' },
  { code: 'PL', country: 'Poland', name: 'Urząd Ochrony Danych Osobowych (UODO)', url: 'https://uodo.gov.pl/' },
  { code: 'PT', country: 'Portugal', name: 'Comissão Nacional de Proteção de Dados (CNPD)', url: 'https://www.cnpd.pt/' },
  { code: 'RO', country: 'Romania', name: 'Autoritatea Națională de Supraveghere a Prelucrării Datelor cu Caracter Personal (ANSPDCP)', url: 'https://www.dataprotection.ro/' },
  { code: 'SK', country: 'Slovakia', name: 'Úrad na ochranu osobných údajov Slovenskej republiky', url: 'https://dataprotection.gov.sk/' },
  { code: 'SI', country: 'Slovenia', name: 'Informacijski pooblaščenec (IP-RS)', url: 'https://www.ip-rs.si/' },
  { code: 'ES', country: 'Spain', name: 'Agencia Española de Protección de Datos (AEPD)', url: 'https://www.aepd.es/' },
  { code: 'SE', country: 'Sweden', name: 'Integritetsskyddsmyndigheten (IMY)', url: 'https://www.imy.se/' },
  { code: 'CH', country: 'Switzerland', name: 'Eidgenössischer Datenschutz- und Öffentlichkeitsbeauftragter (EDÖB)', url: 'https://www.edoeb.admin.ch/' },
  { code: 'GB', country: 'United Kingdom', name: "Information Commissioner's Office (ICO)", url: 'https://ico.org.uk/' },
];

const EU_REGULATION_URLS: Record<AppLanguage, string> = {
  es: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj/spa',
  en: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng',
  fr: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj/fra',
  de: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj/deu',
  pt: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj/por',
  'pt-BR': 'https://eur-lex.europa.eu/eli/reg/2016/679/oj/por',
  it: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita',
};

const DEFAULT_AUTHORITY: Record<AppLanguage, string> = {
  es: 'ES', en: 'IE', fr: 'FR', de: 'DE', pt: 'PT', 'pt-BR': 'PT', it: 'IT',
};

export function defaultProtectAuthority(language: AppLanguage): string {
  return DEFAULT_AUTHORITY[language] ?? 'ES';
}

export function defaultExportFooter(language: AppLanguage, defaultMessage: string): ProtectExportFooter {
  return {
    euLink: true,
    nationalLink: true,
    nationalCountry: defaultProtectAuthority(language),
    nationalCountryCustom: false,
    contactEmailEnabled: false,
    contactEmail: '',
    phoneEnabled: false,
    phone: '',
    messageEnabled: true,
    message: defaultMessage,
    messageCustom: false,
  };
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No se pudo crear el lienzo.');
  return context;
}

export function classifyProtectFile(file: Pick<ProtectFilePayload, 'name' | 'mimeType'>): 'pdf' | 'image' | null {
  if (file.mimeType === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf';
  if (/^image\//i.test(file.mimeType) || /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i.test(file.name)) return 'image';
  return null;
}

async function imagePayloadToCanvas(payload: ProtectFilePayload): Promise<HTMLCanvasElement> {
  const blob = new Blob([payload.bytes.slice().buffer as ArrayBuffer], { type: payload.mimeType || 'application/octet-stream' });
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    bitmap = await new Promise<ImageBitmap>((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const image = new Image();
      image.onload = async () => {
        URL.revokeObjectURL(url);
        try { resolve(await createImageBitmap(image)); } catch (error) { reject(error); }
      };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen.')); };
      image.src = url;
    });
  }
  const scale = Math.min(1, PROTECT_MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const canvas = createCanvas(bitmap.width * scale, bitmap.height * scale);
  context2d(canvas).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

function deferredPage(sourceName: string, loadOriginal: () => Promise<HTMLCanvasElement>): ProtectPage {
  return {
    base: createCanvas(1, 1), rects: [], undo: [], straighten: 0, sourceName,
    deferred: { loadOriginal, loaded: false },
  };
}

async function pdfPageCanvas(payload: ProtectFilePayload, number: number): Promise<HTMLCanvasElement> {
  const loading = getDocument({ data: payload.bytes.slice() });
  try {
    const pdf = await loading.promise;
    const page = await pdf.getPage(number);
    const viewportAtOne = page.getViewport({ scale: 1 });
    const scale = Math.min(3, PROTECT_PDF_TARGET_WIDTH / viewportAtOne.width);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(viewport.width, viewport.height);
    await page.render({ canvasContext: context2d(canvas), viewport }).promise;
    page.cleanup();
    await pdf.destroy();
    return canvas;
  } catch (error) {
    await loading.destroy().catch(() => undefined);
    const name = error && typeof error === 'object' ? String((error as { name?: unknown }).name ?? '') : '';
    if (/PasswordException/i.test(name)) throw new Error(`El PDF «${payload.name}» está cifrado. Guarda una copia sin contraseña y vuelve a intentarlo.`);
    if (/InvalidPDFException|MissingPDFException/i.test(name)) throw new Error(`El PDF «${payload.name}» está dañado o no es válido.`);
    throw error;
  }
}

async function pdfPayloadToPages(payload: ProtectFilePayload): Promise<ProtectPage[]> {
  const loading = getDocument({ data: payload.bytes.slice() });
  try {
    const pdf = await loading.promise;
    if (!pdf.numPages) throw new Error(`El PDF «${payload.name}» no contiene páginas.`);
    const count = pdf.numPages;
    await pdf.destroy();
    return Array.from({ length: count }, (_, index) => deferredPage(payload.name, () => pdfPageCanvas(payload, index + 1)));
  } catch (error) {
    await loading.destroy().catch(() => undefined);
    const name = error && typeof error === 'object' ? String((error as { name?: unknown }).name ?? '') : '';
    if (/PasswordException/i.test(name)) throw new Error(`El PDF «${payload.name}» está cifrado. Guarda una copia sin contraseña y vuelve a intentarlo.`);
    if (/InvalidPDFException|MissingPDFException/i.test(name)) throw new Error(`El PDF «${payload.name}» está dañado o no es válido.`);
    throw error;
  }
}

async function snapshotToCanvas(bytes: Uint8Array): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'image/png' }));
  const canvas = createCanvas(bitmap.width, bitmap.height);
  context2d(canvas).drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

async function evictDecodedPage(page: ProtectPage): Promise<void> {
  const deferred = page.deferred;
  if (!deferred?.loaded) return;
  deferred.snapshot = await canvasBytes(page.base, 'image/png');
  page.base.width = 1;
  page.base.height = 1;
  deferred.loaded = false;
}

function touchDecodedPage(page: ProtectPage): void {
  const previous = decodedPageLru.indexOf(page);
  if (previous >= 0) decodedPageLru.splice(previous, 1);
  decodedPageLru.push(page);
}

/** Ensure one page is rasterized and enforce a process-wide LRU of three page canvases. */
export async function ensureProtectPage(page: ProtectPage): Promise<void> {
  const deferred = page.deferred;
  if (!deferred) return;
  if (deferred.loaded) {
    touchDecodedPage(page);
    return;
  }
  if (!deferred.loading) {
    deferred.loading = (async () => {
      page.base = deferred.snapshot
        ? await snapshotToCanvas(deferred.snapshot)
        : await deferred.loadOriginal();
      deferred.loaded = true;
    })().finally(() => { deferred.loading = undefined; });
  }
  await deferred.loading;
  touchDecodedPage(page);
  while (decodedPageLru.length > PROTECT_DECODED_PAGE_CACHE_SIZE) {
    const victim = decodedPageLru.shift();
    if (victim && victim !== page) await evictDecodedPage(victim);
  }
}

export function disposeProtectPages(pages: ProtectPage[]): void {
  for (const page of pages) {
    const index = decodedPageLru.indexOf(page);
    if (index >= 0) decodedPageLru.splice(index, 1);
    page.base.width = 1;
    page.base.height = 1;
    if (page.deferred) { page.deferred.snapshot = undefined; page.deferred.loaded = false; }
  }
}

export async function loadProtectPages(
  payloads: ProtectFilePayload[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ pages: ProtectPage[]; hasPdf: boolean; baseName: string }> {
  const accepted = payloads.filter((payload) => classifyProtectFile(payload));
  if (!accepted.length) throw new Error('Formato no compatible. Usa imágenes o PDF.');
  const pages: ProtectPage[] = [];
  let done = 0;
  for (const payload of accepted) {
    const kind = classifyProtectFile(payload);
    const next = kind === 'pdf'
      ? await pdfPayloadToPages(payload)
      : [deferredPage(payload.name, () => imagePayloadToCanvas(payload))];
    pages.push(...next);
    done += 1;
    onProgress?.(done, accepted.length);
  }
  if (!pages.length) throw new Error('El documento no contiene páginas legibles.');
  for (const page of pages.slice(0, PROTECT_DECODED_PAGE_CACHE_SIZE)) await ensureProtectPage(page);
  const hasPdf = accepted.some((payload) => classifyProtectFile(payload) === 'pdf');
  const baseName = accepted.length === 1
    ? accepted[0].name.replace(/\.[^.]+$/, '') || 'documento'
    : 'documentos';
  return { pages, hasPdf, baseName };
}

interface FooterRow { kind: 'message' | 'link' | 'contact'; text: string }

export interface ProtectComposeCopy extends WatermarkCopy {
  language: AppLanguage;
  legalEu: string;
  contactEmail: string;
  contactPhone: string;
}

function exportFooterRows(footer: ProtectExportFooter, copy: ProtectComposeCopy): FooterRow[] {
  const rows: FooterRow[] = [];
  if (footer.messageEnabled && footer.message.trim()) rows.push({ kind: 'message', text: footer.message.trim() });
  if (footer.euLink) rows.push({ kind: 'link', text: `${copy.legalEu}: ${EU_REGULATION_URLS[copy.language]}` });
  if (footer.nationalLink) {
    const authority = PROTECT_AUTHORITIES.find((entry) => entry.code === footer.nationalCountry)
      ?? PROTECT_AUTHORITIES.find((entry) => entry.code === 'ES');
    if (authority) rows.push({ kind: 'link', text: `${authority.name}: ${authority.url}` });
  }
  if (footer.contactEmailEnabled && footer.contactEmail.trim()) rows.push({ kind: 'contact', text: `${copy.contactEmail}: ${footer.contactEmail.trim()}` });
  if (footer.phoneEnabled && footer.phone.trim()) rows.push({ kind: 'contact', text: `${copy.contactPhone}: ${footer.phone.trim()}` });
  return rows;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) { lines.push(line); line = word; }
    else line = candidate;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function layoutFooter(ctx: CanvasRenderingContext2D, width: number, rows: FooterRow[], scale: number) {
  const padX = Math.max(18, 24 * scale);
  const padY = Math.max(14, 18 * scale);
  const gap = Math.max(6, 8 * scale);
  const fontPx = Math.max(12, 13 * scale);
  const maxWidth = Math.max(1, width - padX * 2);
  const items = rows.map((row) => {
    const font = `${row.kind === 'message' ? '700' : '600'} ${fontPx}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif`;
    ctx.font = font;
    return {
      lines: wrapText(ctx, row.text, maxWidth),
      font,
      lineHeight: fontPx * 1.38,
      color: row.kind === 'link' ? '#145ca8' : '#1c1a17',
    };
  });
  const height = Math.ceil(padY * 2 + items.reduce((total, item, index) => (
    total + item.lines.length * item.lineHeight + (index < items.length - 1 ? gap : 0)
  ), 0));
  return { padX, padY, gap, items, height };
}

function drawFooter(ctx: CanvasRenderingContext2D, y: number, width: number, rows: FooterRow[], scale: number): number {
  const layout = layoutFooter(ctx, width, rows, scale);
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, y, width, layout.height);
  ctx.fillStyle = '#e2d8cd';
  ctx.fillRect(0, y, width, Math.max(1, Math.round(scale)));
  let cursor = y + layout.padY;
  layout.items.forEach((item, index) => {
    ctx.font = item.font;
    ctx.fillStyle = item.color;
    ctx.textBaseline = 'top';
    for (const line of item.lines) { ctx.fillText(line, layout.padX, cursor); cursor += item.lineHeight; }
    if (index < layout.items.length - 1) cursor += layout.gap;
  });
  ctx.restore();
  return layout.height;
}

export function composeProtectPage(
  page: ProtectPage,
  watermark: ProtectWatermark,
  footer: ProtectExportFooter,
  grayscale: boolean,
  targetWidth: number,
  pageIndex: number,
  copy: ProtectComposeCopy,
): HTMLCanvasElement {
  const degrees = page.straighten || 0;
  const display = degrees ? rotatedSize(page.base.width, page.base.height, degrees) : {
    w: page.base.width, h: page.base.height, rad: 0,
  };
  const scale = Math.min(1, targetWidth / display.w);
  const width = Math.max(1, Math.round(display.w * scale));
  const documentHeight = Math.max(1, Math.round(display.h * scale));
  const rows = exportFooterRows(footer, copy);
  const footerScale = width / WATERMARK_REFERENCE_WIDTH;
  const scratch = createCanvas(1, 1);
  const footerHeight = rows.length ? layoutFooter(context2d(scratch), width, rows, footerScale).height : 0;
  const canvas = createCanvas(width, documentHeight + footerHeight);
  const ctx = context2d(canvas);
  ctx.save();
  ctx.scale(scale, scale);
  if (degrees) {
    ctx.translate(display.w / 2, display.h / 2);
    ctx.rotate(display.rad);
    ctx.translate(-page.base.width / 2, -page.base.height / 2);
  }
  paintProtectPage(ctx, page, grayscale);
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, documentHeight);
  ctx.clip();
  renderWatermark(ctx, width, documentHeight, watermark, width / WATERMARK_REFERENCE_WIDTH, pageIndex, copy);
  ctx.restore();
  if (rows.length) drawFooter(ctx, documentHeight, width, rows, footerScale);
  return canvas;
}

export function composeProtectPageFull(
  page: ProtectPage,
  watermark: ProtectWatermark,
  footer: ProtectExportFooter,
  grayscale: boolean,
  pageIndex: number,
  copy: ProtectComposeCopy,
): HTMLCanvasElement {
  const target = page.straighten ? rotatedSize(page.base.width, page.base.height, page.straighten).w : page.base.width;
  return composeProtectPage(page, watermark, footer, grayscale, target, pageIndex, copy);
}

async function canvasBytes(canvas: HTMLCanvasElement, type: 'image/png' | 'image/jpeg', quality?: number): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => (
    value ? resolve(value) : reject(new Error('No se pudo codificar la imagen.'))
  ), type, quality));
  return new Uint8Array(await blob.arrayBuffer());
}

function u16le(value: number): number[] { return [value & 255, (value >> 8) & 255]; }
function u32le(value: number): number[] { return [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]; }
let zipCrcTable: number[] | undefined;

/** Dependency-free STORE zip; exact equivalent of the IDprotector writer. */
export function makeProtectZip(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  // Imported lazily to avoid a circular export in the IDPS module.
  const crc = (bytes: Uint8Array) => {
    let table = zipCrcTable;
    if (!table) {
      table = [];
      for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c >>> 0;
      }
      zipCrcTable = table;
    }
    let value = -1;
    for (const byte of bytes) value = (value >>> 8) ^ table[(value ^ byte) & 255];
    return (value ^ -1) >>> 0;
  };
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const checksum = crc(file.data);
    const local = new Uint8Array([
      ...u32le(0x04034b50), ...u16le(20), ...u16le(0), ...u16le(0), ...u16le(0), ...u16le(0),
      ...u32le(checksum), ...u32le(file.data.length), ...u32le(file.data.length), ...u16le(name.length), ...u16le(0),
    ]);
    parts.push(local, name, file.data);
    central.push(new Uint8Array([
      ...u32le(0x02014b50), ...u16le(20), ...u16le(20), ...u16le(0), ...u16le(0), ...u16le(0), ...u16le(0),
      ...u32le(checksum), ...u32le(file.data.length), ...u32le(file.data.length), ...u16le(name.length), ...u16le(0),
      ...u16le(0), ...u16le(0), ...u16le(0), ...u32le(0), ...u32le(offset),
    ]), name);
    offset += local.length + name.length + file.data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array([
    ...u32le(0x06054b50), ...u16le(0), ...u16le(0), ...u16le(files.length), ...u16le(files.length),
    ...u32le(centralSize), ...u32le(offset), ...u16le(0),
  ]);
  const all = [...parts, ...central, end];
  const result = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  for (const part of all) { result.set(part, cursor); cursor += part.length; }
  return result;
}

interface PreparedTrace {
  payload: Uint8Array;
  copyIdHex: string;
  keyed: 'open' | 'passphrase';
  meta: IdpsMetadata;
}

async function prepareTrace(trace: ProtectTraceOptions): Promise<PreparedTrace | null> {
  if (!trace.enabled || !idpsAvailable) return null;
  const copyId = randomCopyId();
  const copyIdHex = toHex(copyId);
  return {
    payload: await buildIdpsPayload(copyId, trace.passphrase),
    copyIdHex,
    keyed: trace.passphrase ? 'passphrase' : 'open',
    meta: { copyId: copyIdHex, purpose: trace.label, created: new Date().toISOString(), version: 'idps1' },
  };
}

export interface BuildProtectArtifactOptions {
  pages: ProtectPage[];
  watermark: ProtectWatermark;
  footer: ProtectExportFooter;
  grayscale: boolean;
  format: 'image' | 'pdf';
  baseName: string;
  protectedSuffix: string;
  pagePrefix: string;
  trace: ProtectTraceOptions;
  copy: ProtectComposeCopy;
  appVersion: string;
  sourceLabel?: string;
}

export interface BuiltProtectArtifact {
  artifact: ProtectArtifact;
  issued: ProtectIssuedCopy | null;
}

export async function buildProtectArtifact(options: BuildProtectArtifactOptions): Promise<BuiltProtectArtifact> {
  if (!options.pages.length) throw new Error('No hay páginas para exportar.');
  const trace = await prepareTrace(options.trace);
  let artifact: ProtectArtifact;
  if (options.format === 'pdf') {
    const document = await PDFDocument.create();
    for (let index = 0; index < options.pages.length; index += 1) {
      await ensureProtectPage(options.pages[index]);
      const canvas = composeProtectPageFull(
        options.pages[index], options.watermark, options.footer, options.grayscale, index, options.copy,
      );
      if (trace) embedIdpsIntoCanvas(canvas, trace.payload);
      const imageBytes = trace
        ? await canvasBytes(canvas, 'image/png')
        : await canvasBytes(canvas, 'image/jpeg', 0.92);
      const image = trace ? await document.embedPng(imageBytes) : await document.embedJpg(imageBytes);
      const page = document.addPage([canvas.width, canvas.height]);
      page.drawImage(image, { x: 0, y: 0, width: canvas.width, height: canvas.height });
    }
    document.setTitle(options.baseName);
    document.setProducer(`Nodus Protect · Nodus v${options.appVersion}`);
    document.setCreator('Nodus Protect');
    document.setCreationDate(new Date());
    document.setModificationDate(new Date());
    if (trace) {
      document.setSubject(trace.meta.purpose || '');
      document.setKeywords([IDPROTECTOR_PNG_KEYWORD, `copyId:${trace.copyIdHex}`, 'idps1']);
    } else {
      document.setSubject('');
      document.setKeywords(['Nodus Protect']);
    }
    artifact = {
      fileName: `${options.baseName}-${options.protectedSuffix}.pdf`,
      mimeType: 'application/pdf', format: 'pdf', pageCount: options.pages.length,
      bytes: await document.save(), sourceLabel: options.sourceLabel,
    };
  } else if (options.pages.length === 1) {
    await ensureProtectPage(options.pages[0]);
    const canvas = composeProtectPageFull(options.pages[0], options.watermark, options.footer, options.grayscale, 0, options.copy);
    if (trace) embedIdpsIntoCanvas(canvas, trace.payload);
    let bytes = await canvasBytes(canvas, 'image/png');
    if (trace) bytes = pngInsertTextChunk(bytes, IDPROTECTOR_PNG_KEYWORD, JSON.stringify(trace.meta));
    artifact = {
      fileName: `${options.baseName}-${options.protectedSuffix}.png`,
      mimeType: 'image/png', format: 'png', pageCount: 1, bytes, sourceLabel: options.sourceLabel,
    };
  } else {
    const files: Array<{ name: string; data: Uint8Array }> = [];
    for (let index = 0; index < options.pages.length; index += 1) {
      await ensureProtectPage(options.pages[index]);
      const canvas = composeProtectPageFull(
        options.pages[index], options.watermark, options.footer, options.grayscale, index, options.copy,
      );
      if (trace) embedIdpsIntoCanvas(canvas, trace.payload);
      let data = await canvasBytes(canvas, 'image/png');
      if (trace) data = pngInsertTextChunk(data, IDPROTECTOR_PNG_KEYWORD, JSON.stringify(trace.meta));
      files.push({ name: `${options.pagePrefix}-${index + 1}.png`, data });
    }
    artifact = {
      fileName: `${options.baseName}-${options.protectedSuffix}.zip`,
      mimeType: 'application/zip', format: 'zip', pageCount: options.pages.length,
      bytes: makeProtectZip(files), sourceLabel: options.sourceLabel,
    };
  }
  return {
    artifact,
    issued: trace ? {
      copyId: trace.copyIdHex,
      label: trace.meta.purpose,
      keyed: trace.keyed,
      format: options.format,
      fileName: artifact.fileName,
      created: trace.meta.created,
    } : null,
  };
}

export function issuedCopiesCsv(copies: ProtectIssuedCopy[]): Uint8Array {
  const cell = (value: unknown) => {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows: unknown[][] = [['copyId', 'label', 'keyed', 'format', 'fileName', 'created']];
  for (const copy of copies) rows.push([copy.copyId, copy.label, copy.keyed, copy.format, copy.fileName, copy.created]);
  return new TextEncoder().encode(rows.map((row) => row.map(cell).join(',')).join('\n'));
}

interface PdfImageObject { width: number; height: number; bitmap?: ImageBitmap; data?: Uint8Array }

async function bitmapImageData(bitmap: CanvasImageSource, width: number, height: number): Promise<ImageData> {
  const canvas = createCanvas(width, height);
  const context = context2d(canvas);
  context.drawImage(bitmap, 0, 0);
  return context.getImageData(0, 0, width, height);
}

async function exactPdfPageImageData(page: PDFPageProxy): Promise<{ image: ImageData; fallback: boolean }> {
  try {
    const operations = await page.getOperatorList();
    let objectId: string | null = null;
    for (let index = 0; index < operations.fnArray.length; index += 1) {
      if (operations.fnArray[index] === OPS.paintImageXObject) {
        objectId = String(operations.argsArray[index][0]);
        break;
      }
    }
    if (!objectId) throw new Error('no image xobject');
    const image = await new Promise<PdfImageObject>((resolve, reject) => {
      try {
        page.objs.get(objectId!, (value: PdfImageObject | null) => value ? resolve(value) : reject(new Error('empty image object')));
      } catch (error) { reject(error); }
    });
    if (image.bitmap) return { image: await bitmapImageData(image.bitmap, image.width, image.height), fallback: false };
    if (image.data) {
      const result = new ImageData(image.width, image.height);
      const pixels = image.width * image.height;
      if (image.data.length === pixels * 4) result.data.set(image.data);
      else if (image.data.length === pixels * 3) {
        for (let pixel = 0; pixel < pixels; pixel += 1) {
          result.data[pixel * 4] = image.data[pixel * 3];
          result.data[pixel * 4 + 1] = image.data[pixel * 3 + 1];
          result.data[pixel * 4 + 2] = image.data[pixel * 3 + 2];
          result.data[pixel * 4 + 3] = 255;
        }
      } else throw new Error('unsupported image kind');
      return { image: result, fallback: false };
    }
    throw new Error('unsupported image object');
  } catch {
    const viewport = page.getViewport({ scale: 1 });
    const canvas = createCanvas(viewport.width, viewport.height);
    const context = context2d(canvas);
    await page.render({ canvasContext: context, viewport }).promise;
    return { image: context.getImageData(0, 0, canvas.width, canvas.height), fallback: true };
  }
}

export type ProtectVerifyPixel = IdpsDecodeResult & { page?: number; unavailable?: boolean };

export interface ProtectVerifyResult {
  metadata: IdpsMetadata | null;
  pixel: ProtectVerifyPixel;
  fallback: boolean;
  pageCount: number;
}

function pdfMetadata(info: Record<string, unknown> | undefined): IdpsMetadata | null {
  const keywords = String(info?.Keywords ?? '');
  if (!keywords.includes(IDPROTECTOR_PNG_KEYWORD)) return null;
  const id = keywords.match(/copyId:([0-9a-f]+)/i)?.[1] ?? '';
  return {
    copyId: id,
    purpose: String(info?.Subject ?? ''),
    created: String(info?.CreationDate ?? ''),
    version: 'idps1',
  };
}

async function naturalImageData(payload: ProtectFilePayload): Promise<ImageData> {
  const bitmap = await createImageBitmap(new Blob([payload.bytes.slice().buffer as ArrayBuffer], { type: payload.mimeType }));
  const result = await bitmapImageData(bitmap, bitmap.width, bitmap.height);
  bitmap.close();
  return result;
}

export async function verifyProtectFile(payload: ProtectFilePayload, passphrase: string): Promise<ProtectVerifyResult> {
  const kind = classifyProtectFile(payload);
  if (!kind) throw new Error('Formato no compatible.');
  let metadata: IdpsMetadata | null = null;
  const images: ImageData[] = [];
  let fallback = false;
  if (kind === 'pdf') {
    const pdf = await getDocument({ data: payload.bytes.slice() }).promise;
    const meta = await pdf.getMetadata().catch(() => null);
    metadata = pdfMetadata(meta?.info as unknown as Record<string, unknown> | undefined);
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const extracted = await exactPdfPageImageData(page).catch(() => null);
      if (extracted) { images.push(extracted.image); fallback ||= extracted.fallback; }
      page.cleanup();
    }
    await pdf.destroy();
  } else {
    if (isPng(payload.bytes)) metadata = readIdpsPngMetadata(payload.bytes);
    images.push(await naturalImageData(payload));
  }
  if (!idpsAvailable) return { metadata, pixel: { found: false, unavailable: true }, fallback, pageCount: images.length };
  let selected: ProtectVerifyPixel | null = null;
  for (let index = 0; index < images.length; index += 1) {
    const result = await decodeIdps(images[index], passphrase);
    if (result.found && (!selected?.found || (result.verified && !selected.verified))) selected = { ...result, page: index + 1 };
    if (selected?.found && selected.verified) break;
  }
  return { metadata, pixel: selected ?? { found: false }, fallback, pageCount: images.length };
}
