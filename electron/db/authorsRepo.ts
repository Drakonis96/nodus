import { getDb } from './database';
import { v4 as uuid } from 'uuid';

export function getOrCreateAuthor(name: string, affiliation: string | null): string {
  const db = getDb();
  const norm = name.trim();
  const existing = db.prepare('SELECT author_id FROM authors WHERE name = ?').get(norm) as
    | { author_id: string }
    | undefined;
  if (existing) {
    if (affiliation) {
      db.prepare('UPDATE authors SET affiliation = COALESCE(?, affiliation) WHERE author_id = ?').run(
        affiliation,
        existing.author_id
      );
    }
    return existing.author_id;
  }
  const author_id = uuid();
  db.prepare('INSERT INTO authors (author_id, name, affiliation) VALUES (?, ?, ?)').run(author_id, norm, affiliation);
  return author_id;
}

export function linkWorkAuthor(nodusId: string, authorId: string): void {
  getDb().prepare('INSERT OR IGNORE INTO work_authors (nodus_id, author_id) VALUES (?, ?)').run(nodusId, authorId);
}

/**
 * Recompute the DERIVED author-relations layer from the idea graph.
 * Two authors are related when works they (co-)authored are connected by
 * contradicts/extends/supports/refutes edges. Never inferred by the model.
 */
export function recomputeAuthorRelations(): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM author_relations').run();

    const edges = db
      .prepare("SELECT from_id, to_id, type, confidence FROM edges WHERE type IN ('contradicts','extends','supports','refutes')")
      .all() as { from_id: string; to_id: string; type: string; confidence: number }[];

    const weights = new Map<string, { from: string; to: string; type: string; weight: number }>();

    for (const e of edges) {
      const fromAuthors = authorsForIdea(e.from_id);
      const toAuthors = authorsForIdea(e.to_id);
      for (const fa of fromAuthors) {
        for (const ta of toAuthors) {
          if (fa === ta) continue;
          const key = `${fa}::${ta}::${e.type}`;
          const cur = weights.get(key) ?? { from: fa, to: ta, type: e.type, weight: 0 };
          cur.weight += e.confidence;
          weights.set(key, cur);
        }
      }
    }

    const ins = db.prepare(
      'INSERT OR REPLACE INTO author_relations (from_author, to_author, type, weight) VALUES (?, ?, ?, ?)'
    );
    for (const w of weights.values()) ins.run(w.from, w.to, w.type, w.weight);
  });
  tx();
}

function authorsForIdea(globalId: string): string[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT DISTINCT wa.author_id
       FROM idea_occurrences io
       JOIN work_authors wa ON wa.nodus_id = io.nodus_id
       WHERE io.global_id = ?`
    )
    .all(globalId) as { author_id: string }[];
  return rows.map((r) => r.author_id);
}
