import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-deep-research-approaches-'));
test.after(() => rm(tmp, { recursive: true, force: true }));

async function bundle(entry, name, plugins = []) {
  const outfile = path.join(tmp, `${name}.mjs`);
  await build({
    entryPoints: [path.join(repoRoot, entry)],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    alias: { '@shared': path.join(repoRoot, 'shared') },
    plugins,
    logLevel: 'silent',
  });
  return import(`${pathToFileURL(outfile).href}?v=${Date.now()}-${name}`);
}

const shared = await bundle('shared/deepResearchApproaches.ts', 'shared');

const ioStub = {
  name: 'stub-approach-io',
  setup(api) {
    api.onResolve({ filter: /\.\/aiClient$/ }, () => ({ path: 'approach-ai', namespace: 'stub' }));
    api.onResolve({ filter: /\.\.\/db\/database$/ }, () => ({ path: 'approach-db', namespace: 'stub' }));
    api.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
      contents: args.path === 'approach-ai'
        ? 'export const completeJson = async () => ({ probes: [] });'
        : 'export const getDb = () => ({ prepare: () => ({ all: () => [] }) });',
      loader: 'js',
    }));
  },
};
const profiles = await bundle('electron/ai/deepResearchApproaches.ts', 'profiles', [ioStub]);

test('all seven stable approaches exist and missing metadata is General', () => {
  assert.deepEqual(shared.DEEP_RESEARCH_APPROACHES, [
    'general', 'literature_review', 'state_of_art', 'scholarly_debate', 'comparative', 'chronological', 'conceptual',
  ]);
  assert.equal(shared.normalizeDeepResearchApproach(undefined), 'general');
  assert.equal(shared.normalizeDeepResearchApproach('unknown-from-old-client'), 'general');
  assert.equal(shared.DEEP_RESEARCH_APPROACH_OPTIONS.length, 7);
});

test('General has no supplemental retrieval or prompt rules in any adapter', () => {
  assert.deepEqual(profiles.deterministicApproachRetrievalPlan(undefined, 'objetivo'), {
    probes: [], comparands: [], axes: [], phases: [],
  });
  for (const variant of ['academic', 'genealogy', 'study', 'unit', 'client']) {
    assert.deepEqual(profiles.approachRules('general', variant), {
      retrieval: [], planner: [], writer: [], finalizer: [],
    }, `General gained specialized behavior in ${variant}`);
  }
});

test('every specialized approach changes retrieval, planning, writing and finalization', () => {
  for (const approach of shared.DEEP_RESEARCH_APPROACHES.slice(1)) {
    const retrieval = profiles.deterministicApproachRetrievalPlan(approach, 'La memoria y sus usos');
    assert.ok(retrieval.probes.length > 0, `${approach} has no supplemental retrieval`);
    for (const variant of ['academic', 'genealogy', 'study', 'unit', 'client']) {
      const rules = profiles.approachRules(approach, variant);
      for (const stage of ['retrieval', 'planner', 'writer', 'finalizer']) {
        assert.ok(rules[stage].length > 0, `${approach}/${variant} never reaches ${stage}`);
      }
    }
  }
  assert.ok(
    profiles.approachRules('literature_review', 'study').writer.some((rule) => rule.includes('previousSections')),
    'Study literature review explicitly prevents cross-section definition repetition',
  );
  assert.ok(
    profiles.approachRules('chronological', 'study').planner.some((rule) => rule.includes('secuencia de proceso')),
    'Study chronology distinguishes process order from unsupported historical periodization',
  );
});

test('specialized Academic material is unioned and deduplicated without deleting ordinary hits', () => {
  const idea = (id, author, type = 'claim', workCount = 1) => ({
    id, label: id, summary: id, score: 1, reason: '', type, statement: id,
    themes: [], workCount, evidenceCount: 1,
    works: [{ nodus_id: `w-${id}`, title: `W ${id}`, authors: [author], year: 2020, zotero_key: id }],
  });
  const empty = {
    generatedAt: '', brief: { kind: 'deep_research', objective: 'x' },
    stats: { ideas: 0, themes: 0, gaps: 0, contradictions: 0, works: 0, passages: 0, tutorRoutes: 0 },
    recommendedSelection: { ideaIds: [], themeIds: [], gapIds: [], contradictionIds: [], workIds: [], passageIds: [], tutorRouteIds: [] },
    ideas: [], themes: [], gaps: [], contradictions: [], works: [], passages: [], tutorRoutes: [],
  };
  const ordinary = { ...empty, ideas: [idea('base-a', 'Autor A'), idea('base-b', 'Autor A')] };
  const supplemental = { ...empty, ideas: [idea('base-a', 'Autor A'), idea('new-c', 'Autor B')] };
  const merged = profiles.mergeApproachSnapshots(ordinary, supplemental, 'literature_review');
  assert.deepEqual(new Set(merged.ideas.map((item) => item.id)), new Set(['base-a', 'base-b', 'new-c']));
  assert.equal(merged.ideas.length, 3, 'deduplication keeps one copy of the repeated hit');
  assert.equal(merged.ideas[1].id, 'new-c', 'literature review prevents one author occupying the whole front of the pool');
});

test('specialized Genealogy repairs only malformed citations to allowed sources', () => {
  const sources = [{ id: 'doc:record-1', title: 'Partida de bautismo (1892)', label: 'partida' }];
  assert.equal(
    profiles.repairMalformedGenealogyCitations('Texto ](nodus://archive/record-1].', sources),
    'Texto [Partida de bautismo (1892)](nodus://archive/record-1).',
  );
  assert.equal(
    profiles.repairMalformedGenealogyCitations('Texto ](nodus://archive/inventado].', sources),
    'Texto .',
    'a syntactically broken hallucinated id is removed, never repaired into a citation',
  );
});

test('General still calls the historical retrieval and prompt dependency path', async () => {
  const [source, workshop] = await Promise.all([
    readFile(path.join(repoRoot, 'electron/ai/deepResearch.ts'), 'utf8'),
    readFile(path.join(repoRoot, 'electron/ai/writingWorkshop.ts'), 'utf8'),
  ]);
  assert.match(source, /deepResearchApproachPath\(approach\) === 'general'[\s\S]*orchestrateDeepResearch\(\{ \.\.\.request, model \}, realDeps\(model\), onProgress\)/);
  assert.match(source, /buildSnapshot: \(brief\) => buildWritingWorkshopSnapshot\(brief\)/, 'General retrieval is still the one-probe snapshot');
  assert.match(source, /planReport: \(input\) => aiPlanReport\(input, model\)/, 'General planner receives no approach argument');
  assert.match(source, /writeSection: \(input\) => aiWriteSection\(input, model\)/, 'General writer receives no approach argument');
  assert.match(source, /finalize: \(input\) => aiFinalize\(input, model\)/, 'General finalizer receives no approach argument');
  assert.match(source, /function specializedAcademicDeps/);
  assert.match(
    workshop,
    /const lexicalQuery = extraProbes\.length[\s\S]*\? `\$\{brief\.objective\}[\s\S]*: `\$\{brief\.objective\} \$\{kindLabel\(brief\.kind\)\}`/,
    'General retains the exact historical lexical query while specialized probes enrich lexical-only vaults',
  );
});

test('UI, gallery, reader, queue and MCP carry the approach metadata', async () => {
  const [view, queue, mcp, lane, jobs, repo] = await Promise.all([
    readFile(path.join(repoRoot, 'src/views/DeepResearchView.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'electron/ai/deepResearchQueue.ts'), 'utf8'),
    readFile(path.join(repoRoot, 'electron/mcp/tools.ts'), 'utf8'),
    readFile(path.join(repoRoot, 'electron/ai/deepResearchLane.ts'), 'utf8'),
    readFile(path.join(repoRoot, 'src/backgroundJobs.ts'), 'utf8'),
    readFile(path.join(repoRoot, 'electron/db/writingDraftsRepo.ts'), 'utf8'),
  ]);
  assert.match(view, /data-testid="deep-research-approach"/);
  assert.match(view, /DEEP_RESEARCH_APPROACH_OPTIONS\.map/);
  assert.match(view, /data-testid="deep-research-generation-tags"/);
  assert.ok((view.match(/<ReportGenerationTags saved=\{saved\}/g) ?? []).length >= 3, 'tags render in grid, list and reader');
  assert.match(queue, /approach: normalizeDeepResearchApproach\(input\.request\.approach\)/);
  assert.match(queue, /deepResearchApproach: normalizeDeepResearchApproach\(input\.request\.approach\)/);
  assert.match(mcp, /approach: deepResearchApproachSchema/g);
  assert.match(lane, /report\.draft\.generationModel \?\? request\.model/);
  assert.match(jobs, /report\.draft\.generationModel \?\? currentRequest\.model/);
  assert.match(repo, /JSON\.stringify\(request\.draft\.brief\)/, 'approach is persisted inside brief_json');
  assert.match(repo, /JSON\.stringify\(request\.draft\)/, 'generation metadata survives a database restart in draft_json');
});

test('Teaching keeps the teacher outline and focus after approach rules', async () => {
  const source = await readFile(path.join(repoRoot, 'electron/ai/studyDeepResearch.ts'), 'utf8');
  assert.match(source, /\.\.\.\(approachContext\?\.rules\.planner \?\? \[\]\),[\s\S]*\.\.\.\(requestedOutline\.length \? \[FIXED_OUTLINE_RULE\]/);
  assert.match(source, /\.\.\.\(approachContext\?\.rules\.writer \?\? \[\]\),[\s\S]*\.\.\.\(section\.focus \? \[SECTION_FOCUS_RULE\]/);
  assert.match(source, /resolveStudySections\(\{[\s\S]*outline: request\.outline/);
  assert.match(source, /\.\.\.\(approachContext \? \{[\s\S]*sourceEvidence:/, 'specialized finalization receives grounded evidence');
});

test('Genealogy keeps its evidence-first and unproven-kinship rules', async () => {
  const source = await readFile(path.join(repoRoot, 'electron/ai/genealogyDeepResearch.ts'), 'utf8');
  assert.match(source, /Sigue el estándar de prueba genealógico/);
  assert.match(source, /nunca afirmes una identidad o un parentesco sin apoyo documental/);
  assert.match(source, /if \(approach === 'general'\)[\s\S]*orchestrateGenealogyDeepResearch\(request, ordinarySources, family, realDeps\(model\)/);
});

test('all supported UI languages include every approach string', async () => {
  const feature = await readFile(path.join(repoRoot, 'src/i18n.deepResearchApproaches.ts'), 'utf8');
  for (const language of ['en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr']) {
    assert.match(feature, new RegExp(`(?:^|\\n)\\s*['"]?${language.replace('-', '\\-')}['"]?\\s*:`), `${language} table missing`);
  }
  for (const file of ['en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr']) {
    const source = await readFile(path.join(repoRoot, `src/i18n.${file}.ts`), 'utf8');
    assert.match(source, /DEEP_RESEARCH_APPROACH_TRANSLATIONS/);
  }
});
