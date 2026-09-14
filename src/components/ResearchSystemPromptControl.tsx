import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { RESEARCH_PROMPT_NAME_LIMIT, RESEARCH_PROMPT_TEXT_LIMIT, type ResearchSystemPrompt } from '@shared/researchSystemPrompts';
import { Icon } from './ui';
import { t } from '../i18n';

export function ResearchSystemPromptControl({ prompts, selectedId, disabled, onSelect, refresh }: {
  prompts: ResearchSystemPrompt[]; selectedId: string | null; disabled: boolean;
  onSelect: (id: string | null) => Promise<void>; refresh: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = prompts.find(prompt => prompt.id === selectedId);
  return <>
    <button ref={trigger} type="button" className={`btn btn-ghost border border-neutral-700 gap-1.5 text-xs research-system-prompt-trigger ${selected ? 'research-accent-soft' : ''}`}
      data-testid="research-system-prompt-trigger" disabled={disabled} aria-haspopup="dialog" aria-expanded={open}
      aria-label={`${t('System prompt')}: ${selected?.name ?? 'Default'}`}
      title={`${t('System prompt')}: ${selected?.name ?? 'Default'}`} onClick={() => setOpen(true)}>
      <Icon name="edit" size={14} /><span className="research-system-prompt-name">{selected?.name ?? 'Default'}</span><Icon name="chevronDown" size={13} />
    </button>
    {open && <PromptDialog prompts={prompts} selectedId={selectedId} refresh={refresh} onSelect={onSelect}
      accent={trigger.current ? getComputedStyle(trigger.current).getPropertyValue('--vault-accent') : ''}
      onClose={() => { setOpen(false); requestAnimationFrame(() => trigger.current?.focus()); }} />}
  </>;
}

function PromptDialog({ prompts, selectedId, accent, onClose, onSelect, refresh }: {
  prompts: ResearchSystemPrompt[]; selectedId: string | null; accent: string; onClose: () => void;
  onSelect: (id: string | null) => Promise<void>; refresh: () => Promise<unknown>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [viewId, setViewId] = useState<string | null>(selectedId);
  const [name, setName] = useState(prompts.find(p => p.id === selectedId)?.name ?? '');
  const [instructions, setInstructions] = useState(prompts.find(p => p.id === selectedId)?.instructions ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const original = prompts.find(p => p.id === viewId);
  const creating = viewId === 'new';
  const isDefault = viewId === null;
  const dirty = creating || name !== original?.name || instructions !== original?.instructions;
  const matching = [...prompts].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }))
    .filter(p => `${p.name} ${p.instructions}`.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().includes(query.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().trim()));
  useEffect(() => { dialog.current?.showModal(); void refresh().catch(e => setError(String(e))); }, []);
  useLayoutEffect(() => { if (viewId === 'new') titleInput.current?.focus(); }, [viewId]);
  const show = (prompt?: ResearchSystemPrompt) => { setViewId(prompt?.id ?? null); setName(prompt?.name ?? ''); setInstructions(prompt?.instructions ?? ''); setError(''); setConfirmDelete(false); };
  const create = () => { setViewId('new'); setName(''); setInstructions(''); setError(''); setConfirmDelete(false); };
  const usePrompt = async () => {
    setBusy(true); setError('');
    try {
      let id = viewId;
      if (!isDefault && dirty) {
        const saved = await window.nodus.saveResearchSystemPrompt({ id: creating ? undefined : viewId!, name, instructions });
        id = saved.id;
        await refresh();
      }
      await onSelect(id); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const remove = async () => { if (!original) return; setBusy(true); setError(''); try { await window.nodus.deleteResearchSystemPrompt(original.id); await refresh(); show(); } catch (e) { setError(String(e)); } finally { setBusy(false); } };
  return createPortal(<dialog ref={dialog} className="research-system-prompt-dialog" aria-labelledby="research-system-prompt-title"
    style={{ '--vault-accent': accent } as CSSProperties} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className="research-prompt-header">
      <div><div className="research-prompt-eyebrow">Research chat</div><h2 id="research-system-prompt-title">{t('System prompts')}</h2><p>{t('Elige cómo quieres que te acompañe el asistente.')}</p></div>
      <button className="btn btn-ghost" title={t('Cerrar')} disabled={busy} onClick={onClose}><Icon name="x" size={18} /></button>
    </header>
    <div className="research-prompt-layout">
      <aside className="research-prompt-library">
        <label className="research-prompt-search"><Icon name="search" size={15} /><input aria-label={t('Buscar prompts')} placeholder={t('Buscar prompts')} value={query} onChange={e => setQuery(e.target.value)} /></label>
        <button type="button" className="research-prompt-new" disabled={busy} onClick={create}><Icon name="plus" size={14} />{t('Nuevo prompt')}</button>
        <div className="research-prompt-list" role="list" aria-label={t('Prompts guardados')}>
          <div role="listitem"><button type="button" aria-pressed={isDefault} className={`research-prompt-item ${isDefault ? 'is-viewed' : ''}`} disabled={busy} onClick={() => show()}>
            <Icon name="layers" size={16} /><span><strong>Default</strong><small>{t('Prompt original de Nodus')}</small></span>{selectedId === null && <Icon name="check" size={15} />}
          </button></div>
          <div className="research-prompt-list-label">{t('Tus prompts')} <span>{prompts.length}</span></div>
          {matching.map(prompt => <div key={prompt.id} role="listitem"><button type="button" aria-pressed={viewId === prompt.id} className={`research-prompt-item ${viewId === prompt.id ? 'is-viewed' : ''}`} disabled={busy} onClick={() => show(prompt)}>
            <Icon name="edit" size={15} /><span><strong>{prompt.name}</strong><small>{prompt.instructions}</small></span>{selectedId === prompt.id && <Icon name="check" size={15} />}
          </button></div>)}
          {!matching.length && <p className="research-prompt-empty">{t(query ? 'No hay prompts que coincidan.' : 'Crea un prompt para personalizar tus conversaciones.')}</p>}
        </div>
      </aside>
      <section className="research-prompt-editor">
        <div className="research-prompt-contract"><Icon name="check" size={16} /><div><strong>{t('Las capacidades de Nodus siguen activas')}</strong><p>{t('Contexto, ideas, citas y skills conservan sus reglas. Tus instrucciones personalizan el enfoque, no sustituyen estas capacidades.')}</p></div></div>
        {isDefault ? <div className="research-prompt-default"><span><Icon name="layers" size={28} /></span><h3>Default</h3><p>{t('Usa el system prompt original de Nodus, sin instrucciones adicionales.')}</p><small>{t('El prompt base no se modifica y siempre puedes volver a él.')}</small></div> : <>
          <label className="research-prompt-field">{t('Nombre del prompt')}<input ref={titleInput} className="input" maxLength={RESEARCH_PROMPT_NAME_LIMIT} disabled={busy} value={name} onChange={e => setName(e.target.value)} placeholder={t('Por ejemplo: Revisor crítico')} /></label>
          <label className="research-prompt-field research-prompt-instructions">{t('Instrucciones personalizadas')}<textarea aria-label={t('Instrucciones personalizadas')} maxLength={RESEARCH_PROMPT_TEXT_LIMIT} disabled={busy} value={instructions} onChange={e => setInstructions(e.target.value)} placeholder={t('Define el rol, el tono y la estructura que prefieres para las respuestas.')} /><small>{instructions.length.toLocaleString()} / {RESEARCH_PROMPT_TEXT_LIMIT.toLocaleString()}</small></label>
        </>}
        {error && <p className="research-prompt-error" role="alert">{error}</p>}
        <footer className="research-prompt-footer">{original && <button className="btn btn-ghost" title={t('Eliminar prompt')} disabled={busy} onClick={() => setConfirmDelete(true)}><Icon name="trash" size={14} /></button>}<span />
          <button className="btn btn-ghost" disabled={busy} onClick={onClose}>{t('Cancelar')}</button>
          <button className="btn btn-primary" disabled={busy || (!isDefault && (!name.trim() || !instructions.trim()))} onClick={() => void usePrompt()}>{busy ? t('Guardando…') : isDefault ? t('Usar Default') : dirty ? t('Guardar y usar') : t('Usar prompt')}</button>
        </footer>
      </section>
    </div>
    {confirmDelete && original && <DeletePromptConfirmation name={original.name} busy={busy} error={error} accent={accent}
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
  return createPortal(<dialog ref={dialog} role="alertdialog" aria-modal="true"
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
