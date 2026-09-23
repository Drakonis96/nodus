import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--documentary-store')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-documentary-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
const { DocumentaryStore } = require(path.join(repoRoot, 'electron/db/documentaryStore.ts'));
const filename = path.join(scratch, 'shared.sqlite');
let first = new DocumentaryStore(filename);
const second = new DocumentaryStore(filename);
try {
  const identity = { documentId: 'work', attachmentId: 'pdf', revision: 'r1', textFingerprint: 'hash', chunkerVersion: '280-60/1', processingVersion: '1',
    embedding: { provider: 'fixture', model: 'fixture', dimensions: 2, metric: 'cosine', parameters: {} } };
  const id = first.enqueue(identity, {}, 1, 1000);
  assert.equal(second.enqueue(identity, {}, 1, 1000), id, 'one index shared across producers');
  const a = first.claim(1000, 1000);
  assert.ok(a);
  assert.equal(second.claim(1000, 1000), null, 'transactional claim is exclusive');
  first.saveExtraction(a, 'North field measured 23 units.', 1100);
  first.close();
  first = new DocumentaryStore(filename);
  assert.equal(first.claim(1900), null);
  const recovered = second.claim(2001, 1000);
  assert.equal(recovered.stage, 'chunk');
  assert.equal(recovered.attempts, 1, 'a crash preserves the failure allowance');
  assert.throws(() => first.saveExtraction(a, 'stale writer', 2100), /lease_lost/);
  second.saveChunks(recovered, [{ text: 'North field measured 23 units.', pageLabel: 'iv', pageNumber: 6, sourceRef: 'pdf:source' }], 2100);
  second.publishLexical(recovered, 2200);
  assert.equal(first.lexicalSearch('23 units', [id], 5).length, 1, 'searchable before embeddings');
  assert.equal(first.lexicalSearch('23 units', [], 5).length, 0);
  assert.equal(first.physicalPages([id], 6, 6, 10, 'pdf').length, 1, 'physical page 6 is distinct from printed page iv');
  assert.equal(first.physicalPages([id], 4, 4, 10).length, 0);
  assert.deepEqual(first.physicalPages([], 6, 6, 10), []);
  assert.deepEqual(first.physicalPages([id], 6, 6, 10, 'foreign-file'), []);
  assert.deepEqual(first.physicalPages([id], 1, 500, 10), [], 'wide page ranges are refused');
  assert.equal(first.revision(id).embedding_ready, 0);
  assert.throws(() => second.publishEmbeddings(recovered, [[1, 2, 3]], 2300), /space_mismatch/);
  second.publishEmbeddings(recovered, [[1, 0]], 2300);
  assert.equal(first.revision(id).embedding_ready, 1);
  const nextId = first.enqueue({ ...identity, revision: 'r2' }, {}, 0, 3000);
  const next = first.claim(3000, 1000);
  first.saveExtraction(next, 'changed', 3100);
  first.cancel(nextId);
  assert.throws(() => first.saveChunks(next, [], 3200), /lease_lost/);
  assert.equal(first.lexicalSearch('23 units', [id], 5).length, 1, 'failed rebuild preserves old revision');
  assert.equal(first.db.prepare('SELECT index_key FROM documentary_current').get().index_key, id);
  const failedId = first.enqueue({ ...identity, documentId: 'failure' }, {}, 0, 4000);
  for (const now of [4000, 10000, 20000]) { const job = first.claim(now); first.fail(job, 'provider_failed', now); }
  assert.equal(first.getJob(failedId).state, 'failed');
  assert.equal(first.claim(50000), null, 'retry bound enforced');
  first.enqueue({ ...identity, documentId: 'paused' }, {}, 0, 60000);
  first.setPreference('paused', true);
  assert.equal(second.claim(60000), null);
  first.setPreference('paused', false);
  const pausedJob = second.claim(60000);
  assert.ok(pausedJob);
  second.interrupt(pausedJob, 60001);
  const resumedJob = second.claim(60002, 60000, pausedJob.id);
  assert.equal(resumedJob.attempts, 1, 'pause does not consume an extraction attempt');
  second.complete(resumedJob, 60003);
  const attachments = ['appendix-a', 'appendix-b'].map(attachmentId => ({ ...identity, documentId: 'multi', attachmentId, attachmentRevision: 'bytes-1' }));
  const keys = attachments.map(attachment => first.enqueue(attachment, {}, 0, 70000));
  for (const [index, key] of keys.entries()) {
    const job = first.claim(70000, 60000, key);
    first.saveChunks(job, [{ text: `Independent evidence ${index}`, pageLabel: '1', pageNumber: 1, sourceRef: attachments[index].attachmentId }], 71000);
    first.publishLexical(job, 72000);
    first.complete(job, 73000);
  }
  const heads = first.db.prepare('SELECT attachment_id,current_key FROM documentary_attachment_heads WHERE document_id=? ORDER BY attachment_id').all('multi');
  assert.deepEqual(heads.map(head => head.current_key), keys, 'attachments publish independently within one canonical work');
  const changed = first.enqueue({ ...attachments[0], attachmentRevision: 'bytes-2' }, {}, 0, 74000);
  assert.notEqual(changed, keys[0], 'attachment revision participates in identity');
  first.cancel(changed);
  assert.deepEqual(first.db.prepare('SELECT current_key FROM documentary_attachment_heads WHERE document_id=? ORDER BY attachment_id').all('multi').map(row => row.current_key), keys,
    'failed replacement retains both attachment heads');
  assert.equal(first.lexicalSearch('Independent', keys, 10).length, 2);

  // A real SQLITE_FULL during FTS publication must roll back the new revision,
  // leaving the previous manifest and searchable passages intact.
  const full = new DocumentaryStore(path.join(scratch, 'full.sqlite'));
  try {
    const document = { id: 'full-work', revision: 'r1', attachmentId: 'pdf', attachments: [{ id: 'pdf', revision: 'bytes-1' }], permissionRevision: 'allowed' };
    const oldKey = full.enqueue({ ...identity, documentId: document.id, attachmentRevision: 'bytes-1' }, {});
    const oldJob = full.claim(Date.now(), 60000, oldKey);
    full.saveChunks(oldJob, [{ text: 'Last valid evidence', pageLabel: '1', pageNumber: 1, sourceRef: 'pdf' }]);
    full.publishLexical(oldJob); full.complete(oldJob); full.publishDocument(document, [oldKey]);
    const replacementKey = full.enqueue({ ...identity, documentId: document.id, revision: 'r2', attachmentRevision: 'bytes-2' }, {});
    const replacementJob = full.claim(Date.now(), 60000, replacementKey);
    full.saveChunks(replacementJob, [{ text: 'large replacement evidence '.repeat(100000), pageLabel: '1', pageNumber: 1, sourceRef: 'pdf' }]);
    full.db.pragma(`max_page_count = ${full.db.pragma('page_count', { simple: true })}`);
    assert.throws(() => full.publishLexical(replacementJob), error => error.code === 'SQLITE_FULL');
    assert.equal(full.revision(replacementKey).lexical_ready, 0);
    assert.equal(full.lexicalSearch('valid', [oldKey], 5).length, 1);
    assert.equal(full.publishedDocument({ ...document, revision: 'r2' }).indexedSource.revision, 'r1');
  } finally { full.close(); }
  console.log('Shared documentary store: idempotency, transactional leases, restart recovery, fencing, lexical-first publication, vector compatibility, cancellation, bounded retries and pause passed.');
} finally { first.close(); second.close(); fs.rmSync(scratch, { recursive: true, force: true }); }
