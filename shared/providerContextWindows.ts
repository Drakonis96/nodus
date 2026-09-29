/**
 * Context windows a provider documents but does not report in its model list. DeepSeek's
 * /models returns ids only, so without this a research request falls back to a conservative
 * default and a normal synthesis prompt is refused as too large before it is ever sent.
 *
 * DeepSeek, verified 2026-09-28 (https://api-docs.deepseek.com/quick_start/pricing/):
 * `deepseek-flash` and `deepseek-v4-pro` have a 1M context. The legacy names
 * `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` are still accepted and are served by
 * the same Flash model, so they share its window.
 */
const DOCUMENTED: Record<string, Record<string, number>> = {
  deepseek: {
    'deepseek-flash': 1_000_000,
    'deepseek-v4-flash': 1_000_000,
    'deepseek-v4-flash-vision-exp': 1_000_000,
    'deepseek-v4-pro': 1_000_000,
  },
};

/** The documented context window in tokens, or null when the provider documents none. */
export function documentedContextWindow(provider: string, model: string): number | null {
  return DOCUMENTED[provider]?.[model] ?? null;
}
