import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  LibraryReaderDocument,
  LibraryReaderSection,
  WritingDraftAnnotation,
  WritingDraftAnnotationColor,
  WritingDraftAnnotationInput,
  WorkView,
} from '@shared/types';
import { getSettings } from '../db/settingsRepo';
import { getWork } from '../db/worksRepo';

interface ReaderMetadata {
  citationKey?: string;
  storageId?: string;
  title?: string;
  authors?: string[];
  year?: number | null;
  zotero?: { itemKey?: string; attachmentKey?: string };
  files?: { reader?: string; original?: string; sourceMap?: string };
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
const SAFE_STORAGE_ID = /^[A-Za-z0-9._-]+$/;

function libraryRoot(): string {
  const backupRoot = getSettings().autoBackupFolder?.trim();
  if (!backupRoot) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  return path.join(backupRoot, 'nodus-library');
}

/** Personal-library Zotero keys remain byte-for-byte identical on disk. Group keys
 * contain characters Windows reserves, so only those exceptional ids are encoded;
 * their original canonical id remains in metadata as `storageId`. */
function storageFolderName(storageId: string): string {
  if (SAFE_STORAGE_ID.test(storageId) && storageId !== '.' && storageId !== '..') return storageId;
  return encodeURIComponent(storageId).replace(/\./g, '%2E') || '_document';
}

function storageIdFor(work: WorkView): string {
  return work.zotero_key?.trim() || work.nodus_id;
}

function rawZoteroKey(key: string): string {
  const match = /^groups:[^:]+:(.+)$/.exec(key);
  return match?.[1] ?? key;
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

function resolvedDocument(workId: string): { work: WorkView; folder: string; metadata: ReaderMetadata } | null {
  const work = getWork(workId);
  if (!work) return null;
  const folder = documentFolder(work);
  if (!folder) return null;
  return { work, folder, metadata: readJson<ReaderMetadata>(path.join(folder, 'metadata.json')) ?? {} };
}

export function getLibraryReaderDocument(workId: string): LibraryReaderDocument | null {
  const resolved = resolvedDocument(workId);
  if (!resolved) return null;
  const { work, folder, metadata } = resolved;
  const readerName = metadata.files?.reader || 'reader.md';
  const originalName = metadata.files?.original || 'original.pdf';
  const sourceMapName = metadata.files?.sourceMap || 'source-map.json';
  const markdownPath = documentFile(folder, readerName, 'reader.md');
  const sourceMapPath = documentFile(folder, sourceMapName, 'source-map.json');
  const originalPath = documentFile(folder, originalName, 'original.pdf');
  if (!fs.existsSync(markdownPath)) return null;

  const rawMarkdown = fs.readFileSync(markdownPath, 'utf8');
  const sourceMap = readJson<ReaderSourceMap>(sourceMapPath);
  const storageId = storageIdFor(work);
  return {
    workId: work.nodus_id,
    storageId,
    zoteroKey: work.zotero_key || null,
    citationKey: metadata.citationKey?.trim() || null,
    title: metadata.title?.trim() || work.title,
    authors: Array.isArray(metadata.authors) && metadata.authors.length ? metadata.authors : work.authors,
    year: typeof metadata.year === 'number' ? metadata.year : work.year,
    markdown: inlineDocumentImages(rawMarkdown, folder),
    sections: sectionsFromMarkdown(rawMarkdown, sourceMap),
    pageCount: sourceMap?.pages?.length || null,
    wordCount: rawMarkdown.split(/\s+/).filter(Boolean).length,
    originalAvailable: fs.existsSync(originalPath),
    originalFileName: fs.existsSync(originalPath) ? path.basename(originalPath) : null,
    sourceMapAvailable: sourceMap !== null,
  };
}

export function libraryReaderOriginalPath(workId: string): string | null {
  const resolved = resolvedDocument(workId);
  if (!resolved) return null;
  const name = resolved.metadata.files?.original || 'original.pdf';
  const target = documentFile(resolved.folder, name, 'original.pdf');
  return fs.existsSync(target) && fs.statSync(target).isFile() ? target : null;
}

function annotationsPath(workId: string): { filePath: string; documentId: string } | null {
  const resolved = resolvedDocument(workId);
  if (!resolved) return null;
  return { filePath: path.join(resolved.folder, 'annotations.json'), documentId: storageIdFor(resolved.work) };
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
