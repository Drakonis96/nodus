import { protocol } from 'electron';
import {
  getArchiveFileBlobSlice,
  getArchiveFilePayloadInfo,
} from './db/archiveFilesRepo';

export const NODUS_ARCHIVE_SCHEME = 'nodus-archive';

export function registerArchiveSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: NODUS_ARCHIVE_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
      },
    },
  ]);
}

export interface ByteRange {
  start: number;
  end: number;
}

/** Parse one RFC 7233 byte range. Multipart ranges are intentionally unsupported. */
export function parseArchiveByteRange(value: string | null, size: number): ByteRange | null | 'invalid' {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match || size < 0) return 'invalid';
  const rawStart = match[1];
  const rawEnd = match[2];
  if (!rawStart && !rawEnd) return 'invalid';
  if (!rawStart) {
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return 'invalid';
    return { start: Math.max(0, size - suffix), end: Math.max(0, size - 1) };
  }
  const start = Number(rawStart);
  const requestedEnd = rawEnd ? Number(rawEnd) : size - 1;
  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(requestedEnd)
    || start < 0
    || requestedEnd < start
    || start >= size
  ) return 'invalid';
  return { start, end: Math.min(requestedEnd, size - 1) };
}

function fileIdFromRequest(request: Request): string | null {
  try {
    const url = new URL(request.url);
    if (url.hostname !== 'file') return null;
    const id = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    return id && id.length <= 512 ? id : null;
  } catch {
    return null;
  }
}

function responseHeaders(info: NonNullable<ReturnType<typeof getArchiveFilePayloadInfo>>): Headers {
  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Content-Type': info.mimeType,
    'Cache-Control': info.contentHash
      ? 'private, max-age=31536000, immutable'
      : 'private, no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  if (info.fileName) {
    headers.set(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(info.fileName.replace(/[\r\n]/g, ''))}`
    );
  }
  return headers;
}

/**
 * Database-backed, range-aware access to preserved objects.
 *
 * SQLite's substr(BLOB) reads only the requested slice, so Chromium's PDF/media
 * range requests never cross the IPC bridge and do not duplicate the whole object
 * in renderer memory.
 */
export function registerArchiveProtocol(): void {
  protocol.handle(NODUS_ARCHIVE_SCHEME, (request) => {
    try {
      const fileId = fileIdFromRequest(request);
      if (!fileId) return new Response(null, { status: 400 });
      const info = getArchiveFilePayloadInfo(fileId);
      if (!info || !info.hasContent) return new Response(null, { status: 404 });
      const headers = responseHeaders(info);
      const parsed = parseArchiveByteRange(request.headers.get('range'), info.byteSize);
      if (parsed === 'invalid') {
        headers.set('Content-Range', `bytes */${info.byteSize}`);
        return new Response(null, { status: 416, headers });
      }
      if (request.method === 'HEAD') {
        headers.set('Content-Length', String(parsed ? parsed.end - parsed.start + 1 : info.byteSize));
        if (parsed) headers.set('Content-Range', `bytes ${parsed.start}-${parsed.end}/${info.byteSize}`);
        return new Response(null, { status: parsed ? 206 : 200, headers });
      }
      const start = parsed?.start ?? 0;
      const end = parsed?.end ?? Math.max(0, info.byteSize - 1);
      const payload = getArchiveFileBlobSlice(fileId, start, end + 1);
      if (!payload) return new Response(null, { status: 404 });
      headers.set('Content-Length', String(payload.byteLength));
      if (parsed) headers.set('Content-Range', `bytes ${start}-${end}/${info.byteSize}`);
      return new Response(Uint8Array.from(payload), {
        status: parsed ? 206 : 200,
        headers,
      });
    } catch {
      // Vault switches can race an in-flight media request; fail the resource only.
      return new Response(null, { status: 503 });
    }
  });
}
