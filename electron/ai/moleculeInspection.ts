import type { ModelRef } from '@shared/types';
import {
  annotateSpeciesSmiles,
  buildNameFeedbackRequest,
  buildRouteConsistencyRequest,
  buildRouteRepairRequest,
  buildRouteReviewRequest,
  buildRouteSteps,
  countRouteSteps,
  declaresRacemic,
  findAnswerSpecies,
  findDuplicateRoleProblems,
  findReactionLines,
  findSmilesCandidates,
  findStepConditions,
  findStepEquationProblems,
  findStepNamedSpecies,
  findStepSpeciesLabels,
  formatNamedRouteFixPrompts,
  formatRouteAudit,
  formatRouteClarification,
  formatRouteFixPrompt,
  formatStructureAudit,
  formatUnresolvedNameClarification,
  hasCheckerScaffolding,
  normalizeMoleculeDossier,
  normalizeRouteAudit,
  parseNameFeedback,
  parseRouteConsistencyVerdict,
  parseRouteReview,
  ROUTE_CONSISTENCY_SYSTEM,
  ROUTE_NAME_FEEDBACK_SYSTEM,
  ROUTE_REPAIR_SYSTEM,
  ROUTE_REVIEW_SYSTEM,
  type MoleculeDossier,
  type NamedSpecies,
  type ResolvedSpecies,
  type RouteAudit,
  type RouteConsistencyVerdict,
  type RouteReview,
  type RouteSpeciesLabel,
  type UnresolvedName,
} from '@shared/moleculeInspection';
import { capabilityRegistry, pinCapabilitiesForTurn, type CapabilityProvider } from '../capabilities/registry';
import { createTrustedCapabilityRunner } from '../capabilities/runner';
import { completeText } from './aiClient';
import type { ViewDocumentV1 } from '../../packages/capability-api/src/views';

/** The read-only inspection tool Chemistry Studio must declare. When an older package
 *  only exposes `compile`, these steps are skipped and Research Chat behaves as before. */
const CHEMISTRY_CAPABILITY = 'nodus:chemistry';
const INSPECT_TOOL = 'inspect';
const ROUTE_TOOL = 'verify-route';
const COMPILE_TOOL = 'compile';
const MAX_BATCH = 24;
/** Each step is a full validated compile; stop before a long route stalls the turn. */
const MAX_ROUTE_DRAWINGS = 8;

interface InspectOptions {
  model?: ModelRef | null;
  locale?: string;
  signal?: AbortSignal;
  enabled?: boolean;
  /** The conversation that owns stored artifacts, when the chat is saved. */
  owner?: string;
  /** The requested target as SMILES; the route check then requires the route to form it. */
  target?: string | null;
  /** The researcher's request, given to the route review as context. */
  question?: string;
}

function inspectProvider() {
  const provider = capabilityRegistry().providers.get(CHEMISTRY_CAPABILITY);
  return provider && provider.tools.some((tool) => tool.id === INSPECT_TOOL) ? provider : null;
}

/** True when the enabled Chemistry Studio package exposes the read-only inspector. */
export function moleculeInspectionAvailable(): boolean {
  return inspectProvider() !== null;
}

async function inspectCandidates(candidates: string[], options: InspectOptions): Promise<MoleculeDossier[]> {
  if (!candidates.length) return [];
  const provider = inspectProvider();
  if (!provider) return [];
  const runner = createTrustedCapabilityRunner({
    locale: options.locale ?? 'en',
    model: options.model ?? null,
    pins: pinCapabilitiesForTurn(),
    signal: options.signal,
    runCoreStages: async (text) => text,
  });
  const dossiers: MoleculeDossier[] = [];
  try {
    for (let start = 0; start < candidates.length; start += MAX_BATCH) {
      options.signal?.throwIfAborted();
      const batch = candidates.slice(start, start + MAX_BATCH);
      try {
        const result = await runner.invoke({ provider, toolId: INSPECT_TOOL, input: { smiles: batch } });
        for (const artifact of result.artifacts ?? []) {
          const data = artifact.data as Record<string, unknown> | null;
          const inputSmiles = data && typeof data.inputSmiles === 'string' ? data.inputSmiles : '';
          const dossier = normalizeMoleculeDossier(data, inputSmiles);
          if (dossier) dossiers.push(dossier);
        }
      } catch {
        /* one unparseable batch must not block the answer */
      }
    }
  } finally {
    await runner.dispose?.();
  }
  return dossiers;
}

/** Verifies the SMILES in the user's question before the model answers, so the target
 *  is a checked graph rather than text the model has to re-read. */
export async function inspectResearchMolecules(
  question: string,
  options: InspectOptions = {},
): Promise<MoleculeDossier[]> {
  if (options.enabled === false) return [];
  return inspectCandidates(findSmilesCandidates(question), options);
}

/** Non-blocking post-answer check: parses every species the model proposed and appends a
 *  deterministic RDKit report. Never rewrites the answer and never asks the model again. */
export async function appendStructureAudit(
  finalAnswer: string,
  modelAnswer: string,
  options: InspectOptions = {},
): Promise<string> {
  if (options.enabled === false || !moleculeInspectionAvailable()) return finalAnswer;
  const species = findAnswerSpecies(modelAnswer);
  if (!species.length) return finalAnswer;
  const dossiers = await inspectCandidates(species, options);
  // A tool failure must not present every species as unparseable; only report when at
  // least one structure was actually verified.
  if (!dossiers.length) return finalAnswer;
  return `${finalAnswer.trimEnd()}\n\n${formatStructureAudit(species, dossiers)}\n`;
}

function routeProvider() {
  const provider = capabilityRegistry().providers.get(CHEMISTRY_CAPABILITY);
  return provider && provider.tools.some((tool) => tool.id === ROUTE_TOOL) ? provider : null;
}

function compileProvider() {
  const provider = capabilityRegistry().providers.get(CHEMISTRY_CAPABILITY);
  return provider && provider.tools.some((tool) => tool.id === COMPILE_TOOL) ? provider : null;
}

/** True when the enabled Chemistry Studio package exposes the read-only route checker. */
export function routeVerificationAvailable(): boolean {
  return routeProvider() !== null;
}

function chemistryRunner(options: InspectOptions) {
  return createTrustedCapabilityRunner({
    locale: options.locale ?? 'en',
    model: options.model ?? null,
    pins: pinCapabilitiesForTurn(),
    signal: options.signal,
    ...(options.owner ? { owner: options.owner } : {}),
    runCoreStages: async (text) => text,
  });
}

type Runner = ReturnType<typeof createTrustedCapabilityRunner>;

/** Whether the installed package declares the `labels` field, so an older package is not
 *  sent an input its schema would reject. */
function routeAcceptsLabels(provider: CapabilityProvider): boolean {
  const schema = provider.tools.find((tool) => tool.id === ROUTE_TOOL)?.inputSchema as { properties?: Record<string, unknown> } | undefined;
  return Boolean(schema?.properties && 'labels' in schema.properties);
}

async function invokeRoute(runner: Runner, provider: CapabilityProvider, steps: string[], racemic?: boolean, target?: string | null, labels?: RouteSpeciesLabel[][]): Promise<RouteAudit | null> {
  // A package that predates `target`/`labels` ignores them, and the audit simply has no
  // target entry or name check. The schema probe keeps a 2.3.0 package from rejecting an
  // input it never declared.
  const named = labels && labels.some((entries) => entries.length);
  const input = {
    steps,
    ...(racemic ? { racemic } : {}),
    ...(target ? { target } : {}),
    ...(named && routeAcceptsLabels(provider) ? { labels } : {}),
  };
  const result = await runner.invoke({ provider, toolId: ROUTE_TOOL, input });
  const artifact = (result.artifacts ?? []).find((entry) => entry.artifactType === 'route-audit');
  return artifact ? normalizeRouteAudit(artifact.data) : null;
}

async function verifyRouteSteps(steps: string[], options: InspectOptions, racemic?: boolean): Promise<RouteAudit | null> {
  if (!steps.length) return null;
  const provider = routeProvider();
  if (!provider) return null;
  const runner = chemistryRunner(options);
  try {
    return await invokeRoute(runner, provider, steps, racemic, options.target);
  } catch {
    return null;
  } finally {
    await runner.dispose?.();
  }
}

/** Verifies a whole synthesis route: every equation balanced and every intermediate the
 *  same RDKit-canonical molecule from one step to the next. */
export async function verifySynthesisRoute(steps: string[], options: InspectOptions = {}): Promise<RouteAudit | null> {
  if (options.enabled === false) return null;
  return verifyRouteSteps(steps, options);
}

// ------------------------------------------------- name-first route (resolve names → derive)

const RESOLVE_TOOL = 'resolve-names';
/** How many times an unresolved name is sent back to the model for correction. */
const NAME_FEEDBACK_ATTEMPTS = 2;

interface SpeciesResolution {
  name: string;
  status: 'resolved' | 'ambiguous' | 'unresolved';
  smiles?: string;
  formula?: string;
  source?: 'pubchem' | 'opsin';
  feedback?: string;
}

export interface RouteResolutionOutcome {
  answer: string;
  steps: string[];
  labels: RouteSpeciesLabel[][];
  consistent: boolean;
  clarification?: string;
  /** One line per name the resolver corrected, e.g. "old → new"; empty when nothing changed. */
  corrections: string[];
  /** True when the installed package has no resolve-names tool, so the caller falls back to
   *  the legacy reaction-line path. */
  legacy: boolean;
}

function resolveProvider() {
  const provider = capabilityRegistry().providers.get(CHEMISTRY_CAPABILITY);
  return provider && provider.tools.some((tool) => tool.id === RESOLVE_TOOL) ? provider : null;
}

/** True when the enabled Chemistry Studio package can resolve names to structures. */
export function nameResolutionAvailable(): boolean {
  return resolveProvider() !== null;
}

function normalizeSpeciesResolution(entry: unknown): SpeciesResolution | null {
  const value = entry && typeof entry === 'object' ? entry as Record<string, unknown> : null;
  if (!value || typeof value.name !== 'string') return null;
  const status = value.status;
  if (status !== 'resolved' && status !== 'ambiguous' && status !== 'unresolved') return null;
  return {
    name: value.name.slice(0, 200),
    status,
    ...(typeof value.smiles === 'string' && value.smiles ? { smiles: value.smiles.slice(0, 2000) } : {}),
    ...(typeof value.formula === 'string' ? { formula: value.formula.slice(0, 200) } : {}),
    ...(value.source === 'pubchem' || value.source === 'opsin' ? { source: value.source } : {}),
    ...(typeof value.feedback === 'string' && value.feedback ? { feedback: value.feedback.slice(0, 400) } : {}),
  };
}

async function invokeResolveNames(runner: Runner, provider: CapabilityProvider, names: string[]): Promise<SpeciesResolution[]> {
  const result = await runner.invoke({ provider, toolId: RESOLVE_TOOL, input: { names } });
  const artifact = (result.artifacts ?? []).find((entry) => entry.artifactType === 'species-resolution');
  const data = artifact?.data as { results?: unknown } | undefined;
  const list = Array.isArray(data?.results) ? data.results as unknown[] : [];
  return list.map(normalizeSpeciesResolution).filter((entry): entry is SpeciesResolution => entry !== null);
}

/** Unresolved reactant/product names — the ones a step cannot be built without. An agent
 *  (catalyst or solvent) may have no resolvable name and is not chased. */
function unresolvedNames(speciesByStep: NamedSpecies[][], resolutions: Map<string, SpeciesResolution>): UnresolvedName[] {
  const out: UnresolvedName[] = [];
  speciesByStep.forEach((step, index) => {
    for (const entry of step) {
      if (entry.role === 'agent') continue;
      if (resolutions.get(entry.name)?.status === 'resolved') continue;
      const resolution = resolutions.get(entry.name);
      out.push({ step: index + 1, role: entry.role, byproduct: entry.byproduct, name: entry.name, ...(resolution?.feedback ? { feedback: resolution.feedback } : {}) });
    }
  });
  return out.slice(0, 24);
}

async function requestCorrectedNames(prose: string, unresolved: UnresolvedName[], options: InspectOptions): Promise<Array<{ from: string; to: string }>> {
  try {
    const raw = await completeText({
      system: ROUTE_NAME_FEEDBACK_SYSTEM,
      user: buildNameFeedbackRequest(unresolved, prose),
      temperature: 0,
      maxTokens: 1600,
    }, options.model ?? null);
    return parseNameFeedback(raw);
  } catch {
    return [];
  }
}

/** One model review of the route plan: the problems a balance and continuity check cannot
 *  see. Defensive — an unreadable reply yields no review, so it never blocks a route. */
async function requestRouteReview(question: string, labels: RouteSpeciesLabel[][], audit: RouteAudit, options: InspectOptions): Promise<RouteReview | null> {
  try {
    const raw = await completeText({
      system: ROUTE_REVIEW_SYSTEM,
      user: buildRouteReviewRequest(question, labels, audit),
      temperature: 0,
      maxTokens: 1200,
      ...(options.signal ? { signal: options.signal } : {}),
    }, options.model ?? null);
    return parseRouteReview(raw);
  } catch {
    return null;
  }
}

/** The names-only route: resolve every species name to a structure (PubChem first, OPSIN
 *  fallback), send unresolved reactant/product names back to the model for correction up to
 *  `NAME_FEEDBACK_ATTEMPTS` times, derive the `reactants>agents>products` lines from the
 *  resolved structures, and attach the derived SMILES to the answer in place. A model-authored
 *  SMILES is used only when a name cannot be resolved. */
export async function resolveNamedRoute(
  finalAnswer: string,
  modelAnswer: string,
  options: InspectOptions = {},
): Promise<RouteResolutionOutcome> {
  const legacy: RouteResolutionOutcome = { answer: finalAnswer, steps: [], labels: [], consistent: true, corrections: [], legacy: true };
  if (options.enabled === false) return legacy;
  const provider = resolveProvider();
  if (!provider) return legacy;
  const stepCount = countRouteSteps(modelAnswer);
  if (!stepCount) return legacy;
  let speciesByStep = findStepNamedSpecies(modelAnswer, stepCount);
  if (!speciesByStep.some((step) => step.length)) return legacy;

  const runner = chemistryRunner(options);
  try {
    const resolutions = new Map<string, SpeciesResolution>();
    const corrections: string[] = [];
    // The plugin resolves at most 48 names per call; chunk so a long route is fully resolved
    // instead of leaving the tail silently unresolved.
    const resolveAll = async (names: string[]): Promise<void> => {
      const missing = [...new Set(names)].filter((name) => name && !resolutions.has(name));
      for (let start = 0; start < missing.length; start += 48) {
        options.signal?.throwIfAborted();
        const results = await invokeResolveNames(runner, provider, missing.slice(start, start + 48));
        for (const entry of results) resolutions.set(entry.name, entry);
      }
      for (const name of missing) if (!resolutions.has(name)) resolutions.set(name, { name, status: 'unresolved', feedback: 'No resolution was returned.' });
    };
    await resolveAll(speciesByStep.flatMap((step) => step.map((entry) => entry.name)));

    for (let attempt = 0; attempt < NAME_FEEDBACK_ATTEMPTS; attempt += 1) {
      const unresolved = unresolvedNames(speciesByStep, resolutions);
      if (!unresolved.length) break;
      options.signal?.throwIfAborted();
      const corrected = await requestCorrectedNames(modelAnswer, unresolved, options);
      if (!corrected.length) break;
      const renamed = new Map(corrected.map((entry) => [entry.from, entry.to]));
      for (const [from, to] of renamed) if (from !== to) corrections.push(`${from} → ${to}`);
      speciesByStep = speciesByStep.map((step) => step.map((entry) => renamed.has(entry.name) ? { ...entry, name: renamed.get(entry.name)! } : entry));
      await resolveAll([...renamed.values()]);
    }

    const resolvedByStep: ResolvedSpecies[][] = speciesByStep.map((step) => step.map((entry) => {
      const resolution = resolutions.get(entry.name);
      if (resolution?.status === 'resolved' && resolution.smiles) {
        if (entry.declaredSmiles && entry.declaredSmiles !== resolution.smiles) corrections.push(`${entry.name}: \`${entry.declaredSmiles}\` → \`${resolution.smiles}\``);
        return { ...entry, status: 'resolved' as const, smiles: resolution.smiles, source: resolution.source ?? 'pubchem', ...(resolution.formula ? { formula: resolution.formula } : {}) };
      }
      if (entry.declaredSmiles) return { ...entry, status: 'fallback' as const, smiles: entry.declaredSmiles, source: 'declared' as const };
      return { ...entry, status: 'unresolved' as const, ...(resolution?.feedback ? { feedback: resolution.feedback } : {}) };
    }));

    const critical: UnresolvedName[] = [];
    resolvedByStep.forEach((step, index) => {
      for (const entry of step) {
        if (entry.role === 'agent' || entry.smiles) continue;
        critical.push({ step: index + 1, role: entry.role, byproduct: entry.byproduct, name: entry.name, ...(entry.feedback ? { feedback: entry.feedback } : {}) });
      }
    });

    const steps = buildRouteSteps(resolvedByStep);
    const labels: RouteSpeciesLabel[][] = resolvedByStep.map((step) => step.filter((entry) => entry.smiles).map((entry) => ({ role: entry.role, byproduct: entry.byproduct, name: entry.name, smiles: entry.smiles! })));
    const annotated = `${annotateSpeciesSmiles(finalAnswer, resolvedByStep).trimEnd()}\n`;
    return {
      answer: annotated,
      steps,
      labels,
      consistent: critical.length === 0,
      corrections,
      ...(critical.length ? { clarification: formatUnresolvedNameClarification(critical) } : {}),
      legacy: false,
    };
  } catch {
    return legacy;
  } finally {
    await runner.dispose?.();
  }
}

// ------------------------------------------------- name/prose consistency (legacy gate)

/** How many times the route may be sent back to the model for a name/SMILES rewrite. */
const CONSISTENCY_ATTEMPTS = 2;

export interface RouteConsistencyOutcome {
  answer: string;
  /** False when the gate could not be resolved automatically. The route is still returned
   *  and rendered; `clarification` is a `nodus-route-fix` fence the caller appends after the
   *  route report, so a name disagreement annotates the answer instead of hiding it. */
  consistent: boolean;
  /** The one-click clarification, present only when `consistent` is false. */
  clarification?: string;
}

/** One model call comparing every named species' IUPAC name and SMILES to the step prose.
 *  An unreadable reply returns null, which the caller treats as "not checked" rather than a
 *  fabricated failure. */
async function checkRouteConsistency(
  answer: string,
  steps: string[],
  labels: RouteSpeciesLabel[][],
  options: InspectOptions,
): Promise<RouteConsistencyVerdict | null> {
  try {
    const raw = await completeText({
      system: ROUTE_CONSISTENCY_SYSTEM,
      user: buildRouteConsistencyRequest(answer, steps, labels),
      temperature: 0,
      maxTokens: 1400,
    }, options.model ?? null);
    return parseRouteConsistencyVerdict(raw);
  } catch {
    return null;
  }
}

/** One model call rewriting only the names and reaction SMILES so they agree with the fixed
 *  prose. Returns the corrected answer, or the model's ambiguity question. */
async function repairRouteConsistency(
  answer: string,
  steps: string[],
  labels: RouteSpeciesLabel[][],
  verdict: RouteConsistencyVerdict,
  options: InspectOptions,
): Promise<{ text: string } | { ambiguous: string } | null> {
  try {
    const raw = await completeText({
      system: ROUTE_REPAIR_SYSTEM,
      user: buildRouteRepairRequest(answer, steps, labels, verdict),
      temperature: 0,
      maxTokens: 6000,
    }, options.model ?? null);
    const text = raw.trim();
    if (!text) return null;
    const ambiguous = /^AMBIGUOUS\b\s*:?\s*/i.exec(text);
    if (ambiguous) return { ambiguous: text.slice(ambiguous[0].length).trim().slice(0, 1200) };
    // A repair that echoes our own request, or loses the reaction lines, is not an answer;
    // treating it as no repair keeps the original text instead of pasting the request into it.
    if (hasCheckerScaffolding(text)) return null;
    return findReactionLines(text).length ? { text } : null;
  } catch {
    return null;
  }
}

/** The name/prose gate that runs before any of the other chemistry checks. When the answer
 *  names its species, every IUPAC name and isomeric SMILES must denote the structure the
 *  step prose describes; a disagreement is rewritten up to `CONSISTENCY_ATTEMPTS` times and
 *  otherwise becomes a one-click clarification. An answer with no names, or one where no
 *  model is available to check, is passed through untouched. */
export async function ensureRouteConsistency(
  finalAnswer: string,
  modelAnswer: string,
  options: InspectOptions = {},
): Promise<RouteConsistencyOutcome> {
  if (options.enabled === false) return { answer: finalAnswer, consistent: true };
  let steps = findReactionLines(modelAnswer);
  if (!steps.length) return { answer: finalAnswer, consistent: true };
  let labels = findStepSpeciesLabels(modelAnswer, steps.length);
  if (!labels.some((entries) => entries.length)) return { answer: finalAnswer, consistent: true };

  let answer = finalAnswer;
  let current = modelAnswer;
  for (let attempt = 0; attempt <= CONSISTENCY_ATTEMPTS; attempt += 1) {
    options.signal?.throwIfAborted();
    // A structure listed under two roles, or a species in the species list that is not in
    // the step's reaction line (or vice versa), is a deterministic failure; every other
    // disagreement is semantic and needs the model to read the prose.
    const deterministic = [...findDuplicateRoleProblems(labels), ...findStepEquationProblems(steps, labels)];
    const verdict: RouteConsistencyVerdict | null = deterministic.length
      ? { status: 'mismatch', problems: deterministic }
      : await checkRouteConsistency(current, steps, labels, options);
    // No verdict is a transport/shape failure, not a chemical disagreement: fail open.
    if (!verdict || verdict.status === 'ok') return { answer, consistent: true };
    // The clarification is returned beside the answer, not spliced into it: the route is still
    // checked and drawn by the caller, so a name disagreement annotates rather than hides it.
    if (verdict.status === 'ambiguous' || attempt === CONSISTENCY_ATTEMPTS) {
      return { answer, consistent: false, clarification: formatRouteClarification(verdict.problems, verdict.question) };
    }
    const repaired = await repairRouteConsistency(current, steps, labels, verdict, options);
    if (!repaired) {
      return { answer, consistent: false, clarification: formatRouteClarification(verdict.problems, verdict.question) };
    }
    if ('ambiguous' in repaired) {
      return { answer, consistent: false, clarification: formatRouteClarification(verdict.problems, repaired.ambiguous) };
    }
    // Only the route is rewritten; if the repair loses the named species there is nothing
    // left to check and the corrected answer stands on its own.
    current = repaired.text;
    answer = repaired.text;
    steps = findReactionLines(current);
    if (!steps.length) return { answer, consistent: true };
    labels = findStepSpeciesLabels(current, steps.length);
    if (!labels.some((entries) => entries.length)) return { answer, consistent: true };
  }
  return { answer, consistent: true };
}

/** Draws every step the checker accepted, in order, on the runner already opened for the
 *  route check. A step the checker refused is never auto-drawn: the verified lane abstains
 *  for it and its fallback picture is unchecked, so it gets a deterministic note instead. */
async function drawRouteSteps(
  runner: Runner,
  provider: CapabilityProvider,
  steps: string[],
  conditions: string[],
  audit: RouteAudit,
  options: InspectOptions,
): Promise<string> {
  const figures: string[] = [];
  const skipped: string[] = [];
  let drawn = 0;
  for (const step of audit.steps) {
    const reason = !step.ok
      ? step.error ?? 'could not be parsed'
      : step.nameProblems?.length
        ? `name check failed (${step.nameProblems.join('; ')})`
        : step.balanced !== true
          ? `not balanced (${step.differences.join('; ')})`
          : step.unspecifiedStereocentres > 0 && step.racemic !== true
            ? `${step.unspecifiedStereocentres} unspecified stereocentre(s) or double bond(s)`
            : '';
    if (reason) { skipped.push(`- Step ${step.index + 1} — ${reason}`); continue; }
    if (drawn >= MAX_ROUTE_DRAWINGS) { skipped.push(`- Step ${step.index + 1} — not drawn (limit of ${MAX_ROUTE_DRAWINGS} reached)`); continue; }
    options.signal?.throwIfAborted();
    const reactionSmiles = steps[step.index];
    try {
      // The step's "Reagents and conditions:" prose is the only source for temperature,
      // time and workup; the plugin sanitizes it to arrow text and drops it rather than
      // fail the drawing. Empty when the model wrote no such line.
      const condition = conditions[step.index] ?? '';
      // A declared-racemic step has open centres by design, so tell the renderer to draw it
      // with them unspecified instead of refusing the unspecified stereocentre.
      const plan = JSON.stringify({ version: 2, kind: 'reaction', depiction: 'skeletal', reactionSmiles, ...(condition ? { conditions: condition } : {}), ...(step.racemic ? { racemic: true } : {}) });
      const result = await runner.invoke({ provider, toolId: COMPILE_TOOL, input: { plan, question: reactionSmiles } });
      const artifact = (result.artifacts ?? []).find((entry) => entry.artifactType === 'chemistry-document');
      // One block per step. A stored reference and its inline view would each render the
      // same drawing, so the route shows the view alone.
      if (!artifact?.view) { skipped.push(`- Step ${step.index + 1} — the verified drawing could not be produced`); continue; }
      figures.push(runner.renderView({ provider, view: artifact.view as ViewDocumentV1 }));
      drawn += 1;
    } catch (error) {
      skipped.push(`- Step ${step.index + 1} — ${error instanceof Error ? error.message : 'could not be drawn'}`);
    }
  }
  // Nothing drawable is not a drawings section; the route report already says why each
  // step was refused.
  if (!figures.length) return '';
  const lines = ['### Route drawings (RDKit)', '', ...figures];
  if (skipped.length) lines.push('', 'Not drawn:', ...skipped);
  return `\n${lines.join('\n')}\n`;
}

/** The post-answer route check, then one drawing per verified step. Neither rewrites the
 *  answer nor asks the model again; a step the checker refused is reported, not drawn. */
export async function appendRouteReportAndDrawings(
  finalAnswer: string,
  modelAnswer: string,
  options: InspectOptions = {},
  overrides: { steps?: string[]; labels?: RouteSpeciesLabel[][] } = {},
): Promise<string> {
  if (options.enabled === false || !routeVerificationAvailable()) return finalAnswer;
  // The name-first path derives the equations from resolved names and passes them in; the
  // legacy path parses reaction lines the model wrote itself.
  const steps = overrides.steps?.length ? overrides.steps : findReactionLines(modelAnswer);
  if (!steps.length) return finalAnswer;
  const conditions = findStepConditions(modelAnswer, steps.length);
  const labels = overrides.labels ?? findStepSpeciesLabels(modelAnswer, steps.length);
  const racemic = declaresRacemic(modelAnswer);
  const provider = routeProvider();
  if (!provider) return finalAnswer;
  const compile = compileProvider();
  const runner = chemistryRunner(options);
  try {
    const audit = await invokeRoute(runner, provider, steps, racemic, options.target, labels);
    if (!audit) return finalAnswer;
    // When the route was derived from names, one model review looks for plan problems the
    // checker cannot see (prose vs names, a product that is a different compound, a step that
    // cannot work, a redundant step). It is blocking: a finding marks the route not verified.
    // An unreadable reply yields no review and never blocks.
    const named = Boolean(overrides.labels?.some((entries) => entries.length));
    const review = named ? await requestRouteReview(options.question ?? '', labels, audit, options) : null;
    const report = formatRouteAudit(audit, labels, review);
    const drawings = compile ? await drawRouteSteps(runner, compile, steps, conditions, audit, options) : '';
    // A refusal the checker can name and the app cannot fix is offered back to the model as
    // one click: it proposes a corrected step, and this same path checks and draws it again.
    // When the route was derived from names, the correction speaks names and roles only — the
    // model never authored the derived SMILES, so it is not asked to rewrite one.
    const fix = named ? formatNamedRouteFixPrompts(labels, audit, review) : formatRouteFixPrompt(steps, audit);
    return `${finalAnswer.trimEnd()}\n\n${report}\n${drawings}${fix ? `\n${fix}\n` : ''}`;
  } catch {
    return finalAnswer;
  } finally {
    await runner.dispose?.();
  }
}
