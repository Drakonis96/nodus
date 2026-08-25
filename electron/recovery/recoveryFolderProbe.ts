import fs from 'node:fs';
import path from 'node:path';
import type { RecoverySnapshotSummary } from '@shared/types';
import { readZipEntrySync } from '../export/zipFile';
import {
  readRecoveryManifest,
  recoverySnapshotsDir,
  visibleDirectoryEntries,
} from './recoveryPaths';

export type RecoveryProbeMode = 'cached' | 'deep';

export interface RecoveryFolderProbe {
  path: string;
  kind: 'empty' | 'recovery' | 'invalid' | 'missing';
  snapshots: RecoverySnapshotSummary[];
  visibleEntries?: number;
}

interface OuterBackupManifest {
  format: string;
  formatVersion: number;
  schemaVersion: number;
  appVersion: string;
  date: string;
  includesSecrets?: boolean;
  vaultCount?: number;
}

interface RecoverySnapshotIndex {
  format: 'nodus.recovery-snapshot-index';
  formatVersion: 1;
  updatedAt: string;
  snapshots: Omit<RecoverySnapshotSummary, 'path'>[];
}

export const RECOVERY_SNAPSHOT_INDEX_FILE = 'nodus-recovery-index.json';

function recoverySnapshotIndexPath(root: string): string {
  return path.join(root, RECOVERY_SNAPSHOT_INDEX_FILE);
}

function safeIndexedSummary(root: string, value: Omit<RecoverySnapshotSummary, 'path'>): RecoverySnapshotSummary | null {
  if (!value || path.basename(value.fileName) !== value.fileName || !value.fileName.endsWith('.nodus')) return null;
  if (!value.date || !value.appVersion || !Number.isFinite(value.schemaVersion) || !Number.isFinite(value.bytes)) return null;
  return { ...value, path: path.join(recoverySnapshotsDir(root), value.fileName) };
}

export function readRecoverySnapshotIndex(root: string): RecoverySnapshotSummary[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(recoverySnapshotIndexPath(root), 'utf8')) as RecoverySnapshotIndex;
    if (parsed.format !== 'nodus.recovery-snapshot-index' || parsed.formatVersion !== 1 || !Array.isArray(parsed.snapshots)) return [];
    return parsed.snapshots
      .map((snapshot) => safeIndexedSummary(root, snapshot))
      .filter((snapshot): snapshot is RecoverySnapshotSummary => snapshot !== null)
      .sort((a, b) => b.date.localeCompare(a.date));
  } catch {
    return [];
  }
}

export function writeRecoverySnapshotIndex(root: string, snapshots: RecoverySnapshotSummary[]): void {
  if (!readRecoveryManifest(root)) return;
  const target = recoverySnapshotIndexPath(root);
  const temporary = `${target}.tmp-${process.pid}`;
  const payload: RecoverySnapshotIndex = {
    format: 'nodus.recovery-snapshot-index',
    formatVersion: 1,
    updatedAt: new Date().toISOString(),
    snapshots: snapshots.map(({ path: _snapshotPath, ...snapshot }) => snapshot),
  };
  fs.writeFileSync(temporary, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(temporary, target);
}

/** Update the tiny sidecar only after a snapshot has been fully authenticated. */
export function recordVerifiedRecoverySnapshot(root: string, snapshot: RecoverySnapshotSummary): void {
  if (!readRecoveryManifest(root)) return;
  const snapshotsDir = recoverySnapshotsDir(root);
  let survivingNames: Set<string>;
  try {
    survivingNames = new Set(fs.readdirSync(snapshotsDir).filter((name) => name.endsWith('.nodus')));
  } catch {
    survivingNames = new Set([snapshot.fileName]);
  }
  const byName = new Map(
    readRecoverySnapshotIndex(root)
      .filter((item) => survivingNames.has(item.fileName))
      .map((item) => [item.fileName, item]),
  );
  byName.set(snapshot.fileName, snapshot);
  writeRecoverySnapshotIndex(root, [...byName.values()].sort((a, b) => b.date.localeCompare(a.date)));
}

export function snapshotSummary(filePath: string): RecoverySnapshotSummary | null {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    const manifestBytes = readZipEntrySync(filePath, 'manifest.json', 1024 * 1024);
    if (!manifestBytes) return null;
    const manifest = JSON.parse(manifestBytes.toString('utf8')) as OuterBackupManifest;
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
 * Filesystem-only probe designed to run outside Electron's main process. Cached mode
 * never opens a .nodus archive, so a cloud placeholder cannot trigger hydration at
 * startup. Deep mode is reserved for an explicit restore-folder selection.
 */
export function probeRecoveryFolder(folder: string, mode: RecoveryProbeMode = 'deep'): RecoveryFolderProbe {
  const clean = path.resolve(folder);
  if (!fs.existsSync(clean)) return { path: clean, kind: 'missing', snapshots: [] };
  let stat: fs.Stats;
  try {
    stat = fs.statSync(clean);
  } catch {
    return { path: clean, kind: 'missing', snapshots: [] };
  }
  if (!stat.isDirectory()) return { path: clean, kind: 'invalid', snapshots: [] };

  if (readRecoveryManifest(clean)) {
    const snapshotsDir = recoverySnapshotsDir(clean);
    const cached = readRecoverySnapshotIndex(clean);
    if (mode === 'cached') return { path: clean, kind: 'recovery', snapshots: cached };

    const cachedByName = new Map(cached.map((snapshot) => [snapshot.fileName, snapshot]));
    let names: string[] = [];
    try {
      names = fs.readdirSync(snapshotsDir).filter((name) => name.endsWith('.nodus'));
    } catch {
      /* a valid root may not have its snapshots directory yet */
    }
    const snapshots = names
      .map((name) => cachedByName.get(name) ?? snapshotSummary(path.join(snapshotsDir, name)))
      .filter((item): item is RecoverySnapshotSummary => item !== null)
      .sort((a, b) => b.date.localeCompare(a.date));
    return { path: clean, kind: 'recovery', snapshots };
  }

  const entries = visibleDirectoryEntries(clean);
  return entries.length === 0
    ? { path: clean, kind: 'empty', snapshots: [] }
    : { path: clean, kind: 'invalid', snapshots: [], visibleEntries: entries.length };
}
