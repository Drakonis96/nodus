import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  Character,
  CharacterChatConversation,
  CharacterChatConversationSummary,
} from '@shared/types';
import { Icon, AiBadge } from './ui';
import { ConfirmModal } from './ConfirmModal';
import { ImageLightbox } from './ImageLightbox';
import { characterChatImageUrl, characterChatThumbnailUrl } from '../lib/imageUrl';
import { t, tx } from '../i18n';

/**
 * Persistent, in-character chat. A conversation is created lazily on its first message,
 * so opening the modal or pressing "new" never leaves empty history records behind.
 */
export function CharacterInterviewModal({
  character,
  onClose,
}: {
  character: Character;
  onClose: () => void;
}) {
  const [conversation, setConversation] = useState<CharacterChatConversation | null>(null);
  const [history, setHistory] = useState<CharacterChatConversationSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [imageEnabled, setImageEnabled] = useState(false);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageNotice, setImageNotice] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CharacterChatConversationSummary | null>(null);
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const refreshHistory = async () => {
    const rows = await window.nodus.listCharacterChatConversations(character.personId);
    setHistory(rows);
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    window.nodus
      .listCharacterChatConversations(character.personId)
      .then((rows) => {
        if (alive) setHistory(rows);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [character.personId]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [conversation?.messages, busy]);

  const openConversation = async (id: string) => {
    if (busy) return;
    setLoading(true);
    setError(null);
    try {
      const loaded = await window.nodus.getCharacterChatConversation(id);
      if (!loaded || loaded.personId !== character.personId) throw new Error('Conversación no encontrada.');
      setConversation(loaded);
      setImageEnabled(loaded.imageEnabled);
      setHistoryOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const resetChat = () => {
    if (busy) return;
    setConversation(null);
    setQuestion('');
    setError(null);
    setImageNotice(null);
    setHistoryOpen(false);
  };

  const toggleImages = async () => {
    if (busy) return;
    const next = !imageEnabled;
    setImageEnabled(next);
    if (!conversation) return;
    try {
      const updated = await window.nodus.setCharacterChatImagesEnabled(conversation.id, next);
      if (updated) setConversation(updated);
      await refreshHistory();
    } catch (err) {
      setImageEnabled(!next);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const ask = async () => {
    const trimmed = question.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    setImageNotice(null);
    setQuestion('');
    let active = conversation;
    try {
      if (!active) {
        active = await window.nodus.createCharacterChatConversation({
          personId: character.personId,
          title: trimmed,
          imageEnabled,
        });
        setConversation(active);
      }
      const result = await window.nodus.sendCharacterChatMessage(active.id, trimmed);
      setConversation(result.conversation);
      setImageEnabled(result.conversation.imageEnabled);
      if (result.imageError) setImageNotice(result.imageError);
      await refreshHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      // The author turn is intentionally durable even if the text provider fails.
      if (active) {
        const saved = await window.nodus.getCharacterChatConversation(active.id).catch(() => null);
        if (saved) setConversation(saved);
      }
      await refreshHistory().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete || busy) return;
    setBusy(true);
    setError(null);
    const id = pendingDelete.id;
    try {
      await window.nodus.deleteCharacterChatConversation(id);
      if (conversation?.id === id) {
        setConversation(null);
        setImageNotice(null);
      }
      setPendingDelete(null);
      await refreshHistory();
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
  const messages = conversation?.messages ?? [];
  const gallery = useMemo(
    () =>
      messages.flatMap((message) =>
        message.image
          ? [
              {
                id: message.image.imageId,
                src: characterChatImageUrl(message.image),
                alt: character.displayName,
                label: character.displayName,
                meta: message.content,
              },
            ]
          : []
      ),
    [character.displayName, messages]
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3 sm:p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="card-modal flex h-[86vh] w-full max-w-5xl overflow-hidden p-0"
        role="dialog"
        aria-modal="true"
        aria-labelledby="interview-title"
        data-testid="character-chat-modal"
      >
        {historyOpen && (
          <aside className="flex w-64 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950">
            <div className="flex h-14 items-center gap-2 border-b border-neutral-200 px-3 dark:border-neutral-800">
              <span className="min-w-0 flex-1 text-xs font-semibold">{t('Historial de chats')}</span>
              <button
                type="button"
                className="btn btn-ghost h-7 w-7 p-0"
                title={t('Nuevo chat')}
                aria-label={t('Nuevo chat')}
                onClick={resetChat}
              >
                <Icon name="plus" size={12} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {history.map((item) => (
                <article
                  key={item.id}
                  className={`group mb-1 flex items-center rounded-lg ${
                    conversation?.id === item.id
                      ? 'bg-indigo-100 dark:bg-indigo-950/50'
                      : 'hover:bg-neutral-100 dark:hover:bg-neutral-900'
                  }`}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 px-2.5 py-2 text-left"
                    onClick={() => void openConversation(item.id)}
                  >
                    <span className="block truncate text-xs font-medium">{item.title}</span>
                    <span className="mt-0.5 block text-[9px] text-neutral-500">
                      {item.messageCount} {t('mensajes')}
                      {item.imageCount > 0 ? ` · ${item.imageCount} ${t('Imágenes').toLocaleLowerCase()}` : ''}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="mr-1 grid h-7 w-7 place-items-center rounded text-neutral-400 opacity-0 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 focus:opacity-100 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                    title={t('Eliminar chat')}
                    aria-label={t('Eliminar chat')}
                    disabled={busy}
                    onClick={() => setPendingDelete(item)}
                  >
                    <Icon name="trash" size={12} />
                  </button>
                </article>
              ))}
              {!loading && history.length === 0 && (
                <p className="px-3 py-10 text-center text-xs leading-5 text-neutral-500">
                  {t('Todavía no hay conversaciones guardadas.')}
                </p>
              )}
            </div>
          </aside>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex min-h-14 items-center gap-2 border-b border-neutral-200 bg-white px-3 dark:border-neutral-800 dark:bg-neutral-950 sm:px-4">
            <button
              type="button"
              data-testid="character-chat-history-toggle"
              className={`btn h-8 w-8 shrink-0 p-0 ${historyOpen ? 'btn-secondary' : 'btn-ghost'}`}
              aria-label={t('Historial de chats')}
              title={t('Historial de chats')}
              onClick={() => setHistoryOpen((open) => !open)}
            >
              <Icon name="clock" size={15} />
            </button>
            <div className="min-w-0 flex-1">
              <h3 id="interview-title" className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                {tx('Entrevistar a {name}', { name: character.displayName })}
              </h3>
              <p className="truncate text-[10px] text-neutral-500">
                {t('Responde en su propia voz; las conversaciones se guardan en esta bóveda.')}
              </p>
            </div>
            <label className="flex shrink-0 cursor-pointer items-center gap-2 text-[11px] text-neutral-600 dark:text-neutral-400">
              <span className="hidden sm:inline">{t('Imágenes')}</span>
              <button
                type="button"
                role="switch"
                data-testid="character-chat-image-toggle"
                aria-checked={imageEnabled}
                aria-label={t('Imágenes')}
                disabled={busy}
                className={`relative h-5 w-9 rounded-full transition-colors disabled:opacity-50 ${
                  imageEnabled ? 'bg-indigo-600' : 'bg-neutral-300 dark:bg-neutral-700'
                }`}
                onClick={() => void toggleImages()}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                    imageEnabled ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </label>
            <button
              type="button"
              className="btn btn-ghost h-8 w-8 shrink-0 p-0"
              aria-label={t('Nuevo chat')}
              title={t('Nuevo chat')}
              disabled={busy}
              onClick={resetChat}
            >
              <Icon name="plus" size={13} />
            </button>
            <button
              type="button"
              className="btn btn-ghost h-8 w-8 shrink-0 p-0"
              aria-label={t('Cerrar')}
              onClick={onClose}
            >
              <Icon name="x" size={15} />
            </button>
          </header>

          <div
            ref={scroller}
            className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-neutral-50/60 p-3 dark:bg-neutral-950/30 sm:p-5"
          >
            {messages.length === 0 && !loading && (
              <div className="py-10 text-center">
                {hasSheet ? (
                  <>
                    <p className="text-sm text-neutral-500">{t('Pregúntale algo.')}</p>
                    <ul className="mt-3 space-y-1.5 text-xs text-neutral-400 dark:text-neutral-600">
                      <li>{t('«¿De qué te arrepientes?»')}</li>
                      <li>{t('«¿A quién no soportas y por qué?»')}</li>
                      <li>{t('«¿Qué harías si te quitaran lo que más quieres?»')}</li>
                    </ul>
                  </>
                ) : (
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    {t('Rellena antes su descripción: sin ficha no tiene nada que contestar.')}
                  </p>
                )}
              </div>
            )}
            {messages.map((message) => (
              <div
                key={message.id}
                className={message.role === 'author' ? 'flex justify-end' : 'flex justify-start'}
              >
                <div
                  className={`max-w-[88%] overflow-hidden rounded-xl text-sm leading-6 ${
                    message.role === 'author'
                      ? 'bg-indigo-600 px-3 py-2 text-white'
                      : 'border border-neutral-200 bg-white text-neutral-800 shadow-sm dark:border-neutral-800 dark:bg-neutral-950/70 dark:text-neutral-200'
                  }`}
                >
                  <p className={message.role === 'author' ? 'whitespace-pre-wrap' : 'whitespace-pre-wrap px-3 py-2'}>
                    {message.content}
                  </p>
                  {message.image && (
                    <button
                      type="button"
                      className="relative block max-w-md border-t border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900"
                      onClick={() => setLightboxId(message.image!.imageId)}
                    >
                      <img
                        src={characterChatThumbnailUrl(message.image)}
                        alt={character.displayName}
                        className="max-h-80 w-full object-contain"
                      />
                      <AiBadge size="sm" />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <p className="flex items-center gap-2 text-xs text-neutral-500">
                <Icon name="sync" size={12} className="animate-spin" /> {t('Pensando…')}
              </p>
            )}
          </div>

          {(error || imageNotice) && (
            <div className="border-t border-neutral-200 bg-white px-4 py-2 text-xs dark:border-neutral-800 dark:bg-neutral-950">
              {error && <p className="text-red-600 dark:text-red-300">{error}</p>}
              {imageNotice && (
                <p className="text-amber-700 dark:text-amber-300">
                  <Icon name="image" size={11} className="mr-1" />
                  {imageNotice}
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2 border-t border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-950">
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
            <button
              type="button"
              className="btn btn-primary min-w-24"
              disabled={busy || !question.trim()}
              onClick={() => void ask()}
            >
              {t('Preguntar')}
            </button>
          </div>
        </div>
      </section>

      {pendingDelete && (
        <ConfirmModal
          zIndex={180}
          title={t('Borrar conversación')}
          message={tx('Se eliminará «{title}» junto con todos sus mensajes e imágenes. Esta acción no se puede deshacer.', {
            title: pendingDelete.title,
          })}
          confirmLabel={t('Eliminar')}
          danger
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}
      {lightboxId && gallery.length > 0 && (
        <ImageLightbox items={gallery} activeId={lightboxId} onClose={() => setLightboxId(null)} />
      )}
    </div>,
    document.body
  );
}
