import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AppSettings,
  DbChatTurn,
  WorldChatConversation,
  WorldChatConversationSummary,
  WorldChatResult,
  WorldChatSelection,
  WorldEntry,
} from '@shared/types';
import type { View } from '../navigation';
import { ConfirmModal } from '../components/ConfirmModal';
import { Markdown } from '../components/Markdown';
import { ModelPicker } from '../components/ModelPicker';
import { Icon } from '../components/ui';
import { useFeatureModel } from '../hooks/useFeatureModel';
import { t } from '../i18n';

const SECTION_OF_KIND: Record<string, View> = {
  character: 'characters',
  place: 'places',
  group: 'factions',
  scene: 'scenes',
  article: 'encyclopedia',
  map: 'map',
  rule: 'rules',
  conflict: 'conflicts',
};

const KIND_LABEL: Record<string, string> = {
  character: 'Personaje',
  place: 'Lugar',
  group: 'Facción',
  scene: 'Escena',
  article: 'Artículo',
  map: 'Mapa',
  rule: 'Regla',
  conflict: 'Conflicto',
};

const STARTERS = [
  '¿Qué tiene que moverse en la próxima escena?',
  '¿Esto contradice algo de lo que ya he escrito?',
  '¿Qué leyes alcanzan a mi protagonista?',
  '¿Quién sabía el secreto en ese momento?',
];

const BLANK_SELECTION: WorldChatSelection = { scope: 'auto', entryKeys: [], keepFocus: false };

function relativeDate(value: string): string {
  const date = new Date(value);
  const elapsed = Date.now() - date.getTime();
  if (elapsed < 60_000) return t('Ahora');
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} min`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} h`;
  return date.toLocaleDateString();
}

function titleFromQuestion(question: string): string {
  const clean = question.replace(/\s+/g, ' ').trim();
  return clean.length > 64 ? `${clean.slice(0, 61).trimEnd()}…` : clean;
}

export function WorldChatView({ settings, onNavigate }: {
  settings: AppSettings;
  onNavigate?: (view: View) => void;
}) {
  const [conversation, setConversation] = useState<WorldChatConversation | null>(null);
  const [history, setHistory] = useState<WorldChatConversationSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(() => localStorage.getItem('nodus.worldChatHistoryOpen') === '1');
  const [contextOpen, setContextOpen] = useState(() => localStorage.getItem('nodus.worldChatContextOpen') !== '0');
  const [selection, setSelection] = useState<WorldChatSelection>(BLANK_SELECTION);
  const [focus, setFocus] = useState<WorldChatResult['focus']>([]);
  const [entries, setEntries] = useState<WorldEntry[]>([]);
  const [entrySearch, setEntrySearch] = useState('');
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<WorldChatConversationSummary | null>(null);
  const [model, setModel] = useFeatureModel(settings, 'chatModel');
  const scrollRef = useRef<HTMLDivElement>(null);

  const refreshHistory = useCallback(async () => {
    setHistory(await window.nodus.listWorldChatConversations());
  }, []);

  useEffect(() => {
    void Promise.all([refreshHistory(), window.nodus.listWorldEntries().then(setEntries)]);
  }, [refreshHistory]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [conversation?.messages, streaming]);

  const filteredEntries = useMemo(() => {
    const query = entrySearch.trim().toLocaleLowerCase();
    return (query
      ? entries.filter((entry) =>
          `${entry.title} ${entry.summary ?? ''} ${entry.category ?? ''}`.toLocaleLowerCase().includes(query)
        )
      : entries
    ).slice(0, 150);
  }, [entries, entrySearch]);

  const toggleHistory = () => setHistoryOpen((open) => {
    localStorage.setItem('nodus.worldChatHistoryOpen', open ? '0' : '1');
    return !open;
  });
  const toggleContext = () => setContextOpen((open) => {
    localStorage.setItem('nodus.worldChatContextOpen', open ? '0' : '1');
    return !open;
  });
  const resetChat = () => {
    setConversation(null);
    setFocus([]);
    setInput('');
    setStreaming('');
    setError('');
  };
  const openConversation = async (id: string) => {
    const next = await window.nodus.getWorldChatConversation(id);
    if (!next) return;
    setConversation(next);
    setSelection(next.selection);
    setFocus(next.focus);
    if (next.model) setModel(next.model);
    setError('');
    setStreaming('');
  };
  const removeConversation = async () => {
    if (!pendingDelete) return;
    await window.nodus.deleteWorldChatConversation(pendingDelete.id);
    if (conversation?.id === pendingDelete.id) resetChat();
    setPendingDelete(null);
    await refreshHistory();
  };

  const send = async (value = input) => {
    const question = value.trim();
    if (!question || busy) return;
    let active = conversation;
    if (!active) {
      active = await window.nodus.createWorldChatConversation({
        title: titleFromQuestion(question),
        selection,
        model,
      });
    }
    const previous = active.messages;
    const withUser: DbChatTurn[] = [...previous, { role: 'user', content: question }];
    setConversation({ ...active, messages: withUser, messageCount: withUser.length });
    setInput('');
    setBusy(true);
    setStreaming('');
    setError('');
    try {
      const result = await window.nodus.worldChatStream(
        {
          question,
          focusKeys: selection.scope === 'manual'
            ? selection.entryKeys
            : selection.keepFocus
              ? focus.map((ref) => `${ref.kind}:${ref.id}`)
              : undefined,
          history: previous,
          model,
        },
        { onDelta: (delta) => setStreaming((current) => current + delta) }
      );
      const answer = result.noMaterial
        ? t('No he encontrado nada de tu mundo en esa pregunta. Nombra un personaje, un lugar, una escena o una ley y vuelvo a mirar.')
        : result.text;
      const finalMessages: DbChatTurn[] = [...withUser, { role: 'assistant', content: answer }];
      setFocus(result.focus);
      const saved = await window.nodus.saveWorldChatConversation(
        active.id,
        finalMessages,
        selection,
        result.focus,
        model
      );
      if (saved) setConversation(saved);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      const failedMessages: DbChatTurn[] = [
        ...withUser,
        { role: 'assistant', content: `${t('No se pudo generar la respuesta.')} (${message})` },
      ];
      const saved = await window.nodus.saveWorldChatConversation(
        active.id,
        failedMessages,
        selection,
        focus,
        model
      );
      if (saved) setConversation(saved);
    } finally {
      setStreaming('');
      setBusy(false);
      await refreshHistory();
    }
  };

  const openWorldEntry = (kind: string) => {
    const section = SECTION_OF_KIND[kind];
    if (section) onNavigate?.(section);
  };
  const answer = (text: string) => (
    <Markdown
      content={text}
      className="text-sm"
      verify={false}
      onWorldEntry={(kind) => openWorldEntry(kind)}
    />
  );

  return (
    <div className="flex h-full min-h-0 bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100" data-testid="world-chat-view">
      {historyOpen && (
        <aside className="flex w-64 shrink-0 flex-col border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950" data-testid="world-chat-history-sidebar">
          <div className="flex items-center gap-2 border-b border-neutral-200 p-3 dark:border-neutral-800">
            <h2 className="text-sm font-semibold">{t('Historial de chats')}</h2>
            <button className="btn btn-ghost ml-auto h-7 w-7 p-0" title={t('Ocultar historial')} onClick={toggleHistory}><Icon name="x" size={13} /></button>
          </div>
          <div className="p-2"><button data-testid="world-chat-new" className="btn btn-primary w-full" onClick={resetChat}><Icon name="plus" size={13} />{t('Nuevo chat')}</button></div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {history.map((item) => (
              <article key={item.id} className={`group mb-1 flex items-center rounded-lg ${conversation?.id === item.id ? 'bg-violet-50 dark:bg-violet-950/40' : 'hover:bg-neutral-100 dark:hover:bg-neutral-900'}`}>
                <button className="min-w-0 flex-1 px-2.5 py-2 text-left" onClick={() => void openConversation(item.id)}>
                  <span className="block truncate text-xs font-medium">{item.title}</span>
                  <span className="mt-0.5 block text-[9px] text-neutral-500">{item.messageCount} {t('mensajes')} · {relativeDate(item.updatedAt)}</span>
                </button>
                <button className="mr-1 grid h-7 w-7 place-items-center rounded text-neutral-400 opacity-0 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-red-950/40" title={t('Eliminar chat')} onClick={() => setPendingDelete(item)}><Icon name="trash" size={12} /></button>
              </article>
            ))}
            {!history.length && <p className="px-3 py-8 text-center text-xs leading-5 text-neutral-500">{t('Tus conversaciones sobre el mundo aparecerán aquí.')}</p>}
          </div>
        </aside>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-w-0 items-center gap-3 border-b border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-950">
          <button data-testid="world-chat-history-toggle" className={`btn h-8 w-8 shrink-0 p-0 ${historyOpen ? 'btn-secondary' : 'btn-ghost'}`} aria-label={t('Historial de chats')} title={t('Historial de chats')} onClick={toggleHistory}><Icon name="clock" size={15} /></button>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300"><Icon name="chat" size={17} /></span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold">{conversation?.title ?? t('Chat del mundo')}</h1>
            <p className="truncate text-[10px] text-neutral-500">{t('Pregunta a las fichas de tu mundo con referencias verificables.')}</p>
          </div>
          <div className="w-56 min-w-0 max-w-[42%] shrink"><ModelPicker settings={settings} value={model} onChange={setModel} compact className="w-full min-w-0" /></div>
          <button data-testid="world-chat-header-new" className="btn btn-ghost relative z-10 h-8 w-8 shrink-0 p-0" aria-label={t('Nuevo chat')} title={t('Nuevo chat')} onClick={resetChat}><Icon name="plus" size={13} /></button>
          <button data-testid="world-chat-context-toggle" className={`btn relative z-10 h-8 w-8 shrink-0 p-0 ${contextOpen ? 'btn-secondary' : 'btn-ghost'}`} aria-label={t(contextOpen ? 'Ocultar ámbito y fuentes' : 'Mostrar ámbito y fuentes')} title={t(contextOpen ? 'Ocultar ámbito y fuentes' : 'Mostrar ámbito y fuentes')} onClick={toggleContext}><Icon name="columns" size={14} /></button>
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {!conversation?.messages.length && !streaming && (
              <div className="py-14 text-center">
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300"><Icon name="chat" size={25} /></span>
                <h2 className="mt-4 text-lg font-semibold">{t('Pregunta a tu mundo')}</h2>
                <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-neutral-500">{t('Nodus reúne personajes, lugares, reglas, conflictos y escenas para responder sin inventar canon.')}</p>
                <div className="mx-auto mt-5 grid max-w-2xl gap-2 sm:grid-cols-2">
                  {STARTERS.map((starter) => <button key={starter} className="rounded-xl border border-neutral-200 bg-white p-3 text-left text-xs leading-5 text-neutral-600 hover:border-violet-400 hover:bg-violet-50 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-400 dark:hover:border-violet-800 dark:hover:bg-violet-950/20" onClick={() => void send(t(starter))}>{t(starter)}</button>)}
                </div>
              </div>
            )}
            {conversation?.messages.map((message, index) => message.role === 'user' ? (
              <div key={index} className="ml-auto max-w-[82%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-violet-600 px-4 py-3 text-sm leading-6 text-white">{message.content}</div>
            ) : (
              <article key={index} data-testid="world-chat-answer" className="mr-auto max-w-[95%] rounded-2xl border border-neutral-200 bg-white px-4 py-3 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/45">{answer(message.content)}</article>
            ))}
            {streaming && <article className="mr-auto max-w-[95%] rounded-2xl border border-neutral-200 bg-white px-4 py-3 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/45">{answer(streaming)}</article>}
            {busy && !streaming && <div className="mr-auto text-xs text-neutral-500">{t('Pensando…')}</div>}
          </div>
        </div>

        <footer className="border-t border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-950">
          <div className="relative mx-auto flex h-10 max-w-3xl items-stretch gap-2">
            {error && <span className="absolute bottom-full left-0 mb-2 max-w-full truncate rounded-md bg-red-50 px-2 py-1 text-[10px] text-red-600 shadow-sm dark:bg-red-950 dark:text-red-300">{error}</span>}
            <div className="h-10 min-w-0 flex-1 rounded-xl border border-neutral-300 bg-neutral-50 px-2 focus-within:border-violet-500 dark:border-neutral-700 dark:bg-neutral-900">
              <textarea
                rows={1}
                data-testid="world-chat-input"
                aria-label={selection.scope === 'manual' ? `${selection.entryKeys.length} ${t('fichas elegidas')}` : t('Recuperación automática del mundo')}
                className="block h-full w-full resize-none bg-transparent px-1 py-2.5 text-sm leading-5 outline-none"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                placeholder={t('Pregunta por personajes, lugares, escenas o reglas…')}
              />
            </div>
            {busy ? <button data-testid="world-chat-stop" className="btn btn-secondary h-10 shrink-0 self-stretch" onClick={() => void window.nodus.cancelWorldChat()}><Icon name="stop" size={12} />{t('Detener')}</button> : <button data-testid="world-chat-send" className="btn btn-primary h-10 shrink-0 self-stretch" disabled={!input.trim()} onClick={() => void send()}><Icon name="arrowUp" size={13} />{t('Enviar')}</button>}
          </div>
        </footer>
      </main>

      {contextOpen && (
        <aside className="w-72 shrink-0 overflow-y-auto border-l border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950" data-testid="world-chat-context-sidebar">
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{t('Ámbito y fuentes')}</h2>
            <button className="btn btn-ghost ml-auto h-7 w-7 p-0" aria-label={t('Ocultar ámbito y fuentes')} title={t('Ocultar ámbito y fuentes')} onClick={toggleContext}><Icon name="x" size={13} /></button>
          </div>
          <label className="mt-3 block text-[10px] text-neutral-500">
            {t('Ámbito')}
            <select data-testid="world-chat-scope" className="input mt-1 w-full" value={selection.scope} onChange={(event) => setSelection((current) => ({ ...current, scope: event.target.value as WorldChatSelection['scope'] }))}>
              <option value="auto">{t('Detección automática')}</option>
              <option value="manual">{t('Selección manual')}</option>
            </select>
          </label>
          {selection.scope === 'auto' ? (
            <>
              <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-neutral-200 p-2 text-xs dark:border-neutral-800">
                <input type="checkbox" checked={selection.keepFocus} onChange={(event) => setSelection((current) => ({ ...current, keepFocus: event.target.checked }))} />
                <span><span className="block font-medium">{t('Seguir con el foco anterior')}</span><span className="mt-0.5 block text-[9px] leading-4 text-neutral-500">{t('Útil para preguntas de seguimiento que no vuelven a nombrar una ficha.')}</span></span>
              </label>
              {focus.length > 0 && <div className="mt-3"><p className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">{t('Ha mirado')}</p><div className="mt-1.5 flex flex-wrap gap-1.5">{focus.map((ref) => <button key={`${ref.kind}:${ref.id}`} className="rounded-full border border-violet-200 px-2 py-1 text-[10px] text-violet-700 hover:border-violet-500 dark:border-violet-900 dark:text-violet-300" onClick={() => openWorldEntry(ref.kind)}>{ref.title}</button>)}</div></div>}
            </>
          ) : (
            <>
              <div className="relative mt-3">
                <Icon name="search" size={12} className="pointer-events-none absolute left-2.5 top-2.5 text-neutral-400" />
                <input className="input w-full pl-8 text-xs" value={entrySearch} placeholder={t('Buscar fichas…')} onChange={(event) => setEntrySearch(event.target.value)} />
              </div>
              <p className="mt-2 text-[10px] text-neutral-500">{selection.entryKeys.length} {t('fichas elegidas')}</p>
              <div className="mt-2 max-h-[calc(100vh-270px)] space-y-1 overflow-y-auto">
                {filteredEntries.map((entry) => (
                  <label key={entry.key} className="flex cursor-pointer gap-2 rounded-lg border border-neutral-200 p-2 text-xs hover:border-violet-400 dark:border-neutral-800 dark:hover:border-violet-800">
                    <input type="checkbox" checked={selection.entryKeys.includes(entry.key)} onChange={(event) => setSelection((current) => ({ ...current, entryKeys: event.target.checked ? [...current.entryKeys, entry.key] : current.entryKeys.filter((key) => key !== entry.key) }))} />
                    <span className="min-w-0"><span className="block truncate font-medium">{entry.title}</span><span className="block truncate text-[9px] text-neutral-500">{t(KIND_LABEL[entry.kind] ?? entry.kind)}{entry.category ? ` · ${entry.category}` : ''}</span></span>
                  </label>
                ))}
              </div>
            </>
          )}
          <p className="mt-4 rounded-lg bg-neutral-100 p-3 text-[10px] leading-5 text-neutral-500 dark:bg-neutral-900/60">{t('Las respuestas se fundamentan en las fichas del vault. Las referencias abren su sección original y el chat nunca modifica el canon.')}</p>
        </aside>
      )}

      {pendingDelete && <ConfirmModal title={t('Eliminar chat')} message={t('Se eliminará «{title}» y todo su historial. Esta acción no se puede deshacer.').replace('{title}', pendingDelete.title)} confirmLabel={t('Eliminar')} danger onConfirm={() => void removeConversation()} onCancel={() => setPendingDelete(null)} />}
    </div>
  );
}
