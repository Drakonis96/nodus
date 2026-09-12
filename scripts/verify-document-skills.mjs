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
  const plugins = load('electron/capabilities/pluginStoreV2.ts');
  const resolve = plugins.resolveTrustedCapability;
  plugins.resolveTrustedCapability = (...args) => args[0] === id ? runtime : resolve(...args);
  const workers = load('electron/capabilities/workerHost.ts');
  const acquire = workers.acquireCapabilityWorker;
  workers.acquireCapabilityWorker = (runtime, options) => acquire(runtime, { ...options, bootstrapPath: path.join(root, 'dist-electron/capabilityWorkerBootstrap.js') });
  const skillStore = load('electron/chatSkills.ts');
  const skills = skillStore.saveChatSkill({ name: 'Visual Lab · demo', description: tool.description, instructions: 'Return exactly a demo-view JSON fence with mode chart or model.', capabilities: [id], enabled: { assistant: true, nodi: false } });
  const demo = skills.find(skill => skill.name === 'Visual Lab · demo');
  const svg = skills.find(skill => skill.builtin === 'svg');
  assert.ok(svg && demo);
  const options = load('electron/capabilities/documentCatalog.ts').listDocumentSkills();
  const policy = { enabled: true, skills: options.map(option => ({ skillId: option.skill.id, enabled: [svg.id, demo.id].includes(option.skill.id), maxCalls: option.skill.id === svg.id ? 4 : option.billing === 'none' ? 'auto' : null })) };
  const ai = load('electron/ai/aiClient.ts');
  ai.completeJson = async args => {
    if (zero) return [];
    const { blocks } = JSON.parse(args.user);
    assert.ok(blocks, 'final editorial sees stable blocks');
    const first = blocks.find(block => block.field === (mode === 'deep' ? 'body' : 'overview') && !block.markdown.startsWith('#'));
    const second = mode === 'deep' ? blocks.find(block => block.markdown.startsWith('Para ilustrar')) : blocks.find(block => block.field.endsWith('-synthesis'));
    return [{ blockId: first.id, skillId: svg.id, brief: 'diagram', caption: mode === 'deep' ? 'Del ingreso a la consulta: tres etapas de un flujo documental ilustrativo.' : 'Observar, girar y explicar: una secuencia para explorar la forma.', sources: [], layout: 'wide' }, { blockId: second.id, skillId: demo.id, brief: mode === 'deep' ? 'chart' : 'model', caption: mode === 'deep' ? 'Cantidades sintéticas para comparar etapas: 12, 8 y 5 documentos.' : 'El mismo cubo puede observarse desde distintas perspectivas. Modelo interactivo disponible en la aplicación.', sources: [], layout: 'wide' }];
  };
  ai.completeText = async args => {
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
  await workers.stopCapabilityWorkers();
  fs.writeFileSync(path.join(out, 'verification.json'), JSON.stringify({ passed: true, textCalls, isolatedProfile: true, zeroFigures: true, usageCeiling: true, reopensWithoutCalls: true, originalsUnchanged: true, undo: true, paidOverflowBlocked: true, captureRetryWithoutCalls: true }, null, 2));
  console.log('Document skills verification passed.');
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  load('electron/db/database.ts').closeDb(); fs.rmSync(profile,{recursive:true,force:true});
  app.exit(0);
} catch (error) { console.error(error); keeper.destroy(); app.exit(1); }

});
