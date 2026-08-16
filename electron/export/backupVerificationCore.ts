import AdmZip from 'adm-zip';
import { decryptBackupPayload, sha256Hex, type BackupCipherMetadata } from './backupCrypto';

interface OuterManifest { format: string; formatVersion: number; schemaVersion: number; cipher: BackupCipherMetadata; recovery?: { wrappedKeyCipher: BackupCipherMetadata } }
interface InnerManifest { schemaVersion: number; files: Record<string, { sha256: string; bytes: number }>; vaults?: Array<{ name: string; dbFile: string }>; globalLibrary?: { prefix: string; fileCount: number } }

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
