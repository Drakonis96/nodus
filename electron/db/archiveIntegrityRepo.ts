import { v4 as uuid } from 'uuid';
import type { PrimarySourceIntegrityCheck } from '@shared/primarySourcesTypes';
import { getDb } from './database';

export type ArchiveIntegrityCheckRecord = PrimarySourceIntegrityCheck;

export function listIntegrityChecks(options: { fileId?: string; status?: string } = {}): ArchiveIntegrityCheckRecord[] {
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (options.fileId) { clauses.push('file_id=?'); values.push(options.fileId); }
  if (options.status) { clauses.push('status=?'); values.push(options.status); }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  return (getDb().prepare(
    `SELECT * FROM archive_integrity_checks${where} ORDER BY checked_at DESC`
  ).all(...values) as Array<{
    check_id: string; file_id: string; algorithm: 'sha256'; expected_hash: string | null;
    observed_hash: string | null; status: PrimarySourceIntegrityCheck['status']; checked_at: string; details: string | null;
  }>).map((row) => ({
    checkId: row.check_id, fileId: row.file_id, algorithm: row.algorithm,
    expectedHash: row.expected_hash, observedHash: row.observed_hash,
    status: row.status, checkedAt: row.checked_at, details: row.details,
  }));
}

export function recordArchiveExport(input: {
  kind: string;
  selection: unknown;
  policySnapshot: unknown;
  includedFiles: number;
  excludedFiles: number;
  manifestHash?: string | null;
}): string {
  const exportId = `aexpt_${uuid()}`;
  getDb().prepare(
    `INSERT INTO archive_exports (
      export_id, kind, selection_json, policy_snapshot_json, included_files,
      excluded_files, manifest_hash, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    exportId, input.kind, JSON.stringify(input.selection), JSON.stringify(input.policySnapshot),
    input.includedFiles, input.excludedFiles, input.manifestHash ?? null, new Date().toISOString()
  );
  return exportId;
}
