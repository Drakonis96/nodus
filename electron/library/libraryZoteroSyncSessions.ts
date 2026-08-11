import fs from 'node:fs';
import path from 'node:path';
import type { ZoteroImportProgress, ZoteroImportReport, ZoteroImportSelection, ZoteroSyncSession } from '@shared/libraryTypes';
import { atomicWriteJson, readJsonFile, safeLibraryFolderName } from './libraryPaths';

function isSession(value: unknown): value is ZoteroSyncSession {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<ZoteroSyncSession>;
  return record.format === 'nodus.zotero-sync' && record.formatVersion === 1
    && typeof record.id === 'string' && ['running', 'canceled', 'failed', 'completed'].includes(String(record.status))
    && !!record.progress && typeof record.startedAt === 'string' && typeof record.updatedAt === 'string';
}

export class ZoteroSyncSessionStore {
  private readonly folder: string;

  constructor(root: string) {
    this.folder = path.join(root, '.nodus', 'zotero-sync');
  }

  private file(id: string): string {
    return path.join(this.folder, `${safeLibraryFolderName(id)}.json`);
  }

  get(id: string): ZoteroSyncSession | null {
    const value = readJsonFile<unknown>(this.file(id));
    return isSession(value) ? value : null;
  }

  list(): ZoteroSyncSession[] {
    if (!fs.existsSync(this.folder)) return [];
    return fs.readdirSync(this.folder, { withFileTypes: true }).flatMap((entry) => {
      if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name.includes('.tmp-')) return [];
      const value = readJsonFile<unknown>(path.join(this.folder, entry.name));
      return isSession(value) ? [value] : [];
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  begin(id: string, selection: ZoteroImportSelection, progress: ZoteroImportProgress, now = new Date().toISOString()): ZoteroSyncSession {
    const previous = this.get(id);
    const session: ZoteroSyncSession = {
      format: 'nodus.zotero-sync', formatVersion: 1, id, status: 'running', selection,
      progress, report: null, startedAt: previous?.startedAt ?? now, updatedAt: now, error: null,
    };
    atomicWriteJson(this.file(id), session);
    return session;
  }

  progress(id: string, value: ZoteroImportProgress, now = new Date().toISOString()): ZoteroSyncSession | null {
    const current = this.get(id);
    if (!current) return null;
    const session = { ...current, status: 'running' as const, progress: value, updatedAt: now, error: null };
    atomicWriteJson(this.file(id), session);
    return session;
  }

  finish(id: string, status: Exclude<ZoteroSyncSession['status'], 'running'>, report: ZoteroImportReport, error: string | null = null, now = new Date().toISOString()): ZoteroSyncSession | null {
    const current = this.get(id);
    if (!current) return null;
    const session: ZoteroSyncSession = { ...current, status, report, updatedAt: now, error };
    atomicWriteJson(this.file(id), session);
    return session;
  }
}
