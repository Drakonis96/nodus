import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './ui';
import { t } from '../i18n';

/**
 * A chat history's own notebook, created or edited: its name and the sources its chats
 * read. The dialog is Research Chat's notebook dialog, with the surface's source picker in
 * place of the collection tree (the databases of a Databases vault, the entries of a
 * Worldbuilding vault). It never touches the sources themselves.
 */
export function ChatNotebookDialog<Selection>({ name: initialName, selection: initialSelection, editing, picker, ready, onSave, onClose }: {
  name: string;
  selection: Selection;
  /** Editing an existing notebook rather than creating one. */
  editing: boolean;
  picker: (selection: Selection, onChange: (next: Selection) => void, disabled: boolean) => ReactNode;
  /** Whether the selection is enough to save (at least one source). */
  ready: (selection: Selection) => boolean;
  onSave: (name: string, selection: Selection) => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initialName);
  const [selection, setSelection] = useState(initialSelection);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [accent, setAccent] = useState('var(--a-500)');
  useLayoutEffect(() => {
    const element = dialog.current;
    element?.showModal();
    nameRef.current?.focus();
    const surface = document.querySelector('.research-chat-surface');
    if (surface) setAccent(getComputedStyle(surface).getPropertyValue('--vault-accent').trim() || 'var(--a-500)');
    return () => element?.close();
  }, []);
  const save = async () => {
    setBusy(true); setError('');
    try { await onSave(name.trim(), selection); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setBusy(false); }
  };
  const title = editing ? t('Editar cuaderno') : t('Nuevo cuaderno');
  return createPortal(<dialog ref={dialog} className="research-system-prompt-dialog research-prompt-edit-modal research-notebook-modal" aria-label={title} data-testid="chat-notebook-dialog"
    style={{ '--vault-accent': accent } as CSSProperties}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className="research-prompt-edit-head"><Icon name="notebook" size={18} /><div><h2>{title}</h2><p>{t('Elige las fuentes que leerán sus chats.')}</p></div></header>
    <form className="research-prompt-edit-body" id="chat-notebook-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      <label className="research-prompt-field">{t('Nombre')}<input ref={nameRef} className="input" required maxLength={120} value={name} disabled={busy} onChange={event => setName(event.target.value)} placeholder={t('Por ejemplo: Tesis, capítulo 2')} /></label>
      <div className="research-notebook-collections">{picker(selection, setSelection, busy)}</div>
      {!ready(selection) && <p role="status" className="research-notebook-summary">{t('Elige al menos una fuente.')}</p>}
      {error && <p className="research-prompt-error" role="alert">{error}</p>}
    </form>
    <footer className="research-prompt-footer research-prompt-edit-foot">
      <span />
      <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>{t('Cancelar')}</button>
      <button type="submit" form="chat-notebook-form" className="btn btn-primary" disabled={busy || !name.trim() || !ready(selection)}>{busy ? t('Guardando…') : editing ? t('Guardar') : t('Crear cuaderno')}</button>
    </footer>
  </dialog>, document.body);
}

/** What a chat reading a notebook shows in its context panel instead of the picker. */
export function ChatNotebookContextNote({ name, onEdit }: { name: string; onEdit?: () => void }) {
  return <div className="mt-3 rounded-lg border border-neutral-200 p-3 text-xs dark:border-neutral-800" data-testid="chat-notebook-context">
    <p className="flex items-center gap-1.5 font-medium"><Icon name="notebook" size={13} />{name}</p>
    <p className="mt-1 text-[10px] leading-4 text-neutral-500">{t('Este chat lee las fuentes del cuaderno. Edita el cuaderno para cambiarlas.')}</p>
    {onEdit && <button type="button" className="btn btn-ghost mt-2 text-xs" onClick={onEdit}>{t('Editar fuentes')}</button>}
  </div>;
}
