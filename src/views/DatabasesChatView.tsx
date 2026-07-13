import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/ui';
import { Markdown } from '../components/Markdown';
import { ChartFromSpec } from '../components/DatabaseChart';
import { t } from '../i18n';
import { parseChatSegments } from '@shared/chartSpec';
import type { DatabaseSummary, DbChatTurn } from '@shared/types';

const STARTERS = [
  'Resume esta base de datos en 3 puntos.',
  'Muéstrame la distribución por categoría en un gráfico.',
  '¿Qué valores atípicos o problemas de calidad detectas?',
  'Compara los grupos y destaca las diferencias.',
];

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
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void window.nodus.listDatabases().then((list) => {
      setDatabases(list);
      setSelected((cur) => (cur.size ? cur : new Set(list[0] ? [list[0].id] : [])));
    });
  }, []);

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

  const send = async (question: string) => {
    const q = question.trim();
    if (!q || busy || selected.size === 0) return;
    setInput('');
    setBusy(true);
    setStreaming('');
    const history = messages;
    setMessages((m) => [...m, { role: 'user', content: q }]);
    try {
      const res = await window.nodus.dbChatStream(
        { question: q, databaseIds: [...selected], history },
        { onDelta: (delta) => setStreaming((s) => s + delta) }
      );
      setMessages((m) => [...m, { role: 'assistant', content: res.text }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: t('No se pudo generar la respuesta.') + ` (${(e as Error).message})` }]);
    } finally {
      setStreaming('');
      setBusy(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-neutral-800">
        <Icon name="chat" size={18} className="text-indigo-400" />
        <h1 className="text-lg font-semibold">{t('Chat de datos')}</h1>
        <div className="flex-1" />
        <div className="flex flex-wrap gap-1">
          {databases.map((d) => (
            <button
              key={d.id}
              onClick={() => toggleDb(d.id)}
              className={`text-xs px-2 py-1 rounded border ${
                selected.has(d.id) ? 'bg-indigo-600 text-white border-indigo-600' : 'border-neutral-700 text-neutral-400 hover:bg-neutral-800'
              }`}
            >
              {d.name}
            </button>
          ))}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-4">
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
              <div key={i} className="self-start max-w-[95%] rounded-2xl px-3.5 py-2 bg-neutral-900 border border-neutral-800">
                <AssistantMessage text={m.content} />
              </div>
            )
          )}
          {streaming && (
            <div className="self-start max-w-[95%] rounded-2xl px-3.5 py-2 bg-neutral-900 border border-neutral-800">
              <AssistantMessage text={streaming} />
            </div>
          )}
          {busy && !streaming && <div className="self-start text-xs text-neutral-500">{t('Pensando…')}</div>}
        </div>
      </div>

      <div className="border-t border-neutral-800 p-3">
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
    </div>
  );
}
