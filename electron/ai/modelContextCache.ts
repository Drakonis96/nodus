import type { AiProvider, ModelInfo } from '@shared/types';

const catalogues = new Map<string, Map<string, number>>();
const catalogueKey = (provider: AiProvider, endpoint: string | null) => JSON.stringify([provider, endpoint]);

/** Keep the last successful catalogue for this session. A model's cloud window
 * does not shrink merely because a conversation lasts longer than five minutes.
 * Every explicit catalogue refresh replaces its snapshot, including removals and
 * missing limits; custom endpoints have independent snapshots. Local runtime
 * allocations are probed separately and retain their short-lived cache. */
export function rememberModelContextWindows(
  provider: AiProvider,
  models: readonly Pick<ModelInfo, 'id' | 'contextLength'>[],
  endpoint: string | null = null,
): void {
  const windows = new Map<string, number>();
  for (const model of models) {
    if (Number.isSafeInteger(model.contextLength) && model.contextLength! >= 1024) {
      windows.set(model.id, model.contextLength!);
    }
  }
  catalogues.set(catalogueKey(provider, endpoint), windows);
}

export function cachedModelContextWindow(provider: AiProvider, model: string, endpoint: string | null = null): number | null {
  return catalogues.get(catalogueKey(provider, endpoint))?.get(model) ?? null;
}
