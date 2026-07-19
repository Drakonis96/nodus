import crypto from 'node:crypto';
import { v4 as uuid } from 'uuid';
import type { ProtectArtifact, ProtectSourceKind, ProtectVaultCopySummary } from '@shared/types';
import { getDb } from './database';

interface ProtectCopyRow {
  id: string;
  file_name: string;
  mime_type: string;
  bytes: number;
  sha256: string;
  source_kind: ProtectSourceKind | 'mixed' | null;
  source_label: string | null;
  created_at: string;
  updated_at: string;
}

const SUMMARY_COLUMNS = `id, file_name, mime_type, bytes, sha256, source_kind,
  source_label, created_at, updated_at`;

function toSummary(row: ProtectCopyRow): ProtectVaultCopySummary {
  return {
    id: row.id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    bytes: row.bytes,
    sha256: row.sha256,
    sourceKind: row.source_kind,
    sourceLabel: row.source_label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listProtectCopies(query = ''): ProtectVaultCopySummary[] {
  const term = query.trim();
  const rows = term
    ? getDb().prepare(
      `SELECT ${SUMMARY_COLUMNS} FROM protect_copies
       WHERE deleted_at IS NULL AND (file_name LIKE ? ESCAPE '\\' OR source_label LIKE ? ESCAPE '\\')
       ORDER BY updated_at DESC`,
    ).all(`%${term.replace(/[\\%_]/g, '\\$&')}%`, `%${term.replace(/[\\%_]/g, '\\$&')}%`) as ProtectCopyRow[]
    : getDb().prepare(
      `SELECT ${SUMMARY_COLUMNS} FROM protect_copies WHERE deleted_at IS NULL ORDER BY updated_at DESC`,
    ).all() as ProtectCopyRow[];
  return rows.map(toSummary);
}

export function getProtectCopy(id: string): ProtectVaultCopySummary | null {
  const row = getDb().prepare(
    `SELECT ${SUMMARY_COLUMNS} FROM protect_copies WHERE id = ? AND deleted_at IS NULL`,
  ).get(id) as ProtectCopyRow | undefined;
  return row ? toSummary(row) : null;
}

export function getProtectCopyBlob(id: string): Buffer | null {
  const row = getDb().prepare(
    'SELECT blob FROM protect_copies WHERE id = ? AND deleted_at IS NULL',
  ).get(id) as { blob: Buffer | null } | undefined;
  return row?.blob ?? null;
}

export function saveProtectCopy(artifact: ProtectArtifact): ProtectVaultCopySummary {
  const bytes = Buffer.from(artifact.bytes);
  const now = new Date().toISOString();
  const id = uuid();
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  getDb().prepare(
    `INSERT INTO protect_copies
      (id, file_name, mime_type, bytes, sha256, blob, source_kind, source_label, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).run(
    id,
    artifact.fileName,
    artifact.mimeType,
    bytes.length,
    sha256,
    bytes,
    artifact.sourceKind ?? null,
    artifact.sourceLabel?.trim() || null,
    now,
    now,
  );
  return getProtectCopy(id)!;
}

export function deleteProtectCopy(id: string): void {
  const now = new Date().toISOString();
  getDb().prepare(
    `UPDATE protect_copies
     SET blob = NULL, bytes = 0, deleted_at = ?, updated_at = ?
     WHERE id = ? AND deleted_at IS NULL`,
  ).run(now, now, id);
}
