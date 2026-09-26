import { useEffect, useState } from 'react';
import type { ModelInfo, ModelRef } from '@shared/types';
import { researchReasoningNeedsCatalog } from '@shared/researchReasoning';

/**
 * The live catalogue entry of a model whose thinking levels come with its provider's
 * catalogue (subscriptions, OpenRouter, LM Studio). Undefined while it loads, when the
 * catalogue cannot be read, and for every other provider, whose ladder is known without it.
 */
export function useResearchModelInfo(model: ModelRef | null): ModelInfo | undefined {
  const [catalog, setCatalog] = useState<{ provider: string; models: ModelInfo[] } | null>(null);
  useEffect(() => {
    if (!model || !researchReasoningNeedsCatalog(model)) return;
    let active = true;
    void window.nodus.listModels(model.provider).then(models => {
      if (active) setCatalog({ provider: model.provider, models });
    }).catch(() => { if (active) setCatalog(null); });
    return () => { active = false; };
  }, [model?.provider, model?.model]);
  return catalog?.provider === model?.provider ? catalog?.models.find(entry => entry.id === model?.model) : undefined;
}
