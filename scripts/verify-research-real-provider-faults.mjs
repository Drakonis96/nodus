/** Real provider faults: DeepSeek and OpenRouter reject a revoked credential with
 * their own 401 responses (no inference is billed), then the isolated valid
 * credentials recover. Every request goes through the shared cost-reserving proxy
 * and ledger; failed requests keep their conservative reservation. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createResearchApp, writeSyntheticPdfs, addPdfItems, waitFor, inventoryOf } from './lib/research-app-harness.mjs';

const option = name => process.argv.find(argument => argument.startsWith(`--${name}=`))?.split('=')[1];
const campaignRoot = option('campaign-root'), credentials = option('credentials-root');
if (!campaignRoot || !credentials) throw new Error('--campaign-root and --credentials-root are required');
const ledgerFile = path.join(campaignRoot, 'artifacts/cost-ledger.json'), metricsFile = path.join(campaignRoot, 'artifacts/provider-metrics.jsonl');
const ledger = () => JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
const accounted = () => ledger().calls.reduce((sum, call) => sum + (call.actualUsd ?? call.maximumUsd), 0);
if (accounted() > 4.5) throw new Error('Budget guard: the shared ledger already exceeds USD 4.5');
const metricsSince = offset => fs.readFileSync(metricsFile, 'utf8').trim().split('\n').slice(offset).map(JSON.parse);
const lineCount = () => fs.readFileSync(metricsFile, 'utf8').trim().split('\n').length;
const harness = await createResearchApp({ realProvider: { campaignRoot } });
const report = { root: harness.root, proof: harness.proof, realProviders: ['api.deepseek.com', 'openrouter.ai'], ledgerBefore: { calls: ledger().calls.length, accountedUsd: accounted() }, phases: {}, completed: false };
const settle = promise => promise.then(value => ({ ok: true, value }), error => ({ ok: false, error: String(error?.message ?? error).slice(0, 300) }));
const summarize = rows => rows.map(row => `${row.provider}:${row.status ?? (row.failed ? 'failed' : '?')}`);
const chatInput = id => ({ model: { provider: 'deepseek', model: 'deepseek-flash' }, thinkingEffort: 'standard', messages: [{ role: 'user', content: 'Which marker closes a line on page 2 of the first document? Cite it.' }],
  selection: { notebookId: id, ideas: true, themes: true, contradictions: true, gaps: true, readingPath: false, authors: true, documents: false, passages: true, graph: true, graphParts: { ideaNodes: true, themeNodes: true, ideaEdges: true, authorGraph: true } } });
try {
  // Phase A: revoked credentials against the real endpoints.
  let { app, page } = await harness.launch();
  await harness.prepareProfile(page);
  await page.evaluate(async () => {
    await window.nodus.setApiKey('deepseek', 'sk-nodus-revoked-test-credential-0000000000');
    await window.nodus.setApiKey('openrouter', 'sk-or-v1-nodus-revoked-test-credential-000000000000000000000000');
    await window.nodus.updateSettings({ chatModel: { provider: 'deepseek', model: 'deepseek-flash' }, deepResearchModel: { provider: 'deepseek', model: 'deepseek-flash' },
      synthesisModel: { provider: 'deepseek', model: 'deepseek-flash' }, embeddingProvider: 'openrouter', embeddingModel: 'baai/bge-m3', chatReasoning: 'off' });
  });
  const ids = await addPdfItems(app, page, await writeSyntheticPdfs(harness.root, { documents: 1, pages: 2, prefix: 'REALFAULT' }));
  const notebook = await page.evaluate(ids => window.nodus.saveResearchNotebook({ name: 'Real faults', mode: 'fixed', sources: ids.map(id => ({ kind: 'library-item', id })), exclusions: [] }), ids);
  let offset = lineCount();
  await page.evaluate(ids => window.nodus.prepareResearchDocuments(ids), ids);
  const settled = await waitFor(async () => { const [document] = await inventoryOf(page, ids); return document.preparation.lexical === 'ready' && ['failed', 'missing'].includes(document.preparation.embeddings) && !['running', 'queued'].includes(document.preparation.status) && document; }, { timeoutMs: 120000 });
  await new Promise(resolve => setTimeout(resolve, 10000));
  const [prepared] = await inventoryOf(page, ids);
  const embeddingCalls = metricsSince(offset);
  report.phases.revokedEmbeddings = { preparation: { lexical: prepared.preparation.lexical, embeddings: prepared.preparation.embeddings, status: prepared.preparation.status, reason: prepared.preparation.reason, error: prepared.preparation.error }, providerResponses: summarize(embeddingCalls) };
  assert.ok(settled, 'preparation settles with text ready and no vectors');
  assert.ok(embeddingCalls.length > 0 && embeddingCalls.every(row => row.provider === 'openrouter'), 'only the configured embedding provider was contacted');
  assert.ok(embeddingCalls.some(row => row.status === 401), 'the real provider rejected the revoked credential');
  const lexical = await page.evaluate(id => window.nodus.searchResearchNotebook(id, 'REALFAULT1P2'), notebook.id);
  report.phases.revokedEmbeddings.lexicalSearchStillWorks = lexical.evidence.some(item => item.text.includes('REALFAULT1P2'));
  assert.ok(report.phases.revokedEmbeddings.lexicalSearchStillWorks);
  offset = lineCount();
  const chat = await settle(page.evaluate(input => window.nodus.researchChat(input), chatInput(notebook.id)));
  const chatCalls = metricsSince(offset);
  report.phases.revokedChat = { result: chat.ok ? { answer: chat.value.answer.slice(0, 200) } : chat, providerResponses: summarize(chatCalls) };
  assert.equal(chat.ok, false, 'a revoked credential yields an error, not an answer');
  // Retrieval first embeds the question (OpenRouter), then the chat model is called.
  const modelCalls = chatCalls.filter(row => row.provider === 'deepseek');
  assert.ok(chatCalls.every(row => row.status === 401), 'every real response is the authentication rejection');
  assert.ok(modelCalls.length >= 1 && modelCalls.length <= 2, 'an authentication failure is not retried beyond one attempt');
  offset = lineCount();
  const deep = await settle(page.evaluate(id => window.nodus.generateDeepResearchReport({ notebookId: id, objective: 'Summarize the markers per page.', deepResearchVersion: 'v2', approach: 'general',
    language: 'en', sectionLimit: 2, sectionLength: 200, model: { provider: 'deepseek', model: 'deepseek-flash' } }), notebook.id));
  const deepCalls = metricsSince(offset);
  report.phases.revokedDeepResearch = { result: deep.ok ? { completed: true, markdown: deep.value.draft.draftMarkdown.slice(0, 300), factualAudit: deep.value.meta.factualAudit ?? null, truncated: deep.value.draft.stats.truncated } : deep, providerResponses: summarize(deepCalls) };
  if (deep.ok) {
    assert.ok((deep.value.draft.claimLedger ?? []).every(claim => claim.status !== 'supported' || claim.kind === 'nonfactual'), 'no factual claim is accepted without a working model');
    assert.equal(deep.value.draft.stats.truncated, true);
  }
  assert.ok(deepCalls.every(row => row.status === 401 || row.provider === 'openrouter'), 'no model call succeeded with a revoked credential');
  await harness.closeApp();

  // Phase B: valid isolated credentials; the same profile recovers.
  report.credentials = await harness.importCredentials(credentials);
  ({ app, page } = await harness.launch());
  offset = lineCount();
  await page.evaluate(ids => window.nodus.prepareResearchDocuments(ids), ids);
  const ready = await waitFor(async () => (await inventoryOf(page, ids))[0].preparation.embeddings === 'ready', { timeoutMs: 120000 });
  report.phases.recoveredEmbeddings = { ready: !!ready, providerResponses: summarize(metricsSince(offset)) };
  assert.ok(ready, 'vectors complete with the valid credential');
  offset = lineCount();
  const answer = await settle(page.evaluate(input => window.nodus.researchChat(input), chatInput(notebook.id)));
  report.phases.recoveredChat = { result: answer.ok ? { answer: answer.value.answer.slice(0, 400), cited: /nodus:\/\/passage\//.test(answer.value.answer) } : answer, providerResponses: summarize(metricsSince(offset)) };
  assert.ok(answer.ok && report.phases.recoveredChat.result.cited, 'the same notebook answers with a citation after recovery');
  report.completed = true;
} finally {
  await harness.close();
  report.ledgerAfter = { calls: ledger().calls.length, accountedUsd: accounted(), unresolved: ledger().calls.filter(call => call.actualUsd == null).length };
  fs.writeFileSync(path.join(harness.root, 'artifacts/real-provider-faults.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ root: harness.root, completed: report.completed, phases: report.phases, ledgerBefore: report.ledgerBefore, ledgerAfter: report.ledgerAfter }));
}
