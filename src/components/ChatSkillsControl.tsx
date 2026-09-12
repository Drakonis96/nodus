import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { ChatSkill, ChatSkillSurface } from '@shared/chatSkills';
import { SkillCard, skillMeta, skillSearchText, useSkillLibrary } from './skillLibrary';
import { canOpenSkillMarketplace, openSkillMarketplace } from './skillMarketplaceOpener';
import { Icon } from './ui';
import { byName } from './skillGlyph';
import { t, getActiveLang } from '../i18n';
import './chatSkills.css';

/**
 * Which skills are on in THIS chat.
 *
 * Only that. Installing, authoring, importing, plugin permissions and everything else
 * that is true of the whole application rather than of one conversation lives in the
 * Skills modal, one click away through the footer — and reachable without a chat at all,
 * from the header. What stays here is the single question you actually ask mid-sentence,
 * which is also the only one that fits a popover: a searchable list of what you have,
 * with a switch each.
 *
 * The library is shared and the activation is per surface, so the same skill can be on
 * for the assistant and off for Nodi.
 */
export function ChatSkillsControl({ surface, disabled = false, compact = false }: { surface: ChatSkillSurface; disabled?: boolean; compact?: boolean }) {
  const { skills, accent, error, busy, mutate } = useSkillLibrary();
  const accentStyle = { '--vault-accent': accent } as CSSProperties;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [details, setDetails] = useState('');
  const [imageModel, setImageModel] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
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
  useEffect(() => { if (open) void window.nodus.getSettings().then(settings => setImageModel(settings.imageModel ? `${settings.imageProvider} · ${settings.imageModel}` : t('Elige un modelo de imagen en Ajustes.'))); }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node) && !panelRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopImmediatePropagation(); setOpen(false); } };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape, true); };
  }, [open]);
  const active = skills.filter(skill => skill.enabled[surface]).length;
  const toggle = (skill: ChatSkill) =>
    void mutate(() => window.nodus.saveChatSkill({ ...skill, enabled: { ...skill.enabled, [surface]: !skill.enabled[surface] } }));
  const terms = skillSearchText(query).trim().split(/\s+/).filter(Boolean);
  // Alphabetical, always: the library is a list you look things up in, and an order that
  // depends on when each skill was installed means hunting for one you know is there.
  const visibleSkills = skills.filter(skill => {
    const text = skillSearchText(`${skill.name} ${skill.description}`);
    return terms.every(term => text.includes(term));
  }).sort(byName(getActiveLang()));
  const renderPanel = (panel: React.ReactNode) => compact ? panel : createPortal(<div style={accentStyle} className={root.current?.closest('.light, .nodi-theme-light') ? 'light' : ''}>{panel}</div>, document.body);
  return <div className={`chat-skills-control ${compact ? 'compact' : ''}`} ref={root} style={accentStyle}>
    <button type="button" className="chat-skills-trigger" data-testid={`chat-skills-${surface}`} aria-label="Skills" aria-expanded={open} title="Skills" disabled={disabled} onClick={() => { setOpen(!open); if (!open) setQuery(''); }}><Icon name="sparkles" size={compact ? 14 : 15} />{!compact && <span>Skills</span>}<span className="chat-skills-count">{active}</span></button>
    {open && renderPanel(<div ref={panelRef} style={compact ? undefined : panelStyle} className="chat-skills-panel" data-nodi-interactive role="region" aria-label="Skills">
      <div className="chat-skills-heading"><div><span className="chat-skills-eyebrow">NODUS SKILLS</span><h3>{t('De la idea a la creación')}</h3></div><button type="button" aria-label={t('Cerrar')} onClick={() => setOpen(false)}><Icon name="x" size={16} /></button></div>
      <p className="chat-skills-intro">{t('Activa capacidades y deja que el modelo elija cuándo usarlas.')}<span>{surface === 'nodi' ? 'Nodi' : t('Asistente')} · {t(surface === 'nodi' ? 'Activación independiente' : 'Compartida entre los chats de la app')}</span></p>
      <div className="chat-skills-search">
        <Icon name="search" size={16} />
        <input ref={searchRef} type="search" aria-label={t('Buscar skills')} placeholder={t('Buscar por nombre o descripción…')} value={query} onChange={event => setQuery(event.target.value)} autoComplete="off" spellCheck={false} />
        {query && <button type="button" aria-label={t('Limpiar búsqueda de skills')} title={t('Limpiar búsqueda de skills')} onClick={() => { setQuery(''); searchRef.current?.focus(); }}><Icon name="x" size={14} /></button>}
      </div>
      {!visibleSkills.length && <div className="chat-skills-empty" role="status"><Icon name="search" size={20} /><span>{t('No se encontraron skills.')}</span></div>}
      <div className="chat-skills-list">{visibleSkills.map(skill => <SkillCard key={skill.id} skill={skill} surfaces={[surface]} busy={busy} expanded={details === skill.id}
        onToggleDetails={() => setDetails(details === skill.id ? '' : skill.id)}
        meta={skillMeta(skill, imageModel)}
        onEnable={() => toggle(skill)} />)}</div>
      {/* The way to everything this popover no longer does. Hidden in the windows that
          cannot open it — the standalone Nodi overlay does not mount the modal — rather
          than offered there as a button that goes nowhere. */}
      {canOpenSkillMarketplace() && <div className="chat-skills-add"><button type="button" data-testid={`chat-skills-manage-${surface}`} onClick={() => { setOpen(false); openSkillMarketplace(); }}><Icon name="basket" size={14} />{t('Skills y Marketplace')}</button></div>}
      {error && <p className="chat-skill-error" role="alert">{error}</p>}
    </div>)}
  </div>;
}
