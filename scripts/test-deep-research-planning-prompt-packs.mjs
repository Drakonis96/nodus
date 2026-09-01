import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const scratch = mkdtempSync(path.join(tmpdir(), 'nodus-planning-packs-'));
const bundle = path.join(scratch, 'planning-packs.mjs');
execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [
  path.join(root, 'shared/deepResearchPlanningPromptPacks.ts'),
  '--bundle', '--platform=node', '--format=esm', `--outfile=${bundle}`,
], { cwd: root, stdio: 'ignore' });

const packsModule = await import(pathToFileURL(bundle).href);
const deepResearchSource = fs.readFileSync(path.join(root, 'electron/ai/deepResearch.ts'), 'utf8');
const languages = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr'];
const stages = ['decomposeObjective', 'auditPlanCoverage', 'planReport', 'reviewPlan', 'adversarialReview'];
const stableTokens = [
  '`coverageQuestions`', '`dependsOn`', '`passageIds`', 'ideaIds', 'workIds', 'gapIds',
  'contradictionIds', 'keyClaims', '"intro|body|synthesis"', '"s1"', '[]',
];
const SpanishProse = [
  'Eres el ', 'Descompones un objetivo', 'Devuelve SOLO JSON válido',
  'El objetivo del usuario puede',
  'Cada pregunta de cobertura debe permanecer', 'Toda exclusión del objetivo es vinculante',
];

test('all eight prompt languages expose all five planning stages', () => {
  for (const language of languages) {
    const pack = packsModule.deepResearchPlanningPromptPack(language, {
      maxCoverageQuestions: 17,
      sectionCount: 4,
      sectionMode: 'user',
      approachRules: ['APPROACH_SENTINEL: preserve this rule literally.'],
    });
    assert.deepEqual(Object.keys(pack).sort(), [...stages].sort(), language);
    for (const stage of stages) {
      assert.equal(typeof pack[stage], 'string');
      assert.ok(pack[stage].length > 400, `${language}.${stage} is unexpectedly short`);
    }
  }
});

test('Spanish retains the source-stage clause counts, schema tokens, and dynamic controls', () => {
  const pack = packsModule.deepResearchPlanningPromptPack('es', {
    maxCoverageQuestions: 17, sectionCount: 4, sectionMode: 'user',
    approachRules: ['APPROACH_SENTINEL: preserve this rule literally.'],
  });
  assert.equal(pack.decomposeObjective.split('\n').length, 6);
  assert.equal(pack.auditPlanCoverage.split('\n').length, 7);
  assert.equal(pack.planReport.split('\n').length, 24);
  assert.equal(pack.reviewPlan.split('\n').length, 15);
  assert.equal(pack.adversarialReview.split('\n').length, 12);
  for (const stage of stages) {
    const tokens = stage === 'decomposeObjective'
      ? ['"subpreguntas"']
      : stage === 'auditPlanCoverage'
        ? ['`coverageQuestions`', 'passageIds']
        : stage === 'planReport'
          ? stableTokens.filter((token) => token !== '`passageIds`')
        : stage === 'reviewPlan' ? ['`passageIds`'] : ['passageIds'];
    for (const token of tokens) assert.match(pack[stage], new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${stage} lost ${token}`);
    if (['planReport', 'reviewPlan', 'adversarialReview'].includes(stage)) {
      assert.match(pack[stage], /APPROACH_SENTINEL: preserve this rule literally\./);
    }
  }
  assert.match(pack.decomposeObjective, /4 y 17 subpreguntas/);
  assert.match(pack.planReport, /arquitectura de 4 secciones amplias/);
});

test('dynamic approach rules are appended without translation and no non-Spanish pack emits Spanish prose', () => {
  const sentinel = 'APPROACH_SENTINEL: keep IDs, limits, and backticks exactly.';
  for (const language of languages) {
    const pack = packsModule.deepResearchPlanningPromptPack(language, { approachRules: [sentinel] });
    for (const stage of ['planReport', 'reviewPlan', 'adversarialReview']) assert.match(pack[stage], /APPROACH_SENTINEL: keep IDs, limits, and backticks exactly\./);
    if (language === 'es') continue;
    for (const stage of stages) {
      for (const phrase of SpanishProse) assert.doesNotMatch(pack[stage], new RegExp(phrase));
    }
  }
});

test('planning schema enums and limits remain invariant across translations', () => {
  for (const language of languages) {
    const pack = packsModule.deepResearchPlanningPromptPack(language, { maxCoverageQuestions: 19, sectionCount: 3 });
    assert.match(pack.decomposeObjective, /4[^\n]{0,12}19/);
    assert.match(pack.planReport, /"role":"intro\|body\|synthesis"/);
    for (const token of ['"title"', '"abstract"', '"sections"', '"id"', '"dependsOn"', '"keyClaims"', '"ideaIds"', '"workIds"', '"gapIds"', '"contradictionIds"', '"passageIds"', '"coverageQuestions"']) {
      assert.match(pack.planReport, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${language} lost ${token}`);
    }
  }
});

test('the five production planning stages are wired to the native pack, with no active Spanish arrays', () => {
  assert.match(deepResearchSource, /from '@shared\/deepResearchPlanningPromptPacks';/);
  const ranges = [
    ['aiDecomposeObjective', 'export const __decomposeObjectiveForTesting'],
    ['aiAuditPlanCoverage', 'async function aiPlanReport'],
    ['aiPlanReport', 'function planFromAi'],
  ];
  for (const [startMarker, endMarker] of ranges) {
    const start = deepResearchSource.indexOf(`function ${startMarker}`);
    const end = deepResearchSource.indexOf(endMarker, start + 1);
    assert.ok(start >= 0 && end > start, `could not isolate ${startMarker}`);
    const body = deepResearchSource.slice(start, end);
    assert.doesNotMatch(body, /const (?:system|reviewSystem|redTeamSystem) = \[/, `${startMarker} still owns a Spanish prompt array`);
    assert.match(body, /deepResearchPlanningPromptPack\(/, `${startMarker} is not wired to the native pack`);
  }
  const planner = deepResearchSource.slice(deepResearchSource.indexOf('async function aiPlanReport'), deepResearchSource.indexOf('function planFromAi'));
  assert.match(planner, /sectionCount: input\.sectionCount/);
  assert.match(planner, /sectionMode: input\.sectionMode/);
  assert.match(planner, /approachRules: approach\?\.rules\.planner \?\? \[\]/);
  assert.match(deepResearchSource, /maxCoverageQuestions: MAX_COVERAGE_QUESTIONS/);
  assert.match(deepResearchSource, /deepResearchPlanningPromptPack\(input\.language\)\.auditPlanCoverage/);
});

rmSync(scratch, { recursive: true, force: true });
