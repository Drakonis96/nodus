// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

import dns from 'node:dns/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const MAX_PUBLIC_DOWNLOAD_BYTES = 64 * 1024 * 1024;

const SUPPORTED_EXTENSIONS = new Set([
  '.pdf', '.epub', '.doc', '.docx', '.odt', '.rtf', '.txt', '.md', '.html', '.htm', '.xml', '.jats',
  '.csv', '.tsv', '.xls', '.xlsx', '.ods', '.ppt', '.pptx', '.odp', '.png', '.jpg', '.jpeg', '.webp',
  '.gif', '.tif', '.tiff', '.bmp', '.svg', '.mp3', '.m4a', '.wav', '.ogg', '.flac', '.mp4', '.m4v', '.webm',
]);

const MIME_EXTENSIONS: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/epub+zip': '.epub',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/msword': '.doc',
  'application/rtf': '.rtf',
  'text/rtf': '.rtf',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'text/html': '.html',
  'application/xhtml+xml': '.html',
  'application/xml': '.xml',
  'text/xml': '.xml',
  'text/csv': '.csv',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/tiff': '.tiff',
  'image/bmp': '.bmp',
  'image/svg+xml': '.svg',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/wav': '.wav',
  'audio/ogg': '.ogg',
  'audio/flac': '.flac',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
};

export interface PublicFetchResult {
  response: Response;
  finalUrl: string;
}

export interface PublicFetchOptions {
  accept?: string;
  headers?: Record<string, string>;
  maxBytes?: number;
  timeoutMs?: number;
  fetcher?: typeof fetch;
  assertPublic?: (url: string) => Promise<URL>;
}

export interface RemoteFileNameCandidate {
  fileName?: string;
  title?: string;
  mimeType?: string;
  url?: string;
}

function cleanText(value: unknown, limit = 10_000): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

export function safeRemoteFileName(raw: string | undefined, mimeType: string | undefined, url?: string): string {
  let candidate = cleanText(raw, 240);
  if (!candidate && url) {
    try { candidate = decodeURIComponent(path.basename(new URL(url).pathname)); } catch { candidate = ''; }
  }
  candidate = [...candidate]
    .map((character) => (character.codePointAt(0)! < 32 || '<>:"/\\|?*'.includes(character) ? '-' : character))
    .join('')
    .replace(/[. ]+$/g, '')
    .trim();
  if (!candidate) candidate = `document-${randomUUID().slice(0, 8)}`;
  let extension = path.extname(candidate).toLowerCase();
  const mime = cleanText(mimeType, 200).split(';')[0].toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    extension = MIME_EXTENSIONS[mime] ?? '.txt';
    candidate = `${path.basename(candidate, path.extname(candidate))}${extension}`;
  }
  return candidate.slice(-220);
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^::ffff:/, '');
  if (normalized === '::1' || normalized === '0.0.0.0' || normalized === '127.0.0.1') return true;
  if (/^10\./.test(normalized) || /^192\.168\./.test(normalized)) return true;
  const second = /^172\.(\d+)\./.exec(normalized);
  if (second && Number(second[1]) >= 16 && Number(second[1]) <= 31) return true;
  if (/^169\.254\./.test(normalized) || /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(normalized)) return true;
  if (/^(?:fc|fd|fe8|fe9|fea|feb)/.test(normalized)) return true;
  return false;
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP(S) resources can be downloaded.');
  if (!url.hostname || url.username || url.password || url.hostname.toLowerCase() === 'localhost') throw new Error('The resource URL is not public.');
  if (isPrivateAddress(url.hostname)) throw new Error('Private-network resource URLs are not accepted.');
  const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) throw new Error('The resource host resolves to a private address.');
  return url;
}

export async function fetchPublicResource(raw: string, options: PublicFetchOptions = {}): Promise<PublicFetchResult> {
  const validate = options.assertPublic ?? assertPublicUrl;
  const fetcher = options.fetcher ?? fetch;
  const maxBytes = options.maxBytes ?? MAX_PUBLIC_DOWNLOAD_BYTES;
  let current = await validate(raw);
  for (let redirect = 0; redirect < 6; redirect += 1) {
    const response = await fetcher(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
      headers: {
        Accept: options.accept ?? '*/*',
        'User-Agent': 'Nodus/4 document client',
        ...(options.headers ?? {}),
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`Resource download redirected without a location (${response.status}).`);
      current = await validate(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) throw new Error(`Resource download returned ${response.status}.`);
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > maxBytes) throw new Error(`The resource is larger than ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
    return { response, finalUrl: current.toString() };
  }
  throw new Error('The resource redirected too many times.');
}

export async function fetchPublicAttachment(raw: string, options: PublicFetchOptions = {}): Promise<Response> {
  return (await fetchPublicResource(raw, options)).response;
}

export async function responseToTemporaryFile(
  response: Response,
  candidate: RemoteFileNameCandidate,
  options: { prefix?: string; maxBytes?: number } = {},
): Promise<{ dir: string; file: string }> {
  const maxBytes = options.maxBytes ?? MAX_PUBLIC_DOWNLOAD_BYTES;
  const mimeType = cleanText(response.headers.get('content-type') ?? candidate.mimeType, 200).split(';')[0];
  const fileName = safeRemoteFileName(candidate.fileName || candidate.title, mimeType, candidate.url);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), options.prefix ?? 'nodus-public-download-'));
  const file = path.join(dir, fileName);
  const handle = fs.openSync(file, 'wx', 0o600);
  let total = 0;
  try {
    if (!response.body) throw new Error('The resource response was empty.');
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      total += chunk.byteLength;
      if (total > maxBytes) throw new Error(`The resource is larger than ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
      fs.writeSync(handle, chunk);
    }
  } catch (error) {
    fs.closeSync(handle);
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  fs.closeSync(handle);
  if (!total) { fs.rmSync(dir, { recursive: true, force: true }); throw new Error('The resource response was empty.'); }
  return { dir, file };
}
