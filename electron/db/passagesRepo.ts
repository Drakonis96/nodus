import type { PassageDetail, WorkPassageStatus } from '@shared/types';
import { getDb } from './database';
import { currentEmbeddingConfig, embeddingTextHash, encodeEmbedding } from './ideasRepo';

export interface PassageInsert {
  text: string;
  pageLabel: string | null;
  embedding: number[] | null;
}

export interface SimilarPassage {
  passage_id: string;
  nodus_id: string;
  text: string;
  page_label: string | null;
  similarity: number;
  title: string;
  authors_json: string;
  year: number | null;
  zotero_key: string;
}

/** Replace one work atomically so interrupted/reprocessed runs never mix chunks. */
export function replaceWorkPassages(nodusId: string, contentHash: string, rows: PassageInsert[]): void {
  const db = getDb();
  const config = currentEmbeddingConfig();
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO passages (
       passage_id, nodus_id, chunk_index, text, page_label, char_len, content_hash,
       embedding, embedding_provider, embedding_model, embedding_dim, embedding_text_hash, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  db.transaction(() => {
    db.prepare('DELETE FROM passages WHERE nodus_id = ?').run(nodusId);
    rows.forEach((row, chunkIndex) => {
      const embedding = row.embedding;
      insert.run(
        `${nodusId}#${chunkIndex}`,
        nodusId,
        chunkIndex,
        row.text,
        row.pageLabel,
        row.text.length,
        contentHash,
        embedding ? encodeEmbedding(embedding) : null,
        embedding ? config.provider : null,
        embedding ? config.model : null,
        embedding?.length ?? null,
        embedding ? embeddingTextHash(row.text) : null,
        now
      );
    });
  })();
}

export function findSimilarPassages(
  queryEmbedding: number[],
  threshold: number,
  limit: number,
  opts: { nodusIds?: string[] } = {}
): SimilarPassage[] {
  if (limit <= 0) return [];
  const config = currentEmbeddingConfig();
  const nodusIds = [...new Set(opts.nodusIds ?? [])];
  const scoped = nodusIds.length
    ? ` AND p.nodus_id IN (${nodusIds.map(() => '?').join(',')})`
    : '';
  return getDb()
    .prepare(
      `SELECT * FROM (
         SELECT p.passage_id, p.nodus_id, p.text, p.page_label,
                w.title, w.authors_json, w.year, w.zotero_key,
                vec_cosine(p.embedding, ?) AS similarity
           FROM passages p
           JOIN works w ON w.nodus_id = p.nodus_id
          WHERE p.embedding IS NOT NULL
            AND w.archived = 0
            AND (w.deep_hash IS NULL OR p.content_hash = w.deep_hash)
            AND p.embedding_provider = ?
            AND p.embedding_model = ?
            AND p.embedding_dim = ?${scoped}
       ) WHERE similarity >= ?
       ORDER BY similarity DESC
       LIMIT ?`
    )
    .all(encodeEmbedding(queryEmbedding), config.provider, config.model, queryEmbedding.length, ...nodusIds, threshold, limit) as SimilarPassage[];
}

/**
 * How many passages carry an embedding for the current provider/model (0 ⇒ the full text
 * is not indexed for semantic search, so findSimilarPassages can only return nothing).
 * Mirrors embeddedIdeaCount; both let a caller tell "no matches" apart from "no index".
 */
export function embeddedPassageCount(): number {
  const config = currentEmbeddingConfig();
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS count
         FROM passages p
         JOIN works w ON w.nodus_id = p.nodus_id
        WHERE p.embedding IS NOT NULL
          AND w.archived = 0
          AND p.embedding_provider = ?
          AND p.embedding_model = ?`
    )
    .get(config.provider, config.model) as { count: number };
  return row.count;
}

export function getPassageDetail(passageId: string): PassageDetail | null {
  const row = getDb()
    .prepare(
      `SELECT p.passage_id, p.nodus_id, p.text, p.page_label, p.chunk_index,
              w.title, w.authors_json, w.year, w.zotero_key
         FROM passages p
         JOIN works w ON w.nodus_id = p.nodus_id
        WHERE p.passage_id = ?`
    )
    .get(passageId) as
    | {
        passage_id: string;
        nodus_id: string;
        text: string;
        page_label: string | null;
        chunk_index: number;
        title: string;
        authors_json: string;
        year: number | null;
        zotero_key: string;
      }
    | undefined;
  if (!row) return null;
  let authors: string[] = [];
  try {
    authors = JSON.parse(row.authors_json || '[]');
  } catch {
    // Stored work metadata remains usable even if legacy author JSON is malformed.
  }
  return {
    passage_id: row.passage_id,
    nodus_id: row.nodus_id,
    text: row.text,
    page_label: row.page_label,
    chunk_index: row.chunk_index,
    work: { title: row.title, authors, year: row.year, zotero_key: row.zotero_key },
  };
}

/** Lightweight status based on the last deep-scan content hash and current model. */
export function workPassageStatuses(nodusIds?: string[]): WorkPassageStatus[] {
  const ids = [...new Set(nodusIds ?? [])];
  const where = ids.length ? `WHERE w.nodus_id IN (${ids.map(() => '?').join(',')})` : '';
  const config = currentEmbeddingConfig();
  const rows = getDb()
    .prepare(
      `SELECT w.nodus_id, w.deep_hash,
              COUNT(p.passage_id) AS total_passages,
              SUM(CASE WHEN (w.deep_hash IS NULL OR p.content_hash = w.deep_hash)
                         AND p.embedding IS NOT NULL
                         AND p.embedding_provider = ?
                         AND p.embedding_model = ?
                         AND p.embedding_dim > 0
                       THEN 1 ELSE 0 END) AS current_passages
         FROM works w
         LEFT JOIN passages p ON p.nodus_id = w.nodus_id
         ${where}
        GROUP BY w.nodus_id, w.deep_hash`
    )
    .all(config.provider, config.model, ...ids) as {
    nodus_id: string;
    deep_hash: string | null;
    total_passages: number;
    current_passages: number | null;
  }[];
  return rows.map((row) => {
    const totalPassages = Number(row.total_passages ?? 0);
    const current = Number(row.current_passages ?? 0);
    return {
      nodus_id: row.nodus_id,
      totalPassages,
      status: totalPassages === 0 ? 'missing' : current === totalPassages ? 'complete' : 'outdated',
    };
  });
}

export function clearAllPassages(): void {
  getDb().prepare('DELETE FROM passages').run();
}
