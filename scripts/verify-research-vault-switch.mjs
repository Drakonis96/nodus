/** Real Electron: switching vaults while academic Research work is in flight.
 * Simulated upstream behind the real proxy; no request leaves the machine. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createResearchApp, simulatedUpstream, writeSyntheticPdfs, addPdfItems, waitFor, inventoryOf } from './lib/research-app-harness.mjs';

// The first model call of each case is held until the test has switched vaults.
let gate = null;
const arm = () => { let release; const held = new Promise(resolve => { release = resolve; }); let reached; const hit = new Promise(resolve => { reached = resolve; }); gate = { held, release, hit, reached }; return gate; };
let slowEmbeddings = false;
const upstream = simulatedUpstream(async provider => {
  if (provider === 'deepseek' && gate) { const current = gate; gate = null; current.reached(); await current.held; }
  if (provider === 'openrouter' && slowEmbeddings) return { hangMs: 1500 };
  return null;
});
const harness = await createResearchApp({ provider: upstream });
const report = { root: harness.root, proof: harness.proof, simulatedUpstream: true, cases: {}, completed: false };
const settle = promise => promise.then(value => ({ ok: true, value }), error => ({ ok: false, error: String(error?.message ?? error) }));
try {
  const { app, page } = await harness.launch();
  await harness.prepareProfile(page);
  await harness.simulatedKeys(page);
  const vaultA = await page.evaluate(() => window.nodus.getActiveVault());
  assert.equal(vaultA.type, 'academic');
  const vaultB = await page.evaluate(() => window.nodus.createVault({ name: 'Switch target', type: 'academic', aiModel: { provider: 'deepseek', model: 'deepseek-flash' }, embeddingProvider: 'openrouter', embeddingModel: 'baai/bge-m3' }));
  const bId = vaultB.id ?? vaultB.vault?.id;
  assert.ok(bId, 'second academic vault created');
  const ids = await addPdfItems(app, page, await writeSyntheticPdfs(harness.root, { documents: 2, pages: 3, prefix: 'SWITCH' }));
  await page.evaluate(async ({ ids, vault }) => window.nodus.linkGlobalLibraryItemsToVault(ids, vault), { ids, vault: vaultA.id });
  await page.evaluate(ids => window.nodus.prepareResearchDocuments(ids), ids);
  assert.ok(await waitFor(async () => (await inventoryOf(page, ids)).every(document => document.preparation.embeddings === 'ready')), 'vault A prepared');
  const notebook = await page.evaluate(ids => window.nodus.saveResearchNotebook({ name: 'Switch notebook', mode: 'fixed', sources: ids.map(id => ({ kind: 'library-item', id })), exclusions: [] }), ids);
  const switchTo = id => page.evaluate(id => window.nodus.switchVault(id), id);
  const active = () => page.evaluate(() => window.nodus.getActiveVault().then(vault => vault.id));

  // (a) Research Chat: the switch lands while the model call is outstanding.
  let current = arm();
  const chat = settle(page.evaluate(id => window.nodus.researchChat({ model: { provider: 'deepseek', model: 'deepseek-flash' }, thinkingEffort: 'standard',
    messages: [{ role: 'user', content: 'Which marker closes a line on page 2 of the first document?' }],
    selection: { notebookId: id, ideas: true, themes: true, contradictions: true, gaps: true, readingPath: false, authors: true, documents: false, passages: true, graph: true,
      graphParts: { ideaNodes: true, themeNodes: true, ideaEdges: true, authorGraph: true } } }), notebook.id));
  await current.hit;
  const chatSwitch = await switchTo(bId);
  current.release();
  const chatResult = await chat;
  report.cases.researchChat = { switch: chatSwitch, result: chatResult.ok ? { answer: chatResult.value.answer?.slice(0, 300) } : chatResult, activeAfter: await active() };
  if (chatSwitch.ok) {
    assert.equal(chatResult.ok, false, 'a chat whose vault changed mid-request must not return an answer');
    assert.match(chatResult.error, /research_scope_changed|scope/i);
  }
  const bSources = await page.evaluate(() => window.nodus.getResearchCorpusSources());
  // The Global Library is shared by design; vault A's links must not follow it.
  const inB = bSources.documents.filter(document => ids.includes(document.id));
  report.cases.researchChat.vaultBView = inB.map(document => ({ id: document.id, workId: document.workId }));
  assert.ok(inB.every(document => document.workId === null), 'in vault B the shared items are unlinked global documents');
  await switchTo(vaultA.id);

  // (b) Deep Research: a report in flight either blocks the switch or aborts on scope.
  current = arm();
  const deep = settle(page.evaluate(id => window.nodus.generateDeepResearchReport({ notebookId: id, objective: 'Summarize the markers per page.',
    deepResearchVersion: 'v2', approach: 'general', language: 'en', sectionLimit: 2, sectionLength: 200, model: { provider: 'deepseek', model: 'deepseek-flash' } }), notebook.id));
  await current.hit;
  const deepSwitch = await switchTo(bId);
  current.release();
  if (deepSwitch.ok) {
    const deepResult = await deep;
    report.cases.deepResearch = { switch: deepSwitch, result: deepResult.ok ? { title: deepResult.value.draft?.title } : deepResult };
    assert.equal(deepResult.ok, false, 'a report whose vault changed mid-run must not complete');
    await switchTo(vaultA.id);
  } else {
    report.cases.deepResearch = { switch: deepSwitch, refused: true };
    assert.match(deepSwitch.message, /Deep Research/);
    upstream.cancelAll = true;
    const deepResult = await deep;
    report.cases.deepResearch.result = deepResult.ok ? { completed: true } : deepResult;
  }
  assert.equal(await active(), vaultA.id);

  // (c) Preparation owned by A continues after the UI moves to B, writing nothing into B.
  const more = await addPdfItems(app, page, await writeSyntheticPdfs(harness.root, { documents: 3, pages: 40, prefix: 'OWNED' }));
  await page.evaluate(async ({ ids, vault }) => window.nodus.linkGlobalLibraryItemsToVault(ids, vault), { ids: more, vault: vaultA.id });
  slowEmbeddings = true;
  await page.evaluate(ids => window.nodus.prepareResearchDocuments(ids), more);
  await waitFor(async () => (await inventoryOf(page, more)).some(document => document.preparation.lexical === 'ready'), { timeoutMs: 60000 });
  const before = (await inventoryOf(page, more)).map(document => `${document.preparation.lexical}/${document.preparation.embeddings}`);
  const prepSwitch = await switchTo(bId);
  report.cases.preparation = { before, switch: prepSwitch };
  if (prepSwitch.ok) {
    const bView = await page.evaluate(() => window.nodus.getResearchPreparationInventory());
    const moreInB = bView.documents.filter(document => more.includes(document.id));
    report.cases.preparation.vaultBView = moreInB.map(document => ({ workId: document.workId, preparation: `${document.preparation.lexical}/${document.preparation.embeddings}` }));
    assert.ok(moreInB.every(document => document.workId === null), 'vault B does not acquire vault A links during the owned preparation');
    await new Promise(resolve => setTimeout(resolve, 8000));
    await switchTo(vaultA.id);
  }
  slowEmbeddings = false;
  const after = await waitFor(async () => { const docs = await inventoryOf(page, more); return docs.every(document => document.preparation.embeddings === 'ready') && docs; }, { timeoutMs: 180000 });
  report.cases.preparation.after = (after || await inventoryOf(page, more)).map(document => `${document.preparation.lexical}/${document.preparation.embeddings}/${document.preparation.reason ?? ''}`);
  assert.ok(after, 'owned preparation completes for vault A across the switch');
  // Vault B's own database must not have acquired A's works.
  await switchTo(bId);
  const bLinked = await page.evaluate(() => window.nodus.getResearchCorpusSources().then(sources => sources.documents.filter(document => document.workId).length));
  report.cases.preparation.vaultBLinkedDocumentsAtEnd = bLinked;
  assert.equal(bLinked, 0, 'vault B database acquired no works from vault A');
  report.upstreamCalls = upstream.calls.length;
  report.completed = true;
} finally {
  await harness.close();
  fs.writeFileSync(path.join(harness.root, 'artifacts/vault-switch.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ root: harness.root, completed: report.completed, cases: Object.fromEntries(Object.entries(report.cases).map(([key, value]) => [key, { switch: value.switch?.ok ?? value.switch, result: value.result?.error ?? (value.result ? 'returned' : undefined) }])) }));
}
