/** Integral Research verification through the real interface of an isolated Nodus.
 *
 * A fresh profile accepts automatic indexing in the welcome. Two Nodus collections are
 * built in the Global Library (files added through "Añadir archivos") and a Zotero
 * subcollection of a disposable Zotero 10 is monitored into this vault. Every document
 * is indexed without anyone pressing prepare. Research Chat is then asked, through the
 * composer, about one group, about each notebook's other group, about both, about the
 * Zotero group, with and without an @-invoked skill, and finally about one document of
 * a Nodus group and one of the Zotero group whose indexes were removed, so the answer
 * needs the original: from the Global Library for the Nodus one, from Zotero through the
 * managed MCP for the Zotero one. Every answer is recorded with its request, ordered
 * activity (main process and panel), resolved citations, quotations found in the
 * corpus, logs and the calls, tokens and cost the shared ledger charged.
 *
 *   node scripts/verify-research-integral.mjs --campaign-root=<ledger root>
 *     --credentials-root=<isolated profile holding the two encrypted keys>
 *     [--limit-usd=6.8] [--out=docs/research-evidence/<date>-integral.json] [--until=<step>]
 *
 * Integration here is real for the application, the providers (DeepSeek Flash, OpenRouter
 * bge-m3, through the cost-reserving proxy), Zotero 10 and the managed Zotero MCP. The
 * documents are synthetic fixtures. IPC only configures the profile, stubs the OS file
 * picker, and measures; the one documented exception is the removal of two published
 * indexes in the closed profile (step 7), which has no interface by design.
 * The run refuses to start, and every paid step refuses to begin, once the ledger could
 * pass --limit-usd; a watchdog closes the application at that limit. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createResearchApp, reserveLoopbackPort, waitFor } from './lib/research-app-harness.mjs';
import { launchIndependentZotero } from './lib/independent-zotero.mjs';
import { createResearchTestRoot, macResearchSandbox, verifyResearchSandbox } from './research-isolation.mjs';
import { DOCUMENTS, GROUPS, QUESTIONS, ZOTERO_DECOY, writeCorpusPdf, zoteroCreators } from './lib/research-integral-corpus.mjs';

const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const campaignRoot = argument('campaign-root');
const credentialsRoot = argument('credentials-root');
const limitUsd = Number(argument('limit-usd') ?? 6.8);
const evidenceOut = argument('out');
const until = argument('until');
if (!campaignRoot || !credentialsRoot) throw new Error('--campaign-root and --credentials-root are required');
if (!(limitUsd > 0 && limitUsd <= 6.8)) throw new Error('--limit-usd must stay at or below the 6.80 guard');
const PROOFS = ['writeInsideAllowed', 'writeOutsideDenied', 'descendantWriteDenied', 'externalNetworkDenied', 'forbiddenLoopbackPortDenied'];
const assertIsolated = (proof, what) => assert.ok(PROOFS.every(key => proof[key] === true), `${what}: isolation proof failed ${JSON.stringify(proof)}`);
const STEPS = ['welcome', 'collectionA', 'generalA', 'collectionB', 'notebooks', 'ideasB', 'zotero', 'skills', 'wholeDocument', 'layers'];
if (until && !STEPS.includes(until)) throw new Error(`--until must be one of ${STEPS.join(', ')}`);
class StopAfter extends Error {}
const done = step => { if (until === step) throw new StopAfter(step); };

// ---------------------------------------------------------------- cost

const ledgerFile = path.join(campaignRoot, 'artifacts/cost-ledger.json');
const ledgerTotal = () => {
  const { calls, limitUsd: ledgerLimit } = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
  return { calls: calls.length, usd: calls.reduce((sum, call) => sum + (call.actualUsd ?? call.maximumUsd), 0), retained: calls.filter(call => call.actualUsd == null).length, ledgerLimit };
};
/** Re-read before every paid step; a step whose bound would reach the guard never starts. */
const costGuard = (step, boundUsd) => {
  const total = ledgerTotal();
  if (total.usd + boundUsd >= limitUsd) throw new Error(`cost_guard: ${step} needs up to $${boundUsd}; the ledger holds $${total.usd.toFixed(6)} and the guard is $${limitUsd}`);
  return total;
};

// Observe what the application sends upstream (prompts only, never headers), still sending it.
let observed = null;
const observingFetch = async (url, init) => {
  if (observed && url.includes('deepseek')) {
    try {
      const body = JSON.parse(Buffer.from(init.body).toString('utf8'));
      observed.push({ at: Date.now(), system: body.messages?.filter(message => message.role === 'system').map(message => message.content).join('\n') ?? '', maxTokens: body.max_tokens ?? body.max_completion_tokens });
    } catch { /* Observation must never stop a request. */ }
  }
  return fetch(url, init);
};

// ---------------------------------------------------------------- run

const startedAt = new Date().toISOString();
const ledgerAtStart = costGuard('start', 0.3);
const evidence = { description: 'Integral Research verification through the real interface of an isolated Nodus (collections, notebooks, Zotero MCP, whole-document reads, skills)',
  mode: 'real_provider', models: { chat: 'deepseek/deepseek-flash', extraction: 'deepseek/deepseek-flash', embeddings: 'openrouter/baai/bge-m3' },
  startedAt, limitUsd, ledgerAtStart, stepOrder: STEPS, steps: {} };

// A disposable Zotero with its own root, sandbox, profile, data directory and port.
const zoteroRoot = createResearchTestRoot();
const zoteroPort = await reserveLoopbackPort();
const zoteroPolicy = macResearchSandbox(zoteroRoot, [zoteroPort]);
const zoteroProof = { ...verifyResearchSandbox(zoteroRoot, zoteroPolicy), allowedLoopbackPorts: [zoteroPort] };
assertIsolated(zoteroProof, 'Zotero root');
const written = {};
for (const document of DOCUMENTS.filter(document => document.group === 'Z')) written[document.key] = await writeCorpusPdf(path.join(zoteroRoot, 'fixtures'), document);
const zotero = await launchIndependentZotero({ root: zoteroRoot, port: zoteroPort, policy: zoteroPolicy,
  collections: [{ name: GROUPS.Z.parent }, { name: GROUPS.Z.collection, parent: GROUPS.Z.parent }],
  records: [...DOCUMENTS.filter(document => document.group === 'Z').map(document => ({ title: document.title, abstract: '', file: written[document.key].file, sha256: written[document.key].sha256,
    creators: zoteroCreators(document), date: String(document.year), collection: GROUPS.Z.collection })),
  { ...ZOTERO_DECOY, collection: GROUPS.Z.parent }] });
evidence.zotero = { root: zoteroRoot, proof: zoteroProof, version: zotero.corpus.version, endpoint: zotero.endpoint, dataDirectory: zotero.corpus.dataDirectory,
  collections: zotero.corpus.collections, items: zotero.corpus.items.map(item => ({ key: item.key, collection: item.collection, attachment: item.attachment && { key: item.attachment.key, sha256: item.attachment.sha256 } })) };

const harness = await createResearchApp({ realProvider: { campaignRoot, dispatch: observingFetch }, extraPorts: [zoteroPort], extraEnv: { NODUS_ZOTERO_API_BASE: zotero.endpoint } });
assertIsolated(harness.proof, 'application root');
evidence.root = harness.root;
evidence.proof = harness.proof;
const artifacts = path.join(harness.root, 'artifacts');
const shots = [];
const shot = async name => { const file = path.join(artifacts, `${name}.png`); await harness.page.screenshot({ path: file }); shots.push(file); return file; };
const consoleLog = [], mainLog = [];
let watchdog;
let app, page;

async function launch(label) {
  ({ app, page } = await harness.launch());
  assertIsolated(harness.launchProofs.at(-1), `${label} launch`);
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setSize(1440, 920); window.center(); });
  page.on('console', message => consoleLog.push({ at: Date.now(), launch: label, type: message.type(), text: message.text().slice(0, 2000) }));
  page.on('pageerror', error => consoleLog.push({ at: Date.now(), launch: label, type: 'pageerror', text: String(error).slice(0, 2000) }));
  app.process().stdout?.on('data', data => mainLog.push({ at: Date.now(), launch: label, stream: 'stdout', text: String(data).slice(0, 4000) }));
  app.process().stderr?.on('data', data => mainLog.push({ at: Date.now(), launch: label, stream: 'stderr', text: String(data).slice(0, 4000) }));
  await installRecorders();
}

/** Every stream event and every final response, recorded in the main process. */
async function installRecorders() {
  await app.evaluate(({ ipcMain, webContents }) => {
    globalThis.researchStreamLog ??= [];
    globalThis.researchResponses ??= [];
    for (const contents of webContents.getAllWebContents()) {
      if (contents.researchRecorder) continue;
      contents.researchRecorder = true;
      const send = contents.send.bind(contents);
      contents.send = (channel, ...args) => {
        if (String(channel).startsWith('research:chatStream') && !String(channel).endsWith(':delta') && !String(channel).endsWith(':reasoning')) globalThis.researchStreamLog.push({ at: Date.now(), channel, args: JSON.parse(JSON.stringify(args)) });
        return send(channel, ...args);
      };
    }
    const handlers = ipcMain._invokeHandlers;
    const original = handlers?.get('research:chatStream');
    if (original && !original.recorded) {
      const recorded = async (event, requestId, request) => {
        const started = Date.now();
        const summary = { skillIds: request?.skillIds ?? [], notebookId: request?.selection?.notebookId ?? null, conversationId: request?.conversationId ?? null,
          messages: request?.messages?.length ?? 0, sourceFilter: request?.selection?.sourceFilter?.enabled ?? false, model: request?.model ?? null };
        try { const response = await original(event, requestId, request); globalThis.researchResponses.push({ requestId, started, finished: Date.now(), request: summary, response: JSON.parse(JSON.stringify(response)) }); return response; }
        catch (error) { globalThis.researchResponses.push({ requestId, started, finished: Date.now(), request: summary, error: String(error?.message ?? error) }); throw error; }
      };
      recorded.recorded = true;
      handlers.set('research:chatStream', recorded);
    }
  });
}

/** Playwright can report the main process's execution context as destroyed while the
 * application keeps running (seen once mid-answer); a measurement retries instead of
 * failing the scenario. */
async function mainEval(fn, arg) {
  for (let attempt = 0; ; attempt++) {
    try { return await app.evaluate(fn, arg); }
    catch (error) {
      if (attempt >= 8 || !/Execution context was destroyed/.test(String(error?.message))) throw error;
      evidence.harnessRetries = (evidence.harnessRetries ?? 0) + 1;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}

// ---------------------------------------------------------------- measurement helpers

const inventory = () => page.evaluate(() => window.nodus.getResearchPreparationInventory());
const docs = {}; // key -> { id, workId, libraryItemId, title }
const keyOfWork = workId => Object.keys(docs).find(key => docs[key].workId === workId);
const keyOfDocument = id => id ? Object.keys(docs).find(key => docs[key].id === id || docs[key].libraryItemId === id) : undefined;
const keyOfTitle = title => DOCUMENTS.find(document => document.title === title)?.key;

/** Waits until every listed document has ready text and vectors; samples each change. */
async function waitIndexed(keys, label, timeoutMs = 600000) {
  const samples = [];
  const result = await waitFor(async () => {
    const current = await inventory();
    const state = Object.fromEntries(keys.map(key => [key, current.documents.find(document => document.id === docs[key].id)?.preparation ?? null]));
    const sample = Object.fromEntries(Object.entries(state).map(([key, value]) => [key, value && [value.status, value.text, value.lexical, value.embeddings, value.passages, value.embedded]]));
    if (JSON.stringify(sample) !== JSON.stringify(samples.at(-1)?.state)) samples.push({ at: Date.now(), state: sample });
    const failed = Object.entries(state).find(([, value]) => value && ['failed', 'blocked'].includes(value.status));
    if (failed) throw new Error(`${label}: indexing failed for ${failed[0]}: ${JSON.stringify(failed[1])}`);
    return Object.values(state).every(value => value?.lexical === 'ready' && value?.embeddings === 'ready') && { state, embeddingSpaces: current.embeddingSpaces };
  }, { timeoutMs, intervalMs: 1000 });
  assert.ok(result, `${label}: documents indexed automatically; last ${JSON.stringify(samples.at(-1))}`);
  return { samples, final: Object.fromEntries(Object.entries(result.state).map(([key, value]) => [key, { status: value.status, text: value.text, lexical: value.lexical, embeddings: value.embeddings, passages: value.passages, embedded: value.embedded }])),
    embeddingSpaces: result.embeddingSpaces };
}

async function queueRows(name) {
  await page.locator('[data-queue-trigger]').click();
  const panel = page.getByTestId('header-queue-panel');
  await panel.waitFor();
  const bar = panel.getByTestId('preparation-queue-bar');
  let rows = [];
  if (await bar.count()) {
    await bar.getByRole('button', { name: /Indexación/ }).first().click();
    await bar.locator('[data-testid^="preparation-item-"]').first().waitFor({ timeout: 10000 }).catch(() => undefined);
    rows = await panel.locator('[data-testid^="preparation-item-"]').evaluateAll(elements => elements.map(element => ({ testId: element.getAttribute('data-testid'), state: element.getAttribute('data-state'), text: element.textContent.trim().slice(0, 200) })));
  }
  const status = await panel.getByTestId('preparation-queue-status').textContent().catch(() => null);
  await shot(name);
  await page.keyboard.press('Escape');
  return { status, rows: rows.map(row => ({ ...row, document: keyOfDocument(row.testId.replace('preparation-item-', '')) ?? null })) };
}

const orderOf = activities => {
  const byId = new Map();
  for (const event of activities) byId.set(event.id, { ...(byId.get(event.id) ?? {}), ...event });
  return [...byId.values()].sort((a, b) => a.startedAt - b.startedAt || 0).map(event => ({ layer: event.layer, operation: event.operation, status: event.status, subject: event.subject ?? null, count: event.count ?? null,
    startedAt: event.startedAt, finishedAt: event.finishedAt ?? null }));
};
/** scope → retrieval (profiles/nodus/ideas) → context → reading → graph → response. */
function checkOrder(ordered) {
  const index = predicate => ordered.findIndex(predicate);
  const firstRetrieval = index(event => ['profiles', 'nodus', 'ideas'].includes(event.layer) && ['lexical', 'semantic', 'search'].includes(event.operation));
  const firstResponse = index(event => event.layer === 'response');
  const late = ordered.filter((event, position) => position > firstResponse && !['response', 'tools'].includes(event.layer));
  const reading = ordered.map((event, position) => ({ event, position })).filter(({ event }) => event.operation === 'pages' || event.layer === 'zotero');
  const context = ordered.map((event, position) => ({ event, position })).filter(({ event }) => event.layer === 'context');
  const checks = {
    startsWithScope: ordered[0]?.layer === 'scope',
    retrievalBeforeContext: context.every(({ position }) => firstRetrieval >= 0 && position > firstRetrieval),
    readingAfterRetrieval: reading.every(({ position }) => firstRetrieval >= 0 && position > firstRetrieval),
    responseAfterAllConsultation: firstResponse > 0 && late.length === 0,
  };
  return { ...checks, ok: Object.values(checks).every(Boolean) };
}

const corpusPages = DOCUMENTS.flatMap(document => document.pages.map((lines, index) => ({ key: document.key, page: index + 1, text: lines.join(' ') })));
const normalize = text => text.replace(/\s+/g, ' ').trim();
function quotationsIn(answer) {
  return [...answer.matchAll(/«([^»]{8,400})»/g)].map(match => {
    const quote = normalize(match[1]).replace(/[.…]+$/, '');
    const found = corpusPages.filter(page => normalize(page.text).includes(quote));
    return { quote: match[1], foundIn: found.map(page => `${page.key} p. ${page.page}`) };
  });
}

async function resolveCitations(answer) {
  const refs = [...new Set([...answer.matchAll(/nodus:\/\/(passage|idea|gap)\/([^\s)\]"<>]+)/g)].map(match => `${match[1]}:${decodeURIComponent(match[2])}`))];
  const citations = [];
  for (const ref of refs) {
    const [kind, ...rest] = ref.split(':');
    const id = rest.join(':');
    if (kind !== 'passage') { citations.push({ kind, id }); continue; }
    const passage = await page.evaluate(id => window.nodus.getPassage(id), id);
    if (!passage) { citations.push({ kind, id, unresolved: true }); continue; }
    const document = keyOfDocument(passage.libraryItemId) ?? keyOfWork(passage.nodus_id) ?? keyOfTitle(passage.work?.title) ?? null;
    const text = normalize(passage.text ?? '');
    const pagesContaining = corpusPages.filter(entry => entry.key === document && text.includes(normalize(entry.text).slice(0, 60))).map(entry => entry.page);
    citations.push({ kind, id, document, page: passage.page_number ?? null, pageLabel: passage.page_label ?? null, provenance: passage.provenance ?? null, pagesContaining, text: (passage.text ?? '').slice(0, 700) });
  }
  return citations;
}

function mechanicalChecks(answer, expect = {}) {
  return { include: (expect.include ?? []).map(pattern => ({ pattern: String(pattern), found: pattern.test(answer) })),
    exclude: (expect.exclude ?? []).map(pattern => ({ pattern: String(pattern), found: pattern.test(answer) })) };
}

async function openResearchChat() {
  await page.getByRole('button', { name: 'Research chat', exact: true }).first().click();
  await page.locator('.research-assistant-header').waitFor({ timeout: 30000 });
  if (await page.getByTestId('research-history-toggle').count() && !(await page.getByTestId('research-history-sidebar').isVisible())) await page.getByTestId('research-history-toggle').click();
  await page.getByTestId('research-history-sidebar').waitFor();
}
const notebooks = {};
async function startConversation(target) {
  if (target === 'general') await page.getByTestId('research-new-conversation').click();
  else {
    const notebook = notebooks[target];
    await page.getByTestId(`research-notebook-${notebook.id}`).hover();
    await page.getByTestId(`research-notebook-${notebook.id}`).getByRole('button', { name: `Abrir ${notebook.name}`, exact: true }).click();
    await page.getByTestId('research-notebook-home').waitFor();
    await page.waitForFunction(() => !document.querySelector('[data-testid="research-notebook-banner"][data-state="indexing"], [data-testid="research-notebook-banner"][data-state="checking"]'), null, { timeout: 600000 });
  }
  await page.getByRole('textbox', { name: /Pregunta al asistente/ }).waitFor();
}

const questions = [];
/** One question in a fresh conversation (or notebook chat), through the composer. */
async function ask(step, question, { target = 'general', skill = null, observe = false } = {}) {
  costGuard(`${step}/${question.name}`, 0.25);
  const before = ledgerTotal();
  await startConversation(target);
  const responsesBefore = await mainEval(() => globalThis.researchResponses.length);
  const input = page.getByRole('textbox', { name: /Pregunta al asistente/ });
  await input.fill('');
  let skillPick = null;
  if (skill) {
    await input.pressSequentially(`@${skill.mention}`);
    const menu = page.getByTestId('research-skill-mention');
    await menu.waitFor();
    const first = menu.getByRole('option').first();
    skillPick = { offered: await first.innerText(), selected: await first.getAttribute('aria-selected') };
    assert.match(skillPick.offered, new RegExp(skill.name));
    await page.keyboard.press('Enter');
    await menu.waitFor({ state: 'detached' });
    skillPick.pill = await page.getByTestId('research-invoked-skills').innerText();
    await input.pressSequentially(question.text);
  } else await input.fill(question.text);
  if (observe) observed = [];
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  const outcome = await waitFor(async () => {
    const responses = await mainEval(() => globalThis.researchResponses);
    return responses.length > responsesBefore && responses.at(-1);
  }, { timeoutMs: 600000, intervalMs: 500 });
  assert.ok(outcome, `${question.name}: the chat returned`);
  await page.getByRole('button', { name: 'Enviar', exact: true }).waitFor({ timeout: 60000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  const prompts = observe ? observed : null;
  observed = null;
  const stream = (await mainEval(() => globalThis.researchStreamLog)).filter(entry => entry.args[0] === outcome.requestId);
  const activity = orderOf(stream.filter(entry => entry.channel.endsWith(':activity')).map(entry => entry.args[1]));
  const panel = await page.locator('[data-testid="research-activity"] li[data-layer]').evaluateAll(elements => elements.map(element => ({ layer: element.dataset.layer, status: element.dataset.status, text: element.textContent.trim().slice(0, 160) })));
  const answer = outcome.response?.answer ?? '';
  const rendered = await page.evaluate(() => {
    const visuals = [...document.querySelectorAll('.chat-visual')];
    const last = visuals.at(-1);
    return { visuals: visuals.length, lastHasSvg: !!last?.querySelector('svg, img'), lastKind: last?.querySelector('.chat-visual-kind')?.textContent ?? null, errors: document.querySelectorAll('.chat-visual-error').length,
      messageSkills: [...document.querySelectorAll('[data-testid="research-message-skills"]')].map(element => element.textContent.trim()) };
  });
  const record = { step, target, ...question, expect: undefined, requestId: outcome.requestId, request: outcome.request, durationMs: outcome.finished - outcome.started, error: outcome.error ?? null, answer,
    stats: outcome.response?.stats ?? null, activity, order: checkOrder(activity), panel,
    layersUsed: [...new Set(activity.filter(event => event.status === 'completed' && event.count !== 0).map(event => event.layer))],
    failedLayers: panel.filter(row => row.status === 'failed').map(row => row.layer),
    citations: await resolveCitations(answer), quotations: quotationsIn(answer), mechanical: mechanicalChecks(answer, question.expect),
    skill: skill ? { pick: skillPick, rendered } : null,
    prompts: prompts && { calls: prompts.length, invokedRule: prompts.map(prompt => prompt.system.split('\n').find(line => line.startsWith('INVOKED SKILLS')) ?? null).filter(Boolean),
      skillsInSystem: prompts.map(prompt => /SVG Studio/.test(prompt.system)), maxTokens: prompts.map(prompt => prompt.maxTokens) },
    screenshot: await shot(`q-${String(questions.length + 1).padStart(2, '0')}-${question.name}`), viewCrashed: await page.getByText('Algo ha fallado en esta sección', { exact: true }).isVisible().catch(() => false) };
  const after = ledgerTotal();
  record.cost = { calls: after.calls - before.calls, usd: after.usd - before.usd };
  questions.push(record);
  evidence.questions = questions;
  if (record.viewCrashed) throw new Error(`${question.name}: the Research Chat view crashed`);
  return record;
}

/** "Nueva colección" in the Global Library, then "Añadir archivos" into it (only the OS
 * file picker is stubbed). Returns the created items, by corpus key. */
async function createCollectionWithFiles(group, keys, files) {
  await page.locator('[data-tour="nav-library"]').click();
  await page.getByTestId('library-scope-global').click();
  await page.getByTestId('global-library-view').waitFor();
  // "Nueva colección" creates inside the selected Nodus collection; start from the root.
  await page.getByRole('button', { name: /Todos los documentos/ }).first().click();
  await page.getByTitle('Nueva colección', { exact: true }).click();
  const name = GROUPS[group].collection;
  await page.getByPlaceholder('Nombre de la colección').fill(name);
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  const collection = await waitFor(async () => (await page.evaluate(() => window.nodus.listGlobalLibraryCollections())).find(entry => entry.name === name), { timeoutMs: 30000 });
  assert.ok(collection, `collection ${name} created`);
  assert.equal(collection.parentId ?? null, null, `collection ${name} is a top-level collection`);
  await app.evaluate(({ dialog }, filePaths) => { globalThis.harnessOpenDialog ??= dialog.showOpenDialog; dialog.showOpenDialog = async () => ({ canceled: false, filePaths }); }, files);
  await page.getByTestId('library-add-menu-toggle').click();
  await page.getByTestId('add-library-files').click();
  // The file import names each item after its file name; it does not read the PDF's
  // embedded Title/Author. The metadata is then typed in the item's metadata editor.
  const fileTitles = files.map(file => path.basename(file, '.pdf').replace(/[-_]+/g, ' '));
  const items = await waitFor(async () => {
    const list = (await page.evaluate(() => window.nodus.listGlobalLibraryItems({ limit: 200 }))).items;
    const found = fileTitles.map(title => list.find(item => item.title === title));
    return found.every(Boolean) && found;
  }, { timeoutMs: 120000 });
  await app.evaluate(({ dialog }) => { if (globalThis.harnessOpenDialog) dialog.showOpenDialog = globalThis.harnessOpenDialog; });
  assert.ok(items, `the three ${group} files became Global Library items named after their files`);
  const importedTitles = items.map(item => item.title);
  for (const [index, key] of keys.entries()) await editMetadata(items[index].title, DOCUMENTS.find(document => document.key === key));
  const full = await Promise.all(items.map(item => page.evaluate(id => window.nodus.getGlobalLibraryItem(id), item.id)));
  assert.ok(full.every(item => item.collectionIds.includes(collection.id)), `the ${group} items were added inside the selected collection`);
  keys.forEach((key, index) => {
    assert.equal(full[index].metadata.title, DOCUMENTS.find(document => document.key === key).title, `${key} metadata saved`);
    docs[key] = { id: items[index].id, libraryItemId: items[index].id, workId: null, title: full[index].metadata.title };
  });
  await shot(`collection-${group}-metadata`);
  return { collection: { id: collection.id, name: collection.name, source: collection.source }, importedTitles,
    items: keys.map((key, index) => ({ key, id: items[index].id, title: full[index].metadata.title, creators: full[index].metadata.creators, year: full[index].metadata.year,
      attachments: full[index].attachments.map(attachment => ({ id: attachment.id, sha256: attachment.sha256, mimeType: attachment.mimeType, fileName: attachment.fileName })) })) };
}

/** "Editar y completar metadatos": title, people and year, as a person types them. */
async function editMetadata(currentTitle, document) {
  await page.getByTestId('global-library-search').fill(currentTitle);
  await page.getByText(currentTitle, { exact: true }).first().click();
  await page.getByTestId('global-library-detail').waitFor();
  await page.getByTestId('edit-library-metadata').first().click();
  const editor = page.getByTestId('library-metadata-editor');
  await editor.waitFor();
  await editor.getByLabel('Título', { exact: true }).fill(document.title);
  const people = [document.author, document.coauthor].filter(Boolean);
  for (const [index, [first, last]] of people.entries()) {
    if (await editor.getByRole('textbox', { name: 'Apellidos', exact: true }).count() <= index) await editor.getByRole('button', { name: 'Añadir persona' }).click();
    await editor.getByRole('textbox', { name: 'Nombre', exact: true }).nth(index).fill(first);
    await editor.getByRole('textbox', { name: 'Apellidos', exact: true }).nth(index).fill(last);
  }
  await editor.getByLabel('Año', { exact: true }).fill(String(document.year));
  await editor.getByRole('button', { name: 'Guardar metadatos' }).click();
  await editor.waitFor({ state: 'detached' });
  await page.getByTestId('global-library-search').fill('');
}

/** Selects the collection's rows and uses "Usar en un vault" with this vault. */
async function linkCollectionToVault(group, keys) {
  await page.locator('[data-tour="nav-library"]').click();
  await page.getByTestId('library-scope-global').click();
  await page.getByTestId('global-library-view').waitFor();
  await page.getByTestId('library-collections-pane').getByText(GROUPS[group].collection, { exact: true }).click();
  await page.getByTestId('global-library-table-header').getByRole('checkbox').check();
  await page.getByTestId('global-library-bulk-actions').waitFor();
  const selected = await page.getByTestId('global-library-bulk-actions').locator('b').first().textContent();
  await page.getByTestId('bulk-add-library-to-vault').click();
  const dialog = page.getByTestId('global-library-vault-dialog');
  await dialog.waitFor();
  await shot(`link-${group}-to-vault`);
  await dialog.getByTestId('confirm-global-library-vault-link').click();
  await dialog.waitFor({ state: 'detached' });
  const linkedAt = Date.now();
  const works = await waitFor(async () => {
    const current = await inventory();
    const found = keys.map(key => current.documents.find(document => document.id === docs[key].id)?.workId);
    return found.every(Boolean) && found;
  }, { timeoutMs: 60000 });
  assert.ok(works, `the ${group} items became works of this vault`);
  keys.forEach((key, index) => { docs[key].workId = works[index]; });
  await page.getByTestId('bulk-clear-library-selection').click().catch(() => undefined);
  return { selected, linkedAt, works: Object.fromEntries(keys.map((key, index) => [key, works[index]])) };
}

// ---------------------------------------------------------------- steps

try {
  evidence.credentials = { imported: (await harness.importCredentials(credentialsRoot)).imported };
  for (const document of DOCUMENTS.filter(document => document.group !== 'Z')) written[document.key] = await writeCorpusPdf(path.join(harness.root, 'fixtures'), document);
  evidence.corpus = { groups: GROUPS, documents: DOCUMENTS.map(document => ({ ...written[document.key], file: path.relative(document.group === 'Z' ? zoteroRoot : harness.root, written[document.key].file),
    root: document.group === 'Z' ? 'zotero' : 'app', pages: document.pages })), zoteroDecoy: ZOTERO_DECOY };

  await launch('initial');
  watchdog = setInterval(() => {
    if (ledgerTotal().usd >= limitUsd) { consoleLog.push({ at: Date.now(), type: 'watchdog', text: 'cost guard reached, closing' }); void harness.closeApp(); }
  }, 2000);

  // 1. A new user's profile with the two authorized models, then the welcome.
  await page.evaluate(async ({ root }) => {
    const model = { provider: 'deepseek', model: 'deepseek-flash' };
    await window.nodus.updateSettings({ autoLightScan: false, autoDeepScanOnReadTag: false, autoSummaryAfterDeep: false,
      autoBackupFolder: `${root}/library`, onboardingComplete: true, basicsTutorialVersion: 99, recoverySetupVersion: 999, tourComplete: true,
      advancedTourComplete: true, uiLanguage: 'es', promptLanguage: 'es', mascotEnabled: false, mascotStyleChosen: true, reduceMotion: true,
      chatModel: model, deepResearchModel: model, synthesisModel: model, extractionModel: model, summaryModel: model, fusionModel: model,
      relationModel: model, documentProfileModel: model, documentAuditModel: model, embeddingProvider: 'openrouter', embeddingModel: 'baai/bge-m3', chatReasoning: 'off' });
  }, { root: harness.root });
  await page.evaluate(version => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    for (const key of ['nodus.mobileTeaserSeen.3.2.4', 'nodus.platformHighlightsSeen.2026-07', 'nodus.tutorialVideosAnnouncementSeen.2026-07',
      'nodus.pdfPresenterTutorialSeen.e2js_u-05OA', 'nodus.toolkitBetaGuideSeen.2.4.0', 'nodus.libraryTutorialSeen.v1']) localStorage.setItem(key, '1');
  }, JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../package.json'), 'utf8')).version);
  await page.reload();
  await installRecorders();
  const vault = await page.evaluate(() => window.nodus.getActiveVault());
  const welcome = page.getByTestId('research-preparation-welcome');
  await welcome.getByText('baai/bge-m3', { exact: true }).waitFor({ timeout: 60000 });
  const welcomeText = await welcome.textContent();
  await shot('01-welcome');
  await welcome.getByRole('button', { name: 'Sí, iniciar', exact: true }).click();
  await welcome.waitFor({ state: 'detached' });
  const policy = await page.evaluate(() => window.nodus.getResearchPreparationPolicy());
  assert.equal(policy.decision, 'accepted'); assert.equal(policy.futureAdditions, true);
  evidence.steps.welcome = { vault: { id: vault.id, name: vault.name, type: vault.type }, clicked: 'Sí, iniciar',
    promisesAutomaticIndexing: welcomeText.includes('Los documentos nuevos se indexarán automáticamente'), policy,
    zoteroMcp: await page.evaluate(() => window.nodus.getZoteroMcpStatus(null)) };
  assert.equal(vault.type, 'academic');
  done('welcome');

  // 2. Collection A in the Global Library; its three works indexed with nothing pressed.
  costGuard('collection A indexing', 0.05);
  const collectionA = await createCollectionWithFiles('A', ['A1', 'A2', 'A3'], ['A1', 'A2', 'A3'].map(key => written[key].file));
  await shot('02-collection-A');
  const linkA = await linkCollectionToVault('A', ['A1', 'A2', 'A3']);
  const indexedA = await waitIndexed(['A1', 'A2', 'A3'], 'collection A');
  evidence.steps.collectionA = { ...collectionA, link: linkA, manualPrepareCalled: false, indexing: indexedA, queue: await queueRows('03-queue-A') };
  done('collectionA');

  // 3. The general chat of the vault, four questions about A.
  await openResearchChat();
  for (const question of QUESTIONS.generalA) await ask('generalA', question);
  evidence.steps.generalA = { questions: questions.filter(question => question.step === 'generalA').map(question => question.name) };
  done('generalA');

  // 4. Collection B, still outside the vault: its notebook will ask for the indexing.
  const collectionB = await createCollectionWithFiles('B', ['B1', 'B2', 'B3'], ['B1', 'B2', 'B3'].map(key => written[key].file));
  await shot('04-collection-B');
  const beforeNotebook = await inventory();
  evidence.steps.collectionB = { ...collectionB, beforeNotebook: Object.fromEntries(['B1', 'B2', 'B3'].map(key => [key, beforeNotebook.documents.find(document => document.id === docs[key].id)?.preparation?.status ?? 'not in inventory'])) };
  done('collectionB');

  // 5. Two notebooks from the sidebar. B first, so its own indexing is visible.
  costGuard('notebook B indexing', 0.05);
  await openResearchChat();
  const createNotebook = async (group, name) => {
    await page.getByTestId('research-new-notebook').click();
    const editor = page.getByTestId('research-notebook-dialog');
    await editor.waitFor();
    await editor.getByRole('textbox', { name: 'Nombre', exact: true }).fill(name);
    const collectionId = group === 'A' ? collectionA.collection.id : collectionB.collection.id;
    const tree = await editor.locator('[data-testid^="notebook-collection-"]').evaluateAll(rows => rows.map(row => ({ id: row.dataset.testid.replace('notebook-collection-', ''),
      name: row.querySelector('.research-notebook-name')?.textContent, origin: row.querySelector('[data-origin]')?.getAttribute('data-origin'), count: row.querySelector('.research-notebook-count')?.textContent })));
    const onlyCollections = await editor.locator('input[type="checkbox"]').count() === tree.length;
    await editor.getByTestId(`notebook-collection-${collectionId}`).getByRole('checkbox').check();
    const summary = await editor.getByTestId('research-notebook-summary').textContent();
    await shot(`05-notebook-dialog-${group}`);
    await editor.getByRole('button', { name: 'Crear cuaderno', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    await page.getByTestId('research-notebook-home').waitFor();
    const saved = (await page.evaluate(() => window.nodus.listResearchNotebooks())).find(item => item.name === name);
    notebooks[group] = { id: saved.id, name };
    return { tree, onlyCollections, summary, saved: { id: saved.id, name: saved.name, sources: saved.sources, mode: saved.mode } };
  };
  const notebookB = await createNotebook('B', 'Cuaderno Brenquel-9');
  const banner = page.getByTestId('research-notebook-banner');
  const gate = await waitFor(async () => {
    const state = await banner.getAttribute('data-state').catch(() => null);
    return state && state !== 'checking' && { state, text: (await banner.textContent()).trim(), sendDisabled: await page.getByRole('button', { name: 'Enviar', exact: true }).isDisabled() };
  }, { timeoutMs: 20000, intervalMs: 100 });
  await shot('06-notebook-B-indexing');
  let queueFromBanner = null;
  if (gate?.state === 'indexing') {
    await banner.getByRole('button', { name: 'Ver cola', exact: true }).click();
    queueFromBanner = { opened: await page.getByTestId('header-queue-panel').isVisible() };
    await shot('07-notebook-B-see-queue');
    await page.keyboard.press('Escape');
  }
  await page.getByRole('textbox', { name: /Pregunta al asistente/ }).fill('prueba de bloqueo');
  const sendWhileIndexing = gate?.state === 'indexing' ? await page.getByRole('button', { name: 'Enviar', exact: true }).isDisabled() : null;
  await page.getByRole('textbox', { name: /Pregunta al asistente/ }).fill('');
  const indexedB = await waitIndexed(['B1', 'B2', 'B3'], 'notebook B');
  await page.waitForFunction(() => !document.querySelector('[data-testid="research-notebook-banner"]'), null, { timeout: 60000 });
  await shot('08-notebook-B-ready');
  const sidebar = await page.getByTestId('research-history-sidebar').innerText();
  const notebookA = await createNotebook('A', 'Cuaderno Sarbela');
  await page.waitForFunction(() => !document.querySelector('[data-testid="research-notebook-banner"]'), null, { timeout: 60000 });
  await shot('09-notebook-A-view');
  const header = await page.getByTestId('research-notebook-title').innerText();
  // The general chat reads the vault, so B joins the vault now that its notebook indexed it.
  const linkB = await linkCollectionToVault('B', ['B1', 'B2', 'B3']);
  const afterLinkB = (await inventory()).documents.filter(document => ['B1', 'B2', 'B3'].some(key => docs[key].id === document.id)).map(document => ({ key: keyOfDocument(document.id), status: document.preparation.status, lexical: document.preparation.lexical, embeddings: document.preparation.embeddings }));
  await openResearchChat();
  const contextBalloon = {};
  await startConversation('B');
  await page.getByTestId('research-context-trigger').click();
  contextBalloon.notebookTabs = await page.locator('[data-testid^="research-context-tab-"]').evaluateAll(tabs => tabs.map(tab => tab.dataset.testid));
  await shot('10-context-balloon-notebook');
  await page.keyboard.press('Escape');
  await startConversation('general');
  await page.getByTestId('research-context-trigger').click();
  contextBalloon.generalTabs = await page.locator('[data-testid^="research-context-tab-"]').evaluateAll(tabs => tabs.map(tab => tab.dataset.testid));
  await shot('11-context-balloon-general');
  await page.keyboard.press('Escape');
  await ask('notebooks', QUESTIONS.notebookA, { target: 'A' });
  await ask('notebooks', QUESTIONS.notebookB, { target: 'B' });
  await ask('notebooks', QUESTIONS.notebookBInDomain, { target: 'B' });
  await ask('notebooks', QUESTIONS.generalBoth, { target: 'general' });
  evidence.steps.notebooks = { order: 'B was created before joining the vault, so the notebook itself queued its indexing; A was already indexed',
    B: { ...notebookB, gate, queueFromBanner, sendDisabledWhileIndexing: sendWhileIndexing, indexing: indexedB, manualPrepareCalled: false },
    A: notebookA, sidebarText: sidebar.slice(0, 1200), notebookHeaderA: header, linkB, afterLinkB, contextBalloon,
    notebookScopes: Object.fromEntries(await Promise.all(Object.entries(notebooks).map(async ([group, notebook]) => [group, (await page.evaluate(id => window.nodus.resolveResearchNotebook(id), notebook.id)).documents.map(document => keyOfDocument(document.id))]))) };
  done('notebooks');

  // 9a. Ideas for group B, through "Extraer ideas" on each row of this vault's Library.
  costGuard('ideas extraction B', 0.6);
  const ledgerBeforeIdeas = ledgerTotal();
  await page.locator('[data-tour="nav-library"]').click();
  await page.getByTestId('library-scope-vault').click();
  await page.getByTestId('library-vault-header').waitFor();
  const worksList = await page.evaluate(() => window.nodus.listWorks());
  for (const key of ['B1', 'B2', 'B3']) {
    const title = worksList.find(work => work.nodus_id === docs[key].workId)?.title;
    const row = page.locator('[role="row"], tr, [data-testid^="library-row"], div').filter({ hasText: title }).filter({ has: page.getByRole('button', { name: 'Extraer ideas', exact: true }) }).last();
    await row.getByRole('button', { name: 'Extraer ideas', exact: true }).click();
  }
  await shot('12-extract-ideas-B');
  const extractionSamples = [];
  const extracted = await waitFor(async () => {
    const queue = await page.evaluate(() => window.nodus.getQueue());
    const list = await page.evaluate(() => window.nodus.listWorks());
    const status = Object.fromEntries(['B1', 'B2', 'B3'].map(key => { const work = list.find(item => item.nodus_id === docs[key].workId); return [key, { deep: work?.deep_status, ideas: work?.ideaCount }]; }));
    const sample = { queue: { total: queue.total, done: queue.done, failed: queue.failed, current: queue.current?.kind ?? null, paused: queue.paused, pausedReason: queue.pausedReason }, status };
    if (JSON.stringify(sample) !== JSON.stringify(extractionSamples.at(-1)?.sample)) extractionSamples.push({ at: Date.now(), sample });
    if (queue.paused) throw new Error(`the analysis queue paused during extraction: ${queue.pausedReason}`);
    if (ledgerTotal().usd >= limitUsd - 0.05) throw new Error('cost_guard: extraction approaching the guard');
    const settled = !queue.current && !queue.maintenanceRunning && queue.items.every(item => !['pending', 'running'].includes(item.status));
    return settled && Object.values(status).every(value => ['done', 'failed', 'error'].includes(value.deep)) && { queue, status };
  }, { timeoutMs: 1500000, intervalMs: 3000 });
  assert.ok(extracted, `extraction settled; last ${JSON.stringify(extractionSamples.at(-1))}`);
  const ideasByWork = {};
  for (const key of ['B1', 'B2', 'B3']) ideasByWork[key] = (await page.evaluate(id => window.nodus.getIdeasByWork(id, 100, 0), docs[key].workId)).ideas.map(idea => ({ id: idea.global_id ?? idea.id, label: idea.label, type: idea.type, statement: idea.statement ?? null }));
  const graph = await page.evaluate(() => window.nodus.getGraph('ideas'));
  const nodeWorks = new Map(graph.nodes.map(node => [node.id, node.workIds ?? []]));
  const nodeLabel = new Map(graph.nodes.map(node => [node.id, node.label]));
  const bWorks = ['B1', 'B2', 'B3'].map(key => docs[key].workId);
  const crossEdges = graph.edges.filter(edge => {
    const from = (nodeWorks.get(edge.source) ?? []).filter(id => bWorks.includes(id)), to = (nodeWorks.get(edge.target) ?? []).filter(id => bWorks.includes(id));
    return from.length && to.length && from.some(id => !to.includes(id));
  });
  evidence.steps.ideasB = { action: 'Extraer ideas (one row each)', status: extracted.status, samples: extractionSamples, queueFailed: extracted.queue.failed, ideasByWork,
    graph: { nodes: graph.nodes.length, edges: graph.edges.length, crossDocumentEdges: crossEdges.map(edge => ({ type: edge.type, from: nodeLabel.get(edge.source), to: nodeLabel.get(edge.target) })) },
    cost: { before: ledgerBeforeIdeas, after: ledgerTotal() } };
  assert.ok(Object.values(ideasByWork).every(list => list.length > 0), 'every B document yields ideas');
  // Document profiles are only built on request: "Escanear obra completa" in each work's status.
  costGuard('document profiles B', 0.6);
  const ledgerBeforeProfiles = ledgerTotal();
  const workStatus = {};
  for (const key of ['B1', 'B2', 'B3']) {
    const title = worksList.find(work => work.nodus_id === docs[key].workId)?.title;
    const row = page.locator('[role="row"], tr, [data-testid^="library-row"], div').filter({ hasText: title }).filter({ has: page.locator('button.library-status-pill') }).last();
    await row.locator('button.library-status-pill').click();
    const action = page.getByTestId('work-status-documentary-action');
    await action.waitFor();
    if (key === 'B1') await shot('13a-work-status-documentary-index');
    await action.click();
    const modal = page.locator('div').filter({ has: page.getByTestId('work-status-documentary-index') }).filter({ has: page.getByRole('button', { name: 'Cerrar', exact: true }) }).last();
    workStatus[key] = (await modal.innerText()).slice(0, 1200);
    await modal.getByRole('button', { name: 'Cerrar', exact: true }).last().click();
    await page.getByTestId('work-status-documentary-index').waitFor({ state: 'detached', timeout: 10000 });
  }
  const profileSamples = [];
  const profiles = await waitFor(async () => {
    const statuses = await page.evaluate(ids => window.nodus.getDocumentProfileStatuses(ids), ['B1', 'B2', 'B3'].map(key => docs[key].workId));
    const sample = Object.fromEntries(statuses.map(entry => [keyOfWork(entry.nodusId), entry.status + (entry.error ? `:${entry.error}` : '')]));
    if (JSON.stringify(sample) !== JSON.stringify(profileSamples.at(-1)?.sample)) profileSamples.push({ at: Date.now(), sample });
    if (ledgerTotal().usd >= limitUsd - 0.05) throw new Error('cost_guard: document profiles approaching the guard');
    return statuses.every(entry => ['current', 'failed', 'error', 'stale'].includes(entry.status)) && statuses;
  }, { timeoutMs: 1500000, intervalMs: 3000 });
  assert.ok(profiles, `document profiles settled; last ${JSON.stringify(profileSamples.at(-1))}`);
  evidence.steps.ideasB.documentProfiles = { action: 'Escanear obra completa (work status, one row each)', workStatusBefore: workStatus, samples: profileSamples, final: profiles.map(entry => ({ key: keyOfWork(entry.nodusId), status: entry.status, error: entry.error })),
    cost: { before: ledgerBeforeProfiles, after: ledgerTotal() } };
  await openResearchChat();
  await ask('ideasB', QUESTIONS.ideasB);
  done('ideasB');

  // 6. The Zotero subcollection, monitored into this vault, then synchronised.
  costGuard('Zotero indexing', 0.05);
  await page.locator('[data-tour="nav-library"]').click();
  await page.getByTestId('library-scope-vault').click();
  await page.getByTestId('library-collections-menu-toggle').click();
  await page.getByTestId('open-zotero-collections').click();
  const zoteroModal = page.locator('div').filter({ has: page.getByRole('heading', { name: 'Colecciones de Zotero', exact: true }) }).last();
  const parentName = page.getByText(GROUPS.Z.parent, { exact: true });
  await parentName.waitFor({ timeout: 60000 });
  await parentName.locator('xpath=..').getByRole('button').first().click();
  // Once monitored, the name also shows in the "Monitorizando" list; the tree row is the span.
  const childName = page.locator('span.truncate').filter({ hasText: new RegExp(`^${GROUPS.Z.collection.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) });
  await childName.waitFor();
  await childName.locator('xpath=..').getByRole('button', { name: 'Monitorizar', exact: true }).click();
  await childName.click();
  await page.getByText(DOCUMENTS.find(document => document.key === 'Z1').title, { exact: true }).waitFor({ timeout: 30000 });
  const listedInSubcollection = await Promise.all(DOCUMENTS.filter(document => document.group === 'Z').map(async document => page.getByText(document.title, { exact: true }).isVisible()));
  await shot('13-zotero-collections-monitor');
  const monitored = (await page.evaluate(() => window.nodus.getSettings())).monitoredCollections;
  await page.keyboard.press('Escape');
  if (await zoteroModal.getByRole('heading', { name: 'Colecciones de Zotero', exact: true }).isVisible().catch(() => false)) await zoteroModal.locator('header button, button.btn-ghost').first().click();
  await page.locator('[data-tour="sync"]').click();
  const zWorks = await waitFor(async () => {
    const works = await page.evaluate(() => window.nodus.listWorks());
    const found = DOCUMENTS.filter(document => document.group === 'Z').map(document => works.find(work => work.title === document.title));
    return found.every(Boolean) && { found, works };
  }, { timeoutMs: 120000, intervalMs: 1000 });
  assert.ok(zWorks, 'the three Zotero items became works of this vault');
  const zInventory = await inventory();
  for (const [index, document] of DOCUMENTS.filter(document => document.group === 'Z').entries()) {
    const work = zWorks.found[index];
    const entry = zInventory.documents.find(item => item.workId === work.nodus_id);
    docs[document.key] = { id: entry.id, workId: work.nodus_id, libraryItemId: entry.libraryItemId ?? null, title: work.title, zoteroKey: work.zotero_key };
  }
  const indexedZ = await waitIndexed(['Z1', 'Z2', 'Z3'], 'Zotero subcollection');
  await openResearchChat();
  await page.getByTestId('research-new-notebook').click();
  const treeEditor = page.getByTestId('research-notebook-dialog');
  await treeEditor.waitFor();
  for (const twisty of await treeEditor.getByRole('button', { name: 'Desplegar' }).all()) await twisty.click().catch(() => undefined);
  const notebookTree = await treeEditor.locator('[data-testid^="notebook-collection-"]').evaluateAll(rows => rows.map(row => ({ name: row.querySelector('.research-notebook-name')?.textContent,
    origin: row.querySelector('[data-origin]')?.getAttribute('data-origin'), count: row.querySelector('.research-notebook-count')?.textContent, depth: parseInt(row.style.paddingLeft, 10) })));
  await shot('14-notebook-tree-nodus-and-zotero');
  await treeEditor.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await ask('zotero', QUESTIONS.zotero);
  evidence.steps.zotero = { monitored, listedInSubcollection, decoyImported: zWorks.works.some(work => work.title === ZOTERO_DECOY.title), vaultWorks: zWorks.works.length,
    documents: Object.fromEntries(['Z1', 'Z2', 'Z3'].map(key => [key, docs[key]])), indexing: indexedZ, queue: await queueRows('15-queue-Z'), notebookTree,
    zoteroMcp: await page.evaluate(() => window.nodus.getZoteroMcpStatus(null)) };
  done('zotero');

  // 8. Skills: first a request that suits one without naming it, then @SVG Studio.
  await openResearchChat();
  await ask('skills', QUESTIONS.skillsImplicit, { observe: true });
  await ask('skills', QUESTIONS.skillsInvoked, { skill: { mention: QUESTIONS.skillsInvoked.mention, name: QUESTIONS.skillsInvoked.skill }, observe: true });
  evidence.steps.skills = { vaultType: 'academic', skills: await page.evaluate(async () => (await window.nodus.listChatSkills()).map(skill => ({ id: skill.id, name: skill.name, enabled: skill.enabled ?? null }))).catch(error => ({ error: String(error) })) };
  done('skills');

  // 7. One document of A and one of Z lose their published index; the rest stay intact.
  await harness.closeApp();
  const store = path.join(harness.root, 'profile/documentary/store.sqlite');
  const removal = [];
  for (const key of ['A3', 'Z3']) {
    const id = docs[key].id;
    const quoted = `'${id.replaceAll("'", "''")}'`;
    // The statements of DocumentaryStore.removeDocument, for one document.
    const sql = `BEGIN IMMEDIATE;
DELETE FROM documentary_fts WHERE id IN (SELECT id FROM documentary_passages WHERE document_id=${quoted});
${['documentary_passages', 'documentary_publications', 'documentary_current', 'documentary_desired', 'documentary_attachment_heads', 'documentary_jobs', 'documentary_revisions'].map(table => `DELETE FROM ${table} WHERE document_id=${quoted};`).join('\n')}
DELETE FROM documentary_embedding_chunks WHERE operation IN (SELECT document_id FROM documentary_requests WHERE source_id=${quoted} OR document_id=${quoted} OR document_id LIKE 'embedding:' || ${quoted} || ':%');
DELETE FROM documentary_embedding_attempts WHERE operation IN (SELECT document_id FROM documentary_requests WHERE source_id=${quoted} OR document_id=${quoted} OR document_id LIKE 'embedding:' || ${quoted} || ':%');
DELETE FROM documentary_requests WHERE source_id=${quoted} OR document_id=${quoted} OR document_id LIKE 'embedding:' || ${quoted} || ':%';
COMMIT;`;
    const count = table => Number(execFileSync('/usr/bin/sqlite3', [store, `SELECT COUNT(*) FROM ${table} WHERE document_id=${quoted}`]).toString().trim());
    const before = { revisions: count('documentary_revisions'), passages: count('documentary_passages') };
    execFileSync('/usr/bin/sqlite3', [store], { input: sql });
    removal.push({ key, id, before, after: { revisions: count('documentary_revisions'), passages: count('documentary_passages') } });
  }
  await launch('after index removal');
  const afterRemoval = await inventory();
  const states = Object.fromEntries(Object.keys(docs).map(key => { const value = afterRemoval.documents.find(document => document.id === docs[key].id)?.preparation; return [key, value && { status: value.status, lexical: value.lexical, embeddings: value.embeddings, passages: value.passages }]; }));
  assert.equal(states.A3.lexical, 'missing'); assert.equal(states.Z3.lexical, 'missing');
  for (const key of ['A1', 'A2', 'Z1', 'Z2']) assert.equal(states[key].lexical, 'ready', `${key} stays indexed`);
  await openResearchChat();
  await ask('wholeDocument', QUESTIONS.wholeA3);
  await ask('wholeDocument', QUESTIONS.wholeZ3);
  const stillUnindexed = await inventory();
  evidence.steps.wholeDocument = { method: 'Closed the application, re-proved isolation, and ran DocumentaryStore.removeDocument\'s statements for A3 and Z3 on profile/documentary/store.sqlite with /usr/bin/sqlite3; A3 keeps its PDF in the Global Library, Z3 has no Global Library copy (vault Zotero work).',
    removal, statesAfterRelaunch: states, relaunchProof: harness.launchProofs.at(-1),
    stillUnindexedAfterQuestions: Object.fromEntries(['A3', 'Z3'].map(key => [key, stillUnindexed.documents.find(document => document.id === docs[key].id)?.preparation?.lexical])),
    zoteroMcp: await page.evaluate(() => window.nodus.getZoteroMcpStatus(null)) };
  done('wholeDocument');

  // 9. Every layer, across the run.
  const byLayer = {};
  for (const question of questions) for (const event of question.activity) {
    byLayer[event.layer] ??= { completedWithResults: 0, empty: 0, failed: 0, cancelled: 0, questions: new Set(), operations: new Set() };
    const entry = byLayer[event.layer];
    if (event.status === 'completed' && event.count !== 0) entry.completedWithResults++;
    else if (event.status === 'completed') entry.empty++;
    else entry[event.status] = (entry[event.status] ?? 0) + 1;
    entry.questions.add(question.name); entry.operations.add(event.operation);
  }
  evidence.steps.layers = { byLayer: Object.fromEntries(Object.entries(byLayer).map(([layer, value]) => [layer, { ...value, questions: [...value.questions], operations: [...value.operations] }])),
    zoteroOperations: questions.flatMap(question => question.activity.filter(event => event.layer === 'zotero').map(event => ({ question: question.name, operation: event.operation, status: event.status, subject: event.subject, count: event.count }))),
    panelFailures: questions.filter(question => question.failedLayers.length).map(question => ({ question: question.name, failed: question.failedLayers })),
    orderFailures: questions.filter(question => !question.order.ok).map(question => ({ question: question.name, order: question.order })) };
  done('layers');

  evidence.logs = {
    pipeline: await page.evaluate(() => window.nodus.getPipelineLogs({ limit: 500 })).catch(error => ({ error: String(error) })),
    rendererErrors: consoleLog.filter(entry => ['error', 'pageerror', 'watchdog'].includes(entry.type)),
    rendererWarnings: consoleLog.filter(entry => entry.type === 'warning').length,
    mainStderr: mainLog.filter(entry => entry.stream === 'stderr').map(entry => entry.text).join('').slice(-20000),
  };
  evidence.completed = true;
} catch (error) {
  if (error instanceof StopAfter) evidence.stoppedAfter = error.message;
  else {
    evidence.failure = { message: String(error?.stack ?? error).slice(0, 4000) };
    if (harness.page) await shot('failure').catch(() => undefined);
  }
} finally {
  if (watchdog) clearInterval(watchdog);
  evidence.launchProofs = harness.launchProofs;
  evidence.documents = docs;
  evidence.screenshots = shots.map(file => path.relative(harness.root, file));
  fs.writeFileSync(path.join(artifacts, 'renderer-console.json'), JSON.stringify(consoleLog, null, 2));
  fs.writeFileSync(path.join(artifacts, 'main-process.log'), mainLog.map(entry => `[${entry.launch}/${entry.stream}] ${entry.text}`).join(''));
  await harness.close();
  await zotero.stop();
  const ledgerAtEnd = ledgerTotal();
  const calls = JSON.parse(fs.readFileSync(ledgerFile, 'utf8')).calls.filter(call => call.reservedAt >= startedAt);
  evidence.accounting = { ledgerAtStart, ledgerAtEnd, runCalls: calls.length, runUsd: calls.reduce((sum, call) => sum + (call.actualUsd ?? call.maximumUsd), 0),
    retainedReservations: calls.filter(call => call.actualUsd == null).length,
    tokens: { input: calls.reduce((sum, call) => sum + (call.inputTokens ?? 0), 0), output: calls.reduce((sum, call) => sum + (call.outputTokens ?? 0), 0) },
    byProvider: Object.values(calls.reduce((groups, call) => {
      const key = `${call.provider}/${call.model}`;
      groups[key] ??= { model: key, calls: 0, usd: 0, inputTokens: 0, outputTokens: 0 };
      groups[key].calls++; groups[key].usd += call.actualUsd ?? call.maximumUsd; groups[key].inputTokens += call.inputTokens ?? 0; groups[key].outputTokens += call.outputTokens ?? 0;
      return groups;
    }, {})) };
  evidence.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(artifacts, 'integral.json'), JSON.stringify(evidence, null, 2));
  if (evidenceOut) fs.writeFileSync(evidenceOut, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ root: evidence.root, zoteroRoot, completed: !!evidence.completed, stoppedAfter: evidence.stoppedAfter ?? null, failure: evidence.failure?.message?.slice(0, 600) ?? null, accounting: evidence.accounting }));
  if (evidence.failure) process.exitCode = 1;
}
