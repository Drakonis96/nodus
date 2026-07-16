import type { AiProvider, EmbeddingProvider, ModelInfo, ModelRef } from './types';
import { AI_PROVIDERS, EMBEDDING_PROVIDERS, PROVIDER_LABELS, isLocalProvider } from './providers';

// Pure helpers behind the setup wizard's provider step. The wizard asks the user
// for nothing it can find out on its own: it queries every provider that already
// answers (built-in local models, a local server, or a stored key), merges the
// results into one searchable list per role, and only falls back to a key prompt
// when nothing answered.

export type ProviderKeyMap = Partial<Record<AiProvider, boolean>>;

/** Nodus ships these models inside the app, so they always answer. */
const BUILT_IN_PROVIDER: AiProvider = 'nodus';

/** True when the provider can be queried without asking the user for anything:
 *  the built-in models are bundled, local servers need no key, and a cloud
 *  provider answers as soon as its (globally shared) key is stored. */
export function canAutoDiscover(provider: AiProvider, keys: ProviderKeyMap): boolean {
  if (provider === BUILT_IN_PROVIDER) return true;
  if (isLocalProvider(provider)) return true;
  return Boolean(keys[provider]);
}

/** Providers to query for the general AI model, built-in first. */
export function autoDiscoverableAiProviders(keys: ProviderKeyMap): AiProvider[] {
  return [BUILT_IN_PROVIDER, ...AI_PROVIDERS].filter((provider) => canAutoDiscover(provider, keys));
}

/** Providers to query for the embedding model, built-in first. */
export function autoDiscoverableEmbeddingProviders(keys: ProviderKeyMap): EmbeddingProvider[] {
  return [BUILT_IN_PROVIDER as EmbeddingProvider, ...EMBEDDING_PROVIDERS.filter((p) => p !== BUILT_IN_PROVIDER)]
    .filter((provider) => canAutoDiscover(provider, keys));
}

/** Cloud providers with no key yet — the only ones worth offering in the "add a
 *  key" prompt, since local ones are already reachable without one. */
export function providersMissingKey(keys: ProviderKeyMap): AiProvider[] {
  return AI_PROVIDERS.filter((provider) => !isLocalProvider(provider) && !keys[provider]);
}

/** Cloud providers whose key is already stored, in picker order. */
export function configuredKeyProviders(keys: ProviderKeyMap): AiProvider[] {
  return AI_PROVIDERS.filter((provider) => !isLocalProvider(provider) && Boolean(keys[provider]));
}

export interface ModelChoice {
  provider: AiProvider;
  model: string;
  /** Model display name (falls back to its id). */
  label: string;
  providerLabel: string;
  /** OpenRouter's upstream vendor segment, when the listing reports one. */
  group?: string;
  /** Runs on this machine: no key, no per-token billing. */
  local: boolean;
}

export function choiceKey(choice: Pick<ModelChoice, 'provider' | 'model'>): string {
  return `${choice.provider}::${choice.model}`;
}

export function refKey(ref: ModelRef | null): string {
  return ref ? `${ref.provider}::${ref.model}` : '';
}

/** True for providers that run on the user's machine (built-in or local server). */
export function isOnDeviceProvider(provider: AiProvider): boolean {
  return provider === BUILT_IN_PROVIDER || isLocalProvider(provider);
}

export function toModelChoices(provider: AiProvider, models: ModelInfo[]): ModelChoice[] {
  const seen = new Set<string>();
  const choices: ModelChoice[] = [];
  for (const model of models) {
    const id = model.id?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    choices.push({
      provider,
      model: id,
      label: model.name?.trim() || id,
      providerLabel: PROVIDER_LABELS[provider] ?? provider,
      group: model.group,
      local: isOnDeviceProvider(provider),
    });
  }
  return choices;
}

/** Searchbox matcher: every whitespace-separated term must appear somewhere in
 *  the model id, its name, or its provider — so "claude opus" and "openai embed"
 *  both narrow the list the way a user expects. */
export function filterModelChoices(choices: ModelChoice[], query: string): ModelChoice[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return choices;
  return choices.filter((choice) => {
    const haystack = `${choice.model} ${choice.label} ${choice.providerLabel} ${choice.provider} ${choice.group ?? ''}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export function findChoice(choices: ModelChoice[], ref: ModelRef | null): ModelChoice | null {
  if (!ref) return null;
  return choices.find((choice) => choice.provider === ref.provider && choice.model === ref.model) ?? null;
}

/** One provider's answer to the wizard's listing call. */
export interface DiscoveryOutcome {
  provider: AiProvider;
  models?: ModelInfo[];
  error?: string;
}

export interface DiscoveryFailure {
  provider: AiProvider;
  providerLabel: string;
  message: string;
}

export interface Discovery {
  choices: ModelChoice[];
  /** Providers that were reachable in principle but did not answer — a stale key
   *  or a local server that is not running. Reported, never fatal: the wizard
   *  still works as long as one provider answered. */
  failures: DiscoveryFailure[];
}

/**
 * Merge every provider's answer into the single list each picker shows. Failures
 * are collected rather than thrown: one dead provider (LM Studio not running, a
 * revoked key) must not empty the picker for all the others.
 */
export function collectDiscovery(outcomes: DiscoveryOutcome[]): Discovery {
  const choices: ModelChoice[] = [];
  const failures: DiscoveryFailure[] = [];
  for (const outcome of outcomes) {
    if (outcome.error) {
      failures.push({
        provider: outcome.provider,
        providerLabel: PROVIDER_LABELS[outcome.provider] ?? outcome.provider,
        message: outcome.error,
      });
      continue;
    }
    choices.push(...toModelChoices(outcome.provider, outcome.models ?? []));
  }
  return { choices, failures };
}

/**
 * What the wizard should preselect once discovery finishes, in order:
 * the value already configured (kept even if the provider went quiet), then a
 * favorite that is still offered, then the first discovered model. Returns null
 * when nothing answered, which is what keeps the "continue" button disabled.
 */
export function pickDefaultChoice(
  choices: ModelChoice[],
  current: ModelRef | null,
  favorites: ModelRef[] = []
): ModelRef | null {
  if (current && (findChoice(choices, current) || choices.length === 0)) return current;
  const favorite = favorites.find((model) => findChoice(choices, model));
  if (favorite) return { provider: favorite.provider, model: favorite.model };
  const first = choices[0];
  return first ? { provider: first.provider, model: first.model } : null;
}
