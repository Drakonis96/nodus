import type { PassageDetail, WorkPassageStatus } from '@shared/types';
import { getDb } from './database';
import { currentEmbeddingConfig, embeddingTextHash, encodeEmbedding } from './ideasRepo';
import { scanSimilar } from './vectorScan';

export interface PassageInsert {
  text: string;
  pageLabel: string | null;
  sourceRef?: string | null;
  pageNumber?: number | null;
  embedding: number[] | null;
}

export interface SimilarPassage {
  passage_id: string;
  nodus_id: string;
  text: string;
  page_label: string | null;
  source_ref: string | null;
  page_number: number | null;
  similarity: number;
  title: string;
  authors_json: string;
  year: number | null;
  zotero_key: string;
}

const PASSAGE_FTS_STOPWORDS = new Set([
  'para', 'como', 'desde', 'hasta', 'entre', 'sobre', 'este', 'esta', 'estos', 'estas',
  'cuál', 'cual', 'cómo', 'como', 'qué', 'que', 'quién', 'quien', 'donde', 'cuando',
  'with', 'from', 'into', 'this', 'that', 'what', 'which', 'where', 'when', 'during',
]);

const PASSAGE_MATCHES_RESOLVED_TEXT = `(
  (w.resolved_text_hash IS NOT NULL AND p.content_hash = w.resolved_text_hash)
  OR (w.resolved_text_hash IS NULL AND (w.deep_hash IS NULL OR p.content_hash = w.deep_hash))
)`;

/** Literal passage lane for names, procedures and phrases that dense retrieval can
 * blur. The query is constructed from quoted prefix tokens, never raw FTS syntax. */
export function lexicalPassageSearch(
  query: string,
  limit: number,
  opts: { nodusIds?: string[] } = {},
): SimilarPassage[] {
  if (limit <= 0) return [];
  const fold = (value: string) => value.normalize('NFKD').replace(/\p{M}+/gu, '').toLocaleLowerCase();
  const tokens = fold(query).match(/[\p{L}\p{N}]+/gu) ?? [];
  // FTS5 has no language stemmer in this index. Prefix roots recover predictable
  // inflection/OCR variants such as distribuyó/distribución and
  // gratuitamente/gratuita without ever accepting raw FTS syntax from the user.
  const rootFor = (token: string) => /^\d+$/u.test(token)
    ? token
    : token.length >= 8 ? token.slice(0, 7) : token;
  const unique = [...new Set(tokens
    .filter((token) => (token.length >= 4 || /^\d+$/u.test(token)) && !PASSAGE_FTS_STOPWORDS.has(token))
    .map(rootFor))]
    .slice(0, 32);
  const ftsQuery = unique.map((token) => `"${token.replaceAll('"', '""')}"*`).join(' OR ');
  if (!ftsQuery) return [];
  const nodusIds = [...new Set(opts.nodusIds ?? [])];
  const scoped = nodusIds.length ? ` AND p.nodus_id IN (${nodusIds.map(() => '?').join(',')})` : '';
  const rows = getDb().prepare(
    `SELECT p.passage_id,p.nodus_id,p.text,p.page_label,p.source_ref,p.page_number,
            w.title,w.authors_json,w.year,w.zotero_key,bm25(passages_fts) AS rank
       FROM passages_fts f
       JOIN passages p ON p.passage_id=f.passage_id
       JOIN works w ON w.nodus_id=p.nodus_id
      WHERE passages_fts MATCH ? AND w.archived=0
        AND ${PASSAGE_MATCHES_RESOLVED_TEXT}${scoped}
      ORDER BY rank
      LIMIT ?`
  ).all(ftsQuery, ...nodusIds, Math.max(limit, limit * 4)) as Array<Omit<SimilarPassage, 'similarity'> & { rank: number }>;
  // BM25 alone rewards a very frequent generic term. Re-rank its bounded candidate
  // pool by how many distinct roots from this one atomic question the passage
  // actually covers, with a small proximity and original-rank tie-breaker.
  return rows.map(({ rank: _rank, ...row }, index) => {
    const passageTokens = fold(row.text).match(/[\p{L}\p{N}]+/gu) ?? [];
    const positions = unique.map((root) => passageTokens
      .map((token, at) => token.startsWith(root) ? at : -1)
      .filter((at) => at >= 0));
    const covered = positions.filter((items) => items.length > 0).length;
    let closePairs = 0;
    for (let left = 0; left < positions.length - 1; left += 1) {
      if (!positions[left].length || !positions[left + 1].length) continue;
      if (positions[left].some((a) => positions[left + 1].some((b) => Math.abs(a - b) <= 12))) closePairs += 1;
    }
    const coverage = covered / Math.max(1, unique.length);
    const proximity = closePairs / Math.max(1, unique.length - 1);
    const originalRank = 1 / (index + 1);
    return { row, score: coverage * 0.72 + proximity * 0.18 + originalRank * 0.10 };
  }).sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ row, score }) => ({ ...row, similarity: Math.min(1, score) }));
}

/** Replace one work atomically so interrupted/reprocessed runs never mix chunks. */
export function replaceWorkPassages(nodusId: string, contentHash: string, rows: PassageInsert[]): void {
  const db = getDb();
  const config = currentEmbeddingConfig();
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO passages (
       passage_id, nodus_id, chunk_index, text, page_label, source_ref, page_number, char_len, content_hash,
       embedding, embedding_provider, embedding_model, embedding_dim, embedding_text_hash, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        row.sourceRef ?? null,
        row.pageNumber ?? null,
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
         SELECT p.passage_id, p.nodus_id, p.text, p.page_label, p.source_ref, p.page_number,
                w.title, w.authors_json, w.year, w.zotero_key,
                vec_cosine(p.embedding, ?) AS similarity
           FROM passages p
           JOIN works w ON w.nodus_id = p.nodus_id
          WHERE p.embedding IS NOT NULL
            AND w.archived = 0
            AND ${PASSAGE_MATCHES_RESOLVED_TEXT}
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
 * The same search as `findSimilarPassages`, paged so it does not hold the main
 * process for the whole scan (see ./vectorScan.ts). Used by the long generations —
 * Deep Research runs one of these per probe and per section, and the passage index
 * is the largest table of all.
 *
 * Ranking reads ids only; the text and its work are fetched for the winners alone,
 * instead of dragging every passage in the corpus through SQLite's sorter.
 */
export async function findSimilarPassagesPaged(
  queryEmbedding: number[],
  threshold: number,
  limit: number,
  opts: { nodusIds?: string[] } = {}
): Promise<SimilarPassage[]> {
  const config = currentEmbeddingConfig();
  const nodusIds = [...new Set(opts.nodusIds ?? [])];
  const scoped = nodusIds.length ? ` AND p.nodus_id IN (${nodusIds.map(() => '?').join(',')})` : '';
  const ranked = await scanSimilar<{ passage_id: string; content_hash: string; rid: number; similarity: number }>({
    table: 'passages',
    sql: `SELECT p.passage_id, p.content_hash, p.rowid AS rid, vec_scan(p.embedding) AS similarity
            FROM passages p
            JOIN works w ON w.nodus_id = p.nodus_id
           WHERE p.rowid > ? AND p.rowid <= ?
             AND p.embedding IS NOT NULL
             AND w.archived = 0
             AND ${PASSAGE_MATCHES_RESOLVED_TEXT}
             AND p.embedding_provider = ?
             AND p.embedding_model = ?
             AND p.embedding_dim = ?${scoped}`,
    params: [config.provider, config.model, queryEmbedding.length, ...nodusIds],
    query: queryEmbedding,
    threshold,
    limit,
  });
  if (ranked.length === 0) return [];

  const byId = new Map(ranked.map((row) => [row.passage_id, {
    similarity: row.similarity,
    contentHash: row.content_hash,
  }]));
  const rows = getDb()
    .prepare(
      `SELECT p.passage_id, p.nodus_id, p.text, p.page_label, p.source_ref, p.page_number, p.content_hash,
              w.title, w.authors_json, w.year, w.zotero_key
         FROM passages p
         JOIN works w ON w.nodus_id = p.nodus_id
        WHERE p.passage_id IN (${ranked.map(() => '?').join(',')})
          AND w.archived = 0
          AND ${PASSAGE_MATCHES_RESOLVED_TEXT}`
    )
    .all(...ranked.map((row) => row.passage_id)) as Array<Omit<SimilarPassage, 'similarity'> & { content_hash: string }>;
  // Back into the ranked order the scan produced; the IN clause has none of its own.
  return rows
    .filter((row) => byId.get(row.passage_id)?.contentHash === row.content_hash)
    .map(({ content_hash: _contentHash, ...row }) => ({
      ...row,
      similarity: byId.get(row.passage_id)?.similarity ?? 0,
    }))
    .sort((a, b) => b.similarity - a.similarity);
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
          AND ${PASSAGE_MATCHES_RESOLVED_TEXT}
          AND p.embedding_provider = ?
          AND p.embedding_model = ?`
    )
    .get(config.provider, config.model) as { count: number };
  return row.count;
}

export function getPassageDetail(passageId: string): PassageDetail | null {
  const row = getDb()
    .prepare(
      `SELECT p.passage_id, p.nodus_id, p.text, p.page_label, p.source_ref, p.page_number, p.chunk_index,
              w.title, w.authors_json, w.year, w.zotero_key
         FROM passages p
         JOIN works w ON w.nodus_id = p.nodus_id
        WHERE p.passage_id = ?
          AND ${PASSAGE_MATCHES_RESOLVED_TEXT}`
    )
    .get(passageId) as
    | {
        passage_id: string;
        nodus_id: string;
        text: string;
        page_label: string | null;
        source_ref: string | null;
        page_number: number | null;
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
    source_ref: row.source_ref,
    page_number: row.page_number,
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
      `SELECT w.nodus_id, w.deep_hash, w.resolved_text_hash,
              COUNT(p.passage_id) AS total_passages,
              SUM(CASE WHEN ${PASSAGE_MATCHES_RESOLVED_TEXT}
                         AND p.embedding IS NOT NULL
                         AND p.embedding_provider = ?
                         AND p.embedding_model = ?
                         AND p.embedding_dim > 0
                       THEN 1 ELSE 0 END) AS current_passages
         FROM works w
         LEFT JOIN passages p ON p.nodus_id = w.nodus_id
         ${where}
        GROUP BY w.nodus_id, w.deep_hash, w.resolved_text_hash`
    )
    .all(config.provider, config.model, ...ids) as {
    nodus_id: string;
    deep_hash: string | null;
    resolved_text_hash: string | null;
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
