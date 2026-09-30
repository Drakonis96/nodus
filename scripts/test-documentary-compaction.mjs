import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--documentary-compaction')) process.exit(0);

// Converting a real store to binary vectors left 2.1 of its 3.7 GB as free pages and the
// rest scattered: semantic search took 5 s per query before VACUUM and 0.3 s after. VACUUM
// holds the write lock for tens of seconds, so it runs in its own process while nothing
// writes, and writers wait for it instead of failing on a locked database.
const worker = path.join(repoRoot, 'dist-electron/documentaryMaintenanceWorker.js');
if (!fs.existsSync(worker)) { console.log('Skipped: build the app first (dist-electron/documentaryMaintenanceWorker.js).'); process.exit(0); }
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-documentary-compaction-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
const keepAlive = setInterval(() => {}, 1000);
const tick = () => new Promise(resolve => setImmediate(resolve));
try {
  const preparation = load('electron/ai/documentaryPreparation.ts');
  await preparation.initializeDocumentaryPreparation();
  const store = preparation.documentaryStore();
  const db = store.db;
  const { encodeDocumentaryVector } = load('electron/db/documentaryVectors.ts');
  db.prepare("INSERT INTO documentary_revisions(index_key,document_id,identity_json,lexical_ready,embedding_ready,created_at) VALUES ('kept','doc','{}',1,1,0)").run();
  const passage = db.prepare("INSERT INTO documentary_passages(id,index_key,document_id,ordinal,text,locator_json,vector) VALUES (?,'kept','doc',?,?,'{}',?)");
  for (let i = 0; i < 200; i++) passage.run(`kept:${i}`, i, `Kept passage ${i}`, encodeDocumentaryVector([i + 1, 1, 0]));
  store.setPreference('legacy-vectors-converted', true);
  const churn = () => {
    const junk = db.prepare("INSERT INTO documentary_embedding_chunks VALUES ('embedding:junk',?,'h',?,1)");
    db.transaction(() => { for (let i = 0; i < 2000; i++) junk.run(i, 'x'.repeat(20000)); })();
    db.prepare("DELETE FROM documentary_embedding_chunks WHERE operation='embedding:junk'").run();
    db.pragma('wal_checkpoint(TRUNCATE)');
  };
  new (load('electron/db/documentaryEmbeddingBatches.ts').DocumentaryEmbeddingBatches)(db);
  churn();
  const threshold = { minFreeBytes: 1024 * 1024, minFreeRatio: 0.3 };
  const free = () => db.pragma('freelist_count', { simple: true });
  const bytesBefore = fs.statSync(db.name).size;
  assert.ok(free() * 4096 > 30e6, 'the fixture leaves tens of megabytes free');

  // Nothing starts while a writer holds the store.
  await preparation.withDocumentaryWrites(async () => {
    preparation.compactDocumentaryStoreWhenIdle(threshold);
    let settled = false;
    void preparation.documentaryMaintenanceSettled().then(() => { settled = true; });
    await tick();
    assert.equal(settled, true, 'compaction waits for writers to finish');
  });

  // Idle: compaction runs in its own process and writers wait for it.
  preparation.compactDocumentaryStoreWhenIdle(threshold);
  let finished = false;
  void preparation.documentaryMaintenanceSettled().then(() => { finished = true; });
  await tick();
  assert.equal(finished, false, 'compaction is running');
  let freeSeenByWriter = null;
  await preparation.withDocumentaryWrites(() => { freeSeenByWriter = free(); });
  assert.equal(finished, true);
  assert.ok(freeSeenByWriter < 16, `the writer ran after compaction (${freeSeenByWriter} free pages)`);
  const bytesAfter = fs.statSync(db.name).size;
  assert.ok(bytesAfter < bytesBefore / 4, `the file shrank from ${bytesBefore} to ${bytesAfter} bytes`);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM documentary_passages WHERE index_key='kept' AND vector IS NOT NULL").get().n, 200);
  assert.deepEqual(store.semanticSearch([7, 1, 0], ['kept'], 1).map(row => row.text), ['Kept passage 6']);
  assert.equal(store.preference('legacy-vectors-converted'), true);

  // A small store is left alone.
  preparation.compactDocumentaryStoreWhenIdle();
  let untouched = false;
  void preparation.documentaryMaintenanceSettled().then(() => { untouched = true; });
  await tick();
  assert.equal(untouched, true, 'the default threshold skips a store without much free space');
  console.log('The store is compacted in its own process while idle; writers wait and data survives.');
} finally {
  clearInterval(keepAlive);
  await load('electron/ai/documentaryPreparation.ts').closeDocumentaryPreparation();
  fs.rmSync(root, { recursive: true, force: true });
}
