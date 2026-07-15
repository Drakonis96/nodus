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
  assert.deepEqual(preferencesForTutorialLanguage('fr'), { uiLanguage: 'en', promptLanguage: 'fr' });
  assert.deepEqual(preferencesForTutorialLanguage('tr'), { uiLanguage: 'en', promptLanguage: 'tr' });
  for (const language of ['de', 'it', 'pt', 'pt-BR', 'zh', 'ja', 'ru', 'uk']) {
    assert.deepEqual(preferencesForTutorialLanguage(language), { uiLanguage: 'en', promptLanguage: 'en' });
  }
});
