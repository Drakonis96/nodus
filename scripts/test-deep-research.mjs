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
    // Types from @shared are erased at build time, but citation naming is a real
    // value import — the writer and the reader that re-derives its labels share one
    // implementation — so it has to be bundled in rather than left external.
    external: ['@shared/types', '@shared/deepResearchApproaches'],
    alias: { '@shared': path.join(repoRoot, 'shared') },
    logLevel: 'silent',
  });
  const mod = await import(pathToFileURL(outfile).href);
  const {
    orchestrateDeepResearch,
    applyCitationPolicy,
    buildSnapshotMaps,
    buildCitationCatalog,
    buildCitationMenu,
    normalizePlan,
    orderSections,
    normalizeSectionTitle,
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
    assert.ok(report.meta.sections >= 4 && report.meta.sections <= 7, `bounded section count (got ${report.meta.sections})`);
    // A writer that names one source per section HAS covered almost nothing, and the
    // report must say so instead of counting every assigned idea as developed.
    assert.ok(
      report.meta.ideasCovered < 20,
      `coverage reflects what was cited, not what was assigned (got ${report.meta.ideasCovered}/50)`
    );
    assert.ok(report.draft.limitations.length > 0, 'a thin report declares what it left out');
    assert.ok(!report.draft.draftMarkdown.includes('HALLUCINATED'), 'thin sections also citation-clean');
    assert.equal(report.meta.sections, 5, 'standard auto mode plans five sections, sized to what a section really delivers');
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
    assert.equal(resolveSectionPlan({ min: 9, max: 14 }, 'auto').target, 5, 'a 9-14 page target needs five sections at the measured ~1100 words each');
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

  // ── 11b. The writer is never handed a token whose content it cannot read ────
  {
    const snapshot = makeSnapshot(4);
    snapshot.passages = [
      {
        id: 'p-1',
        label: 'Obra 0 · p. 47',
        summary: 'El tiempo se hace tiempo humano en la medida en que se articula de modo narrativo.',
        score: 1,
        reason: 'test',
        nodus_id: 'w-0',
        pageLabel: 'p. 47',
        authors: ['Autor0, Nombre'],
        year: 2000,
        zotero_key: 'Z0',
        citation: 'nodus://passage/p-1',
      },
      // No readable text: this one must never become citable.
      {
        id: 'p-empty',
        label: 'Obra 1',
        summary: '   ',
        score: 1,
        reason: 'test',
        nodus_id: 'w-1',
        pageLabel: null,
        authors: ['Autor1, Nombre'],
        year: 2001,
        zotero_key: 'Z1',
        citation: 'nodus://passage/p-empty',
      },
    ];
    const maps = buildSnapshotMaps(snapshot);
    const menu = buildCitationMenu(
      {
        id: 's1',
        title: 't',
        purpose: 'p',
        keyClaims: [],
        ideaIds: ['g-0'],
        workIds: [],
        gapIds: ['gap-1'],
        contradictionIds: ['edge-1'],
        passageIds: ['p-1', 'p-empty'],
      },
      maps
    );
    const byKind = (kind) => menu.filter((item) => item.kind === kind);
    assert.equal(byKind('gap').length, 1, 'the gap is offered');
    assert.ok(
      byKind('gap')[0].note.includes(snapshot.gaps[0].summary.slice(0, 20)),
      'the gap carries what it actually says, not a placeholder'
    );
    assert.ok(
      byKind('contradiction')[0].note.includes(snapshot.contradictions[0].summary.slice(0, 20)),
      'the contradiction carries what it actually opposes'
    );
    assert.equal(byKind('passage').length, 1, 'the textless passage is not offered at all');
    assert.ok(byKind('passage')[0].note.includes('tiempo humano'), 'the passage carries its literal text');
    assert.ok(byKind('idea')[0].note.includes('Enunciado'), 'the idea carries its statement');
    // No menu entry may be a generic label.
    for (const item of menu) {
      assert.ok(item.note.trim().length > 12, `menu note is substantive for ${item.kind}`);
    }
  }

  // ── 11b2. Half-written references are repaired or dropped, never leaked ────
  {
    const snapshot = makeSnapshot(3);
    const maps = buildSnapshotMaps(snapshot);
    const md = [
      'Uno [Autor](nodus://idea/g-0].', // right link, wrong closing bracket
      'Dos [nodus://idea/g-1, nodus://idea/g-2].', // bare bracketed list
      'Tres nodus://work/w-0 sin enlace.', // bare reference in the prose
      'Cuatro nodus://idea/NO-EXISTE fantasma.', // bare reference to nothing
      'Cinco [Autor0, N. (2000) (nodus://idea/g-2)].', // brackets and parentheses swapped
      'Seis ([x](nodus://idea/g-0); Autor1, N. (2001)](nodus://idea/g-1)).', // second link lost its opening bracket
      'Siete y la autarquía Autor2, N. (2002)](nodus://idea/g-2) seguía siendo dura.', // orphan with no delimiter to anchor a label
      'Ocho [Fuentes Vega (2017)](nodus://contradicción/abc) con el tipo en español.', // invented target type
      'Nueve [hueco](nodus://280a3b7b-5404-4ab8) sin tipo ninguno.', // target with no type segment
    ].join('\n');
    const { markdown, cited } = applyCitationPolicy(md, maps);
    assert.ok(!/nodus:\/\/[^)]*\]/.test(markdown), 'no mismatched bracket survives');
    // Every surviving reference is a well-formed link, so nothing leaks a raw id.
    for (const match of markdown.matchAll(/nodus:\/\/[^\s)]+/g)) {
      const at = markdown.indexOf(match[0]);
      assert.equal(markdown[at - 1], '(', `reference ${match[0]} sits inside a real link`);
    }
    assert.ok(cited.ideas.has('g-0'), 'the mismatched bracket is still counted as a citation');
    assert.ok(cited.ideas.has('g-1') && cited.ideas.has('g-2'), 'the bare list is counted');
    assert.ok(cited.works.has('w-0'), 'the bare prose reference is counted');
    assert.ok(!markdown.includes('NO-EXISTE'), 'a bare reference to nothing is dropped entirely');
    // Repairing a broken neighbour must not damage a link that was already correct.
    assert.ok(!/\[\[/.test(markdown), 'no stray bracket is introduced next to a well-formed link');
    assert.equal((markdown.match(/\]\(nodus:\/\//g) ?? []).length, (markdown.match(/nodus:\/\//g) ?? []).length, 'every surviving reference sits in a link');
    // When the label cannot be reconstructed the reference goes, but the sentence stays.
    assert.ok(markdown.includes('y la autarquía Autor2, N. (2002) seguía siendo dura'), 'prose is never eaten to salvage a citation');
    // A link Nodus cannot resolve loses the link and keeps the visible text.
    assert.ok(!markdown.includes('contradicción/abc'), 'an invented target type is not printed');
    assert.ok(markdown.includes('Fuentes Vega (2017)'), 'its author-year survives as plain text');
    assert.ok(!markdown.includes('280a3b7b'), 'a target with no type segment is not printed');
  }

  // ── 11c. Coverage counts citations, and a short report is topped up ─────────
  {
    const snapshot = makeSnapshot(40);
    const phases = [];
    // A writer that produces prose but cites nothing at all.
    const deps = { ...baseDeps(snapshot), writeSection: async () => `## S\n\n${'palabra '.repeat(300)}` };
    const report = await orchestrateDeepResearch(
      { objective: 'X', language: 'es', targetLength: 'standard' },
      deps,
      (p) => phases.push(p.phase)
    );
    assert.equal(report.meta.ideasCovered, 0, 'citing nothing covers nothing');
    assert.ok(phases.includes('coverage'), 'a report under its minimum length triggers the coverage top-up');
    assert.ok(report.draft.limitations.length > 0, 'the report discloses the ideas it never developed');
    assert.equal(report.draft.stats.selectedIdeas, 0, 'the saved selection matches the honest coverage');
  }

  // ── 11d. Leftover ideas land where they fit, not by index arithmetic ────────
  {
    const snapshot = makeSnapshot(6);
    // Two clearly separate topics; the planner only claims one idea per section.
    snapshot.ideas[0].statement = 'La fotografía turística compone el paisaje nacional.';
    snapshot.ideas[1].statement = 'La legislación agraria reordena la propiedad rural.';
    snapshot.ideas[2].statement = 'La fotografía de prensa fija el paisaje como emblema.';
    snapshot.ideas[3].statement = 'La reforma de la propiedad rural altera el catastro agrario.';
    const plan = {
      title: 'T',
      abstract: '',
      sections: [
        { id: 's1', title: 'Fotografía y paisaje', purpose: 'La fotografía y el paisaje nacional.', keyClaims: [], ideaIds: ['g-0'], workIds: [], gapIds: [], contradictionIds: [], passageIds: [] },
        { id: 's2', title: 'Propiedad rural', purpose: 'La legislación agraria y la propiedad rural.', keyClaims: [], ideaIds: ['g-1'], workIds: [], gapIds: [], contradictionIds: [], passageIds: [] },
        { id: 's3', title: 'Cierre', purpose: 'síntesis', keyClaims: [], ideaIds: [], workIds: [], gapIds: [], contradictionIds: [], passageIds: [] },
      ],
    };
    const normalized = normalizePlan(plan, snapshot);
    const photography = normalized.sections.find((s) => s.id === 's1').ideaIds;
    const land = normalized.sections.find((s) => s.id === 's2').ideaIds;
    assert.ok(photography.includes('g-2'), 'the second photography idea joins the photography section');
    assert.ok(land.includes('g-3'), 'the second land idea joins the land section');
    assert.ok(!photography.includes('g-3') && !land.includes('g-2'), 'topics are not interleaved by index');
  }

  // ── 11e. Per-section retrieval reaches material the snapshot never held ─────
  {
    const snapshot = makeSnapshot(6);
    const extraIdea = {
      id: 'g-late',
      label: 'Idea tardía',
      summary: 'Recuperada durante la redacción.',
      score: 0.9,
      reason: 'test',
      type: 'claim',
      statement: 'Enunciado recuperado por la segunda pasada de recuperación.',
      themes: [],
      workCount: 1,
      evidenceCount: 1,
      works: [{ nodus_id: 'w-late', title: 'Obra tardía', authors: ['Tardío, Ana'], year: 2010, zotero_key: 'ZL' }],
    };
    const extraPassage = {
      id: 'p-late',
      label: 'Obra tardía · p. 12',
      summary: 'Texto literal recuperado para esta sección concreta.',
      score: 0.9,
      reason: 'test',
      nodus_id: 'w-late',
      pageLabel: 'p. 12',
      authors: ['Tardío, Ana'],
      year: 2010,
      zotero_key: 'ZL',
      citation: 'nodus://passage/p-late',
    };
    let asked = 0;
    const deps = {
      ...baseDeps(snapshot),
      retrieveForSection: async (input) => {
        asked += 1;
        assert.ok(input.sectionTitle, 'the retrieval is scoped to a section');
        return { ideas: [extraIdea], passages: [extraPassage] };
      },
    };
    const report = await orchestrateDeepResearch({ objective: 'X', language: 'es', targetLength: 'concise' }, deps);
    assert.ok(asked >= 2, 'the corpus is queried once per section, not only once per report');
    // Retrieved material survives the citation policy instead of being stripped.
    assert.ok(report.draft.draftMarkdown.includes('nodus://idea/g-late'), 'a retrieved idea is really citable');
    assert.ok(report.draft.draftMarkdown.includes('nodus://passage/p-late'), 'a retrieved passage is really citable');
    assert.ok(report.draft.bibliography.some((entry) => entry.includes('Tardío')), 'its work reaches the bibliography');
  }

  // ── 11f. Report language drives the document, not the developer's locale ────
  {
    const snapshot = makeSnapshot(8);
    const messages = [];
    const report = await orchestrateDeepResearch(
      { objective: 'X', language: 'en', targetLength: 'concise' },
      baseDeps(snapshot),
      (p) => messages.push(p.message)
    );
    assert.ok(report.draft.draftMarkdown.includes('## References'), 'an English report closes in English');
    assert.ok(!report.draft.draftMarkdown.includes('## Referencias'), 'no Spanish heading leaks in');
    assert.ok(messages.some((m) => /Gathering|Writing|Assembling/.test(m)), 'progress speaks the report language');
    assert.ok(!messages.some((m) => /Reuniendo|Redactando|Ensamblando/.test(m)), 'no Spanish progress copy leaks in');
  }

  // ── 11g. Reading order follows the declared dependencies, not the emission order ─
  {
    // The planner emits the consequence before its cause and the framing last.
    const emitted = [
      { id: 'consecuencia', role: 'body', dependsOn: ['origen'], title: 'Consecuencia', purpose: '', keyClaims: [], ideaIds: [], workIds: [], gapIds: [], contradictionIds: [], passageIds: [] },
      { id: 'cierre', role: 'synthesis', dependsOn: ['consecuencia'], title: 'Síntesis', purpose: '', keyClaims: [], ideaIds: [], workIds: [], gapIds: [], contradictionIds: [], passageIds: [] },
      { id: 'origen', role: 'body', dependsOn: [], title: 'Origen', purpose: '', keyClaims: [], ideaIds: [], workIds: [], gapIds: [], contradictionIds: [], passageIds: [] },
      { id: 'marco', role: 'intro', dependsOn: [], title: 'Planteamiento', purpose: '', keyClaims: [], ideaIds: [], workIds: [], gapIds: [], contradictionIds: [], passageIds: [] },
    ];
    const ordered = orderSections(emitted).map((s) => s.id);
    assert.deepEqual(ordered, ['marco', 'origen', 'consecuencia', 'cierre'], 'framing first, cause before consequence, synthesis last');

    // A dependency cycle must degrade to an order, never hang or drop a section.
    const cyclic = [
      { id: 'a', role: 'body', dependsOn: ['b'], title: 'A', purpose: '', keyClaims: [], ideaIds: [], workIds: [], gapIds: [], contradictionIds: [], passageIds: [] },
      { id: 'b', role: 'body', dependsOn: ['a'], title: 'B', purpose: '', keyClaims: [], ideaIds: [], workIds: [], gapIds: [], contradictionIds: [], passageIds: [] },
    ];
    assert.equal(orderSections(cyclic).length, 2, 'a cycle still yields every section');
    // An unknown dependency id is ignored rather than fatal.
    const dangling = [{ id: 'a', role: 'body', dependsOn: ['ghost'], title: 'A', purpose: '', keyClaims: [], ideaIds: [], workIds: [], gapIds: [], contradictionIds: [], passageIds: [] }];
    assert.equal(orderSections(dangling).length, 1, 'a dangling dependency is ignored');
  }

  // ── 11h. A short section is expanded once, and only if it really grew ───────
  {
    const snapshot = makeSnapshot(20);
    let expansions = 0;
    const deps = {
      ...baseDeps(snapshot),
      writeSection: async (input) => `## ${input.section.title}\n\nCorto (${input.citationMenu[0]?.token ?? ''}).`,
      expandSection: async (input) => {
        expansions += 1;
        assert.ok(input.draft.includes('Corto'), 'the expander sees its own draft');
        assert.ok(input.missingWords > 0, 'the expander is told how much is missing');
        return `## ${input.section.title}\n\n${input.draft} ${'desarrollo '.repeat(600)}`;
      },
    };
    const report = await orchestrateDeepResearch({ objective: 'X', language: 'es', targetLength: 'standard' }, deps);
    assert.ok(expansions > 0, 'a section far under target is expanded');
    assert.ok(report.meta.words > 1000, `the expansion reaches the report (got ${report.meta.words} words)`);

    // An expansion that does not actually grow the section is discarded, so a model
    // that merely reshuffles the same words cannot replace the original draft.
    let refused = 0;
    const stingy = {
      ...baseDeps(snapshot),
      writeSection: async (input) => `## ${input.section.title}\n\nBORRADOR original breve.`,
      expandSection: async (input) => {
        refused += 1;
        return `## ${input.section.title}\n\nEXPANSION igual.`;
      },
    };
    const weak = await orchestrateDeepResearch({ objective: 'X', language: 'es', targetLength: 'concise' }, stingy);
    assert.ok(refused > 0, 'the expansion was attempted');
    assert.ok(!weak.draft.draftMarkdown.includes('EXPANSION'), 'a non-growing expansion is discarded');
    assert.ok(weak.draft.draftMarkdown.includes('BORRADOR'), 'the original draft survives instead');
  }

  // ── 11i. Verification: a source that does not support the claim is removed ──
  {
    const snapshot = makeSnapshot(10);
    snapshot.passages = [
      {
        id: 'p-1',
        label: 'Obra 0 · p. 9',
        summary: 'El turismo interior creció durante la posguerra.',
        score: 1,
        reason: 'test',
        nodus_id: 'w-0',
        pageLabel: 'p. 9',
        authors: ['Autor0, N.'],
        year: 2000,
        zotero_key: 'zk-0',
        citation: 'nodus://passage/p-1',
      },
    ];
    // The writer cites two ideas per sentence; the judge rejects everything backed by
    // the work behind idea g-1, and accepts the rest.
    const rejected = new Set(['g-1']);
    let seenClaims = [];
    const deps = {
      ...baseDeps(snapshot),
      writeSection: async (input) => {
        const tokens = input.citationMenu.filter((c) => c.kind === 'idea').slice(0, 3);
        const sentences = tokens.map((c, i) => `Afirmación número ${i} sobre el asunto (${c.token}).`);
        return `## ${input.section.title}\n\n${sentences.join(' ')} ${'texto '.repeat(400)}`;
      },
      verifyCitations: async (claims) => {
        seenClaims = seenClaims.concat(claims);
        return claims.map((claim) => (rejected.has(claim.id) ? 'unsupported' : 'supports'));
      },
    };
    const report = await orchestrateDeepResearch({ objective: 'X', language: 'es', targetLength: 'concise' }, deps);

    // The judge must receive the real sentence and the real source content.
    assert.ok(seenClaims.length > 0, 'claims reached the verifier');
    assert.ok(seenClaims.every((c) => c.sentence.includes('Afirmación número')), 'each claim carries its own sentence');
    assert.ok(seenClaims.every((c) => c.content.length > 0), 'each claim carries what the source says');
    assert.ok(seenClaims.some((c) => c.content.includes('Enunciado sustantivo')), 'an idea claim carries its statement');

    // The rejected citation is gone from the prose …
    assert.ok(!report.draft.draftMarkdown.includes('nodus://idea/g-1'), 'an unsupported citation is removed from the body');
    // … and therefore from the accounting and the bibliography too.
    assert.ok(!report.draft.selection.ideaIds.includes('g-1'), 'it stops counting as covered');
    assert.ok(
      !report.draft.bibliography.some((entry) => entry.includes('Autor1')),
      'the work behind it leaves the bibliography unless something else cites it'
    );
    assert.ok(report.meta.verification, 'verification is reported');
    assert.ok(report.meta.verification.checked > 0, 'the number of checked claims is reported');
    assert.ok(report.meta.verification.unsupported > 0, 'the number of removed citations is reported');
    // Supported citations survive untouched.
    assert.ok(report.draft.draftMarkdown.includes('nodus://idea/g-0'), 'a supported citation is kept');
  }

  // ── 11j. A judge that fails or answers nonsense never damages the report ────
  {
    const snapshot = makeSnapshot(10);
    const base = await orchestrateDeepResearch({ objective: 'X', language: 'es', targetLength: 'concise' }, baseDeps(snapshot));
    for (const broken of [
      async () => {
        throw new Error('judge down');
      },
      async () => [],
      async () => ['sí', 'no'],
      async () => null,
    ]) {
      const report = await orchestrateDeepResearch(
        { objective: 'X', language: 'es', targetLength: 'concise' },
        { ...baseDeps(snapshot), verifyCitations: broken }
      );
      assert.equal(
        (report.draft.draftMarkdown.match(/nodus:\/\/idea\//g) ?? []).length,
        (base.draftMarkdown ?? base.draft.draftMarkdown).match(/nodus:\/\/idea\//g).length,
        'a broken judge leaves every citation in place'
      );
    }
  }

  // ── 11k. Split headings are folded into one phrase, keeping both halves ────
  {
    assert.equal(
      normalizeSectionTitle('La genealogía de la mirada: del mito romántico a la gestión institucional'),
      'La genealogía de la mirada, del mito romántico a la gestión institucional',
      'a colon becomes a comma and the subtitle survives'
    );
    assert.equal(
      normalizeSectionTitle('La construcción del imaginario: Fotografía, patrimonio y folclore'),
      'La construcción del imaginario, Fotografía, patrimonio y folclore',
      'a subtitle starting with a content word keeps its capital'
    );
    assert.equal(
      normalizeSectionTitle('Nacionalismo banal: Hacia una síntesis'),
      'Nacionalismo banal, hacia una síntesis',
      'a subtitle starting with a function word is lowercased'
    );
    assert.equal(normalizeSectionTitle('Un título limpio'), 'Un título limpio', 'a clean title is untouched');
    assert.equal(normalizeSectionTitle('Ratio 3:1 sin espacio'), 'Ratio 3:1 sin espacio', 'a colon without a following space is not a subtitle');

    // And it reaches the report, not just the helper.
    const snapshot = makeSnapshot(12);
    const deps = {
      ...baseDeps(snapshot),
      planReport: async (input) => {
        const plan = fakePlan(input);
        plan.sections[0].title = 'Genealogías del imaginario: del romanticismo a la propaganda';
        return plan;
      },
    };
    const report = await orchestrateDeepResearch({ objective: 'X', language: 'es', targetLength: 'concise' }, deps);
    assert.ok(
      report.draft.draftMarkdown.includes('## Genealogías del imaginario, del romanticismo a la propaganda'),
      'the assembled report carries the folded heading'
    );
    assert.ok(!/^##\s+[^\n]*:\s/mu.test(report.draft.draftMarkdown), 'no split heading survives into the document');
  }

  // ── 11l. Self-contradictions are reported only when both quotes are real ───
  {
    const snapshot = makeSnapshot(12);
    let seenSections = [];
    const run = (issues) =>
      orchestrateDeepResearch(
        { objective: 'X', language: 'es', targetLength: 'concise' },
        {
          ...baseDeps(snapshot),
          writeSection: async (input) =>
            `## ${input.section.title}\n\nEl turismo creció de forma sostenida durante el periodo (${input.citationMenu[0]?.token ?? ''}). ${'texto '.repeat(400)}`,
          checkCoherence: async (sections) => {
            seenSections = sections;
            return issues(sections);
          },
        }
      );

    // A tension whose quotes really appear is reported to the reader.
    const real = await run((sections) => [
      {
        sectionA: sections[0].title,
        quoteA: 'El turismo creció de forma sostenida durante el periodo',
        sectionB: sections[1].title,
        quoteB: 'El turismo creció de forma sostenida durante el periodo',
        issue: 'Una sección afirma crecimiento sostenido y la otra lo niega.',
      },
    ]);
    // Identical quotes are not a contradiction: the grounding must reject that too.
    assert.equal(real.meta.coherenceIssues, 0, 'two identical quotes are not a tension');

    // An invented quote is discarded rather than printed in the limitations.
    const invented = await run(() => [
      {
        sectionA: 'Sección 1',
        quoteA: 'El régimen prohibió por completo el turismo extranjero hasta 1975',
        sectionB: 'Sección 2',
        quoteB: 'La apertura turística comenzó en los años cuarenta con plena libertad',
        issue: 'Fechas incompatibles.',
      },
    ]);
    assert.equal(invented.meta.coherenceIssues, 0, 'an invented tension never reaches the report');
    assert.ok(
      !invented.draft.limitations.some((l) => l.includes('Fechas incompatibles')),
      'and never reaches the limitations either'
    );

    // The checker sees real section text, stripped of its heading.
    assert.ok(seenSections.length > 1, 'every section is offered to the coherence check');
    assert.ok(seenSections.every((s) => !s.text.startsWith('## ')), 'sections arrive without their heading');
    assert.ok(seenSections.some((s) => s.text.includes('El turismo creció')), 'sections arrive with their prose');

    // A failing checker must not cost the report anything.
    const broken = await orchestrateDeepResearch(
      { objective: 'X', language: 'es', targetLength: 'concise' },
      {
        ...baseDeps(snapshot),
        checkCoherence: async () => {
          throw new Error('coherence down');
        },
      }
    );
    assert.equal(broken.meta.coherenceIssues, 0, 'a broken coherence check degrades to zero findings');
    assert.ok(broken.draft.draftMarkdown.includes('## Referencias'), 'and the report still assembles');
  }

  // ── 11m. Every visible citation reads like a citation ──────────────────────
  {
    const snapshot = makeSnapshot(6);
    // A gap anchored to a work, a debate with a named side, and a work whose author
    // the corpus never captured.
    snapshot.gaps[0].work = { nodus_id: 'w-0', title: 'Obra 0', authors: ['Fuentes Vega, Ana'], year: 2017, zotero_key: 'zk-0' };
    snapshot.contradictions[0].sources = ['Brandis García (2015)', 'Otro (2011)'];
    snapshot.ideas[1].works = [{ nodus_id: 'w-x', title: 'Bibliografía de viajeros por España y Portugal', authors: [], year: 2004, zotero_key: 'zk-x' }];
    const maps = buildSnapshotMaps(snapshot);
    const menu = buildCitationMenu(
      { id: 's1', title: 't', purpose: '', keyClaims: [], ideaIds: ['g-1'], workIds: [], gapIds: ['gap-1'], contradictionIds: ['edge-1'], passageIds: [] },
      maps
    );
    const anchorOf = (kind) => menu.find((i) => i.kind === kind).token.match(/^\[([^\]]*)\]/)[1];
    assert.equal(anchorOf('gap'), 'Fuentes Vega, A. (2017)', 'a gap is cited by the work it is anchored to');
    assert.equal(anchorOf('contradiction'), 'Brandis García (2015)', 'a debate is cited by whoever holds a side');
    assert.ok(!/^Autor$|^Autor \(/.test(anchorOf('idea')), 'no bare "Autor" placeholder reaches the prose');
    assert.ok(anchorOf('idea').includes('Bibliografía de viajeros'), 'an authorless work is cited by its shortened title');

    // And the anchors survive the citation policy unchanged.
    const { markdown } = applyCitationPolicy(`Frase (${menu.find((i) => i.kind === 'gap').token}).`, maps);
    assert.ok(markdown.includes('[Fuentes Vega, A. (2017)]'), 'the policy keeps the readable anchor');
    assert.ok(!markdown.includes('[hueco]'), 'the debug-looking label is gone');
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
