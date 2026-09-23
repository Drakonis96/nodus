import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { RETRIEVAL_CHUNKER_VERSION } from '@shared/retrievalChunks';
import type { DocumentaryIndexIdentity, ResearchCorpusDocument, ResearchEvidence, ResearchPreparationInventory, ResolvedResearchScope, RetrievalSettings } from '@shared/researchCorpus';
import { DocumentaryRequests } from '../db/documentaryRequests';
import { DocumentaryStore, type DocumentaryChunk } from '../db/documentaryStore';
import { documentaryChunks } from './documentaryChunking';
import { researchCorpusInventory } from './researchCorpusInventory';
import { assertResearchDocument } from './researchCorpusScope';
import { getLibraryReaderRawContent } from '../libraryReader/libraryReaderStore';
import { getGlobalLibraryItem, enqueueLibraryExtraction, listLibraryExtractionJobs } from '../library/libraryService';
import { openAiCompatBase } from './providers';
import { currentEmbeddingConfig } from '../db/ideasRepo';
import { embedMany } from './aiClient';
import { getWork } from '../db/worksRepo';
import { getSettings } from '../db/settingsRepo';
import { getItem, LOCAL_USER_ID } from '../zotero/zoteroClient';
import { documentarySourceText, readDocumentarySourceMap, extractTraditionalResearchWork } from './documentaryExtraction';
import { onGlobalLibraryChanged } from '../library/libraryRuntime';
import { getActiveVault } from '../vaults/vaultRegistry';

let shared: DocumentaryStore | null = null;
let stopping = false;
export function documentaryStore(): DocumentaryStore {
  if (!shared) {
    const directory = path.join(app.getPath('userData'), 'documentary');
    fs.mkdirSync(directory, { recursive: true });
    shared = new DocumentaryStore(path.join(directory, 'store.sqlite'));
    new DocumentaryRequests(shared.db);
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
export async function prepareDocumentaryText(document: ResearchCorpusDocument, text: string, sourceMap: Record<string, string> = {}, signal?: AbortSignal): Promise<{ indexKey: string; chunks: DocumentaryChunk[] }> {
  const store = documentaryStore();
  const identity: DocumentaryIndexIdentity = { documentId: document.id, attachmentId: document.attachmentId, revision: document.revision,
    coverage: document.coverage, textFingerprint: createHash('sha256').update(text).digest('hex'), chunkerVersion: RETRIEVAL_CHUNKER_VERSION, processingVersion: 'nodus-documentary/1', embedding: null };
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
    if (store.getJob(indexKey)?.lease_token === job.lease_token) store.fail(job, 'documentary_preparation_failed');
    throw error;
  } finally { clearInterval(heartbeat); }
}

export async function prepareDocumentaryEmbeddings(indexKey: string, chunks: DocumentaryChunk[], signal?: AbortSignal): Promise<void> {
  const store = documentaryStore();
  const base = JSON.parse(store.getJob(indexKey)!.identity_json) as DocumentaryIndexIdentity;
  const config = currentEmbeddingConfig();
  const parameters = { endpoint: createHash('sha256').update(openAiCompatBase(config.provider) ?? config.provider).digest('hex'), inputPolicy: 'utf8-4096/2' };
  const cached = store.db.prepare(`SELECT 1 FROM documentary_revisions WHERE document_id=? AND embedding_ready=1
    AND json_extract(identity_json,'$.textFingerprint')=? AND json_extract(identity_json,'$.revision')=?
    AND json_extract(identity_json,'$.chunkerVersion')=? AND json_extract(identity_json,'$.embedding.provider')=?
    AND json_extract(identity_json,'$.embedding.model')=? AND json_extract(identity_json,'$.processingVersion')=?
    AND json_extract(identity_json,'$.embedding.parameters')=?`).get(base.documentId, base.textFingerprint, base.revision, base.chunkerVersion, config.provider, config.model, base.processingVersion, JSON.stringify(parameters));
  if (cached) return;
  const vectors = await embedMany(chunks.map(chunk => chunk.text), signal);
  signal?.throwIfAborted();
  if (vectors.some(vector => !vector?.length) || !vectors.length) throw new Error('documentary_embeddings_unavailable');
  if (JSON.stringify(currentEmbeddingConfig()) !== JSON.stringify(config)) throw new Error('documentary_embedding_configuration_changed');
  const identity: DocumentaryIndexIdentity = { ...base, embedding: { ...config, dimensions: vectors[0]!.length, metric: 'cosine', parameters } };
  const id = store.enqueue(identity, {});
  const job = store.claim(Date.now(), 60000, id);
  if (!job) return;
  try {
    store.saveChunks(job, chunks);
    store.publishLexical(job);
    store.publishEmbeddings(job, vectors as number[][]);
  } catch (error) { store.fail(job, 'documentary_embedding_publication_failed'); throw error; }
}

function revisionsFor(document: ResearchCorpusDocument): Array<{ index_key: string; identity_json: string; embedding_ready: number; lexical_ready: number; chunks_json: string }> {
  return documentaryStore().db.prepare(`SELECT * FROM documentary_revisions WHERE document_id=? AND json_extract(identity_json,'$.revision')=? ORDER BY embedding_ready DESC,created_at DESC`)
    .all(document.id, document.revision) as ReturnType<typeof revisionsFor>;
}
export function getResearchPreparationInventory(): ResearchPreparationInventory {
  const store = documentaryStore();
  return { enabled: store.preference('enabled'), documents: researchCorpusInventory().documents.map(document => {
    const revision = revisionsFor(document).find(row => row.lexical_ready);
    const request = store.db.prepare('SELECT state,error FROM documentary_requests WHERE document_id=?').get(document.id) as { state: string; error: string | null } | undefined;
    const passages = revision ? (JSON.parse(revision.chunks_json) as DocumentaryChunk[]).length : 0;
    const coverage = revision ? (JSON.parse(revision.identity_json) as DocumentaryIndexIdentity).coverage ?? document.coverage : document.coverage;
    return { ...document, preparation: { documentId: document.id, revision: document.revision, text: coverage === 'abstract' ? 'abstract' : passages ? 'available' : 'missing',
      lexical: revision ? 'ready' : 'missing', embeddings: revision?.embedding_ready ? 'ready' : request?.error ? 'failed' : 'missing',
      status: store.preference('paused') ? 'paused' : revision ? 'ready' : request?.state === 'running' ? 'running' : request?.state === 'queued' ? 'queued' : request?.error ? 'failed' : 'catalogued',
      reason: request?.error === 'documentary_embeddings_unavailable' ? 'no_model' : request?.error?.includes('embedding') ? 'provider_failed' : request?.error ? 'extraction_failed' : null, error: request?.error ?? null, passages, embedded: revision?.embedding_ready ? passages : 0 } };
  }) };
}

let draining = false;
let activePreparation: AbortController | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
export async function prepareResearchDocuments(documentIds: string[]): Promise<void> {
  const store = documentaryStore();
  const inventory = researchCorpusInventory();
  const wanted = new Set(documentIds);
  const documents = inventory.documents.filter(document => wanted.has(document.id));
  if (documents.length !== wanted.size) throw new Error('research_source_not_authorized');
  const requests = new DocumentaryRequests(store.db);
  for (const document of documents) requests.enqueue(document.id, document.revision, getActiveVault().id);
  void drainDocumentaryRequests();
}
export async function drainDocumentaryRequests(): Promise<void> {
  if (draining || stopping) return;
  const store = documentaryStore();
  if (store.preference('paused')) return;
  draining = true;
  const requests = new DocumentaryRequests(store.db);
  const vaultId = getActiveVault().id;
  if (retryTimer) clearTimeout(retryTimer);
  try {
    // One worker initially; existing Library extraction has its own bounded pool.
    for (;;) {
      if (store.preference('paused')) break;
      if (getActiveVault().id !== vaultId) break;
      const request = requests.claim(vaultId);
      if (!request) break;
      const controller = new AbortController();
      activePreparation = controller;
      const heartbeat = setInterval(() => { try { requests.renew(request); } catch { controller.abort(); } }, 15000);
      const checkLease = () => { controller.signal.throwIfAborted(); if (getActiveVault().id !== vaultId) throw new Error('research_scope_changed'); requests.renew(request); };
      try {
        const document = researchCorpusInventory().documents.find(item => item.id === request.document_id);
        if (!document || document.revision !== request.revision) throw new Error('research_source_not_authorized');
        checkLease();
        let text = '';
        let coverage = document.coverage;
        let sourceMap: Record<string, string> = {};
        if (document.libraryItemId) {
          let item = getGlobalLibraryItem(document.libraryItemId);
          let raw = getLibraryReaderRawContent(document.libraryItemId);
          let map = raw ? readDocumentarySourceMap(raw.folder, item?.files?.sourceMap) : null;
          const compatible = () => !!raw && !!map && map.reader.sha256 === createHash('sha256').update(raw.markdown).digest('hex')
            && !!item?.attachments.some(attachment => attachment.sha256 === map!.source.sha256)
            && item.contentRevision?.components.extraction.freshness === 'current';
          if (!compatible() && item?.attachments.length) {
            const queued = enqueueLibraryExtraction([document.libraryItemId], { ocrMode: 'off', maxOcrPages: 0, force: true });
            const deadline = Date.now() + 120000;
            while (queued.jobIds.length) {
              checkLease();
              const jobs = listLibraryExtractionJobs().filter(job => queued.jobIds.includes(job.id));
              if (jobs.every(job => ['done', 'failed', 'canceled'].includes(job.status))) break;
              if (Date.now() >= deadline) throw new Error('documentary_extraction_timeout');
              await new Promise(resolve => setTimeout(resolve, 200));
            }
            item = getGlobalLibraryItem(document.libraryItemId);
            raw = getLibraryReaderRawContent(document.libraryItemId);
            map = raw ? readDocumentarySourceMap(raw.folder, item?.files?.sourceMap) : null;
          }
          if (!compatible()) raw = null;
          if (raw?.markdown) {
            text = documentarySourceText(raw.markdown, map, 'library');
            sourceMap.library = `library:${document.libraryItemId}:${document.attachmentId ?? 'reader'}`;
            coverage = 'fulltext';
          } else { text = item?.metadata.abstract ?? ''; coverage = 'abstract'; }
        }
        if (!text && document.workId) {
          const work = getWork(document.workId);
          if (!work || work.archived) throw new Error('research_source_not_authorized');
          const settings = getSettings();
          const userId = settings.zoteroUserId || LOCAL_USER_ID;
          const item = await getItem(userId, work.zotero_key).catch(() => null);
          const resolved = await extractTraditionalResearchWork(userId, work.zotero_key, work.item_type, controller.signal);
          text = resolved.text || item?.abstract || '';
          coverage = resolved.text ? 'fulltext' : 'abstract';
          sourceMap = resolved.sourceMap;
        }
        if (!text.trim()) throw new Error('documentary_text_unavailable');
        const current = researchCorpusInventory().documents.find(item => item.id === document.id);
        if (!current || current.revision !== document.revision) throw new Error('research_source_revision_changed');
        checkLease();
        const result = await prepareDocumentaryText({ ...document, coverage }, text, sourceMap, controller.signal);
        checkLease();
        await prepareDocumentaryEmbeddings(result.indexKey, result.chunks, controller.signal);
        checkLease();
        requests.finish(request, null);
      } catch (error) {
        try { requests.finish(request, error instanceof Error ? error.message.slice(0, 120) : 'documentary_preparation_failed', store.preference('paused')); } catch { /* A newer request owns publication. */ }
      } finally { clearInterval(heartbeat); if (activePreparation === controller) activePreparation = null; }
    }
  } finally {
    draining = false;
    if (stopping) { store.close(); shared = null; }
    else {
      const delay = requests.nextDelay(vaultId);
      if (delay !== null && !store.preference('paused') && getActiveVault().id === vaultId) {
        retryTimer = setTimeout(() => { retryTimer = null; void drainDocumentaryRequests().catch(() => undefined); }, delay);
        retryTimer.unref();
      }
    }
  }
}
export function setResearchPreparationPaused(paused: boolean): void {
  if (typeof paused !== 'boolean') throw new Error('Invalid preparation preference');
  documentaryStore().setPreference('paused', paused);
  if (paused) activePreparation?.abort(); else void drainDocumentaryRequests();
}
export function setResearchPreparationEnabled(enabled: boolean): void {
  if (typeof enabled !== 'boolean') throw new Error('Invalid preparation preference');
  documentaryStore().setPreference('enabled', enabled);
  initializeDocumentaryPreparation();
}

let unsubscribe: (() => void) | null = null;
let autoTimer: ReturnType<typeof setTimeout> | null = null;
export function initializeDocumentaryPreparation(): void {
  if (unsubscribe) return;
  unsubscribe = onGlobalLibraryChanged(() => {
    if (autoTimer) clearTimeout(autoTimer);
    autoTimer = setTimeout(() => {
      autoTimer = null;
      if (!documentaryStore().preference('enabled') || getActiveVault().type !== 'academic') return;
      const documents = researchCorpusInventory().documents.filter(document => {
        if (revisionsFor(document).some(row => row.lexical_ready)) return false;
        const previous = documentaryStore().db.prepare('SELECT revision FROM documentary_requests WHERE document_id=?').get(document.id) as { revision: string } | undefined;
        return previous?.revision !== document.revision;
      });
      if (documents.length) void prepareResearchDocuments(documents.map(document => document.id)).catch(() => undefined);
    }, 1000);
    autoTimer.unref();
  });
  // Resume explicitly queued work after a restart, including a crashed stage.
  if (fs.existsSync(path.join(app.getPath('userData'), 'documentary/store.sqlite')) && getActiveVault().type === 'academic') void drainDocumentaryRequests().catch(() => undefined);
}

export async function retrieveSharedDocumentaryEvidence(scope: ResolvedResearchScope, query: string, settings: RetrievalSettings, vector: number[] | null, signal?: AbortSignal): Promise<{ evidence: ResearchEvidence[]; traversal: { partial: boolean; rounds: number; candidates: number; evidenceTokens: number; visited: string[] } }> {
  const inventory = researchCorpusInventory();
  const config = currentEmbeddingConfig();
  const parameters = { endpoint: createHash('sha256').update(openAiCompatBase(config.provider) ?? config.provider).digest('hex'), inputPolicy: 'utf8-4096/2' };
  const vectorKeys: string[] = [];
  const keys = scope.documents.flatMap(document => {
    assertResearchDocument(scope, document.id, inventory.documents.find(item => item.id === document.id));
    const revisions = revisionsFor(document);
    const semantic = revisions.find(row => {
      const identity: DocumentaryIndexIdentity = JSON.parse(row.identity_json);
      return row.embedding_ready && identity.embedding?.model === config.model && identity.embedding?.provider === config.provider && identity.embedding?.dimensions === vector?.length && JSON.stringify(identity.embedding.parameters) === JSON.stringify(parameters);
    });
    if (semantic) vectorKeys.push(semantic.index_key);
    const revision = revisions.find(row => row.lexical_ready && !row.embedding_ready) ?? revisions.find(row => row.lexical_ready);
    return revision ? [revision.index_key] : [];
  });
  const space = `${config.provider}:${config.model}:${vector?.length ?? 0}:cosine`;
  const threshold = settings.threshold.mode === 'manual' && settings.threshold.embeddingSpace === space ? settings.threshold.value : -1;
  signal?.throwIfAborted();
  const worker = new Worker(path.join(__dirname, 'documentaryRetrievalWorker.js'));
  const result = await new Promise<{ passages: ReturnType<DocumentaryStore['lexicalSearch']>; traversal: { partial: boolean; rounds: number; candidates: number; evidenceTokens: number; visited: string[] } }>((resolve, reject) => {
    let settled = false;
    const finish = (error: Error | null, value?: Parameters<typeof resolve>[0]) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      signal?.removeEventListener('abort', abort);
      void worker.terminate();
      if (error) reject(error); else resolve(value!);
    };
    const abort = () => finish(new Error('documentary_retrieval_cancelled'));
    const deadline = setTimeout(() => finish(new Error('documentary_retrieval_timeout')), 30000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.once('message', message => finish(message.error ? new Error(message.error) : null, message));
    worker.once('error', error => finish(error));
    worker.once('exit', () => { if (!settled) finish(new Error('documentary_retrieval_worker_stopped')); });
    worker.postMessage({ filename: documentaryStore().db.name, query, lexicalKeys: keys, vectorKeys, vector, settings, threshold });
  });
  const evidence = result.passages.map(passage => {
    const document = scope.documents.find(document => document.id === passage.document_id)!;
    const identity = JSON.parse(documentaryStore().getJob(passage.index_key)!.identity_json) as DocumentaryIndexIdentity;
    const coverage = identity.coverage ?? document.coverage;
    return { id: passage.id, documentId: document.id, workId: document.workId, attachmentId: document.attachmentId,
      revision: document.revision, text: passage.text, locator: JSON.parse(passage.locator_json),
      provenance: coverage === 'abstract' ? 'abstract' as const : 'source' as const, limitations: coverage === 'abstract' ? ['abstract_only'] : [] };
  });
  return { evidence, traversal: result.traversal };
}
