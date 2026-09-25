import { resolveModelRef } from './aiClient';
import type { ModelRef } from '@shared/types';
import type { NativeResearchEffort, ResearchEffort } from '@shared/researchReasoning';
import { researchReasoningProfile, resolveResearchEffort, researchThinkingAllowance } from '@shared/researchReasoning';
import { isLocalProvider, listModels } from './providers';
import { getApiKey } from '../secrets/secretStore';

/**
 * Adaptive-thinking models cannot turn thinking off, and their thinking tokens count against
 * `max_tokens` — which the provider documents as "a hard limit on total output (thinking plus
 * response text)". The manual `budget_tokens` allowances are sized for a fixed cap and are far
 * too small here: at the lowest effort `claude-opus-5-5` still reasoned roughly ten thousand
 * tokens on a route-correction turn and the answer was truncated to a few dozen characters.
 * Reserve the depth the provider documents per effort so the visible answer always fits. A
 * larger `max_tokens` is a ceiling, not a target, so it does not make the model write more.
 */
const ADAPTIVE_THINKING_ALLOWANCE: Partial<Record<NativeResearchEffort, number>> = {
  none: 16_384, off: 16_384, minimal: 16_384, low: 16_384,
  medium: 24_576, high: 32_768, xhigh: 49_152, max: 65_536, ultra: 65_536, on: 32_768,
};

export async function researchGenerationOptions(request: { model?: ModelRef | null; thinkingEffort?: ResearchEffort }, maxTokens: number, local: boolean, signal?: AbortSignal) {
  const model = resolveModelRef(request.model);
  let researchModelInfo: import('@shared/types').ModelInfo | undefined;
  if (['openrouter', 'lmstudio'].includes(model.provider)) {
    try {
      const deadline = AbortSignal.timeout(5000);
      researchModelInfo = (await listModels(model.provider, getApiKey(model.provider), signal ? AbortSignal.any([signal, deadline]) : deadline)).find(m => m.id === model.model);
    }
    catch { /* Known families still work when catalogue discovery is unavailable. */ }
  }
  signal?.throwIfAborted();
  const researchEffort = request.thinkingEffort ?? 'standard';
  const profile = researchReasoningProfile(model, researchModelInfo);
  const native = resolveResearchEffort(profile, researchEffort);
  // Adaptive thinking is always on, so its reserve stands in for the `budget_tokens` the
  // manual mode would otherwise cap at a much smaller number.
  const thinkingAllowance = profile.mode === 'anthropic-adaptive'
    ? ADAPTIVE_THINKING_ALLOWANCE[native ?? 'none'] ?? researchThinkingAllowance(native)
    : researchThinkingAllowance(native);
  return { reasoning: 'off' as const, researchEffort, researchModelInfo,
    maxTokens: (local || isLocalProvider(model.provider) || model.provider === 'nodus') ? maxTokens : maxTokens + thinkingAllowance };
}
