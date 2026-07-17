// Nodus Toolkit — images (category D). Electron-free: @napi-rs/canvas for
// decode/encode/resize, heic-decode for HEIC. Heavy deps load lazily. HEIC is
// verified against a real iPhone photo only in scripts/verify-toolkit-heic.mjs —
// a real HEIC never enters the repo (§6.2-bis); the unit suite covers only the
// deterministic HEIC magic-byte detection.
import fs from 'node:fs';
import path from 'node:path';
import type { ToolkitOpRegistry, ToolkitRunContext } from '../toolkitJobs';
import type { ToolkitProduced } from '@shared/toolkitTypes';

async function getCanvas() {
  return import('@napi-rs/canvas');
}

function clampQuality(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 90;
  return Math.min(100, Math.max(1, n));
}

const EXT_FOR: Record<string, string> = { png: 'png', jpeg: 'jpg', webp: 'webp', avif: 'avif' };

/** Encode a canvas to the requested format at the given quality (JPEG/WebP/AVIF). */
function encodeCanvas(canvas: any, format: string, quality: number): Uint8Array {
  switch (format) {
    case 'jpeg':
      return canvas.toBuffer('image/jpeg', quality);
    case 'webp':
      return canvas.toBuffer('image/webp', quality);
    case 'avif':
      return canvas.toBuffer('image/avif', quality);
    default:
      return canvas.toBuffer('image/png');
  }
}

async function drawToCanvas(bytes: Buffer, createCanvas: any, loadImage: any) {
  const image = await loadImage(bytes);
  const canvas = createCanvas(image.width, image.height);
  canvas.getContext('2d').drawImage(image, 0, 0);
  return { canvas, width: image.width, height: image.height };
}

/** D1 — re-encode an image to PNG / JPEG / WebP. */
async function convertImage(input: string, ctx: ToolkitRunContext): Promise<ToolkitProduced[]> {
  const { createCanvas, loadImage } = await getCanvas();
  const format = ctx.outputFormat ?? 'png';
  const { canvas } = await drawToCanvas(fs.readFileSync(input), createCanvas, loadImage);
  ctx.onPageProgress(1);
  return [{ data: encodeCanvas(canvas, format, clampQuality(ctx.options.quality)), ext: EXT_FOR[format] ?? 'png' }];
}

/** True when the bytes carry the ISO-BMFF `ftyp` box of a HEIC/HEIF file. */
export function isHeic(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  // Bytes 4..8 must be 'ftyp'.
  if (bytes[4] !== 0x66 || bytes[5] !== 0x74 || bytes[6] !== 0x79 || bytes[7] !== 0x70) return false;
  const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  return ['heic', 'heix', 'heif', 'hevc', 'mif1', 'msf1', 'heim', 'heis', 'hevm', 'hevs'].includes(brand);
}

/** D2 — decode a HEIC/HEIF image and re-encode it to JPEG or PNG. */
async function convertHeic(input: string, ctx: ToolkitRunContext): Promise<ToolkitProduced[]> {
  const bytes = fs.readFileSync(input);
  if (!isHeic(new Uint8Array(bytes))) {
    throw new Error('El archivo no parece un HEIC/HEIF válido.');
  }
  let decode: any;
  try {
    const mod: any = await import('heic-decode');
    decode = mod.default ?? mod;
  } catch {
    throw new Error('El decodificador HEIC no está disponible.');
  }
  const { width, height, data } = await decode({ buffer: bytes });
  const { createCanvas } = await getCanvas();
  const canvas = createCanvas(width, height);
  const cctx = canvas.getContext('2d');
  const imageData = cctx.createImageData(width, height);
  imageData.data.set(new Uint8Array(data.buffer ?? data));
  cctx.putImageData(imageData, 0, 0);
  const format = ctx.outputFormat ?? 'jpeg';
  ctx.onPageProgress(1);
  return [{ data: encodeCanvas(canvas, format, clampQuality(ctx.options.quality)), ext: EXT_FOR[format] ?? 'jpg' }];
}

function outputExtForInput(input: string): { format: string; ext: string } {
  const ext = path.extname(input).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return { format: 'jpeg', ext: 'jpg' };
  if (ext === '.webp') return { format: 'webp', ext: 'webp' };
  return { format: 'png', ext: 'png' };
}

/** D3 — resize by a maximum side (px) or a percentage, preserving aspect ratio. */
async function resizeImage(input: string, ctx: ToolkitRunContext): Promise<ToolkitProduced[]> {
  const { createCanvas, loadImage } = await getCanvas();
  const image = await loadImage(fs.readFileSync(input));
  const mode = String(ctx.options.mode ?? 'maxSide');
  const value = Number(ctx.options.value ?? 0);
  let scale = 1;
  if (mode === 'percent') scale = value / 100;
  else scale = value / Math.max(image.width, image.height);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('El valor de redimensionado no es válido.');
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = createCanvas(width, height);
  canvas.getContext('2d').drawImage(image, 0, 0, width, height);
  const { format, ext } = outputExtForInput(input);
  ctx.onPageProgress(1);
  return [{ data: encodeCanvas(canvas, format, clampQuality(ctx.options.quality ?? 90)), ext, suffix: ' (redimensionado)' }];
}

/** D4 — recompress to JPEG or WebP at a chosen quality (lossy). */
async function compressImage(input: string, ctx: ToolkitRunContext): Promise<ToolkitProduced[]> {
  const { createCanvas, loadImage } = await getCanvas();
  const { canvas } = await drawToCanvas(fs.readFileSync(input), createCanvas, loadImage);
  const format = ctx.outputFormat ?? 'jpeg';
  ctx.onPageProgress(1);
  return [{ data: encodeCanvas(canvas, format, clampQuality(ctx.options.quality ?? 70)), ext: EXT_FOR[format] ?? 'jpg', suffix: ' (comprimido)' }];
}

/** Crop centered to an aspect ratio like "1:1" or "16:9". */
async function cropImage(input: string, ctx: ToolkitRunContext): Promise<ToolkitProduced[]> {
  const { createCanvas, loadImage } = await getCanvas();
  const image = await loadImage(fs.readFileSync(input));
  const [aw, ah] = String(ctx.options.aspect ?? '1:1').split(':').map((n) => Number(n));
  const targetRatio = aw > 0 && ah > 0 ? aw / ah : 1;
  let cw: number;
  let ch: number;
  if (image.width / image.height > targetRatio) {
    ch = image.height;
    cw = Math.round(ch * targetRatio);
  } else {
    cw = image.width;
    ch = Math.round(cw / targetRatio);
  }
  const sx = Math.round((image.width - cw) / 2);
  const sy = Math.round((image.height - ch) / 2);
  const canvas = createCanvas(cw, ch);
  canvas.getContext('2d').drawImage(image, sx, sy, cw, ch, 0, 0, cw, ch);
  const { format, ext } = outputExtForInput(input);
  ctx.onPageProgress(1);
  return [{ data: encodeCanvas(canvas, format, clampQuality(ctx.options.quality ?? 92)), ext, suffix: ' (recortado)' }];
}

/** Rotate by 90/180/270° or flip horizontally/vertically. */
async function rotateImage(input: string, ctx: ToolkitRunContext): Promise<ToolkitProduced[]> {
  const { createCanvas, loadImage } = await getCanvas();
  const image = await loadImage(fs.readFileSync(input));
  const mode = String(ctx.options.transform ?? 'rotate90');
  const quarter = mode === 'rotate90' || mode === 'rotate270';
  const cw = quarter ? image.height : image.width;
  const ch = quarter ? image.width : image.height;
  const canvas = createCanvas(cw, ch);
  const c = canvas.getContext('2d');
  switch (mode) {
    case 'rotate90':
      c.translate(cw, 0);
      c.rotate(Math.PI / 2);
      break;
    case 'rotate180':
      c.translate(cw, ch);
      c.rotate(Math.PI);
      break;
    case 'rotate270':
      c.translate(0, ch);
      c.rotate(-Math.PI / 2);
      break;
    case 'flipH':
      c.translate(cw, 0);
      c.scale(-1, 1);
      break;
    case 'flipV':
      c.translate(0, ch);
      c.scale(1, -1);
      break;
    default:
      break;
  }
  c.drawImage(image, 0, 0);
  const { format, ext } = outputExtForInput(input);
  ctx.onPageProgress(1);
  return [{ data: encodeCanvas(canvas, format, clampQuality(ctx.options.quality ?? 92)), ext, suffix: ' (rotado)' }];
}

/** Stamp a text watermark over the image. */
async function watermarkImage(input: string, ctx: ToolkitRunContext): Promise<ToolkitProduced[]> {
  const { createCanvas, loadImage } = await getCanvas();
  const image = await loadImage(fs.readFileSync(input));
  const text = String(ctx.options.text ?? '').trim() || 'BORRADOR';
  const opacity = Math.min(0.9, Math.max(0.05, Number(ctx.options.opacity ?? 0.35)));
  const position = String(ctx.options.position ?? 'bottom-right');
  const canvas = createCanvas(image.width, image.height);
  const c = canvas.getContext('2d');
  c.drawImage(image, 0, 0);
  const size = Math.max(16, Math.round(Math.min(image.width, image.height) / 14));
  c.font = `bold ${size}px sans-serif`;
  c.textBaseline = 'alphabetic';
  const draw = (x: number, y: number) => {
    c.fillStyle = `rgba(255,255,255,${opacity})`;
    c.strokeStyle = `rgba(0,0,0,${opacity * 0.6})`;
    c.lineWidth = Math.max(1, size / 16);
    c.strokeText(text, x, y);
    c.fillText(text, x, y);
  };
  const pad = size;
  const textWidth = c.measureText(text).width;
  if (position === 'tile') {
    c.globalAlpha = 1;
    for (let y = size + pad; y < image.height; y += size * 4) {
      for (let x = pad; x < image.width; x += textWidth + size * 3) draw(x, y);
    }
  } else if (position === 'center') {
    draw((image.width - textWidth) / 2, image.height / 2);
  } else if (position === 'top-left') {
    draw(pad, size + pad);
  } else {
    draw(image.width - textWidth - pad, image.height - pad);
  }
  const { format, ext } = outputExtForInput(input);
  ctx.onPageProgress(1);
  return [{ data: encodeCanvas(canvas, format, clampQuality(ctx.options.quality ?? 92)), ext, suffix: ' (marca de agua)' }];
}

export const imageOps: ToolkitOpRegistry = {
  'image-convert': { arity: 'each', run: ([input], ctx) => convertImage(input, ctx) },
  'heic-convert': { arity: 'each', run: ([input], ctx) => convertHeic(input, ctx) },
  'image-resize': { arity: 'each', run: ([input], ctx) => resizeImage(input, ctx) },
  'image-compress': { arity: 'each', run: ([input], ctx) => compressImage(input, ctx) },
  'image-crop': { arity: 'each', run: ([input], ctx) => cropImage(input, ctx) },
  'image-rotate': { arity: 'each', run: ([input], ctx) => rotateImage(input, ctx) },
  'image-watermark': { arity: 'each', run: ([input], ctx) => watermarkImage(input, ctx) },
};
