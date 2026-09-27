/** Real Electron + real providers + disposable Zotero. Public web access is
 * intentional; the OS still forbids writes outside the disposable root and reads
 * of production Nodus/Zotero data. Every paid call uses the campaign ledger. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { _electron } from 'playwright-core';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createResearchApp, addPdfItems, reserveLoopbackPort, waitFor, repoRoot } from './lib/research-app-harness.mjs';
import { launchIndependentZotero } from './lib/independent-zotero.mjs';
import { researchTestEnvironment } from './research-isolation.mjs';
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const campaign = arg('campaign-root');
const credentials = arg('credentials-root');
if (!campaign || !credentials) throw new Error('Pass --campaign-root and --credentials-root (isolated credentials only)');
const out = path.resolve(arg('out') ?? 'artifacts/dictionary-research');
fs.mkdirSync(out, { recursive: true });
const ledgerFile = path.join(campaign, 'artifacts/cost-ledger.json');
const ledgerTotal = () => JSON.parse(fs.readFileSync(ledgerFile)).calls.reduce((sum, c) => sum + (c.actualUsd ?? c.maximumUsd), 0);
const before = ledgerTotal();
assert.ok(before + 0.5 < 5, 'campaign must retain at least $0.50 under the $5 user limit');
fs.writeFileSync(path.join(out, 'electron.log'), '');
const calls = [];
const dispatch = async (url, init) => {
  const body = JSON.parse(Buffer.from(init.body).toString());
  const started = Date.now();
  const response = await fetch(url, init);
  const json = await response.clone().json().catch(() => null);
  calls.push({ provider: url.includes('deepseek') ? 'deepseek' : 'openrouter', model: body.model, status: response.status,
    thinking: body.thinking, effort: body.reasoning_effort, system: body.messages?.[0]?.content?.slice(0, 100),
    finishReason: json?.choices?.[0]?.finish_reason, usage: json?.usage, durationMs: Date.now() - started });
  fs.writeFileSync(path.join(out, 'calls.json'), JSON.stringify(calls, null, 2));
  return response;
};
const port = await reserveLoopbackPort();
const harness = await createResearchApp({ realProvider: { campaignRoot: campaign, dispatch }, extraPorts: [port] });
const root = harness.root;
const report = { root, campaign, before, network: 'Live public web enabled; production profile reads and external writes remain denied', calls };
fs.writeFileSync(path.join(out, 'running.json'), JSON.stringify(report, null, 2));
const originalPolicy = fs.readFileSync(path.join(root, 'isolation.sb'), 'utf8');
const webPolicy = originalPolicy.replace('(deny network-outbound)\n', '');
fs.writeFileSync(path.join(root, 'web-isolation.sb'), webPolicy);
const require = createRequire(import.meta.url);
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const wrapper = path.join(root, 'electron-web-isolated');
fs.writeFileSync(wrapper, `#!/bin/sh\nexec /usr/bin/sandbox-exec -f ${quote(path.join(root, 'web-isolation.sb'))} ${quote(require('electron'))} "$@"\n`, { mode: 0o700 });
const model = { provider: 'deepseek', model: 'deepseek-flash' };
const texts = [
  'Rotational irrigation distributes water through scheduled turns. In the synthetic Sarbela archive, each farm received one day of water every eleven days. This schedule coordinated access to a shared canal and made scarcity predictable.',
  'Rotational irrigation in the synthetic Sarbela Nodus record reduced the irrigation turn from eleven days to seven in 1786. This change increased the frequency of access to the shared canal. The record describes allocation by time rather than by private ownership of water.',
  'Rotational irrigation in the synthetic Sarbela Zotero record used a public register to assign irrigation days. The register helped settle disputes between farms. This report defines a water turn as the time during which one farm could divert canal water.',
];
const files = [];
for (let i = 0; i < texts.length; i++) {
  const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica);
  const lines = texts[i].match(/.{1,78}(?:\s|$)/g);
  pdf.addPage([612, 792]).drawText(lines.join('\n') + '\n\nSynthetic source for software verification only.', { x: 40, y: 710, size: 11, font, lineHeight: 18 });
  const file = path.join(root, 'fixtures', `Rotational irrigation ${i + 1}.pdf`);
  fs.writeFileSync(file, await pdf.save()); files.push(file);
}
let zotero, app, moved;
try {
  await harness.importCredentials(credentials);
  zotero = await launchIndependentZotero({ root, port, policy: originalPolicy, records: [{ title: 'Rotational irrigation Zotero original', abstract: '', file: files[2], sha256: createHash('sha256').update(fs.readFileSync(files[2])).digest('hex') }] });
  app = await _electron.launch({ executablePath: wrapper, args: ['--no-sandbox', repoRoot], cwd: root, timeout: 60000,
    env: { ...researchTestEnvironment(root), NODUS_TEST_USERDATA: path.join(root, 'profile'), NODUS_ZOTERO_API_BASE: zotero.endpoint, NODUS_RESEARCH_PROVIDER_PROXY: harness.proxy.url } });
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.nodus && !!document.getElementById('root')?.children.length);
  app.process().stdout?.on('data', chunk => fs.appendFileSync(path.join(out, 'electron.log'), chunk));
  app.process().stderr?.on('data', chunk => fs.appendFileSync(path.join(out, 'electron.log'), chunk));
  await harness.prepareProfile(page, { dictionaryModel: model, chatModel: model, documentProfileModel: model, documentAuditModel: model,
    synthesisModel: model, extractionModel: model, embeddingProvider: 'openrouter', embeddingModel: 'baai/bge-m3',
    chatReasoning: 'off', promptLanguage: 'en', uiLanguage: 'en', syncMode: 'manual', autoResumeQueue: false, documentIndexingEnabled: false });
  await page.evaluate(() => window.nodus.setResearchPreparationPolicy({ welcomeVersion: 1, decision: 'declined', futureAdditions: false }));
  const ids = await addPdfItems(app, page, files.slice(0, 2));
  const imported = await page.evaluate(async () => {
    const libraries = await window.nodus.listZoteroImportLibraries();
    await window.nodus.importZoteroLibrary('dictionary-test', { libraryIds: libraries.map(l => l.id), copyAttachments: true, fullRefresh: true });
    return window.nodus.getResearchPreparationInventory();
  });
  const zdoc = imported.documents.find(d => d.origin.kind === 'zotero'); assert.ok(zdoc);
  ids.push(zdoc.id);
  await page.evaluate(async ids => {
    const vault = await window.nodus.getActiveVault();
    await window.nodus.linkGlobalLibraryItemsToVault(ids, vault.id);
  }, ids);
  const inventory = await page.evaluate(() => window.nodus.getResearchPreparationInventory());
  const documents = inventory.documents.filter(d => ids.includes(d.id));
  assert.equal(documents.length, 3);
  assert.ok(documents.every(d => d.workId));
  report.documents = documents;
  // Only the first work is indexed. The other two must be read as originals.
  await page.evaluate(ids => window.nodus.prepareResearchDocuments(ids), [ids[0]]);
  assert.ok(await waitFor(async () => (await page.evaluate(() => window.nodus.getResearchPreparationInventory())).documents.find(d => d.id === ids[0])?.preparation?.status === 'ready', { timeoutMs: 180000 }), 'indexed work ready');
  await page.evaluate(async workId => {
    const idea = await window.nodus.createManualIdea({ folderId: null, title: 'Rotational irrigation' });
    await window.nodus.saveManualIdea({ globalId: idea.globalId, noteId: idea.note.id, title: 'Rotational irrigation',
      summary: 'Rotational irrigation allocates shared water by scheduled turns.', works: [{ nodusId: workId, development: 'Allocation of canal access by time.' }],
      evidence: [{ nodusId: workId, quote: 'Rotational irrigation distributes water through scheduled turns.', location: '1' }], connections: [] });
  }, documents.find(d => d.id === ids[0]).workId);
  // Force Zotero's original-document reader, rather than its owned Nodus copy.
  const local = await page.evaluate(id => window.nodus.getGlobalLibraryItem(id), zdoc.id);
  const attachment = local.attachments.find(a => a.sourceKey === zotero.corpus.items[0].attachment.key);
  moved = path.join(root, 'library/nodus-library', encodeURIComponent(local.storageId).replaceAll('.', '%2E'), attachment.relativePath);
  assert.ok(fs.realpathSync(moved).startsWith(root + path.sep)); fs.renameSync(moved, moved + '.held');
  await page.evaluate(() => {
    localStorage.setItem('nodus.lastSeenVersion', '5.6.0');
    for (const key of ['nodus.mobileTeaserSeen.3.2.4', 'nodus.platformHighlightsSeen.2026-07', 'nodus.tutorialVideosAnnouncementSeen.2026-07', 'nodus.pdfPresenterTutorialSeen.e2js_u-05OA', 'nodus.toolkitBetaGuideSeen.2.4.0']) localStorage.setItem(key, '1');
  });
  await page.reload();
  const whatsNew = page.locator('.whats-new-close');
  if (await whatsNew.isVisible()) await whatsNew.click();
  await page.locator('[data-tour="nav-dictionary"]').click();
  await page.getByTestId('dictionary-new').waitFor();
  await page.getByTestId('dictionary-thinking').first().click();
  const slider = page.locator('.research-effort-panel input[type=range]');
  assert.equal(await slider.getAttribute('max'), '2', 'only the three advertised DeepSeek levels');
  assert.equal(await slider.inputValue(), '0', 'new model starts at native low');
  await page.screenshot({ path: path.join(out, 'dictionary-thinking.png') });
  await slider.press('Escape');
  await page.getByTestId('dictionary-new').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByTestId('dictionary-thinking').waitFor();
  assert.equal(await dialog.getByTestId('dictionary-thinking').count(), 1, 'creation dialog shares the native selector');
  assert.equal(await dialog.getByTestId('dictionary-web').count(), 1, 'creation dialog exposes web choice');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  const entry = await page.evaluate(() => window.nodus.createDictionaryEntry({ name: 'Rotational irrigation', aliases: ['water turns'],
    focusPrompt: 'Define the concept using the library, explain the synthetic Sarbela example, and search the web for an independent definition of rotational irrigation. Keep each claim atomic.',
    scope: { kind: 'vault' }, outputLanguage: 'en', detailLevel: 'concise', tags: [] }));
  const started = Date.now();
  await page.evaluate(({ id, model }) => {
    window.dictionaryEvents = [];
    window.nodus.onDictionaryProgress(e => { if (e.entryId === id) window.dictionaryEvents.push(e); });
    return window.nodus.startDictionaryGeneration({ entryId: id, mode: 'creation', model, thinkingEffort: 'low', webSearch: 'auto' });
  }, { id: entry.id, model });
  await page.getByText('Rotational irrigation', { exact: true }).first().click();
  await page.getByTestId('research-activity').waitFor();
  await page.screenshot({ path: path.join(out, 'dictionary-active.png') });
  const result = await waitFor(async () => {
    const jobs = await page.evaluate(() => window.nodus.listDictionaryGenerationJobs());
    const job = jobs.find(j => j.entryId === entry.id);
    return job && ['done', 'degraded', 'failed'].includes(job.phase) ? job : null;
  }, { timeoutMs: 300000 });
  report.result = result; report.durationMs = Date.now() - started;
  report.events = await page.evaluate(() => window.dictionaryEvents);
  report.detail = await page.evaluate(id => window.nodus.getDictionaryEntry(id), entry.id);
  report.evidence = await page.evaluate(id => window.nodus.listDictionaryEvidence({ entryId: id, offset: 0, limit: 200 }), entry.id);
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  assert.equal(result?.phase, 'done', JSON.stringify(result));
  assert.equal(report.detail.currentVersion.outcome, 'synthesis');
  const evidence = report.evidence.items;
  assert.ok(evidence.some(e => e.kind === 'idea'), 'ideas consulted');
  assert.ok(evidence.some(e => e.id.startsWith('documentary:')), 'indexed documentary evidence');
  for (const d of documents.filter(d => d.id !== ids[0])) assert.ok(evidence.some(e => e.id.startsWith('scoped:') && e.workId === d.workId), `original read: ${d.title}`);
  assert.ok(evidence.some(e => e.id.startsWith('web:')), 'live web evidence retained');
  assert.ok(evidence.every(e => !e.unavailable), 'all retained citations resolve');
  assert.ok(calls.some(c => c.provider === 'deepseek' && c.effort === 'low'), 'native thinking transmitted');
  assert.ok(calls.every(c => c.status === 200), 'no provider errors');
  assert.ok(calls.every(c => !/^(length|max_tokens|max_output_tokens)$/.test(c.finishReason ?? '')), 'no truncated model output with native low thinking');
  assert.doesNotMatch(fs.readFileSync(path.join(out, 'electron.log'), 'utf8'), /JSON retry.*status=error|structured reply (?:is not JSON|rejected by its guard)/, 'no malformed structured output');
  assert.ok(evidence.filter(e => e.kind === 'passage' && !e.id.startsWith('web:')).every(e => e.decision === 'included'), 'web passages preserve representation of library works');
  assert.ok(report.detail.currentVersion.citations.some(c => c.id.startsWith('web:')), 'saved definition cites live web evidence');
  // The Evidence tab stayed mounted during retrieval: completion must refresh it.
  const webLabel = evidence.find(e => e.id.startsWith('web:')).label;
  await page.getByText(webLabel, { exact: true }).first().waitFor();
  await page.getByText(webLabel, { exact: true }).first().click();
  await page.getByTestId('source-citation-web-passage').waitFor();
  await page.screenshot({ path: path.join(out, 'dictionary-web-citation.png') });
  await page.getByTestId('source-citation-close').click();
  report.citationModal = true;
  const excluded = evidence.find(e => e.id.startsWith('scoped:'));
  await page.evaluate(({ id, ref }) => window.nodus.setDictionaryEvidenceDecision(id, [{ kind: 'passage', id: ref }], 'excluded'), { id: entry.id, ref: excluded.id });
  const scanStart = calls.length;
  await page.evaluate(({ id, model }) => window.nodus.scanDictionaryNewEvidence(id, { model, thinkingEffort: 'low', webSearch: 'off' }), { id: entry.id, model });
  const afterScan = await page.evaluate(id => window.nodus.listDictionaryEvidence({ entryId: id, offset: 0, limit: 200 }), entry.id);
  assert.ok(afterScan.items.filter(e => e.workId === excluded.workId && e.sourceRevision === excluded.sourceRevision).every(e => e.decision === 'excluded'), 'new investigation preserves explicit exclusions');
  assert.ok(calls.slice(scanStart).every(c => !/web searches|search results|evidence passages/.test(c.system ?? '')), 'web-off scan makes no web planning calls');
  report.scan = { exclusionPreserved: true, webOff: true, calls: calls.length - scanStart };
  await page.evaluate(({ id, ref }) => window.nodus.setDictionaryEvidenceDecision(id, [{ kind: 'passage', id: ref }], 'included'), { id: entry.id, ref: excluded.id });
  await page.getByText('Overview', { exact: true }).click();
  await page.screenshot({ path: path.join(out, 'dictionary-result.png') });
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setMinimumSize(600, 600); win.setContentSize(800, 900); });
  await page.waitForFunction(() => window.innerWidth === 800);
  await page.screenshot({ path: path.join(out, 'dictionary-800.png') });
  report.layout = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  assert.equal(report.layout.width, 800, 'Electron really resized to 800px');
  assert.ok(report.layout.scroll <= report.layout.width + 1, 'Dictionary fits an 800px window');
  report.passed = true;
} catch (error) { report.error = String(error.stack ?? error); throw error; }
finally {
  if (moved && fs.existsSync(moved + '.held')) fs.renameSync(moved + '.held', moved);
  report.after = ledgerTotal(); report.costUsd = report.after - before;
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  if (report.passed && process.argv.includes('--keep-open')) {
    await app.evaluate(({ app, BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(1280, 900); win.show(); win.focus(); app.focus({ steal: true }); });
    console.log(JSON.stringify({ ready: true, root, passed: true, costUsd: report.costUsd }));
    await new Promise(resolve => app.once('close', resolve));
  }
  if (app) await app.close().catch(() => undefined);
  if (zotero) await zotero.stop();
  await harness.close();
  console.log(JSON.stringify({ root, passed: report.passed ?? false, costUsd: report.costUsd, error: report.error }));
}
