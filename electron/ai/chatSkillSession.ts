import type { ModelRef } from '@shared/types';
import { enabledChatSkills } from '../chatSkills';
import { chatAssetOwner, chatAssetVersion } from '../chatAssets';
import { getActiveVault } from '../vaults/vaultRegistry';
import type { ChatSkillExecution } from './chatSkillExecution';

/** Snapshot before any asynchronous work. Other native chats share assistant activation. */
export function vaultChatSkillSession(surface: string, conversationId: string | undefined, question: string, model: ModelRef | null | undefined, exists: (id: string) => unknown): ChatSkillExecution {
  const vaultId = getActiveVault().id;
  const owner = conversationId ? chatAssetOwner(surface, conversationId, vaultId) : undefined;
  return {
    skills: enabledChatSkills('assistant'), owner, version: owner ? chatAssetVersion(owner) : 0, question, model,
    isCurrent: () => getActiveVault().id === vaultId && (!conversationId || !!exists(conversationId)),
  };
}
