// Pure contract tests for the model-facing JSON schemas. No provider is called.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-db-research-model-'));
const out = path.join(outDir, 'prompts.cjs');
execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [path.join(root, 'shared/databaseDeepResearchPrompts.ts'), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${out}`], { cwd: root, stdio: 'inherit' });
const prompts = require(out);

test.after(() => rm(outDir, { recursive: true, force: true }));

test('runtime planner/critic/verifier schemas are guarded', () => {
  assert.equal(prompts.isDatabaseDeepResearchPlannerOutput({ questions: [], hypotheses: [], priorities: [], risks: [], requestedOperations: ['describe'] }), true);
  assert.equal(prompts.isDatabaseDeepResearchCriticOutput({ issues: [], sensitivities: [], verdict: 'accept' }), true);
  assert.equal(prompts.isDatabaseDeepResearchVerifierOutput({ claims: [], accepted: true }), true);
  assert.equal(prompts.isDatabaseDeepResearchPlannerOutput({ questions: [], hypotheses: [], priorities: [{ operation: 'describe' }], risks: [], requestedOperations: [] }), false);
});

test('completeJson narrative guard accepts only the engine AST and rejects model numbers', () => {
  const valid = { title: 'Resumen', summary: '{{artifact:a:estimate}}', sections: [{ heading: 'Hallazgo', paragraphs: [{ textTemplate: 'El resultado es {{artifact:a:estimate}}.', artifactRefs: ['a'], claimClass: 'verified' }] }] };
  assert.equal(prompts.isDatabaseDeepResearchNarrativeOutput(valid), true);
  assert.deepEqual(prompts.validateDatabaseDeepResearchNarrative(valid, new Set(['a'])), { ok: true, errors: [] });
  const hostile = { ...valid, sections: [{ ...valid.sections[0], paragraphs: [{ ...valid.sections[0].paragraphs[0], textTemplate: 'El resultado es 42.', claimClass: 'verified' }] }] };
  assert.equal(prompts.validateDatabaseDeepResearchNarrative(hostile, new Set(['a'])).ok, false);
  assert.equal(prompts.isDatabaseDeepResearchNarrativeOutput({ ...valid, sections: [{ heading: 'Hallazgo', paragraphs: [{ textTemplate: 'x', artifactRefs: ['a'], claimType: 'verified' }] }] }), false);
});

test('localized deterministic copy and prompt provenance cover every supported locale', () => {
  const languages = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr'];
  assert.equal(prompts.DATABASE_DEEP_RESEARCH_PROMPT_VERSION, '1.0.0');
  for (const language of languages) {
    const labels = prompts.DATABASE_DEEP_RESEARCH_SECTION_LABELS[language];
    const copy = prompts.DATABASE_DEEP_RESEARCH_REPORT_COPY[language];
    assert.ok(labels?.summary && labels?.reproducibility, `${language} headings`);
    for (const key of ['method', 'result', 'noEvidence', 'noSectionEvidence', 'objective', 'snapshot', 'fingerprint', 'allFigures', 'model']) {
      assert.equal(typeof copy?.[key], 'string', `${language}.${key}`);
      assert.ok(copy[key].length > 0, `${language}.${key} is non-empty`);
    }
  }
});
