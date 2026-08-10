import { protocol } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { libraryReaderOriginalPath } from './libraryReader/libraryReaderStore';

export const NODUS_LIBRARY_SCHEME = 'nodus-library';

export function registerLibrarySchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: NODUS_LIBRARY_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  }]);
}

interface ByteRange { start: number; end: number }

function parseRange(value: string | null, size: number): ByteRange | null | 'invalid' {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || size <= 0) return 'invalid';
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return 'invalid';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || requestedEnd < start || start >= size) return 'invalid';
  return { start, end: Math.min(requestedEnd, size - 1) };
}

function mimeType(file: string): string {
  return ({
    '.pdf': 'application/pdf', '.epub': 'application/epub+zip', '.md': 'text/markdown; charset=utf-8',
    '.markdown': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp',
  } as Record<string, string>)[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

function documentId(request: Request): string | null {
  try {
    const url = new URL(request.url);
    if (url.hostname !== 'original') return null;
    const value = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    return value && value.length <= 2_048 ? value : null;
  } catch { return null; }
}

function readSlice(file: string, start: number, end: number): Uint8Array {
  const length = end - start + 1;
  const result = Buffer.allocUnsafe(length);
  const descriptor = fs.openSync(file, 'r');
  try {
    const read = fs.readSync(descriptor, result, 0, length, start);
    return Uint8Array.from(result.subarray(0, read));
  } finally { fs.closeSync(descriptor); }
}

export function registerLibraryProtocol(): void {
  protocol.handle(NODUS_LIBRARY_SCHEME, (request) => {
    try {
      const id = documentId(request);
      if (!id) return new Response(null, { status: 400 });
      const file = libraryReaderOriginalPath(id);
      if (!file) return new Response(null, { status: 404 });
      const stat = fs.statSync(file);
      const headers = new Headers({
        'Accept-Ranges': 'bytes', 'Content-Type': mimeType(file), 'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-cache',
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(path.basename(file).replace(/[\r\n]/g, ''))}`,
      });
      const range = parseRange(request.headers.get('range'), stat.size);
      if (range === 'invalid') {
        headers.set('Content-Range', `bytes */${stat.size}`);
        return new Response(null, { status: 416, headers });
      }
      const start = range?.start ?? 0;
      const end = range?.end ?? Math.max(0, stat.size - 1);
      headers.set('Content-Length', String(Math.max(0, end - start + 1)));
      if (range) headers.set('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      if (request.method === 'HEAD') return new Response(null, { status: range ? 206 : 200, headers });
      return new Response(readSlice(file, start, end), { status: range ? 206 : 200, headers });
    } catch { return new Response(null, { status: 503 }); }
  });
}
