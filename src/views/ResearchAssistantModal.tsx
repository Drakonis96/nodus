import { useMemo, useRef, useState } from 'react';
import type {
  AppSettings,
  ModelRef,
  ResearchChatMessage,
  ResearchContextSelection,
  ResearchContextStats,
  ResearchGraphPartsSelection,
} from '@shared/types';
import { Icon, modelLabel } from '../components/ui';

const DEFAULT_SELECTION: ResearchContextSelection = {
  ideas: true,
  themes: true,
  contradictions: true,
  gaps: true,
  readingPath: false,
  authors: true,
  documents: false,
  graph: false,
  graphParts: {
    ideaNodes: true,
    themeNodes: true,
    ideaEdges: true,
    authorGraph: false,
  },
};

interface UiMessage extends ResearchChatMessage {
  id: string;
  selectionKey?: string;
  stats?: ResearchContextStats;
  error?: boolean;
}

export function ResearchAssistantModal({ settings, onClose }: { settings: AppSettings; onClose: () => void }) {
  const [selection, setSelection] = useState<ResearchContextSelection>(DEFAULT_SELECTION);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const [selectedModel, setSelectedModel] = useState<ModelRef | null>(settings.synthesisModel ?? settings.defaultModel);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const availableModels = useMemo(() => {
    const models: ModelRef[] = [];
    const add = (model: ModelRef | null | undefined) => {
      if (!model || models.some((m) => sameModelRef(m, model))) return;
      models.push(model);
    };
    add(settings.synthesisModel);
    add(settings.defaultModel);
    for (const model of settings.favorites ?? []) add(model);
    return models;
  }, [settings.defaultModel, settings.favorites, settings.synthesisModel]);

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

  const send = async () => {
    const content = input.trim();
    if (!content || sending || !selectedModel) return;
    const selectionKey = serializeSelection(selection);
    const userMessage: UiMessage = { id: crypto.randomUUID(), role: 'user', content, selectionKey };
    const assistantId = crypto.randomUUID();
    const requestMessages: ResearchChatMessage[] = [
      ...messages.filter((m) => m.selectionKey === selectionKey && m.content.trim()),
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
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId ? { ...message, content: response.answer, stats: response.stats } : message
        )
      );
      window.setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }), 0);
    } catch (e) {
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? { ...message, content: e instanceof Error ? e.message : String(e), error: true }
            : message
        )
      );
    } finally {
      setSending(false);
    }
  };

  const serializedModel = selectedModel ? serializeModel(selectedModel) : '';

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
          <aside className="w-full md:w-72 shrink-0 border-b md:border-b-0 md:border-r border-neutral-800 p-4 overflow-y-auto max-h-64 md:max-h-none">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">Contexto</h2>
              <span className="text-xs text-neutral-500">{selectedCount}</span>
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
                    className={`max-w-[78%] rounded-lg border px-3 py-2 text-sm whitespace-pre-wrap ${
                      message.role === 'user'
                        ? 'bg-indigo-600 border-indigo-500 text-white'
                        : message.error
                          ? 'bg-red-950/40 border-red-800 text-red-200'
                          : 'bg-neutral-900 border-neutral-800 text-neutral-200'
                    }`}
                  >
                    {message.content || (message.role === 'assistant' && sending ? '...' : '')}
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

function serializeSelection(selection: ResearchContextSelection): string {
  return JSON.stringify(selection);
}
