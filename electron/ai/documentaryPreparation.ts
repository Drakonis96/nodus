import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { RETRIEVAL_CHUNKER_VERSION } from '@shared/retrievalChunks';
import type { DocumentaryIndexIdentity, ResearchCorpusDocument, ResearchEvidence, ResearchPreparationInventory, ResolvedResearchScope, RetrievalSettings } from '@shared/researchCorpus';
import { DocumentaryStore, type DocumentaryChunk } from '../db/documentaryStore';
import { documentaryChunks } from './documentaryChunking';
import { researchCorpusInventory } from './researchCorpusInventory';
import { assertResearchDocument } from './researchCorpusScope';
import { getLibraryReaderRawContent } from '../libraryReader/libraryReaderStore';
import { getGlobalLibraryItem, prepareGlobalLibraryReading } from '../library/libraryService';
import { currentEmbeddingConfig } from '../db/ideasRepo';
import { embedMany } from './aiClient';
import { getWork } from '../db/worksRepo';
import { getSettings } from '../db/settingsRepo';
import { getItem, LOCAL_USER_ID } from '../zotero/zoteroClient';
import { resolveWorkText } from '../extraction/textExtractor';
import { onGlobalLibraryChanged } from '../library/libraryRuntime';
import { getActiveVault } from '../vaults/vaultRegistry';

let shared: DocumentaryStore | null = null;
export function documentaryStore(): DocumentaryStore {
  if (!shared) {
    const directory = path.join(app.getPath('userData'), 'documentary');
    fs.mkdirSync(directory, { recursive: true });
    shared = new DocumentaryStore(path.join(directory, 'store.sqlite'));
    shared.db.exec(`CREATE TABLE IF NOT EXISTS documentary_requests (
      document_id TEXT PRIMARY KEY, revision TEXT NOT NULL, state TEXT NOT NULL, error TEXT, updated_at INTEGER NOT NULL
    )`);
  }
  return shared;
}
export function closeDocumentaryPreparation(): void { shared?.close(); shared = null; }

/** Shared text writer used once extraction has supplied a real source revision. */
export async function prepareDocumentaryText(document: ResearchCorpusDocument, text: string, sourceMap: Record<string, string> = {}, signal?: AbortSignal): Promise<{ indexKey: string; chunks: DocumentaryChunk[] }> {
  const store = documentaryStore();
  const identity: DocumentaryIndexIdentity = { documentId: document.id, attachmentId: document.attachmentId, revision: document.revision,
    textFingerprint: createHash('sha256').update(text).digest('hex'), chunkerVersion: RETRIEVAL_CHUNKER_VERSION, processingVersion: 'nodus-documentary/1', embedding: null };
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
  const cached = store.db.prepare(`SELECT 1 FROM documentary_revisions WHERE document_id=? AND embedding_ready=1
    AND json_extract(identity_json,'$.textFingerprint')=? AND json_extract(identity_json,'$.revision')=?
    AND json_extract(identity_json,'$.chunkerVersion')=? AND json_extract(identity_json,'$.embedding.provider')=?
    AND json_extract(identity_json,'$.embedding.model')=?`).get(base.documentId, base.textFingerprint, base.revision, base.chunkerVersion, config.provider, config.model);
  if (cached) return;
  const vectors = await embedMany(chunks.map(chunk => chunk.text), signal);
  signal?.throwIfAborted();
  if (vectors.some(vector => !vector?.length) || !vectors.length) throw new Error('documentary_embeddings_unavailable');
  if (JSON.stringify(currentEmbeddingConfig()) !== JSON.stringify(config)) throw new Error('documentary_embedding_configuration_changed');
  const identity: DocumentaryIndexIdentity = { ...base, embedding: { ...config, dimensions: vectors[0]!.length, metric: 'cosine', parameters: {} } };
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
    return { ...document, preparation: { documentId: document.id, revision: document.revision, text: document.coverage === 'abstract' ? 'abstract' : passages ? 'available' : 'missing',
      lexical: revision ? 'ready' : 'missing', embeddings: revision?.embedding_ready ? 'ready' : request?.error ? 'failed' : 'missing',
      status: store.preference('paused') ? 'paused' : revision ? 'ready' : request?.state === 'running' ? 'running' : request?.state === 'queued' ? 'queued' : request?.error ? 'failed' : 'catalogued',
      reason: request?.error ? 'extraction_failed' : null, error: request?.error ?? null, passages, embedded: revision?.embedding_ready ? passages : 0 } };
  }) };
}

let draining = false;
export async function prepareResearchDocuments(documentIds: string[]): Promise<void> {
  const store = documentaryStore();
  const inventory = researchCorpusInventory();
  const wanted = new Set(documentIds);
  const documents = inventory.documents.filter(document => wanted.has(document.id));
  if (documents.length !== wanted.size) throw new Error('research_source_not_authorized');
  const insert = store.db.prepare(`INSERT INTO documentary_requests VALUES (?,?,'queued',NULL,?)
    ON CONFLICT(document_id) DO UPDATE SET revision=excluded.revision,state='queued',error=NULL,updated_at=excluded.updated_at`);
  for (const document of documents) insert.run(document.id, document.revision, Date.now());
  void drainDocumentaryRequests();
}
export async function drainDocumentaryRequests(): Promise<void> {
  if (draining) return;
  const store = documentaryStore();
  if (store.preference('paused')) return;
  draining = true;
  try {
    // One worker initially; existing Library extraction has its own bounded pool.
    store.db.prepare("UPDATE documentary_requests SET state='queued' WHERE state='running'").run();
    for (;;) {
      if (store.preference('paused')) break;
      const request = store.db.prepare("SELECT document_id FROM documentary_requests WHERE state='queued' ORDER BY updated_at LIMIT 1").get() as { document_id: string } | undefined;
      if (!request) break;
      store.db.prepare("UPDATE documentary_requests SET state='running',updated_at=? WHERE document_id=?").run(Date.now(), request.document_id);
      try {
        const document = researchCorpusInventory().documents.find(item => item.id === request.document_id);
        if (!document) throw new Error('research_source_not_authorized');
        let text = document.libraryItemId ? getLibraryReaderRawContent(document.libraryItemId)?.markdown ?? '' : '';
        let sourceMap: Record<string, string> = {};
        if (!text && document.libraryItemId) {
          await prepareGlobalLibraryReading(document.libraryItemId);
          text = getLibraryReaderRawContent(document.libraryItemId)?.markdown || getGlobalLibraryItem(document.libraryItemId)?.metadata.abstract || '';
        }
        if (!text && document.workId) {
          const work = getWork(document.workId);
          if (!work || work.archived) throw new Error('research_source_not_authorized');
          const settings = getSettings();
          const userId = settings.zoteroUserId || LOCAL_USER_ID;
          const item = await getItem(userId, work.zotero_key).catch(() => null);
          const resolved = await resolveWorkText(userId, work.zotero_key, settings.zoteroStoragePath, item?.abstract ?? null, work.doi,
            { unpaywallEmail: '', allowExternalRetrieval: false, preferZoteroFulltext: true, ocr: { enabled: false, languages: settings.ocrLanguages, maxPages: 0 } }, work.item_type);
          text = resolved.text;
          sourceMap = Object.fromEntries((resolved.segments ?? []).map(segment => [segment.marker, segment.sourceRef]));
        }
        if (!text.trim()) throw new Error('documentary_text_unavailable');
        const current = researchCorpusInventory().documents.find(item => item.id === document.id);
        if (!current || current.revision !== document.revision) throw new Error('research_source_revision_changed');
        const result = await prepareDocumentaryText(document, text, sourceMap);
        await prepareDocumentaryEmbeddings(result.indexKey, result.chunks);
        store.db.prepare("UPDATE documentary_requests SET state='complete',error=NULL WHERE document_id=?").run(document.id);
      } catch (error) {
        store.db.prepare("UPDATE documentary_requests SET state='failed',error=? WHERE document_id=?").run(error instanceof Error ? error.message.slice(0, 120) : 'documentary_preparation_failed', request.document_id);
      }
    }
  } finally { draining = false; }
}
export function setResearchPreparationPaused(paused: boolean): void { documentaryStore().setPreference('paused', paused); if (!paused) void drainDocumentaryRequests(); }
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

export async function retrieveSharedDocumentaryEvidence(scope: ResolvedResearchScope, query: string, settings: RetrievalSettings, vector: number[] | null): Promise<{ evidence: ResearchEvidence[]; traversal: { partial: boolean; rounds: number; candidates: number; evidenceTokens: number; visited: string[] } }> {
  const inventory = researchCorpusInventory();
  const config = currentEmbeddingConfig();
  const vectorKeys: string[] = [];
  const keys = scope.documents.flatMap(document => {
    assertResearchDocument(scope, document.id, inventory.documents.find(item => item.id === document.id));
    const revisions = revisionsFor(document);
    const semantic = revisions.find(row => {
      const identity: DocumentaryIndexIdentity = JSON.parse(row.identity_json);
      return row.embedding_ready && identity.embedding?.model === config.model && identity.embedding?.provider === config.provider && identity.embedding?.dimensions === vector?.length;
    });
    if (semantic) vectorKeys.push(semantic.index_key);
    const revision = revisions.find(row => row.lexical_ready && !row.embedding_ready) ?? revisions.find(row => row.lexical_ready);
    return revision ? [revision.index_key] : [];
  });
  const space = `${config.provider}:${config.model}:${vector?.length ?? 0}:cosine`;
  const threshold = settings.threshold.mode === 'manual' && settings.threshold.embeddingSpace === space ? settings.threshold.value : -1;
  const worker = new Worker(path.join(__dirname, 'documentaryRetrievalWorker.js'));
  const result = await new Promise<{ passages: ReturnType<DocumentaryStore['lexicalSearch']>; traversal: { partial: boolean; rounds: number; candidates: number; evidenceTokens: number; visited: string[] } }>((resolve, reject) => {
    let settled = false;
    const finish = (error: Error | null, value?: Parameters<typeof resolve>[0]) => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      if (error) reject(error); else resolve(value!);
    };
    worker.once('message', message => finish(message.error ? new Error(message.error) : null, message));
    worker.once('error', error => finish(error));
    worker.once('exit', () => { if (!settled) finish(new Error('documentary_retrieval_worker_stopped')); });
    worker.postMessage({ filename: documentaryStore().db.name, query, lexicalKeys: keys, vectorKeys, vector, settings, threshold });
  });
  const evidence = result.passages.map(passage => {
    const document = scope.documents.find(document => document.id === passage.document_id)!;
    return { id: passage.id, documentId: document.id, workId: document.workId, attachmentId: document.attachmentId,
      revision: document.revision, text: passage.text, locator: JSON.parse(passage.locator_json),
      provenance: document.coverage === 'abstract' ? 'abstract' as const : 'source' as const, limitations: document.coverage === 'abstract' ? ['abstract_only'] : [] };
  });
  return { evidence, traversal: result.traversal };
}
