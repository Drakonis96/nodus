import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--documentary-writers')) process.exit(0);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-writer-test-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
try {
  const db = load('electron/db/database.ts').getDb();
  assert.equal(db.pragma('user_version', { simple: true }), load('electron/db/migrations.ts').SCHEMA_VERSION);
  db.prepare("INSERT INTO works(nodus_id,zotero_key,title,authors_json,item_type,source_type) VALUES('inside','inside','Synthetic','[]','book','text')").run();
  const { beginPassagePublication } = load('electron/db/passagePublications.ts');
  const { replaceWorkPassages } = load('electron/db/passagesRepo.ts');
  const settings = load('electron/db/ideasRepo.ts').currentEmbeddingConfig();
  const old = beginPassagePublication('inside', 'old');
  const recent = beginPassagePublication('inside', 'recent');
  const rows = [{ text: 'Current evidence', pageLabel: '1', embedding: null }];
  const config = { embeddingProvider: settings.provider, embeddingModel: settings.model };
  replaceWorkPassages('inside', 'recent', rows, { ...config, publication: recent });
  assert.throws(() => replaceWorkPassages('inside', 'old', [], { ...config, publication: old }), /superseded/);
  assert.equal(db.prepare('SELECT text FROM passages').get().text, 'Current evidence');

  // Exercise the actual shared store and persistent operation lease. Only the
  // worker and provider are deterministic test doubles in this unit fixture.
  const chunks = load('electron/ai/documentaryChunking.ts');
  chunks.documentaryChunks = async text => [{ text, pageLabel: '1', pageNumber: 1, sourceRef: 'fixture' }];
  const ai = load('electron/ai/aiClient.ts');
  let calls = 0, unblock;
  ai.embedMany = async () => { calls++; await new Promise(resolve => { unblock = resolve; }); return [[1, 0, 0]]; };
  const preparation = load('electron/ai/documentaryPreparation.ts');
  const doc = load('electron/ai/researchCorpusInventory.ts').researchCorpusInventory().documents.find(item => item.workId === 'inside');
  const text = await preparation.prepareDocumentaryText({ ...doc, coverage: 'fulltext' }, 'Known evidence');
  assert.equal(preparation.documentaryStore().lexicalSearch('Known', [text.indexKey], 3).length, 1);
  const pending = preparation.prepareDocumentaryEmbeddings(text.indexKey, text.chunks);
  await assert.rejects(() => preparation.prepareDocumentaryEmbeddings(text.indexKey, text.chunks), /job_unavailable/);
  assert.equal(calls, 1, 'concurrent producer is fenced before a provider request');
  unblock();
  const result = await pending;
  assert.equal(preparation.documentaryStore().revision(result.indexKey).embedding_ready, 1);
  const reused = await preparation.prepareDocumentaryEmbeddings(text.indexKey, text.chunks);
  assert.equal(calls, 1, 'compatible published vectors are reused');
  assert.deepEqual(reused.vectors, [[1, 0, 0]]);
  const inventory = preparation.getResearchPreparationInventory();
  assert.equal(inventory.embeddingSpaces.length, 1);
  assert.match(inventory.embeddingSpaces[0].id, /^[a-f0-9]{64}$/);
  const files = [];
  for (const attachmentId of ['appendix-a', 'appendix-b']) {
    files.push(await preparation.prepareDocumentaryText({ ...doc, coverage: 'fulltext', attachmentId,
      attachments: [{ id: attachmentId, revision: `hash-${attachmentId}` }] }, `Independent ${attachmentId} evidence`));
  }
  const scope = load('electron/ai/researchNotebookService.ts').resolveAcademicResearchScope();
  const found = await preparation.retrieveSharedDocumentaryEvidence(scope, 'Independent', load('shared/researchCorpus.ts').RETRIEVAL_PRESETS.balanced, null);
  assert.deepEqual([...new Set(found.evidence.map(item => item.attachmentId))].sort(), ['appendix-a', 'appendix-b']);
  assert.equal(preparation.getResearchPreparationInventory().documents.find(item => item.id === doc.id).preparation.passages, 2);
  const citations = load('electron/citations/documentaryCitations.ts');
  const citationId = citations.documentaryCitationId(scope.id, found.evidence[0].id);
  const before = citations.getDocumentaryPassageDetail(citationId);
  assert.equal(before.attachmentId, found.evidence[0].attachmentId);
  db.prepare('UPDATE works SET resolved_text_hash=? WHERE nodus_id=?').run('changed-content', 'inside');
  const pinnedRead = await preparation.retrieveSharedDocumentaryEvidence(scope, 'Independent', load('shared/researchCorpus.ts').RETRIEVAL_PRESETS.balanced, null);
  assert.deepEqual(pinnedRead.evidence.map(item => item.text), found.evidence.map(item => item.text), 'frozen executions keep original indexed revisions after content changes');
  const historical = citations.getDocumentaryPassageDetail(citationId);
  assert.equal(historical.historical, true);
  assert.equal(historical.text, before.text, 'immutable citation keeps its exact original text after a content edit');
  db.prepare('UPDATE works SET archived=1 WHERE nodus_id=?').run('inside');
  assert.equal(citations.getDocumentaryPassageDetail(citationId), null, 'revocation still blocks historical source reads');
  console.log('Legacy fencing, lexical-first shared preparation, pre-dispatch embedding lease and compatible vector reuse passed.');
} finally {
  load('electron/ai/documentaryPreparation.ts').closeDocumentaryPreparation();
  load('electron/db/database.ts').closeDb();
  fs.rmSync(root, { recursive: true, force: true });
}
