import type { ModelRef } from '@shared/types';
import {
  declaresRacemic,
  findAnswerSpecies,
  findReactionLines,
  findSmilesCandidates,
  findStepConditions,
  formatRouteAudit,
  formatRouteFixPrompt,
  formatStructureAudit,
  normalizeMoleculeDossier,
  normalizeRouteAudit,
  type MoleculeDossier,
  type RouteAudit,
} from '@shared/moleculeInspection';
import { capabilityRegistry, pinCapabilitiesForTurn, type CapabilityProvider } from '../capabilities/registry';
import { createTrustedCapabilityRunner } from '../capabilities/runner';
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

async function invokeRoute(runner: Runner, provider: CapabilityProvider, steps: string[], racemic?: boolean): Promise<RouteAudit | null> {
  const result = await runner.invoke({ provider, toolId: ROUTE_TOOL, input: { steps, ...(racemic ? { racemic } : {}) } });
  const artifact = (result.artifacts ?? []).find((entry) => entry.artifactType === 'route-audit');
  return artifact ? normalizeRouteAudit(artifact.data) : null;
}

async function verifyRouteSteps(steps: string[], options: InspectOptions, racemic?: boolean): Promise<RouteAudit | null> {
  if (!steps.length) return null;
  const provider = routeProvider();
  if (!provider) return null;
  const runner = chemistryRunner(options);
  try {
    return await invokeRoute(runner, provider, steps, racemic);
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
): Promise<string> {
  if (options.enabled === false || !routeVerificationAvailable()) return finalAnswer;
  const steps = findReactionLines(modelAnswer);
  if (!steps.length) return finalAnswer;
  const conditions = findStepConditions(modelAnswer, steps.length);
  const racemic = declaresRacemic(modelAnswer);
  const provider = routeProvider();
  if (!provider) return finalAnswer;
  const compile = compileProvider();
  const runner = chemistryRunner(options);
  try {
    const audit = await invokeRoute(runner, provider, steps, racemic);
    if (!audit) return finalAnswer;
    const report = formatRouteAudit(audit);
    const drawings = compile ? await drawRouteSteps(runner, compile, steps, conditions, audit, options) : '';
    // A refusal the checker can name and the app cannot fix is offered back to the model as
    // one click: it proposes a corrected step, and this same path checks and draws it again.
    const fix = formatRouteFixPrompt(steps, audit);
    return `${finalAnswer.trimEnd()}\n\n${report}\n${drawings}${fix ? `\n${fix}\n` : ''}`;
  } catch {
    return finalAnswer;
  } finally {
    await runner.dispose?.();
  }
}
