import type { CodexReasoningEffort, ModelInfo, ModelRef } from './types';

/** The reasoning levels one model publishes, plus the level it falls back to when the
 *  user leaves it on «Predeterminado». */
export interface CodexReasoningChoice {
  supported: NonNullable<ModelInfo['supportedReasoningEfforts']>;
  fallback: CodexReasoningEffort | null;
}

export type CodexReasoningCatalog = Record<string, CodexReasoningChoice>;

/**
 * Index a provider's model list by the reasoning levels each model advertises. Models
 * that publish none are left out entirely, so «this model has no levels» is a plain
 * absence and a caller can decide to render no selector without a second condition.
 */
export function codexReasoningCatalog(models: ModelInfo[]): CodexReasoningCatalog {
  const catalog: CodexReasoningCatalog = {};
  for (const model of models) {
    const supported = model.supportedReasoningEfforts ?? [];
    if (supported.length === 0) continue;
    catalog[model.id] = { supported, fallback: model.defaultReasoningEffort ?? null };
  }
  return catalog;
}

/** The levels a specific selection can offer, or null when it can offer none — a
 *  non-Codex provider, a model outside the catalogue, or one with no levels. */
export function reasoningChoiceFor(
  catalog: CodexReasoningCatalog | null,
  model: ModelRef | null | undefined
): CodexReasoningChoice | null {
  if (!catalog || model?.provider !== 'codex') return null;
  return catalog[model.model] ?? null;
}

/**
 * The single writer for the per-model reasoning map. Providers and Models both go
 * through it, which is what makes the two screens agree: the level belongs to the
 * model, not to the role that happens to be using it, so choosing it once in either
 * place is choosing it everywhere that model runs.
 *
 * Null clears the entry rather than storing a sentinel, so «Predeterminado» stays the
 * absence of a choice and keeps following the model's own recommendation when Codex
 * changes it.
 */
export function withCodexReasoning(
  current: Record<string, CodexReasoningEffort> | undefined,
  model: string,
  effort: CodexReasoningEffort | null
): Record<string, CodexReasoningEffort> {
  const next = { ...(current ?? {}) };
  if (effort) next[model] = effort;
  else delete next[model];
  return next;
}
