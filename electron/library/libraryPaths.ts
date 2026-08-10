import { app } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readGlobalPrefsRaw } from '../db/appPrefs';

const SAFE_FOLDER = /^[A-Za-z0-9._-]+$/;
const WINDOWS_RESERVED = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i;

export function configuredLibraryRoot(): string | null {
  const configured = readGlobalPrefsRaw().autoBackupFolder;
  if (typeof configured !== 'string' || !configured.trim()) return null;
  return path.join(path.resolve(configured.trim()), 'nodus-library');
}

export function configuredLibraryRootOrThrow(): string {
  const root = configuredLibraryRoot();
  if (!root) throw new Error('Configura primero la carpeta de copias de seguridad de Nodus.');
  return root;
}

export function localLibraryDirectory(): string {
  return path.join(app.getPath('userData'), 'library');
}

export function localLibraryDatabasePath(): string {
  return path.join(localLibraryDirectory(), 'catalog.sqlite');
}

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

export function libraryDeviceId(): string {
  const directory = localLibraryDirectory();
  const file = path.join(directory, 'device.json');
  const current = readJsonFile<{ id?: unknown }>(file);
  if (typeof current?.id === 'string' && /^[a-f0-9-]{16,64}$/i.test(current.id)) return current.id;
  const id = randomUUID();
  atomicWriteJson(file, { format: 'nodus.library-device', formatVersion: 1, id, createdAt: new Date().toISOString() });
  return id;
}
