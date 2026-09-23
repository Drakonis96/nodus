import { researchActivityEnabled, startResearchActivity } from './researchActivity';
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { backgroundProcess } from '../workers/backgroundProcess';
import { createHash } from 'node:crypto';
import { RETRIEVAL_CHUNKER_VERSION } from '@shared/retrievalChunks';
import { unpreparedResearchAttachmentIds } from '@shared/researchCorpus';
import type { DocumentaryIndexIdentity, ResearchCorpusDocument, ResearchDocumentRead, ResearchEvidence, ResearchPreparationInventory, ResolvedResearchScope, RetrievalSettings } from '@shared/researchCorpus';
import { DocumentaryRequests } from '../db/documentaryRequests';
import { DocumentaryCampaigns } from '../db/documentaryCampaigns';
import { DocumentaryStore, type DocumentaryChunk } from '../db/documentaryStore';
import { documentaryChunks } from './documentaryChunking';
import { researchCorpusInventory } from './researchCorpusInventory';
import { assertResearchDocumentPermission, researchFingerprint } from './researchCorpusScope';
import { getLibraryReaderRawContent } from '../libraryReader/libraryReaderStore';
import { getGlobalLibraryItem } from '../library/libraryService';
import { currentEmbeddingConfig } from '../db/ideasRepo';
import { embedMany, effectiveEmbeddingConfig, type EmbeddingExecutionConfig } from './aiClient';
import { DocumentaryEmbeddingBatches } from '../db/documentaryEmbeddingBatches';
import { getWork } from '../db/worksRepo';
import { readResearchAttachmentSource } from './researchAttachmentSources';
import { getNote } from '../db/notesRepo';
import { getSettings } from '../db/settingsRepo';
import { getItem, LOCAL_USER_ID } from '../zotero/zoteroClient';
import { documentarySourceText, readDocumentarySourceMap, extractTraditionalResearchWork, extractGlobalResearchAttachments, type DocumentarySourcePart } from './documentaryExtraction';
import { onGlobalLibraryChanged } from '../library/libraryRuntime';
import { getActiveVault, getVault, listVaults, withOwningVault, withoutOwningVault } from '../vaults/vaultRegistry';
import { withVaultDatabase, withoutDatabaseContext } from '../db/database';
import { notifyDocumentaryPreparation } from './documentaryPreparationEvents';
import { onResearchCorpusChanged } from './researchCorpusEvents';

let shared: DocumentaryStore | null = null;
let stopping = false;
export function documentaryStore(): DocumentaryStore {
  if (!shared) {
    const directory = path.join(app.getPath('userData'), 'documentary');
    fs.mkdirSync(directory, { recursive: true });
    shared = new DocumentaryStore(path.join(directory, 'store.sqlite'));
    new DocumentaryCampaigns(shared.db);
  }
  return shared;
}
export function closeDocumentaryPreparation(): void {
  stopping = true;
  activePreparation?.abort();
  if (retryTimer) clearTimeout(retryTimer);
  if (autoTimer) clearTimeout(autoTimer);
  unsubscribe?.(); unsubscribe = null;
  if (!draining) { shared?.close(); shared = null; }
}

/** Shared text writer used once extraction has supplied a real source revision. */
export async function prepareDocumentaryText(document: ResearchCorpusDocument, text: string, sourceMap: Record<string, string> = {}, signal?: AbortSignal, processingVersion = 'nodus-documentary/2'): Promise<{ indexKey: string; chunks: DocumentaryChunk[] }> {
  const store = documentaryStore();
  const identity: DocumentaryIndexIdentity = { documentId: document.id, attachmentId: document.attachmentId, revision: document.revision,
    attachmentRevision: document.attachments?.find(attachment => attachment.id === document.attachmentId)?.revision,
    coverage: document.coverage, textFingerprint: createHash('sha256').update(text).digest('hex'), chunkerVersion: RETRIEVAL_CHUNKER_VERSION, processingVersion, embedding: null };
  const indexKey = store.enqueue(identity, { text, sourceMap });
  const existing = store.revision(indexKey);
  if (existing?.lexical_ready) return { indexKey, chunks: JSON.parse(existing.chunks_json!) };
  const job = store.claim(Date.now(), 60000, indexKey);
  if (!job) throw new Error(store.preference('paused') ? 'documentary_paused' : 'documentary_job_already_claimed');
  const heartbeat = setInterval(() => store.renew(job), 15000);
  try {
    signal?.throwIfAborted();
    if (job.stage === 'extract') store.saveExtraction(job, text);
    const chunks = existing?.chunks_json ? JSON.parse(existing.chunks_json) as DocumentaryChunk[] : await documentaryChunks(text, sourceMap, signal);
    signal?.throwIfAborted();
    if (job.stage === 'chunk') store.saveChunks(job, chunks);
    if (job.stage === 'lexical') store.publishLexical(job);
    store.complete(job);
    return { indexKey, chunks };
  } catch (error) {
    if (store.getJob(indexKey)?.lease_token === job.lease_token) {
      if (signal?.aborted || stopping || store.preference('paused')) store.interrupt(job);
      else store.fail(job, 'documentary_preparation_failed');
    }
    throw error;
  } finally { clearInterval(heartbeat); }
}

function embeddingIdentityParameters(config: EmbeddingExecutionConfig) {
  return { endpoint: createHash('sha256').update(config.endpoint).digest('hex'), inputPolicy: 'utf8-4096/2' };
}

export async function prepareDocumentaryEmbeddings(indexKey: string, chunks: DocumentaryChunk[], signal?: AbortSignal, execution = effectiveEmbeddingConfig(), assertAuthorized: () => void = () => {}, progress: (completed: number, unknown: number) => void = () => {}): Promise<{ indexKey: string; vectors: number[][]; provider: string; model: string }> {
  const store = documentaryStore();
  assertAuthorized();
  const base = JSON.parse(store.getJob(indexKey)!.identity_json) as DocumentaryIndexIdentity;
  const config = { provider: execution.provider, model: execution.modelId };
  const parameters = embeddingIdentityParameters(execution);
  const cached = store.db.prepare(`SELECT index_key FROM documentary_revisions WHERE document_id=? AND embedding_ready=1
    AND json_extract(identity_json,'$.textFingerprint')=? AND json_extract(identity_json,'$.revision')=?
    AND json_extract(identity_json,'$.chunkerVersion')=? AND json_extract(identity_json,'$.embedding.provider')=?
    AND json_extract(identity_json,'$.embedding.model')=? AND json_extract(identity_json,'$.processingVersion')=?
    AND json_extract(identity_json,'$.attachmentId') IS ?
    AND json_extract(identity_json,'$.embedding.parameters')=?`).get(base.documentId, base.textFingerprint, base.revision, base.chunkerVersion, config.provider, config.model, base.processingVersion, base.attachmentId, JSON.stringify(parameters)) as { index_key: string } | undefined;
  if (cached) {
    const rows = store.db.prepare('SELECT vector_json FROM documentary_passages WHERE index_key=? ORDER BY ordinal').all(cached.index_key) as { vector_json: string }[];
    progress(rows.length, 0);
    return { indexKey: cached.index_key, vectors: rows.map(row => JSON.parse(row.vector_json)), ...config };
  }
  if (store.preference('paused')) throw new Error('documentary_paused');
  // Dimensions are measured from the response, so lease a persistent operation
  // identity before calling the provider, then publish under the complete space.
  const operation = `embedding:${base.documentId}:${researchFingerprint([indexKey, config, parameters])}`;
  const requests = new DocumentaryRequests(store.db);
  store.db.transaction(() => {
    if (!store.db.prepare('SELECT 1 FROM documentary_requests WHERE document_id=?').get(operation)) requests.enqueue(operation, base.revision, operation);
  }).immediate();
  const lease = requests.claim(operation, Date.now(), 60000, true);
  if (!lease) throw new Error('documentary_embedding_job_unavailable');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const heartbeat = setInterval(() => { try { requests.renew(lease); } catch { controller.abort(); } }, 15000);
  let job: ReturnType<DocumentaryStore['claim']> = null;
  try {
    signal?.throwIfAborted();
    const checkpoints = new DocumentaryEmbeddingBatches(store.db);
    checkpoints.recover(operation);
    const texts = chunks.map(chunk => chunk.text);
    const vectors = checkpoints.read(operation, texts);
    const updateProgress = () => progress(vectors.filter(Boolean).length, (store.db.prepare("SELECT COUNT(*) n FROM documentary_embedding_attempts WHERE operation=? AND state='unknown'").get(operation) as { n: number }).n);
    updateProgress();
    // Sequential bounded batches checkpoint before the next paid request. The
    // persistent operation lease fences concurrent writers and late responses.
    for (let start = 0; start < texts.length;) {
      if (vectors[start]) { start++; continue; }
      let end = start + 1;
      while (end < texts.length && end - start < 32 && !vectors[end]) end++;
      controller.signal.throwIfAborted();
      requests.renew(lease);
      const batch = texts.slice(start, end);
      const attempt = checkpoints.begin(operation, start, batch.length);
      try {
        const received = await embedMany(batch, controller.signal, { config: execution, jobId: operation });
        controller.signal.throwIfAborted();
        if (received.some(vector => !vector?.length)) throw new Error('documentary_embeddings_unavailable');
        checkpoints.complete(attempt, batch, received as number[][], () => { requests.renew(lease); assertAuthorized(); });
        vectors.splice(start, batch.length, ...received);
        updateProgress();
      } catch (error) { checkpoints.uncertain(attempt); updateProgress(); throw error; }
      start = end;
    }
    signal?.throwIfAborted();
    requests.renew(lease);
    if (store.preference('paused')) throw new Error('documentary_paused');
    if (vectors.some(vector => !vector?.length) || !vectors.length) throw new Error('documentary_embeddings_unavailable');
    assertAuthorized();
    const identity: DocumentaryIndexIdentity = { ...base, embedding: { ...config, dimensions: vectors[0]!.length, metric: 'cosine', parameters } };
    const id = store.enqueue(identity, {});
    job = store.claim(Date.now(), 60000, id);
    if (!job) throw new Error('documentary_embedding_publication_unavailable');
    store.saveChunks(job, chunks);
    store.publishLexical(job);
    store.publishEmbeddings(job, vectors as number[][]);
    requests.finish(lease, null);
    return { indexKey: id, vectors: vectors as number[][], ...config };
  } catch (error) {
    if (job && store.getJob(job.id)?.state === 'running') store.fail(job, 'documentary_embedding_publication_failed');
    try { requests.finish(lease, 'documentary_embedding_failed', store.preference('paused') || stopping || !!signal?.aborted); } catch { /* Lease was fenced. */ }
    throw error;
  } finally { clearInterval(heartbeat); signal?.removeEventListener('abort', abort); }
}

function revisionsFor(document: ResearchCorpusDocument): Array<{ index_key: string; identity_json: string; embedding_ready: number; lexical_ready: number; chunks_json: string }> {
  return documentaryStore().db.prepare(`SELECT * FROM documentary_revisions WHERE document_id=? AND json_extract(identity_json,'$.revision')=? ORDER BY embedding_ready DESC,created_at DESC`)
    .all(document.id, document.indexedSource?.revision ?? document.revision) as ReturnType<typeof revisionsFor>;
}
function attachmentRevisions(document: ResearchCorpusDocument): Array<ReturnType<typeof revisionsFor>> {
  const groups = new Map<string | null, ReturnType<typeof revisionsFor>>();
  const attachments = document.indexedSource ? document.indexedSource.attachments : document.attachments;
  const published = document.indexedSource?.indexKeys.flatMap(key => {
    const job = documentaryStore().getJob(key);
    return job ? [JSON.parse(job.identity_json) as DocumentaryIndexIdentity] : [];
  });
  for (const row of revisionsFor(document)) {
    const identity: DocumentaryIndexIdentity = JSON.parse(row.identity_json);
    if (published && !published.some(base => base.attachmentId === identity.attachmentId && base.textFingerprint === identity.textFingerprint
      && base.chunkerVersion === identity.chunkerVersion && base.processingVersion === identity.processingVersion)) continue;
    if (attachments?.length && identity.attachmentId !== null
        && !attachments.some(attachment => attachment.id === identity.attachmentId
          && (!identity.attachmentRevision || attachment.revision === identity.attachmentRevision))) continue;
    const group = groups.get(identity.attachmentId) ?? [];
    group.push(row); groups.set(identity.attachmentId, group);
  }
  // A merged legacy derivative cannot accompany independently indexed files.
  if (groups.size > 1) groups.delete(null);
  return [...groups.values()];
}
export function pinPublishedResearchDocument(document: ResearchCorpusDocument): ResearchCorpusDocument {
  const store = documentaryStore();
  const published = store.publishedDocument(document);
  if (published) return published;
  // No partially built first revision may leak before the all-attachment switch.
  const preparing = store.db.prepare('SELECT 1 FROM documentary_requests WHERE document_id=? OR source_id=?').get(document.id, document.id);
  return preparing ? { ...document, indexedSource: { revision: document.revision, attachmentId: document.attachmentId, attachments: document.attachments, indexKeys: [] } } : document;
}

export function getResearchPreparationInventory(): ResearchPreparationInventory {
  const store = documentaryStore();
  let selectedEmbedding: EmbeddingExecutionConfig | null = null;
  try { selectedEmbedding = effectiveEmbeddingConfig(); } catch { /* Text readiness does not depend on model configuration. */ }
  const embeddingSpaces = new Map<string, NonNullable<ResearchPreparationInventory['embeddingSpaces']>[number]>();
  for (const row of store.db.prepare('SELECT identity_json FROM documentary_revisions WHERE embedding_ready=1').all() as { identity_json: string }[]) {
    const embedding = (JSON.parse(row.identity_json) as DocumentaryIndexIdentity).embedding;
    if (embedding) {
      const id = researchFingerprint(embedding);
      embeddingSpaces.set(id, { id, provider: embedding.provider, model: embedding.model, dimensions: embedding.dimensions, metric: embedding.metric });
    }
  }
  return { enabled: new DocumentaryCampaigns(store.db).policy(getActiveVault().id).futureAdditions, embeddingSpaces: [...embeddingSpaces.values()], documents: researchCorpusInventory().documents.map(current => {
    const document = pinPublishedResearchDocument(current);
    const stale = document.indexedSource && document.indexedSource.revision !== document.revision;
    const groups = attachmentRevisions(document);
    const revisions = groups.flatMap(group => group.find(row => row.lexical_ready && !row.embedding_ready) ?? group.find(row => row.lexical_ready) ?? []);
    const revision = revisions[0];
    const request = store.db.prepare('SELECT state,error FROM documentary_requests WHERE document_id=? OR source_id=? ORDER BY updated_at DESC LIMIT 1').get(document.id, document.id) as { state: string; error: string | null } | undefined;
    const passages = revisions.reduce((sum, row) => sum + (JSON.parse(row.chunks_json) as DocumentaryChunk[]).length, 0);
    const compatibleVectors = groups.flatMap(group => group.find(row => {
      const identity = JSON.parse(row.identity_json) as DocumentaryIndexIdentity;
      return row.embedding_ready && selectedEmbedding && identity.embedding?.provider === selectedEmbedding.provider
        && identity.embedding.model === selectedEmbedding.modelId
        && JSON.stringify(identity.embedding.parameters) === JSON.stringify(embeddingIdentityParameters(selectedEmbedding));
    }) ?? []);
    const embedded = compatibleVectors.reduce((sum, row) => sum + (JSON.parse(row.chunks_json) as DocumentaryChunk[]).length, 0);
    const incompatible = groups.some(group => group.some(row => row.embedding_ready)) && compatibleVectors.length === 0;
    const coverage = revision ? (JSON.parse(revision.identity_json) as DocumentaryIndexIdentity).coverage ?? document.coverage : document.coverage;
    return { ...document, preparation: { documentId: document.id, revision: document.revision, text: coverage === 'abstract' ? 'abstract' : passages ? 'available' : 'missing',
      lexical: revision ? stale ? 'stale' : 'ready' : 'missing', embeddings: embedded === passages && passages > 0 ? stale ? 'stale' : 'ready' : embedded > 0 ? 'partial' : incompatible ? 'stale' : request?.error ? 'failed' : 'missing',
      status: request?.state === 'blocked' ? 'blocked' : request?.state === 'cancelled' ? 'cancelled' : store.preference('paused') ? 'paused' : revision ? 'ready' : request?.state === 'running' ? 'running' : request?.state === 'queued' ? 'queued' : request?.error ? 'failed' : 'catalogued',
      reason: request?.error?.startsWith('documentary_ocr_') ? 'ocr_required' : request?.error === 'documentary_embeddings_unavailable' ? 'no_model' : request?.error?.includes('embedding') ? 'provider_failed' : request?.error ? 'extraction_failed' : null, error: request?.error ?? null, passages, embedded,
      unpreparedAttachmentIds: unpreparedResearchAttachmentIds(document, revisions.map(row => JSON.parse(row.identity_json) as DocumentaryIndexIdentity)) } };
  }) };
}

let draining = false;
let activePreparation: AbortController | null = null;
let activePreparationDocument: string | null = null;
let activePreparationRequest: string | null = null;
export function interruptUnusedDocumentaryRequest(): void {
  if (!activePreparationRequest) return;
  const row = documentaryStore().db.prepare('SELECT state FROM documentary_requests WHERE document_id=?').get(activePreparationRequest) as { state: string } | undefined;
  if (row?.state !== 'running') activePreparation?.abort();
}
let retryTimer: ReturnType<typeof setTimeout> | null = null;
export async function prepareResearchDocuments(documentIds: string[], mode: 'embeddings' | 'text' = 'embeddings'): Promise<void> {
  const store = documentaryStore();
  const inventory = researchCorpusInventory();
  const configuration = { embedding: mode === 'text' ? null : effectiveEmbeddingConfig(), processingVersion: 'nodus-documentary/2', ocrLanguages: getSettings().ocrLanguages || 'spa+eng' };
  const wanted = new Set(documentIds);
  const documents = inventory.documents.filter(document => wanted.has(document.id));
  if (documents.length !== wanted.size) throw new Error('research_source_not_authorized');
  new DocumentaryCampaigns(store.db).create(getActiveVault().id, getActiveVault().name, documents, configuration);
  for (const document of documents) {
    for (const row of store.db.prepare("SELECT id FROM documentary_jobs WHERE document_id=? AND state IN ('failed','cancelled')").all(document.id) as { id: string }[]) store.retry(row.id);
    const prefix = `embedding:${document.id}:`;
    store.db.prepare(`UPDATE documentary_requests SET state='queued',attempts=0,error=NULL,available_at=?
      WHERE substr(document_id,1,?)=? AND state IN ('failed','cancelled')`).run(Date.now(), prefix.length, prefix);
  }
  notifyDocumentaryPreparation();
  void drainDocumentaryRequests();
}
export function cancelResearchDocuments(documentIds: string[]): void {
  const allowed = new Set(researchCorpusInventory().documents.map(document => document.id));
  if (documentIds.some(id => !allowed.has(id))) throw new Error('research_source_not_authorized');
  const store = documentaryStore();
  const requests = new DocumentaryRequests(store.db);
  const campaigns = new DocumentaryCampaigns(store.db);
  for (const id of documentIds) {
    const owned = store.db.prepare(`SELECT c.id FROM documentary_campaigns c JOIN documentary_campaign_members m ON m.campaign_id=c.id
      WHERE c.vault_id=? AND m.document_id=?`).all(getActiveVault().id, id) as { id: string }[];
    for (const campaign of owned) campaigns.control(campaign.id, 'cancel', id);
    const interest = store.db.prepare(`SELECT 1 FROM documentary_campaign_members m JOIN documentary_campaigns c ON c.id=m.campaign_id
      WHERE m.document_id=? AND m.state='active' AND c.state='active' LIMIT 1`).get(id);
    if (interest) continue;
    requests.cancel(id);
    const prefix = `embedding:${id}:`;
    store.db.prepare(`UPDATE documentary_requests SET state='cancelled',lease_token=NULL,lease_until=NULL
      WHERE substr(document_id,1,?)=? AND state<>'complete'`).run(prefix.length, prefix);
    for (const row of store.db.prepare("SELECT id FROM documentary_jobs WHERE document_id=? AND state<>'complete'").all(id) as { id: string }[]) store.cancel(row.id);
    if (activePreparationDocument === id) activePreparation?.abort();
  }
  notifyDocumentaryPreparation();
}
export function drainDocumentaryRequests(): Promise<void> {
  return withoutOwningVault(() => withoutDatabaseContext(drainOwnedDocumentaryRequests));
}
async function drainOwnedDocumentaryRequests(): Promise<void> {
  if (draining || stopping) return;
  const store = documentaryStore();
  if (store.preference('paused')) return;
  draining = true;
  const requests = new DocumentaryRequests(store.db);
  const owners = () => listVaults().filter(vault => vault.type === 'academic').map(vault => vault.id);
  // Adopt only legacy requests belonging to the active academic vault.
  if (getActiveVault().type === 'academic') store.db.prepare("UPDATE documentary_requests SET vault_id=? WHERE vault_id=''").run(getActiveVault().id);
  if (retryTimer) clearTimeout(retryTimer);
  try {
    // One worker initially; existing Library extraction has its own bounded pool.
    for (;;) {
      if (stopping || store.preference('paused')) break;
      new DocumentaryCampaigns(store.db).synchronizeOwners(owners());
      const request = requests.claim(owners());
      if (!request) break;
      const controller = new AbortController();
      activePreparation = controller;
      activePreparationRequest = request.document_id;
      notifyDocumentaryPreparation();
      activePreparationDocument = request.source_id ?? request.document_id;
      const heartbeat = setInterval(() => { try { requests.renew(request); } catch { controller.abort(); } }, 15000);
      let validateSource = () => {};
      const checkLease = () => { controller.signal.throwIfAborted(); validateSource(); if (getVault(request.vault_id)?.type !== 'academic') throw new Error('research_vault_unavailable'); requests.renew(request); };
      try {
        await withOwningVault(request.vault_id, () => withVaultDatabase(request.vault_id, async () => {
        // Legacy authorized jobs capture their existing provider once at first
        // dispatch; new jobs already carry the enqueue-time configuration.
        const configuration = request.configuration_json ? JSON.parse(request.configuration_json) as { embedding: EmbeddingExecutionConfig | null; processingVersion: string; ocrLanguages?: string }
          : { embedding: effectiveEmbeddingConfig(), processingVersion: 'nodus-documentary/1' };
        if (!request.configuration_json) store.db.prepare('UPDATE documentary_requests SET configuration_json=? WHERE document_id=? AND lease_token=?').run(JSON.stringify(configuration), request.document_id, request.lease_token);
        if (!['nodus-documentary/1', 'nodus-documentary/2'].includes(configuration.processingVersion)) throw new Error('documentary_processing_version_unavailable');
        const document = researchCorpusInventory().documents.find(item => item.id === (request.source_id ?? request.document_id));
        if (!document || document.revision !== request.revision) throw new Error('research_source_not_authorized');
        validateSource = () => {
          const current = researchCorpusInventory().documents.find(item => item.id === document.id);
          if (!current || current.revision !== document.revision || current.permissionRevision !== document.permissionRevision) throw new Error('research_source_not_authorized');
        };
        checkLease();
        const extractionOptions = configuration.processingVersion === 'nodus-documentary/2'
          ? { ocrMode: 'local' as const, localOcrOnly: true, ocrLanguages: configuration.ocrLanguages || 'spa+eng', maxOcrPages: 1000000 }
          : { ocrMode: 'off' as const, maxOcrPages: 0 };
        const onExtractionProgress = (progress: { phase: string; page?: number; totalPages?: number }) => {
          checkLease();
          store.db.prepare('UPDATE documentary_requests SET stage=?,current_page=?,total_pages=?,updated_at=? WHERE document_id=? AND lease_token=?').run(progress.phase === 'ocr' ? 'ocr' : 'extraction', progress.page ?? null, progress.totalPages ?? null, Date.now(), request.document_id, request.lease_token);
          notifyDocumentaryPreparation();
        };
        let text = '';
        let coverage = document.coverage;
        let sourceMap: Record<string, string> = {};
        let parts: DocumentarySourcePart[] = [];
        const publication = store.publishedDocument(document)?.indexedSource;
        const prepared: Array<{ indexKey: string; chunks: DocumentaryChunk[] }> = [];
        if (publication?.revision === document.revision && publication.indexKeys.length) {
          const identities = publication.indexKeys.map(key => JSON.parse(store.getJob(key)!.identity_json) as DocumentaryIndexIdentity);
          if (!unpreparedResearchAttachmentIds(document, identities).length && identities.every(identity => identity.chunkerVersion === RETRIEVAL_CHUNKER_VERSION && identity.processingVersion === configuration.processingVersion)) {
            for (const key of publication.indexKeys) {
              const revision = store.revision(key);
              if (revision?.lexical_ready && revision.chunks_json) prepared.push({ indexKey: key, chunks: JSON.parse(revision.chunks_json) });
            }
            if (prepared.length !== publication.indexKeys.length) prepared.length = 0;
            else coverage = identities.every(identity => identity.coverage === 'fulltext') ? 'fulltext' : identities.some(identity => identity.coverage === 'abstract') ? 'abstract' : document.coverage;
          }
        }
        if (!prepared.length) {
        if (document.conversationAttachment) {
          const { conversationId, attachmentId } = document.conversationAttachment;
          const source = readResearchAttachmentSource(conversationId, attachmentId);
          if (!source) throw new Error('research_source_not_authorized');
          // PDF import records physical page boundaries, not printed folios.
          text = `[[src:conversation]]\n${source.text}`;
          if (source.kind === 'pdf') text = text.split('\n').map(line => {
            const prefix = `[${source.name}, página `;
            const number = line.startsWith(prefix) && line.endsWith(']') ? line.slice(prefix.length, -1) : '';
            return /^[1-9]\d*$/.test(number) ? `[[src:conversation p. ${number}]]` : line;
          }).join('\n');
          sourceMap.conversation = `conversation:${conversationId}:${attachmentId}`;
        }
        if (document.noteId) {
          const note = getNote(document.noteId);
          if (!note || note.trashedAt) throw new Error('research_source_not_authorized');
          text = `[[src:note]]\n${note.content}`;
          sourceMap.note = `note:${getActiveVault().id}:${note.id}`;
        }
        if (document.libraryItemId) {
          const item = getGlobalLibraryItem(document.libraryItemId);
          const raw = getLibraryReaderRawContent(document.libraryItemId);
          const map = raw ? readDocumentarySourceMap(raw.folder, item?.files?.sourceMap) : null;
          const compatible = !!raw && !!map && map.reader.sha256 === createHash('sha256').update(raw.markdown).digest('hex')
            && item?.attachments.length === 1 && item.attachments[0].sha256 === map.source.sha256
            && item.contentRevision?.components.extraction.freshness === 'current';
          if (compatible && raw?.markdown) {
            text = documentarySourceText(raw.markdown, map, 'library');
            sourceMap.library = `library:${document.libraryItemId}:${document.attachmentId ?? 'reader'}`;
            coverage = 'fulltext';
          } else {
            // Use a private staging worker, not the active-vault Library queue.
            // Every compatible attachment keeps its own revision and locators.
            if (item?.attachments.length) parts = await extractGlobalResearchAttachments(document.libraryItemId, controller.signal, extractionOptions, onExtractionProgress);
            if (!parts.length) { text = item?.metadata.abstract ?? ''; coverage = 'abstract'; }
          }
        }
        if (!text && !parts.length && document.workId) {
          const work = getWork(document.workId);
          if (!work || work.archived) throw new Error('research_source_not_authorized');
          const settings = getSettings();
          const userId = settings.zoteroUserId || LOCAL_USER_ID;
          const item = await getItem(userId, work.zotero_key).catch(() => null);
          const resolved = await extractTraditionalResearchWork(userId, work.zotero_key, work.item_type, controller.signal, extractionOptions, onExtractionProgress);
          text = resolved.text || item?.abstract || '';
          coverage = resolved.text ? 'fulltext' : 'abstract';
          sourceMap = resolved.sourceMap;
          parts = resolved.parts;
        }
        if (!text.trim() && !parts.length) throw new Error('documentary_text_unavailable');
        const current = researchCorpusInventory().documents.find(item => item.id === document.id);
        if (!current || current.revision !== document.revision) throw new Error('research_source_revision_changed');
        checkLease();
        store.db.prepare("UPDATE documentary_requests SET stage='lexical' WHERE document_id=? AND lease_token=?").run(request.document_id, request.lease_token);
        if (parts.length) {
          for (const part of parts) {
            checkLease();
            prepared.push(await prepareDocumentaryText({ ...document, coverage: 'fulltext', attachmentId: part.attachmentId,
              attachments: [{ id: part.attachmentId, revision: part.attachmentRevision }] }, part.text, part.sourceMap, controller.signal, configuration.processingVersion));
          }
        } else prepared.push(await prepareDocumentaryText({ ...document, coverage }, text, sourceMap, controller.signal, configuration.processingVersion));
        }
        checkLease();
        const beforePublish = researchCorpusInventory().documents.find(item => item.id === document.id);
        if (!beforePublish || beforePublish.revision !== document.revision || beforePublish.permissionRevision !== document.permissionRevision) throw new Error('research_source_revision_changed');
        store.publishDocument({ ...document, coverage: parts.length ? 'fulltext' : coverage }, prepared.map(result => result.indexKey));
        // Publish every lexical attachment before any optional vector request.
        const total = prepared.reduce((sum, result) => sum + result.chunks.length, 0);
        store.db.prepare("UPDATE documentary_requests SET stage=?,total_passages=?,completed_passages=0,unknown_requests=0 WHERE document_id=? AND lease_token=?").run(configuration.embedding ? 'embeddings' : 'lexical', total, request.document_id, request.lease_token);
        let completed = 0, unknown = 0;
        for (const result of prepared) {
          checkLease();
          if (configuration.embedding) await prepareDocumentaryEmbeddings(result.indexKey, result.chunks, controller.signal, configuration.embedding, checkLease, (count, uncertain) => {
            store.db.prepare('UPDATE documentary_requests SET completed_passages=?,unknown_requests=?,updated_at=? WHERE document_id=? AND lease_token=?').run(completed + count, unknown + uncertain, Date.now(), request.document_id, request.lease_token);
            notifyDocumentaryPreparation();
          });
          completed += result.chunks.length;
          unknown = (store.db.prepare('SELECT unknown_requests FROM documentary_requests WHERE document_id=?').get(request.document_id) as { unknown_requests: number }).unknown_requests;
        }
        checkLease();
        requests.finish(request, null);
        store.db.prepare("UPDATE documentary_requests SET stage='complete' WHERE document_id=?").run(request.document_id);
        }));
      } catch (error) {
        if (error instanceof Error && /^research_(source|vault)_/.test(error.message) && request.source_id) {
          new DocumentaryCampaigns(store.db).blockOwner(request.document_id, request.vault_id);
        }
        try {
          const code = error instanceof Error ? error.message.slice(0, 120) : 'documentary_preparation_failed';
          if (/^documentary_(ocr_resources_missing|ocr_incomplete|embeddings_unavailable|extraction_worker_unavailable)$/.test(code)) requests.block(request, code);
          else requests.finish(request, code, store.preference('paused') || stopping || controller.signal.aborted);
        } catch { /* A newer request owns publication. */ }
      } finally { notifyDocumentaryPreparation(); clearInterval(heartbeat); if (activePreparation === controller) { activePreparation = null; activePreparationDocument = null; activePreparationRequest = null; } }
    }
  } finally {
    draining = false;
    if (stopping) { store.close(); shared = null; }
    else {
      const delay = requests.nextDelay(owners());
      if (delay !== null && !store.preference('paused')) {
        retryTimer = setTimeout(() => { retryTimer = null; void drainDocumentaryRequests().catch(() => undefined); }, delay);
        retryTimer.unref();
      }
    }
  }
}
export function setResearchPreparationPaused(paused: boolean): void {
  if (typeof paused !== 'boolean') throw new Error('Invalid preparation preference');
  documentaryStore().setPreference('paused', paused);
  notifyDocumentaryPreparation();
  if (paused) activePreparation?.abort(); else void drainDocumentaryRequests();
}
export function setResearchPreparationEnabled(enabled: boolean): void {
  if (typeof enabled !== 'boolean') throw new Error('Invalid preparation preference');
  if (getActiveVault().type !== 'academic') throw new Error('research_academic_vault_required');
  const repo = new DocumentaryCampaigns(documentaryStore().db);
  const policy = repo.policy(getActiveVault().id);
  if (enabled && !policy.futureAdditions) policy.known = researchCorpusInventory().documents.filter(document => document.workId && !document.noteId && !document.conversationAttachment).map(document => document.id);
  repo.savePolicy({ ...policy, futureAdditions: enabled });
  notifyDocumentaryPreparation();
  initializeDocumentaryPreparation();
}

let unsubscribe: (() => void) | null = null;
let autoTimer: ReturnType<typeof setTimeout> | null = null;
export function notifyResearchCorpusChanged(): void {
  if (autoTimer) clearTimeout(autoTimer);
  autoTimer = withoutOwningVault(() => withoutDatabaseContext(() => setTimeout(() => {
    autoTimer = null;
    void (async () => {
      const repo = new DocumentaryCampaigns(documentaryStore().db);
      for (const vault of listVaults().filter(vault => vault.type === 'academic')) {
        if (!repo.policy(vault.id).futureAdditions) continue;
        await withOwningVault(vault.id, () => withVaultDatabase(vault.id, async () => {
          const policy = repo.policy(vault.id);
          if (!policy.futureAdditions) return;
          const inventory = researchCorpusInventory().documents.filter(document => document.workId && !document.noteId && !document.conversationAttachment);
          const documents = inventory.filter(document => !policy.known.includes(document.id)
            || (policy.authorized[document.id] !== undefined && policy.authorized[document.id] !== document.revision));
          if (documents.length) await prepareResearchDocuments(documents.map(document => document.id));
          const updated = repo.policy(vault.id);
          repo.savePolicy({ ...updated, known: [...new Set([...updated.known, ...inventory.map(document => document.id)])] });
        }));
      }
    })().catch(() => undefined);
  }, 1000)));
  autoTimer.unref();
}
export function initializeDocumentaryPreparation(): void {
  if (unsubscribe) return;
  const global = onGlobalLibraryChanged(notifyResearchCorpusChanged);
  const authored = onResearchCorpusChanged(notifyResearchCorpusChanged);
  unsubscribe = () => { global(); authored(); };
  // A legacy profile preference must never authorize every vault.
  if (fs.existsSync(path.join(app.getPath('userData'), 'documentary/store.sqlite'))) {
    const store = documentaryStore();
    if (store.preference('enabled') && getActiveVault().type === 'academic') {
      setResearchPreparationEnabled(true);
      store.setPreference('enabled', false);
    }
  }
  // Resume explicitly queued work after a restart, including a crashed stage.
  if (fs.existsSync(path.join(app.getPath('userData'), 'documentary/store.sqlite'))) void drainDocumentaryRequests().catch(() => undefined);
}

export async function retrieveSharedDocumentaryEvidence(scope: ResolvedResearchScope, query: string, settings: RetrievalSettings, vector: number[] | null, signal?: AbortSignal, read?: ResearchDocumentRead): Promise<{ evidence: ResearchEvidence[]; traversal: { partial: boolean; rounds: number; candidates: number; evidenceTokens: number; visited: string[] } }> {
  const inventory = researchCorpusInventory();
  const config = currentEmbeddingConfig();
  let parameters: ReturnType<typeof embeddingIdentityParameters> | null = null;
  try { parameters = embeddingIdentityParameters(effectiveEmbeddingConfig()); } catch { /* Lexical retrieval remains available without an endpoint. */ }
  const vectorKeys: string[] = [];
  const indexedDocuments = new Set<string>();
  const incompleteAttachments = new Set<string>();
  const keys = scope.documents.flatMap(document => {
    assertResearchDocumentPermission(scope, document.id, inventory.documents.find(item => item.id === document.id));
    const groups = attachmentRevisions(document);
    const identities = groups.flatMap(group => group.filter(row => row.lexical_ready).map(row => JSON.parse(row.identity_json) as DocumentaryIndexIdentity));
    if (unpreparedResearchAttachmentIds(document, identities).length) incompleteAttachments.add(document.id);
    return groups.flatMap(revisions => {
    const semantic = revisions.find(row => {
      const identity: DocumentaryIndexIdentity = JSON.parse(row.identity_json);
      return row.embedding_ready && identity.embedding?.model === config.model && identity.embedding?.provider === config.provider && identity.embedding?.dimensions === vector?.length && JSON.stringify(identity.embedding.parameters) === JSON.stringify(parameters);
    });
    if (semantic) vectorKeys.push(semantic.index_key);
    const revision = revisions.find(row => row.lexical_ready && !row.embedding_ready) ?? revisions.find(row => row.lexical_ready);
      if (revision) indexedDocuments.add(document.id);
      return revision ? [revision.index_key] : [];
    });
  });
  const space = researchFingerprint({ ...config, dimensions: vector?.length ?? 0, metric: 'cosine', parameters });
  const threshold = settings.threshold.mode === 'manual' && settings.threshold.embeddingSpace === space ? settings.threshold.value : -1;
  signal?.throwIfAborted();
  if (!keys.length && !vectorKeys.length) return { evidence: [], traversal: { partial: scope.documents.length > 0, rounds: 1, candidates: 0, evidenceTokens: 0, visited: [] } };
  const packagedWorker = path.join(__dirname, 'documentaryRetrievalWorker.js');
  const worker = backgroundProcess(fs.existsSync(packagedWorker) ? packagedWorker : path.join(app.getAppPath(), 'dist-electron/documentaryRetrievalWorker.js'), 'Nodus documentary retrieval');
  const finishSearch = startResearchActivity('nodus', read?.kind === 'search' ? 'search' : read?.kind === 'pages' ? 'pages' : read?.kind === 'context' ? 'expand' : read?.kind === 'references' ? 'references' : 'search', scope.documents.length === 1 ? scope.documents[0].title : query);
  const activities = new Map<string, ReturnType<typeof startResearchActivity>>();
  const result = await new Promise<{ passages: ReturnType<DocumentaryStore['lexicalSearch']>; traversal: { partial: boolean; rounds: number; candidates: number; evidenceTokens: number; visited: string[] } }>((resolve, reject) => {
    let settled = false;
    const finish = (error: Error | null, value?: { passages: ReturnType<DocumentaryStore['lexicalSearch']>; traversal: { partial: boolean; rounds: number; candidates: number; evidenceTokens: number; visited: string[] } }) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      finishSearch(error ? 'failed' : 'completed', value?.passages.length);
      for (const finishActivity of activities.values()) finishActivity(error ? 'failed' : 'completed');
      activities.clear();
      signal?.removeEventListener('abort', abort);
      void worker.terminate().finally(() => { if (error) reject(error); else resolve(value!); });
    };
    const abort = () => finish(new Error('documentary_retrieval_cancelled'));
    const deadline = setTimeout(() => finish(new Error('documentary_retrieval_timeout')), 30000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.on('message', message => {
      if (settled) return;
      if (message.type === 'activity') {
        if (message.status === 'active') activities.set(message.key, startResearchActivity(message.operation === 'expand' ? 'context' : 'nodus', message.operation));
        else { activities.get(message.key)?.('completed', message.count); activities.delete(message.key); }
        return;
      }
      finish(message.error ? new Error(message.error) : null, message);
    });
    worker.once('error', error => finish(error));
    worker.once('exit', () => { if (!settled) finish(new Error('documentary_retrieval_worker_stopped')); });
    worker.postMessage({ filename: documentaryStore().db.name, query, lexicalKeys: keys, vectorKeys, vector, settings, threshold, read, activity: researchActivityEnabled() });
  });
  const latest = researchCorpusInventory().documents;
  for (const document of scope.documents) assertResearchDocumentPermission(scope, document.id, latest.find(item => item.id === document.id));
  const evidence = result.passages.map(passage => {
    const document = scope.documents.find(document => document.id === passage.document_id)!;
    const identity = JSON.parse(documentaryStore().getJob(passage.index_key)!.identity_json) as DocumentaryIndexIdentity;
    const coverage = identity.coverage ?? document.coverage;
    return { id: passage.id, documentId: document.id, workId: document.workId, attachmentId: identity.attachmentId, attachmentRevision: identity.attachmentRevision,
      revision: identity.revision, text: passage.text, locator: JSON.parse(passage.locator_json),
      provenance: document.authoredKind ?? (coverage === 'abstract' ? 'abstract' as const : 'source' as const),
      limitations: [...(incompleteAttachments.has(document.id) ? ['attachments_partially_prepared'] : []), ...(identity.revision !== document.revision ? ['previous_indexed_revision'] : []), ...(document.authoredKind ? [document.authoredKind, 'not_primary_evidence'] : coverage === 'abstract' ? ['abstract_only'] : []), ...(document.sourceWarning ? [document.sourceWarning] : []), ...(read?.kind === 'references' ? ['reference_candidates_require_source_review'] : [])] };
  });
  return { evidence, traversal: { ...result.traversal, partial: result.traversal.partial || incompleteAttachments.size > 0 || indexedDocuments.size < scope.documents.length || scope.documents.some(document => document.indexedSource && document.indexedSource.revision !== document.revision) } };
}
