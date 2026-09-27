import { useEffect, useState } from 'react';
import type { ModelInfo, ModelRef } from '@shared/types';

// Share only in-flight reads between the preference hook and its control. A later mount
// refreshes the catalogue, so changed credentials or provider capabilities are not stale.
const pending = new Map<ModelRef['provider'], Promise<ModelInfo[]>>();
function loadCatalog(provider: ModelRef['provider']): Promise<ModelInfo[]> {
  let request = pending.get(provider);
  if (!request) {
    request = window.nodus.listModels(provider).finally(() => pending.delete(provider));
    pending.set(provider, request);
  }
  return request;
}

/**
 * The live catalogue entry of a model whose thinking levels come with its provider's
 * catalogue. Undefined while it loads or when the catalogue cannot be read. Never infer
 * picker choices from a model name or a generic reasoning capability flag.
 */
export function useResearchModelInfo(model: ModelRef | null): ModelInfo | undefined {
  const [catalog, setCatalog] = useState<{ provider: string; models: ModelInfo[] } | null>(null);
  useEffect(() => {
    if (!model) return;
    let active = true;
    void loadCatalog(model.provider).then(models => {
      if (active) setCatalog({ provider: model.provider, models });
    }).catch(() => { if (active) setCatalog(null); });
    return () => { active = false; };
  }, [model?.provider, model?.model]);
  return catalog?.provider === model?.provider ? catalog?.models.find(entry => entry.id === model?.model) : undefined;
}
