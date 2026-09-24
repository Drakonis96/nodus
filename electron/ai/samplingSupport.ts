import type { ModelRef } from '@shared/types';

/**
 * Models whose provider answered a 400 naming `temperature` as deprecated or unsupported.
 *
 * A provider can retire a sampling knob between two calls — that is how DeepSeek's
 * unversioned ids arrived, and OpenAI's o-series did the same — so each transport learns the
 * model once and stops sending the field. Session-scoped on purpose: a restart costs one
 * failed request per model, and a model's sampling contract is not worth persisting.
 *
 * Shared by `aiClient` (the generic OpenAI-compatible transport) and `openCodeGoCompletion`
 * (OpenCode Go speaks its own HTTP), so a model learned on one route does not have to fail
 * again on the other.
 */
const unsupported = new Set<string>();

const modelKey = (model: ModelRef): string => `${model.provider}:${model.model}`;

export function temperatureUnsupported(model: ModelRef): boolean {
  return unsupported.has(modelKey(model));
}

export function rememberTemperatureUnsupported(model: ModelRef): void {
  unsupported.add(modelKey(model));
}

/**
 * Models whose provider answered a 400 rejecting `thinking.type.disabled` and requiring
 * `thinking.type.adaptive`. Newer Claude models (`claude-opus-5-5`) removed thinking-off, so the
 * transport sends adaptive from the start once the model has been learned. Session-scoped, like
 * the temperature memory.
 */
const adaptiveThinking = new Set<string>();

export function adaptiveThinkingRequired(model: ModelRef): boolean {
  return adaptiveThinking.has(modelKey(model));
}

export function rememberAdaptiveThinking(model: ModelRef): void {
  adaptiveThinking.add(modelKey(model));
}
