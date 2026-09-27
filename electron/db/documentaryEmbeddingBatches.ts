import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { validateEmbeddingVectors } from '../ai/strictEmbeddings';

/** Working vectors are never searched; only complete immutable publications are. */
export class DocumentaryEmbeddingBatches {
  constructor(readonly db: Database.Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS documentary_embedding_chunks (
      operation TEXT NOT NULL, ordinal INTEGER NOT NULL, text_hash TEXT NOT NULL,
      vector_json TEXT NOT NULL, dimensions INTEGER NOT NULL,
      PRIMARY KEY(operation,ordinal)
    );
    CREATE TABLE IF NOT EXISTS documentary_embedding_attempts (
      id TEXT PRIMARY KEY, operation TEXT NOT NULL, first_ordinal INTEGER NOT NULL,
      count INTEGER NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`);
  }
  hash(text: string): string { return createHash('sha256').update(text).digest('hex'); }
  /** Caller must first reclaim the persistent operation lease. The old response
   * may have been billed; recovery cannot assert provider-side idempotency. */
  recover(operation: string): void {
    this.db.prepare(`UPDATE documentary_embedding_attempts SET state='unknown',updated_at=?
      WHERE operation=? AND state='requested'`).run(Date.now(), operation);
  }
  read(operation: string, texts: string[]): Array<number[] | null> {
    const rows = this.db.prepare('SELECT ordinal,text_hash,vector_json FROM documentary_embedding_chunks WHERE operation=? ORDER BY ordinal')
      .all(operation) as Array<{ ordinal: number; text_hash: string; vector_json: string }>;
    const vectors: Array<number[] | null> = texts.map(() => null);
    for (const row of rows) {
      if (row.ordinal >= texts.length || row.text_hash !== this.hash(texts[row.ordinal])) throw new Error('documentary_embedding_checkpoint_mismatch');
      vectors[row.ordinal] = JSON.parse(row.vector_json);
    }
    const present = vectors.filter((vector): vector is number[] => vector !== null);
    if (present.length) validateEmbeddingVectors(present, present.length, operation);
    return vectors;
  }
  begin(operation: string, first: number, count: number): string {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(`INSERT INTO documentary_embedding_attempts VALUES(?,?,?,?, 'requested',?,?)`).run(id, operation, first, count, now, now);
    return id;
  }
  complete(id: string, texts: string[], vectors: number[][], assertLease: () => void): void {
    this.db.transaction(() => {
      assertLease();
      const attempt = this.db.prepare("SELECT operation,first_ordinal,count FROM documentary_embedding_attempts WHERE id=? AND state='requested'")
        .get(id) as { operation: string; first_ordinal: number; count: number } | undefined;
      if (!attempt || texts.length !== attempt.count) throw new Error('documentary_embedding_attempt_invalid');
      validateEmbeddingVectors(vectors, attempt.count, attempt.operation);
      const previous = this.db.prepare('SELECT dimensions FROM documentary_embedding_chunks WHERE operation=? LIMIT 1').get(attempt.operation) as { dimensions: number } | undefined;
      if (previous && previous.dimensions !== vectors[0].length) throw new Error('documentary_embedding_space_mismatch');
      const insert = this.db.prepare('INSERT INTO documentary_embedding_chunks VALUES(?,?,?,?,?)');
      vectors.forEach((vector, i) => insert.run(attempt.operation, attempt.first_ordinal + i, this.hash(texts[i]), JSON.stringify(vector), vector.length));
      this.db.prepare("UPDATE documentary_embedding_attempts SET state='complete',updated_at=? WHERE id=?").run(Date.now(), id);
    }).immediate();
  }
  uncertain(id: string): void {
    this.db.prepare("UPDATE documentary_embedding_attempts SET state='unknown',updated_at=? WHERE id=? AND state='requested'").run(Date.now(), id);
  }
}
