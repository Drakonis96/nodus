import type { ModelRef } from '@shared/types';
import {
  annotateSpeciesSmiles,
  buildNameFeedbackRequest,
  buildRouteReviewRequest,
  buildRouteSteps,
  classifyCoProducts,
  countRouteSteps,
  declaresRacemic,
  findAnswerSpecies,
  findSmilesCandidates,
  findStepConditions,
  findStepNamedSpecies,
  findStepProse,
  formatNamedRouteFixPrompts,
  routeStepFailure,
  formatRouteAudit,
  formatRouteCheckUnavailable,
  formatStructureAudit,
  formatUnresolvedNameClarification,
  normalizeMoleculeDossier,
  normalizeRouteAudit,
  parseNameFeedback,
  parseRouteReview,
  ROUTE_NAME_FEEDBACK_SYSTEM,
  ROUTE_REVIEW_SYSTEM,
  type MoleculeDossier,
  type NamedSpecies,
  type NameFeedbackEntry,
  type ResolvedSpecies,
  type RouteAudit,
  type RouteStepAudit,
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
/** Each step is a full validated compile. The route checker refuses a plan with more than
 *  sixteen steps, so every step it accepted fits; keep the cap aligned so a long route never
 *  drops its tail — the final product step is the last one this could ever drop. */
const MAX_ROUTE_DRAWINGS = 16;

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
  /** A runner shared across the whole post-answer phase, so the capability worker is opened
   *  once. When absent each phase opens and closes its own. */
  runner?: Runner;
  /** Called with the deterministic report and drawings as soon as they exist, before the
   *  route review lands, so the reply can show them without waiting on the reviewer. */
  onDeterministic?: (text: string) => void;
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
  const { runner, dispose } = chemistryRunner(options);
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
    await dispose();
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

/** A runner lease for one phase. A caller-supplied shared runner is reused and this lease
 *  owns nothing; otherwise it owns a fresh runner and disposing stops it. Sharing opens the
 *  capability worker once per turn, so its reference cache serves the resolve pass and the
 *  route audit instead of paying for a second worker and a second network pass. */
export function chemistryRunner(options: InspectOptions): { runner: Runner; dispose: () => Promise<void> } {
  if (options.runner) return { runner: options.runner, dispose: async () => {} };
  const runner = createTrustedCapabilityRunner({
    locale: options.locale ?? 'en',
    model: options.model ?? null,
    pins: pinCapabilitiesForTurn(),
    signal: options.signal,
    ...(options.owner ? { owner: options.owner } : {}),
    runCoreStages: async (text) => text,
  });
  return { runner, dispose: async () => { await runner.dispose?.(); } };
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
  const { runner, dispose } = chemistryRunner(options);
  try {
    return await invokeRoute(runner, provider, steps, racemic, options.target);
  } catch {
    return null;
  } finally {
    await dispose();
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
  /** Species the model supplied as structures because no name would resolve, as prose, so the
   *  caller discloses that their structure came from the model, not a reference. */
  authorStructures: string[];
  /** True when the installed package has no resolve-names tool, so the caller falls back to
   *  the legacy reaction-line path. */
  legacy: boolean;
  /** Set when name resolution failed outright, so the caller says the route went unchecked. */
  error?: string;
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

const STRUCTURE_TOOL = 'resolve-structure';

/** A structure named by the reference service: the reverse of a name resolution. */
interface SpeciesStructureName {
  smiles: string;
  status: 'named' | 'unnamed';
  cid?: number;
  name?: string;
  formula?: string;
  canonicalSmiles?: string;
  feedback?: string;
}

/** True when the installed package can name a structure. Older packages only resolve names, so
 *  a structure the author supplies then keeps the author's SMILES with no name read back. */
function structureNamingAvailable(): boolean {
  const provider = capabilityRegistry().providers.get(CHEMISTRY_CAPABILITY);
  return Boolean(provider && provider.tools.some((tool) => tool.id === STRUCTURE_TOOL));
}

function normalizeStructureName(entry: unknown): SpeciesStructureName | null {
  const value = entry && typeof entry === 'object' ? entry as Record<string, unknown> : null;
  if (!value || typeof value.smiles !== 'string' || !value.smiles) return null;
  return {
    smiles: value.smiles.slice(0, 2000),
    status: value.status === 'named' ? 'named' : 'unnamed',
    ...(Number.isSafeInteger(value.cid) && (value.cid as number) > 0 ? { cid: value.cid as number } : {}),
    ...(typeof value.name === 'string' && value.name ? { name: value.name.slice(0, 300) } : {}),
    ...(typeof value.formula === 'string' && value.formula ? { formula: value.formula.slice(0, 200) } : {}),
    ...(typeof value.canonicalSmiles === 'string' && value.canonicalSmiles ? { canonicalSmiles: value.canonicalSmiles.slice(0, 2000) } : {}),
    ...(typeof value.feedback === 'string' && value.feedback ? { feedback: value.feedback.slice(0, 400) } : {}),
  };
}

async function invokeNameStructures(runner: Runner, provider: CapabilityProvider, smiles: string[]): Promise<SpeciesStructureName[]> {
  const result = await runner.invoke({ provider, toolId: STRUCTURE_TOOL, input: { smiles } });
  const artifact = (result.artifacts ?? []).find((entry) => entry.artifactType === 'structure-naming');
  const data = artifact?.data as { results?: unknown } | undefined;
  const list = Array.isArray(data?.results) ? data.results as unknown[] : [];
  return list.map(normalizeStructureName).filter((entry): entry is SpeciesStructureName => entry !== null);
}

/** Unresolved reactant/product names — the ones a step cannot be built without. An agent
 *  (catalyst or solvent) may have no resolvable name and is not chased. */
function unresolvedNames(speciesByStep: NamedSpecies[][], resolutions: Map<string, SpeciesResolution>): UnresolvedName[] {
  const out: UnresolvedName[] = [];
  speciesByStep.forEach((step, index) => {
    for (const entry of step) {
      if (entry.role === 'agent') continue;
      if (entry.declaredSmiles) continue; // the model already supplied a structure
      if (resolutions.get(entry.name)?.status === 'resolved') continue;
      const resolution = resolutions.get(entry.name);
      out.push({ step: index + 1, role: entry.role, byproduct: entry.byproduct, name: entry.name, ...(resolution?.feedback ? { feedback: resolution.feedback } : {}) });
    }
  });
  return out.slice(0, 24);
}

async function requestCorrectedNames(prose: string, unresolved: UnresolvedName[], options: InspectOptions): Promise<NameFeedbackEntry[]> {
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
async function requestRouteReview(question: string, labels: RouteSpeciesLabel[][], audit: RouteAudit, options: InspectOptions, stepProse: string[] = []): Promise<RouteReview | null> {
  try {
    const raw = await completeText({
      system: ROUTE_REVIEW_SYSTEM,
      user: buildRouteReviewRequest(question, labels, audit, stepProse),
      temperature: 0,
      maxTokens: 2000,
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
  const legacy: RouteResolutionOutcome = { answer: finalAnswer, steps: [], labels: [], consistent: true, corrections: [], authorStructures: [], legacy: true };
  if (options.enabled === false) return legacy;
  const provider = resolveProvider();
  if (!provider) return legacy;
  const stepCount = countRouteSteps(modelAnswer);
  if (!stepCount) return legacy;
  let speciesByStep = findStepNamedSpecies(modelAnswer, stepCount);
  if (!speciesByStep.some((step) => step.length)) return legacy;

  const { runner, dispose } = chemistryRunner(options);
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
      const renamed = new Map<string, string>();
      for (const entry of corrected) {
        if (entry.kind === 'structure') {
          // The model answered with a structure instead of a name — an exotic cage or a named
          // literature intermediate it cannot name. Keep the name as written and attach the
          // structure; the naming pass below reads a name back from PubChem when it can.
          speciesByStep = speciesByStep.map((step) => step.map((item) => item.name === entry.from ? { ...item, declaredSmiles: entry.to } : item));
          continue;
        }
        if (entry.from !== entry.to) corrections.push(`${entry.from} → ${entry.to}`);
        renamed.set(entry.from, entry.to);
      }
      if (renamed.size) {
        speciesByStep = speciesByStep.map((step) => step.map((entry) => renamed.has(entry.name) ? { ...entry, name: renamed.get(entry.name)! } : entry));
        await resolveAll([...renamed.values()]);
      }
    }

    // A species the model could only give as a structure: try to read a name back from PubChem,
    // so the route uses a real name where one exists. An unnamed structure keeps the author's
    // SMILES and is disclosed as author-supplied.
    const declaredSmiles = [...new Set(speciesByStep.flat().map((entry) => entry.declaredSmiles).filter((value): value is string => Boolean(value)))];
    const nameByStructure = new Map<string, SpeciesStructureName>();
    if (declaredSmiles.length && structureNamingAvailable()) {
      try {
        for (let start = 0; start < declaredSmiles.length; start += 48) {
          options.signal?.throwIfAborted();
          const named = await invokeNameStructures(runner, provider, declaredSmiles.slice(start, start + 48));
          for (const entry of named) nameByStructure.set(entry.smiles, entry);
        }
      } catch { /* naming is best effort; the declared structure stands */ }
    }

    const resolvedByStep: ResolvedSpecies[][] = speciesByStep.map((step) => classifyCoProducts(step.map((entry): ResolvedSpecies => {
      const resolution = resolutions.get(entry.name);
      if (resolution?.status === 'resolved' && resolution.smiles) {
        // The name is authoritative in the names-first path, and the resolver now returns the
        // canonical isomeric SMILES, so a model-declared writing is not compared here: an
        // equivalent SMILES written differently would otherwise look like a correction.
        return { ...entry, status: 'resolved' as const, smiles: resolution.smiles, source: resolution.source ?? 'pubchem', ...(resolution.formula ? { formula: resolution.formula } : {}) };
      }
      if (entry.declaredSmiles) {
        const named = nameByStructure.get(entry.declaredSmiles);
        const smiles = named?.canonicalSmiles ?? entry.declaredSmiles;
        return { ...entry, status: 'fallback' as const, smiles, source: 'declared' as const, ...(named?.status === 'named' && named.name ? { name: named.name } : {}), ...(named?.formula ? { formula: named.formula } : {}) };
      }
      return { ...entry, status: 'unresolved' as const, ...(resolution?.feedback ? { feedback: resolution.feedback } : {}) };
    })));

    const critical: UnresolvedName[] = [];
    resolvedByStep.forEach((step, index) => {
      for (const entry of step) {
        if (entry.role === 'agent' || entry.smiles) continue;
        critical.push({ step: index + 1, role: entry.role, byproduct: entry.byproduct, name: entry.name, ...(entry.feedback ? { feedback: entry.feedback } : {}) });
      }
    });

    const steps = buildRouteSteps(resolvedByStep);
    const labels: RouteSpeciesLabel[][] = resolvedByStep.map((step) => step.filter((entry) => entry.smiles).map((entry) => ({ role: entry.role, byproduct: entry.byproduct, name: entry.name, smiles: entry.smiles! })));
    const authorStructures = resolvedByStep.flat().filter((entry) => entry.status === 'fallback' && entry.smiles).map((entry) => `${entry.name} — \`${entry.smiles}\``);
    const annotated = `${annotateSpeciesSmiles(finalAnswer, resolvedByStep).trimEnd()}\n`;
    return {
      answer: annotated,
      steps,
      labels,
      consistent: critical.length === 0,
      corrections,
      authorStructures,
      ...(critical.length ? { clarification: formatUnresolvedNameClarification(critical, options.target) } : {}),
      legacy: false,
    };
  } catch (error) {
    if (options.signal?.aborted) return legacy;
    return { ...legacy, error: error instanceof Error ? error.message : 'name resolution failed' };
  } finally {
    await dispose();
  }
}

/** How many step drawings compile at once. Each compile forks its own RDKit subworker, so a
 *  small pool hides the RDKit load without thrashing the machine. */
const DRAW_CONCURRENCY = 2;

/** One reaction scheme from the compile tool, rendered for the answer, or null when the tool
 *  produced no view. A stored reference and its inline view would each render the same
 *  drawing, so only the view is kept. */
async function drawReaction(runner: Runner, provider: CapabilityProvider, reactionSmiles: string, extra: { conditions?: string; racemic?: boolean } = {}): Promise<string | null> {
  const plan = JSON.stringify({ version: 2, kind: 'reaction', depiction: 'skeletal', reactionSmiles, openStereo: true, ...extra });
  const result = await runner.invoke({ provider, toolId: COMPILE_TOOL, input: { plan, question: reactionSmiles } });
  const artifact = (result.artifacts ?? []).find((entry) => entry.artifactType === 'chemistry-document');
  return artifact?.view ? runner.renderView({ provider, view: artifact.view as ViewDocumentV1 }) : null;
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
  const drawable: RouteStepAudit[] = [];
  const skipped: string[] = [];
  for (const step of audit.steps) {
    // The same verdict as the route report, so a step the report marks FAIL (an assembly
    // problem included) is never drawn.
    const reason = routeStepFailure(step) ?? '';
    if (reason) { skipped.push(`- Step ${step.index + 1} — ${reason}`); continue; }
    if (drawable.length >= MAX_ROUTE_DRAWINGS) { skipped.push(`- Step ${step.index + 1} — not drawn (limit of ${MAX_ROUTE_DRAWINGS} reached)`); continue; }
    drawable.push(step);
  }
  const figures: Array<{ index: number; view: string } | null> = new Array(drawable.length).fill(null);
  let cursor = 0;
  const run = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= drawable.length) return;
      const step = drawable[index];
      options.signal?.throwIfAborted();
      const reactionSmiles = steps[step.index];
      try {
        // The step's "Reagents and conditions:" prose is the only source for temperature,
        // time and workup; the plugin sanitizes it to arrow text and drops it rather than
        // fail the drawing. Empty when the model wrote no such line.
        const condition = conditions[step.index] ?? '';
        // The route checker already accepted this step, so draw its open centres as
        // unspecified rather than refusing — a step whose only open centre is on a reactant
        // (a purchased input) must still render. A declared-racemic product keeps its flag.
        const view = await drawReaction(runner, provider, reactionSmiles, { ...(condition ? { conditions: condition } : {}), ...(step.racemic ? { racemic: true } : {}) });
        if (!view) { skipped.push(`- Step ${step.index + 1} — the verified drawing could not be produced`); continue; }
        figures[index] = { index: step.index, view };
      } catch (error) {
        skipped.push(`- Step ${step.index + 1} — ${error instanceof Error ? error.message : 'could not be drawn'}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(DRAW_CONCURRENCY, drawable.length) }, run));
  const ordered = figures.filter((figure): figure is { index: number; view: string } => figure !== null);
  // Nothing drawable is not a drawings section; the route report already says why each
  // step was refused.
  if (!ordered.length) return '';
  // Label each scheme with the step it is, so the drawings line up with the report and the
  // "Fix step N" chips instead of floating unlabelled under the route.
  const lines = ['### Route drawings (RDKit)', '', ...ordered.flatMap((figure) => [`**Step ${figure.index + 1}**`, '', figure.view, ''])];
  if (skipped.length) lines.push('Not drawn:', ...skipped);
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
  // The names-first path derives the equations from the resolved names and passes them in.
  const steps = overrides.steps ?? [];
  const labels = overrides.labels ?? [];
  if (!steps.length || !labels.some((entries) => entries.length)) return finalAnswer;
  const conditions = findStepConditions(modelAnswer, steps.length);
  const stepProse = findStepProse(modelAnswer, steps.length);
  const racemic = declaresRacemic(modelAnswer);
  const provider = routeProvider();
  if (!provider) return finalAnswer;
  const compile = compileProvider();
  const { runner, dispose } = chemistryRunner(options);
  try {
    const audit = await invokeRoute(runner, provider, steps, racemic, options.target, labels);
    if (!audit) return `${finalAnswer.trimEnd()}\n\n${formatRouteCheckUnavailable('the chemistry package returned no route audit')}\n`;
    // One model review looks for plan problems the checker cannot see (prose vs names, a
    // product that is a different compound, a step that cannot work, a redundant step). It is
    // blocking: a finding marks the route not verified. An unreadable reply never blocks. It
    // runs while the drawings compile, so the reviewer and the drawings overlap.
    const reviewPromise = requestRouteReview(options.question ?? '', labels, audit, options, stepProse);
    const drawings = compile ? await drawRouteSteps(runner, compile, steps, conditions, audit, options) : '';
    // Paint the deterministic report and drawings before the reviewer returns. The transport
    // replaces the provisional stream with this returned answer, so the route only waits on
    // the reviewer when the reviewer is the last thing outstanding.
    if (options.onDeterministic) options.onDeterministic(`${finalAnswer.trimEnd()}\n\n${formatRouteAudit(audit, labels, null, true)}\n${drawings}`);
    const review = await reviewPromise;
    const report = formatRouteAudit(audit, labels, review);
    // A refusal the checker can name and the app cannot fix is offered back to the model as one
    // click: names and roles only — the model never authored the derived SMILES.
    const fix = formatNamedRouteFixPrompts(labels, audit, review);
    return `${finalAnswer.trimEnd()}\n\n${report}\n${drawings}${fix ? `\n${fix}\n` : ''}`;
  } catch (error) {
    if (options.signal?.aborted) return finalAnswer;
    return `${finalAnswer.trimEnd()}\n\n${formatRouteCheckUnavailable(error instanceof Error ? error.message : 'the route check failed')}\n`;
  } finally {
    await dispose();
  }
}
