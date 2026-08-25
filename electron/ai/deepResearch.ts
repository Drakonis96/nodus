import type { DeepResearchProgress, DeepResearchReport, DeepResearchRequest, ModelRef } from '@shared/types';
import type { DeepResearchApproach } from '@shared/deepResearchApproaches';
import { normalizeDeepResearchApproach } from '@shared/deepResearchApproaches';
import {
  deepResearchEnginePath as characterizeDeepResearchEngine,
  parseDeepResearchRequestVersion,
  type DeepResearchVersion,
} from '@shared/deepResearchVersions';
import { completeJson, completeText } from './aiClient';
import { assertChatGptSubscriptionConnected } from './codexSubscription';
import { getSettings } from '../db/settingsRepo';
import { getActiveVault } from '../vaults/vaultRegistry';
import { generateGenealogyDeepResearchReport } from './genealogyDeepResearch';
import { generateStudyDeepResearchReport } from './studyDeepResearch';
import {
  buildHistoricalWritingWorkshopSnapshot,
  buildIdeaFirstWritingWorkshopSnapshot,
  retrieveSectionMaterial,
  retrieveSectionMaterialLegacy,
} from './writingWorkshop';
import { prepareRelevantDocumentProfiles } from './documentPreparation';
import {
  academicRelationshipContext,
  approachRules,
  mergeApproachSnapshots,
  planApproachRetrieval,
  type ApproachRetrievalPlan,
} from './deepResearchApproaches';
import {
  orchestrateDeepResearch,
  type DeepResearchDeps,
  type DeepResearchPlan,
  type DeepResearchPlanSection,
  type CitationClaim,
  type CitationVerdict,
  type CoherenceIssue,
  DEEP_RESEARCH_NARRATIVE_RULES,
  type FinalizeInput,
  type FinalizeResult,
  type PlanInput,
  type PlanCoverageAuditInput,
  buildPlanInput,
  normalizePlan,
  fallbackPlan,
  resolveSectionPlan,
  assignMissingCoverageQuestions,
  reconcileCoverageAudit,
  plannedCandidateWorkIds,
  buildSnapshotMaps,
  mergeRetrievedMaterial,
  buildCitationMenu,
  citationMenuExclusionText,
  matchesObjectiveExclusion,
  normalizeSectionClaimAudit,
  enforcePlanObjectiveExclusions,
  MAX_COVERAGE_QUESTIONS,
  MAX_SECTION_IDEAS,
  SECTION_RETRIEVAL_LIMITS,
  type ReportEditorialReview,
  type SectionInput,
  type SectionClaimAudit,
  type DeepResearchProofRole,
  type AtomicPassageRetrieval,
  type SectionEvidencePlan,
  type SectionRevisionInput,
} from './deepResearchCore';

/** A post-plan query may prepare a small high-value nucleus; the opt-in background
 * campaign owns exhaustive vault indexing. */
const ON_DEMAND_DOCUMENT_PROFILE_LIMIT = 8;

const DEEP_RESEARCH_PROOF_ROLES = new Set<DeepResearchProofRole>([
  'fact', 'actor_time', 'mechanism', 'causality', 'comparison_side',
  'agreement', 'contradiction', 'effect', 'reception', 'limit', 'method',
]);

function parseProofRole(value: unknown): DeepResearchProofRole {
  const normalized = String(value ?? '').trim().toLocaleLowerCase() as DeepResearchProofRole;
  return DEEP_RESEARCH_PROOF_ROLES.has(normalized) ? normalized : 'fact';
}

function sectionClaimsForWriting(section: DeepResearchPlanSection): string[] {
  return [...section.keyClaims, ...(section.coverageClaims ?? [])];
}

// ─────────────────────────────────────────────────────────────────────────────
// AI + DB wiring for Deep Research. The control flow (planning, coverage,
// evidence selection, citation policy, assembly) lives in the pure
// ./deepResearchCore module;
// here we only bind the injected dependencies to real provider/DB calls.
// ─────────────────────────────────────────────────────────────────────────────

export async function generateDeepResearchReport(
  request: DeepResearchRequest,
  onProgress?: (p: DeepResearchProgress) => void,
  signal?: AbortSignal,
): Promise<DeepResearchReport> {
  signal?.throwIfAborted();
  const settings = getSettings();
  const model = request.model ?? settings.deepResearchModel ?? settings.synthesisModel ?? null;
  // Deep Research has useful fallbacks for an unavailable optional stage, but a
  // disconnected provider is not an optional-stage failure. Check Codex once up
  // front so we neither make dozens of doomed calls nor leave a job looking alive.
  if (model?.provider === 'codex') await assertChatGptSubscriptionConnected();
  signal?.throwIfAborted();
  const approach = normalizeDeepResearchApproach(request.approach);
  const deepResearchVersion = parseDeepResearchRequestVersion(request.deepResearchVersion);
  const versionedRequest: DeepResearchRequest = { ...request, deepResearchVersion };
  let report: DeepResearchReport;
  // Study and teaching share one pipeline over the local study_* corpus. Teaching adds
  // the extracted idea network and the unit prompts, selected by `unitMode`; the vault
  // type sets it for anything that reaches here without the flag (MCP, a stale queue).
  if (request.unitMode || getActiveVault().type === 'docencia') {
    const routedRequest = deepResearchVersion === 'v2'
      ? await requestWithCoverageQuestions(versionedRequest, model, signal)
      : versionedRequest;
    report = await generateStudyDeepResearchReport({ ...routedRequest, unitMode: true }, model, onProgress, signal);
    return withGenerationMetadata(report, approach, deepResearchVersion, model);
  }
  if (request.studyMode || getActiveVault().type === 'estudio') {
    const routedRequest = deepResearchVersion === 'v2'
      ? await requestWithCoverageQuestions(versionedRequest, model, signal)
      : versionedRequest;
    report = await generateStudyDeepResearchReport(routedRequest, model, onProgress, signal);
    return withGenerationMetadata(report, approach, deepResearchVersion, model);
  }
  // A genealogy vault has no idea graph; its Deep Research writes a family-history
  // report over the embedding-indexed archive + library instead (own pipeline).
  if (getActiveVault().type === 'genealogy') {
    const routedRequest = deepResearchVersion === 'v2'
      ? await requestWithCoverageQuestions(versionedRequest, model, signal)
      : versionedRequest;
    report = await generateGenealogyDeepResearchReport(routedRequest, onProgress, signal);
    return withGenerationMetadata(report, approach, deepResearchVersion, model);
  }
  // Both academic routes are graph-first. Full-document profiles are prepared and
  // queried only after the orchestrator has frozen the argument.
  const deps = deepResearchEnginePath(deepResearchVersion, approach) === 'v1-general'
      ? legacyAcademicDeps(model)
    : deepResearchEnginePath(deepResearchVersion, approach) === 'v1-specialized'
      ? legacySpecializedAcademicDeps(model, approach, versionedRequest)
      : deepResearchEnginePath(deepResearchVersion, approach) === 'v2-general'
      ? realDeps(model, signal)
      : specializedAcademicDeps(model, approach, versionedRequest, signal);
  report = await orchestrateDeepResearch({ ...versionedRequest, model }, deps, onProgress, signal);
  return withGenerationMetadata(report, approach, deepResearchVersion, model);
}

/** Exact production planning path without section writing. Used by the isolated
 * quality harness so a weak outline can be rejected before report-sized spend. */
export async function generateDeepResearchPlanPreview(request: DeepResearchRequest, options: {
  auditEvidence?: boolean;
  /** Audit harness only: exercise the production documentary stages over a plan
   * generated by another isolated actor without spending another planning call. */
  planOverride?: DeepResearchPlan;
} = {}): Promise<{
  plan: DeepResearchPlan;
  coverageQuestions: string[];
  fallbackUsed: boolean;
  snapshotStats: { ideas: number; works: number; gaps: number; contradictions: number; passages: number };
  planningIdeas: Array<{ id: string; label: string; statement: string; score: number }>;
  claimAudit: { checked: number; supported: number; partial: number; unsupported: number } | null;
  documentPreparation: import('./deepResearchCore').PlanEvidencePreparationResult | null;
}> {
  if (getActiveVault().type !== 'academic') {
    throw new Error('La previsualización idea-first solo está disponible para vaults académicos.');
  }
  const settings = getSettings();
  const model = request.model ?? settings.deepResearchModel ?? settings.synthesisModel ?? null;
  const approach = normalizeDeepResearchApproach(request.approach);
  const deepResearchVersion = parseDeepResearchRequestVersion(request.deepResearchVersion);
  const versionedRequest: DeepResearchRequest = { ...request, deepResearchVersion };
  const deps = deepResearchEnginePath(deepResearchVersion, approach) === 'v1-general'
      ? legacyAcademicDeps(model)
    : deepResearchEnginePath(deepResearchVersion, approach) === 'v1-specialized'
      ? legacySpecializedAcademicDeps(model, approach, versionedRequest)
      : deepResearchEnginePath(deepResearchVersion, approach) === 'v2-general'
      ? realDeps(model)
      : specializedAcademicDeps(model, approach, versionedRequest);
  const language = request.language ?? 'es';
  const brief = {
    kind: 'deep_research' as const,
    deepResearchVersion,
    objective: request.objective,
    audience: request.audience,
    tone: 'academic' as const,
    language,
  };
  const snapshot = await deps.buildSnapshot(brief);
  let coverageQuestions = (request.coverageQuestions ?? [])
    .map((question) => question.trim())
    .filter(Boolean)
    .slice(0, MAX_COVERAGE_QUESTIONS);
  if (deepResearchVersion === 'v2' && !coverageQuestions.length && deps.decomposeObjective) {
    try {
      coverageQuestions = (await deps.decomposeObjective(request.objective, language))
        .map((question) => question.trim())
        .filter(Boolean)
        .slice(0, MAX_COVERAGE_QUESTIONS);
    } catch {
      coverageQuestions = [];
    }
  }
  const sectionPlan = resolveSectionPlan(snapshot, request.sectionLimit ?? 'auto', request.objective, coverageQuestions);
  const input = buildPlanInput(
    { ...versionedRequest, coverageQuestions },
    language,
    snapshot,
    sectionPlan,
  );
  let plan: DeepResearchPlan;
  let fallbackUsed = false;
  try {
    plan = normalizePlan(
      options.planOverride ?? await deps.planReport(input),
      snapshot,
      Number.MAX_SAFE_INTEGER,
      coverageQuestions,
    );
    if (!plan.sections.length) throw new Error('empty plan');
  } catch {
    fallbackUsed = true;
    plan = fallbackPlan(request, snapshot, sectionPlan.target);
  }
  assignMissingCoverageQuestions(plan.sections, coverageQuestions);
  if (coverageQuestions.length && deps.auditPlanCoverage) {
    try {
      const audited = await deps.auditPlanCoverage({
        objective: request.objective,
        language,
        coverageQuestions,
        plan: {
          ...plan,
          sections: plan.sections.map((section) => ({
            ...section,
            keyClaims: [...section.keyClaims],
            ideaIds: [...section.ideaIds],
            workIds: [...section.workIds],
            gapIds: [...section.gapIds],
            contradictionIds: [...section.contradictionIds],
            passageIds: [...section.passageIds],
            coverageQuestions: [...(section.coverageQuestions ?? [])],
            dependsOn: [...(section.dependsOn ?? [])],
          })),
        },
        ideas: input.ideas,
        gaps: input.gaps,
        contradictions: input.contradictions,
      });
      reconcileCoverageAudit(plan, audited, snapshot, coverageQuestions);
    } catch {
      /* preview exposes the same safe fallback as the full orchestrator */
    }
  }
  enforcePlanObjectiveExclusions(plan, snapshot, request.objective);
  assignMissingCoverageQuestions(plan.sections, coverageQuestions);
  let documentPreparation: import('./deepResearchCore').PlanEvidencePreparationResult | null = null;
  const claimAudit = { checked: 0, supported: 0, partial: 0, unsupported: 0 };
  if (options.auditEvidence && deps.auditSectionClaims) {
    if (deps.preparePlanEvidence) {
      try {
        documentPreparation = await deps.preparePlanEvidence({
          objective: request.objective,
          language,
          coverageQuestions,
          plan: {
            ...plan,
            sections: plan.sections.map((section) => ({
              ...section,
              keyClaims: [...section.keyClaims],
              ideaIds: [...section.ideaIds],
              workIds: [...section.workIds],
              gapIds: [...section.gapIds],
              contradictionIds: [...section.contradictionIds],
              passageIds: [...section.passageIds],
              coverageQuestions: [...(section.coverageQuestions ?? [])],
              dependsOn: [...(section.dependsOn ?? [])],
            })),
          },
          candidateWorkIds: plannedCandidateWorkIds(plan, snapshot),
        });
      } catch {
        documentPreparation = null;
      }
    }
    const maps = buildSnapshotMaps(snapshot);
    for (const section of plan.sections) {
      if (deps.retrieveForSection) {
        try {
          const material = await deps.retrieveForSection({
            objective: request.objective,
            sectionTitle: section.title,
            purpose: section.purpose,
            keyClaims: [...section.keyClaims],
            coverageQuestions: [...(section.coverageQuestions ?? [])],
            excludeIdeaIds: [...section.ideaIds],
            excludePassageIds: [...section.passageIds],
            limits: SECTION_RETRIEVAL_LIMITS,
          });
          const merged = mergeRetrievedMaterial(maps, material ?? {});
          section.ideaIds = [...new Set([...section.ideaIds, ...merged.ideaIds])].slice(0, MAX_SECTION_IDEAS);
          section.passageIds = [...new Set([...section.passageIds, ...merged.passageIds])];
        } catch {
          /* Existing graph evidence remains auditable. */
        }
      }
      const originalClaims = [...section.keyClaims];
      const citationMenu = buildCitationMenu(section, maps).filter((item) =>
        !matchesObjectiveExclusion(citationMenuExclusionText(item, maps), request.objective));
      try {
        const audited = normalizeSectionClaimAudit(await deps.auditSectionClaims({
          objective: request.objective,
          language,
          audience: request.audience,
          section,
          isConclusion: section.role === 'synthesis',
          citationMenu,
          priorSummary: '',
          alreadyDeveloped: [],
          reservedForOtherSections: plan.sections.filter((candidate) => candidate.id !== section.id).map((candidate) => ({
            title: candidate.title,
            responsibilities: [...candidate.keyClaims, ...(candidate.coverageQuestions ?? [])],
          })),
        }), originalClaims, new Set(citationMenu.map((item) => item.token)));
        if (audited.items.length === originalClaims.length) {
          for (const item of audited.items) claimAudit[item.status] += 1;
          claimAudit.checked += audited.items.length;
          section.keyClaims = audited.items.map((item) => item.revised);
        }
      } catch {
        /* Preview remains graph-only when an audit call fails. */
      }
    }
  }
  return {
    plan,
    coverageQuestions,
    fallbackUsed,
    snapshotStats: {
      ideas: snapshot.ideas.length,
      works: snapshot.works.length,
      gaps: snapshot.gaps.length,
      contradictions: snapshot.contradictions.length,
      passages: snapshot.passages.length,
    },
    planningIdeas: snapshot.ideas.slice(0, 70).map((idea) => ({
      id: idea.id,
      label: idea.label,
      statement: idea.statement,
      score: idea.score,
    })),
    claimAudit: claimAudit.checked > 0 ? claimAudit : null,
    documentPreparation,
  };
}

async function requestWithCoverageQuestions(
  request: DeepResearchRequest,
  model: ModelRef | null,
  signal?: AbortSignal,
): Promise<DeepResearchRequest> {
  signal?.throwIfAborted();
  if (request.coverageQuestions?.length) {
    return { ...request, coverageQuestions: request.coverageQuestions.slice(0, MAX_COVERAGE_QUESTIONS) };
  }
  const coverageQuestions = await aiDecomposeObjective(request.objective, request.language, model);
  signal?.throwIfAborted();
  return {
    ...request,
    coverageQuestions,
  };
}

/** Pure characterization seam used by CI to lock old/undefined requests to General. */
export function deepResearchApproachPath(value: unknown): 'general' | 'specialized' {
  return normalizeDeepResearchApproach(value) === 'general' ? 'general' : 'specialized';
}

/** Pure router seam. Version and research approach remain orthogonal metadata. */
export function deepResearchEnginePath(
  versionValue: unknown,
  approachValue: unknown,
): 'v1-general' | 'v1-specialized' | 'v2-general' | 'v2-specialized' {
  const version = parseDeepResearchRequestVersion(versionValue);
  return characterizeDeepResearchEngine(version, deepResearchApproachPath(approachValue) === 'specialized');
}

function withGenerationMetadata(
  report: DeepResearchReport,
  approach: DeepResearchApproach,
  deepResearchVersion: DeepResearchVersion,
  model: ModelRef | null,
): DeepResearchReport {
  return {
    ...report,
    draft: {
      ...report.draft,
      brief: { ...report.draft.brief, deepResearchApproach: approach, deepResearchVersion },
      deepResearchApproach: approach,
      deepResearchVersion,
      generationModel: model ? { ...model } : null,
    },
    meta: { ...report.meta, deepResearchVersion },
  };
}

/** Reproducible compatibility engine. It preserves the historical idea/passage
 * retrieval architecture while sharing the current evidence-driven (length-free)
 * writing and citation safety contract. */
function legacyAcademicDeps(model: ModelRef | null): DeepResearchDeps {
  return {
    buildSnapshot: (brief) => buildHistoricalWritingWorkshopSnapshot(brief),
    planReport: (input) => aiPlanReport(input, model),
    writeSection: (input) => aiWriteSection(input, model),
    finalize: (input) => aiFinalize(input, model),
    retrieveForSection: (input) => retrieveSectionMaterialLegacy(input),
    verifyCitations: (claims) => aiVerifyCitations(claims, model),
    checkCoherence: (sections) => aiCheckCoherence(sections, model),
  };
}

function legacySpecializedAcademicDeps(
  model: ModelRef | null,
  approach: DeepResearchApproach,
  request: DeepResearchRequest,
): DeepResearchDeps {
  let context: AcademicApproachContext = {
    approach,
    rules: approachRules(approach, 'academic'),
    retrieval: { probes: [], comparands: [], axes: [], phases: [] },
    relationships: [],
  };
  return {
    buildSnapshot: async (brief) => {
      const ordinary = await buildHistoricalWritingWorkshopSnapshot(brief);
      const retrieval = await planApproachRetrieval({
        approach,
        variant: 'academic',
        objective: request.objective,
        language: request.language ?? 'es',
        model,
        corpusPreview: {
          themes: ordinary.themes.slice(0, 16).map((item) => item.label),
          works: ordinary.works.slice(0, 24).map((item) => ({ title: item.title, authors: item.authors, year: item.year })),
          contradictions: ordinary.contradictions.slice(0, 16).map((item) => item.summary),
          gaps: ordinary.gaps.slice(0, 16).map((item) => item.summary),
        },
      });
      const supplemental = await buildHistoricalWritingWorkshopSnapshot(brief, retrieval.probes);
      const merged = mergeApproachSnapshots(ordinary, supplemental, approach);
      context = { ...context, retrieval, relationships: academicRelationshipContext(merged) };
      return merged;
    },
    planReport: (input) => aiPlanReport(input, model, context),
    writeSection: (input) => aiWriteSection(input, model, context),
    finalize: (input) => aiFinalize(input, model, context),
    retrieveForSection: (input) => retrieveSectionMaterialLegacy(input),
    verifyCitations: (claims) => aiVerifyCitations(claims, model),
    checkCoherence: (sections) => aiCheckCoherence(sections, model),
  };
}

function realDeps(model: ModelRef | null, signal?: AbortSignal): DeepResearchDeps {
  const experimentalProse = process.env.NODUS_EXPERIMENTAL_DEEP_RESEARCH_PROSE === '1';
  let relationships: ReturnType<typeof academicRelationshipContext> = [];
  return {
    buildSnapshot: async (brief) => {
      const snapshot = await buildIdeaFirstWritingWorkshopSnapshot(brief, academicObjectiveProbes(brief.objective));
      relationships = academicRelationshipContext(snapshot);
      return snapshot;
    },
    planReport: (input) => aiPlanReport({ ...input, relationships }, model),
    writeSection: (input) => aiWriteSection(input, model),
    finalize: (input) => aiFinalize(input, model),
    auditFinalSummary: (input, draft) => aiAuditFinalSummary(input, draft, model),
    decomposeObjective: (objective, language) => aiDecomposeObjective(objective, language, model),
    auditPlanCoverage: (input) => aiAuditPlanCoverage(input, model, relationships),
    preparePlanEvidence: (input) => prepareRelevantDocumentProfiles(
      input.candidateWorkIds,
      'deep-research',
      ON_DEMAND_DOCUMENT_PROFILE_LIMIT,
      signal,
    ),
    retrieveForSection: (input) => retrieveSectionMaterial(input),
    auditSectionClaims: (input) => aiAuditSectionClaims(input, model),
    reviseSection: (input) => aiReviseSection(input, model),
    verifyCitations: (claims) => aiVerifyCitations(claims, model),
    checkCoherence: (sections) => aiCheckCoherence(sections, model),
    // The evidence-planned/paragraph writer raised deterministic proxy scores but
    // repeatedly lost full-text blind comparisons against existing Nodus reports.
    // Keep it available for explicit research runs, never as the production default.
    ...(experimentalProse ? {
      planSectionEvidence: (input: SectionInput) => aiPlanSectionEvidence(input, model),
      judgeSectionRevision: (input: SectionInput, original: string, revised: string) => aiJudgeSectionRevision(input, original, revised, model),
      reviewReport: (input: Parameters<NonNullable<DeepResearchDeps['reviewReport']>>[0]) => aiReviewReport(input, model),
    } : {}),
  };
}

interface AcademicApproachContext {
  approach: DeepResearchApproach;
  rules: ReturnType<typeof approachRules>;
  retrieval: ApproachRetrievalPlan;
  relationships: ReturnType<typeof academicRelationshipContext>;
}

/** Specialized Academic adapter. It is intentionally unreachable from General. */
function specializedAcademicDeps(
  model: ModelRef | null,
  approach: DeepResearchApproach,
  request: DeepResearchRequest,
  signal?: AbortSignal,
): DeepResearchDeps {
  const experimentalProse = process.env.NODUS_EXPERIMENTAL_DEEP_RESEARCH_PROSE === '1';
  let context: AcademicApproachContext = {
    approach,
    rules: approachRules(approach, 'academic'),
    retrieval: { probes: [], comparands: [], axes: [], phases: [] },
    relationships: [],
  };
  return {
    buildSnapshot: async (brief) => {
      // Specialized probes may broaden the IDEA graph before planning. Document
      // profiles and passages remain excluded until the resulting plan is fixed.
      const ordinary = await buildIdeaFirstWritingWorkshopSnapshot(brief, academicObjectiveProbes(brief.objective));
      const retrieval = await planApproachRetrieval({
        approach,
        variant: 'academic',
        objective: request.objective,
        language: request.language ?? 'es',
        model,
        corpusPreview: {
          themes: ordinary.themes.slice(0, 16).map((item) => item.label),
          works: ordinary.works.slice(0, 24).map((item) => ({ title: item.title, authors: item.authors, year: item.year })),
          contradictions: ordinary.contradictions.slice(0, 16).map((item) => item.summary),
          gaps: ordinary.gaps.slice(0, 16).map((item) => item.summary),
        },
      });
      const supplemental = await buildIdeaFirstWritingWorkshopSnapshot(brief, retrieval.probes);
      const merged = mergeApproachSnapshots(ordinary, supplemental, approach);
      context = { ...context, retrieval, relationships: academicRelationshipContext(merged) };
      return merged;
    },
    planReport: (input) => aiPlanReport(input, model, context),
    writeSection: (input) => aiWriteSection(input, model, context),
    finalize: (input) => aiFinalize(input, model, context),
    auditFinalSummary: (input, draft) => aiAuditFinalSummary(input, draft, model, context),
    decomposeObjective: (objective, language) => aiDecomposeObjective(objective, language, model),
    auditPlanCoverage: (input) => aiAuditPlanCoverage(input, model, context.relationships),
    preparePlanEvidence: (input) => prepareRelevantDocumentProfiles(
      input.candidateWorkIds,
      'deep-research',
      ON_DEMAND_DOCUMENT_PROFILE_LIMIT,
      signal,
    ),
    retrieveForSection: async (input) => {
      const ordinary = await retrieveSectionMaterial(input);
      const facets = [...context.retrieval.axes, ...context.retrieval.phases, ...context.retrieval.comparands]
        .slice(0, 3);
      if (!facets.length) return ordinary;
      const supplemental = await retrieveSectionMaterial({
        ...input,
        purpose: `${input.purpose}. ${facets.join('. ')}`,
        keyClaims: [...input.keyClaims, ...facets],
        limits: { ideas: input.limits.ideas * 2, passages: input.limits.passages * 2 },
      });
      return {
        ideas: [...ordinary.ideas, ...supplemental.ideas].filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index),
        passages: [...ordinary.passages, ...supplemental.passages].filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index),
        evidencePacks: [...ordinary.evidencePacks, ...supplemental.evidencePacks].reduce<Array<{
          question: string;
          passageIds: string[];
          candidates: AtomicPassageRetrieval[];
        }>>((packs, pack) => {
          const existing = packs.find((candidate) => candidate.question === pack.question);
          if (existing) {
            existing.passageIds = [...new Set([...existing.passageIds, ...pack.passageIds])];
            existing.candidates = [...existing.candidates, ...(pack.candidates ?? [])]
              .filter((item, index, all) => all.findIndex((candidate) => candidate.passageId === item.passageId) === index);
          } else {
            packs.push({ question: pack.question, passageIds: [...pack.passageIds], candidates: [...(pack.candidates ?? [])] });
          }
          return packs;
        }, []),
      };
    },
    auditSectionClaims: (input) => aiAuditSectionClaims(input, model, context),
    reviseSection: (input) => aiReviseSection(input, model, context),
    verifyCitations: (claims) => aiVerifyCitations(claims, model),
    checkCoherence: (sections) => aiCheckCoherence(sections, model),
    ...(experimentalProse ? {
      planSectionEvidence: (input: SectionInput) => aiPlanSectionEvidence(input, model, context),
      judgeSectionRevision: (input: SectionInput, original: string, revised: string) => aiJudgeSectionRevision(input, original, revised, model),
      reviewReport: (input: Parameters<NonNullable<DeepResearchDeps['reviewReport']>>[0]) => aiReviewReport(input, model),
    } : {}),
  };
}

/** Explicit clauses broaden graph recall without turning coverage into an outline.
 * Unlike the old AI decomposition, these probes add no concepts and carry no
 * exclusive section mandate; they are merely alternative searches over the same
 * user-authored objective. */
export function academicObjectiveProbes(objective: string): string[] {
  const normalized = objective.replace(/\s+/gu, ' ').trim();
  if (!normalized) return [];
  const clauses = normalized
    .split(/[.;]\s+/u)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length >= 32)
    .filter((clause) => !/^(?:excluir|exclude|sin abordar|no abordar)\b/iu.test(clause));
  return [...new Set(clauses)].slice(0, 7);
}

interface AiCoherence {
  tensiones?: { seccion_a?: string; cita_a?: string; seccion_b?: string; cita_b?: string; problema?: string }[];
}

interface AiReportReview {
  diagnostico_global?: string;
  secciones?: Array<{
    titulo?: string;
    diagnostico?: string;
    eliminar?: string[];
    profundizar?: string[];
    cautelas?: string[];
    transicion?: string;
  }>;
}
function isAiReportReview(value: unknown): value is AiReportReview {
  return typeof value === 'object' && value !== null && Array.isArray((value as AiReportReview).secciones);
}

async function aiReviewReport(
  input: {
    objective: string;
    sections: Array<{ title: string; purpose: string; responsibilities: string[]; markdown: string }>;
  },
  model: ModelRef | null,
): Promise<ReportEditorialReview> {
  const system = [
    'Eres el director académico que diagnostica un informe completo antes de su edición final. No reescribes ni añades investigación.',
    'Evalúa el argumento como una secuencia: qué demuestra cada sección, qué repite, qué presupone, qué debate nombra sin desarrollar y qué requisito del encargo queda superficial.',
    'Detecta con precisión metadiscurso mecánico, párrafos-catalogo, hipérboles, causalidades no demostradas, contradicciones cronológicas, citas decorativas y conclusiones que se limitan a repetir la introducción.',
    'Toda exclusión del encargo es vinculante. Señala cualquier incumplimiento.',
    'No pidas hechos, autores ni fuentes nuevos: la edición posterior solo puede reorganizar, precisar, comparar y eliminar dentro de lo ya citado.',
    'Para cada sección produce una directiva concreta. En eliminar nombra tesis o pasajes redundantes, no consejos vagos. En profundizar indica el mecanismo, divergencia o consecuencia que debe explicarse con las fuentes ya presentes. En cautelas identifica el grado de certeza que debe rebajarse.',
    'La transición debe describir la relación conceptual con la sección siguiente, nunca una frase formularia.',
    'Devuelve SOLO JSON válido: {"diagnostico_global":"...","secciones":[{"titulo":"título exacto","diagnostico":"...","eliminar":["..."],"profundizar":["..."],"cautelas":["..."],"transicion":"..."}]}.',
  ].join('\n');
  const user = JSON.stringify({
    objetivo: input.objective,
    secciones: input.sections.map((section) => ({
      titulo: section.title,
      proposito: section.purpose,
      responsabilidades: section.responsibilities,
      texto: section.markdown.replace(/\[([^\]]*)\]\((nodus:\/\/[^)]*)\)/g, '$1'),
    })),
  }, null, 2);
  const result = await completeJson<AiReportReview>({ system, user, temperature: 0, maxTokens: 4200 }, isAiReportReview, model);
  return {
    overall: String(result.diagnostico_global ?? '').trim(),
    directives: (result.secciones ?? []).map((section) => ({
      sectionTitle: String(section.titulo ?? '').trim(),
      diagnosis: String(section.diagnostico ?? '').trim(),
      remove: (section.eliminar ?? []).filter((item): item is string => typeof item === 'string').slice(0, 8),
      deepen: (section.profundizar ?? []).filter((item): item is string => typeof item === 'string').slice(0, 8),
      cautions: (section.cautelas ?? []).filter((item): item is string => typeof item === 'string').slice(0, 8),
      transition: String(section.transicion ?? '').trim(),
    })).filter((section) => section.sectionTitle),
  };
}
function isAiCoherence(v: unknown): v is AiCoherence {
  return typeof v === 'object' && v !== null;
}

/**
 * Look for places where the report argues against itself.
 *
 * Read-only by design. Both sides must be quoted verbatim so the orchestrator can
 * confirm the sentences exist before believing the finding — a model asked to find
 * contradictions will happily invent one, and an invented tension printed in the
 * limitations of an academic report is worse than no check at all.
 */
async function aiCheckCoherence(
  sections: { title: string; text: string }[],
  model: ModelRef | null
): Promise<CoherenceIssue[]> {
  const system = [
    'Revisas la coherencia interna de un informe académico ya redactado.',
    'Busca ÚNICAMENTE lugares donde el informe se contradice a sí mismo: dos pasajes que no pueden ser ciertos a la vez, o donde una sección afirma algo que otra niega o matiza hasta el punto de resultar incompatible.',
    'No señales repeticiones, cambios de énfasis, matices compatibles ni cuestiones de estilo. Un desacuerdo ENTRE AUTORES citados no es una contradicción del informe: eso es un debate y es correcto que aparezca.',
    'Cita ambos pasajes LITERALMENTE, copiando una frase completa de cada uno tal y como aparece en el texto. Si no puedes copiarlas literalmente, no incluyas la tensión.',
    'Si el informe es coherente, devuelve una lista vacía. Es la respuesta esperada la mayoría de las veces.',
    'Devuelve SOLO JSON válido: {"tensiones":[{"seccion_a":"...","cita_a":"...","seccion_b":"...","cita_b":"...","problema":"en una frase, qué es incompatible"}]}',
  ].join('\n');
  const user = JSON.stringify(
    { secciones: sections.map((s) => ({ titulo: s.title, texto: s.text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') })) },
    null,
    2
  );
  try {
    const ai = await completeJson<AiCoherence>({ system, user, temperature: 0, maxTokens: 1400 }, isAiCoherence, model);
    return (ai.tensiones ?? [])
      .filter((t) => t && typeof t.cita_a === 'string' && typeof t.cita_b === 'string')
      .slice(0, 5)
      .map((t) => ({
        sectionA: String(t.seccion_a ?? ''),
        quoteA: String(t.cita_a ?? ''),
        sectionB: String(t.seccion_b ?? ''),
        quoteB: String(t.cita_b ?? ''),
        issue: String(t.problema ?? '').trim() || 'Afirmaciones incompatibles entre secciones.',
      }));
  } catch {
    return [];
  }
}

interface AiProbes {
  subpreguntas?: string[];
}
function isAiProbes(v: unknown): v is AiProbes {
  return typeof v === 'object' && v !== null;
}

/**
 * Break the objective into the questions a researcher would actually go looking for.
 *
 * The corpus is searched by semantic similarity, so a single probe reaches only what
 * resembles the objective *as a whole sentence*. An objective spanning several axes
 * retrieves the intersection and misses what each axis would surface on its own —
 * with ~10,000 ideas indexed, a report was being built on the neighbourhood of one
 * query. Each sub-question becomes an independent probe. Failure is harmless: the
 * objective alone still works exactly as before.
 */
async function aiDecomposeObjective(objective: string, language: string | undefined, model: ModelRef | null): Promise<string[]> {
  const system = [
    'Descompones un objetivo de investigación en las preguntas concretas que habría que buscar por separado en una biblioteca académica.',
    'Cada subpregunta debe ser autónoma y buscable por sí sola, formulada como una frase con contenido (no una etiqueta de dos palabras).',
    'Hazlas ATÓMICAS: si el objetivo enumera operaciones distintas —por ejemplo organización, competencias y evolución; o producción, catalogación y distribución— formula una pregunta independiente para cada operación. Una misma sección podrá agruparlas después, pero la recuperación debe poder buscarlas por separado.',
    'Descompón SOLO los requisitos explícitos del objetivo. No añadas actores, métodos, lugares, periodos ni debates que el usuario no haya pedido.',
    'No pierdas incisos, ejemplos vinculantes, exclusiones ni preguntas sobre cronología, causalidad, comparación, eficacia o controversia historiográfica.',
    `Produce entre 4 y ${MAX_COVERAGE_QUESTIONS} subpreguntas, salvo que el objetivo sea tan simple que necesite menos. Devuelve SOLO JSON válido: {"subpreguntas":["...","..."]}`,
  ].join('\n');
  try {
    const ai = await completeJson<AiProbes>(
      { system, user: JSON.stringify({ objetivo: objective, idioma: language ?? 'es' }), temperature: 0.2, maxTokens: 700 },
      isAiProbes,
      model
    );
    return (ai.subpreguntas ?? [])
      .filter((q): q is string => typeof q === 'string' && q.trim().length > 12)
      .slice(0, MAX_COVERAGE_QUESTIONS);
  } catch {
    return [];
  }
}

/** Exposed for `scripts/measure-retrieval-breadth.mjs`. */
export const __decomposeObjectiveForTesting = aiDecomposeObjective;

/** How many claims are judged per call. Small enough that the judge reads each one. */
const VERIFY_BATCH = 12;

/**
 * Exposed for `scripts/verify-citation-judge.mjs`, which feeds the judge deliberately
 * false citations to check it rejects them. A verifier nobody audits can quietly
 * approve everything and still look like it is working.
 */
export const __verifyCitationsForTesting = aiVerifyCitations;

interface AiVerdicts {
  veredictos?: { i?: number; veredicto?: string }[];
}
function isAiVerdicts(v: unknown): v is AiVerdicts {
  return typeof v === 'object' && v !== null && Array.isArray((v as AiVerdicts).veredictos);
}

/**
 * Judge whether each cited source really supports the sentence it was attached to.
 *
 * The citation policy already proves the source exists in the corpus; this is the
 * only thing standing between "the report cites something real" and "the report
 * cites something that says what the report claims it says". A claim whose judgement
 * cannot be obtained aborts the batch and is recorded as unverified by the
 * orchestrator. It never deletes a citation on the strength of a failed API call,
 * but it also never presents an unavailable judgement as a successful check.
 */
export async function aiVerifyCitations(claims: CitationClaim[], model: ModelRef | null): Promise<CitationVerdict[]> {
  const verdicts: Array<CitationVerdict | null> = new Array(claims.length).fill(null);
  const system = [
    'Eres el verificador de citas del modo Deep Research de Nodus.',
    'Para cada par recibes UNA afirmación tal como aparece en un informe académico y el CONTENIDO de la fuente que se ha citado para sostenerla.',
    'Tu única tarea es decidir si esa fuente sostiene esa afirmación. No juzgues si la afirmación es cierta en el mundo, ni si está bien escrita, ni si la fuente es buena.',
    'Veredictos posibles:',
    '- "sostiene": el contenido afirma, implica o documenta directamente lo que dice la frase.',
    '- "parcial": el contenido sostiene una parte de la frase, o una versión más débil o más limitada de lo que afirma.',
    '- "no_sostiene": el contenido trata de otra cosa, dice algo distinto, o no permite afirmar lo que la frase sostiene.',
    'Una frase puede citar varias fuentes: juzga SOLO la que se te da en cada par, aunque otra fuente distinta pudiera sostener la frase.',
    'Descompón mentalmente la frase en sujeto, relación, objeto, escala, periodo y efecto. `sostiene` exige que la fuente respalde todos los componentes que la frase le atribuye; coincidencia temática o contexto general es `parcial`.',
    'Distingue estrictamente descripción, atribución, mecanismo, causalidad, intención, efecto y recepción. Una fuente que documenta intención no sostiene un efecto; una audiencia prevista no sostiene recepción; una asociación no sostiene causalidad.',
    'Si la frase declara acuerdo, divergencia, contradicción o comparación entre posiciones, esta fuente debe sostener el lado que se le atribuye. Si la misma cláusula le atribuye también el otro lado o el vínculo completo sin documentarlo, marca `parcial`.',
    'Una idea normalizada puede sostener la interpretación atribuida al autor, pero no convierte por sí sola esa interpretación en hecho documental. Un passage literal es evidencia más directa, aunque también debe corresponder exactamente al predicado.',
    'Ante la duda razonable entre "sostiene" y "parcial", elige "parcial". Reserva "no_sostiene" para cuando la relación sea realmente inexistente.',
    'Devuelve SOLO JSON válido: {"veredictos":[{"i":0,"veredicto":"sostiene|parcial|no_sostiene"}]} con una entrada por par y el mismo índice que recibiste.',
  ].join('\n');

  for (let start = 0; start < claims.length; start += VERIFY_BATCH) {
    const batch = claims.slice(start, start + VERIFY_BATCH);
    const user = JSON.stringify(
      {
        pares: batch.map((claim, offset) => ({
          i: offset,
          afirmacion: claim.sentence,
          tipo_de_fuente: claim.kind,
          contenido_de_la_fuente: claim.content,
        })),
      },
      null,
      2
    );
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const ai = await completeJson<AiVerdicts>({ system, user, temperature: 0, maxTokens: 1800 }, isAiVerdicts, model);
        for (const entry of ai.veredictos ?? []) {
          const at = start + (typeof entry.i === 'number' ? entry.i : -1);
          if (at < start || at >= start + batch.length) continue;
          const raw = String(entry.veredicto ?? '').toLowerCase();
          verdicts[at] = raw.includes('no_sostiene') ? 'unsupported' : raw.includes('parcial') ? 'partial' : 'supports';
        }
        if (verdicts.slice(start, start + batch.length).every((verdict) => verdict != null)) break;
        lastError = new Error('El verificador omitió uno o más veredictos.');
      } catch (error) {
        lastError = error;
      }
    }
    if (verdicts.slice(start, start + batch.length).some((verdict) => verdict == null)) {
      throw new Error(`No se pudo verificar el lote de citas ${start + 1}-${start + batch.length}.`, { cause: lastError });
    }
  }
  return verdicts as CitationVerdict[];
}

/**
 * Repair argument quality without widening the evidence boundary. The orchestrator
 * still decides whether to keep this rewrite using deterministic before/after
 * metrics, so the editor cannot improve its own grade by assertion.
 */
async function aiReviseSection(
  input: SectionRevisionInput,
  model: ModelRef | null,
  approach?: AcademicApproachContext,
): Promise<string> {
  const system = [
    'Eres el editor académico final de una sección de Deep Research de Nodus.',
    'Las `proposiciones_a_contrastar` proceden del plan y no son hechos. La `auditoria_epistemologica` posterior a la recuperación fija el máximo grado de certeza permitido y prevalece sobre el plan.',
    'Reescribe la sección para corregir los problemas de calidad enumerados y ejecutar una edición académica final. Conserva su tesis y toda precisión que ya esté bien formulada, pero elimina cualquier repetición sin valor.',
    'En la edición final elimina repeticiones respecto al recorrido previo, fortalece la progresión entre párrafos, integra las citas en la sintaxis y aplica estrictamente el plan probatorio. No introduzcas un tema nuevo para hacer el texto más vistoso.',
    'Elimina metadiscurso de hoja de ruta y cierres formularios. No repitas una responsabilidad reservada a otra sección ni un mecanismo ya demostrado en el recorrido previo.',
    'Cuando recibas una directiva global, aplícala de forma visible: elimina exactamente las redundancias señaladas, desarrolla los mecanismos indicados con las citas que ya existen y rebaja las certezas enumeradas. No contestes a la directiva; entrega la sección corregida.',
    'Usa exclusivamente los materiales del menú. No inventes hechos, autores, obras, páginas ni enlaces.',
    'Cada enlace nodus:// debe copiarse literalmente del menú. No añadas una cita si su note no sostiene la frase. Puedes retirar una cita redundante, pero no dejes sin apoyo una afirmación sustantiva.',
    'La mejora debe proceder de explicar mecanismos, comparar fuentes, distinguir convergencias y desacuerdos, formular límites probatorios y conectar la evidencia con la pregunta. No rellenes ni acumules citas.',
    'Si el menú lo permite, crea síntesis real entre fuentes independientes. Cada comparación debe explicar convergencia, divergencia, escala o límite; dos enlaces juntos sin relación analizada no cuentan.',
    'Elimina repeticiones entre párrafos y reformula cualquier afirmación determinista que el material solo permita sostener como inferencia. Un debate debe identificar posiciones, evidencias, causa de la divergencia y criterio de resolución.',
    'Distribuye las referencias junto a la afirmación que sostienen. No apiles autores al final del párrafo ni uses una referencia como aval genérico de varias afirmaciones distintas.',
    'Las frases señaladas por el verificador requieren una decisión explícita: reescríbelas con un alcance menor, vuelve a fundamentarlas con una fuente cuyo note sí las sostenga o elimínalas. Repara la gramática que haya quedado rota al retirarse una atribución y no dejes una afirmación huérfana.',
    'Cuando haya frases señaladas, la prioridad absoluta es reducir su número: compara la frase completa con cada note, divide frases que mezclen varias afirmaciones y conserva solo la proposición que la fuente sostenga literalmente o por implicación inmediata. No sustituyas una exageración por otra.',
    'Compara sujeto, relación, objeto, escala, periodo y efecto con la auditoría. No añadas en la edición un actor, una fecha, una causalidad, una eficacia o una recepción que no figure en la reformulación auditada.',
    'No redactes un acuerdo, divergencia o contradicción si el plan no contiene dos lados evidenciados. En ese caso conserva la posición demostrada y formula la otra como hueco, no como oposición.',
    'Respeta todas las exclusiones del objetivo y del plan probatorio. Suprime cualquier excursión hacia un eje excluido aunque tenga una cita válida.',
    'Usa tono analítico sobrio. Retira hipérboles, intenciones atribuidas sin prueba y conclusiones deterministas; marca como inferencia del informe lo que no sea un dato o una interpretación atribuida.',
    'Cuando haya pasajes pertinentes, intégralos como evidencia textual precisa. No conviertas la sección en una sucesión de citas literales.',
    'Mantén un único encabezado ## y prosa continua sin microsecciones ni listas.',
    ...(approach?.rules.writer ?? []),
    ...DEEP_RESEARCH_NARRATIVE_RULES,
    'Devuelve solo el Markdown completo de la sección revisada.',
  ].join('\n');
  const user = JSON.stringify({
    objetivo: input.objective,
    tipo_de_pase: (input.verificationConcerns?.length ?? 0) > 0 ? 'reparacion_probatoria' : 'edicion_academica_final',
    seccion: {
      titulo: input.section.title,
      proposito: input.section.purpose,
      proposiciones_a_contrastar: sectionClaimsForWriting(input.section),
      preguntas_de_cobertura: input.section.coverageQuestions ?? [],
    },
    problemas_detectados: input.quality.issues,
    directiva_del_editor_global: input.editorialDirective ?? null,
    frases_con_respaldo_parcial_o_retirado: input.verificationConcerns ?? [],
    metricas_antes: input.quality.metrics,
    borrador: input.draft,
    menu_de_citas: input.citationMenu,
    afirmaciones_ya_desarrolladas: input.alreadyDeveloped,
    responsabilidades_reservadas_a_otras_secciones: input.reservedForOtherSections ?? [],
    plan_probatorio: input.evidencePlan ?? null,
    auditoria_epistemologica: input.claimAudit ?? null,
  }, null, 2);
  return completeText({ system, user, temperature: 0, maxTokens: 5600 }, model);
}

interface AiSectionChoice { ganador?: number; motivo?: string }
function isAiSectionChoice(value: unknown): value is AiSectionChoice {
  return typeof value === 'object' && value !== null && typeof (value as AiSectionChoice).ganador === 'number';
}

/**
 * Prevent a stylistic rewrite from being accepted just because easy-to-game
 * counters stayed green. The same pair is judged in both orders and the revision
 * wins only on agreement; any order bias or uncertainty keeps the verified draft.
 */
async function aiJudgeSectionRevision(
  input: SectionInput,
  original: string,
  revised: string,
  model: ModelRef | null,
): Promise<boolean> {
  const system = [
    'Comparas dos versiones anónimas de la misma sección académica. No sabes cuál es original ni revisada.',
    'Elige la que sea globalmente mejor en: respuesta directa al encargo, profundidad explicativa, progresión argumental, integración precisa de citas, prudencia, desarrollo real de debates y ausencia de repetición.',
    'Penaliza cualquier incumplimiento de una exclusión, afirmación retórica o determinista no demostrada, cita decorativa, lista de autores disfrazada de análisis, nueva desviación temática o pérdida de un requisito.',
    'No premies la longitud ni el tono seguro. Si son equivalentes devuelve 0.',
    'Devuelve SOLO JSON válido: {"ganador":0|1|2,"motivo":"una frase concreta"}.',
  ].join('\n');
  const ask = async (first: string, second: string): Promise<number> => {
    const user = JSON.stringify({
      objetivo: input.objective,
      seccion: {
        titulo: input.section.title,
        proposito: input.section.purpose,
        preguntas_de_cobertura: input.section.coverageQuestions ?? [],
      },
      exclusiones_y_plan_probatorio: input.evidencePlan ?? null,
      responsabilidades_reservadas_a_otras_secciones: input.reservedForOtherSections ?? [],
      secciones_previas: input.priorSummary,
      version_1: first.replace(/\[([^\]]*)\]\((nodus:\/\/[^)]*)\)/g, '$1'),
      version_2: second.replace(/\[([^\]]*)\]\((nodus:\/\/[^)]*)\)/g, '$1'),
    }, null, 2);
    try {
      const result = await completeJson<AiSectionChoice>({ system, user, temperature: 0, maxTokens: 500 }, isAiSectionChoice, model);
      return result.ganador === 1 || result.ganador === 2 ? result.ganador : 0;
    } catch {
      return 0;
    }
  };
  const forward = await ask(original, revised);
  const reverse = await ask(revised, original);
  return forward === 2 && reverse === 1;
}

interface AiPlan {
  title?: string;
  abstract?: string;
  sections?: Array<Partial<DeepResearchPlanSection>>;
}

function isAiPlan(v: unknown): v is AiPlan {
  return typeof v === 'object' && v !== null && Array.isArray((v as AiPlan).sections);
}

async function aiAuditPlanCoverage(
  input: PlanCoverageAuditInput,
  model: ModelRef | null,
  relationships: ReturnType<typeof academicRelationshipContext>,
): Promise<DeepResearchPlan> {
  const system = [
    'Eres el auditor de cobertura de un plan académico YA APROBADO. No vuelves a planificar el informe.',
    'Conserva literalmente título, resumen, número, ids, orden, roles, dependencias, títulos de sección, propósitos y keyClaims. No reescribas ninguna proposición histórica: este paso solo asigna controles de cobertura y evidencia del grafo ya disponible.',
    'Tu tarea es localizar qué requisito explícito queda superficial y asignarlo a la sección existente que mejor puede resolverlo.',
    'Asigna cada pregunta recibida a UNA sola sección primaria mediante `coverageQuestions`, copiándola literalmente. Una pregunta es un control de cobertura, nunca el nombre ni el principio organizador de una sección.',
    'Puedes añadir a cada sección ids de ideas, huecos y contradicciones pertinentes que ya existan en los menús, sin retirar las asignaciones aprobadas. Usa exclusivamente ids presentes y deja passageIds vacío.',
    'No inventes datos que esperas encontrar después en documentos, no añadas conceptos ni introduzcas ejes excluidos por el objetivo.',
    'Devuelve SOLO JSON válido con la misma forma del plan recibido.',
  ].join('\n');
  const user = JSON.stringify({
    objetivo: input.objective,
    preguntas_de_cobertura: input.coverageQuestions,
    plan_aprobado: input.plan,
    ideas_disponibles: input.ideas,
    huecos: input.gaps,
    contradicciones: input.contradictions,
    relaciones_del_grafo: relationships,
  }, null, 2);
  return planFromAi(await completeJson<AiPlan>(
    { system, user, temperature: 0.05, maxTokens: 6000 },
    isAiPlan,
    model,
  ));
}

async function aiPlanReport(input: PlanInput, model: ModelRef | null, approach?: AcademicApproachContext): Promise<DeepResearchPlan> {
  const countRule =
    input.sectionMode === 'user'
      ? `El usuario prefiere una arquitectura de ${input.sectionCount} secciones amplias. Es una preferencia organizativa, nunca un límite de contenido ni una obligación de rellenar.`
      : `La evidencia recuperada sugiere ${input.sectionCount} movimientos argumentales amplios. Usa únicamente los cortes que correspondan a funciones intelectuales distintas.`;
  const system = [
    'Eres el planificador del modo Deep Research de Nodus.',
    'Diseñas el esqueleto de un informe académico riguroso y bien referenciado a partir de un grafo local de ideas, obras, huecos y contradicciones.',
    'PRINCIPIO CLAVE: cada sección debe agrupar ideas que formen un mismo movimiento argumental. No midas el informe por longitud ni crees una sección para rellenar o para cada idea aislada.',
    'Decide primero una tesis interpretativa defendible y construye cada sección como un paso necesario para demostrarla. El esquema no es un inventario de asuntos ni una respuesta fragmentada a subpreguntas.',
    'Las `preguntas_de_cobertura_obligatoria` son un contrato de alcance: todas deben tener una sección primaria capaz de responderlas con mecanismos concretos. No las conviertas en una lista de secciones ni sacrifiques por ellas la progresión argumental guiada por las ideas.',
    'Copia cada pregunta de cobertura literalmente en `coverageQuestions` de UNA sola sección. El título, propósito y al menos una keyClaim de esa sección deben nombrar el mecanismo concreto que permitirá responderla.',
    'No dediques una sección a un eje secundario mientras una institución, proceso, circuito, periodo o debate pedido explícitamente carezca de desarrollo propio. Los asuntos secundarios pueden entrar dentro de la sección cuya explicación causal profundicen.',
    'El objetivo del usuario puede formular una hipótesis fuerte. No la adoptes como hecho. Si pregunta «en qué medida», por intencionalidad, causalidad, eficacia o carácter deliberado, convierte esa hipótesis en un problema a contrastar y formula criterios para distinguir intención declarada, función política, efecto observado y consecuencia no prevista.',
    'Cuando el corpus sea desigual, reserva espacio dentro de la arquitectura para diferencias regionales, escalas locales, evidencia contraria y límites documentales. No generalices un estudio de caso a todo el territorio.',
    'Cada título debe formular una proposición o hallazgo argumental amplio, no una etiqueta temática. Evita títulos nominales genéricos, dos puntos, punto y coma o guion largo.',
    countRule,
    'El informe será tan extenso como exijan las proposiciones relevantes sostenidas por el corpus. Incluye cada aportación sustantiva una sola vez y detente cuando la evidencia restante no añada información, contraste, conexión o cautela nueva.',
    'Agrupa las ideas por afinidad temática o argumental: cada sección reúne un CONJUNTO de ideas relacionadas, no una sola. Reparte TODAS las ideas relevantes entre las secciones. Asigna huecos y contradicciones donde aporten tensión.',
    // Order is planned, not left to the order the sections happen to be emitted in.
    'ORDEN DEL ARGUMENTO: el informe debe leerse como un razonamiento que progresa, no como una lista de temas. Marca `role` con "intro" para el planteamiento, "body" para el desarrollo y "synthesis" para el cierre, y usa `dependsOn` para declarar de qué secciones previas depende cada una porque dan por establecido algo que necesita.',
    'Ordena de modo que ninguna sección presuponga algo que solo se establece más adelante. Si el material tiene una dimensión histórica, respétala: lo que explica el origen va antes que lo que explica su consecuencia.',
    'Reparte las obras entre secciones: evita que una sección dependa casi entera de una sola obra o de un solo autor cuando el corpus ofrece alternativas.',
    'Usa las relaciones explícitas del grafo para decidir continuidad, oposición, dependencia conceptual y cambios de escala. Las ideas y sus relaciones determinan qué sostiene el informe.',
    'La síntesis final integra solo resultados ya demostrados. No le asignes un tema nuevo ni la conviertas en una segunda introducción.',
    'Toda exclusión del objetivo es vinculante: no asignes a ninguna sección ideas, obras, ejemplos o pasajes de ese eje.',
    'En esta fase no recibes fichas documentales ni pasajes. No reserves secciones para lo que imaginas que podrían contener. La evidencia documental se buscará después para reforzar este argumento ya fijado.',
    ...(approach?.rules.planner ?? []),
    'Usa EXCLUSIVAMENTE los identificadores que se te dan. No inventes ideas, obras ni ids.',
    'Devuelve SOLO JSON válido con la forma:',
    '{"title":"...","abstract":"...","sections":[{"id":"s1","role":"intro|body|synthesis","dependsOn":["s2"],"title":"...","purpose":"...","keyClaims":["..."],"ideaIds":["..."],"workIds":["..."],"gapIds":["..."],"contradictionIds":["..."],"passageIds":[],"coverageQuestions":["pregunta literal"]}]}',
  ].join('\n');
  const user = JSON.stringify(
    {
      objetivo: input.objective,
      idioma: input.language,
      audiencia: input.audience ?? null,
      secciones_objetivo: input.sectionCount,
      arquitectura_sugerida: input.sectionMode === 'user' ? 'preferencia_organizativa_del_usuario' : 'derivada_de_la_evidencia',
      preguntas_de_cobertura_obligatoria: input.coverageQuestions,
      ideas: input.ideas,
      temas: input.themes,
      huecos: input.gaps,
      contradicciones: input.contradictions,
      obras: input.works,
      relaciones_del_grafo: approach?.relationships?.length ? approach.relationships : (input.relationships ?? []),
      ...(approach ? {
        enfoque_de_investigacion: approach.approach,
        plan_de_recuperacion: approach.retrieval,
      } : {}),
    },
    null,
    2
  );
  const ai = await completeJson<AiPlan>({ system, user, temperature: 0.2, maxTokens: 6000 }, isAiPlan, model);
  const draft = planFromAi(ai);
  let candidate = draft;
  try {
    const reviewSystem = [
      'Eres el director de investigación que somete un esquema académico a una segunda revisión antes de autorizar la búsqueda documental.',
      'Trabajas SOLO con el objetivo, las ideas y las relaciones del grafo. No inventes evidencia, hechos, actores, periodos ni intenciones.',
      'Reescribe el plan completo para que sostenga una tesis interpretativa prudente, específica y demostrable. Mantén el mismo número de secciones y su orden general, pero puedes corregir títulos, propósitos, afirmaciones y asignaciones.',
      'Comprueba si el plan ha convertido la hipótesis del encargo en una conclusión anticipada. En preguntas sobre intencionalidad o causalidad, exige criterios probatorios y separa decisión explícita, funcionalidad para actores, efecto material y resultado no previsto.',
      'El hambre, la escasez, la ineficacia o la precariedad no pueden llamarse «herramienta deliberada» solo porque reforzaran el control. Formula esa relación como funcionalidad, selección distributiva o hipótesis mientras no exista evidencia directa de intención.',
      'Haz visibles las escalas y los límites de generalización. Un caso local puede revelar un mecanismo sin demostrar su homogeneidad nacional.',
      'Cada título debe formular una proposición histórica concreta. Sustituye etiquetas abstractas como «arquitectura», «simulacro», «identidad» o «visibilidad» cuando no nombren también el mecanismo material o institucional que la sección demostrará.',
      'Penaliza y corrige cualquier afirmación de éxito, fracaso, control total, causalidad, intención deliberada o eficacia política que el grafo no permita sostener. Cuando exista debate o evidencia ambivalente, la tesis debe conservar esa incertidumbre y explicar de qué dependió el resultado.',
      'Comprueba la progresión. Una sección debe establecer antecedentes o condiciones, la siguiente mecanismos, otra circulación o transformación y la síntesis debe evaluar alcance y límites. No impongas esa secuencia si el material exige otra, pero evita cinco compartimentos temáticos intercambiables.',
      'Da prioridad a los mecanismos explícitamente pedidos por el objetivo. No los sustituyas por teoría general y no reintroduzcas ejes que el usuario haya excluido.',
      'Cada pregunta de cobertura debe permanecer copiada literalmente en una sola sección. Si una sección se dedica a un asunto secundario mientras falta un mecanismo obligatorio, integra el asunto secundario en otra sección y dedica esa responsabilidad al mecanismo omitido.',
      'Cada keyClaim debe poder justificarse con al menos una de las ideas asignadas. Elimina una afirmación si ninguna idea la sostiene; no la suavices solo retóricamente.',
      'Usa exclusivamente los ids recibidos. `passageIds` debe permanecer vacío porque la evidencia documental aún no ha entrado.',
      ...(approach?.rules.planner ?? []),
      'Devuelve SOLO JSON válido con la misma forma del plan candidato.',
    ].join('\n');
    const reviewUser = JSON.stringify({
      objetivo: input.objective,
      audiencia: input.audience ?? null,
      objetivo_con_exclusiones_vinculantes: input.objective,
      preguntas_de_cobertura_obligatoria: input.coverageQuestions,
      ideas: input.ideas.slice(0, 70),
      huecos: input.gaps.slice(0, 16),
      contradicciones: input.contradictions.slice(0, 16),
      relaciones_del_grafo: approach?.relationships?.length ? approach.relationships : (input.relationships ?? []),
      plan_candidato: draft,
    }, null, 2);
    const reviewed = await completeJson<AiPlan>(
      { system: reviewSystem, user: reviewUser, temperature: 0.08, maxTokens: 6000 },
      isAiPlan,
      model,
    );
    const refined = planFromAi(reviewed);
    candidate = refined.sections.length === draft.sections.length ? refined : draft;
  } catch {
    candidate = draft;
  }

  // A director can still be persuaded by the vocabulary of the user's hypothesis.
  // Run a separate adversarial pass whose only job is to bound propositions by the
  // graph evidence already assigned to each section. Documentary retrieval remains
  // later, so this pass must turn unsupported conclusions into questions rather than
  // imagining the proof that a future document might contain.
  try {
    const redTeamSystem = [
      'Eres un revisor epistemológico adversarial. Auditas un plan académico antes de que se consulte ningún documento completo.',
      'El objetivo del usuario es una pregunta, no una fuente. Las frases del grafo son proposiciones sintéticas, no citas literales ni prueba automática de intención, causalidad, eficacia, homogeneidad o recepción.',
      'Conserva EXACTAMENTE el número, ids, orden, roles, dependsOn y todas las asignaciones de ideaIds, workIds, gapIds, contradictionIds y passageIds del plan candidato.',
      'Solo puedes reescribir el título global, el abstract y, dentro de cada sección, title, purpose y keyClaims.',
      'Cada keyClaim debe quedar estrictamente acotada por al menos una proposición asignada a su sección. Si la evidencia asignada no prueba la formulación, conviértela en una pregunta explícita, una hipótesis a contrastar o una afirmación atribuida y limitada; nunca imagines evidencia futura.',
      'Distingue siempre intención declarada, diseño institucional, función posible, efecto observado, recepción y consecuencia no prevista. Que una práctica beneficiara a un actor no demuestra que fuera deliberada; que orientara una representación no demuestra que controlara la recepción.',
      'Sustituye absolutos como demostrar, garantizar, monopolizar, predeterminar, neutralizar, excluir sistemáticamente, deliberadamente, control total, eficacia indiscutible o causa principal salvo que una proposición asignada sostenga literalmente esa intensidad y escala.',
      'No generalices un caso local o regional al conjunto nacional. Haz explícitos periodo, escala y límites cuando la proposición asignada los contenga.',
      'Toda exclusión del objetivo es vinculante. No añadas conceptos, marcos, actores o ejes ausentes del plan candidato y de sus proposiciones asignadas.',
      'El título y el abstract también deben respetar estas reglas: presentan el problema y la arquitectura argumental, no anuncian como probada una conclusión todavía no auditada documentalmente.',
      ...(approach?.rules.planner ?? []),
      'Devuelve SOLO JSON válido con la misma forma del plan candidato.',
    ].join('\n');
    const ideaById = new Map(input.ideas.map((item) => [item.id, item]));
    const gapById = new Map(input.gaps.map((item) => [item.id, item]));
    const contradictionById = new Map(input.contradictions.map((item) => [item.id, item]));
    const redTeamUser = JSON.stringify({
      objetivo_con_exclusiones_vinculantes: input.objective,
      preguntas_de_cobertura_obligatoria: input.coverageQuestions,
      plan_candidato: candidate,
      evidencia_asignada_por_seccion: candidate.sections.map((section) => ({
        sectionId: section.id,
        ideas: section.ideaIds.map((id) => ideaById.get(id)).filter(Boolean),
        huecos: section.gapIds.map((id) => gapById.get(id)).filter(Boolean),
        contradicciones: section.contradictionIds.map((id) => contradictionById.get(id)).filter(Boolean),
      })),
    }, null, 2);
    const redTeamed = planFromAi(await completeJson<AiPlan>(
      { system: redTeamSystem, user: redTeamUser, temperature: 0, maxTokens: 6000 },
      isAiPlan,
      model,
    ));
    if (redTeamed.sections.length !== candidate.sections.length) return candidate;
    // Assignments are a deterministic trust boundary even if the reviewer ignored
    // the preservation instruction. Only its epistemic wording is accepted.
    return {
      title: redTeamed.title,
      abstract: redTeamed.abstract,
      sections: candidate.sections.map((section, index) => ({
        ...section,
        title: redTeamed.sections[index]?.title || section.title,
        purpose: redTeamed.sections[index]?.purpose || section.purpose,
        keyClaims: redTeamed.sections[index]?.keyClaims?.length
          ? redTeamed.sections[index].keyClaims
          : section.keyClaims,
      })),
    };
  } catch {
    return candidate;
  }
}

function planFromAi(ai: AiPlan): DeepResearchPlan {
  return {
    title: ai.title ?? '',
    abstract: ai.abstract ?? '',
    sections: (ai.sections ?? []).map((s, i) => ({
      id: s.id ?? `s${i + 1}`,
      title: s.title ?? `Sección ${i + 1}`,
      purpose: s.purpose ?? '',
      keyClaims: Array.isArray(s.keyClaims) ? s.keyClaims : [],
      ideaIds: Array.isArray(s.ideaIds) ? s.ideaIds : [],
      workIds: Array.isArray(s.workIds) ? s.workIds : [],
      gapIds: Array.isArray(s.gapIds) ? s.gapIds : [],
      contradictionIds: Array.isArray(s.contradictionIds) ? s.contradictionIds : [],
      passageIds: Array.isArray(s.passageIds) ? s.passageIds : [],
      coverageQuestions: Array.isArray(s.coverageQuestions) ? s.coverageQuestions : [],
      role: s.role,
      dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn : [],
    })),
  };
}

interface AiSectionEvidencePlan {
  tesis?: string;
  vinculos_objetivo?: string[];
  exclusiones?: string[];
  parrafos?: Array<{
    funcion?: string;
    rol_probatorio?: string;
    afirmacion?: string;
    evidencias?: string[];
    relacion?: string;
    lados_relacion?: Array<{ etiqueta?: string; afirmacion?: string; evidencias?: string[] }>;
    cautela?: string;
    transicion?: string;
  }>;
}

interface AiSectionClaimAudit {
  claims?: Array<{
    i?: number;
    status?: string;
    reformulacion?: string;
    evidencias?: Array<{
      token?: string;
      rol?: string;
      motivo?: string;
    }>;
    requisitos?: Array<{
      texto?: string;
      rol?: string;
      probado?: boolean;
      evidencias?: string[];
    }>;
    motivo?: string;
  }>;
}

function isAiSectionClaimAudit(value: unknown): value is AiSectionClaimAudit {
  return typeof value === 'object' && value !== null && Array.isArray((value as AiSectionClaimAudit).claims);
}

/**
 * Claims leave planning as propositions, not facts. Only after section-specific
 * retrieval (including literal passages from whole-document indexing) does this
 * audit decide what the available evidence can actually sustain.
 */
async function aiAuditSectionClaims(
  input: SectionInput,
  model: ModelRef | null,
  approach?: AcademicApproachContext,
): Promise<SectionClaimAudit> {
  const targets = [...input.section.keyClaims, ...(input.section.coverageQuestions ?? [])];
  const system = [
    'Eres el auditor epistemológico previo a la redacción de una sección académica. No redactas prosa.',
    'Las proposiciones del plan son HIPÓTESIS de trabajo, no hechos. Contrasta cada una por separado con el contenido real del menú de evidencias.',
    'Las preguntas de cobertura aparecen en la misma lista. Para cada una, la `reformulacion` debe ser la respuesta proposicional más completa que el menú permita. Si no permite responderla, clasifícala como `unsupported` y consérvala expresamente como cuestión abierta.',
    'Descompón cada objetivo en requisitos atómicos explícitos. Por ejemplo, «distribución gratuita a autores y editoriales extranjeras» exige probar por separado la gratuidad, los destinatarios y su condición extranjera. No confundas un mecanismo con su destinatario, circulación internacional con entrega internacional, ni contexto temático con prueba directa.',
    'Asigna a cada requisito un `rol`: fact, actor_time, mechanism, causality, comparison_side, agreement, contradiction, effect, reception, limit o method. El rol expresa qué relación debe demostrar la evidencia, no su tema.',
    'Un marco teórico, una idea normalizada o una coincidencia léxica puede ser `context`, pero no prueba por sí solo un actor, una fecha, un mecanismo histórico, una causalidad, una recepción o un efecto. Para esos roles exige que el note afirme esa relación específica; prioriza un passage literal cuando exista.',
    'Para agreement o contradiction identifica por separado los dos lados y exige evidencia direct para cada uno. Dos citas que comparten vocabulario no prueban consenso, y una fuente que describe solo un lado no prueba una contradicción bilateral.',
    'Marca `supported` únicamente si TODOS los requisitos atómicos están probados. Si falta uno, usa `partial` con una reformulación que suprima exactamente la parte no demostrada. Si no se prueba ninguno, usa `unsupported`.',
    'Clasifica `supported` solo cuando una o varias entradas sostienen la proposición completa y su grado de causalidad, intención, escala, cronología y eficacia.',
    'Clasifica `partial` cuando existe base para una formulación más estrecha, atribuida o provisional. Reformúlala exactamente con ese alcance menor.',
    'Toda `reformulacion` debe ser una proposición académica autónoma y publicable en un esquema. No escribas muletillas metadiscursivas como «la evidencia disponible permite sostener solo parcialmente», «esta proposición» o «según el menú»; expresa directamente el límite mediante atribución, posibilidad, escala o condición.',
    'Clasifica `unsupported` cuando el menú no permite sostenerla. En ese caso la reformulación debe declarar explícitamente que el corpus no permite establecerla o convertirla en una pregunta abierta. Nunca la conserves como conclusión.',
    'Una idea sintética no prueba por sí sola intención deliberada, eficacia real, monopolio, control total, inevitabilidad ni causalidad. Para esos términos exige contenido explícito; de lo contrario distingue intento, orientación, función, efecto observado y recepción.',
    'No sumes fragmentos incompatibles para fabricar una proposición más fuerte. Un estudio local no demuestra una política nacional homogénea.',
    'Construye un paquete pequeño por objetivo. Clasifica como máximo tres enlaces `direct` que prueben la respuesta y dos `context` que solo la delimiten. Marca como `irrelevant` cualquier candidato tentador que no responda. El contexto nunca convierte por sí solo una respuesta en supported.',
    'Para una pregunta de cobertura usa únicamente candidatos de su `paquete_atomico` cuando exista. No tomes un pasaje recuperado para otra pregunta salvo que también figure en el paquete de esta. Una misma fuente puede estar en varios paquetes, pero debe evaluarse de nuevo respecto a cada pregunta.',
    'Comprueba por separado correspondencia temática, periodo, geografía, tipo de fuente y mecanismo solicitado. Una coincidencia en un solo eje es contexto o irrelevante, no evidencia directa. Señala como irrelevante material de otro dominio aunque comparta palabras como movilidad, representación, control o circulación.',
    'Copia únicamente enlaces exactos del menú en cada evidencia y en cada requisito. Para `supported` y `partial` incluye al menos una evidencia direct; para `unsupported` puede no haber ninguna.',
    'Mantén exactamente el mismo número y orden de proposiciones. Usa su índice `i` empezando en 0.',
    ...(approach?.rules.writer ?? []),
    'Devuelve SOLO JSON válido: {"claims":[{"i":0,"status":"supported|partial|unsupported","reformulacion":"...","requisitos":[{"texto":"...","rol":"fact|actor_time|mechanism|causality|comparison_side|agreement|contradiction|effect|reception|limit|method","probado":true,"evidencias":["enlace exacto"]}],"evidencias":[{"token":"enlace exacto","rol":"direct|context|irrelevant","motivo":"..."}],"motivo":"..."}]}.',
  ].join('\n');
  const user = JSON.stringify({
    objetivo: input.objective,
    seccion: {
      titulo: input.section.title,
      proposito: input.section.purpose,
      objetivos_a_contrastar_en_este_orden: targets.map((text, index) => ({
        i: index,
        tipo: index < input.section.keyClaims.length ? 'proposicion_del_plan' : 'pregunta_de_cobertura',
        text,
      })),
    },
    menu_de_evidencias: input.citationMenu,
    paquetes_atomicos: input.atomicEvidencePacks ?? [],
  }, null, 2);
  const ai = await completeJson<AiSectionClaimAudit>(
    { system, user, temperature: 0, maxTokens: 5200 },
    isAiSectionClaimAudit,
    model,
  );
  const allowed = new Set(input.citationMenu.map((item) => item.token));
  const packAllowed = new Map((input.atomicEvidencePacks ?? []).map((pack) => [
    pack.question,
    new Set(pack.candidates.map((candidate) => candidate.token)),
  ]));
  const byIndex = new Map((ai.claims ?? []).map((item) => [Number(item.i), item]));
  return {
    items: targets.map((original, index) => {
      const item = byIndex.get(index);
      const coverageQuestion = input.section.coverageQuestions?.[index - input.section.keyClaims.length];
      const scopedAllowed = coverageQuestion && (packAllowed.get(coverageQuestion)?.size ?? 0) > 0
        ? packAllowed.get(coverageQuestion)!
        : allowed;
      const rawStatus = String(item?.status ?? '').toLowerCase();
      const status = rawStatus === 'supported' || rawStatus === 'partial' ? rawStatus : 'unsupported';
      return {
        original,
        status,
        revised: String(item?.reformulacion ?? '').trim(),
        evidenceTokens: (item?.evidencias ?? [])
          .filter((entry) => entry?.rol === 'direct' || entry?.rol === 'context')
          .map((entry) => String(entry?.token ?? ''))
          .filter((token) => scopedAllowed.has(token)),
        reason: String(item?.motivo ?? '').trim(),
        evidencePack: (item?.evidencias ?? []).map((entry) => ({
          token: String(entry?.token ?? ''),
          role: (entry?.rol === 'direct' || entry?.rol === 'context' ? entry.rol : 'irrelevant') as 'direct' | 'context' | 'irrelevant',
          reason: String(entry?.motivo ?? '').trim(),
        })).filter((entry) => scopedAllowed.has(entry.token)),
        requirements: (item?.requisitos ?? []).map((requirement) => ({
          text: String(requirement?.texto ?? '').trim(),
          proofRole: parseProofRole(requirement?.rol),
          supported: requirement?.probado === true,
          evidenceTokens: (requirement?.evidencias ?? []).filter((token): token is string =>
            typeof token === 'string' && scopedAllowed.has(token)),
        })).filter((requirement) => requirement.text.length > 0),
      };
    }),
  };
}

function isAiSectionEvidencePlan(value: unknown): value is AiSectionEvidencePlan {
  return typeof value === 'object' && value !== null && Array.isArray((value as AiSectionEvidencePlan).parrafos);
}

/**
 * Plan claims against exact evidence before writing prose. A lightweight model is
 * much more reliable when it first has to state which source supports which claim:
 * the subsequent writer follows an explicit argument instead of attaching citations
 * after it has already improvised the paragraph.
 */
async function aiPlanSectionEvidence(
  input: SectionInput,
  model: ModelRef | null,
  approach?: AcademicApproachContext,
): Promise<SectionEvidencePlan> {
  const system = [
    'Eres el arquitecto probatorio de una sección académica. Aún NO redactas prosa: diseñas un plan de afirmaciones que pueda demostrarse con las fuentes disponibles.',
    'Las proposiciones del plan son hipótesis. La auditoría epistemológica fija qué versión está supported, partial o unsupported; ninguna afirmación ni tesis del plan probatorio puede exceder esa reformulación.',
    'Dentro de cada paquete de evidencia prioriza `direct`, usa `context` solo para delimitar y no cites elementos `irrelevant`. Una evidencia contextual nunca completa un requisito atómico ausente.',
    'Lee primero el objetivo completo. Conserva todos sus requisitos y trata cualquier instrucción de excluir, omitir o no abordar un eje como una frontera vinculante, aunque el menú contenga material sobre ese eje.',
    'Diseña exactamente los párrafos que aporten una función inferencial distinta: planteamiento, evidencia, mecanismo, comparación, límite, consecuencia o síntesis. No fijes un número y no repitas una función con otra redacción.',
    'Para cada afirmación selecciona solo enlaces exactos del menú cuyo campo note sostenga TODA la afirmación. Si la fuente solo permite una versión limitada, escribe esa versión limitada en afirmacion y registra la cautela.',
    'No uses adjetivos valorativos o deterministas como total, absoluto, meticuloso, pieza maestra, fracaso, vigilancia rigurosa o inevitable salvo que una fuente los documente expresamente.',
    'Una relación entre dos fuentes debe explicar qué comparten, en qué difieren, qué escalas usan o por qué una limita a la otra. No confundas dos citas acumuladas con síntesis.',
    'Asigna a cada párrafo un `rol_probatorio`. Si el rol es agreement, contradiction o comparison_side, completa `lados_relacion` con cada posición, su afirmación exacta y sus evidencias. No planifiques la relación si uno de los lados carece de evidencia directa.',
    'Para causality, effect o reception, una fuente transversal o metodológica solo puede delimitar la inferencia. El núcleo debe descansar en evidencia que documente específicamente la relación, el efecto o la recepción solicitados.',
    'Cuando exista debate, identifica las posiciones, la evidencia que utiliza cada una, el origen de su divergencia y qué dato permitiría decidir. Si el menú no permite ese desarrollo, declara el límite.',
    'Incluye evidencia textual directa cuando exista un passage pertinente, sin extrapolar más allá de su extracto.',
    'Evita repetir afirmaciones ya desarrolladas en otras secciones. Usa la transición para mostrar por qué este párrafo es el siguiente paso del razonamiento.',
    'Respeta la reserva de responsabilidades: no desarrolles preguntas o argumentos asignados a otras secciones, aunque el menú contenga fuentes sobre ellos.',
    ...(approach?.rules.writer ?? []),
    'Devuelve SOLO JSON válido con esta forma: {"tesis":"...","vinculos_objetivo":["..."],"exclusiones":["..."],"parrafos":[{"funcion":"...","rol_probatorio":"fact|actor_time|mechanism|causality|comparison_side|agreement|contradiction|effect|reception|limit|method","afirmacion":"...","evidencias":["enlace exacto del menú"],"relacion":"...","lados_relacion":[{"etiqueta":"A","afirmacion":"...","evidencias":["enlace exacto"]}],"cautela":"...","transicion":"..."}]}.',
  ].join('\n');
  const user = JSON.stringify({
    objetivo: input.objective,
    seccion: {
      titulo: input.section.title,
      proposito: input.section.purpose,
      proposiciones_a_contrastar: sectionClaimsForWriting(input.section),
      preguntas_de_cobertura: input.section.coverageQuestions ?? [],
    },
    menu_de_citas: input.citationMenu,
    recorrido_previo: input.priorSummary || '(primera sección)',
    afirmaciones_ya_desarrolladas: input.alreadyDeveloped,
    responsabilidades_reservadas_a_otras_secciones: input.reservedForOtherSections ?? [],
    auditoria_epistemologica: input.claimAudit ?? null,
  }, null, 2);
  const ai = await completeJson<AiSectionEvidencePlan>(
    { system, user, temperature: 0, maxTokens: 4500 },
    isAiSectionEvidencePlan,
    model,
  );
  const allowed = new Set(input.citationMenu.map((item) => item.token));
  const auditedDirect = new Set((input.claimAudit?.items ?? []).flatMap((claim) =>
    (claim.evidencePack ?? []).filter((entry) => entry.role === 'direct').map((entry) => entry.token)));
  const paragraphs = (ai.parrafos ?? []).map((item) => {
    const proofRole = parseProofRole(item.rol_probatorio);
    const relationshipSides = (item.lados_relacion ?? []).map((side) => ({
      label: String(side.etiqueta ?? '').trim(),
      claim: String(side.afirmacion ?? '').trim(),
      evidenceTokens: (side.evidencias ?? []).filter((token): token is string =>
        typeof token === 'string'
        && allowed.has(token)
        && (auditedDirect.size === 0 || auditedDirect.has(token))),
    })).filter((side) => side.label && side.claim && side.evidenceTokens.length > 0).slice(0, 4);
    const evidenceTokens = [...new Set([
      ...(item.evidencias ?? []).filter((token): token is string => typeof token === 'string' && allowed.has(token)),
      ...relationshipSides.flatMap((side) => side.evidenceTokens),
    ])].slice(0, 5);
    return {
      function: String(item.funcion ?? '').trim(),
      proofRole,
      claim: String(item.afirmacion ?? '').trim(),
      evidenceTokens,
      relationship: String(item.relacion ?? '').trim(),
      relationshipSides,
      caveat: String(item.cautela ?? '').trim(),
      transition: String(item.transicion ?? '').trim(),
    };
  }).filter((item) => item.claim && item.evidenceTokens.length > 0);
  if (paragraphs.length < 1) throw new Error('El plan probatorio no contiene ninguna unidad verificable.');
  if (paragraphs.some((paragraph) =>
    (paragraph.proofRole === 'agreement' || paragraph.proofRole === 'contradiction')
    && (paragraph.relationshipSides?.length ?? 0) < 2)) {
    throw new Error('El plan probatorio propone una relación bilateral sin evidenciar ambos lados.');
  }
  return {
    thesis: String(ai.tesis ?? '').trim(),
    objectiveLinks: (ai.vinculos_objetivo ?? []).filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 8),
    exclusions: (ai.exclusiones ?? []).filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 8),
    paragraphs,
  };
}

async function aiWriteSection(input: SectionInput, model: ModelRef | null, approach?: AcademicApproachContext): Promise<string> {
  if ((input.evidencePlan?.paragraphs.length ?? 0) >= 1) {
    try {
      return await aiWriteSectionParagraphByParagraph(input, model, approach);
    } catch {
      /* one bounded monolithic fallback keeps provider hiccups non-fatal */
    }
  }
  const system = [
    'Eres el redactor del modo Deep Research de Nodus: escribes UNA sección de un informe académico de nivel profesional.',
    'Las `proposiciones_a_contrastar` son hipótesis del plan, no conclusiones. La `auditoria_epistemologica` posterior a la recuperación es vinculante: usa solo su reformulación y conserva como cuestión abierta todo elemento `unsupported`.',
    'Respeta los paquetes de la auditoría: apoya el núcleo de cada respuesta en evidencias `direct`, usa `context` solo para precisar alcance y omite `irrelevant`. No reconstruyas una conjunción que el checklist de requisitos dejó incompleta.',
    'Respeta el `rol` de cada requisito y el `rol_probatorio` de cada párrafo. No conviertas fact en mechanism, asociación en causality, intención en effect ni descripción de audiencia en reception.',
    'Un acuerdo, divergencia o contradicción solo puede afirmarse cuando el plan identifica los lados y aporta evidencia para cada uno. Si falta un lado, presenta una posición y declara el hueco, nunca un consenso o debate fabricado.',
    'Escribe en español salvo que el idioma indicado pida otra lengua.',
    'Usa SOLO los materiales y las citas del menú proporcionado. No inventes obras, autores, datos ni páginas.',
    'El plan probatorio se preparó antes de redactar. Síguelo como arquitectura vinculante: cada párrafo debe desarrollar la afirmación limitada, la evidencia, la cautela y la transición previstas. Si un punto del plan contradice el note de su fuente, prevalece el note y debes omitir o estrechar el punto.',
    'Respeta literalmente las exclusiones del objetivo y del plan probatorio. No introduzcas esos ejes ni siquiera como ejemplo secundario.',
    'Cada afirmación sustantiva debe ir respaldada por una cita del menú, colocada ENTRE PARÉNTESIS y en formato enlace Markdown nodus:// exactamente como aparece en el menú.',
    // Every menu entry now carries its real content, so the writer can be held to it.
    'Cada entrada del menú incluye el contenido real de lo que cita en el campo "note". Apóyate en ese contenido: no cites nada cuyo "note" no sostenga lo que afirmas.',
    'Los pasajes ("kind":"passage") traen el texto literal de la obra entre comillas angulares. Úsalos como evidencia textual, parafrasea o cita con precisión y no extiendas su sentido más allá de lo que dicen.',
    'Los huecos ("kind":"gap") y las contradicciones ("kind":"contradiction") traen en "note" lo que realmente afirman. Arguméntalos por su contenido, no los menciones de pasada como etiquetas.',
    'Cuando el menú traiga una contradicción, conviértela en un debate explícito: nombra las dos posturas y, si el campo "source" dice quién las sostiene, atribúyelas a esos autores. Un desacuerdo entre investigadores es más informativo que una afirmación unánime.',
    'RIQUEZA DE FUENTES: no sostengas una sección con una sola obra ni con un solo autor. Alterna entre las fuentes del menú y, cuando varias sostengan lo mismo, dilo explícitamente porque la convergencia entre autores independientes es un argumento en sí. Si una afirmación descansa en una única fuente, deja constancia de ello en la prosa.',
    'SÍNTESIS: siempre que dos fuentes permitan una comparación real, explica si convergen, divergen, operan en escalas distintas o imponen límites diferentes. No basta con colocar dos enlaces juntos.',
    'Cuando cites un hueco, no te limites a constatar que falta investigación: explica qué impide concluir y qué haría falta para cerrarlo.',
    'EXTENSIÓN GUIADA POR EVIDENCIA: incluye toda proposición relevante y respaldada que añada una idea, conexión, contraste, matiz o límite nuevo. Detente cuando el valor marginal sea cero. No alargues, resumas de nuevo ni reformules una conclusión ya establecida.',
    'ARQUITECTURA DEL DESARROLLO: cada párrafo debe añadir un paso distinto —planteamiento, evidencia, mecanismo, contraste, límite o consecuencia— y no repetir la tesis como apertura y cierre de varios bloques.',
    'Desarrolla la sección con profundidad real: no te limites a enunciar cada idea; contrástalas, encadénalas y construye un argumento continuo que atraviese todas las ideas asignadas.',
    'Relaciona las ideas entre sí: continuidad, diferencias, niveles de abstracción, consecuencias metodológicas, tensiones y huecos.',
    'No repitas lo ya dicho en secciones anteriores. Se te dan el recorrido de cada sección previa y la lista de afirmaciones ya desarrolladas: puedes apoyarte en ellas y remitir a ellas, pero el desarrollo de esta sección debe ser nuevo.',
    'No desarrolles las responsabilidades reservadas a otras secciones. Una referencia breve para enlazar el argumento es admisible; repetir su demostración no lo es.',
    'PRECISIÓN HISTORIOGRÁFICA: atribuye a cada autor su interpretación concreta, separa la evidencia documental de tu inferencia y formula de modo provisional lo que el corpus no permite probar. Cuando haya debate, explica las posiciones, su base empírica, el origen de la divergencia y qué evidencia faltaría para resolverla.',
    'INTEGRACIÓN DE CITAS: coloca cada enlace junto a la cláusula exacta que respalda. Evita cadenas de autores al final del párrafo y no uses una fuente como aval decorativo de varias afirmaciones heterogéneas.',
    'TONO Y CERTEZA: elimina la retórica enfática. No llames a un proceso total, absoluto, meticuloso, pieza maestra, fracaso, simulacro, vigilancia rigurosa o inevitable salvo que la evidencia citada permita exactamente esa calificación. Distingue de forma visible dato documentado, interpretación del autor, inferencia de este informe y cuestión no resuelta.',
    ...(approach?.rules.writer ?? []),
    ...DEEP_RESEARCH_NARRATIVE_RULES,
    input.isConclusion
      ? 'Esta es la sección de cierre: integra las líneas del informe, nombra los huecos y perfila la contribución.'
      : 'Desarrolla la línea argumental de esta sección con profundidad.',
    'Empieza la sección con un encabezado Markdown "## " y el título dado. Devuelve solo el Markdown de la sección, sin JSON ni vallas de código.',
  ].join('\n');
  const user = JSON.stringify(
    {
      objetivo: input.objective,
      idioma: input.language,
      seccion: { titulo: input.section.title, proposito: input.section.purpose, proposiciones_a_contrastar: sectionClaimsForWriting(input.section), preguntas_de_cobertura: input.section.coverageQuestions ?? [] },
      menu_de_citas: input.citationMenu,
      recorrido_secciones_previas: input.priorSummary || '(esta es la primera sección)',
      afirmaciones_ya_desarrolladas: input.alreadyDeveloped,
      responsabilidades_reservadas_a_otras_secciones: input.reservedForOtherSections ?? [],
      plan_probatorio: input.evidencePlan ?? null,
      auditoria_epistemologica: input.claimAudit ?? null,
      ...(approach ? {
        enfoque_de_investigacion: approach.approach,
        comparandos: approach.retrieval.comparands,
        ejes: approach.retrieval.axes,
        fases: approach.retrieval.phases,
        relaciones_del_grafo: approach.relationships.slice(0, 40),
      } : {}),
    },
    null,
    2
  );
  return completeText({ system, user, temperature: 0.3, maxTokens: 5200 }, model);
}

async function aiWriteSectionParagraphByParagraph(
  input: SectionInput,
  model: ModelRef | null,
  approach?: AcademicApproachContext,
): Promise<string> {
  const plan = input.evidencePlan!;
  const menuByToken = new Map(input.citationMenu.map((item) => [item.token, item]));
  const written: string[] = [];
  for (let index = 0; index < plan.paragraphs.length; index += 1) {
    const paragraph = plan.paragraphs[index];
    const evidence = paragraph.evidenceTokens
      .map((token) => menuByToken.get(token))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    if (!evidence.length) continue;
    const system = [
      'Redactas UN SOLO párrafo de una sección académica de Deep Research. No escribas título, lista, resumen ni más de un párrafo.',
      'Extiende el párrafo solo hasta completar su función probatoria. No añadas frases que no aporten una proposición, relación, cautela o transición necesaria.',
      'Cumple exactamente la función, afirmación limitada, relación entre fuentes, cautela y transición indicadas. No introduzcas otro asunto.',
      'El rol probatorio es vinculante. No amplíes un fact a mechanism, una asociación a causality, una intención a effect ni una audiencia prevista a reception.',
      'Si `lados_relacion` está vacío o solo contiene un lado, no declares acuerdo, divergencia, contradicción ni comparación bilateral. Describe únicamente la posición demostrada y el límite.',
      'Usa exclusivamente los enlaces del minimenú y cópialos literalmente. Cada cita debe seguir inmediatamente a la cláusula que sostiene; el note debe respaldar toda esa cláusula.',
      'Integra las fuentes en la sintaxis: atribuye interpretaciones a sus autores y reserva la voz del informe para inferencias expresamente señaladas. No acumules nombres o enlaces al final.',
      'Explica el mecanismo o la divergencia, no enumeres hallazgos. Si dos fuentes no permiten una comparación real, no finjas que convergen.',
      'Formula con sobriedad. Evita superlativos, metáforas enfáticas, intenciones no documentadas y relaciones causales que las fuentes solo sugieren.',
      'Respeta todas las exclusiones. No menciones el eje excluido ni siquiera para aclarar que queda fuera.',
      'Conecta con el párrafo anterior sin repetirlo. Usa la transición como relación conceptual, no como una frase de hoja de ruta.',
      'PROHIBIDO el metadiscurso mecánico: no escribas «una vez establecido», «resulta necesario examinar», «procede analizar», «este informe abordará», «deja preparada la comprensión» ni cierres cada párrafo anunciando el siguiente.',
      'No cierres con «en conclusión» salvo que sea el último párrafo de la sección. No repitas autor y año fuera del enlace si el mismo enlace ya los muestra.',
      'No desarrolles ninguna responsabilidad reservada a otra sección y no vuelvas a demostrar un mecanismo que el recorrido previo ya da por establecido.',
      ...(approach?.rules.writer ?? []),
      ...DEEP_RESEARCH_NARRATIVE_RULES,
      'Devuelve solo el párrafo en Markdown, sin encabezado ni vallas de código.',
    ].join('\n');
    const user = JSON.stringify({
      objetivo: input.objective,
      seccion: {
        titulo: input.section.title,
        proposito: input.section.purpose,
        preguntas_de_cobertura: input.section.coverageQuestions ?? [],
        tesis: plan.thesis,
        exclusiones: plan.exclusions,
      },
      numero_de_parrafo: index + 1,
      total_de_parrafos: plan.paragraphs.length,
      plan_del_parrafo: paragraph,
      minimenu_de_evidencias: evidence,
      auditoria_epistemologica: input.claimAudit ?? null,
      recorrido_de_secciones_previas: input.priorSummary,
      responsabilidades_reservadas_a_otras_secciones: input.reservedForOtherSections ?? [],
      cierre_del_parrafo_anterior: written.length ? written[written.length - 1].slice(-900) : '(inicio de la sección)',
    }, null, 2);
    const raw = await completeText({ system, user, temperature: 0.12, maxTokens: 1500 }, model);
    const cleaned = raw
      .replace(/^```(?:markdown)?\s*/iu, '')
      .replace(/\s*```$/u, '')
      .replace(/^#{1,6}\s+[^\n]+\n+/u, '')
      .trim();
    if (!/nodus:\/\//u.test(cleaned) || !/[.!?](?:\s|$)/u.test(cleaned)) throw new Error('Párrafo probatorio incompleto.');
    written.push(cleaned);
  }
  if (written.length < 1) throw new Error('La redacción probatoria no produjo ninguna unidad respaldada.');
  return `## ${input.section.title}\n\n${written.join('\n\n')}`;
}

interface AiFinal {
  title?: string;
  abstract?: string;
  limitations?: string[];
  nextSteps?: string[];
}
function isAiFinal(v: unknown): v is AiFinal {
  return typeof v === 'object' && v !== null;
}

async function aiFinalize(input: FinalizeInput, model: ModelRef | null, approach?: AcademicApproachContext): Promise<FinalizeResult> {
  const system = [
    'Cierras un informe académico de Deep Research de Nodus.',
    'Escribe en español salvo que el idioma pida otra lengua.',
    'Devuelve SOLO JSON válido: {"title":"título académico preciso","abstract":"síntesis proporcional a los hallazgos, sin repetirlos ni añadir tesis nuevas","limitations":["..."],"nextSteps":["..."]}',
    'El resumen debe sintetizar EXCLUSIVAMENTE los hallazgos del cuerpo verificado que recibes. Los títulos y el objetivo no son evidencia y no autorizan a recuperar una hipótesis que el cuerpo dejó abierta.',
    'No atribuyas control, intención, causalidad o eficacia con más certeza que el cuerpo. Si los hallazgos distinguen intento, orientación, recepción o límites, conserva exactamente esa distinción.',
    'Las frases señaladas como preocupaciones de respaldo no pueden reaparecer en el resumen como conclusiones. Incorpora su incertidumbre a las limitaciones cuando sea relevante.',
    'Las limitaciones deben ser honestas e incluir los requisitos que el corpus o el texto verificado no pudieron resolver.',
    'Redacta el título y el resumen como prosa fluida. Evita dos puntos, punto y coma y guion largo salvo necesidad estricta.',
    ...(approach?.rules.finalizer ?? []),
  ].join('\n');
  const user = JSON.stringify(
    {
      objetivo: input.objective,
      idioma: input.language,
      titulo_provisional: input.planTitle,
      secciones: input.sectionTitles,
      ideas_cubiertas: input.ideasCovered,
      ideas_consideradas: input.ideasConsidered,
      ideas_sin_cubrir_ejemplos: input.uncoveredSamples,
      hallazgos_verificados_por_seccion: input.sectionFindings ?? [],
      afirmaciones_con_respaldo_retirado_o_parcial: input.supportConcerns ?? [],
      ...(approach ? { enfoque_de_investigacion: approach.approach, plan_de_recuperacion: approach.retrieval } : {}),
    },
    null,
    2
  );
  const ai = await completeJson<AiFinal>({ system, user, temperature: 0.2, maxTokens: 2000 }, isAiFinal, model);
  return {
    title: ai.title ?? input.planTitle,
    abstract: ai.abstract ?? '',
    limitations: Array.isArray(ai.limitations) ? ai.limitations : [],
    nextSteps: Array.isArray(ai.nextSteps) ? ai.nextSteps : [],
  };
}

/** A second, colder pass prevents a fluent abstract from restoring a hypothesis or
 * causal claim that section verification narrowed or removed. */
async function aiAuditFinalSummary(
  input: FinalizeInput,
  draft: FinalizeResult,
  model: ModelRef | null,
  approach?: AcademicApproachContext,
): Promise<FinalizeResult> {
  const system = [
    'Auditas el título y el resumen de un informe académico ya verificado. No redactas el cuerpo y no añades hallazgos.',
    'Compara CADA afirmación del resumen con los hallazgos verificados por sección. Conserva solo lo que esté sostenido literalmente o por implicación inmediata.',
    'Si el resumen convierte intento en efecto, orientación en recepción, asociación en causalidad, un caso local en regla general o una hipótesis en conclusión, reescríbelo con el alcance menor.',
    'Si el resumen declara consenso, acuerdo, divergencia o contradicción, comprueba que los hallazgos verificados identifican y respaldan ambos lados. Una sola posición no autoriza una relación bilateral.',
    'Toda afirmación que figure entre las preocupaciones de respaldo debe desaparecer como conclusión o reaparecer únicamente como límite explícito.',
    'El título tampoco puede afirmar una eficacia, causalidad o control que el cuerpo no haya establecido.',
    'Conserva todas las limitaciones y próximos pasos recibidos; puedes añadir otra limitación necesaria, nunca borrarlas.',
    'Devuelve SOLO JSON válido: {"title":"...","abstract":"...","limitations":["..."],"nextSteps":["..."]}.',
    ...(approach?.rules.finalizer ?? []),
  ].join('\n');
  const user = JSON.stringify({
    objetivo: input.objective,
    borrador_de_cierre: draft,
    hallazgos_verificados_por_seccion: input.sectionFindings ?? [],
    preocupaciones_de_respaldo: input.supportConcerns ?? [],
  }, null, 2);
  const ai = await completeJson<AiFinal>({ system, user, temperature: 0, maxTokens: 2200 }, isAiFinal, model);
  return {
    title: ai.title ?? draft.title,
    abstract: ai.abstract ?? draft.abstract,
    limitations: Array.isArray(ai.limitations) ? ai.limitations : draft.limitations,
    nextSteps: Array.isArray(ai.nextSteps) ? ai.nextSteps : draft.nextSteps,
  };
}
