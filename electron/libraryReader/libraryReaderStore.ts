import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  LibraryReaderDocument,
  LibraryReaderChatMessage,
  LibraryReaderSection,
  WritingDraftAnnotation,
  WritingDraftAnnotationColor,
  WritingDraftAnnotationInput,
  WorkView,
} from '@shared/types';
import type { LibraryItemRecord } from '@shared/libraryTypes';
import { getWork } from '../db/worksRepo';
import { atomicWriteJson, configuredLibraryRootOrThrow, safeLibraryFolderName } from '../library/libraryPaths';
import { legacyMetadataToRecord, normalizeLibraryItemRecord } from '../library/libraryRecord';

interface ReaderMetadata {
  citationKey?: string;
  storageId?: string;
  title?: string;
  authors?: string[];
  year?: number | null;
  zotero?: { itemKey?: string; attachmentKey?: string };
  files?: { reader?: string; original?: string; sourceMap?: string; annotations?: string; chat?: string };
}

interface SourceMapBlock {
  kind?: string;
  markdown?: { start?: number; end?: number };
  anchors?: Array<{ page?: number; bbox?: number[] }>;
}

interface ReaderSourceMap {
  pages?: Array<{ page?: number; width?: number; height?: number }>;
  blocks?: SourceMapBlock[];
}

interface ReaderIdentity {
  workId: string;
  storageId: string;
  zoteroKey: string | null;
  title: string;
  authors: string[];
  year: number | null;
}

interface ResolvedReaderDocument {
  identity: ReaderIdentity;
  folder: string;
  metadata: ReaderMetadata;
}

interface DiskAnnotation {
  id: string;
  documentId: string;
  scope: string;
  kind: WritingDraftAnnotation['kind'];
  color: WritingDraftAnnotationColor | null;
  startOffset: number;
  endOffset: number;
  selectedText: string;
  prefix: string;
  suffix: string;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
}

const COLORS = new Set<WritingDraftAnnotationColor>(['yellow', 'rose', 'blue', 'mint', 'lavender', 'peach']);

function libraryRoot(): string {
  return configuredLibraryRootOrThrow();
}

/** Personal-library Zotero keys remain byte-for-byte identical on disk. Group keys
 * contain characters Windows reserves, so only those exceptional ids are encoded;
 * their original canonical id remains in metadata as `storageId`. */
function storageFolderName(storageId: string): string {
  return safeLibraryFolderName(storageId);
}

function storageIdFor(work: WorkView): string {
  return work.zotero_key?.trim() || work.nodus_id;
}

function rawZoteroKey(key: string): string {
  const match = /^groups:[^:]+:(.+)$/.exec(key);
  return match?.[1] ?? key;
}

function creatorName(creator: LibraryItemRecord['metadata']['creators'][number]): string {
  return creator.name?.trim() || [creator.firstName, creator.lastName].filter(Boolean).join(' ').trim();
}

function recordIdentity(record: LibraryItemRecord): ReaderIdentity {
  return {
    workId: record.id,
    storageId: record.storageId,
    zoteroKey: record.source === 'zotero' ? record.storageId.trim() || record.sourceKey?.trim() || null : null,
    title: record.metadata.title,
    authors: record.metadata.creators.map(creatorName).filter(Boolean),
    year: record.metadata.year ?? null,
  };
}

function recordReaderMetadata(record: LibraryItemRecord): ReaderMetadata {
  const identity = recordIdentity(record);
  return {
    citationKey: record.citationKey,
    storageId: record.storageId,
    title: identity.title,
    authors: identity.authors,
    year: identity.year,
    zotero: identity.zoteroKey ? { itemKey: identity.zoteroKey } : undefined,
    files: record.files,
  };
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function pathEntryExists(filePath: string): boolean {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Resolve the closest existing ancestor so both existing symlinks and symlinked
 * parent directories are rejected before a reader can read or create a file. */
function pathStaysInside(root: string, target: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) return false;
  let probe = resolvedTarget;
  while (!pathEntryExists(probe) && probe !== path.dirname(probe)) probe = path.dirname(probe);
  try {
    const realRoot = fs.realpathSync.native(resolvedRoot);
    const realProbe = fs.realpathSync.native(probe);
    return realProbe === realRoot || realProbe.startsWith(`${realRoot}${path.sep}`);
  } catch {
    return false;
  }
}

function safeDocumentFolder(root: string, folder: string): boolean {
  return pathStaysInside(root, folder) && pathEntryExists(folder) && fs.statSync(folder).isDirectory();
}

/** Metadata may name a nested file, but it can never escape its document folder. */
function documentFile(folder: string, declaredName: string | undefined, fallbackName: string): string {
  const folderPath = path.resolve(folder);
  const target = path.resolve(folderPath, declaredName?.trim() || fallbackName);
  if (target !== folderPath && pathStaysInside(folderPath, target)) return target;
  const fallback = path.join(folderPath, fallbackName);
  if (pathStaysInside(folderPath, fallback)) return fallback;
  throw new Error('La ruta del documento no es válida.');
}

function optionalDocumentFile(folder: string, declaredName: string | undefined, fallbackName: string): string | null {
  try { return documentFile(folder, declaredName, fallbackName); }
  catch { return null; }
}

function metadataMatchesWork(metadata: ReaderMetadata, work: WorkView): boolean {
  const storageId = storageIdFor(work);
  const candidates = [metadata.storageId, metadata.zotero?.itemKey].filter((item): item is string => !!item);
  return candidates.includes(storageId) || candidates.includes(rawZoteroKey(storageId));
}

/** Locate an existing document and migrate the citation-key prototype folder to
 * the stable Zotero identifier the first time it is opened. */
function documentFolder(work: WorkView): string | null {
  const root = libraryRoot();
  const storageId = storageIdFor(work);
  const canonical = path.join(root, storageFolderName(storageId));
  if (!fs.existsSync(root)) return null;
  if (safeDocumentFolder(root, canonical)) {
    const reader = optionalDocumentFile(canonical, 'reader.md', 'reader.md');
    if (reader && fs.existsSync(reader)) return canonical;
  }

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const candidate = path.join(root, entry.name);
    if (!safeDocumentFolder(root, candidate)) continue;
    const metadataPath = optionalDocumentFile(candidate, 'metadata.json', 'metadata.json');
    if (!metadataPath) continue;
    const metadata = readJson<ReaderMetadata>(metadataPath);
    const reader = optionalDocumentFile(candidate, metadata?.files?.reader, 'reader.md');
    if (!metadata || !metadataMatchesWork(metadata, work) || !reader || !fs.existsSync(reader)) continue;
    if (candidate !== canonical && !fs.existsSync(canonical)) fs.renameSync(candidate, canonical);
    const resolved = fs.existsSync(canonical) ? canonical : candidate;
    if (!safeDocumentFolder(root, resolved)) continue;
    const nextMetadata = { ...metadata, storageId };
    const resolvedMetadata = optionalDocumentFile(resolved, 'metadata.json', 'metadata.json');
    if (!resolvedMetadata) continue;
    atomicWriteJson(resolvedMetadata, nextMetadata);
    return resolved;
  }
  return null;
}

function cleanHeading(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .trim();
}

function headingPage(offset: number, sourceMap: ReaderSourceMap | null): number | null {
  if (!sourceMap?.blocks?.length) return null;
  const exact = sourceMap.blocks.find((block) => {
    const start = block.markdown?.start;
    const end = block.markdown?.end;
    return (block.kind === 'heading' || block.kind === 'title')
      && typeof start === 'number'
      && typeof end === 'number'
      && offset >= start
      && offset < end;
  });
  const nearest = exact ?? sourceMap.blocks
    .filter((block) => block.kind === 'heading' || block.kind === 'title')
    .sort((a, b) => Math.abs((a.markdown?.start ?? 0) - offset) - Math.abs((b.markdown?.start ?? 0) - offset))[0];
  const page = nearest?.anchors?.[0]?.page;
  return Number.isInteger(page) && Number(page) > 0 ? Number(page) : null;
}

function sectionsFromMarkdown(markdown: string, sourceMap: ReaderSourceMap | null): LibraryReaderSection[] {
  const sections: LibraryReaderSection[] = [];
  const headings = /^(#{1,6})[ \t]+(.+?)\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = headings.exec(markdown)) !== null) {
    const title = cleanHeading(match[2]);
    if (!title) continue;
    sections.push({
      id: `reader-section-${sections.length + 1}`,
      title,
      level: match[1].length,
      page: headingPage(match.index, sourceMap),
    });
  }
  return sections;
}

function mimeForAsset(filePath: string): string | null {
  switch (path.extname(filePath).toLowerCase()) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    case '.svg': return 'image/svg+xml';
    default: return null;
  }
}

/** Markdown assets never become arbitrary file:// access in the renderer. Only
 * images below this document folder are converted to an inert data URL. */
function inlineDocumentImages(markdown: string, folder: string): string {
  return markdown.replace(/(!\[[^\]]*\]\()([^\s)]+)(\))/g, (whole, before: string, rawTarget: string, after: string) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(rawTarget) || rawTarget.startsWith('#')) return whole;
    let decoded = rawTarget;
    try { decoded = decodeURIComponent(rawTarget); } catch { /* keep the literal path */ }
    const target = optionalDocumentFile(folder, decoded, '.missing-reader-asset');
    if (!target) return whole;
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return whole;
    const mime = mimeForAsset(target);
    if (!mime) return whole;
    return `${before}data:${mime};base64,${fs.readFileSync(target).toString('base64')}${after}`;
  });
}

function globalDocument(documentId: string): ResolvedReaderDocument | null {
  const root = libraryRoot();
  if (!fs.existsSync(root)) return null;
  let canonicalId = documentId;
  if (documentId.startsWith('nodus-library:')) {
    try { canonicalId = decodeURIComponent(documentId.slice('nodus-library:'.length)); } catch { /* keep input */ }
  }
  const inspect = (folder: string): ResolvedReaderDocument | null => {
    if (!safeDocumentFolder(root, folder)) return null;
    const metadataPath = optionalDocumentFile(folder, 'metadata.json', 'metadata.json');
    if (!metadataPath) return null;
    const raw = readJson<unknown>(metadataPath);
    const record = normalizeLibraryItemRecord(raw) ?? legacyMetadataToRecord(raw, path.basename(folder));
    if (!record || record.deletedAt) return null;
    const matches = record.id === canonicalId || record.storageId === canonicalId || record.sourceKey === canonicalId
      || record.aliases.includes(canonicalId)
      || record.sourceIdentities.some((identity) => identity.itemKey === canonicalId);
    if (!matches) return null;
    const metadata = recordReaderMetadata(record);
    const reader = optionalDocumentFile(folder, metadata.files?.reader, 'reader.md');
    if (!reader || !fs.existsSync(reader)) return null;
    return { identity: recordIdentity(record), folder, metadata };
  };
  const directNames = new Set([
    safeLibraryFolderName(canonicalId),
    ...(documentId.startsWith('zotero:') ? [safeLibraryFolderName(documentId.slice('zotero:'.length))] : []),
  ]);
  for (const name of directNames) {
    const folder = path.join(root, name);
    if (fs.existsSync(folder)) {
      const found = inspect(folder);
      if (found) return found;
    }
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || directNames.has(entry.name)) continue;
    const found = inspect(path.join(root, entry.name));
    if (found) return found;
  }
  return null;
}

function resolvedDocument(documentId: string): ResolvedReaderDocument | null {
  const global = globalDocument(documentId);
  if (global) return global;
  let work: WorkView | null = null;
  try { work = getWork(documentId); } catch { return null; }
  if (!work) return null;
  const folder = documentFolder(work);
  if (!folder) return null;
  return {
    identity: {
      workId: work.nodus_id, storageId: storageIdFor(work), zoteroKey: work.zotero_key || null,
      title: work.title, authors: work.authors, year: work.year,
    },
    folder,
    metadata: (() => {
      const metadataPath = optionalDocumentFile(folder, 'metadata.json', 'metadata.json');
      return metadataPath ? readJson<ReaderMetadata>(metadataPath) ?? {} : {};
    })(),
  };
}

export function getLibraryReaderDocument(documentId: string): LibraryReaderDocument | null {
  const resolved = resolvedDocument(documentId);
  if (!resolved) return null;
  const { identity, folder, metadata } = resolved;
  const readerName = metadata.files?.reader || 'reader.md';
  const originalName = metadata.files?.original || 'original.pdf';
  const sourceMapName = metadata.files?.sourceMap || 'source-map.json';
  const markdownPath = optionalDocumentFile(folder, readerName, 'reader.md');
  const sourceMapPath = optionalDocumentFile(folder, sourceMapName, 'source-map.json');
  const originalPath = optionalDocumentFile(folder, originalName, 'original.pdf');
  if (!markdownPath || !fs.existsSync(markdownPath)) return null;

  const rawMarkdown = fs.readFileSync(markdownPath, 'utf8');
  const sourceMap = sourceMapPath ? readJson<ReaderSourceMap>(sourceMapPath) : null;
  const originalAvailable = !!originalPath && fs.existsSync(originalPath) && fs.statSync(originalPath).isFile();
  return {
    workId: identity.workId,
    storageId: identity.storageId,
    zoteroKey: identity.zoteroKey,
    citationKey: metadata.citationKey?.trim() || null,
    title: metadata.title?.trim() || identity.title,
    authors: Array.isArray(metadata.authors) && metadata.authors.length ? metadata.authors : identity.authors,
    year: typeof metadata.year === 'number' ? metadata.year : identity.year,
    markdown: inlineDocumentImages(rawMarkdown, folder),
    sections: sectionsFromMarkdown(rawMarkdown, sourceMap),
    pageCount: sourceMap?.pages?.length || null,
    wordCount: rawMarkdown.split(/\s+/).filter(Boolean).length,
    originalAvailable,
    originalFileName: originalAvailable && originalPath ? path.basename(originalPath) : null,
    originalUrl: originalAvailable && originalPath ? `nodus-library://original/${encodeURIComponent(identity.workId)}?v=${encodeURIComponent(path.basename(originalPath))}` : null,
    originalMimeType: originalAvailable && originalPath ? mimeForOriginal(originalPath) : null,
    sourceMapAvailable: sourceMap !== null,
  };
}

/** Main-process-only clean content. Unlike getLibraryReaderDocument this never
 * expands image files into base64, so it is safe to feed into retrieval and chat. */
export function getLibraryReaderRawContent(documentId: string): {
  document: LibraryReaderDocument;
  markdown: string;
  folder: string;
} | null {
  const resolved = resolvedDocument(documentId);
  const document = getLibraryReaderDocument(documentId);
  if (!resolved || !document) return null;
  const markdownPath = optionalDocumentFile(resolved.folder, resolved.metadata.files?.reader, 'reader.md');
  if (!markdownPath || !fs.existsSync(markdownPath)) return null;
  const markdown = fs.readFileSync(markdownPath, 'utf8');
  return { document: { ...document, markdown }, markdown, folder: resolved.folder };
}

function mimeForOriginal(filePath: string): string {
  return ({
    '.pdf': 'application/pdf', '.epub': 'application/epub+zip', '.md': 'text/markdown', '.markdown': 'text/markdown',
    '.txt': 'text/plain', '.html': 'text/html', '.htm': 'text/html', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  } as Record<string, string>)[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

export function libraryReaderOriginalPath(documentId: string): string | null {
  const resolved = resolvedDocument(documentId);
  if (!resolved) return null;
  const name = resolved.metadata.files?.original || 'original.pdf';
  const target = optionalDocumentFile(resolved.folder, name, 'original.pdf');
  return target && fs.existsSync(target) && fs.statSync(target).isFile() ? target : null;
}

function annotationsPath(documentId: string): { filePath: string; documentId: string } | null {
  const resolved = resolvedDocument(documentId);
  if (!resolved) return null;
  const filePath = optionalDocumentFile(resolved.folder, resolved.metadata.files?.annotations, 'annotations.json');
  if (!filePath) return null;
  return {
    filePath,
    documentId: resolved.identity.storageId,
  };
}

function validDiskAnnotation(value: unknown): value is DiskAnnotation {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<DiskAnnotation>;
  return typeof item.id === 'string'
    && typeof item.documentId === 'string'
    && typeof item.scope === 'string'
    && (item.kind === 'highlight' || item.kind === 'comment' || item.kind === 'bookmark')
    && (item.color === null || COLORS.has(item.color as WritingDraftAnnotationColor))
    && Number.isInteger(item.startOffset)
    && Number.isInteger(item.endOffset)
    && Number(item.startOffset) >= 0
    && Number(item.endOffset) > Number(item.startOffset)
    && typeof item.selectedText === 'string'
    && typeof item.prefix === 'string'
    && typeof item.suffix === 'string'
    && (item.comment === null || typeof item.comment === 'string')
    && typeof item.createdAt === 'string'
    && typeof item.updatedAt === 'string';
}

function readDiskAnnotations(filePath: string): DiskAnnotation[] {
  const parsed = readJson<unknown>(filePath);
  return Array.isArray(parsed) ? parsed.filter(validDiskAnnotation) : [];
}

function publicAnnotation(workId: string, annotation: DiskAnnotation): WritingDraftAnnotation {
  return { ...annotation, draftId: workId };
}

export function listLibraryReaderAnnotations(workId: string): WritingDraftAnnotation[] {
  const target = annotationsPath(workId);
  if (!target) return [];
  return readDiskAnnotations(target.filePath)
    .sort((a, b) => a.scope.localeCompare(b.scope) || a.startOffset - b.startOffset || a.createdAt.localeCompare(b.createdAt))
    .map((annotation) => publicAnnotation(workId, annotation));
}

function normalizedAnnotationInput(input: WritingDraftAnnotationInput) {
  const scope = input.scope.trim() || 'source';
  const startOffset = Math.trunc(input.startOffset);
  const endOffset = Math.trunc(input.endOffset);
  if (scope.length > 180) throw new Error('El contexto de la anotación no es válido.');
  if (startOffset < 0 || endOffset <= startOffset || input.selectedText.length !== endOffset - startOffset || !input.selectedText.trim()) {
    throw new Error('El fragmento seleccionado no es válido.');
  }
  if (input.kind === 'highlight' && (!input.color || !COLORS.has(input.color))) {
    throw new Error('El color del subrayado no es válido.');
  }
  const comment = input.kind === 'comment' ? input.comment?.trim() || '' : null;
  if (input.kind === 'comment' && !comment) throw new Error('Escribe el comentario antes de guardarlo.');
  return {
    scope,
    kind: input.kind,
    color: input.kind === 'highlight' ? input.color as WritingDraftAnnotationColor : null,
    startOffset,
    endOffset,
    selectedText: input.selectedText,
    prefix: (input.prefix ?? '').slice(-64),
    suffix: (input.suffix ?? '').slice(0, 64),
    comment,
  };
}

export function createLibraryReaderAnnotation(workId: string, input: WritingDraftAnnotationInput): WritingDraftAnnotation {
  const target = annotationsPath(workId);
  if (!target) throw new Error('La versión de lectura ya no existe.');
  const value = normalizedAnnotationInput(input);
  const now = new Date().toISOString();
  const id = value.kind === 'bookmark' ? `reader-bookmark:${target.documentId}:${value.scope}` : randomUUID();
  const next: DiskAnnotation = { id, documentId: target.documentId, ...value, createdAt: now, updatedAt: now };
  const annotations = readDiskAnnotations(target.filePath);
  const existing = annotations.findIndex((annotation) => annotation.id === id);
  if (existing >= 0) next.createdAt = annotations[existing].createdAt;
  if (existing >= 0) annotations[existing] = next;
  else annotations.push(next);
  atomicWriteJson(target.filePath, annotations);
  return publicAnnotation(workId, next);
}

export function updateLibraryReaderComment(workId: string, id: string, comment: string): WritingDraftAnnotation | null {
  const target = annotationsPath(workId);
  if (!target) return null;
  const value = comment.trim();
  if (!value) throw new Error('Escribe el comentario antes de guardarlo.');
  const annotations = readDiskAnnotations(target.filePath);
  const annotation = annotations.find((item) => item.id === id && item.kind === 'comment');
  if (!annotation) return null;
  annotation.comment = value;
  annotation.updatedAt = new Date().toISOString();
  atomicWriteJson(target.filePath, annotations);
  return publicAnnotation(workId, annotation);
}

export function deleteLibraryReaderAnnotation(workId: string, id: string): boolean {
  const target = annotationsPath(workId);
  if (!target) return false;
  const annotations = readDiskAnnotations(target.filePath);
  const next = annotations.filter((annotation) => annotation.id !== id);
  if (next.length === annotations.length) return false;
  atomicWriteJson(target.filePath, next);
  return true;
}

function chatPath(documentId: string): string | null {
  const resolved = resolvedDocument(documentId);
  return resolved ? optionalDocumentFile(resolved.folder, resolved.metadata.files?.chat, 'chat.json') : null;
}

function validChatMessage(value: unknown): value is LibraryReaderChatMessage {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<LibraryReaderChatMessage>;
  return typeof item.id === 'string'
    && (item.role === 'user' || item.role === 'assistant')
    && typeof item.content === 'string'
    && typeof item.createdAt === 'string'
    && (item.error === undefined || typeof item.error === 'boolean');
}

export function listLibraryReaderChatMessages(documentId: string): LibraryReaderChatMessage[] {
  const filePath = chatPath(documentId);
  if (!filePath) return [];
  const parsed = readJson<unknown>(filePath);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(validChatMessage).slice(-100);
}

export function saveLibraryReaderChatMessages(documentId: string, messages: LibraryReaderChatMessage[]): void {
  const filePath = chatPath(documentId);
  if (!filePath) throw new Error('La versión de lectura ya no existe.');
  const safe = messages.filter(validChatMessage).slice(-100).map((message) => ({
    ...message,
    content: message.content.slice(0, 200_000),
  }));
  atomicWriteJson(filePath, safe);
}

export function clearLibraryReaderChat(documentId: string): void {
  const filePath = chatPath(documentId);
  if (!filePath) return;
  atomicWriteJson(filePath, []);
}
