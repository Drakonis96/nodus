// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

/** Filesystem helpers shared with Library workers. Keep this module Electron-free. */
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SAFE_FOLDER = /^[A-Za-z0-9._-]+$/;
const WINDOWS_RESERVED = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i;

export function safeLibraryFolderName(value: string): string {
  const clean = value.trim();
  if (clean && clean !== '.' && clean !== '..' && SAFE_FOLDER.test(clean)
    && !WINDOWS_RESERVED.test(clean) && !/[. ]$/.test(clean)) return clean;
  const encoded = encodeURIComponent(clean).replace(/\./g, '%2E');
  if (!encoded) return `document-${createHash('sha256').update(value).digest('hex').slice(0, 16)}`;
  return WINDOWS_RESERVED.test(encoded)
    ? `%${encoded.codePointAt(0)!.toString(16).toUpperCase().padStart(2, '0')}${encoded.slice(1)}`
    : encoded;
}

/** Keep the final extension visible to filesystem providers. Google Drive may
 * append a MIME-derived extension to names ending in an encoded `%2Epdf`, which
 * makes the physical file drift away from its manifest path. */
export function safeLibraryFileName(value: string): string {
  const clean = value.trim();
  if (clean && clean !== '.' && clean !== '..' && SAFE_FOLDER.test(clean)
    && !WINDOWS_RESERVED.test(clean) && !/[. ]$/.test(clean)) return clean;
  const extension = path.extname(clean);
  if (!/^\.[A-Za-z0-9]{1,16}$/.test(extension)) return safeLibraryFolderName(clean);
  return `${safeLibraryFolderName(clean.slice(0, -extension.length))}${extension}`;
}

export function assertInside(root: string, target: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(target);
  if (resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`)) return resolved;
  throw new Error('La ruta de biblioteca no es válida.');
}

function pathEntryExists(filePath: string): boolean {
  try { fs.lstatSync(filePath); return true; }
  catch { return false; }
}

/** Resolve the closest existing ancestor so symlinked files and parent
 * directories cannot turn a manifest-relative path into arbitrary disk access. */
export function pathStaysInside(root: string, target: string): boolean {
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

function encodedTerminalExtension(value: string): { extension: string; encoded: string } | null {
  const baseName = path.basename(value);
  let decoded: string;
  try { decoded = decodeURIComponent(baseName); }
  catch { return null; }
  const extension = path.extname(decoded);
  if (!/^\.[A-Za-z0-9]{1,16}$/.test(extension)) return null;
  const encoded = encodeURIComponent(extension).replace(/\./g, '%2E');
  return baseName.toLowerCase().endsWith(encoded.toLowerCase()) ? { extension, encoded } : null;
}

/** Convert an old encoded-extension manifest path into the portable spelling
 * used by new writes, without decoding the rest of the safe filename. */
export function libraryFilePathWithLiteralExtension(relativePath: string): string {
  const terminal = encodedTerminalExtension(relativePath);
  if (!terminal) return relativePath;
  const baseName = path.basename(relativePath);
  const literalName = `${baseName.slice(0, -terminal.encoded.length)}${terminal.extension}`;
  return path.join(path.dirname(relativePath), literalName);
}

function regularFileInside(root: string, candidate: string): string | null {
  if (!pathStaysInside(root, candidate)) return null;
  try { return fs.statSync(candidate).isFile() ? candidate : null; }
  catch { return null; }
}

/** Resolve both canonical library paths and the legacy spelling produced when
 * a cloud filesystem appends `.pdf` to a filename already ending `%2Epdf`. */
export function resolveLibraryFile(root: string, declaredRelativePath: string): string | null {
  let declared: string;
  try { declared = assertInside(root, path.join(root, declaredRelativePath)); }
  catch { return null; }
  const exact = regularFileInside(root, declared);
  if (exact) return exact;
  const canonicalRelative = libraryFilePathWithLiteralExtension(declaredRelativePath);
  if (canonicalRelative !== declaredRelativePath) {
    const canonical = regularFileInside(root, assertInside(root, path.join(root, canonicalRelative)));
    if (canonical) return canonical;
    const terminal = encodedTerminalExtension(declaredRelativePath);
    if (terminal) return regularFileInside(root, `${declared}${terminal.extension}`);
  }
  return null;
}

export function atomicWriteFile(filePath: string, data: string | NodeJS.ArrayBufferView): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(descriptor, data);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(temporary, filePath);
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

export function atomicWriteJson(filePath: string, value: unknown): void {
  atomicWriteFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}
