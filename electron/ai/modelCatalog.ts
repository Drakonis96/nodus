import type { AiProvider, ModelCatalogResult } from '@shared/types';
import { getApiKey } from '../secrets/secretStore';
import { listProviderModelCatalog } from './providers';
import { listChatGptSubscriptionModelCatalog } from './codexSubscription';
import { listGitHubCopilotSubscriptionModels } from './githubCopilotSubscription';

/** Read listing evidence without the picker’s manual fallbacks or hidden-model filter. */
export async function getModelCatalog(provider: AiProvider): Promise<ModelCatalogResult> {
  try {
    if (provider === 'codex') return { status: 'read', ...await listChatGptSubscriptionModelCatalog() };
    if (provider === 'github-copilot') {
      const models = await listGitHubCopilotSubscriptionModels();
      return { status: 'read', models, selectableModels: models };
    }
    return { status: 'read', ...await listProviderModelCatalog(provider, getApiKey(provider), AbortSignal.timeout(15000)) };
  } catch {
    return { status: 'unreadable' };
  }
}
