import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import AdmZip from 'adm-zip';
import type {
  LibraryReaderAttachment,
  LibraryReaderAttachmentContent,
  LibraryReaderDocument,
  LibraryReaderChatMessage,
  LibraryReaderSection,
  WritingDraftAnnotation,
  WritingDraftAnnotationColor,
  WritingDraftAnnotationInput,
  WorkView,
} from '@shared/types';
import type { LibraryContentRevision, LibraryItemRecord } from '@shared/libraryTypes';
import { getWork } from '../db/worksRepo';
import { xlsxFileToText } from '../extraction/tabular';
import { atomicWriteJson, configuredLibraryRootOrThrow, safeLibraryFolderName } from '../library/libraryPaths';
import { legacyMetadataToRecord, normalizeLibraryItemRecord } from '../library/libraryRecord';

interface ReaderMetadata {
  citationKey?: string;
  storageId?: string;
  title?: string;
  authors?: string[];
  year?: number | null;
  url?: string;
  zotero?: { itemKey?: string; attachmentKey?: string };
  files?: { reader?: string; original?: string; sourceMap?: string; annotations?: string; chat?: string; orphanedAnnotations?: string };
  contentRevision?: LibraryContentRevision;
  extraction?: LibraryItemRecord['extraction'];
  attachments?: LibraryItemRecord['attachments'];
}

interface SourceMapBlock {
  kind?: string;
  markdown?: { start?: number; end?: number };
  anchors?: Array<{ page?: number; bbox?: number[] }>;
}

interface ReaderSourceMap {
  pages?: Array<{ page?: number; width?: number; height?: number }>;
  blocks?: SourceMapBlock[];
  reader?: { sha256?: string };
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
  anchorStatus?: 'current' | 'orphaned';
  contentFingerprint?: string | null;
  orphanReason?: string | null;
  target?: WritingDraftAnnotation['target'];
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
    url: record.metadata.url,
    zotero: identity.zoteroKey ? { itemKey: identity.zoteroKey } : undefined,
    files: record.files,
    contentRevision: record.contentRevision,
    extraction: record.extraction,
    attachments: record.attachments,
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
function inlineDocumentImages(markdown: string, folder: string, markdownFolder: string): string {
  return markdown.replace(/(!\[[^\]]*\]\()([^\s)]+)(\))/g, (whole, before: string, rawTarget: string, after: string) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(rawTarget) || rawTarget.startsWith('#')) return whole;
    let decoded = rawTarget;
    try { decoded = decodeURIComponent(rawTarget); } catch { /* keep the literal path */ }
    const target = path.resolve(markdownFolder, decoded);
    if (!pathStaysInside(folder, target)) return whole;
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
  const cleanAvailable = !!markdownPath && fs.existsSync(markdownPath) && fs.statSync(markdownPath).isFile();
  const rawMarkdown = cleanAvailable && markdownPath ? fs.readFileSync(markdownPath, 'utf8') : '';
  const sourceMap = sourceMapPath ? readJson<ReaderSourceMap>(sourceMapPath) : null;
  const originalAvailable = !!originalPath && fs.existsSync(originalPath) && fs.statSync(originalPath).isFile();
  const extractionRevision = metadata.contentRevision?.components.extraction;
  const freshness = extractionRevision?.freshness ?? (metadata.files?.reader ? 'unavailable' : 'none');
  const sourceContentFingerprint = metadata.contentRevision?.contentFingerprint ?? sourceMap?.reader?.sha256 ?? null;
  const declaredAttachments = Array.isArray(metadata.attachments) ? metadata.attachments : [];
  const attachments: LibraryReaderAttachment[] = declaredAttachments
    .map((attachment) => readerAttachment(identity.workId, folder, attachment))
    .sort((a, b) => {
      const left = declaredAttachments.find((entry) => entry.id === a.id)?.position ?? 0;
      const right = declaredAttachments.find((entry) => entry.id === b.id)?.position ?? 0;
      return left - right || a.id.localeCompare(b.id);
    });
  if (originalAvailable && originalPath && !attachments.some((entry) => path.basename(entry.fileName) === path.basename(originalPath))) {
    attachments.unshift(readerAttachment(identity.workId, folder, {
      id: 'original', title: path.basename(originalPath), fileName: path.basename(originalPath),
      relativePath: path.relative(folder, originalPath), mimeType: mimeForOriginal(originalPath),
      byteSize: fs.statSync(originalPath).size, sha256: '', role: 'original', position: -1,
    }));
  }
  return {
    workId: identity.workId,
    storageId: identity.storageId,
    zoteroKey: identity.zoteroKey,
    citationKey: metadata.citationKey?.trim() || null,
    title: metadata.title?.trim() || identity.title,
    authors: Array.isArray(metadata.authors) && metadata.authors.length ? metadata.authors : identity.authors,
    year: typeof metadata.year === 'number' ? metadata.year : identity.year,
    sourceUrl: metadata.url?.trim() || null,
    markdown: cleanAvailable && markdownPath ? inlineDocumentImages(rawMarkdown, folder, path.dirname(markdownPath)) : '',
    cleanAvailable,
    sections: sectionsFromMarkdown(rawMarkdown, sourceMap),
    pageCount: sourceMap?.pages?.length || null,
    wordCount: rawMarkdown.split(/\s+/).filter(Boolean).length,
    originalAvailable,
    originalFileName: originalAvailable && originalPath ? path.basename(originalPath) : null,
    originalUrl: originalAvailable && originalPath ? `nodus-library://original/${encodeURIComponent(identity.workId)}?v=${encodeURIComponent(path.basename(originalPath))}` : null,
    originalMimeType: originalAvailable && originalPath ? mimeForOriginal(originalPath) : null,
    attachments,
    sourceMapAvailable: sourceMap !== null,
    contentFingerprint: sourceContentFingerprint,
    extractionFingerprint: metadata.contentRevision?.extractionFingerprint ?? metadata.extraction?.lastSuccessfulFingerprint ?? null,
    freshness,
    generatedAt: extractionRevision?.generatedAt ?? metadata.extraction?.lastSuccessfulAt ?? null,
    previousReadable: !!metadata.contentRevision?.contentFingerprint && freshness !== 'current',
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
    '.txt': 'text/plain', '.csv': 'text/csv', '.tsv': 'text/tab-separated-values', '.xml': 'application/xml', '.jats': 'application/xml',
    '.html': 'text/html', '.htm': 'text/html', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.tif': 'image/tiff', '.tiff': 'image/tiff',
  } as Record<string, string>)[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

function attachmentViewer(mimeType: string, fileName: string): LibraryReaderAttachment['viewer'] {
  const mime = mimeType.toLowerCase();
  const extension = path.extname(fileName).toLowerCase();
  if (mime === 'application/pdf' || extension === '.pdf') return 'pdf';
  if (mime === 'application/epub+zip' || extension === '.epub') return 'epub';
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'text/html' || ['.html', '.htm'].includes(extension)) return 'html';
  if (['.docx', '.odt', '.rtf', '.pptx', '.odp'].includes(extension)) return 'html';
  if (['.xlsx', '.ods'].includes(extension)) return 'text';
  if (mime.startsWith('text/') || ['.md', '.markdown', '.xml', '.jats'].includes(extension)) return 'text';
  return 'external';
}

function readerAttachment(documentId: string, folder: string, attachment: LibraryItemRecord['attachments'][number]): LibraryReaderAttachment {
  const file = optionalDocumentFile(folder, attachment.relativePath, attachment.fileName);
  const available = !!file && fs.existsSync(file) && fs.statSync(file).isFile();
  const viewer = attachmentViewer(attachment.mimeType, attachment.fileName);
  const annotationMode = viewer === 'image' ? 'region' : ['pdf', 'epub', 'html', 'text'].includes(viewer) ? 'text' : 'none';
  return {
    id: attachment.id, title: attachment.title || attachment.fileName, fileName: attachment.fileName,
    mimeType: attachment.mimeType || mimeForOriginal(attachment.fileName), byteSize: attachment.byteSize,
    role: attachment.role, viewer, available,
    url: available ? `nodus-library://attachment/${encodeURIComponent(documentId)}/${encodeURIComponent(attachment.id)}?v=${encodeURIComponent(attachment.sha256 || attachment.fileName)}` : null,
    annotationsSupported: available && annotationMode !== 'none', annotationMode,
  };
}

export function libraryReaderOriginalPath(documentId: string): string | null {
  const resolved = resolvedDocument(documentId);
  if (!resolved) return null;
  const name = resolved.metadata.files?.original || 'original.pdf';
  const target = optionalDocumentFile(resolved.folder, name, 'original.pdf');
  return target && fs.existsSync(target) && fs.statSync(target).isFile() ? target : null;
}

export function libraryReaderAttachmentPath(documentId: string, attachmentId: string): string | null {
  const resolved = resolvedDocument(documentId);
  if (!resolved) return null;
  const attachment = resolved.metadata.attachments?.find((entry) => entry.id === attachmentId);
  if (!attachment) {
    if (attachmentId === 'original') return libraryReaderOriginalPath(documentId);
    return null;
  }
  const target = optionalDocumentFile(resolved.folder, attachment.relativePath, attachment.fileName);
  return target && fs.existsSync(target) && fs.statSync(target).isFile() ? target : null;
}

function safeZipPath(base: string, target: string): string | null {
  const normalized = path.posix.normalize(path.posix.join(base, target)).replace(/^\/+/, '');
  return normalized.startsWith('../') || normalized.includes('/../') ? null : normalized;
}

function xmlAttribute(source: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(source);
  return match?.[1]?.trim() || null;
}

function plainHtmlText(html: string): string {
  return html.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/(?:p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').trim();
}

function sanitizedPublicationHtml(html: string, zip?: AdmZip, entryName?: string): string {
  let body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html;
  body = body.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|iframe|object|embed|form|input|button|video|audio|svg)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|style|iframe|object|embed|form|input|button|video|audio|svg)\b[^>]*\/?\s*>/gi, '')
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/\sstyle\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
    .replace(/\s(?:href|src)\s*=\s*(["'])\s*(?:javascript|file):[\s\S]*?\1/gi, '');
  if (zip && entryName) {
    const base = path.posix.dirname(entryName);
    body = body.replace(/(<img\b[^>]*\bsrc\s*=\s*["'])([^"']+)(["'][^>]*>)/gi, (whole, before: string, raw: string, after: string) => {
      if (/^(?:data:|https?:)/i.test(raw)) return whole;
      let decoded = raw.split('#')[0];
      try { decoded = decodeURIComponent(decoded); } catch { /* keep the encoded path */ }
      const name = safeZipPath(base, decoded);
      const entry = name ? zip.getEntry(name) : null;
      if (!entry || entry.isDirectory || entry.header.size > 12 * 1024 * 1024) return '';
      const mime = mimeForOriginal(name!);
      if (!mime.startsWith('image/')) return '';
      return `${before}data:${mime};base64,${entry.getData().toString('base64')}${after}`;
    });
  }
  return body;
}

function epubContent(file: string, attachmentId: string): LibraryReaderAttachmentContent {
  const zip = new AdmZip(file);
  const container = zip.getEntry('META-INF/container.xml')?.getData().toString('utf8') ?? '';
  const rootfile = xmlAttribute(/<rootfile\b[^>]*>/i.exec(container)?.[0] ?? '', 'full-path');
  if (!rootfile) throw new Error('El EPUB no contiene un paquete OPF válido.');
  const opfEntry = zip.getEntry(rootfile);
  if (!opfEntry || opfEntry.header.size > 8 * 1024 * 1024) throw new Error('El paquete OPF del EPUB no es válido.');
  const opf = opfEntry.getData().toString('utf8');
  const manifest = new Map<string, string>();
  for (const match of opf.matchAll(/<item\b[^>]*>/gi)) {
    const id = xmlAttribute(match[0], 'id'); const href = xmlAttribute(match[0], 'href');
    if (id && href) manifest.set(id, href);
  }
  const spine = [...opf.matchAll(/<itemref\b[^>]*>/gi)].map((match) => xmlAttribute(match[0], 'idref')).filter((value): value is string => !!value);
  const opfBase = path.posix.dirname(rootfile);
  const chapters = spine.slice(0, 2_000).flatMap((idref, index) => {
    const href = manifest.get(idref); const name = href ? safeZipPath(opfBase, href.split('#')[0]) : null;
    const entry = name ? zip.getEntry(name) : null;
    if (!entry || entry.isDirectory || entry.header.size > 16 * 1024 * 1024) return [];
    const source = entry.getData().toString('utf8');
    const html = sanitizedPublicationHtml(source, zip, name!); const text = plainHtmlText(html);
    if (!text) return [];
    const title = plainHtmlText(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(source)?.[1] ?? '')
      || plainHtmlText(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(html)?.[1] ?? '') || `Capítulo ${index + 1}`;
    return [{ id: idref, title, html, text }];
  });
  if (!chapters.length) throw new Error('El EPUB no contiene capítulos legibles.');
  return { attachmentId, viewer: 'epub', text: chapters.map((chapter) => chapter.text).join('\n\n'), html: null, chapters };
}

function escapePublicationText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function officeXmlParagraphs(xml: string): string[] {
  const paragraphs = xml.match(/<(?:text:p|text:h|a:p)\b[^>]*>[\s\S]*?<\/(?:text:p|text:h|a:p)>/gi) ?? [];
  return paragraphs.map((entry) => plainHtmlText(entry.replace(/<text:tab\b[^>]*\/>/gi, '\t').replace(/<text:line-break\b[^>]*\/>/gi, '\n'))).filter(Boolean);
}

function zippedOfficeContent(file: string, extension: string): { html: string; text: string } {
  const zip = new AdmZip(file);
  if (extension === '.pptx') {
    const slides = zip.getEntries().filter((entry) => /^ppt\/slides\/slide\d+\.xml$/i.test(entry.entryName)).sort((a, b) => {
      const left = Number(a.entryName.match(/slide(\d+)\.xml/i)?.[1] ?? 0); const right = Number(b.entryName.match(/slide(\d+)\.xml/i)?.[1] ?? 0); return left - right;
    }).slice(0, 5_000);
    const sections = slides.flatMap((entry, index) => {
      if (entry.header.size > 16 * 1024 * 1024) return [];
      const lines = officeXmlParagraphs(entry.getData().toString('utf8')); if (!lines.length) return [];
      return [`<section><h2>${escapePublicationText(`Diapositiva ${index + 1}`)}</h2>${lines.map((line) => `<p>${escapePublicationText(line)}</p>`).join('')}</section>`];
    });
    const html = sections.join(''); return { html, text: plainHtmlText(html) };
  }
  const entryName = extension === '.odt' || extension === '.ods' || extension === '.odp' ? 'content.xml' : '';
  const entry = entryName ? zip.getEntry(entryName) : null;
  if (!entry || entry.header.size > 32 * 1024 * 1024) throw new Error('El documento OpenDocument no contiene texto legible.');
  const lines = officeXmlParagraphs(entry.getData().toString('utf8'));
  const html = lines.map((line) => `<p>${escapePublicationText(line)}</p>`).join('');
  return { html, text: lines.join('\n') };
}

function rtfText(source: string): string {
  return source.replace(/\\par[d]?\b ?/gi, '\n').replace(/\\line\b ?/gi, '\n')
    .replace(/\\'([0-9a-f]{2})/gi, (_whole, hex: string) => Buffer.from([Number.parseInt(hex, 16)]).toString('latin1'))
    .replace(/\\[a-z]+-?\d* ?/gi, '').replace(/\\[{}\\]/g, '').replace(/[{}]/g, '')
    .replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').trim();
}

export async function getLibraryReaderAttachmentContent(documentId: string, attachmentId: string): Promise<LibraryReaderAttachmentContent | null> {
  const resolved = resolvedDocument(documentId); const file = libraryReaderAttachmentPath(documentId, attachmentId);
  const attachment = resolved?.metadata.attachments?.find((entry) => entry.id === attachmentId);
  if (!resolved || !file || !attachment) return null;
  const viewer = attachmentViewer(attachment.mimeType, attachment.fileName);
  if (viewer === 'epub') return epubContent(file, attachmentId);
  if (viewer !== 'html' && viewer !== 'text') return null;
  const stat = fs.statSync(file);
  if (stat.size > 128 * 1024 * 1024) throw new Error('El adjunto supera el límite de lectura de 128 MB.');
  const extension = path.extname(file).toLowerCase();
  if (extension === '.docx') {
    const mammoth: any = await import('mammoth');
    const converted = await mammoth.convertToHtml({ path: file }); const html = sanitizedPublicationHtml(String(converted.value ?? ''));
    return { attachmentId, viewer: 'html', text: plainHtmlText(html), html, chapters: [] };
  }
  if (extension === '.xlsx') {
    const text = xlsxFileToText(file); return { attachmentId, viewer: 'text', text, html: null, chapters: [] };
  }
  if (['.odt', '.ods', '.pptx', '.odp'].includes(extension)) {
    const content = zippedOfficeContent(file, extension); return { attachmentId, viewer, ...content, chapters: [] };
  }
  const source = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
  if (extension === '.rtf') {
    const text = rtfText(source); return { attachmentId, viewer: 'html', text, html: `<p>${escapePublicationText(text).replace(/\n/g, '</p><p>')}</p>`, chapters: [] };
  }
  if (viewer === 'html') {
    const html = sanitizedPublicationHtml(source); return { attachmentId, viewer, text: plainHtmlText(html), html, chapters: [] };
  }
  return { attachmentId, viewer, text: source, html: null, chapters: [] };
}

function annotationsPath(documentId: string): { filePath: string; orphanedFilePath: string; documentId: string; contentFingerprint: string | null } | null {
  const resolved = resolvedDocument(documentId);
  if (!resolved) return null;
  const filePath = optionalDocumentFile(resolved.folder, resolved.metadata.files?.annotations, 'annotations.json');
  if (!filePath) return null;
  return {
    filePath,
    orphanedFilePath: optionalDocumentFile(resolved.folder, resolved.metadata.files?.orphanedAnnotations, 'orphaned-annotations.json')
      ?? path.join(resolved.folder, 'orphaned-annotations.json'),
    documentId: resolved.identity.storageId,
    contentFingerprint: resolved.metadata.contentRevision?.contentFingerprint ?? null,
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
    && typeof item.updatedAt === 'string'
    && validAnnotationTarget(item.target);
}

function validAnnotationTarget(target: unknown): boolean {
  if (target == null) return true;
  if (!target || typeof target !== 'object') return false;
  const value = target as NonNullable<WritingDraftAnnotation['target']>;
  if (value.type === 'text') return typeof value.attachmentId === 'string' && value.attachmentId.length <= 512
    && (value.page == null || Number.isInteger(value.page) && value.page > 0)
    && (value.chapterId == null || typeof value.chapterId === 'string' && value.chapterId.length <= 512);
  return value.type === 'region' && typeof value.attachmentId === 'string' && value.attachmentId.length <= 512
    && [value.x, value.y, value.width, value.height].every((entry) => Number.isFinite(entry) && entry >= 0 && entry <= 1)
    && value.width > 0 && value.height > 0 && value.x + value.width <= 1.000001 && value.y + value.height <= 1.000001;
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
    .filter((annotation) => annotation.anchorStatus !== 'orphaned')
    .sort((a, b) => a.scope.localeCompare(b.scope) || a.startOffset - b.startOffset || a.createdAt.localeCompare(b.createdAt))
    .map((annotation) => publicAnnotation(workId, annotation));
}

export function listLibraryReaderOrphanedAnnotations(workId: string): WritingDraftAnnotation[] {
  const target = annotationsPath(workId);
  if (!target) return [];
  return readDiskAnnotations(target.filePath)
    .filter((annotation) => annotation.anchorStatus === 'orphaned')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
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
  if (!validAnnotationTarget(input.target)) throw new Error('La posición de la anotación no es válida.');
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
    ...(input.target ? { target: input.target } : {}),
  };
}

export function createLibraryReaderAnnotation(workId: string, input: WritingDraftAnnotationInput): WritingDraftAnnotation {
  const target = annotationsPath(workId);
  if (!target) throw new Error('La versión de lectura ya no existe.');
  const value = normalizedAnnotationInput(input);
  const now = new Date().toISOString();
  const id = value.kind === 'bookmark' ? `reader-bookmark:${target.documentId}:${value.scope}` : randomUUID();
  const next: DiskAnnotation = {
    id, documentId: target.documentId, ...value, createdAt: now, updatedAt: now,
    anchorStatus: 'current', contentFingerprint: target.contentFingerprint, orphanReason: null,
  };
  const annotations = readDiskAnnotations(target.filePath);
  const existing = annotations.findIndex((annotation) => annotation.id === id);
  if (existing >= 0) next.createdAt = annotations[existing].createdAt;
  if (existing >= 0) annotations[existing] = next;
  else annotations.push(next);
  atomicWriteJson(target.filePath, annotations);
  atomicWriteJson(target.orphanedFilePath, annotations.filter((annotation) => annotation.anchorStatus === 'orphaned'));
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
  atomicWriteJson(target.orphanedFilePath, annotations.filter((entry) => entry.anchorStatus === 'orphaned'));
  return publicAnnotation(workId, annotation);
}

export function deleteLibraryReaderAnnotation(workId: string, id: string): boolean {
  const target = annotationsPath(workId);
  if (!target) return false;
  const annotations = readDiskAnnotations(target.filePath);
  const next = annotations.filter((annotation) => annotation.id !== id);
  if (next.length === annotations.length) return false;
  atomicWriteJson(target.filePath, next);
  atomicWriteJson(target.orphanedFilePath, next.filter((annotation) => annotation.anchorStatus === 'orphaned'));
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
