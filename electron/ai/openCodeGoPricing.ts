import type { OpenCodeGoNormalizedUsage } from './openCodeGoCompletion';

interface PricingUsdPerMillion {
  input: number;
  output: number;
  cachedRead?: number;
  cachedWrite?: number;
}

/** Prices published in the OpenCode Go documentation on 2026-07-17. Unknown
 * catalogue entries remain unpriced instead of receiving a guess. */
const PRICING: Record<string, PricingUsdPerMillion> = {
  'grok-4.5': { input: 2, output: 6, cachedRead: 0.5 },
  'glm-5.2': { input: 1.4, output: 4.4, cachedRead: 0.26 },
  'glm-5.1': { input: 1.4, output: 4.4, cachedRead: 0.26 },
  'kimi-k3': { input: 3, output: 15, cachedRead: 0.3 },
  'kimi-k2.7-code': { input: 0.95, output: 4, cachedRead: 0.19 },
  'kimi-k2.6': { input: 0.95, output: 4, cachedRead: 0.16 },
  'deepseek-v4-pro': { input: 0.435, output: 0.87, cachedRead: 0.003625 },
  'deepseek-v4-flash': { input: 0.14, output: 0.28, cachedRead: 0.0028 },
  'mimo-v2.5': { input: 0.14, output: 0.28, cachedRead: 0.0028 },
  'mimo-v2.5-pro': { input: 0.435, output: 0.87, cachedRead: 0.003625 },
  'minimax-m3': { input: 0.3, output: 1.2, cachedRead: 0.06 },
  'minimax-m2.7': { input: 0.3, output: 1.2, cachedRead: 0.06, cachedWrite: 0.375 },
  'minimax-m2.5': { input: 0.3, output: 1.2, cachedRead: 0.06, cachedWrite: 0.375 },
  'qwen3.7-max': { input: 2.5, output: 7.5, cachedRead: 0.5, cachedWrite: 3.125 },
  'qwen3.7-plus': { input: 0.4, output: 1.6, cachedRead: 0.04, cachedWrite: 0.5 },
  'qwen3.6-plus': { input: 0.5, output: 3, cachedRead: 0.05, cachedWrite: 0.625 },
};

const LONG_CONTEXT_PRICING: Partial<Record<string, PricingUsdPerMillion>> = {
  'qwen3.7-plus': { input: 1.2, output: 4.8, cachedRead: 0.12, cachedWrite: 1.5 },
  'qwen3.6-plus': { input: 2, output: 6, cachedRead: 0.2, cachedWrite: 2.5 },
};

/** Local estimate only. OpenCode Console remains authoritative because this
 * meter cannot observe requests from other clients or provider-side rounding. */
export function estimateOpenCodeGoCostUsd(
  model: string,
  usage: OpenCodeGoNormalizedUsage | null
): number | null {
  if (!usage) return null;
  const totalInput = usage.uncachedInputTokens + usage.cachedReadTokens + usage.cachedWriteTokens;
  const price = totalInput > 256_000 ? LONG_CONTEXT_PRICING[model] ?? PRICING[model] : PRICING[model];
  if (!price) return null;
  const cost =
    usage.uncachedInputTokens * price.input +
    usage.outputTokens * price.output +
    usage.cachedReadTokens * (price.cachedRead ?? price.input) +
    usage.cachedWriteTokens * (price.cachedWrite ?? price.input);
  return cost / 1_000_000;
}
