import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AutoBackupResult } from '@shared/types';
import { getSettings, updateSettings } from '../db/settingsRepo';
import { getBackupPassword } from '../secrets/secretStore';
import { createBackupArchive } from './exportImport';

/**
 * Scheduled encrypted backups. Every run encrypts with the ONE master password
 * from the keychain (no per-file passwords to write down), writes into the
 * user-chosen folder — point it at iCloud Drive / Google Drive and the cloud
 * client does the off-machine transport — and prunes old copies with a
 * grandfather-father-son policy. Automatic backups never contain API keys, so
 * restoring one on another machine preserves that machine's own credentials.
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
  const folder = settings.autoBackupFolder;
  const finish = (result: AutoBackupResult): AutoBackupResult => {
    updateSettings({
      lastAutoBackupAt: result.ok ? new Date().toISOString() : settings.lastAutoBackupAt,
      lastAutoBackupStatus: `${result.ok ? 'ok' : 'error'}: ${result.message}`,
    });
    return result;
  };

  if (!folder) return finish({ ok: false, message: 'No hay carpeta de destino configurada.' });
  const password = getBackupPassword();
  if (!password) return finish({ ok: false, message: 'No hay contraseña maestra de copias configurada.' });
  try {
    fs.mkdirSync(folder, { recursive: true });
    const archive = await createBackupArchive({ password, includeSecrets: false, appVersion });
    const hostname = os.hostname();
    const target = path.join(folder, backupFileName(hostname, new Date()));
    // Write via temp + rename so cloud clients never sync a half-written file.
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, archive);
    fs.renameSync(tmp, target);
    const prunedCount = pruneBackups(folder, hostname);
    return finish({ ok: true, message: `Copia guardada en ${target}`, path: target, prunedCount });
  } catch (e) {
    return finish({ ok: false, message: e instanceof Error ? e.message : String(e) });
  }
}

/** Scheduler tick: run only when enabled, configured and overdue. */
export async function maybeRunAutoBackup(appVersion: string): Promise<AutoBackupResult | null> {
  const settings = getSettings();
  if (!settings.autoBackupEnabled) return null;
  if (!settings.autoBackupFolder || !getBackupPassword()) return null;
  if (!isBackupDue(settings.lastAutoBackupAt, settings.autoBackupIntervalHours)) return null;
  return runAutoBackupNow(appVersion);
}
