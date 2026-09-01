// Tests for the client-driven Deep Research path (Option B) in
// electron/ai/deepResearchClient.ts — the flow where the MCP *client's* model
// writes the report and Nodus only prepares materials + enforces grounding.
//
// The module's one outside dependency (buildWritingWorkshopSnapshot → DB +
// embeddings) is injectable, so we bundle the module (stubbing that DB import)
// and drive it with a fake corpus snapshot. No provider calls, no database, and
// crucially NOT the running local app instance.
//
// It locks the two guarantees that make Option B safe:
//   • buildDeepResearchBrief hands out only real, citable tokens (trimmed pool);
//   • assembleClientDeepResearchReport strips hallucinated citations the client
//     model may have invented and builds references only from really-cited works.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-dr-client-test-'));

// Replace the DB-heavy snapshot module with a stub — the tests inject their own.
const stubWritingWorkshop = {
  name: 'stub-writing-workshop',
  setup(b) {
    b.onResolve({ filter: /\/writingWorkshop$/ }, (args) => ({ path: args.path, namespace: 'stub' }));
    b.onResolve({ filter: /\/aiClient$/ }, () => ({ path: 'ai-client', namespace: 'stub' }));
    b.onResolve({ filter: /\/db\/database$/ }, () => ({ path: 'database', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: [
        'const emptySnapshot = (brief, route) => {',
        '  globalThis.__nodusClientSnapshotCalls ??= [];',
        '  globalThis.__nodusClientSnapshotCalls.push(route);',
        '  return { generatedAt: new Date().toISOString(), brief, stats: { ideas: 0, themes: 0, gaps: 0, contradictions: 0, works: 0, passages: 0, tutorRoutes: 0 }, recommendedSelection: { ideaIds: [], themeIds: [], gapIds: [], contradictionIds: [], workIds: [], passageIds: [], tutorRouteIds: [] }, ideas: [], themes: [], gaps: [], contradictions: [], works: [], passages: [], tutorRoutes: [] };',
        '};',
        'export function buildWritingWorkshopSnapshot(brief){ return Promise.resolve(emptySnapshot(brief, "hierarchical")); }',
        'export function buildHistoricalWritingWorkshopSnapshot(brief){ return Promise.resolve(emptySnapshot(brief, "historical")); }',
        'export function buildIdeaFirstWritingWorkshopSnapshot(brief){ return Promise.resolve(emptySnapshot(brief, "idea-first")); }',
        'export async function completeJson(){return {}}',
        'export function getDb(){return {prepare(){return {all(){return []}}}}}',
      ].join('\n'),
      loader: 'js',
    }));
  },
};

try {
  const outfile = path.join(tmp, 'deepResearchClient.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'electron/ai/deepResearchClient.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    alias: { '@shared': path.join(repoRoot, 'shared') },
    plugins: [stubWritingWorkshop],
    logLevel: 'silent',
  });
  const { buildDeepResearchBrief, assembleClientDeepResearchReport, deepResearchClientRoute } = await import(pathToFileURL(outfile).href);

  const makeSnapshot = (ideaCount) => {
    const ideas = Array.from({ length: ideaCount }, (_, i) => ({
      id: `g-${i}`,
      label: `Idea ${i}`,
      summary: `Resumen ${i}`,
      score: 1 - i / ideaCount,
      reason: 'test',
      type: 'claim',
      statement: `Enunciado sustantivo ${i}.`,
      themes: ['tema'],
      workCount: 1,
      evidenceCount: 2,
      works: [{ nodus_id: `w-${i}`, title: `Obra ${i}`, authors: [`Autor${i}, N.`], year: 2000 + (i % 25), zotero_key: `zk-${i}` }],
    }));
    const works = ideas.map((idea) => ({
      id: idea.works[0].nodus_id,
      label: idea.works[0].title,
      summary: 'sinopsis',
      score: 0.5,
      reason: 'test',
      title: idea.works[0].title,
      authors: idea.works[0].authors,
      year: idea.works[0].year,
      zotero_key: idea.works[0].zotero_key,
      themes: ['tema'],
      deepStatus: 'deep',
      ideaCount: 1,
      gapCount: 0,
    }));
    return {
      generatedAt: new Date().toISOString(),
      brief: { kind: 'deep_research', objective: 'obj', language: 'es' },
      stats: { ideas: ideaCount, themes: 0, gaps: 0, contradictions: 0, works: ideaCount, passages: 0, tutorRoutes: 0 },
      recommendedSelection: { ideaIds: [], themeIds: [], gapIds: [], contradictionIds: [], workIds: [], passageIds: [], tutorRouteIds: [] },
      ideas,
      themes: [],
      gaps: [],
      contradictions: [],
      works,
      passages: [],
      tutorRoutes: [],
    };
  };

  // ── 1. Brief: trimmed pool, real citable tokens, scope + handoff ────────────
  {
    const snap = makeSnapshot(90);
    let snapshotCalls = 0;
    const brief = await buildDeepResearchBrief({ objective: 'Tema', language: 'es',}, async () => {
      snapshotCalls += 1;
      return snap;
    });
    assert.equal(brief.mode, 'client');
    assert.equal(brief.approach, 'general', 'missing approach metadata remains General');
    assert.equal(snapshotCalls, 1, 'General uses the historical one-snapshot retrieval path');
    assert.equal(brief.materials.ideas.length, 70, 'pool trimmed to POOL_LIMITS.ideas');
    assert.ok(brief.materials.ideas.every((i) => /\]\(nodus:\/\/idea\/g-\d+\)$/.test(i.token)), 'idea tokens are real nodus citations');
    assert.ok(brief.sections.suggested >= 3, 'evidence-derived architecture is exposed as a suggestion');
    assert.equal('hardCap' in brief.sections, false, 'the client receives no editorial section ceiling');
    assert.equal(['target', 'Pages'].join('') in brief, false, 'the client receives no page target');
    assert.equal(brief.finalizeWith, 'nodus_finalize_deep_research', 'points the writer at the finalize tool');
    assert.ok(brief.citationPolicy.length > 0 && brief.method.length > 0, 'ships a citation policy + method');
    assert.ok(brief.method.some((rule) => rule.includes('dos puntos') && rule.includes('guion largo')), 'client writer receives the narrative punctuation contract');
    assert.ok(brief.method.some((rule) => rule.includes('no añadas subtítulos')), 'client writer receives the single-epigraph contract');
  }

  // ── 1a. Version router: independent from approach and strict at the boundary ─
  {
    assert.equal(deepResearchClientRoute(undefined), 'v1-historical', 'new client requests default to lower-cost v1');
    assert.equal(deepResearchClientRoute('v1'), 'v1-historical');
    assert.equal(deepResearchClientRoute('v2'), 'v2-idea-first');
    assert.throws(() => deepResearchClientRoute('v3'), /Unsupported Deep Research version/);

    globalThis.__nodusClientSnapshotCalls = [];
    await buildDeepResearchBrief({ objective: 'Tema', language: 'es', deepResearchVersion: 'v1' });
    await buildDeepResearchBrief({ objective: 'Tema', language: 'es', deepResearchVersion: 'v2' });
    assert.deepEqual(globalThis.__nodusClientSnapshotCalls, ['historical', 'idea-first'], 'default client builders are genuinely versioned');
    delete globalThis.__nodusClientSnapshotCalls;

    const seenVersions = [];
    const snapshot = makeSnapshot(4);
    const builder = async (brief) => {
      seenVersions.push(brief.deepResearchVersion);
      return snapshot;
    };
    const historical = await buildDeepResearchBrief(
      { objective: 'Tema', language: 'es', approach: 'comparative', deepResearchVersion: 'v1' },
      builder,
    );
    const current = await buildDeepResearchBrief(
      { objective: 'Tema', language: 'es', approach: 'comparative', deepResearchVersion: 'v2' },
      builder,
    );
    assert.equal(historical.deepResearchVersion, 'v1');
    assert.equal(current.deepResearchVersion, 'v2');
    assert.deepEqual(seenVersions, ['v1', 'v1', 'v2', 'v2'], 'version reaches both ordinary and supplemental client retrieval');
    await assert.rejects(
      () => buildDeepResearchBrief({ objective: 'Tema', deepResearchVersion: 'v3' }, builder),
      /Unsupported Deep Research version/,
      'explicit unknown versions must not silently become v2',
    );
  }

  // ── 1b. Specialized client brief enriches extraction and all prompt stages ──
  {
    const ordinary = makeSnapshot(8);
    const supplemental = makeSnapshot(10);
    supplemental.ideas[8].id = 'g-extra-8';
    supplemental.works[8].id = 'w-extra-8';
    supplemental.ideas[8].works[0].nodus_id = 'w-extra-8';
    const calls = [];
    const brief = await buildDeepResearchBrief(
      { objective: 'Tema', language: 'es',approach: 'literature_review' },
      async (_brief, probes) => {
        calls.push(probes ?? []);
        return calls.length === 1 ? ordinary : supplemental;
      }
    );
    assert.equal(brief.approach, 'literature_review');
    assert.equal(calls.length, 2, 'specialized client generation executes supplemental retrieval');
    assert.ok(calls[1].length > 0, 'supplemental retrieval receives approach-specific probes');
    assert.ok(brief.materials.ideas.some((idea) => idea.token.includes('nodus://idea/g-extra-8')), 'ordinary and supplemental pools are unioned');
    assert.ok(brief.method.some((rule) => rule.includes('Nunca crees una sección por autor')), 'planner rules reach the client handoff');
    assert.ok(brief.method.some((rule) => rule.includes('Sintetiza las fuentes')), 'writer rules reach the client handoff');
    assert.ok(brief.method.some((rule) => rule.includes('estructura de la literatura')), 'finalizer rules reach the client handoff');
  }

  // ── 1c. The client writing kit follows the requested prompt language ───────
  {
    const markers = { es: /Cita CADA/, en: /Cite EVERY/, fr: /Citez CHAQUE/, de: /Belegen Sie JEDE/, pt: /Cita CADA/, 'pt-BR': /Cite CADA/, it: /Cita OGNI/, tr: /HER önemli iddiayı/ };
    for (const language of Object.keys(markers)) {
      const brief = await buildDeepResearchBrief(
        { objective: 'Topic', language, approach: 'general', sectionLimit: 'single' },
        async () => makeSnapshot(4),
      );
      const instructions = [...brief.citationPolicy, ...brief.method].join('\n');
      assert.match(instructions, markers[language], `${language} client citation policy is not localized`);
      for (const token of ['materials', 'nodus://', 'sectionsMarkdown', 'sectionLimit: "single"', 'nodus_finalize_deep_research']) {
        assert.ok(instructions.includes(token), `${language} lost client contract token ${token}`);
      }
      if (language !== 'es') assert.doesNotMatch(instructions, /Cita CADA afirmación|Reparte TODAS las ideas|Cuando termines de redactar/, `${language} leaked Spanish client instructions`);
    }
    const specialized = await buildDeepResearchBrief(
      { objective: 'Topic', language: 'en', approach: 'literature_review' },
      async () => makeSnapshot(4),
    );
    assert.doesNotMatch(specialized.method.join('\n'), /Nunca crees una sección|Sintetiza las fuentes|estructura de la literatura/, 'English specialized rules leaked Spanish');
  }

  // ── 2. Finalize: strip hallucinations, build references from cited works ────
  {
    const snap = makeSnapshot(10);
    const sectionsMarkdown = [
      '## Introducción',
      'Una afirmación apoyada [Autor0, N. (2000)](nodus://idea/g-0) y otra [Autor3](nodus://idea/g-3).',
      'Un invento [Fantasma, X. (1999)](nodus://idea/HALLUCINATED-999) que debe desaparecer.',
      '',
      '## Síntesis',
      'Cierre que reutiliza [Autor0, N. (2000)](nodus://idea/g-0).',
    ].join('\n');

    const report = await assembleClientDeepResearchReport(
      { objective: 'Tema', language: 'es', deepResearchVersion: 'v1', sectionsMarkdown, title: 'Informe cliente', abstract: 'Resumen breve.', limitations: ['Sesgo del corpus.'] },
      async () => snap
    );

    const { draft, meta } = report;
    // The fake link/id is removed (so it can never become a reference); the neutral
    // bracket text may remain as plain prose, but it must not survive as a citation.
    assert.ok(!draft.draftMarkdown.includes('HALLUCINATED'), 'hallucinated citation id stripped from body');
    assert.ok(!draft.draftMarkdown.includes('nodus://idea/HALLUCINATED-999'), 'hallucinated link removed');
    assert.ok(draft.draftMarkdown.includes('nodus://idea/g-0'), 'real citations survive');
    assert.ok(draft.draftMarkdown.includes('## Referencias'), 'references section assembled');
    assert.ok(draft.draftMarkdown.includes('## Resumen') && draft.draftMarkdown.includes('Resumen breve.'), 'abstract folded in');
    assert.ok(draft.draftMarkdown.includes('## Limitaciones'), 'limitations folded in');

    assert.deepEqual([...draft.selection.ideaIds].sort(), ['g-0', 'g-3'], 'only really-cited ideas recorded');
    assert.deepEqual([...draft.selection.workIds].sort(), ['w-0', 'w-3'], 'works trace back to cited ideas');
    assert.equal(draft.bibliography.length, 2, 'bibliography = the two cited works');
    assert.ok(!draft.bibliography.join('|').includes('Fantasma'), 'hallucinated source never becomes a reference');
    assert.ok(draft.bibliography.every((r) => /Autor\d+, N\. \(20\d\d\)\./.test(r)), 'reference entries well-formed');
    assert.deepEqual(draft.outline.map((s) => s.title), ['Introducción', 'Síntesis'], 'outline derived from ## headers');
    assert.equal(draft.stats.selectedIdeas, 2);
    assert.equal(draft.stats.selectedWorks, 2);

    assert.equal(meta.ideasCovered, 2, 'coverage = distinct cited ideas');
    assert.equal(meta.ideasConsidered, 10, 'considered = whole snapshot');
    assert.equal(meta.worksCited, 2);
    assert.equal(report.draft.deepResearchVersion, 'v1');
    assert.equal(report.draft.brief.deepResearchVersion, 'v1');
    assert.equal(meta.deepResearchVersion, 'v1');
    assert.ok(meta.pages >= 1 && meta.words > 0, 'meta word/page counts computed');
    assert.equal(meta.stoppedReason, null);
  }

  // Old client finalize calls remain General, while supplied provenance is kept.
  {
    const snap = makeSnapshot(10);
    const brief = await buildDeepResearchBrief(
      { objective: 'Tema continuo', language: 'es', sectionLimit: 'single' },
      async () => snap,
    );
    assert.equal(brief.structure, 'single', 'the client handoff exposes the requested continuous structure');
    assert.ok(brief.method.some((rule) => /sin encabezados/iu.test(rule)), 'the client writer is explicitly told to write without headings');
    assert.ok(!brief.method.some((rule) => /Empieza cada sección con un encabezado/iu.test(rule)), 'the headed-section instruction is removed in continuous mode');

    const report = await assembleClientDeepResearchReport({
      objective: 'Tema continuo',
      language: 'es',
      sectionLimit: 'single',
      sectionsMarkdown: '## Encabezado accidental\n\nArgumento apoyado [Autor0, N. (2000)](nodus://idea/g-0).\n\n## Otro corte\n\nSíntesis apoyada [Autor3](nodus://idea/g-3).',
      limitations: ['Alcance acotado.'],
    }, async () => snap);
    assert.equal(report.meta.structure, 'single');
    assert.equal(report.meta.sections, 1);
    assert.equal(report.draft.deepResearchStructure, 'single');
    assert.equal(report.draft.outline.length, 0);
    assert.equal((report.draft.draftMarkdown.match(/^#{1,6}\s+/gmu) ?? []).length, 0, 'the assembler deterministically removes accidental headings');
    assert.ok(report.draft.draftMarkdown.includes('nodus://idea/g-0'), 'valid citations survive continuous assembly');
    assert.equal(report.draft.bibliography.length, 2, 'references still derive from the cited corpus');
  }

  // Old client finalize calls remain General, while supplied provenance is kept.
  {
    const snap = makeSnapshot(2);
    const generationModel = { provider: 'gemini', model: 'gemini-3.1-flash-lite' };
    const report = await assembleClientDeepResearchReport({
      objective: 'Tema',
      approach: 'conceptual',
      deepResearchVersion: 'v2',
      language: 'es',
      sectionsMarkdown: '## Síntesis\n\nRelación [Autor0](nodus://idea/g-0).',
      generationModel,
    }, async () => snap);
    assert.equal(report.draft.brief.deepResearchApproach, 'conceptual');
    assert.equal(report.draft.deepResearchApproach, 'conceptual');
    assert.equal(report.draft.deepResearchVersion, 'v2');
    assert.equal(report.draft.brief.deepResearchVersion, 'v2');
    assert.deepEqual(report.draft.generationModel, generationModel);

    await assert.rejects(
      () => assembleClientDeepResearchReport({ objective: 'Tema', deepResearchVersion: 'v3', sectionsMarkdown: '## Síntesis\n\nTexto.' }, async () => snap),
      /Unsupported Deep Research version/,
      'finalization rejects an explicit unknown version too',
    );
  }

  console.log('deep research client (Option B) test passed');
} finally {
  await rm(tmp, { recursive: true, force: true });
}
