import { getDb } from './database';

export type CheckpointKind = 'deep_chunk' | 'reproc_theme_batch' | 'reproc_relation_batch';

/**
 * Load all saved checkpoints for a given work + content hash + kind.
 * Returns a Map of batch_index → parsed data.
 */
export function loadCheckpoints(
  nodusId: string,
  contentHash: string,
  kind: CheckpointKind
): Map<number, unknown> {
  const rows = getDb()
    .prepare(
      'SELECT batch_index, data_json FROM scan_checkpoints WHERE nodus_id = ? AND content_hash = ? AND kind = ?'
    )
    .all(nodusId, contentHash, kind) as { batch_index: number; data_json: string }[];
  const map = new Map<number, unknown>();
  for (const row of rows) {
    try {
      map.set(row.batch_index, JSON.parse(row.data_json));
    } catch {
      /* corrupt checkpoint — skip */
    }
  }
  return map;
}

/**
 * Save one checkpoint entry (upsert so re-saving the same batch is idempotent).
 */
export function saveCheckpoint(
  nodusId: string,
  contentHash: string,
  kind: CheckpointKind,
  batchIndex: number,
  data: unknown
): void {
  getDb()
    .prepare(
      `INSERT INTO scan_checkpoints (nodus_id, content_hash, kind, batch_index, data_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(nodus_id, content_hash, kind, batch_index)
       DO UPDATE SET data_json = excluded.data_json, created_at = excluded.created_at`
    )
    .run(nodusId, contentHash, kind, batchIndex, JSON.stringify(data), new Date().toISOString());
}

/**
 * Clear all checkpoints for a given work + hash + kind (or all kinds if omitted).
 */
export function clearCheckpoints(nodusId: string, contentHash?: string, kind?: CheckpointKind): void {
  const db = getDb();
  if (contentHash && kind) {
    db.prepare('DELETE FROM scan_checkpoints WHERE nodus_id = ? AND content_hash = ? AND kind = ?').run(
      nodusId,
      contentHash,
      kind
    );
  } else if (contentHash) {
    db.prepare('DELETE FROM scan_checkpoints WHERE nodus_id = ? AND content_hash = ?').run(nodusId, contentHash);
  } else {
    db.prepare('DELETE FROM scan_checkpoints WHERE nodus_id = ?').run(nodusId);
  }
}
