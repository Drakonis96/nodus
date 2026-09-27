/** Real Electron: SIGKILL while embedding batches are in flight, then relaunch.
 * Simulated embedding upstream behind the real proxy (the proxy outlives the
 * killed application); nothing leaves the machine. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createResearchApp, simulatedUpstream, writeSyntheticPdfs, addPdfItems, waitFor, inventoryOf } from './lib/research-app-harness.mjs';

const embedded = [];
const upstream = simulatedUpstream(provider => {
  if (provider !== 'openrouter') return null;
  return { hangMs: 700 };
});
const recordInputs = upstream.dispatch;
upstream.dispatch = async (url, init) => {
  const body = JSON.parse(Buffer.from(init.body).toString('utf8'));
  if (url.includes('openrouter')) embedded.push(...(Array.isArray(body.input) ? body.input : [body.input]));
  return recordInputs(url, init);
};
const harness = await createResearchApp({ provider: upstream });
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
const store = path.join(harness.root, 'profile/documentary/store.sqlite');
// The batch table is created with the first batch; before that nothing is outstanding.
const live = query => { try { return JSON.parse(execFileSync('/usr/bin/sqlite3', ['-readonly', '-json', store, query], { stdio: ['ignore', 'pipe', 'ignore'] }).toString() || '[]'); } catch { return []; } };
const report = { root: harness.root, proof: harness.proof, simulatedUpstream: true, completed: false };
try {
  let { app, page } = await harness.launch();
  await harness.prepareProfile(page);
  await harness.simulatedKeys(page);
  const ids = await addPdfItems(app, page, await writeSyntheticPdfs(harness.root, { documents: 3, pages: 80, prefix: 'EMBKILL' }));
  await page.evaluate(ids => window.nodus.prepareResearchDocuments(ids), ids);
  // Kill once some vectors are stored and a batch is outstanding.
  const armed = await waitFor(async () => {
    const docs = await inventoryOf(page, ids);
    const requested = fs.existsSync(store) ? (live("SELECT COUNT(*) n FROM documentary_embedding_attempts WHERE state='requested'")[0]?.n ?? 0) : 0;
    return docs.some(document => document.preparation.embedded > 0) && docs.some(document => document.preparation.embeddings !== 'ready') && requested > 0 && docs;
  }, { timeoutMs: 180000, intervalMs: 100 });
  assert.ok(armed, 'kill point reached with stored vectors and an outstanding batch');
  report.killPoint = { documents: armed.map(document => ({ embedded: document.preparation.embedded, passages: document.preparation.passages, embeddings: document.preparation.embeddings })),
    attempts: live('SELECT state,COUNT(*) n FROM documentary_embedding_attempts GROUP BY state'), inputsSentBeforeKill: embedded.length };
  const processes = await app.evaluate(({ app }) => app.getAppMetrics().map(metric => metric.pid));
  const mainPid = app.process().pid;
  process.kill(mainPid, 'SIGKILL');
  await new Promise(resolve => app.process().exitCode !== null || app.process().signalCode ? resolve() : app.process().once('exit', resolve));
  const orphans = await waitFor(async () => { const left = processes.filter(alive); return left.length === 0 ? [] : null; }, { timeoutMs: 15000 });
  report.orphansAfterKill = orphans ?? processes.filter(alive);
  assert.deepEqual(report.orphansAfterKill, []);
  const lock = path.join(harness.root, 'profile/isolated-instance.lock');
  assert.equal(Number(fs.readFileSync(lock, 'utf8')), mainPid);
  fs.unlinkSync(lock);
  const inputsAtKill = embedded.length;

  ({ app, page } = await harness.launch());
  const ready = await waitFor(async () => (await inventoryOf(page, ids)).every(document => document.preparation.embeddings === 'ready'), { timeoutMs: 300000 });
  const after = await inventoryOf(page, ids);
  report.afterRestart = after.map(document => ({ embedded: document.preparation.embedded, passages: document.preparation.passages, embeddings: document.preparation.embeddings }));
  assert.ok(ready, 'embeddings resume and complete after relaunch without user action');
  const notebook = await page.evaluate(ids => window.nodus.saveResearchNotebook({ name: 'Embedding kill', mode: 'fixed', sources: ids.map(id => ({ kind: 'library-item', id })), exclusions: [] }), ids);
  const hit = await page.evaluate(id => window.nodus.searchResearchNotebook(id, 'EMBKILL2P40'), notebook.id);
  report.searchAfterRestart = hit.evidence.some(item => item.text.includes('EMBKILL2P40'));
  assert.ok(report.searchAfterRestart);
  await harness.app.close(); harness.app = null;
  const copy = path.join(harness.root, 'artifacts/embedding-kill-store.sqlite');
  for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(store + suffix)) fs.copyFileSync(store + suffix, copy + suffix);
  const sql = query => JSON.parse(execFileSync('/usr/bin/sqlite3', ['-json', copy, query]).toString() || '[]');
  const passages = after.reduce((sum, document) => sum + document.preparation.passages, 0);
  const documentInputs = embedded.filter(text => !/^EMBKILL\d+P\d+$/.test(text));
  const repeated = documentInputs.length - new Set(documentInputs).size;
  report.store = { passages, inputsBeforeKill: inputsAtKill, inputsTotal: documentInputs.length, reembeddedInputs: repeated,
    attempts: sql('SELECT state,COUNT(*) n FROM documentary_embedding_attempts GROUP BY state'), requests: sql("SELECT state,attempts,error FROM documentary_requests"),
    vectorsMissing: sql('SELECT COUNT(*) n FROM documentary_passages p JOIN documentary_revisions r ON r.index_key=p.index_key WHERE r.embedding_ready=1 AND p.vector_json IS NULL')[0].n };
  assert.equal(report.store.vectorsMissing, 0, 'every published vector passage has its vector');
  assert.ok(report.store.requests.every(row => row.state !== 'running'), 'no request keeps a dead lease');
  // Only batches outstanding at the kill may be sent twice (their outcome was unknown).
  const outstanding = report.killPoint.attempts.find(row => row.state === 'requested')?.n ?? 0;
  report.store.outstandingBatchesAtKill = outstanding;
  assert.ok(repeated <= outstanding * 64, 'at most the outstanding batches are re-sent');
  report.completed = true;
} finally {
  await harness.close();
  fs.writeFileSync(path.join(harness.root, 'artifacts/embedding-kill.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ root: harness.root, completed: report.completed, killPoint: report.killPoint, afterRestart: report.afterRestart, store: report.store && { ...report.store, requests: undefined } }));
}
