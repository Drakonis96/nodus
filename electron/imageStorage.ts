import { createCanvas, Image } from '@napi-rs/canvas';
import { nativeImage } from 'electron';

const THUMBNAIL_LONG_EDGE = 480;
const THUMBNAIL_JPEG_QUALITY = 86;

export interface StoredImageAssets {
  /** Exact bytes returned by the provider or selected by the user. Never resized or re-encoded. */
  image: Buffer;
  mimeType: string;
  /** A separate compact derivative used only by lists and grids. */
  thumbnail: Buffer;
  thumbnailMimeType: string;
  width: number;
  height: number;
}

function sniffImageMime(bytes: Buffer, declared?: string | null): string {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (bytes.subarray(0, 6).toString('ascii').match(/^GIF8[79]a$/)) return 'image/gif';
  if (bytes.subarray(0, 2).toString('ascii') === 'BM') return 'image/bmp';
  const clean = declared?.toLowerCase().trim();
  return clean && /^image\/[a-z0-9.+-]+$/i.test(clean) ? clean : 'application/octet-stream';
}

/**
 * Keep the source image byte-for-byte and derive a thumbnail independently.
 *
 * Full-screen viewers, zoom, exports and backups always receive `image`. Only cards and
 * grids receive `thumbnail`, so performance no longer requires sacrificing source detail.
 */
export function prepareImageStorage(bytes: Buffer, declaredMimeType?: string | null): StoredImageAssets {
  if (!bytes.length) throw new Error('El archivo de imagen está vacío.');
  const electronSource = nativeImage?.createFromBuffer(bytes);
  if (electronSource && !electronSource.isEmpty()) {
    const { width, height } = electronSource.getSize();
    const longest = Math.max(width, height);
    const scale = Math.min(1, THUMBNAIL_LONG_EDGE / longest);
    const resized =
      scale < 1
        ? electronSource.resize({
            width: Math.max(1, Math.round(width * scale)),
            height: Math.max(1, Math.round(height * scale)),
            quality: 'best',
          })
        : electronSource;
    return {
      image: Buffer.from(bytes),
      mimeType: sniffImageMime(bytes, declaredMimeType),
      thumbnail: resized.toJPEG(THUMBNAIL_JPEG_QUALITY),
      thumbnailMimeType: 'image/jpeg',
      width,
      height,
    };
  }

  // Electron exposes no nativeImage implementation while its binary is running in
  // Node-only test mode. The canvas fallback keeps repositories testable there.
  const source = new Image();
  try {
    source.src = bytes;
  } catch {
    throw new Error('No se pudo leer la imagen: formato no reconocido o archivo dañado.');
  }
  const { width, height } = source;
  if (!width || !height) throw new Error('La imagen no tiene un tamaño válido.');

  const longest = Math.max(width, height);
  const scale = Math.min(1, THUMBNAIL_LONG_EDGE / longest);
  const thumbWidth = Math.max(1, Math.round(width * scale));
  const thumbHeight = Math.max(1, Math.round(height * scale));
  const canvas = createCanvas(thumbWidth, thumbHeight);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, thumbWidth, thumbHeight);
  context.drawImage(source, 0, 0, thumbWidth, thumbHeight);

  return {
    image: Buffer.from(bytes),
    mimeType: sniffImageMime(bytes, declaredMimeType),
    thumbnail: canvas.toBuffer('image/jpeg', THUMBNAIL_JPEG_QUALITY),
    thumbnailMimeType: 'image/jpeg',
    width,
    height,
  };
}
