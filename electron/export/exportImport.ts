import AdmZip from 'adm-zip';
import fs from 'node:fs';
import path from 'node:path';
import { dialog, app } from 'electron';
import type { AiProvider } from '@shared/types';
import { dbPath, closeDb, getDb, replaceDbFile, SCHEMA_VERSION } from '../db/database';
import { getSettings } from '../db/settingsRepo';
import { clearApiKey, getApiKey, setApiKey } from '../secrets/secretStore';
import {
  decryptBackupPayload,
  encryptBackupPayload,
  generateBackupPassword,
  sha256Hex,
  type BackupCipherMetadata,
} from './backupCrypto';

const AI_PROVIDERS: AiProvider[] = ['anthropic', 'openai', 'openrouter', 'deepseek', 'gemini'];

interface ExportManifestBase {
  schemaVersion: number;
  appVersion: string;
  date: string;
  zoteroUserId: string;
}

interface BackupManifest {
  format: 'nodus.encrypted-backup';
  formatVersion: 1;
  schemaVersion: number;
  appVersion: string;
  date: string;
  zoteroUserId: string;
  cipher: BackupCipherMetadata;
}

interface PayloadManifest {
  schemaVersion: number;
  appVersion: string;
  date: string;
  zoteroUserId: string;
  files: Record<string, { sha256: string; bytes: number }>;
}

/**
 * Export a self-contained encrypted `*.nodus` archive: full database, settings
 * and API keys protected by a generated password the user must keep.
 */
export async function exportData(): Promise<{ path: string; password: string } | null> {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Exportar biblioteca Nodus',
    defaultPath: path.join(app.getPath('documents'), `nodus-export-${Date.now()}.nodus`),
    filters: [{ name: 'Nodus', extensions: ['nodus'] }],
  });
  if (canceled || !filePath) return null;

  // Checkpoint WAL so the .sqlite file is complete on disk.
  getDb().pragma('wal_checkpoint(TRUNCATE)');

  const settings = getSettings();
  const manifest: ExportManifestBase = {
    schemaVersion: SCHEMA_VERSION,
    appVersion: app.getVersion(),
    date: new Date().toISOString(),
    zoteroUserId: settings.zoteroUserId,
  };
  const { providerKeys: _providerKeys, ...nonSecret } = settings; // strip derived key-presence flags

  const files: Record<string, Buffer> = {
    'database.sqlite': fs.readFileSync(dbPath()),
    'settings.json': Buffer.from(JSON.stringify(nonSecret, null, 2)),
    'api-keys.json': Buffer.from(JSON.stringify(readApiKeys(), null, 2)),
  };
  const payloadManifest: PayloadManifest = {
    ...manifest,
    files: Object.fromEntries(
      Object.entries(files).map(([name, data]) => [name, { sha256: sha256Hex(data), bytes: data.byteLength }])
    ),
  };
  files['payload-manifest.json'] = Buffer.from(JSON.stringify(payloadManifest, null, 2));

  const payloadZip = new AdmZip();
  for (const [name, data] of Object.entries(files)) payloadZip.addFile(name, data);

  const password = generateBackupPassword();
  const { ciphertext, metadata } = encryptBackupPayload(payloadZip.toBuffer(), password);
  const outerManifest: BackupManifest = {
    format: 'nodus.encrypted-backup',
    formatVersion: 1,
    ...manifest,
    cipher: metadata,
  };

  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(outerManifest, null, 2)));
  zip.addFile('backup.bin', ciphertext);
  zip.writeZip(filePath);

  return { path: filePath, password };
}

/** Import a password-protected `*.nodus` archive, validating schema compatibility and hashes. */
export async function importData(password: string): Promise<{ ok: boolean; message: string }> {
  if (!password.trim()) return { ok: false, message: 'Importación cancelada: falta la contraseña de la copia.' };
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Importar biblioteca Nodus',
    properties: ['openFile'],
    filters: [{ name: 'Nodus', extensions: ['nodus'] }],
  });
  if (canceled || filePaths.length === 0) return { ok: false, message: 'Cancelado' };

  const zip = new AdmZip(filePaths[0]);
  const manifestEntry = zip.getEntry('manifest.json');
  const encryptedEntry = zip.getEntry('backup.bin');
  if (!manifestEntry || !encryptedEntry) {
    return { ok: false, message: 'Archivo .nodus inválido: faltan manifest o datos cifrados.' };
  }

  const manifest = JSON.parse(zip.readAsText(manifestEntry)) as BackupManifest;
  if (manifest.format !== 'nodus.encrypted-backup' || manifest.formatVersion !== 1) {
    return { ok: false, message: 'Formato de copia de seguridad no soportado.' };
  }
  if (manifest.schemaVersion > SCHEMA_VERSION) {
    return {
      ok: false,
      message: `El archivo usa un esquema más reciente (v${manifest.schemaVersion}) que esta versión de Nodus (v${SCHEMA_VERSION}). Actualiza la app.`,
    };
  }

  let payload: AdmZip;
  try {
    payload = new AdmZip(decryptBackupPayload(encryptedEntry.getData(), password, manifest.cipher));
  } catch {
    return { ok: false, message: 'No se pudo descifrar la copia. Revisa la contraseña o el archivo.' };
  }

  const payloadManifest = readJsonEntry<PayloadManifest>(payload, 'payload-manifest.json');
  if (!payloadManifest) {
    return { ok: false, message: 'Copia inválida: falta el manifiesto interno.' };
  }
  if (!verifyPayloadHashes(payload, payloadManifest)) {
    return { ok: false, message: 'Copia inválida: los hashes internos no coinciden.' };
  }
  if (payloadManifest.schemaVersion > SCHEMA_VERSION) {
    return {
      ok: false,
      message: `El archivo usa un esquema más reciente (v${payloadManifest.schemaVersion}) que esta versión de Nodus (v${SCHEMA_VERSION}). Actualiza la app.`,
    };
  }

  const dbEntry = payload.getEntry('database.sqlite');
  if (!dbEntry) return { ok: false, message: 'Copia inválida: falta la base de datos.' };

  // Write the imported DB to a temp file, then swap it in (migrations run on open).
  const tmp = path.join(app.getPath('temp'), `nodus-import-${Date.now()}.sqlite`);
  fs.writeFileSync(tmp, dbEntry.getData());
  closeDb();
  replaceDbFile(tmp);
  fs.unlinkSync(tmp);

  // Restore settings and API keys to match the backed-up machine.
  const settingsEntry = payload.getEntry('settings.json');
  if (settingsEntry) {
    const imported = JSON.parse(payload.readAsText(settingsEntry));
    getDb()
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run('app', JSON.stringify(imported));
  }
  restoreApiKeys(readJsonEntry<Partial<Record<AiProvider, string>>>(payload, 'api-keys.json') ?? {});

  return {
    ok: true,
    message: 'Importación completa: biblioteca, ajustes, modelos, grafo y claves API restaurados.',
  };
}

function readApiKeys(): Partial<Record<AiProvider, string>> {
  return Object.fromEntries(
    AI_PROVIDERS.flatMap((provider) => {
      const key = getApiKey(provider);
      return key ? [[provider, key]] : [];
    })
  ) as Partial<Record<AiProvider, string>>;
}

function restoreApiKeys(keys: Partial<Record<AiProvider, string>>): void {
  for (const provider of AI_PROVIDERS) {
    clearApiKey(provider);
    const key = keys[provider];
    if (key) setApiKey(provider, key);
  }
}

function readJsonEntry<T>(zip: AdmZip, name: string): T | null {
  const entry = zip.getEntry(name);
  if (!entry) return null;
  return JSON.parse(zip.readAsText(entry)) as T;
}

function verifyPayloadHashes(zip: AdmZip, manifest: PayloadManifest): boolean {
  for (const [name, expected] of Object.entries(manifest.files)) {
    const entry = zip.getEntry(name);
    if (!entry) return false;
    const data = entry.getData();
    if (data.byteLength !== expected.bytes) return false;
    if (sha256Hex(data) !== expected.sha256) return false;
  }
  return true;
}
