import { randomUUID } from 'node:crypto';
import { getDb } from './database';

export interface PassagePublication { token: string; database: string; contentHash: string }
/** Newer producers fence older ones before asynchronous work starts. The check
 * runs inside each legacy publication transaction, including Documentary Index. */
export function beginPassagePublication(nodusId: string, contentHash: string): PassagePublication {
  const db = getDb();
  const token = randomUUID();
  db.prepare(`INSERT INTO passage_publications VALUES (?,?,?,?) ON CONFLICT(nodus_id)
    DO UPDATE SET token=excluded.token,content_hash=excluded.content_hash,created_at=excluded.created_at`)
    .run(nodusId, token, contentHash, new Date().toISOString());
  return { token, database: db.name, contentHash };
}
export function assertPassagePublication(nodusId: string, publication: PassagePublication): void {
  const db = getDb();
  if (db.name !== publication.database || !db.prepare('SELECT 1 FROM passage_publications WHERE nodus_id=? AND token=? AND content_hash=?')
    .get(nodusId, publication.token, publication.contentHash)) throw new Error('documentary_publication_superseded');
}
