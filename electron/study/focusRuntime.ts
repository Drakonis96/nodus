import Database from 'better-sqlite3';
import { app } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FocusSnapshot } from '../../shared/studyFocus';
import { getActiveVault, listVaults } from '../vaults/vaultRegistry';
import { getDb } from '../db/database';
import { FocusService } from './focusService';
import { ensureGlobalFocusSchema, importLegacyFocus } from './focusStore';

let database: Database.Database | null = null;
let service: FocusService | null = null;
const completions = new Set<(snapshot: FocusSnapshot) => void>();
const contexts = new Set<() => void>();
export const globalFocusFile = () => path.join(app.getPath('userData'), 'focus', 'focus.sqlite');
const snapshot = (): FocusSnapshot => {
  const current = getGlobalFocusService();
  return { vaultId: current.context.id, vaultType: current.context.type, state: current.snapshot() };
};

export function getGlobalFocusService(): FocusService {
  if (!service) {
    const file = globalFocusFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    database = new Database(file);
    try {
      database.pragma('journal_mode = WAL');
      database.pragma('busy_timeout = 5000');
      ensureGlobalFocusSchema(database);
      importLegacyFocus(database, listVaults(), getActiveVault().id);
      service = new FocusService(database, undefined, undefined, state => {
        const context = service!.context;
        const payload = { vaultId: context.id, vaultType: context.type, state };
        for (const listener of completions) listener(payload);
      }, (id, vaultId) => {
        if (getActiveVault().id !== vaultId) return null;
        return (getDb().prepare('SELECT name FROM study_subjects WHERE id = ? AND deleted_at IS NULL').get(id) as { name: string } | undefined)?.name ?? null;
      });
      service.setVault(getActiveVault());
    } catch (error) {
      database.close(); database = null; service = null;
      throw error;
    }
  }
  return service;
}

/** Called after the vault switch commits, before its renderer event. */
export function synchronizeFocusVault(): void {
  if (!service) return;
  const active = getActiveVault();
  if (service.context.id !== active.id && database) importLegacyFocus(database, [active], active.id);
  const revision = service.snapshot().revision;
  service.setVault(active);
  if (service.snapshot().revision !== revision) for (const listener of contexts) listener();
}
export function getGlobalFocusSnapshot(): FocusSnapshot { synchronizeFocusVault(); return snapshot(); }
export function onGlobalFocusCompleted(callback: (payload: FocusSnapshot) => void): () => void {
  completions.add(callback); return () => { completions.delete(callback); };
}
export function onGlobalFocusContextChanged(callback: () => void): () => void {
  contexts.add(callback); return () => { contexts.delete(callback); };
}
export function pauseGlobalFocus(): void { service?.pause(); }
export function closeGlobalFocusRuntime(): void {
  pauseGlobalFocus(); database?.close(); database = null; service = null;
}

/** SQLite's backup API includes WAL pages without interrupting a running block. */
export async function snapshotGlobalFocusForBackup(): Promise<Buffer | null> {
  if (!database && !fs.existsSync(globalFocusFile())) return null;
  getGlobalFocusService().tick(true);
  const temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nodus-focus-backup-'));
  try {
    const file = path.join(temporary, 'focus.sqlite');
    await database!.backup(file);
    return await fs.promises.readFile(file);
  } finally { await fs.promises.rm(temporary, { recursive: true, force: true }); }
}
export function prepareGlobalFocusRestore(): void {
  closeGlobalFocusRuntime();
  for (const suffix of ['-wal', '-shm']) fs.rmSync(`${globalFocusFile()}${suffix}`, { force: true });
}
export function restoreGlobalFocusBackupFile(staged: string): void {
  const probe = new Database(staged, { readonly: true, fileMustExist: true });
  try {
    if (probe.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('La copia de Focus está dañada.');
    const row = probe.prepare('SELECT state_json FROM study_focus_state WHERE id = 1').get() as { state_json: string } | undefined;
    if (row) JSON.parse(row.state_json);
  } finally { probe.close(); }
  prepareGlobalFocusRestore();
  fs.mkdirSync(path.dirname(globalFocusFile()), { recursive: true });
  fs.renameSync(staged, globalFocusFile());
}
