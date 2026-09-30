// Favourites and task selections that name a model its provider no longer lists (DeepSeek's
// legacy `deepseek-v4-flash`) are found against the live catalogues and rewritten in one step.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp(path.join(os.tmpdir(), 'nodus-stale-models-'));
test.after(() => rm(dir, { recursive: true, force: true }));
const outfile = path.join(dir, 'stale.mjs');
await build({ entryPoints: [path.join(root, 'shared/staleModels.ts')], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const { staleFavorites, tasksUsingModel, replaceModelPatch, TASK_MODEL_KEYS } = await import(pathToFileURL(outfile).href);

const legacy = { provider: 'deepseek', model: 'deepseek-v4-flash' };
const flash = { provider: 'deepseek', model: 'deepseek-flash' };
const opus = { provider: 'anthropic', model: 'claude-opus-4-8' };
const local = { provider: 'ollama', model: 'qwen3.8:27b-q8_0' };

test('only a favourite missing from a catalogue that was read is stale', () => {
  const catalogues = new Map([['deepseek', new Set(['deepseek-flash', 'deepseek-v4-pro'])], ['ollama', null]]);
  assert.deepEqual(staleFavorites([legacy, flash, opus, local], catalogues), [legacy],
    'an unreadable provider (ollama offline) and an unchecked one (anthropic) are never stale');
});

test('every task selecting the legacy model is found, and nothing else', () => {
  const settings = { chatModel: flash, extractionModel: legacy, summaryModel: legacy, deepResearchModel: opus, defaultModel: null, synthesisModel: legacy };
  assert.deepEqual(tasksUsingModel(settings, legacy).sort(), ['extractionModel', 'summaryModel', 'synthesisModel']);
  assert.ok(TASK_MODEL_KEYS.includes('flashcardModel') && TASK_MODEL_KEYS.includes('documentProfileModel'));
});

test('replace moves every task and swaps the favourite in place, without duplicating it', () => {
  const settings = { favorites: [opus, legacy, flash], chatModel: flash, extractionModel: legacy, synthesisModel: legacy };
  const patch = replaceModelPatch(settings, legacy, flash);
  assert.deepEqual(patch.extractionModel, flash);
  assert.deepEqual(patch.synthesisModel, flash);
  assert.ok(!('chatModel' in patch), 'a task that did not use it is left alone');
  assert.deepEqual(patch.favorites, [opus, flash], 'flash was already a favourite: no second copy');
  const fresh = replaceModelPatch({ favorites: [opus, legacy], extractionModel: legacy }, legacy, flash);
  assert.deepEqual(fresh.favorites, [opus, flash], 'the replacement takes the legacy entry’s place');
});

test('remove only drops the favourite; tasks are not unset', () => {
  const patch = replaceModelPatch({ favorites: [legacy, flash], extractionModel: legacy }, legacy, null);
  assert.deepEqual(patch, { favorites: [flash] });
});

test('the settings view offers the check and the panel', async () => {
  const source = await readFile(path.join(root, 'src/views/ProvidersSettings.tsx'), 'utf8');
  assert.match(source, /FavoriteAvailabilityButton favorites=\{favorites\}/);
  assert.match(source, /<StaleFavoritesPanel /);
  assert.match(source, /replaceModelPatch\(settings, from, to\)/);
});
