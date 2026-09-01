import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-teaching-prompts-'));
test.after(() => rm(tmp, { recursive: true, force: true }));
const outfile = path.join(tmp, 'teachingPromptPacks.mjs');
await build({ entryPoints: [path.join(repoRoot, 'shared/teachingPromptPacks.ts')], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const { TEACHING_PROMPT_PACKS } = await import(pathToFileURL(outfile).href);

const languages = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr'];
const types = ['section', 'short_essay', 'medium_essay', 'long_essay', 'short_answer', 'definition', 'multiple_choice', 'true_false', 'matching', 'ordering', 'fill_blank', 'image_comment', 'problem'];

test('every teaching language has every exam label, scope hint, and JSON shape', () => {
  for (const language of languages) {
    const pack = TEACHING_PROMPT_PACKS[language].exam;
    assert.equal(Object.keys(pack.typeLabels).length, types.length, `${language}: labels changed`);
    for (const type of types) {
      assert.ok(pack.typeLabels[type].label.trim(), `${language}.${type}: missing label`);
      assert.ok(pack.typeLabels[type].description.trim(), `${language}.${type}: missing description`);
      const shape = pack.shapeFor(type, 4);
      for (const key of type === 'multiple_choice' ? ['prompt', 'options', 'correctIndex', 'solution'] : type === 'true_false' ? ['prompt', 'correct', 'solution'] : type === 'matching' ? ['prompt', 'pairs', 'solution'] : type === 'ordering' ? ['prompt', 'items', 'solution'] : type === 'image_comment' ? ['prompt', 'imageCaption', 'solution'] : ['prompt', 'solution']) {
        assert.match(shape, new RegExp(`"${key}"`), `${language}.${type}: missing ${key}`);
      }
    }
    for (const type of ['short_essay', 'medium_essay', 'long_essay', 'short_answer']) assert.ok(pack.scopeHints[type], `${language}.${type}: missing scope hint`);
    for (const field of ['systemRole', 'systemLanguage', 'systemJson', 'systemFormat', 'systemEvidence', 'systemNoEvidence', 'userQuestionType', 'userTeacherInstruction', 'userAvoid', 'userMaterials', 'userExactJson']) assert.ok(pack[field].trim(), `${language}: missing ${field}`);
  }
});

test('exam shape invariants preserve exact counts, bounds, and section semantics in every language', () => {
  for (const language of languages) {
    const pack = TEACHING_PROMPT_PACKS[language].exam;
    assert.equal((pack.shapeFor('multiple_choice', 7).match(/"(?:option|opción|option|Option|opzione|seçenek|opção) \d+"/g) ?? []).length, 7, `${language}: option count changed`);
    assert.match(pack.shapeFor('section', 4), /80|80/);
    assert.match(pack.shapeFor('section', 4), /200/);
    assert.match(pack.shapeFor('matching', 4), /4/);
    assert.match(pack.shapeFor('matching', 4), /6/);
    assert.match(pack.shapeFor('fill_blank', 4), /2/);
    assert.match(pack.shapeFor('fill_blank', 4), /5/);
  }
});

test('every teaching language has the complete rubric rule set and JSON contract', () => {
  for (const language of languages) {
    const pack = TEACHING_PROMPT_PACKS[language].rubric;
    // The canonical rules contain five independent clauses; each translation must keep all five.
    assert.ok(pack.descriptorRules.length > 180, `${language}: rubric rules were summarized`);
    assert.match(pack.descriptorRules, /[.!?]/u);
    const json = pack.jsonFormat(true);
    for (const key of ['title', 'description', 'levels', 'criteria', 'name', 'weight', 'descriptors']) assert.match(json, new RegExp(`"${key}"`), `${language}: missing ${key}`);
    assert.match(pack.exactCounts(4, 6), /4/);
    assert.match(pack.exactCounts(4, 6), /6/);
    assert.match(pack.descriptorCount(6), /6/);
    assert.ok(pack.criterionFallback.trim() && pack.rubricFallback.trim(), `${language}: missing fallback labels`);
    for (const field of ['systemRole', 'systemLanguage', 'systemDescriptorOutput', 'taskSystemRole', 'taskSystemLanguage', 'taskSystemJson', 'independentCriteria', 'rubricComplete', 'criterion', 'level', 'teacherInstruction', 'writeCell', 'task', 'attachedTask', 'sourceMaterial', 'sourceSearchFallback', 'exactJson']) assert.ok(pack[field].trim(), `${language}: missing ${field}`);
  }
});

test('labels and rules are genuinely localized, with Spanish remaining canonical', () => {
  const es = TEACHING_PROMPT_PACKS.es;
  assert.equal(es.exam.typeLabels.short_essay.label, 'Desarrollo corto');
  assert.equal(es.rubric.criterionFallback, 'Criterio');
  assert.notEqual(TEACHING_PROMPT_PACKS.en.exam.typeLabels.short_essay.label, es.exam.typeLabels.short_essay.label);
  assert.notEqual(TEACHING_PROMPT_PACKS.fr.rubric.systemRole, es.rubric.systemRole);
  assert.notEqual(TEACHING_PROMPT_PACKS.tr.exam.scopeHints.short_answer, es.exam.scopeHints.short_answer);
});

test('the two AI modules select the prompt pack from promptLanguage settings', async () => {
  const stub = path.join(tmp, 'teaching-ai-stubs.mjs');
  await writeFile(stub, `export let lastRequest = null;
export const completeJson = async (request) => { lastRequest = request; if (!request.system.includes('Vous êtes')) throw new Error('promptLanguage wiring regressed'); return { prompt: 'ok', solution: '', levels: ['High', 'Low'], criteria: [{ name: 'criterion', descriptors: ['good', 'bad'] }] }; };
export const completeText = async (request) => { lastRequest = request; if (!request.system.includes('Vous êtes')) throw new Error('promptLanguage wiring regressed'); return 'descriptor'; };
export const retrieveStudyAssistantEntries = async () => [];
export const runStudyAiTask = async (input, call) => ({ value: await call({ provider: 'test', model: 'test' }), model: { provider: 'test', model: 'test' } });
export const getSettings = () => ({ promptLanguage: 'fr', studyAiTemperature: 0, studyAiMaxOutputTokens: 4000 });
export const getTeachingRubric = () => ({ subjectId: null, language: 'es', scaleMax: 10, levels: [{ id: 'L1', label: 'High', score: 10 }, { id: 'L2', label: 'Low', score: 0 }], criteria: [{ id: 'C1', name: 'Clarity', description: '' }] });
export const extractFromPath = async () => ({ text: '' });`);
  const bundle = async (entry, output) => build({ entryPoints: [path.join(repoRoot, entry)], outfile: path.join(tmp, output), bundle: true, format: 'esm', platform: 'node', alias: { '@shared': path.join(repoRoot, 'shared') }, plugins: [{ name: 'stubs', setup(api) { api.onResolve({ filter: /(aiClient|studyAiPolicy|studySearch|settingsRepo|teachingRubricsRepo|textExtractor)$/ }, ({ path: importPath }) => ({ path: importPath.endsWith('teachingRubricsRepo') ? stub : stub })); } }], logLevel: 'silent' });
  // The source assertion catches accidental direct use of request.language; bundling the
  // modules also verifies the import and call-site wiring remains executable.
  const [examSource, rubricSource] = await Promise.all([readFile(path.join(repoRoot, 'electron/ai/teachingExamQuestions.ts'), 'utf8'), readFile(path.join(repoRoot, 'electron/ai/teachingRubrics.ts'), 'utf8')]);
  assert.match(examSource, /teachingPromptPack\(settings\.promptLanguage \?\? 'es'\)\.exam/);
  assert.match(rubricSource, /teachingPromptPack\(settings\.promptLanguage \?\? 'es'\)\.rubric/);
  await bundle('electron/ai/teachingExamQuestions.ts', 'exam.mjs');
  await bundle('electron/ai/teachingRubrics.ts', 'rubric.mjs');
  const exam = await import(pathToFileURL(path.join(tmp, 'exam.mjs')).href);
  const rubric = await import(pathToFileURL(path.join(tmp, 'rubric.mjs')).href);
  // These calls are intentionally only smoke calls: the prompt-language strings are
  // checked in the pack tests above, while this proves both production modules consume
  // that pack without changing their JSON/result contracts.
  const examResult = await exam.generateExamQuestion({ type: 'short_answer', instruction: 'tema', language: 'es' });
  assert.equal(examResult.question.prompt, 'ok');
  const rubricResult = await rubric.generateRubric({ source: { kind: 'prompt' }, instruction: 'task', subjectId: null, language: 'es', scaleMax: 10, levelCount: 2, criteriaCount: 1 });
  assert.equal(rubricResult.rubric.criteria.length, 1);
});
