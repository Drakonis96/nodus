import { refineChatSvg } from './chatSvgQuality';
import type { ModelRef } from '@shared/types';
import type { ChatSkill } from '@shared/chatSkills';
import { CHAT_IMAGE_ASPECT_RATIOS, type ChatImageAspectRatio, splitChatVisuals } from '@shared/chatSkills';
import { callImageProvider, prepareGeneratedImage } from './decorativeImages';
import { getSettings } from '../db/settingsRepo';
import { chatAssetVersion, storeChatImage } from '../chatAssets';

export interface ChatSkillExecution {
  skills: ChatSkill[];
  question?: string;
  model?: ModelRef | null;
  owner?: string;
  version: number;
  isCurrent: () => boolean;
}

export function assertChatSkillSession(execution: ChatSkillExecution, signal?: AbortSignal): void {
  signal?.throwIfAborted();
  if (!execution.isCurrent() || (execution.owner && chatAssetVersion(execution.owner) !== execution.version)) {
    throw new DOMException('The chat was deleted or changed.', 'AbortError');
  }
}

/** Provider-independent tool adapter: only the current model answer may invoke it. */
export async function executeChatSkills(answer: string, execution: ChatSkillExecution, signal?: AbortSignal): Promise<string> {
  assertChatSkillSession(execution, signal);
  answer = await refineChatSvg(answer, { question: execution.question ?? '', skills: execution.skills, model: execution.model, signal });
  const parts = splitChatVisuals(answer);
  let requested = false;
  const result: string[] = [];
  for (const part of parts) {
    if (part.kind !== 'image-request') {
      result.push(part.kind === 'svg' ? `\n\n\`\`\`svg\n${part.content}\n${part.complete ? '```' : ''}\n\n` : part.kind === 'image-error' ? `\n\n\`\`\`nodus-image-error\n${part.content}\n\`\`\`\n\n` : part.content);
      continue;
    }
    signal?.throwIfAborted();
    try {
      if (requested) throw new Error('Only one image can be generated per reply. Send another message to create a variation.');
      requested = true;
      if (!execution.skills.some(skill => skill.builtin === 'image')) throw new Error('Enable Image Atelier in Skills to generate images.');
      if (!execution.owner) throw new Error('Start a saved chat in Nodi or the assistant to generate an image.');
      if (!part.complete) throw new Error('The image brief was interrupted. Retry the response.');
      let value: { title?: unknown; alt?: unknown; prompt?: unknown; aspectRatio?: unknown };
      try { value = JSON.parse(part.content); } catch { throw new Error('The model returned an invalid image brief. Retry the response.'); }
      if (typeof value.prompt !== 'string' || value.prompt.trim().length < 20 || value.prompt.length > 12000) throw new Error('The model returned an invalid image brief. Retry the response.');
      const settings = getSettings();
      if (!settings.imageProvider || !settings.imageModel) throw new Error('Choose an image provider and model in Settings.');
      const title = String(value.title || 'Generated image').replace(/[[\]\n\r]/g, ' ').slice(0, 160);
      const alt = String(value.alt || title).replace(/[[\]\n\r]/g, ' ').slice(0, 500);
      const current = () => execution.isCurrent() && chatAssetVersion(execution.owner!) === execution.version;
      if (!current()) throw new DOMException('The chat was deleted or changed.', 'AbortError');
      const aspectRatio = CHAT_IMAGE_ASPECT_RATIOS.includes(value.aspectRatio as ChatImageAspectRatio) ? value.aspectRatio as ChatImageAspectRatio : undefined;
      const generated = await callImageProvider(settings.imageProvider, settings.imageModel, value.prompt.trim(), signal, aspectRatio);
      signal?.throwIfAborted();
      if (!current()) throw new DOMException('The chat was deleted or changed.', 'AbortError');
      const prepared = prepareGeneratedImage(generated);
      const source = storeChatImage(execution.owner, { bytes: prepared.image, mimeType: prepared.mimeType }, {
        ...(aspectRatio ? { aspectRatio } : {}), title, alt, prompt: value.prompt.trim(), provider: settings.imageProvider, model: settings.imageModel, createdAt: new Date().toISOString(),
      });
      result.push(`\n\n![${alt}](${source})\n\n`);
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
      const message = error instanceof Error ? error.message : 'Image generation failed. Please retry.';
      result.push(`\n\n\`\`\`nodus-image-error\n${JSON.stringify({ message: message.replace(/[\r\n]+/g, ' ').slice(0, 500) })}\n\`\`\`\n\n`);
    }
  }
  assertChatSkillSession(execution, signal);
  return result.join('');
}
