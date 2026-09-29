/**
 * Context windows a provider documents but does not report in its model list. DeepSeek's
 * /models returns ids only, so without this a research request falls back to a conservative
 * default and a normal synthesis prompt is refused as too large before it is ever sent.
 *
 * DeepSeek, verified 2026-09-28 (https://api-docs.deepseek.com/quick_start/pricing/):
 * `deepseek-flash` and `deepseek-v4-pro` have a 1M context. The legacy names
 * `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` are still accepted and are served by
 * the same Flash model, so they share its window.
 *
 * Anthropic: every current Claude model has at least a 200K-token context window
 * (https://docs.claude.com/en/docs/about-claude/models/overview). The model list's
 * `max_input_tokens` is used when present; this floor covers a list read without it. Without it
 * a research request to Claude Opus fell back to 32K and was refused before sending.
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
  const listed = DOCUMENTED[provider]?.[model];
  if (listed) return listed;
  if (provider === 'anthropic' && /^claude-/.test(model)) return 200_000;
  return null;
}
