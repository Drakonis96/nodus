/**
 * Local persistence for complete study guides (migration 194): run checkpoints so a
 * re-queued job resumes where it stopped, a content-addressed cache of the reading
 * passes shared by every run in the vault, and the evidence sidecar of each saved
 * guide. The functions take a minimal statement interface so the same code runs on
 * better-sqlite3 in the app and on node:sqlite in tests.
 */
import { getDb } from './database';

export interface GuideStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}
export interface GuideDb { prepare(sql: string): GuideStatement }

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();
const db = (override?: GuideDb): GuideDb => override ?? (getDb() as unknown as GuideDb);

export interface CompleteGuideRunRecord<TRequest = unknown, TSnapshot = unknown> {
  runId: string;
  stage: string;
  request: TRequest;
  snapshot: TSnapshot;
  createdAt: string;
  updatedAt: string;
}

export function getCompleteGuideRun<TRequest, TSnapshot>(runId: string, database?: GuideDb): CompleteGuideRunRecord<TRequest, TSnapshot> | null {
  const row = db(database).prepare('SELECT * FROM complete_guide_runs WHERE run_id = ?').get(runId) as Row | undefined;
  if (!row) return null;
  return {
    runId: String(row.run_id),
    stage: String(row.stage),
    request: JSON.parse(String(row.request_json)) as TRequest,
    snapshot: JSON.parse(String(row.snapshot_json)) as TSnapshot,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/** Freeze a run's request and snapshot. An existing run keeps its original snapshot. */
export function createCompleteGuideRun(runId: string, request: unknown, snapshot: unknown, database?: GuideDb): void {
  const stamp = now();
  db(database).prepare(`INSERT INTO complete_guide_runs (run_id, stage, request_json, snapshot_json, created_at, updated_at)
    VALUES (?, 'snapshot', ?, ?, ?, ?) ON CONFLICT(run_id) DO NOTHING`).run(runId, JSON.stringify(request), JSON.stringify(snapshot), stamp, stamp);
}

export function setCompleteGuideRunStage(runId: string, stage: string, database?: GuideDb): void {
  db(database).prepare('UPDATE complete_guide_runs SET stage = ?, updated_at = ? WHERE run_id = ?').run(stage, now(), runId);
}

export function getCompleteGuideUnit<T>(runId: string, stage: string, unitKey: string, database?: GuideDb): T | null {
  const row = db(database).prepare('SELECT result_json FROM complete_guide_units WHERE run_id = ? AND stage = ? AND unit_key = ?').get(runId, stage, unitKey) as Row | undefined;
  return row ? JSON.parse(String(row.result_json)) as T : null;
}

export function putCompleteGuideUnit(runId: string, stage: string, unitKey: string, result: unknown, database?: GuideDb): void {
  db(database).prepare(`INSERT INTO complete_guide_units (run_id, stage, unit_key, result_json, created_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(run_id, stage, unit_key) DO UPDATE SET result_json = excluded.result_json`).run(runId, stage, unitKey, JSON.stringify(result), now());
}

export function listCompleteGuideUnits<T>(runId: string, stage: string, database?: GuideDb): Array<{ unitKey: string; result: T }> {
  return (db(database).prepare('SELECT unit_key, result_json FROM complete_guide_units WHERE run_id = ? AND stage = ? ORDER BY unit_key').all(runId, stage) as Row[])
    .map((row) => ({ unitKey: String(row.unit_key), result: JSON.parse(String(row.result_json)) as T }));
}

/** Forget a run's working state (after a successful save, or when it is stale). */
export function deleteCompleteGuideRun(runId: string, database?: GuideDb): void {
  const target = db(database);
  target.prepare('DELETE FROM complete_guide_units WHERE run_id = ?').run(runId);
  target.prepare('DELETE FROM complete_guide_runs WHERE run_id = ?').run(runId);
}

export function pruneStaleCompleteGuideRuns(olderThanDays = 14, database?: GuideDb): number {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
  const stale = (db(database).prepare('SELECT run_id FROM complete_guide_runs WHERE updated_at < ?').all(cutoff) as Row[]).map((row) => String(row.run_id));
  for (const runId of stale) deleteCompleteGuideRun(runId, database);
  return stale.length;
}

export function getCompleteGuideCache<T>(cacheKey: string, database?: GuideDb): T | null {
  const target = db(database);
  const row = target.prepare('SELECT result_json FROM complete_guide_chunk_cache WHERE cache_key = ?').get(cacheKey) as Row | undefined;
  if (!row) return null;
  target.prepare('UPDATE complete_guide_chunk_cache SET last_used_at = ? WHERE cache_key = ?').run(now(), cacheKey);
  return JSON.parse(String(row.result_json)) as T;
}

export function hasCompleteGuideCache(cacheKeys: string[], database?: GuideDb): Set<string> {
  const found = new Set<string>();
  const statement = db(database).prepare('SELECT 1 AS hit FROM complete_guide_chunk_cache WHERE cache_key = ?');
  for (const key of cacheKeys) if (statement.get(key)) found.add(key);
  return found;
}

export const COMPLETE_GUIDE_CACHE_MAX_BYTES = 50 * 1024 * 1024;

export function putCompleteGuideCache(cacheKey: string, stage: string, result: unknown, database?: GuideDb): void {
  const json = JSON.stringify(result);
  db(database).prepare(`INSERT INTO complete_guide_chunk_cache (cache_key, stage, result_json, bytes, last_used_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET result_json = excluded.result_json, bytes = excluded.bytes, last_used_at = excluded.last_used_at`)
    .run(cacheKey, stage, json, Buffer.byteLength(json), now());
}

/** Least-recently-used eviction down to the byte budget. Returns rows removed. */
export function pruneCompleteGuideCache(maxBytes = COMPLETE_GUIDE_CACHE_MAX_BYTES, database?: GuideDb): number {
  const target = db(database);
  const rows = target.prepare('SELECT cache_key, bytes FROM complete_guide_chunk_cache ORDER BY last_used_at DESC, cache_key').all() as Row[];
  let total = 0;
  let removed = 0;
  const remove = target.prepare('DELETE FROM complete_guide_chunk_cache WHERE cache_key = ?');
  for (const row of rows) {
    total += Number(row.bytes ?? 0);
    if (total > maxBytes) { remove.run(String(row.cache_key)); removed += 1; }
  }
  return removed;
}

export function saveCompleteGuideArtifacts(draftId: string, runId: string, artifacts: unknown, database?: GuideDb): void {
  db(database).prepare(`INSERT INTO complete_guide_artifacts (draft_id, run_id, artifacts_json, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(draft_id) DO UPDATE SET run_id = excluded.run_id, artifacts_json = excluded.artifacts_json`).run(draftId, runId, JSON.stringify(artifacts), now());
}

export function getCompleteGuideArtifacts<T>(draftId: string, database?: GuideDb): T | null {
  const row = db(database).prepare('SELECT artifacts_json FROM complete_guide_artifacts WHERE draft_id = ?').get(draftId) as Row | undefined;
  return row ? JSON.parse(String(row.artifacts_json)) as T : null;
}

export function deleteCompleteGuideArtifacts(draftId: string, database?: GuideDb): void {
  db(database).prepare('DELETE FROM complete_guide_artifacts WHERE draft_id = ?').run(draftId);
}
