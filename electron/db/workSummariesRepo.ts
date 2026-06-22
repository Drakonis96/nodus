import type { ModelRef, WorkSummary } from '@shared/types';
import { getDb } from './database';
import { currentEmbeddingConfig, embeddingTextHash, encodeEmbedding } from './ideasRepo';

interface WorkSummaryRow extends WorkSummary {
  model_json: string | null;
  content_hash: string;
  embedding: Buffer | null;
  embedding_provider: string | null;
  embedding_model: string | null;
  embedding_dim: number | null;
  embedding_text_hash: string | null;
}

export interface UpsertWorkSummaryInput {
  nodusId: string;
  summary: string;
  sourceLevel: 'deep' | 'light';
  model: ModelRef | null;
  contentHash: string;
}

function toSummary(row: WorkSummaryRow): WorkSummary {
  return {
    nodus_id: row.nodus_id,
    summary: row.summary,
    source_level: row.source_level,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function upsertWorkSummary(input: UpsertWorkSummaryInput): void {
  const now = new Date().toISOString();
  const existing = getDb().prepare('SELECT created_at FROM work_summaries WHERE nodus_id = ?').get(input.nodusId) as
    | { created_at: string }
    | undefined;
  getDb()
    .prepare(
      `INSERT INTO work_summaries (
         nodus_id, summary, source_level, model_json, content_hash,
         embedding, embedding_provider, embedding_model, embedding_dim, embedding_text_hash,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?)
       ON CONFLICT(nodus_id) DO UPDATE SET
         summary = excluded.summary,
         source_level = excluded.source_level,
         model_json = excluded.model_json,
         content_hash = excluded.content_hash,
         embedding = NULL,
         embedding_provider = NULL,
         embedding_model = NULL,
         embedding_dim = NULL,
         embedding_text_hash = NULL,
         updated_at = excluded.updated_at`
    )
    .run(
      input.nodusId,
      input.summary,
      input.sourceLevel,
      input.model ? JSON.stringify(input.model) : null,
      input.contentHash,
      existing?.created_at ?? now,
      now
    );
}

export function getWorkSummary(nodusId: string): WorkSummary | null {
  const row = getDb().prepare('SELECT * FROM work_summaries WHERE nodus_id = ?').get(nodusId) as WorkSummaryRow | undefined;
  return row ? toSummary(row) : null;
}

export function updateWorkSummaryEmbedding(nodusId: string, summaryText: string, embedding: number[]): void {
  const config = currentEmbeddingConfig();
  getDb()
    .prepare(
      `UPDATE work_summaries
          SET embedding = ?,
              embedding_provider = ?,
              embedding_model = ?,
              embedding_dim = ?,
              embedding_text_hash = ?,
              updated_at = ?
        WHERE nodus_id = ?`
    )
    .run(
      encodeEmbedding(embedding),
      config.provider,
      config.model,
      embedding.length,
      embeddingTextHash(summaryText),
      new Date().toISOString(),
      nodusId
    );
}

export function summaryNeedsEmbedding(
  row: Pick<WorkSummaryRow, 'embedding' | 'embedding_provider' | 'embedding_model' | 'embedding_dim' | 'embedding_text_hash'>,
  summaryText: string
): boolean {
  if (!row.embedding) return true;
  const config = currentEmbeddingConfig();
  const dim = row.embedding.byteLength / 4;
  return (
    row.embedding_provider !== config.provider ||
    row.embedding_model !== config.model ||
    row.embedding_dim !== dim ||
    row.embedding_text_hash !== embeddingTextHash(summaryText)
  );
}

export function findSimilarWorks(
  queryEmbedding: number[],
  threshold: number,
  limit: number
): { nodus_id: string; summary: string; similarity: number }[] {
  const config = currentEmbeddingConfig();
  return getDb()
    .prepare(
      `SELECT * FROM (
         SELECT nodus_id, summary, vec_cosine(embedding, ?) AS similarity
           FROM work_summaries
          WHERE embedding IS NOT NULL
            AND embedding_provider = ?
            AND embedding_model = ?
            AND embedding_dim = ?
       ) WHERE similarity >= ?
       ORDER BY similarity DESC
       LIMIT ?`
    )
    .all(encodeEmbedding(queryEmbedding), config.provider, config.model, queryEmbedding.length, threshold, limit) as {
    nodus_id: string;
    summary: string;
    similarity: number;
  }[];
}

export function clearAllWorkSummaryEmbeddings(): void {
  getDb()
    .prepare(
      `UPDATE work_summaries
          SET embedding = NULL,
              embedding_provider = NULL,
              embedding_model = NULL,
              embedding_dim = NULL,
              embedding_text_hash = NULL
        WHERE embedding IS NOT NULL`
    )
    .run();
}

export function allWorkSummaryRows(): WorkSummaryRow[] {
  return getDb().prepare('SELECT * FROM work_summaries ORDER BY updated_at ASC').all() as WorkSummaryRow[];
}

export function pendingSummaryWorks(): { nodus_id: string; title: string }[] {
  return getDb()
    .prepare("SELECT nodus_id, title FROM works WHERE archived = 0 AND summary_status = 'pending'")
    .all() as { nodus_id: string; title: string }[];
}

export function failedSummaryWorks(): { nodus_id: string; title: string }[] {
  return getDb()
    .prepare("SELECT nodus_id, title FROM works WHERE archived = 0 AND summary_status = 'failed'")
    .all() as { nodus_id: string; title: string }[];
}
