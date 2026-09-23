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
  console.log('Legacy fencing, lexical-first shared preparation, pre-dispatch embedding lease and compatible vector reuse passed.');
} finally {
  load('electron/ai/documentaryPreparation.ts').closeDocumentaryPreparation();
  load('electron/db/database.ts').closeDb();
  fs.rmSync(root, { recursive: true, force: true });
}
