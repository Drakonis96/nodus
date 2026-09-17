// Real repositories, shared skill executor, trusted worker, production figure renderer
// and PDF exporter. Only AI completions are scripted; no paid services or user profile.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { installRuntimeHooks, repoRoot as root } from './lib/tsRuntimeHooks.mjs';
import { draftFixture, immersionFixture, diagram, chart, cubeGltf } from './fixtures/document-visuals/samples.mjs';
const require = createRequire(import.meta.url);
if (!process.argv.includes('--visual-electron')) {
  execFileSync(path.join(root, 'node_modules/.bin/electron'), [import.meta.filename, '--visual-electron'], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' }, stdio: 'inherit', timeout: 180_000 });
  process.exit(0);
}
const electron = require('electron');
const { app, BrowserWindow } = electron;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-document-skills-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
installRuntimeHooks(profile, { BrowserWindow, utilityProcess: electron.utilityProcess, nativeImage: electron.nativeImage });
const load = file => require(path.join(root, file));
const out = path.join(root, 'artifacts/document-skills');
fs.mkdirSync(out, { recursive: true });
const id = 'visual-demo:figures';
const plugin = { id: 'visual-demo', version: '1.0.0', digest: 'a'.repeat(64) };
const tool = { id: 'render', description: 'Create a chart or a self-contained 3D model.', inputSchema: { type: 'object' }, artifactTypes: [], timeoutMs: 30_000, concurrency: 1, maxPerReply: 1, answerMode: 'replace-block', metered: false, billing: 'none' };
const provider = { id, source: 'plugin', version: '1.0.0', description: tool.description, plugin, tools: [tool], artifacts: [], hasSettings: false, chat: { priority: 100, requestProtocols: [{ fence: 'demo-view', toolId: 'render', maxPerReply: 1, answerMode: 'replace-block' }], legacyResults: [], hooks: {}, pendingLabel: { en: 'Preparing a figure', es: 'Preparando una figura' } } };
const paidId = 'visual-demo:paid';
const paidTool = { ...tool, id: 'review', description: 'Review prepared image candidates with the selected model.', metered: true, billing: 'per-call', maxPerReply: 3 };
const paidProvider = { id: paidId, source: 'plugin', version: '1.0.0', description: paidTool.description, plugin, tools: [paidTool], artifacts: [], hasSettings: false, chat: { priority: 100, requestProtocols: [], legacyResults: [], hooks: {}, pendingLabel: { en: 'Reviewing a figure', es: 'Revisando una figura' } } };
const entryPath = path.join(profile, 'plugin.cjs');
fs.writeFileSync(entryPath, `module.exports = host => ({
  async health(){return {status:'ready',dataVersion:1}},
  async invoke({input}) {
    if(input.mode==='over-budget') { await host.model.complete({prompt:'budget-probe'}); await host.model.complete({prompt:'budget-probe'}); }
    if(input.mode==='chart') return {view:{schemaVersion:1,summary:'Synthetic comparison',nodes:[${JSON.stringify(chart)}]}};
    const bytes = Uint8Array.from(Buffer.from('${cubeGltf().toString('base64')}', 'base64'));
    const saved = await host.models.store({bytes,mimeType:'model/gltf+json',name:'cube.gltf'});
    return {view:{schemaVersion:1,summary:'Cube',nodes:[{kind:'model',attachmentId:saved.attachmentId,title:'Una forma, varias perspectivas',alt:'Cubo tridimensional de color violeta.',name:'cube.gltf',mimeType:'model/gltf+json',bytes:bytes.length}]}};
  }, async renderArtifact(){return {schemaVersion:1,summary:'Demo',nodes:[]}}, async shutdown(){}
});`);
const runtime = { capabilityId: id, plugin, entryPath, permissions: { models: true }, manifest: { schemaVersion: 2, id: 'figures', provides: id, version: '1.0.0', description: tool.description, runtime: { kind: 'nodus-trusted-worker-v1', protocol: 1, entry: 'plugin.cjs' }, requires: [], tools: [tool], artifacts: [], permissions: { models: true } } };
let mode = 'deep';
let textCalls = 0;
let nestedCalls = 0;
let overBudget = false;
let zero = false;
app.whenReady().then(async () => {
const keeper = new BrowserWindow({ show: false });
try {
  const registry = load('electron/capabilities/registry.ts').capabilityRegistry();
  registry.providers.set(id, provider); registry.chatOrder.push(provider); registry.fences.set('demo-view', { provider, kind: 'request' });
  registry.providers.set(paidId, paidProvider);
  const plugins = load('electron/capabilities/pluginStoreV2.ts');
  const resolve = plugins.resolveTrustedCapability;
  plugins.resolveTrustedCapability = (...args) => args[0] === id ? runtime : resolve(...args);
  const workers = load('electron/capabilities/workerHost.ts');
  const acquire = workers.acquireCapabilityWorker;
  workers.acquireCapabilityWorker = (runtime, options) => acquire(runtime, { ...options, bootstrapPath: path.join(root, 'dist-electron/capabilityWorkerBootstrap.js') });
  const skillStore = load('electron/chatSkills.ts');
  const skills = skillStore.saveChatSkill({ name: 'Visual Lab · demo', description: tool.description, instructions: 'Return exactly a demo-view JSON fence with mode chart or model.', capabilities: [id], enabled: { assistant: true, nodi: false } });
  skillStore.saveChatSkill({ name: 'Vision Lab · paid', description: paidTool.description, instructions: 'Review host-prepared image candidates with the selected model.', capabilities: [paidId], enabled: { assistant: true, nodi: false } });
  const demo = skills.find(skill => skill.name === 'Visual Lab · demo');
  const svg = skills.find(skill => skill.builtin === 'svg');
  assert.ok(svg && demo);
  const options = load('electron/capabilities/documentCatalog.ts').listDocumentSkills();
  const policy = { enabled: true, skills: options.map(option => ({ skillId: option.skill.id, enabled: [svg.id, demo.id].includes(option.skill.id), maxCalls: option.skill.id === svg.id ? 4 : option.billing === 'none' ? 'auto' : null })) };
  const ai = load('electron/ai/aiClient.ts');
  // Every completion records the engine it was handed: which model writes a document's
  // resources is the thing this verification has to pin down, not an implementation detail.
  const engines = [];
  // What the planner asks for, when a case below needs a proposal the app must judge.
  let proposal = '';
  let selection = 'all';
  let plannerPrompt = '';
  /** Planning calls, so a repaired attempt can be counted instead of assumed. */
  let plannerCalls = 0;
  const proposalsFor = (blocks, refused) => {
    const paragraph = blocks.find(block => block.field === 'body' && !block.markdown.startsWith('#'));
    const heading = blocks.find(block => /^\s*#{1,6}\s+[^\n]+$/.test(block.markdown));
    const citing = blocks.find(block => block.markdown.includes('nodus://idea/g-0001'));
    // A batch can legitimately carry no citable block of its own — the tail of a long
    // document does — so a case cites evidence when its batch has it and stays honest
    // with `sources: []` when it does not.
    const target = citing ?? paragraph;
    const one = patch => [{ blockId: target.id, skillId: svg.id, brief: 'diagram', caption: 'Del ingreso a la consulta: tres etapas ilustrativas.', sources: [], layout: 'wide', ...patch }];
    // Told what it got wrong, the second attempt cites the link that is really there.
    if (proposal === 'repair-succeeds') return refused ? one({ blockId: citing.id, sources: ['nodus://idea/g-0001'] }) : one({ sources: ['nodus://idea/g-9999'] });
    if (proposal === 'cited') return one({ sources: citing ? ['nodus://idea/g-0001'] : [] });
    if (proposal === 'invented-source') return one({ sources: ['nodus://idea/g-9999'] });
    if (proposal === 'heading-only') return one({ blockId: heading.id });
    if (proposal === 'foreign-skill') return one({ skillId: 'no-such-skill' });
    return [];
  };
  ai.completeJson = async (args, _validate, model) => {
    engines.push(model);
    const payload = JSON.parse(args.user);
    // The global selection of a long document gets its own call, with proposals and no blocks.
    if (payload.proposals) return selection === 'one' ? [payload.proposals[0].id] : payload.proposals.map(item => item.id);
    plannerCalls++;
    if (proposal) { plannerPrompt = args.user; return proposalsFor(payload.blocks, payload.refused); }
    const { blocks } = payload;
    if (zero) return [];
    assert.ok(blocks, 'final editorial sees stable blocks');
    const first = blocks.find(block => block.field === (mode === 'deep' ? 'body' : 'overview') && !block.markdown.startsWith('#'));
    const second = mode === 'deep' ? blocks.find(block => block.markdown.startsWith('Para ilustrar')) : blocks.find(block => block.field.endsWith('-synthesis'));
    return [{ blockId: first.id, skillId: svg.id, brief: 'diagram', caption: mode === 'deep' ? 'Del ingreso a la consulta: tres etapas de un flujo documental ilustrativo.' : 'Observar, girar y explicar: una secuencia para explorar la forma.', sources: [], layout: 'wide' }, { blockId: second.id, skillId: demo.id, brief: mode === 'deep' ? 'chart' : 'model', caption: mode === 'deep' ? 'Cantidades sintéticas para comparar etapas: 12, 8 y 5 documentos.' : 'El mismo cubo puede observarse desde distintas perspectivas. Modelo interactivo disponible en la aplicación.', sources: [], layout: 'wide' }];
  };
  ai.completeText = async (args, model) => {
    engines.push(model);
    if(args.user==='budget-probe'){nestedCalls++;return 'ok';}
    textCalls++;
    const { figure } = JSON.parse(args.user);
    return figure === 'diagram' ? '```svg\n' + diagram(mode === 'deep' ? ['Ingreso','Descripción','Consulta'] : ['Observar','Girar','Explicar'], mode === 'deep' ? 'UN RECORRIDO DOCUMENTAL' : 'EXPLORAR UNA FORMA') + '\n```' : '```demo-view\n' + JSON.stringify({ mode: overBudget ? 'over-budget' : figure }) + '\n```';
  };
  const drafts = load('electron/db/writingDraftsRepo.ts');
  const immersions = load('electron/db/immersionRepo.ts');
  const service = load('electron/ai/documentVisuals.ts');
  const deep = drafts.saveWritingWorkshopDraft({ draft: draftFixture(), model: null });
  const immersion = immersions.saveImmersionSession(immersionFixture(), null);
  console.log('Enriching saved Deep Research…');
  const deepManifest = await service.enrichDocumentVisuals({ kind: 'deep-research', id: deep.id }, policy);
  console.log(deepManifest.figures.map(({ state, error }) => ({ state, error })));
  assert.equal(deepManifest.state, 'ready'); assert.equal(deepManifest.figures.length, 2);
  mode = 'immersion';
  console.log('Enriching saved Immersion…');
  const immersionManifest = await service.enrichDocumentVisuals({ kind: 'immersion', id: immersion.id }, policy);
  console.log(immersionManifest.figures.map(({ state, error }) => ({ state, error })));
  assert.equal(immersionManifest.state, 'ready'); assert.equal(immersionManifest.figures.length, 2);
  assert.equal(textCalls, 4);
  assert.equal(deepManifest.usage[svg.id].attempts, 1, 'max 4 is not a quota');
  assert.equal(drafts.getWritingWorkshopDraft(deep.id).draft.draftMarkdown, draftFixture().draftMarkdown);
  assert.deepEqual(immersions.getImmersionSession(immersion.id).progress, immersion.progress);
  assert.deepEqual(service.getDocumentVisuals(deepManifest.target).figures, deepManifest.figures);
  assert.equal(textCalls, 4, 'reopening never generates again');
  assert.notEqual(deepManifest.figures[1].owner, immersionManifest.figures[1].owner);
  for (const [prefix, manifest] of [['deep',deepManifest],['immersion',immersionManifest]]) for (const [index,figure] of manifest.figures.entries()) fs.writeFileSync(path.join(out, `${prefix}-figure-${index+1}.png`), Buffer.from(figure.poster.split(',')[1], 'base64'));
  fs.writeFileSync(path.join(out, 'samples.json'), JSON.stringify({ deep, immersion, deepManifest, immersionManifest, options, policy, modelBase64: cubeGltf().toString('base64') }));
  assert.equal(options.find(option => option.skill.name === 'Image Atelier')?.billing, 'per-call', 'Image Atelier stays the only metered document Skill');
  assert.equal(options.find(option => option.skill.name === 'Vision Lab · paid')?.billing, 'none', 'a paid capability tool does not make its Skill metered in documents');
  const pdf = load('electron/export/professionalReportPdf.ts').professionalReportPdf;
  const deepInput = load('electron/export/writingWorkshopExport.ts').buildDeepResearchPdfInput(deep.draft, deep.id);
  const immersionInput = load('electron/export/immersionExport.ts').buildImmersionPdfInput(immersion);
  const pdfOut = path.join(root, 'output/pdf'); fs.mkdirSync(pdfOut, { recursive: true });
  for (const [name, input] of [['deep-research-skills',deepInput], ['immersion-skills',immersionInput]]) {
    const bytes = await pdf(input); assert.equal(bytes.subarray(0,5).toString(), '%PDF-');
    fs.writeFileSync(path.join(pdfOut, `${name}.pdf`), bytes);
  }
  const removed = service.removeDocumentFigure(deepManifest.target, deepManifest.figures[0].id);
  assert.equal(removed.figures.length, 1);
  assert.equal(service.undoVisualEnrichment(deepManifest.target).figures.length, 2);
  assert.equal(service.getDocumentVisuals(deepManifest.target).usage[svg.id].attempts, 1);
  const blank = drafts.saveWritingWorkshopDraft({ draft: draftFixture(), model: null });
  zero = true;
  const noFigures = await service.enrichDocumentVisuals({ kind: 'deep-research', id: blank.id }, policy);
  assert.equal(noFigures.state, 'ready'); assert.equal(noFigures.figures.length, 0); assert.equal(textCalls, 4);
  // A paid worker attempts two nested model requests under a maximum of one.
  // Only the first reaches the (scripted) provider; retry and undo cannot reset spend.
  zero = false; overBudget = true; mode = 'deep'; tool.billing = 'per-call'; runtime.permissions.model = true;
  const paidPolicy = {enabled:true,skills:[{skillId:demo.id,enabled:true,maxCalls:1}]};
  const paidDraft = drafts.saveWritingWorkshopDraft({draft:draftFixture(),model:null});
  const paidTarget = {kind:'deep-research',id:paidDraft.id};
  const paidResult = await service.enrichDocumentVisuals(paidTarget,paidPolicy);
  assert.equal(paidResult.state,'partial'); assert.equal(nestedCalls,1);
  assert.equal(paidResult.usage[demo.id].paidCalls,1);
  await service.enrichDocumentVisuals(paidTarget,paidPolicy,{retry:true}); assert.equal(nestedCalls,1);
  service.undoVisualEnrichment(paidTarget); service.undoVisualEnrichment(paidTarget);
  const afterUndo=await service.enrichDocumentVisuals(paidTarget,paidPolicy); assert.equal(nestedCalls,1); assert.equal(afterUndo.usage[demo.id].attempts,1);
  // A failed capture keeps the produced resource. Retrying only the capture costs no calls.
  overBudget = false; mode = 'deep';
  const snapshots = load('electron/capabilities/documentSnapshot.ts'); const snapshot = snapshots.snapshotDocumentFigure;
  snapshots.snapshotDocumentFigure = async () => { throw new Error('Synthetic capture interruption'); };
  const interrupted = drafts.saveWritingWorkshopDraft({draft:draftFixture(),model:null});
  const interruptedTarget = {kind:'deep-research',id:interrupted.id};
  const interruptedPolicy = {enabled:true,skills:[{skillId:svg.id,enabled:true,maxCalls:1}]};
  const incomplete = await service.enrichDocumentVisuals(interruptedTarget, interruptedPolicy);
  assert.equal(incomplete.state,'partial'); assert.ok(incomplete.figures[0].view);
  const callsBeforeCaptureRetry = textCalls; snapshots.snapshotDocumentFigure = snapshot;
  const recovered = await service.enrichDocumentVisuals(interruptedTarget,interruptedPolicy,{retry:true});
  assert.equal(recovered.state,'ready'); assert.equal(textCalls,callsBeforeCaptureRetry);
  // ── Which engine writes the resources of a report somebody else wrote ──────────
  // A report records who wrote its prose. That must not decide who writes its figures:
  // a report written with a subscription provider that has since run out of quota kept
  // asking that provider, and nothing in the app could say otherwise.
  const settings = load('electron/db/settingsRepo.ts');
  const logging = load('electron/logging/pipelineLogCore.ts');
  const lines = []; logging.setPipelineLogSink({ record: entry => lines.push(entry) });
  const configured = { provider: 'gemini', model: 'gemini-3.1-flash-lite' };
  const general = { provider: 'deepseek', model: 'deepseek-flash' };
  const stored = { provider: 'codex', model: 'gpt-5.6-sol' };
  const requested = { provider: 'openrouter', model: 'xiaomi/mimo-v2.5' };
  const enginesUsed = () => [...new Set(engines.map(engine => engine ? `${engine.provider}/${engine.model}` : 'unresolved'))];
  const oneFigurePolicy = { enabled: true, skills: [{ skillId: svg.id, enabled: true, maxCalls: 1 }] };
  mode = 'deep';
  settings.updateSettings({ deepResearchModel: configured, immersionModel: general, synthesisModel: general });
  const legacyReport = drafts.saveWritingWorkshopDraft({ draft: draftFixture(), model: stored });
  engines.length = 0;
  const legacyTarget = { kind: 'deep-research', id: legacyReport.id };
  const legacyRun = await service.enrichDocumentVisuals(legacyTarget, oneFigurePolicy);
  assert.equal(legacyRun.state, 'ready');
  assert.deepEqual(enginesUsed(), ['gemini/gemini-3.1-flash-lite'], 'resources follow the task’s current model, not the one the report remembers');
  settings.updateSettings({ deepResearchModel: null, immersionModel: null, synthesisModel: null });
  const orphanReport = drafts.saveWritingWorkshopDraft({ draft: draftFixture(), model: stored });
  engines.length = 0;
  await service.enrichDocumentVisuals({ kind: 'deep-research', id: orphanReport.id }, oneFigurePolicy);
  assert.deepEqual(enginesUsed(), ['codex/gpt-5.6-sol'], 'with nothing configured the report’s own engine still runs');
  settings.updateSettings({ deepResearchModel: configured, immersionModel: general, synthesisModel: configured });
  const chosenReport = drafts.saveWritingWorkshopDraft({ draft: draftFixture(), model: stored });
  engines.length = 0;
  await service.enrichDocumentVisuals({ kind: 'deep-research', id: chosenReport.id }, oneFigurePolicy, { model: requested });
  assert.deepEqual(enginesUsed(), ['openrouter/xiaomi/mimo-v2.5'], 'a model chosen for this run overrides the settings');
  mode = 'immersion';
  const ownTask = immersions.saveImmersionSession(immersionFixture(), stored);
  engines.length = 0;
  await service.enrichDocumentVisuals({ kind: 'immersion', id: ownTask.id }, oneFigurePolicy);
  assert.deepEqual(enginesUsed(), ['deepseek/deepseek-flash'], 'an immersion follows its own task, not Deep Research’s');
  // The line a failure leaves must name that engine: it is the only place a reader can
  // see that the quota being reported belongs to a model they are not using any more.
  mode = 'deep';
  const failingReport = drafts.saveWritingWorkshopDraft({ draft: draftFixture(), model: stored });
  const answerFor = ai.completeText;
  ai.completeText = async () => { throw new Error('You’ve hit your usage limit.'); };
  lines.length = 0;
  const failedRun = await service.enrichDocumentVisuals({ kind: 'deep-research', id: failingReport.id }, oneFigurePolicy);
  ai.completeText = answerFor;
  assert.equal(failedRun.state, 'partial');
  const recorded = lines.find(entry => entry.code === 'extract_failed');
  assert.ok(recorded, 'a failed figure is recorded');
  assert.equal(recorded.provider, 'gemini');
  assert.equal(recorded.model, 'gemini-3.1-flash-lite');
  // ── A proposal the app refuses, and a document that needed none ────────────────
  // Enabling skills is permission, never obligation, so a run may legitimately end with
  // zero figures. What this measures is whether a refused proposal is told apart from
  // that, or whether both reach the reader as the same sentence.
  const severalSkills = { enabled: true, skills: [{ skillId: svg.id, enabled: true, maxCalls: 2 }, { skillId: demo.id, enabled: true, maxCalls: 1 }] };
  const linkedDraft = () => {
    const draft = draftFixture();
    draft.draftMarkdown = draft.draftMarkdown.replace('El primer paso registra la procedencia', 'Como sostiene [Pérez (1999)](nodus://idea/g-0001), el primer paso registra la procedencia');
    return draft;
  };
  const outcomes = {};
  const targets = {};
  for (const kindOfProposal of ['cited', 'invented-source', 'heading-only', 'foreign-skill', 'none', 'repair-succeeds']) {
    proposal = kindOfProposal;
    const report = drafts.saveWritingWorkshopDraft({ draft: linkedDraft(), model: null });
    targets[kindOfProposal] = { kind: 'deep-research', id: report.id };
    lines.length = 0; plannerCalls = 0;
    const run = await service.enrichDocumentVisuals(targets[kindOfProposal], severalSkills);
    outcomes[kindOfProposal] = { state: run.state, figures: run.figures.length, reason: run.figures[0]?.error ?? run.error ?? null, recorded: lines.map(entry => entry.code), discarded: (run.discarded ?? []).map(item => item.reason), log: lines.map(entry => ({ code: entry.code, level: entry.level, message: entry.message })), planning: plannerCalls };
    console.log('proposal:', kindOfProposal, JSON.stringify(outcomes[kindOfProposal]));
  }
  proposal = '';
  assert.equal(outcomes.cited.figures, 1, 'a proposal citing evidence in its own block is used');
  assert.deepEqual(outcomes.cited.discarded, [], 'and nothing is refused');
  assert.equal(outcomes.none.figures, 0, 'a document that needs no figures is allowed to stay without them');
  assert.deepEqual(outcomes.none.discarded, [], 'a document that needed none refuses none');
  assert.deepEqual(outcomes.none.recorded, [], 'and stays out of the log: there is nothing to explain');
  // Every refusal is named, in the document and in the log, with the motive that caused it.
  assert.deepEqual(outcomes['invented-source'].discarded, ['source-not-in-block']);
  assert.deepEqual(outcomes['heading-only'].discarded, ['heading-block']);
  assert.deepEqual(outcomes['foreign-skill'].discarded, ['skill-not-enabled']);
  for (const kind of ['invented-source', 'heading-only', 'foreign-skill']) {
    assert.equal(outcomes[kind].figures, 0);
    assert.deepEqual(outcomes[kind].recorded, ['figure_skipped'], `${kind} must be recorded, not swallowed`);
    const [line] = outcomes[kind].log;
    assert.equal(line.level, 'warning', 'a run that kept no figure must be a warning, not a quiet success');
    assert.equal(line.code, 'figure_skipped');
    assert.equal(line.message.id, 'figuresDiscarded');
    assert.equal(line.message.params.count, 1);
    assert.match(line.message.params.reason.id, /^reason[A-Z]/);
  }
  assert.equal(outcomes['invented-source'].log[0].message.params.reason.id, 'reasonSourceNotInBlock');
  assert.equal(outcomes['heading-only'].log[0].message.params.reason.id, 'reasonHeadingBlock');
  assert.equal(outcomes['foreign-skill'].log[0].message.params.reason.id, 'reasonSkillNotEnabled');
  // ── The one repaired attempt, and nothing more than one ────────────────────────
  // Told what it got wrong, the planner can rescue the figure the document was about to
  // lose; told the same thing twice, it ends the run. Either way it is exactly one extra
  // call, and only when the document would otherwise keep nothing.
  assert.equal(outcomes['repair-succeeds'].figures, 1, 'a repaired attempt can produce the figure the first pass refused');
  assert.deepEqual(outcomes['repair-succeeds'].discarded, [], 'and the refusal that explained its absence is gone');
  assert.deepEqual(outcomes['repair-succeeds'].recorded, [], 'so a rescued run has nothing to explain');
  assert.equal(outcomes['repair-succeeds'].planning, 2, 'a repaired attempt is one call, not a loop');
  assert.equal(outcomes['invented-source'].planning, 2, 'a planner that repeats the mistake is asked exactly once more');
  assert.deepEqual(outcomes['invented-source'].discarded, ['source-not-in-block']);
  assert.equal(outcomes.cited.planning, 1, 'a run that kept its figure buys no extra call');
  assert.equal(outcomes.none.planning, 1, 'and neither does a document that refused nothing: there is nothing to repair');
  for (const kind of ['heading-only', 'foreign-skill']) assert.equal(outcomes[kind].planning, 2, `${kind} is the planner's mistake to correct`);
  // ── Retry: it plans again only when there is nothing to preserve ───────────────
  proposal = 'cited';
  plannerCalls = 0;
  const replanned = await service.enrichDocumentVisuals(targets['invented-source'], severalSkills, { retry: true });
  assert.equal(plannerCalls, 1, 'a retry with no figures kept must plan again, not do nothing');
  assert.equal(replanned.figures.length, 1, 'and can produce the figure the first run lacked');
  assert.deepEqual(replanned.discarded, [], 'the new plan replaces the refusal that explained the absence');
  plannerCalls = 0;
  const preserved = await service.enrichDocumentVisuals(targets.cited, severalSkills, { retry: true });
  assert.equal(plannerCalls, 0, 'a retry with finished figures plans nothing: that is what retry is for');
  assert.equal(preserved.figures.length, 1, 'and keeps them');
  assert.equal(preserved.figures[0].state, 'ready');
  assert.deepEqual(service.getDocumentVisuals(targets['invented-source'])?.discarded ?? [], [], 'and a rescued document reads back without the refusal that is no longer true');
  proposal = '';
  // The refusal has to survive the reopen, or the reader loses the explanation again the
  // moment they leave the document: this reads back through the store's own validation.
  const reopened = service.getDocumentVisuals(targets['heading-only']);
  assert.deepEqual(reopened?.discarded?.map(item => item.reason), ['heading-block'], 'the refusals travel with the manifest');
  assert.equal(reopened?.figures.length, 0);
  assert.equal(reopened?.discarded?.[0].blockId.length > 0, true, 'and name the block they were about');
  // Every skill the reader enabled is offered to the planner, with its ceiling, and no
  // other: a skill that never reaches the catalogue can never produce a resource.
  const catalogue = JSON.parse(plannerPrompt).skills;
  assert.deepEqual(catalogue.map(item => item.id).sort(), [svg.id, demo.id].sort(), 'the enabled skills are exactly what the planner is offered');
  assert.ok(catalogue.every(item => Number.isSafeInteger(item.maximum)), 'each offered skill carries its ceiling');
  const disabled = options.find(option => ![svg.id, demo.id].includes(option.skill.id));
  assert.ok(disabled && !catalogue.some(item => item.id === disabled.skill.id), 'a skill left disabled is never offered');
  // The planner is handed the links each block may cite, so "exact source" is a choice
  // from a list instead of a guess it has one unretried attempt to get right.
  const offered = JSON.parse(plannerPrompt).blocks.map(block => block.sources);
  assert.ok(offered.some(sources => sources.includes('nodus://idea/g-0001')), 'the block that carries the link offers it');
  assert.ok(offered.every(sources => Array.isArray(sources)), 'every block offers a list, empty when it cites nothing');
  // A long report is planned in batches and then chosen globally. A proposal the
  // selection leaves out is the fourth way a figure disappears without a word.
  proposal = 'cited'; selection = 'one';
  const longDraft = () => { const draft = linkedDraft(); draft.draftMarkdown = Array.from({ length: 12 }, () => draft.draftMarkdown).join('\n\n'); return draft; };
  const longReport = drafts.saveWritingWorkshopDraft({ draft: longDraft(), model: null });
  lines.length = 0;
  const longRun = await service.enrichDocumentVisuals({ kind: 'deep-research', id: longReport.id }, severalSkills);
  console.log('long document:', JSON.stringify({ error: longRun.error, figures: longRun.figures.length, discarded: (longRun.discarded ?? []).map(item => item.reason), recorded: lines.map(entry => `${entry.code}/${entry.level}`) }));
  assert.ok(longRun.blocks.length > 29 && longRun.figures.length === 1, 'a long document is planned in batches and keeps what the selection chose');
  assert.deepEqual((longRun.discarded ?? []).map(item => item.reason), ['not-selected'], 'the proposals the global selection left out are recorded');
  assert.deepEqual(lines.map(entry => entry.level), ['info'], 'a run that kept a figure records the same motive quietly');
  assert.equal(lines[0].message.id, 'figuresDiscarded');
  assert.deepEqual(lines[0].message.params, { count: 1, reason: { id: 'reasonDiscardNotSelected' } });
  proposal = ''; selection = 'all';
  await workers.stopCapabilityWorkers();
  fs.writeFileSync(path.join(out, 'verification.json'), JSON.stringify({ passed: true, textCalls, isolatedProfile: true, zeroFigures: true, usageCeiling: true, reopensWithoutCalls: true, originalsUnchanged: true, undo: true, paidOverflowBlocked: true, captureRetryWithoutCalls: true, resourcesFollowTheConfiguredModel: true, explicitModelWins: true, storedModelOnlyAsFallback: true, perTaskEngines: true, failuresNameTheirEngine: true, enabledSkillsReachThePlanner: true, citedProposalUsed: true, zeroFigureDocumentAllowed: true, refusalsAreNamed: true, refusalsReachTheLog: true, silentSelectionRecorded: true, plannerOfferedExactSources: true, oneRepairedAttempt: true, repairedRefusalsSuperseded: true, retryPlansWhenNothingKept: true, proposalOutcomes: outcomes }, null, 2));
  console.log('Document skills verification passed.');
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  load('electron/db/database.ts').closeDb(); fs.rmSync(profile,{recursive:true,force:true});
  app.exit(0);
} catch (error) { console.error(error); keeper.destroy(); app.exit(1); }

});
