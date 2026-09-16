// Which engine writes a document's visual resources, against the real vault.
//
// A report records who wrote its prose, and that record used to decide who wrote its
// figures: a report written with a subscription provider that had since run out of
// quota kept asking that provider, and nothing in the app could say otherwise. This
// runs the real enrichment — real SQLite, real draft/immersion repositories, real
// settings, the built-in SVG Skill — and asserts the engine every call was handed.
//
// Only the built-in Skill runs, so the run needs no capability worker and no plugin:
// the subject here is the model, not the media. AI completions are scripted, so it
// spends nothing and needs no credentials.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { installRuntimeHooks, repoRoot as root } from './lib/tsRuntimeHooks.mjs';
import { draftFixture, immersionFixture, diagram } from './fixtures/document-visuals/samples.mjs';
const require = createRequire(import.meta.url);
if (!process.argv.includes('--visual-model')) {
  execFileSync(path.join(root, 'node_modules/.bin/electron'), [import.meta.filename, '--visual-model'], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' }, stdio: 'inherit', timeout: 180_000 });
  process.exit(0);
}
const electron = require('electron');
const { app, BrowserWindow } = electron;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-document-visual-model-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
installRuntimeHooks(profile, { BrowserWindow, utilityProcess: electron.utilityProcess, nativeImage: electron.nativeImage });
const load = file => require(path.join(root, file));

app.whenReady().then(async () => {
  const keeper = new BrowserWindow({ show: false });
  try {
    let mode = 'deep';
    const engines = [];
    const ai = load('electron/ai/aiClient.ts');
    ai.completeJson = async (args, _validate, model) => {
      engines.push(model);
      const { blocks } = JSON.parse(args.user);
      const block = blocks.find(candidate => candidate.field === (mode === 'deep' ? 'body' : 'overview') && !candidate.markdown.startsWith('#'));
      return [{ blockId: block.id, skillId: svg.id, brief: 'diagram', caption: 'Del ingreso a la consulta: tres etapas.', sources: [], layout: 'wide' }];
    };
    ai.completeText = async (args, model) => {
      engines.push(model);
      JSON.parse(args.user);
      return '```svg\n' + diagram(['Ingreso', 'Descripción', 'Consulta'], 'UN RECORRIDO DOCUMENTAL') + '\n```';
    };
    const options = load('electron/capabilities/documentCatalog.ts').listDocumentSkills();
    const svg = options.find(option => option.skill.builtin === 'svg')?.skill;
    assert.ok(svg, 'the built-in SVG Skill is installed');
    const policy = { enabled: true, skills: [{ skillId: svg.id, enabled: true, maxCalls: 1 }] };
    const service = load('electron/ai/documentVisuals.ts');
    const drafts = load('electron/db/writingDraftsRepo.ts');
    const immersions = load('electron/db/immersionRepo.ts');
    const settings = load('electron/db/settingsRepo.ts');
    const logging = load('electron/logging/pipelineLogCore.ts');
    const lines = []; logging.setPipelineLogSink({ record: entry => lines.push(entry) });
    const configured = { provider: 'gemini', model: 'gemini-3.1-flash-lite' };
    const general = { provider: 'deepseek', model: 'deepseek-flash' };
    const stored = { provider: 'codex', model: 'gpt-5.6-sol' };
    const requested = { provider: 'openrouter', model: 'xiaomi/mimo-v2.5' };
    const used = () => [...new Set(engines.map(engine => engine ? `${engine.provider}/${engine.model}` : 'unresolved'))];
    const deepReport = () => drafts.saveWritingWorkshopDraft({ draft: draftFixture(), model: stored });

    // The reported failure: the report was written by Codex, the reader has since moved
    // Deep Research to Gemini, and the figures must follow the reader.
    settings.updateSettings({ deepResearchModel: configured, immersionModel: general, synthesisModel: general });
    engines.length = 0;
    const legacy = await service.enrichDocumentVisuals({ kind: 'deep-research', id: deepReport().id }, policy);
    assert.equal(legacy.state, 'ready', 'the figure is produced');
    assert.deepEqual(used(), ['gemini/gemini-3.1-flash-lite'], 'resources follow the task’s current model, not the one the report remembers');

    // A model chosen for this run — the dialog’s picker — overrides the settings.
    engines.length = 0;
    await service.enrichDocumentVisuals({ kind: 'deep-research', id: deepReport().id }, policy, { model: requested });
    assert.deepEqual(used(), ['openrouter/xiaomi/mimo-v2.5'], 'an explicit choice wins');

    // With nothing configured at all, the report’s own engine is still better than nothing.
    settings.updateSettings({ deepResearchModel: null, immersionModel: null, synthesisModel: null });
    engines.length = 0;
    await service.enrichDocumentVisuals({ kind: 'deep-research', id: deepReport().id }, policy);
    assert.deepEqual(used(), ['codex/gpt-5.6-sol'], 'the stored model remains the last resort');

    // Each document kind follows its own task.
    settings.updateSettings({ deepResearchModel: configured, immersionModel: general, synthesisModel: configured });
    mode = 'immersion';
    engines.length = 0;
    await service.enrichDocumentVisuals({ kind: 'immersion', id: immersions.saveImmersionSession(immersionFixture(), stored).id }, policy);
    assert.deepEqual(used(), ['deepseek/deepseek-flash'], 'an immersion follows its own task, not Deep Research’s');

    // The line a failure leaves names the engine that ran it. Without it the reader sees
    // a quota belonging to a model they are not using, with nothing to explain it.
    mode = 'deep';
    const answerFor = ai.completeText;
    ai.completeText = async () => { throw new Error('You’ve hit your usage limit.'); };
    lines.length = 0;
    const failed = await service.enrichDocumentVisuals({ kind: 'deep-research', id: deepReport().id }, policy);
    ai.completeText = answerFor;
    assert.equal(failed.state, 'partial', 'a failed figure leaves the document partial');
    const recorded = lines.find(entry => entry.code === 'extract_failed');
    assert.ok(recorded, 'a failed figure is recorded');
    assert.equal(recorded.provider, 'gemini');
    assert.equal(recorded.model, 'gemini-3.1-flash-lite');

    console.log('Document visual model verification passed.');
    for (const win of BrowserWindow.getAllWindows()) win.destroy();
    load('electron/db/database.ts').closeDb(); fs.rmSync(profile, { recursive: true, force: true });
    app.exit(0);
  } catch (error) { console.error(error); keeper.destroy(); app.exit(1); }
});
