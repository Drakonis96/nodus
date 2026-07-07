import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-hypothesis-lab-test-'));

try {
  const outfile = path.join(tmp, 'hypothesisLab.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'shared/hypothesisLab.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  });
  const { buildHypothesisLabFallback } = await import(pathToFileURL(outfile).href);

  const result = buildHypothesisLabFallback({
    request: {
      objective: 'tourism heritage memory',
      mode: 'comparative',
      language: 'en',
      maxCandidates: 4,
    },
    generatedAt: '2026-07-06T00:00:00.000Z',
    ideas: [
      {
        id: 'g-1',
        label: 'Tourism as heritage mediation',
        statement: 'Tourism mediates public memory through heritage routes.',
        type: 'claim',
        themes: ['tourism', 'heritage'],
        workIds: ['w-1'],
        workCount: 4,
        evidenceCount: 6,
      },
    ],
    gaps: [
      {
        id: 'gap-1',
        kind: 'open_question',
        statement: 'The corpus does not explain how heritage tourism changes memory practices across cases.',
        confidence: 0.86,
        relatedIdeaId: 'g-1',
        workId: 'w-1',
        workTitle: 'Heritage Routes',
        authors: ['Rivera'],
        year: 2020,
        evidenceQuote: 'Future work should compare how routes produce memory.',
      },
    ],
    debates: [
      {
        id: 'edge-1',
        fromId: 'g-1',
        toId: 'g-2',
        fromLabel: 'Tourism mediates memory',
        toLabel: 'Tourism commodifies memory',
        explanation: 'The corpus contains a tension between mediation and commodification.',
        confidence: 0.78,
      },
    ],
    works: [
      {
        id: 'w-1',
        title: 'Heritage Routes',
        authors: ['Rivera'],
        year: 2020,
        themes: ['tourism', 'heritage'],
        deepStatus: 'done',
        ideaCount: 8,
        gapCount: 3,
        summary: 'A study of tourism routes and memory.',
      },
    ],
    passages: 12,
    project: {
      id: 'p-1',
      title: 'Thesis',
      brief: 'A thesis about tourism and memory.',
      linkLabels: ['Tourism as heritage mediation'],
    },
  });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.stats.projectLinked, true);
  assert.equal(result.stats.aiRefined, false);
  assert.equal(result.candidates[0].maturity === 'testable' || result.candidates[0].maturity === 'ready', true);
  assert.equal(result.candidates[0].evidence.some((item) => item.citation === 'nodus://gap/gap-1'), true);
  assert.equal(result.candidates[0].evidence.some((item) => item.citation === 'nodus://idea/g-1'), true);
  assert.equal(result.candidates[0].hypothesis.includes('heritage') || result.candidates[0].hypothesis.includes('tourism'), true);
  assert.equal(result.candidates[0].searchQueries.length > 0, true);

  console.log('hypothesis lab planner test passed');
} finally {
  await rm(tmp, { recursive: true, force: true });
}
