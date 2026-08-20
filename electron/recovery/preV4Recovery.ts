// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const FORMAT = 'nodus.pre-v4-recovery';
const FORMAT_VERSION = 1;
const MARKER_FILE = 'pre-v4-recovery.json';
const LIBRARY_RECOVERY_RELATIVE = path.join('.nodus', 'recovery', 'pre-v4');
const PROFILE_FILES = [
  'app-prefs.json',
  'browser-bookmarks.json',
  'vaults.json',
  'nodi-chat-history.json',
  'nodi-notes.json',
  'nodi-notifications.json',
  'nodi-welcome.seed',
] as const;
const VAULT_SIDECARS = [
  'manifest.json',
  'remote.json',
  'study-chat-history.json',
  'study-search-index.json',
  'study-audio-meta.json',
] as const;

interface RecoveryFile {
  archivePath: string;
  sourcePath: string;
  bytes: number;
  sha256: string;
}

interface RecoveryVault {
  id: string;
  databasePath: string;
  archivePath: string;
  schemaVersion: number;
  bytes: number;
  sha256: string;
}

export interface PreV4RecoveryManifest {
  format: typeof FORMAT;
  formatVersion: typeof FORMAT_VERSION;
  sourceVersion: '3.2.7-or-earlier';
  targetVersion: string;
  createdAt: string;
  userDataDirectory: string;
  libraryRoot: string | null;
  files: RecoveryFile[];
  vaults: RecoveryVault[];
  skippedSymbolicLinks: string[];
}

export interface PreV4RecoveryResult {
  status: 'created' | 'already-created' | 'fresh-profile' | 'not-required';
  snapshotPath: string | null;
  manifest: PreV4RecoveryManifest | null;
}

interface PreV4RecoveryOptions {
  userDataDirectory: string;
  targetVersion: string;
  now?: Date;
  /** Test seam and alternate-filesystem seam. Production uses copy-on-write when supported. */
  copyFile?: (source: string, target: string) => Promise<void>;
}

function sha256File(file: string): string {
  const hash = createHash('sha256');
  const descriptor = fs.openSync(file, 'r');
  const chunk = Buffer.allocUnsafe(1024 * 1024);
  try {
    let count = 0;
    do {
      count = fs.readSync(descriptor, chunk, 0, chunk.length, null);
      if (count > 0) hash.update(chunk.subarray(0, count));
    } while (count > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function atomicWriteJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function configuredLibraryRoot(userDataDirectory: string): string | null {
  const prefs = readJson(path.join(userDataDirectory, 'app-prefs.json'));
  const folder = typeof prefs?.autoBackupFolder === 'string' ? prefs.autoBackupFolder.trim() : '';
  return folder ? path.join(path.resolve(folder), 'nodus-library') : null;
}

function rawVaults(userDataDirectory: string): { id: string; databasePath: string }[] {
  const fallback = { id: 'default', databasePath: path.join(userDataDirectory, 'nodus.sqlite') };
  const registry = readJson(path.join(userDataDirectory, 'vaults.json'));
  const rows = Array.isArray(registry?.vaults) ? registry.vaults : [];
  const result = rows.flatMap((row): { id: string; databasePath: string }[] => {
    if (!row || typeof row !== 'object') return [];
    const record = row as Record<string, unknown>;
    if (typeof record.id !== 'string' || typeof record.path !== 'string') return [];
    return [{ id: record.id, databasePath: path.resolve(record.path) }];
  });
  if (!result.some((vault) => vault.databasePath === fallback.databasePath)) result.unshift(fallback);
  return [...new Map(result.map((vault) => [vault.databasePath, vault])).values()];
}

function safeSegment(value: string): string {
  const slug = value.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'vault';
  return `${slug}-${createHash('sha256').update(value).digest('hex').slice(0, 10)}`;
}

async function defaultCopyFile(source: string, target: string): Promise<void> {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    await fs.promises.copyFile(source, target, fs.constants.COPYFILE_FICLONE);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOTSUP' && code !== 'EINVAL' && code !== 'ENOSYS') throw error;
    await fs.promises.copyFile(source, target);
  }
}

async function copyVerified(
  source: string,
  archivePath: string,
  stagingRoot: string,
  copyFile: (source: string, target: string) => Promise<void>,
): Promise<RecoveryFile> {
  const target = path.join(stagingRoot, ...archivePath.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  await copyFile(source, target);
  const sourceHash = sha256File(source);
  const targetHash = sha256File(target);
  if (sourceHash !== targetHash) throw new Error(`The pre-v4 recovery copy of ${source} did not verify.`);
  return { archivePath, sourcePath: source, bytes: fs.statSync(target).size, sha256: targetHash };
}

async function walkLibrary(
  root: string,
  directory: string,
  stagingRoot: string,
  copyFile: (source: string, target: string) => Promise<void>,
  files: RecoveryFile[],
  skippedSymbolicLinks: string[],
): Promise<void> {
  const entries = await fs.promises.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const source = path.join(directory, entry.name);
    const relative = path.relative(root, source);
    if (!relative || relative === LIBRARY_RECOVERY_RELATIVE || relative.startsWith(`${LIBRARY_RECOVERY_RELATIVE}${path.sep}`)) continue;
    if (entry.isSymbolicLink()) {
      skippedSymbolicLinks.push(source);
      continue;
    }
    if (entry.isDirectory()) {
      await walkLibrary(root, source, stagingRoot, copyFile, files, skippedSymbolicLinks);
      continue;
    }
    if (!entry.isFile() || entry.name.includes('.tmp-') || entry.name.includes('.restore-')) continue;
    const archivePath = `global-library/${relative.split(path.sep).map(encodeURIComponent).join('/')}`;
    files.push(await copyVerified(source, archivePath, stagingRoot, copyFile));
  }
}

function markerPath(userDataDirectory: string): string {
  return path.join(userDataDirectory, '.nodus', MARKER_FILE);
}

function readCompletedMarker(userDataDirectory: string): { snapshotPath: string | null; status: string } | null {
  const marker = readJson(markerPath(userDataDirectory));
  if (marker?.format !== FORMAT || marker.formatVersion !== FORMAT_VERSION || typeof marker.status !== 'string') return null;
  if (marker.status === 'fresh-profile') return { snapshotPath: null, status: marker.status };
  if (typeof marker.snapshotPath !== 'string') return null;
  const manifest = readJson(path.join(marker.snapshotPath, 'recovery.json'));
  return manifest?.format === FORMAT && manifest.formatVersion === FORMAT_VERSION
    ? { snapshotPath: marker.snapshotPath, status: marker.status }
    : null;
}

function majorVersion(version: string): number {
  const value = Number.parseInt(version.split('.')[0] ?? '', 10);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Create one verified, immutable recovery copy before Nodus 4 opens a database or
 * rewrites a Library manifest. The completion marker is written last, so interruption
 * can only cause this function to retry; it can never make an incomplete copy trusted.
 */
export async function ensurePreV4Recovery(options: PreV4RecoveryOptions): Promise<PreV4RecoveryResult> {
  const userDataDirectory = path.resolve(options.userDataDirectory);
  if (majorVersion(options.targetVersion) < 4) return { status: 'not-required', snapshotPath: null, manifest: null };
  const completed = readCompletedMarker(userDataDirectory);
  if (completed) {
    const manifest = completed.snapshotPath
      ? readJson(path.join(completed.snapshotPath, 'recovery.json')) as unknown as PreV4RecoveryManifest
      : null;
    return { status: completed.status === 'fresh-profile' ? 'fresh-profile' : 'already-created', snapshotPath: completed.snapshotPath, manifest };
  }

  const vaults = rawVaults(userDataDirectory).filter((vault) => {
    try { return fs.statSync(vault.databasePath).isFile() && fs.statSync(vault.databasePath).size > 0; } catch { return false; }
  });
  const libraryRoot = configuredLibraryRoot(userDataDirectory);
  const hasLibrary = Boolean(libraryRoot && fs.existsSync(libraryRoot) && fs.readdirSync(libraryRoot).some((name) => name !== '.DS_Store'));
  const profileFiles = PROFILE_FILES.map((name) => path.join(userDataDirectory, name)).filter((file) => fs.existsSync(file));
  if (vaults.length === 0 && !hasLibrary && profileFiles.length === 0) {
    atomicWriteJson(markerPath(userDataDirectory), {
      format: FORMAT, formatVersion: FORMAT_VERSION, status: 'fresh-profile', targetVersion: options.targetVersion,
      createdAt: (options.now ?? new Date()).toISOString(),
    });
    return { status: 'fresh-profile', snapshotPath: null, manifest: null };
  }

  const createdAt = (options.now ?? new Date()).toISOString();
  const stamp = createdAt.replace(/[^0-9]/g, '').slice(0, 14);
  const recoveryParent = libraryRoot
    ? path.join(libraryRoot, LIBRARY_RECOVERY_RELATIVE)
    : path.join(userDataDirectory, 'recovery', 'pre-v4');
  fs.mkdirSync(recoveryParent, { recursive: true });
  const snapshotPath = path.join(recoveryParent, `${stamp}-from-3.2.7`);
  const stagingRoot = `${snapshotPath}.incomplete-${process.pid}-${randomUUID()}`;
  fs.mkdirSync(stagingRoot, { recursive: true });
  const copyFile = options.copyFile ?? defaultCopyFile;
  const files: RecoveryFile[] = [];
  const recoveryVaults: RecoveryVault[] = [];
  const skippedSymbolicLinks: string[] = [];

  try {
    for (const source of profileFiles) {
      files.push(await copyVerified(source, `profile/${path.basename(source)}`, stagingRoot, copyFile));
    }
    for (const vault of vaults) {
      const segment = safeSegment(vault.id);
      const archivePath = `vaults/${segment}/database.sqlite`;
      const target = path.join(stagingRoot, ...archivePath.split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const sourceDb = new Database(vault.databasePath, { readonly: true, fileMustExist: true });
      let schemaVersion = 0;
      try {
        schemaVersion = sourceDb.pragma('user_version', { simple: true }) as number;
        await sourceDb.backup(target);
      } finally {
        sourceDb.close();
      }
      const probe = new Database(target, { readonly: true, fileMustExist: true });
      try {
        if (probe.pragma('quick_check', { simple: true }) !== 'ok') throw new Error(`The pre-v4 database copy of ${vault.id} is corrupt.`);
      } finally {
        probe.close();
      }
      const hash = sha256File(target);
      recoveryVaults.push({ id: vault.id, databasePath: vault.databasePath, archivePath, schemaVersion, bytes: fs.statSync(target).size, sha256: hash });
      for (const name of VAULT_SIDECARS) {
        const sidecar = path.join(path.dirname(vault.databasePath), name);
        if (fs.existsSync(sidecar) && fs.statSync(sidecar).isFile()) {
          files.push(await copyVerified(sidecar, `vaults/${segment}/sidecars/${encodeURIComponent(name)}`, stagingRoot, copyFile));
        }
      }
    }
    if (hasLibrary && libraryRoot) {
      await walkLibrary(libraryRoot, libraryRoot, stagingRoot, copyFile, files, skippedSymbolicLinks);
    }
    const manifest: PreV4RecoveryManifest = {
      format: FORMAT,
      formatVersion: FORMAT_VERSION,
      sourceVersion: '3.2.7-or-earlier',
      targetVersion: options.targetVersion,
      createdAt,
      userDataDirectory,
      libraryRoot,
      files,
      vaults: recoveryVaults,
      skippedSymbolicLinks,
    };
    atomicWriteJson(path.join(stagingRoot, 'recovery.json'), manifest);
    fs.renameSync(stagingRoot, snapshotPath);
    atomicWriteJson(markerPath(userDataDirectory), {
      format: FORMAT, formatVersion: FORMAT_VERSION, status: 'completed', targetVersion: options.targetVersion,
      createdAt, snapshotPath,
    });
    return { status: 'created', snapshotPath, manifest };
  } catch (error) {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}

function verifiedManifest(snapshotPath: string): PreV4RecoveryManifest {
  const manifest = readJson(path.join(snapshotPath, 'recovery.json')) as unknown as PreV4RecoveryManifest | null;
  if (!manifest || manifest.format !== FORMAT || manifest.formatVersion !== FORMAT_VERSION) {
    throw new Error('This is not a valid Nodus pre-v4 recovery copy.');
  }
  for (const entry of manifest.files) {
    const file = path.resolve(snapshotPath, ...entry.archivePath.split('/'));
    if (!file.startsWith(`${path.resolve(snapshotPath)}${path.sep}`) || !fs.existsSync(file) || sha256File(file) !== entry.sha256) {
      throw new Error(`The pre-v4 recovery file ${entry.archivePath} did not verify.`);
    }
  }
  for (const vault of manifest.vaults) {
    const file = path.resolve(snapshotPath, ...vault.archivePath.split('/'));
    if (!file.startsWith(`${path.resolve(snapshotPath)}${path.sep}`) || !fs.existsSync(file) || sha256File(file) !== vault.sha256) {
      throw new Error(`The pre-v4 recovery database ${vault.id} did not verify.`);
    }
  }
  return manifest;
}

function replaceFileRecoverably(source: string, target: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const incoming = `${target}.pre-v4-incoming-${process.pid}-${randomUUID()}`;
  const displaced = `${target}.pre-v4-displaced-${process.pid}-${randomUUID()}`;
  fs.copyFileSync(source, incoming);
  try {
    if (fs.existsSync(target)) fs.renameSync(target, displaced);
    fs.renameSync(incoming, target);
    fs.rmSync(displaced, { force: true });
  } catch (error) {
    fs.rmSync(incoming, { force: true });
    if (fs.existsSync(displaced) && !fs.existsSync(target)) fs.renameSync(displaced, target);
    throw error;
  }
}

function stageRecoveredLibrary(snapshotRoot: string, manifest: PreV4RecoveryManifest): string | null {
  if (!manifest.libraryRoot) return null;
  const root = path.resolve(manifest.libraryRoot);
  const entries = manifest.files.filter((entry) => entry.archivePath.startsWith('global-library/'));
  if (entries.length === 0) return null;
  const staging = `${root}.pre-v4-incoming-${process.pid}-${randomUUID()}`;
  fs.mkdirSync(staging, { recursive: true });
  try {
    for (const entry of entries) {
      const targetSource = path.resolve(entry.sourcePath);
      if (!targetSource.startsWith(`${root}${path.sep}`)) throw new Error('The pre-v4 Library manifest contains an invalid target path.');
      const relative = path.relative(root, targetSource);
      const target = path.join(staging, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(snapshotRoot, ...entry.archivePath.split('/')), target);
    }
    return staging;
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

function applyRecoveredLibrary(snapshotRoot: string, manifest: PreV4RecoveryManifest, staging: string | null): void {
  if (!manifest.libraryRoot || !staging) return;
  const root = path.resolve(manifest.libraryRoot);
  const displaced = `${root}.v4-before-pre-v4-restore-${process.pid}-${randomUUID()}`;
  const snapshotRelative = path.relative(root, snapshotRoot);
  const snapshotWasInside = snapshotRelative && !snapshotRelative.startsWith('..') && !path.isAbsolute(snapshotRelative);
  try {
    if (fs.existsSync(root)) fs.renameSync(root, displaced);
    fs.renameSync(staging, root);
    // The verified recovery package belongs to the restored Library too. Move it from
    // the displaced v4 tree before discarding that tree, keeping the marker path stable.
    if (snapshotWasInside) {
      const displacedSnapshot = path.join(displaced, snapshotRelative);
      const restoredSnapshot = path.join(root, snapshotRelative);
      fs.mkdirSync(path.dirname(restoredSnapshot), { recursive: true });
      if (fs.existsSync(displacedSnapshot)) fs.renameSync(displacedSnapshot, restoredSnapshot);
    }
    fs.rmSync(displaced, { recursive: true, force: true });
  } catch (error) {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    // Roll back only while the old complete tree is still available and the target did
    // not land. If the new tree did land, retain both trees for manual recovery.
    if (fs.existsSync(displaced) && !fs.existsSync(root)) fs.renameSync(displaced, root);
    throw error;
  }
}

/** Restore the exact pre-v4 files after validating every hash. Call only with databases closed. */
export function restorePreV4Recovery(snapshotPath: string): PreV4RecoveryManifest {
  const root = path.resolve(snapshotPath);
  const manifest = verifiedManifest(root);
  const stagedLibrary = stageRecoveredLibrary(root, manifest);
  try {
    for (const vault of manifest.vaults) {
      replaceFileRecoverably(path.join(root, ...vault.archivePath.split('/')), vault.databasePath);
      fs.rmSync(`${vault.databasePath}-wal`, { force: true });
      fs.rmSync(`${vault.databasePath}-shm`, { force: true });
    }
    for (const entry of manifest.files.filter((file) => file.archivePath.startsWith('profile/') || file.archivePath.includes('/sidecars/'))) {
      replaceFileRecoverably(path.join(root, ...entry.archivePath.split('/')), entry.sourcePath);
    }
    applyRecoveredLibrary(root, manifest, stagedLibrary);
    return manifest;
  } catch (error) {
    if (stagedLibrary && fs.existsSync(stagedLibrary)) fs.rmSync(stagedLibrary, { recursive: true, force: true });
    throw error;
  }
}
