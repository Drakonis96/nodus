import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-tutorial-preferences-'));
const bundle = path.join(outDir, 'tutorialPreferences.cjs');
execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [path.join(root, 'shared/tutorialPreferences.ts'), '--bundle', '--platform=node', '--format=cjs', `--outfile=${bundle}`], { cwd: root, stdio: 'inherit' });
const { preferencesForTutorialLanguage } = createRequire(import.meta.url)(bundle);
test.after(() => rm(outDir, { recursive: true, force: true }));

test('tutorial choice selects the available UI and prompt translations', () => {
  assert.deepEqual(preferencesForTutorialLanguage('es'), { uiLanguage: 'es', promptLanguage: 'es' });
  assert.deepEqual(preferencesForTutorialLanguage('en'), { uiLanguage: 'en', promptLanguage: 'en' });
  // The two axes are independent. French has both a UI table and prompt translations.
  assert.deepEqual(preferencesForTutorialLanguage('fr'), { uiLanguage: 'fr', promptLanguage: 'fr' });
  // Turkish has both a UI table and prompt translations.
  assert.deepEqual(preferencesForTutorialLanguage('tr'), { uiLanguage: 'tr', promptLanguage: 'tr' });
  // German and both Portuguese variants have both a UI table and prompt translations,
  // so each axis stays in the tutorial's own language.
  for (const language of ['de', 'pt', 'pt-BR']) {
    assert.deepEqual(preferencesForTutorialLanguage(language), { uiLanguage: language, promptLanguage: language });
  }
  // Italian has complete UI and prompt coverage, so both axes stay in Italian.
  assert.deepEqual(preferencesForTutorialLanguage('it'), { uiLanguage: 'it', promptLanguage: 'it' });
  // Japanese ships both a UI table and prompt translations, so both axes follow it.
  assert.deepEqual(preferencesForTutorialLanguage('ja'), { uiLanguage: 'ja', promptLanguage: 'ja' });
  // Both Chinese scripts and Korean have their own UI table: each one switches the
  // interface to itself and selects its matching prompt translation.
  assert.deepEqual(preferencesForTutorialLanguage('zh-CN'), { uiLanguage: 'zh-CN', promptLanguage: 'zh-Hans' });
  assert.deepEqual(preferencesForTutorialLanguage('zh-TW'), { uiLanguage: 'zh-TW', promptLanguage: 'zh-Hant' });
  assert.deepEqual(preferencesForTutorialLanguage('ko'), { uiLanguage: 'ko', promptLanguage: 'ko' });
  // The legacy Chinese code only ever meant Simplified Chinese.
  assert.deepEqual(preferencesForTutorialLanguage('zh'), { uiLanguage: 'zh-CN', promptLanguage: 'zh-Hans' });
  // Tutorial-only languages keep the English UI but use their own prompt translation.
  for (const language of ['ru', 'uk']) {
    assert.deepEqual(preferencesForTutorialLanguage(language), { uiLanguage: 'en', promptLanguage: language });
  }
});

test('every language the tutorial offers with a UI table switches the interface to it', async () => {
  const { readFile } = await import('node:fs/promises');
  const tutorial = await readFile(path.join(root, 'src/views/BasicsTutorial.tsx'), 'utf8');
  const offered = [...tutorial.matchAll(/\{ code: '([^']+)', label:/g)].map((match) => match[1]);
  const types = await readFile(path.join(root, 'shared/types.ts'), 'utf8');
  const appLanguages = types.match(/export type AppLanguage = ([^;]+);/)[1].match(/'([^']+)'/g).map((code) => code.slice(1, -1));
  // Nobody can reach a UI language the picker does not offer.
  for (const language of appLanguages) assert.ok(offered.includes(language), `the tutorial picker offers ${language}`);
  for (const language of offered) {
    const { uiLanguage } = preferencesForTutorialLanguage(language);
    if (appLanguages.includes(language)) assert.equal(uiLanguage, language, `${language} switches the interface to itself`);
    else assert.equal(uiLanguage, 'en', `${language} has no UI table and falls back to English`);
  }
});
