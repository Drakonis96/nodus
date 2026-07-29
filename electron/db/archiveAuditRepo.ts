import { randomUUID } from 'node:crypto';
import type { PrimarySourceAuditEvent } from '@shared/primarySourcesTypes';
import { getDb } from './database';

type AuditRow = {
  event_id: string;
  item_id: string;
  file_id: string | null;
  action: PrimarySourceAuditEvent['action'];
  details_json: string;
  created_by: string | null;
  created_at: string;
};

function parseDetails(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function fromRow(row: AuditRow): PrimarySourceAuditEvent {
  return {
    eventId: row.event_id,
    itemId: row.item_id,
    fileId: row.file_id,
    action: row.action,
    details: parseDetails(row.details_json),
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export function recordArchiveAudit(input: {
  itemId: string;
  fileId?: string | null;
  action: PrimarySourceAuditEvent['action'];
  details?: Record<string, unknown>;
  createdBy?: string | null;
  createdAt?: string;
}): PrimarySourceAuditEvent {
  const eventId = `aal_${randomUUID()}`;
  const createdAt = input.createdAt ?? new Date().toISOString();
  getDb().prepare(
    `INSERT INTO archive_audit_log (
      event_id, item_id, file_id, action, details_json, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    eventId,
    input.itemId,
    input.fileId ?? null,
    input.action,
    JSON.stringify(input.details ?? {}),
    input.createdBy ?? null,
    createdAt
  );
  return fromRow(
    getDb().prepare('SELECT * FROM archive_audit_log WHERE event_id=?').get(eventId) as AuditRow
  );
}

export function listArchiveAudit(itemId: string, limit = 250): PrimarySourceAuditEvent[] {
  const safeLimit = Math.max(1, Math.min(1000, Math.trunc(limit)));
  return (getDb().prepare(
    `SELECT * FROM archive_audit_log
     WHERE item_id=?
     ORDER BY created_at DESC, event_id DESC
     LIMIT ?`
  ).all(itemId, safeLimit) as AuditRow[]).map(fromRow);
}
