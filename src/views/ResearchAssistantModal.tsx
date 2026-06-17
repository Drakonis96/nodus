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
import { SourceCitationModal, type CitationTarget } from '../components/SourceCitationModal';

const DEFAULT_SELECTION: ResearchContextSelection = {
  ideas: false,
  themes: false,
  contradictions: false,
  gaps: false,
  readingPath: false,
  authors: false,
  documents: false,
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
  graph: true,
  graphParts: {
    ideaNodes: true,
    themeNodes: true,
    ideaEdges: true,
    authorGraph: true,
  },
};

interface UiMessage extends ChatMessageRecord {
  id: string;
}

export function ResearchAssistantModal({ settings, onClose }: { settings: AppSettings; onClose: () => void }) {
  const [selection, setSelection] = useState<ResearchContextSelection>(DEFAULT_SELECTION);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const [selectedModel, setSelectedModel] = useState<ModelRef | null>(settings.synthesisModel ?? settings.defaultModel);
  const [sending, setSending] = useState(false);
  const [conversations, setConversations] = useState<ChatConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ChatConversationSummary | null>(null);
  const [citation, setCitation] = useState<CitationTarget>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Mirrors `messages` so async stream callbacks can persist the final array without
  // racing React state updates.
  const messagesRef = useRef<UiMessage[]>([]);
  messagesRef.current = messages;

  const availableModels = useMemo(() => {
    const models: ModelRef[] = [];
    const add = (model: ModelRef | null | undefined) => {
      if (!model || models.some((m) => sameModelRef(m, model))) return;
      models.push(model);
    };
    add(settings.synthesisModel);
    add(settings.defaultModel);
    add(selectedModel);
    for (const model of settings.favorites ?? []) add(model);
    return models;
  }, [settings.defaultModel, settings.favorites, settings.synthesisModel, selectedModel]);

  const refreshConversations = useCallback(async () => {
    setConversations(await window.nodus.listConversations(true));
  }, []);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

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

  const startNewConversation = () => {
    setActiveId(null);
    setMessages([]);
    setInput('');
  };

  const loadConversation = async (id: string) => {
    if (sending) return;
    const conversation = await window.nodus.getConversation(id);
    if (!conversation) {
      await refreshConversations();
      return;
    }
    setActiveId(conversation.id);
    setMessages(conversation.messages.map((m) => ({ ...m, id: m.id || crypto.randomUUID() })));
    if (conversation.selection) setSelection(conversation.selection);
    if (conversation.model) setSelectedModel(conversation.model);
    setInput('');
    window.setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }), 0);
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

  const send = async () => {
    const content = input.trim();
    if (!content || sending || !selectedModel) return;

    // Lazily create the conversation on the first message so empty chats never clutter history.
    let conversationId = activeId;
    const isFirstExchange = messagesRef.current.length === 0;
    if (!conversationId) {
      const created = await window.nodus.createConversation({ model: selectedModel, selection });
      conversationId = created.id;
      setActiveId(created.id);
    }

    const selectionKey = serializeSelection(selection);
    const priorMessages = messagesRef.current;
    const userMessage: UiMessage = { id: crypto.randomUUID(), role: 'user', content, selectionKey };
    const assistantId = crypto.randomUUID();
    const requestMessages: ResearchChatMessage[] = [
      ...priorMessages.filter((m) => m.selectionKey === selectionKey && m.content.trim()),
      userMessage,
    ].map((m) => ({ role: m.role, content: m.content }));

    setMessages((current) => [...current, userMessage, { id: assistantId, role: 'assistant', content: '', selectionKey }]);
    setInput('');
    setSending(true);

    try {
      const response = await window.nodus.researchChatStream(
        { messages: requestMessages, selection, model: selectedModel },
        {
          onDelta: (delta) => {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId ? { ...message, content: message.content + delta } : message
              )
            );
            window.setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }), 0);
          },
        }
      );
      const finalMessages: UiMessage[] = [
        ...priorMessages,
        userMessage,
        { id: assistantId, role: 'assistant', content: response.answer, selectionKey, stats: response.stats },
      ];
      setMessages(finalMessages);
      window.setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }), 0);
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
      setMessages(finalMessages);
      await persist(conversationId, finalMessages, false);
    } finally {
      setSending(false);
    }
  };

  const serializedModel = selectedModel ? serializeModel(selectedModel) : '';
  const visibleConversations = conversations.filter((c) => showArchived || !c.archived);
  const archivedCount = conversations.filter((c) => c.archived).length;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 p-4 flex items-center justify-center">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-6xl h-[86vh] bg-neutral-950 border border-neutral-800 rounded-lg shadow-2xl flex flex-col overflow-hidden"
      >
        <header className="px-4 py-3 border-b border-neutral-800 flex items-center gap-3">
          <div className="flex items-center gap-2 font-semibold">
            <Icon name="wand" className="text-indigo-300" />
            Asistente de investigación
          </div>
          <select
            className="input text-xs py-1 max-w-xs"
            title="Modelo del chat"
            value={serializedModel}
            onChange={(e) => setSelectedModel(e.target.value ? parseModel(e.target.value) : null)}
          >
            {!selectedModel && <option value="">Sin modelo seleccionado</option>}
            {availableModels.map((model) => (
              <option key={serializeModel(model)} value={serializeModel(model)}>
                {modelLabel(model)}
              </option>
            ))}
          </select>
          <div className="flex-1" />
          <button className="btn btn-ghost" onClick={onClose} title="Cerrar">
            <Icon name="x" />
          </button>
        </header>

        <div className="flex-1 min-h-0 flex flex-col md:flex-row">
          {/* Conversation history */}
          <aside className="w-full md:w-60 shrink-0 border-b md:border-b-0 md:border-r border-neutral-800 flex flex-col max-h-48 md:max-h-none">
            <div className="p-3 border-b border-neutral-800">
              <button className="btn btn-primary w-full gap-1.5" onClick={startNewConversation} disabled={sending}>
                <Icon name="plus" /> Nueva conversación
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
              {visibleConversations.length === 0 && (
                <div className="text-xs text-neutral-600 text-center py-6 px-2">
                  Aún no hay conversaciones. Escribe abajo para empezar.
                </div>
              )}
              {visibleConversations.map((conversation) => (
                <ConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  active={conversation.id === activeId}
                  onOpen={() => void loadConversation(conversation.id)}
                  onArchive={() => void archiveConversation(conversation)}
                  onDelete={() => setPendingDelete(conversation)}
                />
              ))}
            </div>
            {archivedCount > 0 && (
              <button
                className="text-xs text-neutral-500 hover:text-neutral-300 px-3 py-2 border-t border-neutral-800 text-left flex items-center gap-1.5"
                onClick={() => setShowArchived((v) => !v)}
              >
                <Icon name="archive" size={13} />
                {showArchived ? 'Ocultar archivadas' : `Ver archivadas (${archivedCount})`}
              </button>
            )}
          </aside>

          {/* Context selection */}
          <aside className="w-full md:w-60 shrink-0 border-b md:border-b-0 md:border-r border-neutral-800 p-4 overflow-y-auto max-h-56 md:max-h-none">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">Contexto</h2>
              <span className="text-xs text-neutral-500">{selectedCount}</span>
            </div>
            <div className="mb-3 flex gap-2">
              <button className="btn btn-ghost border border-neutral-700 flex-1 text-xs py-1" onClick={() => setSelection(ALL_SELECTION)}>
                Todo
              </button>
              <button className="btn btn-ghost border border-neutral-700 flex-1 text-xs py-1" onClick={() => setSelection(DEFAULT_SELECTION)}>
                Nada
              </button>
            </div>

            <div className="space-y-2">
              <ContextCheckbox label="Ideas generadas" checked={selection.ideas} onChange={(v) => updateSelection('ideas', v)} />
              <ContextCheckbox label="Temas principales" checked={selection.themes} onChange={(v) => updateSelection('themes', v)} />
              <ContextCheckbox label="Contradicciones" checked={selection.contradictions} onChange={(v) => updateSelection('contradictions', v)} />
              <ContextCheckbox label="Huecos de investigación" checked={selection.gaps} onChange={(v) => updateSelection('gaps', v)} />
              <ContextCheckbox label="Rutas de lectura" checked={selection.readingPath} onChange={(v) => updateSelection('readingPath', v)} />
              <ContextCheckbox label="Autores" checked={selection.authors} onChange={(v) => updateSelection('authors', v)} />
              <ContextCheckbox label="Documentos relacionados" checked={selection.documents} onChange={(v) => updateSelection('documents', v)} />
              <ContextCheckbox label="Grafo" checked={selection.graph} onChange={(v) => updateSelection('graph', v)} />
            </div>

            <div className={`mt-3 pl-3 border-l border-neutral-800 space-y-2 ${selection.graph ? '' : 'opacity-45'}`}>
              <ContextCheckbox
                label="Nodos de ideas"
                checked={selection.graphParts.ideaNodes}
                disabled={!selection.graph}
                onChange={(v) => updateGraphPart('ideaNodes', v)}
              />
              <ContextCheckbox
                label="Nodos de temas"
                checked={selection.graphParts.themeNodes}
                disabled={!selection.graph}
                onChange={(v) => updateGraphPart('themeNodes', v)}
              />
              <ContextCheckbox
                label="Relaciones de ideas"
                checked={selection.graphParts.ideaEdges}
                disabled={!selection.graph}
                onChange={(v) => updateGraphPart('ideaEdges', v)}
              />
              <ContextCheckbox
                label="Grafo de autores"
                checked={selection.graphParts.authorGraph}
                disabled={!selection.graph}
                onChange={(v) => updateGraphPart('authorGraph', v)}
              />
            </div>
          </aside>

          <section className="flex-1 min-w-0 flex flex-col">
            <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 && (
                <div className="h-full flex items-center justify-center text-neutral-500 text-sm">
                  Pregunta sobre ideas, autores, temas, contradicciones o documentos.
                </div>
              )}
              {messages.map((message) => (
                <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[78%] rounded-lg border px-3 py-2 text-sm ${
                      message.role === 'user'
                        ? 'bg-indigo-600 border-indigo-500 text-white whitespace-pre-wrap'
                        : message.error
                          ? 'bg-red-950/40 border-red-800 text-red-200 whitespace-pre-wrap'
                          : 'bg-neutral-900 border-neutral-800 text-neutral-200'
                    }`}
                  >
                    {message.role === 'assistant' && !message.error && message.content ? (
                      <Markdown
                        content={message.content}
                        onCitation={(c: MarkdownCitation) => setCitation({ kind: c.kind, id: c.id })}
                      />
                    ) : (
                      message.content || (message.role === 'assistant' && sending ? '...' : '')
                    )}
                    {message.stats && (
                      <div className="mt-2 pt-2 border-t border-neutral-800 text-[11px] text-neutral-500 whitespace-normal">
                        {message.stats.sections.join(', ') || 'Sin secciones'} · {message.stats.works} obras ·{' '}
                        {message.stats.documents} docs · {formatChars(message.stats.contextChars)}
                        {message.stats.truncated ? ' · recortado' : ''}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <footer className="border-t border-neutral-800 p-3">
              <div className="flex gap-2">
                <textarea
                  className="input flex-1 min-h-[44px] max-h-32 resize-none"
                  value={input}
                  placeholder="Pregunta al asistente..."
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                <button
                  className="btn btn-primary self-end h-11 w-11 px-0"
                  title="Enviar"
                  onClick={() => void send()}
                  disabled={sending || !input.trim() || !selectedModel}
                >
                  <Icon name={sending ? 'sync' : 'arrowUp'} className={sending ? 'animate-spin' : ''} />
                </button>
              </div>
            </footer>
          </section>
        </div>
      </div>

      {pendingDelete && (
        <ConfirmModal
          title="Eliminar conversación"
          message={
            <>
              Se eliminará <span className="text-neutral-200">«{pendingDelete.title}»</span> y todo su historial de mensajes.
              Esta acción no se puede deshacer.
            </>
          }
          confirmLabel="Eliminar"
          danger
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {citation && <SourceCitationModal target={citation} onClose={() => setCitation(null)} />}
    </div>
  );
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
            title={conversation.archived ? 'Desarchivar' : 'Archivar'}
            onClick={(e) => {
              e.stopPropagation();
              onArchive();
            }}
          >
            <Icon name="archive" size={13} />
          </button>
          <button
            className="p-1 rounded text-neutral-500 hover:text-red-400 hover:bg-neutral-800"
            title="Eliminar"
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
        {formatRelative(conversation.updated_at)} · {conversation.messageCount} mensaje(s)
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
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `hace ${days} d`;
  return new Date(iso).toLocaleDateString();
}

function serializeSelection(selection: ResearchContextSelection): string {
  return JSON.stringify(selection);
}
