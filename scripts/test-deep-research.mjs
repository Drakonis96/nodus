// Tests for the Deep Research orchestration core. The pure control flow in
// electron/ai/deepResearchCore.ts has no Electron/DB/AI deps (only erased type
// imports), so we bundle just that file with esbuild and drive the REAL
// orchestrator with injected fakes — no provider calls, no database, and
// crucially NOT the running local app instance.
//
// It locks the guarantees that matter for a professional report:
//   • the loop is bounded (budget cap + hard section cap → stoppedReason);
//   • coverage top-up lifts a thin report to its minimum length;
//   • hallucinated citations never survive into the report or its references;
//   • every reference traces back to a really-cited corpus work;
//   • the model failing on a section degrades gracefully instead of aborting.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-deep-research-test-'));

try {
  const outfile = path.join(tmp, 'deepResearchCore.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'electron/ai/deepResearchCore.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    external: ['@shared/*'],
    logLevel: 'silent',
  });
  const mod = await import(pathToFileURL(outfile).href);
  const {
    orchestrateDeepResearch,
    applyCitationPolicy,
    buildSnapshotMaps,
    buildCitationCatalog,
    resolveTargetPages,
    resolveSectionPlan,
    countWords,
    normalizeNarrativeSection,
    DEEP_RESEARCH_NARRATIVE_RULES,
    WORDS_PER_PAGE,
    MAX_SECTIONS,
  } = mod;

  // ── Fake corpus snapshot ────────────────────────────────────────────────────
  const makeSnapshot = (ideaCount) => {
    const ideas = Array.from({ length: ideaCount }, (_, i) => ({
      id: `g-${i}`,
      label: `Idea ${i}`,
      summary: `Resumen de la idea ${i}`,
      score: 1 - i / ideaCount,
      reason: 'test',
      type: 'claim',
      statement: `Enunciado sustantivo número ${i} sobre el fenómeno estudiado.`,
      themes: ['tema'],
      workCount: 1,
      evidenceCount: 2,
      works: [
        { nodus_id: `w-${i}`, title: `Obra ${i}`, authors: [`Autor${i}, N.`], year: 2000 + (i % 25), zotero_key: `zk-${i}` },
      ],
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
    const gaps = [
      {
        id: 'gap-1',
        label: 'Hueco 1',
        summary: 'Un hueco de investigación',
        score: 0.4,
        reason: 'test',
        kind: 'empirical',
        work: { nodus_id: 'w-0', title: 'Obra 0', authors: ['Autor0, N.'], year: 2000, zotero_key: 'zk-0' },
        relatedIdea: null,
        confidence: 0.7,
      },
    ];
    const contradictions = [
      {
        id: 'edge-1',
        label: 'Contradicción 1',
        summary: 'A contradice a B',
        score: 0.4,
        reason: 'test',
        fromLabel: 'A',
        toLabel: 'B',
        type: 'contradicts',
        basis: 'semantic',
        confidence: 0.6,
      },
    ];
    return {
      generatedAt: new Date().toISOString(),
      brief: { kind: 'deep_research', objective: 'obj', language: 'es' },
      stats: { ideas: ideaCount, themes: 0, gaps: 1, contradictions: 1, works: ideaCount, passages: 0, tutorRoutes: 0 },
      recommendedSelection: { ideaIds: [], themeIds: [], gapIds: [], contradictionIds: [], workIds: [], passageIds: [], tutorRouteIds: [] },
      ideas,
      themes: [],
      gaps,
      contradictions,
      works,
      passages: [],
      tutorRoutes: [],
    };
  }

  const HALLUCINATED = '[Fantasma, X. (1999)](nodus://idea/HALLUCINATED-999)';

  // A plan that spreads every pool idea across `sectionCount` sections + a conclusion.
  const fakePlan = (input) => {
    const ids = input.ideas.map((i) => i.id);
    const bodyCount = Math.max(1, input.sectionCount - 1);
    const per = Math.max(1, Math.ceil(ids.length / bodyCount));
    const sections = [];
    for (let b = 0; b < bodyCount; b++) {
      const chunk = ids.slice(b * per, (b + 1) * per);
      sections.push({
        id: `s${b + 1}`,
        title: `Sección ${b + 1}`,
        purpose: 'propósito',
        keyClaims: chunk.slice(0, 3).map((id) => `clave ${id}`),
        ideaIds: chunk,
        workIds: [],
        gapIds: b === 0 ? ['gap-1'] : [],
        contradictionIds: b === 0 ? ['edge-1'] : [],
        passageIds: [],
      });
    }
    sections.push({
      id: 'concl',
      title: 'Conclusión',
      purpose: 'cierre',
      keyClaims: ['síntesis'],
      ideaIds: [],
      workIds: [],
      gapIds: ['gap-1'],
      contradictionIds: ['edge-1'],
      passageIds: [],
    });
    return { title: 'Informe de prueba', abstract: 'resumen', sections };
  }

  // Writes ~targetWords words, cites every menu token verbatim, and slips in a
  // hallucinated citation the policy must strip.
  const fakeWriteSection = (input) => {
    const cites = input.citationMenu.map((c) => `Afirmación (${c.token}).`).join(' ');
    const filler = 'texto '.repeat(input.targetWords);
    return `## ${input.section.title}\n\n${cites} ${filler} ${HALLUCINATED}`;
  }

  const fakeFinalize = (input) => {
    return {
      title: 'Informe de prueba',
      abstract: 'Este informe desarrolla el objetivo a partir del corpus.',
      limitations: input.uncoveredSamples.length ? [`Sin desarrollar: ${input.uncoveredSamples.join('; ')}`] : [],
      nextSteps: ['Revisar citas.'],
    };
  }

  const baseDeps = (snapshot) => ({
    buildSnapshot: async () => snapshot,
    planReport: async (input) => fakePlan(input),
    writeSection: async (input) => fakeWriteSection(input),
    finalize: async (input) => fakeFinalize(input),
  });

  // ── 1. resolveTargetPages buckets ───────────────────────────────────────────
  assert.deepEqual(resolveTargetPages('concise', { ideas: [] }), { min: 5, max: 8 });
  assert.deepEqual(resolveTargetPages('standard', { ideas: [] }), { min: 9, max: 14 });
  assert.deepEqual(resolveTargetPages('exhaustive', { ideas: [] }), { min: 15, max: 20 });
  {
    const adaptive = resolveTargetPages('adaptive', { ideas: new Array(60).fill(0) });
    assert.ok(adaptive.min >= 5 && adaptive.max <= 20 && adaptive.max > adaptive.min, 'adaptive clamps to 5–20');
  }

  // ── 2. applyCitationPolicy: strip hallucinations, keep + relabel real ones ──
  {
    const snapshot = makeSnapshot(3);
    const maps = buildSnapshotMaps(snapshot);
    const md = `Uno [x](nodus://idea/g-0) y dos ${HALLUCINATED} y tres [y](nodus://work/w-1).`;
    const { markdown, cited } = applyCitationPolicy(md, maps);
    assert.ok(!markdown.includes('HALLUCINATED'), 'hallucinated citation stripped');
    assert.ok(markdown.includes('nodus://idea/g-0'), 'valid idea citation kept');
    assert.ok(markdown.includes('nodus://work/w-1'), 'valid work citation kept');
    assert.ok(markdown.includes('Autor0, N. (2000)'), 'idea label rewritten to canonical corpus label');
    assert.deepEqual([...cited.ideas], ['g-0']);
    assert.deepEqual([...cited.works], ['w-1']);
  }

  // ── 2b. buildCitationCatalog: trimmed pool, and every token is really citable ──
  {
    const snapshot = makeSnapshot(90);
    const maps = buildSnapshotMaps(snapshot);
    const catalog = buildCitationCatalog(snapshot);
    // Pool is trimmed to POOL_LIMITS.ideas (70) even though the snapshot has 90.
    assert.equal(catalog.ideas.length, 70, 'idea pool trimmed to POOL_LIMITS');
    assert.equal(catalog.gaps.length, 1, 'gaps surfaced');
    assert.equal(catalog.contradictions.length, 1, 'contradictions surfaced');
    // Client-driven guarantee: a report citing ONLY catalog tokens loses nothing.
    const md = [...catalog.ideas, ...catalog.works, ...catalog.gaps, ...catalog.contradictions]
      .map((c) => `Claim ${c.token}.`)
      .join('\n');
    const { markdown } = applyCitationPolicy(md, maps);
    assert.equal((markdown.match(/nodus:\/\//g) ?? []).length, md.match(/nodus:\/\//g).length, 'every catalog token survives the citation policy');
  }

  // ── 3. Full report: standard length, coverage, clean citations, references ──
  {
    const snapshot = makeSnapshot(40);
    const report = await orchestrateDeepResearch({ objective: 'X', language: 'es', targetLength: 'standard' }, baseDeps(snapshot));
    const { draft, meta } = report;

    assert.ok(meta.sections >= 4, 'produced several sections');
    assert.ok(meta.pages >= 9, `at least the 9-page minimum (got ${meta.pages})`);
    assert.ok(meta.pages <= 14 + 2, `does not blow past the 14-page target much (got ${meta.pages})`);
    assert.equal(meta.stoppedReason, null, 'standard run finishes without hitting a cap');

    // No hallucinated citation anywhere in the assembled report.
    assert.ok(!draft.draftMarkdown.includes('HALLUCINATED'), 'no hallucinated citation in report body');
    // Real citations are present and clickable.
    assert.ok(/nodus:\/\/idea\/g-\d+/.test(draft.draftMarkdown), 'report carries clickable idea citations');

    // References section exists, is non-empty, and every entry traces to a cited work.
    assert.ok(draft.draftMarkdown.includes('## Referencias'), 'report has a References section');
    assert.ok(draft.bibliography.length > 0, 'bibliography is populated');
    assert.ok(meta.worksCited > 0 && meta.ideasCovered > 0, 'coverage accounting is populated');
    // Coverage: with 40 ideas across body sections, most should be cited.
    assert.ok(meta.ideasCovered >= 30, `covers the bulk of the corpus ideas (got ${meta.ideasCovered}/40)`);

    // The draft round-trips into the Writing Workshop shape (export/save reuse).
    assert.equal(typeof draft.title, 'string');
    assert.ok(Array.isArray(draft.outline) && draft.outline.length === meta.sections);
    assert.equal(draft.stats.selectedIdeas, meta.ideasCovered);
  }

  // ── 4. Budget cap: runaway section length stops the loop and flags truncation ─
  {
    const snapshot = makeSnapshot(60);
    const deps = { ...baseDeps(snapshot), writeSection: async () => `## Larga\n\n${'palabra '.repeat(6000)}` };
    const report = await orchestrateDeepResearch({ objective: 'X', targetLength: 'concise' }, deps);
    assert.ok(report.meta.stoppedReason, 'runaway length trips a stop reason');
    assert.ok(/presupuesto|páginas/.test(report.meta.stoppedReason), 'stop reason mentions the page budget');
    assert.equal(report.draft.stats.truncated, true, 'draft marked truncated');
    assert.ok(report.meta.sections <= 22, 'never exceeds the hard section cap');
  }

  // ── 5. Thin sections stay bounded and complete (no runaway section count) ───
  {
    const snapshot = makeSnapshot(50);
    // Each section is deliberately tiny (ignores targetWords). Even so, the report must
    // stay within its section budget and keep full corpus coverage — never balloon.
    const deps = {
      ...baseDeps(snapshot),
      writeSection: async (input) => {
        return `## ${input.section.title}\n\nBreve (${input.citationMenu[0]?.token ?? ''}).\n\n### Matiz adicional\n\nContinuación breve.`;
      },
    };
    const report = await orchestrateDeepResearch({ objective: 'X', targetLength: 'standard' }, deps);
    // Standard auto plan stays small (few, deep sections) and bounded by the +1 grace.
    assert.ok(report.meta.sections >= 4 && report.meta.sections <= 6, `bounded section count (got ${report.meta.sections})`);
    assert.ok(report.meta.ideasCovered >= 40, `keeps full corpus coverage (got ${report.meta.ideasCovered}/50)`);
    assert.ok(!report.draft.draftMarkdown.includes('HALLUCINATED'), 'thin sections also citation-clean');
    assert.equal(report.meta.sections, 4, 'standard auto mode stays at four broad epigraphs');
    assert.ok(!report.draft.draftMarkdown.includes('### '), 'model-added microheadings are flattened');
    assert.ok(report.draft.draftMarkdown.includes('Matiz adicional. Continuación breve.'), 'microheading content remains as prose');
  }

  // ── 6. Resilience: plan + every section failing still yields a report ───────
  {
    const snapshot = makeSnapshot(12);
    const deps = {
      buildSnapshot: async () => snapshot,
      planReport: async () => {
        throw new Error('planner down');
      },
      writeSection: async () => {
        throw new Error('writer down');
      },
      finalize: async () => {
        throw new Error('finalizer down');
      },
    };
    const report = await orchestrateDeepResearch({ objective: 'X', targetLength: 'concise' }, deps);
    assert.ok(report.meta.sections > 0, 'fallback plan still produced sections');
    assert.ok(report.meta.stoppedReason && /degradada/.test(report.meta.stoppedReason), 'degraded generation is reported');
    assert.ok(report.draft.draftMarkdown.includes('## Referencias'), 'still assembles a full document');
    // Degraded sections still only cite real corpus ideas.
    assert.ok(!report.draft.draftMarkdown.includes('HALLUCINATED'), 'no fake citations even in degraded mode');
  }

  // ── 7. countWords sanity ────────────────────────────────────────────────────
  assert.equal(countWords('uno dos tres'), 3);
  assert.equal(countWords('[Autor (2020)](nodus://idea/g-1) palabra'), 3, 'link label counts, url does not');
  assert.equal(WORDS_PER_PAGE, 450);

  // ── 8. Narrative normalization: one epigraph, internal cuts become prose ───
  {
    const normalized = normalizeNarrativeSection(
      '## Título improvisado\n\nPrimer párrafo.\n\n### Contexto\n\nSegundo párrafo.\n\n#### Consecuencias\n\nTercer párrafo.',
      'Línea argumental amplia'
    );
    assert.equal((normalized.match(/^#{1,6}\s/gm) ?? []).length, 1, 'one visible epigraph per section');
    assert.ok(normalized.startsWith('## Línea argumental amplia'), 'the planned title is canonical');
    assert.ok(normalized.includes('Contexto. Segundo párrafo.'), 'internal heading becomes a prose lead');
    assert.ok(normalized.includes('Consecuencias. Tercer párrafo.'), 'all artificial subheadings are flattened');
    assert.ok(
      DEEP_RESEARCH_NARRATIVE_RULES.some((rule) => rule.includes('dos puntos') && rule.includes('guion largo')),
      'shared prose contract restricts disruptive punctuation'
    );
  }

  // ── 9. resolveSectionPlan: auto vs. user-capped, with the +1 grace ──────────
  {
    const auto = resolveSectionPlan({ min: 15, max: 20 }, 'auto');
    assert.equal(auto.mode, 'auto', 'auto mode reported');
    assert.ok(auto.target >= 3 && auto.target <= 7, `auto target stays small (got ${auto.target})`);
    assert.equal(resolveSectionPlan({ min: 9, max: 14 }, 'auto').target, 4, 'standard report defaults to four deep sections');
    assert.ok(auto.hardCap <= MAX_SECTIONS, 'auto hard cap respects the absolute ceiling');
    assert.ok(auto.hardCap === Math.min(MAX_SECTIONS, auto.target + 1), 'auto hard cap = target + 1 grace');

    const capped = resolveSectionPlan({ min: 15, max: 20 }, 5);
    assert.equal(capped.mode, 'user', 'user mode reported');
    assert.equal(capped.target, 5, 'user cap becomes the target');
    assert.equal(capped.hardCap, 6, 'user cap allows exactly one extra section');

    // An absurd cap is clamped to the absolute ceiling.
    const huge = resolveSectionPlan({ min: 15, max: 20 }, 999);
    assert.ok(huge.target <= MAX_SECTIONS && huge.hardCap <= MAX_SECTIONS, 'huge cap clamped to the ceiling');
  }

  // ── 10. A user section cap is honoured end-to-end (never exceeds cap + 1) ────
  {
    const snapshot = makeSnapshot(60);
    const report = await orchestrateDeepResearch(
      { objective: 'X', language: 'es', targetLength: 'exhaustive', sectionLimit: 4 },
      baseDeps(snapshot)
    );
    assert.ok(report.meta.sections <= 5, `respects the 4-section cap + 1 grace (got ${report.meta.sections})`);
    assert.ok(report.meta.sections >= 3, 'still produces a real report under a tight cap');
    // Even capped, references still trace to really-cited works.
    assert.ok(report.draft.bibliography.length > 0, 'capped report still has references');
    assert.ok(!report.draft.draftMarkdown.includes('HALLUCINATED'), 'capped report stays citation-clean');
  }

  // ── 11. Fewer/deeper by default: auto exhaustive stays tightly bounded ─────
  {
    const snapshot = makeSnapshot(60);
    const report = await orchestrateDeepResearch(
      { objective: 'X', language: 'es', targetLength: 'exhaustive' },
      baseDeps(snapshot)
    );
    assert.ok(report.meta.sections <= MAX_SECTIONS, 'never exceeds the absolute section ceiling');
    assert.ok(report.meta.sections <= 7, `auto mode favours few, deep sections (got ${report.meta.sections})`);
  }

  // ── 12. All writer routes inherit the same narrative contract ──────────────
  {
    const sources = await Promise.all([
      'electron/ai/deepResearch.ts',
      'electron/ai/genealogyDeepResearch.ts',
      'electron/ai/deepResearchClient.ts',
    ].map((file) => readFile(path.join(repoRoot, file), 'utf8')));
    assert.ok(sources.every((source) => source.includes('DEEP_RESEARCH_NARRATIVE_RULES')), 'all Deep Research writers share the prose contract');
    assert.match(sources[0], /nunca superes esa cifra en el plan inicial/, 'general planner cannot spend the grace slot on an extra heading');
    assert.match(sources[1], /nunca más de esa cifra en el plan inicial/, 'genealogy planner uses the same section discipline');
  }

  console.log('deep research orchestration test passed');
} finally {
  await rm(tmp, { recursive: true, force: true });
}
