import { getDb } from '../db/database';
import { documentProfileStatuses } from '../db/documentProfilesRepo';
import { documentIndexQueue } from '../pipeline/documentIndexQueue';
import { getActiveVault } from '../vaults/vaultRegistry';

export interface DocumentPreparationResult {
  considered: number;
  requested: number;
  prepared: number;
  unavailable: number;
  failed: number;
}

/**
 * Blocking barrier for deliberate modes. The candidates are already relevance-
 * ordered by their caller. Known abstract-only/missing sources are replaced by
 * later candidates, while newly discovered unavailable works do not abort the
 * entire report.
 */
export async function prepareRelevantDocumentProfiles(
  orderedNodusIds: string[],
  reason: 'deep-research' | 'immersion',
  limit = 32,
): Promise<DocumentPreparationResult> {
  const vault = getActiveVault();
  const unique = [...new Set(orderedNodusIds)].filter(Boolean);
  if (vault.type !== 'academic' || unique.length === 0) {
    return { considered: unique.length, requested: 0, prepared: 0, unavailable: 0, failed: 0 };
  }
  const rows = getDb().prepare(
    `SELECT w.nodus_id,w.source_type,w.deep_status,COALESCE(dps.status,'missing') profile_status
       FROM works w LEFT JOIN document_profile_state dps ON dps.nodus_id=w.nodus_id
      WHERE w.archived=0 AND w.nodus_id IN (${unique.map(() => '?').join(',')})`
  ).all(...unique) as Array<{
    nodus_id: string;
    source_type: string | null;
    deep_status: string;
    profile_status: string;
  }>;
  const byId = new Map(rows.map((row) => [row.nodus_id, row]));
  const candidates = unique.filter((id) => {
    const row = byId.get(id);
    // A terminal failure has already exhausted the queue's retries. Repeating the
    // same rejected document at the start of every research request wastes minutes
    // and provider calls; explicit "scan again" remains the recovery path.
    if (!row || row.profile_status === 'unavailable' || row.profile_status === 'failed') return false;
    if (row.source_type === 'abstract_only' || row.source_type === 'none') return false;
    return row.deep_status !== 'skipped_no_text';
  }).slice(0, limit);
  if (!candidates.length) {
    return { considered: unique.length, requested: 0, prepared: 0, unavailable: 0, failed: 0 };
  }
  await documentIndexQueue.ensureProfiles(vault.id, candidates, reason, { allowUnavailable: true, allowFailed: true });
  const statuses = documentProfileStatuses(candidates);
  return {
    considered: unique.length,
    requested: candidates.length,
    prepared: statuses.filter((item) => item.status === 'current').length,
    unavailable: statuses.filter((item) => item.status === 'unavailable').length,
    failed: statuses.filter((item) => item.status === 'failed').length,
  };
}
