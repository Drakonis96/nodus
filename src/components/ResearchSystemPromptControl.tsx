import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { RESEARCH_PROMPT_NAME_LIMIT, RESEARCH_PROMPT_TEXT_LIMIT, type ResearchSystemPrompt } from '@shared/researchSystemPrompts';
import { HeaderBalloon } from './HeaderBalloon';
import { Icon } from './ui';
import { t } from '../i18n';

export function ResearchSystemPromptControl({ prompts, selectedId, disabled, onSelect, refresh }: {
  prompts: ResearchSystemPrompt[]; selectedId: string | null; disabled: boolean;
  onSelect: (id: string | null) => Promise<void>; refresh: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ResearchSystemPrompt | 'new' | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = prompts.find(prompt => prompt.id === selectedId);
  useEffect(() => { if (open) void refresh().catch(e => setError(String(e))); }, [open]);
  const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().trim();
  const listed = [...prompts].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }))
    .filter(prompt => fold(`${prompt.name} ${prompt.instructions}`).includes(fold(query)));
  // One prompt is active per conversation: activating one is the whole choice.
  const activate = async (id: string | null) => {
    setBusy(true); setError('');
    try { await onSelect(id); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const accent = () => trigger.current ? getComputedStyle(trigger.current).getPropertyValue('--vault-accent').trim() || 'var(--a-500)' : 'var(--a-500)';
  const row = (prompt: ResearchSystemPrompt | null) => {
    const id = prompt?.id ?? null;
    const active = selectedId === id;
    return <div key={id ?? 'default'} role="listitem" className={`header-balloon-row research-prompt-row ${active ? 'is-active' : ''}`} data-testid={`research-prompt-${id ?? 'default'}`}>
      <span className="header-balloon-row-icon"><Icon name={prompt ? 'edit' : 'layers'} size={15} /></span>
      <span className="header-balloon-row-text"><strong>{prompt?.name ?? 'Default'}</strong><small>{prompt?.instructions ?? t('Prompt original de Nodus')}</small></span>
      <button type="button" className={`header-balloon-chip ${active ? 'is-on' : ''}`} aria-pressed={active} disabled={busy || active}
        aria-label={`${active ? t('Activo') : t('Activar')}: ${prompt?.name ?? 'Default'}`} onClick={() => void activate(id)}>
        {active && <Icon name="check" size={13} />}{active ? t('Activo') : t('Activar')}
      </button>
      {prompt && <button type="button" className="header-balloon-icon-button" disabled={busy} aria-label={`${t('Editar')}: ${prompt.name}`} title={t('Editar')} onClick={() => setEditing(prompt)}><Icon name="edit" size={15} /></button>}
    </div>;
  };
  return <>
    <button ref={trigger} type="button" className={`btn btn-ghost border border-neutral-700 gap-1.5 text-xs research-system-prompt-trigger ${selected ? 'research-accent-soft' : ''}`}
      data-testid="research-system-prompt-trigger" disabled={disabled} aria-haspopup="dialog" aria-expanded={open}
      aria-label={`${t('System prompt')}: ${selected?.name ?? 'Default'}`}
      title={`${t('System prompt')}: ${selected?.name ?? 'Default'}`} onClick={() => setOpen(current => !current)}>
      <Icon name="edit" size={14} /><span className="research-system-prompt-name">{t('System prompt')}</span><Icon name="chevronDown" size={13} />
    </button>
    <HeaderBalloon open={open} anchor={trigger} onClose={() => { if (!editing) setOpen(false); }} width={440}
      icon={<Icon name="edit" size={18} />} title={t('System prompts')} meta={selected?.name ?? 'Default'} testId="research-system-prompt-panel"
      footer={<button type="button" className="btn btn-ghost research-prompt-new-button" disabled={busy} onClick={() => setEditing('new')}><Icon name="plus" size={14} />{t('Nuevo prompt')}</button>}>
      <p className="header-balloon-intro">{t('Elige cómo quieres que te acompañe el asistente.')}</p>
      {prompts.length > 5 && <label className="header-balloon-search"><Icon name="search" size={14} /><input aria-label={t('Buscar prompts')} placeholder={t('Buscar prompts')} value={query} onChange={e => setQuery(e.target.value)} /></label>}
      <div role="list" aria-label={t('Prompts guardados')}>
        {!query && row(null)}
        {listed.map(prompt => row(prompt))}
        {!listed.length && query && <p className="research-prompt-empty">{t('No hay prompts que coincidan.')}</p>}
      </div>
      {!prompts.length && <p className="research-prompt-empty">{t('Crea un prompt para personalizar tus conversaciones.')}</p>}
      {error && <p className="research-prompt-error" role="alert">{error}</p>}
    </HeaderBalloon>
    {editing && <PromptEditor prompt={editing === 'new' ? null : editing} accent={accent()} refresh={refresh}
      onClose={() => setEditing(null)}
      onDeleted={async id => { if (selectedId === id) await onSelect(null); }} />}
  </>;
}

/** One prompt's name and instructions, in a modal whose Cancel and Save stay in view. */
function PromptEditor({ prompt, accent, refresh, onClose, onDeleted }: {
  prompt: ResearchSystemPrompt | null; accent: string; refresh: () => Promise<unknown>; onClose: () => void; onDeleted: (id: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(prompt?.name ?? '');
  const [instructions, setInstructions] = useState(prompt?.instructions ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  useLayoutEffect(() => {
    const element = dialog.current;
    element?.showModal();
    titleInput.current?.focus();
    return () => element?.close();
  }, []);
  const save = async () => {
    setBusy(true); setError('');
    try { await window.nodus.saveResearchSystemPrompt({ id: prompt?.id, name, instructions }); await refresh(); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };
  const remove = async () => {
    if (!prompt) return;
    setBusy(true); setError('');
    try { await window.nodus.deleteResearchSystemPrompt(prompt.id); await onDeleted(prompt.id); await refresh(); onClose(); }
    catch (e) { setError(String(e)); setBusy(false); }
  };
  const title = prompt ? t('Editar prompt') : t('Nuevo prompt');
  return createPortal(<dialog ref={dialog} data-balloon-layer className="research-system-prompt-dialog research-prompt-edit-modal" aria-label={title}
    style={{ '--vault-accent': accent } as CSSProperties}
    onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}
    onCancel={event => { event.preventDefault(); if (!busy && !confirmDelete) onClose(); }}>
    <header className="research-prompt-edit-head"><Icon name="edit" size={18} /><h2>{title}</h2></header>
    <div className="research-prompt-edit-body">
      <div className="research-prompt-contract"><Icon name="check" size={16} /><div><strong>{t('Las capacidades de Nodus siguen activas')}</strong><p>{t('Contexto, ideas, citas y skills conservan sus reglas. Tus instrucciones personalizan el enfoque, no sustituyen estas capacidades.')}</p></div></div>
      <label className="research-prompt-field">{t('Nombre del prompt')}<input ref={titleInput} className="input" maxLength={RESEARCH_PROMPT_NAME_LIMIT} disabled={busy} value={name} onChange={e => setName(e.target.value)} placeholder={t('Por ejemplo: Revisor crítico')} /></label>
      <label className="research-prompt-field research-prompt-instructions">{t('Instrucciones personalizadas')}<textarea aria-label={t('Instrucciones personalizadas')} maxLength={RESEARCH_PROMPT_TEXT_LIMIT} disabled={busy} value={instructions} onChange={e => setInstructions(e.target.value)} placeholder={t('Define el rol, el tono y la estructura que prefieres para las respuestas.')} /><small>{instructions.length.toLocaleString()} / {RESEARCH_PROMPT_TEXT_LIMIT.toLocaleString()}</small></label>
      {error && <p className="research-prompt-error" role="alert">{error}</p>}
    </div>
    <footer className="research-prompt-footer research-prompt-edit-foot">
      {prompt && <button type="button" className="btn btn-ghost" title={t('Eliminar prompt')} aria-label={t('Eliminar prompt')} disabled={busy} onClick={() => setConfirmDelete(true)}><Icon name="trash" size={14} /></button>}
      <span />
      <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>{t('Cancelar')}</button>
      <button type="button" className="btn btn-primary" disabled={busy || !name.trim() || !instructions.trim()} onClick={() => void save()}>{busy ? t('Guardando…') : t('Guardar')}</button>
    </footer>
    {confirmDelete && prompt && <DeletePromptConfirmation name={prompt.name} busy={busy} error={error} accent={accent}
      onCancel={() => setConfirmDelete(false)} onConfirm={remove} />}
  </dialog>, document.body);
}

/** Native top-layer dialog keeps the prompt editor inert until deletion is decided. */
function DeletePromptConfirmation({ name, busy, error, accent, onCancel, onConfirm }: {
  name: string; busy: boolean; error: string; accent: string;
  onCancel: () => void; onConfirm: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current;
    element?.showModal();
    cancelButton.current?.focus();
    return () => element?.close();
  }, []);
  return createPortal(<dialog ref={dialog} data-balloon-layer role="alertdialog" aria-modal="true"
    aria-labelledby="research-prompt-delete-title" aria-describedby="research-prompt-delete-description"
    className="research-system-prompt-dialog research-prompt-delete-modal" style={{ '--vault-accent': accent } as CSSProperties}
    onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); if (!busy) onCancel(); }}>
    <h2 id="research-prompt-delete-title">{t('Eliminar prompt')}</h2>
    <p className="research-prompt-delete-name">{name}</p>
    <p id="research-prompt-delete-description">{t('¿Eliminar este prompt? Las conversaciones que lo usan volverán a Default.')}</p>
    {error && <p className="research-prompt-error" role="alert">{error}</p>}
    <footer className="research-prompt-footer">
      <span />
      <button ref={cancelButton} type="button" className="btn btn-ghost" disabled={busy} onClick={onCancel}>{t('Cancelar')}</button>
      <button type="button" className="btn bg-red-600 hover:bg-red-500 text-white" disabled={busy} onClick={() => void onConfirm()}>{t('Eliminar')}</button>
    </footer>
  </dialog>, document.body);
}
