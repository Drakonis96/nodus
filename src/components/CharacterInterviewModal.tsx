import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Character } from '@shared/types';
import type { InterviewTurn } from '@shared/characterInterview';
import { Icon } from './ui';
import { t, tx } from '../i18n';

/**
 * Ask the character questions and let them answer in their own voice.
 *
 * The exchange is NOT saved: it lives here while the modal is open. An interview is a
 * thinking tool — what it produces becomes canon only by the author editing the sheet.
 * Keeping a transcript would create a second account of the character that nothing else
 * reads and no one maintains.
 */
export function CharacterInterviewModal({
  character,
  onClose,
}: {
  character: Character;
  onClose: () => void;
}) {
  const [turns, setTurns] = useState<InterviewTurn[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [turns, busy]);

  const ask = async () => {
    const trimmed = question.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    // The question is shown immediately, and the history sent is the one BEFORE it, so a
    // failed turn leaves the author's words on screen to retry rather than losing them.
    const history = turns;
    setTurns([...history, { role: 'author', content: trimmed }]);
    setQuestion('');
    try {
      const answer = await window.nodus.interviewCharacter(character.personId, trimmed, history);
      setTurns((current) => [...current, { role: 'character', content: answer }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const hasSheet = Boolean(
    character.profile.appearance?.trim() ||
      character.profile.personality?.trim() ||
      character.profile.backstory?.trim()
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="card-modal flex h-[80vh] w-full max-w-2xl flex-col p-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby="interview-title"
      >
        <div className="mb-3 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 id="interview-title" className="text-base font-semibold text-neutral-100">
              {tx('Entrevistar a {name}', { name: character.displayName })}
            </h3>
            <p className="mt-1 text-xs text-neutral-500">
              {t('Responde en su voz y solo sabe lo que hay en su ficha. Nada de esta conversación se guarda.')}
            </p>
          </div>
          <button
            className="btn btn-ghost h-8 w-8 shrink-0 p-0 text-neutral-400"
            aria-label={t('Cerrar')}
            onClick={onClose}
          >
            <Icon name="x" size={15} />
          </button>
        </div>

        <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-md border border-neutral-800 bg-neutral-900/40 p-3">
          {turns.length === 0 && (
            <div className="py-8 text-center">
              {hasSheet ? (
                <>
                  <p className="text-sm text-neutral-500">{t('Pregúntale algo.')}</p>
                  <ul className="mt-3 space-y-1.5 text-xs text-neutral-600">
                    <li>{t('«¿De qué te arrepientes?»')}</li>
                    <li>{t('«¿A quién no soportas y por qué?»')}</li>
                    <li>{t('«¿Qué harías si te quitaran lo que más quieres?»')}</li>
                  </ul>
                </>
              ) : (
                <p className="text-sm text-amber-300">
                  {t('Rellena antes su descripción: sin ficha no tiene nada que contestar.')}
                </p>
              )}
            </div>
          )}
          {turns.map((turn, index) => (
            <div
              key={`${index}-${turn.role}`}
              className={turn.role === 'author' ? 'flex justify-end' : 'flex justify-start'}
            >
              <p
                className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-6 ${
                  turn.role === 'author'
                    ? 'bg-indigo-600/20 text-neutral-200'
                    : 'border border-neutral-800 bg-neutral-950/60 text-neutral-200'
                }`}
              >
                {turn.content}
              </p>
            </div>
          ))}
          {busy && (
            <p className="flex items-center gap-2 text-xs text-neutral-500">
              <Icon name="sync" size={12} className="animate-spin" /> {t('Pensando…')}
            </p>
          )}
        </div>

        {error && <p className="mt-2 text-xs text-red-300">{error}</p>}

        <div className="mt-3 flex gap-2">
          <input
            className="input h-9 flex-1 text-sm"
            placeholder={t('Tu pregunta…')}
            aria-label={t('Tu pregunta…')}
            value={question}
            autoFocus
            disabled={busy}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void ask();
            }}
          />
          <button className="btn btn-primary min-w-24" disabled={busy || !question.trim()} onClick={() => void ask()}>
            {t('Preguntar')}
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}
