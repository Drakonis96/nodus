import fs from 'node:fs';
import path from 'node:path';

/**
 * Preparing a map image for storage.
 *
 * Deliberately NOT `optimizedJpegs` from decorativeImages.ts, which downsizes to 1280 px
 * wide. That is right for a decorative header and catastrophic for a map: a world map is
 * the one image in Nodus a reader zooms INTO, and 1280 px turns every city label into a
 * smear the moment they do.
 *
 * So: up to 4096 px on the long side, WebP at quality 88, plus a 480 px thumbnail for the
 * grid. WebP because a 4096 px map is 3–6 MB as JPEG and roughly a third less as WebP,
 * and those bytes live in the vault database — they travel in every backup and in every
 * `.nodussync` package.
 *
 * The encoder is `@napi-rs/canvas`, not Electron's `nativeImage`: nativeImage only knows
 * `toPNG()` and `toJPEG()`. It is already a dependency (decorativeImages.ts uses it to
 * rasterise WebP and SVG), so this adds nothing to the installer.
 */

/** The long side a stored map is capped at. Beyond this the memory cost stops paying. */
export const MAX_MAP_DIMENSION = 4096;
/** What the grid draws. Small enough that listing thirty maps is cheap. */
export const MAP_THUMBNAIL_WIDTH = 480;
/**
 * WebP quality on `@napi-rs/canvas` is **0–100, not 0–1**. Passing 0.88 does not mean
 * "88%": it is read as quality 1 and produces a 16 KB smear where 88 produces 190 KB of
 * readable map. Measured on this tree, and pinned by scripts/test-world-map-images.mjs —
 * nothing about the call site would reveal the mistake, and the damage only shows when
 * the author zooms in.
 */
const WEBP_QUALITY = 88;
const THUMBNAIL_QUALITY = 78;

export interface PreparedMapImage {
  mimeType: string;
  width: number;
  height: number;
  blob: Buffer;
  thumbnail: Buffer | null;
}

type Canvas = import('@napi-rs/canvas').Canvas;

async function canvasLib() {
  return import('@napi-rs/canvas');
}

function encodeWebp(canvas: Canvas, quality: number): Buffer {
  return canvas.toBuffer('image/webp', quality);
}

/**
 * Decode, cap and re-encode. Returns the FULL image plus a thumbnail.
 *
 * An image already inside the cap is still re-encoded, so that everything in `map_images`
 * is WebP and the renderer never has to care what the author happened to upload.
 */
export async function prepareMapImage(bytes: Buffer): Promise<PreparedMapImage> {
  if (!bytes.length) throw new Error('El archivo de imagen está vacío.');
  const { createCanvas, loadImage } = await canvasLib();
  const source = await loadImage(bytes).catch(() => {
    throw new Error('No se pudo leer la imagen: formato no reconocido o archivo dañado.');
  });
  if (!source.width || !source.height) throw new Error('La imagen no tiene un tamaño válido.');

  // Only the width is derived here; `render` recomputes the height from the source
  // aspect ratio so the cap can never quietly stretch a map.
  const scale = Math.min(1, MAX_MAP_DIMENSION / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));

  const render = (targetWidth: number, quality: number): { buffer: Buffer; width: number; height: number } => {
    const targetHeight = Math.max(1, Math.round(targetWidth * (source.height / source.width)));
    const canvas = createCanvas(targetWidth, targetHeight);
    const context = canvas.getContext('2d');
    // A map may be a PNG with transparency; a transparent map reads as a hole once it is
    // laid over the dark viewer background, so it is flattened onto white here.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, targetWidth, targetHeight);
    context.drawImage(source, 0, 0, targetWidth, targetHeight);
    return { buffer: encodeWebp(canvas, quality), width: targetWidth, height: targetHeight };
  };

  const full = render(width, WEBP_QUALITY);
  const thumbnail = width > MAP_THUMBNAIL_WIDTH ? render(MAP_THUMBNAIL_WIDTH, THUMBNAIL_QUALITY).buffer : full.buffer;
  return { mimeType: 'image/webp', width: full.width, height: full.height, blob: full.buffer, thumbnail };
}

const READABLE = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff', '.avif']);

export async function readMapImageFile(filePath: string): Promise<PreparedMapImage> {
  const ext = path.extname(filePath).toLowerCase();
  if (!READABLE.has(ext)) throw new Error(`No se puede usar «${ext}» como imagen de mapa.`);
  return prepareMapImage(fs.readFileSync(filePath));
}

/**
 * Crop a region out of a map image, in normalized coordinates.
 *
 * This is the no-AI half of "ampliación": instant, free, offline and geographically
 * EXACT. It is offered before the AI path on purpose — an author who commissioned their
 * map from an illustrator wants exactly this, and everyone else wants it as the base the
 * AI detail is then asked for.
 */
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
  return prepareMapImage(encodeWebp(canvas, WEBP_QUALITY));
}

/**
 * Place an image inside a larger canvas, ready to be handed to an image model as the
 * thing to continue. The new area is filled with a neutral tone rather than left
 * transparent: several providers flatten transparency to black, and a model asked to
 * continue a map into a black rectangle draws an ocean at night.
 *
 * `growth` MUST be the same object passed to `growMapCanvas`, or the pins and the
 * pixels will disagree.
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
  return prepareMapImage(encodeWebp(canvas, WEBP_QUALITY));
}
