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

export function assertInside(root: string, target: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(target);
  if (resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`)) return resolved;
  throw new Error('La ruta de biblioteca no es válida.');
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
