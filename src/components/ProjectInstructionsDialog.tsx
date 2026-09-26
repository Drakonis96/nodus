import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { ResearchChatProject } from '@shared/types';
import { RESEARCH_PROMPT_TEXT_LIMIT } from '@shared/researchSystemPrompts';
import { t } from '../i18n';
import { Icon } from './ui';

export function ProjectInstructionsDialog({ project, onSave, onClose }: {
  project: ResearchChatProject; onSave: (instructions: string) => Promise<void>; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [instructions, setInstructions] = useState(project.instructions ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useLayoutEffect(() => {
    const element = dialog.current;
    element?.showModal(); input.current?.focus();
    return () => element?.close();
  }, []);
  const save = async () => {
    setBusy(true); setError('');
    try { await onSave(instructions); onClose(); }
    catch (reason) { const message = reason instanceof Error ? reason.message : String(reason); setError(message.includes('research_chat_project_invalid_instructions') ? t('Las instrucciones del proyecto admiten hasta 12.000 caracteres.') : message); setBusy(false); }
  };
  return createPortal(<dialog ref={dialog} data-balloon-layer data-testid="project-instructions-dialog"
    style={{ '--vault-accent': 'var(--a-500)' } as CSSProperties}
    className="research-system-prompt-dialog research-prompt-edit-modal" aria-label={t('Instrucciones del proyecto')}
    onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className="research-prompt-edit-head"><Icon name="brain" size={18} /><h2>{t('Instrucciones del proyecto')}</h2></header>
    <div className="research-prompt-edit-body">
      <strong>{project.name}</strong>
      <p>{t('Se aplican a todos los chats de este proyecto desde el siguiente mensaje. El prompt de cada chat puede concretarlas. Déjalo vacío para desactivarlas.')}</p>
      <label className="research-prompt-field research-prompt-instructions">{t('Instrucciones personalizadas')}
        <textarea ref={input} aria-label={t('Instrucciones personalizadas')} maxLength={RESEARCH_PROMPT_TEXT_LIMIT} disabled={busy}
          value={instructions} onChange={event => setInstructions(event.target.value)}
          placeholder={t('Define el rol, el tono y la estructura que prefieres para las respuestas.')} />
        <small>{instructions.length.toLocaleString()} / {RESEARCH_PROMPT_TEXT_LIMIT.toLocaleString()}</small>
      </label>
      {error && <p className="research-prompt-error" role="alert">{error}</p>}
    </div>
    <footer className="research-prompt-footer research-prompt-edit-foot"><span /><span />
      <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>{t('Cancelar')}</button>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? t('Guardando…') : t('Guardar')}</button>
    </footer>
  </dialog>, document.body);
}
