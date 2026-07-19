import AdmZip from 'adm-zip';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AppLanguage,
  RecoveryFolderInspection,
  RecoveryHealth,
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
 * user-facing recovery strings are localized inline. A language with no entry falls
 * back to English, matching `src/i18n.ts`'s <lang> → EN chain.
 */
type RecoveryStrings = Partial<Record<AppLanguage, string>> & { es: string; en: string };
const tr = (language: AppLanguage, values: RecoveryStrings) => values[language] ?? values.en;

function localizeRestoreMessage(message: string, language: AppLanguage): string {
  if (language === 'es') return message;
  const pick = (values: Omit<RecoveryStrings, 'es'>) => values[language] ?? values.en;
  if (message.includes('No se pudo descifrar la copia')) return pick({ en: 'The snapshot could not be decrypted. Check the password or recovery key.', fr: 'La sauvegarde n\'a pas pu être déchiffrée. Vérifiez le mot de passe ou la clé de récupération.', de: 'Die Sicherung konnte nicht entschlüsselt werden. Überprüfen Sie das Passwort oder den Wiederherstellungsschlüssel.', pt: 'Não foi possível desencriptar a cópia de segurança. Verifique a palavra-passe ou a chave de recuperação.', 'pt-BR': 'Não foi possível descriptografar o backup. Verifique a senha ou a chave de recuperação.' });
  if (message.includes('falta la contraseña')) return pick({ en: 'Restore cancelled: enter the password or recovery key.', fr: 'Restauration annulée : saisissez le mot de passe ou la clé de récupération.', de: 'Wiederherstellung abgebrochen: Geben Sie das Passwort oder den Wiederherstellungsschlüssel ein.', pt: 'Restauração cancelada: introduza a palavra-passe ou a chave de recuperação.', 'pt-BR': 'Restauração cancelada: digite a senha ou a chave de recuperação.' });
  if (message.includes('Formato de copia de seguridad no soportado')) return pick({ en: 'This backup format is not supported.', fr: 'Ce format de sauvegarde n\'est pas pris en charge.', de: 'Dieses Sicherungsformat wird nicht unterstützt.', pt: 'Este formato de cópia de segurança não é suportado.', 'pt-BR': 'Este formato de backup não é suportado.' });
  if (message.includes('los hashes internos no coinciden')) return pick({ en: 'Invalid snapshot: its integrity hashes do not match.', fr: 'Sauvegarde invalide : ses hachages d\'intégrité ne correspondent pas.', de: 'Ungültige Sicherung: Die Integritäts-Hashes stimmen nicht überein.', pt: 'Cópia de segurança inválida: os hashes de integridade não coincidem.', 'pt-BR': 'Backup inválido: os hashes de integridade não coincidem.' });
  if (message.includes('falta la clave de recuperación cifrada')) return pick({ en: 'Invalid snapshot: the encrypted recovery key is missing.', fr: 'Sauvegarde invalide : la clé de récupération chiffrée est manquante.', de: 'Ungültige Sicherung: Der verschlüsselte Wiederherstellungsschlüssel fehlt.', pt: 'Cópia de segurança inválida: falta a chave de recuperação encriptada.', 'pt-BR': 'Backup inválido: falta a chave de recuperação criptografada.' });
  if (message.includes('falta el manifiesto interno')) return pick({ en: 'Invalid snapshot: its internal manifest is missing.', fr: 'Sauvegarde invalide : son manifeste interne est manquant.', de: 'Ungültige Sicherung: Das interne Manifest fehlt.', pt: 'Cópia de segurança inválida: falta o manifesto interno.', 'pt-BR': 'Backup inválido: falta o manifesto interno.' });
  if (message.includes('faltan manifest o datos cifrados')) return pick({ en: 'Invalid .nodus file: its manifest or encrypted data is missing.', fr: 'Fichier .nodus invalide : son manifeste ou ses données chiffrées sont manquants.', de: 'Ungültige .nodus-Datei: Das Manifest oder die verschlüsselten Daten fehlen.', pt: 'Ficheiro .nodus inválido: falta o manifesto ou os dados encriptados.', 'pt-BR': 'Arquivo .nodus inválido: falta o manifesto ou os dados criptografados.' });
  if (message.includes('esquema más reciente')) return pick({ en: 'This snapshot was created by a newer Nodus version. Update the app before restoring it.', fr: 'Cette sauvegarde a été créée par une version plus récente de Nodus. Mettez à jour l\'application avant de la restaurer.', de: 'Diese Sicherung wurde mit einer neueren Nodus-Version erstellt. Aktualisieren Sie die App, bevor Sie sie wiederherstellen.', pt: 'Esta cópia de segurança foi criada com uma versão mais recente do Nodus. Atualize a aplicação antes de a restaurar.', 'pt-BR': 'Este backup foi criado com uma versão mais recente do Nodus. Atualize o aplicativo antes de restaurá-lo.' });
  if (message.includes('reversión automática')) return pick({ en: `Restore failed, but Nodus attempted to preserve the previous state. ${message}`, fr: `La restauration a échoué, mais Nodus a tenté de préserver l'état précédent. ${message}`, de: `Die Wiederherstellung ist fehlgeschlagen, aber Nodus hat versucht, den vorherigen Zustand zu erhalten. ${message}`, pt: `A restauração falhou, mas o Nodus tentou preservar o estado anterior. ${message}`, 'pt-BR': `A restauração falhou, mas o Nodus tentou preservar o estado anterior. ${message}` });
  if (message.includes('restauración se canceló antes de modificar')) return pick({ en: `Restore was cancelled before changing your data. ${message}`, fr: `La restauration a été annulée avant toute modification de vos données. ${message}`, de: `Die Wiederherstellung wurde abgebrochen, bevor Ihre Daten geändert wurden. ${message}`, pt: `A restauração foi cancelada antes de alterar os seus dados. ${message}`, 'pt-BR': `A restauração foi cancelada antes de alterar seus dados. ${message}` });
  return message;
}

export function inspectRecoveryFolder(folder: string, language: AppLanguage = 'es'): RecoveryFolderInspection {
  const clean = path.resolve(folder);
  if (!fs.existsSync(clean)) return { path: clean, kind: 'missing', message: tr(language, { es: 'La carpeta no existe.', en: 'The folder does not exist.', fr: "Le dossier n'existe pas.", de: 'Der Ordner existiert nicht.', pt: 'A pasta não existe.', 'pt-BR': 'A pasta não existe.' }), snapshots: [] };
  let stat: fs.Stats;
  try {
    stat = fs.statSync(clean);
  } catch {
    return { path: clean, kind: 'missing', message: tr(language, { es: 'No se puede acceder a la carpeta.', en: 'The folder cannot be accessed.', fr: "Impossible d'accéder au dossier.", de: 'Auf den Ordner kann nicht zugegriffen werden.', pt: 'Não é possível aceder à pasta.', 'pt-BR': 'Não é possível acessar a pasta.' }), snapshots: [] };
  }
  if (!stat.isDirectory()) return { path: clean, kind: 'invalid', message: tr(language, { es: 'La ruta seleccionada no es una carpeta.', en: 'The selected path is not a folder.', fr: "Le chemin sélectionné n'est pas un dossier.", de: 'Der ausgewählte Pfad ist kein Ordner.', pt: 'O caminho selecionado não é uma pasta.', 'pt-BR': 'O caminho selecionado não é uma pasta.' }), snapshots: [] };

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
        ? tr(language, { es: `${snapshots.length} copia(s) válida(s) encontrada(s).`, en: `${snapshots.length} valid snapshot(s) found.`, fr: `${snapshots.length} sauvegarde(s) valide(s) trouvée(s).`, de: `${snapshots.length} gültige Sicherung(en) gefunden.`, pt: `${snapshots.length} cópia(s) de segurança válida(s) encontrada(s).`, 'pt-BR': `${snapshots.length} backup(s) válido(s) encontrado(s).` })
        : tr(language, { es: 'Carpeta de recuperación válida, todavía sin copias.', en: 'Valid recovery folder, with no snapshots yet.', fr: 'Dossier de récupération valide, encore sans sauvegarde.', de: 'Gültiger Wiederherstellungsordner, noch ohne Sicherungen.', pt: 'Pasta de recuperação válida, ainda sem cópias de segurança.', 'pt-BR': 'Pasta de recuperação válida, ainda sem backups.' }),
      snapshots,
    };
  }

  const entries = visibleDirectoryEntries(clean);
  if (entries.length === 0) return { path: clean, kind: 'empty', message: tr(language, { es: 'Carpeta vacía y disponible.', en: 'Empty folder, ready to use.', fr: 'Dossier vide et disponible.', de: 'Ordner leer und verfügbar.', pt: 'Pasta vazia e disponível.', 'pt-BR': 'Pasta vazia e disponível.' }), snapshots: [] };
  return {
    path: clean,
    kind: 'invalid',
    message: tr(language, { es: `La carpeta debe estar vacía o contener una recuperación de Nodus válida. Contiene ${entries.length} elemento(s).`, en: `The folder must be empty or contain a valid Nodus recovery. It contains ${entries.length} item(s).`, fr: `Le dossier doit être vide ou contenir une récupération Nodus valide. Il contient ${entries.length} élément(s).`, de: `Der Ordner muss leer sein oder eine gültige Nodus-Wiederherstellung enthalten. Er enthält ${entries.length} Element(e).`, pt: `A pasta deve estar vazia ou conter uma recuperação válida do Nodus. Contém ${entries.length} elemento(s).`, 'pt-BR': `A pasta deve estar vazia ou conter uma recuperação válida do Nodus. Ela contém ${entries.length} elemento(s).` }),
    snapshots: [],
  };
}

/** How many days a snapshot may age before protection counts as lapsed. The scheduler
 *  aims for a slot per chosen weekday, so a week without one is already anomalous. */
const STALE_AFTER_DAYS = 8;

/**
 * Decide whether the user is actually protected right now. Deliberately pessimistic:
 * anything that would stop the next snapshot from being written — or that already did —
 * outranks the reassuring "last run was ok" string.
 */
function assessRecoveryHealth(
  settings: ReturnType<typeof getSettings>,
  folder: RecoveryFolderInspection | null
): RecoveryHealth {
  const detail = settings.lastAutoBackupStatus ?? '';
  const lastAt = settings.lastAutoBackupAt ? Date.parse(settings.lastAutoBackupAt) : NaN;
  const daysSinceLastBackup = Number.isNaN(lastAt)
    ? null
    : Math.max(0, Math.floor((Date.now() - lastAt) / 86400000));

  if (!settings.autoBackupEnabled || !settings.autoBackupFolder) {
    return { level: 'critical', code: 'disabled', daysSinceLastBackup, detail };
  }
  // An unreachable destination means the next snapshot cannot be written, whatever the
  // last recorded status says.
  if (folder && folder.kind !== 'recovery' && folder.kind !== 'empty') {
    return { level: 'critical', code: 'folder-unreachable', daysSinceLastBackup, detail };
  }
  if (detail.startsWith('error:')) {
    return { level: 'critical', code: 'last-run-failed', daysSinceLastBackup, detail };
  }
  if (daysSinceLastBackup === null) {
    return { level: 'warning', code: 'never-run', daysSinceLastBackup, detail };
  }
  if (daysSinceLastBackup >= STALE_AFTER_DAYS) {
    return { level: 'warning', code: 'stale', daysSinceLastBackup, detail };
  }
  return { level: 'ok', code: 'ok', daysSinceLastBackup, detail };
}

export function getRecoveryStatus(): RecoveryStatus {
  const settings = getSettings();
  const configuredRoot = settings.autoBackupFolder?.trim() ?? '';
  const folder = configuredRoot ? inspectRecoveryFolder(configuredRoot, settings.uiLanguage) : null;
  return {
    health: assessRecoveryHealth(settings, folder),
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
  if (cleanPassword.length < 8) return { ok: false, message: tr(language, { es: 'La contraseña debe tener al menos 8 caracteres.', en: 'The password must be at least 8 characters long.', fr: 'Le mot de passe doit contenir au moins 8 caractères.', de: 'Das Passwort muss mindestens 8 Zeichen lang sein.', pt: 'A palavra-passe deve ter pelo menos 8 caracteres.', 'pt-BR': 'A senha deve ter pelo menos 8 caracteres.' }) };
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
    if (!snapshot) throw new Error(tr(language, { es: 'La copia inicial se escribió, pero no superó la verificación del manifiesto.', en: 'The initial snapshot was written but failed manifest verification.', fr: "La sauvegarde initiale a été écrite, mais elle n'a pas passé la vérification du manifeste.", de: 'Die anfängliche Sicherung wurde geschrieben, hat die Manifestprüfung jedoch nicht bestanden.', pt: 'A cópia de segurança inicial foi gravada, mas não passou na verificação do manifesto.', 'pt-BR': 'O backup inicial foi gravado, mas não passou na verificação do manifesto.' }));
    return {
      ok: true,
      message: tr(language, { es: 'Carpeta de recuperación creada y primera copia verificada.', en: 'Recovery folder created and first snapshot verified.', fr: 'Dossier de récupération créé et première sauvegarde vérifiée.', de: 'Wiederherstellungsordner erstellt und erste Sicherung verifiziert.', pt: 'Pasta de recuperação criada e primeira cópia de segurança verificada.', 'pt-BR': 'Pasta de recuperação criada e primeiro backup verificado.' }),
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
  if (!snapshot) return { ok: false, message: tr(language, { es: 'La copia seleccionada no pertenece a esta carpeta de recuperación.', en: 'The selected snapshot does not belong to this recovery folder.', fr: "La sauvegarde sélectionnée n'appartient pas à ce dossier de récupération.", de: 'Die ausgewählte Sicherung gehört nicht zu diesem Wiederherstellungsordner.', pt: 'A cópia de segurança selecionada não pertence a esta pasta de recuperação.', 'pt-BR': 'O backup selecionado não pertence a esta pasta de recuperação.' }) };
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
    // Branch first, then translate: a ternary *inside* each argument hides these
    // strings from the extraction that keeps the languages in step.
    message: result.usedRecoveryKey
      ? tr(language, {
        es: 'Datos recuperados con la clave de recuperación. Puedes establecer una contraseña nueva en Ajustes.',
        en: 'Data restored with the recovery key. You can set a new password in Settings.',
        fr: 'Données récupérées avec la clé de récupération. Vous pouvez définir un nouveau mot de passe dans les Paramètres.',
        de: 'Daten mit dem Wiederherstellungsschlüssel wiederhergestellt. Sie können in den Einstellungen ein neues Passwort festlegen.',
        pt: 'Dados recuperados com a chave de recuperação. Pode definir uma nova palavra-passe nas Definições.',
        'pt-BR': 'Dados recuperados com a chave de recuperação. Você pode definir uma nova senha nas Configurações.',
      })
      : tr(language, {
        es: 'Datos recuperados y copia de seguridad previa conservada por seguridad.',
        en: 'Data restored and a pre-restore safety snapshot was retained.',
        fr: 'Données récupérées ; une sauvegarde préalable a été conservée par sécurité.',
        de: 'Daten wiederhergestellt; eine Sicherung vor der Wiederherstellung wurde vorsorglich aufbewahrt.',
        pt: 'Dados recuperados; foi conservada uma cópia de segurança prévia por precaução.',
        'pt-BR': 'Dados recuperados; um backup anterior foi mantido por segurança.',
      }),
    snapshot,
  };
}
