import { getDb } from './database';

function savedAuthorKey(authorId: string): string {
  const row = getDb()
    .prepare("SELECT COALESCE(canonical_key, 'id:' || author_id) AS author_key FROM authors WHERE author_id = ?")
    .get(authorId) as { author_key: string } | undefined;
  if (!row) throw new Error('Autor no encontrado.');
  return row.author_key;
}

/** Persist or clear one reader-curated author bookmark in the active vault. */
export function setAuthorSaved(authorId: string, saved: boolean): void {
  const db = getDb();
  const authorKey = savedAuthorKey(authorId);
  if (saved) {
    db.prepare(
      `INSERT INTO saved_authors (author_key, saved_at)
       VALUES (?, ?)
       ON CONFLICT(author_key) DO UPDATE SET saved_at = excluded.saved_at`
    ).run(authorKey, new Date().toISOString());
  } else {
    db.prepare('DELETE FROM saved_authors WHERE author_key = ?').run(authorKey);
  }
}

/** Author ids whose stable canonical identity is saved in the active vault. */
export function savedAuthorIds(): Set<string> {
  const rows = getDb()
    .prepare(
      `SELECT a.author_id
         FROM authors a
         JOIN saved_authors s
           ON s.author_key = COALESCE(a.canonical_key, 'id:' || a.author_id)`
    )
    .all() as { author_id: string }[];
  return new Set(rows.map((row) => row.author_id));
}
