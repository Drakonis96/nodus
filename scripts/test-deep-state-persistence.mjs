import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
if (!process.argv.includes('--electron-deep-state-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-deep-state-persistence.mjs'), '--electron-deep-state-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-deep-state-'));
installRuntimeHooks(root);
let closeDb = () => undefined;
try {
  const database = require(path.join(repoRoot, 'electron/db/database.ts'));
  const works = require(path.join(repoRoot, 'electron/db/worksRepo.ts'));
  const ideas = require(path.join(repoRoot, 'electron/db/ideasRepo.ts'));
  const passages = require(path.join(repoRoot, 'electron/db/passagesRepo.ts'));
  closeDb = database.closeDb;
  const db = database.getDb();
  db.prepare(`INSERT INTO works (
    nodus_id,zotero_key,title,authors_json,item_type,source_type,light_status,deep_status,
    deep_hash,summary_status,archived,notes
  ) VALUES ('w1','Z1','Obra','[]','book','pdf','done','done','old-hash','none',0,'nota anterior')`).run();
  db.prepare("INSERT INTO ideas (global_id,type,label,statement,created_at) VALUES ('g-test','claim','idea','idea anterior',?)").run(new Date().toISOString());
  db.prepare("INSERT INTO idea_occurrences (global_id,nodus_id,role,development,confidence) VALUES ('g-test','w1','principal','anterior',1)").run();

  works.setResolvedTextState('w1', {
    sourceType: 'epub', textHash: 'new-hash', textChars: 500, sourceCount: 1,
    hasPageMarkers: false, blockReason: null, notes: null, resolvedAt: '2026-01-01T00:00:00.000Z',
    sources: [{ nodus_id: 'w1', source_ref: 'zotero:user:0:A', origin: 'local_attachment', source_type: 'epub', zotero_library_id: '0', attachment_key: 'A', display_name: 'a.epub', content_hash: 'a', char_count: 500, page_count: null, has_page_markers: 0, ordinal: 0, active: 1, resolved_at: '2026-01-01T00:00:00.000Z' }],
  });
  let row = db.prepare('SELECT * FROM works WHERE nodus_id=?').get('w1');
  assert.equal(row.source_type, 'pdf', 'resolution never rewrites the committed analysis source');
  assert.equal(row.deep_hash, 'old-hash');
  assert.equal(row.resolved_source_type, 'epub');

  works.setSummaryResult('w1', 'failed', 'summary-hash', 'provider exploded');
  row = db.prepare('SELECT summary_status, summary_error FROM works WHERE nodus_id=?').get('w1');
  assert.equal(row.summary_status, 'failed');
  assert.equal(row.summary_error, 'provider exploded', 'summary failures retain the actionable provider reason');
  works.setSummaryPending('w1');
  row = db.prepare('SELECT summary_status, summary_error FROM works WHERE nodus_id=?').get('w1');
  assert.equal(row.summary_status, 'pending');
  assert.equal(row.summary_error, null, 'retrying clears the obsolete failure reason');
  works.setSummaryResult('w1', 'done', 'summary-hash');
  assert.equal(db.prepare('SELECT summary_error FROM works WHERE nodus_id=?').get('w1').summary_error, null);

  passages.replaceWorkPassages('w1', 'old-hash', [{ text: 'pasaje de la versión anterior', pageLabel: 'p. 1', sourceRef: 'zotero:user:0:A', pageNumber: 1, embedding: [1, 0] }]);
  assert.equal(passages.embeddedPassageCount(), 0, 'retrieval excludes passages whose hash differs from resolved text');
  assert.equal(passages.getPassageDetail('w1#0'), null, 'a stale passage cannot be recovered directly');
  const stalePassages = passages.workPassageStatuses(['w1'])[0];
  assert.equal(stalePassages.status, 'outdated');
  assert.equal(stalePassages.outdatedReason, 'text_changed', 'the UI must not blame an unchanged embedding model');
  assert.equal(works.listWorks({ statusFlags: ['passages'] }).length, 0, 'advanced work filters do not count stale passages');
  assert.equal(works.listWorks({ statusFlags: ['!passages'] })[0].nodus_id, 'w1');

  works.setDeepPending('w1');
  works.setDeepResult('w1', 'failed', null, null, 'fallo nuevo');
  row = db.prepare('SELECT * FROM works WHERE nodus_id=?').get('w1');
  assert.equal(row.deep_hash, 'old-hash');
  assert.equal(row.source_type, 'pdf');
  assert.equal(row.notes, 'nota anterior');
  assert.equal(row.deep_error, 'fallo nuevo');
  assert.equal(row.deep_status, 'done', 'a failed replacement attempt keeps the committed graph visible');
  assert.equal(db.prepare("SELECT COUNT(*) count FROM idea_occurrences WHERE nodus_id='w1'").get().count, 1);

  assert.throws(() => db.transaction(() => {
    ideas.purgeDeepData('w1');
    throw new Error('fault after purge');
  })());
  assert.equal(db.prepare("SELECT COUNT(*) count FROM idea_occurrences WHERE nodus_id='w1'").get().count, 1, 'transaction rollback restores the previous analysis');

  works.setDeepResult('w1', 'done', 'new-hash', 'epub', null);
  row = db.prepare('SELECT * FROM works WHERE nodus_id=?').get('w1');
  assert.equal(row.deep_hash, 'new-hash');
  assert.equal(row.source_type, 'epub');
  assert.equal(row.notes, null);
  assert.equal(row.deep_error, null);

  works.setResolvedTextState('w1', {
    sourceType: 'pdf', textHash: 'third-hash', textChars: 700, sourceCount: 1,
    hasPageMarkers: true, blockReason: null, notes: null, resolvedAt: '2026-01-02T00:00:00.000Z',
    sources: [{ nodus_id: 'w1', source_ref: 'zotero:user:0:B', origin: 'local_attachment', source_type: 'pdf', zotero_library_id: '0', attachment_key: 'B', display_name: 'b.pdf', content_hash: 'b', char_count: 700, page_count: 2, has_page_markers: 1, ordinal: 0, active: 1, resolved_at: '2026-01-02T00:00:00.000Z' }],
  });
  assert.equal(db.prepare("SELECT active FROM work_text_sources WHERE nodus_id='w1' AND source_ref='zotero:user:0:A'").get().active, 0, 'old evidence source remains addressable');
  assert.equal(db.prepare("SELECT active FROM work_text_sources WHERE nodus_id='w1' AND source_ref='zotero:user:0:B'").get().active, 1);

  db.prepare(`INSERT INTO works (
    nodus_id,zotero_key,title,authors_json,archived,resolved_text_hash
  ) VALUES ('race','ZR','Race','[]',0,'race-hash'), ('fill','ZF','Fill','[]',0,NULL)`).run();
  passages.replaceWorkPassages('race', 'race-hash', [{
    text: 'candidate that becomes stale between vector windows', pageLabel: 'p. 4',
    sourceRef: 'zotero:user:0:R', pageNumber: 4, embedding: [1, 0],
  }]);
  const filler = db.prepare(`INSERT INTO passages (
    passage_id,nodus_id,chunk_index,text,page_label,char_len,content_hash,created_at
  ) VALUES (?,?,?,?,?,?,?,?)`);
  db.transaction(() => {
    for (let index = 0; index < 1_600; index += 1) {
      filler.run(`fill#${index}`, 'fill', index, 'filler', null, 6, 'fill-hash', '2026-01-02T00:00:00.000Z');
    }
  })();
  const mutateBeforeNextWindow = new Promise((resolve) => setImmediate(() => {
    db.prepare("UPDATE works SET resolved_text_hash='replacement-hash' WHERE nodus_id='race'").run();
    passages.replaceWorkPassages('race', 'replacement-hash', [{
      text: 'replacement text under the same stable passage id', pageLabel: 'p. 9',
      sourceRef: 'zotero:user:0:R2', pageNumber: 9, embedding: [-1, 0],
    }]);
    resolve();
  }));
  const raced = await passages.findSimilarPassagesPaged([1, 0], -1, 10, { nodusIds: ['race'] });
  await mutateBeforeNextWindow;
  assert.deepEqual(raced, [], 'paged vector materialization cannot attach an old score to a reindexed stable passage id');

  // --- A queued rescan outlives the process, and a failed one stays retriable ---------
  // The queue lives in memory only: resumePending() reading the database IS the entire
  // restart story. Since a rescan of an already-analysed work deliberately keeps
  // deep_status='done', deep_queued is the only trace a restart can find. The worker
  // loop is neutralised so this exercises that bookkeeping without running a scan.
  const queue = require(path.join(repoRoot, 'electron/pipeline/scanQueue.ts')).scanQueue;
  Object.getPrototypeOf(queue).run = async () => undefined;
  const deepItemsFor = (nodusId) => queue.snapshot().items.filter((item) => item.nodus_id === nodusId && item.kind === 'deep');

  db.prepare(`INSERT INTO works (
    nodus_id,zotero_key,title,authors_json,item_type,source_type,light_status,deep_status,
    deep_hash,summary_status,archived,read_tag,manual_deep
  ) VALUES ('degraded','ZD','Degradada','[]','book','abstract_only','done','done','deg-hash','none',0,0,0)`).run();
  queue.enqueue('degraded', 'Degradada', 'deep');
  let degraded = db.prepare("SELECT * FROM works WHERE nodus_id='degraded'").get();
  assert.equal(degraded.deep_status, 'done', 'enqueueing a rescan never hides the committed analysis');
  assert.equal(degraded.deep_queued, 1, 'the queued marker is the only thing a restart can see');

  queue.items.length = 0; // the process dies: the in-memory queue goes with it
  queue.resumePending();
  assert.equal(deepItemsFor('degraded').length, 1, 'a rescan of an analysed work is re-enqueued after a restart');

  // Finishing the JOB is what drops the marker — process() marks the item terminal and
  // then asks the queue. setDeepResult deliberately does not, because an abandoned scan
  // writes one too (see below).
  works.setDeepResult('degraded', 'done', 'deg-hash-2', 'pdf', null);
  queue.items.find((item) => item.nodus_id === 'degraded' && item.kind === 'deep').state = 'done';
  queue.syncDeepQueued('degraded');
  assert.equal(db.prepare("SELECT deep_queued FROM works WHERE nodus_id='degraded'").get().deep_queued, 0);
  queue.items.length = 0;
  queue.resumePending();
  assert.equal(deepItemsFor('degraded').length, 0, 'a finished rescan is not resumed forever');

  // Cancelling is not crashing: an abandoned job must drop its marker too.
  queue.enqueue('degraded', 'Degradada', 'deep');
  queue.stopAll();
  assert.equal(db.prepare("SELECT deep_queued FROM works WHERE nodus_id='degraded'").get().deep_queued, 0);
  queue.resumePending();
  assert.equal(deepItemsFor('degraded').length, 0, 'a cancelled rescan is not resurrected');

  // Stopping a running job must keep it visible until its already-accepted provider
  // operation settles. This prevents hidden work and also prevents a duplicate scan of
  // the same paper from starting while the original is still alive.
  queue.enqueue('degraded', 'Degradada', 'deep');
  const stopping = queue.snapshot().items.find((item) => item.nodus_id === 'degraded' && item.kind === 'deep');
  queue.items.find((item) => item.id === stopping.id).state = 'running';
  queue.removeItem(stopping.id);
  assert.equal(db.prepare("SELECT deep_queued FROM works WHERE nodus_id='degraded'").get().deep_queued, 1,
    'the marker remains while the accepted operation remains visible');
  queue.enqueue('degraded', 'Degradada', 'deep');
  assert.equal(deepItemsFor('degraded').length, 1, 'a stopping operation blocks a duplicate for the same paper');
  works.setDeepResult('degraded', 'done', 'deg-hash-3', 'pdf', null); // the accepted scan lands
  assert.equal(db.prepare("SELECT deep_queued FROM works WHERE nodus_id='degraded'").get().deep_queued, 1,
    'publishing the result cannot hide the still-settling operation');
  queue.items = queue.items.filter((item) => item.id !== stopping.id); // process() removes it after settlement
  queue.syncDeepQueued('degraded');
  assert.equal(db.prepare("SELECT deep_queued FROM works WHERE nodus_id='degraded'").get().deep_queued, 0,
    'the marker drops only after the accepted operation really settles');
  queue.enqueue('degraded', 'Degradada', 'deep');
  queue.items.length = 0;
  queue.resumePending();
  assert.equal(deepItemsFor('degraded').length, 1, 'a later replacement rescan still survives a restart');
  queue.stopAll();

  // A failed replacement keeps deep_status='done' so the old graph stays readable; the
  // Library still counts it as failed (deep_error), so the retry action must find it —
  // but only within the eligibility it always had, or every historical failure (including
  // the ones migration 160 backfilled from notes) would become a full-library rescan.
  db.prepare("UPDATE works SET manual_deep=1 WHERE nodus_id='degraded'").run();
  queue.enqueue('degraded', 'Degradada', 'deep');
  works.setDeepResult('degraded', 'failed', null, null, 'truncado');
  db.prepare(`INSERT INTO works (
    nodus_id,zotero_key,title,authors_json,archived,read_tag,manual_deep,deep_status,deep_error
  ) VALUES ('untagged','ZU','Sin marcar','[]',0,0,0,'done','fallo antiguo')`).run();
  queue.items.length = 0;
  queue.retryFailed();
  const retried = db.prepare("SELECT * FROM works WHERE nodus_id='degraded'").get();
  assert.equal(deepItemsFor('degraded').length, 1, 'retrying failures re-enqueues a work whose failure is recorded in deep_error');
  assert.equal(retried.deep_error, null, 'the retry clears the previous error');
  assert.equal(retried.deep_status, 'done', 'retrying never hides the analysis the failure preserved');
  assert.equal(retried.deep_hash, 'deg-hash-3', 'and never drops it');
  assert.equal(deepItemsFor('untagged').length, 0, 'a work that was never read-tagged or marked stays out of the retry');
  queue.stopAll();

  // Migration 162 dropped the cascading key, so a merge that forgot this table would
  // leak the duplicate's inventory rows on every new database.
  const dedupe = require(path.join(repoRoot, 'electron/db/dedupe.ts'));
  db.prepare(`INSERT INTO works (nodus_id,zotero_key,title,authors_json,archived) VALUES ('dup','ZDUP','Duplicada','[]',0)`).run();
  works.setResolvedTextState('dup', {
    sourceType: 'pdf', textHash: 'dup-hash', textChars: 10, sourceCount: 1,
    hasPageMarkers: true, blockReason: null, notes: null, resolvedAt: '2026-01-03T00:00:00.000Z',
    sources: [{ nodus_id: 'dup', source_ref: 'zotero:user:0:D', origin: 'local_attachment', source_type: 'pdf', zotero_library_id: '0', attachment_key: 'D', display_name: 'd.pdf', content_hash: 'd', char_count: 10, page_count: 1, has_page_markers: 1, ordinal: 0, active: 1, resolved_at: '2026-01-03T00:00:00.000Z' }],
  });
  dedupe.mergeWorks(db, 'w1', ['dup']);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM work_text_sources WHERE nodus_id='dup'").get().count, 0,
    'merging a duplicate takes its text inventory with it');

  // A marker must not outlive the work's visibility: archived works are invisible to
  // both resume branches, and a graph reset wipes the analysis the marker belonged to.
  works.setDeepPending('degraded');
  works.setArchived('degraded', true);
  assert.equal(db.prepare("SELECT deep_queued FROM works WHERE nodus_id='degraded'").get().deep_queued, 0,
    'archiving drops the queued marker instead of leaving it dormant');
  works.setArchived('degraded', false);
  works.setDeepPending('degraded');
  ideas.resetGraphData();
  assert.equal(db.prepare("SELECT deep_queued FROM works WHERE nodus_id='degraded'").get().deep_queued, 0,
    'resetting the graph clears the queued marker with the analysis');

  // The upload path scans outside the queue, so nothing else can clear its marker.
  const uploadHandler = fs.readFileSync(path.join(repoRoot, 'electron/ipc/academic.ts'), 'utf8');
  const uploadStart = uploadHandler.indexOf("h('works:uploadText'");
  const uploadBody = uploadHandler.slice(uploadStart, uploadHandler.indexOf("\n  h('", uploadStart));
  assert.match(uploadBody, /finally\s*\{[^}]*scanQueue\.syncDeepQueued\(nodusId\)/,
    'works:uploadText settles the queued marker through the queue even when its scan throws');

  // Fusion falls back to lexical matching whenever no embedding is available — no
  // embedding provider configured, no key, exhausted quota. The ideas table allows a
  // null statement and a real 14,612-idea vault holds six of them, so that fallback used
  // to throw on the first one and take the whole scan down with it, for every work.
  const fusion = require(path.join(repoRoot, 'electron/ai/fusion.ts'));
  db.prepare("INSERT INTO ideas (global_id,type,label,statement,created_at) VALUES ('g-null','claim','idea sin enunciado',NULL,?)")
    .run(new Date().toISOString());
  const plan = await fusion.planIdeaFusion(
    { localId: 'nueva', type: 'claim', label: 'tema completamente distinto', statement: 'Un enunciado sin relación con nada del corpus.' },
    { embedding: null, model: null },
  );
  assert.equal(plan.existingId, null, 'the lexical fallback survives an idea whose statement is null');

  // Everything above drives the queue's public surface. The marker is cleared by the
  // JOB's terminal branch inside process(), so run that for real — with the scan itself
  // stubbed, since this is about bookkeeping, not about analysing anything.
  const proto = Object.getPrototypeOf(queue);
  proto.chainAfterDeep = () => undefined;
  db.prepare("UPDATE works SET archived=0, deep_queued=0 WHERE nodus_id='degraded'").run();

  proto.doDeep = async () => works.setDeepResult('degraded', 'done', 'deg-hash-4', 'pdf', null);
  queue.items.length = 0;
  queue.enqueue('degraded', 'Degradada', 'deep');
  await queue.process(queue.items.find((item) => item.nodus_id === 'degraded' && item.kind === 'deep'));
  assert.equal(db.prepare("SELECT deep_queued FROM works WHERE nodus_id='degraded'").get().deep_queued, 0,
    'a finished job drops its own marker from inside process()');

  proto.doDeep = async () => { throw new Error('boom'); };
  queue.items.length = 0;
  queue.enqueue('degraded', 'Degradada', 'deep');
  await queue.process(queue.items.find((item) => item.nodus_id === 'degraded' && item.kind === 'deep'));
  const afterFailure = db.prepare("SELECT deep_queued, deep_status, deep_error FROM works WHERE nodus_id='degraded'").get();
  assert.equal(afterFailure.deep_queued, 0, 'a failed job drops its marker too');
  assert.equal(afterFailure.deep_status, 'done', 'and still does not hide the committed analysis');
  assert.equal(afterFailure.deep_error, 'boom');

  // Cancelling and clearing are list mutations like any other: a work whose deep_status
  // stays 'done' has nothing but the marker to record that its job is gone.
  for (const stop of ['cancelItem', 'clear']) {
    queue.items.length = 0;
    queue.enqueue('degraded', 'Degradada', 'deep');
    if (stop === 'cancelItem') queue.cancelItem(queue.items.find((item) => item.nodus_id === 'degraded').id);
    else queue.clear();
    assert.equal(db.prepare("SELECT deep_queued FROM works WHERE nodus_id='degraded'").get().deep_queued, 0,
      `${stop} drops the marker of the job it removed`);
    queue.items.length = 0;
    queue.resumePending();
    assert.equal(deepItemsFor('degraded').length, 0, `${stop} is not undone by the next launch`);
  }
} finally {
  try { closeDb(); } catch {}
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return {
      app: { getPath: () => userDataPath, getVersion: () => '0.0.0-test', getAppPath: () => repoRoot, isPackaged: false },
      safeStorage: { isEncryptionAvailable: () => false, encryptString: (value) => Buffer.from(String(value)), decryptString: (value) => Buffer.from(value).toString() },
      dialog: {}, shell: {}, BrowserWindow: class {}, ipcMain: { handle: () => undefined, on: () => undefined },
    };
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true, skipLibCheck: true },
    }).outputText;
    module._compile(output, filename);
  };
}
