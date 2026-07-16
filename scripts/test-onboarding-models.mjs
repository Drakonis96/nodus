import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The setup wizard's promise is that the user configures nothing it can find out
// on its own: every provider that already answers is queried automatically and
// merged into one searchable list per role. These are the pure rules behind that.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-onboarding-models-'));
test.after(() => rm(tmp, { recursive: true, force: true }));

const outfile = path.join(tmp, 'onboardingModels.mjs');
await build({
  entryPoints: [path.join(root, 'shared/onboardingModels.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
});
const {
  autoDiscoverableAiProviders,
  autoDiscoverableEmbeddingProviders,
  canAutoDiscover,
  collectDiscovery,
  configuredKeyProviders,
  filterModelChoices,
  findChoice,
  pickDefaultChoice,
  providersMissingKey,
  toModelChoices,
} = await import(pathToFileURL(outfile).href);

test('a provider is queried automatically only when it needs nothing from the user', () => {
  // Built-in models ship with the app and local servers need no key, so they are
  // always worth a call; a cloud provider is only reachable once its key exists.
  assert.equal(canAutoDiscover('nodus', {}), true);
  assert.equal(canAutoDiscover('ollama', {}), true);
  assert.equal(canAutoDiscover('lmstudio', {}), true);
  assert.equal(canAutoDiscover('anthropic', {}), false);
  assert.equal(canAutoDiscover('anthropic', { anthropic: true }), true);
  assert.equal(canAutoDiscover('anthropic', { anthropic: false }), false);
});

test('discovery covers every reachable provider and never the unreachable ones', () => {
  assert.deepEqual(autoDiscoverableAiProviders({}), ['nodus', 'ollama', 'lmstudio']);
  const withKeys = autoDiscoverableAiProviders({ openai: true, gemini: true });
  assert.deepEqual(withKeys, ['nodus', 'openai', 'gemini', 'ollama', 'lmstudio']);
  assert.ok(!withKeys.includes('anthropic'), 'a provider without a key must not be queried');

  // The embedding role has its own, narrower provider set.
  assert.deepEqual(autoDiscoverableEmbeddingProviders({}), ['nodus', 'ollama', 'lmstudio']);
  assert.deepEqual(autoDiscoverableEmbeddingProviders({ openai: true, anthropic: true }), ['nodus', 'openai', 'ollama', 'lmstudio']);
});

test('the key prompt offers exactly the cloud providers still missing a key', () => {
  const missing = providersMissingKey({ openai: true });
  assert.ok(!missing.includes('openai'), 'a configured provider is not worth prompting for');
  assert.ok(!missing.includes('ollama') && !missing.includes('lmstudio'), 'local providers never need a key');
  assert.ok(missing.includes('anthropic'));
  assert.deepEqual(configuredKeyProviders({ openai: true, anthropic: true }), ['anthropic', 'openai']);
  assert.deepEqual(configuredKeyProviders({}), []);
});

test('a listing becomes choices that carry provider, label and locality', () => {
  const choices = toModelChoices('openai', [
    { id: 'gpt-5', name: 'GPT-5' },
    { id: 'gpt-5' }, // the same id twice must not produce a duplicate row
    { id: '  ' }, // a blank id is not a model
    { id: 'o4-mini' }, // no name → the id is the label
  ]);
  assert.deepEqual(choices.map((choice) => choice.model), ['gpt-5', 'o4-mini']);
  assert.equal(choices[0].label, 'GPT-5');
  assert.equal(choices[1].label, 'o4-mini');
  assert.equal(choices[0].providerLabel, 'OpenAI');
  assert.equal(choices[0].local, false);
  assert.equal(toModelChoices('nodus', [{ id: 'gemma' }])[0].local, true, 'built-in models run on this machine');
  assert.equal(toModelChoices('ollama', [{ id: 'llama' }])[0].local, true, 'a local server runs on this machine');
});

test('one dead provider does not empty the picker for the others', () => {
  // The whole point of collecting failures instead of throwing: LM Studio not
  // running must not hide the models OpenAI already returned.
  const { choices, failures } = collectDiscovery([
    { provider: 'openai', models: [{ id: 'gpt-5' }] },
    { provider: 'lmstudio', error: 'ECONNREFUSED 127.0.0.1:1234' },
    { provider: 'nodus', models: [{ id: 'gemma' }] },
  ]);
  assert.deepEqual(choices.map((choice) => choice.model), ['gpt-5', 'gemma']);
  assert.equal(failures.length, 1);
  assert.deepEqual(failures[0], {
    provider: 'lmstudio',
    providerLabel: 'LM Studio',
    message: 'ECONNREFUSED 127.0.0.1:1234',
  });
});

test('a provider that answers with nothing is not reported as a failure', () => {
  const { choices, failures } = collectDiscovery([{ provider: 'ollama', models: [] }]);
  assert.deepEqual(choices, []);
  assert.deepEqual(failures, [], 'an empty library is a valid answer, not an error');
});

test('the searchbox narrows by model, name and provider together', () => {
  const choices = [
    ...toModelChoices('anthropic', [{ id: 'claude-opus-4-8', name: 'Claude Opus 4.8' }]),
    ...toModelChoices('openai', [{ id: 'text-embedding-3-small' }]),
    ...toModelChoices('openrouter', [{ id: 'baai/bge-m3', name: 'BGE M3', group: 'baai' }]),
  ];
  assert.equal(filterModelChoices(choices, '').length, 3, 'an empty query keeps everything');
  // Every term must match somewhere — this is what makes "claude opus" work.
  assert.deepEqual(filterModelChoices(choices, 'claude opus').map((c) => c.model), ['claude-opus-4-8']);
  assert.deepEqual(filterModelChoices(choices, 'openai embed').map((c) => c.model), ['text-embedding-3-small']);
  assert.deepEqual(filterModelChoices(choices, 'BGE').map((c) => c.model), ['baai/bge-m3'], 'search is case-insensitive');
  assert.deepEqual(filterModelChoices(choices, 'anthropic gpt').map((c) => c.model), [], 'terms are ANDed, not ORed');
});

test('the wizard preselects what is already configured, then a favorite, then the first model', () => {
  const choices = [
    ...toModelChoices('openai', [{ id: 'gpt-5' }, { id: 'o4-mini' }]),
    ...toModelChoices('anthropic', [{ id: 'claude-opus-4-8' }]),
  ];
  const current = { provider: 'anthropic', model: 'claude-opus-4-8' };

  // What the vault already uses wins: re-running the wizard must not silently
  // switch the user's model.
  assert.deepEqual(pickDefaultChoice(choices, current, []), current);
  // No current choice → a favorite that is actually on offer.
  assert.deepEqual(
    pickDefaultChoice(choices, null, [{ provider: 'openai', model: 'o4-mini' }]),
    { provider: 'openai', model: 'o4-mini' }
  );
  // A favorite nobody offers is ignored rather than preselected into an error.
  assert.deepEqual(pickDefaultChoice(choices, null, [{ provider: 'groq', model: 'gone' }]), { provider: 'openai', model: 'gpt-5' });
  // Nothing configured and nothing favorited → just the first discovered model.
  assert.deepEqual(pickDefaultChoice(choices, null, []), { provider: 'openai', model: 'gpt-5' });
});

test('a configured model survives its provider going quiet, but nothing is invented', () => {
  const current = { provider: 'anthropic', model: 'claude-opus-4-8' };
  // Discovery found nothing (offline): keep showing what the vault has.
  assert.deepEqual(pickDefaultChoice([], current, []), current);
  // Nothing configured and nothing discovered → null, which is what keeps the
  // wizard's "Empezar" button disabled instead of saving an empty model.
  assert.equal(pickDefaultChoice([], null, []), null);
  // The provider answered but no longer lists the configured model → fall through.
  const choices = toModelChoices('anthropic', [{ id: 'claude-sonnet-5' }]);
  assert.deepEqual(pickDefaultChoice(choices, current, []), { provider: 'anthropic', model: 'claude-sonnet-5' });
});

test('findChoice matches on provider and model together', () => {
  const choices = toModelChoices('openai', [{ id: 'gpt-5' }]);
  assert.equal(findChoice(choices, { provider: 'openai', model: 'gpt-5' })?.model, 'gpt-5');
  assert.equal(findChoice(choices, { provider: 'groq', model: 'gpt-5' }), null, 'the same id from another provider is another model');
  assert.equal(findChoice(choices, null), null);
});
