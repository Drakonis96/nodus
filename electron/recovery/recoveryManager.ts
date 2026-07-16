import AdmZip from 'adm-zip';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AppLanguage,
  RecoveryFolderInspection,
  RecoverySetupResult,
  RecoverySnapshotSummary,
  RecoveryStatus,
} from '@shared/types';
import { getSettings, updateSettings } from '../db/settingsRepo';
import { restoreBackupArchiveSafely } from '../export/exportImport';
import { runAutoBackupNow } from '../export/autoBackup';
import {
  clearBackupPassword,
  clearBackupRecoveryKey,
  getBackupPassword,
  getBackupRecoveryKey,
  hasBackupPassword,
  setBackupPassword,
  setBackupRecoveryKey,
} from '../secrets/secretStore';
import { generateBackupPassword } from '../export/backupCrypto';
import { listVaults } from '../vaults/vaultRegistry';
import {
  createRecoveryManifest,
  readRecoveryManifest,
  recoveryManifestPath,
  recoverySnapshotsDir,
  visibleDirectoryEntries,
  writeRecoveryManifest,
} from './recoveryPaths';

export const RECOVERY_SETUP_VERSION = 1;

interface OuterBackupManifest {
  format: string;
  formatVersion: number;
  schemaVersion: number;
  appVersion: string;
  date: string;
  includesSecrets?: boolean;
  vaultCount?: number;
}

function snapshotSummary(filePath: string): RecoverySnapshotSummary | null {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    const zip = new AdmZip(filePath);
    const entry = zip.getEntry('manifest.json');
    if (!entry) return null;
    const manifest = JSON.parse(zip.readAsText(entry)) as OuterBackupManifest;
    if (manifest.format !== 'nodus.encrypted-backup' || !Number.isFinite(manifest.formatVersion)) return null;
    return {
      fileName: path.basename(filePath),
      path: filePath,
      date: manifest.date,
      appVersion: manifest.appVersion,
      schemaVersion: manifest.schemaVersion,
      vaultCount: manifest.vaultCount ?? 1,
      bytes: stat.size,
      includesSecrets: manifest.includesSecrets === true,
    };
  } catch {
    return null;
  }
}

/**
 * The main process cannot reach the renderer's i18n table, so the handful of
 * user-facing recovery strings are localized inline. Anything without a French
 * translation falls back to English, matching `src/i18n.ts`.
 */
const tr = (language: AppLanguage, es: string, en: string, fr?: string) =>
  language === 'fr' ? fr ?? en : language === 'en' ? en : es;

function localizeRestoreMessage(message: string, language: AppLanguage): string {
  if (language === 'es') return message;
  const pick = (en: string, fr: string) => (language === 'fr' ? fr : en);
  if (message.includes('No se pudo descifrar la copia')) return pick('The snapshot could not be decrypted. Check the password or recovery key.', 'La sauvegarde n\'a pas pu être déchiffrée. Vérifiez le mot de passe ou la clé de récupération.');
  if (message.includes('falta la contraseña')) return pick('Restore cancelled: enter the password or recovery key.', 'Restauration annulée : saisissez le mot de passe ou la clé de récupération.');
  if (message.includes('Formato de copia de seguridad no soportado')) return pick('This backup format is not supported.', 'Ce format de sauvegarde n\'est pas pris en charge.');
  if (message.includes('los hashes internos no coinciden')) return pick('Invalid snapshot: its integrity hashes do not match.', 'Sauvegarde invalide : ses hachages d\'intégrité ne correspondent pas.');
  if (message.includes('falta la clave de recuperación cifrada')) return pick('Invalid snapshot: the encrypted recovery key is missing.', 'Sauvegarde invalide : la clé de récupération chiffrée est manquante.');
  if (message.includes('falta el manifiesto interno')) return pick('Invalid snapshot: its internal manifest is missing.', 'Sauvegarde invalide : son manifeste interne est manquant.');
  if (message.includes('faltan manifest o datos cifrados')) return pick('Invalid .nodus file: its manifest or encrypted data is missing.', 'Fichier .nodus invalide : son manifeste ou ses données chiffrées sont manquants.');
  if (message.includes('esquema más reciente')) return pick('This snapshot was created by a newer Nodus version. Update the app before restoring it.', 'Cette sauvegarde a été créée par une version plus récente de Nodus. Mettez à jour l\'application avant de la restaurer.');
  if (message.includes('reversión automática')) return pick(`Restore failed, but Nodus attempted to preserve the previous state. ${message}`, `La restauration a échoué, mais Nodus a tenté de préserver l'état précédent. ${message}`);
  if (message.includes('restauración se canceló antes de modificar')) return pick(`Restore was cancelled before changing your data. ${message}`, `La restauration a été annulée avant toute modification de vos données. ${message}`);
  return message;
}

export function inspectRecoveryFolder(folder: string, language: AppLanguage = 'es'): RecoveryFolderInspection {
  const clean = path.resolve(folder);
  if (!fs.existsSync(clean)) return { path: clean, kind: 'missing', message: tr(language, 'La carpeta no existe.', 'The folder does not exist.', "Le dossier n'existe pas."), snapshots: [] };
  let stat: fs.Stats;
  try {
    stat = fs.statSync(clean);
  } catch {
    return { path: clean, kind: 'missing', message: tr(language, 'No se puede acceder a la carpeta.', 'The folder cannot be accessed.', "Impossible d'accéder au dossier."), snapshots: [] };
  }
  if (!stat.isDirectory()) return { path: clean, kind: 'invalid', message: tr(language, 'La ruta seleccionada no es una carpeta.', 'The selected path is not a folder.', "Le chemin sélectionné n'est pas un dossier."), snapshots: [] };

  const manifest = readRecoveryManifest(clean);
  if (manifest) {
    const snapshotsDir = recoverySnapshotsDir(clean);
    const snapshots = fs.existsSync(snapshotsDir)
      ? fs.readdirSync(snapshotsDir)
        .filter((name) => name.endsWith('.nodus'))
        .map((name) => snapshotSummary(path.join(snapshotsDir, name)))
        .filter((item): item is RecoverySnapshotSummary => item !== null)
        .sort((a, b) => b.date.localeCompare(a.date))
      : [];
    return {
      path: clean,
      kind: 'recovery',
      message: snapshots.length
        ? tr(language, `${snapshots.length} copia(s) válida(s) encontrada(s).`, `${snapshots.length} valid snapshot(s) found.`, `${snapshots.length} sauvegarde(s) valide(s) trouvée(s).`)
        : tr(language, 'Carpeta de recuperación válida, todavía sin copias.', 'Valid recovery folder, with no snapshots yet.', 'Dossier de récupération valide, encore sans sauvegarde.'),
      snapshots,
    };
  }

  const entries = visibleDirectoryEntries(clean);
  if (entries.length === 0) return { path: clean, kind: 'empty', message: tr(language, 'Carpeta vacía y disponible.', 'Empty folder, ready to use.', 'Dossier vide et disponible.'), snapshots: [] };
  return {
    path: clean,
    kind: 'invalid',
    message: tr(
      language,
      `La carpeta debe estar vacía o contener una recuperación de Nodus válida. Contiene ${entries.length} elemento(s).`,
      `The folder must be empty or contain a valid Nodus recovery. It contains ${entries.length} item(s).`,
      `Le dossier doit être vide ou contenir une récupération Nodus valide. Il contient ${entries.length} élément(s).`
    ),
    snapshots: [],
  };
}

export function getRecoveryStatus(): RecoveryStatus {
  const settings = getSettings();
  const configuredRoot = settings.autoBackupFolder?.trim() ?? '';
  const folder = configuredRoot ? inspectRecoveryFolder(configuredRoot, settings.uiLanguage) : null;
  return {
    setupVersion: settings.recoverySetupVersion ?? 0,
    // A previously completed setup is not turned into a blocking full-screen wizard
    // merely because a removable/cloud volume is temporarily offline. Settings and
    // backup status still surface that operational error without locking the user out.
    needsSetup: (settings.recoverySetupVersion ?? 0) < RECOVERY_SETUP_VERSION,
    previousInstallation: settings.onboardingComplete || listVaults().length > 1,
    configuredRoot,
    folder,
    hasPassword: hasBackupPassword(),
    hasRecoveryKey: Boolean(getBackupRecoveryKey()),
  };
}

function settingsPatch(root: string) {
  return {
    recoverySetupVersion: RECOVERY_SETUP_VERSION,
    // Preserve legacy fields as explicit all-on values so downgrades cannot inherit
    // an old partial selection. Current backup creation does not consult them.
    backupVaultIds: [],
    backupIncludePreferences: true,
    backupIncludeHistories: true,
    backupIncludeGeneratedMedia: true,
    backupIncludeApiKeys: true,
    autoBackupEnabled: true,
    autoBackupFolder: root,
  };
}

export async function initializeRecoveryFolder(
  folder: string,
  password: string,
  appVersion: string,
  language: AppLanguage = 'es'
): Promise<RecoverySetupResult> {
  const cleanPassword = password.trim();
  if (cleanPassword.length < 8) return { ok: false, message: tr(language, 'La contraseña debe tener al menos 8 caracteres.', 'The password must be at least 8 characters long.', 'Le mot de passe doit contenir au moins 8 caractères.') };
  const inspection = inspectRecoveryFolder(folder, language);
  if (inspection.kind !== 'empty') return { ok: false, message: inspection.message };

  const root = inspection.path;
  const previousSettings = getSettings();
  const previousPassword = getBackupPassword();
  const previousRecoveryKey = getBackupRecoveryKey();
  const recoveryKey = generateBackupPassword();
  let createdManifest = false;
  try {
    writeRecoveryManifest(root, createRecoveryManifest());
    createdManifest = true;
    fs.mkdirSync(recoverySnapshotsDir(root), { recursive: true });
    setBackupPassword(cleanPassword);
    setBackupRecoveryKey(recoveryKey);
    updateSettings(settingsPatch(root));
    const result = await runAutoBackupNow(appVersion);
    if (!result.ok || !result.path) throw new Error(result.message);
    const snapshot = snapshotSummary(result.path);
    if (!snapshot) throw new Error(tr(language, 'La copia inicial se escribió, pero no superó la verificación del manifiesto.', 'The initial snapshot was written but failed manifest verification.', "La sauvegarde initiale a été écrite, mais elle n'a pas passé la vérification du manifeste."));
    return {
      ok: true,
      message: tr(language, 'Carpeta de recuperación creada y primera copia verificada.', 'Recovery folder created and first snapshot verified.', 'Dossier de récupération créé et première sauvegarde vérifiée.'),
      snapshot,
      recoveryKey,
    };
  } catch (error) {
    updateSettings({
      recoverySetupVersion: previousSettings.recoverySetupVersion,
      backupVaultIds: previousSettings.backupVaultIds,
      backupIncludePreferences: previousSettings.backupIncludePreferences,
      backupIncludeHistories: previousSettings.backupIncludeHistories,
      backupIncludeGeneratedMedia: previousSettings.backupIncludeGeneratedMedia,
      backupIncludeApiKeys: previousSettings.backupIncludeApiKeys,
      autoBackupEnabled: previousSettings.autoBackupEnabled,
      autoBackupFolder: previousSettings.autoBackupFolder,
    });
    if (previousPassword) setBackupPassword(previousPassword); else clearBackupPassword();
    if (previousRecoveryKey) setBackupRecoveryKey(previousRecoveryKey); else clearBackupRecoveryKey();
    if (createdManifest) {
      try { fs.rmSync(recoverySnapshotsDir(root), { recursive: true, force: true }); } catch { /* best effort */ }
      try { fs.rmSync(recoveryManifestPath(root), { force: true }); } catch { /* best effort */ }
    }
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export async function restoreRecoverySnapshot(
  root: string,
  fileName: string,
  password: string,
  appVersion: string,
  language: AppLanguage = 'es'
): Promise<RecoverySetupResult> {
  const inspection = inspectRecoveryFolder(root, language);
  if (inspection.kind !== 'recovery') return { ok: false, message: inspection.message };
  const snapshot = inspection.snapshots.find((candidate) => candidate.fileName === path.basename(fileName));
  if (!snapshot) return { ok: false, message: tr(language, 'La copia seleccionada no pertenece a esta carpeta de recuperación.', 'The selected snapshot does not belong to this recovery folder.', "La sauvegarde sélectionnée n'appartient pas à ce dossier de récupération.") };
  let archive: Buffer;
  try {
    archive = fs.readFileSync(snapshot.path);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  const result = await restoreBackupArchiveSafely(archive, password, appVersion);
  if (!result.ok) return { ...result, message: localizeRestoreMessage(result.message, language) };
  if (result.recoveryKey) setBackupRecoveryKey(result.recoveryKey);
  // A restore with the recovery key must not make both credentials identical.
  // Generate a fresh password in the OS-protected store; the user can replace it
  // in Settings and export a new kit, while the stable recovery key keeps working.
  setBackupPassword(result.usedRecoveryKey ? generateBackupPassword() : password.trim());
  updateSettings(settingsPatch(inspection.path));
  return {
    ok: true,
    message: tr(
      language,
      result.usedRecoveryKey
        ? 'Datos recuperados con la clave de recuperación. Puedes establecer una contraseña nueva en Ajustes.'
        : 'Datos recuperados y copia de seguridad previa conservada por seguridad.',
      result.usedRecoveryKey
        ? 'Data restored with the recovery key. You can set a new password in Settings.'
        : 'Data restored and a pre-restore safety snapshot was retained.'
    ),
    snapshot,
  };
}
