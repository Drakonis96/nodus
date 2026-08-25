// SPDX-License-Identifier: AGPL-3.0-only
import Database from 'better-sqlite3';
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { CompassFilters, CompassImportItemResult, CompassImportJob, CompassProviderId, CompassProviderStatus, CompassQueryPlan, CompassResult, CompassResultSummary, CompassSearchSession } from '@shared/compass';

const SCHEMA_VERSION = 2;
const MAX_RESULT_JSON = 1_000_000;
const MAX_PAGE = 25;

function defaultFile(): string {
  try { return path.join(app.getPath('userData'), 'compass', 'compass.sqlite'); } catch { return path.join(process.cwd(), '.nodus-compass', 'compass.sqlite'); }
}
function json<T>(value: unknown, fallback: T): T { try { return JSON.parse(String(value)) as T; } catch { return fallback; } }
function normalizedTitle(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 2_000);
}
function normalizedIdentity(scheme: string, value: string): string {
  const kind = scheme.trim().toLowerCase();
  let normalized = value.trim().toLowerCase();
  if (kind === 'doi') normalized = normalized.replace(/^doi:\s*/, '').replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '');
  if (kind === 'isbn' || kind === 'issn') normalized = normalized.replace(/[\s-]/g, '');
  if (kind === 'pmid') normalized = normalized.replace(/^pmid:\s*/, '');
  if (kind === 'pmcid') normalized = normalized.replace(/^pmc(?:id)?:\s*/, '').replace(/^pmc/i, '');
  if (kind === 'arxiv') normalized = normalized.replace(/^arxiv:\s*/, '').replace(/v\d+$/i, '');
  return normalized.slice(0, 2_000);
}
function summary(result: CompassResult): CompassResultSummary {
  return { canonicalKey: result.canonicalKey, title: result.title, authors: result.authors, issuedYear: result.issuedYear, type: result.type, language: result.language, openAccess: result.openAccess, citationCount: result.citationCount, provenance: result.provenance, finalScore: result.finalScore, reasons: result.reasons, landingUrl: result.landingUrl, identifiers: result.identifiers };
}

export interface StoredProviderRow { provider: CompassProviderId; state: CompassProviderStatus['state']; count: number; nextCursor?: string; retryAt?: number; error?: string; attribution?: string; }

export class CompassStore {
  readonly file: string;
  private readonly db: Database.Database;
  constructor(file = defaultFile()) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.migrate();
  }
  private migrate(): void {
    const current = Number(this.db.pragma('user_version', { simple: true }) || 0);
    if (current < 1) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS compass_searches (
          search_id TEXT PRIMARY KEY, request_id TEXT NOT NULL, generation INTEGER NOT NULL,
          query TEXT NOT NULL, fingerprint TEXT NOT NULL, plan_json TEXT NOT NULL,
          filters_json TEXT NOT NULL, state TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS compass_searches_updated ON compass_searches(updated_at DESC);
        CREATE TABLE IF NOT EXISTS compass_search_providers (
          search_id TEXT NOT NULL REFERENCES compass_searches(search_id) ON DELETE CASCADE,
          provider TEXT NOT NULL, state TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
          next_cursor TEXT, retry_at INTEGER, error TEXT, attribution TEXT,
          PRIMARY KEY(search_id, provider)
        );
        CREATE TABLE IF NOT EXISTS compass_candidates (
          search_id TEXT NOT NULL REFERENCES compass_searches(search_id) ON DELETE CASCADE,
          canonical_key TEXT NOT NULL, result_json TEXT NOT NULL, sort_key REAL NOT NULL DEFAULT 0,
          first_seen INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY(search_id, canonical_key)
        );
        CREATE INDEX IF NOT EXISTS compass_candidates_order ON compass_candidates(search_id, sort_key DESC, canonical_key);
        CREATE TABLE IF NOT EXISTS compass_candidate_identities (
          search_id TEXT NOT NULL, scheme TEXT NOT NULL, normalized_value TEXT NOT NULL,
          canonical_key TEXT NOT NULL, PRIMARY KEY(search_id, scheme, normalized_value)
        );
        CREATE TABLE IF NOT EXISTS compass_selections (
          search_id TEXT NOT NULL, canonical_key TEXT NOT NULL, revision INTEGER NOT NULL,
          PRIMARY KEY(search_id, canonical_key)
        );
        CREATE TABLE IF NOT EXISTS compass_saved_candidates (
          canonical_key TEXT PRIMARY KEY, result_json TEXT NOT NULL, saved_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS compass_dismissals (
          fingerprint TEXT NOT NULL, canonical_key TEXT NOT NULL, dismissed_at INTEGER NOT NULL,
          PRIMARY KEY(fingerprint, canonical_key)
        );
        CREATE TABLE IF NOT EXISTS compass_provider_cache (
          cache_key TEXT PRIMARY KEY, provider TEXT NOT NULL, payload_json TEXT NOT NULL,
          next_cursor TEXT, retrieved_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
          last_accessed_at INTEGER NOT NULL, byte_size INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS compass_provider_cache_lru ON compass_provider_cache(last_accessed_at);
        CREATE TABLE IF NOT EXISTS compass_import_jobs (
          job_id TEXT PRIMARY KEY, search_id TEXT NOT NULL, selection_revision INTEGER NOT NULL,
          selected_keys_json TEXT NOT NULL, collection_ids_json TEXT NOT NULL, state TEXT NOT NULL,
          total INTEGER NOT NULL, completed INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS compass_import_items (
          job_id TEXT NOT NULL REFERENCES compass_import_jobs(job_id) ON DELETE CASCADE,
          canonical_key TEXT NOT NULL, state TEXT NOT NULL, library_item_id TEXT, error TEXT,
          attempts INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(job_id, canonical_key)
        );
      `);
      this.db.pragma('user_version = 1');
    }
    if (current < 2) {
      this.db.exec(`
        ALTER TABLE compass_candidates ADD COLUMN normalized_title TEXT NOT NULL DEFAULT '';
        ALTER TABLE compass_candidates ADD COLUMN issued_year INTEGER;
        ALTER TABLE compass_candidates ADD COLUMN normalized_first_author TEXT NOT NULL DEFAULT '';
        CREATE INDEX IF NOT EXISTS compass_candidates_title
          ON compass_candidates(search_id, normalized_title, issued_year, normalized_first_author);
      `);
      this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
    }
  }
  close(): void { this.db.close(); }
  saveSearch(session: CompassSearchSession): void {
    this.db.prepare(`INSERT INTO compass_searches(search_id,request_id,generation,query,fingerprint,plan_json,filters_json,state,revision,created_at,updated_at)
      VALUES(@searchId,@requestId,@generation,@query,@fingerprint,@plan,@filters,@state,@revision,@createdAt,@updatedAt)
      ON CONFLICT(search_id) DO UPDATE SET state=@state,revision=@revision,filters_json=@filters,plan_json=@plan,updated_at=@updatedAt`).run({ ...session, plan: JSON.stringify(session.plan), filters: JSON.stringify(session.filters) });
    const upsert = this.db.prepare(`INSERT INTO compass_search_providers(search_id,provider,state,count,next_cursor,retry_at,error,attribution) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(search_id,provider) DO UPDATE SET state=excluded.state,count=excluded.count,next_cursor=excluded.next_cursor,retry_at=excluded.retry_at,error=excluded.error,attribution=excluded.attribution`);
    const tx = this.db.transaction((providers: CompassProviderStatus[]) => { for (const p of providers) upsert.run(session.searchId, p.provider, p.state, p.count, p.nextCursor ?? null, p.retryAt ?? null, p.error ?? null, p.attribution ?? null); });
    tx(session.providers);
    this.db.prepare(`DELETE FROM compass_searches WHERE search_id IN (
      SELECT search_id FROM compass_searches ORDER BY updated_at DESC LIMIT -1 OFFSET 200
    )`).run();
  }
  private sessionRow(searchId: string): CompassSearchSession | null {
    const row = this.db.prepare('SELECT * FROM compass_searches WHERE search_id=?').get(searchId) as any;
    if (!row) return null;
    const providers = this.db.prepare('SELECT provider,state,count,next_cursor,retry_at,error,attribution FROM compass_search_providers WHERE search_id=?').all(searchId) as any[];
    const resultCount = this.resultCount(searchId);
    const selectedCount = Number((this.db.prepare('SELECT COUNT(*) AS n FROM compass_selections WHERE search_id=?').get(searchId) as any).n);
    return { searchId: row.search_id, requestId: row.request_id, generation: row.generation, query: row.query, fingerprint: row.fingerprint, plan: json(row.plan_json, {} as CompassQueryPlan), filters: json(row.filters_json, {} as CompassFilters), state: row.state, revision: row.revision, resultCount, selectedCount, providers: providers.map((p) => ({ provider: p.provider, state: p.state, count: p.count, nextCursor: p.next_cursor ?? undefined, retryAt: p.retry_at ?? undefined, error: p.error ?? undefined, attribution: p.attribution ?? undefined })), createdAt: row.created_at, updatedAt: row.updated_at };
  }
  getSearch(searchId: string): CompassSearchSession | null { return this.sessionRow(searchId); }
  listHistory(limit = 50): CompassSearchSession[] { return (this.db.prepare('SELECT search_id FROM compass_searches ORDER BY updated_at DESC LIMIT ?').all(Math.max(1, Math.min(200, limit))) as any[]).map((r) => this.sessionRow(r.search_id)).filter((x): x is CompassSearchSession => !!x); }
  deleteSearch(searchId: string): void { this.db.prepare('DELETE FROM compass_searches WHERE search_id=?').run(searchId); }
  clearHistory(): void { this.db.prepare('DELETE FROM compass_searches').run(); }
  private resultSortKey(searchId: string, result: CompassResult): number {
    const row = this.db.prepare('SELECT filters_json FROM compass_searches WHERE search_id=?').get(searchId) as { filters_json?: string } | undefined;
    const sort = json<CompassFilters>(row?.filters_json, {}).sort ?? 'relevance';
    if (sort === 'date') return result.issuedYear ?? -9_999;
    if (sort === 'citations') return result.citationCount ?? -1;
    return result.finalScore;
  }
  upsertResult(searchId: string, result: CompassResult, revision: number): void {
    const payload = JSON.stringify(result);
    if (Buffer.byteLength(payload, 'utf8') > MAX_RESULT_JSON) throw new Error('Compass result exceeds the persistence limit.');
    const firstSeen = Number((this.db.prepare('SELECT COALESCE(MAX(first_seen), 0) + 1 AS next_position FROM compass_candidates WHERE search_id=?').get(searchId) as { next_position: number }).next_position);
    this.db.prepare(`INSERT INTO compass_candidates(search_id,canonical_key,result_json,sort_key,first_seen,revision,normalized_title,issued_year,normalized_first_author) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(search_id,canonical_key) DO UPDATE SET result_json=excluded.result_json,sort_key=excluded.sort_key,revision=excluded.revision,normalized_title=excluded.normalized_title,issued_year=excluded.issued_year,normalized_first_author=excluded.normalized_first_author`).run(searchId, result.canonicalKey, payload, this.resultSortKey(searchId, result), firstSeen, revision, normalizedTitle(result.title), result.issuedYear ?? null, normalizedTitle(result.authors[0]?.name ?? ''));
    const identity = this.db.prepare('INSERT OR IGNORE INTO compass_candidate_identities(search_id,scheme,normalized_value,canonical_key) VALUES(?,?,?,?)');
    for (const id of result.identifiers) if (id.value) identity.run(searchId, id.scheme.toLowerCase(), normalizedIdentity(id.scheme, id.value), result.canonicalKey);
  }
  upsertResults(searchId: string, results: CompassResult[], revision: number): void { const tx = this.db.transaction(() => results.forEach((r) => this.upsertResult(searchId, r, revision))); tx(); }
  stabilizeResultOrder(searchId: string): void {
    const rows = this.db.prepare('SELECT canonical_key FROM compass_candidates WHERE search_id=? ORDER BY sort_key DESC, canonical_key').all(searchId) as Array<{ canonical_key: string }>;
    const update = this.db.prepare('UPDATE compass_candidates SET first_seen=? WHERE search_id=? AND canonical_key=?');
    this.db.transaction(() => rows.forEach((row, index) => update.run(index + 1, searchId, row.canonical_key)))();
  }
  listResults(searchId: string, offset = 0, limit = MAX_PAGE): CompassResultSummary[] { const rows = this.db.prepare(`SELECT candidate.result_json FROM compass_candidates candidate
    JOIN compass_searches search ON search.search_id=candidate.search_id
    WHERE candidate.search_id=? AND NOT EXISTS (
      SELECT 1 FROM compass_dismissals dismissal
      WHERE dismissal.fingerprint=search.fingerprint AND dismissal.canonical_key=candidate.canonical_key
    ) ORDER BY candidate.first_seen ASC, candidate.canonical_key LIMIT ? OFFSET ?`).all(searchId, Math.min(MAX_PAGE * 4, Math.max(1, limit)), Math.max(0, offset)) as any[]; return rows.map((r) => summary(json<CompassResult>(r.result_json, {} as CompassResult))); }
  resultCount(searchId: string): number { return Number((this.db.prepare(`SELECT COUNT(*) AS n FROM compass_candidates candidate
    JOIN compass_searches search ON search.search_id=candidate.search_id
    WHERE candidate.search_id=? AND NOT EXISTS (
      SELECT 1 FROM compass_dismissals dismissal
      WHERE dismissal.fingerprint=search.fingerprint AND dismissal.canonical_key=candidate.canonical_key
    )`).get(searchId) as any).n); }
  getResult(searchId: string, key: string): CompassResult | null { const row = this.db.prepare('SELECT result_json FROM compass_candidates WHERE search_id=? AND canonical_key=?').get(searchId, key) as any; return row ? json<CompassResult>(row.result_json, {} as CompassResult) : null; }
  findResultByIdentity(searchId: string, identities: Array<{ scheme: string; value: string }>, title?: string, year?: number, firstAuthor?: string): CompassResult | null {
    for (const identity of identities) { const row = this.db.prepare('SELECT canonical_key FROM compass_candidate_identities WHERE search_id=? AND scheme=? AND normalized_value=?').get(searchId, identity.scheme.toLowerCase(), normalizedIdentity(identity.scheme, identity.value)) as any; if (row) return this.getResult(searchId, row.canonical_key); }
    if (title) {
      const row = this.db.prepare(`SELECT canonical_key FROM compass_candidates
        WHERE search_id=? AND normalized_title=?
          AND (? IS NULL OR issued_year IS NULL OR issued_year=?)
          AND (?='' OR normalized_first_author='' OR normalized_first_author=?)
        ORDER BY first_seen ASC LIMIT 1`).get(searchId, normalizedTitle(title), year ?? null, year ?? null, normalizedTitle(firstAuthor ?? ''), normalizedTitle(firstAuthor ?? '')) as any;
      if (row) return this.getResult(searchId, row.canonical_key);
    }
    return null;
  }
  setSelection(searchId: string, keys: string[], revision: number): void { const tx = this.db.transaction(() => { this.db.prepare('DELETE FROM compass_selections WHERE search_id=?').run(searchId); const stmt = this.db.prepare('INSERT INTO compass_selections(search_id,canonical_key,revision) VALUES(?,?,?)'); for (const key of keys.slice(0, 10_000)) stmt.run(searchId, key, revision); }); tx(); }
  selectedKeys(searchId: string): string[] { return (this.db.prepare('SELECT canonical_key FROM compass_selections WHERE search_id=?').all(searchId) as any[]).map((r) => r.canonical_key); }
  saveCandidate(searchId: string, key: string): void { const result = this.getResult(searchId, key); if (result) this.db.prepare('INSERT INTO compass_saved_candidates(canonical_key,result_json,saved_at) VALUES(?,?,?) ON CONFLICT(canonical_key) DO UPDATE SET result_json=excluded.result_json,saved_at=excluded.saved_at').run(key, JSON.stringify(result), Date.now()); }
  listSavedCandidates(limit = 100): CompassResultSummary[] { return (this.db.prepare('SELECT result_json FROM compass_saved_candidates ORDER BY saved_at DESC LIMIT ?').all(Math.max(1, Math.min(500, limit))) as any[]).map((row) => summary(json<CompassResult>(row.result_json, {} as CompassResult))); }
  dismissCandidate(searchId: string, key: string): void { const row = this.db.prepare('SELECT fingerprint FROM compass_searches WHERE search_id=?').get(searchId) as any; if (row) this.db.prepare('INSERT OR REPLACE INTO compass_dismissals(fingerprint,canonical_key,dismissed_at) VALUES(?,?,?)').run(row.fingerprint, key, Date.now()); }
  restoreCandidate(searchId: string, key: string): void { const row = this.db.prepare('SELECT fingerprint FROM compass_searches WHERE search_id=?').get(searchId) as any; if (row) this.db.prepare('DELETE FROM compass_dismissals WHERE fingerprint=? AND canonical_key=?').run(row.fingerprint, key); }
  createImportJob(job: CompassImportJob): void { this.db.prepare('INSERT INTO compass_import_jobs VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(job.jobId, job.searchId, job.selectionRevision, JSON.stringify(job.selectedKeys.slice(0, 10_000)), JSON.stringify(job.collectionIds), job.state, job.total, job.completed, job.failed, job.createdAt, job.updatedAt); const stmt = this.db.prepare('INSERT INTO compass_import_items(job_id,canonical_key,state) VALUES(?,?,?)'); const tx = this.db.transaction(() => job.selectedKeys.slice(0, 10_000).forEach((k) => stmt.run(job.jobId, k, 'queued'))); tx(); }
  getImportJob(jobId: string): CompassImportJob | null { const r = this.db.prepare('SELECT * FROM compass_import_jobs WHERE job_id=?').get(jobId) as any; if (!r) return null; return { jobId: r.job_id, searchId: r.search_id, selectionRevision: r.selection_revision, selectedKeys: json(r.selected_keys_json, []), collectionIds: json(r.collection_ids_json, []), state: r.state, total: r.total, completed: r.completed, failed: r.failed, createdAt: r.created_at, updatedAt: r.updated_at }; }
  updateImportJob(job: CompassImportJob): void { this.db.prepare('UPDATE compass_import_jobs SET state=?,completed=?,failed=?,updated_at=? WHERE job_id=?').run(job.state, job.completed, job.failed, job.updatedAt, job.jobId); }
  listImportItems(jobId: string): CompassImportItemResult[] { return (this.db.prepare('SELECT * FROM compass_import_items WHERE job_id=?').all(jobId) as any[]).map((r) => ({ jobId, canonicalKey: r.canonical_key, state: r.state, libraryItemId: r.library_item_id ?? undefined, error: r.error ?? undefined })); }
  updateImportItem(item: CompassImportItemResult): void { this.db.prepare('UPDATE compass_import_items SET state=?,library_item_id=?,error=?,attempts=attempts+1 WHERE job_id=? AND canonical_key=?').run(item.state, item.libraryItemId ?? null, item.error ?? null, item.jobId, item.canonicalKey); }
  resetImportItems(jobId: string): void { this.db.prepare("UPDATE compass_import_items SET state='queued',library_item_id=NULL,error=NULL WHERE job_id=? AND state IN ('failed','canceled')").run(jobId); }
  cancelPendingImportItems(jobId: string): void { this.db.prepare("UPDATE compass_import_items SET state='canceled',error='Canceled' WHERE job_id=? AND state IN ('queued','checking')").run(jobId); }
  putProviderCache(cacheKey: string, provider: CompassProviderId, payload: unknown, nextCursor: string | undefined, ttlMs: number): void { const payloadJson = JSON.stringify(payload); if (Buffer.byteLength(payloadJson, 'utf8') > MAX_RESULT_JSON) return; const stamp = Date.now(); this.db.prepare(`INSERT INTO compass_provider_cache(cache_key,provider,payload_json,next_cursor,retrieved_at,expires_at,last_accessed_at,byte_size) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET payload_json=excluded.payload_json,next_cursor=excluded.next_cursor,retrieved_at=excluded.retrieved_at,expires_at=excluded.expires_at,last_accessed_at=excluded.last_accessed_at,byte_size=excluded.byte_size`).run(cacheKey, provider, payloadJson, nextCursor ?? null, stamp, stamp + Math.min(Math.max(ttlMs, 60_000), 7 * 24 * 60 * 60_000), stamp, Buffer.byteLength(payloadJson, 'utf8')); this.pruneCache(); }
  getProviderCache(cacheKey: string): { payload: unknown; nextCursor?: string } | null { const row = this.db.prepare('SELECT payload_json,next_cursor,expires_at FROM compass_provider_cache WHERE cache_key=?').get(cacheKey) as any; if (!row || row.expires_at < Date.now()) { if (row) this.db.prepare('DELETE FROM compass_provider_cache WHERE cache_key=?').run(cacheKey); return null; } this.db.prepare('UPDATE compass_provider_cache SET last_accessed_at=? WHERE cache_key=?').run(Date.now(), cacheKey); return { payload: json(row.payload_json, null), nextCursor: row.next_cursor ?? undefined }; }
  private pruneCache(maxBytes = 64 * 1024 * 1024): void { const current = Number((this.db.prepare('SELECT COALESCE(SUM(byte_size),0) AS total FROM compass_provider_cache').get() as any).total); if (current <= maxBytes) return; const rows = this.db.prepare('SELECT cache_key,byte_size FROM compass_provider_cache ORDER BY last_accessed_at ASC').all() as any[]; let total = current; const remove = this.db.prepare('DELETE FROM compass_provider_cache WHERE cache_key=?'); for (const row of rows) { if (total <= maxBytes) break; remove.run(row.cache_key); total -= Number(row.byte_size); } }
}

export function compassDatabasePath(): string { return defaultFile(); }
