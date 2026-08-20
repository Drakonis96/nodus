import AdmZip from 'adm-zip';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  decryptBackupPayload,
  decryptBackupPayloadStream,
  sha256Hex,
  type BackupCipherMetadata,
} from './backupCrypto';
import { ZipFileReader, type ZipFileEntry } from './zipFile';

export interface StreamedOuterManifest {
  format: string;
  formatVersion: number;
  schemaVersion: number;
  appVersion?: string;
  includesSecrets?: boolean;
  cipher: BackupCipherMetadata;
  recovery?: { wrappedKeyCipher: BackupCipherMetadata };
}

export interface StreamedVaultEntry {
  id?: string;
  name: string;
  type?: string;
  legacy?: boolean;
  dbFile: string;
  inventoryFile?: string;
}

export interface StreamedInnerManifest {
  schemaVersion: number;
  files: Record<string, { sha256: string; bytes: number }>;
  activeVaultId?: string;
  vaults?: StreamedVaultEntry[];
  selection?: Record<string, unknown>;
  globalLibrary?: { prefix: string; fileCount: number };
}

type OuterManifest = StreamedOuterManifest;
type InnerManifest = StreamedInnerManifest;

interface OpenedBackupFile {
  ok: true;
  manifest: StreamedOuterManifest;
  payloadManifest: StreamedInnerManifest;
  payload: ZipFileReader;
  includesSecrets: boolean;
  recoveredKey?: string;
  usedRecoveryKey: boolean;
  cleanup: () => Promise<void>;
}

export type OpenBackupFileResult = OpenedBackupFile | { ok: false; message: string };
export type BackupFileProgress = (phase: 'decrypting' | 'verifying', completedBytes: number, totalBytes: number) => void;

/** Full archive authentication with no Electron main-only imports. */
export function verifyBackupBytes(archive: Buffer, password: string, currentSchema: number): { ok: boolean; message: string } {
  if (!password.trim()) return { ok: false, message: 'Falta la contraseña para verificar la copia.' };
  let outer: AdmZip; let manifest: OuterManifest;
  try {
    outer = new AdmZip(archive);
    const manifestEntry = outer.getEntry('manifest.json');
    if (!manifestEntry || !outer.getEntry('backup.bin')) return { ok: false, message: 'Archivo .nodus inválido: faltan manifest o datos cifrados.' };
    manifest = JSON.parse(outer.readAsText(manifestEntry)) as OuterManifest;
  } catch { return { ok: false, message: 'Archivo .nodus inválido o dañado: no se pudo leer su estructura.' }; }
  if (manifest.format !== 'nodus.encrypted-backup' || ![1, 2, 3, 4, 5, 6].includes(manifest.formatVersion)) return { ok: false, message: 'Formato de copia de seguridad no soportado.' };
  if (manifest.schemaVersion > currentSchema) return { ok: false, message: `El archivo usa un esquema más reciente (v${manifest.schemaVersion}) que esta versión de Nodus (v${currentSchema}). Actualiza la app.` };
  try {
    let credential = password;
    if (manifest.formatVersion >= 6) {
      const wrapped = outer.getEntry('recovery-key.bin');
      if (!wrapped || !manifest.recovery?.wrappedKeyCipher) return { ok: false, message: 'Copia inválida: falta la clave de recuperación cifrada.' };
      try { credential = decryptBackupPayload(wrapped.getData(), password, manifest.recovery.wrappedKeyCipher).toString('utf8'); } catch { credential = password; }
    }
    const ciphertext = outer.getEntry('backup.bin')!.getData();
    const payload = new AdmZip(decryptBackupPayload(ciphertext, credential, manifest.cipher));
    const innerEntry = payload.getEntry('payload-manifest.json');
    if (!innerEntry) return { ok: false, message: 'Copia inválida: falta el manifiesto interno.' };
    const inner = JSON.parse(payload.readAsText(innerEntry)) as InnerManifest;
    if (inner.schemaVersion > currentSchema) return { ok: false, message: 'La copia usa un esquema más reciente. Actualiza la app.' };
    for (const [name, expected] of Object.entries(inner.files)) {
      const entry = payload.getEntry(name);
      if (!entry) return { ok: false, message: 'Copia inválida: los hashes internos no coinciden.' };
      const data = entry.getData();
      if (data.byteLength !== expected.bytes || sha256Hex(data) !== expected.sha256) return { ok: false, message: 'Copia inválida: los hashes internos no coinciden.' };
    }
    if (!inner.vaults?.length) return { ok: false, message: 'La copia verificada no contiene ninguna bóveda.' };
    for (const vault of inner.vaults) if (!payload.getEntry(vault.dbFile)) return { ok: false, message: `La copia verificada no contiene la bóveda «${vault.name}».` };
    if (inner.globalLibrary) {
      const prefix = `${inner.globalLibrary.prefix}/`;
      const count = payload.getEntries().filter((entry) => !entry.isDirectory && entry.entryName.startsWith(prefix)).length;
      if (count !== inner.globalLibrary.fileCount) return { ok: false, message: 'La copia verificada no contiene todos los archivos de la Biblioteca global.' };
    }
    return { ok: true, message: `Copia verificada: ${inner.vaults.length} bóveda(s) descifrables.` };
  } catch { return { ok: false, message: 'No se pudo descifrar la copia. Revisa la contraseña o el archivo.' }; }
}

async function hashEntry(
  payload: ZipFileReader,
  entry: ZipFileEntry,
  onChunk?: (chunkBytes: number) => void,
): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const raw of await payload.stream(entry)) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    hash.update(chunk);
    bytes += chunk.byteLength;
    onChunk?.(chunk.byteLength);
  }
  if (bytes !== entry.uncompressedSize) throw new Error(`La entrada ZIP ${entry.name} tiene un tamaño incoherente.`);
  return { sha256: hash.digest('hex'), bytes };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function decryptionMessage(error: unknown): string {
  const message = errorText(error);
  return /authenticat|unsupported state|contraseña no es válida/i.test(message)
    ? 'No se pudo descifrar la copia. Revisa la contraseña o el archivo.'
    : `No se pudo verificar la copia: ${message}`;
}

/**
 * Open and fully authenticate a file-backed backup without retaining an archive,
 * ciphertext, plaintext ZIP, or vault database in memory. The returned payload
 * is temporary and must be released with `cleanup`.
 */
export async function openVerifiedBackupFile(
  archivePath: string,
  password: string,
  currentSchema: number,
  onProgress?: BackupFileProgress,
): Promise<OpenBackupFileResult> {
  if (!password.trim()) return { ok: false, message: 'Falta la contraseña para verificar la copia.' };

  let outer: ZipFileReader;
  let manifest: StreamedOuterManifest;
  try {
    outer = await ZipFileReader.open(archivePath);
    const manifestEntry = outer.entry('manifest.json');
    if (!manifestEntry || !outer.entry('backup.bin')) {
      return { ok: false, message: 'Archivo .nodus inválido: faltan manifest o datos cifrados.' };
    }
    manifest = JSON.parse((await outer.read(manifestEntry, 1024 * 1024)).toString('utf8')) as StreamedOuterManifest;
  } catch (error) {
    return { ok: false, message: `Archivo .nodus inválido o dañado: ${errorText(error)}` };
  }
  if (!manifest || typeof manifest !== 'object') return { ok: false, message: 'Archivo .nodus inválido: su manifiesto no es legible.' };
  if (manifest.format !== 'nodus.encrypted-backup' || ![1, 2, 3, 4, 5, 6].includes(manifest.formatVersion)) {
    return { ok: false, message: 'Formato de copia de seguridad no soportado.' };
  }
  if (manifest.schemaVersion > currentSchema) {
    return { ok: false, message: `El archivo usa un esquema más reciente (v${manifest.schemaVersion}) que esta versión de Nodus (v${currentSchema}). Actualiza la app.` };
  }

  const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nodus-backup-verify-'));
  const payloadPath = path.join(temporaryRoot, 'payload.zip');
  const cleanup = () => fs.promises.rm(temporaryRoot, { recursive: true, force: true });
  let credential = password;
  let recoveredKey: string | undefined;
  let usedRecoveryKey = false;
  try {
    if (manifest.formatVersion >= 6) {
      const wrappedEntry = outer.entry('recovery-key.bin');
      if (!wrappedEntry || !manifest.recovery?.wrappedKeyCipher) {
        await cleanup();
        return { ok: false, message: 'Copia inválida: falta la clave de recuperación cifrada.' };
      }
      try {
        credential = decryptBackupPayload(
          await outer.read(wrappedEntry, 1024 * 1024),
          password,
          manifest.recovery.wrappedKeyCipher,
        ).toString('utf8');
      } catch {
        credential = password;
        usedRecoveryKey = true;
      }
      recoveredKey = credential;
    }
    const encryptedEntry = outer.entry('backup.bin')!;
    onProgress?.('decrypting', 0, encryptedEntry.uncompressedSize);
    await decryptBackupPayloadStream(
      await outer.stream(encryptedEntry),
      payloadPath,
      credential,
      manifest.cipher,
      (completedBytes) => onProgress?.('decrypting', completedBytes, encryptedEntry.uncompressedSize),
    );
  } catch (error) {
    await cleanup();
    return { ok: false, message: decryptionMessage(error) };
  }

  let payload: ZipFileReader;
  let inner: StreamedInnerManifest;
  try {
    payload = await ZipFileReader.open(payloadPath);
    const innerEntry = payload.entry('payload-manifest.json');
    if (!innerEntry) {
      await cleanup();
      return { ok: false, message: 'Copia inválida: falta el manifiesto interno.' };
    }
    inner = JSON.parse((await payload.read(innerEntry, 16 * 1024 * 1024)).toString('utf8')) as StreamedInnerManifest;
  } catch (error) {
    await cleanup();
    return { ok: false, message: `Copia inválida: no se pudo leer el contenido descifrado: ${errorText(error)}` };
  }
  if (!inner || typeof inner !== 'object' || !inner.files || typeof inner.files !== 'object') {
    await cleanup();
    return { ok: false, message: 'Copia inválida: el manifiesto interno no es legible.' };
  }
  if (inner.schemaVersion > currentSchema) {
    await cleanup();
    return { ok: false, message: 'La copia usa un esquema más reciente. Actualiza la app.' };
  }
  try {
    const verificationTotal = Object.values(inner.files).reduce(
      (total, file) => total + (file && Number.isSafeInteger(file.bytes) && file.bytes >= 0 ? file.bytes : 0),
      0,
    );
    let verificationCompleted = 0;
    onProgress?.('verifying', 0, verificationTotal);
    for (const [name, expected] of Object.entries(inner.files)) {
      const entry = payload.entry(name);
      if (!entry || entry.isDirectory || !expected || typeof expected.sha256 !== 'string' || !Number.isSafeInteger(expected.bytes) || expected.bytes < 0) {
        await cleanup();
        return { ok: false, message: 'Copia inválida: los hashes internos no coinciden.' };
      }
      const actual = await hashEntry(payload, entry, (chunkBytes) => {
        verificationCompleted += chunkBytes;
        onProgress?.('verifying', verificationCompleted, verificationTotal);
      });
      if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) {
        await cleanup();
        return { ok: false, message: 'Copia inválida: los hashes internos no coinciden.' };
      }
    }
  } catch (error) {
    await cleanup();
    return { ok: false, message: `No se pudo verificar el contenido de la copia: ${errorText(error)}` };
  }
  if (manifest.formatVersion >= 4 && !inner.vaults?.length) {
    await cleanup();
    return { ok: false, message: 'La copia verificada no contiene ninguna bóveda.' };
  }
  for (const vault of inner.vaults ?? []) {
    if (!payload.entry(vault.dbFile)) {
      await cleanup();
      return { ok: false, message: `La copia verificada no contiene la bóveda «${vault.name}».` };
    }
  }
  if (inner.globalLibrary) {
    const prefix = `${inner.globalLibrary.prefix}/`;
    const count = payload.entries.filter((entry) => !entry.isDirectory && entry.name.startsWith(prefix)).length;
    if (count !== inner.globalLibrary.fileCount) {
      await cleanup();
      return { ok: false, message: 'La copia verificada no contiene todos los archivos de la Biblioteca global.' };
    }
  }
  return {
    ok: true,
    manifest,
    payloadManifest: inner,
    payload,
    includesSecrets: manifest.formatVersion < 3 || manifest.includesSecrets === true,
    recoveredKey,
    usedRecoveryKey,
    cleanup,
  };
}

/** Full, streaming authentication for the automatic-backup utility process. */
export async function verifyBackupFile(
  archivePath: string,
  password: string,
  currentSchema: number,
): Promise<{ ok: boolean; message: string }> {
  const opened = await openVerifiedBackupFile(archivePath, password, currentSchema);
  if (!opened.ok) return opened;
  try {
    return { ok: true, message: `Copia verificada: ${opened.payloadManifest.vaults?.length ?? 1} bóveda(s) descifrables.` };
  } finally {
    await opened.cleanup();
  }
}
