import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { RETRIEVAL_CHUNKER_VERSION } from '@shared/retrievalChunks';
import type { DocumentaryIndexIdentity, ResearchCorpusDocument, ResearchDocumentRead, ResearchEvidence, ResearchPreparationInventory, ResolvedResearchScope, RetrievalSettings } from '@shared/researchCorpus';
import { DocumentaryRequests } from '../db/documentaryRequests';
import { DocumentaryStore, type DocumentaryChunk } from '../db/documentaryStore';
import { documentaryChunks } from './documentaryChunking';
import { researchCorpusInventory } from './researchCorpusInventory';
import { assertResearchDocumentPermission, researchFingerprint } from './researchCorpusScope';
import { getLibraryReaderRawContent } from '../libraryReader/libraryReaderStore';
import { getGlobalLibraryItem, enqueueLibraryExtraction, listLibraryExtractionJobs } from '../library/libraryService';
import { openAiCompatBase } from './providers';
import { currentEmbeddingConfig } from '../db/ideasRepo';
import { embedMany } from './aiClient';
import { getWork } from '../db/worksRepo';
import { readResearchAttachmentSource } from './researchAttachmentSources';
import { getNote } from '../db/notesRepo';
import { listResearchNotebooks } from '../db/researchNotebooksRepo';
import { getSettings } from '../db/settingsRepo';
import { getItem, LOCAL_USER_ID } from '../zotero/zoteroClient';
import { documentarySourceText, readDocumentarySourceMap, extractTraditionalResearchWork, extractGlobalResearchAttachments, type DocumentarySourcePart } from './documentaryExtraction';
import { onGlobalLibraryChanged } from '../library/libraryRuntime';
import { getActiveVault } from '../vaults/vaultRegistry';
import { onResearchCorpusChanged } from './researchCorpusEvents';

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
    attachmentRevision: document.attachments?.find(attachment => attachment.id === document.attachmentId)?.revision,
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

export async function prepareDocumentaryEmbeddings(indexKey: string, chunks: DocumentaryChunk[], signal?: AbortSignal): Promise<{ indexKey: string; vectors: number[][]; provider: string; model: string }> {
  const store = documentaryStore();
  const base = JSON.parse(store.getJob(indexKey)!.identity_json) as DocumentaryIndexIdentity;
  const config = currentEmbeddingConfig();
  const parameters = { endpoint: createHash('sha256').update(openAiCompatBase(config.provider) ?? config.provider).digest('hex'), inputPolicy: 'utf8-4096/2' };
  const cached = store.db.prepare(`SELECT index_key FROM documentary_revisions WHERE document_id=? AND embedding_ready=1
    AND json_extract(identity_json,'$.textFingerprint')=? AND json_extract(identity_json,'$.revision')=?
    AND json_extract(identity_json,'$.chunkerVersion')=? AND json_extract(identity_json,'$.embedding.provider')=?
    AND json_extract(identity_json,'$.embedding.model')=? AND json_extract(identity_json,'$.processingVersion')=?
    AND json_extract(identity_json,'$.attachmentId') IS ?
    AND json_extract(identity_json,'$.embedding.parameters')=?`).get(base.documentId, base.textFingerprint, base.revision, base.chunkerVersion, config.provider, config.model, base.processingVersion, base.attachmentId, JSON.stringify(parameters)) as { index_key: string } | undefined;
  if (cached) {
    const rows = store.db.prepare('SELECT vector_json FROM documentary_passages WHERE index_key=? ORDER BY ordinal').all(cached.index_key) as { vector_json: string }[];
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
    const vectors = await embedMany(chunks.map(chunk => chunk.text), controller.signal);
    signal?.throwIfAborted();
    requests.renew(lease);
    if (store.preference('paused')) throw new Error('documentary_paused');
    if (vectors.some(vector => !vector?.length) || !vectors.length) throw new Error('documentary_embeddings_unavailable');
    if (JSON.stringify(currentEmbeddingConfig()) !== JSON.stringify(config)) throw new Error('documentary_embedding_configuration_changed');
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
    try { requests.finish(lease, 'documentary_embedding_failed', store.preference('paused')); } catch { /* Lease was fenced. */ }
    throw error;
  } finally { clearInterval(heartbeat); signal?.removeEventListener('abort', abort); }
}

function revisionsFor(document: ResearchCorpusDocument): Array<{ index_key: string; identity_json: string; embedding_ready: number; lexical_ready: number; chunks_json: string }> {
  return documentaryStore().db.prepare(`SELECT * FROM documentary_revisions WHERE document_id=? AND json_extract(identity_json,'$.revision')=? ORDER BY embedding_ready DESC,created_at DESC`)
    .all(document.id, document.revision) as ReturnType<typeof revisionsFor>;
}
function attachmentRevisions(document: ResearchCorpusDocument): Array<ReturnType<typeof revisionsFor>> {
  const groups = new Map<string | null, ReturnType<typeof revisionsFor>>();
  for (const row of revisionsFor(document)) {
    const identity: DocumentaryIndexIdentity = JSON.parse(row.identity_json);
    if (document.attachments?.length && identity.attachmentId !== null
        && !document.attachments.some(attachment => attachment.id === identity.attachmentId
          && (!identity.attachmentRevision || attachment.revision === identity.attachmentRevision))) continue;
    const group = groups.get(identity.attachmentId) ?? [];
    group.push(row); groups.set(identity.attachmentId, group);
  }
  // A merged legacy derivative cannot accompany independently indexed files.
  if (groups.size > 1) groups.delete(null);
  return [...groups.values()];
}
export function getResearchPreparationInventory(): ResearchPreparationInventory {
  const store = documentaryStore();
  const embeddingSpaces = new Map<string, NonNullable<ResearchPreparationInventory['embeddingSpaces']>[number]>();
  for (const row of store.db.prepare('SELECT identity_json FROM documentary_revisions WHERE embedding_ready=1').all() as { identity_json: string }[]) {
    const embedding = (JSON.parse(row.identity_json) as DocumentaryIndexIdentity).embedding;
    if (embedding) {
      const id = researchFingerprint(embedding);
      embeddingSpaces.set(id, { id, provider: embedding.provider, model: embedding.model, dimensions: embedding.dimensions, metric: embedding.metric });
    }
  }
  return { enabled: store.preference('enabled'), embeddingSpaces: [...embeddingSpaces.values()], documents: researchCorpusInventory().documents.map(document => {
    const revisions = attachmentRevisions(document).flatMap(group => group.find(row => row.lexical_ready) ?? []);
    const revision = revisions[0];
    const request = store.db.prepare('SELECT state,error FROM documentary_requests WHERE document_id=?').get(document.id) as { state: string; error: string | null } | undefined;
    const passages = revisions.reduce((sum, row) => sum + (JSON.parse(row.chunks_json) as DocumentaryChunk[]).length, 0);
    const embedded = revisions.reduce((sum, row) => sum + (row.embedding_ready ? (JSON.parse(row.chunks_json) as DocumentaryChunk[]).length : 0), 0);
    const coverage = revision ? (JSON.parse(revision.identity_json) as DocumentaryIndexIdentity).coverage ?? document.coverage : document.coverage;
    return { ...document, preparation: { documentId: document.id, revision: document.revision, text: coverage === 'abstract' ? 'abstract' : passages ? 'available' : 'missing',
      lexical: revision ? 'ready' : 'missing', embeddings: embedded === passages && passages > 0 ? 'ready' : embedded > 0 ? 'partial' : request?.error ? 'failed' : 'missing',
      status: request?.state === 'cancelled' ? 'cancelled' : store.preference('paused') ? 'paused' : revision ? 'ready' : request?.state === 'running' ? 'running' : request?.state === 'queued' ? 'queued' : request?.error ? 'failed' : 'catalogued',
      reason: request?.error === 'documentary_embeddings_unavailable' ? 'no_model' : request?.error?.includes('embedding') ? 'provider_failed' : request?.error ? 'extraction_failed' : null, error: request?.error ?? null, passages, embedded } };
  }) };
}

let draining = false;
let activePreparation: AbortController | null = null;
let activePreparationDocument: string | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
export async function prepareResearchDocuments(documentIds: string[]): Promise<void> {
  const store = documentaryStore();
  const inventory = researchCorpusInventory();
  const wanted = new Set(documentIds);
  const documents = inventory.documents.filter(document => wanted.has(document.id));
  if (documents.length !== wanted.size) throw new Error('research_source_not_authorized');
  const requests = new DocumentaryRequests(store.db);
  for (const document of documents) {
    requests.enqueue(document.id, document.revision, getActiveVault().id);
    for (const row of store.db.prepare("SELECT id FROM documentary_jobs WHERE document_id=? AND state IN ('failed','cancelled')").all(document.id) as { id: string }[]) store.retry(row.id);
    const prefix = `embedding:${document.id}:`;
    store.db.prepare(`UPDATE documentary_requests SET state='queued',attempts=0,error=NULL,available_at=?
      WHERE substr(document_id,1,?)=? AND state IN ('failed','cancelled')`).run(Date.now(), prefix.length, prefix);
  }
  void drainDocumentaryRequests();
}
export function cancelResearchDocuments(documentIds: string[]): void {
  const allowed = new Set(researchCorpusInventory().documents.map(document => document.id));
  if (documentIds.some(id => !allowed.has(id))) throw new Error('research_source_not_authorized');
  const store = documentaryStore();
  const requests = new DocumentaryRequests(store.db);
  for (const id of documentIds) {
    requests.cancel(id);
    const prefix = `embedding:${id}:`;
    store.db.prepare(`UPDATE documentary_requests SET state='cancelled',lease_token=NULL,lease_until=NULL
      WHERE substr(document_id,1,?)=? AND state<>'complete'`).run(prefix.length, prefix);
    for (const row of store.db.prepare("SELECT id FROM documentary_jobs WHERE document_id=? AND state<>'complete'").all(id) as { id: string }[]) store.cancel(row.id);
    if (activePreparationDocument === id) activePreparation?.abort();
  }
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
      activePreparationDocument = request.document_id;
      const heartbeat = setInterval(() => { try { requests.renew(request); } catch { controller.abort(); } }, 15000);
      const checkLease = () => { controller.signal.throwIfAborted(); if (getActiveVault().id !== vaultId) throw new Error('research_scope_changed'); requests.renew(request); };
      try {
        const document = researchCorpusInventory().documents.find(item => item.id === request.document_id);
        if (!document || document.revision !== request.revision) throw new Error('research_source_not_authorized');
        checkLease();
        let text = '';
        let coverage = document.coverage;
        let sourceMap: Record<string, string> = {};
        let parts: DocumentarySourcePart[] = [];
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
          let item = getGlobalLibraryItem(document.libraryItemId);
          if ((item?.attachments.length ?? 0) > 1) {
            parts = await extractGlobalResearchAttachments(document.libraryItemId, controller.signal);
            coverage = parts.length ? 'fulltext' : 'abstract';
          }
          let raw = getLibraryReaderRawContent(document.libraryItemId);
          let map = raw ? readDocumentarySourceMap(raw.folder, item?.files?.sourceMap) : null;
          const compatible = () => !!raw && !!map && map.reader.sha256 === createHash('sha256').update(raw.markdown).digest('hex')
            && !!item?.attachments.some(attachment => attachment.sha256 === map!.source.sha256)
            && item.contentRevision?.components.extraction.freshness === 'current';
          if (!parts.length && !compatible() && item?.attachments.length) {
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
        if (!text && !parts.length && document.workId) {
          const work = getWork(document.workId);
          if (!work || work.archived) throw new Error('research_source_not_authorized');
          const settings = getSettings();
          const userId = settings.zoteroUserId || LOCAL_USER_ID;
          const item = await getItem(userId, work.zotero_key).catch(() => null);
          const resolved = await extractTraditionalResearchWork(userId, work.zotero_key, work.item_type, controller.signal);
          text = resolved.text || item?.abstract || '';
          coverage = resolved.text ? 'fulltext' : 'abstract';
          sourceMap = resolved.sourceMap;
          parts = resolved.parts;
        }
        if (!text.trim() && !parts.length) throw new Error('documentary_text_unavailable');
        const current = researchCorpusInventory().documents.find(item => item.id === document.id);
        if (!current || current.revision !== document.revision) throw new Error('research_source_revision_changed');
        checkLease();
        const prepared = [];
        if (parts.length) {
          for (const part of parts) {
            checkLease();
            prepared.push(await prepareDocumentaryText({ ...document, coverage: 'fulltext', attachmentId: part.attachmentId,
              attachments: [{ id: part.attachmentId, revision: part.attachmentRevision }] }, part.text, part.sourceMap, controller.signal));
          }
        } else prepared.push(await prepareDocumentaryText({ ...document, coverage }, text, sourceMap, controller.signal));
        // Publish every lexical attachment before any optional vector request.
        for (const result of prepared) {
          checkLease();
          await prepareDocumentaryEmbeddings(result.indexKey, result.chunks, controller.signal);
        }
        checkLease();
        requests.finish(request, null);
      } catch (error) {
        try { requests.finish(request, error instanceof Error ? error.message.slice(0, 120) : 'documentary_preparation_failed', store.preference('paused')); } catch { /* A newer request owns publication. */ }
      } finally { clearInterval(heartbeat); if (activePreparation === controller) { activePreparation = null; activePreparationDocument = null; } }
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
export function notifyResearchCorpusChanged(): void {
  if (getActiveVault().type !== 'academic') return;
    if (autoTimer) clearTimeout(autoTimer);
    autoTimer = setTimeout(() => {
      autoTimer = null;
      if (!documentaryStore().preference('enabled') || getActiveVault().type !== 'academic') return;
      const documents = researchCorpusInventory().documents.filter(document => {
        if (document.conversationAttachment && !listResearchNotebooks().some(notebook => notebook.sources.some(source => source.kind === 'conversation-attachment' && source.id === document.id)
          && !notebook.exclusions.includes(document.id))) return false;
        if (document.noteId && !listResearchNotebooks().some(notebook => notebook.sources.some(source => source.kind === 'note' && source.id === document.noteId)
          && !notebook.exclusions.includes(document.id))) return false;
        if (revisionsFor(document).some(row => row.lexical_ready)) return false;
        const previous = documentaryStore().db.prepare('SELECT revision FROM documentary_requests WHERE document_id=?').get(document.id) as { revision: string } | undefined;
        return previous?.revision !== document.revision;
      });
      if (documents.length) void prepareResearchDocuments(documents.map(document => document.id)).catch(() => undefined);
    }, 1000);
    autoTimer.unref();
}
export function initializeDocumentaryPreparation(): void {
  if (unsubscribe) return;
  const global = onGlobalLibraryChanged(notifyResearchCorpusChanged);
  const authored = onResearchCorpusChanged(notifyResearchCorpusChanged);
  unsubscribe = () => { global(); authored(); };
  // Resume explicitly queued work after a restart, including a crashed stage.
  if (fs.existsSync(path.join(app.getPath('userData'), 'documentary/store.sqlite')) && getActiveVault().type === 'academic') void drainDocumentaryRequests().catch(() => undefined);
}

export async function retrieveSharedDocumentaryEvidence(scope: ResolvedResearchScope, query: string, settings: RetrievalSettings, vector: number[] | null, signal?: AbortSignal, read?: ResearchDocumentRead): Promise<{ evidence: ResearchEvidence[]; traversal: { partial: boolean; rounds: number; candidates: number; evidenceTokens: number; visited: string[] } }> {
  const inventory = researchCorpusInventory();
  const config = currentEmbeddingConfig();
  const parameters = { endpoint: createHash('sha256').update(openAiCompatBase(config.provider) ?? config.provider).digest('hex'), inputPolicy: 'utf8-4096/2' };
  const vectorKeys: string[] = [];
  const indexedDocuments = new Set<string>();
  const keys = scope.documents.flatMap(document => {
    assertResearchDocumentPermission(scope, document.id, inventory.documents.find(item => item.id === document.id));
    return attachmentRevisions(document).flatMap(revisions => {
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
  const worker = new Worker(fs.existsSync(packagedWorker) ? packagedWorker : path.join(app.getAppPath(), 'dist-electron/documentaryRetrievalWorker.js'));
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
    worker.postMessage({ filename: documentaryStore().db.name, query, lexicalKeys: keys, vectorKeys, vector, settings, threshold, read });
  });
  const latest = researchCorpusInventory().documents;
  for (const document of scope.documents) assertResearchDocumentPermission(scope, document.id, latest.find(item => item.id === document.id));
  const evidence = result.passages.map(passage => {
    const document = scope.documents.find(document => document.id === passage.document_id)!;
    const identity = JSON.parse(documentaryStore().getJob(passage.index_key)!.identity_json) as DocumentaryIndexIdentity;
    const coverage = identity.coverage ?? document.coverage;
    return { id: passage.id, documentId: document.id, workId: document.workId, attachmentId: identity.attachmentId, attachmentRevision: identity.attachmentRevision,
      revision: document.revision, text: passage.text, locator: JSON.parse(passage.locator_json),
      provenance: document.authoredKind ?? (coverage === 'abstract' ? 'abstract' as const : 'source' as const),
      limitations: [...(document.authoredKind ? [document.authoredKind, 'not_primary_evidence'] : coverage === 'abstract' ? ['abstract_only'] : []), ...(document.sourceWarning ? [document.sourceWarning] : []), ...(read?.kind === 'references' ? ['reference_candidates_require_source_review'] : [])] };
  });
  return { evidence, traversal: { ...result.traversal, partial: result.traversal.partial || indexedDocuments.size < scope.documents.length } };
}
