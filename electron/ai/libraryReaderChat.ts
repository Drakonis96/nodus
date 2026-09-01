import type {
  LibraryReaderChatRequest,
  LibraryReaderChatResponse,
  ModelRef,
  NodiChatRequest,
  NodiViewContext,
  PromptLanguage,
  WritingDraftAnnotation,
} from '@shared/types';
import { getSettings } from '../db/settingsRepo';
import {
  getLibraryReaderAttachmentContent,
  getLibraryReaderDocument,
  getLibraryReaderRawContent,
  libraryReaderAttachmentPath,
  listLibraryReaderAnnotations,
} from '../libraryReader/libraryReaderStore';
import { extractFromPath } from '../extraction/textExtractor';
import { localModelContextWindow, resolveModelRef } from './aiClient';
import { streamNodiChat } from './nodiChat';

const MAX_HISTORY = 12;
const CLOUD_DOCUMENT_CHARS = 300_000;
const CHARS_PER_TOKEN = 3.2;

interface LibraryReaderContextCopy {
  truncated: string;
  cleanMarkdown: string;
  cleanVersionContext: string;
  documentUnavailable: string;
  unreadableFile: string;
  unreadableSource: string;
  questionRequired: string;
}

const LIBRARY_READER_CONTEXT_COPY: Record<PromptLanguage, LibraryReaderContextCopy> = {
  es: { truncated: '[... contenido central omitido por el límite de contexto ...]', cleanMarkdown: 'Markdown limpio', cleanVersionContext: 'contexto de la versión limpia', documentUnavailable: 'El documento ya no está disponible.', unreadableFile: 'Este archivo no contiene texto legible para el chat.', unreadableSource: 'La fuente seleccionada no contiene texto legible para el chat.', questionRequired: 'Escribe una pregunta antes de enviarla.' },
  en: { truncated: '[... middle content omitted due to the context limit ...]', cleanMarkdown: 'Clean Markdown', cleanVersionContext: 'clean-version context', documentUnavailable: 'The document is no longer available.', unreadableFile: 'This file contains no readable text for the chat.', unreadableSource: 'The selected source contains no readable text for the chat.', questionRequired: 'Enter a question before sending it.' },
  fr: { truncated: '[... contenu central omis en raison de la limite de contexte ...]', cleanMarkdown: 'Markdown nettoyé', cleanVersionContext: 'contexte de la version nettoyée', documentUnavailable: "Le document n’est plus disponible.", unreadableFile: 'Ce fichier ne contient aucun texte lisible pour le chat.', unreadableSource: 'La source sélectionnée ne contient aucun texte lisible pour le chat.', questionRequired: 'Saisissez une question avant de l’envoyer.' },
  de: { truncated: '[... mittlerer Inhalt wegen des Kontextlimits ausgelassen ...]', cleanMarkdown: 'Bereinigtes Markdown', cleanVersionContext: 'Kontext der bereinigten Version', documentUnavailable: 'Das Dokument ist nicht mehr verfügbar.', unreadableFile: 'Diese Datei enthält keinen für den Chat lesbaren Text.', unreadableSource: 'Die ausgewählte Quelle enthält keinen für den Chat lesbaren Text.', questionRequired: 'Gib vor dem Senden eine Frage ein.' },
  pt: { truncated: '[... conteúdo central omitido devido ao limite de contexto ...]', cleanMarkdown: 'Markdown limpo', cleanVersionContext: 'contexto da versão limpa', documentUnavailable: 'O documento já não está disponível.', unreadableFile: 'Este ficheiro não contém texto legível para o chat.', unreadableSource: 'A fonte selecionada não contém texto legível para o chat.', questionRequired: 'Escreva uma pergunta antes de a enviar.' },
  'pt-BR': { truncated: '[... conteúdo central omitido devido ao limite de contexto ...]', cleanMarkdown: 'Markdown limpo', cleanVersionContext: 'contexto da versão limpa', documentUnavailable: 'O documento não está mais disponível.', unreadableFile: 'Este arquivo não contém texto legível para o chat.', unreadableSource: 'A fonte selecionada não contém texto legível para o chat.', questionRequired: 'Digite uma pergunta antes de enviá-la.' },
  it: { truncated: '[... contenuto centrale omesso per il limite di contesto ...]', cleanMarkdown: 'Markdown pulito', cleanVersionContext: 'contesto della versione pulita', documentUnavailable: 'Il documento non è più disponibile.', unreadableFile: 'Questo file non contiene testo leggibile per la chat.', unreadableSource: 'La fonte selezionata non contiene testo leggibile per la chat.', questionRequired: 'Inserisci una domanda prima di inviarla.' },
  tr: { truncated: '[... bağlam sınırı nedeniyle orta bölüm atlandı ...]', cleanMarkdown: 'Temiz Markdown', cleanVersionContext: 'temiz sürüm bağlamı', documentUnavailable: 'Belge artık kullanılamıyor.', unreadableFile: 'Bu dosyada sohbet için okunabilir metin bulunmuyor.', unreadableSource: 'Seçilen kaynakta sohbet için okunabilir metin bulunmuyor.', questionRequired: 'Göndermeden önce bir soru yazın.' },
};

function annotationContext(annotations: WritingDraftAnnotation[], sourceId = 'clean'): Array<Record<string, string>> {
  const scope = sourceId === 'clean' ? 'source' : `attachment:${sourceId}`;
  return annotations
    .filter((annotation) => annotation.scope === scope || annotation.scope.startsWith(`${scope}:`))
    .slice(-80)
    .map((annotation) => ({
      kind: annotation.kind,
      quote: annotation.selectedText.replace(/\s+/g, ' ').trim(),
      ...(annotation.comment ? { comment: annotation.comment } : {}),
    }));
}

function boundedDocument(markdown: string, limit: number, marker: string): { text: string; truncated: boolean } {
  if (markdown.length <= limit) return { text: markdown, truncated: false };
  const head = Math.ceil(limit * 0.72);
  const tail = Math.max(0, limit - head);
  return {
    text: `${markdown.slice(0, head)}\n\n${marker}\n\n${markdown.slice(-tail)}`,
    truncated: true,
  };
}

export function buildLibraryReaderNodiContext(input: {
  documentId: string;
  title: string;
  authors: string[];
  year: number | null;
  markdown: string;
  sourceLabel?: string;
  sourceId?: string;
  annotations: WritingDraftAnnotation[];
  sections: Array<{ id: string; title: string; page: number | null }>;
  documentCharLimit?: number;
  language?: PromptLanguage;
}): { currentView: NodiViewContext; readerGrounding: NonNullable<NodiChatRequest['readerGrounding']> } {
  const copy = LIBRARY_READER_CONTEXT_COPY[input.language ?? 'es'];
  const document = boundedDocument(input.markdown, Math.max(2_000, input.documentCharLimit ?? CLOUD_DOCUMENT_CHARS), copy.truncated);
  const citationUri = `nodus://reader/${encodeURIComponent(input.documentId)}`;
  const outline = input.sections.map((section) => ({
    id: section.id,
    title: section.title,
    ...(section.page ? { page: section.page } : {}),
    citation: `${citationUri}/section/${encodeURIComponent(section.id)}`,
  }));
  const metadata = {
    id: input.documentId,
    title: input.title,
    authors: input.authors,
    year: input.year,
    source: input.sourceLabel ?? copy.cleanMarkdown,
    truncated: document.truncated,
  };
  return {
    currentView: {
      viewId: `library-reader:${input.documentId}`,
      title: input.title,
      capturedAt: Date.now(),
      complete: true,
      text: [
        '<open_document>',
        JSON.stringify({ metadata, tracedOutline: outline, annotations: annotationContext(input.annotations, input.sourceId) }, null, 2),
        '</open_document>',
        '<document_content>',
        document.text,
        '</document_content>',
      ].join('\n\n'),
    },
    readerGrounding: {
      documentId: input.documentId,
      title: input.title,
      citationUri,
      sections: input.sections,
    },
  };
}

function effectiveModel(request: LibraryReaderChatRequest): ModelRef {
  const settings = getSettings();
  return resolveModelRef(request.model ?? settings.nodiModel ?? settings.chatModel ?? settings.synthesisModel);
}

export async function streamLibraryReaderChat(
  request: LibraryReaderChatRequest,
  onDelta: (delta: string, kind?: 'content' | 'reasoning') => void,
  signal?: AbortSignal,
): Promise<LibraryReaderChatResponse> {
  const settings = getSettings();
  const language = settings.promptLanguage ?? 'es';
  const copy = LIBRARY_READER_CONTEXT_COPY[language];
  const document = getLibraryReaderDocument(request.documentId);
  if (!document) throw new Error(copy.documentUnavailable);
  const clean = getLibraryReaderRawContent(request.documentId);
  const sourceId = request.sourceId && request.sourceId !== 'clean' ? request.sourceId : 'clean';
  const attachment = sourceId === 'clean' ? null : document.attachments.find((entry) => entry.id === sourceId) ?? null;
  let contextSourceId = attachment?.id ?? 'clean';
  let sourceText = clean?.markdown ?? '';
  let sourceLabel = copy.cleanMarkdown;
  if (attachment) {
    sourceLabel = `${attachment.title} (${attachment.fileName})`;
    const readable = await getLibraryReaderAttachmentContent(request.documentId, attachment.id).catch(() => null);
    if (readable?.text.trim()) sourceText = readable.text;
    else {
      const file = libraryReaderAttachmentPath(request.documentId, attachment.id);
      if (file) {
        try {
          sourceText = (await extractFromPath(file, {
            ocr: { enabled: settings.ocrEnabled, languages: settings.ocrLanguages, maxPages: settings.ocrMaxPages },
          })).text;
        } catch {
          if (!sourceText) throw new Error(copy.unreadableFile);
          sourceLabel = `${sourceLabel}; ${copy.cleanVersionContext}`;
          contextSourceId = 'clean';
        }
      }
    }
  }
  if (!sourceText.trim()) throw new Error(copy.unreadableSource);
  const messages = request.messages.filter((message) => message.content.trim()).slice(-MAX_HISTORY);
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    throw new Error(copy.questionRequired);
  }
  const model = effectiveModel(request);
  const localWindow = await localModelContextWindow(model);
  const documentCharLimit = localWindow
    ? Math.max(2_000, Math.min(CLOUD_DOCUMENT_CHARS, Math.floor((localWindow - 1_800) * CHARS_PER_TOKEN)))
    : CLOUD_DOCUMENT_CHARS;
  const grounding = buildLibraryReaderNodiContext({
    documentId: document.workId,
    title: document.title,
    authors: document.authors,
    year: document.year,
    markdown: sourceText,
    sourceLabel,
    sourceId: contextSourceId,
    annotations: listLibraryReaderAnnotations(request.documentId),
    sections: document.sections.map((section) => ({ id: section.id, title: section.title, page: section.page })),
    documentCharLimit,
    language,
  });
  const nodiRequest: NodiChatRequest = {
    messages: messages.map(({ role, content }) => ({ role, content })),
    contexts: ['current_view', 'vault'],
    model,
    currentView: grounding.currentView,
    readerGrounding: grounding.readerGrounding,
  };
  const answer = await streamNodiChat(nodiRequest, (delta) => onDelta(delta, 'content'), signal);
  return { answer: answer.trim(), model };
}
