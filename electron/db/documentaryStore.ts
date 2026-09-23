import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { DocumentaryIndexIdentity } from '@shared/researchCorpus';
import { documentaryIndexKey } from '../ai/researchCorpusScope';

export interface DocumentaryChunk {
  text: string;
  pageLabel: string | null;
  pageNumber: number | null;
  sourceRef: string | null;
}
export interface DocumentaryJob {
  id: string;
  document_id: string;
  identity_json: string;
  payload_json: string;
  stage: 'extract' | 'chunk' | 'lexical' | 'embed';
  state: 'queued' | 'running' | 'paused' | 'cancelled' | 'failed' | 'complete';
  attempts: number;
  lease_token: string | null;
  lease_until: number | null;
}

/** A profile-owned durable store, independent from rebuildable library catalogs
 * and vault analyses. Callers choose its path; construction never discovers one. */
export class DocumentaryStore {
  readonly db: Database.Database;
  constructor(filename: string, readonly = false) {
    this.db = new Database(filename, { readonly, fileMustExist: readonly });
    if (readonly) { this.db.pragma('busy_timeout = 5000'); return; }
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documentary_revisions (
        index_key TEXT PRIMARY KEY, document_id TEXT NOT NULL, identity_json TEXT NOT NULL,
        text TEXT, chunks_json TEXT, lexical_ready INTEGER NOT NULL DEFAULT 0,
        embedding_ready INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS documentary_current (document_id TEXT PRIMARY KEY, index_key TEXT NOT NULL REFERENCES documentary_revisions(index_key));
      CREATE TABLE IF NOT EXISTS documentary_desired (document_id TEXT PRIMARY KEY, index_key TEXT NOT NULL REFERENCES documentary_revisions(index_key));
      CREATE TABLE IF NOT EXISTS documentary_attachment_heads (
        document_id TEXT NOT NULL, attachment_id TEXT NOT NULL,
        desired_key TEXT NOT NULL REFERENCES documentary_revisions(index_key),
        current_key TEXT REFERENCES documentary_revisions(index_key),
        PRIMARY KEY(document_id,attachment_id)
      );
      CREATE TABLE IF NOT EXISTS documentary_passages (
        id TEXT PRIMARY KEY, index_key TEXT NOT NULL REFERENCES documentary_revisions(index_key),
        document_id TEXT NOT NULL, ordinal INTEGER NOT NULL, text TEXT NOT NULL, locator_json TEXT NOT NULL, vector_json TEXT
      );
      CREATE INDEX IF NOT EXISTS documentary_passages_revision ON documentary_passages(index_key, ordinal);
      CREATE VIRTUAL TABLE IF NOT EXISTS documentary_fts USING fts5(id UNINDEXED,text,tokenize='unicode61 remove_diacritics 2');
      CREATE TABLE IF NOT EXISTS documentary_jobs (
        id TEXT PRIMARY KEY, document_id TEXT NOT NULL, identity_json TEXT NOT NULL, payload_json TEXT NOT NULL,
        stage TEXT NOT NULL DEFAULT 'extract', state TEXT NOT NULL DEFAULT 'queued', priority INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_until INTEGER,
        available_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, error TEXT
      );
      CREATE INDEX IF NOT EXISTS documentary_jobs_claim ON documentary_jobs(state, available_at, priority);
      CREATE TABLE IF NOT EXISTS documentary_preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
  }
  close(): void { this.db.close(); }
  setPreference(key: 'enabled' | 'paused', value: boolean): void {
    this.db.prepare('INSERT INTO documentary_preferences VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
  }
  preference(key: 'enabled' | 'paused'): boolean {
    return (this.db.prepare('SELECT value FROM documentary_preferences WHERE key=?').get(key) as { value: string } | undefined)?.value === 'true';
  }
  enqueue(identity: DocumentaryIndexIdentity, payload: unknown, priority = 0, now = Date.now()): string {
    const id = documentaryIndexKey(identity);
    this.db.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO documentary_revisions(index_key,document_id,identity_json,created_at) VALUES (?,?,?,?)')
        .run(id, identity.documentId, JSON.stringify(identity), now);
      this.db.prepare(`INSERT OR IGNORE INTO documentary_jobs(id,document_id,identity_json,payload_json,priority,available_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(id, identity.documentId, JSON.stringify(identity), JSON.stringify(payload), priority, now, now, now);
      this.db.prepare('INSERT INTO documentary_desired VALUES (?,?) ON CONFLICT(document_id) DO UPDATE SET index_key=excluded.index_key').run(identity.documentId, id);
      this.db.prepare(`INSERT INTO documentary_attachment_heads(document_id,attachment_id,desired_key) VALUES (?,?,?)
        ON CONFLICT(document_id,attachment_id) DO UPDATE SET desired_key=excluded.desired_key`).run(identity.documentId, identity.attachmentId ?? '', id);
    }).immediate();
    return id;
  }
  claim(now = Date.now(), leaseMs = 60000, jobId: string | null = null): DocumentaryJob | null {
    if (this.preference('paused')) return null;
    return this.db.transaction(() => {
      this.db.prepare(`UPDATE documentary_jobs SET state=CASE WHEN attempts>=3 THEN 'failed' ELSE 'queued' END,
        lease_token=NULL,lease_until=NULL,updated_at=? WHERE state='running' AND lease_until<=?`).run(now, now);
      const job = this.db.prepare(`SELECT * FROM documentary_jobs WHERE state='queued' AND available_at<=? AND attempts<3 AND (? IS NULL OR id=?)
        ORDER BY priority + ((? - created_at) / 60000) DESC, created_at, id LIMIT 1`).get(now, jobId, jobId, now) as DocumentaryJob | undefined;
      if (!job) return null;
      const token = randomUUID();
      this.db.prepare(`UPDATE documentary_jobs SET state='running',attempts=attempts+1,lease_token=?,lease_until=?,updated_at=? WHERE id=?`)
        .run(token, now + leaseMs, now, job.id);
      return { ...job, state: 'running' as const, attempts: job.attempts + 1, lease_token: token, lease_until: now + leaseMs };
    }).immediate();
  }
  renew(job: DocumentaryJob, now = Date.now(), leaseMs = 60000): boolean {
    return this.db.prepare(`UPDATE documentary_jobs SET lease_until=?,updated_at=? WHERE id=? AND lease_token=? AND state='running' AND lease_until>?`)
      .run(now + leaseMs, now, job.id, job.lease_token, now).changes === 1;
  }
  private assertLease(job: DocumentaryJob, now: number): void {
    if (!this.db.prepare(`SELECT 1 FROM documentary_jobs WHERE id=? AND lease_token=? AND state='running' AND lease_until>?`)
      .get(job.id, job.lease_token, now)) throw new Error('documentary_lease_lost');
  }
  private stage(job: DocumentaryJob, stage: DocumentaryJob['stage'], now: number): void {
    this.db.prepare('UPDATE documentary_jobs SET stage=?,updated_at=? WHERE id=?').run(stage, now, job.id);
    job.stage = stage;
  }
  saveExtraction(job: DocumentaryJob, text: string, now = Date.now()): void {
    this.db.transaction(() => {
      this.assertLease(job, now);
      this.db.prepare('UPDATE documentary_revisions SET text=? WHERE index_key=?').run(text, job.id);
      this.stage(job, 'chunk', now);
    }).immediate();
  }
  saveChunks(job: DocumentaryJob, chunks: DocumentaryChunk[], now = Date.now()): void {
    this.db.transaction(() => {
      this.assertLease(job, now);
      this.db.prepare('UPDATE documentary_revisions SET chunks_json=? WHERE index_key=?').run(JSON.stringify(chunks), job.id);
      this.stage(job, 'lexical', now);
    }).immediate();
  }
  publishLexical(job: DocumentaryJob, now = Date.now()): void {
    this.db.transaction(() => {
      this.assertLease(job, now);
      const row = this.db.prepare('SELECT chunks_json FROM documentary_revisions WHERE index_key=?').get(job.id) as { chunks_json: string | null };
      if (!row.chunks_json) throw new Error('documentary_chunks_missing');
      const chunks: DocumentaryChunk[] = JSON.parse(row.chunks_json);
      if (!chunks.length) throw new Error('documentary_text_empty');
      this.db.prepare('DELETE FROM documentary_fts WHERE id IN (SELECT id FROM documentary_passages WHERE index_key=?)').run(job.id);
      this.db.prepare('DELETE FROM documentary_passages WHERE index_key=?').run(job.id);
      const insert = this.db.prepare('INSERT INTO documentary_passages(id,index_key,document_id,ordinal,text,locator_json) VALUES (?,?,?,?,?,?)');
      const fts = this.db.prepare('INSERT INTO documentary_fts(id,text) VALUES (?,?)');
      chunks.forEach(({ text, ...locator }, ordinal) => {
        const id = `${job.id}:${ordinal}`;
        insert.run(id, job.id, job.document_id, ordinal, text, JSON.stringify(locator));
        fts.run(id, text);
      });
      this.db.prepare('UPDATE documentary_revisions SET lexical_ready=1 WHERE index_key=?').run(job.id);
      const identity: DocumentaryIndexIdentity = JSON.parse(job.identity_json);
      this.db.prepare(`UPDATE documentary_attachment_heads SET current_key=?
        WHERE document_id=? AND attachment_id=? AND desired_key=?`).run(job.id, job.document_id, identity.attachmentId ?? '', job.id);
      // A slower obsolete build may finish after a newer revision was requested.
      // Keep its immutable evidence, but never replace the requested revision.
      if (this.db.prepare('SELECT 1 FROM documentary_desired WHERE document_id=? AND index_key=?').get(job.document_id, job.id)) {
        this.db.prepare(`INSERT INTO documentary_current VALUES (?,?) ON CONFLICT(document_id) DO UPDATE SET index_key=excluded.index_key`).run(job.document_id, job.id);
      }
      this.stage(job, 'embed', now);
    }).immediate();
  }
  publishEmbeddings(job: DocumentaryJob, vectors: number[][], now = Date.now()): void {
    const identity: DocumentaryIndexIdentity = JSON.parse(job.identity_json);
    const dim = identity.embedding?.dimensions;
    if (!dim || vectors.some(vector => vector.length !== dim || vector.some(value => !Number.isFinite(value)))) throw new Error('documentary_embedding_space_mismatch');
    this.db.transaction(() => {
      this.assertLease(job, now);
      const rows = this.db.prepare('SELECT id FROM documentary_passages WHERE index_key=? ORDER BY ordinal').all(job.id) as { id: string }[];
      if (rows.length !== vectors.length || !rows.length) throw new Error('documentary_embedding_count_mismatch');
      const update = this.db.prepare('UPDATE documentary_passages SET vector_json=? WHERE id=?');
      rows.forEach((row, index) => update.run(JSON.stringify(vectors[index]), row.id));
      this.db.prepare('UPDATE documentary_revisions SET embedding_ready=1 WHERE index_key=?').run(job.id);
      this.complete(job, now);
    }).immediate();
  }
  complete(job: DocumentaryJob, now = Date.now()): void {
    this.assertLease(job, now);
    this.db.prepare("UPDATE documentary_jobs SET state='complete',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(now, job.id);
  }
  fail(job: DocumentaryJob, errorCode: string, now = Date.now()): void {
    this.db.transaction(() => {
      this.assertLease(job, now);
      this.db.prepare(`UPDATE documentary_jobs SET state=CASE WHEN attempts>=3 THEN 'failed' ELSE 'queued' END,
        error=?,available_at=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?`)
        .run(errorCode.slice(0, 120), now + 1000 * 2 ** job.attempts, now, job.id);
    }).immediate();
  }
  cancel(id: string): void { this.db.prepare("UPDATE documentary_jobs SET state='cancelled',lease_token=NULL,lease_until=NULL WHERE id=? AND state<>'complete'").run(id); }
  retry(id: string): void { this.db.prepare("UPDATE documentary_jobs SET state='queued',attempts=0,error=NULL,available_at=? WHERE id=? AND state IN ('failed','cancelled')").run(Date.now(), id); }
  getJob(id: string): DocumentaryJob | null { return this.db.prepare('SELECT * FROM documentary_jobs WHERE id=?').get(id) as DocumentaryJob ?? null; }
  revision(id: string): { text: string | null; chunks_json: string | null; lexical_ready: number; embedding_ready: number } | null {
    return this.db.prepare('SELECT text,chunks_json,lexical_ready,embedding_ready FROM documentary_revisions WHERE index_key=?').get(id) as ReturnType<DocumentaryStore['revision']> ?? null;
  }
  lexicalSearch(query: string, indexKeys: string[], limit: number): Array<{ id: string; document_id: string; index_key: string; text: string; locator_json: string }> {
    if (!indexKeys.length || limit <= 0) return [];
    const terms = [...new Set(query.match(/[\p{L}\p{N}]+/gu) ?? [])].slice(0, 32).map(term => `"${term}"`).join(' OR ');
    if (!terms) return [];
    return this.db.prepare(`SELECT p.id,p.document_id,p.index_key,p.text,p.locator_json FROM documentary_fts f JOIN documentary_passages p ON p.id=f.id
      WHERE documentary_fts MATCH ? AND p.index_key IN (SELECT value FROM json_each(?)) ORDER BY bm25(documentary_fts),p.id LIMIT ?`)
      .all(terms, JSON.stringify(indexKeys), limit) as ReturnType<DocumentaryStore['lexicalSearch']>;
  }
  semanticSearch(query: number[], indexKeys: string[], limit: number, threshold = -1): ReturnType<DocumentaryStore['lexicalSearch']> {
    if (!indexKeys.length || !query.length || limit <= 0) return [];
    const norm = Math.sqrt(query.reduce((sum, value) => sum + value * value, 0));
    if (!norm) return [];
    this.db.function('documentary_similarity', (json: string) => {
      const vector: number[] = JSON.parse(json);
      if (vector.length !== query.length || vector.some(value => !Number.isFinite(value))) return -2;
      let dot = 0, magnitude = 0;
      for (let index = 0; index < vector.length; index++) { dot += vector[index] * query[index]; magnitude += vector[index] ** 2; }
      return magnitude ? dot / (norm * Math.sqrt(magnitude)) : -2;
    });
    return this.db.prepare(`SELECT id,document_id,index_key,text,locator_json FROM (
      SELECT *,documentary_similarity(vector_json) similarity FROM documentary_passages
      WHERE vector_json IS NOT NULL AND index_key IN (SELECT value FROM json_each(?)))
      WHERE similarity>=? ORDER BY similarity DESC,id LIMIT ?`).all(JSON.stringify(indexKeys), threshold, limit) as ReturnType<DocumentaryStore['lexicalSearch']>;
  }
  adjacentPassages(id: string, indexKeys: string[], radius = 1): ReturnType<DocumentaryStore['lexicalSearch']> {
    if (!indexKeys.length || radius < 0 || radius > 3) return [];
    return this.db.prepare(`SELECT p.id,p.document_id,p.index_key,p.text,p.locator_json FROM documentary_passages p
      JOIN documentary_passages origin ON origin.index_key=p.index_key
      WHERE origin.id=? AND p.index_key IN (SELECT value FROM json_each(?)) AND ABS(p.ordinal-origin.ordinal)<=? ORDER BY p.ordinal`)
      .all(id, JSON.stringify(indexKeys), radius) as ReturnType<DocumentaryStore['lexicalSearch']>;
  }
  physicalPages(indexKeys: string[], from: number, to: number, limit: number, attachmentId?: string): ReturnType<DocumentaryStore['lexicalSearch']> {
    if (!indexKeys.length || !Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to - from > 3 || limit < 1 || limit > 500) return [];
    return this.db.prepare(`SELECT p.id,p.document_id,p.index_key,p.text,p.locator_json FROM documentary_passages p
      JOIN documentary_revisions r ON r.index_key=p.index_key
      WHERE p.index_key IN (SELECT value FROM json_each(?))
      AND json_extract(p.locator_json,'$.pageNumber') BETWEEN ? AND ?
      AND (? IS NULL OR json_extract(r.identity_json,'$.attachmentId')=?)
      ORDER BY p.index_key,p.ordinal LIMIT ?`).all(JSON.stringify(indexKeys), from, to, attachmentId ?? null, attachmentId ?? null, limit) as ReturnType<DocumentaryStore['lexicalSearch']>;
  }
}
