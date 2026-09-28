/**
 * Binds the pure complete-guide orchestrator to the vault, the AI client, the local
 * run/cache tables and the claim auditor, and turns its result into a Deep Research
 * report that the existing queue, gallery, reader and exports already understand.
 */
import crypto from 'node:crypto';
import type {
  DeepResearchMeta,
  DeepResearchProgress,
  DeepResearchReport,
  DeepResearchRequest,
  ModelRef,
  PromptLanguage,
  WritingWorkshopDraft,
} from '@shared/types';
import type { StudySourceOrganization } from '@shared/studySourceTree';
import type { CompleteGuideSnapshot } from '@shared/completeGuide/snapshot';
import { completeGuidePrice } from '@shared/completeGuide/estimate';
import { normalizeCompleteGuideConfig, type CompleteGuideDraftMeta } from '@shared/completeGuide/types';
import {
  createCompleteGuideRun,
  getCompleteGuideCache,
  getCompleteGuideRun,
  getCompleteGuideUnit,
  pruneCompleteGuideCache,
  pruneStaleCompleteGuideRuns,
  putCompleteGuideCache,
  putCompleteGuideUnit,
  setCompleteGuideRunStage,
} from '../../db/completeGuideRepo';
import { getSettings } from '../../db/settingsRepo';
import { completeJson, embedMany } from '../aiClient';
import { withoutDocumentVisualPlanning } from '../documentVisualContext';
import { createResearchProseAuditor, findResearchConflicts } from '../researchClaimAudit';
import { withResearchValidationThinking } from '../thinkingEffort';
import { createUsageMeter, recordEstimatedUsage, withUsageMeter, type UsageMeter } from '../usageMeter';
import { runCompleteGuide, type CompleteGuideDeps, type CompleteGuideProgress } from './core';
import { COMPLETE_GUIDE_PROMPT_VERSION } from './prompts';
import { snapshotCompleteGuideSelection } from './sources';

interface FrozenRun { snapshot: CompleteGuideSnapshot; organization: StudySourceOrganization; snapshotAt: string }

const PROGRESS_COPY: Partial<Record<PromptLanguage, Record<CompleteGuideProgress['stage'], string>>> & { en: Record<CompleteGuideProgress['stage'], string> } = {
  es: { recon: 'Revisando los materiales', extract: 'Extrayendo conceptos, fórmulas y ejemplos', plan: 'Organizando los capítulos', write: 'Redactando', verify: 'Comprobando las citas', finalize: 'Preparando glosario, formulario y ficha de repaso' },
  en: { recon: 'Surveying the materials', extract: 'Extracting concepts, formulas and examples', plan: 'Organizing the chapters', write: 'Writing', verify: 'Checking citations', finalize: 'Preparing glossary, formula sheet and review sheet' },
  fr: { recon: 'Parcours des documents', extract: 'Extraction des notions, formules et exemples', plan: 'Organisation des chapitres', write: 'Rédaction', verify: 'Vérification des citations', finalize: 'Préparation du glossaire, du formulaire et de la fiche' },
  de: { recon: 'Materialien werden gesichtet', extract: 'Begriffe, Formeln und Beispiele werden erfasst', plan: 'Kapitel werden geordnet', write: 'Schreiben', verify: 'Belege werden geprüft', finalize: 'Glossar, Formelsammlung und Wiederholungsblatt' },
  it: { recon: 'Esame dei materiali', extract: 'Estrazione di concetti, formule ed esempi', plan: 'Organizzazione dei capitoli', write: 'Stesura', verify: 'Verifica delle citazioni', finalize: 'Glossario, formulario e scheda di ripasso' },
  pt: { recon: 'A rever os materiais', extract: 'A extrair conceitos, fórmulas e exemplos', plan: 'A organizar os capítulos', write: 'A redigir', verify: 'A verificar as citações', finalize: 'Glossário, formulário e ficha de revisão' },
  'pt-BR': { recon: 'Revisando os materiais', extract: 'Extraindo conceitos, fórmulas e exemplos', plan: 'Organizando os capítulos', write: 'Redigindo', verify: 'Verificando as citações', finalize: 'Glossário, formulário e ficha de revisão' },
};

function progressEvent(event: CompleteGuideProgress, language: PromptLanguage): DeepResearchProgress {
  const copy = PROGRESS_COPY[language] ?? PROGRESS_COPY.en;
  const phase: DeepResearchProgress['phase'] = event.stage === 'recon' || event.stage === 'extract' ? 'document_preparation'
    : event.stage === 'plan' ? 'planning' : event.stage === 'write' ? 'section' : event.stage === 'verify' ? 'coverage' : 'assembling';
  return {
    phase,
    stage: event.stage,
    done: event.done,
    total: event.total,
    message: `${copy[event.stage]} (${event.done}/${event.total})${event.detail ? ` · ${event.detail}` : ''}`,
    ...(event.stage === 'write' ? { sectionIndex: event.done, sectionTotal: event.total, ...(event.detail ? { sectionTitle: event.detail } : {}) } : {}),
  };
}

class BudgetExhausted extends Error {
  readonly code = 'budget_exhausted';
  constructor(limit: number) {
    super(`Se alcanzó el límite de gasto de la guía (${limit.toFixed(2)} USD). Vuelve a intentarlo con un límite mayor: lo ya hecho se reutilizará.`);
    this.name = 'BudgetExhausted';
  }
}

function usd(meter: UsageMeter, model: ModelRef | null): number | null {
  const price = completeGuidePrice(model);
  return price ? (meter.inputTokens * price.input + meter.outputTokens * price.output) / 1e6 : null;
}

export async function generateCompleteGuideReport(
  request: DeepResearchRequest,
  model: ModelRef | null,
  onProgress?: (progress: DeepResearchProgress) => void,
  signal?: AbortSignal,
): Promise<DeepResearchReport> {
  const config = normalizeCompleteGuideConfig(request.completeGuide);
  const language = request.language ?? getSettings().promptLanguage ?? 'es';
  const emit = (progress: DeepResearchProgress) => { signal?.throwIfAborted(); try { onProgress?.(progress); } catch { /* best effort */ } };
  emit({ phase: 'snapshot', message: (PROGRESS_COPY[language] ?? PROGRESS_COPY.en).recon });
  try { pruneStaleCompleteGuideRuns(); pruneCompleteGuideCache(); } catch { /* housekeeping only */ }

  // The first snapshot of a run is frozen: a job re-queued after a restart reads
  // exactly the text it started with, even if a material changed meanwhile.
  let frozen = getCompleteGuideRun<DeepResearchRequest, FrozenRun>(config.runId)?.snapshot ?? null;
  if (!frozen) {
    const { snapshot, organization } = snapshotCompleteGuideSelection(config);
    if (!snapshot.totals.readablePassages) throw new Error('Ninguna de las fuentes seleccionadas tiene texto legible. Indexa o prepara los materiales e inténtalo de nuevo.');
    frozen = { snapshot, organization, snapshotAt: new Date().toISOString() };
    createCompleteGuideRun(config.runId, { ...request, completeGuide: config }, frozen);
  }

  const job = createUsageMeter();
  const checkBudget = () => {
    signal?.throwIfAborted();
    const spent = usd(job, model);
    if (config.maxCostUsd && spent !== null && spent >= config.maxCostUsd) throw new BudgetExhausted(config.maxCostUsd);
  };
  const auditor = createResearchProseAuditor(model, signal);
  const deps: CompleteGuideDeps = {
    json: async (call) => {
      checkBudget();
      const meter = createUsageMeter();
      const run = () => completeJson({
        system: call.system,
        user: call.user,
        maxTokens: call.maxTokens,
        temperature: call.temperature,
        signal,
        requestClass: 'background',
      }, call.validate, model);
      const result = await withUsageMeter(job, () => withUsageMeter(meter, () => (call.mechanical
        ? withoutDocumentVisualPlanning(() => withResearchValidationThinking(model, run))
        : run())));
      // Transports that report no usage are counted from the text they carried.
      if (!meter.calls) withUsageMeter(job, () => recordEstimatedUsage((call.system.length + call.user.length) / 3.6, JSON.stringify(result).length / 3.6));
      return result;
    },
    embed: (texts) => embedMany(texts, signal),
    audit: async (markdown, sources) => {
      const audit = await withUsageMeter(job, () => withoutDocumentVisualPlanning(() => withResearchValidationThinking(model, () => auditor.audit(markdown, sources))));
      const removed = audit.claims.filter((claim) => claim.status !== 'supported' && !(claim.kind === 'nonfactual' && claim.failure !== 'nonfactual_with_content')).length;
      return { markdown: audit.markdown, removed };
    },
    conflicts: async (statements) => (await withUsageMeter(job, () => withoutDocumentVisualPlanning(() => findResearchConflicts(statements, model, signal))))
      .filter((conflict) => conflict.incompatible)
      .map((conflict) => ({ a: conflict.a, b: conflict.b, reason: conflict.reason })),
    cacheGet: (key) => getCompleteGuideCache(key),
    cachePut: (key, stage, value) => putCompleteGuideCache(key, stage, value),
    checkpointGet: (stage, unit) => getCompleteGuideUnit(config.runId, stage, unit),
    checkpointPut: (stage, unit, value) => { putCompleteGuideUnit(config.runId, stage, unit, value); setCompleteGuideRunStage(config.runId, stage); },
    hash: (value) => crypto.createHash('sha256').update(value).digest('hex'),
    progress: (event) => emit(progressEvent(event, language)),
    checkpoint: checkBudget,
  };

  const result = await runCompleteGuide({
    config,
    snapshot: frozen.snapshot,
    organization: frozen.organization,
    language,
    modelKey: model ? `${model.provider}/${model.model}` : 'default',
    promptVersion: COMPLETE_GUIDE_PROMPT_VERSION,
    instructions: config.instructions,
  }, deps);

  const words = result.markdown.split(/\s+/).filter(Boolean).length;
  const { runId, ...configWithoutRun } = config;
  const meta: CompleteGuideDraftMeta = {
    version: 1,
    runId,
    config: configWithoutRun,
    snapshotAt: frozen.snapshotAt,
    promptVersion: COMPLETE_GUIDE_PROMPT_VERSION,
    sources: result.coverage.map((row) => ({
      sourceKey: row.source.sourceKey, kind: row.source.kind, alias: row.source.alias, title: row.source.title, path: row.source.path,
      passagesTotal: row.passagesTotal, passagesRead: row.passagesRead, ...(row.source.pages ? { pages: row.source.pages } : {}),
      itemsExtracted: row.itemsExtracted, itemsUsed: row.itemsUsed, duplicates: row.duplicates, unreadRanges: row.unreadRanges,
    })),
    units: result.chapters.map((chapter) => ({ unitKey: chapter.unitKey, title: chapter.title, sections: chapter.sections.length, items: result.items.filter((item) => item.unitKey === chapter.unitKey).length })),
    counts: {
      items: result.counts.items, itemsUsed: result.counts.itemsUsed, blocks: result.counts.blocks, aiBlocks: result.counts.aiBlocks,
      windows: result.counts.windows, failedWindows: result.counts.failedWindows, auditedBlocks: result.counts.auditedBlocks,
      removedSentences: result.counts.removedSentences, repairedBlocks: result.counts.repairedBlocks, invalidLatex: result.counts.invalidLatex,
      conflicts: result.counts.conflicts, cacheHits: result.counts.cacheHits,
    },
    usage: { calls: job.calls, inputTokens: job.inputTokens, outputTokens: job.outputTokens, usd: usd(job, model) },
    warnings: result.warnings,
    cheatSheetMarkdown: result.cheatSheetMarkdown,
  };
  const draft: WritingWorkshopDraft = {
    generatedAt: new Date().toISOString(),
    brief: {
      kind: 'deep_research',
      objective: request.objective?.trim() || result.title,
      audience: request.audience,
      tone: 'academic',
      language,
      deepResearchVersion: request.deepResearchVersion ?? 'v2',
      studyReportMode: 'complete_guide',
    },
    selection: { ideaIds: [], themeIds: [], gapIds: [], contradictionIds: [], workIds: [], passageIds: [], tutorRouteIds: [] },
    title: result.title,
    abstract: result.abstract,
    outline: result.chapters.map((chapter) => ({
      id: chapter.unitKey,
      title: chapter.title,
      purpose: chapter.overview,
      keyClaims: chapter.sections.map((section) => section.title),
      sources: [],
    })),
    draftMarkdown: result.markdown,
    matrix: [],
    bibliography: result.bibliography,
    nextSteps: [],
    limitations: result.limitations,
    deepResearchStructure: 'sectioned',
    completeGuide: meta,
    stats: {
      selectedIdeas: result.counts.itemsUsed, selectedThemes: 0, selectedGaps: 0, selectedContradictions: 0,
      selectedWorks: frozen.snapshot.sources.length, selectedPassages: frozen.snapshot.totals.readablePassages, selectedTutorRoutes: 0,
      contextChars: frozen.snapshot.totals.chars, truncated: result.counts.failedWindows > 0,
    },
  };
  const reportMeta: DeepResearchMeta = {
    deepResearchVersion: request.deepResearchVersion ?? 'v2',
    structure: 'sectioned',
    sections: result.chapters.reduce((sum, chapter) => sum + chapter.sections.length, 0),
    words,
    pages: Math.max(1, Math.ceil(words / 450)),
    ideasCovered: result.counts.itemsUsed,
    ideasConsidered: result.counts.items,
    worksCited: result.coverage.filter((row) => row.itemsUsed > 0).length,
    stoppedReason: null,
    verification: null,
  };
  emit({ phase: 'done', message: result.title, wordsSoFar: words, pagesSoFar: reportMeta.pages });
  return {
    draft,
    meta: reportMeta,
    completeGuideArtifacts: {
      runId,
      items: result.items,
      chapters: result.chapters,
      syllabus: result.syllabus,
      sources: frozen.snapshot.sources,
      passages: frozen.snapshot.passages.map(({ id, sourceKey, locator }) => ({ id, sourceKey, locator })),
    },
  };
}
