/** Real Electron: durable preparation survives an abrupt process kill.
 * Text-only preparation, no provider credentials and no model calls. The whole
 * process tree runs under the inherited OS boundary proven before the first launch. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { _electron } from 'playwright-core';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createResearchTestRoot, macResearchSandbox, researchTestEnvironment, verifyResearchSandbox } from './research-isolation.mjs';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(import.meta.dirname, '..');
const root = createResearchTestRoot();
const sandbox = macResearchSandbox(root);
const proof = verifyResearchSandbox(root, sandbox);
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
fs.writeFileSync(path.join(root, 'isolation.sb'), sandbox);
const wrapper = path.join(root, 'electron-isolated');
fs.writeFileSync(wrapper, `#!/bin/sh\nexec /usr/bin/sandbox-exec -f ${quote(path.join(root, 'isolation.sb'))} ${quote(require('electron'))} "$@"\n`, { mode: 0o700 });
const store = path.join(root, 'profile/documentary/store.sqlite');
const sql = query => JSON.parse(execFileSync('/usr/bin/sqlite3', ['-readonly', '-json', store, query]).toString() || '[]');
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
const report = { root, proof, modelCalls: 0, completed: false };
const option = name => process.argv.find(argument => argument.startsWith(`--${name}=`))?.split('=')[1];
const DOCUMENTS = 4, PAGES = Number(option('pages') ?? 250);
// Baseline without the crash, to separate recovery defects from fixture defects.
const KILL = !process.argv.includes('--no-kill');
report.options = { documents: DOCUMENTS, pages: PAGES, kill: KILL };

async function launch() {
  const app = await _electron.launch({ executablePath: wrapper, args: ['--no-sandbox', '--disable-gpu', repoRoot], cwd: root, env: researchTestEnvironment(root), timeout: 60000 });
  const page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length), null, { timeout: 60000 });
  return { app, page };
}
const inventory = async (page, ids) => (await page.evaluate(() => window.nodus.getResearchPreparationInventory())).documents.filter(document => ids.includes(document.id));

let app, page;
try {
  ({ app, page } = await launch());
  await page.evaluate(async root => {
    await window.nodus.setResearchPreparationPolicy({ welcomeVersion: 1, decision: 'declined' });
    await window.nodus.updateSettings({ autoLightScan: false, autoDeepScanOnReadTag: false, autoSummaryAfterDeep: false, autoBridgeAfterQueue: false,
      autoBackupFolder: `${root}/library`, onboardingComplete: true, basicsTutorialVersion: 99, recoverySetupVersion: 999, tourComplete: true,
      advancedTourComplete: true, uiLanguage: 'es', mascotEnabled: false, mascotStyleChosen: true, reduceMotion: true });
  }, root);
  const files = [];
  for (let index = 0; index < DOCUMENTS; index++) {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    // Distinct prose on every page: identical templated lines in the same position
    // are removed as running headers, which would leave nothing to extract.
    let seed = index + 1;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const words = ['archive', 'measurement', 'field', 'survey', 'record', 'river', 'harvest', 'ledger', 'north', 'season', 'witness', 'parcel',
      'boundary', 'inspection', 'granary', 'village', 'census', 'weather', 'tithe', 'mill', 'estate', 'register', 'orchard', 'valley'];
    for (let number = 1; number <= PAGES; number++) {
      const lines = Array.from({ length: 30 }, () => Array.from({ length: 9 }, () => words[Math.floor(random() * words.length)]).join(' ') + '.');
      // The marker sits inside varying prose, not in a repeated header position.
      lines[1 + Math.floor(random() * 28)] += ` Marker RECOVERY${index + 1}P${number} closes this line.`;
      pdf.addPage().drawText(lines.join('\n'), { x: 30, y: 760, size: 8, lineHeight: 12, font });
    }
    const filename = path.join(root, 'fixtures', `recovery-${index + 1}.pdf`);
    fs.writeFileSync(filename, await pdf.save());
    files.push(filename);
  }
  const ids = [];
  for (const filename of files) {
    await app.evaluate(({ dialog }, filename) => { globalThis.recoveryOpenDialog ??= dialog.showOpenDialog; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }); }, filename);
    ids.push(await page.evaluate(async title => {
      const item = await window.nodus.createGlobalLibraryItem({ title, itemType: 'report', creators: [] }, []);
      await window.nodus.addGlobalLibraryAttachments(item.id);
      return item.id;
    }, path.basename(filename, '.pdf')));
  }
  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = globalThis.recoveryOpenDialog; });
  await page.evaluate(ids => window.nodus.prepareResearchDocuments(ids), ids);
  if (KILL) {
  // Kill while work is demonstrably in flight: at least one request is running
  // and at least one document is still unpublished.
  let before;
  const armed = Date.now() + 120000;
  do {
    before = await inventory(page, ids);
    const running = fs.existsSync(store) && sql("SELECT COUNT(*) n FROM documentary_requests WHERE state='running'")[0].n > 0;
    if (running && before.some(document => document.preparation.lexical !== 'ready')) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < armed);
  const inFlight = sql("SELECT document_id,state,attempts FROM documentary_requests");
  assert.ok(inFlight.some(row => row.state === 'running'), 'a preparation request is running at the kill point');
  assert.ok(before.some(document => document.preparation.lexical !== 'ready'), 'at least one document is unpublished at the kill point');
  const processes = await app.evaluate(({ app }) => app.getAppMetrics().map(metric => ({ pid: metric.pid, type: metric.type, serviceName: metric.serviceName ?? null })));
  const mainPid = app.process().pid;
  report.killPoint = { published: before.filter(document => document.preparation.lexical === 'ready').length, requests: inFlight, processes };
  process.kill(mainPid, 'SIGKILL');
  await new Promise(resolve => app.process().exitCode !== null || app.process().signalCode ? resolve() : app.process().once('exit', resolve));
  const orphanDeadline = Date.now() + 15000;
  let orphans;
  do {
    orphans = processes.filter(item => alive(item.pid));
    if (!orphans.length) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  } while (Date.now() < orphanDeadline);
  report.orphansAfterKill = orphans;
  assert.deepEqual(orphans, [], 'no owned helper or utility process survives the killed application');
  app = null;
  // The isolated QA profile lock fails closed after a crash by design; its owning
  // harness may discard it only once the recorded owner is proven dead.
  const lock = path.join(root, 'profile/isolated-instance.lock');
  const owner = Number(fs.readFileSync(lock, 'utf8'));
  assert.equal(owner, mainPid, 'the stale lock belongs to the killed application');
  assert.equal(alive(owner), false);
  fs.unlinkSync(lock);
  report.staleIsolatedLockDiscarded = { owner, alive: false };

  ({ app, page } = await launch());
  }
  const deadline = Date.now() + 300000;
  let after;
  do {
    after = await inventory(page, ids);
    if (after.every(document => document.preparation.lexical === 'ready')) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  } while (Date.now() < deadline);
  report.afterRestart = after.map(document => ({ id: document.id, lexical: document.preparation.lexical, status: document.preparation.status, passages: document.preparation.passages, reason: document.preparation.reason ?? null }));
  assert.ok(after.every(document => document.preparation.lexical === 'ready'), 'interrupted and queued documents finish after restart without user action');
  const notebook = await page.evaluate(ids => window.nodus.saveResearchNotebook({ name: 'Recovery', mode: 'fixed', sources: ids.map(id => ({ kind: 'library-item', id })), exclusions: [] }), ids);
  const lastPages = [];
  for (let index = 0; index < DOCUMENTS; index++) {
    const marker = `RECOVERY${index + 1}P${PAGES}`;
    const search = await page.evaluate(input => window.nodus.searchResearchNotebook(input.id, input.marker), { id: notebook.id, marker });
    const hit = search.evidence.find(item => item.text.includes(marker));
    assert.ok(hit, `${marker}: the final page of every document is searchable`);
    // The citation must cover the marker's physical page (a chunk may start on the previous one).
    assert.ok(hit.locator.pageNumber <= PAGES && (hit.locator.pageEnd ?? hit.locator.pageNumber) >= PAGES, `${marker}: the citation covers page ${PAGES}`);
    assert.match(hit.locator.pageLabel, new RegExp(`\\b${PAGES}$`), `${marker}: the visible page label names page ${PAGES}`);
    lastPages.push({ marker, pageNumber: hit.locator.pageNumber, pageEnd: hit.locator.pageEnd ?? null, pageLabel: hit.locator.pageLabel });
  }
  report.lastPages = lastPages;
  await app.close(); app = null;
  // Store invariants after the process tree has exited, read from a copy: a
  // read-only WAL database cannot create its shared-memory file.
  const copy = path.join(root, 'artifacts/store-after-restart.sqlite');
  for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(store + suffix)) fs.copyFileSync(store + suffix, copy + suffix);
  const copied = query => JSON.parse(execFileSync('/usr/bin/sqlite3', ['-json', copy, query]).toString() || '[]');
  const requests = copied("SELECT document_id,state,lease_token,attempts,error FROM documentary_requests WHERE document_id NOT LIKE 'embedding:%'");
  const heads = copied('SELECT document_id,attachment_id,current_key,desired_key FROM documentary_attachment_heads');
  const published = copied('SELECT document_id,COUNT(*) n FROM documentary_revisions WHERE lexical_ready=1 GROUP BY document_id');
  const duplicates = copied('SELECT index_key,COUNT(*) n FROM documentary_passages GROUP BY index_key,ordinal HAVING n>1');
  report.store = { requests, heads, published, duplicatePassages: duplicates.length };
  assert.ok(requests.every(row => row.state !== 'running' && row.lease_token === null), 'no request keeps a dead owner lease');
  assert.ok(requests.every(row => row.attempts <= 2), 'a crash consumes at most the interrupted attempt');
  for (const id of ids) {
    assert.equal(published.find(row => row.document_id === id)?.n, 1, `${id}: exactly one published lexical revision`);
    const head = heads.filter(row => row.document_id === id);
    assert.equal(head.length, 1);
    assert.equal(head[0].current_key, head[0].desired_key, `${id}: the published head matches the desired revision`);
  }
  assert.equal(duplicates.length, 0, 'resumed extraction writes no duplicate passage ordinals');
  report.completed = true;
} finally {
  if (app) await app.close().catch(() => undefined);
  fs.writeFileSync(path.join(root, 'artifacts/queue-recovery.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ root, completed: report.completed, proof, killPoint: report.killPoint && { published: report.killPoint.published, requests: report.killPoint.requests.length }, orphans: report.orphansAfterKill?.length }));
}
