import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AutoBackupResult } from '@shared/types';
import { getSettings, updateSettings } from '../db/settingsRepo';
import { getBackupPassword, getBackupRecoveryKey, lockedApiKeyProviders, setBackupRecoveryKey } from '../secrets/secretStore';
import { generateBackupPassword } from './backupCrypto';
import { createBackupArchive, verifyBackupArchive } from './exportImport';
import { resolveBackupOutputDir } from '../recovery/recoveryPaths';

/**
 * Scheduled encrypted backups. Every run encrypts with the ONE master password
 * from the keychain (no per-file passwords to write down), writes into the
 * user-chosen folder — point it at iCloud Drive / Google Drive and the cloud
 * client does the off-machine transport — and prunes old copies with a
 * grandfather-father-son policy. Every automatic backup contains the complete
 * Nodus state, including API keys, inside the encrypted payload.
 */

const KEEP_DAILY = 7;
const KEEP_WEEKLY = 4;
const KEEP_MONTHLY = 3;

/** nodus-backup-<host>-YYYYMMDD-HHmmss.nodus */
const BACKUP_FILE_RE = /^nodus-backup-(.+)-(\d{8})-(\d{6})\.nodus$/;

export function sanitizeHostname(raw: string): string {
  const clean = raw
    .toLowerCase()
    .replace(/\.local$/, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return clean || 'equipo';
}

export function backupFileName(hostname: string, date: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `nodus-backup-${sanitizeHostname(hostname)}-${stamp}.nodus`;
}

export function isBackupDue(lastAt: string | null, intervalHours: number, now = new Date()): boolean {
  if (!lastAt) return true;
  const last = Date.parse(lastAt);
  if (Number.isNaN(last)) return true;
  return now.getTime() - last >= intervalHours * 60 * 60 * 1000;
}

/**
 * The most recent scheduled backup slot at or before `now`: the latest day whose
 * weekday is allowed (empty `days` = every day) at `hour:minute`. Returns null only
 * if no slot exists in the last week (shouldn't happen with a non-empty schedule).
 */
export function mostRecentBackupSlot(days: number[], hour: number, minute: number, now = new Date()): Date | null {
  const allowed = (weekday: number) => days.length === 0 || days.includes(weekday);
  for (let back = 0; back <= 7; back++) {
    const slot = new Date(now);
    slot.setDate(now.getDate() - back);
    slot.setHours(hour, minute, 0, 0);
    if (slot.getTime() <= now.getTime() && allowed(slot.getDay())) return slot;
  }
  return null;
}

/**
 * Schedule-aware "is a backup due?": true when a scheduled slot (a chosen weekday at
 * the chosen time) has passed since the last successful backup. This is what makes
 * the startup catch-up work — if the machine was off at the scheduled time, the most
 * recent slot is still in the past and after `lastAt`, so the next launch backs up.
 */
export function isScheduledBackupDue(
  lastAt: string | null,
  days: number[],
  hour: number,
  minute: number,
  now = new Date()
): boolean {
  const slot = mostRecentBackupSlot(days, hour, minute, now);
  if (!slot) return false;
  if (!lastAt) return true;
  const last = Date.parse(lastAt);
  if (Number.isNaN(last)) return true;
  return last < slot.getTime();
}

interface ParsedBackup {
  file: string;
  date: Date;
}

function parseBackupFile(hostname: string, file: string): ParsedBackup | null {
  const match = BACKUP_FILE_RE.exec(file);
  if (!match || match[1] !== sanitizeHostname(hostname)) return null;
  const [, , d, t] = match;
  const date = new Date(
    Number(d.slice(0, 4)),
    Number(d.slice(4, 6)) - 1,
    Number(d.slice(6, 8)),
    Number(t.slice(0, 2)),
    Number(t.slice(2, 4)),
    Number(t.slice(4, 6))
  );
  return Number.isNaN(date.getTime()) ? null : { file, date };
}

function isoWeekKey(date: Date): string {
  // Thursday of the current week decides the ISO week-year.
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * Grandfather-father-son selection: newest per day for the last KEEP_DAILY
 * days, newest per ISO week for KEEP_WEEKLY weeks, newest per month for
 * KEEP_MONTHLY months. Only THIS machine's files are considered — other
 * machines writing to the same synced folder prune their own lineage.
 * Returns the files that should be deleted.
 */
export function selectBackupsToPrune(hostname: string, files: string[]): string[] {
  const parsed = files
    .map((f) => parseBackupFile(hostname, f))
    .filter((p): p is ParsedBackup => p !== null)
    .sort((a, b) => b.date.getTime() - a.date.getTime()); // newest first

  const keep = new Set<string>();
  const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  const monthKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}`;

  const seenDays = new Set<string>();
  const seenWeeks = new Set<string>();
  const seenMonths = new Set<string>();
  for (const p of parsed) {
    const day = dayKey(p.date);
    if (!seenDays.has(day) && seenDays.size < KEEP_DAILY) {
      seenDays.add(day);
      keep.add(p.file);
    }
    const week = isoWeekKey(p.date);
    if (!seenWeeks.has(week) && seenWeeks.size < KEEP_WEEKLY) {
      seenWeeks.add(week);
      keep.add(p.file);
    }
    const month = monthKey(p.date);
    if (!seenMonths.has(month) && seenMonths.size < KEEP_MONTHLY) {
      seenMonths.add(month);
      keep.add(p.file);
    }
  }
  return parsed.filter((p) => !keep.has(p.file)).map((p) => p.file);
}

function pruneBackups(folder: string, hostname: string): number {
  let files: string[];
  try {
    files = fs.readdirSync(folder);
  } catch {
    return 0;
  }
  const doomed = selectBackupsToPrune(hostname, files);
  let pruned = 0;
  for (const file of doomed) {
    try {
      fs.unlinkSync(path.join(folder, file));
      pruned += 1;
    } catch {
      /* a locked/cloud-evicted file just survives until next prune */
    }
  }
  return pruned;
}

/** Run one backup now (manual "Probar ahora" or the scheduler). */
export async function runAutoBackupNow(appVersion: string): Promise<AutoBackupResult> {
  const settings = getSettings();
  const configuredFolder = settings.autoBackupFolder;
  const finish = (result: AutoBackupResult): AutoBackupResult => {
    updateSettings({
      lastAutoBackupAt: result.ok ? new Date().toISOString() : settings.lastAutoBackupAt,
      lastAutoBackupStatus: `${result.ok ? 'ok' : 'error'}: ${result.message}`,
    });
    return result;
  };

  if (!configuredFolder) return finish({ ok: false, message: 'No hay carpeta de destino configurada.' });
  const password = getBackupPassword();
  if (!password) return finish({ ok: false, message: 'No hay contraseña maestra de copias configurada.' });
  try {
    const folder = resolveBackupOutputDir(configuredFolder);
    fs.mkdirSync(folder, { recursive: true });
    let recoveryKey = getBackupRecoveryKey();
    if (!recoveryKey) {
      recoveryKey = generateBackupPassword();
      setBackupRecoveryKey(recoveryKey);
    }
    const archive = await createBackupArchive({
      password,
      appVersion,
      recoveryKey,
    });
    const hostname = os.hostname();
    const target = path.join(folder, backupFileName(hostname, new Date()));
    // Write via temp + rename so cloud clients never sync a half-written file.
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, archive);
    fs.renameSync(tmp, target);

    // Prove the snapshot is recoverable BEFORE retention deletes older ones. Re-read
    // from disk rather than trusting the in-memory buffer, so a truncated or corrupted
    // write is caught here instead of on the day it is needed.
    const verification = verifyBackupArchive(fs.readFileSync(target), password);
    if (!verification.ok) {
      fs.rmSync(target, { force: true });
      return finish({
        ok: false,
        message: `La copia se escribió pero no se pudo verificar, así que se descartó y no se ha podado ninguna anterior: ${verification.message}`,
      });
    }

    const prunedCount = pruneBackups(folder, hostname);
    // A key the keychain can no longer read is reported, not fatal: the library was
    // still backed up, and restoreApiKeys never erases a local key it did not receive.
    const locked = lockedApiKeyProviders();
    const warning = locked.length > 0
      ? ` Aviso: las claves de ${locked.join(', ')} no se pudieron leer del almacén seguro y no viajan en esta copia.`
      : '';
    return finish({ ok: true, message: `Copia verificada y guardada en ${target}.${warning}`, path: target, prunedCount });
  } catch (e) {
    return finish({ ok: false, message: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Scheduler tick: run only when enabled, configured and a scheduled slot has passed
 * since the last backup. Called shortly after launch (startup catch-up for a slot
 * missed while the machine was off) and periodically; runs in the main process so it
 * never blocks the UI.
 */
export async function maybeRunAutoBackup(appVersion: string): Promise<AutoBackupResult | null> {
  const settings = getSettings();
  if (!settings.autoBackupEnabled) return null;
  // A configured-but-broken setup must never fail silently. Returning early without
  // recording anything leaves `lastAutoBackupStatus` frozen on the last success, so the
  // UI keeps showing "ok" for months while nothing is being backed up — the one failure
  // mode a backup system cannot afford. `getBackupPassword()` also returns null when the
  // blob exists but the OS keychain can no longer decrypt it (new login password,
  // machine migration), which is precisely when the user must be told.
  if (!settings.autoBackupFolder || !getBackupPassword()) {
    const reason = !settings.autoBackupFolder
      ? 'No hay carpeta de destino configurada.'
      : 'No se pudo leer la contraseña maestra del almacén seguro del sistema. Vuelve a introducirla en Ajustes para reanudar las copias.';
    updateSettings({ lastAutoBackupStatus: `error: ${reason}` });
    return { ok: false, message: reason };
  }
  const days = Array.isArray(settings.autoBackupDays) ? settings.autoBackupDays : [];
  const hour = Number.isFinite(settings.autoBackupHour) ? settings.autoBackupHour : 3;
  const minute = Number.isFinite(settings.autoBackupMinute) ? settings.autoBackupMinute : 0;
  if (!isScheduledBackupDue(settings.lastAutoBackupAt, days, hour, minute)) return null;
  return runAutoBackupNow(appVersion);
}
