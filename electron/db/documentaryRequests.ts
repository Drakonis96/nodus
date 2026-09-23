import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export interface DocumentaryRequest {
  document_id: string; revision: string; vault_id: string; lease_token: string; attempts: number; configuration_json: string | null; source_id: string | null;
}

/** Source discovery/extraction needs a lease before a textual fingerprint exists.
 * The immutable revision queue takes over once extraction has produced text. */
export class DocumentaryRequests {
  constructor(readonly db: Database.Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS documentary_requests (
      document_id TEXT PRIMARY KEY, revision TEXT NOT NULL, state TEXT NOT NULL, error TEXT, updated_at INTEGER NOT NULL
    )`);
    const columns = new Set((db.prepare('PRAGMA table_info(documentary_requests)').all() as { name: string }[]).map(column => column.name));
    for (const [name, sql] of Object.entries({ vault_id: "TEXT NOT NULL DEFAULT ''", lease_token: 'TEXT', lease_until: 'INTEGER',
      attempts: 'INTEGER NOT NULL DEFAULT 0', available_at: 'INTEGER NOT NULL DEFAULT 0', priority: 'INTEGER NOT NULL DEFAULT 0', created_at: 'INTEGER NOT NULL DEFAULT 0', configuration_json: 'TEXT', source_id: 'TEXT', stage: "TEXT NOT NULL DEFAULT 'extraction'", completed_passages: 'INTEGER NOT NULL DEFAULT 0', total_passages: 'INTEGER', unknown_requests: 'INTEGER NOT NULL DEFAULT 0' })) {
      if (!columns.has(name)) db.exec(`ALTER TABLE documentary_requests ADD COLUMN ${name} ${sql}`);
    }
  }
  enqueue(documentId: string, revision: string, vaultId: string, now = Date.now(), priority = 0, configuration: unknown = null): void {
    this.db.prepare(`INSERT INTO documentary_requests(document_id,revision,vault_id,state,error,updated_at,available_at,priority,created_at,configuration_json)
      VALUES (?,?,?,'queued',NULL,?,?,?,?,?) ON CONFLICT(document_id) DO UPDATE SET revision=excluded.revision,vault_id=excluded.vault_id,
      state=CASE WHEN documentary_requests.state='running' AND documentary_requests.revision=excluded.revision AND documentary_requests.configuration_json IS excluded.configuration_json THEN 'running' ELSE 'queued' END,
      lease_token=CASE WHEN documentary_requests.state='running' AND documentary_requests.revision=excluded.revision AND documentary_requests.configuration_json IS excluded.configuration_json THEN documentary_requests.lease_token ELSE NULL END,
      lease_until=CASE WHEN documentary_requests.state='running' AND documentary_requests.revision=excluded.revision AND documentary_requests.configuration_json IS excluded.configuration_json THEN documentary_requests.lease_until ELSE NULL END,
      attempts=CASE WHEN documentary_requests.state='running' AND documentary_requests.revision=excluded.revision AND documentary_requests.configuration_json IS excluded.configuration_json THEN documentary_requests.attempts ELSE 0 END,
      configuration_json=excluded.configuration_json,error=NULL,updated_at=excluded.updated_at,available_at=excluded.available_at,priority=excluded.priority`).run(documentId, revision, vaultId, now, now, priority, now, configuration == null ? null : JSON.stringify(configuration));
  }
  claim(vaultId: string | string[], now = Date.now(), leaseMs = 60000, exactOwner = false): DocumentaryRequest | null {
    const owners = Array.isArray(vaultId) ? vaultId : [vaultId];
    if (!owners.length) return null;
    return this.db.transaction(() => {
      this.db.prepare(`UPDATE documentary_requests SET state='queued',attempts=MAX(0,attempts-1),
        lease_token=NULL,lease_until=NULL WHERE state='running' AND (lease_until IS NULL OR lease_until<=?)`).run(now);
      const row = this.db.prepare(`SELECT document_id,revision,vault_id,attempts,configuration_json,source_id FROM documentary_requests
        WHERE state='queued' AND available_at<=? AND attempts<3 AND (vault_id IN (${owners.map(() => '?').join(',')}) OR (?=0 AND vault_id=''))
        ORDER BY priority + ((? - created_at)/60000) DESC,created_at,document_id LIMIT 1`).get(now, ...owners, Number(exactOwner || Array.isArray(vaultId)), now) as Omit<DocumentaryRequest, 'lease_token'> | undefined;
      if (!row) return null;
      const owner = row.vault_id || owners[0];
      const lease_token = randomUUID();
      this.db.prepare(`UPDATE documentary_requests SET state='running',vault_id=?,lease_token=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE document_id=?`)
        .run(owner, lease_token, now + leaseMs, now, row.document_id);
      return { ...row, vault_id: owner, lease_token, attempts: row.attempts + 1 };
    }).immediate();
  }
  renew(job: DocumentaryRequest, now = Date.now(), leaseMs = 60000): void {
    const result = this.db.prepare(`UPDATE documentary_requests SET lease_until=?,updated_at=?
      WHERE document_id=? AND revision=? AND lease_token=? AND state='running' AND lease_until>?`)
      .run(now + leaseMs, now, job.document_id, job.revision, job.lease_token, now);
    if (!result.changes) throw new Error('documentary_request_lease_lost');
  }
  finish(job: DocumentaryRequest, error: string | null, paused = false, now = Date.now()): void {
    const state = !error ? 'complete' : paused || job.attempts < 3 ? 'queued' : 'failed';
    const result = this.db.prepare(`UPDATE documentary_requests SET state=?,error=?,lease_token=NULL,lease_until=NULL,updated_at=?,
      available_at=?,attempts=attempts-? WHERE document_id=? AND revision=? AND lease_token=? AND state='running'`)
      .run(state, error, now, paused ? now : now + 1000 * 2 ** job.attempts, Number(paused), job.document_id, job.revision, job.lease_token);
    if (!result.changes) throw new Error('documentary_request_lease_lost');
  }
  nextDelay(vaultId: string | string[], now = Date.now()): number | null {
    const owners = Array.isArray(vaultId) ? vaultId : [vaultId, ''];
    if (!owners.length) return null;
    const row = this.db.prepare(`SELECT MIN(CASE WHEN state='running' THEN lease_until ELSE available_at END) next
      FROM documentary_requests WHERE state IN ('queued','running') AND attempts<3 AND vault_id IN (${owners.map(() => '?').join(',')})`).get(...owners) as { next: number | null };
    return row.next == null ? null : Math.max(100, row.next - now);
  }
  cancel(documentId: string): void {
    this.db.prepare("UPDATE documentary_requests SET state='cancelled',lease_token=NULL,lease_until=NULL WHERE document_id=?").run(documentId);
  }
}
