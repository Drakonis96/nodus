import { getDb } from './database';
import { v4 as uuid } from 'uuid';
import type {
  Idea,
  IdeaType,
  Edge,
  EdgeType,
  EdgeBasis,
  Evidence,
  EvidenceKind,
  IdeaDetail,
  EdgeDetail,
} from '@shared/types';
import { getWorksByIds } from './worksRepo';

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
}

export function createIdea(input: NewIdeaInput): Idea {
  const db = getDb();
  const global_id = nextGlobalId();
  const created_at = new Date().toISOString();
  db.prepare(
    'INSERT INTO ideas (global_id, type, label, statement, embedding, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    global_id,
    input.type,
    input.label,
    input.statement,
    input.embedding ? encodeEmbedding(input.embedding) : null,
    created_at
  );
  return { global_id, ...input, created_at };
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

/** All ideas with an embedding, for in-memory cosine candidate retrieval. */
export function ideasWithEmbeddings(): { global_id: string; type: IdeaType; label: string; statement: string; embedding: number[] }[] {
  const db = getDb();
  const rows = db.prepare('SELECT global_id, type, label, statement, embedding FROM ideas WHERE embedding IS NOT NULL').all() as {
    global_id: string;
    type: IdeaType;
    label: string;
    statement: string;
    embedding: Buffer;
  }[];
  return rows.map((r) => ({ ...r, embedding: decodeEmbedding(r.embedding) }));
}

export function allIdeaCandidates(): { global_id: string; type: IdeaType; label: string; statement: string }[] {
  return getDb().prepare('SELECT global_id, type, label, statement FROM ideas').all() as {
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
  limit: number
): { global_id: string; type: IdeaType; label: string; statement: string; similarity: number }[] {
  const buf = encodeEmbedding(queryEmbedding);
  return getDb()
    .prepare(
      `SELECT * FROM (
         SELECT global_id, type, label, statement, vec_cosine(embedding, ?) AS similarity
         FROM ideas
         WHERE embedding IS NOT NULL
       ) WHERE similarity >= ?
       ORDER BY similarity DESC
       LIMIT ?`
    )
    .all(buf, threshold, limit) as {
    global_id: string;
    type: IdeaType;
    label: string;
    statement: string;
    similarity: number;
  }[];
}

export function upsertOccurrence(
  globalId: string,
  nodusId: string,
  role: 'principal' | 'secondary',
  development: string,
  confidence: number
): void {
  getDb()
    .prepare(
      `INSERT INTO idea_occurrences (global_id, nodus_id, role, development, confidence)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(global_id, nodus_id) DO UPDATE SET role=excluded.role, development=excluded.development, confidence=excluded.confidence`
    )
    .run(globalId, nodusId, role, development, confidence);
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
  from_id: string;
  to_id: string;
  type: string;
  basis: string;
  confidence: number;
  source_work: string | null;
}

/** Insert an edge, de-duplicating on (from, to, type); keeps the higher confidence. */
export function addEdge(input: NewEdgeInput): string | null {
  const type = normalizeEdgeType(input.type);
  if (!type) return null;
  const basis = normalizeEdgeBasis(input.basis);
  const confidence = clampConfidence(input.confidence);
  const db = getDb();
  const existing = db
    .prepare('SELECT id, confidence FROM edges WHERE from_id = ? AND to_id = ? AND type = ?')
    .get(input.from_id, input.to_id, type) as { id: string; confidence: number } | undefined;
  if (existing) {
    if (confidence > existing.confidence) {
      db.prepare('UPDATE edges SET confidence = ?, basis = ? WHERE id = ?').run(
        confidence,
        basis,
        existing.id
      );
    }
    return existing.id;
  }
  const id = uuid();
  db.prepare(
    'INSERT INTO edges (id, from_id, to_id, type, basis, confidence, source_work) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, input.from_id, input.to_id, type, basis, confidence, input.source_work);
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
      UPDATE works SET
        light_status = 'none', light_at = NULL, light_hash = NULL,
        deep_status = 'none', deep_at = NULL, deep_hash = NULL,
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
    db.prepare('DELETE FROM edges WHERE source_work = ?').run(nodusId);
    db.prepare('DELETE FROM idea_theme_links WHERE nodus_id = ?').run(nodusId);
    db.prepare('DELETE FROM gaps WHERE nodus_id = ?').run(nodusId);
    db.prepare('DELETE FROM external_refs WHERE nodus_id = ?').run(nodusId);
    db.prepare('DELETE FROM work_authors WHERE nodus_id = ?').run(nodusId);
    // Drop ideas that no longer have any occurrence.
    db.prepare(
      'DELETE FROM ideas WHERE global_id NOT IN (SELECT DISTINCT global_id FROM idea_occurrences)'
    ).run();
    db.prepare(
      `DELETE FROM edges
       WHERE from_id NOT IN (SELECT global_id FROM ideas)
          OR to_id NOT IN (SELECT global_id FROM ideas)`
    ).run();
  });
  tx();
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
