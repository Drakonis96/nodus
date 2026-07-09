import { getDb } from './database';
import { v4 as uuid } from 'uuid';
import crypto from 'node:crypto';
import type {
  Idea,
  IdeaType,
  Edge,
  EdgeType,
  EdgeBasis,
  Evidence,
  EvidenceKind,
  IdeaDetail,
  IdeaByWork,
  EdgeDetail,
  EdgeTrace,
  ModelRef,
  EmbeddingProvider,
} from '@shared/types';
import { getWorksByIds } from './worksRepo';
import { getSettings } from './settingsRepo';
import { getEdgeFeedback } from './edgeFeedbackRepo';

const EDGE_TYPES = new Set<EdgeType>([
  'extends',
  'contradicts',
  'applies_to',
  'shares_method',
  'precondition_of',
  'measures_same',
  'supports',
  'refutes',
  'variant_of',
  'refines',
  'contains',
]);

const SYMMETRIC_EDGE_TYPES = new Set<EdgeType>(['contradicts', 'shares_method', 'measures_same', 'variant_of']);

const DEFAULT_EMBED_MODELS: Record<EmbeddingProvider, string> = {
  openai: 'text-embedding-3-small',
  openrouter: 'baai/bge-m3',
  gemini: 'gemini-embedding-001',
};

export function normalizeEdgeType(type: string | null | undefined): EdgeType | null {
  const raw = (type ?? '').trim().toLowerCase();
  if (EDGE_TYPES.has(raw as EdgeType)) return raw as EdgeType;
  if (raw === 'has_variant') return 'variant_of';
  return null;
}

export function normalizeEdgeBasis(basis: string | null | undefined): EdgeBasis {
  return basis === 'explicit' ? 'explicit' : 'inferred';
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function normalizeEmbeddingModel(provider: EmbeddingProvider, modelId: string): string {
  const trimmed = modelId.trim() || DEFAULT_EMBED_MODELS[provider];
  if (provider === 'openrouter' && !trimmed.includes('/') && trimmed.includes(':')) {
    const [author, slug] = trimmed.split(':', 2);
    if (author && slug) return `${author.toLowerCase()}/${slug}`;
  }
  return trimmed;
}

export function currentEmbeddingConfig(): { provider: EmbeddingProvider; model: string } {
  const settings = getSettings();
  const provider = settings.embeddingProvider ?? 'openai';
  return {
    provider,
    model: normalizeEmbeddingModel(provider, settings.embeddingModel || DEFAULT_EMBED_MODELS[provider]),
  };
}

export function embeddingTextForIdea(input: {
  type?: string | null;
  label: string;
  statement: string;
  themes?: string[] | null;
}): string {
  const parts = [
    input.type ? `tipo: ${input.type}` : '',
    `etiqueta: ${input.label}`,
    `enunciado: ${input.statement}`,
    input.themes?.length ? `temas: ${input.themes.slice(0, 4).join(', ')}` : '',
  ].filter(Boolean);
  return parts.join('\n');
}

export function embeddingTextHash(text: string): string {
  return crypto.createHash('sha1').update(text.replace(/\s+/g, ' ').trim()).digest('hex');
}

function embeddingMetaFor(text: string, embedding: number[]): {
  provider: EmbeddingProvider;
  model: string;
  dim: number;
  textHash: string;
} {
  const config = currentEmbeddingConfig();
  return {
    ...config,
    dim: embedding.length,
    textHash: embeddingTextHash(text),
  };
}

export function ideaNeedsEmbedding(row: {
  embedding: Buffer | null;
  embedding_provider: string | null;
  embedding_model: string | null;
  embedding_dim: number | null;
  embedding_text_hash: string | null;
}, text: string): boolean {
  if (!row.embedding) return true;
  const config = currentEmbeddingConfig();
  const dim = row.embedding.byteLength / 4;
  return (
    row.embedding_provider !== config.provider ||
    row.embedding_model !== config.model ||
    row.embedding_dim !== dim ||
    row.embedding_text_hash !== embeddingTextHash(text)
  );
}

// ── Embedding (de)serialization: store float32 array as BLOB ────────────────

export function encodeEmbedding(vec: number[]): Buffer {
  const f32 = new Float32Array(vec);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

export function decodeEmbedding(buf: Buffer): number[] {
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  return Array.from(f32);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ── Global id allocation: g-0001, g-0002, ... (assigned by the app, never AI) ─

export function nextGlobalId(): string {
  const db = getDb();
  const row = db.prepare("SELECT global_id FROM ideas WHERE global_id LIKE 'g-%' ORDER BY global_id DESC LIMIT 1").get() as
    | { global_id: string }
    | undefined;
  let n = 1;
  if (row) {
    const parsed = parseInt(row.global_id.slice(2), 10);
    if (!Number.isNaN(parsed)) n = parsed + 1;
  }
  return `g-${String(n).padStart(4, '0')}`;
}

export interface NewIdeaInput {
  type: IdeaType;
  label: string;
  statement: string;
  embedding: number[] | null;
  embeddingText?: string;
  themes?: string[];
}

export function createIdea(input: NewIdeaInput): Idea {
  const db = getDb();
  const global_id = nextGlobalId();
  const created_at = new Date().toISOString();
  const embeddingText = input.embeddingText ?? embeddingTextForIdea(input);
  const meta = input.embedding ? embeddingMetaFor(embeddingText, input.embedding) : null;
  db.prepare(
    `INSERT INTO ideas (
       global_id, type, label, statement, embedding, created_at,
       embedding_provider, embedding_model, embedding_dim, embedding_text_hash
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    global_id,
    input.type,
    input.label,
    input.statement,
    input.embedding ? encodeEmbedding(input.embedding) : null,
    created_at,
    meta?.provider ?? null,
    meta?.model ?? null,
    meta?.dim ?? null,
    meta?.textHash ?? null
  );
  return { global_id, ...input, created_at };
}

export function updateIdeaEmbedding(globalId: string, text: string, embedding: number[]): void {
  const meta = embeddingMetaFor(text, embedding);
  getDb()
    .prepare(
      `UPDATE ideas
          SET embedding = ?,
              embedding_provider = ?,
              embedding_model = ?,
              embedding_dim = ?,
              embedding_text_hash = ?
        WHERE global_id = ?`
    )
    .run(encodeEmbedding(embedding), meta.provider, meta.model, meta.dim, meta.textHash, globalId);
}

export function clearAllEmbeddings(): void {
  getDb()
    .prepare(
      `UPDATE ideas
          SET embedding = NULL,
              embedding_provider = NULL,
              embedding_model = NULL,
              embedding_dim = NULL,
              embedding_text_hash = NULL
        WHERE embedding IS NOT NULL`
    )
    .run();
}

export function getIdea(globalId: string): Idea | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM ideas WHERE global_id = ?').get(globalId) as
    | (Omit<Idea, 'embedding'> & { embedding: Buffer | null })
    | undefined;
  if (!row) return null;
  return { ...row, embedding: row.embedding ? decodeEmbedding(row.embedding) : null };
}

/**
 * Lightweight idea lookup that skips the embedding BLOB. The detail panels and
 * edge explanations never need the vector, so decoding a 1536-float array on
 * every tap was pure waste (and the main reason the sidebar felt laggy on big
 * libraries — each tap re-decoded embeddings for the idea and both endpoints).
 */
export function getIdeaSummary(globalId: string): Idea | null {
  const db = getDb();
  const row = db
    .prepare('SELECT global_id, type, label, statement, created_at FROM ideas WHERE global_id = ?')
    .get(globalId) as Omit<Idea, 'embedding'> | undefined;
  if (!row) return null;
  return { ...row, embedding: null };
}

/** All ideas with a current-model embedding. Kept for small in-memory consumers. */
export function ideasWithEmbeddings(): { global_id: string; type: IdeaType; label: string; statement: string; embedding: number[] }[] {
  const db = getDb();
  const config = currentEmbeddingConfig();
  const rows = db
    .prepare(
      `SELECT global_id, type, label, statement, embedding
         FROM ideas
        WHERE embedding IS NOT NULL
          AND embedding_provider = ?
          AND embedding_model = ?
          AND embedding_dim IS NOT NULL
          AND orphaned_at IS NULL`
    )
    .all(config.provider, config.model) as {
    global_id: string;
    type: IdeaType;
    label: string;
    statement: string;
    embedding: Buffer;
  }[];
  return rows.map((r) => ({ ...r, embedding: decodeEmbedding(r.embedding) }));
}

export function allIdeaCandidates(options: { includeDormant?: boolean } = {}): { global_id: string; type: IdeaType; label: string; statement: string }[] {
  const dormantSql = options.includeDormant ? '' : 'WHERE orphaned_at IS NULL';
  return getDb().prepare(`SELECT global_id, type, label, statement FROM ideas ${dormantSql}`).all() as {
    global_id: string;
    type: IdeaType;
    label: string;
    statement: string;
  }[];
}

/**
 * Find ideas whose embedding cosine-similarity to the query vector meets the threshold.
 * Pushes the computation into SQLite via the vec_cosine() custom function so we never
 * load all embeddings into JS memory.
 */
export function findSimilarIdeas(
  queryEmbedding: number[],
  threshold: number,
  limit: number,
  options: { excludeIds?: string[]; includeDormant?: boolean } = {}
): { global_id: string; type: IdeaType; label: string; statement: string; similarity: number }[] {
  const buf = encodeEmbedding(queryEmbedding);
  const config = currentEmbeddingConfig();
  const excluded = options.excludeIds ?? [];
  const excludeSql = excluded.length ? `AND global_id NOT IN (${excluded.map(() => '?').join(',')})` : '';
  // Dormant ideas (no occurrences after a rescan) are hidden from every
  // retrieval consumer; only fusion opts in, so it can revive them.
  const dormantSql = options.includeDormant ? '' : 'AND orphaned_at IS NULL';
  return getDb()
    .prepare(
      `SELECT * FROM (
         SELECT global_id, type, label, statement, vec_cosine(embedding, ?) AS similarity
         FROM ideas
         WHERE embedding IS NOT NULL
           AND embedding_provider = ?
           AND embedding_model = ?
           AND embedding_dim = ?
           ${dormantSql}
           ${excludeSql}
       ) WHERE similarity >= ?
       ORDER BY similarity DESC
       LIMIT ?`
    )
    .all(buf, config.provider, config.model, queryEmbedding.length, ...excluded, threshold, limit) as {
    global_id: string;
    type: IdeaType;
    label: string;
    statement: string;
    similarity: number;
  }[];
}

/**
 * Cosine similarity of the query vector to a specific set of ideas (those that
 * carry a current-model embedding). Used to score graph-expansion neighbours,
 * where the candidate ids are already known and only need ranking.
 */
export function ideaEmbeddingSimilarities(
  queryEmbedding: number[],
  ids: string[]
): { global_id: string; type: IdeaType; label: string; statement: string; similarity: number }[] {
  if (ids.length === 0) return [];
  const buf = encodeEmbedding(queryEmbedding);
  const config = currentEmbeddingConfig();
  const placeholders = ids.map(() => '?').join(',');
  return getDb()
    .prepare(
      `SELECT global_id, type, label, statement, vec_cosine(embedding, ?) AS similarity
         FROM ideas
        WHERE embedding IS NOT NULL
          AND embedding_provider = ?
          AND embedding_model = ?
          AND embedding_dim = ?
          AND global_id IN (${placeholders})
        ORDER BY similarity DESC`
    )
    .all(buf, config.provider, config.model, queryEmbedding.length, ...ids) as {
    global_id: string;
    type: IdeaType;
    label: string;
    statement: string;
    similarity: number;
  }[];
}

/** How many ideas carry an embedding for the current provider/model (0 ⇒ library not indexed). */
export function embeddedIdeaCount(): number {
  const config = currentEmbeddingConfig();
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS count
         FROM ideas
        WHERE embedding IS NOT NULL
          AND embedding_provider = ?
          AND embedding_model = ?`
    )
    .get(config.provider, config.model) as { count: number };
  return row.count;
}

export function upsertOccurrence(
  globalId: string,
  nodusId: string,
  role: 'principal' | 'secondary',
  development: string,
  confidence: number
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO idea_occurrences (global_id, nodus_id, role, development, confidence)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(global_id, nodus_id) DO UPDATE SET role=excluded.role, development=excluded.development, confidence=excluded.confidence`
  ).run(globalId, nodusId, role, development, confidence);
  // Revival: re-attaching a work to a dormant idea restores it everywhere
  // (graph, search) with its original global_id intact.
  db.prepare('UPDATE ideas SET orphaned_at = NULL WHERE global_id = ? AND orphaned_at IS NOT NULL').run(globalId);
}

export function addEvidence(
  globalId: string,
  nodusId: string,
  quote: string,
  location: string | null,
  kind: EvidenceKind
): string {
  const id = uuid();
  getDb()
    .prepare('INSERT INTO evidence (id, global_id, nodus_id, quote, location, kind) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, globalId, nodusId, quote, location, kind);
  return id;
}

export interface NewEdgeInput {
  id?: string;
  from_id: string;
  to_id: string;
  type: string;
  basis: string;
  confidence: number;
  source_work: string | null;
  trace?: EdgeTraceInput | null;
}

export interface EdgeTraceInput {
  method: EdgeTrace['method'];
  model?: ModelRef | null;
  embeddingProvider?: string | null;
  embeddingModel?: string | null;
  similarity?: number | null;
  rationale?: string | null;
}

function canonicalEdgeEndpoints(fromId: string, toId: string, type: EdgeType): { from_id: string; to_id: string } {
  if (SYMMETRIC_EDGE_TYPES.has(type) && fromId > toId) {
    return { from_id: toId, to_id: fromId };
  }
  return { from_id: fromId, to_id: toId };
}

export function canonicalEdgeKey(fromId: string, toId: string, type: EdgeType): string {
  const endpoints = canonicalEdgeEndpoints(fromId, toId, type);
  return `${endpoints.from_id}|${endpoints.to_id}|${type}`;
}

export function upsertEdgeTrace(edgeId: string, trace: EdgeTraceInput): void {
  getDb()
    .prepare(
      `INSERT INTO edge_traces (
         edge_id, method, model_json, embedding_provider, embedding_model, similarity, rationale, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(edge_id) DO UPDATE SET
         method = excluded.method,
         model_json = excluded.model_json,
         embedding_provider = excluded.embedding_provider,
         embedding_model = excluded.embedding_model,
         similarity = excluded.similarity,
         rationale = excluded.rationale,
         created_at = excluded.created_at`
    )
    .run(
      edgeId,
      trace.method,
      trace.model ? JSON.stringify(trace.model) : null,
      trace.embeddingProvider ?? null,
      trace.embeddingModel ?? null,
      trace.similarity ?? null,
      trace.rationale ?? null,
      new Date().toISOString()
    );
}

export function getEdgeTrace(edgeId: string): EdgeTrace | null {
  const row = getDb()
    .prepare('SELECT * FROM edge_traces WHERE edge_id = ?')
    .get(edgeId) as
    | {
        edge_id: string;
        method: string;
        model_json: string | null;
        embedding_provider: string | null;
        embedding_model: string | null;
        similarity: number | null;
        rationale: string | null;
        created_at: string;
      }
    | undefined;
  if (!row) return null;
  let model: ModelRef | null = null;
  if (row.model_json) {
    try {
      model = JSON.parse(row.model_json) as ModelRef;
    } catch {
      model = null;
    }
  }
  return {
    edgeId: row.edge_id,
    method: row.method,
    model,
    embeddingProvider: row.embedding_provider,
    embeddingModel: row.embedding_model,
    similarity: row.similarity,
    rationale: row.rationale,
    createdAt: row.created_at,
  };
}

/** Insert an edge, de-duplicating on canonical (from, to, type); keeps the higher confidence. */
export function addEdge(input: NewEdgeInput): string | null {
  const type = normalizeEdgeType(input.type);
  if (!type) return null;
  const basis = normalizeEdgeBasis(input.basis);
  const confidence = clampConfidence(input.confidence);
  const endpoints = canonicalEdgeEndpoints(input.from_id, input.to_id, type);
  const db = getDb();
  const existing = db
    .prepare('SELECT id, confidence FROM edges WHERE from_id = ? AND to_id = ? AND type = ?')
    .get(endpoints.from_id, endpoints.to_id, type) as { id: string; confidence: number } | undefined;
  if (existing) {
    if (confidence > existing.confidence) {
      db.prepare('UPDATE edges SET confidence = ?, basis = ? WHERE id = ?').run(
        confidence,
        basis,
        existing.id
      );
    }
    if (input.trace) upsertEdgeTrace(existing.id, input.trace);
    return existing.id;
  }
  const id = input.id ?? uuid();
  db.prepare(
    'INSERT INTO edges (id, from_id, to_id, type, basis, confidence, source_work) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, endpoints.from_id, endpoints.to_id, type, basis, confidence, input.source_work);
  if (input.trace) upsertEdgeTrace(id, input.trace);
  return id;
}

/**
 * Reinitialise the whole graph: drop every piece of derived analysis (ideas, themes,
 * edges, authors, gaps, evidence) and reset each work's scan status to 'none' so it can
 * be analysed again from scratch. The Zotero-sourced library (works) and the user's
 * settings are kept — only the graph is wiped.
 */
export function resetGraphData(): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.exec(`
      DELETE FROM idea_occurrences;
      DELETE FROM evidence;
      DELETE FROM edge_traces;
      DELETE FROM edges;
      DELETE FROM ideas;
      DELETE FROM idea_theme_links;
      DELETE FROM gaps;
      DELETE FROM external_refs;
      DELETE FROM tutor_saved_routes;
      DELETE FROM work_authors;
      DELETE FROM author_relations;
      DELETE FROM authors;
      DELETE FROM work_themes;
      DELETE FROM themes;
      DELETE FROM work_summaries;
      DELETE FROM work_idea_synthesis;
      UPDATE works SET
        light_status = 'none', light_at = NULL, light_hash = NULL,
        deep_status = 'none', deep_at = NULL, deep_hash = NULL,
        summary_status = 'none', summary_at = NULL, summary_hash = NULL,
        source_type = NULL, notes = NULL;
    `);
  });
  tx();
}

/** Remove all derived deep-scan data for a work, so it can be cleanly re-scanned. */
export function purgeDeepData(nodusId: string): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM idea_occurrences WHERE nodus_id = ?').run(nodusId);
    db.prepare('DELETE FROM evidence WHERE nodus_id = ?').run(nodusId);
    db.prepare('DELETE FROM edge_traces WHERE edge_id IN (SELECT id FROM edges WHERE source_work = ?)').run(nodusId);
    db.prepare('DELETE FROM edges WHERE source_work = ?').run(nodusId);
    db.prepare('DELETE FROM idea_theme_links WHERE nodus_id = ?').run(nodusId);
    db.prepare('DELETE FROM gaps WHERE nodus_id = ?').run(nodusId);
    db.prepare('DELETE FROM external_refs WHERE nodus_id = ?').run(nodusId);
    db.prepare('DELETE FROM work_authors WHERE nodus_id = ?').run(nodusId);
    db.prepare('DELETE FROM work_idea_synthesis WHERE nodus_id = ?').run(nodusId);
    // Ideas that no longer have any occurrence go DORMANT instead of being
    // deleted. Deleting them here was the identity bug: the following rescan
    // re-extracted the same idea but fusion had nothing to match against, so it
    // minted a new global_id and orphaned every reference to the old one
    // (notes, tutor routes, drafts, edge feedback). A dormant idea keeps its
    // global_id and embedding, stays out of the graph and search (no
    // occurrences / orphaned_at filters), remains a fusion candidate, and is
    // revived by upsertOccurrence the moment any scan re-attaches it. Manual
    // ideas are never flagged: they are owned by a note and may legitimately
    // have no works linked yet.
    db.prepare(
      `UPDATE ideas SET orphaned_at = ?
        WHERE orphaned_at IS NULL
          AND global_id NOT IN (SELECT DISTINCT global_id FROM idea_occurrences)
          AND global_id NOT IN (
            SELECT json_extract(source_json, '$.ref') FROM notes
             WHERE json_extract(source_json, '$.note') = 'manual-idea'
          )`
    ).run(new Date().toISOString());
    db.prepare(
      `DELETE FROM edges
       WHERE from_id NOT IN (SELECT global_id FROM ideas)
          OR to_id NOT IN (SELECT global_id FROM ideas)`
    ).run();
    db.prepare('DELETE FROM edge_traces WHERE edge_id NOT IN (SELECT id FROM edges)').run();
  });
  tx();
}

/**
 * Delete ideas that have been dormant (no occurrences) longer than maxAgeDays.
 * Runs at startup as maintenance: recent dormancy is a revival opportunity —
 * fusion re-matches the idea on the next rescan and keeps its global_id —
 * while long-dormant ideas are genuinely gone from the corpus. Returns the
 * number of pruned ideas.
 */
export function pruneDormantIdeas(maxAgeDays = 30): number {
  const db = getDb();
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
  let pruned = 0;
  const tx = db.transaction(() => {
    const result = db
      .prepare(
        `DELETE FROM ideas
          WHERE orphaned_at IS NOT NULL
            AND orphaned_at < ?
            AND global_id NOT IN (SELECT DISTINCT global_id FROM idea_occurrences)
            AND global_id NOT IN (
              SELECT json_extract(source_json, '$.ref') FROM notes
               WHERE json_extract(source_json, '$.note') = 'manual-idea'
            )`
      )
      .run(cutoff);
    pruned = result.changes;
    if (pruned > 0) {
      db.prepare(
        `DELETE FROM edges
         WHERE from_id NOT IN (SELECT global_id FROM ideas)
            OR to_id NOT IN (SELECT global_id FROM ideas)`
      ).run();
      db.prepare('DELETE FROM edge_traces WHERE edge_id NOT IN (SELECT id FROM edges)').run();
    }
  });
  tx();
  return pruned;
}

// ── Detail panels ───────────────────────────────────────────────────────────

export function getIdeaDetail(globalId: string): IdeaDetail | null {
  const db = getDb();
  const idea = getIdeaSummary(globalId);
  if (!idea) return null;
  const occRows = db.prepare('SELECT * FROM idea_occurrences WHERE global_id = ?').all(globalId) as {
    global_id: string;
    nodus_id: string;
    role: 'principal' | 'secondary';
    development: string;
    confidence: number;
  }[];
  // Batch-load all works for the occurrences in 2 queries instead of N+1
  // (previously each occurrence called getWork() → 2 queries each).
  const worksById = getWorksByIds(occRows.map((o) => o.nodus_id));
  const occurrences = occRows
    .map((o) => {
      const work = worksById.get(o.nodus_id);
      return work ? { ...o, work } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const evidence = db.prepare('SELECT * FROM evidence WHERE global_id = ?').all(globalId) as Evidence[];
  return { idea, occurrences, evidence };
}

/**
 * Inverse of getIdeaDetail's occurrences: given a work's nodus_id, return every
 * idea anchored to it, paired with the fields specific to that idea↔work
 * occurrence (role, confidence, development). Read-only; no generation.
 */
export function getIdeasByWork(nodusId: string, limit: number, offset: number): { ideas: IdeaByWork[]; total: number } {
  const db = getDb();
  const total = (
    db.prepare('SELECT COUNT(*) AS count FROM idea_occurrences WHERE nodus_id = ?').get(nodusId) as { count: number }
  ).count;
  const ideas = db
    .prepare(
      `SELECT i.global_id, i.type, i.label, i.statement, o.role, o.confidence, o.development
         FROM idea_occurrences o
         JOIN ideas i ON i.global_id = o.global_id
        WHERE o.nodus_id = ?
        ORDER BY i.global_id
        LIMIT ? OFFSET ?`
    )
    .all(nodusId, limit, offset) as IdeaByWork[];
  return { ideas, total };
}

/** Every direct idea↔idea edge touching an idea, with its evidence and trace. */
export function getIdeaEdges(globalId: string): EdgeDetail[] {
  const rows = getDb()
    .prepare('SELECT id FROM visible_edges WHERE from_id = ? OR to_id = ? ORDER BY confidence DESC, id')
    .all(globalId, globalId) as { id: string }[];
  return rows.map((row) => getEdgeDetail(row.id)).filter((detail): detail is EdgeDetail => detail !== null);
}

export function getEdgeDetail(edgeId: string): EdgeDetail | null {
  const db = getDb();
  const edge = db.prepare('SELECT * FROM edges WHERE id = ?').get(edgeId) as Edge | undefined;
  if (!edge) return null;
  const from = getIdeaSummary(edge.from_id);
  const to = getIdeaSummary(edge.to_id);
  // Evidence on the source work for either endpoint idea.
  const evidence = edge.source_work
    ? (db
        .prepare('SELECT * FROM evidence WHERE nodus_id = ? AND global_id IN (?, ?)')
        .all(edge.source_work, edge.from_id, edge.to_id) as Evidence[])
    : [];
  return {
    edge,
    fromLabel: from?.label ?? edge.from_id,
    toLabel: to?.label ?? edge.to_id,
    explanation: contradictionExplanation(edge, from, to),
    evidence,
    trace: getEdgeTrace(edgeId),
    feedback: getEdgeFeedback(edge.from_id, edge.to_id, edge.type),
  };
}

function contradictionExplanation(edge: Edge, from: Idea | null, to: Idea | null): string | null {
  if (edge.type !== 'contradicts' && edge.type !== 'refutes') return null;
  const left = shortText(from?.statement || from?.label || edge.from_id);
  const right = shortText(to?.statement || to?.label || edge.to_id);
  const noun = edge.type === 'refutes' ? 'refutación' : 'contradicción';
  return `La ${noun} detectada es que "${left}" entra en tensión con "${right}".`;
}

function shortText(value: string, max = 180): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trim()}...`;
}
