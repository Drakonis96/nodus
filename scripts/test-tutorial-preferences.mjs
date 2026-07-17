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
  // Turkish has prompt translations but no UI table, so it borrows the English UI.
  assert.deepEqual(preferencesForTutorialLanguage('tr'), { uiLanguage: 'en', promptLanguage: 'tr' });
  // German and both Portuguese variants have both a UI table and prompt translations,
  // so each axis stays in the tutorial's own language.
  for (const language of ['de', 'pt', 'pt-BR']) {
    assert.deepEqual(preferencesForTutorialLanguage(language), { uiLanguage: language, promptLanguage: language });
  }
  // Everything else is tutorial-only: English on both axes.
  for (const language of ['it', 'zh', 'ja', 'ru', 'uk']) {
    assert.deepEqual(preferencesForTutorialLanguage(language), { uiLanguage: 'en', promptLanguage: 'en' });
  }
});
