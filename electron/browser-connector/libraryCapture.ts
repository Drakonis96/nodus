// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

import dns from 'node:dns/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  BrowserConnectorAttachmentCandidate,
  BrowserConnectorCaptureRequest,
  BrowserConnectorPendingUpload,
  BrowserConnectorSaveResult,
} from '@shared/browserConnector';
import type { LibraryItemMetadata, LibraryMetadataIdentifierKind } from '@shared/libraryTypes';
import { detectLibraryMetadataIdentifier } from '@shared/libraryBibliography';
import { normalizeLibraryMetadata } from '../library/libraryRecord';
import {
  addGlobalLibraryAttachments,
  createGlobalLibraryItem,
  getGlobalLibraryItem,
  listGlobalLibraryCollections,
  resolveGlobalLibraryMetadata,
  updateGlobalLibraryAttachment,
} from '../library/libraryService';

const MAX_REMOTE_BYTES = 64 * 1024 * 1024;
const MAX_SNAPSHOT_CHARS = 6 * 1024 * 1024;
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

function cleanText(value: unknown, limit = 10_000): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

function safeFileName(raw: string | undefined, mimeType: string | undefined, url?: string): string {
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

async function assertPublicUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP(S) attachments can be captured.');
  if (!url.hostname || url.username || url.password || url.hostname.toLowerCase() === 'localhost') throw new Error('The attachment URL is not public.');
  if (isPrivateAddress(url.hostname)) throw new Error('Private-network attachment URLs are not accepted.');
  const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) throw new Error('The attachment host resolves to a private address.');
  return url;
}

async function fetchPublicAttachment(raw: string): Promise<Response> {
  let current = await assertPublicUrl(raw);
  for (let redirect = 0; redirect < 6; redirect += 1) {
    const response = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
      headers: { Accept: '*/*', 'User-Agent': 'Nodus/4 browser connector' },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`Attachment download redirected without a location (${response.status}).`);
      current = await assertPublicUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) throw new Error(`Attachment download returned ${response.status}.`);
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > MAX_REMOTE_BYTES) throw new Error('The attachment is larger than 64 MB.');
    return response;
  }
  throw new Error('The attachment redirected too many times.');
}

async function responseToTemporaryFile(response: Response, candidate: BrowserConnectorAttachmentCandidate): Promise<{ dir: string; file: string }> {
  const mimeType = cleanText(response.headers.get('content-type') ?? candidate.mimeType, 200).split(';')[0];
  const fileName = safeFileName(candidate.fileName || candidate.title, mimeType, candidate.url);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-browser-capture-'));
  const file = path.join(dir, fileName);
  const handle = fs.openSync(file, 'wx', 0o600);
  let total = 0;
  try {
    if (!response.body) throw new Error('The attachment response was empty.');
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      total += chunk.byteLength;
      if (total > MAX_REMOTE_BYTES) throw new Error('The attachment is larger than 64 MB.');
      fs.writeSync(handle, chunk);
    }
  } catch (error) {
    fs.closeSync(handle);
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  fs.closeSync(handle);
  if (!total) { fs.rmSync(dir, { recursive: true, force: true }); throw new Error('The attachment response was empty.'); }
  return { dir, file };
}

async function attachFile(itemId: string, file: string, candidate: BrowserConnectorAttachmentCandidate, makePrimary = false) {
  const before = getGlobalLibraryItem(itemId);
  const known = new Set(before?.attachments.map((entry) => entry.id) ?? []);
  let result = await addGlobalLibraryAttachments(itemId, [file]);
  const added = result.attachments.find((entry) => !known.has(entry.id));
  if (added && (candidate.title || candidate.role || makePrimary)) {
    result = await updateGlobalLibraryAttachment(itemId, added.id, {
      ...(candidate.title ? { title: cleanText(candidate.title, 500) } : {}),
      ...(candidate.role ? { role: candidate.role } : {}),
      ...(makePrimary ? { makePrimary: true } : {}),
    });
  }
  return result;
}

function preferredIdentifier(metadata: LibraryItemMetadata): { kind: LibraryMetadataIdentifierKind; value: string } | null {
  const candidates = [metadata.doi, metadata.pmid && `pmid:${metadata.pmid}`, metadata.pmcid, metadata.arxiv && `arxiv:${metadata.arxiv}`, metadata.isbn?.[0] && `isbn:${metadata.isbn[0]}`];
  for (const candidate of candidates) {
    const detected = candidate ? detectLibraryMetadataIdentifier(candidate) : null;
    if (detected) return detected;
  }
  return null;
}

function mergeMetadata(detected: LibraryItemMetadata, resolved: LibraryItemMetadata | null, source: BrowserConnectorCaptureRequest['metadataSource']): LibraryItemMetadata {
  if (!resolved) return normalizeLibraryMetadata(detected);
  const trustedPage = !['direct-file', 'generic', 'open-graph'].includes(source);
  const overlay = trustedPage ? detected : {
    ...detected,
    title: resolved.title || detected.title,
    itemType: resolved.itemType !== 'document' ? resolved.itemType : detected.itemType,
    creators: resolved.creators.length ? resolved.creators : detected.creators,
  };
  return normalizeLibraryMetadata({
    ...resolved,
    ...overlay,
    creators: overlay.creators.length ? overlay.creators : resolved.creators,
    abstract: overlay.abstract || resolved.abstract,
    publicationTitle: overlay.publicationTitle || resolved.publicationTitle,
    publisher: overlay.publisher || resolved.publisher,
    date: overlay.date || resolved.date,
    year: overlay.year ?? resolved.year,
    doi: overlay.doi || resolved.doi,
    pmid: overlay.pmid || resolved.pmid,
    pmcid: overlay.pmcid || resolved.pmcid,
    arxiv: overlay.arxiv || resolved.arxiv,
    isbn: [...new Set([...(overlay.isbn ?? []), ...(resolved.isbn ?? [])])],
    issn: [...new Set([...(overlay.issn ?? []), ...(resolved.issn ?? [])])],
    tags: [...new Set([...(overlay.tags ?? []), ...(resolved.tags ?? [])])],
    extra: { ...(resolved.extra ?? {}), ...(overlay.extra ?? {}) },
  });
}

export async function previewBrowserCapture(request: BrowserConnectorCaptureRequest): Promise<{ metadata: LibraryItemMetadata; warnings: string[] }> {
  const detected = normalizeLibraryMetadata({ ...request.metadata, url: request.metadata.url || request.pageUrl }, request.pageUrl);
  const warnings: string[] = [];
  let resolved: LibraryItemMetadata | null = null;
  const identifier = preferredIdentifier(detected);
  if (identifier) {
    try {
      resolved = (await resolveGlobalLibraryMetadata(identifier.kind, identifier.value)).candidates[0]?.metadata ?? null;
    } catch (error) {
      warnings.push(`Identifier enrichment unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { metadata: mergeMetadata(detected, resolved, request.metadataSource), warnings };
}

function editableCollectionId(requested: string | null | undefined): string | null {
  if (!requested) return null;
  const collection = listGlobalLibraryCollections().find((entry) => entry.id === requested);
  if (!collection) throw new Error('The selected collection no longer exists.');
  if (collection.source !== 'nodus') throw new Error('Imported collections are read-only; choose a Nodus collection.');
  return collection.id;
}

export async function saveBrowserCapture(request: BrowserConnectorCaptureRequest): Promise<BrowserConnectorSaveResult> {
  const preview = await previewBrowserCapture(request);
  const tags = [...new Set([...(preview.metadata.tags ?? []), ...(request.tags ?? [])].map((entry) => cleanText(entry, 200)).filter(Boolean))].slice(0, 256);
  const collectionId = editableCollectionId(request.collectionId);
  let record = createGlobalLibraryItem({ ...preview.metadata, tags }, collectionId ? [collectionId] : []);
  const warnings = [...preview.warnings];
  const pendingUploads: BrowserConnectorPendingUpload[] = [];
  const attachments = [...new Map((request.attachments ?? []).slice(0, 8).flatMap((entry) => {
    try { return [[new URL(entry.url).toString(), entry] as const]; } catch { return []; }
  })).values()];

  for (const [index, candidate] of attachments.entries()) {
    let temporary: { dir: string; file: string } | null = null;
    try {
      const response = await fetchPublicAttachment(candidate.url);
      temporary = await responseToTemporaryFile(response, candidate);
      record = await attachFile(record.id, temporary.file, candidate, index === 0 && candidate.role === 'original');
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      warnings.push(`${candidate.title || candidate.url}: ${reason}`);
      pendingUploads.push({ ...candidate, reason });
    } finally {
      if (temporary) fs.rmSync(temporary.dir, { recursive: true, force: true });
    }
  }

  if (request.snapshotHtml && request.snapshotHtml.length <= MAX_SNAPSHOT_CHARS) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-browser-snapshot-'));
    const file = path.join(dir, 'webpage.html');
    try {
      fs.writeFileSync(file, request.snapshotHtml, { encoding: 'utf8', mode: 0o600 });
      record = await attachFile(record.id, file, { url: request.pageUrl, title: 'Web page snapshot', mimeType: 'text/html', role: 'snapshot' });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } else if (request.snapshotHtml && request.snapshotHtml.length > MAX_SNAPSHOT_CHARS) {
    warnings.push('The web page snapshot exceeded 6 MB and was not stored.');
  }

  return {
    ok: true,
    itemId: record.id,
    title: record.metadata.title,
    attachmentCount: record.attachments.length,
    extractionStatus: record.extraction?.status ?? null,
    warnings,
    pendingUploads,
  };
}

export async function uploadBrowserAttachment(itemId: string, bytes: Uint8Array, input: Omit<BrowserConnectorAttachmentCandidate, 'url'> & { url?: string }): Promise<BrowserConnectorSaveResult> {
  if (!bytes.byteLength || bytes.byteLength > MAX_REMOTE_BYTES) throw new Error('The uploaded attachment must be between 1 byte and 64 MB.');
  const current = getGlobalLibraryItem(itemId);
  if (!current || current.deletedAt) throw new Error('The captured library item no longer exists.');
  const fileName = safeFileName(input.fileName || input.title, input.mimeType, input.url);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-browser-upload-'));
  const file = path.join(dir, fileName);
  try {
    fs.writeFileSync(file, bytes, { mode: 0o600 });
    const saved = await attachFile(itemId, file, input as BrowserConnectorAttachmentCandidate, input.role === 'original');
    return {
      ok: true,
      itemId: saved.id,
      title: saved.metadata.title,
      attachmentCount: saved.attachments.length,
      extractionStatus: saved.extraction?.status ?? null,
      warnings: [],
      pendingUploads: [],
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
