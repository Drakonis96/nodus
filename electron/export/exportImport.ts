import AdmZip from 'adm-zip';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { dialog, app } from 'electron';
import type { AiProvider, AppSettings } from '@shared/types';
import { AI_PROVIDERS } from '@shared/providers';
import { closeDb, getDb, replaceDbFile, SCHEMA_VERSION } from '../db/database';
import { getSettings } from '../db/settingsRepo';
import { listVaults, getActiveVault, restoreVaultDatabase, setActiveVault } from '../vaults/vaultRegistry';
import type { VaultType } from '@shared/types';
import { clearApiKey, getApiKey, setApiKey } from '../secrets/secretStore';
import {
  decryptBackupPayload,
  encryptBackupPayload,
  generateBackupPassword,
  sha256Hex,
  type BackupCipherMetadata,
} from './backupCrypto';

interface ExportManifestBase {
  schemaVersion: number;
  appVersion: string;
  date: string;
  zoteroUserId: string;
}

/** One vault inside a v4 (multi-vault) backup. */
interface BackupVaultEntry {
  id: string;
  name: string;
  type: VaultType;
  legacy: boolean;
  /** Path of the vault's DB inside the payload zip, e.g. 'vaults/<id>/database.sqlite'. */
  dbFile: string;
  /** Path of the vault's inventory inside the payload zip. */
  inventoryFile: string;
}

interface BackupManifest {
  format: 'nodus.encrypted-backup';
  // v3 = secret-free single-vault backup. v4 = multi-vault (every vault of every
  // type). `includesSecrets` distinguishes a manual export (keys inside) from an
  // automatic one. Older app versions reject newer formats cleanly.
  formatVersion: 1 | 2 | 3 | 4;
  schemaVersion: number;
  appVersion: string;
  date: string;
  zoteroUserId: string;
  cipher: BackupCipherMetadata;
  includesSecrets?: boolean;
  /** v4 only: number of vaults in the archive (for a quick UI summary). */
  vaultCount?: number;
}

interface PayloadManifest {
  schemaVersion: number;
  appVersion: string;
  date: string;
  zoteroUserId: string;
  files: Record<string, { sha256: string; bytes: number }>;
  /** v4 only: the vaults included and which one was active. */
  activeVaultId?: string;
  vaults?: BackupVaultEntry[];
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
    | 'embeddingProvider' | 'embeddingModel' | 'favorites' | 'defaultModel'
    | 'extractionModel' | 'synthesisModel' | 'summaryModel' | 'fusionModel'
    | 'chatModel' | 'deepResearchModel' | 'immersionModel' | 'writingModel'
    | 'argumentMapModel' | 'authorModel' | 'studyModel' | 'tutorModel' | 'hypothesisModel'
    | 'imageProvider' | 'imageModel' | 'imageStyle'
  >;
  apiKeyProviders: AiProvider[];
}

/** Local MCP access credentials must never leave the machine in a backup. */
type BackupSettings = Omit<AppSettings, 'providerKeys' | 'mcpToken'>;

/**
 * Export a self-contained encrypted `*.nodus` archive. The SQLite snapshot is
 * the source of truth and includes every Nodus table, including Float32 BLOB
 * embeddings, full-text passages, extraction cache and chat history.
 */
/**
 * Build the complete encrypted `.nodus` archive in memory. Shared by the manual
 * export (dialog + generated password + secrets) and the automatic scheduled
 * backup (master password, secrets EXCLUDED). Dialog-free so it can run
 * headless and be exercised by tests.
 */
export async function createBackupArchive(options: {
  password: string;
  includeSecrets: boolean;
  appVersion: string;
}): Promise<Buffer> {
  const settings = getSettings();
  const manifest: ExportManifestBase = {
    schemaVersion: SCHEMA_VERSION,
    appVersion: options.appVersion,
    date: new Date().toISOString(),
    zoteroUserId: settings.zoteroUserId,
  };
  const apiKeys = options.includeSecrets ? readApiKeys() : {};

  // Snapshot EVERY vault (all types), not just the active one, so the archive is an
  // integral copy of the whole app. Each vault's DB carries its own settings row,
  // which is scrubbed of the MCP token/listener in the snapshot.
  const vaults = listVaults();
  const activeVaultId = getActiveVault().id;
  const files: Record<string, Buffer> = {};
  const vaultEntries: BackupVaultEntry[] = [];
  for (const vault of vaults) {
    const dbFile = `vaults/${vault.id}/database.sqlite`;
    const inventoryFile = `vaults/${vault.id}/inventory.json`;
    const { database, inventory } = await snapshotVaultDatabase(vault.path, vault.id === activeVaultId, apiKeys);
    files[dbFile] = database;
    files[inventoryFile] = Buffer.from(JSON.stringify(inventory, null, 2));
    vaultEntries.push({ id: vault.id, name: vault.name, type: vault.type, legacy: vault.legacy, dbFile, inventoryFile });
  }
  files['registry.json'] = Buffer.from(JSON.stringify({ activeVaultId, vaults: vaultEntries }, null, 2));
  if (options.includeSecrets) {
    files['api-keys.json'] = Buffer.from(JSON.stringify(apiKeys, null, 2));
  }

  const payloadManifest: PayloadManifest = {
    ...manifest,
    activeVaultId,
    vaults: vaultEntries,
    files: Object.fromEntries(
      Object.entries(files).map(([name, data]) => [name, { sha256: sha256Hex(data), bytes: data.byteLength }])
    ),
  };
  files['payload-manifest.json'] = Buffer.from(JSON.stringify(payloadManifest, null, 2));

  const payloadZip = new AdmZip();
  for (const [name, data] of Object.entries(files)) payloadZip.addFile(name, data);

  const { ciphertext, metadata } = encryptBackupPayload(payloadZip.toBuffer(), options.password);
  const outerManifest: BackupManifest = {
    format: 'nodus.encrypted-backup',
    formatVersion: 4,
    ...manifest,
    cipher: metadata,
    includesSecrets: options.includeSecrets,
    vaultCount: vaultEntries.length,
  };

  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(outerManifest, null, 2)));
  zip.addFile('backup.bin', ciphertext);
  return zip.toBuffer();
}

export async function exportData(): Promise<{ path: string; password: string } | null> {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Exportar biblioteca Nodus',
    defaultPath: path.join(app.getPath('documents'), `nodus-export-${Date.now()}.nodus`),
    filters: [{ name: 'Nodus', extensions: ['nodus'] }],
  });
  if (canceled || !filePath) return null;

  const password = generateBackupPassword();
  const archive = await createBackupArchive({ password, includeSecrets: true, appVersion: app.getVersion() });
  fs.writeFileSync(filePath, archive);
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
  return restoreBackupArchive(fs.readFileSync(filePaths[0]), password);
}

/** Restore a `.nodus` archive buffer (dialog-free, so it is unit-testable). */
export function restoreBackupArchive(archive: Buffer, password: string): { ok: boolean; message: string } {
  if (!password.trim()) return { ok: false, message: 'Importación cancelada: falta la contraseña de la copia.' };
  const zip = new AdmZip(archive);
  const manifestEntry = zip.getEntry('manifest.json');
  const encryptedEntry = zip.getEntry('backup.bin');
  if (!manifestEntry || !encryptedEntry) {
    return { ok: false, message: 'Archivo .nodus inválido: faltan manifest o datos cifrados.' };
  }

  const manifest = JSON.parse(zip.readAsText(manifestEntry)) as BackupManifest;
  const supportedVersions = [1, 2, 3, 4];
  if (manifest.format !== 'nodus.encrypted-backup' || !supportedVersions.includes(manifest.formatVersion)) {
    return { ok: false, message: 'Formato de copia de seguridad no soportado.' };
  }
  // v3 backups (automatic) carry no secrets: keys/tokens on this machine are preserved.
  const includesSecrets = manifest.formatVersion < 3 || manifest.includesSecrets === true;
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

  const importedKeys = readJsonEntry<Partial<Record<AiProvider, string>>>(payload, 'api-keys.json') ?? {};

  // v4 = multi-vault archive: restore every vault (all types), keyed by its id.
  if (manifest.formatVersion >= 4) {
    const result = restoreAllVaults(payload, payloadManifest);
    if (!result.ok) return result;
    if (includesSecrets) restoreApiKeys(importedKeys);
    return {
      ok: true,
      message: includesSecrets
        ? `Importación completa: ${result.restored} bóveda(s) con su biblioteca, embeddings, grafo y claves API restauradas.`
        : `Importación completa: ${result.restored} bóveda(s) restauradas (biblioteca, embeddings y grafo). Las claves API locales se han conservado (la copia automática no las incluye).`,
    };
  }

  // v1–v3 = single (active-vault) archive.
  const dbEntry = payload.getEntry('database.sqlite');
  if (!dbEntry) return { ok: false, message: 'Copia inválida: falta la base de datos.' };

  const importedSettings = readJsonEntry<BackupSettings>(payload, 'settings.json');
  const inventory = readJsonEntry<BackupInventory>(payload, 'backup-inventory.json');
  if (manifest.formatVersion >= 2 && !inventory) {
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
    // Backups created before MCP support may not have these fields; backups from
    // any version must never restore a listener or a bearer credential.
    const restoredSettings = { ...imported, mcpEnabled: false, mcpToken: '' };
    getDb()
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run('app', JSON.stringify(restoredSettings));
  }
  // Secret-free (automatic) backups leave this machine's keys untouched.
  if (includesSecrets) restoreApiKeys(importedKeys);

  return {
    ok: true,
    message: includesSecrets
      ? 'Importación completa: biblioteca, texto extraído, embeddings, pasajes, modelos, grafo y claves API restaurados.'
      : 'Importación completa: biblioteca, texto extraído, embeddings, pasajes, modelos y grafo restaurados. Las claves API locales se han conservado (la copia automática no las incluye).',
  };
}

/**
 * Restore every vault in a v4 archive, keyed by its original id (merge-safe: local
 * vaults NOT present in the backup are left untouched, never deleted). The live DB is
 * closed first so the active vault's file can be replaced, then reopened on the
 * restored active vault (running any pending migrations).
 */
function restoreAllVaults(
  payload: AdmZip,
  payloadManifest: PayloadManifest
): { ok: true; restored: number } | { ok: false; message: string } {
  const vaults = payloadManifest.vaults;
  if (!vaults || vaults.length === 0) return { ok: false, message: 'Copia inválida: el archivo no contiene bóvedas.' };

  // Validate everything (entries + inventories) into temp files BEFORE touching any
  // live data, so a corrupt archive can't leave a half-restored library.
  const staged: { entry: BackupVaultEntry; tmp: string }[] = [];
  const cleanup = () => staged.forEach((s) => fs.existsSync(s.tmp) && fs.unlinkSync(s.tmp));
  try {
    for (const ve of vaults) {
      const dbEntry = payload.getEntry(ve.dbFile);
      if (!dbEntry) {
        cleanup();
        return { ok: false, message: `Copia inválida: falta la base de datos de la bóveda «${ve.name}».` };
      }
      const tmp = path.join(app.getPath('temp'), `nodus-import-${ve.id}-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
      fs.writeFileSync(tmp, dbEntry.getData());
      const inv = ve.inventoryFile ? readJsonEntry<BackupInventory>(payload, ve.inventoryFile) : null;
      if (inv && !databaseMatchesInventory(tmp, inv)) {
        fs.unlinkSync(tmp);
        cleanup();
        return { ok: false, message: `Copia inválida: faltan datos en la bóveda «${ve.name}».` };
      }
      staged.push({ entry: ve, tmp });
    }

    // All validated — swap the live DB out and restore each vault to its path.
    closeDb();
    for (const { entry, tmp } of staged) {
      restoreVaultDatabase({ id: entry.id, name: entry.name, type: entry.type, legacy: entry.legacy }, tmp);
    }
    const activeId = payloadManifest.activeVaultId ?? vaults[0].id;
    try {
      setActiveVault(activeId);
    } catch {
      /* the backup's active vault might be absent; keep the current one */
    }
    getDb(); // reopen (+ migrate) the active vault
    return { ok: true, restored: staged.length };
  } finally {
    cleanup();
  }
}

/** Strip the MCP token/listener and any stray secrets from a settings object. */
function scrubSettings(raw: unknown): BackupSettings {
  const obj = (raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>) } : {}) as Record<string, unknown>;
  delete obj.mcpToken;
  delete obj.providerKeys;
  obj.mcpEnabled = false;
  return obj as unknown as BackupSettings;
}

/**
 * Transactionally consistent snapshot of ONE vault's database (including live WAL for
 * the active vault), with the `app` settings row scrubbed of secrets. Works for the
 * active vault (via the live connection) and any other vault (opened from its file).
 */
async function snapshotVaultDatabase(
  vaultDbPath: string,
  isActive: boolean,
  apiKeys: Partial<Record<AiProvider, string>>
): Promise<{ database: Buffer; inventory: BackupInventory }> {
  const snapshotPath = path.join(app.getPath('temp'), `nodus-export-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  try {
    if (isActive) {
      await getDb().backup(snapshotPath);
    } else {
      const src = new Database(vaultDbPath, { fileMustExist: true });
      try {
        await src.backup(snapshotPath);
      } finally {
        src.close();
      }
    }
    // Scrub the snapshot's settings row so the bearer token never leaves the machine.
    const snapshotDb = new Database(snapshotPath);
    let scrubbed: BackupSettings;
    try {
      const row = snapshotDb.prepare("SELECT value FROM settings WHERE key = 'app'").get() as { value: string } | undefined;
      scrubbed = scrubSettings(row ? safeParse(row.value) : {});
      snapshotDb
        .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run('app', JSON.stringify(scrubbed));
    } finally {
      snapshotDb.close();
    }
    return {
      database: fs.readFileSync(snapshotPath),
      inventory: databaseInventory(snapshotPath, scrubbed, apiKeys),
    };
  } finally {
    if (fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath);
  }
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

function databaseInventory(
  databasePath: string,
  settings: BackupSettings,
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
  settings: BackupSettings | null,
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
    | 'embeddingProvider' | 'embeddingModel' | 'favorites' | 'defaultModel'
    | 'extractionModel' | 'synthesisModel' | 'summaryModel' | 'fusionModel'
    | 'chatModel' | 'deepResearchModel' | 'immersionModel' | 'writingModel'
    | 'argumentMapModel' | 'authorModel' | 'studyModel' | 'tutorModel' | 'hypothesisModel'
    | 'imageProvider' | 'imageModel' | 'imageStyle'
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
    chatModel: settings.chatModel,
    deepResearchModel: settings.deepResearchModel,
    immersionModel: settings.immersionModel,
    writingModel: settings.writingModel,
    argumentMapModel: settings.argumentMapModel,
    authorModel: settings.authorModel,
    studyModel: settings.studyModel,
    tutorModel: settings.tutorModel,
    hypothesisModel: settings.hypothesisModel,
    imageProvider: settings.imageProvider,
    imageModel: settings.imageModel,
    imageStyle: settings.imageStyle,
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
