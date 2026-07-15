import type {
  DeepResearchMeta,
  DeepResearchProgress,
  DeepResearchReport,
  DeepResearchRequest,
  DeepResearchTargetLength,
  WritingWorkshopBrief,
  WritingWorkshopDraft,
  WritingWorkshopIdeaCandidate,
  WritingWorkshopMatrixRow,
  WritingWorkshopSection,
  WritingWorkshopSnapshot,
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
 * A section aims for roughly this many words. Deliberately high so a report is a few
 * long, well-developed sections rather than many thin ones — depth over fragmentation.
 */
const SECTION_TARGET_WORDS = 1400;
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
}

export interface DeepResearchPlan {
  title: string;
  abstract: string;
  sections: DeepResearchPlanSection[];
}

export interface PlanInput {
  objective: string;
  language: 'es' | 'en' | 'fr' | 'tr';
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

/** One citable token the model must copy verbatim, plus the claim it supports. */
export interface CitationMenuItem {
  token: string;
  note: string;
}

export interface SectionInput {
  objective: string;
  language: 'es' | 'en' | 'fr' | 'tr';
  audience?: string;
  section: DeepResearchPlanSection;
  targetWords: number;
  isConclusion: boolean;
  citationMenu: CitationMenuItem[];
  priorSummary: string;
}

export interface FinalizeInput {
  objective: string;
  language: 'es' | 'en' | 'fr' | 'tr';
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
}

interface WorkInfo {
  nodus_id: string;
  title: string;
  authors: string[];
  year: number | null;
  zotero_key: string;
}

export interface SnapshotMaps {
  ideaById: Map<string, WritingWorkshopIdeaCandidate>;
  workInfoById: Map<string, WorkInfo>;
  passageWorkId: Map<string, string>;
  passagePage: Map<string, string | null>;
  gapIds: Set<string>;
  contradictionIds: Set<string>;
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
  const emit = (p: DeepResearchProgress) => {
    try {
      onProgress?.(p);
    } catch {
      /* progress is best-effort; never let a UI callback abort the report */
    }
  };

  emit({ phase: 'snapshot', message: 'Reuniendo materiales del corpus…' });
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

  emit({ phase: 'planning', message: `Planificando ~${sectionCount} secciones de fondo (${targetPages.min}–${targetPages.max} páginas)…` });
  const plan = await planWithFallback(deps, request, language, snapshot, sectionPlan, targetPages);

  // Budget is measured over the BODY sections only. The abstract, limitations and
  // the final bibliography are assembled separately and never consume this budget,
  // so references at the end never eat into the page/word target.
  const maxWords = targetPages.max * WORDS_PER_PAGE;
  const minWords = targetPages.min * WORDS_PER_PAGE;

  const written: { section: DeepResearchPlanSection; markdown: string }[] = [];
  const coveredIdeaIds = new Set<string>();
  const citedIds = {
    ideas: new Set<string>(),
    works: new Set<string>(),
    gaps: new Set<string>(),
    contradictions: new Set<string>(),
    passages: new Set<string>(),
  };
  let totalWords = 0;
  let stoppedReason: string | null = null;

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
      message: `Redactando: ${section.title}`,
      sectionIndex: written.length + 1,
      sectionTitle: section.title,
      wordsSoFar: totalWords,
      pagesSoFar: pagesFromWords(totalWords),
    });

    let raw = '';
    try {
      raw = await deps.writeSection(sectionInput(request, language, section, targetWords, isConclusion, maps, written));
    } catch {
      // One retry, then a graceful degraded section — never fail the whole report.
      try {
        raw = await deps.writeSection(sectionInput(request, language, section, targetWords, isConclusion, maps, written));
      } catch {
        raw = degradedSection(section, maps);
        if (!stoppedReason)
          stoppedReason = 'Una o más secciones no pudieron generarse con el modelo y se resolvieron de forma degradada.';
      }
    }

    const { markdown, cited } = applyCitationPolicy(normalizeNarrativeSection(raw, section.title), maps);
    if (mergeIntoIndex != null && written[mergeIntoIndex]) {
      const existing = written[mergeIntoIndex];
      existing.markdown = `${existing.markdown.trim()}\n\n${stripInitialHeading(markdown)}`.trim();
      existing.section = mergePlanSections(existing.section, section);
    } else {
      written.push({ section, markdown });
    }
    for (const id of cited.ideas) {
      citedIds.ideas.add(id);
      coveredIdeaIds.add(id);
    }
    // Assigned ideas that resolve to real corpus ideas count as covered even if the
    // model leaned on a neighbour: they were the section's mandate.
    for (const id of section.ideaIds) if (maps.ideaById.has(id)) coveredIdeaIds.add(id);
    cited.works.forEach((id) => citedIds.works.add(id));
    cited.gaps.forEach((id) => citedIds.gaps.add(id));
    cited.contradictions.forEach((id) => citedIds.contradictions.add(id));
    cited.passages.forEach((id) => {
      citedIds.passages.add(id);
      const workId = maps.passageWorkId.get(id);
      if (workId) citedIds.works.add(workId);
    });
    totalWords += countWords(markdown);
  };

  // Planned sections.
  for (let i = 0; i < plan.sections.length; i++) {
    if (written.length >= sectionHardCap) {
      stoppedReason = `Se alcanzó el máximo de ${sectionHardCap} secciones.`;
      break;
    }
    if (totalWords >= maxWords) {
      stoppedReason = `Se alcanzó el presupuesto máximo de ~${targetPages.max} páginas.`;
      break;
    }
    const isConclusion = i === plan.sections.length - 1;
    await runSection(plan.sections[i], isConclusion);
  }

  // Coverage top-up: keep deepening while the report is under its minimum length
  // and relevant ideas remain uncovered — but never past the hard caps.
  let topups = 0;
  while (totalWords < minWords && written.length < sectionHardCap && topups < MAX_TOPUP_SECTIONS && !stoppedReason) {
    const uncovered = snapshot.ideas.filter((idea) => !coveredIdeaIds.has(idea.id)).slice(0, 6);
    if (uncovered.length === 0) break;
    topups += 1;
    emit({
      phase: 'coverage',
      message: `Ampliando cobertura (${uncovered.length} ideas pendientes)…`,
      wordsSoFar: totalWords,
      pagesSoFar: pagesFromWords(totalWords),
    });
    // Expand the last body section instead of creating a new "development
    // complement" epigraph. Coverage grows the argument, not the outline.
    const mergeIntoIndex = Math.max(0, written.length - (written.length > 1 ? 2 : 1));
    await runSection(coverageSection(topups, uncovered), false, mergeIntoIndex);
  }

  emit({
    phase: 'assembling',
    message: 'Ensamblando informe y referencias…',
    wordsSoFar: totalWords,
    pagesSoFar: pagesFromWords(totalWords),
  });

  const uncoveredSamples = snapshot.ideas
    .filter((idea) => !coveredIdeaIds.has(idea.id))
    .slice(0, 5)
    .map((idea) => idea.label);

  const finalize = await finalizeWithFallback(deps, {
    objective: request.objective,
    language,
    planTitle: plan.title,
    sectionTitles: written.map((w) => w.section.title),
    ideasCovered: coveredIdeaIds.size,
    ideasConsidered: snapshot.ideas.length,
    uncoveredSamples,
  });

  // Works actually referenced = works cited directly + the works behind every cited idea.
  const citedWorkIds = collectCitedWorkIds(citedIds, maps);
  const references = buildReferences(citedWorkIds, maps);
  const draftMarkdown = assembleMarkdown(written, references, finalize, language);
  const worksCited = citedWorkIds.size;

  const outline: WritingWorkshopSection[] = written.map((w, index) => ({
    id: w.section.id || `s${index + 1}`,
    title: w.section.title,
    purpose: w.section.purpose,
    keyClaims: w.section.keyClaims.slice(0, 8),
    sources: sectionSources(w.section, maps),
  }));

  const matrix = buildMatrix(coveredIdeaIds, maps);

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
    limitations: finalize.limitations,
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
  };

  emit({
    phase: 'done',
    message: `Informe listo: ${written.length} secciones · ~${meta.pages} páginas`,
    wordsSoFar: totalWords,
    pagesSoFar: meta.pages,
  });

  return { draft, meta };
}

function sectionInput(
  request: DeepResearchRequest,
  language: 'es' | 'en' | 'fr' | 'tr',
  section: DeepResearchPlanSection,
  targetWords: number,
  isConclusion: boolean,
  maps: SnapshotMaps,
  written: { section: DeepResearchPlanSection; markdown: string }[]
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
  };
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
  language: 'es' | 'en' | 'fr' | 'tr',
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
  language: 'es' | 'en' | 'fr' | 'tr',
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
  if (!plan || plan.sections.length === 0) return fallbackPlan(request, snapshot, sectionPlan.target);
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
    title: cleanStr(s.title, `Sección ${index + 1}`),
    purpose: cleanStr(s.purpose, ''),
    keyClaims: strList(s.keyClaims).slice(0, 8),
    ideaIds: strList(s.ideaIds).filter((id) => ideaIds.has(id)),
    workIds: strList(s.workIds).filter((id) => workIds.has(id)),
    gapIds: strList(s.gapIds).filter((id) => gapIds.has(id)),
    contradictionIds: strList(s.contradictionIds).filter((id) => contradictionIds.has(id)),
    passageIds: strList(s.passageIds).filter((id) => passageIds.has(id)),
  }));

  return {
    title: cleanStr(plan.title, ''),
    abstract: cleanStr(plan.abstract, ''),
    sections: ensureIdeaAssignment(sections, snapshot),
  };
}

/** Guarantee every section has some material; spread otherwise-unassigned ideas so nothing is dropped. */
function ensureIdeaAssignment(sections: DeepResearchPlanSection[], snapshot: WritingWorkshopSnapshot): DeepResearchPlanSection[] {
  if (sections.length === 0) return sections;
  const assigned = new Set<string>();
  for (const s of sections) for (const id of s.ideaIds) assigned.add(id);
  const leftover = snapshot.ideas.filter((i) => !assigned.has(i.id)).map((i) => i.id);
  let cursor = 0;
  // Round-robin the leftovers into the body sections (skip a lone final conclusion).
  const bodyCount = Math.max(1, sections.length - 1);
  for (const id of leftover) {
    sections[cursor % bodyCount].ideaIds.push(id);
    cursor += 1;
  }
  // Any section that is still empty borrows the top ideas so it has a mandate.
  for (const s of sections) {
    if (s.ideaIds.length === 0 && snapshot.ideas.length > 0) {
      s.ideaIds = snapshot.ideas.slice(0, 3).map((i) => i.id);
    }
  }
  return sections;
}

export function fallbackPlan(request: DeepResearchRequest, snapshot: WritingWorkshopSnapshot, sectionCount: number): DeepResearchPlan {
  const ideas = snapshot.ideas;
  const bodyCount = Math.max(1, sectionCount - 2);
  const perSection = Math.max(1, Math.ceil(ideas.length / bodyCount));
  const sections: DeepResearchPlanSection[] = [];
  sections.push({
    id: 's1',
    title: 'Introducción y planteamiento',
    purpose: 'Delimitar el problema y anticipar las líneas del argumento.',
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
      title: `Línea argumental ${b + 1}`,
      purpose: 'Desarrollar y relacionar un grupo de ideas del corpus.',
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
    title: 'Síntesis, huecos y contribución',
    purpose: 'Integrar las líneas, señalar huecos y perfilar la contribución.',
    keyClaims: snapshot.gaps.slice(0, 3).map((g) => g.label),
    ideaIds: [],
    workIds: [],
    gapIds: snapshot.gaps.slice(0, 4).map((g) => g.id),
    contradictionIds: snapshot.contradictions.slice(0, 3).map((c) => c.id),
    passageIds: [],
  });
  return {
    title: `Informe: ${request.objective}`.slice(0, 140),
    abstract: '',
    sections: ensureIdeaAssignment(sections, snapshot),
  };
}

async function finalizeWithFallback(deps: DeepResearchDeps, input: FinalizeInput): Promise<FinalizeResult> {
  try {
    const result = await deps.finalize(input);
    return {
      title: cleanStr(result.title, input.planTitle || input.objective),
      abstract: cleanStr(result.abstract, ''),
      limitations: strList(result.limitations),
      nextSteps: strList(result.nextSteps),
    };
  } catch {
    return {
      title: input.planTitle || input.objective,
      abstract: '',
      limitations:
        input.uncoveredSamples.length > 0
          ? [`Quedaron ideas del corpus sin desarrollar en profundidad (p. ej.: ${input.uncoveredSamples.join('; ')}).`]
          : [],
      nextSteps: ['Revisar cada cita y contrastar el informe con las fuentes originales.'],
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Coverage / degraded fallbacks
// ─────────────────────────────────────────────────────────────────────────────

function coverageSection(index: number, uncovered: WritingWorkshopIdeaCandidate[]): DeepResearchPlanSection {
  return {
    id: `cov-${index}`,
    title: `Desarrollo complementario ${index}`,
    purpose: 'Desarrollar ideas del corpus todavía no tratadas en profundidad.',
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
function degradedSection(section: DeepResearchPlanSection, maps: SnapshotMaps): string {
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
  else lines.push('_No se pudo desarrollar esta sección con el modelo; revisar los materiales asignados._');
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

  for (const idea of snapshot.ideas) {
    ideaById.set(idea.id, idea);
    for (const w of idea.works) {
      if (!workInfoById.has(w.nodus_id)) {
        workInfoById.set(w.nodus_id, { nodus_id: w.nodus_id, title: w.title, authors: w.authors, year: w.year, zotero_key: w.zotero_key });
      }
    }
  }
  for (const w of snapshot.works) {
    if (!workInfoById.has(w.id)) {
      workInfoById.set(w.id, { nodus_id: w.id, title: w.title, authors: w.authors, year: w.year, zotero_key: w.zotero_key });
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
  for (const p of snapshot.passages) {
    passageWorkId.set(p.id, p.nodus_id);
    passagePage.set(p.id, p.pageLabel);
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
  const gapIds = new Set(snapshot.gaps.map((g) => g.id));
  const contradictionIds = new Set(snapshot.contradictions.map((c) => c.id));
  for (const id of gapIds) validIds.add(`gap:${id}`);
  for (const id of contradictionIds) validIds.add(`contradiction:${id}`);
  for (const id of passageWorkId.keys()) validIds.add(`passage:${id}`);

  return { ideaById, workInfoById, passageWorkId, passagePage, gapIds, contradictionIds, validIds };
}

const CITATION_RE = /\[([^\]]*)\]\(nodus:\/\/(idea|work|passage|gap|contradiction)\/([^)]+)\)/g;

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
  const out = markdown.replace(CITATION_RE, (_full, label: string, type: string, rawId: string) => {
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
      case 'gap':
        cited.gaps.add(id);
        return `[${label || 'hueco'}](nodus://gap/${encodeURIComponent(id)})`;
      case 'contradiction':
        cited.contradictions.add(id);
        return `[${label || 'contradicción'}](nodus://contradiction/${encodeURIComponent(id)})`;
      default:
        return label || '';
    }
  });
  return { markdown: out, cited };
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

export function buildReferences(workIds: Set<string>, maps: SnapshotMaps): string[] {
  const entries = [...workIds]
    .map((id) => maps.workInfoById.get(id))
    .filter((w): w is WorkInfo => !!w)
    .map(referenceEntry);
  return dedupe(entries).sort((a, b) => a.localeCompare(b, 'es'));
}

function referenceEntry(work: WorkInfo): string {
  const authors = work.authors.length ? work.authors.join('; ') : 'Autor desconocido';
  const year = work.year ? ` (${work.year})` : ' (s.f.)';
  const title = work.title ? `. ${work.title.replace(/\.\s*$/, '')}.` : '.';
  return `${authors}${year}${title}`;
}

function buildMatrix(coveredIdeaIds: Set<string>, maps: SnapshotMaps): WritingWorkshopMatrixRow[] {
  const rows: WritingWorkshopMatrixRow[] = [];
  for (const id of coveredIdeaIds) {
    if (rows.length >= MAX_MATRIX_ROWS) break;
    const idea = maps.ideaById.get(id);
    if (!idea) continue;
    rows.push({
      claim: clip(idea.statement || idea.label, 240),
      role: matrixRole(idea.type),
      sourceLabel: sourceLabelFromWork(idea.works[0]) || 'Fuente del corpus',
      citation: `nodus://idea/${encodeURIComponent(id)}`,
      evidence: idea.evidenceCount > 0 ? `${idea.evidenceCount} evidencia(s) ancladas en el corpus.` : 'Idea derivada del corpus.',
      notes: idea.workCount > 1 ? `Sostenida por ${idea.workCount} obras.` : 'Una obra de respaldo.',
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
  language: 'es' | 'en' | 'fr' | 'tr'
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

function buildCitationMenu(section: DeepResearchPlanSection, maps: SnapshotMaps): CitationMenuItem[] {
  const items: CitationMenuItem[] = [];
  for (const id of section.ideaIds) {
    const idea = maps.ideaById.get(id);
    if (idea) items.push({ token: ideaCitation(idea), note: clip(idea.statement || idea.label, 180) });
  }
  for (const id of section.workIds) {
    const work = maps.workInfoById.get(id);
    if (work) items.push({ token: `[${sourceLabelFromWork(work)}](nodus://work/${encodeURIComponent(id)})`, note: clip(work.title, 160) });
  }
  for (const id of section.gapIds) {
    if (maps.gapIds.has(id)) items.push({ token: `[hueco](nodus://gap/${encodeURIComponent(id)})`, note: 'Hueco de investigación anclado.' });
  }
  for (const id of section.contradictionIds) {
    if (maps.contradictionIds.has(id))
      items.push({ token: `[contradicción](nodus://contradiction/${encodeURIComponent(id)})`, note: 'Contradicción entre autores.' });
  }
  for (const id of section.passageIds) {
    const workId = maps.passageWorkId.get(id);
    if (workId) {
      const page = maps.passagePage.get(id);
      const label = `${sourceLabelFromWork(maps.workInfoById.get(workId))}${page ? `, ${page}` : ''}`;
      items.push({ token: `[${label}](nodus://passage/${encodeURIComponent(id)})`, note: 'Pasaje literal del texto completo.' });
    }
  }
  return items;
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
      token: `[hueco](nodus://gap/${encodeURIComponent(g.id)})`,
      note: clip(g.summary || g.label, 160),
    })),
    contradictions: snapshot.contradictions.slice(0, POOL_LIMITS.contradictions).map((c) => ({
      token: `[contradicción](nodus://contradiction/${encodeURIComponent(c.id)})`,
      note: clip(c.summary || c.label, 160),
    })),
    themes: snapshot.themes.slice(0, POOL_LIMITS.themes).map((t) => ({ id: t.id, label: t.label, summary: clip(t.summary, 160) })),
  };
}

function sourceLabelFromWork(work: { authors: string[]; year: number | null } | undefined): string {
  if (!work) return '';
  return authorYearLabel(work.authors[0], work.year);
}

/** Turn Nodus's stored `Apellido, I.` name into a readable inline citation. */
function authorYearLabel(author: string | undefined, year: number | null | undefined): string {
  const raw = author?.replace(/\s+/g, ' ').trim();
  if (!raw) return year ? `Autor (${year})` : 'Autor';
  const comma = raw.indexOf(',');
  const surname = (comma >= 0 ? raw.slice(0, comma) : raw.split(' ').slice(-1).join(' ')).trim() || raw;
  const given = (comma >= 0 ? raw.slice(comma + 1) : raw.split(' ').slice(0, -1).join(' ')).trim();
  const initial = given.match(/[\p{L}]/u)?.[0]?.toLocaleUpperCase('es-ES');
  const name = initial ? `${surname}, ${initial}.` : surname;
  return year ? `${name} (${year})` : name;
}

function summarizePrior(written: { section: DeepResearchPlanSection; markdown: string }[]): string {
  if (written.length === 0) return '';
  return written
    .map((w, i) => `${i + 1}. ${w.section.title}: ${clip(firstSentence(stripMarkdown(w.markdown)), 160)}`)
    .join('\n');
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

function labels(language: 'es' | 'en' | 'fr' | 'tr') {
  if (language === 'en') {
    return { abstract: 'Abstract', limitations: 'Limitations', references: 'References', noReferences: 'No sources cited.' };
  }
  if (language === 'fr') {
    return { abstract: 'Résumé', limitations: 'Limites', references: 'Références', noReferences: 'Aucune source citée.' };
  }
  if (language === 'tr') {
    return { abstract: 'Özet', limitations: 'Sınırlılıklar', references: 'Kaynakça', noReferences: 'Kaynak belirtilmedi.' };
  }
  return { abstract: 'Resumen', limitations: 'Limitaciones', references: 'Referencias', noReferences: 'Sin fuentes citadas.' };
}
