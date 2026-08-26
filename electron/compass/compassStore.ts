// SPDX-License-Identifier: AGPL-3.0-only
import Database from "better-sqlite3";
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import type {
  CompassDownloadLink,
  CompassFilters,
  CompassImportItemResult,
  CompassImportJob,
  CompassLane,
  CompassProviderId,
  CompassProviderStatus,
  CompassQueryPlan,
  CompassQueryStrategy,
  CompassResult,
  CompassResultSummary,
  CompassSearchSession,
} from "@shared/compass";
import type { CompassProviderUsage } from "./compassRequestScheduler";

const SCHEMA_VERSION = 3;
const MAX_RESULT_JSON = 64 * 1024;
const MAX_CACHE_JSON = 2 * 1024 * 1024;
const MAX_PAGE = 25;

function defaultFile(): string {
  try {
    return path.join(app.getPath("userData"), "compass", "compass.sqlite");
  } catch {
    return path.join(process.cwd(), ".nodus-compass", "compass.sqlite");
  }
}
function json<T>(value: unknown, fallback: T): T {
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}
function normalizedTitle(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .slice(0, 2_000);
}
function normalizedIdentity(scheme: string, value: string): string {
  const kind = scheme.trim().toLowerCase();
  let normalized = value.trim().toLowerCase();
  if (kind === "doi")
    normalized = normalized
      .replace(/^doi:\s*/, "")
      .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "");
  if (kind === "isbn" || kind === "issn")
    normalized = normalized.replace(/[\s-]/g, "");
  if (kind === "pmid") normalized = normalized.replace(/^pmid:\s*/, "");
  if (kind === "pmcid")
    normalized = normalized.replace(/^pmc(?:id)?:\s*/, "").replace(/^pmc/i, "");
  if (kind === "arxiv")
    normalized = normalized.replace(/^arxiv:\s*/, "").replace(/v\d+$/i, "");
  return normalized.slice(0, 2_000);
}
function summary(result: CompassResult): CompassResultSummary {
  return {
    canonicalKey: result.canonicalKey,
    title: result.title,
    authors: result.authors,
    issuedYear: result.issuedYear,
    type: result.type,
    lane: result.lane ?? "scholarly",
    language: result.language,
    openAccess: result.openAccess,
    citationCount: result.citationCount,
    provenance: result.provenance,
    finalScore: result.finalScore,
    displayRank: result.displayRank,
    reasons: result.reasons,
    landingUrl: result.landingUrl,
    identifiers: result.identifiers,
    rights: result.rights,
    digitallyAvailable: result.digitallyAvailable,
    hasDownloadableFile: (result.downloadLinks ?? []).some((link) => link.open),
  };
}

export interface StoredCompassRoute {
  searchId: string;
  provider: CompassProviderId;
  strategy: CompassQueryStrategy;
  lane: CompassLane;
  cursor?: string;
  page: number;
  state: string;
}

export class CompassStore {
  readonly file: string;
  private readonly db: Database.Database;
  constructor(file = defaultFile()) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.migrate();
  }
  private migrate(): void {
    const current = Number(
      this.db.pragma("user_version", { simple: true }) || 0,
    );
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
      this.db.pragma("user_version = 1");
    }
    if (current < 2) {
      this.db.exec(`
        ALTER TABLE compass_candidates ADD COLUMN normalized_title TEXT NOT NULL DEFAULT '';
        ALTER TABLE compass_candidates ADD COLUMN issued_year INTEGER;
        ALTER TABLE compass_candidates ADD COLUMN normalized_first_author TEXT NOT NULL DEFAULT '';
        CREATE INDEX IF NOT EXISTS compass_candidates_title
          ON compass_candidates(search_id, normalized_title, issued_year, normalized_first_author);
      `);
      this.db.pragma("user_version = 2");
    }
    if (current < 3) {
      this.db.exec(`
        ALTER TABLE compass_searches ADD COLUMN query_revision INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE compass_searches ADD COLUMN view_revision INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE compass_searches ADD COLUMN lane TEXT NOT NULL DEFAULT 'scholarly';
        ALTER TABLE compass_search_providers ADD COLUMN has_more INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE compass_search_providers ADD COLUMN strategy TEXT NOT NULL DEFAULT 'balanced';
        ALTER TABLE compass_search_providers ADD COLUMN lane TEXT NOT NULL DEFAULT 'scholarly';
        ALTER TABLE compass_candidates ADD COLUMN lane TEXT NOT NULL DEFAULT 'scholarly';
        ALTER TABLE compass_candidates ADD COLUMN native_score REAL;
        ALTER TABLE compass_candidates ADD COLUMN native_rank INTEGER;
        ALTER TABLE compass_candidates ADD COLUMN display_rank INTEGER;
        CREATE TABLE IF NOT EXISTS compass_search_routes (
          search_id TEXT NOT NULL REFERENCES compass_searches(search_id) ON DELETE CASCADE,
          provider TEXT NOT NULL, strategy TEXT NOT NULL, lane TEXT NOT NULL,
          cursor TEXT, page INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'queued',
          PRIMARY KEY(search_id, provider, lane)
        );
        INSERT OR IGNORE INTO compass_search_routes(search_id,provider,strategy,lane,cursor,page,state)
          SELECT search_id,provider,'balanced','scholarly',next_cursor,CASE WHEN count>0 THEN 1 ELSE 0 END,state FROM compass_search_providers;
        CREATE TABLE IF NOT EXISTS compass_provider_usage (
          provider TEXT PRIMARY KEY, day TEXT NOT NULL, daily_used INTEGER NOT NULL DEFAULT 0,
          tokens REAL NOT NULL DEFAULT 0, token_updated_at INTEGER NOT NULL DEFAULT 0,
          next_allowed_at INTEGER NOT NULL DEFAULT 0, consecutive_failures INTEGER NOT NULL DEFAULT 0,
          circuit_until INTEGER, retry_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS compass_import_downloads (
          job_id TEXT NOT NULL REFERENCES compass_import_jobs(job_id) ON DELETE CASCADE,
          canonical_key TEXT NOT NULL, url TEXT, license TEXT, rights TEXT, state TEXT NOT NULL DEFAULT 'queued',
          bytes INTEGER, sha256 TEXT, attachment_id TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY(job_id, canonical_key)
        );
        CREATE INDEX IF NOT EXISTS compass_candidates_lane_order ON compass_candidates(search_id,lane,sort_key DESC,canonical_key);
        UPDATE compass_candidates SET lane='scholarly' WHERE lane IS NULL OR lane='';
      `);
      this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
    }
    this.ensureProviderLaneKey();
  }
  private ensureProviderLaneKey(): void {
    const columns = this.db.pragma("table_info(compass_search_providers)") as Array<{ name: string; pk: number }>;
    const primaryKey = columns.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk).map((column) => column.name);
    if (primaryKey.join(",") === "search_id,provider,lane") return;
    this.db.exec(`
      ALTER TABLE compass_search_providers RENAME TO compass_search_providers_legacy;
      CREATE TABLE compass_search_providers (
        search_id TEXT NOT NULL REFERENCES compass_searches(search_id) ON DELETE CASCADE,
        provider TEXT NOT NULL, state TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
        next_cursor TEXT, retry_at INTEGER, error TEXT, attribution TEXT,
        has_more INTEGER NOT NULL DEFAULT 0, strategy TEXT NOT NULL DEFAULT 'balanced',
        lane TEXT NOT NULL DEFAULT 'scholarly',
        PRIMARY KEY(search_id, provider, lane)
      );
      INSERT INTO compass_search_providers(search_id,provider,state,count,next_cursor,retry_at,error,attribution,has_more,strategy,lane)
        SELECT search_id,provider,state,count,next_cursor,retry_at,error,attribution,has_more,strategy,lane
        FROM compass_search_providers_legacy;
      DROP TABLE compass_search_providers_legacy;
    `);
  }
  close(): void {
    this.db.close();
  }
  saveSearch(session: CompassSearchSession): void {
    this.db
      .prepare(
        `INSERT INTO compass_searches(search_id,request_id,generation,query_revision,view_revision,query,fingerprint,plan_json,filters_json,lane,state,revision,created_at,updated_at)
      VALUES(@searchId,@requestId,@generation,@queryRevision,@viewRevision,@query,@fingerprint,@plan,@filters,@lane,@state,@revision,@createdAt,@updatedAt)
      ON CONFLICT(search_id) DO UPDATE SET state=@state,revision=@revision,query_revision=@queryRevision,view_revision=@viewRevision,filters_json=@filters,plan_json=@plan,lane=@lane,updated_at=@updatedAt`,
      )
      .run({
        ...session,
        plan: JSON.stringify(session.plan),
        filters: JSON.stringify(session.filters),
      });
    const upsert = this.db.prepare(
      `INSERT INTO compass_search_providers(search_id,provider,state,count,retry_at,error,attribution,has_more,strategy,lane) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(search_id,provider,lane) DO UPDATE SET state=excluded.state,count=excluded.count,retry_at=excluded.retry_at,error=excluded.error,attribution=excluded.attribution,has_more=excluded.has_more,strategy=excluded.strategy`,
    );
    const tx = this.db.transaction((providers: CompassProviderStatus[]) => {
      for (const p of providers)
        upsert.run(
          session.searchId,
          p.provider,
          p.state,
          p.count,
          p.retryAt ?? null,
          p.error ?? null,
          p.attribution ?? null,
          p.hasMore ? 1 : 0,
          p.strategy ?? "balanced",
          p.lane,
        );
    });
    tx(session.providers);
    this.db
      .prepare(
        `DELETE FROM compass_searches WHERE search_id IN (
      SELECT search_id FROM compass_searches
      WHERE search_id NOT IN (SELECT search_id FROM compass_import_jobs)
      ORDER BY updated_at DESC LIMIT -1 OFFSET 200
    )`,
      )
      .run();
  }
  private sessionRow(searchId: string): CompassSearchSession | null {
    const row = this.db
      .prepare("SELECT * FROM compass_searches WHERE search_id=?")
      .get(searchId) as any;
    if (!row) return null;
    const providers = this.db
      .prepare(
        "SELECT provider,state,count,retry_at,error,attribution,has_more,strategy,lane FROM compass_search_providers WHERE search_id=?",
      )
      .all(searchId) as any[];
    const resultCount = this.resultCount(searchId);
    const selectedCount = Number(
      (
        this.db
          .prepare(
            "SELECT COUNT(*) AS n FROM compass_selections WHERE search_id=?",
          )
          .get(searchId) as any
      ).n,
    );
    return {
      searchId: row.search_id,
      requestId: row.request_id,
      generation: row.generation,
      queryRevision: row.query_revision ?? 0,
      viewRevision: row.view_revision ?? 0,
      query: row.query,
      fingerprint: row.fingerprint,
      plan: json(row.plan_json, {} as CompassQueryPlan),
      filters: json(row.filters_json, {} as CompassFilters),
      lane: row.lane ?? "scholarly",
      state: row.state,
      revision: row.revision,
      resultCount,
      selectedCount,
      providers: providers.map((p) => ({
        provider: p.provider,
        state: p.state,
        count: p.count,
        hasMore: Boolean(p.has_more),
        retryAt: p.retry_at ?? undefined,
        error: p.error ?? undefined,
        attribution: p.attribution ?? undefined,
        strategy: p.strategy,
        lane: p.lane ?? "scholarly",
      })),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
  getSearch(searchId: string): CompassSearchSession | null {
    return this.sessionRow(searchId);
  }
  listHistory(limit = 50): CompassSearchSession[] {
    return (
      this.db
        .prepare(
          "SELECT search_id FROM compass_searches ORDER BY updated_at DESC LIMIT ?",
        )
        .all(Math.max(1, Math.min(200, limit))) as any[]
    )
      .map((r) => this.sessionRow(r.search_id))
      .filter((x): x is CompassSearchSession => !!x);
  }
  deleteSearch(searchId: string): void {
    this.db
      .prepare("DELETE FROM compass_searches WHERE search_id=?")
      .run(searchId);
  }
  clearHistory(): void {
    this.db.prepare("DELETE FROM compass_searches").run();
  }
  private resultSortKey(searchId: string, result: CompassResult): number {
    const row = this.db
      .prepare("SELECT filters_json FROM compass_searches WHERE search_id=?")
      .get(searchId) as { filters_json?: string } | undefined;
    const sort =
      json<CompassFilters>(row?.filters_json, {}).sort ?? "relevance";
    if (sort === "date") return result.issuedYear ?? -9_999;
    if (sort === "citations") return result.citationCount ?? -1;
    return result.finalScore;
  }
  upsertResult(
    searchId: string,
    result: CompassResult,
    revision: number,
  ): void {
    let persisted = result;
    let payload = JSON.stringify(persisted);
    if (Buffer.byteLength(payload, "utf8") > MAX_RESULT_JSON) {
      persisted = {
        ...result,
        abstract: result.abstract?.slice(0, 8_000),
        authors: result.authors.slice(0, 32),
        disciplines: result.disciplines.slice(0, 24),
        topics: result.topics.slice(0, 48),
        identifiers: result.identifiers.slice(0, 32),
        provenance: result.provenance.slice(0, 24),
        downloadLinks: result.downloadLinks?.slice(0, 12),
        reasons: result.reasons.slice(0, 24),
        duplicateAliases: result.duplicateAliases?.slice(0, 32),
      };
      payload = JSON.stringify(persisted);
    }
    if (Buffer.byteLength(payload, "utf8") > MAX_RESULT_JSON)
      throw new Error("Compass result exceeds the persistence limit.");
    const firstSeen = Number(
      (
        this.db
          .prepare(
            "SELECT COALESCE(MAX(first_seen), 0) + 1 AS next_position FROM compass_candidates WHERE search_id=?",
          )
          .get(searchId) as { next_position: number }
      ).next_position,
    );
    const exists = this.db
      .prepare(
        "SELECT 1 FROM compass_candidates WHERE search_id=? AND canonical_key=?",
      )
      .get(searchId, persisted.canonicalKey);
    if (
      !exists &&
      Number(
        (
          this.db
            .prepare(
              "SELECT COUNT(*) AS n FROM compass_candidates WHERE search_id=?",
            )
            .get(searchId) as { n: number }
        ).n,
      ) >= 2_000
    )
      throw new Error("Compass candidate limit reached; refine the query.");
    this.db
      .prepare(
        `INSERT INTO compass_candidates(search_id,canonical_key,result_json,sort_key,first_seen,revision,normalized_title,issued_year,normalized_first_author,lane,native_score,native_rank,display_rank) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(search_id,canonical_key) DO UPDATE SET result_json=excluded.result_json,sort_key=excluded.sort_key,revision=excluded.revision,normalized_title=excluded.normalized_title,issued_year=excluded.issued_year,normalized_first_author=excluded.normalized_first_author,lane=excluded.lane,native_score=excluded.native_score,native_rank=excluded.native_rank,display_rank=excluded.display_rank`,
      )
      .run(
        searchId,
        persisted.canonicalKey,
        payload,
        this.resultSortKey(searchId, persisted),
        firstSeen,
        revision,
        normalizedTitle(persisted.title),
        persisted.issuedYear ?? null,
        normalizedTitle(persisted.authors[0]?.name ?? ""),
        persisted.lane ?? "scholarly",
        persisted.nativeScore ?? null,
        persisted.nativeRank ?? null,
        persisted.displayRank ?? null,
      );
    const identity = this.db.prepare(
      "INSERT OR IGNORE INTO compass_candidate_identities(search_id,scheme,normalized_value,canonical_key) VALUES(?,?,?,?)",
    );
    for (const id of persisted.identifiers)
      if (id.value)
        identity.run(
          searchId,
          id.scheme.toLowerCase(),
          normalizedIdentity(id.scheme, id.value),
          persisted.canonicalKey,
        );
  }
  upsertResults(
    searchId: string,
    results: CompassResult[],
    revision: number,
  ): void {
    const tx = this.db.transaction(() =>
      results.forEach((r) => this.upsertResult(searchId, r, revision)),
    );
    tx();
    this.pruneHistory();
  }
  stabilizeResultOrder(searchId: string): void {
    const rows = this.db
      .prepare(
        "SELECT canonical_key FROM compass_candidates WHERE search_id=? ORDER BY sort_key DESC, canonical_key",
      )
      .all(searchId) as Array<{ canonical_key: string }>;
    const update = this.db.prepare(
      "UPDATE compass_candidates SET first_seen=? WHERE search_id=? AND canonical_key=?",
    );
    this.db.transaction(() =>
      rows.forEach((row, index) =>
        update.run(index + 1, searchId, row.canonical_key),
      ),
    )();
  }
  private filteredResults(searchId: string): CompassResult[] {
    const search = this.db
      .prepare(
        "SELECT fingerprint,filters_json,lane FROM compass_searches WHERE search_id=?",
      )
      .get(searchId) as any;
    if (!search) return [];
    const filters = json<CompassFilters>(search.filters_json, {});
    const lane = (filters.lane ?? search.lane ?? "scholarly") as CompassLane;
    const dismissed = new Set(
      (
        this.db
          .prepare(
            "SELECT canonical_key FROM compass_dismissals WHERE fingerprint=?",
          )
          .all(search.fingerprint) as any[]
      ).map((row) => row.canonical_key),
    );
    const rows = this.db
      .prepare("SELECT result_json FROM compass_candidates WHERE search_id=?")
      .all(searchId) as any[];
    const values = rows
      .map((row) => json<CompassResult>(row.result_json, {} as CompassResult))
      .filter(
        (entry) =>
          entry.canonicalKey &&
          !dismissed.has(entry.canonicalKey) &&
          (entry.lane ?? "scholarly") === lane,
      )
      .filter(
        (entry) =>
          !filters.fromYear ||
          (entry.issuedYear != null && entry.issuedYear >= filters.fromYear),
      )
      .filter(
        (entry) =>
          !filters.toYear ||
          (entry.issuedYear != null && entry.issuedYear <= filters.toYear),
      )
      .filter(
        (entry) =>
          !filters.languages?.length ||
          (entry.language &&
            filters.languages.some((language) =>
              entry
                .language!.toLocaleLowerCase()
                .startsWith(language.toLocaleLowerCase()),
            )),
      )
      .filter(
        (entry) => !filters.types?.length || filters.types.includes(entry.type),
      )
      .filter(
        (entry) =>
          !filters.providers?.length ||
          entry.provenance.some((source) =>
            filters.providers!.includes(source.provider),
          ),
      )
      .filter(
        (entry) =>
          !filters.openAccessOnly ||
          (entry.openAccess && entry.openAccess.status !== "closed"),
      )
      .filter(
        (entry) => !filters.digitallyAvailableOnly || entry.digitallyAvailable,
      );
    const sort = filters.sort ?? "relevance";
    values.sort((left, right) =>
      sort === "date"
        ? (right.issuedYear ?? -Infinity) - (left.issuedYear ?? -Infinity) ||
          left.canonicalKey.localeCompare(right.canonicalKey)
        : sort === "citations"
          ? (right.citationCount ?? -1) - (left.citationCount ?? -1) ||
            left.canonicalKey.localeCompare(right.canonicalKey)
          : right.finalScore - left.finalScore ||
            left.canonicalKey.localeCompare(right.canonicalKey),
    );
    return values.map((entry, index) => ({ ...entry, displayRank: index + 1 }));
  }
  listResults(
    searchId: string,
    offset = 0,
    limit = MAX_PAGE,
  ): CompassResultSummary[] {
    return this.filteredResults(searchId)
      .slice(
        Math.max(0, offset),
        Math.max(0, offset) + Math.min(MAX_PAGE, Math.max(1, limit)),
      )
      .map(summary);
  }
  resultCount(searchId: string): number {
    return this.filteredResults(searchId).length;
  }
  updateView(
    searchId: string,
    lane: CompassLane,
    filters: CompassFilters,
    viewRevision: number,
  ): void {
    this.db
      .prepare(
        "UPDATE compass_searches SET lane=?,filters_json=?,view_revision=?,updated_at=? WHERE search_id=?",
      )
      .run(
        lane,
        JSON.stringify({ ...filters, lane }),
        viewRevision,
        Date.now(),
        searchId,
      );
  }
  getResult(searchId: string, key: string): CompassResult | null {
    const row = this.db
      .prepare(
        "SELECT result_json FROM compass_candidates WHERE search_id=? AND canonical_key=?",
      )
      .get(searchId, key) as any;
    return row
      ? json<CompassResult>(row.result_json, {} as CompassResult)
      : null;
  }
  findResultByIdentity(
    searchId: string,
    identities: Array<{ scheme: string; value: string }>,
    title?: string,
    year?: number,
    firstAuthor?: string,
  ): CompassResult | null {
    for (const identity of identities) {
      if (!new Set(["doi", "isbn", "pmid", "pmcid", "arxiv"]).has(identity.scheme.toLowerCase()))
        continue;
      const row = this.db
        .prepare(
          "SELECT canonical_key FROM compass_candidate_identities WHERE search_id=? AND scheme=? AND normalized_value=?",
        )
        .get(
          searchId,
          identity.scheme.toLowerCase(),
          normalizedIdentity(identity.scheme, identity.value),
        ) as any;
      if (row) return this.getResult(searchId, row.canonical_key);
    }
    if (title) {
      const row = this.db
        .prepare(
          `SELECT canonical_key FROM compass_candidates
        WHERE search_id=? AND normalized_title=?
          AND (? IS NULL OR issued_year IS NULL OR issued_year=?)
          AND (?='' OR normalized_first_author='' OR normalized_first_author=?)
        ORDER BY first_seen ASC LIMIT 1`,
        )
        .get(
          searchId,
          normalizedTitle(title),
          year ?? null,
          year ?? null,
          normalizedTitle(firstAuthor ?? ""),
          normalizedTitle(firstAuthor ?? ""),
        ) as any;
      if (row) return this.getResult(searchId, row.canonical_key);
    }
    return null;
  }
  setSelection(searchId: string, keys: string[], revision: number): void {
    const tx = this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM compass_selections WHERE search_id=?")
        .run(searchId);
      const stmt = this.db.prepare(
        "INSERT INTO compass_selections(search_id,canonical_key,revision) VALUES(?,?,?)",
      );
      for (const key of keys.slice(0, 10_000))
        stmt.run(searchId, key, revision);
    });
    tx();
  }
  selectRange(
    searchId: string,
    from: number,
    to: number,
    selected: boolean,
    revision: number,
  ): string[] {
    const keys = this.filteredResults(searchId)
      .slice(Math.max(0, from), Math.min(2_000, to + 1))
      .map((entry) => entry.canonicalKey);
    const tx = this.db.transaction(() => {
      const insert = this.db.prepare(
        "INSERT OR REPLACE INTO compass_selections(search_id,canonical_key,revision) VALUES(?,?,?)",
      );
      const remove = this.db.prepare(
        "DELETE FROM compass_selections WHERE search_id=? AND canonical_key=?",
      );
      for (const key of keys) {
        if (selected) insert.run(searchId, key, revision);
        else remove.run(searchId, key);
      }
    });
    tx();
    return keys;
  }
  selectedKeys(searchId: string): string[] {
    return (
      this.db
        .prepare(
          "SELECT canonical_key FROM compass_selections WHERE search_id=?",
        )
        .all(searchId) as any[]
    ).map((r) => r.canonical_key);
  }
  saveCandidate(searchId: string, key: string): void {
    const result = this.getResult(searchId, key);
    if (result)
      this.db
        .prepare(
          "INSERT INTO compass_saved_candidates(canonical_key,result_json,saved_at) VALUES(?,?,?) ON CONFLICT(canonical_key) DO UPDATE SET result_json=excluded.result_json,saved_at=excluded.saved_at",
        )
        .run(key, JSON.stringify(result), Date.now());
  }
  listSavedCandidates(limit = 100): CompassResultSummary[] {
    return (
      this.db
        .prepare(
          "SELECT result_json FROM compass_saved_candidates ORDER BY saved_at DESC LIMIT ?",
        )
        .all(Math.max(1, Math.min(500, limit))) as any[]
    ).map((row) =>
      summary(json<CompassResult>(row.result_json, {} as CompassResult)),
    );
  }
  dismissCandidate(searchId: string, key: string): void {
    const row = this.db
      .prepare("SELECT fingerprint FROM compass_searches WHERE search_id=?")
      .get(searchId) as any;
    if (row)
      this.db
        .prepare(
          "INSERT OR REPLACE INTO compass_dismissals(fingerprint,canonical_key,dismissed_at) VALUES(?,?,?)",
        )
        .run(row.fingerprint, key, Date.now());
  }
  restoreCandidate(searchId: string, key: string): void {
    const row = this.db
      .prepare("SELECT fingerprint FROM compass_searches WHERE search_id=?")
      .get(searchId) as any;
    if (row)
      this.db
        .prepare(
          "DELETE FROM compass_dismissals WHERE fingerprint=? AND canonical_key=?",
        )
        .run(row.fingerprint, key);
  }
  createImportJob(job: CompassImportJob): void {
    this.db
      .prepare("INSERT INTO compass_import_jobs VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run(
        job.jobId,
        job.searchId,
        job.selectionRevision,
        JSON.stringify(job.selectedKeys.slice(0, 10_000)),
        JSON.stringify(job.collectionIds),
        job.state,
        job.total,
        job.completed,
        job.failed,
        job.createdAt,
        job.updatedAt,
      );
    const stmt = this.db.prepare(
      "INSERT INTO compass_import_items(job_id,canonical_key,state) VALUES(?,?,?)",
    );
    const tx = this.db.transaction(() =>
      job.selectedKeys
        .slice(0, 10_000)
        .forEach((k) => stmt.run(job.jobId, k, "queued")),
    );
    tx();
  }
  getImportJob(jobId: string): CompassImportJob | null {
    const r = this.db
      .prepare("SELECT * FROM compass_import_jobs WHERE job_id=?")
      .get(jobId) as any;
    if (!r) return null;
    return {
      jobId: r.job_id,
      searchId: r.search_id,
      selectionRevision: r.selection_revision,
      selectedKeys: json(r.selected_keys_json, []),
      collectionIds: json(r.collection_ids_json, []),
      state: r.state,
      total: r.total,
      completed: r.completed,
      failed: r.failed,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
  updateImportJob(job: CompassImportJob): void {
    this.db
      .prepare(
        "UPDATE compass_import_jobs SET state=?,completed=?,failed=?,updated_at=? WHERE job_id=?",
      )
      .run(job.state, job.completed, job.failed, job.updatedAt, job.jobId);
  }
  listImportItems(jobId: string): CompassImportItemResult[] {
    return (
      this.db
        .prepare(
          `SELECT item.*,download.attachment_id,download.bytes,download.sha256,COALESCE(download.error,item.error) AS combined_error FROM compass_import_items item LEFT JOIN compass_import_downloads download ON download.job_id=item.job_id AND download.canonical_key=item.canonical_key WHERE item.job_id=?`,
        )
        .all(jobId) as any[]
    ).map((r) => ({
      jobId,
      canonicalKey: r.canonical_key,
      state: r.state,
      libraryItemId: r.library_item_id ?? undefined,
      attachmentId: r.attachment_id ?? undefined,
      bytes: r.bytes ?? undefined,
      sha256: r.sha256 ?? undefined,
      error: r.combined_error ?? undefined,
    }));
  }
  updateImportItem(item: CompassImportItemResult): void {
    this.db
      .prepare(
        "UPDATE compass_import_items SET state=?,library_item_id=?,error=?,attempts=attempts+1 WHERE job_id=? AND canonical_key=?",
      )
      .run(
        item.state,
        item.libraryItemId ?? null,
        item.error ?? null,
        item.jobId,
        item.canonicalKey,
      );
    if (
      [
        "downloading",
        "attached",
        "no-file",
        "skipped-limit",
        "failed",
        "canceled",
      ].includes(item.state)
    )
      this.db
        .prepare(
          `INSERT INTO compass_import_downloads(job_id,canonical_key,state,bytes,sha256,attachment_id,error,attempts) VALUES(?,?,?,?,?,?,?,1) ON CONFLICT(job_id,canonical_key) DO UPDATE SET state=excluded.state,bytes=COALESCE(excluded.bytes,bytes),sha256=COALESCE(excluded.sha256,sha256),attachment_id=COALESCE(excluded.attachment_id,attachment_id),error=excluded.error,attempts=attempts+1`,
        )
        .run(
          item.jobId,
          item.canonicalKey,
          item.state,
          item.bytes ?? null,
          item.sha256 ?? null,
          item.attachmentId ?? null,
          item.error ?? null,
        );
  }
  setImportDownloadSource(
    jobId: string,
    canonicalKey: string,
    link: CompassDownloadLink,
  ): void {
    this.db
      .prepare(
        `INSERT INTO compass_import_downloads(job_id,canonical_key,url,license,rights,state) VALUES(?,?,?,?,?,'queued') ON CONFLICT(job_id,canonical_key) DO UPDATE SET url=excluded.url,license=excluded.license,rights=excluded.rights`,
      )
      .run(
        jobId,
        canonicalKey,
        link.url,
        link.license ?? null,
        link.rights ?? null,
      );
  }
  findAttachedDownloadByUrl(
    url: string,
  ): { attachmentId: string; sha256: string; bytes?: number } | null {
    const row = this.db
      .prepare(
        `SELECT attachment_id,sha256,bytes FROM compass_import_downloads WHERE url=? AND state='attached' AND attachment_id IS NOT NULL AND sha256 IS NOT NULL ORDER BY rowid DESC LIMIT 1`,
      )
      .get(url) as any;
    return row
      ? {
          attachmentId: row.attachment_id,
          sha256: row.sha256,
          bytes: row.bytes ?? undefined,
        }
      : null;
  }
  resetImportItems(jobId: string): void {
    this.db
      .prepare(
        "UPDATE compass_import_items SET state='queued',library_item_id=NULL,error=NULL WHERE job_id=? AND state IN ('failed','canceled')",
      )
      .run(jobId);
  }
  cancelPendingImportItems(jobId: string): void {
    this.db
      .prepare(
        "UPDATE compass_import_items SET state='canceled',error='Canceled' WHERE job_id=? AND state IN ('queued','checking')",
      )
      .run(jobId);
  }
  upsertRoute(route: StoredCompassRoute): void {
    this.db
      .prepare(
        `INSERT INTO compass_search_routes(search_id,provider,strategy,lane,cursor,page,state) VALUES(?,?,?,?,?,?,?) ON CONFLICT(search_id,provider,lane) DO UPDATE SET strategy=excluded.strategy,cursor=excluded.cursor,page=excluded.page,state=excluded.state`,
      )
      .run(
        route.searchId,
        route.provider,
        route.strategy,
        route.lane,
        route.cursor ?? null,
        route.page,
        route.state,
      );
  }
  getRoute(
    searchId: string,
    provider: CompassProviderId,
    lane: CompassLane,
  ): StoredCompassRoute | null {
    const row = this.db
      .prepare(
        "SELECT * FROM compass_search_routes WHERE search_id=? AND provider=? AND lane=?",
      )
      .get(searchId, provider, lane) as any;
    return row
      ? {
          searchId: row.search_id,
          provider: row.provider,
          strategy: row.strategy,
          lane: row.lane,
          cursor: row.cursor ?? undefined,
          page: row.page,
          state: row.state,
        }
      : null;
  }
  listRoutes(searchId: string): StoredCompassRoute[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM compass_search_routes WHERE search_id=? ORDER BY rowid",
        )
        .all(searchId) as any[]
    ).map((row) => ({
      searchId: row.search_id,
      provider: row.provider,
      strategy: row.strategy,
      lane: row.lane,
      cursor: row.cursor ?? undefined,
      page: row.page,
      state: row.state,
    }));
  }
  getProviderUsage(provider: CompassProviderId): CompassProviderUsage | null {
    const row = this.db
      .prepare("SELECT * FROM compass_provider_usage WHERE provider=?")
      .get(provider) as any;
    return row
      ? {
          provider: row.provider,
          day: row.day,
          dailyUsed: row.daily_used,
          tokens: row.tokens,
          tokenUpdatedAt: row.token_updated_at,
          nextAllowedAt: row.next_allowed_at,
          consecutiveFailures: row.consecutive_failures,
          circuitUntil: row.circuit_until ?? undefined,
          retryAt: row.retry_at ?? undefined,
        }
      : null;
  }
  saveProviderUsage(usage: CompassProviderUsage): void {
    this.db
      .prepare(
        `INSERT INTO compass_provider_usage(provider,day,daily_used,tokens,token_updated_at,next_allowed_at,consecutive_failures,circuit_until,retry_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(provider) DO UPDATE SET day=excluded.day,daily_used=excluded.daily_used,tokens=excluded.tokens,token_updated_at=excluded.token_updated_at,next_allowed_at=excluded.next_allowed_at,consecutive_failures=excluded.consecutive_failures,circuit_until=excluded.circuit_until,retry_at=excluded.retry_at`,
      )
      .run(
        usage.provider,
        usage.day,
        usage.dailyUsed,
        usage.tokens,
        usage.tokenUpdatedAt,
        usage.nextAllowedAt,
        usage.consecutiveFailures,
        usage.circuitUntil ?? null,
        usage.retryAt ?? null,
      );
  }
  putProviderCache(
    cacheKey: string,
    provider: CompassProviderId,
    payload: unknown,
    nextCursor: string | undefined,
    ttlMs: number,
  ): void {
    const payloadJson = JSON.stringify(payload);
    if (Buffer.byteLength(payloadJson, "utf8") > MAX_CACHE_JSON) return;
    const stamp = Date.now();
    this.db
      .prepare(
        `INSERT INTO compass_provider_cache(cache_key,provider,payload_json,next_cursor,retrieved_at,expires_at,last_accessed_at,byte_size) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET payload_json=excluded.payload_json,next_cursor=excluded.next_cursor,retrieved_at=excluded.retrieved_at,expires_at=excluded.expires_at,last_accessed_at=excluded.last_accessed_at,byte_size=excluded.byte_size`,
      )
      .run(
        cacheKey,
        provider,
        payloadJson,
        nextCursor ?? null,
        stamp,
        stamp + Math.min(Math.max(ttlMs, 60_000), 30 * 24 * 60 * 60_000),
        stamp,
        Buffer.byteLength(payloadJson, "utf8"),
      );
    this.pruneCache();
  }
  getProviderCache(
    cacheKey: string,
  ): { payload: unknown; nextCursor?: string } | null {
    const row = this.db
      .prepare(
        "SELECT payload_json,next_cursor,expires_at FROM compass_provider_cache WHERE cache_key=?",
      )
      .get(cacheKey) as any;
    if (!row || row.expires_at < Date.now()) {
      if (row)
        this.db
          .prepare("DELETE FROM compass_provider_cache WHERE cache_key=?")
          .run(cacheKey);
      return null;
    }
    this.db
      .prepare(
        "UPDATE compass_provider_cache SET last_accessed_at=? WHERE cache_key=?",
      )
      .run(Date.now(), cacheKey);
    return {
      payload: json(row.payload_json, null),
      nextCursor: row.next_cursor ?? undefined,
    };
  }
  private pruneCache(maxBytes = 64 * 1024 * 1024): void {
    const current = Number(
      (
        this.db
          .prepare(
            "SELECT COALESCE(SUM(byte_size),0) AS total FROM compass_provider_cache",
          )
          .get() as any
      ).total,
    );
    if (current <= maxBytes) return;
    const rows = this.db
      .prepare(
        "SELECT cache_key,byte_size FROM compass_provider_cache ORDER BY last_accessed_at ASC",
      )
      .all() as any[];
    let total = current;
    const remove = this.db.prepare(
      "DELETE FROM compass_provider_cache WHERE cache_key=?",
    );
    for (const row of rows) {
      if (total <= maxBytes) break;
      remove.run(row.cache_key);
      total -= Number(row.byte_size);
    }
  }
  private pruneHistory(maxBytes = 256 * 1024 * 1024): void {
    let total = Number(
      (
        this.db
          .prepare(
            `SELECT COALESCE(SUM(length(result_json)),0) AS total FROM compass_candidates`,
          )
          .get() as any
      ).total,
    );
    if (total <= maxBytes) return;
    const rows = this.db
      .prepare(
        `SELECT search_id, COALESCE((SELECT SUM(length(result_json)) FROM compass_candidates c WHERE c.search_id=s.search_id),0) AS bytes FROM compass_searches s WHERE NOT EXISTS (SELECT 1 FROM compass_import_jobs j WHERE j.search_id=s.search_id) ORDER BY updated_at ASC`,
      )
      .all() as Array<{ search_id: string; bytes: number }>;
    const remove = this.db.prepare(
      "DELETE FROM compass_searches WHERE search_id=?",
    );
    for (const row of rows) {
      if (total <= maxBytes) break;
      remove.run(row.search_id);
      total -= Number(row.bytes);
    }
  }
}

export function compassDatabasePath(): string {
  return defaultFile();
}
