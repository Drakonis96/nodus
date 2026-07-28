import type { CharacterChatSendResult } from '@shared/types';
import type { InterviewTurn } from '@shared/characterInterview';
import { buildCharacterChatImagePrompt, isCharacterImageRequest } from '@shared/characterChat';
import {
  appendCharacterChatMessage,
  attachCharacterChatImage,
  getCharacterChatConversation,
} from '../db/characterChatRepo';
import { getCharacter } from '../db/charactersRepo';
import { getSettings } from '../db/settingsRepo';
import { callImageProvider, optimizedJpegs } from './decorativeImages';
import { interviewCharacter } from './characterInterview';

/**
 * Save the author's turn first, then the character's reply, then (optionally) its image.
 * An image-provider failure must never discard a successful conversation.
 */
export async function sendCharacterChatMessage(
  conversationId: string,
  question: string
): Promise<CharacterChatSendResult> {
  const trimmed = question.trim();
  if (!trimmed) throw new Error('Escribe una pregunta.');
  const before = getCharacterChatConversation(conversationId);
  if (!before) throw new Error('Conversación no encontrada.');
  const character = getCharacter(before.personId);
  if (!character) throw new Error('Personaje no encontrado.');

  const history: InterviewTurn[] = before.messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
  appendCharacterChatMessage(conversationId, 'author', trimmed);

  const wantsImage = before.imageEnabled && isCharacterImageRequest(trimmed);
  const answer = await interviewCharacter(before.personId, trimmed, history, { canSendImages: wantsImage });
  const characterMessage = appendCharacterChatMessage(conversationId, 'character', answer);

  let imageError: string | null = null;
  if (wantsImage) {
    try {
      const settings = getSettings();
      if (!settings.imageProvider || !settings.imageModel) {
        throw new Error('Configura un proveedor y modelo de imagen en Ajustes → Proveedores.');
      }
      const prompt = buildCharacterChatImagePrompt({
        style: settings.imageStyle,
        name: character.displayName,
        visualSeed: character.profile.visualSeed,
        appearance: character.profile.appearance,
        request: trimmed,
        answer,
      });
      const generated = await callImageProvider(settings.imageProvider, settings.imageModel, prompt);
      const optimized = await optimizedJpegs(generated);
      // JPEG keeps roleplay chat images small and predictable regardless of provider.
      attachCharacterChatImage({
        conversationId,
        messageId: characterMessage.id,
        blob: optimized.image,
        thumbnailBlob: optimized.thumbnail,
        mimeType: 'image/jpeg',
        prompt,
        provider: settings.imageProvider,
        model: settings.imageModel,
      });
    } catch (error) {
      imageError = error instanceof Error ? error.message : String(error);
    }
  }

  const conversation = getCharacterChatConversation(conversationId);
  if (!conversation) throw new Error('La conversación se eliminó antes de terminar la respuesta.');
  return { conversation, imageError };
}
