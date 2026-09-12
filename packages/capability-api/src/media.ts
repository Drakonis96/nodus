import { LIMITS } from './limits';

/** Raster images and sound a capability produced.
 *
 *  The same bargain as a 3D model: the capability hands over bytes and gets back a
 *  reference, and the core decides what those bytes are. A declared MIME type is a claim,
 *  not evidence — an `image/png` that is really an HTML document would be a document the
 *  renderer was asked to treat as a picture — so the format is read from the first bytes
 *  of the file and the claim has to match what is actually there.
 *
 *  Only formats a browser decodes natively are accepted. Nothing here shells out to a
 *  converter, and nothing a capability supplies chooses a decoder. */

export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'] as const;
export const AUDIO_MIME_TYPES = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/mp4'] as const;

export type ImageMimeType = typeof IMAGE_MIME_TYPES[number];
export type AudioMimeType = typeof AUDIO_MIME_TYPES[number];

export interface MediaAssetInfo {
  kind: 'image' | 'audio';
  mimeType: ImageMimeType | AudioMimeType;
  bytes: number;
  /** Present for images whose dimensions are readable from the header. */
  width?: number;
  height?: number;
}

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) =>
  bytes.length >= offset + signature.length && signature.every((byte, index) => bytes[offset + index] === byte);

const ascii = (bytes: Uint8Array, offset: number, length: number) =>
  String.fromCharCode(...bytes.subarray(offset, offset + length));

/** What the first bytes say the file is, regardless of what it was called. */
function sniff(bytes: Uint8Array): { mimeType: string; width?: number; height?: number } | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    // PNG: the IHDR chunk is always first, and carries the dimensions.
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return bytes.length >= 24 && ascii(bytes, 12, 4) === 'IHDR'
      ? { mimeType: 'image/png', width: view.getUint32(16, false), height: view.getUint32(20, false) }
      : { mimeType: 'image/png' };
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { mimeType: 'image/jpeg', ...jpegSize(bytes) };
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return bytes.length >= 10
      ? { mimeType: 'image/gif', width: view.getUint16(6, true), height: view.getUint16(8, true) }
      : { mimeType: 'image/gif' };
  }
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && ascii(bytes, 8, 4) === 'WEBP') return { mimeType: 'image/webp' };
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && ascii(bytes, 8, 4) === 'WAVE') return { mimeType: 'audio/wav' };
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4);
    if (brand === 'avif' || brand === 'avis') return { mimeType: 'image/avif' };
    // `M4A `, `mp42`, `isom` and friends all decode as audio/mp4 when the track is sound.
    return { mimeType: 'audio/mp4' };
  }
  if (startsWith(bytes, [0x49, 0x44, 0x33]) || startsWith(bytes, [0xff, 0xfb]) || startsWith(bytes, [0xff, 0xf3]) || startsWith(bytes, [0xff, 0xf2])) return { mimeType: 'audio/mpeg' };
  if (startsWith(bytes, [0x4f, 0x67, 0x67, 0x53])) return { mimeType: 'audio/ogg' };
  if (startsWith(bytes, [0x66, 0x4c, 0x61, 0x43])) return { mimeType: 'audio/flac' };
  return null;
}

/** JPEG carries its size in whichever start-of-frame marker appears first. */
function jpegSize(bytes: Uint8Array): { width?: number; height?: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return {};
    const marker = bytes[offset + 1];
    const length = view.getUint16(offset + 2, false);
    // SOF0..SOF15, excluding the four that are not frame headers.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: view.getUint16(offset + 5, false), width: view.getUint16(offset + 7, false) };
    }
    if (length < 2) return {};
    offset += 2 + length;
  }
  return {};
}

/** The one check for a raster or a sound file a capability wants stored. */
export function validateMediaAsset(input: unknown, mimeType: string, expected?: 'image' | 'audio'): MediaAssetInfo {
  const bytes = input instanceof Uint8Array ? input : null;
  if (!bytes) throw new Error('Media must be handed over as bytes.');
  if (!bytes.byteLength) throw new Error('The file is empty.');

  const isImage = (IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
  const isAudio = (AUDIO_MIME_TYPES as readonly string[]).includes(mimeType);
  if (!isImage && !isAudio) throw new Error(`${mimeType || 'That type'} is not a format the viewer can open.`);
  const kind = isImage ? 'image' as const : 'audio' as const;
  if (expected && expected !== kind) throw new Error(`Expected ${expected}, got ${kind}.`);

  const ceiling = kind === 'image' ? LIMITS.imageBytes : LIMITS.audioBytes;
  if (bytes.byteLength > ceiling) throw new Error(`A ${kind} may not exceed ${Math.round(ceiling / (1024 * 1024))} MB.`);

  const sniffed = sniff(bytes);
  if (!sniffed) throw new Error('The file is not in a format the viewer can open.');
  // A container that decodes as either is judged by what it claims, as long as the claim
  // is one of the two the container can be; anything else has to match exactly.
  const interchangeable = sniffed.mimeType === 'audio/mp4' && mimeType === 'audio/mp4';
  if (sniffed.mimeType !== mimeType && !interchangeable) {
    throw new Error(`The file says it is ${mimeType} but its contents are ${sniffed.mimeType}.`);
  }

  if (kind === 'image' && sniffed.width && sniffed.height) {
    if (sniffed.width * sniffed.height > LIMITS.imagePixels) throw new Error('The image has more pixels than the viewer will open.');
  }

  return {
    kind,
    mimeType: mimeType as ImageMimeType | AudioMimeType,
    bytes: bytes.byteLength,
    ...(kind === 'image' && sniffed.width ? { width: sniffed.width, height: sniffed.height } : {}),
  };
}

export const isImageMimeType = (value: unknown): value is ImageMimeType => (IMAGE_MIME_TYPES as readonly string[]).includes(String(value));
export const isAudioMimeType = (value: unknown): value is AudioMimeType => (AUDIO_MIME_TYPES as readonly string[]).includes(String(value));
