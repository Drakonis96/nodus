// The reasoning level a Codex model runs at, chosen from either the Providers tab (a
// row per model) or the Models tab (beside the picker of each role). Both screens must
// land on the same value, which is only true because both go through one writer and
// key the map by MODEL, never by role. Drives the real shared module.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-codex-reasoning-'));
const outfile = path.join(outDir, 'codexReasoning.mjs');
await build({
  entryPoints: [path.join(repoRoot, 'shared/codexReasoning.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
});
const { codexReasoningCatalog, reasoningChoiceFor, withCodexReasoning } = await import(pathToFileURL(outfile).href);

// Shaped like what listModels('codex') actually returns, taken from the live catalogue.
const MODELS = [
  {
    id: 'gpt-5.6-luna',
    name: 'gpt-5.6-luna',
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: 'Fast responses with lighter reasoning' },
      { reasoningEffort: 'medium', description: 'Balances speed and reasoning depth' },
      { reasoningEffort: 'high', description: 'Greater reasoning depth' },
    ],
    defaultReasoningEffort: 'medium',
  },
  { id: 'sin-niveles', name: 'sin-niveles', supportedReasoningEfforts: [] },
  { id: 'sin-campo', name: 'sin-campo' },
];

test('only models that publish levels enter the catalogue', () => {
  const catalog = codexReasoningCatalog(MODELS);
  assert.deepEqual(Object.keys(catalog), ['gpt-5.6-luna'], 'a model without levels must not get an entry');
  assert.equal(catalog['gpt-5.6-luna'].fallback, 'medium', 'the default level is what «Predeterminado» resolves to');
  assert.equal(catalog['gpt-5.6-luna'].supported.length, 3);
});

test('a selector is offered only where a level can actually be chosen', () => {
  const catalog = codexReasoningCatalog(MODELS);
  assert.ok(reasoningChoiceFor(catalog, { provider: 'codex', model: 'gpt-5.6-luna' }));
  assert.equal(reasoningChoiceFor(catalog, { provider: 'codex', model: 'sin-niveles' }), null);
  assert.equal(reasoningChoiceFor(catalog, { provider: 'codex', model: 'desconocido' }), null);
  assert.equal(reasoningChoiceFor(catalog, { provider: 'gemini', model: 'gemini-3.1-flash-lite' }), null,
    'no other provider publishes reasoning levels, so no other provider gets a selector');
  assert.equal(reasoningChoiceFor(catalog, null), null);
  assert.equal(reasoningChoiceFor(null, { provider: 'codex', model: 'gpt-5.6-luna' }), null,
    'before the catalogue loads there is nothing to offer');
});

test('the level belongs to the model, so both screens agree', () => {
  // Providers writes it from the model row; Models writes it from a role's picker.
  const fromProviders = withCodexReasoning({}, 'gpt-5.6-luna', 'low');
  const fromModels = withCodexReasoning({}, 'gpt-5.6-luna', 'low');
  assert.deepEqual(fromProviders, fromModels, 'the same choice must produce the same stored map');
  assert.deepEqual(fromProviders, { 'gpt-5.6-luna': 'low' });

  // Two roles on the same model share one entry: changing it in one changes it in both.
  const shared = withCodexReasoning(fromModels, 'gpt-5.6-luna', 'high');
  assert.deepEqual(shared, { 'gpt-5.6-luna': 'high' }, 'the map is keyed by model, never by role');

  // Back to «Predeterminado» clears the entry instead of storing a sentinel, so the
  // model keeps following its own recommendation when Codex changes it.
  assert.deepEqual(withCodexReasoning(shared, 'gpt-5.6-luna', null), {});
  assert.deepEqual(withCodexReasoning(undefined, 'otro', 'max'), { otro: 'max' }, 'an unset map is not a crash');

  const before = { a: 'low' };
  withCodexReasoning(before, 'b', 'high');
  assert.deepEqual(before, { a: 'low' }, 'the stored settings object is never mutated in place');
});

test('every model picker that drives a role carries its reasoning level', async () => {
  const [settings, providers, picker] = await Promise.all([
    readFile(path.join(repoRoot, 'src/views/Settings.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src/views/ProvidersSettings.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src/components/ModelPicker.tsx'), 'utf8'),
  ]);

  for (const role of ['synthesisModel', 'extractionModel', 'visionModel', 'summaryModel', 'fusionModel', 'nodiModel']) {
    const row = settings.match(new RegExp(`<ModelWithReasoning[^>]*settings\\.${role}[^>]*>`));
    assert.ok(row, `the ${role} picker must offer the reasoning level next to it`);
  }
  assert.match(settings, /<ModelWithReasoning[^>]*settings\[key\]/, 'per-vault overrides carry it too');
  assert.match(settings, /<ModelWithReasoning[^>]*settings\[item\.key\]/, 'the study vault overrides carry it too');

  // One writer, or the two screens drift apart the first time one of them is edited.
  assert.match(providers, /withCodexReasoning\(settings\.codexReasoningEfforts, model, effort\)/);
  assert.equal(/function codexReasoningLabel/.test(providers), false,
    'the level labels must come from the shared component, not a second private copy');
  assert.match(picker, /withCodexReasoning\(\s*settings\.codexReasoningEfforts/);
});

await rm(outDir, { recursive: true, force: true });
