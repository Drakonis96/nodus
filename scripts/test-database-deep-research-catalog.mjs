import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const output = path.join(os.tmpdir(), `nodus-dbr-catalog-${process.pid}.cjs`);
const contractOutput = path.join(os.tmpdir(), `nodus-dbr-contract-${process.pid}.cjs`);
execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [
  path.join(root, 'shared/databaseDeepResearchPrompts.ts'), '--bundle', '--platform=node', '--format=cjs', `--outfile=${output}`,
]);
execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [
  path.join(root, 'shared/databaseDeepResearch.ts'), '--bundle', '--platform=node', '--format=cjs', `--outfile=${contractOutput}`,
]);
const prompts = require(output);
const contract = require(contractOutput);

test('all nine report modes and eight languages have every prompt role', () => {
  assert.equal(contract.DATABASE_DEEP_RESEARCH_REPORT_TYPES.length, 9);
  assert.equal(contract.DATABASE_DEEP_RESEARCH_PROMPT_LANGUAGES.length, 8);
  assert.deepEqual(prompts.validateDatabaseDeepResearchPromptRegistry(), []);
  for (const language of contract.DATABASE_DEEP_RESEARCH_PROMPT_LANGUAGES) {
    for (const reportType of contract.DATABASE_DEEP_RESEARCH_REPORT_TYPES) {
      for (const role of prompts.DATABASE_DEEP_RESEARCH_PROMPT_ROLES) {
        const prompt = prompts.buildDatabaseDeepResearchPrompt({ language, reportType, role, objective: 'test objective' });
        assert.equal(prompt.language, language);
        assert.equal(prompt.reportType, reportType);
        assert.ok(prompt.system.length > 100);
        assert.ok(prompt.user.includes(reportType));
      }
    }
  }
});

test('editable previews are contextual and localized for every mode-language pair', () => {
  for (const language of contract.DATABASE_DEEP_RESEARCH_PROMPT_LANGUAGES) {
    const signatures = new Set();
    for (const reportType of contract.DATABASE_DEEP_RESEARCH_REPORT_TYPES) {
      const sections = prompts.buildDatabaseDeepResearchPreviewSections(language, reportType, 'Objective', 7);
      assert.equal(sections.length, 3);
      assert.equal(sections[0].focus, 'Objective');
      assert.ok(sections.every((section) => section.title && section.focus && section.evidenceCount === 7));
      signatures.add(sections.map((section) => section.title).join('|'));
    }
    assert.ok(signatures.size >= 6, `${language} should expose contextual section structures`);
  }
});

test('eligibility is deterministic and enforces causal/survival contracts', () => {
  const causal = contract.getDatabaseDeepResearchEligibility('causal_impact', {
    columns: [{ id: 'o', type: 'number' }, { id: 't', type: 'checkbox' }, { id: 'c', type: 'number' }],
    roles: { outcome: 'o', treatment: 't', confounders: ['c'] },
  });
  assert.equal(causal.applicable, true);
  const unmappedTreatment = contract.getDatabaseDeepResearchEligibility('causal_impact', {
    columns: [{ id: 'o', type: 'number' }, { id: 't', type: 'select' }, { id: 'c', type: 'number' }],
    roles: { outcome: 'o', treatment: 't', confounders: ['c'] },
  });
  assert.equal(unmappedTreatment.applicable, false);
  const survival = contract.getDatabaseDeepResearchEligibility('survival_retention', {
    columns: [{ id: 'd', type: 'number' }, { id: 'e', type: 'checkbox' }],
    roles: { duration: 'd' },
  });
  assert.equal(survival.applicable, false);
  assert.deepEqual(survival.missingRoles, ['event']);
  const cohortWithoutMetrics = contract.getDatabaseDeepResearchEligibility('cohort_comparison', {
    columns: [{ id: 'g', type: 'select' }, { id: 'm', type: 'number' }],
    roles: { group: 'g' },
  });
  assert.equal(cohortWithoutMetrics.applicable, false);
  assert.ok(cohortWithoutMetrics.missingRoles.includes('metrics'));
  const setValuedCohort = contract.getDatabaseDeepResearchEligibility('cohort_comparison', {
    columns: [{ id: 'g', type: 'multi_select' }, { id: 'm', type: 'number' }],
    roles: { group: 'g', metrics: ['m'] },
  });
  assert.equal(setValuedCohort.applicable, false, 'set-valued cohorts require an explicit mapping');
});

test('unknown modes normalize to general and request normalization preserves explicit mode', () => {
  assert.equal(contract.normalizeDatabaseDeepResearchReportType('not-a-mode'), 'general');
  const normalized = contract.normalizeDatabaseDeepResearchJobInput({
    reportType: 'privacy_attachments', objective: 'audit', databaseIds: ['db'], viewIds: [], filters: { query: '', columnIds: [] }, roles: {}, model: null, depth: 'focused', budget: {},
  });
  assert.equal(normalized.reportType, 'privacy_attachments');
});

test('depth presets change the bounded model-cost envelope', () => {
  const focused = contract.estimateDatabaseDeepResearchCost(1_000, 2, 'focused');
  const deep = contract.estimateDatabaseDeepResearchCost(1_000, 2, 'deep');
  const exhaustive = contract.estimateDatabaseDeepResearchCost(1_000, 2, 'exhaustive');
  assert.ok(focused.estimatedTokens < deep.estimatedTokens);
  assert.ok(deep.estimatedTokens < exhaustive.estimatedTokens);
  assert.ok(focused.estimatedCostUsd < deep.estimatedCostUsd);
});

test('narrative guard rejects unsupported references and model-generated numbers', () => {
  const narrative = { title: 'T', summary: 'S', sections: [{ heading: 'H', paragraphs: [{ textTemplate: 'Resultado 42', artifactRefs: ['missing'], claimClass: 'verified' }] }] };
  const result = prompts.validateDatabaseDeepResearchNarrative(narrative, new Set());
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('0:0:literal_number'));
  assert.ok(result.errors.includes('0:0:unknown_artifact_ref'));
  assert.ok(result.errors.includes('0:0:missing_placeholder'));
});

test.after(() => { try { fs.unlinkSync(output); } catch {} try { fs.unlinkSync(contractOutput); } catch {} });
