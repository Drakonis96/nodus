import { composeProjectSystemPrompt } from '@shared/researchSystemPrompts';
import { resolveResearchSystemPrompt } from '../db/researchSystemPromptsRepo';
import { createChatOrganizer } from '../db/chatOrganizerRepo';
import { CHAT_HISTORY_TABLES } from '../db/chatHistoryTables';
import { readStudyChatStore } from './studyChatHistory';

type ConversationScope = { surface: 'research' | 'database' | 'world' | 'study'; conversationId?: string | null };

/** Resolve ownership from persisted placement, never from renderer-supplied project text. */
export function withResearchSystemPrompt(base: string, id?: string | null, scope?: ConversationScope): string {
  let project = null;
  if (scope?.conversationId) {
    if (scope.surface === 'study') {
      const store = readStudyChatStore();
      const conversation = store.conversations.find(item => item.id === scope.conversationId);
      project = store.projects.find(item => item.id === conversation?.projectId) ?? null;
    } else {
      const tables = CHAT_HISTORY_TABLES.find(item => item.surface === scope.surface)!;
      const organizer = createChatOrganizer(tables);
      const { projectId } = organizer.placementFor(scope.conversationId);
      project = projectId ? organizer.getChatProject(projectId) : null;
    }
  }
  return composeProjectSystemPrompt(base, resolveResearchSystemPrompt(id), project);
}
