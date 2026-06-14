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
import { getWork } from './worksRepo';

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
  type: EdgeType;
  basis: EdgeBasis;
  confidence: number;
  source_work: string | null;
}

/** Insert an edge, de-duplicating on (from, to, type); keeps the higher confidence. */
export function addEdge(input: NewEdgeInput): string {
  const db = getDb();
  const existing = db
    .prepare('SELECT id, confidence FROM edges WHERE from_id = ? AND to_id = ? AND type = ?')
    .get(input.from_id, input.to_id, input.type) as { id: string; confidence: number } | undefined;
  if (existing) {
    if (input.confidence > existing.confidence) {
      db.prepare('UPDATE edges SET confidence = ?, basis = ? WHERE id = ?').run(
        input.confidence,
        input.basis,
        existing.id
      );
    }
    return existing.id;
  }
  const id = uuid();
  db.prepare(
    'INSERT INTO edges (id, from_id, to_id, type, basis, confidence, source_work) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, input.from_id, input.to_id, input.type, input.basis, input.confidence, input.source_work);
  return id;
}

/** Remove all derived deep-scan data for a work, so it can be cleanly re-scanned. */
export function purgeDeepData(nodusId: string): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM idea_occurrences WHERE nodus_id = ?').run(nodusId);
    db.prepare('DELETE FROM evidence WHERE nodus_id = ?').run(nodusId);
    db.prepare('DELETE FROM edges WHERE source_work = ?').run(nodusId);
    db.prepare('DELETE FROM gaps WHERE nodus_id = ?').run(nodusId);
    db.prepare('DELETE FROM external_refs WHERE nodus_id = ?').run(nodusId);
    db.prepare('DELETE FROM work_authors WHERE nodus_id = ?').run(nodusId);
    // Drop ideas that no longer have any occurrence.
    db.prepare(
      'DELETE FROM ideas WHERE global_id NOT IN (SELECT DISTINCT global_id FROM idea_occurrences)'
    ).run();
  });
  tx();
}

// ── Detail panels ───────────────────────────────────────────────────────────

export function getIdeaDetail(globalId: string): IdeaDetail | null {
  const db = getDb();
  const idea = getIdea(globalId);
  if (!idea) return null;
  const occRows = db.prepare('SELECT * FROM idea_occurrences WHERE global_id = ?').all(globalId) as {
    global_id: string;
    nodus_id: string;
    role: 'principal' | 'secondary';
    development: string;
    confidence: number;
  }[];
  const occurrences = occRows
    .map((o) => {
      const work = getWork(o.nodus_id);
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
  const from = getIdea(edge.from_id);
  const to = getIdea(edge.to_id);
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
    evidence,
  };
}
