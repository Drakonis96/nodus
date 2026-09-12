import type { ReactNode } from 'react';
import type { ChatConversation, ChatConversationSummary, ChatMessageRecord, ModelRef, ResearchChatRequest, ResearchContextSelection, ResearchContextStats, StudyAssistantMessage } from '@shared/types';

export interface ResearchUiMessage extends ChatMessageRecord {
  reasoning?: string;
  interrupted?: boolean;
  study?: StudyAssistantMessage;
}

/** Only the transport and vault-specific evidence differ; all chat chrome is shared. */
export interface ResearchChatAdapter {
  id: string;
  contextKey: string;
  contextPanel: ReactNode;
  canSend?: boolean;
  subtitle: string;
  suggestions: string[];
  modelFeature?: 'chatModel' | 'studyModel';
  reset?: () => void;
  listConversations: (includeArchived?: boolean) => Promise<ChatConversationSummary[]>;
  getConversation: (id: string) => Promise<(Omit<ChatConversation, 'messages'> & { messages: ResearchUiMessage[] }) | null>;
  createConversation: (input: { model?: ModelRef | null; selection?: ResearchContextSelection; title?: string }) => Promise<{ id: string }>;
  saveConversationMessages: (id: string, messages: ResearchUiMessage[], options: { model?: ModelRef | null; selection?: ResearchContextSelection }) => Promise<unknown>;
  deleteConversation: (id: string) => Promise<unknown>;
  archiveConversation?: (id: string, archived: boolean) => Promise<unknown>;
  generateConversationTitle?: (id: string, model?: ModelRef | null) => Promise<unknown>;
  researchChatStream: (request: ResearchChatRequest, handlers: { onDelta: (delta: string) => void; onReasoning?: (delta: string) => void }) => Promise<{ answer: string; aborted?: boolean; stats?: ResearchContextStats; message?: Partial<ResearchUiMessage> }>;
  cancelResearchChat: () => Promise<unknown>;
  renderMessage: (message: ResearchUiMessage, streaming: boolean) => ReactNode;
}

export function nativeSummary(conversation: { id: string; title: string; createdAt: string; updatedAt: string; messageCount: number; model?: ModelRef | null; archived?: boolean }): ChatConversationSummary {
  return { id: conversation.id, title: conversation.title, created_at: conversation.createdAt, updated_at: conversation.updatedAt, messageCount: conversation.messageCount, model: conversation.model ?? null, archived: conversation.archived ?? false };
}
