import type {
  DeepResearchMeta,
  DeepResearchProgress,
  DeepResearchReport,
  DeepResearchRequest,
  DeepResearchTargetLength,
  PromptLanguage,
  WritingWorkshopBrief,
  WritingWorkshopDraft,
  WritingWorkshopIdeaCandidate,
  WritingWorkshopMatrixRow,
  WritingWorkshopSection,
  WritingWorkshopSnapshot,
  SupportAuditEntry,
} from '@shared/types';

// ─────────────────────────────────────────────────────────────────────────────
// Pure orchestration core for Deep Research. This module has NO Electron / DB /
// AI-provider imports (only erased type imports), so the whole control flow —
// planning, coverage top-up, budget caps, citation policy, assembly — can be
// unit-tested with injected fakes. The AI/DB wiring lives in ./deepResearch.ts.
//
// Every long-running loop below is bounded so a slow or misbehaving model can
// never produce an unbounded report, spend, or hang.
// ─────────────────────────────────────────────────────────────────────────────

/** Rough academic density used to translate word counts into a page estimate. */
export const WORDS_PER_PAGE = 450;
const MIN_TARGET_PAGES = 5;
const MAX_TARGET_PAGES = 20;
/**
 * How many words a section actually holds, used to decide how many sections a page
 * target needs.
 *
 * This was 1400, chosen as an aspiration: few long sections, depth over
 * fragmentation. Measured against real reports the aspiration never happened — a
 * section asked for 1575 words came back with ~1040, and it stayed at ~1040 even
 * after the expansion pass rewrote it (10 of 12 sections were expanded and 11 of 12
 * still finished under target). Every report therefore landed at the floor of its
 * page range. Sizing the plan to what a section really delivers is what puts a
 * report in the middle of its range instead: the sections are the same length as
 * before, there are simply enough of them to reach the target.
 */
const SECTION_TARGET_WORDS = 1100;
/** Never fewer than this many sections (intro · body · synthesis at the very least). */
export const MIN_SECTIONS = 3;
/** Absolute safety ceiling on total sections (planned + coverage top-ups) — stops runaway loops. */
export const MAX_SECTIONS = 14;
/** The heuristic never *targets* more than this many sections before the +1 grace. */
const MAX_PLAN_SECTIONS = 7;
/** A numeric user cap is allowed to be exceeded by at most this many sections. */
const SECTION_GRACE = 1;
/** Coverage top-up may add at most this many extra sections beyond the plan. */
const MAX_TOPUP_SECTIONS = 2;
/** Per-section word budget is clamped to this window (min, max). Upper end allows deep sections. */
const SECTION_WORDS_RANGE = { min: 800, max: 1800 } as const;
/** Trim the material pool handed to the planner so the prompt stays within limits. */
export const POOL_LIMITS = { ideas: 70, themes: 20, gaps: 20, contradictions: 16, works: 40, passages: 20 } as const;
const MAX_MATRIX_ROWS = 80;
/**
 * A section can only develop so much material in one pass. Beyond this the citation
 * menu turns into a catalogue the writer skims instead of an argument it builds, so
 * surplus ideas are left for the coverage top-up rather than dumped into a section.
 */
const MAX_SECTION_IDEAS = 18;
/** How much of an idea's statement reaches the writer. */
const IDEA_NOTE_CHARS = 240;
/** How much of a literal passage reaches the writer. Never truncate below usefulness. */
const PASSAGE_NOTE_CHARS = 480;
/** Extra material a per-section retrieval may add on top of what the planner assigned. */
const SECTION_RETRIEVAL_LIMITS = { ideas: 6, passages: 4 } as const;
/** How many flagged claims the audit lists. Enough to spot-check, not a second report. */
const MAX_SUPPORT_AUDIT = 40;
/** Below this share of its word target a section gets one expansion pass. */
const MIN_SECTION_FILL = 0.78;

/** Shared prose contract for every Deep Research writer, including genealogy and
 * MCP-client mode. These are writing constraints, not a locale-specific UI copy. */
export const DEEP_RESEARCH_NARRATIVE_RULES = [
  'Prioriza una narración argumental continua, bien hilada y razonada. Cada párrafo debe avanzar desde el anterior mediante transiciones naturales.',
  'Usa pocos epígrafes amplios. Dentro de cada sección no añadas subtítulos, microsecciones, rótulos temáticos ni encabezados adicionales.',
  'No conviertas cada idea, fuente, autor, periodo o matiz en una sección independiente. Intégralos dentro de una misma línea argumental cuando formen parte del mismo movimiento del razonamiento.',
  'Evita los dos puntos, el punto y coma y el guion largo. Úsalos únicamente cuando sean estrictamente necesarios, por ejemplo dentro de una cita literal o una referencia que deba conservarse.',
  'Prefiere frases completas enlazadas con puntos, comas y conectores discursivos. Evita párrafos que comiencen con etiquetas como «Contexto:», «Evidencia:» o «Conclusión:».',
  'No uses listas salvo que la información no pueda expresarse con claridad como prosa continua.',
] as const;

export interface DeepResearchPlanSection {
  id: string;
  title: string;
  purpose: string;
  keyClaims: string[];
  ideaIds: string[];
  workIds: string[];
  gapIds: string[];
  contradictionIds: string[];
  passageIds: string[];
  /** Where the section sits in the report's architecture. */
  role?: 'intro' | 'body' | 'synthesis';
  /** Ids of the sections whose ground this one presupposes. The planner states the
   * dependencies; {@link orderSections} turns them into the reading order, so a
   * coherent sequence is a property of the engine rather than luck of the draw. */
  dependsOn?: string[];
}

export interface DeepResearchPlan {
  title: string;
  abstract: string;
  sections: DeepResearchPlanSection[];
}

export interface PlanInput {
  objective: string;
  language: PromptLanguage;
  audience?: string;
  /** Soft target number of sections the planner should aim for. */
  sectionCount: number;
  /** Hard ceiling the planner must not exceed (already includes the +1 grace). */
  sectionHardCap: number;
  /** Whether the user pinned a section cap ('user') or left it to the model ('auto'). */
  sectionMode: 'auto' | 'user';
  targetPages: { min: number; max: number };
  ideas: { id: string; label: string; type: string; statement: string; works: string }[];
  themes: { id: string; label: string; summary: string }[];
  gaps: { id: string; label: string; summary: string }[];
  contradictions: { id: string; label: string; summary: string }[];
  works: { id: string; label: string; summary: string }[];
}

/**
 * One citable token the model must copy verbatim, plus the material it stands for.
 * `note` always carries the real content (the idea's statement, what the gap says,
 * what the contradiction opposes, the literal words of the passage) — never a
 * placeholder. A writer that cannot read what it is citing can only invent.
 */
export interface CitationMenuItem {
  token: string;
  note: string;
  kind: 'idea' | 'work' | 'gap' | 'contradiction' | 'passage';
  /** Author/year the token resolves to, so the writer can attribute in prose. */
  source?: string;
}

export interface SectionInput {
  objective: string;
  language: PromptLanguage;
  audience?: string;
  section: DeepResearchPlanSection;
  targetWords: number;
  isConclusion: boolean;
  citationMenu: CitationMenuItem[];
  priorSummary: string;
  /** Claims already developed earlier, verbatim, so the writer can build on them
   * instead of restating them. Derived from what was really cited, not from the plan. */
  alreadyDeveloped: string[];
}

/**
 * One claim as it stands in the finished prose, paired with the material cited to
 * support it. This is the unit the verification pass judges: not "does this id
 * exist" (the citation policy already guarantees that) but "does what this source
 * says actually support what this sentence asserts".
 */
export interface CitationClaim {
  /** Position in the section markdown, used to apply the verdict back. */
  offset: number;
  /** The full citation link as it appears, so it can be removed verbatim. */
  link: string;
  kind: 'idea' | 'passage' | 'gap' | 'contradiction';
  id: string;
  /** The sentence the citation sits in, with citation markup removed. */
  sentence: string;
  /** What the cited source actually says. */
  content: string;
}

export type CitationVerdict = 'supports' | 'partial' | 'unsupported';

/** What a per-section retrieval asks the corpus for. */
export interface SectionRetrievalInput {
  objective: string;
  sectionTitle: string;
  purpose: string;
  keyClaims: string[];
  /** Already on the section's desk; the retriever should return something else. */
  excludeIdeaIds: string[];
  excludePassageIds: string[];
  limits: { ideas: number; passages: number };
}

export interface FinalizeInput {
  objective: string;
  language: PromptLanguage;
  planTitle: string;
  sectionTitles: string[];
  ideasCovered: number;
  ideasConsidered: number;
  uncoveredSamples: string[];
}

export interface FinalizeResult {
  title: string;
  abstract: string;
  limitations: string[];
  nextSteps: string[];
}

/**
 * Everything the orchestrator needs from the outside world. Injected so the loop
 * logic can be tested with fakes — no DB, no AI provider, no Electron.
 */
export interface DeepResearchDeps {
  buildSnapshot(brief: WritingWorkshopBrief): Promise<WritingWorkshopSnapshot>;
  planReport(input: PlanInput): Promise<DeepResearchPlan>;
  writeSection(input: SectionInput): Promise<string>;
  finalize(input: FinalizeInput): Promise<FinalizeResult>;
  /**
   * Optional second retrieval pass, run once per section with that section's own
   * focus as the query. The initial snapshot is ranked against the whole objective,
   * so a section about a narrow sub-question would otherwise never get to ask the
   * corpus about it — least of all for literal passages, which the snapshot caps
   * hard. Omitted (undefined) keeps the single-shot behaviour.
   */
  retrieveForSection?(input: SectionRetrievalInput): Promise<{
    ideas?: WritingWorkshopIdeaCandidate[];
    passages?: WritingWorkshopSnapshot['passages'];
  }>;
  /**
   * Optional single expansion of a section that came back far shorter than asked.
   * Writers systematically under-deliver against a word target (measured at ~60% of
   * it), and the engine used to accept whatever arrived, so reports landed at the
   * floor of their page range. Omitted keeps the single-pass behaviour.
   */
  expandSection?(input: SectionInput & { draft: string; missingWords: number }): Promise<string>;
  /**
   * Optional entailment check over the finished prose. The citation policy proves a
   * source exists and is really in the corpus; only this proves the source supports
   * the sentence it was attached to. Must return one verdict per claim, in order.
   * Omitted skips verification entirely.
   */
  verifyCitations?(claims: CitationClaim[]): Promise<CitationVerdict[]>;
  /**
   * Optional read-only check for sections that contradict each other. Deliberately
   * cannot rewrite: a pass that edits assembled prose puts every verified citation
   * at risk, so this only reports. Each finding must quote both sides verbatim so
   * the orchestrator can confirm the sentences really exist before believing it.
   */
  checkCoherence?(sections: { title: string; text: string }[]): Promise<CoherenceIssue[]>;
}

/** Two passages of the same report that cannot both be right. */
export interface CoherenceIssue {
  sectionA: string;
  quoteA: string;
  sectionB: string;
  quoteB: string;
  issue: string;
}

interface WorkInfo {
  nodus_id: string;
  title: string;
  authors: string[];
  year: number | null;
  zotero_key: string;
  /** The only locator the local schema stores. Publisher and journal live in Zotero,
   * so a reference entry can be author-year-title-DOI and no more than that. */
  doi?: string | null;
}

export interface SnapshotMaps {
  ideaById: Map<string, WritingWorkshopIdeaCandidate>;
  workInfoById: Map<string, WorkInfo>;
  passageWorkId: Map<string, string>;
  passagePage: Map<string, string | null>;
  /** Literal passage text. A passage with no text here is never offered as citable. */
  passageText: Map<string, string>;
  /** What each gap actually says, plus the author-year it is anchored to. */
  gapById: Map<string, { label: string; summary: string; source: string }>;
  /** What each contradiction actually opposes, and who holds each side. */
  contradictionById: Map<string, { label: string; summary: string; sources: string[] }>;
  validIds: Set<string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// The orchestrator (pure control flow over injected dependencies)
// ─────────────────────────────────────────────────────────────────────────────

export async function orchestrateDeepResearch(
  request: DeepResearchRequest,
  deps: DeepResearchDeps,
  onProgress?: (p: DeepResearchProgress) => void
): Promise<DeepResearchReport> {
  const language = request.language ?? 'es';
  const L = labels(language);
  const emit = (p: DeepResearchProgress) => {
    try {
      onProgress?.(p);
    } catch {
      /* progress is best-effort; never let a UI callback abort the report */
    }
  };

  emit({ phase: 'snapshot', message: L.gathering });
  const brief: WritingWorkshopBrief = {
    kind: 'deep_research',
    objective: request.objective,
    audience: request.audience,
    tone: 'academic',
    language,
  };
  const snapshot = await deps.buildSnapshot(brief);
  const maps = buildSnapshotMaps(snapshot);

  const targetPages = resolveTargetPages(request.targetLength ?? 'adaptive', snapshot);
  const sectionPlan = resolveSectionPlan(targetPages, request.sectionLimit ?? 'auto');
  const sectionCount = sectionPlan.target;
  const sectionHardCap = sectionPlan.hardCap;

  emit({ phase: 'planning', message: L.planning(sectionCount, targetPages) });
  const plan = await planWithFallback(deps, request, language, snapshot, sectionPlan, targetPages);

  // Budget is measured over the BODY sections only. The abstract, limitations and
  // the final bibliography are assembled separately and never consume this budget,
  // so references at the end never eat into the page/word target.
  const maxWords = targetPages.max * WORDS_PER_PAGE;
  const minWords = targetPages.min * WORDS_PER_PAGE;

  const written: { section: DeepResearchPlanSection; markdown: string }[] = [];
  /** Ideas the prose really cites. */
  const coveredIdeaIds = new Set<string>();
  /** Ideas a section was told to develop, cited or not — used to report honestly. */
  const assignedIdeaIds = new Set<string>();
  const citedIds = {
    ideas: new Set<string>(),
    works: new Set<string>(),
    gaps: new Set<string>(),
    contradictions: new Set<string>(),
    passages: new Set<string>(),
  };
  let totalWords = 0;
  let stoppedReason: string | null = null;
  const verification = { checked: 0, partial: 0, unsupported: 0 };
  const supportAudit: SupportAuditEntry[] = [];
  let expansions = 0;
  const sectionFill: { words: number; target: number }[] = [];

  const runSection = async (
    section: DeepResearchPlanSection,
    isConclusion: boolean,
    mergeIntoIndex: number | null = null
  ): Promise<void> => {
    // Spread the page budget across the planned sections → fewer sections means each
    // one gets a bigger, deeper word target (clamped so it stays writable in one pass).
    const targetWords = clamp(
      Math.round(maxWords / Math.max(sectionCount, 1)),
      SECTION_WORDS_RANGE.min,
      SECTION_WORDS_RANGE.max
    );
    emit({
      phase: 'section',
      message: `${L.writing}: ${section.title}`,
      sectionIndex: written.length + 1,
      sectionTitle: section.title,
      wordsSoFar: totalWords,
      pagesSoFar: pagesFromWords(totalWords),
    });

    // Ask the corpus again, this time about THIS section. Anything it returns is
    // folded into the maps first, so it is genuinely citable rather than stripped.
    if (deps.retrieveForSection) {
      try {
        const material = await deps.retrieveForSection({
          objective: request.objective,
          sectionTitle: section.title,
          purpose: section.purpose,
          keyClaims: section.keyClaims,
          excludeIdeaIds: section.ideaIds,
          excludePassageIds: section.passageIds,
          limits: SECTION_RETRIEVAL_LIMITS,
        });
        const merged = mergeRetrievedMaterial(maps, material ?? {});
        const roomForIdeas = Math.max(0, MAX_SECTION_IDEAS - section.ideaIds.length);
        section.ideaIds = [...new Set([...section.ideaIds, ...merged.ideaIds.slice(0, roomForIdeas)])];
        section.passageIds = [...new Set([...section.passageIds, ...merged.passageIds])];
      } catch {
        /* retrieval is an enrichment; the section still writes from the plan */
      }
    }

    let raw = '';
    try {
      raw = await deps.writeSection(sectionInput(request, language, section, targetWords, isConclusion, maps, written, coveredIdeaIds));
    } catch {
      // One retry, then a graceful degraded section — never fail the whole report.
      try {
        raw = await deps.writeSection(sectionInput(request, language, section, targetWords, isConclusion, maps, written, coveredIdeaIds));
      } catch {
        raw = degradedSection(section, maps, L);
        if (!stoppedReason) stoppedReason = L.degraded;
      }
    }

    // A section that came back well under its target gets exactly one chance to
    // develop further. Bounded to a single call so a terse model cannot loop.
    if (deps.expandSection && raw.trim()) {
      const draftWords = countWords(raw);
      if (draftWords < targetWords * MIN_SECTION_FILL) {
        try {
          const expanded = await deps.expandSection({
            ...sectionInput(request, language, section, targetWords, isConclusion, maps, written, coveredIdeaIds),
            draft: raw,
            missingWords: Math.max(0, targetWords - draftWords),
          });
          // Only accept an expansion that genuinely grew the argument.
          if (countWords(expanded) > draftWords * 1.1) {
            raw = expanded;
            expansions += 1;
          }
        } catch {
          /* the original section stands */
        }
      }
    }

    let { markdown, cited } = applyCitationPolicy(normalizeNarrativeSection(raw, section.title), maps);

    // Entailment pass. Everything downstream — the cited sets, the references, the
    // matrix — is derived from the VERIFIED text, so a citation the source does not
    // support cannot survive anywhere in the report, not even in the bibliography.
    if (deps.verifyCitations) {
      const claims = extractCitationClaims(markdown, maps);
      if (claims.length > 0) {
        try {
          const verdicts = await deps.verifyCitations(claims);
          if (Array.isArray(verdicts) && verdicts.length === claims.length) {
            const outcome = applyVerification(markdown, claims, verdicts);
            verification.checked += outcome.checked;
            verification.partial += outcome.partial;
            verification.unsupported += outcome.unsupported;
            for (const entry of outcome.audit) {
              if (supportAudit.length >= MAX_SUPPORT_AUDIT) break;
              supportAudit.push({
                verdict: entry.verdict,
                kind: entry.claim.kind,
                section: section.title,
                sentence: entry.claim.sentence,
                source: clip(entry.claim.content, 400),
                sourceLabel: sourceLabelForClaim(entry.claim, maps),
              });
            }
            if (outcome.unsupported > 0) {
              markdown = outcome.markdown;
              ({ cited } = applyCitationPolicy(markdown, maps));
            }
          }
        } catch {
          /* an unavailable judge must not cost the report its section */
        }
      }
    }
    if (mergeIntoIndex != null && written[mergeIntoIndex]) {
      const existing = written[mergeIntoIndex];
      existing.markdown = `${existing.markdown.trim()}\n\n${stripInitialHeading(markdown)}`.trim();
      existing.section = mergePlanSections(existing.section, section);
    } else {
      written.push({ section, markdown });
    }
    // Coverage is what the prose actually cites. Counting a section's *mandate* as
    // covered made the statistic unfalsifiable (every idea is assigned to some
    // section, so it always read 100%) and silently disabled the top-up below.
    for (const id of cited.ideas) {
      citedIds.ideas.add(id);
      coveredIdeaIds.add(id);
    }
    for (const id of section.ideaIds) if (maps.ideaById.has(id)) assignedIdeaIds.add(id);
    cited.works.forEach((id) => citedIds.works.add(id));
    cited.gaps.forEach((id) => citedIds.gaps.add(id));
    cited.contradictions.forEach((id) => citedIds.contradictions.add(id));
    cited.passages.forEach((id) => {
      citedIds.passages.add(id);
      const workId = maps.passageWorkId.get(id);
      if (workId) citedIds.works.add(workId);
    });
    sectionFill.push({ words: countWords(markdown), target: targetWords });
    totalWords += countWords(markdown);
  };

  // Planned sections.
  for (let i = 0; i < plan.sections.length; i++) {
    if (written.length >= sectionHardCap) {
      stoppedReason = L.stoppedSections(sectionHardCap);
      break;
    }
    if (totalWords >= maxWords) {
      stoppedReason = L.stoppedPages(targetPages.max);
      break;
    }
    // The page range is a target, not a cap. A stronger model writes longer sections
    // than the plan assumed and overshoots by a page or two; cutting a section to
    // claw that back would cost an argument to save a page, which is a bad trade in
    // a research report. Only the hard budget check above stops the loop.
    const isConclusion = i === plan.sections.length - 1;
    await runSection(plan.sections[i], isConclusion);
  }

  // Coverage top-up: keep deepening while the report is under its minimum length
  // and relevant ideas remain uncovered — but never past the hard caps.
  let topups = 0;
  while (totalWords < minWords && written.length < sectionHardCap && topups < MAX_TOPUP_SECTIONS && !stoppedReason) {
    const uncovered = pendingIdeas(snapshot, coveredIdeaIds, assignedIdeaIds).slice(0, 6);
    if (uncovered.length === 0) break;
    topups += 1;
    emit({
      phase: 'coverage',
      message: L.coverage(uncovered.length),
      wordsSoFar: totalWords,
      pagesSoFar: pagesFromWords(totalWords),
    });
    // Expand the last body section instead of creating a new "development
    // complement" epigraph. Coverage grows the argument, not the outline.
    const mergeIntoIndex = Math.max(0, written.length - (written.length > 1 ? 2 : 1));
    const before = totalWords;
    await runSection(coverageSection(topups, uncovered, L), false, mergeIntoIndex);
    // A top-up that adds nothing would spin the loop against the same ideas.
    if (totalWords <= before) break;
  }

  emit({
    phase: 'assembling',
    message: L.assembling,
    wordsSoFar: totalWords,
    pagesSoFar: pagesFromWords(totalWords),
  });

  // Does the report contradict itself? Reported, never repaired: rewriting assembled
  // prose would put every verified citation at risk, and a researcher is better
  // served by being told where the tension is than by having it quietly smoothed.
  let coherenceIssues: CoherenceIssue[] = [];
  if (deps.checkCoherence && written.length > 1) {
    try {
      const sections = written.map((w) => ({ title: w.section.title, text: stripInitialHeading(w.markdown) }));
      coherenceIssues = groundCoherenceIssues(await deps.checkCoherence(sections), sections);
    } catch {
      /* a missing coherence check never costs the report */
    }
  }

  // Now that coverage means "cited", these samples are real: they name material the
  // report was handed and did not use, which is exactly what a limitation should say.
  const pending = pendingIdeas(snapshot, coveredIdeaIds, assignedIdeaIds);
  const uncoveredSamples = pending.slice(0, 5).map((idea) => idea.label);

  const finalize = await finalizeWithFallback(
    deps,
    {
      objective: request.objective,
      language,
      planTitle: plan.title,
      sectionTitles: written.map((w) => w.section.title),
      ideasCovered: coveredIdeaIds.size,
      ideasConsidered: snapshot.ideas.length,
      uncoveredSamples,
    },
    L
  );

  // Works actually referenced = works cited directly + the works behind every cited idea.
  const citedWorkIds = collectCitedWorkIds(citedIds, maps);
  const references = buildReferences(citedWorkIds, maps, language);
  const draftMarkdown = assembleMarkdown(written, references, finalize, language);
  const worksCited = citedWorkIds.size;

  const outline: WritingWorkshopSection[] = written.map((w, index) => ({
    id: w.section.id || `s${index + 1}`,
    title: w.section.title,
    purpose: w.section.purpose,
    keyClaims: w.section.keyClaims.slice(0, 8),
    sources: sectionSources(w.section, maps),
  }));

  const matrix = buildMatrix(coveredIdeaIds, maps, L);

  const draft: WritingWorkshopDraft = {
    generatedAt: new Date().toISOString(),
    brief,
    selection: {
      ideaIds: [...coveredIdeaIds],
      themeIds: [],
      gapIds: [...citedIds.gaps],
      contradictionIds: [...citedIds.contradictions],
      workIds: [...citedWorkIds],
      passageIds: [...citedIds.passages],
      tutorRouteIds: [],
    },
    title: finalize.title || plan.title || request.objective,
    abstract: finalize.abstract,
    outline,
    draftMarkdown,
    matrix,
    bibliography: references,
    nextSteps: finalize.nextSteps,
    supportAudit,
    limitations: [...finalize.limitations, ...coherenceIssues.map((issue) => L.coherenceLimitation(issue))],
    stats: {
      selectedIdeas: coveredIdeaIds.size,
      selectedThemes: 0,
      selectedGaps: citedIds.gaps.size,
      selectedContradictions: citedIds.contradictions.size,
      selectedWorks: worksCited,
      selectedPassages: citedIds.passages.size,
      selectedTutorRoutes: 0,
      contextChars: draftMarkdown.length,
      truncated: stoppedReason != null,
    },
  };

  const meta: DeepResearchMeta = {
    sections: written.length,
    words: totalWords,
    pages: pagesFromWords(totalWords),
    ideasCovered: coveredIdeaIds.size,
    ideasConsidered: snapshot.ideas.length,
    worksCited,
    targetPages,
    stoppedReason,
    verification: verification.checked > 0 ? { ...verification } : null,
    expansions,
    sectionFill,
    coherenceIssues: coherenceIssues.length,
  };

  emit({
    phase: 'done',
    message: L.done(written.length, meta.pages),
    wordsSoFar: totalWords,
    pagesSoFar: meta.pages,
  });

  return { draft, meta };
}

function sectionInput(
  request: DeepResearchRequest,
  language: PromptLanguage,
  section: DeepResearchPlanSection,
  targetWords: number,
  isConclusion: boolean,
  maps: SnapshotMaps,
  written: { section: DeepResearchPlanSection; markdown: string }[],
  covered: Set<string>
): SectionInput {
  return {
    objective: request.objective,
    language,
    audience: request.audience,
    section,
    targetWords,
    isConclusion,
    citationMenu: buildCitationMenu(section, maps),
    priorSummary: summarizePrior(written),
    alreadyDeveloped: [...covered]
      .map((id) => maps.ideaById.get(id))
      .filter((idea): idea is WritingWorkshopIdeaCandidate => !!idea)
      .slice(0, 24)
      .map((idea) => clip(idea.statement || idea.label, 140)),
  };
}

/** Spanish and English function words that start a subtitle and read better lowercased. */
const SUBTITLE_LEAD_WORDS = new Set(
  ('del de la el los las un una unos unas hacia entre desde sobre para por con sin tras ante entre cuando donde como '
    + 'cómo qué quién cuál hasta the a an of from to towards between within during through under over and or').split(' ')
);

/**
 * Fold a `Título: subtítulo` heading into one continuous phrase.
 *
 * The prose contract asks the planner to avoid split titles and it complies most of
 * the time, but not always — measured at 3 of 15 headings, and the rate grew as the
 * report gained sections. Asking a fourth time was not going to work, so the shape
 * is enforced here instead of requested. The subtitle is kept, not truncated: the
 * information in it is usually the half that says what the section actually argues.
 */
export function normalizeSectionTitle(title: string): string {
  const clean = (title ?? '').replace(/\s+/g, ' ').trim();
  const at = clean.search(/\s*[:;—]\s+/u);
  if (at < 0) return clean;
  const head = clean.slice(0, at).trim().replace(/[.,;:—]+$/u, '');
  const tail = clean.slice(at).replace(/^\s*[:;—]\s+/u, '').trim();
  if (!head) return tail;
  if (!tail) return head;
  const [firstWord, ...rest] = tail.split(' ');
  const lowered = SUBTITLE_LEAD_WORDS.has(firstWord.toLocaleLowerCase('es-ES'))
    ? [firstWord.toLocaleLowerCase('es-ES'), ...rest].join(' ')
    : tail;
  return `${head}, ${lowered}`;
}

/** Ideas the report has not cited, unfinished section mandates first. */
function pendingIdeas(
  snapshot: WritingWorkshopSnapshot,
  covered: Set<string>,
  assigned: Set<string>
): WritingWorkshopIdeaCandidate[] {
  const rest = snapshot.ideas.filter((idea) => !covered.has(idea.id));
  return [...rest.filter((idea) => assigned.has(idea.id)), ...rest.filter((idea) => !assigned.has(idea.id))];
}

// ─────────────────────────────────────────────────────────────────────────────
// Planning
// ─────────────────────────────────────────────────────────────────────────────

/** Resolved section budget: a soft target the planner aims for and a hard cap it must not exceed. */
export interface SectionPlan {
  target: number;
  hardCap: number;
  mode: 'auto' | 'user';
}

/**
 * Decide how many sections a report should have. The whole design bias is toward
 * FEWER, LONGER sections. `'auto'` derives a small count from the page target; a
 * numeric `sectionLimit` pins the target and allows the model exactly one extra
 * section (the grace) when it genuinely needs it.
 */
export function resolveSectionPlan(
  targetPages: { min: number; max: number },
  sectionLimit: 'auto' | number
): SectionPlan {
  const natural = clamp(
    Math.round((midpoint(targetPages) * WORDS_PER_PAGE) / SECTION_TARGET_WORDS),
    MIN_SECTIONS,
    MAX_PLAN_SECTIONS
  );
  if (typeof sectionLimit === 'number' && Number.isFinite(sectionLimit) && sectionLimit > 0) {
    const target = clamp(Math.round(sectionLimit), MIN_SECTIONS, MAX_SECTIONS);
    return { target, hardCap: Math.min(MAX_SECTIONS, target + SECTION_GRACE), mode: 'user' };
  }
  return { target: natural, hardCap: Math.min(MAX_SECTIONS, natural + SECTION_GRACE), mode: 'auto' };
}

export function buildPlanInput(
  request: DeepResearchRequest,
  language: PromptLanguage,
  snapshot: WritingWorkshopSnapshot,
  sectionPlan: SectionPlan,
  targetPages: { min: number; max: number }
): PlanInput {
  return {
    objective: request.objective,
    language,
    audience: request.audience,
    sectionCount: sectionPlan.target,
    sectionHardCap: sectionPlan.hardCap,
    sectionMode: sectionPlan.mode,
    targetPages,
    ideas: snapshot.ideas.slice(0, POOL_LIMITS.ideas).map((i) => ({
      id: i.id,
      label: i.label,
      type: i.type,
      statement: clip(i.statement, 220),
      works: i.works.map((w) => `${w.authors[0] ?? 'Autor'}${w.year ? ` (${w.year})` : ''}`).join('; '),
    })),
    themes: snapshot.themes.slice(0, POOL_LIMITS.themes).map((t) => ({ id: t.id, label: t.label, summary: clip(t.summary, 160) })),
    gaps: snapshot.gaps.slice(0, POOL_LIMITS.gaps).map((g) => ({ id: g.id, label: g.label, summary: clip(g.summary, 160) })),
    contradictions: snapshot.contradictions
      .slice(0, POOL_LIMITS.contradictions)
      .map((c) => ({ id: c.id, label: c.label, summary: clip(c.summary, 160) })),
    works: snapshot.works.slice(0, POOL_LIMITS.works).map((w) => ({ id: w.id, label: w.label, summary: clip(w.summary, 140) })),
  };
}

async function planWithFallback(
  deps: DeepResearchDeps,
  request: DeepResearchRequest,
  language: PromptLanguage,
  snapshot: WritingWorkshopSnapshot,
  sectionPlan: SectionPlan,
  targetPages: { min: number; max: number }
): Promise<DeepResearchPlan> {
  const input = buildPlanInput(request, language, snapshot, sectionPlan, targetPages);
  let plan: DeepResearchPlan | null = null;
  try {
    // The grace slot is reserved for a genuine coverage expansion. A planner
    // cannot spend it merely by returning one more short heading.
    plan = normalizePlan(await deps.planReport(input), snapshot, sectionPlan.target);
  } catch {
    plan = null;
  }
  if (!plan || plan.sections.length === 0) return fallbackPlan(request, snapshot, sectionPlan.target, labels(language));
  return plan;
}

export function normalizePlan(
  plan: DeepResearchPlan,
  snapshot: WritingWorkshopSnapshot,
  maxSections: number = MAX_SECTIONS
): DeepResearchPlan {
  const ideaIds = new Set(snapshot.ideas.map((i) => i.id));
  const workIds = new Set(snapshot.works.map((w) => w.id));
  const gapIds = new Set(snapshot.gaps.map((g) => g.id));
  const contradictionIds = new Set(snapshot.contradictions.map((c) => c.id));
  const passageIds = new Set(snapshot.passages.map((p) => p.id));

  const sections = (plan.sections ?? []).slice(0, maxSections).map((s, index) => ({
    id: cleanStr(s.id, `s${index + 1}`),
    title: normalizeSectionTitle(cleanStr(s.title, `Sección ${index + 1}`)),
    purpose: cleanStr(s.purpose, ''),
    keyClaims: strList(s.keyClaims).slice(0, 8),
    ideaIds: strList(s.ideaIds).filter((id) => ideaIds.has(id)),
    workIds: strList(s.workIds).filter((id) => workIds.has(id)),
    gapIds: strList(s.gapIds).filter((id) => gapIds.has(id)),
    contradictionIds: strList(s.contradictionIds).filter((id) => contradictionIds.has(id)),
    passageIds: strList(s.passageIds).filter((id) => passageIds.has(id)),
    role: (s.role === 'intro' || s.role === 'synthesis' ? s.role : 'body') as DeepResearchPlanSection['role'],
    dependsOn: strList(s.dependsOn),
  }));

  return {
    title: cleanStr(plan.title, ''),
    abstract: cleanStr(plan.abstract, ''),
    sections: ensureIdeaAssignment(orderSections(sections), snapshot),
  };
}

/**
 * Put the sections in reading order: the framing first, the closing synthesis last,
 * and each body section after whatever it presupposes.
 *
 * Without this the report's sequence was whatever order the planner happened to emit
 * — two runs of the same objective produced a genealogy and a flat thematic list. A
 * stable topological sort makes the good ordering reproducible. Cycles and dangling
 * references are ignored rather than fatal: a half-stated dependency should degrade
 * to the planner's own order, never drop a section.
 */
export function orderSections(sections: DeepResearchPlanSection[]): DeepResearchPlanSection[] {
  if (sections.length <= 1) return sections;
  const rank = (s: DeepResearchPlanSection) => (s.role === 'intro' ? 0 : s.role === 'synthesis' ? 2 : 1);
  const byId = new Map(sections.map((s) => [s.id, s]));
  const position = new Map(sections.map((s, i) => [s.id, i]));
  const emitted = new Set<string>();
  const out: DeepResearchPlanSection[] = [];

  // Stable order: architectural role first, then the planner's own sequence.
  const queue = [...sections].sort((a, b) => rank(a) - rank(b) || position.get(a.id)! - position.get(b.id)!);

  const visit = (section: DeepResearchPlanSection, guard: Set<string>): void => {
    if (emitted.has(section.id) || guard.has(section.id)) return;
    guard.add(section.id);
    for (const dependency of section.dependsOn ?? []) {
      const target = byId.get(dependency);
      // A body section never waits on the closing synthesis, or nothing could open.
      if (target && target.id !== section.id && rank(target) <= rank(section)) visit(target, guard);
    }
    guard.delete(section.id);
    if (!emitted.has(section.id)) {
      emitted.add(section.id);
      out.push(section);
    }
  };

  for (const section of queue) visit(section, new Set());
  return out;
}

/**
 * Give every section a mandate without wrecking its coherence.
 *
 * The planner only ever sees the top slice of the idea pool (POOL_LIMITS.ideas),
 * so the rest arrives here unassigned. Round-robining those by index dropped
 * thematically unrelated ideas into each section and then asked the writer for a
 * continuous argument. Instead each leftover goes to the section it actually fits,
 * and a section only takes as much as it can develop — the surplus is left for the
 * coverage top-up and, failing that, reported as a limitation.
 */
function ensureIdeaAssignment(sections: DeepResearchPlanSection[], snapshot: WritingWorkshopSnapshot): DeepResearchPlanSection[] {
  if (sections.length === 0) return sections;
  const assigned = new Set<string>();
  for (const s of sections) for (const id of s.ideaIds) assigned.add(id);

  // Body sections only: a lone closing section synthesises, it does not absorb.
  const bodyCount = Math.max(1, sections.length - 1);
  const body = sections.slice(0, bodyCount);
  const profiles = body.map((s) => sectionProfile(s, snapshot));

  const byId = new Map(snapshot.ideas.map((i) => [i.id, i]));
  // How many ideas each section already draws from each work, so a section is not
  // handed a pile of material that all traces back to the same book.
  const workLoad = body.map((section) => {
    const load = new Map<string, number>();
    for (const id of section.ideaIds) {
      for (const w of byId.get(id)?.works ?? []) load.set(w.nodus_id, (load.get(w.nodus_id) ?? 0) + 1);
    }
    return load;
  });

  for (const idea of snapshot.ideas) {
    if (assigned.has(idea.id)) continue;
    const text = ideaText(idea);
    let bestAt = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < body.length; i++) {
      if (body[i].ideaIds.length >= MAX_SECTION_IDEAS) continue;
      // Affinity first, minus a penalty for piling more of the same work onto a
      // section; the emptier section breaks remaining ties so nothing starves.
      const repeats = Math.max(0, ...(idea.works ?? []).map((w) => workLoad[i].get(w.nodus_id) ?? 0));
      const score = relevanceScore(profiles[i], text) - repeats * 0.03 - body[i].ideaIds.length * 1e-4;
      if (score > bestScore) {
        bestScore = score;
        bestAt = i;
      }
    }
    // Every body section is full: the remaining ideas stay pending on purpose.
    if (bestAt < 0) break;
    body[bestAt].ideaIds.push(idea.id);
    for (const w of idea.works ?? []) workLoad[bestAt].set(w.nodus_id, (workLoad[bestAt].get(w.nodus_id) ?? 0) + 1);
    assigned.add(idea.id);
  }

  // Any section that is still empty borrows the top ideas so it has a mandate.
  for (const s of sections) {
    if (s.ideaIds.length === 0 && snapshot.ideas.length > 0) {
      s.ideaIds = snapshot.ideas.slice(0, 3).map((i) => i.id);
    }
  }
  return sections;
}

/** The words that characterise what a section is about, planner text plus its seed ideas. */
function sectionProfile(section: DeepResearchPlanSection, snapshot: WritingWorkshopSnapshot): Set<string> {
  const byId = new Map(snapshot.ideas.map((i) => [i.id, i]));
  const parts = [section.title, section.purpose, ...section.keyClaims];
  for (const id of section.ideaIds) {
    const idea = byId.get(id);
    if (idea) parts.push(ideaText(idea));
  }
  return tokenSet(parts.join(' '));
}

function ideaText(idea: WritingWorkshopIdeaCandidate): string {
  return [idea.label, idea.statement, (idea.themes ?? []).join(' ')].join(' ');
}

/** Share of the candidate's meaningful words that the section already talks about. */
function relevanceScore(profile: Set<string>, text: string): number {
  const tokens = tokenSet(text);
  if (tokens.size === 0 || profile.size === 0) return 0;
  let hits = 0;
  for (const token of tokens) if (profile.has(token)) hits += 1;
  return hits / tokens.size;
}

/** Accent-insensitive content words. Deliberately dependency-free so the core stays pure. */
function tokenSet(text: string): Set<string> {
  const normalized = (text ?? '')
    .toLocaleLowerCase('es-ES')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, "");
  const out = new Set<string>();
  for (const word of normalized.split(/[^\p{L}\p{N}]+/u)) {
    if (word.length > 3 && !STOPWORDS.has(word)) out.add(word);
  }
  return out;
}

/** Frequent function words in the languages Deep Research writes in. */
const STOPWORDS = new Set(
  ('para como este esta estos estas desde entre sobre cuando donde porque pero mas menos muy todo toda todos todas '
    + 'otro otra otros otras cada tanto tanta cual cuales quien quienes ante bajo cabe contra hacia hasta segun sino '
    + 'that this these those with from into about which their there where when while have has been were was will '
    + 'their them they than then such also would could should some more most other than dans pour avec sont leur '
    + 'sich eine einer eines nicht auch aber oder para como mais quando onde porque').split(/\s+/)
);

export function fallbackPlan(
  request: DeepResearchRequest,
  snapshot: WritingWorkshopSnapshot,
  sectionCount: number,
  L: Labels = labels(request.language ?? 'es')
): DeepResearchPlan {
  const ideas = snapshot.ideas;
  const bodyCount = Math.max(1, sectionCount - 2);
  const perSection = Math.max(1, Math.ceil(ideas.length / bodyCount));
  const sections: DeepResearchPlanSection[] = [];
  sections.push({
    id: 's1',
    title: L.introTitle,
    purpose: L.introPurpose,
    keyClaims: ideas.slice(0, 3).map((i) => i.label),
    ideaIds: ideas.slice(0, Math.min(3, ideas.length)).map((i) => i.id),
    workIds: [],
    gapIds: [],
    contradictionIds: [],
    passageIds: [],
  });
  for (let b = 0; b < bodyCount; b++) {
    const chunk = ideas.slice(b * perSection, (b + 1) * perSection);
    if (chunk.length === 0) continue;
    sections.push({
      id: `s${sections.length + 1}`,
      title: `${L.threadTitle} ${b + 1}`,
      purpose: L.threadPurpose,
      keyClaims: chunk.slice(0, 4).map((i) => i.label),
      ideaIds: chunk.map((i) => i.id),
      workIds: [],
      gapIds: snapshot.gaps.slice(b * 2, b * 2 + 2).map((g) => g.id),
      contradictionIds: snapshot.contradictions.slice(b, b + 1).map((c) => c.id),
      passageIds: [],
    });
  }
  sections.push({
    id: `s${sections.length + 1}`,
    title: L.synthesisTitle,
    purpose: L.synthesisPurpose,
    keyClaims: snapshot.gaps.slice(0, 3).map((g) => g.label),
    ideaIds: [],
    workIds: [],
    gapIds: snapshot.gaps.slice(0, 4).map((g) => g.id),
    contradictionIds: snapshot.contradictions.slice(0, 3).map((c) => c.id),
    passageIds: [],
  });
  return {
    title: `${L.reportTitlePrefix} ${request.objective}`.slice(0, 140),
    abstract: '',
    sections: ensureIdeaAssignment(sections, snapshot),
  };
}

async function finalizeWithFallback(deps: DeepResearchDeps, input: FinalizeInput, L: Labels): Promise<FinalizeResult> {
  const uncoveredNote = () =>
    input.uncoveredSamples.length > 0 ? [L.uncoveredLimitation(input.uncoveredSamples)] : [];
  try {
    const result = await deps.finalize(input);
    const limitations = strList(result.limitations);
    // The model is told how much was left out, but it is not the guarantor of that
    // disclosure. If it omits it, the report states it anyway.
    const mentionsCoverage = limitations.some((line) =>
      input.uncoveredSamples.some((sample) => line.toLowerCase().includes(sample.toLowerCase().slice(0, 24)))
    );
    return {
      title: cleanStr(result.title, input.planTitle || input.objective),
      abstract: cleanStr(result.abstract, ''),
      limitations: mentionsCoverage ? limitations : [...limitations, ...uncoveredNote()],
      nextSteps: strList(result.nextSteps),
    };
  } catch {
    return {
      title: input.planTitle || input.objective,
      abstract: '',
      limitations: uncoveredNote(),
      nextSteps: [L.reviewStep],
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Coverage / degraded fallbacks
// ─────────────────────────────────────────────────────────────────────────────

function coverageSection(index: number, uncovered: WritingWorkshopIdeaCandidate[], L: Labels): DeepResearchPlanSection {
  return {
    id: `cov-${index}`,
    title: `${L.coverageTitle} ${index}`,
    purpose: L.coveragePurpose,
    keyClaims: uncovered.slice(0, 4).map((i) => i.label),
    ideaIds: uncovered.map((i) => i.id),
    workIds: [],
    gapIds: [],
    contradictionIds: [],
    passageIds: [],
  };
}

function mergePlanSections(a: DeepResearchPlanSection, b: DeepResearchPlanSection): DeepResearchPlanSection {
  const unique = (values: string[]) => [...new Set(values)];
  return {
    ...a,
    purpose: [a.purpose, b.purpose].filter(Boolean).join(' '),
    keyClaims: unique([...a.keyClaims, ...b.keyClaims]).slice(0, 8),
    ideaIds: unique([...a.ideaIds, ...b.ideaIds]),
    workIds: unique([...a.workIds, ...b.workIds]),
    gapIds: unique([...a.gapIds, ...b.gapIds]),
    contradictionIds: unique([...a.contradictionIds, ...b.contradictionIds]),
    passageIds: unique([...a.passageIds, ...b.passageIds]),
  };
}

/** Enforce one visible epigraph per generated section. Models occasionally add
 * several `###` headings despite the prompt, producing artificial fragmentation.
 * Their labels become ordinary prose leads while citations and paragraphs remain. */
export function normalizeNarrativeSection(markdown: string, title: string): string {
  const trimmed = (markdown ?? '').trim();
  const withoutFirstHeading = trimmed.replace(/^#{1,6}\s+[^\n]+\n*/u, '');
  const body = withoutFirstHeading
    .replace(/\n{1,2}#{1,6}\s+([^\n]+)\n*/gu, (_match, label: string) => `\n\n${sentenceLead(label)} `)
    .replace(/^\s*#{1,6}\s+([^\n]+)\n*/gmu, (_match, label: string) => `${sentenceLead(label)} `)
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gmu, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return `## ${title}\n\n${body}`.trim();
}

function stripInitialHeading(markdown: string): string {
  return markdown.replace(/^#{1,6}\s+[^\n]+\n*/u, '').trim();
}

function sentenceLead(label: string): string {
  const clean = label.trim().replace(/[.:;—-]+$/u, '');
  return clean ? `${clean}.` : '';
}

/** Deterministic, source-anchored prose used when the model fails twice on a section. */
function degradedSection(section: DeepResearchPlanSection, maps: SnapshotMaps, L: Labels): string {
  const lines = [`## ${section.title}`, ''];
  if (section.purpose) lines.push(section.purpose, '');
  const bullets = section.ideaIds
    .map((id) => maps.ideaById.get(id))
    .filter((idea): idea is WritingWorkshopIdeaCandidate => !!idea)
    .slice(0, 8)
    .map((idea) => {
      const token = ideaCitation(idea);
      return `- ${clip(idea.statement || idea.label, 260)} ${token}`;
    });
  if (bullets.length > 0) lines.push(...bullets);
  else lines.push(`_${L.degradedEmpty}_`);
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot maps + citation policy (pure)
// ─────────────────────────────────────────────────────────────────────────────

export function buildSnapshotMaps(snapshot: WritingWorkshopSnapshot): SnapshotMaps {
  const ideaById = new Map<string, WritingWorkshopIdeaCandidate>();
  const workInfoById = new Map<string, WorkInfo>();
  const passageWorkId = new Map<string, string>();
  const passagePage = new Map<string, string | null>();
  const passageText = new Map<string, string>();
  const gapById = new Map<string, { label: string; summary: string; source: string }>();
  const contradictionById = new Map<string, { label: string; summary: string; sources: string[] }>();

  for (const idea of snapshot.ideas) {
    ideaById.set(idea.id, idea);
    for (const w of idea.works) {
      if (!workInfoById.has(w.nodus_id)) {
        workInfoById.set(w.nodus_id, { nodus_id: w.nodus_id, title: w.title, authors: w.authors, year: w.year, zotero_key: w.zotero_key, doi: w.doi ?? null });
      }
    }
  }
  for (const w of snapshot.works) {
    if (!workInfoById.has(w.id)) {
      workInfoById.set(w.id, { nodus_id: w.id, title: w.title, authors: w.authors, year: w.year, zotero_key: w.zotero_key, doi: w.doi ?? null });
    }
  }
  for (const g of snapshot.gaps) {
    if (g.work?.nodus_id && !workInfoById.has(g.work.nodus_id)) {
      workInfoById.set(g.work.nodus_id, {
        nodus_id: g.work.nodus_id,
        title: g.work.title,
        authors: g.work.authors,
        year: g.work.year,
        zotero_key: g.work.zotero_key,
      });
    }
  }
  for (const g of snapshot.gaps)
    gapById.set(g.id, { label: g.label, summary: g.summary ?? '', source: sourceLabelFromWork(g.work) });
  for (const c of snapshot.contradictions)
    contradictionById.set(c.id, { label: c.label, summary: c.summary ?? '', sources: c.sources ?? [] });
  for (const p of snapshot.passages) {
    passageWorkId.set(p.id, p.nodus_id);
    passagePage.set(p.id, p.pageLabel);
    // `summary` is the clipped literal text of the passage as stored by the retriever.
    if (p.summary?.trim()) passageText.set(p.id, p.summary.trim());
    if (!workInfoById.has(p.nodus_id)) {
      workInfoById.set(p.nodus_id, {
        nodus_id: p.nodus_id,
        title: p.label.split(' · ')[0] ?? p.label,
        authors: p.authors,
        year: p.year,
        zotero_key: p.zotero_key,
      });
    }
  }

  const validIds = new Set<string>();
  for (const id of ideaById.keys()) validIds.add(`idea:${id}`);
  for (const id of workInfoById.keys()) validIds.add(`work:${id}`);
  for (const id of gapById.keys()) validIds.add(`gap:${id}`);
  for (const id of contradictionById.keys()) validIds.add(`contradiction:${id}`);
  for (const id of passageWorkId.keys()) validIds.add(`passage:${id}`);

  return { ideaById, workInfoById, passageWorkId, passagePage, passageText, gapById, contradictionById, validIds };
}

/**
 * Fold material retrieved *during* writing into the maps so it becomes citable.
 * Without this a per-section retrieval would hand the writer tokens that the
 * citation policy then strips as hallucinated.
 */
export function mergeRetrievedMaterial(
  maps: SnapshotMaps,
  material: { ideas?: WritingWorkshopIdeaCandidate[]; passages?: WritingWorkshopSnapshot['passages'] }
): { ideaIds: string[]; passageIds: string[] } {
  const ideaIds: string[] = [];
  const passageIds: string[] = [];
  for (const idea of material.ideas ?? []) {
    if (!idea?.id) continue;
    if (!maps.ideaById.has(idea.id)) {
      maps.ideaById.set(idea.id, idea);
      maps.validIds.add(`idea:${idea.id}`);
    }
    for (const w of idea.works ?? []) {
      if (!maps.workInfoById.has(w.nodus_id)) {
        maps.workInfoById.set(w.nodus_id, {
          nodus_id: w.nodus_id,
          title: w.title,
          authors: w.authors,
          year: w.year,
          zotero_key: w.zotero_key,
          doi: w.doi ?? null,
        });
        maps.validIds.add(`work:${w.nodus_id}`);
      }
    }
    ideaIds.push(idea.id);
  }
  for (const p of material.passages ?? []) {
    if (!p?.id || !p.summary?.trim()) continue;
    if (!maps.passageWorkId.has(p.id)) {
      maps.passageWorkId.set(p.id, p.nodus_id);
      maps.passagePage.set(p.id, p.pageLabel);
      maps.passageText.set(p.id, p.summary.trim());
      maps.validIds.add(`passage:${p.id}`);
      if (!maps.workInfoById.has(p.nodus_id)) {
        maps.workInfoById.set(p.nodus_id, {
          nodus_id: p.nodus_id,
          title: p.label.split(' · ')[0] ?? p.label,
          authors: p.authors,
          year: p.year,
          zotero_key: p.zotero_key,
        });
        maps.validIds.add(`work:${p.nodus_id}`);
      }
    }
    passageIds.push(p.id);
  }
  return { ideaIds, passageIds };
}

const CITATION_RE = /\[([^\]]*)\]\(nodus:\/\/(idea|work|passage|gap|contradiction)\/([^)]+)\)/g;
const NODUS_KIND = '(?:idea|work|passage|gap|contradiction)';
/** `[label (nodus://…)]` — brackets and parentheses swapped round. */
const WRAPPED_RE = new RegExp(`\\[([^\\]]*?)\\s*\\((nodus://${NODUS_KIND}/[^)\\s]+)\\)\\s*\\]`, 'g');
/** `[label](nodus://…]` — right link, wrong closing bracket. */
const WRONG_CLOSER_RE = new RegExp(`\\]\\((nodus://${NODUS_KIND}/[^)\\]\\s]+)\\]`, 'g');
/** `[nodus://…, nodus://…]` — a bare bracketed list instead of links. */
const BARE_GROUP_RE = new RegExp(`\\[\\s*(nodus://${NODUS_KIND}/[^\\s,\\]]+(?:\\s*,\\s*nodus://${NODUS_KIND}/[^\\s,\\]]+)*)\\s*\\]`, 'g');
/** `Autor (2005)](nodus://…)` — the closing half of a link whose `[` never arrived. */
/** The closing half of a link, used by {@link repairMissingOpeners}. */
const CLOSING_HALF_RE = new RegExp(`\\]\\(nodus://${NODUS_KIND}/[^)\\s]+\\)`, 'g');
/** How far back a synthesised citation label may reach. */
const MAX_SYNTHESISED_LABEL = 90;

/**
 * Repair `Autor (2005)](nodus://…)` — a link whose opening bracket never arrived,
 * which happens when a model chains two citations inside one parenthesis.
 *
 * This cannot be a regex: commas and semicolons occur *inside* the labels of
 * perfectly good links, so any prefix pattern loose enough to catch the broken case
 * also mangles the correct one. Instead each closing half is checked for whether an
 * unmatched `[` really precedes it on the same line.
 */
function repairMissingOpeners(markdown: string): string {
  let out = '';
  let cursor = 0;
  for (const match of markdown.matchAll(CLOSING_HALF_RE)) {
    const closeAt = match.index ?? 0;
    const lineStart = markdown.lastIndexOf('\n', closeAt) + 1;
    const segment = markdown.slice(lineStart, closeAt);
    // An opener exists when the last `[` on the line comes after the last `]`.
    if (segment.lastIndexOf('[') > segment.lastIndexOf(']')) continue;
    // Where the label begins. A `(` only counts when it is still OPEN at this point
    // — the parenthesis of a year like "Romero, L. (2005)" closes before the link
    // and belongs inside the label, not before it. A comma is never a boundary for
    // the same reason: "Romero, L." carries one.
    const floor = Math.max(lineStart, closeAt - MAX_SYNTHESISED_LABEL);
    let start = -1;
    let depth = 0;
    for (let at = closeAt - 1; at >= floor; at--) {
      const char = markdown[at];
      if (char === ')') depth += 1;
      else if (char === '(') {
        if (depth === 0) {
          start = at + 1;
          break;
        }
        depth -= 1;
      } else if (char === ';') {
        start = at + 1;
        break;
      }
    }
    // No delimiter means no way to tell where the label starts. Guessing would pull
    // real prose into a label that the citation policy then overwrites, deleting the
    // author's sentence. Leave it: the final sweep drops the bare url and the words
    // the model wrote stay on the page.
    if (start < 0) continue;
    while (start < closeAt && /\s/.test(markdown[start])) start += 1;
    if (start >= closeAt) continue;
    out += markdown.slice(cursor, start) + '[';
    cursor = start;
  }
  return out + markdown.slice(cursor);
}

/**
 * Delete a closing half whose opener could not be reconstructed. The words the model
 * wrote stay on the page; only the dangling `](nodus://…)` goes, so the reader never
 * sees a raw identifier and the accounting never counts a citation nobody can click.
 */
function dropOrphanCitations(markdown: string): string {
  let out = '';
  let cursor = 0;
  for (const match of markdown.matchAll(CLOSING_HALF_RE)) {
    const closeAt = match.index ?? 0;
    const lineStart = markdown.lastIndexOf('\n', closeAt) + 1;
    const segment = markdown.slice(lineStart, closeAt);
    if (segment.lastIndexOf('[') > segment.lastIndexOf(']')) continue;
    out += markdown.slice(cursor, closeAt);
    cursor = closeAt + match[0].length;
  }
  return out + markdown.slice(cursor);
}
/**
 * A reference with no link syntax around it. The only thing that makes a reference
 * well-formed is the `](` immediately before it — a bare `(` does not, which is how
 * `[label (nodus://…)]` slipped through unrepaired and put raw ids on the page.
 */
const BARE_REF_RE = new RegExp(`(?<!\\]\\()(nodus://${NODUS_KIND}/[^\\s\\]),;]+)`, 'g');
/** Belt and braces: any reference still not sitting inside a proper link at the end. */
const SURVIVING_RAW_RE = new RegExp(`(?<!\\]\\()nodus://\\S*`, 'g');
/** Any markdown link whose target is a nodus reference, valid or not. */
const ANY_NODUS_LINK_RE = /\[([^\]\n]*)\]\((nodus:\/\/[^)\s]*)\)/g;
/** The only shape the app can actually resolve. */
const VALID_TARGET_RE = new RegExp(`^nodus://${NODUS_KIND}/.+$`);

/**
 * Models occasionally emit a nodus reference that is not a well-formed Markdown link.
 * Left alone those leak raw ids into the prose AND slip past the citation accounting,
 * because the policy below only recognises proper links. Normalising them first means
 * every reference is either canonicalised or dropped — none survives half-written.
 * The empty label is deliberate: the policy fills in the canonical one, or, for an
 * id that does not exist, collapses the whole thing to nothing.
 */
export function repairLooseCitations(markdown: string): string {
  return repairMissingOpeners((markdown ?? '').replace(WRAPPED_RE, '[$1]($2)').replace(WRONG_CLOSER_RE, ']($1)'))
    .replace(BARE_GROUP_RE, (_full, group: string) =>
      group
        .split(',')
        .map((ref) => `[](${ref.trim()})`)
        .join(', ')
    )
    .replace(BARE_REF_RE, (_full, ref: string) => `[](${ref})`);
}

/**
 * Enforce the citation contract on one section's markdown:
 * - valid nodus targets get their label rewritten to the canonical corpus label;
 * - unknown (hallucinated) targets are stripped to plain text so they can never
 *   become a fake reference.
 * Returns the cleaned markdown and the set of ids actually cited.
 */
export function applyCitationPolicy(
  markdown: string,
  maps: SnapshotMaps
): {
  markdown: string;
  cited: { ideas: Set<string>; works: Set<string>; gaps: Set<string>; contradictions: Set<string>; passages: Set<string> };
} {
  const cited = {
    ideas: new Set<string>(),
    works: new Set<string>(),
    gaps: new Set<string>(),
    contradictions: new Set<string>(),
    passages: new Set<string>(),
  };
  const out = repairLooseCitations(markdown).replace(CITATION_RE, (_full, label: string, type: string, rawId: string) => {
    let id = rawId;
    try {
      id = decodeURIComponent(rawId);
    } catch {
      /* keep raw */
    }
    if (!maps.validIds.has(`${type}:${id}`)) {
      // Hallucinated target: drop the link, keep only neutral bracket-free text.
      return label || '';
    }
    switch (type) {
      case 'idea': {
        cited.ideas.add(id);
        const idea = maps.ideaById.get(id);
        const canonical = idea ? sourceLabelFromWork(idea.works[0]) : label;
        return `[${canonical || label}](nodus://idea/${encodeURIComponent(id)})`;
      }
      case 'work': {
        cited.works.add(id);
        const canonical = sourceLabelFromWork(maps.workInfoById.get(id)) || label;
        return `[${canonical}](nodus://work/${encodeURIComponent(id)})`;
      }
      case 'passage': {
        cited.passages.add(id);
        const workId = maps.passageWorkId.get(id);
        const base = sourceLabelFromWork(workId ? maps.workInfoById.get(workId) : undefined) || label;
        const page = maps.passagePage.get(id);
        const withPage = page ? `${base}, ${page}` : base;
        return `[${withPage}](nodus://passage/${encodeURIComponent(id)})`;
      }
      // Gap and contradiction labels are whole sentences in a real corpus, so they
      // make a terrible anchor: the reader gets a paragraph-long parenthesis. The
      // content belongs in the writer's menu (where it now is) and behind the link,
      // not in the visible citation.
      case 'gap':
        cited.gaps.add(id);
        return `[${maps.gapById.get(id)?.source || 'hueco'}](nodus://gap/${encodeURIComponent(id)})`;
      case 'contradiction':
        cited.contradictions.add(id);
        return `[${maps.contradictionById.get(id)?.sources[0] || 'contradicción'}](nodus://contradiction/${encodeURIComponent(id)})`;
      default:
        return label || '';
    }
  });
  // Whatever shape a model invents next, a raw `nodus://` must never reach the page.
  // Repairs above try to keep the citation; anything still loose here is dropped.
  const swept = dropOrphanCitations(out)
    // A link whose target Nodus cannot resolve is a link to nowhere. Models invent
    // these — `nodus://contradicción/…` with the Spanish word as the type, or a bare
    // `nodus://<uuid>` with no type at all — and because they never matched the
    // citation pattern they slipped past validation and printed as dead links.
    // The visible author-year survives as plain text; only the link dies.
    .replace(ANY_NODUS_LINK_RE, (full, label: string, target: string) =>
      VALID_TARGET_RE.test(target) ? full : label || ''
    )
    .replace(SURVIVING_RAW_RE, '')
    .replace(/\(\s*[;,]?\s*\)/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([.,;)])/g, '$1');
  return { markdown: swept, cited };
}

// ─────────────────────────────────────────────────────────────────────────────
// Citation verification (pure)
// ─────────────────────────────────────────────────────────────────────────────

/** Sentence boundaries, kept simple: citations sit inside ordinary prose. */
const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=[¿¡"«(A-ZÁÉÍÓÚÑ])/u;

/**
 * Pair every citation in a section with the sentence it supports and with what the
 * cited source actually says. Bare `work` citations are skipped: a work token only
 * asserts that the work is relevant, which is not an entailment claim.
 */
export function extractCitationClaims(markdown: string, maps: SnapshotMaps): CitationClaim[] {
  const claims: CitationClaim[] = [];
  const body = stripInitialHeading(markdown);
  const bodyStart = Math.max(0, markdown.indexOf(body));
  // Mask every citation to a same-length run of a neutral character before looking
  // for sentence boundaries. An author initial inside a label ("Autor, N. (2000)")
  // otherwise reads as the end of a sentence and cuts the citation in half, which
  // silently left the whole report unverified.
  const masked = body.replace(CITATION_RE, (link) => '\u0001'.repeat(link.length));
  for (const span of sentenceSpans(masked)) {
    const text = body.slice(span.start, span.end);
    const plain = stripMarkdown(text);
    for (const match of text.matchAll(CITATION_RE)) {
      const type = match[2] as CitationClaim['kind'] | 'work';
      if (type === 'work') continue;
      let id = match[3];
      try {
        id = decodeURIComponent(id);
      } catch {
        /* keep raw */
      }
      const content = citedContent(type, id, maps);
      // Nothing to check against means nothing to verify; leave it alone rather
      // than let a contentless judgement delete a citation.
      if (!content) continue;
      claims.push({
        offset: bodyStart + span.start + (match.index ?? 0),
        link: match[0],
        kind: type,
        id,
        sentence: plain,
        content,
      });
    }
  }
  return claims;
}

/** Sentence and paragraph spans over text whose citations have been masked. */
function sentenceSpans(text: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  const separator = new RegExp(`${SENTENCE_SPLIT.source}|\\n{2,}`, 'gu');
  let start = 0;
  for (const match of text.matchAll(separator)) {
    const at = match.index ?? 0;
    if (at > start) spans.push({ start, end: at });
    start = at + match[0].length;
  }
  if (start < text.length) spans.push({ start, end: text.length });
  return spans;
}

function citedContent(type: string, id: string, maps: SnapshotMaps): string {
  switch (type) {
    case 'idea':
      return maps.ideaById.get(id)?.statement?.trim() || maps.ideaById.get(id)?.label?.trim() || '';
    case 'passage':
      return maps.passageText.get(id)?.trim() || '';
    case 'gap': {
      const gap = maps.gapById.get(id);
      return [gap?.label, gap?.summary].filter(Boolean).join('. ').trim();
    }
    case 'contradiction': {
      const c = maps.contradictionById.get(id);
      return [c?.label, c?.summary].filter(Boolean).join('. ').trim();
    }
    default:
      return '';
  }
}


/**
 * Keep only the conflicts whose two quotes really appear in the sections they are
 * attributed to. A model asked to find contradictions will invent them; requiring it
 * to quote both sides verbatim turns the claim into something checkable, and this
 * throws away anything that fails the check.
 */
export function groundCoherenceIssues(
  issues: CoherenceIssue[],
  sections: { title: string; text: string }[]
): CoherenceIssue[] {
  const byTitle = new Map(sections.map((s) => [s.title.trim().toLowerCase(), normalizeForMatch(s.text)]));
  const appearsIn = (title: string, quote: string) => {
    const needle = normalizeForMatch(quote);
    if (needle.length < 24) return false;
    const haystack = byTitle.get((title ?? '').trim().toLowerCase());
    // Fall back to the whole report: a model often mislabels which section a
    // sentence came from while quoting it correctly.
    if (haystack?.includes(needle)) return true;
    return [...byTitle.values()].some((text) => text.includes(needle));
  };
  return (issues ?? []).filter(
    (issue) =>
      issue &&
      typeof issue.quoteA === 'string' &&
      typeof issue.quoteB === 'string' &&
      issue.quoteA.trim() !== issue.quoteB.trim() &&
      appearsIn(issue.sectionA, issue.quoteA) &&
      appearsIn(issue.sectionB, issue.quoteB)
  );
}

function normalizeForMatch(text: string): string {
  return stripMarkdown(text ?? '')
    .toLocaleLowerCase('es-ES')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface VerificationOutcome {
  markdown: string;
  checked: number;
  partial: number;
  unsupported: number;
  /** Sentences that lost their only support, for honest reporting. */
  strippedSentences: string[];
  /** The claims worth a second look, paired with the source to check them against. */
  audit: { verdict: 'partial' | 'removed'; claim: CitationClaim }[];
}

/**
 * Apply the verdicts. A citation the source does not support is a false attribution,
 * so it is removed outright — leaving the sentence standing but unsupported is bad,
 * leaving a wrong attribution in an academic report is worse. What was removed is
 * counted and surfaced instead of being swallowed.
 */
export function applyVerification(markdown: string, claims: CitationClaim[], verdicts: CitationVerdict[]): VerificationOutcome {
  const doomed = claims
    .map((claim, index) => ({ claim, verdict: verdicts[index] }))
    .filter((entry) => entry.verdict === 'unsupported');
  const partial = verdicts.filter((v) => v === 'partial').length;

  // Remove from the end so earlier offsets stay valid.
  let out = markdown;
  const strippedSentences: string[] = [];
  for (const { claim } of [...doomed].sort((a, b) => b.claim.offset - a.claim.offset)) {
    if (out.slice(claim.offset, claim.offset + claim.link.length) !== claim.link) continue;
    out = out.slice(0, claim.offset) + out.slice(claim.offset + claim.link.length);
    strippedSentences.push(claim.sentence);
  }
  out = out
    .replace(/\(\s*[;,]?\s*\)/g, '')
    .replace(/\s+([.,;)])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ');
  const audit = claims
    .map((claim, index) => ({ verdict: verdicts[index], claim }))
    .filter((entry) => entry.verdict === 'partial' || entry.verdict === 'unsupported')
    .map((entry) => ({ verdict: entry.verdict === 'partial' ? ('partial' as const) : ('removed' as const), claim: entry.claim }));
  return { markdown: out, checked: claims.length, partial, unsupported: doomed.length, strippedSentences, audit };
}

// ─────────────────────────────────────────────────────────────────────────────
// References / matrix / assembly
// ─────────────────────────────────────────────────────────────────────────────

/** Every work referenced by the report: cited directly, or backing a cited idea. */
export function collectCitedWorkIds(citedIds: { ideas: Set<string>; works: Set<string> }, maps: SnapshotMaps): Set<string> {
  const workIds = new Set<string>(citedIds.works);
  for (const ideaId of citedIds.ideas) {
    const idea = maps.ideaById.get(ideaId);
    for (const w of idea?.works ?? []) workIds.add(w.nodus_id);
  }
  return workIds;
}

export function buildReferences(workIds: Set<string>, maps: SnapshotMaps, language: PromptLanguage = 'es'): string[] {
  const L = labels(language);
  const entries = [...workIds]
    .map((id) => maps.workInfoById.get(id))
    .filter((w): w is WorkInfo => !!w)
    .map((work) => referenceEntry(work, L));
  return dedupe(entries).sort((a, b) => a.localeCompare(b, language === 'pt-BR' ? 'pt' : language));
}

function referenceEntry(work: WorkInfo, L: Labels): string {
  const authors = work.authors.length ? work.authors.join('; ') : L.unknownAuthor;
  const year = work.year ? ` (${work.year})` : ` (${L.noDate})`;
  const title = work.title ? `. ${work.title.replace(/\.\s*$/, '')}.` : '.';
  const doi = work.doi?.trim() ? ` https://doi.org/${work.doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')}` : '';
  return `${authors}${year}${title}${doi}`;
}

function buildMatrix(coveredIdeaIds: Set<string>, maps: SnapshotMaps, L: Labels): WritingWorkshopMatrixRow[] {
  const rows: WritingWorkshopMatrixRow[] = [];
  for (const id of coveredIdeaIds) {
    if (rows.length >= MAX_MATRIX_ROWS) break;
    const idea = maps.ideaById.get(id);
    if (!idea) continue;
    rows.push({
      claim: clip(idea.statement || idea.label, 240),
      role: matrixRole(idea.type),
      sourceLabel: sourceLabelFromWork(idea.works[0]) || L.corpusSource,
      citation: `nodus://idea/${encodeURIComponent(id)}`,
      evidence: idea.evidenceCount > 0 ? L.anchoredEvidence(idea.evidenceCount) : L.derivedIdea,
      notes: idea.workCount > 1 ? L.supportedBy(idea.workCount) : L.singleSupport,
    });
  }
  return rows;
}

function matrixRole(type: string): WritingWorkshopMatrixRow['role'] {
  switch (type) {
    case 'method':
      return 'method';
    case 'definition':
      return 'definition';
    case 'context':
      return 'context';
    default:
      return 'support';
  }
}

export function assembleMarkdown(
  written: { section: DeepResearchPlanSection; markdown: string }[],
  references: string[],
  finalize: FinalizeResult,
  language: PromptLanguage
): string {
  const L = labels(language);
  const parts: string[] = [];
  if (finalize.abstract) {
    parts.push(`## ${L.abstract}`, '', finalize.abstract, '');
  }
  for (const w of written) {
    parts.push(w.markdown.trim(), '');
  }
  if (finalize.limitations.length > 0) {
    parts.push(`## ${L.limitations}`, '', ...finalize.limitations.map((x) => `- ${x}`), '');
  }
  parts.push(`## ${L.references}`, '');
  if (references.length > 0) parts.push(...references.map((r) => `- ${r}`));
  else parts.push(`- ${L.noReferences}`);
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function sectionSources(section: DeepResearchPlanSection, maps: SnapshotMaps): string[] {
  return section.ideaIds
    .map((id) => maps.ideaById.get(id))
    .filter((idea): idea is WritingWorkshopIdeaCandidate => !!idea)
    .slice(0, 8)
    .map((idea) => ideaCitation(idea));
}

// ─────────────────────────────────────────────────────────────────────────────
// Citation menu / helpers
// ─────────────────────────────────────────────────────────────────────────────

export function buildCitationMenu(section: DeepResearchPlanSection, maps: SnapshotMaps): CitationMenuItem[] {
  const items: CitationMenuItem[] = [];
  // Passages are offered last, on purpose. Leading with them was measured and made
  // the report worse: verbatim quoting more than tripled, the argument leaned on a
  // third fewer distinct works because each passage belongs to a single one, and
  // unsupported citations doubled as claims overreached a narrow snippet.
  for (const id of section.ideaIds) {
    const idea = maps.ideaById.get(id);
    if (!idea) continue;
    items.push({
      token: ideaCitation(idea),
      kind: 'idea',
      note: clip(idea.statement || idea.label, IDEA_NOTE_CHARS),
      source: ideaSupportLabel(idea),
    });
  }
  for (const id of section.workIds) {
    const work = maps.workInfoById.get(id);
    if (!work) continue;
    items.push({
      token: `[${sourceLabelFromWork(work)}](nodus://work/${encodeURIComponent(id)})`,
      kind: 'work',
      note: clip(work.title, 200),
      source: sourceLabelFromWork(work),
    });
  }
  for (const id of section.gapIds) {
    const gap = maps.gapById.get(id);
    if (!gap) continue;
    items.push({
      token: `[${gap.source || 'hueco'}](nodus://gap/${encodeURIComponent(id)})`,
      kind: 'gap',
      note: clip(gap.summary || gap.label, IDEA_NOTE_CHARS),
    });
  }
  for (const id of section.contradictionIds) {
    const contradiction = maps.contradictionById.get(id);
    if (!contradiction) continue;
    const sides = contradiction.label ? `Posturas enfrentadas: ${contradiction.label}. ` : '';
    const who = contradiction.sources.length ? ` Lo sostienen ${contradiction.sources.join('; ')}.` : '';
    items.push({
      token: `[${contradiction.sources[0] || 'contradicción'}](nodus://contradiction/${encodeURIComponent(id)})`,
      kind: 'contradiction',
      note: `${sides}${clip(contradiction.summary, IDEA_NOTE_CHARS)}${who}`.trim(),
      source: contradiction.sources.join('; ') || undefined,
    });
  }
  for (const id of section.passageIds) {
    const workId = maps.passageWorkId.get(id);
    const text = maps.passageText.get(id);
    // A passage with no readable text is NOT offered: citing it would be a page
    // number attached to words the writer never saw.
    if (!workId || !text) continue;
    const page = maps.passagePage.get(id);
    const label = `${sourceLabelFromWork(maps.workInfoById.get(workId))}${page ? `, ${page}` : ''}`;
    items.push({
      token: `[${label}](nodus://passage/${encodeURIComponent(id)})`,
      kind: 'passage',
      note: `«${clip(text, PASSAGE_NOTE_CHARS)}»`,
      source: label,
    });
  }
  return items;
}

/** Author-year behind a flagged claim, so the reader knows which source to open. */
function sourceLabelForClaim(claim: CitationClaim, maps: SnapshotMaps): string {
  switch (claim.kind) {
    case 'idea':
      return sourceLabelFromWork(maps.ideaById.get(claim.id)?.works[0]) || '';
    case 'passage': {
      const workId = maps.passageWorkId.get(claim.id);
      const page = maps.passagePage.get(claim.id);
      const base = sourceLabelFromWork(workId ? maps.workInfoById.get(workId) : undefined);
      return page ? `${base}, ${page}` : base;
    }
    case 'gap':
      return maps.gapById.get(claim.id)?.source || '';
    case 'contradiction':
      return maps.contradictionById.get(claim.id)?.sources[0] || '';
    default:
      return '';
  }
}

/** Which works back an idea, so the writer can name them in prose. */
function ideaSupportLabel(idea: WritingWorkshopIdeaCandidate): string {
  return idea.works
    .slice(0, 3)
    .map((w) => sourceLabelFromWork(w))
    .filter(Boolean)
    .join('; ');
}

function ideaCitation(idea: WritingWorkshopIdeaCandidate): string {
  const label = sourceLabelFromWork(idea.works[0]) || idea.label;
  return `[${label}](nodus://idea/${encodeURIComponent(idea.id)})`;
}

/**
 * One citable pool, ready to hand to an *external* writer (an MCP client's model)
 * so it can articulate and draft the report itself. Every `token` is a verbatim
 * `nodus://` citation the writer must copy unchanged; anything not in this catalog
 * is stripped by {@link applyCitationPolicy} at assembly time. Themes carry no
 * citable token (they are structural context only). Mirrors the trimming the
 * in-app planner uses so the two writers see the same material.
 */
export interface CitationCatalog {
  ideas: { token: string; note: string; type: string; works: string }[];
  works: { token: string; note: string }[];
  gaps: { token: string; note: string }[];
  contradictions: { token: string; note: string }[];
  /** Literal text from the sources, with the page it sits on. The strongest evidence
   * the corpus can offer, and the only kind the writer can quote. */
  passages: { token: string; note: string; source: string }[];
  themes: { id: string; label: string; summary: string }[];
}

export function buildCitationCatalog(snapshot: WritingWorkshopSnapshot): CitationCatalog {
  return {
    ideas: snapshot.ideas.slice(0, POOL_LIMITS.ideas).map((i) => ({
      token: ideaCitation(i),
      note: clip(i.statement || i.label, 200),
      type: i.type,
      works: i.works.map((w) => `${w.authors[0] ?? 'Autor'}${w.year ? ` (${w.year})` : ''}`).join('; '),
    })),
    works: snapshot.works.slice(0, POOL_LIMITS.works).map((w) => ({
      token: `[${sourceLabelFromWork(w) || w.label}](nodus://work/${encodeURIComponent(w.id)})`,
      note: clip(w.title || w.label, 160),
    })),
    gaps: snapshot.gaps.slice(0, POOL_LIMITS.gaps).map((g) => ({
      token: `[${sourceLabelFromWork(g.work) || 'hueco'}](nodus://gap/${encodeURIComponent(g.id)})`,
      note: clip(g.summary || g.label, 160),
    })),
    contradictions: snapshot.contradictions.slice(0, POOL_LIMITS.contradictions).map((c) => ({
      token: `[${c.sources?.[0] || 'contradicción'}](nodus://contradiction/${encodeURIComponent(c.id)})`,
      note: `Posturas enfrentadas: ${c.label}. ${clip(c.summary, 200)}${c.sources?.length ? ` Lo sostienen ${c.sources.join('; ')}.` : ''}`.trim(),
    })),
    // Only passages whose text is actually present; a page number the writer cannot
    // read is an invitation to invent what the source says.
    passages: snapshot.passages
      .filter((p) => p.summary?.trim())
      .slice(0, POOL_LIMITS.passages)
      .map((p) => {
        const label = `${authorYearLabel(p.authors[0], p.year)}${p.pageLabel ? `, ${p.pageLabel}` : ''}`;
        return {
          token: `[${label}](nodus://passage/${encodeURIComponent(p.id)})`,
          note: `«${clip(p.summary, PASSAGE_NOTE_CHARS)}»`,
          source: label,
        };
      }),
    themes: snapshot.themes.slice(0, POOL_LIMITS.themes).map((t) => ({ id: t.id, label: t.label, summary: clip(t.summary, 160) })),
  };
}

function sourceLabelFromWork(work: { authors: string[]; year: number | null; title?: string } | undefined): string {
  if (!work) return '';
  return authorYearLabel(work.authors[0], work.year, work.title);
}

/** Turn Nodus's stored `Apellido, I.` name into a readable inline citation. */
function authorYearLabel(author: string | undefined, year: number | null | undefined, title?: string): string {
  const raw = author?.replace(/\s+/g, ' ').trim();
  if (!raw) {
    // "Autor" reads as a placeholder in the middle of academic prose. A shortened
    // title is a real citation for a source whose author the corpus never captured.
    const short = clip((title ?? '').replace(/\s+/g, ' ').trim(), 42);
    if (short) return year ? `${short} (${year})` : short;
    return year ? `Obra sin autor (${year})` : 'Obra sin autor';
  }
  const comma = raw.indexOf(',');
  const surname = (comma >= 0 ? raw.slice(0, comma) : raw.split(' ').slice(-1).join(' ')).trim() || raw;
  const given = (comma >= 0 ? raw.slice(comma + 1) : raw.split(' ').slice(0, -1).join(' ')).trim();
  const initial = given.match(/[\p{L}]/u)?.[0]?.toLocaleUpperCase('es-ES');
  const name = initial ? `${surname}, ${initial}.` : surname;
  return year ? `${name} (${year})` : name;
}

/**
 * A running synopsis of the report so far. The opening sentence of a section says
 * almost nothing about where its argument ended up, so each entry carries where the
 * section *closed* — that is what the next one has to pick up from without repeating.
 */
function summarizePrior(written: { section: DeepResearchPlanSection; markdown: string }[]): string {
  if (written.length === 0) return '';
  return written
    .map((w, i) => {
      const prose = stripMarkdown(stripInitialHeading(w.markdown));
      const opening = clip(firstSentence(prose), 200);
      const closing = clip(closingSentences(prose, 2), 320);
      return `${i + 1}. ${w.section.title}\n   ${opening}\n   … ${closing}`;
    })
    .join('\n');
}

/** The last `count` sentences of a passage of prose. */
function closingSentences(text: string, count: number): string {
  const sentences = (text ?? '').match(/[^.!?]+[.!?]+/g);
  if (!sentences || sentences.length === 0) return text ?? '';
  return sentences.slice(-count).join(' ').trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Target sizing
// ─────────────────────────────────────────────────────────────────────────────

export function resolveTargetPages(
  target: DeepResearchTargetLength,
  snapshot: Pick<WritingWorkshopSnapshot, 'ideas'>
): { min: number; max: number } {
  switch (target) {
    case 'concise':
      return { min: 5, max: 8 };
    case 'standard':
      return { min: 9, max: 14 };
    case 'exhaustive':
      return { min: 15, max: 20 };
    case 'adaptive':
    default: {
      const ideas = snapshot.ideas.length;
      const estimate = clamp(Math.round(ideas / 6), MIN_TARGET_PAGES, 18);
      const min = clamp(estimate, MIN_TARGET_PAGES, MAX_TARGET_PAGES - 2);
      const max = clamp(min + 4, min + 2, MAX_TARGET_PAGES);
      return { min, max };
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Small pure utilities
// ─────────────────────────────────────────────────────────────────────────────

function midpoint(range: { min: number; max: number }): number {
  return (range.min + range.max) / 2;
}
function pagesFromWords(words: number): number {
  return Math.max(1, Math.round(words / WORDS_PER_PAGE));
}
export function countWords(text: string): number {
  return stripMarkdown(text).split(/\s+/).filter(Boolean).length;
}
function stripMarkdown(text: string): string {
  return (text ?? '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*_`>|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function firstSentence(text: string): string {
  const match = text.match(/^.*?[.!?](\s|$)/);
  return (match ? match[0] : text).trim();
}
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
function clip(text: string, max: number): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trim()}…` : clean;
}
function cleanStr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
function strList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim())
    : [];
}
function dedupe(items: string[]): string[] {
  return [...new Set(items.map((i) => i.trim()).filter(Boolean))];
}

export interface Labels {
  abstract: string;
  limitations: string;
  references: string;
  noReferences: string;
  gathering: string;
  planning: (sections: number, pages: { min: number; max: number }) => string;
  writing: string;
  coverage: (pending: number) => string;
  assembling: string;
  done: (sections: number, pages: number) => string;
  stoppedSections: (cap: number) => string;
  stoppedPages: (pages: number) => string;
  degraded: string;
  degradedEmpty: string;
  coverageTitle: string;
  coveragePurpose: string;
  introTitle: string;
  introPurpose: string;
  threadTitle: string;
  threadPurpose: string;
  synthesisTitle: string;
  synthesisPurpose: string;
  reportTitlePrefix: string;
  uncoveredLimitation: (samples: string[]) => string;
  coherenceLimitation: (issue: CoherenceIssue) => string;
  reviewStep: string;
  corpusSource: string;
  anchoredEvidence: (count: number) => string;
  derivedIdea: string;
  supportedBy: (count: number) => string;
  singleSupport: string;
  unknownAuthor: string;
  noDate: string;
}

const ES: Labels = {
  abstract: 'Resumen',
  limitations: 'Limitaciones',
  references: 'Referencias',
  noReferences: 'Sin fuentes citadas.',
  gathering: 'Reuniendo materiales del corpus…',
  planning: (s, p) => `Planificando ~${s} secciones de fondo (${p.min}–${p.max} páginas)…`,
  writing: 'Redactando',
  coverage: (n) => `Ampliando cobertura (${n} ideas pendientes)…`,
  assembling: 'Ensamblando informe y referencias…',
  done: (s, p) => `Informe listo: ${s} secciones · ~${p} páginas`,
  stoppedSections: (c) => `Se alcanzó el máximo de ${c} secciones.`,
  stoppedPages: (p) => `Se alcanzó el presupuesto máximo de ~${p} páginas.`,
  degraded: 'Una o más secciones no pudieron generarse con el modelo y se resolvieron de forma degradada.',
  degradedEmpty: 'No se pudo desarrollar esta sección con el modelo; revisar los materiales asignados.',
  coverageTitle: 'Desarrollo complementario',
  coveragePurpose: 'Desarrollar ideas del corpus todavía no tratadas en profundidad.',
  introTitle: 'Introducción y planteamiento',
  introPurpose: 'Delimitar el problema y anticipar las líneas del argumento.',
  threadTitle: 'Línea argumental',
  threadPurpose: 'Desarrollar y relacionar un grupo de ideas del corpus.',
  synthesisTitle: 'Síntesis, huecos y contribución',
  synthesisPurpose: 'Integrar las líneas, señalar huecos y perfilar la contribución.',
  reportTitlePrefix: 'Informe:',
  uncoveredLimitation: (s) => `Quedaron ideas del corpus sin desarrollar en profundidad (p. ej.: ${s.join('; ')}).`,
  coherenceLimitation: (i) =>
    i.sectionA.trim() === i.sectionB.trim()
      ? `Tensión interna dentro de «${i.sectionA}». ${i.issue}`
      : `Tensión interna entre «${i.sectionA}» y «${i.sectionB}». ${i.issue}`,
  reviewStep: 'Revisar cada cita y contrastar el informe con las fuentes originales.',
  corpusSource: 'Fuente del corpus',
  anchoredEvidence: (n) => `${n} evidencia(s) ancladas en el corpus.`,
  derivedIdea: 'Idea derivada del corpus.',
  supportedBy: (n) => `Sostenida por ${n} obras.`,
  singleSupport: 'Una obra de respaldo.',
  unknownAuthor: 'Autor desconocido',
  noDate: 's.f.',
};

const EN: Labels = {
  abstract: 'Abstract',
  limitations: 'Limitations',
  references: 'References',
  noReferences: 'No sources cited.',
  gathering: 'Gathering corpus material…',
  planning: (s, p) => `Planning ~${s} substantial sections (${p.min}–${p.max} pages)…`,
  writing: 'Writing',
  coverage: (n) => `Widening coverage (${n} ideas still untouched)…`,
  assembling: 'Assembling report and references…',
  done: (s, p) => `Report ready: ${s} sections · ~${p} pages`,
  stoppedSections: (c) => `Reached the ceiling of ${c} sections.`,
  stoppedPages: (p) => `Reached the maximum budget of ~${p} pages.`,
  degraded: 'One or more sections could not be generated by the model and were resolved in a degraded form.',
  degradedEmpty: 'The model could not develop this section; review the assigned material.',
  coverageTitle: 'Further development',
  coveragePurpose: 'Develop corpus ideas not yet treated in depth.',
  introTitle: 'Introduction and framing',
  introPurpose: 'Delimit the problem and anticipate the lines of argument.',
  threadTitle: 'Line of argument',
  threadPurpose: 'Develop and relate a group of ideas from the corpus.',
  synthesisTitle: 'Synthesis, gaps and contribution',
  synthesisPurpose: 'Integrate the lines, name the gaps and outline the contribution.',
  reportTitlePrefix: 'Report:',
  uncoveredLimitation: (s) => `Some corpus ideas were left undeveloped (for example: ${s.join('; ')}).`,
  coherenceLimitation: (i) =>
    i.sectionA.trim() === i.sectionB.trim()
      ? `Internal tension within "${i.sectionA}". ${i.issue}`
      : `Internal tension between "${i.sectionA}" and "${i.sectionB}". ${i.issue}`,
  reviewStep: 'Check every citation against the original sources.',
  corpusSource: 'Corpus source',
  anchoredEvidence: (n) => `${n} piece(s) of evidence anchored in the corpus.`,
  derivedIdea: 'Idea derived from the corpus.',
  supportedBy: (n) => `Supported by ${n} works.`,
  singleSupport: 'One supporting work.',
  unknownAuthor: 'Unknown author',
  noDate: 'n.d.',
};

/** Headings the report itself carries, per language. Progress copy and fallback
 * prose fall back to English rather than leaking Spanish into a foreign report. */
const HEADINGS: Partial<Record<PromptLanguage, Pick<Labels, 'abstract' | 'limitations' | 'references' | 'noReferences'>>> = {
  fr: { abstract: 'Résumé', limitations: 'Limites', references: 'Références', noReferences: 'Aucune source citée.' },
  tr: { abstract: 'Özet', limitations: 'Sınırlılıklar', references: 'Kaynakça', noReferences: 'Kaynak belirtilmedi.' },
  de: {
    abstract: 'Zusammenfassung',
    limitations: 'Einschränkungen',
    references: 'Literaturverzeichnis',
    noReferences: 'Keine Quellen angegeben.',
  },
  pt: { abstract: 'Resumo', limitations: 'Limitações', references: 'Bibliografia', noReferences: 'Nenhuma fonte citada.' },
  'pt-BR': { abstract: 'Resumo', limitations: 'Limitações', references: 'Referências', noReferences: 'Nenhuma fonte citada.' },
};

export function labels(language: PromptLanguage): Labels {
  if (language === 'es') return ES;
  if (language === 'en') return EN;
  const headings = HEADINGS[language];
  return headings ? { ...EN, ...headings } : ES;
}
