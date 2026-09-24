/** End-to-end Research verification through the real interface of an isolated Nodus.
 *
 * A fresh profile accepts the preparation welcome; two new synthetic PDFs arrive, one as a
 * file through the Nodus Global Library and one imported from a disposable Zotero 10; both
 * must be indexed (text and embeddings) without anyone pressing prepare. Ideas are then
 * extracted with the separate "Extraer ideas" action, and four questions are asked in
 * Research Chat inside a notebook scoped to both documents. The activity of every answer
 * is recorded in order from the main process and from the panel, with the answer, its
 * resolved citations, logs, and the calls, tokens and cost the shared ledger charged.
 *
 * Real provider:  --campaign-root=<ledger root> --credentials-root=<isolated credentials>
 * Simulated:      --simulated  (the proxy, routing and application are real; the upstream
 *                 answer is produced locally, so only the mechanics are exercised)
 * The run refuses to start, and stops, before the ledger reaches --limit-usd (default 4.8).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createResearchApp, simulatedUpstream, waitFor } from './lib/research-app-harness.mjs';
import { launchIndependentZotero } from './lib/independent-zotero.mjs';
import { createResearchTestRoot, macResearchSandbox, verifyResearchSandbox } from './research-isolation.mjs';

const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const simulated = process.argv.includes('--simulated');
const campaignRoot = argument('campaign-root');
const credentialsRoot = argument('credentials-root');
const limitUsd = Number(argument('limit-usd') ?? 4.8);
const evidenceOut = argument('out');
if (!simulated && (!campaignRoot || !credentialsRoot)) throw new Error('A real run needs --campaign-root and --credentials-root (or pass --simulated)');
const PROOFS = ['writeInsideAllowed', 'writeOutsideDenied', 'descendantWriteDenied', 'externalNetworkDenied', 'forbiddenLoopbackPortDenied'];
const assertIsolated = (proof, what) => assert.ok(PROOFS.every(key => proof[key] === true), `${what}: isolation proof failed ${JSON.stringify(proof)}`);

// ---------------------------------------------------------------- cost

const ledgerFile = campaignRoot && path.join(campaignRoot, 'artifacts/cost-ledger.json');
const ledgerTotal = () => {
  if (!ledgerFile) return { calls: 0, usd: 0, retained: 0 };
  const { calls } = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
  return { calls: calls.length, usd: calls.reduce((sum, call) => sum + (call.actualUsd ?? call.maximumUsd), 0), retained: calls.filter(call => call.actualUsd == null).length };
};
/** Refuses a step whose bound would carry the ledger past the limit. */
const costGuard = (step, boundUsd) => {
  const total = ledgerTotal();
  if (total.usd + boundUsd >= limitUsd) throw new Error(`cost_guard: ${step} needs up to $${boundUsd}; the ledger holds $${total.usd.toFixed(6)} of $${limitUsd}`);
  return total;
};

// ---------------------------------------------------------------- corpus

/** The two documents. Every figure, quotation and page is fixed so an answer can be
 * checked by hand; B names A and disputes it, which is the relation between them. */
const DOCUMENTS = {
  A: {
    title: 'Informe Valdecorza 2031 sobre el regadío del valle del Tormeral',
    author: 'Irene Salcedo Brun',
    pages: [
      ['Informe Valdecorza 2031. Capítulo primero: método.',
        'El equipo dirigido por Irene Salcedo Brun muestreó 212 parcelas del valle del Tormeral',
        'entre marzo y octubre de 2031. Cada parcela se visitó cuatro veces y se registró el volumen',
        'de agua aplicado con contadores precintados. Las parcelas se eligieron entre las que ya',
        'regaban antes de 2029, porque solo en ellas podía compararse el consumo anterior y posterior',
        'a la instalación del riego por goteo.',
        'La muestra excluye deliberadamente las parcelas de secano.',
        'Esa exclusión se justifica en el informe por la ausencia de un consumo previo con el que',
        'comparar, y se indica que ninguna parcela de secano fue visitada durante la campaña.'],
      ['Informe Valdecorza 2031. Capítulo segundo: resultados.',
        'Tras la instalación del riego por goteo, el consumo medio de agua por hectárea descendió',
        'un 38,4 % en las parcelas muestreadas. El descenso fue mayor en los cultivos leñosos que en',
        'los hortícolas, y se mantuvo en las cuatro visitas de la campaña.',
        'El informe añade una advertencia expresa en este capítulo:',
        '«El ahorro no se tradujo en una reducción del caudal extraído del acuífero.»',
        'Los autores atribuyen esa falta de reducción a factores que la campaña no midió y',
        'recomiendan no extraer conclusiones sobre el acuífero a partir de la muestra.'],
      ['Informe Valdecorza 2031. Capítulo tercero: recomendaciones.',
        'El informe recomienda extender el riego por goteo a otras 90 parcelas del valle en los',
        'dos años siguientes, con un coste estimado de 1,7 millones de euros.',
        'También propone repetir la campaña de medición en 2033 con el mismo protocolo y los',
        'mismos contadores, para comprobar si el descenso del consumo por hectárea se mantiene.',
        'El capítulo cierra señalando que la extensión debe acompañarse de un registro de pozos.'],
    ],
  },
  B: {
    title: 'Réplica al Informe Valdecorza: el efecto rebote en el Tormeral',
    author: 'Tomás Aranguren Vidal',
    pages: [
      ['Réplica al Informe Valdecorza. Primera parte: lo que se acepta.',
        'Tomás Aranguren Vidal publica en 2032 esta réplica al Informe Valdecorza 2031.',
        'La réplica acepta la cifra central del informe: el consumo por hectárea de las parcelas',
        'muestreadas descendió un 38,4 % tras instalar el riego por goteo. No discute la medición',
        'ni los contadores, que considera fiables para lo que miden.'],
      ['Réplica al Informe Valdecorza. Segunda parte: el efecto rebote.',
        'Según los registros de la comunidad de regantes, la superficie regada del valle creció un',
        '27 % entre 2030 y 2032. Con más hectáreas en riego, la extracción total del acuífero',
        'aumentó un 6,1 % en el mismo periodo, pese al ahorro por hectárea.',
        'La réplica lo resume en una frase:',
        '«Un ahorro por hectárea no es un ahorro por cuenca.»',
        'El autor llama a este fenómeno efecto rebote y lo presenta como la explicación de la',
        'advertencia que el propio informe dejó sin explicar.'],
      ['Réplica al Informe Valdecorza. Tercera parte: la muestra.',
        'La réplica critica la muestra del informe: al excluir las parcelas de secano, el informe',
        'no pudo observar que muchas de ellas se transformaron en regadío después de 2029.',
        'Esas parcelas nuevas son precisamente las que explican el aumento de la superficie.',
        'La réplica recomienda instalar contadores en todos los pozos del valle antes de ampliar',
        'el riego por goteo, y no repetir la campaña con el mismo protocolo.'],
    ],
  },
};

async function writeDocumentPdf(directory, key) {
  const document = DOCUMENTS[key];
  const pdf = await PDFDocument.create();
  pdf.setTitle(document.title); pdf.setAuthor(document.author);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const lines of document.pages) pdf.addPage([612, 792]).drawText(lines.join('\n'), { x: 50, y: 730, size: 11, lineHeight: 17, font });
  const bytes = await pdf.save();
  const file = path.join(directory, `${key === 'A' ? 'informe-valdecorza-2031' : 'replica-informe-valdecorza'}.pdf`);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(file, bytes);
  return { key, title: document.title, file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

const QUESTIONS = [
  { name: 'literal_quote_with_page', text: '¿Qué frase exacta usa el Informe Valdecorza 2031 para advertir sobre el caudal extraído del acuífero, y en qué página aparece?',
    expected: 'La cita «El ahorro no se tradujo en una reducción del caudal extraído del acuífero.», página 2 del informe A.' },
  { name: 'comparison_between_documents', text: 'Compara lo que concluyen el Informe Valdecorza 2031 y la Réplica de Tomás Aranguren Vidal sobre el efecto del riego por goteo en el consumo de agua.',
    expected: 'A: el consumo por hectárea bajó un 38,4 % (p. 2) y recomienda ampliar el goteo (p. 3). B: acepta el 38,4 % (p. 1), pero la superficie regada creció un 27 % y la extracción total aumentó un 6,1 % (p. 2).' },
  { name: 'ideas_and_connections', text: 'Usando las ideas extraídas y sus conexiones, ¿qué relación hay entre la muestra del Informe Valdecorza 2031 y la crítica de la Réplica?',
    expected: 'A excluye deliberadamente las parcelas de secano (A p. 1); B critica esa exclusión porque esas parcelas pasaron a regadío y explican el aumento de superficie (B p. 3).' },
  { name: 'absent_data', text: '¿Qué nivel de nitratos se midió en el acuífero del Tormeral según estos documentos?',
    expected: 'Ninguno de los dos documentos da una medición de nitratos; la respuesta debe decirlo sin inventar una cifra ni afirmar que no se midió.' },
];

// ---------------------------------------------------------------- run

const startedAt = new Date().toISOString();
const ledgerAtStart = ledgerTotal();
if (!simulated) costGuard('start', 0.25);
const evidence = { description: 'End-to-end Research flow through the real interface of an isolated Nodus', mode: simulated ? 'simulated_provider' : 'real_provider',
  models: { chat: 'deepseek/deepseek-flash', extraction: 'deepseek/deepseek-flash', embeddings: 'openrouter/baai/bge-m3' }, startedAt, limitUsd, ledgerAtStart, steps: {} };

// A disposable Zotero with its own root, sandbox, profile, data directory and port.
const zoteroRoot = createResearchTestRoot();
const zoteroPort = await new Promise(resolve => { const server = http.createServer(); server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); }); });
const zoteroPolicy = macResearchSandbox(zoteroRoot, [zoteroPort]);
const zoteroProof = { ...verifyResearchSandbox(zoteroRoot, zoteroPolicy), allowedLoopbackPorts: [zoteroPort] };
assertIsolated(zoteroProof, 'Zotero root');
const documentB = await writeDocumentPdf(path.join(zoteroRoot, 'fixtures'), 'B');
const zotero = await launchIndependentZotero({ root: zoteroRoot, port: zoteroPort, policy: zoteroPolicy,
  records: [{ title: documentB.title, abstract: 'Réplica sintética de verificación.', file: documentB.file, sha256: documentB.sha256 }] });
evidence.zotero = { root: zoteroRoot, proof: zoteroProof, version: zotero.corpus.version, endpoint: zotero.endpoint, dataDirectory: zotero.corpus.dataDirectory,
  items: zotero.corpus.items.map(item => ({ key: item.key, attachment: item.attachment.key, sha256: item.attachment.sha256 })) };

const harness = await createResearchApp({ ...(simulated ? { provider: simulatedUpstream() } : { realProvider: { campaignRoot } }),
  extraPorts: [zoteroPort], extraEnv: { NODUS_ZOTERO_API_BASE: zotero.endpoint } });
assertIsolated(harness.proof, 'application root');
evidence.root = harness.root;
evidence.proof = harness.proof;
const artifacts = path.join(harness.root, 'artifacts');
const shot = async name => { const file = path.join(artifacts, `${name}.png`); await harness.page.screenshot({ path: file }); return file; };
const consoleLog = [], mainLog = [];
let watchdog;
try {
  if (!simulated) evidence.credentials = { imported: Boolean(await harness.importCredentials(credentialsRoot)) };
  const documentA = await writeDocumentPdf(path.join(harness.root, 'fixtures'), 'A');
  evidence.corpus = { A: { ...documentA, route: 'Nodus Global Library file' }, B: { ...documentB, route: 'disposable Zotero 10 import' },
    pages: Object.fromEntries(Object.entries(DOCUMENTS).map(([key, value]) => [key, value.pages])) };

  const { app, page } = await harness.launch();
  page.on('console', message => consoleLog.push({ at: Date.now(), type: message.type(), text: message.text().slice(0, 2000) }));
  page.on('pageerror', error => consoleLog.push({ at: Date.now(), type: 'pageerror', text: String(error).slice(0, 2000) }));
  app.process().stdout?.on('data', data => mainLog.push({ at: Date.now(), stream: 'stdout', text: String(data).slice(0, 4000) }));
  app.process().stderr?.on('data', data => mainLog.push({ at: Date.now(), stream: 'stderr', text: String(data).slice(0, 4000) }));
  if (!simulated) watchdog = setInterval(() => {
    if (ledgerTotal().usd >= limitUsd) { consoleLog.push({ at: Date.now(), type: 'watchdog', text: 'cost limit reached, closing' }); void harness.closeApp(); }
  }, 2000);

  // A new user's profile: onboarding done, no tutorials in the way, the authorized models.
  await page.evaluate(async ({ root }) => {
    const model = { provider: 'deepseek', model: 'deepseek-flash' };
    await window.nodus.updateSettings({ autoLightScan: false, autoDeepScanOnReadTag: false, autoSummaryAfterDeep: false,
      autoBackupFolder: `${root}/library`, onboardingComplete: true, basicsTutorialVersion: 99, recoverySetupVersion: 999, tourComplete: true,
      advancedTourComplete: true, uiLanguage: 'es', promptLanguage: 'es', mascotEnabled: false, mascotStyleChosen: true, reduceMotion: true,
      chatModel: model, deepResearchModel: model, synthesisModel: model, extractionModel: model, summaryModel: model, fusionModel: model,
      relationModel: model, documentProfileModel: model, documentAuditModel: model, embeddingProvider: 'openrouter', embeddingModel: 'baai/bge-m3', chatReasoning: 'off' });
  }, { root: harness.root });
  if (simulated) await harness.simulatedKeys(page);
  await page.evaluate(version => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    for (const key of ['nodus.mobileTeaserSeen.3.2.4', 'nodus.platformHighlightsSeen.2026-07', 'nodus.tutorialVideosAnnouncementSeen.2026-07',
      'nodus.pdfPresenterTutorialSeen.e2js_u-05OA', 'nodus.toolkitBetaGuideSeen.2.4.0', 'nodus.libraryTutorialSeen.v1']) localStorage.setItem(key, '1');
  }, JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../package.json'), 'utf8')).version);
  await page.reload();

  // 1. The welcome, accepted on the empty vault of a new profile.
  const welcome = page.getByTestId('research-preparation-welcome');
  await welcome.getByText('baai/bge-m3', { exact: true }).waitFor({ timeout: 60000 });
  const welcomeText = await welcome.textContent();
  await shot('01-welcome');
  await welcome.getByRole('button', { name: 'Sí, iniciar', exact: true }).click();
  await welcome.waitFor({ state: 'detached' });
  const policy = await page.evaluate(() => window.nodus.getResearchPreparationPolicy());
  assert.equal(policy.decision, 'accepted'); assert.equal(policy.futureAdditions, true);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('nodus:research-preparation', { detail: { manage: true } })));
  const futureBox = welcome.getByRole('checkbox', { name: 'Preparar nuevas incorporaciones', exact: true });
  await futureBox.waitFor();
  const futureChecked = await futureBox.isChecked();
  assert.equal(futureChecked, true, 'the manage view shows automatic future additions');
  await shot('02-manage-future-additions');
  await page.keyboard.press('Escape'); await welcome.waitFor({ state: 'detached' });
  evidence.steps.welcome = { promisesAutomaticIndexing: welcomeText.includes('Los documentos nuevos se indexarán automáticamente'), emptyVault: welcomeText.includes('0 obras'),
    clicked: 'Sí, iniciar', policy, manageViewFutureAdditionsChecked: futureChecked };

  // 2. Two new documents, neither prepared by hand.
  await page.locator('[data-tour="nav-library"]').click();
  await page.getByTestId('library-scope-global').click();
  await page.getByTestId('global-library-view').waitFor();
  const addToVault = async title => {
    await page.getByTestId('global-library-search').fill(title.slice(0, 30));
    await page.getByText(title, { exact: true }).first().click();
    await page.getByTestId('global-library-detail').waitFor();
    await page.getByTestId('add-library-item-to-vault').first().click();
    const dialog = page.getByTestId('global-library-vault-dialog');
    await dialog.getByText('Principal', { exact: true }).first().waitFor();
    await dialog.getByTestId('confirm-global-library-vault-link').click();
    await dialog.waitFor({ state: 'detached' });
    await page.getByTestId('global-library-search').fill('');
  };
  const addedAt = {};
  // A: a PDF file added through "Añadir → Añadir archivos"; only the OS file picker is stubbed.
  await app.evaluate(({ dialog }, filename) => { globalThis.harnessOpenDialog ??= dialog.showOpenDialog; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }); }, documentA.file);
  await page.getByTestId('library-add-menu-toggle').click();
  await page.getByTestId('add-library-files').click();
  const itemA = await waitFor(async () => (await page.evaluate(() => window.nodus.listGlobalLibraryItems({ limit: 50 }))).items.find(item => item.origin?.kind !== 'zotero'), { timeoutMs: 60000 });
  await app.evaluate(({ dialog }) => { if (globalThis.harnessOpenDialog) dialog.showOpenDialog = globalThis.harnessOpenDialog; });
  assert.ok(itemA, 'the file import created a Global Library item');
  await addToVault(itemA.title);
  addedAt.A = Date.now();
  // B: imported from the disposable Zotero through "Sincronizar Zotero".
  await page.getByTestId('open-zotero-global-import').click();
  const zoteroStart = page.getByTestId('start-zotero-global-import');
  await waitFor(async () => !(await zoteroStart.isDisabled()), { timeoutMs: 60000 });
  await shot('03-zotero-import-dialog');
  await zoteroStart.click();
  const itemB = await waitFor(async () => (await page.evaluate(() => window.nodus.listGlobalLibraryItems({ limit: 50 }))).items.find(item => item.title === DOCUMENTS.B.title), { timeoutMs: 120000 });
  assert.ok(itemB, 'the Zotero import brought the synthetic reply');
  // A completed import closes its dialog; anything else is reported, not dismissed.
  const importHeading = page.getByRole('heading', { name: 'Importar desde Zotero', exact: true });
  if (!await waitFor(async () => !(await importHeading.isVisible()), { timeoutMs: 30000 })) throw new Error(`the Zotero import dialog stayed open: ${await page.locator('body').innerText().then(text => text.slice(0, 600))}`);
  await addToVault(itemB.title);
  addedAt.B = Date.now();

  const ids = { A: itemA.id, B: itemB.id };
  const samples = [];
  const prepared = await waitFor(async () => {
    const inventory = await page.evaluate(() => window.nodus.getResearchPreparationInventory());
    const progress = await page.evaluate(() => window.nodus.getResearchPreparationProgress());
    const state = Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, inventory.documents.find(document => document.id === id)?.preparation ?? null]));
    const sample = { at: Date.now(), A: state.A && [state.A.text, state.A.lexical, state.A.embeddings, state.A.embedded], B: state.B && [state.B.text, state.B.lexical, state.B.embeddings, state.B.embedded],
      campaigns: progress.campaigns.map(campaign => ({ id: campaign.id, jobs: campaign.jobs.map(job => ({ documentId: job.documentId, state: job.state, stage: job.stage, error: job.error ?? null })) })) };
    if (JSON.stringify({ ...sample, at: 0 }) !== JSON.stringify({ ...samples.at(-1), at: 0 })) samples.push(sample);
    const failed = Object.values(state).find(value => value && ['failed'].includes(value.embeddings));
    if (failed) throw new Error(`preparation failed: ${JSON.stringify(failed)}`);
    return Object.values(state).every(value => value?.lexical === 'ready' && value?.embeddings === 'ready') && { inventory, progress, state };
  }, { timeoutMs: 600000, intervalMs: 1000 });
  assert.ok(prepared, `both documents indexed automatically; last sample ${JSON.stringify(samples.at(-1))}`);
  await page.locator('[data-queue-trigger]').click();
  const queuePanel = page.getByTestId('header-queue-panel');
  await queuePanel.waitFor();
  const preparationBar = queuePanel.getByTestId('preparation-queue-bar');
  await preparationBar.getByRole('button', { name: /Indexación/ }).click();
  await preparationBar.locator('[data-testid^="preparation-item-"]').first().waitFor();
  const queueRows = await queuePanel.locator('[data-testid^="preparation-"]').evaluateAll(elements => elements.map(element => ({ testId: element.getAttribute('data-testid'), text: element.textContent.trim().slice(0, 300) })));
  await shot('04-queue');
  await page.keyboard.press('Escape');
  evidence.steps.automaticIndexing = { ids, addedAt, manualPrepareCalled: false, samples, final: prepared.state,
    campaigns: prepared.progress.campaigns, embeddingSpaces: prepared.inventory.embeddingSpaces, queueRows };
  assert.ok(queueRows.some(row => row.testId.startsWith('preparation-item-') && row.text.includes(itemA.title.slice(0, 20))), 'the Queue lists document A');
  assert.ok(queueRows.some(row => row.testId.startsWith('preparation-item-') && row.text.includes(DOCUMENTS.B.title.slice(0, 20))), 'the Queue lists document B');

  // 3. Ideas, through the separate "Extraer ideas" action on each row of the vault's Library.
  if (!simulated) costGuard('ideas extraction', 0.4);
  const ledgerBeforeIdeas = ledgerTotal();
  await page.getByTestId('library-scope-vault').click();
  const works = await waitFor(async () => {
    const list = await page.evaluate(() => window.nodus.listWorks());
    return list.length >= 2 && list;
  }, { timeoutMs: 60000 });
  const workOf = Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, prepared.inventory.documents.find(document => document.id === id).workId]));
  for (const key of ['A', 'B']) {
    const title = works.find(work => work.nodus_id === workOf[key])?.title;
    const row = page.locator('[role="row"], tr, [data-testid^="library-row"], div').filter({ hasText: title }).filter({ has: page.getByRole('button', { name: 'Extraer ideas', exact: true }) }).last();
    await row.getByRole('button', { name: 'Extraer ideas', exact: true }).click();
  }
  await shot('05-extract-ideas');
  const extractionSamples = [];
  const extracted = await waitFor(async () => {
    const queue = await page.evaluate(() => window.nodus.getQueue());
    const list = await page.evaluate(() => window.nodus.listWorks());
    const status = Object.fromEntries(Object.entries(workOf).map(([key, id]) => { const work = list.find(item => item.nodus_id === id); return [key, { deep: work?.deep_status, ideas: work?.ideaCount }]; }));
    const sample = { at: Date.now(), queue: { total: queue.total, done: queue.done, failed: queue.failed, current: queue.current?.kind ?? null, maintenance: queue.maintenanceRunning, error: queue.maintenanceError ?? null, paused: queue.paused, pausedReason: queue.pausedReason }, status };
    if (JSON.stringify({ ...sample, at: 0 }) !== JSON.stringify({ ...extractionSamples.at(-1), at: 0 })) extractionSamples.push(sample);
    evidence.steps.ideas = { samples: extractionSamples };
    if (queue.paused) throw new Error(`the analysis queue paused during extraction: ${queue.pausedReason}`);
    const settled = !queue.current && !queue.maintenanceRunning && queue.items.every(item => !['pending', 'running'].includes(item.status));
    return settled && Object.values(status).every(value => ['done', 'failed', 'error'].includes(value.deep)) && { queue, list, status };
  }, { timeoutMs: 1500000, intervalMs: 3000 });
  assert.ok(extracted, `extraction settled; last ${JSON.stringify(extractionSamples.at(-1))}`);
  const ideasByWork = {};
  for (const [key, id] of Object.entries(workOf)) ideasByWork[key] = (await page.evaluate(id => window.nodus.getIdeasByWork(id, 100, 0), id)).ideas.map(idea => ({ id: idea.global_id ?? idea.id, label: idea.label, type: idea.type, statement: idea.statement ?? null }));
  const graph = await page.evaluate(() => window.nodus.getGraph('ideas'));
  const nodeWorks = new Map(graph.nodes.map(node => [node.id, node.workIds ?? []]));
  const crossEdges = graph.edges.filter(edge => {
    const from = nodeWorks.get(edge.source) ?? [], to = nodeWorks.get(edge.target) ?? [];
    return (from.includes(workOf.A) && to.includes(workOf.B)) || (from.includes(workOf.B) && to.includes(workOf.A));
  });
  const nodeLabel = new Map(graph.nodes.map(node => [node.id, node.label]));
  evidence.steps.ideas = { action: 'Extraer ideas (one row each)', workOf, status: extracted.status, samples: extractionSamples, queueFailed: extracted.queue.failed,
    ideasByWork, graph: { nodes: graph.nodes.length, edges: graph.edges.length, crossDocumentEdges: crossEdges.map(edge => ({ type: edge.type, basis: edge.basis, confidence: edge.confidence, from: nodeLabel.get(edge.source), to: nodeLabel.get(edge.target) })) },
    cost: { before: ledgerBeforeIdeas, after: ledgerTotal() } };
  // A simulated upstream returns no ideas; only a real provider is held to producing them.
  if (!simulated) assert.ok(ideasByWork.A.length > 0 && ideasByWork.B.length > 0, 'both documents yield ideas');

  // 4. Research Chat: a notebook over both documents, four questions through the composer.
  await page.getByRole('button', { name: 'Research chat', exact: true }).first().click();
  const control = page.getByTestId('research-notebooks');
  await control.waitFor({ timeout: 30000 });
  await control.getByRole('button', { name: /Nuevo cuaderno/ }).click();
  const editor = page.getByRole('dialog').filter({ has: page.locator('#research-notebook-title') });
  await editor.waitFor();
  await editor.getByRole('textbox', { name: 'Nombre', exact: true }).fill('Regadío del Tormeral');
  for (const title of [itemA.title, DOCUMENTS.B.title]) await editor.getByRole('checkbox', { name: new RegExp(title.slice(0, 24).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).check();
  await shot('06-notebook');
  await editor.getByRole('button', { name: 'Guardar', exact: true }).click();
  await editor.waitFor({ state: 'detached' });
  const notebook = (await page.evaluate(() => window.nodus.listResearchNotebooks?.()))?.find?.(item => item.name === 'Regadío del Tormeral') ?? null;
  evidence.steps.notebook = { name: 'Regadío del Tormeral', documents: [itemA.id, itemB.id], saved: notebook };

  // Record every stream event and every final response in the main process.
  await app.evaluate(({ ipcMain, webContents }) => {
    globalThis.researchStreamLog = [];
    globalThis.researchResponses = [];
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
        try { const response = await original(event, requestId, request); globalThis.researchResponses.push({ requestId, started, finished: Date.now(), response: JSON.parse(JSON.stringify(response)) }); return response; }
        catch (error) { globalThis.researchResponses.push({ requestId, started, finished: Date.now(), error: String(error?.message ?? error) }); throw error; }
      };
      recorded.recorded = true;
      handlers.set('research:chatStream', recorded);
    }
  });
  const questions = [];
  for (const [index, question] of QUESTIONS.entries()) {
    if (!simulated) costGuard(question.name, 0.2);
    const before = ledgerTotal();
    const responsesBefore = (await app.evaluate(() => globalThis.researchResponses.length));
    await page.getByRole('textbox', { name: /Pregunta al asistente/ }).fill(question.text);
    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
    const outcome = await waitFor(async () => {
      const responses = await app.evaluate(() => globalThis.researchResponses);
      return responses.length > responsesBefore && responses.at(-1);
    }, { timeoutMs: 600000, intervalMs: 500 });
    assert.ok(outcome, `${question.name}: the chat returned`);
    await page.getByRole('button', { name: 'Enviar', exact: true }).waitFor({ timeout: 60000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
    const stream = (await app.evaluate(() => globalThis.researchStreamLog)).filter(entry => entry.args[0] === outcome.requestId);
    const activity = stream.filter(entry => entry.channel.endsWith(':activity')).map(entry => ({ at: entry.at, ...entry.args[1] }));
    const panel = await page.locator('[data-testid="research-activity"] li[data-layer]').evaluateAll(elements => elements.map(element => ({ layer: element.dataset.layer, status: element.dataset.status, text: element.textContent.trim().slice(0, 160) })));
    const answer = outcome.response?.answer ?? '';
    const passageIds = [...new Set([...answer.matchAll(/nodus:\/\/passage\/([^\s)\]"<>]+)/g)].map(match => decodeURIComponent(match[1])))];
    const citations = [];
    for (const id of passageIds) {
      const passage = await page.evaluate(id => window.nodus.getPassage(id), id);
      citations.push(passage ? { id, document: passage.libraryItemId ?? passage.nodus_id, work: passage.nodus_id, page: passage.page_number, pageLabel: passage.page_label, text: passage.text.slice(0, 600) } : { id, unresolved: true });
    }
    const screenshot = await shot(`07-question-${index + 1}`);
    const after = ledgerTotal();
    const crashed = await page.getByText('Algo ha fallado en esta sección', { exact: true }).isVisible().catch(() => false);
    questions.push({ ...question, requestId: outcome.requestId, durationMs: outcome.finished - outcome.started, error: outcome.error ?? null, answer,
      stats: outcome.response?.stats ?? null, activity, panel, citations, screenshot, viewCrashed: crashed,
      cost: { calls: after.calls - before.calls, usd: after.usd - before.usd } });
    evidence.steps.questions = questions;
    if (crashed) throw new Error(`${question.name}: the Research Chat view crashed while showing the answer`);
  }

  // Logs: the pipeline log, the renderer console and the main process.
  evidence.logs = {
    pipeline: await page.evaluate(() => window.nodus.getPipelineLogs({ limit: 500 })).catch(error => ({ error: String(error) })),
    rendererErrors: consoleLog.filter(entry => ['error', 'pageerror', 'watchdog'].includes(entry.type)),
    rendererWarnings: consoleLog.filter(entry => entry.type === 'warning').length,
    mainStderr: mainLog.filter(entry => entry.stream === 'stderr').map(entry => entry.text).join('').slice(-20000),
  };
} finally {
  if (watchdog) clearInterval(watchdog);
  fs.writeFileSync(path.join(artifacts, 'renderer-console.json'), JSON.stringify(consoleLog, null, 2));
  fs.writeFileSync(path.join(artifacts, 'main-process.log'), mainLog.map(entry => `[${entry.stream}] ${entry.text}`).join(''));
  await harness.close();
  await zotero.stop();
  const ledgerAtEnd = ledgerTotal();
  const calls = ledgerFile ? JSON.parse(fs.readFileSync(ledgerFile, 'utf8')).calls.filter(call => call.reservedAt >= startedAt) : [];
  evidence.accounting = { ledgerAtStart, ledgerAtEnd, runCalls: calls.length, runUsd: calls.reduce((sum, call) => sum + (call.actualUsd ?? call.maximumUsd), 0),
    retainedReservations: calls.filter(call => call.actualUsd == null).length,
    tokens: { input: calls.reduce((sum, call) => sum + (call.inputTokens ?? 0), 0), output: calls.reduce((sum, call) => sum + (call.outputTokens ?? 0), 0) },
    byProvider: Object.values(calls.reduce((groups, call) => {
      const key = `${call.provider}/${call.model}`;
      groups[key] ??= { model: key, calls: 0, usd: 0 };
      groups[key].calls++; groups[key].usd += call.actualUsd ?? call.maximumUsd;
      return groups;
    }, {})) };
  evidence.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(artifacts, 'end-to-end.json'), JSON.stringify(evidence, null, 2));
  if (evidenceOut) fs.writeFileSync(evidenceOut, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ root: evidence.root, zoteroRoot, mode: evidence.mode, completed: Boolean(evidence.steps.questions), accounting: evidence.accounting }));
}
