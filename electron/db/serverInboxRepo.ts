import type { ServerInboxEntry } from '@shared/types';
import type { InboxSummary } from '../serverSync/mutationInbox';
import { getDb } from './database';

/**
 * This computer's record of what reached it through Nodus Server's mutation ledger.
 *
 * PER VAULT, and that is the point: the table lives in the vault's own database, so an
 * entry belongs to the corpus the mutation was actually applied to. The phone's outbox is
 * global on purpose — it queues work before knowing where it will land — but by the time
 * something is in here it has landed somewhere specific, and saying "arrived" without
 * saying "here" would be a lie the user cannot check.
 *
 * Nothing in here travels. server_inbox is in NOT_SYNCED_TABLES and outside MUTABLE_TABLES
 * and the published snapshot: read/unread is one person's state on one screen, and a second
 * machine must never be told it received work it never received.
 */

interface ServerInboxRow {
  id: string;
  seq: number;
  space_id: string | null;
  client_id: string | null;
  table_name: string;
  row_key: string;
  op: string;
  outcome: string;
  reason: string | null;
  title: string | null;
  entity_kind: string | null;
  schema_version: number | null;
  created_at: string | null;
  arrived_at: string;
  read: number;
}

function toEntry(row: ServerInboxRow): ServerInboxEntry | null {
  try {
    const key = JSON.parse(row.row_key) as unknown;
    return {
      id: row.id,
      seq: Number(row.seq),
      spaceId: row.space_id,
      clientId: row.client_id,
      table: row.table_name,
      key: Array.isArray(key) ? key : [],
      op: row.op === 'delete' ? 'delete' : 'upsert',
      outcome: row.outcome as ServerInboxEntry['outcome'],
      reason: row.reason,
      title: row.title,
      entityKind: row.entity_kind,
      schemaVersion: row.schema_version === null ? null : Number(row.schema_version),
      createdAt: row.created_at,
      arrivedAt: row.arrived_at,
      read: row.read !== 0,
    };
  } catch {
    // One unreadable record must not empty the whole panel.
    return null;
  }
}

/** The stored outcome vocabulary; the summary's is camelCase, the column's is not. */
function storedOutcome(outcome: InboxSummary['entries'][number]['outcome']): string {
  return outcome === 'keptLocal' ? 'kept_local' : outcome;
}

/**
 * Write a batch of arrivals, once each.
 *
 * ON CONFLICT DO NOTHING is the whole design, not a detail. A refusal STOPS the apply loop
 * without advancing the cursor, so the server keeps handing back that same mutation every
 * thirty seconds, for as long as the reason stands. INSERT OR REPLACE would reset `read` to
 * 0 on every poll and hand the user an unread badge they can never clear; DO UPDATE on
 * arrived_at would keep a permanently-refused mutation permanently at the top of the list.
 * The first account of what happened is the true one — being refused again is not news.
 */
export function recordServerInbox(entries: InboxSummary['entries'], ctx: { spaceId: string }): void {
  if (entries.length === 0) return;
  const db = getDb();
  const arrivedAt = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO server_inbox (
       id, seq, space_id, client_id, table_name, row_key, op, outcome, reason,
       title, entity_kind, schema_version, created_at, arrived_at, read
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(id) DO NOTHING`
  );
  db.transaction(() => {
    for (const entry of entries) {
      insert.run(
        entry.id,
        Number(entry.seq) || 0,
        ctx.spaceId || null,
        entry.clientId || null,
        entry.table,
        // The same encoding server_outbox and the tombstone triggers use, so a key written
        // here and one written by SQL compare equal.
        JSON.stringify(entry.key ?? []),
        entry.kind,
        storedOutcome(entry.outcome),
        entry.reason ?? null,
        entry.title ?? null,
        entry.entityKind ?? null,
        entry.schemaVersion === undefined ? null : Number(entry.schemaVersion),
        entry.createdAt ?? null,
        arrivedAt
      );
    }
  })();
}

export function listServerInbox(limit = 200): ServerInboxEntry[] {
  const rows = getDb()
    .prepare('SELECT * FROM server_inbox ORDER BY arrived_at DESC, seq DESC LIMIT ?')
    .all(limit) as ServerInboxRow[];
  return rows.map(toEntry).filter((entry): entry is ServerInboxEntry => entry !== null);
}

export function unreadServerInboxCount(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM server_inbox WHERE read = 0').get() as { n: number };
  return Number(row?.n ?? 0);
}

/** Mark one entry read, or every entry when no id is given. */
export function markServerInboxRead(id?: string): void {
  const db = getDb();
  if (id) db.prepare('UPDATE server_inbox SET read = 1 WHERE id = ?').run(id);
  else db.prepare('UPDATE server_inbox SET read = 1 WHERE read = 0').run();
}

/**
 * Remove one entry.
 *
 * A REFUSED entry will come back on the next poll, and that is intended. A refusal is not
 * a past event but a live problem: the cursor never advanced, so the server is still
 * handing that mutation over, and the collaborator's work is still not landing. Letting a
 * dismissal hide that would recreate exactly the silence this table exists to end. Applied
 * and deleted entries stay gone — they are finished business.
 */
export function clearServerInboxEntry(id: string): boolean {
  return getDb().prepare('DELETE FROM server_inbox WHERE id = ?').run(id).changes > 0;
}

export function clearServerInbox(): number {
  return getDb().prepare('DELETE FROM server_inbox').run().changes;
}
