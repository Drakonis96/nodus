import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { ChatSkill, ChatSkillSurface } from '@shared/chatSkills';
import { Icon } from './ui';
import { t } from '../i18n';
import './chatSkills.css';

const blank = (): ChatSkill => ({ id: '', name: '', description: '', instructions: '', enabled: { assistant: true, nodi: true } });
const searchText = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Shared library, independent activation per surface; available in the narrowed Nodi bridge. */
export function ChatSkillsControl({ surface, disabled = false, compact = false }: { surface: ChatSkillSurface; disabled?: boolean; compact?: boolean }) {
  const [skills, setSkills] = useState<ChatSkill[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<ChatSkill | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});
  // A top-level overlay keeps the selector usable inside narrow, clipped chat sidebars.
  useLayoutEffect(() => {
    if (!open || compact) return;
    const place = () => {
      const rect = root.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(420, window.innerWidth - 24);
      const below = window.innerHeight - rect.bottom - 20;
      const above = rect.top - 20;
      const upwards = below < 300 && above > below;
      setPanelStyle({ position: 'fixed', width, left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)), right: 'auto',
        top: upwards ? 'auto' : rect.bottom + 8, bottom: upwards ? window.innerHeight - rect.top + 8 : 'auto',
        maxHeight: Math.min(720, Math.max(160, upwards ? above : below)), zIndex: 10050 });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, compact]);
  const fileRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [imageModel, setImageModel] = useState('');
  useEffect(() => {
    const refresh = () => { void window.nodus.listChatSkills().then(setSkills).catch(e => setError(String(e))); };
    refresh();
    return window.nodus.onChatSkillsChanged(refresh);
  }, []);
  useEffect(() => { if (open) void window.nodus.getSettings().then(settings => setImageModel(settings.imageModel ? `${settings.imageProvider} · ${settings.imageModel}` : t('Elige un modelo de imagen en Ajustes.'))); }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node) && !panelRef.current?.contains(event.target as Node) && !draft) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopImmediatePropagation(); if (draft) setDraft(null); else setOpen(false); } };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape, true); };
  }, [open, draft]);
  useEffect(() => { if (draft) nameRef.current?.focus(); }, [!!draft]);
  const mutate = async (action: () => Promise<ChatSkill[]>) => {
    setBusy(true); setError('');
    try { setSkills(await action()); return true; } catch (e) { setError(e instanceof Error ? e.message : String(e)); return false; }
    finally { setBusy(false); }
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    setError('');
    try {
      if (file.size > 40_000) throw new Error(t('El archivo es demasiado grande. Máximo 40 KB.'));
      const text = await file.text();
      if (file.name.toLowerCase().endsWith('.json')) {
        let value;
        try { value = JSON.parse(text); } catch { throw new Error(t('El archivo JSON de la skill no es válido.')); }
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(t('El archivo JSON de la skill no es válido.'));
        setDraft({ ...blank(), name: String(value.name ?? ''), description: String(value.description ?? ''), instructions: String(value.instructions ?? '') });
      } else {
        const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
        const field = (name: string) => new RegExp(`^${name}:\\s*(.+)$`, 'm').exec(front?.[1] ?? '')?.[1]?.replace(/^['"]|['"]$/g, '') ?? '';
        setDraft({ ...blank(), name: field('name') || file.name.replace(/\.md$/i, ''), description: field('description'), instructions: text.slice(front?.[0].length ?? 0).trim() });
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const active = skills.filter(skill => skill.enabled[surface]).length;
  const terms = searchText(query).trim().split(/\s+/).filter(Boolean);
  const visibleSkills = skills.filter(skill => {
    const text = searchText(`${skill.name} ${skill.description}`);
    return terms.every(term => text.includes(term));
  });
  const renderPanel = (panel: React.ReactNode) => compact ? panel : createPortal(<div className={root.current?.closest('.light, .nodi-theme-light') ? 'light' : ''}>{panel}</div>, document.body);
  return <div className={`chat-skills-control ${compact ? 'compact' : ''}`} ref={root}>
    <button type="button" className="chat-skills-trigger" data-testid={`chat-skills-${surface}`} aria-label="Skills" aria-expanded={open} title="Skills" disabled={disabled} onClick={() => { setOpen(!open); setDraft(null); if (!open) setQuery(''); }}><Icon name="sparkles" size={compact ? 14 : 15} />{!compact && <span>Skills</span>}<span className="chat-skills-count">{active}</span></button>
    {open && renderPanel(<div ref={panelRef} style={compact ? undefined : panelStyle} className="chat-skills-panel" data-nodi-interactive role="region" aria-label="Skills">
      <div className="chat-skills-heading"><div><span className="chat-skills-eyebrow">NODUS SKILLS</span><h3>{draft ? (draft.id ? t('Editar skill') : t('Nueva skill')) : t('De la idea a la creación')}</h3></div><button type="button" aria-label={t('Cerrar')} onClick={() => { setOpen(false); setDraft(null); }}><Icon name="x" size={16} /></button></div>
      {draft ? <form className="chat-skill-editor" onSubmit={event => { event.preventDefault(); void mutate(() => window.nodus.saveChatSkill(draft)).then(saved => { if (saved) { setDraft(null); setQuery(''); } }); }}>
        <label>{t('Nombre de la skill')}<input ref={nameRef} required maxLength={80} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder={t('Mi narrador visual')} /></label>
        <label>{t('Cuándo usarla')}<textarea aria-label={t('Cuándo usarla')} required rows={2} maxLength={500} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} placeholder={t('Usar cuando el usuario necesite…')} /></label>
        <label>{t('Instrucciones')}<textarea aria-label={t('Instrucciones')} required className="chat-skill-prompt" rows={9} maxLength={16000} value={draft.instructions} onChange={event => setDraft({ ...draft, instructions: event.target.value })} placeholder={t('Describe el enfoque, el formato y los criterios de calidad…')} spellCheck={false} /></label>
        <small>{t('Describe el método y el resultado esperado. El modelo decide cuándo aplicarlo.')}</small>
        <div className="chat-skill-targets">{(['assistant', 'nodi'] as const).map(target => <label key={target}><input type="checkbox" checked={draft.enabled[target]} onChange={event => setDraft({ ...draft, enabled: { ...draft.enabled, [target]: event.target.checked } })} />{target === 'nodi' ? 'Nodi' : t('Asistente')}</label>)}</div>
        <div className="chat-skill-editor-actions"><button type="button" onClick={() => setDraft(null)}>{t('Cancelar')}</button><button className="chat-skill-primary" type="submit" disabled={busy}>{t('Guardar skill')}</button></div>
      </form> : <>
        <p className="chat-skills-intro">{t('Activa capacidades y deja que el modelo elija cuándo usarlas.')}<span>{surface === 'nodi' ? 'Nodi' : t('Asistente')} · {t(surface === 'nodi' ? 'Activación independiente' : 'Compartida entre los chats de la app')}</span></p>
        <div className="chat-skills-search">
          <Icon name="search" size={16} />
          <input ref={searchRef} type="search" aria-label={t('Buscar skills')} placeholder={t('Buscar por nombre o descripción…')} value={query} onChange={event => setQuery(event.target.value)} autoComplete="off" spellCheck={false} />
          {query && <button type="button" aria-label={t('Limpiar búsqueda de skills')} title={t('Limpiar búsqueda de skills')} onClick={() => { setQuery(''); searchRef.current?.focus(); }}><Icon name="x" size={14} /></button>}
        </div>
        {!visibleSkills.length && <div className="chat-skills-empty" role="status"><Icon name="search" size={20} /><span>{t('No se encontraron skills.')}</span></div>}
        <div className="chat-skills-list">{visibleSkills.map(skill => <div key={skill.id} className={`chat-skill-item ${skill.enabled[surface] ? 'enabled' : ''} ${skill.builtin === 'svg' || skill.builtin === 'image' ? 'tool-skill' : ''}`} data-skill-kind={skill.builtin === 'svg' || skill.builtin === 'image' ? 'tool' : 'prompt'}>
          <div className="chat-skill-main"><span className={`chat-skill-symbol ${skill.builtin ?? 'custom'}`}><Icon name={skill.builtin === 'svg' ? 'code' : skill.builtin === 'image' ? 'image' : skill.builtin === 'socratic' ? 'graduation' : 'sparkles'} size={20} /></span><div><b>{skill.name}</b>{(skill.builtin === 'svg' || skill.builtin === 'image') && <span className="chat-skill-tool-badge">{t('Con herramientas')}</span>}<p>{skill.description}</p></div><button type="button" role="switch" aria-checked={skill.enabled[surface]} aria-label={`${t('Activar')} ${skill.name}`} disabled={busy} className="chat-skill-switch" onClick={() => void mutate(() => window.nodus.saveChatSkill({ ...skill, enabled: { ...skill.enabled, [surface]: !skill.enabled[surface] } }))}><span /></button></div>
          <div className="chat-skill-item-foot"><small>{skill.builtin === 'image' ? imageModel : skill.builtin === 'svg' ? t('Vectorial · editable · preciso') : skill.builtin === 'socratic' ? t('Aprendizaje guiado · paso a paso') : skill.builtin ? t('Skill incluida') : t('Skill personal')}</small><button type="button" title={t('Editar skill')} aria-label={`${t('Editar')} ${skill.name}`} onClick={() => setDraft(structuredClone(skill))}><Icon name="edit" size={13} /></button><button type="button" title={t('Eliminar skill')} aria-label={`${t('Eliminar')} ${skill.name}`} onClick={() => setRemoveId(skill.id)}><Icon name="trash" size={13} /></button></div>
          {removeId === skill.id && <div className="chat-skill-confirm"><span>{t('¿Eliminar esta skill?')}</span><button type="button" disabled={busy} onClick={() => void mutate(() => window.nodus.deleteChatSkill(skill.id)).then(() => setRemoveId(null))}>{t('Eliminar')}</button><button type="button" onClick={() => setRemoveId(null)}>{t('Cancelar')}</button></div>}
        </div>)}</div>
        <div className="chat-skills-add"><button className="chat-skill-primary" type="button" onClick={() => setDraft(blank())}><Icon name="plus" size={14} />{t('Crear skill')}</button><button type="button" onClick={() => fileRef.current?.click()}><Icon name="upload" size={14} />{t('Importar .md')}</button><input ref={fileRef} type="file" accept=".md,.json" hidden onChange={event => { void importFile(event.target.files?.[0]); event.target.value = ''; }} /></div>
        <button type="button" className="chat-skills-restore" onClick={() => setConfirmRestore(true)}>{t('Restaurar skills iniciales')}</button>
        {confirmRestore && <div className="chat-skill-confirm"><span>{t('Se restaurarán las instrucciones y la activación de las skills iniciales.')}</span><button type="button" disabled={busy} onClick={() => void mutate(() => window.nodus.restoreChatSkills()).then(() => setConfirmRestore(false))}>{t('Restaurar')}</button><button type="button" onClick={() => setConfirmRestore(false)}>{t('Cancelar')}</button></div>}
      </>}
      {error && <p className="chat-skill-error" role="alert">{error}</p>}
    </div>)}
  </div>;
}
