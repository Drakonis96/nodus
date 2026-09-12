import { resolveModelRef } from './aiClient';
import type { ModelRef } from '@shared/types';
import type { ResearchEffort } from '@shared/researchReasoning';
import { researchReasoningProfile, resolveResearchEffort, researchThinkingAllowance } from '@shared/researchReasoning';
import { isLocalProvider, listModels } from './providers';
import { getApiKey } from '../secrets/secretStore';

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
  return { reasoning: 'off' as const, researchEffort, researchModelInfo,
    maxTokens: (local || isLocalProvider(model.provider) || model.provider === 'nodus') ? maxTokens : maxTokens + researchThinkingAllowance(native) };
}
