import { randomUUID } from 'node:crypto';
import type { ResearchPreparationAction, ResearchPreparationCampaign, ResearchPreparationPolicy, ResearchPreparationPreview, ResearchPreparationProgress } from '@shared/researchCorpus';
import { DocumentaryCampaigns } from '../db/documentaryCampaigns';
import { getActiveVault, getVault } from '../vaults/vaultRegistry';
import { getSettings } from '../db/settingsRepo';
import { effectiveEmbeddingConfig, type EmbeddingExecutionConfig } from './aiClient';
import { documentaryStore, drainDocumentaryRequests, getResearchPreparationInventory, interruptUnusedDocumentaryRequest } from './documentaryPreparation';
import { researchCorpusInventory } from './researchCorpusInventory';
import { notifyDocumentaryPreparation } from './documentaryPreparationEvents';

interface PreviewRecord {
  preview: ResearchPreparationPreview;
  configuration: { embedding: EmbeddingExecutionConfig | null; processingVersion: string };
}
function campaigns() { return new DocumentaryCampaigns(documentaryStore().db); }
function academicVault() {
  const vault = getActiveVault();
  if (vault.type !== 'academic') throw new Error('research_academic_vault_required');
  return vault;
}
export function getResearchPreparationPolicy(): ResearchPreparationPolicy {
  const { known: _known, authorized: _authorized, ...policy } = campaigns().policy(academicVault().id);
  return policy;
}
export function setResearchPreparationPolicy(input: { welcomeVersion?: number; decision?: ResearchPreparationPolicy['decision']; futureAdditions?: boolean }): ResearchPreparationPolicy {
  if (!input || typeof input !== 'object' || (input.welcomeVersion !== undefined && (!Number.isSafeInteger(input.welcomeVersion) || input.welcomeVersion < 0 || input.welcomeVersion > 1))
    || (input.decision !== undefined && !['accepted', 'declined', 'pending'].includes(input.decision))
    || (input.futureAdditions !== undefined && typeof input.futureAdditions !== 'boolean')) throw new Error('Invalid preparation policy');
  const repo = campaigns(), vault = academicVault(), policy = repo.policy(vault.id);
  if (input.futureAdditions === true && !policy.futureAdditions) {
    policy.known = researchCorpusInventory().documents.filter(document => document.workId && !document.noteId && !document.conversationAttachment).map(document => document.id);
  }
  repo.savePolicy({ ...policy, welcomeVersion: input.welcomeVersion ?? policy.welcomeVersion,
    decision: input.decision ?? policy.decision, futureAdditions: input.futureAdditions ?? policy.futureAdditions });
  notifyDocumentaryPreparation();
  return getResearchPreparationPolicy();
}
export function previewResearchPreparation(input: { scope: 'vault' | 'selection'; documentIds?: string[] }): ResearchPreparationPreview {
  if (!input || !['vault', 'selection'].includes(input.scope)
    || (input.scope === 'selection' && (!Array.isArray(input.documentIds) || input.documentIds.length > 50000 || input.documentIds.some(id => typeof id !== 'string' || id.length > 1000)))) throw new Error('Invalid preparation selection');
  const vault = academicVault(), repo = campaigns();
  const eligible = getResearchPreparationInventory().documents.filter(document => document.workId && !document.noteId && !document.conversationAttachment);
  const wanted = new Set(input.documentIds ?? []);
  const documents = input.scope === 'vault' ? eligible : eligible.filter(document => wanted.has(document.id));
  if (input.scope === 'selection' && documents.length !== wanted.size) throw new Error('research_source_not_authorized');
  let config: EmbeddingExecutionConfig | null = null;
  try { config = effectiveEmbeddingConfig(); } catch { /* Text-only remains available. */ }
  const local = config && ['ollama', 'lmstudio', 'nodus'].includes(config.provider);
  const available = !!config && (!!local || !!getSettings().providerKeys[config.provider]);
  const preview: ResearchPreparationPreview = { id: randomUUID(), vaultId: vault.id, createdAt: Date.now(), documents,
    embedding: config ? { provider: config.provider, model: config.modelId, external: !local } : null,
    embeddingAvailable: available, block: available ? null : 'no_model' };
  const payload: PreviewRecord = { preview, configuration: { embedding: config, processingVersion: 'nodus-documentary/1' } };
  repo.db.prepare('INSERT INTO documentary_preparation_previews VALUES(?,?,?,?)').run(preview.id, vault.id, JSON.stringify(payload), preview.createdAt);
  // Unconfirmed previews carry no authority and can be reconstructed safely.
  repo.db.prepare('DELETE FROM documentary_preparation_previews WHERE created_at<?').run(Date.now() - 7 * 86400000);
  return preview;
}
export async function startResearchPreparationCampaign(input: { previewId: string; mode: 'embeddings' | 'text'; documentIds?: string[] }): Promise<string> {
  if (!input || typeof input.previewId !== 'string' || !['embeddings', 'text'].includes(input.mode)
    || (input.documentIds !== undefined && (!Array.isArray(input.documentIds) || input.documentIds.some(id => typeof id !== 'string')))) throw new Error('Invalid preparation campaign');
  const vault = academicVault(), repo = campaigns();
  const row = repo.db.prepare('SELECT payload_json FROM documentary_preparation_previews WHERE id=? AND vault_id=?').get(input.previewId, vault.id) as { payload_json: string } | undefined;
  if (!row) throw new Error('research_preparation_preview_expired');
  const record: PreviewRecord = JSON.parse(row.payload_json);
  if (input.mode === 'embeddings' && !record.preview.embeddingAvailable) throw new Error('documentary_embeddings_unavailable');
  const selected = input.documentIds ? new Set(input.documentIds) : null;
  const documents = selected ? record.preview.documents.filter(document => selected.has(document.id)) : record.preview.documents;
  if (selected && documents.length !== selected.size) throw new Error('research_source_not_authorized');
  const current = new Map(researchCorpusInventory().documents.map(document => [document.id, document]));
  for (const document of documents) {
    const now = current.get(document.id);
    if (!now || now.revision !== document.revision || now.permissionRevision !== document.permissionRevision || !now.workId) throw new Error('research_preparation_inventory_changed');
  }
  const id = repo.create(vault.id, vault.name, documents, { ...record.configuration, embedding: input.mode === 'text' ? null : record.configuration.embedding });
  repo.db.prepare('DELETE FROM documentary_preparation_previews WHERE id=?').run(input.previewId);
  notifyDocumentaryPreparation();
  void drainDocumentaryRequests();
  return id;
}
export function getResearchPreparationProgress(): ResearchPreparationProgress {
  const repo = campaigns();
  const results = repo.list().map(campaign => {
    const configuration = JSON.parse(campaign.configuration_json) as PreviewRecord['configuration'];
    const rows = repo.db.prepare(`SELECT m.*,r.state request_state,r.stage,r.completed_passages,r.total_passages,r.unknown_requests,r.error
      FROM documentary_campaign_members m JOIN documentary_requests r ON r.document_id=m.job_id WHERE m.campaign_id=? ORDER BY m.title,m.document_id`).all(campaign.id) as Array<{
        job_id: string; document_id: string; title: string; state: string; request_state: ResearchPreparationCampaign['jobs'][number]['state'];
        stage: ResearchPreparationCampaign['jobs'][number]['stage']; completed_passages: number; total_passages: number | null; unknown_requests: number; error: string | null;
      }>;
    return { id: campaign.id, vaultId: campaign.vault_id, vaultName: getVault(campaign.vault_id)?.name ?? campaign.vault_name,
      createdAt: campaign.created_at, updatedAt: campaign.updated_at, state: campaign.state,
      embedding: configuration.embedding ? { provider: configuration.embedding.provider, model: configuration.embedding.modelId, external: !['ollama', 'lmstudio', 'nodus'].includes(configuration.embedding.provider) } : null,
      jobs: rows.map(row => ({ id: row.job_id, documentId: row.document_id, title: row.title,
        state: row.state !== 'active' ? row.state as ResearchPreparationCampaign['jobs'][number]['state'] : campaign.state !== 'active' ? campaign.state : row.request_state,
        stage: row.stage, completedPassages: row.completed_passages, totalPassages: row.total_passages, unknownRequests: row.unknown_requests, error: row.error })) };
  });
  return { paused: documentaryStore().preference('paused'), campaigns: results };
}
export async function controlResearchPreparationCampaign(input: { campaignId: string; action: ResearchPreparationAction; documentId?: string }): Promise<void> {
  if (!input || typeof input.campaignId !== 'string' || !['pause', 'resume', 'cancel', 'retry'].includes(input.action)
    || (input.documentId !== undefined && typeof input.documentId !== 'string')) throw new Error('Invalid preparation action');
  const repo = campaigns();
  repo.control(input.campaignId, input.action, input.documentId);
  interruptUnusedDocumentaryRequest();
  notifyDocumentaryPreparation();
  void drainDocumentaryRequests();
}
