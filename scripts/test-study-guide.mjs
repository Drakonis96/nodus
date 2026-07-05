import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-study-guide-test-'));

try {
  const outfile = path.join(tmp, 'studyGuide.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'shared/studyGuide.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  });
  const { buildStudyGuidePlan } = await import(pathToFileURL(outfile).href);

  let plan = buildStudyGuidePlan({
    authors: [
      author({
        authorId: 'a-secondary',
        fullName: 'Autor Secundario',
        ideaCount: 3,
        relationCount: 0,
        works: [work({ nodusId: 'w-secondary', ideaCount: 3 })],
      }),
      author({
        authorId: 'a-core',
        fullName: 'Autora Central',
        ideaCount: 18,
        relationCount: 5,
        topThemes: ['turismo', 'patrimonio'],
        works: [
          work({
            nodusId: 'w-core-1',
            title: 'Obra principal',
            ideaCount: 12,
            principalIdeaCount: 7,
            passageCount: 44,
            zoteroKey: 'ZOT1',
            summary: 'Resumen orientativo.',
          }),
          work({ nodusId: 'w-core-2', title: 'Obra menor', ideaCount: 2, zoteroKey: null }),
        ],
        keyIdeas: [
          idea({ globalId: 'i-1', label: 'Turismo como apertura', role: 'principal', confidence: 0.9 }),
          idea({ globalId: 'i-2', label: 'Patrimonio como legitimacion', role: 'secondary', confidence: 0.7 }),
        ],
      }),
    ],
    objective: 'turismo y patrimonio',
    generatedAt: '2026-07-05T00:00:00.000Z',
  });

  assert.equal(plan.nextAuthorId, 'a-core');
  assert.equal(plan.authors[0].fullName, 'Autora Central');
  assert.equal(plan.authors[0].recommendedWorks[0].nodusId, 'w-core-1');
  assert.equal(plan.authors[0].recommendedWorks[0].zoteroKey, 'ZOT1');
  assert.equal(plan.authors[0].coverage.fullTextWorks, 1);
  assert.equal(plan.phases.some((phase) => phase.id === 'lectura_profunda'), true);
  assert.equal(plan.coverageWarnings.some((warning) => warning.includes('pasajes indexados')), true);

  plan = buildStudyGuidePlan({
    authors: [
      author({
        authorId: 'a-done',
        fullName: 'Autora Ya Dominada',
        ideaCount: 100,
        relationCount: 20,
        progressStatus: 'understood',
      }),
      author({ authorId: 'a-open', fullName: 'Autor Abierto', ideaCount: 4, relationCount: 0 }),
    ],
    includeCompleted: false,
  });
  assert.equal(plan.authors.length, 1);
  assert.equal(plan.authors[0].authorId, 'a-open');
  assert.equal(plan.stats.completedAuthors, 1);

  plan = buildStudyGuidePlan({
    authors: [
      author({ authorId: 'a-low', fullName: 'Autor Bajo', ideaCount: 4, relationCount: 0 }),
      author({ authorId: 'a-semantic', fullName: 'Autora Afin', ideaCount: 4, relationCount: 0, semanticScore: 3 }),
    ],
    semanticFocusAvailable: true,
    semanticFocusUsed: true,
    semanticFocusSummary: 'Afinado con embeddings.',
  });
  assert.equal(plan.authors[0].authorId, 'a-semantic');
  assert.equal(plan.semanticFocusUsed, true);
  assert.equal(plan.semanticFocusSummary, 'Afinado con embeddings.');

  console.log('study guide planner test passed');
} finally {
  await rm(tmp, { recursive: true, force: true });
}

function author(overrides = {}) {
  return {
    authorId: overrides.authorId ?? 'a-1',
    name: overrides.name ?? overrides.fullName ?? 'Autor',
    fullName: overrides.fullName ?? overrides.name ?? 'Autor',
    workCount: overrides.workCount ?? overrides.works?.length ?? 1,
    ideaCount: overrides.ideaCount ?? 0,
    relationCount: overrides.relationCount ?? 0,
    topThemes: overrides.topThemes ?? [],
    read: overrides.read ?? false,
    hasSynthesis: overrides.hasSynthesis ?? false,
    works: overrides.works ?? [work()],
    keyIdeas: overrides.keyIdeas ?? [],
    progressStatus: overrides.progressStatus ?? null,
    progressNote: overrides.progressNote ?? null,
    semanticScore: overrides.semanticScore ?? 0,
  };
}

function work(overrides = {}) {
  return {
    nodusId: overrides.nodusId ?? 'w-1',
    title: overrides.title ?? 'Obra',
    authors: overrides.authors ?? ['Autor'],
    year: overrides.year ?? 1970,
    zoteroKey: overrides.zoteroKey ?? 'ZOT',
    read: overrides.read ?? false,
    sourceType: overrides.sourceType ?? 'pdf',
    deepStatus: overrides.deepStatus ?? 'done',
    summaryStatus: overrides.summaryStatus ?? 'done',
    ideaCount: overrides.ideaCount ?? 1,
    principalIdeaCount: overrides.principalIdeaCount ?? 1,
    passageCount: overrides.passageCount ?? 0,
    summary: overrides.summary ?? null,
    progressStatus: overrides.progressStatus ?? null,
    semanticScore: overrides.semanticScore ?? 0,
  };
}

function idea(overrides = {}) {
  return {
    globalId: overrides.globalId ?? 'i-1',
    type: overrides.type ?? 'claim',
    label: overrides.label ?? 'Idea',
    statement: overrides.statement ?? 'Enunciado de la idea.',
    workId: overrides.workId ?? 'w-1',
    workTitle: overrides.workTitle ?? 'Obra',
    role: overrides.role ?? 'principal',
    confidence: overrides.confidence ?? 0.8,
  };
}
