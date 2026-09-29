import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--documentary-binary-vectors')) process.exit(0);

// Vectors were stored as JSON text twice: in the published passage and in the working
// checkpoint, which was never deleted. On a real store that was 2.6 of 3.7 GB. They are
// now Float32 blobs stored once, and an existing store converts itself in the background.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-binary-vectors-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
const until = async (condition, label) => {
  for (let i = 0; i < 1000 && !condition(); i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(condition(), label);
};
try {
  const { DocumentaryStore } = load('electron/db/documentaryStore.ts');
  const { DocumentaryRequests } = load('electron/db/documentaryRequests.ts');
  const { DocumentaryEmbeddingBatches } = load('electron/db/documentaryEmbeddingBatches.ts');
  const directory = path.join(root, 'documentary');
  fs.mkdirSync(directory, { recursive: true });

  // 1. A store written by the previous release.
  const legacyVector = i => [Math.cos(i), Math.sin(i), 0.1 * i, 1 / 3];
  const legacy = new DocumentaryStore(path.join(directory, 'store.sqlite'));
  legacy.db.prepare("INSERT INTO documentary_revisions(index_key,document_id,identity_json,lexical_ready,embedding_ready,created_at) VALUES ('legacy-key','doc','{}',1,1,0)").run();
  const passage = legacy.db.prepare("INSERT INTO documentary_passages(id,index_key,document_id,ordinal,text,locator_json,vector_json) VALUES (?,'legacy-key','doc',?,?,'{}',?)");
  for (let i = 0; i < 250; i++) passage.run(`legacy-key:${i}`, i, `Legacy passage ${i}`, JSON.stringify(legacyVector(i)));
  const requests = new DocumentaryRequests(legacy.db);
  new DocumentaryEmbeddingBatches(legacy.db);
  requests.enqueue('embedding:doc:finished', 'r', 'v');
  requests.enqueue('embedding:doc:unfinished', 'r', 'v');
  legacy.db.prepare("UPDATE documentary_requests SET state='complete' WHERE document_id='embedding:doc:finished'").run();
  const checkpoint = legacy.db.prepare("INSERT INTO documentary_embedding_chunks VALUES (?,?,'h',?,4)");
  for (let i = 0; i < 40; i++) { checkpoint.run('embedding:doc:finished', i, JSON.stringify(legacyVector(i))); checkpoint.run('embedding:doc:unfinished', i, JSON.stringify(legacyVector(i))); }
  const query = [0.3, -0.7, 2, 0.5];
  const before = legacy.semanticSearch(query, ['legacy-key'], 25).map(row => row.id);
  legacy.close();

  // 2. Opening it converts in short background batches.
  const preparation = load('electron/ai/documentaryPreparation.ts');
  const store = preparation.documentaryStore();
  const count = sql => store.db.prepare(sql).get().n;
  await until(() => store.preference('legacy-vectors-converted'), 'the background conversion finishes');
  assert.equal(count('SELECT COUNT(*) n FROM documentary_passages WHERE vector_json IS NOT NULL'), 0);
  assert.equal(count('SELECT COUNT(*) n FROM documentary_passages WHERE vector IS NOT NULL'), 250);
  const { storedDocumentaryVector } = load('electron/db/documentaryVectors.ts');
  const converted = store.db.prepare("SELECT vector,vector_json FROM documentary_passages WHERE id='legacy-key:77'").get();
  assert.deepEqual(storedDocumentaryVector(converted), legacyVector(77).map(Math.fround), 'Float32 is exactly what providers return');
  assert.equal(converted.vector.length, 16, 'four dimensions take sixteen bytes');
  assert.deepEqual(store.semanticSearch(query, ['legacy-key'], 25).map(row => row.id), before, 'search ranks the converted vectors identically');
  assert.equal(count("SELECT COUNT(*) n FROM documentary_embedding_chunks WHERE operation='embedding:doc:finished'"), 0, 'finished working copies are dropped');
  assert.equal(count("SELECT COUNT(*) n FROM documentary_embedding_chunks WHERE operation='embedding:doc:unfinished'"), 40, 'unfinished ones still resume');

  // 3. New vectors are written once, as blobs, and reused from them.
  const chunks = Array.from({ length: 70 }, (_, i) => ({ text: `Fresh fragment ${i}`, pageLabel: String(i + 1), pageNumber: i + 1, sourceRef: 'fixture' }));
  load('electron/ai/documentaryChunking.ts').documentaryChunks = async () => chunks;
  const text = await preparation.prepareDocumentaryText({ id: 'fresh-doc', revision: 'r1', coverage: 'fulltext', attachmentId: null }, 'Fresh source');
  const ai = load('electron/ai/aiClient.ts');
  let calls = 0;
  ai.embedMany = async texts => { calls++; return texts.map(value => [Number(value.split(' ').at(-1)) + 1, 1, 0]); };
  const config = { provider: 'openrouter', modelId: 'baai/bge-m3', endpoint: 'http://127.0.0.1:9999/v1' };
  const embedded = await preparation.prepareDocumentaryEmbeddings(text.indexKey, chunks, undefined, config);
  assert.equal(count(`SELECT COUNT(*) n FROM documentary_passages WHERE index_key='${embedded.indexKey}' AND vector IS NOT NULL AND vector_json IS NULL`), 70);
  assert.equal(count("SELECT COUNT(*) n FROM documentary_embedding_chunks WHERE operation LIKE 'embedding:fresh-doc:%'"), 0, 'published vectors keep no second copy');
  const callsBefore = calls;
  const reused = await preparation.prepareDocumentaryEmbeddings(text.indexKey, chunks, undefined, config);
  assert.equal(calls, callsBefore, 'published vectors are reused without a provider call');
  assert.deepEqual(reused.vectors, embedded.vectors);
  assert.deepEqual(store.semanticSearch([5, 1, 0], [embedded.indexKey], 3).map(row => row.text), ['Fresh fragment 4', 'Fresh fragment 5', 'Fresh fragment 3']);
  console.log('Vectors are Float32 blobs stored once; legacy stores convert in the background with identical search results.');
} finally {
  await load('electron/ai/documentaryPreparation.ts').closeDocumentaryPreparation();
  fs.rmSync(root, { recursive: true, force: true });
}
