import { protocol } from 'electron';
import { getPersonPortrait } from './db/entitiesRepo';
import { getMapImageBlob, getMapThumbnail } from './db/worldMapsRepo';
import { getWorldImageBlob } from './db/worldImagesRepo';

export const NODUS_IMAGE_SCHEME = 'nodus-image';

/**
 * Chromium can only treat a custom scheme like a normal image origin when its
 * privileges are declared before Electron becomes ready.
 */
export function registerImageSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: NODUS_IMAGE_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
      },
    },
  ]);
}

type ImagePayload = { blob: Buffer; mime: string } | null;

function safeImageMime(mime: string): string {
  return /^image\/[a-z0-9.+-]+$/i.test(mime) ? mime : 'application/octet-stream';
}

function imageIdFromRequest(request: Request): string | null {
  try {
    const url = new URL(request.url);
    const id = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    return id && id.length <= 512 ? id : null;
  } catch {
    return null;
  }
}

function payloadFor(host: string, id: string): ImagePayload {
  if (host === 'portrait') return getPersonPortrait(id);
  if (host === 'world') return getWorldImageBlob(id);
  if (host === 'map') {
    const payload = getMapImageBlob(id);
    return payload ? { blob: payload.blob, mime: payload.mimeType } : null;
  }
  if (host === 'map-thumbnail') {
    const payload = getMapThumbnail(id);
    return payload ? { blob: payload.blob, mime: payload.mimeType } : null;
  }
  return null;
}

/**
 * Serve database-backed images through Chromium's native image pipeline.
 *
 * The previous path copied every BLOB through ipcRenderer, rebuilt it as a Blob,
 * created an object URL and then committed a second React render. A protocol URL
 * starts loading with the first render, avoids the renderer-side copy and lets
 * Chromium reuse decoded/cached resources while the versioned URL is unchanged.
 */
export function registerImageProtocol(): void {
  protocol.handle(NODUS_IMAGE_SCHEME, (request) => {
    try {
      const url = new URL(request.url);
      const id = imageIdFromRequest(request);
      if (!id) return new Response(null, { status: 400 });
      const payload = payloadFor(url.hostname, id);
      if (!payload) return new Response(null, { status: 404 });
      return new Response(Uint8Array.from(payload.blob), {
        status: 200,
        headers: {
          'Content-Type': safeImageMime(payload.mime),
          'Content-Length': String(payload.blob.byteLength),
          'Cache-Control': 'private, max-age=31536000, immutable',
        },
      });
    } catch {
      // A request racing a vault switch may briefly see the old DB close. An image
      // failing cleanly is preferable to turning that harmless race into a rejection.
      return new Response(null, { status: 503 });
    }
  });
}
