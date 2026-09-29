// Regression tests for library write-path fixes. Each block reproduces a state found
// on a real vault and proves the writer no longer produces it:
//
//   1. addEdge rejects self-loops and keeps an edge's owner and trace method in step.
//   2. A failed Documentary Index job superseded by a later success no longer hands
//      its checkpoints to the next job; neither does one run with another model.
//   3. A section crossing into the next attachment ends inside its own source.
//   4. A support's passage is the one that contains the quote, in the quote's source.
//   5. U+0000 in extracted text becomes a space (offsets unchanged).
//
// Runs the real modules against a fully migrated scratch database under
// Electron-as-Node (better-sqlite3 ABI), like test-document-profiles.mjs.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks as installSharedRuntimeHooks } from './lib/tsRuntimeHooks.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const marker = '--electron-library-integrity-fixes-test';
if (!process.argv.includes(marker)) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [fileURLToPath(import.meta.url), marker], {
    cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-library-integrity-'));
installRuntimeHooks(root);
try {
  const Database = require('better-sqlite3');
  const { runMigrations } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const db = new Database(path.join(root, 'library.sqlite'));
  runMigrations(db);
  globalThis.__libraryIntegrityDb = db;
  const now = new Date().toISOString();
  for (const id of ['w1', 'w2', 'w3', 'w4']) {
    db.prepare(`INSERT INTO works(nodus_id,zotero_key,title,authors_json,year,item_type,source_type,archived,
      light_status,deep_status,summary_status) VALUES(?,?,?,'[]',2024,'book','pdf',0,'done','done','none')`).run(id, `Z-${id}`, `Obra ${id}`);
  }

  // ── 1. Edges ───────────────────────────────────────────────────────────────
  const ideas = require(path.join(repoRoot, 'electron/db/ideasRepo.ts'));
  for (const id of ['g-1', 'g-2', 'g-3']) {
    db.prepare('INSERT INTO ideas(global_id,type,label,statement,created_at) VALUES(?,?,?,?,?)').run(id, 'claim', id, `statement ${id}`, now);
  }
  const edge = (from, to, sourceWork, method) => ideas.addEdge({
    from_id: from, to_id: to, type: 'refines', basis: 'explicit', confidence: 0.8, source_work: sourceWork, trace: { method },
  });
  const edgeRow = (id) => db.prepare(
    'SELECT e.source_work, t.method FROM edges e LEFT JOIN edge_traces t ON t.edge_id = e.id WHERE e.id = ?'
  ).get(id);

  assert.equal(edge('g-1', 'g-1', 'w1', 'deep'), null, 'a self-loop is never stored');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM edges WHERE from_id = to_id').get().n, 0);

  const derived = edge('g-1', 'g-2', null, 'reprocess');
  assert.equal(edge('g-1', 'g-2', 'w1', 'deep'), derived, 'a scan re-finding a derived edge reuses it');
  assert.deepEqual({ ...edgeRow(derived) }, { source_work: 'w1', method: 'deep' }, 'the scan claims the derived edge: owner and trace move together');

  const owned = edge('g-2', 'g-3', 'w1', 'deep');
  assert.equal(edge('g-2', 'g-3', null, 'bridge'), owned);
  assert.deepEqual({ ...edgeRow(owned) }, { source_work: 'w1', method: 'deep' }, 'a derived pass does not overwrite an owned edge\'s trace');

  // ── 2. Documentary Index checkpoints ────────────────────────────────────────
  const repo = require(path.join(repoRoot, 'electron/db/documentProfilesRepo.ts'));
  const modelA = { provider: 'deepseek', model: 'a' };
  const modelB = { provider: 'deepseek', model: 'b' };
  const job = (jobId, nodusId, status, model, updatedAt) => db.prepare(`INSERT INTO document_index_jobs(
      job_id,campaign_id,vault_id,nodus_id,priority,reason,status,phase,progress,generator_model_json,auditor_model_json,
      attempts,max_attempts,created_at,updated_at) VALUES(?,NULL,'v',?,0,'test',?,?,0,?,NULL,1,5,?,?)`)
    .run(jobId, nodusId, status, status, JSON.stringify(model), updatedAt, updatedAt);
  const checkpoint = (jobId, key) => db.prepare(
    'INSERT INTO document_index_checkpoints(job_id,checkpoint_key,content_hash,payload_json,updated_at) VALUES(?,?,?,?,?)'
  ).run(jobId, key, 'h', '{}', now);
  const checkpointsOf = (jobId) => db.prepare('SELECT COUNT(*) n FROM document_index_checkpoints WHERE job_id = ?').get(jobId).n;
  const enqueue = (nodusId, model) => repo.enqueueDocumentIndexJob({
    vaultId: 'v', nodusId, campaignId: null, priority: 0, reason: 'test', generatorModel: model, auditorModel: null,
  });

  job('w2-failed', 'w2', 'failed', modelA, '2026-01-01T00:00:00.000Z');
  checkpoint('w2-failed', 'section:1');
  job('w2-done', 'w2', 'completed', modelA, '2026-01-02T00:00:00.000Z');
  assert.equal(checkpointsOf(enqueue('w2', modelA).jobId), 0, 'a failed job superseded by a success hands nothing on');

  job('w3-failed', 'w3', 'failed', modelA, '2026-01-01T00:00:00.000Z');
  checkpoint('w3-failed', 'section:1');
  assert.equal(checkpointsOf(enqueue('w3', modelA).jobId), 1, 'an unsuperseded failure still resumes with the same model');

  job('w4-failed', 'w4', 'failed', modelA, '2026-01-01T00:00:00.000Z');
  checkpoint('w4-failed', 'section:1');
  assert.equal(checkpointsOf(enqueue('w4', modelB).jobId), 0, 'checkpoints never carry over to another model');

  repo.clearWorkDocumentCheckpoints('w3');
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM document_index_checkpoints c JOIN document_index_jobs j USING(job_id)
    WHERE j.nodus_id = 'w3'`).get().n, 0, 'a published profile clears every job of the work');

  // ── 3. Section page range across attachments ───────────────────────────────
  const profileAi = require(path.join(repoRoot, 'electron/ai/documentProfile.ts'));
  const words = (n) => Array.from({ length: n }, (_, i) => `palabra${i}`).join(' ');
  const text = [
    '[[src:s1 p.1103]]', '# Capítulo final', words(60),
    '[[src:s1 p.1104]]', words(60),
    '[[src:s2 p.12]]', words(60),
    '# Apéndice', words(60),
  ].join('\n');
  const sections = profileAi.deriveDocumentStructure(text, 'Libro', { s1: 'fileA', s2: 'fileB' });
  const crossing = sections.find((section) => section.title === 'Capítulo final');
  assert.ok(crossing, 'the crossing section exists');
  assert.equal(crossing.sourceRef, 'fileA');
  assert.equal(crossing.pageStartNumber, 1103);
  assert.equal(crossing.pageEndNumber, 1104, 'the end page stays inside the section\'s own attachment');

  // ── 4. The passage a support points at ─────────────────────────────────────
  const quote = 'La adición electrofílica al doble enlace sigue la regla de Markovnikov en condiciones estándar';
  const row = (text_, sourceRef, pageNumber) => ({ text: text_, pageLabel: `p. ${pageNumber}`, sourceRef, pageNumber, embedding: null });
  const passages = {
    contentHash: 'h', embeddingProvider: 'nodus', embeddingModel: 'm',
    rows: [
      // Shares every long word with the quote but is not it: the old overlap pick.
      row('regla adición electrofílica doble enlace Markovnikov condiciones estándar sigue', 'fileA', 40),
      row(`Texto previo. ${quote}. Texto posterior.`, 'fileB', 300),
      row(`Introducción. ${quote}. Más texto.`, 'fileA', 301),
    ],
  };
  assert.equal(
    profileAi.passageForQuote('w1', quote, { label: 'p. 301', sourceRef: 'fileA', pageNumber: 301 }, passages),
    'w1#2',
    'the passage containing the quote, in the quote\'s own source',
  );

  // ── 5. NUL bytes in extracted text ─────────────────────────────────────────
  const extractor = require(path.join(repoRoot, 'electron/extraction/textExtractor.ts'));
  const doc = extractor.combineSegments([{
    sourceRef: 'fileA', marker: 's1', origin: 'zotero', sourceType: 'pdf', zoteroLibraryId: null, attachmentKey: null,
    displayName: null, text: '[[p.1]] ab\u0000cd', contentHash: 'h', pageCount: 1, hasPageMarkers: true,
  }], null, true);
  assert.ok(!doc.text.includes('\u0000'), 'no NUL survives');
  assert.ok(doc.text.endsWith('ab cd'), 'the NUL becomes a space, keeping offsets');
  // The Library extractor (reader.md, and so the documentary index) cleans it too.
  const { LibraryDiskStore } = require(path.join(repoRoot, 'electron/library/libraryStorage.ts'));
  const { extractLibraryItem } = require(path.join(repoRoot, 'electron/library/libraryExtractionEngine.ts'));
  const store = new LibraryDiskStore(path.join(root, 'library'), 'nul-test');
  const folder = store.itemFolder('nul'); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'original.txt'), 'Primer párrafo con un nulo aquí:\u0000y el resto del texto sigue entero hasta el final.');
  const item = store.upsertItem({ id: 'local:nul', storageId: 'nul', source: 'local', metadata: { title: 'Nulo', itemType: 'book', creators: [], isbn: [], issn: [], tags: [] },
    collectionIds: [], attachments: [], files: { original: 'original.txt' }, extraction: { status: 'pending' } });
  const extracted = await extractLibraryItem({ item, store });
  const reader = fs.readFileSync(path.join(folder, extracted.item.files.reader), 'utf8');
  assert.ok(!reader.includes('\u0000'), 'no NUL reaches reader.md');
  assert.match(reader, /aquí: y el resto del texto sigue entero hasta el final\./, 'the text after it survives');

  console.log('OK: edges, checkpoints, section pages, support passages and NUL text all hold.');
} finally {
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  // The shared hooks (electron stub, @shared paths, .ts transpile incl. import.meta.url), with
  // the database module swapped for a stub over this test's scratch database.
  installSharedRuntimeHooks(userDataPath);
  const Module = require('node:module');
  const sharedResolve = Module._resolveFilename;
  const databaseStub = path.join(userDataPath, 'stub-database.cjs');
  fs.writeFileSync(databaseStub, 'exports.getDb = () => globalThis.__libraryIntegrityDb;\nexports.setVectorScanQuery = () => {};\n');
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    const resolved = sharedResolve.call(this, request, parent, isMain, options);
    return resolved === path.join(repoRoot, 'electron/db/database.ts') ? databaseStub : resolved;
  };
}
