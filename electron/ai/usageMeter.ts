import { AsyncLocalStorage } from 'node:async_hooks';
import type { ModelRef } from '@shared/types';

/**
 * Token accounting for one scope of model calls (a complete study guide, one of its
 * calls). Transports that report provider usage call `recordProviderUsage`; callers
 * that need a number for every call fall back to their own estimate when a call
 * finished without any provider report.
 */
export interface UsageMeter {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Calls whose tokens came from the provider rather than an estimate. */
  reported: number;
  model: ModelRef | null;
}

const meters = new AsyncLocalStorage<UsageMeter[]>();

export function createUsageMeter(): UsageMeter {
  return { calls: 0, inputTokens: 0, outputTokens: 0, reported: 0, model: null };
}

/** Run `fn` with `meter` added to the active chain: nested meters all receive usage. */
export function withUsageMeter<T>(meter: UsageMeter, fn: () => T): T {
  return meters.run([...(meters.getStore() ?? []), meter], fn);
}

export function recordProviderUsage(model: ModelRef, inputTokens: number | null | undefined, outputTokens: number | null | undefined): void {
  const chain = meters.getStore();
  if (!chain?.length || (!inputTokens && !outputTokens)) return;
  for (const meter of chain) {
    meter.calls += 1;
    meter.reported += 1;
    meter.inputTokens += inputTokens ?? 0;
    meter.outputTokens += outputTokens ?? 0;
    meter.model = model;
  }
}

/** Add usage that no transport reported (estimate) to every active meter. */
export function recordEstimatedUsage(inputTokens: number, outputTokens: number): void {
  for (const meter of meters.getStore() ?? []) {
    meter.calls += 1;
    meter.inputTokens += Math.max(0, Math.round(inputTokens));
    meter.outputTokens += Math.max(0, Math.round(outputTokens));
  }
}
