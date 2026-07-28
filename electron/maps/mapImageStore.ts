import fs from 'node:fs';
import path from 'node:path';
import { prepareImageStorage } from '../imageStorage';

/**
 * Maps are the images users zoom into most deeply. Their source bytes are therefore
 * preserved exactly; only the grid thumbnail is derived.
 */
export interface PreparedMapImage {
  mimeType: string;
  width: number;
  height: number;
  blob: Buffer;
  thumbnail: Buffer;
  thumbnailMimeType: string;
}

export async function prepareMapImage(bytes: Buffer, mimeType?: string): Promise<PreparedMapImage> {
  const stored = prepareImageStorage(bytes, mimeType);
  return {
    mimeType: stored.mimeType,
    width: stored.width,
    height: stored.height,
    blob: stored.image,
    thumbnail: stored.thumbnail,
    thumbnailMimeType: stored.thumbnailMimeType,
  };
}

const READABLE = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff', '.avif']);

function mimeForExtension(extension: string): string {
  switch (extension) {
    case '.png': return 'image/png';
    case '.webp': return 'image/webp';
    case '.bmp': return 'image/bmp';
    case '.tif':
    case '.tiff': return 'image/tiff';
    case '.avif': return 'image/avif';
    default: return 'image/jpeg';
  }
}

export async function readMapImageFile(filePath: string): Promise<PreparedMapImage> {
  const ext = path.extname(filePath).toLowerCase();
  if (!READABLE.has(ext)) throw new Error(`No se puede usar «${ext}» como imagen de mapa.`);
  return prepareMapImage(fs.readFileSync(filePath), mimeForExtension(ext));
}

async function canvasLib() {
  return import('@napi-rs/canvas');
}

/** Crop is an intentional edit, so its new lossless PNG becomes the new original. */
export async function cropMapImage(
  bytes: Buffer,
  region: { x0: number; y0: number; x1: number; y1: number },
): Promise<PreparedMapImage> {
  const { createCanvas, loadImage } = await canvasLib();
  const source = await loadImage(bytes);
  const x0 = Math.max(0, Math.min(region.x0, region.x1)) * source.width;
  const y0 = Math.max(0, Math.min(region.y0, region.y1)) * source.height;
  const x1 = Math.min(1, Math.max(region.x0, region.x1)) * source.width;
  const y1 = Math.min(1, Math.max(region.y0, region.y1)) * source.height;
  const cropWidth = Math.max(1, Math.round(x1 - x0));
  const cropHeight = Math.max(1, Math.round(y1 - y0));

  const canvas = createCanvas(cropWidth, cropHeight);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, cropWidth, cropHeight);
  context.drawImage(source, Math.round(x0), Math.round(y0), cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  return prepareMapImage(canvas.toBuffer('image/png'), 'image/png');
}

/**
 * Place a map inside a larger lossless canvas for generative expansion. The growth
 * coordinates are shared with the marker transformation in `growMapCanvas`.
 */
export async function extendMapCanvas(
  bytes: Buffer,
  growth: { x0: number; y0: number; x1: number; y1: number },
  fill = '#f2ece1',
): Promise<PreparedMapImage> {
  const { createCanvas, loadImage } = await canvasLib();
  const source = await loadImage(bytes);
  const spanX = Math.max(1e-6, growth.x1 - growth.x0);
  const spanY = Math.max(1e-6, growth.y1 - growth.y0);
  const width = Math.max(1, Math.round(source.width / spanX));
  const height = Math.max(1, Math.round(source.height / spanY));

  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = fill;
  context.fillRect(0, 0, width, height);
  context.drawImage(source, Math.round(growth.x0 * width), Math.round(growth.y0 * height), source.width, source.height);
  return prepareMapImage(canvas.toBuffer('image/png'), 'image/png');
}
