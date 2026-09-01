import type { ModelRef } from '@shared/types';
import { completeTextStreamNeutral } from './aiClient';
import { getSettings } from '../db/settingsRepo';
import { officeChatSystem, normalizePromptLanguage } from '@shared/editorAiPrompts';

export type OfficeChatRole = 'user' | 'assistant';

export interface OfficeChatMessage {
  role: OfficeChatRole;
  content: string;
}

export interface OfficeChatContext {
  scope: 'page' | 'document';
  label: string;
  text: string;
  selectionText?: string;
  selectionTruncated?: boolean;
  selectionTotalChars?: number;
  truncated?: boolean;
  totalChars?: number;
}

export interface OfficeChatRequest {
  messages: OfficeChatMessage[];
  context: OfficeChatContext;
  model: ModelRef;
}

const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 20_000;
const MAX_CONTEXT_CHARS = 300_000;
const MAX_SELECTION_CHARS = 40_000;

function bounded(value: unknown, limit: number): string {
  return String(value ?? '').replace(/\r\n/g, '\n').slice(0, limit);
}

export function normalizeOfficeChatRequest(input: OfficeChatRequest): OfficeChatRequest {
  const messages = (Array.isArray(input.messages) ? input.messages : [])
    .slice(-MAX_MESSAGES)
    .filter((message): message is OfficeChatMessage => (
      Boolean(message) && (message.role === 'user' || message.role === 'assistant')
    ))
    .map((message) => ({ role: message.role, content: bounded(message.content, MAX_MESSAGE_CHARS) }))
    .filter((message) => message.content.trim());
  if (!messages.length || messages.at(-1)?.role !== 'user') {
    throw new Error('El chat necesita una pregunta del usuario.');
  }
  const rawContext = String(input.context?.text ?? '');
  const rawSelection = String(input.context?.selectionText ?? '');
  const contextText = bounded(rawContext, MAX_CONTEXT_CHARS);
  const selectionText = bounded(rawSelection, MAX_SELECTION_CHARS);
  if (!contextText.trim() && !selectionText.trim()) {
    throw new Error('No hay texto del documento disponible para responder.');
  }
  return {
    messages,
    context: {
      scope: input.context?.scope === 'document' ? 'document' : 'page',
      label: bounded(input.context?.label, 240),
      text: contextText,
      selectionText,
      selectionTruncated: Boolean(input.context?.selectionTruncated) || rawSelection.length > MAX_SELECTION_CHARS,
      selectionTotalChars: Math.max(rawSelection.length, Number(input.context?.selectionTotalChars) || 0),
      truncated: Boolean(input.context?.truncated) || rawContext.length > MAX_CONTEXT_CHARS,
      totalChars: Math.max(rawContext.length, Number(input.context?.totalChars) || 0),
    },
    model: input.model,
  };
}

export function buildOfficeChatPrompt(input: OfficeChatRequest): { system: string; user: string } {
  const normalized = normalizeOfficeChatRequest(input);
  return {
    system: officeChatSystem(normalizePromptLanguage(getSettings().promptLanguage)),
    user: JSON.stringify({
      contextScope: normalized.context.scope,
      contextLabel: normalized.context.label,
      contextWasTruncated: normalized.context.truncated,
      selectionWasTruncated: normalized.context.selectionTruncated,
      untrustedDocumentContext: normalized.context.text,
      untrustedSelectedPassage: normalized.context.selectionText || '',
      priorConversation: normalized.messages.slice(0, -1),
      authorizedQuestion: normalized.messages.at(-1)?.content ?? '',
    }),
  };
}

export async function streamOfficeChat(
  request: OfficeChatRequest,
  onDelta: (delta: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const normalized = normalizeOfficeChatRequest(request);
  const prompt = buildOfficeChatPrompt(normalized);
  return completeTextStreamNeutral({
    ...prompt,
    temperature: 0.25,
    maxTokens: 3_200,
    plainContext: true,
    signal,
  }, (delta, kind) => {
    if (kind !== 'reasoning') onDelta(delta);
  }, normalized.model, signal);
}
