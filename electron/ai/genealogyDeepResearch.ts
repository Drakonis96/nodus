// Deep Research for the genealogy vault. The academic Deep Research writes a report
// over the argumentative idea graph; a genealogy vault has no ideas, but it DOES have
// an evidence archive and (optionally) a Zotero library, both indexed with embeddings.
// So this pipeline retrieves the sources relevant to the question by MEANING, pulls
// each assigned source's FULL TEXT dynamically when a section is written, and produces
// a family-history report grounded in — and citing — those documents, following the
// Genealogical Proof Standard (evidence first, never assert an unproven link).
//
// The control flow (retrieve → plan → write sections with dynamic full text → finalize
// → assemble) mirrors the academic orchestrator's shape but over a genealogy source
// pool. The AI + full-text-resolution calls are injected so the loop is unit-tested
// with fakes; the real wiring binds them to the provider + the DB/extractor.

import type {
  DeepResearchMeta,
  DeepResearchProgress,
  DeepResearchReport,
  DeepResearchRequest,
  ModelRef,
  WritingWorkshopBrief,
  WritingWorkshopDraft,
  WritingWorkshopMatrixRow,
  WritingWorkshopSection,
} from '@shared/types';
import type { DeepResearchApproach } from '@shared/deepResearchApproaches';
import { normalizeDeepResearchApproach } from '@shared/deepResearchApproaches';
import {
  assessDeepResearchReport,
  assessDeepResearchSection,
  qualityPasses,
  shouldAcceptQualityRevision,
  type DeepResearchQualitySource,
  type DeepResearchSectionQuality,
} from '@shared/deepResearchQuality';
import {
  assembleContinuousNarrative,
  DEEP_RESEARCH_NARRATIVE_RULES,
  countWords,
  normalizeNarrativeSection,
} from './deepResearchCore';
import { getSettings } from '../db/settingsRepo';
import { listPersons, getPerson, listEvents, listEvidenceFor } from '../db/entitiesRepo';
import { allRelationships } from '../db/relationshipsRepo';
import { allSocialRelations } from '../db/socialRepo';
import { listItems, listItemsForPerson, findArchiveItemsSimilar } from '../db/archiveRepo';
import { findSimilarWorksPaged } from '../db/workSummariesRepo';
import { getWork } from '../db/worksRepo';
import { resolveWorkText } from '../extraction/textExtractor';
import { LOCAL_USER_ID } from '../zotero/zoteroClient';
import { completeJson, completeText, embed } from './aiClient';
import {
  approachRules,
  planApproachRetrieval,
  repairMalformedGenealogyCitations,
  type ApproachRetrievalPlan,
} from './deepResearchApproaches';

// Retrieval + budget bounds. Kept modest so the plan prompt and each section stay
// within model windows; the full text of a section's assigned documents is the heavy
// part and is clipped per document + per section.
const MAX_DOC_SOURCES = 24;
const MAX_WORK_SOURCES = 10;
const DOC_SNIPPET = 300;
const PER_DOC_FULLTEXT = 5000;
const PER_SECTION_FULLTEXT = 22000;
const MAX_PERSONS_CONTEXT = 200;
const MAX_EVENTS_CONTEXT = 200;
/** Observational display conversion only. It never controls retrieval or writing. */
const OBSERVED_PAGE_WORD_RATIO = 450;

// ── Source pool ─────────────────────────────────────────────────────────────

export interface GenSource {
  /** 'doc:<itemId>' or 'work:<nodusId>' — the id the planner assigns to sections. */
  id: string;
  kind: 'document' | 'work';
  refId: string;
  title: string;
  label: string;
  persons: string[];
  snippet: string;
  /** Full text for documents (stored); works resolve it on demand at write time. */
  fullText: string;
}

export interface FamilyFacts {
  personas: { id: string; nombre: string; nacimiento: string | null; defuncion: string | null; padres: string[]; conyuges: string[]; hijos: string[] }[];
  eventos: { tipo: string; fecha: string | null; lugar: string | null; participantes: string[] }[];
  relaciones_sociales: { persona: string; contacto: string; tipo_contacto: string; relacion: string; notas: string | null }[];
}

/** The person a report is being centred on, with their kin and biography. */
export interface FocusPerson {
  id: string;
  nombre: string;
  nacimiento: string | null;
  defuncion: string | null;
  padres: string[];
  conyuges: string[];
  hijos: string[];
  biografia: string | null;
}

/** Build the family-facts block (bounded) shared by the plan and every section. */
export function buildFamilyFacts(): FamilyFacts {
  const persons = listPersons();
  const nameById = new Map(persons.map((p) => [p.personId, p.displayName]));
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  const spouses = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, v?: string) => {
    if (v) (m.get(k) ?? m.set(k, []).get(k)!).push(v);
  };
  for (const r of allRelationships()) {
    if (r.type === 'parent') {
      push(children, r.fromPerson, nameById.get(r.toPerson));
      push(parents, r.toPerson, nameById.get(r.fromPerson));
    } else if (r.type === 'spouse') {
      push(spouses, r.fromPerson, nameById.get(r.toPerson));
      push(spouses, r.toPerson, nameById.get(r.fromPerson));
    }
  }
  return {
    personas: persons.slice(0, MAX_PERSONS_CONTEXT).map((p) => ({
      id: p.personId,
      nombre: p.displayName,
      nacimiento: p.birthDate,
      defuncion: p.deathDate,
      padres: parents.get(p.personId) ?? [],
      conyuges: spouses.get(p.personId) ?? [],
      hijos: children.get(p.personId) ?? [],
    })),
    eventos: listEvents()
      .slice(0, MAX_EVENTS_CONTEXT)
      .map((e) => ({
        tipo: e.type,
        fecha: e.date,
        lugar: e.placeName,
        participantes: e.participants.map((pt) => pt.displayName ?? nameById.get(pt.personId) ?? ''),
      })),
    relaciones_sociales: allSocialRelations().slice(0, 200).map((relation) => ({
      persona: relation.personName,
      contacto: relation.targetName,
      tipo_contacto: relation.targetKind,
      relacion: relation.role,
      notas: relation.notes,
    })),
  };
}

/** The focus person's own entry from the family facts, enriched with their biography. */
export function buildFocusPerson(personId: string, family: FamilyFacts): FocusPerson | null {
  const entry = family.personas.find((p) => p.id === personId);
  if (!entry) return null;
  const person = getPerson(personId);
  return { ...entry, biografia: person?.biography ?? null };
}

/** Retrieve the sources relevant to the question by meaning (embeddings), with a
 *  lexical/recency fallback when no embedding provider is configured. When a focus
 *  person is given, every document already linked to them is guaranteed into the
 *  pool (even if it wouldn't rank high by similarity) and the retrieval query is
 *  biased toward their name. */
export async function buildGenealogySourcePool(objective: string, focusPersonId?: string | null): Promise<GenSource[]> {
  const sources: GenSource[] = [];
  const seen = new Set<string>();

  const addDoc = (item: { itemId: string; title: string; docType: string | null; extractedText: string | null; description: string | null; linkedPersons: { displayName: string }[] }) => {
    if (seen.has(item.itemId) || sources.filter((s) => s.kind === 'document').length >= MAX_DOC_SOURCES) return;
    seen.add(item.itemId);
    const text = (item.extractedText ?? item.description ?? '').trim();
    sources.push({
      id: `doc:${item.itemId}`,
      kind: 'document',
      refId: item.itemId,
      title: item.title,
      label: item.docType ?? 'documento',
      persons: item.linkedPersons.map((p) => p.displayName),
      snippet: clip(text, DOC_SNIPPET),
      fullText: text,
    });
  };

  const focusPerson = focusPersonId ? getPerson(focusPersonId) : null;
  if (focusPerson) for (const item of listItemsForPerson(focusPerson.personId)) addDoc(item);

  const queryText = focusPerson ? `${objective.trim()}\n${focusPerson.displayName}`.trim() : objective.trim();
  const objVec = queryText ? await embed(queryText) : null;
  if (objVec) for (const item of await findArchiveItemsSimilar(objVec, { limit: MAX_DOC_SOURCES, minSimilarity: 0.2 })) addDoc(item);
  // Fallback / backfill: recent documents so the report always has primary material.
  for (const item of listItems({}).slice(0, MAX_DOC_SOURCES)) addDoc(item);

  // Zotero library (secondary sources), if any, retrieved by summary similarity.
  if (objVec) {
    // Paged, so gathering the sources does not freeze the window (see db/vectorScan.ts).
    for (const row of await findSimilarWorksPaged(objVec, 0.2, MAX_WORK_SOURCES)) {
      const w = getWork(row.nodus_id);
      if (!w) continue;
      const authors = parseAuthors((w as { authors_json?: string }).authors_json ?? '[]');
      sources.push({
        id: `work:${w.nodus_id}`,
        kind: 'work',
        refId: w.nodus_id,
        title: w.title,
        label: authorYear(authors[0], w.year),
        persons: [],
        snippet: clip(w.title, DOC_SNIPPET),
        fullText: '', // resolved on demand while writing the section it's assigned to
      });
    }
  }
  return sources;
}

// ── Orchestration (injected AI + full-text resolution) ────────────────────────

export interface GenPlanSection {
  id: string;
  title: string;
  purpose: string;
  keyPoints: string[];
  sourceIds: string[];
  coverageQuestions?: string[];
}
export interface GenPlan {
  title: string;
  abstract: string;
  sections: GenPlanSection[];
}
export interface GenPlanInput {
  objective: string;
  coverageQuestions: string[];
  language: string;
  sectionTarget: number;
  sources: { id: string; kind: string; title: string; label: string; persons: string[]; snippet: string }[];
  family: FamilyFacts;
  focusPerson: FocusPerson | null;
}
export interface GenSectionInput {
  objective: string;
  language: string;
  section: GenPlanSection;
  isConclusion: boolean;
  sources: { id: string; title: string; label: string; persons: string[]; texto: string }[];
  family: FamilyFacts;
  focusPerson: FocusPerson | null;
  evidence: { persona: string; cita: string; localizacion: string | null }[];
  priorSummary: string;
}
export interface GenFinalizeInput {
  objective: string;
  language: string;
  planTitle: string;
  sectionTitles: string[];
  sourcesCited: number;
  sourcesConsidered: number;
  /** Grounded section prose, not merely headings, so the abstract cannot invent a
   * family relationship or certainty absent from the report. */
  sectionFindings?: Array<{ title: string; text: string }>;
}
export interface GenFinalizeResult {
  title: string;
  abstract: string;
  limitations: string[];
  nextSteps: string[];
}

export interface GenDeepDeps {
  planReport(input: GenPlanInput): Promise<GenPlan>;
  writeSection(input: GenSectionInput): Promise<string>;
  finalize(input: GenFinalizeInput): Promise<GenFinalizeResult>;
  auditFinalSummary?(input: GenFinalizeInput, draft: GenFinalizeResult): Promise<GenFinalizeResult>;
  /** Dynamic full text of a Zotero work (resolved only for the sections that use it). */
  resolveWorkFullText(nodusId: string): Promise<string>;
  reviseSection?(input: GenSectionInput & { draft: string; quality: DeepResearchSectionQuality }): Promise<string>;
}

export async function orchestrateGenealogyDeepResearch(
  request: DeepResearchRequest,
  sources: GenSource[],
  family: FamilyFacts,
  deps: GenDeepDeps,
  onProgress?: (p: DeepResearchProgress) => void,
  focusPerson: FocusPerson | null = null
): Promise<DeepResearchReport> {
  const language = request.language ?? 'es';
  const emit = (p: DeepResearchProgress) => {
    try {
      onProgress?.(p);
    } catch {
      /* best-effort */
    }
  };
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const { target: sectionTarget, hardCap: sectionHardCap } = resolveSections(
    sources.length,
    request.coverageQuestions?.length ?? 0,
    request.sectionLimit ?? 'auto',
  );

  emit({
    phase: 'snapshot',
    message: focusPerson ? `Reuniendo documentos y evidencia sobre ${focusPerson.nombre}…` : 'Reuniendo documentos y evidencia de la familia…',
  });
  emit({ phase: 'planning', message: `Planificando ${sectionTarget} secciones según la evidencia disponible…` });

  let plan: GenPlan;
  try {
    plan = normalizePlan(
      await deps.planReport({
        objective: request.objective,
        coverageQuestions: request.coverageQuestions ?? [],
        language,
        sectionTarget,
        sources: sources.map((s) => ({ id: s.id, kind: s.kind, title: s.title, label: s.label, persons: s.persons, snippet: s.snippet })),
        family,
        focusPerson,
      }),
      sourceById,
      sectionTarget,
      request.coverageQuestions ?? [],
    );
  } catch {
    plan = fallbackPlan(request.objective, sources, focusPerson);
    assignGenealogyCoverage(plan.sections, request.coverageQuestions ?? []);
  }
  if (plan.sections.length === 0) {
    plan = fallbackPlan(request.objective, sources, focusPerson);
    assignGenealogyCoverage(plan.sections, request.coverageQuestions ?? []);
  }

  const written: { section: GenPlanSection; markdown: string }[] = [];
  const citedSourceIds = new Set<string>();
  let totalWords = 0;
  let stoppedReason: string | null = null;
  let qualityRevisions = 0;

  for (let i = 0; i < plan.sections.length; i++) {
    if (written.length >= sectionHardCap) {
      stoppedReason = `Se alcanzó el máximo de ${sectionHardCap} secciones.`;
      break;
    }
    const section = plan.sections[i];
    const isConclusion = i === plan.sections.length - 1;

    emit({
      phase: 'section',
      message: `Redactando: ${section.title}`,
      sectionIndex: written.length + 1,
      sectionTotal: Math.min(plan.sections.length, sectionHardCap),
      sectionTitle: section.title,
      wordsSoFar: totalWords,
      pagesSoFar: pages(totalWords),
    });

    // Dynamic full text: pull each assigned source's full text (docs stored; works
    // resolved now), clipped per document and per section.
    const assigned = section.sourceIds.map((id) => sourceById.get(id)).filter((s): s is GenSource => !!s);
    const sectionSources: GenSectionInput['sources'] = [];
    let budget = PER_SECTION_FULLTEXT;
    for (const s of assigned) {
      let text = s.fullText;
      if (s.kind === 'work' && !text) text = await deps.resolveWorkFullText(s.refId).catch(() => '');
      const clipped = clip(text, Math.min(PER_DOC_FULLTEXT, budget));
      budget -= clipped.length;
      sectionSources.push({ id: s.id, title: s.title, label: s.label, persons: s.persons, texto: clipped });
      if (budget <= 0) break;
    }
    const personNames = new Set(assigned.flatMap((s) => s.persons));
    if (focusPerson) personNames.add(focusPerson.nombre);
    const evidence = evidenceForPersons(personNames);

    let raw = '';
    try {
      raw = await deps.writeSection({ objective: request.objective, language, section, isConclusion, sources: sectionSources, family, focusPerson, evidence, priorSummary: summarizePrior(written) });
    } catch {
      raw = degradedSection(section, sectionSources);
      if (!stoppedReason) stoppedReason = 'Una o más secciones se resolvieron de forma degradada por un fallo del modelo.';
    }

    let { markdown, cited } = applyGenealogyCitations(normalizeNarrativeSection(raw, section.title), sourceById);
    const qualitySources = genealogyQualitySources(assigned);
    const beforeQuality = assessDeepResearchSection({
      markdown,
      mode: 'genealogy',
      objective: request.objective,
      keyClaims: [...section.keyPoints, ...(section.coverageQuestions ?? [])],
      sources: qualitySources,
    });
    if (deps.reviseSection && (!qualityPasses(beforeQuality) || beforeQuality.score < 85 || beforeQuality.issues.length > 0)) {
      try {
        const revisedRaw = await deps.reviseSection({
          objective: request.objective,
          language,
          section,
          isConclusion,
          sources: sectionSources,
          family,
          focusPerson,
          evidence,
          priorSummary: summarizePrior(written),
          draft: markdown,
          quality: beforeQuality,
        });
        const revisedOutcome = applyGenealogyCitations(normalizeNarrativeSection(revisedRaw, section.title), sourceById);
        const afterQuality = assessDeepResearchSection({
          markdown: revisedOutcome.markdown,
          mode: 'genealogy',
          objective: request.objective,
          keyClaims: [...section.keyPoints, ...(section.coverageQuestions ?? [])],
          sources: qualitySources,
        });
        const allowed = new Set(qualitySources.map((source) => source.citation));
        if (shouldAcceptQualityRevision(beforeQuality, afterQuality, allowed, revisedOutcome.markdown)) {
          markdown = revisedOutcome.markdown;
          cited = revisedOutcome.cited;
          qualityRevisions += 1;
        }
      } catch {
        /* preserve the first grounded draft */
      }
    }
    for (const id of cited) citedSourceIds.add(id);
    written.push({ section, markdown });
    totalWords += countWords(markdown);
  }

  emit({ phase: 'assembling', message: 'Ensamblando informe y fuentes…', wordsSoFar: totalWords, pagesSoFar: pages(totalWords) });

  let finalize: GenFinalizeResult;
  try {
    const finalizeInput: GenFinalizeInput = {
      objective: request.objective,
      language,
      planTitle: plan.title,
      sectionTitles: written.map((w) => w.section.title),
      sourcesCited: citedSourceIds.size,
      sourcesConsidered: sources.length,
      sectionFindings: written.map((item) => ({ title: item.section.title, text: item.markdown.slice(0, 4_500) })),
    };
    finalize = await deps.finalize(finalizeInput);
    if (deps.auditFinalSummary) {
      try {
        const audited = await deps.auditFinalSummary(finalizeInput, finalize);
        finalize = {
          title: audited.title || finalize.title,
          abstract: audited.abstract || finalize.abstract,
          limitations: [...new Set([...finalize.limitations, ...audited.limitations])],
          nextSteps: audited.nextSteps.length ? audited.nextSteps : finalize.nextSteps,
        };
      } catch {
        /* the first grounded finalizer remains valid */
      }
    }
  } catch {
    finalize = { title: plan.title || request.objective, abstract: plan.abstract, limitations: [], nextSteps: ['Contrastar cada dato con la fuente original y buscar registros que confirmen los vínculos aún no probados.'] };
  }

  const citedSources = [...citedSourceIds].map((id) => sourceById.get(id)).filter((s): s is GenSource => !!s);
  const references = buildReferences(citedSources);
  const singleNarrative = request.sectionLimit === 'single';
  const draftMarkdown = assemble(written, references, finalize, language, singleNarrative);
  const qualityAssessment = assessDeepResearchReport({
    mode: 'genealogy',
    objective: request.objective,
    coverageQuestions: request.coverageQuestions,
    sections: written.map((item) => ({
      title: item.section.title,
      markdown: item.markdown,
      keyClaims: [...item.section.keyPoints, ...(item.section.coverageQuestions ?? [])],
      sources: genealogyQualitySources(
        item.section.sourceIds.map((id) => sourceById.get(id)).filter((source): source is GenSource => Boolean(source)),
      ),
    })),
  });

  const outline: WritingWorkshopSection[] = singleNarrative ? [] : written.map((w, i) => ({
    id: w.section.id || `s${i + 1}`,
    title: w.section.title,
    purpose: w.section.purpose,
    keyClaims: [...w.section.keyPoints, ...(w.section.coverageQuestions ?? [])].slice(0, 16),
    sources: w.section.sourceIds.map((id) => sourceById.get(id)?.title ?? id).slice(0, 8),
  }));

  const brief: WritingWorkshopBrief = {
    kind: 'deep_research', objective: request.objective, audience: request.audience, tone: 'academic', language,
    deepResearchVersion: request.deepResearchVersion ?? 'v2',
  };
  const draft: WritingWorkshopDraft = {
    generatedAt: new Date().toISOString(),
    brief,
    selection: { ideaIds: [], themeIds: [], gapIds: [], contradictionIds: [], workIds: [], passageIds: [], tutorRouteIds: [] },
    title: finalize.title || plan.title || request.objective,
    abstract: finalize.abstract,
    outline,
    draftMarkdown,
    matrix: buildMatrix(citedSources),
    bibliography: references,
    nextSteps: finalize.nextSteps,
    limitations: finalize.limitations,
    deepResearchStructure: singleNarrative ? 'single' : 'sectioned',
    qualityAssessment,
    stats: {
      selectedIdeas: 0,
      selectedThemes: 0,
      selectedGaps: 0,
      selectedContradictions: 0,
      selectedWorks: citedSources.length,
      selectedPassages: 0,
      selectedTutorRoutes: 0,
      contextChars: draftMarkdown.length,
      truncated: stoppedReason != null,
    },
  };

  const meta: DeepResearchMeta = {
    deepResearchVersion: request.deepResearchVersion ?? 'v2',
    structure: singleNarrative ? 'single' : 'sectioned',
    sections: singleNarrative ? 1 : written.length,
    words: totalWords,
    pages: pages(totalWords),
    ideasCovered: citedSourceIds.size,
    ideasConsidered: sources.length,
    worksCited: citedSources.length,
    stoppedReason,
    qualityRevisions,
    coverage: request.coverageQuestions?.length
      ? { questions: [...request.coverageQuestions], ratio: qualityAssessment.metrics.objectiveCoverage }
      : null,
  };

  emit({ phase: 'done', message: `Informe listo: ${singleNarrative ? 'bloque continuo' : `${written.length} secciones`} · ~${meta.pages} páginas`, wordsSoFar: totalWords, pagesSoFar: meta.pages });
  return { draft, meta };
}

/** Production entry point: gather the source pool + family facts, then orchestrate. */
export async function generateGenealogyDeepResearchReport(
  request: DeepResearchRequest,
  onProgress?: (p: DeepResearchProgress) => void
): Promise<DeepResearchReport> {
  const settings = getSettings();
  const model = request.model ?? settings.deepResearchModel ?? settings.synthesisModel ?? null;
  const approach = normalizeDeepResearchApproach(request.approach);
  const [ordinarySources, family] = await Promise.all([
    buildGenealogySourcePool(request.objective, request.focusPersonId),
    Promise.resolve(buildFamilyFacts()),
  ]);
  const focusPerson = request.focusPersonId ? buildFocusPerson(request.focusPersonId, family) : null;
  // The historical General path remains byte-for-byte the same after source gathering.
  if (approach === 'general') {
    return orchestrateGenealogyDeepResearch(request, ordinarySources, family, realDeps(model), onProgress, focusPerson);
  }
  const retrieval = await planApproachRetrieval({
    approach,
    variant: 'genealogy',
    objective: request.objective,
    language: request.language ?? 'es',
    model,
    corpusPreview: {
      focusPerson,
      persons: family.personas.slice(0, 40),
      events: family.eventos.slice(0, 60),
      sources: ordinarySources.map((source) => ({ kind: source.kind, title: source.title, label: source.label, persons: source.persons, snippet: source.snippet })),
    },
  });
  const supplementalPools = await Promise.all(
    retrieval.probes.slice(0, 6).map((probe) => buildGenealogySourcePool(probe, request.focusPersonId)),
  );
  const sources = mergeGenealogyApproachSources(ordinarySources, supplementalPools.flat(), approach);
  return orchestrateGenealogyDeepResearch(
    request,
    sources,
    family,
    specializedGenealogyDeps(model, approach, retrieval),
    onProgress,
    focusPerson,
  );
}

function mergeGenealogyApproachSources(
  ordinary: GenSource[],
  supplemental: GenSource[],
  approach: DeepResearchApproach,
): GenSource[] {
  const seen = new Set(ordinary.map((source) => source.id));
  const additions = supplemental.filter((source) => !seen.has(source.id) && Boolean(seen.add(source.id))).slice(0, 24);
  const merged = [...ordinary, ...additions];
  if (approach === 'literature_review') {
    return [...merged.filter((source) => source.kind === 'work'), ...merged.filter((source) => source.kind === 'document')];
  }
  if (approach === 'chronological') {
    const dated = (source: GenSource) => /\b(?:1[5-9]|20)\d{2}\b/.test(`${source.label} ${source.title} ${source.snippet}`) ? 1 : 0;
    return [...merged].sort((a, b) => dated(b) - dated(a));
  }
  return merged;
}

function realDeps(model: ModelRef | null): GenDeepDeps {
  return {
    planReport: (input) => aiPlan(input, model),
    writeSection: (input) => aiWriteSection(input, model),
    reviseSection: (input) => aiReviseGenealogySection(input, model),
    finalize: (input) => aiFinalize(input, model),
    auditFinalSummary: (input, draft) => aiAuditGenealogyFinalSummary(input, draft, model),
    resolveWorkFullText: async (nodusId) => {
      const w = getWork(nodusId);
      if (!w) return '';
      const settings = getSettings();
      const doc = await resolveWorkText(
        settings.zoteroUserId || LOCAL_USER_ID,
        w.zotero_key,
        settings.zoteroStoragePath,
        null,
        w.doi ?? null,
        { unpaywallEmail: settings.unpaywallEmail, preferZoteroFulltext: settings.preferZoteroFulltext, ocr: { enabled: settings.ocrEnabled, languages: settings.ocrLanguages, maxPages: settings.ocrMaxPages } },
        w.item_type
      ).catch(() => ({ text: '' }));
      return doc.text ?? '';
    },
  };
}

interface GenealogyApproachContext {
  approach: DeepResearchApproach;
  retrieval: ApproachRetrievalPlan;
  rules: ReturnType<typeof approachRules>;
}

function specializedGenealogyDeps(
  model: ModelRef | null,
  approach: DeepResearchApproach,
  retrieval: ApproachRetrievalPlan,
): GenDeepDeps {
  const context: GenealogyApproachContext = {
    approach,
    retrieval,
    rules: approachRules(approach, 'genealogy'),
  };
  const base = realDeps(model);
  return {
    ...base,
    planReport: (input) => aiPlan(input, model, context),
    // Specialized prompts contain more citation-dense comparisons/debates and one
    // provider occasionally closes a Markdown URL with `]` instead of `)`. Repair
    // only citations whose ids are in this section's allowed source menu. General's
    // historical writer and citation path remain untouched.
    writeSection: async (input) => repairMalformedGenealogyCitations(
      await aiWriteSection(input, model, context),
      input.sources,
    ),
    finalize: (input) => aiFinalize(input, model, context),
    auditFinalSummary: (input, draft) => aiAuditGenealogyFinalSummary(input, draft, model, context),
  };
}

// ── Real AI prompts ───────────────────────────────────────────────────────────

interface AiPlanShape { title?: string; abstract?: string; sections?: Array<Partial<GenPlanSection>> }
function isAiPlan(v: unknown): v is AiPlanShape {
  return typeof v === 'object' && v !== null && Array.isArray((v as AiPlanShape).sections);
}

async function aiPlan(input: GenPlanInput, model: ModelRef | null, approach?: GenealogyApproachContext): Promise<GenPlan> {
  const system = [
    'Eres el planificador de un INFORME DE HISTORIA FAMILIAR (Deep Research en modo genealogía de Nodus).',
    'Diseñas el esqueleto de un informe riguroso y bien documentado a partir de las FUENTES (documentos de archivo y bibliografía) y de los HECHOS de la familia (personas, parentescos, eventos) que se te dan.',
    'PRINCIPIO: pocas secciones LARGAS y de fondo, no muchas cortas. Organiza el relato de forma útil (p. ej. por generaciones, por figuras clave, por lugares o migraciones, y una sección de fuentes y método).',
    `Organiza ${input.sectionTarget} unidades narrativas solo cuando cada una tenga una función probatoria distinta. No añadas secciones para alcanzar una longitud: si una sección no aporta evidencia o análisis nuevo, intégrala en otra.`,
    'Cada título debe abarcar una etapa o línea narrativa sustantiva. Evita títulos partidos por dos puntos, punto y coma o guion largo.',
    'Sigue el estándar de prueba genealógico: identidad y parentesco son HIPÓTESIS probadas con evidencia; no des por ciertos vínculos sin apoyo documental.',
    'Asigna a cada sección los `sourceIds` que la sostienen (copia los ids EXACTOS de la lista de fuentes). No inventes fuentes ni ids.',
    'Cuando existan fuentes independientes pertinentes, asigna varias a la misma sección para triangular identidad, fecha, lugar y parentesco. No cuentes como corroboración dos extractos derivados del mismo documento.',
    'COBERTURA OBLIGATORIA: asigna cada elemento de `preguntas_de_cobertura` a una sección copiándolo literalmente en `coverageQuestions`. Si las fuentes no permiten responderlo, la sección debe declararlo como límite probatorio, no omitirlo.',
    input.focusPerson
      ? `Hay una PERSONA EN FOCO: ${input.focusPerson.nombre}. Este informe es SU biografía documentada, no un panorama genérico de la familia. Organiza las secciones en torno a su vida (orígenes y familia, etapas vitales, vínculos y descendencia, su rastro documental) y trae al resto de personas solo en la medida en que se relacionan con ella. El título del informe debe nombrarla.`
      : '',
    ...(approach?.rules.planner ?? []),
    'Devuelve SOLO JSON: {"title":"...","abstract":"...","sections":[{"id":"s1","title":"...","purpose":"...","keyPoints":["..."],"coverageQuestions":["pregunta exacta"],"sourceIds":["..."]}]}',
  ].filter(Boolean).join('\n');
  const user = JSON.stringify(
    {
      objetivo: input.objective,
      preguntas_de_cobertura: input.coverageQuestions,
      idioma: input.language,
      secciones_objetivo: input.sectionTarget,
      fuentes: input.sources,
      familia: input.family,
      persona_en_foco: input.focusPerson,
      ...(approach ? { enfoque_de_investigacion: approach.approach, plan_de_recuperacion: approach.retrieval } : {}),
    },
    null,
    2
  );
  const ai = await completeJson<AiPlanShape>({ system, user, temperature: 0.2, maxTokens: 6000 }, isAiPlan, model);
  return {
    title: ai.title ?? '',
    abstract: ai.abstract ?? '',
    sections: (ai.sections ?? []).map((s, i) => ({
      id: s.id ?? `s${i + 1}`,
      title: s.title ?? `Sección ${i + 1}`,
      purpose: s.purpose ?? '',
      keyPoints: Array.isArray(s.keyPoints) ? s.keyPoints : [],
      sourceIds: Array.isArray(s.sourceIds) ? s.sourceIds : [],
      coverageQuestions: Array.isArray(s.coverageQuestions) ? s.coverageQuestions : [],
    })),
  };
}

async function aiWriteSection(input: GenSectionInput, model: ModelRef | null, approach?: GenealogyApproachContext): Promise<string> {
  const system = [
    'Eres el redactor de un INFORME DE HISTORIA FAMILIAR (Deep Research en modo genealogía). Escribes UNA sección.',
    'Escribe en español salvo que el idioma pida otra lengua. Desarrolla todas las afirmaciones, comparaciones e incertidumbres que la evidencia justifique y detente cuando no quede valor probatorio marginal; no persigas un número de párrafos o palabras ni repitas una idea con otras formulaciones.',
    'Usa SOLO las fuentes y los hechos del contexto (documentos con su texto, personas, eventos, evidencia). No inventes personas, documentos, fechas ni parentescos.',
    'Sigue el estándar de prueba genealógico: distingue lo que la fuente AFIRMA de lo que se infiere; nunca afirmes una identidad o un parentesco sin apoyo documental; señala los datos inciertos o contradictorios.',
    'Cuando haya varias fuentes independientes, compáralas explícitamente y explica qué dato corrobora, contradice o deja abierto cada una. Cuando solo exista una, formula la conclusión como provisional.',
    'Cuando existan tres o más fuentes independientes, distribuye al menos tres triangulaciones explícitas en párrafos distintos; con dos fuentes, hazlo en al menos dos. Una triangulación debe explicar qué confirma, contradice o limita cada registro, no limitarse a juntar enlaces.',
    'CITAS: cuando sostengas un hecho con una fuente, cítala inmediatamente como enlace Markdown. Documentos: `[Título](nodus://archive/<itemId>)`. Obras: `[Autor, Año](nodus://work/<nodusId>)`. Copia el `id` EXACTO del campo `id` de la fuente (quita el prefijo `doc:`/`work:`). Nunca inventes ids.',
    'Respeta los nombres y las fechas de época tal como constan; no los modernices. Nombra a las personas por su nombre completo.',
    ...DEEP_RESEARCH_NARRATIVE_RULES,
    'No repitas lo ya dicho (se te da un resumen de las secciones previas). Empieza con un encabezado Markdown "## " y el título dado. Devuelve solo el Markdown de la sección.',
    input.focusPerson
      ? `Hay una PERSONA EN FOCO: ${input.focusPerson.nombre}. Mantén el relato centrado en ella: el resto de personas aparece solo en la medida en que se relaciona con su vida.`
      : '',
    ...(approach?.rules.writer ?? []),
  ].filter(Boolean).join('\n');
  const user = JSON.stringify(
    {
      objetivo: input.objective,
      idioma: input.language,
      seccion: { titulo: input.section.title, proposito: input.section.purpose, puntos_clave: input.section.keyPoints, preguntas_de_cobertura: input.section.coverageQuestions ?? [] },
      fuentes_asignadas: input.sources,
      familia_relevante: input.family,
      persona_en_foco: input.focusPerson,
      evidencia: input.evidence,
      resumen_secciones_previas: input.priorSummary || '(esta es la primera sección)',
      ...(approach ? { enfoque_de_investigacion: approach.approach, plan_de_recuperacion: approach.retrieval } : {}),
    },
    null,
    2
  );
  return completeText({ system, user, temperature: 0.3, maxTokens: 5200 }, model);
}

async function aiReviseGenealogySection(
  input: GenSectionInput & { draft: string; quality: DeepResearchSectionQuality },
  model: ModelRef | null,
): Promise<string> {
  const system = [
    'Eres el editor final de un informe de historia familiar sometido al estándar de prueba genealógico.',
    'Reescribe la sección para corregir únicamente los fallos medidos. Conserva el idioma y todo dato ya correctamente formulado, y elimina cualquier repetición sin valor probatorio.',
    'Usa exclusivamente las fuentes, hechos y evidencias proporcionados. No inventes identidades, parentescos, fechas, lugares ni documentos.',
    'Distingue explícitamente dato documentado, inferencia razonada, conflicto entre registros y ausencia de prueba. Una coincidencia de nombre nunca basta por sí sola para identificar a una persona.',
    'Compara fuentes independientes cuando existan y explica qué aporta cada una. Si una fuente es única, limita la conclusión en vez de reforzarla retóricamente.',
    'Cuando haya tres o más fuentes independientes, conserva al menos tres párrafos de triangulación explícita; con dos fuentes, al menos dos. Cada párrafo debe explicar la relación probatoria entre registros, no acumular citas.',
    'Copia solo los enlaces nodus:// permitidos. No acumules citas ni dejes afirmaciones sustantivas sin apoyo.',
    'Mantén un único encabezado ## y prosa continua. Devuelve solo el Markdown completo revisado.',
  ].join('\n');
  const allowedSources = input.sources.map((source) => {
    const [prefix, ...rest] = source.id.split(':');
    const refId = rest.join(':');
    const kind = prefix === 'doc' ? 'archive' : 'work';
    return {
      id: source.id,
      exactCitation: `[${source.label || source.title}](nodus://${kind}/${encodeURIComponent(refId)})`,
      title: source.title,
      text: source.texto,
    };
  });
  return completeText({
    system,
    user: JSON.stringify({
      objective: input.objective,
      language: input.language,
      section: input.section,
      detectedProblems: input.quality.issues,
      metricsBefore: input.quality.metrics,
      draft: input.draft,
      allowedSources,
      relevantFamilyFacts: input.family,
      focusPerson: input.focusPerson,
      evidence: input.evidence,
    }, null, 2),
    temperature: 0.12,
    maxTokens: 5_600,
  }, model);
}

interface AiFinalShape { title?: string; abstract?: string; limitations?: string[]; nextSteps?: string[] }
function isAiFinal(v: unknown): v is AiFinalShape {
  return typeof v === 'object' && v !== null;
}
async function aiFinalize(input: GenFinalizeInput, model: ModelRef | null, approach?: GenealogyApproachContext): Promise<GenFinalizeResult> {
  const system = [
    'Cierras un INFORME DE HISTORIA FAMILIAR (Deep Research en modo genealogía).',
    'Escribe en español salvo que el idioma pida otra lengua.',
    'Devuelve SOLO JSON: {"title":"título breve del informe","abstract":"resumen de 6-10 líneas","limitations":["..."],"nextSteps":["..."]}',
    'Las limitaciones deben ser honestas y genealógicas: vínculos aún no probados, fuentes no consultadas, fechas inciertas o contradictorias, homónimos por resolver.',
    'El título y el resumen solo pueden sintetizar hallazgos presentes en `hallazgos_verificados`. No conviertas una hipótesis, coincidencia nominal, ausencia documental o relación posible en parentesco o identidad demostrados.',
    'Los próximos pasos deben sugerir qué registros o fuentes buscar para probar lo que queda como hipótesis.',
    'Redacta el título y el resumen como prosa fluida. Evita dos puntos, punto y coma y guion largo salvo necesidad estricta.',
    ...(approach?.rules.finalizer ?? []),
  ].join('\n');
  const user = JSON.stringify(
    {
      objetivo: input.objective,
      idioma: input.language,
      titulo_provisional: input.planTitle,
      secciones: input.sectionTitles,
      fuentes_citadas: input.sourcesCited,
      fuentes_consideradas: input.sourcesConsidered,
      hallazgos_verificados: input.sectionFindings ?? [],
      ...(approach ? { enfoque_de_investigacion: approach.approach, plan_de_recuperacion: approach.retrieval } : {}),
    },
    null,
    2
  );
  const ai = await completeJson<AiFinalShape>({ system, user, temperature: 0.2, maxTokens: 2000 }, isAiFinal, model);
  return {
    title: ai.title ?? input.planTitle,
    abstract: ai.abstract ?? '',
    limitations: Array.isArray(ai.limitations) ? ai.limitations : [],
    nextSteps: Array.isArray(ai.nextSteps) ? ai.nextSteps : [],
  };
}

async function aiAuditGenealogyFinalSummary(
  input: GenFinalizeInput,
  draft: GenFinalizeResult,
  model: ModelRef | null,
  approach?: GenealogyApproachContext,
): Promise<GenFinalizeResult> {
  const system = [
    'Eres el control epistemológico final de un informe de historia familiar. Audita únicamente título, resumen, limitaciones y próximos pasos.',
    'Compara cada afirmación del título y del resumen con `hallazgos_verificados`. Estrecha o elimina cualquier identidad, parentesco, cronología, causalidad o certeza que el cuerpo no establezca de forma explícita.',
    'Distingue coincidencia nominal, hipótesis razonada, evidencia conflictiva y vínculo probado. Nunca mejores el grado de certeza del cuerpo.',
    'No elimines ninguna limitación previa. Puedes añadir otras cuando el resumen dependa de homónimos, registros ausentes o fuentes únicas.',
    'No introduzcas datos nuevos. Conserva el idioma y devuelve SOLO JSON con {"title":"...","abstract":"...","limitations":["..."],"nextSteps":["..."]}.',
    ...(approach?.rules.finalizer ?? []),
  ].join('\n');
  const ai = await completeJson<AiFinalShape>({
    system,
    user: JSON.stringify({
      objetivo: input.objective,
      hallazgos_verificados: input.sectionFindings ?? [],
      propuesta: draft,
    }, null, 2),
    temperature: 0,
    maxTokens: 2_400,
  }, isAiFinal, model);
  return {
    title: ai.title ?? draft.title,
    abstract: ai.abstract ?? draft.abstract,
    limitations: Array.isArray(ai.limitations) ? ai.limitations : draft.limitations,
    nextSteps: Array.isArray(ai.nextSteps) ? ai.nextSteps : draft.nextSteps,
  };
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

const CITATION_RE = /\[([^\]]*)\]\(nodus:\/\/(archive|work)\/([^)]+)\)/g;

function genealogyQualitySources(sources: GenSource[]): DeepResearchQualitySource[] {
  return sources.map((source) => ({
    citation: `nodus://${source.kind === 'document' ? 'archive' : 'work'}/${encodeURIComponent(source.refId)}`,
    sourceId: source.id,
    evidence: 'document',
  }));
}

/** Keep only citations that point at a source in the pool; strip hallucinated ones. */
export function applyGenealogyCitations(markdown: string, sourceById: Map<string, GenSource>): { markdown: string; cited: Set<string> } {
  const cited = new Set<string>();
  const out = markdown.replace(CITATION_RE, (_full, label: string, kind: string, rawId: string) => {
    let id = rawId;
    try {
      id = decodeURIComponent(rawId);
    } catch {
      /* keep raw */
    }
    const sourceId = kind === 'archive' ? `doc:${id}` : `work:${id}`;
    const source = sourceById.get(sourceId);
    if (!source) return label || '';
    cited.add(sourceId);
    const canonical = source.kind === 'document' ? source.title : source.label || source.title;
    return `[${canonical || label}](nodus://${kind}/${encodeURIComponent(id)})`;
  });
  return { markdown: out, cited };
}

export function buildReferences(cited: GenSource[]): string[] {
  const entries = cited.map((s) =>
    s.kind === 'document' ? `${s.title}${s.label ? ` [${s.label}]` : ''}` : `${s.label ? `${s.label}. ` : ''}${s.title}`
  );
  return [...new Set(entries.map((e) => e.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
}

function buildMatrix(cited: GenSource[]): WritingWorkshopMatrixRow[] {
  return cited.slice(0, 60).map((s) => ({
    claim: clip(s.snippet || s.title, 240),
    role: s.kind === 'document' ? 'context' : 'support',
    sourceLabel: s.kind === 'document' ? s.label || 'documento' : s.label || 'obra',
    citation: `nodus://${s.kind === 'document' ? 'archive' : 'work'}/${encodeURIComponent(s.refId)}`,
    evidence: s.persons.length ? `Menciona a: ${s.persons.slice(0, 6).join(', ')}.` : 'Fuente del archivo o la biblioteca.',
    notes: s.kind === 'document' ? 'Fuente primaria del archivo.' : 'Fuente secundaria de la biblioteca.',
  }));
}

function normalizePlan(
  plan: GenPlan,
  sourceById: Map<string, GenSource>,
  maxSections: number,
  coverageQuestions: string[] = [],
): GenPlan {
  const validCoverage = new Set(coverageQuestions);
  const sections = (plan.sections ?? []).slice(0, maxSections).map((s, i) => ({
    id: cleanStr(s.id, `s${i + 1}`),
    title: cleanStr(s.title, `Sección ${i + 1}`),
    purpose: cleanStr(s.purpose, ''),
    keyPoints: strList(s.keyPoints).slice(0, 8),
    sourceIds: strList(s.sourceIds).filter((id) => sourceById.has(id)),
    coverageQuestions: strList(s.coverageQuestions).filter((question) => validCoverage.has(question)),
  }));
  // Any section with no valid sources borrows the top documents so it has grounding.
  const topDocs = [...sourceById.values()].filter((s) => s.kind === 'document').slice(0, 4).map((s) => s.id);
  for (const s of sections) if (s.sourceIds.length === 0) s.sourceIds = topDocs;
  assignGenealogyCoverage(sections, coverageQuestions);
  return { title: cleanStr(plan.title, ''), abstract: cleanStr(plan.abstract, ''), sections };
}

function assignGenealogyCoverage(sections: GenPlanSection[], questions: string[]): void {
  if (!sections.length) return;
  const assigned = new Set(sections.flatMap((section) => section.coverageQuestions ?? []));
  for (const question of questions) {
    if (assigned.has(question)) continue;
    const query = genealogyTerms(question);
    const ranked = sections.map((section, index) => {
      const target = genealogyTerms(`${section.title} ${section.purpose} ${section.keyPoints.join(' ')}`);
      const overlap = [...query].filter((term) => target.has(term)).length / Math.max(1, query.size);
      return { section, index, score: overlap - (section.coverageQuestions?.length ?? 0) * 0.01 };
    }).sort((a, b) => b.score - a.score || a.index - b.index);
    ranked[0].section.coverageQuestions = [...(ranked[0].section.coverageQuestions ?? []), question];
    assigned.add(question);
  }
}

function genealogyTerms(text: string): Set<string> {
  return new Set(text.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 3));
}

function fallbackPlan(objective: string, sources: GenSource[], focusPerson: FocusPerson | null = null): GenPlan {
  const docs = sources.filter((s) => s.kind === 'document');
  const per = Math.max(1, Math.ceil(docs.length / 3));
  const sections: GenPlanSection[] = focusPerson
    ? [
        { id: 's1', title: `Orígenes y familia de ${focusPerson.nombre}`, purpose: 'Presentar a la persona en foco y sus fuentes.', keyPoints: [], sourceIds: docs.slice(0, per).map((s) => s.id) },
        { id: 's2', title: `Vida documentada de ${focusPerson.nombre}`, purpose: 'Reconstruir su biografía y vínculos a partir de los registros.', keyPoints: [], sourceIds: docs.slice(per, per * 2).map((s) => s.id) },
        { id: 's3', title: 'Síntesis, incertidumbres y próximos pasos', purpose: 'Integrar lo probado, señalar lo incierto y qué fuentes faltan.', keyPoints: [], sourceIds: docs.slice(per * 2).map((s) => s.id) },
      ]
    : [
        { id: 's1', title: 'Panorama de la familia y sus fuentes', purpose: 'Presentar a las personas y los documentos disponibles.', keyPoints: [], sourceIds: docs.slice(0, per).map((s) => s.id) },
        { id: 's2', title: 'Vidas y vínculos documentados', purpose: 'Reconstruir biografías y parentescos a partir de los registros.', keyPoints: [], sourceIds: docs.slice(per, per * 2).map((s) => s.id) },
        { id: 's3', title: 'Síntesis, incertidumbres y próximos pasos', purpose: 'Integrar lo probado, señalar lo incierto y qué fuentes faltan.', keyPoints: [], sourceIds: docs.slice(per * 2).map((s) => s.id) },
      ];
  const title = focusPerson ? `Historia de ${focusPerson.nombre}: ${objective}` : `Informe familiar: ${objective}`;
  return { title: title.slice(0, 140), abstract: '', sections };
}

function degradedSection(section: GenPlanSection, sources: GenSectionInput['sources']): string {
  const lines = [`## ${section.title}`, ''];
  if (section.purpose) lines.push(section.purpose, '');
  for (const s of sources.slice(0, 6)) lines.push(`- ${clip(s.texto || s.title, 240)} [${s.title}](nodus://archive/${encodeURIComponent(s.id.replace(/^doc:/, ''))})`);
  if (sources.length === 0) lines.push('_No se pudo desarrollar esta sección con el modelo; revisar las fuentes asignadas._');
  return lines.join('\n');
}

function evidenceForPersons(names: Set<string>): { persona: string; cita: string; localizacion: string | null }[] {
  if (names.size === 0) return [];
  const out: { persona: string; cita: string; localizacion: string | null }[] = [];
  for (const p of listPersons()) {
    if (!names.has(p.displayName)) continue;
    for (const ev of listEvidenceFor('person', p.personId)) {
      if (ev.quote) out.push({ persona: p.displayName, cita: ev.quote, localizacion: ev.location });
      if (out.length >= 30) return out;
    }
  }
  return out;
}

function assemble(
  written: { section: GenPlanSection; markdown: string }[],
  references: string[],
  finalize: GenFinalizeResult,
  language: string,
  singleNarrative = false,
): string {
  const L = labels(language);
  if (singleNarrative) {
    return assembleContinuousNarrative(
      written.map((item) => item.markdown),
      references,
      finalize.limitations,
      L.sources,
      L.limitations,
      L.noSources,
      finalize.abstract,
    );
  }
  const parts: string[] = [];
  if (finalize.abstract) parts.push(`## ${L.abstract}`, '', finalize.abstract, '');
  for (const w of written) parts.push(w.markdown.trim(), '');
  if (finalize.limitations.length) parts.push(`## ${L.limitations}`, '', ...finalize.limitations.map((x) => `- ${x}`), '');
  parts.push(`## ${L.sources}`, '');
  parts.push(...(references.length ? references.map((r) => `- ${r}`) : [`- ${L.noSources}`]));
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function resolveSections(
  sourceCount: number,
  coverageCount: number,
  sectionLimit: NonNullable<DeepResearchRequest['sectionLimit']>,
): { target: number; hardCap: number } {
  if (typeof sectionLimit === 'number' && Number.isFinite(sectionLimit) && sectionLimit > 0) {
    const target = Math.max(1, Math.round(sectionLimit));
    return { target, hardCap: target };
  }
  // The structure follows the evidence graph, not a page/word budget. A small
  // corpus stays compact; additional independent source/coverage clusters may
  // receive their own section when the planner can give them a distinct purpose.
  const target = Math.max(3, Math.ceil(sourceCount / 4), Math.ceil(coverageCount / 3));
  return { target, hardCap: target };
}

function summarizePrior(written: { section: GenPlanSection; markdown: string }[]): string {
  return written.map((w, i) => `${i + 1}. ${w.section.title}`).join('\n');
}
function pages(words: number): number {
  return Math.max(1, Math.round(words / OBSERVED_PAGE_WORD_RATIO));
}
function clip(text: string, max: number): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trim()}…` : clean;
}
function cleanStr(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
}
function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim()) : [];
}
function parseAuthors(json: string): string[] {
  try {
    const p = JSON.parse(json || '[]');
    return Array.isArray(p) ? p.filter((a): a is string => typeof a === 'string') : [];
  } catch {
    return [];
  }
}
function authorYear(author: string | undefined, year: number | null): string {
  const raw = (author ?? '').trim();
  const surname = raw.includes(',') ? raw.split(',')[0].trim() : raw.split(/\s+/).slice(-1)[0] || raw;
  return year ? `${surname || 'Autor'} (${year})` : surname || 'Autor';
}
function labels(language: string) {
  if (language === 'en') return { abstract: 'Abstract', limitations: 'Limitations', sources: 'Sources', noSources: 'No sources cited.' };
  if (language === 'fr') return { abstract: 'Résumé', limitations: 'Limites', sources: 'Sources', noSources: 'Aucune source citée.' };
  if (language === 'tr') return { abstract: 'Özet', limitations: 'Sınırlılıklar', sources: 'Kaynaklar', noSources: 'Kaynak belirtilmedi.' };
  if (language === 'de') return { abstract: 'Zusammenfassung', limitations: 'Einschränkungen', sources: 'Quellen', noSources: 'Keine Quellen angegeben.' };
  if (language === 'pt') return { abstract: 'Resumo', limitations: 'Limitações', sources: 'Fontes', noSources: 'Nenhuma fonte citada.' };
  if (language === 'pt-BR') return { abstract: 'Resumo', limitations: 'Limitações', sources: 'Fontes', noSources: 'Nenhuma fonte citada.' };
  return { abstract: 'Resumen', limitations: 'Limitaciones', sources: 'Fuentes', noSources: 'Sin fuentes citadas.' };
}
