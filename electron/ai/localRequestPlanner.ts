import type { LocalAiRequestDiagnostic, LocalProvider } from '@shared/types';

export type LocalAiTask =
  | 'light-extraction'
  | 'deep-extraction'
  | 'fusion'
  | 'summary'
  | 'theme-assignment'
  | 'relation-validation'
  | 'semantic-bridge'
  | 'chapter-idea-extraction'
  | 'chapter-relation-typing'
  | 'chat'
  | 'generic';

export interface LocalRequestPlanInput {
  provider: LocalProvider;
  model: string;
  task: LocalAiTask;
  promptTokens: number;
  requestedOutputTokens: number;
  contextMode?: 'auto' | 'manual';
  manualContextTokens?: number;
  trainedContextTokens?: number | null;
  /** Used only by compatibility fallback, where context cannot be changed. */
  loadedContextTokens?: number | null;
  nativeTransport: boolean;
}

export interface LocalRequestPlan {
  contextTokens: number;
  requestedOutputTokens: number;
  outputTokens: number;
  promptTokens: number;
  reserveTokens: number;
  task: LocalAiTask;
  contextMode: 'auto' | 'manual';
}

const AUTO_BUCKETS = [4096, 8192, 16384, 32768] as const;
export const LOCAL_CONTEXT_VALUES = [4096, 8192, 16384, 32768, 65536, 131072] as const;
export const MIN_LOCAL_OUTPUT_TOKENS = 512;

/**
 * Budgets for a batch of judgements: what the trace costs, what the JSON costs, and how far a
 * cut-off answer may be retried.
 *
 * These budgets used to be the item count times a per-item allowance, with a floor of 512 for
 * a single item — a model that answers directly writes a few hundred tokens of JSON and stops.
 * A model that reasons before answering does not: the trace comes first and is charged to the
 * same budget, so the JSON only starts after it. Measured on the engine Nodus ships, with
 * Gemma 4 E2B and real ideas from a scanned paper:
 *
 *   · one relation judgement at 512 tokens came back empty at the ceiling; at 2.000 it
 *     finished with valid JSON (its trace was ~1.700 characters);
 *   · a full batch of fifteen judgements at 3.136 tokens (the old per-item allowance) came
 *     back empty too, while 5.000 finished it — the trace alone was 6.500-11.000 characters.
 *
 * So the floor is what a trace costs and the per-item allowance is what the JSON costs, which
 * is why the two are added instead of one bounding the other. A batch larger than
 * `VALIDATION_BATCH_MAX_TOKENS` is left to the adaptive splitter, and a reply that is cut off
 * anyway gets one retry with more room the way fusion and the work summaries do (see
 * `electron/ai/structuredHeadroom.ts`).
 */
export const VALIDATION_MAX_TOKENS = 2_000;
export const VALIDATION_BATCH_MAX_TOKENS = 6_000;
export const VALIDATION_RETRY_MAX_TOKENS = 8_000;

export function localTaskOutputTokens(task: LocalAiTask, itemCount = 1): number {
  switch (task) {
    case 'light-extraction': return 1500;
    case 'deep-extraction': return 16000;
    case 'fusion': return 800;
    case 'summary': return 800;
    case 'theme-assignment': return Math.min(VALIDATION_BATCH_MAX_TOKENS, VALIDATION_MAX_TOKENS + 96 * itemCount);
    case 'relation-validation':
    case 'semantic-bridge': return Math.min(VALIDATION_BATCH_MAX_TOKENS, VALIDATION_MAX_TOKENS + 192 * itemCount);
    case 'chapter-idea-extraction': return Math.min(VALIDATION_BATCH_MAX_TOKENS, 1500 + 750 * itemCount);
    case 'chapter-relation-typing': return Math.min(VALIDATION_BATCH_MAX_TOKENS, VALIDATION_MAX_TOKENS + 160 * itemCount);
    case 'chat': return 1200;
    default: return 8000;
  }
}

export function localContextReserve(contextTokens: number): number {
  return Math.max(512, Math.ceil(contextTokens * 0.10));
}

function capToModel(value: number, trained?: number | null): number {
  return trained && trained > 0 ? Math.min(value, trained) : value;
}

/** Pure, deterministic planner. It never treats output tokens as context. Automatic
 * mode stays at or below 16K for ordinary work, but deep extraction may use 32K so its
 * proven 16K structured-output budget still fits beside the prompt. */
export function buildLocalRequestPlan(input: LocalRequestPlanInput): LocalRequestPlan {
  const mode = input.contextMode === 'manual' ? 'manual' : 'auto';
  let contextTokens: number;
  if (!input.nativeTransport && input.loadedContextTokens) {
    contextTokens = capToModel(input.loadedContextTokens, input.trainedContextTokens);
  } else if (mode === 'manual') {
    const requested = LOCAL_CONTEXT_VALUES.includes(input.manualContextTokens as typeof LOCAL_CONTEXT_VALUES[number])
      ? Number(input.manualContextTokens)
      : 16384;
    contextTokens = capToModel(requested, input.trainedContextTokens);
  } else {
    const neededWithoutReserve = input.promptTokens + input.requestedOutputTokens;
    const maxAutoContext = input.task === 'deep-extraction' ? 32768 : 16384;
    const autoBuckets = AUTO_BUCKETS.filter((bucket) => bucket <= maxAutoContext);
    contextTokens = autoBuckets.find((bucket) => neededWithoutReserve + localContextReserve(bucket) <= bucket) ?? maxAutoContext;
    contextTokens = capToModel(contextTokens, input.trainedContextTokens);
  }

  const reserveTokens = localContextReserve(contextTokens);
  const outputTokens = Math.min(input.requestedOutputTokens, contextTokens - input.promptTokens - reserveTokens);
  const minimumUsefulOutput = Math.min(MIN_LOCAL_OUTPUT_TOKENS, input.requestedOutputTokens);
  if (outputTokens < minimumUsefulOutput) {
    const error = new Error(
      `LOCAL_CONTEXT_OVERFLOW:${input.model}:${input.promptTokens}:${contextTokens}:${input.task}`,
    );
    (error as Error & { code?: string }).code = 'local_context_overflow';
    throw error;
  }
  return {
    contextTokens,
    requestedOutputTokens: input.requestedOutputTokens,
    outputTokens,
    promptTokens: input.promptTokens,
    reserveTokens,
    task: input.task,
    contextMode: mode,
  };
}

const diagnostics: LocalAiRequestDiagnostic[] = [];
const MAX_DIAGNOSTICS = 200;

export function recordLocalAiDiagnostic(diagnostic: LocalAiRequestDiagnostic): void {
  diagnostics.push(diagnostic);
  if (diagnostics.length > MAX_DIAGNOSTICS) diagnostics.splice(0, diagnostics.length - MAX_DIAGNOSTICS);
}

export function listLocalAiDiagnostics(): LocalAiRequestDiagnostic[] {
  return diagnostics.map((entry) => ({ ...entry }));
}

export function clearLocalAiDiagnostics(): void {
  diagnostics.length = 0;
}
