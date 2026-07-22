import AdmZip from 'adm-zip';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { dialog, app } from 'electron';
import { showImportOpenDialog } from '../privacy';
import type { AiProvider, AppSettings, BackupSelection } from '@shared/types';
import { SECRET_PROVIDERS } from '@shared/providers';
import { closeDb, getDb, replaceDbFile, SCHEMA_VERSION } from '../db/database';
import { getSettings } from '../db/settingsRepo';
import { listVaults, getActiveVault, restoreVaultDatabase, setActiveVault } from '../vaults/vaultRegistry';
import type { VaultType } from '@shared/types';
import { getApiKey, getAudioKey, getBackupPassword, setApiKey, setAudioKey } from '../secrets/secretStore';
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
  // type). v5 adds granular auxiliary state. v6 encrypts the payload with an
  // independent recovery key and wraps that key with the master password.
  // `includesSecrets` distinguishes a manual export (keys inside) from an automatic
  // one. Older app versions reject newer formats cleanly.
  formatVersion: 1 | 2 | 3 | 4 | 5 | 6;
  schemaVersion: number;
  appVersion: string;
  date: string;
  zoteroUserId: string;
  cipher: BackupCipherMetadata;
  includesSecrets?: boolean;
  /** v4 only: number of vaults in the archive (for a quick UI summary). */
  vaultCount?: number;
  /** v6: the stable recovery key is wrapped by the user's password. */
  recovery?: { wrappedKeyCipher: BackupCipherMetadata };
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
  /** v5 only: user-selected scope. Omitted means the historical all-data scope. */
  selection?: BackupSelection;
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
    | 'embeddingProvider' | 'embeddingModel' | 'favorites' | 'codexReasoningEfforts' | 'defaultModel' | 'modelSettingsMode' | 'modelSettingsVersion'
    | 'extractionModel' | 'synthesisModel' | 'summaryModel' | 'fusionModel'
    | 'chatModel' | 'nodiModel' | 'deepResearchModel' | 'immersionModel' | 'writingModel'
    | 'argumentMapModel' | 'authorModel' | 'studyModel' | 'tutorModel' | 'hypothesisModel'
    | 'improveModel' | 'questionGenModel' | 'gradingModel' | 'flashcardModel' | 'transcriptionModel' | 'sttProvider'
    | 'sttTransformersModel' | 'sttWhisperCppModel' | 'sttWhisperCppExecutable'
    | 'imageProvider' | 'imageModel' | 'imageQuality' | 'imageStyle' | 'audioProvider' | 'audioVoice' | 'audioSpeed'
  >;
  apiKeyProviders: AiProvider[];
}

const GLOBAL_AUXILIARY_FILES = ['app-prefs.json', 'nodi-chat-history.json', 'nodi-notes.json', 'nodi-notifications.json', 'nodi-welcome.seed'] as const;
const VAULT_HISTORY_FILES = ['study-chat-history.json', 'study-search-index.json'] as const;
const VAULT_MEDIA_FILES = ['study-audio-meta.json'] as const;
/** Cloud TTS keys live outside the AI-provider store, encrypted per vault. The blobs
 *  are safeStorage-bound and useless elsewhere, so the archive carries the plaintext
 *  alongside `api-keys.json` and re-encrypts it on the destination machine. */
const AUDIO_KEY_NAMES = ['hume'] as const;
/**
 * Settings that describe THIS computer, not the library. They live in the vault's
 * settings row, so a restore would otherwise import another machine's absolute paths
 * and silently break every local file lookup (a stale Zotero root is worse than an
 * empty one, which at least falls back to probing the default locations).
 */
const MACHINE_LOCAL_SETTING_KEYS = ['zoteroStoragePath', 'toolkitOutputDir'] as const;
const RECOVERY_PREF_KEYS = [
  'recoverySetupVersion',
  'backupVaultIds',
  'backupIncludePreferences',
  'backupIncludeHistories',
  'backupIncludeGeneratedMedia',
  'backupIncludeApiKeys',
  'autoBackupEnabled',
  'autoBackupFolder',
  'autoBackupIntervalHours',
  'autoBackupDays',
  'autoBackupHour',
  'autoBackupMinute',
  'lastAutoBackupAt',
  'lastAutoBackupStatus',
] as const;

/** Local MCP access credentials must never leave the machine in a backup. */
type BackupSettings = Omit<AppSettings, 'providerKeys' | 'mcpToken'>;

function fullBackupSelection(): BackupSelection {
  return {
    vaultIds: [],
    includePreferences: true,
    includeHistories: true,
    includeGeneratedMedia: true,
    includeApiKeys: true,
  };
}

function normalizeBackupSelection(input: Partial<BackupSelection> | undefined, includeSecrets: boolean): BackupSelection {
  return {
    vaultIds: Array.isArray(input?.vaultIds) ? [...new Set(input.vaultIds.filter((id): id is string => typeof id === 'string' && id.length > 0))] : [],
    includePreferences: input?.includePreferences !== false,
    includeHistories: input?.includeHistories !== false,
    includeGeneratedMedia: input?.includeGeneratedMedia !== false,
    includeApiKeys: includeSecrets && input?.includeApiKeys !== false,
  };
}

function addFileIfPresent(files: Record<string, Buffer>, archiveName: string, sourcePath: string): void {
  try {
    if (fs.statSync(sourcePath).isFile()) files[archiveName] = fs.readFileSync(sourcePath);
  } catch {
    /* Optional auxiliary state may not have been created yet. */
  }
}

function addDirectoryIfPresent(files: Record<string, Buffer>, archivePrefix: string, sourceDir: string): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const source = path.join(sourceDir, entry.name);
    const target = `${archivePrefix}/${entry.name}`;
    if (entry.isDirectory()) addDirectoryIfPresent(files, target, source);
    else if (entry.isFile()) addFileIfPresent(files, target, source);
  }
}

function addAuxiliaryFiles(
  files: Record<string, Buffer>,
  vaults: ReturnType<typeof listVaults>,
  selection: BackupSelection
): void {
  if (selection.includePreferences) {
    for (const name of GLOBAL_AUXILIARY_FILES) {
      addFileIfPresent(files, `aux/global/${name}`, path.join(app.getPath('userData'), name));
    }
  }
  for (const vault of vaults) {
    const dir = path.dirname(vault.path);
    if (selection.includeHistories) {
      for (const name of VAULT_HISTORY_FILES) addFileIfPresent(files, `aux/vaults/${vault.id}/${name}`, path.join(dir, name));
    }
    if (selection.includeGeneratedMedia) {
      for (const name of VAULT_MEDIA_FILES) addFileIfPresent(files, `aux/vaults/${vault.id}/${name}`, path.join(dir, name));
      addDirectoryIfPresent(files, `aux/vaults/${vault.id}/audio`, path.join(dir, 'audio'));
    }
  }
}

/**
 * Export a self-contained encrypted `*.nodus` archive. The SQLite snapshot is
 * the source of truth and includes every Nodus table, including Float32 BLOB
 * embeddings, full-text passages, extraction cache and chat history.
 */
/**
 * Build the complete encrypted `.nodus` archive in memory. Shared by the manual
 * export (dialog + generated password + secrets) and the automatic scheduled
 * backup (master password, all data included). Dialog-free so it can run
 * headless and be exercised by tests.
 */
export async function createBackupArchive(options: {
  password: string;
  appVersion: string;
  /** Independent credential used by automatic recovery snapshots (v6). */
  recoveryKey?: string;
}): Promise<Buffer> {
  const settings = getSettings();
  // Full-state backup is a safety invariant, not a renderer preference. Legacy
  // granular settings and unexpected extra options can never reduce this scope.
  const selection = fullBackupSelection();
  const manifest: ExportManifestBase = {
    schemaVersion: SCHEMA_VERSION,
    appVersion: options.appVersion,
    date: new Date().toISOString(),
    zoteroUserId: settings.zoteroUserId,
  };
  // A credential the OS keychain can no longer decrypt must NOT cost the user their
  // library snapshot: restoreApiKeys is merge-only, so omitting one key never erases
  // anything on the destination, whereas refusing to run means no backup at all — for
  // months, since the failure is invisible until someone opens Settings. The caller
  // surfaces `lockedApiKeyProviders()` as a warning beside the successful result.
  const includesSecrets = true;
  const apiKeys = readApiKeys();
  const audioKeys = readAudioKeys();

  // Snapshot EVERY vault (all types), not just the active one, so the archive is an
  // integral copy of the whole app. Each vault's DB carries its own settings row,
  // which is scrubbed of the MCP token/listener in the snapshot.
  const vaults = listVaults();
  if (vaults.length === 0) throw new Error('Nodus no contiene ninguna bóveda válida para proteger.');
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
  addAuxiliaryFiles(files, vaults, selection);
  if (includesSecrets) {
    files['api-keys.json'] = Buffer.from(JSON.stringify(apiKeys, null, 2));
    if (Object.keys(audioKeys).length > 0) {
      files['audio-keys.json'] = Buffer.from(JSON.stringify(audioKeys, null, 2));
    }
  }

  const payloadManifest: PayloadManifest = {
    ...manifest,
    activeVaultId,
    vaults: vaultEntries,
    selection,
    files: Object.fromEntries(
      Object.entries(files).map(([name, data]) => [name, { sha256: sha256Hex(data), bytes: data.byteLength }])
    ),
  };
  files['payload-manifest.json'] = Buffer.from(JSON.stringify(payloadManifest, null, 2));

  const payloadZip = new AdmZip();
  for (const [name, data] of Object.entries(files)) payloadZip.addFile(name, data);

  const recoveryKey = options.recoveryKey?.trim() || '';
  const payloadCredential = recoveryKey || options.password;
  const { ciphertext, metadata } = encryptBackupPayload(payloadZip.toBuffer(), payloadCredential);
  const wrappedRecovery = recoveryKey
    ? encryptBackupPayload(Buffer.from(recoveryKey, 'utf8'), options.password)
    : null;
  const outerManifest: BackupManifest = {
    format: 'nodus.encrypted-backup',
    formatVersion: recoveryKey ? 6 : 5,
    ...manifest,
    cipher: metadata,
    includesSecrets,
    vaultCount: vaultEntries.length,
    recovery: wrappedRecovery ? { wrappedKeyCipher: wrappedRecovery.metadata } : undefined,
  };

  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(outerManifest, null, 2)));
  zip.addFile('backup.bin', ciphertext);
  if (wrappedRecovery) zip.addFile('recovery-key.bin', wrappedRecovery.ciphertext);
  return zip.toBuffer();
}

export async function exportData(): Promise<{ path: string; password: string; recoveryKey: string } | null> {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Exportar biblioteca Nodus',
    defaultPath: path.join(app.getPath('documents'), `nodus-export-${Date.now()}.nodus`),
    filters: [{ name: 'Nodus', extensions: ['nodus'] }],
  });
  if (canceled || !filePath) return null;

  const password = generateBackupPassword();
  const recoveryKey = generateBackupPassword();
  const archive = await createBackupArchive({
    password,
    appVersion: app.getVersion(),
    recoveryKey,
  });
  fs.writeFileSync(filePath, archive);
  return { path: filePath, password, recoveryKey };
}

/** Import a password-protected `*.nodus` archive, validating schema compatibility and hashes. */
export async function importData(password: string): Promise<{ ok: boolean; message: string }> {
  if (!password.trim()) return { ok: false, message: 'Importación cancelada: falta la contraseña de la copia.' };
  const { canceled, filePaths } = await showImportOpenDialog({
    title: 'Importar biblioteca Nodus',
    properties: ['openFile'],
    filters: [{ name: 'Nodus', extensions: ['nodus'] }],
  });
  if (canceled || filePaths.length === 0) return { ok: false, message: 'Cancelado' };
  return restoreBackupArchiveSafely(fs.readFileSync(filePaths[0]), password, app.getVersion());
}

/**
 * Restore with a complete local safety snapshot taken first. If an I/O failure
 * happens after validation but during the multi-file swap, Nodus immediately
 * rolls the original state back. The safety archive is deliberately retained
 * after success as an additional escape hatch and is encrypted with the existing
 * backup master password (or the import password on a fresh device).
 */
export async function restoreBackupArchiveSafely(
  archive: Buffer,
  password: string,
  appVersion: string
): Promise<BackupRestoreResult> {
  if (!password.trim()) return { ok: false, message: 'Importación cancelada: falta la contraseña de la copia.' };
  const safetyPassword = getBackupPassword() || password;
  let safetyPath = '';
  try {
    const safetyArchive = await createBackupArchive({
      password: safetyPassword,
      appVersion,
    });
    const safetyDir = path.join(app.getPath('userData'), 'restore-safety');
    safetyPath = path.join(safetyDir, `pre-restore-${Date.now()}.nodus`);
    writeAtomicFile(safetyPath, safetyArchive);

    const result = restoreBackupArchive(archive, password);
    if (!result.ok) {
      fs.rmSync(safetyPath, { force: true });
      return result;
    }
    return {
      ...result,
      message: `${result.message} Se ha conservado una copia de seguridad previa en ${safetyPath}.`,
      safetyBackupPath: safetyPath,
    };
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error);
    if (!safetyPath || !fs.existsSync(safetyPath)) {
      return { ok: false, message: `La restauración se canceló antes de modificar los datos: ${failure}` };
    }
    try {
      const rollback = restoreBackupArchive(fs.readFileSync(safetyPath), safetyPassword);
      if (!rollback.ok) throw new Error(rollback.message);
      return {
        ok: false,
        message: `La restauración falló (${failure}), pero Nodus recuperó automáticamente el estado anterior. Copia de seguridad: ${safetyPath}`,
        safetyBackupPath: safetyPath,
      };
    } catch (rollbackError) {
      return {
        ok: false,
        message: `La restauración falló (${failure}) y no se pudo completar la reversión automática (${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}). No borres la copia de emergencia: ${safetyPath}`,
        safetyBackupPath: safetyPath,
      };
    }
  }
}

/** Restore a `.nodus` archive buffer (dialog-free, so it is unit-testable). */
export interface BackupRestoreResult {
  ok: boolean;
  message: string;
  safetyBackupPath?: string;
  /** Internal hand-off used to persist the independent key on a restored device. */
  recoveryKey?: string;
  usedRecoveryKey?: boolean;
}

interface OpenedBackup {
  manifest: BackupManifest;
  payload: AdmZip;
  payloadManifest: PayloadManifest;
  includesSecrets: boolean;
  recoveredKey?: string;
  usedRecoveryKey: boolean;
}

/**
 * Decrypt and fully authenticate an archive without touching any live data: format,
 * schema compatibility, GCM tag, payload hashes and the internal manifest. Restore and
 * post-write verification share this so a "verified" snapshot means exactly what a
 * restore would accept — no second, weaker implementation that could drift.
 */
function openBackupArchive(archive: Buffer, password: string): OpenedBackup | { ok: false; message: string } {
  // A truncated or non-zip file makes AdmZip throw, and a damaged manifest makes
  // JSON.parse throw. Both are ordinary states for a half-synced cloud file, so they
  // must come back as a refusal the caller can report — never as an exception that
  // unwinds into the restore's rollback path.
  let zip: AdmZip;
  let manifest: BackupManifest;
  let encryptedEntry: AdmZip.IZipEntry;
  try {
    zip = new AdmZip(archive);
    const manifestEntry = zip.getEntry('manifest.json');
    const encrypted = zip.getEntry('backup.bin');
    if (!manifestEntry || !encrypted) {
      return { ok: false, message: 'Archivo .nodus inválido: faltan manifest o datos cifrados.' };
    }
    encryptedEntry = encrypted;
    manifest = JSON.parse(zip.readAsText(manifestEntry)) as BackupManifest;
  } catch {
    return { ok: false, message: 'Archivo .nodus inválido o dañado: no se pudo leer su estructura.' };
  }
  if (!manifest || typeof manifest !== 'object') {
    return { ok: false, message: 'Archivo .nodus inválido: su manifiesto no es legible.' };
  }
  const supportedVersions = [1, 2, 3, 4, 5, 6];
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
  let recoveredKey: string | undefined;
  let usedRecoveryKey = false;
  try {
    let payloadCredential = password;
    if (manifest.formatVersion >= 6) {
      const wrappedEntry = zip.getEntry('recovery-key.bin');
      if (!manifest.recovery?.wrappedKeyCipher || !wrappedEntry) {
        return { ok: false, message: 'Copia inválida: falta la clave de recuperación cifrada.' };
      }
      try {
        payloadCredential = decryptBackupPayload(wrappedEntry.getData(), password, manifest.recovery.wrappedKeyCipher).toString('utf8');
      } catch {
        // If password unwrapping fails, the supplied credential may itself be the
        // independent recovery key. Payload authentication decides definitively.
        payloadCredential = password;
        usedRecoveryKey = true;
      }
      recoveredKey = payloadCredential;
    }
    payload = new AdmZip(decryptBackupPayload(encryptedEntry.getData(), payloadCredential, manifest.cipher));
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
  return { manifest, payload, payloadManifest, includesSecrets, recoveredKey, usedRecoveryKey };
}

/**
 * Prove a freshly written snapshot can actually be opened with the credential the user
 * holds. Writing a file is not the same as having a backup: a rotated or unreadable
 * master password produces archives nobody can decrypt, and pruning would then delete
 * the last recoverable copies. Called before retention runs.
 */
export function verifyBackupArchive(archive: Buffer, password: string): { ok: boolean; message: string } {
  if (!password.trim()) return { ok: false, message: 'Falta la contraseña para verificar la copia.' };
  const opened = openBackupArchive(archive, password);
  if ('ok' in opened) return opened;
  if (!opened.payloadManifest.vaults || opened.payloadManifest.vaults.length === 0) {
    return { ok: false, message: 'La copia verificada no contiene ninguna bóveda.' };
  }
  // Every vault's database must be present and open as a valid SQLite file: the hash
  // check proves the bytes survived, this proves they are still a database.
  for (const vault of opened.payloadManifest.vaults) {
    const entry = opened.payload.getEntry(vault.dbFile);
    if (!entry) return { ok: false, message: `La copia verificada no contiene la bóveda «${vault.name}».` };
  }
  return { ok: true, message: `Copia verificada: ${opened.payloadManifest.vaults.length} bóveda(s) descifrables.` };
}

export function restoreBackupArchive(archive: Buffer, password: string): BackupRestoreResult {
  if (!password.trim()) return { ok: false, message: 'Importación cancelada: falta la contraseña de la copia.' };
  const opened = openBackupArchive(archive, password);
  if ('ok' in opened) return opened;
  const { manifest, payload, payloadManifest, includesSecrets, recoveredKey, usedRecoveryKey } = opened;

  const importedKeys = readJsonEntry<Partial<Record<AiProvider, string>>>(payload, 'api-keys.json') ?? {};
  const importedAudioKeys = readJsonEntry<Record<string, string>>(payload, 'audio-keys.json') ?? {};

  // v4 = multi-vault archive: restore every vault (all types), keyed by its id.
  if (manifest.formatVersion >= 4) {
    const result = restoreAllVaults(payload, payloadManifest);
    if (!result.ok) return result;
    if (manifest.formatVersion >= 5) restoreAuxiliaryFiles(payload, payloadManifest);
    if (includesSecrets) {
      restoreApiKeys(importedKeys);
      restoreAudioKeys(importedAudioKeys);
    }
    return {
      ok: true,
      message: includesSecrets
        ? `Importación completa: ${result.restored} bóveda(s) con su biblioteca, embeddings, grafo y claves API restauradas.`
        : `Importación completa: ${result.restored} bóveda(s) restauradas (biblioteca, embeddings y grafo). Las claves API locales se han conservado (la copia automática no las incluye).`,
      recoveryKey: recoveredKey,
      usedRecoveryKey,
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
  // Captured before the swap: these describe this computer, not the archived library.
  const localPaths = captureMachineLocalSettings().get(getActiveVault().id) ?? null;
  closeDb();
  replaceDbFile(tmp);
  fs.unlinkSync(tmp);

  // Restore settings and API keys to match the backed-up machine.
  const settingsEntry = payload.getEntry('settings.json');
  if (settingsEntry) {
    const imported = JSON.parse(payload.readAsText(settingsEntry));
    // Backups created before MCP support may not have these fields; backups from
    // any version must never restore a listener or a bearer credential.
    const restoredSettings = {
      ...imported,
      mcpEnabled: false,
      mcpToken: '',
      nodusServerEnabled: false,
      nodusServerUrl: '',
      nodusServerSpaceId: '',
      nodusServerSpaceName: '',
    } as Record<string, unknown>;
    for (const key of MACHINE_LOCAL_SETTING_KEYS) {
      if (localPaths && localPaths[key] !== undefined) restoredSettings[key] = localPaths[key];
      else delete restoredSettings[key];
    }
    getDb()
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run('app', JSON.stringify(restoredSettings));
  }
  // Secret-free (automatic) backups leave this machine's keys untouched.
  if (includesSecrets) {
    restoreApiKeys(importedKeys);
    restoreAudioKeys(importedAudioKeys);
  }

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
    // Read this computer's paths before the swap, then stamp them into each incoming
    // snapshot so the restore never inherits another machine's Zotero root. Done on the
    // staged temp file, so what lands in place is already correct.
    const machineLocal = captureMachineLocalSettings();
    for (const { entry, tmp } of staged) {
      applyMachineLocalSettings(tmp, machineLocal.get(entry.id) ?? null);
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

/** This machine's path settings, per vault id, read from the vaults currently on disk. */
function captureMachineLocalSettings(): Map<string, Record<string, unknown>> {
  const captured = new Map<string, Record<string, unknown>>();
  let vaults: ReturnType<typeof listVaults>;
  try {
    vaults = listVaults();
  } catch {
    return captured;
  }
  for (const vault of vaults) {
    try {
      if (!fs.statSync(vault.path).isFile()) continue;
    } catch {
      continue; // a vault in the registry whose file is gone has nothing to preserve
    }
    const db = new Database(vault.path, { readonly: true, fileMustExist: true });
    try {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'app'").get() as { value: string } | undefined;
      const current = (row ? safeParse(row.value) : {}) as Record<string, unknown>;
      const picked: Record<string, unknown> = {};
      for (const key of MACHINE_LOCAL_SETTING_KEYS) {
        if (current[key] !== undefined) picked[key] = current[key];
      }
      captured.set(vault.id, picked);
    } catch {
      /* an unreadable settings row simply contributes no local override */
    } finally {
      db.close();
    }
  }
  return captured;
}

/**
 * Replace the machine-local keys in a snapshot's settings row with this computer's
 * values. `null` (no such vault here yet — a fresh device) removes them entirely, so
 * `getSettings()` falls back to the defaults and Zotero auto-detection can run.
 */
function applyMachineLocalSettings(databasePath: string, local: Record<string, unknown> | null): void {
  const db = new Database(databasePath);
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'app'").get() as { value: string } | undefined;
    const settings = (row ? safeParse(row.value) : {}) as Record<string, unknown>;
    for (const key of MACHINE_LOCAL_SETTING_KEYS) {
      if (local && local[key] !== undefined) settings[key] = local[key];
      else delete settings[key];
    }
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run('app', JSON.stringify(settings));
  } finally {
    db.close();
  }
}

function writeAtomicFile(target: string, data: Buffer): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.restore-${process.pid}-${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(temporary, data);
  fs.renameSync(temporary, target);
}

function restoreGlobalPreferences(data: Buffer): void {
  const target = path.join(app.getPath('userData'), 'app-prefs.json');
  let incoming: Record<string, unknown>;
  try {
    incoming = JSON.parse(data.toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new Error('La copia contiene preferencias globales ilegibles.');
  }
  let current: Record<string, unknown> = {};
  try {
    current = JSON.parse(fs.readFileSync(target, 'utf8')) as Record<string, unknown>;
  } catch {
    /* A new device has no current preference file yet. */
  }
  // Absolute folder paths and recovery scheduling belong to this machine. Importing
  // another computer's values could silently redirect snapshots to a missing path.
  const merged = { ...incoming };
  for (const key of RECOVERY_PREF_KEYS) {
    if (current[key] !== undefined) merged[key] = current[key];
    else delete merged[key];
  }
  writeAtomicFile(target, Buffer.from(JSON.stringify(merged, null, 2)));
}

function safeArchiveRelative(value: string): string | null {
  const normalized = path.posix.normalize(value);
  if (!normalized || normalized === '.' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) return null;
  return normalized;
}

function restoreAuxiliaryFiles(payload: AdmZip, payloadManifest: PayloadManifest): void {
  const selection = normalizeBackupSelection(payloadManifest.selection, false);
  if (selection.includePreferences) {
    for (const name of GLOBAL_AUXILIARY_FILES) {
      const entry = payload.getEntry(`aux/global/${name}`);
      if (!entry) continue;
      if (name === 'app-prefs.json') restoreGlobalPreferences(entry.getData());
      else writeAtomicFile(path.join(app.getPath('userData'), name), entry.getData());
    }
  }

  const restoredVaults = new Map(listVaults().map((vault) => [vault.id, vault]));
  for (const vaultEntry of payloadManifest.vaults ?? []) {
    const vault = restoredVaults.get(vaultEntry.id);
    if (!vault) continue;
    const targetDir = path.dirname(vault.path);
    if (selection.includeHistories) {
      for (const name of VAULT_HISTORY_FILES) {
        const entry = payload.getEntry(`aux/vaults/${vault.id}/${name}`);
        if (entry) writeAtomicFile(path.join(targetDir, name), entry.getData());
      }
    }
    if (selection.includeGeneratedMedia) {
      for (const name of VAULT_MEDIA_FILES) {
        const entry = payload.getEntry(`aux/vaults/${vault.id}/${name}`);
        if (entry) writeAtomicFile(path.join(targetDir, name), entry.getData());
      }
      const prefix = `aux/vaults/${vault.id}/audio/`;
      for (const entry of payload.getEntries()) {
        if (entry.isDirectory || !entry.entryName.startsWith(prefix)) continue;
        const relative = safeArchiveRelative(entry.entryName.slice(prefix.length));
        if (relative) writeAtomicFile(path.join(targetDir, 'audio', ...relative.split('/')), entry.getData());
      }
    }
  }
}

/** Strip listeners, remote publication bindings and any stray secrets from settings. */
function scrubSettings(raw: unknown): BackupSettings {
  const obj = (raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>) } : {}) as Record<string, unknown>;
  delete obj.mcpToken;
  delete obj.providerKeys;
  obj.mcpEnabled = false;
  obj.nodusServerEnabled = false;
  obj.nodusServerUrl = '';
  obj.nodusServerSpaceId = '';
  obj.nodusServerSpaceName = '';
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
  const checkDb = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const result = checkDb.pragma('quick_check', { simple: true });
    if (result !== 'ok') return false;
  } finally {
    checkDb.close();
  }
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
    | 'embeddingProvider' | 'embeddingModel' | 'favorites' | 'codexReasoningEfforts' | 'defaultModel' | 'modelSettingsMode' | 'modelSettingsVersion'
    | 'extractionModel' | 'synthesisModel' | 'summaryModel' | 'fusionModel'
    | 'chatModel' | 'nodiModel' | 'deepResearchModel' | 'immersionModel' | 'writingModel'
    | 'argumentMapModel' | 'authorModel' | 'studyModel' | 'tutorModel' | 'hypothesisModel'
    | 'improveModel' | 'questionGenModel' | 'gradingModel' | 'flashcardModel' | 'transcriptionModel' | 'sttProvider'
    | 'sttTransformersModel' | 'sttWhisperCppModel' | 'sttWhisperCppExecutable'
    | 'imageProvider' | 'imageModel' | 'imageQuality' | 'imageStyle' | 'audioProvider' | 'audioVoice' | 'audioSpeed'
  >
): BackupInventory['modelSettings'] {
  return {
    embeddingProvider: settings.embeddingProvider,
    embeddingModel: settings.embeddingModel,
    favorites: settings.favorites,
    codexReasoningEfforts: settings.codexReasoningEfforts,
    defaultModel: settings.defaultModel,
    modelSettingsMode: settings.modelSettingsMode,
    modelSettingsVersion: settings.modelSettingsVersion,
    extractionModel: settings.extractionModel,
    synthesisModel: settings.synthesisModel,
    summaryModel: settings.summaryModel,
    fusionModel: settings.fusionModel,
    chatModel: settings.chatModel,
    nodiModel: settings.nodiModel,
    deepResearchModel: settings.deepResearchModel,
    immersionModel: settings.immersionModel,
    writingModel: settings.writingModel,
    argumentMapModel: settings.argumentMapModel,
    authorModel: settings.authorModel,
    studyModel: settings.studyModel,
    tutorModel: settings.tutorModel,
    hypothesisModel: settings.hypothesisModel,
    improveModel: settings.improveModel,
    questionGenModel: settings.questionGenModel,
    gradingModel: settings.gradingModel,
    flashcardModel: settings.flashcardModel,
    transcriptionModel: settings.transcriptionModel,
    sttProvider: settings.sttProvider,
    sttTransformersModel: settings.sttTransformersModel,
    sttWhisperCppModel: settings.sttWhisperCppModel,
    sttWhisperCppExecutable: settings.sttWhisperCppExecutable,
    imageProvider: settings.imageProvider,
    imageModel: settings.imageModel,
    imageQuality: settings.imageQuality,
    imageStyle: settings.imageStyle,
    audioProvider: settings.audioProvider,
    audioVoice: settings.audioVoice,
    audioSpeed: settings.audioSpeed,
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
    SECRET_PROVIDERS.flatMap((provider) => {
      const key = getApiKey(provider);
      return key ? [[provider, key]] : [];
    })
  ) as Partial<Record<AiProvider, string>>;
}

function readAudioKeys(): Record<string, string> {
  return Object.fromEntries(
    AUDIO_KEY_NAMES.flatMap((name) => {
      // A key the keychain cannot read is skipped, never fatal — same rule as the AI keys.
      let key: string | null = null;
      try {
        key = getAudioKey(name);
      } catch {
        key = null;
      }
      return key ? [[name, key]] : [];
    })
  );
}

function restoreAudioKeys(keys: Record<string, string>): void {
  for (const name of AUDIO_KEY_NAMES) {
    const key = keys[name];
    // Merge-only, matching restoreApiKeys: an absent entry means "unknown", not "delete".
    if (key) setAudioKey(name, key);
  }
}

function restoreApiKeys(keys: Partial<Record<AiProvider, string>>): void {
  for (const provider of SECRET_PROVIDERS) {
    const key = keys[provider];
    // Merge-only recovery: an absent provider can mean that the source snapshot
    // was created while its OS keychain was temporarily unavailable. Never erase
    // a local encrypted blob merely because an archive omits it.
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
