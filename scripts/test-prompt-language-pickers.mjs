// Regression guard for the AI prompt-language pickers. Every composer used to spell
// the language list out by hand and they drifted: the Writing Workshop (and, before
// it, Deep Research) offered seven of the eight supported languages, so an Italian
// draft was reachable over MCP — whose schema enumerates PROMPT_LANGUAGES — but not
// from the app. Every picker must render the shared PROMPT_LANGUAGE_OPTIONS, and that
// list must cover every PromptLanguage.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const buildDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-prompt-language-'));

function loadModule(source, name) {
  const output = path.join(buildDir, `${name}.cjs`);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [path.join(repoRoot, source), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${output}`],
    { cwd: repoRoot, stdio: 'inherit' },
  );
  return require(output);
}

const source = (relative) => readFile(path.join(repoRoot, relative), 'utf8');

test.after(() => rm(buildDir, { recursive: true, force: true }));

test('the shared prompt-language list covers every supported language, Italian included', () => {
  const { PROMPT_LANGUAGES } = loadModule('shared/types.ts', 'types');
  const { PROMPT_LANGUAGE_OPTIONS } = loadModule('shared/promptLanguageOptions.ts', 'promptLanguageOptions');

  assert.deepEqual(
    PROMPT_LANGUAGE_OPTIONS.map((option) => option.id).sort(),
    [...PROMPT_LANGUAGES].sort(),
    'every prompt language must be offered exactly once',
  );
  assert.equal(new Set(PROMPT_LANGUAGE_OPTIONS.map((option) => option.id)).size, PROMPT_LANGUAGES.length);
  for (const option of PROMPT_LANGUAGE_OPTIONS) {
    assert.ok(option.label.trim().length > 0, `${option.id} has no endonym label`);
  }
  assert.equal(PROMPT_LANGUAGE_OPTIONS.find((option) => option.id === 'it')?.label, 'Italiano');
});

for (const file of [
  'src/views/WritingWorkshopView.tsx',
  'src/views/DeepResearchView.tsx',
  'src/views/DatabaseDeepResearchView.tsx',
]) {
  test(`${file} renders the shared prompt-language list instead of a hand-written one`, async () => {
    const text = await source(file);
    assert.ok(text.includes('PROMPT_LANGUAGE_OPTIONS'), `${file} must use the shared prompt-language options`);
    assert.ok(!/<option value="pt">/.test(text), `${file} must not spell the language list by hand`);
  });
}
