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

export function localTaskOutputTokens(task: LocalAiTask, itemCount = 1): number {
  switch (task) {
    case 'light-extraction': return 1500;
    case 'deep-extraction': return 16000;
    case 'fusion': return 800;
    case 'summary': return 800;
    case 'theme-assignment': return Math.max(512, Math.min(4000, 256 + 96 * itemCount));
    case 'relation-validation':
    case 'semantic-bridge': return Math.max(512, Math.min(4000, 256 + 192 * itemCount));
    case 'chapter-idea-extraction': return Math.max(1500, Math.min(6000, 750 * itemCount));
    case 'chapter-relation-typing': return Math.max(768, Math.min(4000, 256 + 160 * itemCount));
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
