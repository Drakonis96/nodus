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
import { collectFromTab } from './tabs';

export interface BrowserCapturePreview {
  request: BrowserConnectorCaptureRequest & { snapshotAvailable?: boolean };
  warnings: string[];
}

/** Ask the active tab for everything the Library needs to describe it. */
export async function captureActivePage(): Promise<BrowserCapturePreview | null> {
  const detected = await collectFromTab('capture');
  if (!detected || typeof detected !== 'object') return null;
  const request = detected as BrowserConnectorCaptureRequest & { snapshotAvailable?: boolean };
  if (!request.pageUrl) return null;

  // Enrichment (DOI → Crossref-quality metadata) happens in the existing
  // preview step, so the review dialog shows what would actually be stored.
  const preview = await previewBrowserCapture(request);
  return {
    request: { ...request, metadata: preview.metadata },
    warnings: preview.warnings,
  };
}

/** Store a reviewed capture, with everything the existing pipeline does to it. */
export async function saveCapture(
  request: BrowserConnectorCaptureRequest,
  options: { includeSnapshot: boolean },
): Promise<BrowserConnectorSaveResult> {
  return saveBrowserCapture({
    ...request,
    snapshotHtml: options.includeSnapshot ? request.snapshotHtml : '',
  });
}

/** Whether the active tab is currently showing a PDF. */
export async function activePageIsPdf(): Promise<{ isPdf: boolean; url: string }> {
  const result = await collectFromTab('pdf');
  const payload = (result ?? {}) as { isPdf?: unknown; url?: unknown };
  return { isPdf: payload.isPdf === true, url: String(payload.url ?? '') };
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
  const bytes = await fetchThroughBrowserSession(url);
  return uploadBrowserAttachment(itemId, bytes, {
    title: title || 'PDF',
    mimeType: 'application/pdf',
    role: 'original',
    url,
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
    request.on('error', reject);
    request.end();
  });
}

/** A request id for a page collection, so replies can be matched to askers. */
export function captureRequestId(): string {
  return `capture-${randomUUID()}`;
}
