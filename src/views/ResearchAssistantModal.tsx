import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AppSettings,
  ChatConversationSummary,
  ChatMessageRecord,
  ModelRef,
  ResearchChatMessage,
  ResearchContextSelection,
  ResearchGraphPartsSelection,
} from '@shared/types';
import { Icon, modelLabel } from '../components/ui';
import { Markdown, type MarkdownCitation } from '../components/Markdown';
import { ConfirmModal } from '../components/ConfirmModal';
import { SaveToNotesModal } from '../components/SaveToNotesModal';
import { SourceCitationModal, type CitationTarget } from '../components/SourceCitationModal';
import { VirtualList } from '../components/VirtualList';
import { ASSISTANT_CONTEXTS, type AssistantNavigationTarget, type PendingGraphNavigationTarget } from '../navigation';
import { t, tx } from '../i18n';
import { useFeatureModel } from '../hooks/useFeatureModel';

const DEFAULT_SELECTION: ResearchContextSelection = {
  ideas: false,
  themes: false,
  contradictions: false,
  gaps: false,
  readingPath: false,
  authors: false,
  documents: false,
  passages: false,
  graph: false,
  graphParts: {
    ideaNodes: false,
    themeNodes: false,
    ideaEdges: false,
    authorGraph: false,
  },
};

const ALL_SELECTION: ResearchContextSelection = {
  ideas: true,
  themes: true,
  contradictions: true,
  gaps: true,
  readingPath: true,
  authors: true,
  documents: true,
  passages: true,
  graph: true,
  graphParts: {
    ideaNodes: true,
    themeNodes: true,
    ideaEdges: true,
    authorGraph: true,
  },
};

type AssistantModeId = 'synthesis' | 'gaps' | 'contradictions' | 'reading' | 'authors' | 'documents';
type ActiveAssistantModeId = AssistantModeId | 'custom';

const AUTHOR_SELECTION: ResearchContextSelection = {
  ideas: false,
  themes: true,
  contradictions: false,
  gaps: false,
  readingPath: false,
  authors: true,
  documents: true,
  passages: true,
  graph: true,
  graphParts: {
    ideaNodes: false,
    themeNodes: false,
    ideaEdges: false,
    authorGraph: true,
  },
};

const DOCUMENT_SELECTION: ResearchContextSelection = {
  ideas: true,
  themes: true,
  contradictions: false,
  gaps: false,
  readingPath: false,
  authors: false,
  documents: true,
  passages: true,
  graph: false,
  graphParts: {
    ideaNodes: false,
    themeNodes: false,
    ideaEdges: false,
    authorGraph: false,
  },
};

const SYNTHESIS_SELECTION: ResearchContextSelection = {
  ideas: true,
  themes: false,
  contradictions: true,
  gaps: true,
  readingPath: false,
  authors: false,
  documents: false,
  passages: false,
  graph: false,
  graphParts: {
    ideaNodes: false,
    themeNodes: false,
    ideaEdges: false,
    authorGraph: false,
  },
};

const ASSISTANT_MODES: {
  id: AssistantModeId;
  label: string;
  icon: string;
  description: string;
  selection: ResearchContextSelection;
  starter: string;
}[] = [
  {
    id: 'synthesis',
    label: 'Síntesis',
    icon: 'layers',
    description: 'Ideas, huecos y contradicciones básicas.',
    selection: SYNTHESIS_SELECTION,
    starter: 'Dame una síntesis crítica del corpus: ideas principales, contradicciones, huecos y próximos pasos.',
  },
  {
    id: 'gaps',
    label: 'Huecos',
    icon: 'gap',
    description: 'Preguntas abiertas, limitaciones y trabajo futuro.',
    selection: ASSISTANT_CONTEXTS.gap,
    starter: 'Prioriza los huecos de investigación del corpus y propón cómo atacarlos con lecturas o análisis.',
  },
  {
    id: 'contradictions',
    label: 'Contradicciones',
    icon: 'alert',
    description: 'Refutaciones, tensiones y evidencia asociada.',
    selection: ASSISTANT_CONTEXTS.contradiction,
    starter: 'Resume las contradicciones más relevantes y distingue tensiones reales de diferencias de marco o método.',
  },
  {
    id: 'reading',
    label: 'Lecturas',
    icon: 'route',
    description: 'Ruta de lectura, documentos, autores y grafo completo.',
    selection: ASSISTANT_CONTEXTS.reading,
    starter: 'Construye una ruta de lectura razonada para avanzar en la investigación y explica la prioridad de cada bloque.',
  },
  {
    id: 'authors',
    label: 'Autores',
    icon: 'graduation',
    description: 'Autores, documentos y red autoral.',
    selection: AUTHOR_SELECTION,
    starter: 'Analiza los autores centrales, sus relaciones y qué zonas del corpus dependen de cada grupo autoral.',
  },
  {
    id: 'documents',
    label: 'Documentos',
    icon: 'book',
    description: 'Obras relacionadas, ideas y temas sin grafo completo.',
    selection: DOCUMENT_SELECTION,
    starter: 'Compara los documentos más relevantes y señala qué aporta cada uno al argumento general.',
  },
];

// Starter prompts offered as clickable chips on an empty chat. They run against
// whatever context is currently selected (Síntesis by default), so they read as
// general research openers rather than mode switches.
const CHAT_SUGGESTIONS = [
  '¿Cuáles son las ideas más centrales del corpus y por qué?',
  'Resume las principales contradicciones y tensiones.',
  '¿Qué huecos de investigación debería priorizar?',
  'Propón una ruta de lectura para empezar.',
  '¿Qué autores son clave y cómo se relacionan?',
];

interface UiMessage extends ChatMessageRecord {
  id: string;
  /** Live reasoning/thinking trace from the model. Transient — never persisted. */
  reasoning?: string;
}

export function ResearchAssistantModal({
  settings,
  initialTarget,
  onOpenGraph,
  onClose,
}: {
  settings: AppSettings;
  initialTarget?: AssistantNavigationTarget | null;
  onOpenGraph?: (target: PendingGraphNavigationTarget) => void;
  onClose: () => void;
}) {
  const [selection, setSelection] = useState<ResearchContextSelection>(() => cloneSelection(SYNTHESIS_SELECTION));
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const [contextTitle, setContextTitle] = useState<string | null>(null);
  const [activeModeId, setActiveModeId] = useState<ActiveAssistantModeId>('synthesis');
  const [selectedModel, setSelectedModel] = useFeatureModel(settings, 'chatModel');
  const [sending, setSending] = useState(false);
  const [conversations, setConversations] = useState<ChatConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ChatConversationSummary | null>(null);
  const [citation, setCitation] = useState<CitationTarget>(null);
  const [noteTarget, setNoteTarget] = useState<{ content: string; title: string } | null>(null);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [showContext, setShowContext] = useState(false);
  // Id of the assistant message currently streaming — drives the live caret and
  // the "stop" affordance. Null when nothing is in flight.
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Whether new stream deltas should keep the view pinned to the bottom. Starts
  // true on send and flips off as soon as the user scrolls up to read back.
  const stickToBottomRef = useRef(true);
  const lastInitialTargetRef = useRef<number | null>(null);
  // Mirrors `messages` so async stream callbacks can persist the final array without
  // racing React state updates.
  const messagesRef = useRef<UiMessage[]>([]);
  messagesRef.current = messages;
  // Mirrors `activeId` so in-flight stream callbacks only touch the UI while their
  // own conversation is on screen — this lets the user switch chats mid-response
  // without the stream overwriting the conversation they switched to.
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;

  const availableModels = useMemo(() => {
    const models: ModelRef[] = [];
    const add = (model: ModelRef | null | undefined) => {
      if (!model || models.some((m) => sameModelRef(m, model))) return;
      models.push(model);
    };
    add(settings.synthesisModel);
    add(settings.chatModel);
    add(selectedModel);
    for (const model of settings.favorites ?? []) add(model);
    return models;
  }, [settings.chatModel, settings.favorites, settings.synthesisModel, selectedModel]);

  const refreshConversations = useCallback(async () => {
    setConversations(await window.nodus.listConversations(true));
  }, []);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  // Auto-grow the composer to fit its content, capped by CSS max-height (then it scrolls).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 224)}px`;
  }, [input]);

  const isNearBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 96;
  }, []);

  const updateJumpIndicator = useCallback(() => {
    const el = scrollRef.current;
    setShowJumpToBottom(!!el && el.scrollHeight > el.clientHeight + 16 && !isNearBottom());
  }, [isNearBottom]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      // The user driving the scrollbar decides whether we keep following the
      // stream: reading back (scrolling up) releases the pin; returning to the
      // bottom re-engages it.
      stickToBottomRef.current = isNearBottom();
      updateJumpIndicator();
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    updateJumpIndicator();
    return () => el.removeEventListener('scroll', onScroll);
  }, [updateJumpIndicator, isNearBottom]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    setShowJumpToBottom(false);
  }, []);

  const copyMessageMarkdown = useCallback(async (message: UiMessage) => {
    const text = message.content.trim();
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopiedMessageId(message.id);
    window.setTimeout(() => {
      setCopiedMessageId((current) => (current === message.id ? null : current));
    }, 1400);
  }, []);

  const selectedCount = useMemo(
    () =>
      [
        selection.ideas,
        selection.themes,
        selection.contradictions,
        selection.gaps,
        selection.readingPath,
        selection.authors,
        selection.documents,
        selection.passages,
        selection.graph,
      ].filter(Boolean).length,
    [selection]
  );

  const updateSelection = (key: keyof Omit<ResearchContextSelection, 'graphParts'>, value: boolean) => {
    setSelection((current) => ({ ...current, [key]: value }));
  };

  const updateGraphPart = (key: keyof ResearchGraphPartsSelection, value: boolean) => {
    setSelection((current) => ({ ...current, graphParts: { ...current.graphParts, [key]: value } }));
  };

  const applyMode = (mode: (typeof ASSISTANT_MODES)[number]) => {
    setActiveModeId(mode.id);
    setSelection(cloneSelection(mode.selection));
    setContextTitle(t(mode.label));
    if (!input.trim()) setInput(t(mode.starter));
  };

  const startNewConversation = () => {
    setActiveId(null);
    setMessages([]);
    setInput('');
    setContextTitle(t(ASSISTANT_MODES.find((mode) => mode.id === activeModeId)?.label ?? '') || null);
    setShowJumpToBottom(false);
    setCopiedMessageId(null);
  };

  useEffect(() => {
    if (!initialTarget || initialTarget.nonce === lastInitialTargetRef.current) return;
    lastInitialTargetRef.current = initialTarget.nonce;
    setActiveId(null);
    setMessages([]);
    setContextTitle(initialTarget.title ?? null);
    setActiveModeId('custom');
    if (initialTarget.selection) setSelection(cloneSelection(initialTarget.selection));
    if (initialTarget.prompt) setInput(initialTarget.prompt);
    setShowJumpToBottom(false);
    setCopiedMessageId(null);
  }, [initialTarget]);

  const loadConversation = async (id: string) => {
    const conversation = await window.nodus.getConversation(id);
    if (!conversation) {
      await refreshConversations();
      return;
    }
    setActiveId(conversation.id);
    setMessages(conversation.messages.map((m) => ({ ...m, id: m.id || crypto.randomUUID() })));
    if (conversation.selection) setSelection(cloneSelection(conversation.selection));
    if (conversation.model) setSelectedModel(conversation.model);
    setContextTitle(null);
    setInput('');
    window.setTimeout(() => scrollToBottom('auto'), 0);
  };

  const archiveConversation = async (conversation: ChatConversationSummary) => {
    await window.nodus.archiveConversation(conversation.id, !conversation.archived);
    await refreshConversations();
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    await window.nodus.deleteConversation(pendingDelete.id);
    if (pendingDelete.id === activeId) startNewConversation();
    setPendingDelete(null);
    await refreshConversations();
  };

  const persist = useCallback(
    async (conversationId: string, finalMessages: UiMessage[], shouldTitle: boolean) => {
      const records: ChatMessageRecord[] = finalMessages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        selectionKey: m.selectionKey ?? null,
        stats: m.stats ?? null,
        error: m.error ?? false,
      }));
      await window.nodus.saveConversationMessages(conversationId, records, { model: selectedModel, selection });
      if (shouldTitle) {
        await window.nodus.generateConversationTitle(conversationId, selectedModel).catch(() => '');
      }
      await refreshConversations();
    },
    [refreshConversations, selectedModel, selection]
  );

  // Runs one assistant turn against `priorMessages` + a fresh user turn. Shared by
  // the composer (send) and the regenerate action, which only differ in how they
  // pick the prior history and the user prompt.
  const generate = async (conversationId: string, priorMessages: UiMessage[], content: string) => {
    if (!selectedModel) return;
    const selectionKey = serializeSelection(selection);
    const isFirstExchange = priorMessages.length === 0;
    const userMessage: UiMessage = { id: crypto.randomUUID(), role: 'user', content, selectionKey };
    const assistantId = crypto.randomUUID();
    const requestMessages: ResearchChatMessage[] = [
      ...priorMessages.filter((m) => m.selectionKey === selectionKey && m.content.trim()),
      userMessage,
    ].map((m) => ({ role: m.role, content: m.content }));

    setMessages([...priorMessages, userMessage, { id: assistantId, role: 'assistant', content: '', selectionKey }]);
    setSending(true);
    setStreamingId(assistantId);
    stickToBottomRef.current = true;
    window.setTimeout(() => scrollToBottom('auto'), 0);

    try {
      const response = await window.nodus.researchChatStream(
        { messages: requestMessages, selection, model: selectedModel },
        {
          onDelta: (delta) => {
            if (activeIdRef.current !== conversationId) return; // user switched away
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId ? { ...message, content: message.content + delta } : message
              )
            );
            if (stickToBottomRef.current) scrollToBottom('auto');
            else window.setTimeout(updateJumpIndicator, 0);
          },
          onReasoning: (delta) => {
            if (activeIdRef.current !== conversationId) return;
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId ? { ...message, reasoning: (message.reasoning ?? '') + delta } : message
              )
            );
          },
        }
      );
      // A user-triggered stop resolves with the partial answer; treat an empty
      // partial as "nothing generated" and drop the placeholder bubble.
      const answer = response.answer.trim();
      const finalMessages: UiMessage[] = answer
        ? [
            ...priorMessages,
            userMessage,
            { id: assistantId, role: 'assistant', content: answer, selectionKey, stats: response.stats },
          ]
        : [...priorMessages, userMessage];
      if (activeIdRef.current === conversationId) {
        setMessages(finalMessages);
        window.setTimeout(updateJumpIndicator, 0);
      }
      await persist(conversationId, finalMessages, isFirstExchange);
    } catch (e) {
      const errorMessage: UiMessage = {
        id: assistantId,
        role: 'assistant',
        content: e instanceof Error ? e.message : String(e),
        selectionKey,
        error: true,
      };
      const finalMessages = [...priorMessages, userMessage, errorMessage];
      if (activeIdRef.current === conversationId) {
        setMessages(finalMessages);
        window.setTimeout(updateJumpIndicator, 0);
      }
      await persist(conversationId, finalMessages, false);
    } finally {
      setSending(false);
      setStreamingId(null);
    }
  };

  const send = async (explicit?: string) => {
    const content = (explicit ?? input).trim();
    if (!content || sending || !selectedModel) return;

    // Lazily create the conversation on the first message so empty chats never clutter history.
    let conversationId = activeId;
    if (!conversationId) {
      const created = await window.nodus.createConversation({ model: selectedModel, selection });
      conversationId = created.id;
      setActiveId(created.id);
    }
    // Only the composer's own text is cleared on send; an explicit prompt (a
    // suggestion chip) must not wipe a draft the user may have typed.
    if (!explicit) setInput('');
    await generate(conversationId, messagesRef.current, content);
  };

  // Re-answer the most recent user turn (dropping the answer it produced). Uses the
  // current model + context selection, so it doubles as "try again with this context".
  const regenerateLast = async () => {
    if (sending || !selectedModel) return;
    const current = messagesRef.current;
    let lastUserIdx = -1;
    for (let i = current.length - 1; i >= 0; i--) {
      if (current[i].role === 'user' && current[i].content.trim()) {
        lastUserIdx = i;
        break;
      }
    }
    const conversationId = activeIdRef.current;
    if (lastUserIdx < 0 || !conversationId) return;
    await generate(conversationId, current.slice(0, lastUserIdx), current[lastUserIdx].content);
  };

  const handleStop = () => {
    void window.nodus.cancelResearchChat();
  };

  const serializedModel = selectedModel ? serializeModel(selectedModel) : '';
  const visibleConversations = conversations.filter((c) => showArchived || !c.archived);
  const archivedCount = conversations.filter((c) => c.archived).length;
  const activeMode = ASSISTANT_MODES.find((mode) => mode.id === activeModeId);
  const lastMessageId = messages.length ? messages[messages.length - 1].id : null;
  // Citations always open their evidence first. Navigation to the graph remains
  // available from that detail modal, rather than unexpectedly closing the chat.
  const handleCitation = useCallback((c: MarkdownCitation) => {
    setCitation({ kind: c.kind, id: c.id });
  }, []);
  const openGraphFromCitation = useCallback(
    (target: PendingGraphNavigationTarget) => {
      setCitation(null);
      onOpenGraph?.(target);
    },
    [onOpenGraph]
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/70 p-4 flex items-center justify-center">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-7xl h-[86vh] bg-neutral-950 border border-neutral-800 rounded-lg shadow-2xl flex flex-col overflow-hidden"
      >
        <header className="px-4 py-3 border-b border-neutral-800 flex items-center gap-3">
          <div className="flex items-center gap-2 font-semibold">
            <Icon name="chat" className="text-indigo-300" />
            {t('Asistente de investigación')}
          </div>
          <select
            className="input text-xs py-1 max-w-xs"
            title={t('Modelo del chat')}
            value={serializedModel}
            onChange={(e) => setSelectedModel(e.target.value ? parseModel(e.target.value) : null)}
          >
            {!selectedModel && <option value="">{t('Sin modelo seleccionado')}</option>}
            {availableModels.map((model) => (
              <option key={serializeModel(model)} value={serializeModel(model)}>
                {modelLabel(model)}
              </option>
            ))}
          </select>
          <button
            className="btn btn-ghost border border-neutral-700 gap-1.5 text-xs py-1"
            title={t('Elegir qué partes del corpus ve el asistente')}
            onClick={() => setShowContext(true)}
          >
            <Icon name="layers" size={13} className="text-indigo-300" />
            <span className="hidden sm:inline">{activeMode ? t(activeMode.label) : t('Contexto')}</span>
            <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-300">{selectedCount}</span>
          </button>
          {contextTitle && (
            <span className="hidden md:inline-flex max-w-xs items-center gap-1.5 rounded-md border border-indigo-900/70 bg-indigo-950/25 px-2 py-1 text-xs text-indigo-200">
              <Icon name="fit" size={12} />
              <span className="truncate">{contextTitle}</span>
            </span>
          )}
          <div className="flex-1" />
          <button className="btn btn-ghost" onClick={onClose} title={t('Cerrar')}>
            <Icon name="x" />
          </button>
        </header>

        <div className="flex-1 min-h-0 flex flex-col md:flex-row">
          {/* Conversation history */}
          <aside className="w-full md:w-60 shrink-0 border-b md:border-b-0 md:border-r border-neutral-800 flex flex-col max-h-48 md:max-h-none">
            <div className="p-3 border-b border-neutral-800">
              <button className="btn btn-primary w-full gap-1.5" onClick={startNewConversation} disabled={sending}>
                <Icon name="plus" /> {t('Nueva conversación')}
              </button>
            </div>
            <VirtualList
              items={visibleConversations}
              itemHeight={58}
              getKey={(conversation) => conversation.id}
              className="flex-1 min-h-0 p-2"
              empty={
                <div className="text-xs text-neutral-600 text-center py-6 px-2">
                  {t('Aún no hay conversaciones. Escribe abajo para empezar.')}
                </div>
              }
              renderItem={(conversation) => (
                <div className="h-[52px]">
                  <ConversationRow
                    conversation={conversation}
                    active={conversation.id === activeId}
                    onOpen={() => void loadConversation(conversation.id)}
                    onArchive={() => void archiveConversation(conversation)}
                    onDelete={() => setPendingDelete(conversation)}
                  />
                </div>
              )}
            />
            {archivedCount > 0 && (
              <button
                className="text-xs text-neutral-500 hover:text-neutral-300 px-3 py-2 border-t border-neutral-800 text-left flex items-center gap-1.5"
                onClick={() => setShowArchived((v) => !v)}
              >
                <Icon name="archive" size={13} />
                {showArchived ? t('Ocultar archivadas') : tx('Ver archivadas ({n})', { n: archivedCount })}
              </button>
            )}
          </aside>

          <section className="flex-1 min-w-0 flex flex-col">
            <div className="relative flex-1 min-h-0">
              <div ref={scrollRef} className="h-full overflow-y-auto p-4 space-y-3">
                {messages.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center gap-5 px-4 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <span className="grid h-12 w-12 place-items-center rounded-full border border-indigo-900/70 bg-indigo-950/30 text-indigo-300">
                        <Icon name="chat" size={22} />
                      </span>
                      <p className="max-w-md text-sm text-neutral-400">
                        {t('Pregunta sobre ideas, autores, temas, contradicciones o documentos.')}
                      </p>
                    </div>
                    <div className="flex max-w-xl flex-wrap justify-center gap-2">
                      {CHAT_SUGGESTIONS.map((suggestion) => (
                        <button
                          key={suggestion}
                          className="suggestion-chip"
                          disabled={sending || !selectedModel}
                          onClick={() => void send(t(suggestion))}
                        >
                          {t(suggestion)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {messages.map((message) => (
                  <div
                    key={message.id}
                    data-message-id={message.id}
                    className={`msg-in flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`group relative max-w-[78%] rounded-lg border px-3 py-2 pr-16 text-sm ${
                        message.role === 'user'
                          ? 'bg-indigo-600 border-indigo-500 text-white whitespace-pre-wrap'
                          : message.error
                            ? 'bg-red-950/40 border-red-800 text-red-200 whitespace-pre-wrap'
                            : 'bg-neutral-900 border-neutral-800 text-neutral-200'
                      }`}
                    >
                      <div className="absolute right-2 top-2 flex items-center gap-0.5">
                        {message.role === 'assistant' &&
                          !message.error &&
                          message.id === lastMessageId &&
                          message.id !== streamingId &&
                          message.content.trim() && (
                            <button
                              className="rounded p-1 text-neutral-500 opacity-70 transition hover:bg-neutral-800 hover:text-indigo-300 hover:opacity-100 disabled:opacity-40"
                              title={t('Regenerar respuesta')}
                              onClick={() => void regenerateLast()}
                              disabled={sending}
                            >
                              <Icon name="refresh" size={13} />
                            </button>
                          )}
                        {message.role === 'assistant' && !message.error && message.content.trim() && (
                          <button
                            className="rounded p-1 text-neutral-500 opacity-70 transition hover:bg-neutral-800 hover:text-indigo-300 hover:opacity-100"
                            title={t('Guardar en notas')}
                            onClick={() =>
                              setNoteTarget({ content: message.content, title: deriveNoteTitle(message.content, contextTitle) })
                            }
                          >
                            <Icon name="notebook" size={13} />
                          </button>
                        )}
                        <button
                          className={`rounded p-1 opacity-70 transition hover:opacity-100 ${
                            message.role === 'user'
                              ? 'text-indigo-100 hover:bg-indigo-500 hover:text-white'
                              : 'text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200'
                          }`}
                          title={copiedMessageId === message.id ? t('Copiado') : t('Copiar en Markdown')}
                          onClick={() => void copyMessageMarkdown(message)}
                          disabled={!message.content.trim()}
                        >
                          <Icon name={copiedMessageId === message.id ? 'check' : 'copy'} size={13} />
                        </button>
                      </div>
                      {message.role === 'assistant' && message.reasoning?.trim() && (
                        <details className="mb-2 rounded border border-neutral-800 bg-neutral-950/60" open={!message.content.trim()}>
                          <summary className="cursor-pointer select-none px-2 py-1 text-[11px] text-neutral-400 hover:text-neutral-200">
                            {t('Razonamiento')}
                          </summary>
                          <div className="max-h-48 overflow-y-auto whitespace-pre-wrap px-2 pb-2 text-[11px] text-neutral-500">
                            {message.reasoning}
                          </div>
                        </details>
                      )}
                      {message.role === 'assistant' && !message.error ? (
                        message.content ? (
                          <div className={message.id === streamingId ? 'stream-body' : undefined}>
                            <Markdown content={message.content} onCitation={handleCitation} />
                            {message.id === streamingId && <span aria-hidden className="stream-caret" />}
                          </div>
                        ) : message.id === streamingId ? (
                          <span className="stream-dots" aria-label={t('Generando…')}>
                            <i />
                            <i />
                            <i />
                          </span>
                        ) : null
                      ) : (
                        message.content
                      )}
                      {message.error && message.id === lastMessageId && !sending && (
                        <button
                          className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-red-800/70 px-2 py-1 text-xs text-red-200 transition hover:bg-red-900/40"
                          onClick={() => void regenerateLast()}
                        >
                          <Icon name="refresh" size={12} /> {t('Reintentar')}
                        </button>
                      )}
                      {message.stats && (
                        <div className="mt-2 pt-2 border-t border-neutral-800 text-[11px] text-neutral-500 whitespace-normal">
                          {message.stats.sections.join(', ') || t('Sin secciones')} · {tx('{n} obras', { n: message.stats.works })} ·{' '}
                          {tx('{n} docs', { n: message.stats.documents })} · {tx('{n} pasajes', { n: message.stats.passages })} · {formatChars(message.stats.contextChars)}
                          {message.stats.truncated ? ` · ${t('recortado')}` : ''}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {showJumpToBottom && (
                <button
                  className="absolute bottom-4 right-4 h-10 w-10 rounded-full border border-neutral-700 bg-neutral-900/95 text-neutral-200 shadow-lg transition hover:bg-neutral-800"
                  title={t('Bajar al final')}
                  onClick={() => scrollToBottom()}
                >
                  <Icon name="arrowDown" />
                </button>
              )}
            </div>

            <footer className="border-t border-neutral-800 p-3">
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  className="input flex-1 min-h-[52px] max-h-56 resize-none"
                  rows={2}
                  value={input}
                  placeholder={activeMode?.starter ? t(activeMode.starter) : t('Pregunta al asistente...')}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                {sending ? (
                  <button
                    className="btn self-end h-11 w-11 px-0 border border-red-800 bg-red-950/40 text-red-200 transition hover:bg-red-900/50"
                    title={t('Detener generación')}
                    onClick={handleStop}
                  >
                    <Icon name="stop" />
                  </button>
                ) : (
                  <button
                    className="btn btn-primary self-end h-11 w-11 px-0"
                    title={t('Enviar')}
                    onClick={() => void send()}
                    disabled={!input.trim() || !selectedModel}
                  >
                    <Icon name="arrowUp" />
                  </button>
                )}
              </div>
              <div className="mt-1.5 flex items-center gap-1 px-1 text-[11px] text-neutral-600">
                <kbd className="composer-kbd">Enter</kbd>
                <span>{t('para enviar')}</span>
                <span className="text-neutral-700">·</span>
                <kbd className="composer-kbd">Shift</kbd>
                <span>+</span>
                <kbd className="composer-kbd">Enter</kbd>
                <span>{t('salto de línea')}</span>
              </div>
            </footer>
          </section>
        </div>
      </div>

      {showContext && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setShowContext(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="flex max-h-[86vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center gap-2 border-b border-neutral-800 px-4 py-3">
              <Icon name="layers" className="text-indigo-300" />
              <span className="text-sm font-semibold">{t('Contexto del asistente')}</span>
              <span className="text-xs text-neutral-500">
                {tx('{n} seleccionados', { n: selectedCount })}
              </span>
              <div className="flex-1" />
              <button className="btn btn-ghost" onClick={() => setShowContext(false)} title={t('Cerrar')}>
                <Icon name="x" />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <p className="mb-3 text-xs text-neutral-500">
                {t('Elige un modo o combina las secciones del corpus que el asistente puede leer.')}
              </p>
              <div className="mb-4">
                <div className="mb-2 text-[11px] uppercase text-neutral-500">{t('Modo')}</div>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {ASSISTANT_MODES.map((mode) => (
                    <button
                      key={mode.id}
                      className={`rounded-md border px-2.5 py-2 text-left transition-colors ${
                        activeModeId === mode.id
                          ? 'border-indigo-700 bg-indigo-950/35'
                          : 'border-neutral-800 hover:bg-neutral-900'
                      }`}
                      title={t(mode.description)}
                      onClick={() => applyMode(mode)}
                    >
                      <div className="flex items-center gap-1.5 text-sm">
                        <Icon
                          name={mode.icon}
                          size={13}
                          className={activeModeId === mode.id ? 'text-indigo-300' : 'text-neutral-500'}
                        />
                        <span>{t(mode.label)}</span>
                      </div>
                      <div className="mt-0.5 line-clamp-1 text-[11px] text-neutral-500">{t(mode.description)}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div className="mb-3 flex gap-2">
                <button
                  className="btn btn-ghost flex-1 border border-neutral-700 py-1 text-xs"
                  onClick={() => {
                    setActiveModeId('custom');
                    setContextTitle(t('Todo'));
                    setSelection(cloneSelection(ALL_SELECTION));
                  }}
                >
                  {t('Todo')}
                </button>
                <button
                  className="btn btn-ghost flex-1 border border-neutral-700 py-1 text-xs"
                  onClick={() => {
                    setActiveModeId('custom');
                    setContextTitle(t('Manual'));
                    setSelection(cloneSelection(DEFAULT_SELECTION));
                  }}
                >
                  {t('Nada')}
                </button>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <ContextCheckbox label={t('Ideas generadas')} checked={selection.ideas} onChange={(v) => updateSelection('ideas', v)} />
                <ContextCheckbox label={t('Temas principales')} checked={selection.themes} onChange={(v) => updateSelection('themes', v)} />
                <ContextCheckbox label={t('Contradicciones')} checked={selection.contradictions} onChange={(v) => updateSelection('contradictions', v)} />
                <ContextCheckbox label={t('Huecos de investigación')} checked={selection.gaps} onChange={(v) => updateSelection('gaps', v)} />
                <ContextCheckbox label={t('Rutas de lectura')} checked={selection.readingPath} onChange={(v) => updateSelection('readingPath', v)} />
                <ContextCheckbox label={t('Autores')} checked={selection.authors} onChange={(v) => updateSelection('authors', v)} />
                <ContextCheckbox label={t('Documentos relacionados')} checked={selection.documents} onChange={(v) => updateSelection('documents', v)} />
                <ContextCheckbox label={t('Pasajes de texto completo')} checked={selection.passages} onChange={(v) => updateSelection('passages', v)} />
                <ContextCheckbox label={t('Grafo')} checked={selection.graph} onChange={(v) => updateSelection('graph', v)} />
              </div>

              <div className={`mt-3 space-y-2 border-l border-neutral-800 pl-3 ${selection.graph ? '' : 'opacity-45'}`}>
                <ContextCheckbox
                  label={t('Nodos de ideas')}
                  checked={selection.graphParts.ideaNodes}
                  disabled={!selection.graph}
                  onChange={(v) => updateGraphPart('ideaNodes', v)}
                />
                <ContextCheckbox
                  label={t('Nodos de temas')}
                  checked={selection.graphParts.themeNodes}
                  disabled={!selection.graph}
                  onChange={(v) => updateGraphPart('themeNodes', v)}
                />
                <ContextCheckbox
                  label={t('Relaciones de ideas')}
                  checked={selection.graphParts.ideaEdges}
                  disabled={!selection.graph}
                  onChange={(v) => updateGraphPart('ideaEdges', v)}
                />
                <ContextCheckbox
                  label={t('Grafo de autores')}
                  checked={selection.graphParts.authorGraph}
                  disabled={!selection.graph}
                  onChange={(v) => updateGraphPart('authorGraph', v)}
                />
              </div>
            </div>
            <footer className="border-t border-neutral-800 p-3">
              <button className="btn btn-primary w-full" onClick={() => setShowContext(false)}>
                {t('Listo')}
              </button>
            </footer>
          </div>
        </div>
      )}

      {pendingDelete && (
        <ConfirmModal
          title={t('Eliminar conversación')}
          message={
            <>
              {t('Se eliminará')} <span className="text-neutral-200">«{pendingDelete.title}»</span> {t('y todo su historial de mensajes. Esta acción no se puede deshacer.')}
            </>
          }
          confirmLabel={t('Eliminar')}
          danger
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {citation && (
        <SourceCitationModal
          target={citation}
          onClose={() => setCitation(null)}
          onOpenGraph={onOpenGraph ? openGraphFromCitation : undefined}
        />
      )}

      {noteTarget && (
        <SaveToNotesModal
          content={noteTarget.content}
          defaultTitle={noteTarget.title}
          kind="assistant"
          source={{ origin: 'assistant', model: selectedModel, note: contextTitle ?? null }}
          onClose={() => setNoteTarget(null)}
        />
      )}
    </div>
  );
}

/** Build a short note title from the answer's first heading/line, falling back to the context. */
function deriveNoteTitle(content: string, contextTitle: string | null): string {
  const firstLine = content
    .split('\n')
    .map((line) => line.replace(/^#+\s*/, '').replace(/[*_`>#-]/g, '').trim())
    .find((line) => line.length > 0);
  const base = firstLine || contextTitle || 'Respuesta del asistente';
  return base.length > 80 ? `${base.slice(0, 77)}…` : base;
}

function ConversationRow({
  conversation,
  active,
  onOpen,
  onArchive,
  onDelete,
}: {
  conversation: ChatConversationSummary;
  active: boolean;
  onOpen: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`group rounded-lg border px-2.5 py-2 cursor-pointer transition-colors ${
        active ? 'bg-indigo-600/15 border-indigo-700' : 'border-transparent hover:bg-neutral-900'
      }`}
      onClick={onOpen}
    >
      <div className="flex items-center gap-1.5">
        <Icon name="chat" size={13} className={`shrink-0 ${active ? 'text-indigo-300' : 'text-neutral-500'}`} />
        <span className={`flex-1 min-w-0 truncate text-sm ${conversation.archived ? 'text-neutral-500 italic' : ''}`}>
          {conversation.title}
        </span>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            className="p-1 rounded text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800"
            title={conversation.archived ? t('Desarchivar') : t('Archivar')}
            onClick={(e) => {
              e.stopPropagation();
              onArchive();
            }}
          >
            <Icon name="archive" size={13} />
          </button>
          <button
            className="p-1 rounded text-neutral-500 hover:text-red-400 hover:bg-neutral-800"
            title={t('Eliminar')}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Icon name="trash" size={13} />
          </button>
        </div>
      </div>
      <div className="text-[10px] text-neutral-600 mt-0.5 pl-5">
        {formatRelative(conversation.updated_at)} · {tx('{n} mensaje(s)', { n: conversation.messageCount })}
      </div>
    </div>
  );
}

function ContextCheckbox({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className={`flex items-center gap-2 text-sm ${disabled ? 'cursor-not-allowed text-neutral-600' : 'text-neutral-300'}`}>
      <input
        type="checkbox"
        className="h-4 w-4 accent-indigo-500"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function serializeModel(model: ModelRef): string {
  return `${model.provider}::${model.model}`;
}

function parseModel(value: string): ModelRef {
  const [provider, model] = value.split('::');
  return { provider: provider as ModelRef['provider'], model };
}

function sameModelRef(a: ModelRef, b: ModelRef): boolean {
  return a.provider === b.provider && a.model === b.model;
}

function cloneSelection(selection: ResearchContextSelection): ResearchContextSelection {
  return {
    ...selection,
    passages: selection.passages ?? true,
    graphParts: { ...selection.graphParts },
  };
}

function formatChars(chars: number): string {
  if (chars >= 1_000_000) return `${(chars / 1_000_000).toFixed(1)}M chars`;
  if (chars >= 1000) return `${Math.round(chars / 1000)}k chars`;
  return `${chars} chars`;
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diff = Date.now() - then;
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return t('ahora');
  if (minutes < 60) return tx('hace {n} min', { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return tx('hace {n} h', { n: hours });
  const days = Math.round(hours / 24);
  if (days < 7) return tx('hace {n} d', { n: days });
  return new Date(iso).toLocaleDateString();
}

function serializeSelection(selection: ResearchContextSelection): string {
  return JSON.stringify(selection);
}
