import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { auditQaDatabaseOpen } from '../qa/databaseAudit';
import type { MigrationRecoverySnapshot } from '@shared/types';

export const MAJOR_SCHEMA_VERSIONS = Object.freeze([134, 135]);

export interface MigrationSafetyReport {
  format: 'nodus.schema-migration-report';
  formatVersion: 1;
  id: string;
  sourceDatabasePath: string;
  fromVersion: number;
  targetVersion: number;
  startedAt: string;
  finishedAt: string;
  status: 'succeeded' | 'failed-restored' | 'failed-unrestored';
  backup: MigrationRecoverySnapshot | null;
  before: DatabaseFingerprint;
  after: DatabaseFingerprint | null;
  error: string | null;
}

interface DatabaseFingerprint {
  quickCheck: string;
  foreignKeyViolations: number;
  tables: Record<string, number>;
}

function sha256File(file: string): string {
  const hash = createHash('sha256');
  const descriptor = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytes = 0;
    do {
      bytes = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytes > 0) hash.update(buffer.subarray(0, bytes));
    } while (bytes > 0);
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

function migrationDirectory(databasePath: string): string {
  return path.join(path.dirname(databasePath), '.nodus', 'migrations');
}

function databaseFingerprint(db: Database.Database): DatabaseFingerprint {
  const tables = (db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all() as Array<{ name: string }>).map((row) => row.name);
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const escaped = table.replace(/"/g, '""');
    counts[table] = Number((db.prepare(`SELECT COUNT(*) AS n FROM "${escaped}"`).get() as { n: number }).n);
  }
  return {
    quickCheck: String(db.pragma('quick_check', { simple: true })),
    foreignKeyViolations: (db.pragma('foreign_key_check') as unknown[]).length,
    tables: counts,
  };
}

function snapshotFromManifest(value: unknown, manifestPath: string): MigrationRecoverySnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Partial<MigrationRecoverySnapshot> & { format?: string; formatVersion?: number };
  if (record.format !== 'nodus.schema-migration-snapshot' || record.formatVersion !== 1) return null;
  if (!record.id || !record.databasePath || !record.sourceDatabasePath || !record.sha256) return null;
  return {
    id: record.id,
    databasePath: path.resolve(record.databasePath),
    manifestPath,
    sourceDatabasePath: path.resolve(record.sourceDatabasePath),
    fromVersion: Number(record.fromVersion),
    targetVersion: Number(record.targetVersion),
    createdAt: String(record.createdAt),
    bytes: Number(record.bytes),
    sha256: record.sha256,
    quickCheck: String(record.quickCheck),
    immutable: Boolean(record.immutable),
    major: Boolean(record.major),
  };
}

function createVerifiedSnapshot(
  sourceDatabasePath: string,
  fromVersion: number,
  targetVersion: number,
  major: boolean,
): MigrationRecoverySnapshot {
  const sourceHash = sha256File(sourceDatabasePath);
  const directory = migrationDirectory(sourceDatabasePath);
  fs.mkdirSync(directory, { recursive: true });
  const id = `pre-v${targetVersion}-from-v${fromVersion}-${sourceHash.slice(0, 16)}`;
  const databasePath = path.join(directory, `${id}.sqlite`);
  const manifestPath = path.join(directory, `${id}.json`);

  if (!fs.existsSync(databasePath)) {
    try {
      fs.copyFileSync(sourceDatabasePath, databasePath, fs.constants.COPYFILE_FICLONE);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOTSUP' && code !== 'EINVAL' && code !== 'ENOSYS') throw error;
      fs.copyFileSync(sourceDatabasePath, databasePath);
    }
  }
  const backupHash = sha256File(databasePath);
  if (backupHash !== sourceHash) {
    fs.rmSync(databasePath, { force: true });
    throw new Error('La copia previa a la migración no coincide con el vault original.');
  }
  const check = new Database(databasePath, { readonly: true, fileMustExist: true });
  auditQaDatabaseOpen(databasePath, 'snapshot');
  let quickCheck = '';
  try {
    quickCheck = String(check.pragma('quick_check', { simple: true }));
  } finally {
    check.close();
  }
  if (quickCheck !== 'ok') throw new Error(`La copia previa a la migración no supera quick_check: ${quickCheck}`);
  fs.chmodSync(databasePath, 0o400);

  const snapshot: MigrationRecoverySnapshot = {
    id,
    databasePath,
    manifestPath,
    sourceDatabasePath: path.resolve(sourceDatabasePath),
    fromVersion,
    targetVersion,
    createdAt: new Date().toISOString(),
    bytes: fs.statSync(databasePath).size,
    sha256: backupHash,
    quickCheck,
    immutable: (fs.statSync(databasePath).mode & 0o222) === 0,
    major,
  };
  atomicWriteJson(manifestPath, { format: 'nodus.schema-migration-snapshot', formatVersion: 1, ...snapshot });
  return snapshot;
}

function restoreSnapshot(snapshot: MigrationRecoverySnapshot, originalMode: number): void {
  if (sha256File(snapshot.databasePath) !== snapshot.sha256) throw new Error('La copia de migración fue alterada y no se puede restaurar.');
  const target = snapshot.sourceDatabasePath;
  const staged = `${target}.restore-${process.pid}-${randomUUID()}`;
  try {
    fs.copyFileSync(snapshot.databasePath, staged);
    fs.chmodSync(staged, originalMode & 0o777);
    for (const candidate of [target, `${target}-wal`, `${target}-shm`]) fs.rmSync(candidate, { force: true });
    fs.renameSync(staged, target);
  } finally {
    fs.rmSync(staged, { force: true });
  }
  if (sha256File(target) !== snapshot.sha256) throw new Error('La restauración automática no coincide con la copia verificada.');
}

function writeMigrationReport(databasePath: string, report: MigrationSafetyReport): string {
  const directory = migrationDirectory(databasePath);
  const stamp = report.startedAt.replace(/[:.]/g, '-');
  const reportPath = path.join(directory, `report-${stamp}-${report.id}.json`);
  atomicWriteJson(reportPath, report);
  return reportPath;
}

export function listMigrationRecoverySnapshots(databasePath: string): MigrationRecoverySnapshot[] {
  const directory = migrationDirectory(databasePath);
  if (!fs.existsSync(directory)) return [];
  const snapshots: MigrationRecoverySnapshot[] = [];
  for (const name of fs.readdirSync(directory)) {
    if (!name.endsWith('.json') || name.startsWith('report-')) continue;
    const manifestPath = path.join(directory, name);
    try {
      const snapshot = snapshotFromManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')), manifestPath);
      if (!snapshot || !fs.existsSync(snapshot.databasePath)) continue;
      if (sha256File(snapshot.databasePath) !== snapshot.sha256) continue;
      if ((fs.statSync(snapshot.databasePath).mode & 0o222) !== 0) continue;
      const check = new Database(snapshot.databasePath, { readonly: true, fileMustExist: true });
      auditQaDatabaseOpen(snapshot.databasePath, 'read-only');
      try {
        if (String(check.pragma('quick_check', { simple: true })) !== 'ok') continue;
      } finally {
        check.close();
      }
      snapshots.push(snapshot);
    } catch {
      // A damaged sidecar is ignored; it never makes an unverified file available to UI.
    }
  }
  return snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Migrates an already-open database and returns the live handle that callers must use.
 * Existing vaults are checkpointed, closed, copied byte-for-byte and verified before a
 * single migration runs. A failure restores that exact copy atomically, even when earlier
 * pending versions had already committed successfully.
 */
export function migrateDatabaseSafely(
  database: Database.Database,
  databasePath: string,
  targetVersion: number,
  migrate: (db: Database.Database) => void,
): Database.Database {
  const fromVersion = Number(database.pragma('user_version', { simple: true }));
  if (fromVersion >= targetVersion) {
    migrate(database);
    return database;
  }

  const startedAt = new Date().toISOString();
  const id = randomUUID();
  database.pragma('foreign_keys = ON');
  const before = databaseFingerprint(database);
  if (before.quickCheck !== 'ok') throw new Error(`El vault no supera quick_check antes de migrar: ${before.quickCheck}`);
  const originalMode = fs.statSync(databasePath).mode;
  const major = MAJOR_SCHEMA_VERSIONS.some((version) => version > fromVersion && version <= targetVersion);
  let snapshot: MigrationRecoverySnapshot | null = null;

  if (fromVersion > 0) {
    database.pragma('wal_checkpoint(TRUNCATE)');
    database.close();
    snapshot = createVerifiedSnapshot(databasePath, fromVersion, targetVersion, major);
    database = new Database(databasePath);
    auditQaDatabaseOpen(databasePath, 'read-write');
  }

  try {
    database.pragma('foreign_keys = ON');
    migrate(database);
    const after = databaseFingerprint(database);
    if (after.quickCheck !== 'ok' || after.foreignKeyViolations !== 0) {
      throw new Error(`La migración terminó con integridad inválida (quick_check=${after.quickCheck}, foreign_keys=${after.foreignKeyViolations}).`);
    }
    const report: MigrationSafetyReport = {
      format: 'nodus.schema-migration-report', formatVersion: 1, id,
      sourceDatabasePath: path.resolve(databasePath), fromVersion, targetVersion,
      startedAt, finishedAt: new Date().toISOString(), status: 'succeeded',
      backup: snapshot, before, after, error: null,
    };
    const reportPath = writeMigrationReport(databasePath, report);
    if (database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migration_events'").get()) {
      database.prepare(
        `INSERT OR REPLACE INTO schema_migration_events
           (id, from_version, target_version, status, report_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(id, fromVersion, targetVersion, report.status, reportPath, report.finishedAt);
    }
    return database;
  } catch (cause) {
    if (database.open) database.close();
    let restored = false;
    let restorationError: unknown = null;
    if (snapshot) {
      try {
        restoreSnapshot(snapshot, originalMode);
        const check = new Database(databasePath, { readonly: true, fileMustExist: true });
        auditQaDatabaseOpen(databasePath, 'read-only');
        try {
          restored = String(check.pragma('quick_check', { simple: true })) === 'ok'
            && Number(check.pragma('user_version', { simple: true })) === fromVersion;
        } finally {
          check.close();
        }
      } catch (error) {
        restorationError = error;
      }
    }
    const errorText = cause instanceof Error ? cause.stack ?? cause.message : String(cause);
    const report: MigrationSafetyReport = {
      format: 'nodus.schema-migration-report', formatVersion: 1, id,
      sourceDatabasePath: path.resolve(databasePath), fromVersion, targetVersion,
      startedAt, finishedAt: new Date().toISOString(),
      status: restored ? 'failed-restored' : 'failed-unrestored',
      backup: snapshot, before, after: null,
      error: restorationError ? `${errorText}\nRestauración: ${String(restorationError)}` : errorText,
    };
    writeMigrationReport(databasePath, report);
    const suffix = restored ? ' El vault original se restauró automáticamente.' : ' No se pudo restaurar automáticamente.';
    throw new Error(`La migración del vault falló.${suffix}`, { cause });
  }
}
