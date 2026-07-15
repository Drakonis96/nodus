import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-model-settings-'));
const output = path.join(tmp, 'model-settings.mjs');

try {
  await build({ entryPoints: [path.join(root, 'shared/modelSettings.ts')], outfile: output, bundle: true, platform: 'node', format: 'esm' });
  const { GRANULAR_MODEL_KEYS, MODEL_SETTINGS_VERSION, migrateModelSettings } = await import(pathToFileURL(output).href);
  const a = { provider: 'openai', model: 'same-model' };
  const b = { provider: 'openrouter', model: 'different-model' };
  const base = () => Object.fromEntries([
    ['modelSettingsVersion', 0],
    ['modelSettingsMode', 'advanced'],
    ['synthesisModel', null],
    ...GRANULAR_MODEL_KEYS.map((key) => [key, null]),
  ]);

  const uniformLegacy = { ...base(), synthesisModel: a, extractionModel: a, summaryModel: a, chatModel: a };
  const uniform = migrateModelSettings(uniformLegacy);
  assert.equal(uniform.changed, true);
  assert.equal(uniform.settings.modelSettingsMode, 'basic', 'one distinct legacy model selects basic mode');
  assert.deepEqual(uniform.settings.synthesisModel, a, 'the uniform legacy model becomes the general model');
  for (const key of GRANULAR_MODEL_KEYS) assert.deepEqual(uniform.settings[key], a, `${key} must receive the basic model`);

  const inheritedLegacy = { ...base(), extractionModel: a, summaryModel: a };
  const inherited = migrateModelSettings(inheritedLegacy);
  assert.equal(inherited.settings.modelSettingsMode, 'basic');
  assert.deepEqual(inherited.settings.synthesisModel, a, 'a uniform override seeds a missing general model');

  const mixedLegacy = { ...base(), synthesisModel: a, summaryModel: b, chatModel: b };
  const mixed = migrateModelSettings(mixedLegacy);
  assert.equal(mixed.settings.modelSettingsMode, 'advanced', 'different legacy models select advanced mode');
  assert.deepEqual(mixed.settings.synthesisModel, a);
  assert.deepEqual(mixed.settings.summaryModel, b, 'advanced migration preserves granular choices');
  assert.deepEqual(mixed.settings.chatModel, b, 'vault-specific choices survive advanced migration');
  assert.deepEqual(mixed.settings.extractionModel, a, 'advanced migration materialises old empty selectors');

  const current = { ...mixed.settings, modelSettingsVersion: MODEL_SETTINGS_VERSION };
  const repeated = migrateModelSettings(current);
  assert.equal(repeated.changed, false, 'migration only runs once');
  assert.strictEqual(repeated.settings, current, 'current settings are not rewritten');

  const integrated = { provider: 'nodus', model: 'qwen3.5-0.8b-q4' };
  const gemini = { provider: 'gemini', model: 'gemini-3.1-flash-lite' };
  const brokenV23 = {
    ...base(),
    modelSettingsVersion: 2,
    modelSettingsMode: 'basic',
    synthesisModel: integrated,
    ...Object.fromEntries(GRANULAR_MODEL_KEYS.map((key) => [key, integrated])),
  };
  const recoveredV23 = migrateModelSettings(brokenV23, {
    chatModel: gemini,
    deepResearchModel: gemini,
    writingModel: integrated,
  });
  assert.equal(recoveredV23.settings.modelSettingsVersion, MODEL_SETTINGS_VERSION);
  assert.equal(recoveredV23.settings.modelSettingsMode, 'advanced', 'ignored 2.2 task choices restore advanced mode');
  assert.deepEqual(recoveredV23.settings.chatModel, gemini, 'the retired global chat choice is recovered');
  assert.deepEqual(recoveredV23.settings.deepResearchModel, gemini, 'the retired research choice is recovered');
  assert.deepEqual(recoveredV23.settings.writingModel, integrated);

  const intentionalAdvanced = { ...brokenV23, modelSettingsMode: 'advanced', chatModel: gemini };
  const preservedAdvanced = migrateModelSettings(intentionalAdvanced, { chatModel: a });
  assert.deepEqual(preservedAdvanced.settings.chatModel, gemini, 'a surviving differentiated setup is never replaced by stale evidence');

  console.log('simplified model settings migration tests passed');
} finally {
  await rm(tmp, { recursive: true, force: true });
}
