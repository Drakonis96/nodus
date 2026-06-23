import AdmZip from 'adm-zip';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { dialog, app } from 'electron';
import type { AiProvider, AppSettings } from '@shared/types';
import { closeDb, getDb, replaceDbFile, SCHEMA_VERSION } from '../db/database';
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
  formatVersion: 1 | 2;
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

interface EmbeddingInventory {
  records: number;
  bytes: number;
}

/** A human-auditable record of the data that must survive without reindexing. */
interface BackupInventory {
  tableRows: Record<string, number>;
  embeddings: {
    ideas: EmbeddingInventory;
    workSummaries: EmbeddingInventory;
    passages: EmbeddingInventory;
  };
  modelSettings: Pick<
    AppSettings,
    'embeddingProvider' | 'embeddingModel' | 'favorites' | 'defaultModel' | 'extractionModel' | 'synthesisModel' | 'summaryModel' | 'fusionModel'
  >;
  apiKeyProviders: AiProvider[];
}

/**
 * Export a self-contained encrypted `*.nodus` archive. The SQLite snapshot is
 * the source of truth and includes every Nodus table, including Float32 BLOB
 * embeddings, full-text passages, extraction cache and chat history.
 */
export async function exportData(): Promise<{ path: string; password: string } | null> {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Exportar biblioteca Nodus',
    defaultPath: path.join(app.getPath('documents'), `nodus-export-${Date.now()}.nodus`),
    filters: [{ name: 'Nodus', extensions: ['nodus'] }],
  });
  if (canceled || !filePath) return null;

  const settings = getSettings();
  const manifest: ExportManifestBase = {
    schemaVersion: SCHEMA_VERSION,
    appVersion: app.getVersion(),
    date: new Date().toISOString(),
    zoteroUserId: settings.zoteroUserId,
  };
  const { providerKeys: _providerKeys, ...nonSecret } = settings; // strip derived key-presence flags
  const apiKeys = readApiKeys();
  const { database, inventory } = await createDatabaseSnapshot(nonSecret, apiKeys);

  const files: Record<string, Buffer> = {
    'database.sqlite': database,
    'settings.json': Buffer.from(JSON.stringify(nonSecret, null, 2)),
    'api-keys.json': Buffer.from(JSON.stringify(apiKeys, null, 2)),
    'backup-inventory.json': Buffer.from(JSON.stringify(inventory, null, 2)),
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
    formatVersion: 2,
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
  if (manifest.format !== 'nodus.encrypted-backup' || (manifest.formatVersion !== 1 && manifest.formatVersion !== 2)) {
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

  const importedSettings = readJsonEntry<Omit<AppSettings, 'providerKeys'>>(payload, 'settings.json');
  const importedKeys = readJsonEntry<Partial<Record<AiProvider, string>>>(payload, 'api-keys.json') ?? {};
  const inventory = readJsonEntry<BackupInventory>(payload, 'backup-inventory.json');
  if (manifest.formatVersion === 2 && !inventory) {
    return { ok: false, message: 'Copia inválida: falta el inventario de datos.' };
  }
  if (inventory && !settingsMatchInventory(importedSettings, importedKeys, inventory)) {
    return { ok: false, message: 'Copia inválida: la configuración de modelos o claves no coincide con su inventario.' };
  }

  // Write the imported DB to a temp file, then swap it in (migrations run on open).
  const tmp = path.join(app.getPath('temp'), `nodus-import-${Date.now()}.sqlite`);
  fs.writeFileSync(tmp, dbEntry.getData());
  if (inventory && !databaseMatchesInventory(tmp, inventory)) {
    fs.unlinkSync(tmp);
    return { ok: false, message: 'Copia inválida: faltan datos o embeddings en la instantánea de base de datos.' };
  }
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
  restoreApiKeys(importedKeys);

  return {
    ok: true,
    message: 'Importación completa: biblioteca, texto extraído, embeddings, pasajes, modelos, grafo y claves API restaurados.',
  };
}

/** Make a transactionally consistent SQLite snapshot, including active WAL data. */
async function createDatabaseSnapshot(
  settings: Omit<AppSettings, 'providerKeys'>,
  apiKeys: Partial<Record<AiProvider, string>>
): Promise<{ database: Buffer; inventory: BackupInventory }> {
  const snapshotPath = path.join(app.getPath('temp'), `nodus-export-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  try {
    await getDb().backup(snapshotPath);
    return {
      database: fs.readFileSync(snapshotPath),
      inventory: databaseInventory(snapshotPath, settings, apiKeys),
    };
  } finally {
    if (fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath);
  }
}

function databaseInventory(
  databasePath: string,
  settings: Omit<AppSettings, 'providerKeys'>,
  apiKeys: Partial<Record<AiProvider, string>>
): BackupInventory {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const tableRows = Object.fromEntries(
      (db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as { name: string }[])
        .map(({ name }) => [name, tableRowCount(db, name)])
    );
    return {
      tableRows,
      embeddings: {
        ideas: embeddingInventory(db, 'ideas'),
        workSummaries: embeddingInventory(db, 'work_summaries'),
        passages: embeddingInventory(db, 'passages'),
      },
      modelSettings: modelSettings(settings),
      apiKeyProviders: Object.keys(apiKeys).sort() as AiProvider[],
    };
  } finally {
    db.close();
  }
}

function tableRowCount(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get() as { count: number }).count;
}

function embeddingInventory(db: Database.Database, table: string): EmbeddingInventory {
  if (!hasTable(db, table)) return { records: 0, bytes: 0 };
  const row = db
    .prepare(`SELECT COUNT(embedding) AS records, COALESCE(SUM(length(embedding)), 0) AS bytes FROM ${quoteIdentifier(table)}`)
    .get() as { records: number; bytes: number };
  return { records: Number(row.records), bytes: Number(row.bytes) };
}

function databaseMatchesInventory(databasePath: string, expected: BackupInventory): boolean {
  const actual = databaseInventory(databasePath, expected.modelSettings as Omit<AppSettings, 'providerKeys'>, {});
  for (const [table, expectedRows] of Object.entries(expected.tableRows)) {
    if (actual.tableRows[table] !== expectedRows) return false;
  }
  return (
    actual.embeddings.ideas.records === expected.embeddings.ideas.records &&
    actual.embeddings.ideas.bytes === expected.embeddings.ideas.bytes &&
    actual.embeddings.workSummaries.records === expected.embeddings.workSummaries.records &&
    actual.embeddings.workSummaries.bytes === expected.embeddings.workSummaries.bytes &&
    actual.embeddings.passages.records === expected.embeddings.passages.records &&
    actual.embeddings.passages.bytes === expected.embeddings.passages.bytes
  );
}

function settingsMatchInventory(
  settings: Omit<AppSettings, 'providerKeys'> | null,
  apiKeys: Partial<Record<AiProvider, string>>,
  expected: BackupInventory
): boolean {
  if (!settings) return false;
  return (
    JSON.stringify(modelSettings(settings)) === JSON.stringify(expected.modelSettings) &&
    JSON.stringify(Object.keys(apiKeys).sort()) === JSON.stringify(expected.apiKeyProviders)
  );
}

function modelSettings(
  settings: Pick<
    AppSettings,
    'embeddingProvider' | 'embeddingModel' | 'favorites' | 'defaultModel' | 'extractionModel' | 'synthesisModel' | 'summaryModel' | 'fusionModel'
  >
): BackupInventory['modelSettings'] {
  return {
    embeddingProvider: settings.embeddingProvider,
    embeddingModel: settings.embeddingModel,
    favorites: settings.favorites,
    defaultModel: settings.defaultModel,
    extractionModel: settings.extractionModel,
    synthesisModel: settings.synthesisModel,
    summaryModel: settings.summaryModel,
    fusionModel: settings.fusionModel,
  };
}

function hasTable(db: Database.Database, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
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
