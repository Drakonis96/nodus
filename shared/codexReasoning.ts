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
 * The writer for the per-MODEL reasoning map, which the Providers tab owns. That screen
 * lists the subscription's models, not the jobs they run, so a level chosen there is a
 * default for every role that has not chosen one of its own.
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

/**
 * The writer for a single role's level, which the Models tab owns. The level is stored
 * on that role's own model selection, so it reaches the provider through the same
 * `ModelRef` the role already hands to the AI client, and two roles pointed at one model
 * stay independent — the whole point of choosing it beside the picker.
 *
 * Null removes the property instead of storing a sentinel: «Predeterminado» is an
 * absence here too, so the role drops back to the model-wide default.
 */
export function modelRefWithReasoning(
  model: ModelRef,
  effort: CodexReasoningEffort | null
): ModelRef {
  const { reasoningEffort: _previous, ...rest } = model;
  return effort ? { ...rest, reasoningEffort: effort } : rest;
}

/**
 * The level a selection actually runs at, or null to let the provider pick. Read at the
 * two ends that must agree — the selector's «Predeterminado» label and the completion
 * call — so neither can claim a level the other would not use.
 *
 * A role's own choice wins; failing that the model-wide default from Providers applies;
 * failing that the provider's own recommendation does. Non-Codex providers publish no
 * levels, so they always resolve to null.
 */
export function codexReasoningFor(
  model: ModelRef | null | undefined,
  perModel: Record<string, CodexReasoningEffort> | undefined
): CodexReasoningEffort | null {
  if (model?.provider !== 'codex') return null;
  return model.reasoningEffort ?? perModel?.[model.model] ?? null;
}
