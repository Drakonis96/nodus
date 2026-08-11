// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

/** Pure filesystem tasks used by the Library reader worker. Electron APIs and app
 * preferences are deliberately forbidden here so the packaged worker stays safe. */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import type {
  LibraryReaderAttachment,
  LibraryReaderAttachmentContent,
  WritingDraftAnnotation,
  WritingDraftAnnotationColor,
  WritingDraftAnnotationInput,
} from '@shared/types';
import { xlsxFileToText } from '../extraction/tabular';
import { atomicWriteJson } from '../library/libraryFileUtils';

export interface LibraryReaderAttachmentTask {
  attachmentId: string;
  file: string;
  viewer: LibraryReaderAttachment['viewer'];
}

export interface LibraryReaderAnnotationContext {
  filePath: string;
  orphanedFilePath: string;
  documentId: string;
  contentFingerprint: string | null;
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

function mimeForFile(filePath: string): string {
  return ({
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
    '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.tif': 'image/tiff', '.tiff': 'image/tiff',
  } as Record<string, string>)[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
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
      try { decoded = decodeURIComponent(decoded); } catch { /* keep encoded path */ }
      const name = safeZipPath(base, decoded);
      const entry = name ? zip.getEntry(name) : null;
      if (!entry || entry.isDirectory || entry.header.size > 12 * 1024 * 1024) return '';
      const mime = mimeForFile(name!);
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

export async function getLibraryReaderAttachmentContentFromTask({ attachmentId, file, viewer }: LibraryReaderAttachmentTask): Promise<LibraryReaderAttachmentContent | null> {
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

function validDiskAnnotation(value: unknown): value is DiskAnnotation {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<DiskAnnotation>;
  return typeof item.id === 'string' && typeof item.documentId === 'string' && typeof item.scope === 'string'
    && (item.kind === 'highlight' || item.kind === 'comment' || item.kind === 'bookmark')
    && (item.color === null || COLORS.has(item.color as WritingDraftAnnotationColor))
    && Number.isInteger(item.startOffset) && Number.isInteger(item.endOffset)
    && Number(item.startOffset) >= 0 && Number(item.endOffset) > Number(item.startOffset)
    && typeof item.selectedText === 'string' && typeof item.prefix === 'string' && typeof item.suffix === 'string'
    && (item.comment === null || typeof item.comment === 'string')
    && typeof item.createdAt === 'string' && typeof item.updatedAt === 'string' && validAnnotationTarget(item.target);
}

function readDiskAnnotations(filePath: string): DiskAnnotation[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    return Array.isArray(parsed) ? parsed.filter(validDiskAnnotation) : [];
  } catch {
    return [];
  }
}

function publicAnnotation(workId: string, annotation: DiskAnnotation): WritingDraftAnnotation {
  return { ...annotation, draftId: workId };
}

function normalizedAnnotationInput(input: WritingDraftAnnotationInput) {
  const scope = input.scope.trim() || 'source';
  const startOffset = Math.trunc(input.startOffset); const endOffset = Math.trunc(input.endOffset);
  if (scope.length > 180) throw new Error('El contexto de la anotación no es válido.');
  if (startOffset < 0 || endOffset <= startOffset || input.selectedText.length !== endOffset - startOffset || !input.selectedText.trim()) throw new Error('El fragmento seleccionado no es válido.');
  if (input.kind === 'highlight' && (!input.color || !COLORS.has(input.color))) throw new Error('El color del subrayado no es válido.');
  const comment = input.kind === 'comment' ? input.comment?.trim() || '' : null;
  if (input.kind === 'comment' && !comment) throw new Error('Escribe el comentario antes de guardarlo.');
  if (!validAnnotationTarget(input.target)) throw new Error('La posición de la anotación no es válida.');
  return {
    scope, kind: input.kind, color: input.kind === 'highlight' ? input.color as WritingDraftAnnotationColor : null,
    startOffset, endOffset, selectedText: input.selectedText, prefix: (input.prefix ?? '').slice(-64), suffix: (input.suffix ?? '').slice(0, 64), comment,
    ...(input.target ? { target: input.target } : {}),
  };
}

export function createLibraryReaderAnnotationFromContext(workId: string, target: LibraryReaderAnnotationContext, input: WritingDraftAnnotationInput): WritingDraftAnnotation {
  const value = normalizedAnnotationInput(input); const now = new Date().toISOString();
  const id = value.kind === 'bookmark' ? `reader-bookmark:${target.documentId}:${value.scope}` : randomUUID();
  const next: DiskAnnotation = { id, documentId: target.documentId, ...value, createdAt: now, updatedAt: now, anchorStatus: 'current', contentFingerprint: target.contentFingerprint, orphanReason: null };
  const annotations = readDiskAnnotations(target.filePath); const existing = annotations.findIndex((annotation) => annotation.id === id);
  if (existing >= 0) next.createdAt = annotations[existing].createdAt;
  if (existing >= 0) annotations[existing] = next; else annotations.push(next);
  atomicWriteJson(target.filePath, annotations);
  atomicWriteJson(target.orphanedFilePath, annotations.filter((annotation) => annotation.anchorStatus === 'orphaned'));
  return publicAnnotation(workId, next);
}

export function updateLibraryReaderCommentFromContext(workId: string, target: LibraryReaderAnnotationContext, id: string, comment: string): WritingDraftAnnotation | null {
  const value = comment.trim(); if (!value) throw new Error('Escribe el comentario antes de guardarlo.');
  const annotations = readDiskAnnotations(target.filePath); const annotation = annotations.find((item) => item.id === id && item.kind === 'comment');
  if (!annotation) return null;
  annotation.comment = value; annotation.updatedAt = new Date().toISOString();
  atomicWriteJson(target.filePath, annotations);
  atomicWriteJson(target.orphanedFilePath, annotations.filter((entry) => entry.anchorStatus === 'orphaned'));
  return publicAnnotation(workId, annotation);
}

export function deleteLibraryReaderAnnotationFromContext(target: LibraryReaderAnnotationContext, id: string): boolean {
  const annotations = readDiskAnnotations(target.filePath); const next = annotations.filter((annotation) => annotation.id !== id);
  if (next.length === annotations.length) return false;
  atomicWriteJson(target.filePath, next);
  atomicWriteJson(target.orphanedFilePath, next.filter((annotation) => annotation.anchorStatus === 'orphaned'));
  return true;
}
