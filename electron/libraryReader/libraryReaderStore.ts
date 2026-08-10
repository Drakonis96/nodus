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
import { configuredLibraryRootOrThrow, safeLibraryFolderName } from '../library/libraryPaths';
import { isLibraryItemRecord, legacyMetadataToRecord } from '../library/libraryRecord';

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

function atomicWriteJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
}

/** Metadata may name a nested file, but it can never escape its document folder. */
function documentFile(folder: string, declaredName: string | undefined, fallbackName: string): string {
  const folderPath = path.resolve(folder);
  const target = path.resolve(folderPath, declaredName?.trim() || fallbackName);
  if (target !== folderPath && target.startsWith(`${folderPath}${path.sep}`)) return target;
  return path.join(folderPath, fallbackName);
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
  if (fs.existsSync(path.join(canonical, 'reader.md'))) return canonical;
  if (!fs.existsSync(root)) return null;

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const candidate = path.join(root, entry.name);
    const metadataPath = path.join(candidate, 'metadata.json');
    const metadata = readJson<ReaderMetadata>(metadataPath);
    if (!metadata || !metadataMatchesWork(metadata, work) || !fs.existsSync(path.join(candidate, 'reader.md'))) continue;
    if (candidate !== canonical && !fs.existsSync(canonical)) fs.renameSync(candidate, canonical);
    const resolved = fs.existsSync(canonical) ? canonical : candidate;
    const nextMetadata = { ...metadata, storageId };
    atomicWriteJson(path.join(resolved, 'metadata.json'), nextMetadata);
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
  const folderPrefix = `${path.resolve(folder)}${path.sep}`;
  return markdown.replace(/(!\[[^\]]*\]\()([^\s)]+)(\))/g, (whole, before: string, rawTarget: string, after: string) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(rawTarget) || rawTarget.startsWith('#')) return whole;
    let decoded = rawTarget;
    try { decoded = decodeURIComponent(rawTarget); } catch { /* keep the literal path */ }
    const target = path.resolve(folder, decoded);
    if (!target.startsWith(folderPrefix) || !fs.existsSync(target) || !fs.statSync(target).isFile()) return whole;
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
    const raw = readJson<unknown>(path.join(folder, 'metadata.json'));
    const record = isLibraryItemRecord(raw) ? raw : legacyMetadataToRecord(raw, path.basename(folder));
    if (!record || record.deletedAt) return null;
    const matches = record.id === canonicalId || record.storageId === canonicalId || record.sourceKey === canonicalId;
    if (!matches) return null;
    const metadata = recordReaderMetadata(record);
    const reader = documentFile(folder, metadata.files?.reader, 'reader.md');
    if (!fs.existsSync(reader)) return null;
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
    metadata: readJson<ReaderMetadata>(path.join(folder, 'metadata.json')) ?? {},
  };
}

export function getLibraryReaderDocument(documentId: string): LibraryReaderDocument | null {
  const resolved = resolvedDocument(documentId);
  if (!resolved) return null;
  const { identity, folder, metadata } = resolved;
  const readerName = metadata.files?.reader || 'reader.md';
  const originalName = metadata.files?.original || 'original.pdf';
  const sourceMapName = metadata.files?.sourceMap || 'source-map.json';
  const markdownPath = documentFile(folder, readerName, 'reader.md');
  const sourceMapPath = documentFile(folder, sourceMapName, 'source-map.json');
  const originalPath = documentFile(folder, originalName, 'original.pdf');
  if (!fs.existsSync(markdownPath)) return null;

  const rawMarkdown = fs.readFileSync(markdownPath, 'utf8');
  const sourceMap = readJson<ReaderSourceMap>(sourceMapPath);
  const originalAvailable = fs.existsSync(originalPath) && fs.statSync(originalPath).isFile();
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
    originalFileName: originalAvailable ? path.basename(originalPath) : null,
    originalUrl: originalAvailable ? `nodus-library://original/${encodeURIComponent(identity.workId)}?v=${encodeURIComponent(path.basename(originalPath))}` : null,
    originalMimeType: originalAvailable ? mimeForOriginal(originalPath) : null,
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
  const markdownPath = documentFile(resolved.folder, resolved.metadata.files?.reader, 'reader.md');
  if (!fs.existsSync(markdownPath)) return null;
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
  const target = documentFile(resolved.folder, name, 'original.pdf');
  return fs.existsSync(target) && fs.statSync(target).isFile() ? target : null;
}

function annotationsPath(documentId: string): { filePath: string; documentId: string } | null {
  const resolved = resolvedDocument(documentId);
  if (!resolved) return null;
  return {
    filePath: documentFile(resolved.folder, resolved.metadata.files?.annotations, 'annotations.json'),
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
  return resolved ? documentFile(resolved.folder, resolved.metadata.files?.chat, 'chat.json') : null;
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
