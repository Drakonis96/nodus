import type {
  LibraryReaderChatMessage,
  LibraryReaderChatRequest,
  LibraryReaderChatResponse,
  ModelRef,
  WritingDraftAnnotation,
} from '@shared/types';
import { getSettings } from '../db/settingsRepo';
import {
  getLibraryReaderRawContent,
  listLibraryReaderAnnotations,
} from '../libraryReader/libraryReaderStore';
import { completeTextStream, localModelContextWindow, resolveModelRef } from './aiClient';

const MAX_HISTORY = 12;
const CLOUD_DOCUMENT_CHARS = 300_000;
const CHARS_PER_TOKEN = 3.2;

function annotationContext(annotations: WritingDraftAnnotation[]): Array<Record<string, string>> {
  return annotations
    .filter((annotation) => annotation.scope === 'source')
    .slice(-80)
    .map((annotation) => ({
      kind: annotation.kind,
      quote: annotation.selectedText.replace(/\s+/g, ' ').trim(),
      ...(annotation.comment ? { comment: annotation.comment } : {}),
    }));
}

function boundedDocument(markdown: string, limit: number): { text: string; truncated: boolean } {
  if (markdown.length <= limit) return { text: markdown, truncated: false };
  const head = Math.ceil(limit * 0.72);
  const tail = Math.max(0, limit - head);
  return {
    text: `${markdown.slice(0, head)}\n\n[... contenido central omitido por el límite de contexto ...]\n\n${markdown.slice(-tail)}`,
    truncated: true,
  };
}

export function buildLibraryReaderChatPrompt(input: {
  title: string;
  authors: string[];
  year: number | null;
  markdown: string;
  annotations: WritingDraftAnnotation[];
  messages: LibraryReaderChatMessage[];
  documentCharLimit?: number;
}): { system: string; user: string } {
  const cleanMessages = input.messages
    .filter((message) => (message.role === 'user' || message.role === 'assistant') && message.content.trim())
    .slice(-MAX_HISTORY)
    .map(({ role, content }) => ({ role, content: content.slice(0, 24_000) }));
  const document = boundedDocument(input.markdown, Math.max(2_000, input.documentCharLimit ?? CLOUD_DOCUMENT_CHARS));
  return {
    system:
      'Eres el asistente académico del lector de Nodus. Responde en el idioma de la pregunta. ' +
      'Prioriza el DOCUMENTO y las ANOTACIONES facilitadas. Distingue claramente entre lo que afirma la fuente, ' +
      'la interpretación del usuario y tus inferencias. Cita encabezados o fragmentos breves cuando ayuden, pero ' +
      'no inventes números de página, citas, metadatos ni contenido ausente. Si la respuesta no está en el documento, dilo. ' +
      'Usa Markdown claro y conciso.',
    user: JSON.stringify({
      document: {
        title: input.title,
        authors: input.authors,
        year: input.year,
        truncated: document.truncated,
        markdown: document.text,
      },
      annotations: annotationContext(input.annotations),
      conversation: cleanMessages,
      instruction: 'Responde al último mensaje del usuario usando este contexto de lectura.',
    }),
  };
}

function effectiveModel(request: LibraryReaderChatRequest): ModelRef {
  const settings = getSettings();
  return resolveModelRef(request.model ?? settings.chatModel ?? settings.nodiModel ?? settings.synthesisModel);
}

export async function streamLibraryReaderChat(
  request: LibraryReaderChatRequest,
  onDelta: (delta: string, kind?: 'content' | 'reasoning') => void,
  signal?: AbortSignal,
): Promise<LibraryReaderChatResponse> {
  const content = getLibraryReaderRawContent(request.documentId);
  if (!content) throw new Error('La versión limpia del documento ya no está disponible.');
  const messages = request.messages.filter((message) => message.content.trim()).slice(-MAX_HISTORY);
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    throw new Error('Escribe una pregunta antes de enviarla.');
  }
  const model = effectiveModel(request);
  const localWindow = await localModelContextWindow(model);
  const documentCharLimit = localWindow
    ? Math.max(2_000, Math.min(CLOUD_DOCUMENT_CHARS, Math.floor((localWindow - 1_800) * CHARS_PER_TOKEN)))
    : CLOUD_DOCUMENT_CHARS;
  const prompt = buildLibraryReaderChatPrompt({
    title: content.document.title,
    authors: content.document.authors,
    year: content.document.year,
    markdown: content.markdown,
    annotations: listLibraryReaderAnnotations(request.documentId),
    messages,
    documentCharLimit,
  });
  const maxTokens = localWindow ? Math.max(300, Math.min(2_000, Math.floor(localWindow * 0.22))) : 4_000;
  const answer = await completeTextStream(
    { ...prompt, temperature: 0.2, maxTokens },
    onDelta,
    model,
    signal,
  );
  return { answer: answer.trim(), model };
}
