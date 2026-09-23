import type { PassageDetail } from '@shared/types';
import type { ResolvedResearchScope } from '@shared/researchCorpus';
import { getDb } from '../db/database';
import { getPassageDetail } from '../db/passagesRepo';
import { getResearchNotebook, recordResearchScope } from '../db/researchNotebooksRepo';
import { researchCorpusInventory } from '../ai/researchCorpusInventory';
import { assertResearchDocument, assertResearchDocumentPermission, researchFingerprint } from '../ai/researchCorpusScope';
import { resolveResearchNotebook } from '../ai/researchNotebookService';
import { getActiveVault } from '../vaults/vaultRegistry';

type Receipt = { documentId: string; detail: PassageDetail };
type StoredScope = ResolvedResearchScope & { legacyEvidence?: Record<string, Receipt> };

/** Adapt a legacy passage only after its content hash and scoped work match.
 * The immutable receipt lives with the backend scope, never in renderer input or
 * synced chat metadata. Old raw passage URLs remain a compatibility API. */
export function recordScopedLegacyPassage(scope: ResolvedResearchScope, passageId: string): PassageDetail | null {
  const detail = getPassageDetail(passageId);
  if (!detail) return null;
  const document = scope.documents.find(item => item.workId === detail.nodus_id);
  if (!document || (document.indexedSource && document.indexedSource.revision !== document.revision)) return null;
  assertResearchDocument(scope, document.id, researchCorpusInventory().documents.find(item => item.id === document.id));
  return recordScopedSourcePassage(scope, document.id, detail);
}

/** Preserve only backend-read bytes; no index or preparation consent is implied. */
export function recordScopedSourcePassage(scope: ResolvedResearchScope, documentId: string, detail: PassageDetail): PassageDetail | null {
  const document = assertResearchDocument(scope, documentId, researchCorpusInventory().documents.find(item => item.id === documentId));
  if (detail.nodus_id !== (document.workId ?? document.id)) throw new Error('research_source_not_authorized');
  const receipt: Receipt = { documentId: document.id, detail: { ...detail, revision: document.revision } };
  const key = researchFingerprint(receipt);
  recordResearchScope(scope);
  const db = getDb();
  const saved = db.transaction(() => {
    const row = db.prepare('SELECT scope_json FROM research_run_scopes WHERE id=?').get(scope.id) as { scope_json: string };
    const stored: StoredScope = JSON.parse(row.scope_json);
    if (!stored.legacyEvidence?.[key] && Object.keys(stored.legacyEvidence ?? {}).length >= 512) return false;
    db.prepare('UPDATE research_run_scopes SET scope_json=json_set(scope_json,?,json(?)) WHERE id=?')
      .run(`$.legacyEvidence.${key}`, JSON.stringify(receipt), scope.id);
    return true;
  }).immediate();
  return saved ? { ...receipt.detail, passage_id: `scoped:${scope.id}:${key}` } : null;
}

export function getScopedLegacyPassageDetail(id: string): PassageDetail | null {
  const match = /^scoped:([a-f0-9]{64}):([a-f0-9]{64})$/.exec(id);
  if (!match) return null;
  try {
    const row = getDb().prepare('SELECT scope_json FROM research_run_scopes WHERE id=?').get(match[1]) as { scope_json: string } | undefined;
    if (!row) return null;
    const scope: StoredScope = JSON.parse(row.scope_json);
    const receipt = scope.legacyEvidence?.[match[2]];
    if (!receipt || scope.vaultId !== getActiveVault().id || researchFingerprint(receipt) !== match[2]) return null;
    const current = researchCorpusInventory().documents.find(item => item.id === receipt.documentId);
    const document = assertResearchDocumentPermission(scope, receipt.documentId, current);
    if ((document.workId ?? document.id) !== receipt.detail.nodus_id || document.revision !== receipt.detail.revision) return null;
    if (scope.notebookId && getResearchNotebook(scope.notebookId)
      && !resolveResearchNotebook(scope.notebookId).documents.some(item => item.id === document.id)) return null;
    return { ...receipt.detail, passage_id: id, historical: current?.revision !== receipt.detail.revision };
  } catch { return null; }
}
