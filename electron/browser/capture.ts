// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * Turning what a browser tab is showing into something Nodus keeps.
 *
 * Almost nothing is implemented here, on purpose. Nodus already has the whole
 * "web page in, Library item out" pipeline, built for the Chrome extension:
 *
 *   previewBrowserCapture / saveBrowserCapture  (browser-connector/libraryCapture)
 *     → createGlobalLibraryItem, DOI enrichment through resolveGlobalLibraryMetadata,
 *       PDF resolution through downloadLibraryFullText, attachment storage,
 *       and addGlobalLibraryAttachments, which enqueues extraction, OCR,
 *       indexing and embeddings.
 *
 * The browser's job is only to ASK the page for a snapshot and hand the result
 * to that pipeline. Building a second metadata path would mean two Library
 * ingest routes that must agree — which is exactly the parallel system the plan
 * ruled out.
 */

import { randomUUID } from 'node:crypto';
import { net } from 'electron';
import type { BrowserConnectorCaptureRequest, BrowserConnectorSaveResult } from '@shared/browserConnector';
import { previewBrowserCapture, saveBrowserCapture, uploadBrowserAttachment } from '../browser-connector/libraryCapture';
import { MAX_PUBLIC_DOWNLOAD_BYTES } from '../network/publicDownload';
import { browserSession } from './session';
import { activeTabSummary, collectFromTab } from './tabs';
import { normalizeLibraryMetadata } from '../library/libraryRecord';

export interface BrowserCapturePreview {
  request: BrowserConnectorCaptureRequest & { snapshotAvailable?: boolean };
  warnings: string[];
}

const CAPTURE_SOURCES = new Set<BrowserConnectorCaptureRequest['metadataSource']>([
  'highwire', 'json-ld', 'coins', 'dublin-core', 'open-graph', 'direct-file', 'generic',
]);
const ATTACHMENT_ROLES = new Set<NonNullable<BrowserConnectorCaptureRequest['attachments']>[number]['role']>([
  'original', 'supplement', 'snapshot', 'image', 'dataset', 'other',
]);
const MAX_SNAPSHOT_CHARS = 6 * 1024 * 1024;

function clean(value: unknown, limit: number): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit)
    : '';
}

function safeWebUrl(value: unknown): string | null {
  const raw = clean(value, 4_096);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function sanitizedMetadata(value: unknown, pageUrl: string) {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const scalarKeys = [
    'title', 'itemType', 'abstract', 'date', 'year', 'language', 'publisher', 'publicationTitle',
    'volume', 'issue', 'pages', 'edition', 'place', 'rights', 'doi', 'pmid', 'pmcid', 'arxiv',
  ] as const;
  const bounded: Record<string, unknown> = { url: safeWebUrl(source.url) ?? pageUrl };
  for (const key of scalarKeys) bounded[key] = source[key];
  bounded.creators = Array.isArray(source.creators) ? source.creators.slice(0, 128) : [];
  bounded.isbn = Array.isArray(source.isbn) ? source.isbn.slice(0, 32) : [];
  bounded.issn = Array.isArray(source.issn) ? source.issn.slice(0, 32) : [];
  bounded.tags = Array.isArray(source.tags) ? source.tags.slice(0, 256) : [];
  if (source.extra && typeof source.extra === 'object' && !Array.isArray(source.extra)) {
    bounded.extra = Object.fromEntries(Object.entries(source.extra as Record<string, unknown>).slice(0, 64));
  }
  return normalizeLibraryMetadata(bounded, pageUrl);
}

function snapshotLooksPassive(html: string): boolean {
  return !/<\s*(?:script|iframe|object|embed|form|base|style)\b/i.test(html)
    && !/\s(?:on[a-z]+|srcdoc|style)\s*=/i.test(html)
    && !/(?:href|src|srcset|poster)\s*=\s*["']\s*(?:javascript|file|nodus-)/i.test(html);
}

/** Re-validate page-derived data in main before it reaches Library or disk. */
export function sanitizeBrowserCaptureRequest(
  raw: unknown,
  expectedPageUrl?: string | null,
): BrowserConnectorCaptureRequest | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const pageUrl = safeWebUrl(input.pageUrl);
  if (!pageUrl) return null;
  if (expectedPageUrl && safeWebUrl(expectedPageUrl) !== pageUrl) return null;
  const metadataSource = CAPTURE_SOURCES.has(input.metadataSource as never)
    ? input.metadataSource as BrowserConnectorCaptureRequest['metadataSource']
    : 'generic';
  const attachments = (Array.isArray(input.attachments) ? input.attachments : [])
    .slice(0, 8)
    .flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const candidate = entry as Record<string, unknown>;
      const url = safeWebUrl(candidate.url);
      if (!url) return [];
      const role = ATTACHMENT_ROLES.has(candidate.role as never) ? candidate.role as never : undefined;
      const mimeType = clean(candidate.mimeType, 120).toLowerCase();
      return [{
        url,
        title: clean(candidate.title, 500) || 'Attachment',
        ...(clean(candidate.fileName, 240) ? { fileName: clean(candidate.fileName, 240) } : {}),
        ...(mimeType && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mimeType.split(';')[0]) ? { mimeType } : {}),
        ...(role ? { role } : {}),
        resolveFullText: candidate.resolveFullText === true,
      }];
    });
  const snapshotHtml = typeof input.snapshotHtml === 'string'
    && input.snapshotHtml.length <= MAX_SNAPSHOT_CHARS
    && snapshotLooksPassive(input.snapshotHtml)
    ? input.snapshotHtml
    : '';
  return {
    pageUrl,
    metadataSource,
    metadata: sanitizedMetadata(input.metadata, pageUrl),
    ...(clean(input.collectionId, 200) ? { collectionId: clean(input.collectionId, 200) } : {}),
    tags: (Array.isArray(input.tags) ? input.tags : []).slice(0, 256).map((entry) => clean(entry, 200)).filter(Boolean),
    attachments,
    snapshotHtml,
  };
}

/** Ask the active tab for everything the Library needs to describe it. */
export async function captureActivePage(): Promise<BrowserCapturePreview | null> {
  const detected = await collectFromTab('capture');
  const request = sanitizeBrowserCaptureRequest(detected, activeTabSummary()?.url);
  if (!request) return null;

  // Enrichment (DOI → Crossref-quality metadata) happens in the existing
  // preview step, so the review dialog shows what would actually be stored.
  const preview = await previewBrowserCapture(request);
  return {
    request: { ...request, metadata: preview.metadata, snapshotAvailable: Boolean(request.snapshotHtml) },
    warnings: preview.warnings,
  };
}

/** Store a reviewed capture, with everything the existing pipeline does to it. */
export async function saveCapture(
  request: BrowserConnectorCaptureRequest,
  options: { includeSnapshot: boolean },
): Promise<BrowserConnectorSaveResult> {
  const safe = sanitizeBrowserCaptureRequest(request);
  if (!safe) throw new Error('The page capture contained an invalid or unsupported URL.');
  return saveBrowserCapture({
    ...safe,
    snapshotHtml: options.includeSnapshot ? safe.snapshotHtml : '',
  });
}

/** Whether the active tab is currently showing a PDF. */
export async function activePageIsPdf(): Promise<{ isPdf: boolean; url: string }> {
  const result = await collectFromTab('pdf');
  const payload = (result ?? {}) as { isPdf?: unknown; url?: unknown };
  const url = safeWebUrl(payload.url) ?? '';
  return { isPdf: payload.isPdf === true && Boolean(url), url };
}

/**
 * Fetch a PDF the tab is already showing, and attach it to a Library item.
 *
 * The bytes are fetched through the BROWSER session rather than with a plain
 * request, because a paywalled PDF is only reachable with that session's
 * cookies. A second, session-less request would 403 — or, worse on a metered
 * institutional licence, spend another access against the user's quota.
 */
export async function importPdfIntoItem(itemId: string, url: string, title: string): Promise<BrowserConnectorSaveResult> {
  const safeUrl = safeWebUrl(url);
  if (!safeUrl) throw new Error('Only HTTP(S) documents can be imported from Browser.');
  const bytes = await fetchThroughBrowserSession(safeUrl);
  return uploadBrowserAttachment(itemId, bytes, {
    title: clean(title, 500) || 'PDF',
    mimeType: 'application/pdf',
    role: 'original',
    url: safeUrl,
  });
}

function fetchThroughBrowserSession(url: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, session: browserSession(), useSessionCookies: true });
    const chunks: Buffer[] = [];
    let total = 0;
    request.on('response', (response) => {
      if (response.statusCode >= 400) {
        reject(new Error(`The document could not be downloaded (HTTP ${response.statusCode}).`));
        // Drain rather than leave the socket hanging on an error path.
        response.on('data', () => undefined);
        return;
      }
      response.on('data', (chunk: Buffer) => {
        total += chunk.length;
        // Bounded before anything is written: an unbounded read of a hostile or
        // simply enormous URL would be held entirely in memory.
        if (total > MAX_PUBLIC_DOWNLOAD_BYTES) {
          reject(new Error('The document is larger than 64 MB.'));
          request.abort();
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
      response.on('error', reject);
    });
    request.on('redirect', (_statusCode, _method, redirectUrl) => {
      if (!safeWebUrl(redirectUrl)) {
        reject(new Error('The document redirected to a blocked URL scheme.'));
        request.abort();
      }
    });
    request.on('error', reject);
    request.end();
  });
}

/** A request id for a page collection, so replies can be matched to askers. */
export function captureRequestId(): string {
  return `capture-${randomUUID()}`;
}
