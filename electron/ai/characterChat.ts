import type { CharacterChatSendResult } from '@shared/types';
import type { InterviewTurn } from '@shared/characterInterview';
import { appendCharacterChatMessage, getCharacterChatConversation } from '../db/characterChatRepo';
import { getSettings } from '../db/settingsRepo';
import { interviewCharacter } from './characterInterview';
import { vaultChatSkillSession } from './chatSkillSession';
import { executeChatSkills, assertChatSkillSession } from './chatSkillExecution';

/** Persist visual tool output with the character turn; previous image attachments remain readable. */
export async function sendCharacterChatMessage(conversationId: string, question: string): Promise<CharacterChatSendResult> {
  const trimmed = question.trim();
  if (!trimmed) throw new Error('Escribe una pregunta.');
  const before = getCharacterChatConversation(conversationId);
  if (!before) throw new Error('Conversación no encontrada.');
  const settings = getSettings();
  const model = settings.chatModel ?? settings.synthesisModel ?? settings.extractionModel ?? null;
  const execution = vaultChatSkillSession('character', conversationId, trimmed, model, getCharacterChatConversation);
  assertChatSkillSession(execution);
  const history: InterviewTurn[] = before.messages.map(({ role, content }) => ({ role, content }));
  appendCharacterChatMessage(conversationId, 'author', trimmed);
  const raw = await interviewCharacter(before.personId, trimmed, history, {
    canSendImages: execution.skills.some(skill => skill.builtin === 'image'), skills: execution.skills,
  });
  const answer = await executeChatSkills(raw, execution);
  assertChatSkillSession(execution);
  appendCharacterChatMessage(conversationId, 'character', answer);
  const conversation = getCharacterChatConversation(conversationId);
  if (!conversation) throw new Error('La conversación se eliminó antes de terminar la respuesta.');
  return { conversation, imageError: null };
}
