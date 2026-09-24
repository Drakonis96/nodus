/** Real Electron against a simulated provider outage behind the real proxy.
 * No request leaves the machine; faults are deterministic. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createResearchApp, simulatedUpstream, writeSyntheticPdfs, addPdfItems, waitFor, inventoryOf } from './lib/research-app-harness.mjs';

const FAULTS = [
  { status: 429, json: { error: { message: 'rate limited (simulated)', type: 'rate_limit' } } },
  { status: 500, json: { error: { message: 'upstream failure (simulated)' } } },
  { status: 200, text: '{"object":"list","data":[{"embedding":' },
  { throw: true },
];
let mode = { openrouter: 'ok', deepseek: 'ok' };
const upstream = simulatedUpstream((provider, _body, call) => {
  if (mode[provider] === 'fault') return FAULTS[call.index % FAULTS.length];
  if (mode[provider] === '500') return FAULTS[1];
  // One fault on the first model call of a request; later calls (retries) succeed.
  if (mode[provider] === 'single' && upstream.single) { const fault = upstream.single; upstream.single = null; return fault; }
  if (provider === 'deepseek' && mode.deepseek === 'single') return { content: citedAnswer(_body) };
  return null;
});
/** A recovered model answers by citing a passage it was actually given. */
function citedAnswer(body) {
  const text = body.messages.map(message => message.content).join('\n');
  const link = text.match(/nodus:\/\/passage\/[^\s)\]"'<>]+/)?.[0];
  return link ? `The requested marker appears in the supplied evidence ([source](${link})).` : 'No evidence was supplied.';
}
const harness = await createResearchApp({ provider: upstream });
const report = { root: harness.root, proof: harness.proof, simulatedUpstream: true, faults: FAULTS.map(fault => fault.throw ? 'connection error' : `${fault.status}${fault.text ? ' malformed body' : ''}`), cases: {}, completed: false };
const settle = promise => promise.then(value => ({ ok: true, value }), error => ({ ok: false, error: String(error?.message ?? error) }));
const count = provider => upstream.calls.filter(call => call.provider === provider).length;
try {
  const { app, page } = await harness.launch();
  await harness.prepareProfile(page);
  await harness.simulatedKeys(page);
  const ids = await addPdfItems(app, page, await writeSyntheticPdfs(harness.root, { documents: 2, pages: 3, prefix: 'FAULT' }));
  const notebook = await page.evaluate(ids => window.nodus.saveResearchNotebook({ name: 'Fault notebook', mode: 'fixed', sources: ids.map(id => ({ kind: 'library-item', id })), exclusions: [] }), ids);

  // (a) Embedding outage: text stays searchable, failure is bounded and recoverable.
  mode = { openrouter: 'fault', deepseek: 'ok' };
  await page.evaluate(ids => window.nodus.prepareResearchDocuments(ids), ids);
  // While retries are pending the state must say so, never "failed".
  const retryStates = new Set();
  const failed = await waitFor(async () => {
    const docs = await inventoryOf(page, ids);
    for (const document of docs) retryStates.add(`${document.preparation.embeddings}/${document.preparation.reason ?? ''}`);
    return docs.every(document => document.preparation.lexical === 'ready' && document.preparation.embeddings === 'failed') && docs;
  }, { timeoutMs: 300000, intervalMs: 200 });
  const failedState = (failed || await inventoryOf(page, ids)).map(document => ({ lexical: document.preparation.lexical, embeddings: document.preparation.embeddings, reason: document.preparation.reason, status: document.preparation.status }));
  const atTerminalState = count('openrouter');
  // Calls must stop: wait for 30 s without any provider request (bounded retries).
  let last = count('openrouter'), quietSince = Date.now();
  const quiet = await waitFor(async () => { const now = count('openrouter'); if (now !== last) { last = now; quietSince = Date.now(); } return Date.now() - quietSince >= 30000; }, { timeoutMs: 180000, intervalMs: 1000 });
  report.cases.embeddingOutage = { observedStates: [...retryStates], state: failedState, callsAtTerminalState: atTerminalState, totalCallsAfterQuiescence: count('openrouter'),
    otherProviderCalls: count('deepseek'), retryPolicy: 'three request attempts; each with up to two server retries and rate-limit waits; malformed bodies bisect the batch' };
  assert.ok(failed, 'every document reaches a terminal failed embedding state with its text ready');
  assert.ok(failedState.every(state => state.reason === 'provider_failed'), 'the failure is attributed to the provider');
  assert.ok(quiet, 'provider calls stop once the bounded attempts are exhausted');
  assert.equal(count('deepseek'), 0, 'an embedding outage never falls back to another provider');
  const lexical = await page.evaluate(id => window.nodus.searchResearchNotebook(id, 'FAULT1P2'), notebook.id);
  report.cases.embeddingOutage.lexicalHit = lexical.evidence.some(item => item.text.includes('FAULT1P2'));
  assert.ok(report.cases.embeddingOutage.lexicalHit, 'prepared text stays searchable during the outage');
  mode = { openrouter: 'ok', deepseek: 'ok' };
  await page.evaluate(ids => window.nodus.prepareResearchDocuments(ids), ids);
  const recovered = await waitFor(async () => (await inventoryOf(page, ids)).every(document => document.preparation.embeddings === 'ready'), { timeoutMs: 120000 });
  report.cases.embeddingOutage.recoveredByExplicitRetry = !!recovered;
  assert.ok(recovered, 'an explicit retry after recovery completes the vectors');

  // (b) Chat model outage: each fault is reported, nothing hangs, no silent answer.
  const chat = question => settle(page.evaluate(({ id, question }) => window.nodus.researchChat({ model: { provider: 'deepseek', model: 'deepseek-flash' }, thinkingEffort: 'standard',
    messages: [{ role: 'user', content: question }], selection: { notebookId: id, ideas: true, themes: true, contradictions: true, gaps: true, readingPath: false, authors: true,
      documents: false, passages: true, graph: true, graphParts: { ideaNodes: true, themeNodes: true, ideaEdges: true, authorGraph: true } } }), { id: notebook.id, question }));
  report.cases.chatOutage = [];
  for (const [label, fault] of [['429', FAULTS[0]], ['500', FAULTS[1]], ['malformed', FAULTS[2]], ['connection', FAULTS[3]]]) {
    mode = { openrouter: 'ok', deepseek: 'single' };
    const before = count('deepseek');
    upstream.single = fault;
    const started = Date.now();
    const result = await chat('Which marker closes a line on page 2 of the first document?');
    report.cases.chatOutage.push({ fault: label, ok: result.ok, error: result.error?.slice(0, 240) ?? null, answer: result.ok ? result.value.answer?.slice(0, 200) : null,
      modelCalls: count('deepseek') - before, seconds: Math.round((Date.now() - started) / 1000) });
  }
  mode = { openrouter: 'ok', deepseek: 'ok' };
  for (const entry of report.cases.chatOutage) {
    assert.ok(entry.modelCalls >= 2, `${entry.fault}: the transient failure is retried`);
    assert.ok(entry.ok && /nodus:\/\/passage\//.test(entry.answer), `${entry.fault}: the retried request recovers with a cited answer`);
  }

  // Persistent chat outage: a bounded number of calls, then an explicit error.
  mode = { openrouter: 'ok', deepseek: '500' };
  const beforeDead = count('deepseek');
  const dead = await chat('Which marker closes a line on page 2 of the first document?');
  report.cases.chatPersistentOutage = { ok: dead.ok, error: dead.error?.slice(0, 240) ?? null, modelCalls: count('deepseek') - beforeDead };
  assert.equal(dead.ok, false, 'a dead model provider yields an error, not an answer');
  assert.ok(report.cases.chatPersistentOutage.modelCalls <= 12, 'retries are bounded');

  // (c) Deep Research with a dead model provider fails closed.
  mode = { openrouter: 'ok', deepseek: '500' };
  const deep = await settle(page.evaluate(id => window.nodus.generateDeepResearchReport({ notebookId: id, objective: 'Summarize the markers per page.',
    deepResearchVersion: 'v2', approach: 'general', language: 'en', sectionLimit: 2, sectionLength: 200, model: { provider: 'deepseek', model: 'deepseek-flash' } }), notebook.id));
  report.cases.deepResearchOutage = deep.ok ? { completed: true, title: deep.value.draft.title, markdown: deep.value.draft.draftMarkdown.slice(0, 600),
    factualAudit: deep.value.meta.factualAudit ?? null, truncated: deep.value.draft.stats.truncated } : { completed: false, error: deep.error.slice(0, 300) };
  if (deep.ok) {
    const claims = deep.value.draft.claimLedger ?? [];
    assert.ok(claims.every(claim => claim.status !== 'supported' || claim.kind === 'nonfactual'), 'no factual claim is accepted without a working judge');
    assert.equal(deep.value.draft.stats.truncated, true, 'the report is marked partial');
  }
  mode = { openrouter: 'ok', deepseek: 'ok' };
  report.upstreamCalls = { openrouter: count('openrouter'), deepseek: count('deepseek') };
  report.completed = true;
} finally {
  await harness.close();
  fs.writeFileSync(path.join(harness.root, 'artifacts/provider-faults.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ root: harness.root, completed: report.completed }));
}
