// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

import fs from 'node:fs';
import path from 'node:path';
import type { LibraryMetadataCandidate } from '@shared/libraryTypes';
import {
  fetchPublicResource,
  responseToTemporaryFile,
  type PublicFetchOptions,
} from '../network/publicDownload';

const MAX_LANDING_PAGE_BYTES = 4 * 1024 * 1024;
const MAX_DISCOVERY_URLS = 16;

export interface LibraryFullTextDownload {
  status: 'downloaded' | 'not-found' | 'failed';
  sourceUrl: string | null;
  message: string | null;
  temporaryDirectory?: string;
  filePath?: string;
}

type FullTextFetchOptions = Pick<PublicFetchOptions, 'fetcher' | 'assertPublic' | 'timeoutMs'>;

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_match, digits) => String.fromCodePoint(Number.parseInt(digits, 16)))
    .replace(/&#(\d+);/g, (_match, digits) => String.fromCodePoint(Number(digits)));
}

function attributes(tag: string): Map<string, string> {
  const result = new Map<string, string>();
  const body = tag.replace(/^<\/?[a-z0-9:-]+/i, '').replace(/\/?\s*>$/, '');
  for (const match of body.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    result.set(match[1].toLowerCase(), decodeHtml(match[2] ?? match[3] ?? match[4] ?? ''));
  }
  return result;
}

function resolvedHttpUrl(value: string | undefined, baseUrl: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim(), baseUrl);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch { return null; }
}

/** Extract only publisher-declared or unambiguous PDF links from a scholarly landing page. */
export function extractScholarlyPdfUrls(html: string, baseUrl: string): string[] {
  const urls: string[] = [];
  const add = (value: string | undefined) => {
    const url = resolvedHttpUrl(value, baseUrl);
    if (url && !urls.includes(url)) urls.push(url);
  };
  const pdfMetaNames = new Set([
    'citation_pdf_url', 'bepress_citation_pdf_url', 'eprints.document_url', 'wkhealth_pdf_url',
  ]);
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const name = (attrs.get('name') ?? attrs.get('property') ?? '').toLowerCase();
    if (pdfMetaNames.has(name)) add(attrs.get('content'));
  }
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const type = (attrs.get('type') ?? '').toLowerCase().split(';')[0];
    const rel = (attrs.get('rel') ?? '').toLowerCase().split(/\s+/);
    if (type === 'application/pdf' || rel.includes('enclosure') && /\.pdf(?:$|[?#])/i.test(attrs.get('href') ?? '')) add(attrs.get('href'));
  }
  for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const href = attrs.get('href') ?? '';
    const type = (attrs.get('type') ?? '').toLowerCase().split(';')[0];
    if (type === 'application/pdf' || /\.pdf(?:$|[?#])/i.test(href)) add(href);
  }
  return urls;
}

async function responseText(response: Response): Promise<string> {
  if (!response.body) return '';
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > MAX_LANDING_PAGE_BYTES) throw new Error('The publisher landing page is larger than 4 MB.');
    text += decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}

function pdfHeader(filePath: string): boolean {
  const handle = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(1024);
    const count = fs.readSync(handle, header, 0, header.length, 0);
    return header.subarray(0, count).includes(Buffer.from('%PDF-'));
  } finally { fs.closeSync(handle); }
}

function contentDispositionFileName(response: Response): string | undefined {
  const raw = response.headers.get('content-disposition') ?? '';
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(raw)?.[1];
  if (encoded) { try { return decodeURIComponent(encoded); } catch { /* use the plain filename */ } }
  return /filename\s*=\s*"([^"]+)"/i.exec(raw)?.[1] ?? /filename\s*=\s*([^;\s]+)/i.exec(raw)?.[1];
}

function suggestedPdfName(candidate: LibraryMetadataCandidate, response: Response, url: string): string {
  const declared = contentDispositionFileName(response);
  if (declared) return declared.toLowerCase().endsWith('.pdf') ? declared : `${declared}.pdf`;
  const creator = candidate.metadata.creators[0];
  const author = creator?.lastName || creator?.name || creator?.firstName || '';
  const stem = [author, candidate.metadata.year, candidate.metadata.title].filter(Boolean).join(' - ');
  if (stem) return `${stem}.pdf`;
  try {
    const fromUrl = decodeURIComponent(path.basename(new URL(url).pathname));
    if (fromUrl) return fromUrl.toLowerCase().endsWith('.pdf') ? fromUrl : `${fromUrl}.pdf`;
  } catch { /* fall through */ }
  return 'Full Text PDF.pdf';
}

export async function downloadLibraryFullText(
  candidate: LibraryMetadataCandidate,
  options: FullTextFetchOptions = {},
): Promise<LibraryFullTextDownload> {
  const queue = [
    ...(candidate.fullTextLinks ?? []).map((entry) => ({ url: entry.url, referrer: candidate.sourceUrl ?? undefined })),
    ...(candidate.sourceUrl ? [{ url: candidate.sourceUrl, referrer: undefined }] : []),
  ];
  const visited = new Set<string>();
  const errors: string[] = [];
  let discoveredPdf = false;

  while (queue.length && visited.size < MAX_DISCOVERY_URLS) {
    const next = queue.shift()!;
    let normalized: string;
    try { normalized = new URL(next.url).toString(); } catch { continue; }
    if (visited.has(normalized)) continue;
    visited.add(normalized);
    try {
      const fetched = await fetchPublicResource(normalized, {
        ...options,
        accept: 'application/pdf,text/html;q=0.9,application/xhtml+xml;q=0.8,*/*;q=0.1',
        headers: next.referrer ? { Referer: next.referrer } : undefined,
      });
      const contentType = (fetched.response.headers.get('content-type') ?? '').toLowerCase().split(';')[0];
      if (contentType === 'text/html' || contentType === 'application/xhtml+xml') {
        const found = extractScholarlyPdfUrls(await responseText(fetched.response), fetched.finalUrl);
        discoveredPdf ||= found.length > 0;
        for (const url of found) queue.push({ url, referrer: fetched.finalUrl });
        continue;
      }
      const temporary = await responseToTemporaryFile(fetched.response, {
        fileName: suggestedPdfName(candidate, fetched.response, fetched.finalUrl),
        mimeType: 'application/pdf', url: fetched.finalUrl,
      }, { prefix: 'nodus-library-full-text-' });
      if (!pdfHeader(temporary.file)) {
        fs.rmSync(temporary.dir, { recursive: true, force: true });
        errors.push(`${fetched.finalUrl}: the response was not a PDF`);
        continue;
      }
      return {
        status: 'downloaded', sourceUrl: fetched.finalUrl, message: null,
        temporaryDirectory: temporary.dir, filePath: temporary.file,
      };
    } catch (error) {
      errors.push(`${normalized}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (errors.length && (candidate.fullTextLinks?.length || discoveredPdf)) {
    return { status: 'failed', sourceUrl: null, message: errors.at(-1) ?? 'The PDF could not be downloaded.' };
  }
  return { status: 'not-found', sourceUrl: null, message: null };
}
