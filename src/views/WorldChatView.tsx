import { useEffect, useRef, useState } from 'react';
import type { DbChatTurn, WorldChatResult } from '@shared/types';
import type { View } from '../navigation';
import { Markdown } from '../components/Markdown';
import { Icon } from '../components/ui';
import { t } from '../i18n';

/** Where each kind's own section lives, so every citation is one click from its sheet. */
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

/**
 * Four questions that show what this is, and could not be answered by any other chat: each
 * one is arithmetic over the whole "Analizar" layer, phrased as a sentence.
 */
const STARTERS = [
  '¿Qué tiene que moverse en la próxima escena?',
  '¿Esto contradice algo de lo que ya he escrito?',
  '¿Qué leyes alcanzan a mi protagonista?',
  '¿Quién sabía el secreto en ese momento?',
];

/**
 * Chat del mundo: **Nodus calcula y el modelo redacta**.
 *
 * Designed knowing the other five sections exist, and that is what makes it different from
 * a chat over a corpus. Which laws reach somebody, where they were, what moves in a scene,
 * what contradicts what, who knew — all of it is already a pure function over the vault, so
 * none of it is asked of the model: it arrives computed, and the model chooses and phrases.
 *
 * It does not write canon (its suggestions are copied by hand or turned into open
 * questions) and it never sees the whole vault — only what the question named and the facts
 * about that, which is also the only way this fits in a local model's context window.
 */
export function WorldChatView({ onNavigate }: { onNavigate?: (view: View) => void }) {
  const [messages, setMessages] = useState<DbChatTurn[]>([]);
  const [focus, setFocus] = useState<WorldChatResult['focus']>([]);
  const [pinned, setPinned] = useState(false);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streaming]);

  const send = async (question: string) => {
    const asked = question.trim();
    if (!asked || busy) return;
    setInput('');
    setBusy(true);
    setStreaming('');
    const previous = messages;
    const withUser: DbChatTurn[] = [...previous, { role: 'user', content: asked }];
    setMessages(withUser);
    try {
      const result = await window.nodus.worldChatStream(
        {
          question: asked,
          // Pinning matters because the focus is resolved from the NAMES in the question:
          // a follow-up like «¿y al día siguiente?» names nothing, and without this it
          // would arrive with nothing to answer about.
          focusKeys: pinned ? focus.map((ref) => `${ref.kind}:${ref.id}`) : undefined,
          history: previous,
        },
        { onDelta: (delta) => setStreaming((current) => current + delta) }
      );
      setFocus(result.focus);
      setMessages([
        ...withUser,
        {
          role: 'assistant',
          content: result.noMaterial
            ? t('No he encontrado nada de tu mundo en esa pregunta. Nombra un personaje, un lugar, una escena o una ley y vuelvo a mirar.')
            : result.text,
        },
      ]);
    } catch (error) {
      setMessages([
        ...withUser,
        { role: 'assistant', content: `${t('No se pudo generar la respuesta.')} (${(error as Error).message})` },
      ]);
    } finally {
      setStreaming('');
      setBusy(false);
    }
  };

  const answer = (text: string) => (
    <Markdown
      content={text}
      className="text-sm"
      // Never verified against the academic corpus: these citations point at world entries,
      // and the repo has already dropped the ones the model invented.
      verify={false}
      onWorldEntry={(kind) => SECTION_OF_KIND[kind] && onNavigate?.(SECTION_OF_KIND[kind])}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="world-chat-view">
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 dark:border-neutral-800 p-4">
        <Icon name="chat" size={20} className="text-indigo-700 dark:text-indigo-300" />
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">{t('Chat del mundo')}</h1>
          <p className="text-[10px] text-neutral-600 dark:text-neutral-500">
            {t('Nodus calcula y el modelo redacta: responde con lo que hay en tus fichas, y cita.')}
          </p>
        </div>
        <button
          className="btn btn-ghost ml-auto h-8 gap-1.5 border border-neutral-300 dark:border-neutral-700 px-2 text-xs"
          data-testid="world-chat-new"
          onClick={() => {
            setMessages([]);
            setFocus([]);
            setStreaming('');
          }}
        >
          <Icon name="plus" size={13} /> {t('Nuevo chat')}
        </button>
      </div>

      {/* What it actually looked at. A chat that answers about a world without saying which
          half of it it read is a chat you have to double-check. */}
      {focus.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-neutral-200 dark:border-neutral-800 px-4 py-2" data-testid="world-chat-focus">
          <span className="text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-600">{t('Ha mirado')}</span>
          {focus.map((ref) => (
            <button
              key={`${ref.kind}:${ref.id}`}
              className="rounded-full bg-neutral-200 dark:bg-neutral-800 px-2.5 py-0.5 text-[11px] text-neutral-700 dark:text-neutral-300 hover:bg-neutral-300 dark:hover:bg-neutral-700"
              disabled={!SECTION_OF_KIND[ref.kind]}
              onClick={() => SECTION_OF_KIND[ref.kind] && onNavigate?.(SECTION_OF_KIND[ref.kind])}
            >
              {ref.title}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-1.5 text-[11px] text-neutral-600 dark:text-neutral-400">
            <input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} />
            {t('Seguir con esto')}
          </label>
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-4">
        {messages.length === 0 && !streaming && (
          <div className="mx-auto mt-10 max-w-xl text-center">
            <Icon name="chat" size={32} className="mx-auto mb-2 text-neutral-400 dark:text-neutral-700" />
            <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-400">
              {t('Pregúntale a tu mundo. Nombra en la pregunta lo que quieras que mire.')}
            </p>
            <div className="flex flex-col gap-2">
              {STARTERS.map((starter) => (
                <button
                  key={starter}
                  className="rounded-lg border border-neutral-200 dark:border-neutral-800 px-3 py-2 text-left text-sm hover:border-indigo-400 dark:hover:border-violet-600/70 hover:bg-neutral-100 dark:hover:bg-neutral-900"
                  onClick={() => void send(t(starter))}
                >
                  {t(starter)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {messages.map((message, index) =>
            message.role === 'user' ? (
              <div key={index} className="self-end max-w-[85%] rounded-2xl bg-indigo-600 px-3.5 py-2 text-sm text-white">
                {message.content}
              </div>
            ) : (
              <div
                key={index}
                data-testid="world-chat-answer"
                className="self-start max-w-[95%] rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900 px-3.5 py-2"
              >
                {answer(message.content)}
              </div>
            )
          )}
          {streaming && (
            <div className="self-start max-w-[95%] rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900 px-3.5 py-2">
              {answer(streaming)}
            </div>
          )}
          {busy && !streaming && <div className="self-start text-xs text-neutral-600 dark:text-neutral-500">{t('Pensando…')}</div>}
        </div>
      </div>

      <div className="border-t border-neutral-200 dark:border-neutral-800 p-3">
        <div className="mx-auto flex max-w-3xl gap-2">
          <input
            className="input flex-1"
            data-testid="world-chat-input"
            placeholder={t('¿Podía hacerlo, ahí y entonces?')}
            value={input}
            disabled={busy}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void send(input);
            }}
          />
          {busy ? (
            <button className="btn btn-ghost border border-neutral-300 dark:border-neutral-700" onClick={() => void window.nodus.cancelWorldChat()}>
              <Icon name="stop" /> {t('Detener')}
            </button>
          ) : (
            <button className="btn btn-primary gap-1.5" disabled={!input.trim()} onClick={() => void send(input)}>
              <Icon name="chat" size={14} /> {t('Enviar')}
            </button>
          )}
        </div>
        <p className="mx-auto mt-1.5 max-w-3xl text-[10px] leading-4 text-neutral-500 dark:text-neutral-600">
          {t('No escribe nada en tu mundo: lo que te proponga, lo copias tú o lo conviertes en pregunta abierta.')}
        </p>
      </div>
    </div>
  );
}
