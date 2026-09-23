import type { PassageDetail } from '@shared/types';
import type { DocumentaryIndexIdentity, ResolvedResearchScope } from '@shared/researchCorpus';
import { getDb } from '../db/database';
import { documentaryStore } from '../ai/documentaryPreparation';
import { researchCorpusInventory } from '../ai/researchCorpusInventory';
import { assertResearchDocumentPermission } from '../ai/researchCorpusScope';
import { getResearchNotebook } from '../db/researchNotebooksRepo';
import { resolveResearchNotebook } from '../ai/researchNotebookService';
import { getActiveVault } from '../vaults/vaultRegistry';

export const documentaryCitationId = (scopeId: string, passageId: string): string => `documentary:${scopeId}:${passageId}`;

/** The persisted backend scope is the authority, never an identifier from a model.
 * Immutable passage revisions survive rebuilds; permission revocations still win. */
export function getDocumentaryPassageDetail(id: string): PassageDetail | null {
  const match = /^documentary:([a-f0-9]{64}):([a-f0-9]{64}:\d+)$/.exec(id);
  if (!match) return null;
  try {
    const row = getDb().prepare('SELECT scope_json FROM research_run_scopes WHERE id=?').get(match[1]) as { scope_json: string } | undefined;
    if (!row) return null;
    const scope: ResolvedResearchScope = JSON.parse(row.scope_json);
    if (scope.vaultId !== getActiveVault().id) return null;
    const passage = documentaryStore().db.prepare(`SELECT p.*,r.identity_json FROM documentary_passages p
      JOIN documentary_revisions r ON r.index_key=p.index_key WHERE p.id=? AND r.lexical_ready=1`).get(match[2]) as {
        document_id: string; text: string; ordinal: number; locator_json: string; identity_json: string;
      } | undefined;
    if (!passage) return null;
    const inventory = researchCorpusInventory();
    const current = inventory.documents.find(item => item.id === passage.document_id);
    const document = assertResearchDocumentPermission(scope, passage.document_id, current);
    if (scope.notebookId && getResearchNotebook(scope.notebookId)
      && !resolveResearchNotebook(scope.notebookId).documents.some(item => item.id === document.id)) return null;
    const identity: DocumentaryIndexIdentity = JSON.parse(passage.identity_json);
    if (identity.revision !== document.revision || identity.attachmentId !== document.attachmentId) return null;
    const locator = JSON.parse(passage.locator_json);
    return { passage_id: id, nodus_id: document.workId ?? document.id, libraryItemId: document.libraryItemId,
      revision: identity.revision, historical: current?.revision !== identity.revision,
      provenance: (identity.coverage ?? document.coverage) === 'abstract' ? 'abstract' : 'source', text: passage.text,
      page_label: locator.pageLabel, source_ref: locator.sourceRef, page_number: locator.pageNumber,
      chunk_index: passage.ordinal, work: { title: document.title, authors: document.authors, year: document.year,
        zotero_key: document.origin.kind === 'zotero' ? document.origin.itemKey : '' } };
  } catch { return null; }
}
