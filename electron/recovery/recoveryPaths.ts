import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const RECOVERY_FORMAT = 'nodus.recovery-root';
export const RECOVERY_FORMAT_VERSION = 1;
export const RECOVERY_MANIFEST_FILE = 'nodus-recovery.json';
export const RECOVERY_SNAPSHOTS_DIR = 'snapshots';

export interface RecoveryRootManifest {
  format: typeof RECOVERY_FORMAT;
  formatVersion: typeof RECOVERY_FORMAT_VERSION;
  recoveryId: string;
  createdAt: string;
  createdByHost: string;
}

export function recoveryManifestPath(root: string): string {
  return path.join(root, RECOVERY_MANIFEST_FILE);
}

export function recoverySnapshotsDir(root: string): string {
  return path.join(root, RECOVERY_SNAPSHOTS_DIR);
}

export function readRecoveryManifest(root: string): RecoveryRootManifest | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(recoveryManifestPath(root), 'utf8')) as RecoveryRootManifest;
    if (parsed.format !== RECOVERY_FORMAT || parsed.formatVersion !== RECOVERY_FORMAT_VERSION || !parsed.recoveryId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function createRecoveryManifest(): RecoveryRootManifest {
  return {
    format: RECOVERY_FORMAT,
    formatVersion: RECOVERY_FORMAT_VERSION,
    recoveryId: randomUUID(),
    createdAt: new Date().toISOString(),
    createdByHost: os.hostname(),
  };
}

export function writeRecoveryManifest(root: string, manifest: RecoveryRootManifest): void {
  fs.mkdirSync(root, { recursive: true });
  const target = recoveryManifestPath(root);
  const temporary = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, JSON.stringify(manifest, null, 2), 'utf8');
  fs.renameSync(temporary, target);
}

export function resolveBackupOutputDir(configuredFolder: string): string {
  return readRecoveryManifest(configuredFolder) ? recoverySnapshotsDir(configuredFolder) : configuredFolder;
}

export function visibleDirectoryEntries(folder: string): string[] {
  return fs.readdirSync(folder).filter((name) => name !== '.DS_Store' && name !== 'Thumbs.db');
}
