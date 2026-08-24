// Unit design (teaching vaults) — the one contract that separates it from Deep
// Research: when the teacher fixes the structure, the generated unit has EXACTLY the
// parts they asked for, in their order, with their titles.
//
// That contract is enforced in code rather than in the prompt, because a prompt is a
// request and a model is free to decline it: return four parts for five slots, rename
// them, or reorder them. The failure is silent — a plausible unit that simply is not
// the one the teacher designed — so the resolution is a pure function driven here with
// deliberately uncooperative planner output. No model, no database, no Electron.
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-unit-design-'));
test.after(() => rm(tmp, { recursive: true, force: true }));

// The module reaches the DB and the providers at import time; the pure exports under
// test do not, so those edges are stubbed rather than loaded.
const stub = path.join(tmp, 'stub.mjs');
await writeFile(stub, 'export const completeJson = async () => ({});\nexport const completeText = async () => "";\nexport const retrieveStudyAssistantEntries = async () => [];\nexport const listStudyIdeasForSources = () => ({ ideas: [], connections: [] });\nexport const approachRules = () => ({ retrieval: [], planner: [], writer: [], finalizer: [] });\nexport const planApproachRetrieval = async () => ({ probes: [], comparands: [], axes: [], phases: [] });\n');

const outfile = path.join(tmp, 'studyDeepResearch.mjs');
await build({
  entryPoints: [path.join(repoRoot, 'electron/ai/studyDeepResearch.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  alias: { '@shared': path.join(repoRoot, 'shared') },
  plugins: [{
    name: 'stub-io',
    setup(api) {
      api.onResolve({ filter: /(aiClient|studySearch|studyKnowledgeRepo)$/ }, () => ({ path: stub }));
      api.onResolve({ filter: /^\.\/deepResearchApproaches$/ }, () => ({ path: stub }));
    },
  }],
  logLevel: 'silent',
});
const {
  normalizeStudyDeepResearchAudience,
  normalizeUnitOutline,
  assembleStudyDraftBody,
  resolveStudySections,
  studyDeepResearchPromptPack,
  STUDY_DEEP_RESEARCH_PROMPTS,
  TEACHING_UNIT_PROMPTS,
  MAX_UNIT_SECTIONS,
} =
  await import(pathToFileURL(outfile).href);

const fallbackTitle = (index) => `Parte ${index}`;
const base = {
  fallbackTitle,
  validSourceIds: new Set(['S1', 'S2', 'S3']),
  validIdeaIds: new Set(['i1', 'i2']),
  fallbackSourceIds: [['S1'], ['S2'], ['S3'], ['S1'], ['S2'], ['S3']],
};

test('a blank slot is a slot: the count survives even when nothing is named', () => {
  const outline = normalizeUnitOutline([{ title: '' }, { title: '  ' }, { title: 'Cierre' }]);
  assert.equal(outline.length, 3, 'untitled parts are kept — the teacher chose how many there are');
  assert.deepEqual(outline.map((slot) => slot.title), ['', '', 'Cierre']);
});

test('an absent or empty outline means the model designs the structure', () => {
  assert.deepEqual(normalizeUnitOutline(undefined), []);
  assert.deepEqual(normalizeUnitOutline([]), []);
  assert.deepEqual(normalizeUnitOutline('nonsense'), []);
});

test('the outline is trimmed and bounded', () => {
  const [slot] = normalizeUnitOutline([{ title: '  Fábrica  ', focus: '  el trabajo infantil  ' }]);
  assert.equal(slot.title, 'Fábrica');
  assert.equal(slot.focus, 'el trabajo infantil');
  assert.equal(normalizeUnitOutline(Array.from({ length: 50 }, () => ({ title: 'x' }))).length, MAX_UNIT_SECTIONS);
});

test('a short planner answer is padded to the teacher’s section count', () => {
  // The model returned two parts for a five-part unit: the missing three are still
  // produced, or the teacher silently receives a different unit from the one designed.
  const sections = resolveStudySections({
    ...base,
    planned: [{ id: 'a', title: 'Uno' }, { id: 'b', title: 'Dos' }],
    outline: Array.from({ length: 5 }, () => ({ title: '' })),
    count: 5,
  });
  assert.equal(sections.length, 5);
  assert.deepEqual(sections.map((section) => section.title), ['Uno', 'Dos', 'Parte 3', 'Parte 4', 'Parte 5']);
});

test('a long planner answer is truncated to the teacher’s section count', () => {
  const sections = resolveStudySections({
    ...base,
    planned: Array.from({ length: 9 }, (_unused, index) => ({ id: `p${index}`, title: `T${index}` })),
    outline: [{ title: '' }, { title: '' }],
    count: 2,
  });
  assert.equal(sections.length, 2);
  assert.deepEqual(sections.map((section) => section.title), ['T0', 'T1']);
});

test('teacher titles win over the planner’s, slot by slot and in order', () => {
  const sections = resolveStudySections({
    ...base,
    planned: [
      { id: 'a', title: 'Título inventado A' },
      { id: 'b', title: 'Título inventado B' },
      { id: 'c', title: 'Título inventado C' },
    ],
    outline: [
      { title: 'La sociedad agraria', focus: 'el punto de partida' },
      { title: '' },
      { title: 'El movimiento obrero' },
    ],
    count: 3,
  });
  assert.deepEqual(
    sections.map((section) => section.title),
    ['La sociedad agraria', 'Título inventado B', 'El movimiento obrero'],
    'named slots keep their name; the unnamed one takes the planner’s',
  );
  assert.deepEqual(sections.map((section) => section.focus), ['el punto de partida', '', '']);
});

test('without an outline the planner decides, bounded by the requested count', () => {
  const sections = resolveStudySections({
    ...base,
    planned: [{ id: 'a', title: 'Uno' }, { id: 'b', title: 'Dos' }, { id: 'c', title: 'Tres' }],
    count: 2,
  });
  assert.deepEqual(sections.map((section) => section.title), ['Uno', 'Dos']);
  assert.deepEqual(sections.map((section) => section.focus), ['', '']);
});

test('ids the model invented are dropped, and a section is never left uncitable', () => {
  const [withBadIds, withNone] = resolveStudySections({
    ...base,
    planned: [
      { id: 'a', title: 'Uno', sourceIds: ['S1', 'S404'], ideaIds: ['i1', 'i404'] },
      { id: 'b', title: 'Dos', sourceIds: [] },
    ],
    count: 2,
  });
  assert.deepEqual(withBadIds.sourceIds, ['S1'], 'a source the corpus does not have cannot reach the writer');
  assert.deepEqual(withBadIds.ideaIds, ['i1']);
  assert.deepEqual(withNone.sourceIds, ['S2'], 'an empty assignment falls back to its share of the corpus');
});

test('coverage questions omitted by the planner are assigned without changing the teacher outline', () => {
  const questions = ['¿Cómo cambia el trabajo?', '¿Qué debate existe?'];
  const sections = resolveStudySections({
    ...base,
    planned: [{ id: 'a', title: 'Trabajo', coverageQuestions: [questions[0]] }, { id: 'b', title: 'Debates' }],
    outline: [{ title: 'El trabajo' }, { title: 'El debate' }],
    coverageQuestions: questions,
    count: 2,
  });
  assert.deepEqual(sections.map((section) => section.title), ['El trabajo', 'El debate']);
  assert.deepEqual([...new Set(sections.flatMap((section) => section.coverageQuestions))].sort(), questions.sort());
});

test('every supported language has a complete teaching-unit prompt pack', () => {
  for (const [language, pack] of Object.entries(TEACHING_UNIT_PROMPTS)) {
    for (const field of ['plan', 'write', 'finalize', 'references', 'limitations']) {
      assert.ok(pack[field]?.trim().length > 8, `${language}.${field} is missing`);
    }
    assert.ok(pack.fallbackSection(2).includes('2'), `${language} fallback title is not numbered`);
    // The unit is written for the teacher to teach from; a pack that slipped back into
    // the study wording would silently turn it into a report addressed to the student.
    assert.match(pack.plan, /\{"title"/, `${language} planner does not state its JSON shape`);
  }
});

test('teaching units preserve their teacher default and accept student handouts', () => {
  assert.equal(normalizeStudyDeepResearchAudience(undefined, 'teacher'), 'teacher');
  assert.equal(normalizeStudyDeepResearchAudience('teacher', 'students'), 'teacher');
  assert.equal(normalizeStudyDeepResearchAudience('students', 'teacher'), 'students');
  assert.equal(normalizeStudyDeepResearchAudience('unknown', 'students'), 'students');
});

test('the audience selects a native teacher plan or student notes in every language', () => {
  for (const language of Object.keys(TEACHING_UNIT_PROMPTS)) {
    assert.equal(
      studyDeepResearchPromptPack(language, 'teacher', true),
      TEACHING_UNIT_PROMPTS[language],
      `${language} teacher output uses the lesson-plan contract`,
    );
    assert.equal(
      studyDeepResearchPromptPack(language, 'students', true),
      STUDY_DEEP_RESEARCH_PROMPTS[language],
      `${language} student output uses the learner-facing notes contract`,
    );
  }
});

test('Study and Teaching can publish one continuous block without losing sources', () => {
  const body = assembleStudyDraftBody({
    written: ['## Primer movimiento\n\nExplicación con [Material](nodus://study-material/m1).', '## Segundo movimiento\n\nContraste final.'],
    citedSourceTokens: ['[Material](nodus://study-material/m1)'],
    limitations: ['El corpus es parcial.'],
    referencesLabel: 'Fuentes',
    limitationsLabel: 'Limitaciones',
    structure: 'single',
  });
  assert.equal((body.match(/^#{1,6}\s+/gmu) ?? []).length, 0, 'all internal headings are flattened');
  assert.match(body, /Explicación/iu, 'only the heading is removed, not the first movement prose');
  assert.match(body, /Contraste final/iu, 'later evidence movements remain present');
  assert.match(body, /nodus:\/\/study-material\/m1/u, 'the citable source survives');
  assert.match(body, /\*\*Fuentes\*\*/u, 'technical references stay visible without becoming a section');
});
