// Contract test for independent model routing. This is intentionally source-
// level: it guards the UI/backend wiring that previously let one header selector
// override unrelated scans, summaries and feature-local choices.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = async (relative) => readFile(path.join(root, relative), 'utf8');

const app = await source('src/App.tsx');
const header = app.slice(app.indexOf('{/* Top bar */}'), app.indexOf('{settings.demoMode'));
assert.ok(!header.includes('settings.defaultModel'), 'header must not depend on the legacy global model');
assert.ok(!header.includes('settings.favorites.map'), 'header must not render a model selector');
assert.ok(!app.includes('updateSettings({ defaultModel'), 'App must never mutate a global model');

for (const file of ['src/views/Library.tsx', 'src/views/CollectionsModal.tsx', 'src/views/ThemesModal.tsx']) {
  const text = await source(file);
  assert.ok(!text.includes('scanModel'), `${file} must not override workload models`);
  assert.ok(!text.includes("from '../components/ModelPicker'"), `${file} must not expose a scan-wide picker`);
}

const featureBindings = new Map([
  ['src/views/ResearchAssistantModal.tsx', 'chatModel'],
  ['src/views/DeepResearchView.tsx', 'deepResearchModel'],
  ['src/views/ImmersionView.tsx', 'immersionModel'],
  ['src/views/WritingWorkshopView.tsx', 'writingModel'],
  ['src/views/ArgumentMapView.tsx', 'argumentMapModel'],
  ['src/views/AuthorsView.tsx', 'authorModel'],
  ['src/views/StudyGuideView.tsx', 'studyModel'],
  ['src/views/TutorPanel.tsx', 'tutorModel'],
  ['src/views/HypothesisLabView.tsx', 'hypothesisModel'],
]);
for (const [file, key] of featureBindings) {
  const text = await source(file);
  assert.ok(text.includes(`useFeatureModel(settings, '${key}')`), `${file} must persist ${key}`);
}

const hook = await source('src/hooks/useFeatureModel.ts');
assert.ok(hook.includes("window.nodus.updateSettings({ [key]: next }"), 'feature choices must persist in vault settings');
assert.ok(hook.includes('settings[key] ?? settings.synthesisModel'), 'unselected features may seed from synthesis only');

const studyModelKeys = ['improveModel', 'questionGenModel', 'gradingModel', 'flashcardModel', 'transcriptionModel'];
const settingsTypes = await source('shared/types.ts');
const settingsRepo = await source('electron/db/settingsRepo.ts');
const appPrefs = await source('electron/db/appPrefs.ts');
for (const key of studyModelKeys) {
  assert.ok(settingsTypes.includes(`${key}: ModelRef | null`), `${key} must be typed independently`);
  assert.ok(settingsRepo.includes(`${key}: null`), `${key} must have a backwards-compatible default`);
  assert.ok(appPrefs.includes(`'${key}'`), `${key} must follow shared model preferences across vaults`);
  assert.ok(hook.includes(`'${key}'`), `${key} must be accepted by the feature-model hook`);
}
assert.ok(settingsTypes.includes("sttProvider: 'local' | 'openai'"), 'STT backend must be explicit');
assert.ok(settingsRepo.includes("sttProvider: 'local'"), 'STT must default to local processing');

const light = await source('electron/ai/lightScan.ts');
const deep = await source('electron/ai/deepScan.ts');
const summary = await source('electron/ai/summaryScan.ts');
const reprocess = await source('electron/ai/reprocessConnections.ts');
assert.ok(light.includes('getSettings().extractionModel'), 'light scans must use extractionModel');
assert.ok(deep.includes('settings.extractionModel') && deep.includes('settings.fusionModel'), 'deep scans must split extraction and fusion');
assert.ok(summary.includes('settings.summaryModel ?? settings.synthesisModel'), 'summaries must use summaryModel');
assert.ok(reprocess.includes('settings.extractionModel') && reprocess.includes('settings.fusionModel'), 'theme/relation reprocessing must split models');

const onboarding = await source('src/views/Onboarding.tsx');
assert.ok(!onboarding.includes('defaultModel: ref'), 'onboarding must not recreate the global selector');
for (const field of ['extractionModel', 'synthesisModel', 'summaryModel', 'fusionModel']) {
  assert.ok(onboarding.includes(`${field}: ref`), `onboarding must initialize ${field}`);
}

const allowedLegacyFiles = new Set([
  'shared/types.ts',
  'electron/db/settingsRepo.ts',
  'electron/export/exportImport.ts',
]);
const collect = async (directory) => {
  const out = [];
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) out.push(...(await collect(relative)));
    else if (/\.tsx?$/.test(entry.name)) out.push(relative);
  }
  return out;
};
for (const file of [...(await collect('src')), ...(await collect('electron')), ...(await collect('shared'))]) {
  if (allowedLegacyFiles.has(file)) continue;
  assert.ok(!(await source(file)).includes('defaultModel'), `${file} still uses the legacy global model`);
}

console.log('independent model selection contract test passed');
