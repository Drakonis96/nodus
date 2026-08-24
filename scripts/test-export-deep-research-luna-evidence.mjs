import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const harnessUrl = pathToFileURL(path.join(repoRoot, 'scripts/export-deep-research-luna-evidence.mjs')).href;
const harness = await import(`${harnessUrl}?test=${Date.now()}`);

test('only v1/v2 routes are accepted and they select distinct production stages', () => {
  assert.deepEqual(harness.routeForVersion('v1'), {
    version: 'v1',
    snapshot: 'buildHistoricalWritingWorkshopSnapshot',
    sections: 'retrieveSectionMaterialLegacy',
    retrievalMode: 'legacy',
  });
  assert.deepEqual(harness.routeForVersion('v2'), {
    version: 'v2',
    snapshot: 'buildIdeaFirstWritingWorkshopSnapshot',
    sections: 'retrieveSectionMaterial',
    retrievalMode: 'idea_first_document_enrichment',
  });
  assert.throws(() => harness.routeForVersion('v3'), /Unknown Deep Research version/);
  assert.equal(harness.parseEvidenceVersion(undefined), 'v2');
});

test('isolated snapshot is mandatory and live-profile-looking paths are refused', () => {
  assert.throws(() => harness.assertIsSafeSnapshot(''), /explicit --snapshot/);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-luna-harness-'));
  try {
    fs.writeFileSync(path.join(temp, 'nodus.sqlite'), 'stub');
    assert.equal(harness.assertIsSafeSnapshot(temp, '/real/nodus'), path.resolve(temp));
    assert.throws(() => harness.assertIsSafeSnapshot(temp, temp), /configured real/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
  assert.throws(
    () => harness.assertIsSafeSnapshot('/Users/test/Library/Application Support/nodus', '/not-used'),
    /live Nodus profile|Missing isolated snapshot DB/,
  );
});

test('copied vault metadata must resolve entirely inside the isolated snapshot', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-luna-vault-metadata-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-luna-outside-'));
  try {
    fs.writeFileSync(path.join(temp, 'nodus.sqlite'), 'stub');
    fs.writeFileSync(path.join(outside, 'other.sqlite'), 'stub');
    fs.writeFileSync(path.join(temp, 'vaults.json'), JSON.stringify({
      activeVaultId: 'default',
      vaults: [{ id: 'default', path: path.join(temp, 'nodus.sqlite') }],
    }));
    assert.equal(harness.assertSnapshotVaultMetadata(temp), fs.realpathSync(temp));
    fs.writeFileSync(path.join(temp, 'vaults.json'), JSON.stringify({
      activeVaultId: 'default',
      vaults: [{ id: 'default', path: path.join(outside, 'other.sqlite') }],
    }));
    assert.throws(() => harness.assertSnapshotVaultMetadata(temp), /escapes the isolated clone/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('stubbed v1/v2 providers exercise routes without any generation provider', async () => {
  const calls = [];
  const builders = {
    buildHistoricalWritingWorkshopSnapshot: async () => { calls.push('v1:snapshot'); return { stats: {}, recommendedSelection: {}, ideas: [], themes: [], gaps: [], contradictions: [], works: [], passages: [], tutorRoutes: [] }; },
    buildIdeaFirstWritingWorkshopSnapshot: async () => { calls.push('v2:snapshot'); return { stats: {}, recommendedSelection: {}, ideas: [], themes: [], gaps: [], contradictions: [], works: [], passages: [], tutorRoutes: [] }; },
  };
  const retrievers = {
    retrieveSectionMaterialLegacy: async () => { calls.push('v1:sections'); return { ideas: [], passages: [] }; },
    retrieveSectionMaterial: async () => { calls.push('v2:sections'); return { ideas: [], passages: [], evidencePacks: [] }; },
  };
  for (const version of ['v1', 'v2']) {
    const route = harness.routeForVersion(version);
    await builders[route.snapshot]();
    await retrievers[route.sections]();
  }
  assert.deepEqual(calls, ['v1:snapshot', 'v1:sections', 'v2:snapshot', 'v2:sections']);
  const source = fs.readFileSync(path.join(repoRoot, 'scripts/export-deep-research-luna-evidence.mjs'), 'utf8');
  assert.doesNotMatch(source, /(?:complete(?:Text|Json)|generate(?:DeepResearch|WritingWorkshop))\s*\(/, 'Harness must not import or call generation');
  assert.match(source, /generation: 'none'/);
});

test('planning and retrieval metrics remain independent of prose length', () => {
  const snapshot = {
    stats: { ideas: 1 }, recommendedSelection: { ideaIds: ['i1'] },
    ideas: [{ id: 'i1' }], themes: [], gaps: [], contradictions: [], works: [], passages: [], tutorRoutes: [],
  };
  const planInput = harness.buildPlanningInput('objetivo', 'v2', snapshot, { ideas: [{ token: 'x' }] });
  assert.equal(planInput.version, 'v2');
  assert.equal(planInput.sectionRetriever, 'retrieveSectionMaterial');
  const metrics = harness.summarizeEvidence([{
    coverageQuestions: ['q1'], ideas: [{ id: 'i1' }], passages: [{ id: 'p1' }], works: ['w1'],
    evidencePacks: [{ question: 'q1', passageIds: ['p1'], candidates: [{ passageId: 'p1', lanes: ['global'] }] }],
  }]);
  assert.equal(metrics.atomicQuestionCandidateRate, 1);
  assert.equal(metrics.passages, 1);
  assert.equal(Object.hasOwn(metrics, 'words'), false);
  assert.equal(Object.hasOwn(metrics, 'targetPages'), false);
});

test('audit catalog keeps the complete snapshot citable pool instead of production menu limits', () => {
  const snapshot = {
    ideas: Array.from({ length: 75 }, (_, index) => ({ id: `i${index}`, label: `Idea ${index}`, works: [] })),
    works: [], gaps: [], contradictions: [], passages: [], themes: [],
  };
  const catalog = harness.buildCompleteCitationCatalog(snapshot);
  assert.equal(catalog.ideas.length, 75);
  assert.equal(catalog.ideas.at(-1).token, '[Autor](nodus://idea/i74)');
});
