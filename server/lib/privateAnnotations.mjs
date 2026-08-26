// Private, per-user/per-space annotation storage.
//
// This deliberately does not use Store.state: state.json contains server metadata and is
// copied/backed up as one administrative object. A reader's annotations must never become
// visible to an administrator or another member merely because they share a space.

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const PRIVATE_ANNOTATIONS_VERSION = 1;
export const DEFAULT_MAX_ANNOTATIONS = 10_000;
export const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

function safePart(value) {
  const clean = String(value ?? '');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(clean)) throw new Error('Invalid annotation owner or space id.');
  return clean;
}

function plainText(value, max = 20_000) {
  // Annotation text is rendered by clients. Keep it plain even when a legacy publisher sent
  // HTML/Markdown-looking data; this removes scriptable tags without needing a dependency.
  return String(value ?? '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max);
}

function safeJson(value, maxBytes = 128 * 1024) {
  try {
    const json = JSON.stringify(value);
    return Buffer.byteLength(json) <= maxBytes ? JSON.parse(json) : null;
  } catch {
    return null;
  }
}

const ANNOTATION_KINDS = new Set(['highlight', 'comment', 'bookmark', 'note']);
const ANNOTATION_COLORS = new Set(['yellow', 'rose', 'blue', 'mint', 'lavender', 'peach']);

/** Convert current and legacy annotation shapes to a small, non-executable record. */
export function sanitizeAnnotation(input, now = new Date().toISOString()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const id = String(input.id ?? input.annotationId ?? '').trim().slice(0, 160) || randomUUID();
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(id)) return null;
  const anchorInput = input.anchor ?? input.range ?? null;
  const anchor = anchorInput && typeof anchorInput === 'object' && !Array.isArray(anchorInput)
    ? safeJson(anchorInput, 64 * 1024)
    : null;
  const requestedKind = plainText(input.kind ?? input.type ?? 'comment', 64).toLowerCase();
  const requestedColor = String(input.color ?? '').toLowerCase();
  const annotation = {
    id,
    resource: plainText(input.resource ?? input.resourceType ?? input.table ?? 'record', 128) || 'record',
    documentId: plainText(input.documentId ?? input.document_id ?? input.draftId ?? '', 512) || null,
    kind: ANNOTATION_KINDS.has(requestedKind) ? requestedKind : 'comment',
    title: plainText(input.title ?? input.label ?? '', 160),
    quote: plainText(input.quote ?? input.selectedText ?? input.quoteSnapshot ?? '', 20_000),
    content: plainText(input.content ?? input.text ?? input.comment ?? input.body ?? input.memo ?? input.note ?? input.value ?? '', 20_000),
    color: ANNOTATION_COLORS.has(requestedColor) || /^#[0-9a-f]{6}$/i.test(requestedColor) ? requestedColor : null,
    anchor,
    createdAt: typeof input.createdAt === 'string' ? input.createdAt.slice(0, 64) : now,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt.slice(0, 64) : now,
    deletedAt: input.deletedAt ? String(input.deletedAt).slice(0, 64) : null,
  };
  // A blank legacy row is not useful and is often a malformed/hostile import.
  if (!annotation.content && !annotation.quote && !annotation.anchor && !annotation.documentId) return null;
  return annotation;
}

export function sanitizeAnnotations(values, now = new Date().toISOString()) {
  if (!Array.isArray(values)) return [];
  const byId = new Map();
  for (const value of values) {
    const annotation = sanitizeAnnotation(value, now);
    if (annotation) byId.set(annotation.id, annotation);
  }
  return [...byId.values()];
}

export class AnnotationVersionConflict extends Error {
  constructor(current) {
    super('The annotations changed on another device.');
    this.name = 'AnnotationVersionConflict';
    this.statusCode = 409;
    this.current = current;
  }
}

export class AnnotationQuotaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AnnotationQuotaError';
    this.statusCode = 413;
  }
}

export class PrivateAnnotationStore {
  constructor(root, options = {}) {
    this.root = path.join(path.resolve(root), 'private-annotations');
    this.maxAnnotations = Number.isSafeInteger(options.maxAnnotations) && options.maxAnnotations > 0
      ? options.maxAnnotations : DEFAULT_MAX_ANNOTATIONS;
    this.maxBytes = Number.isSafeInteger(options.maxBytes) && options.maxBytes > 0
      ? options.maxBytes : DEFAULT_MAX_BYTES;
    if (fs.existsSync(this.root) && fs.lstatSync(this.root).isSymbolicLink()) throw new Error('Private annotation root must not be a symlink');
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    if (fs.lstatSync(this.root).isSymbolicLink()) throw new Error('Private annotation root must not be a symlink');
    try { fs.chmodSync(this.root, 0o700); } catch { /* Windows */ }
  }

  filePath(userId, spaceId) {
    const user = safePart(userId);
    const space = safePart(spaceId);
    const dir = path.join(this.root, user);
    if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) throw new Error('Private annotation user directory must not be a symlink');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (fs.lstatSync(dir).isSymbolicLink()) throw new Error('Private annotation user directory must not be a symlink');
    try { fs.chmodSync(dir, 0o700); } catch { /* Windows */ }
    const target = path.join(dir, `${space}.json`);
    if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error('Private annotation file must not be a symlink');
    return target;
  }

  empty(userId, spaceId) {
    return { version: 0, formatVersion: PRIVATE_ANNOTATIONS_VERSION, userId: String(userId), spaceId: String(spaceId), updatedAt: null, annotations: [] };
  }

  read(userId, spaceId) {
    const target = this.filePath(userId, spaceId);
    if (!fs.existsSync(target)) return this.empty(userId, spaceId);
    const descriptor = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(descriptor, 'utf8')); } finally { fs.closeSync(descriptor); }
    if ((parsed?.userId != null && parsed.userId !== String(userId)) || (parsed?.spaceId != null && parsed.spaceId !== String(spaceId))) {
      throw new Error('Private annotation ownership mismatch');
    }
    try { fs.chmodSync(target, 0o600); } catch { /* Windows */ }
    const annotations = sanitizeAnnotations(parsed?.annotations);
    return {
      version: Math.max(0, Number(parsed?.version) || 0),
      formatVersion: PRIVATE_ANNOTATIONS_VERSION,
      userId: String(userId), spaceId: String(spaceId),
      updatedAt: typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : null,
      annotations,
    };
  }

  checkQuota(annotations) {
    if (annotations.length > this.maxAnnotations) throw new AnnotationQuotaError(`Too many annotations; the limit is ${this.maxAnnotations}.`);
    const bytes = Buffer.byteLength(JSON.stringify({ version: 1, annotations }));
    if (bytes > this.maxBytes) throw new AnnotationQuotaError(`The annotations exceed the ${this.maxBytes}-byte quota.`);
    return bytes;
  }

  writeAtomic(userId, spaceId, value) {
    const target = this.filePath(userId, spaceId);
    const dir = path.dirname(target);
    const temporary = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const payload = JSON.stringify(value);
    const fd = fs.openSync(temporary, 'w', 0o600);
    try {
      fs.writeFileSync(fd, payload, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporary, target);
    try { fs.chmodSync(target, 0o600); } catch { /* best effort on Windows */ }
    try {
      const dirFd = fs.openSync(dir, 'r');
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    } catch { /* directory fsync is not portable */ }
    return value;
  }

  replace(userId, spaceId, annotations, expectedVersion = null) {
    const current = this.read(userId, spaceId);
    if (expectedVersion !== null && Number(expectedVersion) !== current.version) throw new AnnotationVersionConflict(current);
    const clean = sanitizeAnnotations(annotations);
    this.checkQuota(clean);
    const next = { ...current, version: current.version + 1, updatedAt: new Date().toISOString(), annotations: clean };
    return this.writeAtomic(userId, spaceId, next);
  }

  apply(userId, spaceId, operations, expectedVersion = null) {
    const current = this.read(userId, spaceId);
    if (expectedVersion !== null && Number(expectedVersion) !== current.version) throw new AnnotationVersionConflict(current);
    if (!Array.isArray(operations)) throw new Error('Annotation operations must be an array.');
    const byId = new Map(current.annotations.map((annotation) => [annotation.id, annotation]));
    for (const operation of operations) {
      const op = String(operation?.op || 'upsert');
      if (op === 'delete') {
        const id = String(operation?.id ?? operation?.annotation?.id ?? '');
        if (id) byId.delete(id);
        continue;
      }
      if (op !== 'upsert') throw new Error('Unknown annotation operation.');
      const annotation = sanitizeAnnotation(operation?.annotation ?? operation);
      if (!annotation) throw new Error('Invalid annotation.');
      byId.set(annotation.id, annotation);
    }
    const annotations = [...byId.values()];
    this.checkQuota(annotations);
    const next = { ...current, version: current.version + 1, updatedAt: new Date().toISOString(), annotations };
    return this.writeAtomic(userId, spaceId, next);
  }

  remove(userId, spaceId) {
    try { fs.rmSync(this.filePath(userId, spaceId), { force: true }); } catch { /* absent */ }
  }
}

export { safePart };
