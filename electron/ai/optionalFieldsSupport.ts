import type { ModelRef } from '@shared/types';

/**
 * What a gateway refused without saying so, learned from one refusal and reused for the
 * rest of the session.
 *
 * A gateway that answers with a bare "Bad Request" leaves Nodus guessing which of the
 * optional fields it layered onto the plain OpenAI contract — `response_format`, the
 * `reasoning_effort` hint — the gateway disliked. The transport resolves that guess with a
 * bounded ladder (see `optionalFieldReplays` in aiClient.ts) and records the rung that
 * landed here, so the following calls start there instead of walking the ladder again.
 * Without it every chunk of a scan pays it again: on a 48-paper library that is the
 * difference between one request per chunk and three, which is the whole reason a gateway
 * that refuses `response_format` felt like a broken install rather than a slow one.
 *
 * Session-scoped on purpose, like the sampling memory next door: a restart costs one
 * refused request per model, and a gateway's contract is not worth persisting.
 */
const reasoningHintRefused = new Set<string>();
const optionalBodyRefused = new Set<string>();

const modelKey = (model: ModelRef): string => `${model.provider}:${model.model}`;

/** The gateway refused the reasoning hint but accepted the rest of the optional body. */
export function reasoningHintUnsupported(model: ModelRef): boolean {
  return reasoningHintRefused.has(modelKey(model));
}

export function rememberReasoningHintUnsupported(model: ModelRef): void {
  reasoningHintRefused.add(modelKey(model));
}

/** The gateway refused the optional body outright: only the plain OpenAI body lands. */
export function optionalBodyUnsupported(model: ModelRef): boolean {
  return optionalBodyRefused.has(modelKey(model));
}

export function rememberOptionalBodyUnsupported(model: ModelRef): void {
  optionalBodyRefused.add(modelKey(model));
}
