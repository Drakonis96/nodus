// Downscaled previews for image attachments. The grid and the gallery draw one preview per
// visible row; reading the original blob for that is what makes a large photo catalogue
// unusable (a 5 GB / 7k-image catalogue averages ~800 KB per file, all of it crossing IPC
// to fill a 40px box). nativeImage ships with Electron, so this costs no new dependency.

import { nativeImage } from 'electron';

/** Longest edge of a generated thumbnail, in pixels. */
const THUMB_MAX_EDGE = 400;
/** JPEG quality for generated thumbnails. */
const THUMB_QUALITY = 72;

const IMAGE_MIME_RE = /^image\/(jpeg|jpg|png|gif|bmp|webp|tiff?)$/i;

/** Whether a thumbnail can be produced for this attachment's type. */
export function isThumbnailable(mimeType: string | null): boolean {
  return Boolean(mimeType && IMAGE_MIME_RE.test(mimeType));
}

/**
 * Build a downscaled JPEG preview of an image buffer. Returns null when the buffer is not a
 * decodable image or is already smaller than the thumbnail bound — in that case the original
 * is small enough to serve directly and a second copy would only waste space.
 */
export function makeThumbnail(buf: Buffer, mimeType: string | null): Buffer | null {
  if (!isThumbnailable(mimeType)) return null;
  try {
    const img = nativeImage.createFromBuffer(buf);
    if (img.isEmpty()) return null;
    const { width, height } = img.getSize();
    if (width === 0 || height === 0) return null;
    const longest = Math.max(width, height);
    if (longest <= THUMB_MAX_EDGE && buf.length <= 64 * 1024) return null;
    const resized =
      longest <= THUMB_MAX_EDGE
        ? img
        : img.resize(
            width >= height
              ? { width: THUMB_MAX_EDGE, quality: 'good' }
              : { height: THUMB_MAX_EDGE, quality: 'good' }
          );
    const out = resized.toJPEG(THUMB_QUALITY);
    // A "thumbnail" bigger than the original helps nobody.
    return out.length > 0 && out.length < buf.length ? out : null;
  } catch {
    return null;
  }
}
