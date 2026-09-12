import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { SUPPORTED_SKILL_CAPABILITIES } from '@shared/skillMarketplace';
import { skillHasCapability, type ChatSkill, type ChatSkillSurface } from '@shared/chatSkills';
import { marketplaceLogoSvg } from '@shared/marketplaceLogo';
import { CapabilityPackagesPanel } from './CapabilityPackagesPanel';
import { SkillMarketplacePanel } from './SkillMarketplacePanel';
import { SkillCard, blankSkill, skillMeta, skillSearchText, surfaceLabel, useSkillLibrary } from './skillLibrary';
import { byName } from './skillGlyph';
import { Icon, ModalBackdrop } from './ui';
import { getActiveLang, t, tx } from '../i18n';
import './chatSkills.css';

/** The modal belongs to no chat, so it speaks for every surface at once. */
const SURFACES: readonly ChatSkillSurface[] = ['assistant', 'nodi'];

/**
 * Skills, whole: the catalogue and the library that installing from it fills.
 *
 * This is the counterpart to the per-chat popover, and the split between them is by
 * question rather than by feature. Here you answer "what do I have and what can I get" —
 * install, uninstall, author, import, export, plugin permissions and secrets. In a chat
 * you answer "what is on in THIS conversation", which is a different question and a much
 * shorter list. Before this modal existed both lived in a 420px popover reachable only
 * from a chat, so installing anything meant opening a conversation first.
 *
 * The activation switches are the seam. A popover has one surface and needs no labels; a
 * modal has none, so every skill shows one switch per surface, named.
 */
export function SkillMarketplaceModal({ onClose, initialTab = 'library' }: { onClose: () => void; initialTab?: 'library' | 'marketplace' }) {
  const { skills, accent, error, setError, busy, mutate } = useSkillLibrary();
  const [tab, setTab] = useState(initialTab);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<ChatSkill | null>(null);
  const [details, setDetails] = useState('');
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [exportNotice, setExportNotice] = useState('');
  const [imageModel, setImageModel] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const accentStyle = { '--vault-accent': accent } as CSSProperties;

  useEffect(() => { void window.nodus.getSettings().then(settings => setImageModel(settings.imageModel ? `${settings.imageProvider} · ${settings.imageModel}` : t('Elige un modelo de imagen en Ajustes.'))); }, []);
  useEffect(() => { if (draft) nameRef.current?.focus(); }, [!!draft]);

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
        setDraft({ ...blankSkill(), name: String(value.name ?? ''), description: String(value.description ?? ''), instructions: String(value.instructions ?? '') });
      } else {
        const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
        const field = (name: string) => new RegExp(`^${name}:\\s*(.+)$`, 'm').exec(front?.[1] ?? '')?.[1]?.replace(/^['"]|['"]$/g, '') ?? '';
        setDraft({ ...blankSkill(), name: field('name') || file.name.replace(/\.md$/i, ''), description: field('description'), instructions: text.slice(front?.[0].length ?? 0).trim() });
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const toggle = (skill: ChatSkill, surface: ChatSkillSurface) =>
    void mutate(() => window.nodus.saveChatSkill({ ...skill, enabled: { ...skill.enabled, [surface]: !skill.enabled[surface] } }));

  const terms = skillSearchText(query).trim().split(/\s+/).filter(Boolean);
  // Alphabetical, always: the library is a list you look things up in, and an order that
  // depends on when each skill was installed means hunting for one you know is there.
  const visibleSkills = skills.filter(skill => {
    const text = skillSearchText(`${skill.name} ${skill.description}`);
    return terms.every(term => text.includes(term));
  }).sort(byName(getActiveLang()));

  const title = draft ? (draft.id ? t('Editar skill') : t('Nueva skill')) : t('Skills y Marketplace');

  return <ModalBackdrop onClose={onClose} zIndex={10060}>
    <div style={accentStyle} className="skill-modal-shell" data-testid="skill-marketplace-modal" role="dialog" aria-modal="true" aria-label={t('Skills y Marketplace')}>
      <div className="chat-skills-panel skill-modal" data-nodi-interactive>
        <div className="chat-skills-heading">
          <div className="skill-modal-title">
            {/* Both variants, swapped by the stylesheet, exactly as inside the catalogue:
                which theme this is, is a CSS fact. */}
            <img className="skill-marketplace-logo-dark skill-modal-mark" src={`data:image/svg+xml,${encodeURIComponent(marketplaceLogoSvg(accent))}`} alt="" aria-hidden="true" />
            <img className="skill-marketplace-logo-light skill-modal-mark" src={`data:image/svg+xml,${encodeURIComponent(marketplaceLogoSvg(accent, { plate: false }))}`} alt="" aria-hidden="true" />
            <div>
              <span className="chat-skills-eyebrow">NODUS SKILLS</span>
              <h3>{title}</h3>
              <p className="skill-modal-subtitle">{draft ? t('Describe el método y el resultado esperado. El modelo decide cuándo aplicarlo.') : t('Instala, crea y configura tus skills. Actívalas en cada chat.')}</p>
            </div>
          </div>
          <button type="button" aria-label={t('Cerrar')} onClick={() => { if (draft) setDraft(null); else onClose(); }}><Icon name="x" size={16} /></button>
        </div>

        {!draft && <div className="skill-marketplace-tabs">
          <button type="button" aria-pressed={tab === 'library'} onClick={() => setTab('library')}>{t('Mis skills')}</button>
          <button type="button" aria-pressed={tab === 'marketplace'} onClick={() => setTab('marketplace')}>Marketplace</button>
        </div>}

        {draft ? <form className="chat-skill-editor" onSubmit={event => { event.preventDefault(); void mutate(() => window.nodus.saveChatSkill(draft)).then(saved => { if (saved) { setDraft(null); setQuery(''); } }); }}>
          <label>{t('Nombre de la skill')}<input ref={nameRef} required maxLength={80} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder={t('Mi narrador visual')} /></label>
          <label>{t('Cuándo usarla')}<textarea aria-label={t('Cuándo usarla')} required rows={2} maxLength={500} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} placeholder={t('Usar cuando el usuario necesite…')} /></label>
          <label>{t('Instrucciones')}<textarea aria-label={t('Instrucciones')} required className="chat-skill-prompt" rows={9} maxLength={16000} value={draft.instructions} onChange={event => setDraft({ ...draft, instructions: event.target.value })} placeholder={t('Describe el enfoque, el formato y los criterios de calidad…')} spellCheck={false} /></label>
          <small>{t('Describe el método y el resultado esperado. El modelo decide cuándo aplicarlo.')}</small>
          <div className="skill-author-fields"><label>{t('Nombre de autor')}<input required maxLength={39} value={draft.author ?? 'local'} onChange={e => setDraft({ ...draft, author: e.target.value })} /></label><label>{t('Categoría')}<input required maxLength={60} value={draft.category ?? 'Personal'} onChange={e => setDraft({ ...draft, category: e.target.value })} /></label><label>{t('Versión')}<input required pattern="[0-9]+[.][0-9]+[.][0-9]+" value={draft.version ?? '1.0.0'} onChange={e => setDraft({ ...draft, version: e.target.value })} /></label></div>
          <fieldset><legend>{t('Capacidades nativas')}</legend>{SUPPORTED_SKILL_CAPABILITIES.map(capability => <label key={capability}><input type="checkbox" checked={skillHasCapability(draft, capability)} disabled={draft.builtin ? skillHasCapability(draft, capability) : false} onChange={e => setDraft({ ...draft, capabilities: e.target.checked ? [...(draft.capabilities ?? []), capability] : draft.capabilities?.filter(c => c !== capability) })} />{capability.replace('nodus:', '')}</label>)}</fieldset>
          <details><summary>{tx('Herramientas JavaScript propias ({count})', { count: draft.tools?.length ?? 0 })}</summary><p>{t('Cada entrada es una expresión de función: (input) => resultado JSON. Se ejecuta sin archivos, sin red y sin acceso a la app; cinco segundos como máximo.')}</p>{(draft.tools ?? []).map((tool, index) => <div className="skill-tool-editor" key={index}><label>{t('Identificador de la herramienta')}<input required value={tool.id} onChange={e => setDraft({ ...draft, tools: draft.tools!.map((t, i) => i === index ? { ...t, id: e.target.value } : t) })} /></label><label>{t('Descripción de la herramienta')}<input required maxLength={500} value={tool.description} onChange={e => setDraft({ ...draft, tools: draft.tools!.map((t, i) => i === index ? { ...t, description: e.target.value } : t) })} /></label><label>{t('Función JavaScript')}<textarea aria-label={t('Función JavaScript')} required rows={6} maxLength={64000} spellCheck={false} value={tool.source} onChange={e => setDraft({ ...draft, tools: draft.tools!.map((t, i) => i === index ? { ...t, source: e.target.value } : t) })} /></label><button type="button" onClick={() => setDraft({ ...draft, tools: draft.tools!.filter((_, i) => i !== index) })}>{t('Quitar herramienta')}</button></div>)}<button type="button" disabled={(draft.tools?.length ?? 0) >= 12} onClick={() => setDraft({ ...draft, tools: [...(draft.tools ?? []), { id: `tool-${(draft.tools?.length ?? 0) + 1}`, description: '', source: '(input) => ({ result: input })' }] })}>{t('Añadir herramienta')}</button></details>
          <div className="chat-skill-targets">{SURFACES.map(target => <label key={target}><input type="checkbox" checked={draft.enabled[target]} onChange={event => setDraft({ ...draft, enabled: { ...draft.enabled, [target]: event.target.checked } })} />{surfaceLabel(target)}</label>)}</div>
          <div className="chat-skill-editor-actions">{draft.plugin && <button type="button" disabled={busy} onClick={() => void mutate(() => window.nodus.restorePluginSkillAuthorVersion(draft.id)).then(saved => { if (saved) setDraft(null); })}>{t('Restaurar la versión del autor')}</button>}<button type="button" onClick={() => setDraft(null)}>{t('Cancelar')}</button><button className="chat-skill-primary" type="submit" disabled={busy}>{t('Guardar skill')}</button></div>
        </form> : tab === 'marketplace' ? <div className="skill-modal-body">
          <CapabilityPackagesPanel />
          <SkillMarketplacePanel skills={skills} accent={accent} />
        </div> : <div className="skill-modal-body">
          <p className="chat-skills-intro">{t('Tu biblioteca completa. Cada skill se activa por separado en el asistente y en Nodi.')}</p>
          <div className="chat-skills-search">
            <Icon name="search" size={16} />
            <input ref={searchRef} type="search" aria-label={t('Buscar skills')} placeholder={t('Buscar por nombre o descripción…')} value={query} onChange={event => setQuery(event.target.value)} autoComplete="off" spellCheck={false} />
            {query && <button type="button" aria-label={t('Limpiar búsqueda de skills')} title={t('Limpiar búsqueda de skills')} onClick={() => { setQuery(''); searchRef.current?.focus(); }}><Icon name="x" size={14} /></button>}
          </div>
          {!visibleSkills.length && <div className="chat-skills-empty" role="status"><Icon name="search" size={20} /><span>{t('No se encontraron skills.')}</span></div>}
          <div className="chat-skills-list">{visibleSkills.map(skill => <SkillCard key={skill.id} skill={skill} surfaces={SURFACES} busy={busy} expanded={details === skill.id} manage
            onToggleDetails={() => setDetails(details === skill.id ? '' : skill.id)}
            meta={skillMeta(skill, imageModel)}
            onEnable={surface => toggle(skill, surface)} onEdit={() => setDraft(structuredClone(skill))}
            onExport={() => { void window.nodus.exportSkillPackage(skill.id).then(path => { if (path) setExportNotice(tx('Paquete exportado en {path}', { path })); }).catch(e => setError(String(e))); }}
            onRemove={() => setRemoveId(skill.id)}
            confirm={removeId === skill.id ? { onCancel: () => setRemoveId(null), onConfirm: () => void mutate(() => window.nodus.deleteChatSkill(skill.id)).then(() => setRemoveId(null)) } : undefined} />)}</div>
          <div className="chat-skills-add"><button className="chat-skill-primary" type="button" onClick={() => setDraft(blankSkill())}><Icon name="plus" size={14} />{t('Crear skill')}</button><button type="button" onClick={() => fileRef.current?.click()}><Icon name="upload" size={14} />{t('Importar .md')}</button><input ref={fileRef} type="file" accept=".md,.json" hidden onChange={event => { void importFile(event.target.files?.[0]); event.target.value = ''; }} /></div>
          <button type="button" className="chat-skills-restore" disabled={busy} onClick={() => void mutate(() => window.nodus.importSkillPackage())}>{t('Importar un paquete desde una carpeta')}</button>
          {exportNotice && <p role="status">{exportNotice}</p>}
          <button type="button" className="chat-skills-restore" onClick={() => setConfirmRestore(true)}>{t('Restaurar skills iniciales')}</button>
          {confirmRestore && <div className="chat-skill-confirm"><span>{t('Se restaurarán las instrucciones y la activación de las skills iniciales.')}</span><button type="button" disabled={busy} onClick={() => void mutate(() => window.nodus.restoreChatSkills()).then(() => setConfirmRestore(false))}>{t('Restaurar')}</button><button type="button" onClick={() => setConfirmRestore(false)}>{t('Cancelar')}</button></div>}
        </div>}
        {error && <p className="chat-skill-error" role="alert">{error}</p>}
      </div>
    </div>
  </ModalBackdrop>;
}
