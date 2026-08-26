import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

export const LIBRARY_PACKAGE_HASH_PATTERN = /^[0-9a-f]{64}$/;

export function isValidLibraryPackageHash(value) {
  return LIBRARY_PACKAGE_HASH_PATTERN.test(String(value ?? ''));
}

export function hashLibraryPackage(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function looksLikeZip(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 4) return false;
  const signature = bytes.readUInt32LE(0);
  return signature === 0x04034b50 || signature === 0x06054b50 || signature === 0x08074b50;
}

const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const END_SIGNATURE = 0x06054b50;
const MAX_ZIP_ENTRIES = 1_003; // document, manifest, one original and at most one thousand figures.
const MAX_MARKDOWN_BYTES = 64 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_FIGURE_BYTES = 8 * 1024 * 1024;
const MAX_ORIGINAL_BYTES = 96 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
const FIGURE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);
const ORIGINAL_EXTENSIONS = new Set([
  '.pdf', '.epub', '.md', '.markdown', '.txt', '.csv', '.tsv', '.xml', '.jats', '.html', '.htm',
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg', '.tif', '.tiff',
  '.docx', '.odt', '.rtf', '.pptx', '.odp', '.xlsx', '.ods',
]);
const utf8 = new TextDecoder('utf-8', { fatal: true });

function decodeUtf8(bytes) {
  try { return utf8.decode(bytes); } catch { return null; }
}

function figureMime(bytes, extension) {
  if (extension === '.png' && bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if ((extension === '.jpg' || extension === '.jpeg') && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (extension === '.gif' && bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (extension === '.webp' && bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (extension === '.svg') {
    const source = decodeUtf8(bytes);
    if (source && !source.includes('\0') && /<svg(?:\s|>)/i.test(source.slice(0, 4096))) return 'image/svg+xml';
  }
  return null;
}

function zipEndOffset(bytes) {
  const floor = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= floor; offset -= 1) {
    if (bytes.readUInt32LE(offset) === END_SIGNATURE) return offset;
  }
  return -1;
}

/**
 * Fully inspect a package before persisting it. This intentionally avoids a ZIP dependency:
 * the production server image has no node_modules. Central-directory sizes are bounded before
 * inflation, paths are checked twice, and every extracted payload is checked against its role.
 */
export function inspectLibraryPackage(bytes) {
  if (!looksLikeZip(bytes)) return { ok: false, reason: 'The upload is not a readable ZIP.' };
  const end = zipEndOffset(bytes);
  if (end < 0 || end + 22 > bytes.length) return { ok: false, reason: 'The ZIP has no valid end record.' };
  const disk = bytes.readUInt16LE(end + 4);
  const centralDisk = bytes.readUInt16LE(end + 6);
  const diskEntries = bytes.readUInt16LE(end + 8);
  const entryCount = bytes.readUInt16LE(end + 10);
  const centralBytes = bytes.readUInt32LE(end + 12);
  const centralOffset = bytes.readUInt32LE(end + 16);
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== entryCount || entryCount < 2 || entryCount > MAX_ZIP_ENTRIES) {
    return { ok: false, reason: 'The ZIP entry table is not supported.' };
  }
  if (centralOffset + centralBytes > end) return { ok: false, reason: 'The ZIP entry table is outside the archive.' };

  const names = new Set();
  let pointer = centralOffset;
  let total = 0;
  let hasMarkdown = false;
  let hasManifest = false;
  let hasOriginal = false;
  let manifest = null;
  for (let index = 0; index < entryCount; index += 1) {
    if (pointer + 46 > centralOffset + centralBytes || bytes.readUInt32LE(pointer) !== CENTRAL_SIGNATURE) {
      return { ok: false, reason: 'The ZIP entry table is malformed.' };
    }
    const flags = bytes.readUInt16LE(pointer + 8);
    const method = bytes.readUInt16LE(pointer + 10);
    const compressed = bytes.readUInt32LE(pointer + 20);
    const uncompressed = bytes.readUInt32LE(pointer + 24);
    const nameBytes = bytes.readUInt16LE(pointer + 28);
    const extraBytes = bytes.readUInt16LE(pointer + 30);
    const commentBytes = bytes.readUInt16LE(pointer + 32);
    const localOffset = bytes.readUInt32LE(pointer + 42);
    const next = pointer + 46 + nameBytes + extraBytes + commentBytes;
    if (next > centralOffset + centralBytes || [compressed, uncompressed, localOffset].includes(0xffffffff)) {
      return { ok: false, reason: 'ZIP64 and malformed entries are not supported.' };
    }
    const name = decodeUtf8(bytes.subarray(pointer + 46, pointer + 46 + nameBytes));
    if (!name || name.includes('\\') || name.includes('\0') || name.startsWith('/') || name.endsWith('/')) {
      return { ok: false, reason: 'The ZIP contains an unsafe path.' };
    }
    const parts = name.split('/');
    if (parts.some((part) => !part || part === '.' || part === '..')) return { ok: false, reason: 'The ZIP contains an unsafe path.' };
    const normalizedName = name.toLocaleLowerCase('en-US');
    if (names.has(normalizedName)) return { ok: false, reason: 'The ZIP contains duplicate paths.' };
    names.add(normalizedName);
    const extension = path.extname(name).toLocaleLowerCase('en-US');
    const isMarkdown = name === 'document.md';
    const isManifest = name === 'manifest.json';
    const isFigure = name.startsWith('assets/') && FIGURE_EXTENSIONS.has(extension);
    const isOriginal = name.startsWith('original/') && parts.length === 2 && ORIGINAL_EXTENSIONS.has(extension);
    if (!isMarkdown && !isManifest && !isFigure && !isOriginal) {
      return { ok: false, reason: 'Only Clean Markdown, figures and one supported original may be published.' };
    }
    if (isOriginal && hasOriginal) return { ok: false, reason: 'A library package may contain only one original file.' };
    const entryLimit = isMarkdown ? MAX_MARKDOWN_BYTES : isManifest ? MAX_MANIFEST_BYTES : isOriginal ? MAX_ORIGINAL_BYTES : MAX_FIGURE_BYTES;
    if (uncompressed > entryLimit || total + uncompressed > MAX_UNCOMPRESSED_BYTES) return { ok: false, reason: 'The expanded library package is too large.' };
    if ((flags & 1) !== 0 || (method !== 0 && method !== 8)) return { ok: false, reason: 'Encrypted or unsupported ZIP entries are not accepted.' };

    if (localOffset + 30 > centralOffset || bytes.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      return { ok: false, reason: 'The ZIP local entry is malformed.' };
    }
    const localFlags = bytes.readUInt16LE(localOffset + 6);
    const localMethod = bytes.readUInt16LE(localOffset + 8);
    const localNameBytes = bytes.readUInt16LE(localOffset + 26);
    const localExtraBytes = bytes.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameBytes + localExtraBytes;
    if (localFlags !== flags || localMethod !== method || dataOffset + compressed > centralOffset) {
      return { ok: false, reason: 'The ZIP local entry disagrees with its table.' };
    }
    const localName = decodeUtf8(bytes.subarray(localOffset + 30, localOffset + 30 + localNameBytes));
    if (localName !== name) return { ok: false, reason: 'The ZIP path table is inconsistent.' };
    let content;
    try {
      const payload = bytes.subarray(dataOffset, dataOffset + compressed);
      content = method === 0 ? Buffer.from(payload) : inflateRawSync(payload, { maxOutputLength: uncompressed + 1 });
    } catch {
      return { ok: false, reason: 'A ZIP entry could not be decompressed.' };
    }
    if (content.length !== uncompressed) return { ok: false, reason: 'A ZIP entry declared the wrong expanded size.' };
    if (isMarkdown) {
      const source = decodeUtf8(content);
      if (source === null || source.includes('\0')) return { ok: false, reason: 'document.md must be valid UTF-8 text.' };
      hasMarkdown = true;
    } else if (isManifest) {
      const source = decodeUtf8(content);
      try { manifest = source === null ? null : JSON.parse(source); } catch { manifest = null; }
      if (manifest?.format !== 'nodus.library-document-package' || ![1, 2].includes(Number(manifest?.formatVersion)) || !String(manifest?.documentId ?? '').trim()) {
        return { ok: false, reason: 'manifest.json is not a Nodus library document manifest.' };
      }
      hasManifest = true;
    } else if (isOriginal) {
      if (extension === '.pdf' && !content.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
        return { ok: false, reason: 'The published PDF original has no PDF signature.' };
      }
      hasOriginal = true;
    } else if (!figureMime(content, extension)) {
      return { ok: false, reason: `${name} is not an image of the type named by its extension.` };
    }
    total += uncompressed;
    pointer = next;
  }
  if (pointer !== centralOffset + centralBytes || !hasManifest || (!hasMarkdown && !hasOriginal)) {
    return { ok: false, reason: 'The ZIP must contain manifest.json and at least Clean Markdown or one original.' };
  }
  if (Number(manifest?.formatVersion) >= 2) {
    if (Boolean(manifest?.cleanMarkdown) !== hasMarkdown || Boolean(manifest?.original) !== hasOriginal) {
      return { ok: false, reason: 'manifest.json disagrees with the package contents.' };
    }
    if (hasOriginal && String(manifest?.original?.path ?? '') !== [...names].find((name) => name.startsWith('original/'))) {
      return { ok: false, reason: 'manifest.json names a different original file.' };
    }
  }
  return { ok: true, manifest, expandedBytes: total, entries: entryCount, hasMarkdown, hasOriginal };
}

export function libraryPackageExists(store, spaceId, hash) {
  return isValidLibraryPackageHash(hash) && fs.existsSync(store.libraryPackagePath(spaceId, hash));
}

export function readLibraryPackage(store, spaceId, hash) {
  if (!isValidLibraryPackageHash(hash)) return null;
  const target = store.libraryPackagePath(spaceId, hash);
  if (!fs.existsSync(target)) return null;
  const bytes = fs.readFileSync(target);
  return looksLikeZip(bytes) && hashLibraryPackage(bytes) === hash ? bytes : null;
}

/**
 * Read one already-validated entry without ever extracting the archive to disk.
 *
 * The full inspection runs first, so encrypted entries, ZIP64, duplicate/case-folded paths,
 * traversal and expansion bombs are rejected before this helper considers a payload.
 */
export function readLibraryPackageEntry(bytes, wantedName) {
  const inspection = inspectLibraryPackage(bytes);
  if (!inspection.ok || typeof wantedName !== 'string' || !wantedName) return null;
  const end = zipEndOffset(bytes);
  const entryCount = bytes.readUInt16LE(end + 10);
  let pointer = bytes.readUInt32LE(end + 16);
  for (let index = 0; index < entryCount; index += 1) {
    if (bytes.readUInt32LE(pointer) !== CENTRAL_SIGNATURE) return null;
    const flags = bytes.readUInt16LE(pointer + 8);
    const method = bytes.readUInt16LE(pointer + 10);
    const compressed = bytes.readUInt32LE(pointer + 20);
    const uncompressed = bytes.readUInt32LE(pointer + 24);
    const nameBytes = bytes.readUInt16LE(pointer + 28);
    const extraBytes = bytes.readUInt16LE(pointer + 30);
    const commentBytes = bytes.readUInt16LE(pointer + 32);
    const localOffset = bytes.readUInt32LE(pointer + 42);
    const name = decodeUtf8(bytes.subarray(pointer + 46, pointer + 46 + nameBytes));
    if (name === wantedName) {
      if ((flags & 1) !== 0 || (method !== 0 && method !== 8) || bytes.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) return null;
      const localNameBytes = bytes.readUInt16LE(localOffset + 26);
      const localExtraBytes = bytes.readUInt16LE(localOffset + 28);
      const dataOffset = localOffset + 30 + localNameBytes + localExtraBytes;
      try {
        const payload = bytes.subarray(dataOffset, dataOffset + compressed);
        const content = method === 0 ? Buffer.from(payload) : inflateRawSync(payload, { maxOutputLength: uncompressed + 1 });
        return content.length === uncompressed ? content : null;
      } catch {
        return null;
      }
    }
    pointer += 46 + nameBytes + extraBytes + commentBytes;
  }
  return null;
}

export function libraryPackageOriginalEntry(bytes) {
  const inspection = inspectLibraryPackage(bytes);
  const entry = inspection.ok && inspection.manifest?.original && typeof inspection.manifest.original === 'object'
    ? inspection.manifest.original : null;
  const entryPath = String(entry?.path || '');
  if (!entryPath.startsWith('original/') || entryPath.includes('..')) return null;
  const content = readLibraryPackageEntry(bytes, entryPath);
  return content ? { path: entryPath, content, manifest: entry } : null;
}

export function writeLibraryPackage(store, spaceId, hash, bytes) {
  const target = store.libraryPackagePath(spaceId, hash);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, bytes, { mode: 0o600 });
  fs.renameSync(temporary, target);
  return target;
}

export function listLibraryPackages(store, spaceId) {
  const root = store.libraryPackagesDir(spaceId);
  if (!fs.existsSync(root)) return [];
  const found = [];
  for (const first of fs.readdirSync(root)) {
    const firstDir = path.join(root, first);
    if (!fs.statSync(firstDir).isDirectory()) continue;
    for (const second of fs.readdirSync(firstDir)) {
      const secondDir = path.join(firstDir, second);
      if (!fs.statSync(secondDir).isDirectory()) continue;
      for (const name of fs.readdirSync(secondDir)) {
        const hash = name.endsWith('.zip') ? name.slice(0, -4) : '';
        if (isValidLibraryPackageHash(hash)) found.push({ hash, file: path.join(secondDir, name) });
      }
    }
  }
  return found;
}

export function spaceLibraryPackageBytes(store, spaceId) {
  return listLibraryPackages(store, spaceId).reduce((sum, entry) => {
    try { return sum + fs.statSync(entry.file).size; } catch { return sum; }
  }, 0);
}

export function snapshotLibraryPackageHashes(snapshot) {
  const hashes = new Set();
  for (const document of Array.isArray(snapshot?.library?.documents) ? snapshot.library.documents : []) {
    if (isValidLibraryPackageHash(document?.packageHash)) hashes.add(document.packageHash);
  }
  return hashes;
}

export function collectLibraryPackageGarbage(store, spaceId, referenced, graceMs, now = Date.now()) {
  const keep = referenced instanceof Set ? referenced : new Set(referenced);
  const removed = [];
  for (const entry of listLibraryPackages(store, spaceId)) {
    if (keep.has(entry.hash)) continue;
    let stat;
    try { stat = fs.statSync(entry.file); } catch { continue; }
    if (now - stat.mtimeMs < graceMs) continue;
    try { fs.rmSync(entry.file, { force: true }); removed.push(entry.hash); } catch { /* retry next sweep */ }
  }
  return removed;
}
