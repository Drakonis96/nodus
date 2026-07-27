import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-study-audience-'));
const bundle = path.join(outDir, 'studyDeepResearchAudience.cjs');

execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'shared/studyDeepResearchAudience.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=es2022',
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: ['ignore', 'ignore', 'inherit'] },
);

const {
  normalizeStudyDeepResearchAudience,
  STUDY_DEEP_RESEARCH_AUDIENCE_PROMPTS,
} = require(bundle);

test.after(() => rm(outDir, { recursive: true, force: true }));

test('legacy study reports remain student-facing while teaching can opt into a teacher plan', () => {
  assert.equal(normalizeStudyDeepResearchAudience(undefined), 'students');
  assert.equal(normalizeStudyDeepResearchAudience('students'), 'students');
  assert.equal(normalizeStudyDeepResearchAudience('teacher'), 'teacher');
  assert.equal(normalizeStudyDeepResearchAudience('Investigadores'), 'students');
});

test('every output language carries two materially different pedagogical contracts', () => {
  assert.deepEqual(
    Object.keys(STUDY_DEEP_RESEARCH_AUDIENCE_PROMPTS).sort(),
    ['de', 'en', 'es', 'fr', 'pt', 'pt-BR', 'tr'].sort(),
  );
  for (const [language, prompts] of Object.entries(STUDY_DEEP_RESEARCH_AUDIENCE_PROMPTS)) {
    for (const phase of ['plan', 'write', 'finalize']) {
      assert.ok(prompts.teacher[phase].length > 80, `${language} teacher ${phase} is substantive`);
      assert.ok(prompts.students[phase].length > 80, `${language} students ${phase} is substantive`);
      assert.notEqual(prompts.teacher[phase], prompts.students[phase], `${language} ${phase} changes with the audience`);
    }
  }
});

test('the selected audience crosses the UI, queue request, prompt phases and saved brief', async () => {
  const [view, engine, sidebar, app] = await Promise.all([
    readFile(path.join(repoRoot, 'src/views/DeepResearchView.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'electron/ai/studyDeepResearch.ts'), 'utf8'),
    readFile(path.join(repoRoot, 'src/components/TeachingSidebar.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src/App.tsx'), 'utf8'),
  ]);

  assert.match(view, /data-testid="deep-research-audience"/);
  assert.match(view, /value="teacher"/);
  assert.match(view, /value="students"/);
  assert.match(view, /\.\.\.\(isStudy \? \{ audience \} : \{\}\)/);
  assert.match(sidebar, /\{ label: 'Unidades didácticas', icon: 'layers', view: 'studyDeepResearch' \}/);
  assert.match(app, /isTeaching=\{isDocencia\}/);

  assert.match(engine, /normalizeStudyDeepResearchAudience\(request\.audience\)/);
  assert.equal((engine.match(/system: `\$\{prompts\.(?:plan|write|finalize)\}/g) ?? []).length, 3);
  assert.ok((engine.match(/audience,/g) ?? []).length >= 4, 'audience is sent during planning, writing, finalization and saving');
  assert.match(engine, /brief: \{ kind: 'deep_research', objective: request\.objective, audience,/);
});
