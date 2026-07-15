import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../components/ui';
import { Markdown } from '../components/Markdown';
import { ConfirmModal } from '../components/ConfirmModal';
import { ChartFromSpec } from '../components/DatabaseChart';
import { t } from '../i18n';
import { parseChatSegments } from '@shared/chartSpec';
import type { DatabaseChatConversationSummary, DatabaseSummary, DbChatTurn } from '@shared/types';

const STARTERS = [
  'Resume esta base de datos en 3 puntos.',
  'Muéstrame la distribución por categoría en un gráfico.',
  '¿Qué valores atípicos o problemas de calidad detectas?',
  'Compara los grupos y destaca las diferencias.',
];

function relativeDate(value: string): string {
  const elapsed = Date.now() - new Date(value).getTime();
  if (elapsed < 60_000) return t('Ahora');
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} min`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} h`;
  return new Date(value).toLocaleDateString();
}

/** Renders an assistant message: Markdown prose with any native chart specs inline. */
function AssistantMessage({ text }: { text: string }) {
  const segments = parseChatSegments(text);
  return (
    <div className="text-sm">
      {segments.map((seg, i) =>
        seg.kind === 'chart' ? <ChartFromSpec key={i} spec={seg.spec} /> : <Markdown key={i} content={seg.text} className="text-sm" />
      )}
    </div>
  );
}

export function DatabasesChatView({ initialDatabaseId }: { initialDatabaseId: string | null }) {
  const [databases, setDatabases] = useState<DatabaseSummary[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set(initialDatabaseId ? [initialDatabaseId] : []));
  const [messages, setMessages] = useState<DbChatTurn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationTitle, setConversationTitle] = useState<string | null>(null);
  const [history, setHistory] = useState<DatabaseChatConversationSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(() => localStorage.getItem('nodus.databaseChatHistoryOpen') === '1');
  const [pendingDelete, setPendingDelete] = useState<DatabaseChatConversationSummary | null>(null);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const refreshHistory = useCallback(async () => setHistory(await window.nodus.listDatabaseChatConversations()), []);

  useEffect(() => {
    void window.nodus.listDatabases().then((list) => {
      setDatabases(list);
      setSelected((cur) => (cur.size ? cur : new Set(list[0] ? [list[0].id] : [])));
    });
  }, []);
  useEffect(() => { void refreshHistory(); }, [refreshHistory]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streaming]);

  const toggleDb = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleHistory = () => setHistoryOpen((open) => {
    localStorage.setItem('nodus.databaseChatHistoryOpen', open ? '0' : '1');
    return !open;
  });
  const resetChat = () => { setConversationId(null); setConversationTitle(null); setMessages([]); setStreaming(''); setInput(''); };
  const openConversation = async (id: string) => {
    const conversation = await window.nodus.getDatabaseChatConversation(id); if (!conversation) return;
    setConversationId(conversation.id); setConversationTitle(conversation.title); setMessages(conversation.messages); setSelected(new Set(conversation.databaseIds)); setStreaming(''); setInput('');
  };
  const removeConversation = async () => {
    if (!pendingDelete) return;
    await window.nodus.deleteDatabaseChatConversation(pendingDelete.id);
    if (conversationId === pendingDelete.id) resetChat();
    setPendingDelete(null); await refreshHistory();
  };

  const send = async (question: string) => {
    const q = question.trim();
    if (!q || busy || selected.size === 0) return;
    setInput('');
    setBusy(true);
    setStreaming('');
    let activeId = conversationId;
    if (!activeId) {
      const created = await window.nodus.createDatabaseChatConversation({ title: q.slice(0, 80), databaseIds: [...selected] });
      activeId = created.id; setConversationId(created.id); setConversationTitle(created.title);
    }
    const previous = messages;
    const withUser: DbChatTurn[] = [...previous, { role: 'user', content: q }];
    setMessages(withUser);
    try {
      const res = await window.nodus.dbChatStream(
        { question: q, databaseIds: [...selected], history: previous },
        { onDelta: (delta) => setStreaming((s) => s + delta) }
      );
      const next: DbChatTurn[] = [...withUser, { role: 'assistant', content: res.text }];
      setMessages(next); await window.nodus.saveDatabaseChatConversation(activeId, next, [...selected]);
    } catch (e) {
      const next: DbChatTurn[] = [...withUser, { role: 'assistant', content: t('No se pudo generar la respuesta.') + ` (${(e as Error).message})` }];
      setMessages(next); await window.nodus.saveDatabaseChatConversation(activeId, next, [...selected]);
    } finally {
      setStreaming('');
      setBusy(false);
      await refreshHistory();
    }
  };

  return (
    <div className="flex h-full min-h-0 bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100" data-testid="database-chat-view">
      {historyOpen && <aside className="flex w-64 shrink-0 flex-col border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950" data-testid="database-chat-history-sidebar">
        <div className="flex items-center gap-2 border-b border-neutral-200 p-3 dark:border-neutral-800"><h2 className="text-sm font-semibold">{t('Historial de chats')}</h2><button className="btn btn-ghost ml-auto h-7 w-7 p-0" title={t('Ocultar historial')} onClick={toggleHistory}><Icon name="x" size={13} /></button></div>
        <div className="p-2"><button data-testid="database-chat-new" className="btn btn-primary w-full" onClick={resetChat}><Icon name="plus" size={13} />{t('Nuevo chat')}</button></div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">{history.map((item) => <article key={item.id} className={`group mb-1 flex items-center rounded-lg ${conversationId === item.id ? 'bg-indigo-50 dark:bg-indigo-950/40' : 'hover:bg-neutral-100 dark:hover:bg-neutral-900'}`}><button className="min-w-0 flex-1 px-2.5 py-2 text-left" onClick={() => void openConversation(item.id)}><span className="block truncate text-xs font-medium">{item.title}</span><span className="mt-0.5 block text-[9px] text-neutral-500">{item.messageCount} {t('mensajes')} · {relativeDate(item.updatedAt)}</span></button><button className="mr-1 grid h-7 w-7 place-items-center rounded text-neutral-400 opacity-0 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-red-950/40" title={t('Eliminar chat')} onClick={() => setPendingDelete(item)}><Icon name="trash" size={12} /></button></article>)}{!history.length && <p className="px-3 py-8 text-center text-xs leading-5 text-neutral-500">{t('Tus conversaciones aparecerán aquí.')}</p>}</div>
      </aside>}

      <main className="flex min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-950">
        <button data-testid="database-chat-history-toggle" className={`btn h-8 w-8 shrink-0 p-0 ${historyOpen ? 'btn-secondary' : 'btn-ghost'}`} aria-label={t('Historial de chats')} title={t('Historial de chats')} onClick={toggleHistory}><Icon name="clock" size={15} /></button>
        <Icon name="chat" size={18} className="text-indigo-400" />
        <div className="min-w-0"><h1 className="truncate text-sm font-semibold">{conversationTitle ?? t('Chat de datos')}</h1><p className="text-[10px] text-neutral-500">{t('Pregunta a tus datos y genera gráficos a partir de las filas seleccionadas.')}</p></div>
        <div className="ml-auto flex min-w-0 flex-wrap justify-end gap-1">
          {databases.map((d) => <button key={d.id} onClick={() => toggleDb(d.id)} className={`max-w-36 truncate rounded border px-2 py-1 text-xs ${selected.has(d.id) ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-neutral-300 text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800'}`}>{d.name}</button>)}
        </div>
        <button className="btn btn-ghost h-8 shrink-0" onClick={resetChat}><Icon name="plus" size={13} />{t('Nuevo chat')}</button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-4">
        {messages.length === 0 && !streaming && (
          <div className="max-w-xl mx-auto text-center mt-10">
            <Icon name="chat" size={32} className="text-neutral-700 mx-auto mb-2" />
            <p className="text-sm text-neutral-400 mb-4">
              {selected.size === 0
                ? t('Elige al menos una base de datos arriba para empezar.')
                : t('Pregunta a tus datos. Puede responder con cifras y gráficos, siempre a partir de tus filas.')}
            </p>
            <div className="flex flex-col gap-2">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  className="text-left text-sm px-3 py-2 rounded-lg border border-neutral-800 hover:border-indigo-600/70 hover:bg-neutral-900"
                  onClick={() => void send(t(s))}
                  disabled={selected.size === 0}
                >
                  {t(s)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="max-w-3xl mx-auto flex flex-col gap-4">
          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="self-end max-w-[85%] rounded-2xl px-3.5 py-2 bg-indigo-600 text-white text-sm">
                {m.content}
              </div>
            ) : (
              <div key={i} className="self-start max-w-[95%] rounded-2xl border border-neutral-200 bg-white px-3.5 py-2 dark:border-neutral-800 dark:bg-neutral-900">
                <AssistantMessage text={m.content} />
              </div>
            )
          )}
          {streaming && (
            <div className="self-start max-w-[95%] rounded-2xl border border-neutral-200 bg-white px-3.5 py-2 dark:border-neutral-800 dark:bg-neutral-900">
              <AssistantMessage text={streaming} />
            </div>
          )}
          {busy && !streaming && <div className="self-start text-xs text-neutral-500">{t('Pensando…')}</div>}
        </div>
      </div>

      <div className="border-t border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="max-w-3xl mx-auto flex gap-2">
          <input
            className="input flex-1"
            placeholder={selected.size === 0 ? t('Elige una base de datos…') : t('Pregunta a tus datos…')}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void send(input);
            }}
            disabled={busy || selected.size === 0}
          />
          {busy ? (
            <button className="btn btn-ghost border border-neutral-700" onClick={() => void window.nodus.cancelDbChat()}>
              <Icon name="stop" /> {t('Detener')}
            </button>
          ) : (
            <button className="btn btn-primary gap-1.5" onClick={() => void send(input)} disabled={selected.size === 0 || !input.trim()}>
              <Icon name="chat" size={14} /> {t('Enviar')}
            </button>
          )}
        </div>
      </div>
      </main>
      {pendingDelete && <ConfirmModal title={t('Eliminar chat')} message={t('Se eliminará «{title}» y todo su historial. Esta acción no se puede deshacer.').replace('{title}', pendingDelete.title)} confirmLabel={t('Eliminar')} danger onConfirm={() => void removeConversation()} onCancel={() => setPendingDelete(null)} />}
    </div>
  );
}
