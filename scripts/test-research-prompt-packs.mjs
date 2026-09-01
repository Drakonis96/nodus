import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const languages = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr'];
const require = createRequire(import.meta.url);

async function load() {
  const out = path.join(os.tmpdir(), 'nodus-research-packs-' + process.pid + '.cjs');
  await build({ entryPoints: [path.join(root, 'shared/researchPromptPacks.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'silent' });
  try { return require(out); } finally { fs.rmSync(out, { force: true }); }
}

test('hypothesis and live-relations packs are complete and preserve contracts in all locales', async () => {
  const packs = await load();
  const required = ['candidates', 'hypothesis', 'variables', 'methods', 'predictions', 'counterArguments', 'nextSteps', 'searchQueries', 'draftAbstract', 'warnings'];
  for (const language of languages) {
    const hypothesis = packs.hypothesisLabPrompt(language);
    for (const marker of required) assert.match(hypothesis, new RegExp(marker), language + ' hypothesis contract missing ' + marker);
    const live = packs.liveRelationsPromptPack(language);
    for (const text of [live.ideaInsertion, live.composeBase]) {
      assert.ok(text.length > 180, language + ' live prompt is unexpectedly short');
      assert.match(text, /(cit|alınt|zitat)/i, language + ' live prompt is missing citation guidance');
    }
    for (const text of Object.values(live.output)) assert.ok(text.length > 30, language + ' live output hint is unexpectedly short');
  }
  assert.match(packs.hypothesisLabPrompt('tr'), /YALNIZCA/);
  assert.match(packs.liveRelationsPromptPack('fr').composeBase, /Nodus Copilot/);
});

test('prompt consumers select request language or settings fallback', () => {
  const hypothesis = fs.readFileSync(path.join(root, 'electron/ai/hypothesisLab.ts'), 'utf8');
  const live = fs.readFileSync(path.join(root, 'electron/ai/liveRelations.ts'), 'utf8');
  assert.match(hypothesis, /hypothesisLabPrompt\(corpus\.request\.language\)/);
  assert.match(live, /input\.language \?\? settings\.promptLanguage/);
  assert.match(live, /typeRelations\([\s\S]*language/);
  assert.match(live, /localizedComposeSystemPrompt\(mode, language\)/);
  assert.match(live, /localizedComposeOutputHint\(mode, language\)/);
});
