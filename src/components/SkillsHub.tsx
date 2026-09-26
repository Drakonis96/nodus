import { useEffect, useRef, useState } from 'react';
import { DEFAULT_SKILL_SOURCE, SUPPORTED_SKILL_CAPABILITIES, isOfficialSkillSource, type SkillMarketplace } from '@shared/skillMarketplace';
import { onEverySurface, skillActive, skillHasCapability, type ChatSkill, type ChatSkillSurface } from '@shared/chatSkills';
import { SkillMarketplacePanel } from './SkillMarketplacePanel';
import { SkillCard, blankSkill, skillMeta, skillSearchText, useSkillLibrary } from './skillLibrary';
import { byName } from './skillGlyph';
import { Icon } from './ui';
import { getActiveLang, t, tx } from '../i18n';
import './chatSkills.css';

export type SkillsHubTab = 'library' | 'marketplace' | 'repos' | 'create';
/** A skill is on or off everywhere, so the library shows one switch. */
const ONE_SWITCH: readonly ChatSkillSurface[] = ['assistant'];
const TABS: Array<{ id: SkillsHubTab; icon: string; label: string }> = [
  { id: 'library', icon: 'sparkles', label: 'Mis skills' },
  { id: 'marketplace', icon: 'basket', label: 'Marketplace' },
  { id: 'repos', icon: 'gitPr', label: 'Repositorios' },
  { id: 'create', icon: 'plus', label: 'Crear' },
];

/**
 * Skills, whole, in four tabs: the library you have, the catalogue you can install from,
 * the repositories that catalogue reads, and a form to write your own. The same component
 * fills the chat header balloon and the Skills modal, so both say the same thing.
 */
export function SkillsHub({ initialTab = 'library' }: { initialTab?: SkillsHubTab }) {
  const library = useSkillLibrary();
  const [tab, setTab] = useState<SkillsHubTab>(initialTab);
  const [draft, setDraft] = useState<ChatSkill>(() => ({ ...blankSkill(), enabled: onEverySurface(true) }));
  const edit = (skill: ChatSkill) => { setDraft(structuredClone(skill)); setTab('create'); };
  const fresh = () => ({ ...blankSkill(), enabled: onEverySurface(true) });
  return <div className="skills-hub" data-testid="skills-hub">
    <div className="header-balloon-tabs skills-hub-tabs" role="tablist" aria-label={t('Skills')}>
      {TABS.map(item => {
        const label = item.id === 'create' && draft.id ? t('Editar skill') : t(item.label);
        return <button key={item.id} type="button" role="tab" id={`skills-hub-tab-${item.id}`} aria-controls={`skills-hub-panel-${item.id}`}
          aria-selected={tab === item.id} aria-label={label} title={label} data-testid={`skills-hub-tab-${item.id}`} className="header-balloon-tab"
          onClick={() => { if (item.id === 'create' && tab !== 'create') setDraft(current => current.id ? current : fresh()); setTab(item.id); }}>
          <Icon name={item.id === 'create' && draft.id ? 'edit' : item.icon} size={16} />{tab === item.id && <span>{label}</span>}
        </button>;
      })}
    </div>
    <div className="skills-hub-panel" role="tabpanel" id={`skills-hub-panel-${tab}`} aria-labelledby={`skills-hub-tab-${tab}`}>
      {tab === 'library' && <LibraryTab library={library} onEdit={edit} onImported={skill => { setDraft(skill); setTab('create'); }} />}
      {tab === 'marketplace' && <SkillMarketplacePanel skills={library.skills} accent={library.accent} manageSources={false} />}
      {tab === 'repos' && <RepositoriesTab />}
      {tab === 'create' && <CreateTab library={library} draft={draft} setDraft={setDraft}
        onDone={() => { setDraft(fresh()); setTab('library'); }} />}
      {library.error && <p className="chat-skill-error" role="alert">{library.error}</p>}
    </div>
  </div>;
}

type Library = ReturnType<typeof useSkillLibrary>;

function LibraryTab({ library, onEdit, onImported }: { library: Library; onEdit: (skill: ChatSkill) => void; onImported: (skill: ChatSkill) => void }) {
  const { skills, busy, mutate, setError } = library;
  const [query, setQuery] = useState('');
  const [details, setDetails] = useState('');
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [notice, setNotice] = useState('');
  const [imageModel, setImageModel] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { void window.nodus.getSettings().then(settings => setImageModel(settings.imageModel ? `${settings.imageProvider} · ${settings.imageModel}` : t('Elige un modelo de imagen en Ajustes.'))); }, []);
  const terms = skillSearchText(query).trim().split(/\s+/).filter(Boolean);
  const visible = skills.filter(skill => terms.every(term => skillSearchText(`${skill.name} ${skill.description}`).includes(term))).sort(byName(getActiveLang()));
  const toggle = (skill: ChatSkill) => void mutate(() => window.nodus.saveChatSkill({ ...skill, enabled: onEverySurface(!skillActive(skill)) }));
  const importFile = async (file?: File) => {
    if (!file) return;
    setError('');
    try {
      if (file.size > 40_000) throw new Error(t('El archivo es demasiado grande. Máximo 40 KB.'));
      const text = await file.text();
      const base = { ...blankSkill(), enabled: onEverySurface(true) };
      if (file.name.toLowerCase().endsWith('.json')) {
        let value;
        try { value = JSON.parse(text); } catch { throw new Error(t('El archivo JSON de la skill no es válido.')); }
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(t('El archivo JSON de la skill no es válido.'));
        onImported({ ...base, name: String(value.name ?? ''), description: String(value.description ?? ''), instructions: String(value.instructions ?? '') });
      } else {
        const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
        const field = (name: string) => new RegExp(`^${name}:\\s*(.+)$`, 'm').exec(front?.[1] ?? '')?.[1]?.replace(/^['"]|['"]$/g, '') ?? '';
        onImported({ ...base, name: field('name') || file.name.replace(/\.md$/i, ''), description: field('description'), instructions: text.slice(front?.[0].length ?? 0).trim() });
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return <>
    <p className="header-balloon-intro">{t('Una skill activa está disponible en el asistente, en Nodi y en los demás chats.')}</p>
    <label className="header-balloon-search"><Icon name="search" size={14} /><input type="search" aria-label={t('Buscar skills')} placeholder={t('Buscar por nombre o descripción…')} value={query} onChange={event => setQuery(event.target.value)} autoComplete="off" spellCheck={false} /></label>
    {!visible.length && <div className="chat-skills-empty" role="status"><Icon name="search" size={20} /><span>{t('No se encontraron skills.')}</span></div>}
    <div className="chat-skills-list">{visible.map(skill => <SkillCard key={skill.id} skill={{ ...skill, enabled: onEverySurface(skillActive(skill)) }} surfaces={ONE_SWITCH} busy={busy}
      expanded={details === skill.id} manage meta={skillMeta(skill, imageModel)}
      onToggleDetails={() => setDetails(details === skill.id ? '' : skill.id)}
      onEnable={() => toggle(skill)} onEdit={() => onEdit(skill)}
      onExport={() => { void window.nodus.exportSkillPackage(skill.id).then(path => { if (path) setNotice(tx('Paquete exportado en {path}', { path })); }).catch(e => setError(String(e))); }}
      onRemove={() => setRemoveId(skill.id)}
      confirm={removeId === skill.id ? { onCancel: () => setRemoveId(null), onConfirm: () => void mutate(() => window.nodus.deleteChatSkill(skill.id)).then(() => setRemoveId(null)) } : undefined} />)}</div>
    <div className="skills-hub-actions">
      <button type="button" onClick={() => fileRef.current?.click()}><Icon name="upload" size={14} />{t('Importar .md')}</button>
      <button type="button" disabled={busy} onClick={() => void mutate(() => window.nodus.importSkillPackage())}><Icon name="folder" size={14} />{t('Importar un paquete desde una carpeta')}</button>
      <button type="button" onClick={() => setConfirmRestore(true)}><Icon name="refresh" size={14} />{t('Restaurar skills iniciales')}</button>
      <input ref={fileRef} type="file" accept=".md,.json" hidden onChange={event => { void importFile(event.target.files?.[0]); event.target.value = ''; }} />
    </div>
    {notice && <p role="status" className="skills-hub-notice">{notice}</p>}
    {confirmRestore && <div className="chat-skill-confirm"><span>{t('Se restaurarán las instrucciones y la activación de las skills iniciales.')}</span><button type="button" disabled={busy} onClick={() => void mutate(() => window.nodus.restoreChatSkills()).then(() => setConfirmRestore(false))}>{t('Restaurar')}</button><button type="button" onClick={() => setConfirmRestore(false)}>{t('Cancelar')}</button></div>}
  </>;
}

/** The repositories the catalogue reads: add, edit, refresh and remove them here. */
function RepositoriesTab() {
  const [state, setState] = useState<SkillMarketplace>({ version: 1, sources: [] });
  const [url, setUrl] = useState('');
  const [editing, setEditing] = useState<{ id: string; url: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let alive = true;
    const refresh = () => void window.nodus.getSkillMarketplace().then(value => { if (alive) setState(value); }).catch(e => { if (alive) setError(String(e)); });
    refresh();
    const off = window.nodus.onChatSkillsChanged(refresh);
    return () => { alive = false; off(); };
  }, []);
  const run = async (id: string, action: () => Promise<unknown>, success = '') => {
    setBusy(id); setError(''); setNotice('');
    try { await action(); if (success) setNotice(success); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  };
  const hasOfficial = state.sources.some(source => isOfficialSkillSource(source.url));
  return <>
    <p className="header-balloon-intro">{t('De aquí lee el Marketplace. Las skills instaladas no cambian al actualizar o quitar un repositorio.')}</p>
    <div role="list" aria-label={t('Repositorios')}>
      {state.sources.map(source => {
        const official = isOfficialSkillSource(source.url);
        const count = source.entries.length + (source.plugins?.length ?? 0);
        return <div key={source.id} role="listitem" className="header-balloon-row skills-hub-repo" data-testid={`skills-repo-${source.id}`}>
          <span className="header-balloon-row-icon"><Icon name={official ? 'shield' : 'gitPr'} size={15} /></span>
          {editing?.id === source.id
            ? <form className="skills-hub-repo-edit" onSubmit={event => { event.preventDefault(); const next = editing.url.trim(); void run(source.id, async () => {
                // Add the new address first, so a mistyped one never leaves the list without the old.
                await window.nodus.addSkillSource(next);
                setState(await window.nodus.removeSkillSource(source.id));
                setEditing(null);
              }, t('Repositorio actualizado.')); }}>
                <input aria-label={t('URL del repositorio')} type="url" required autoFocus value={editing.url} onChange={event => setEditing({ id: source.id, url: event.target.value })} />
                <button type="submit" className="header-balloon-chip is-on" disabled={!!busy || !editing.url.trim() || editing.url.trim() === source.url}>{t('Guardar')}</button>
                <button type="button" className="header-balloon-icon-button" aria-label={t('Cancelar')} title={t('Cancelar')} onClick={() => setEditing(null)}><Icon name="x" size={14} /></button>
              </form>
            : <>
              <span className="header-balloon-row-text"><strong>{source.id}</strong>
                <small>{official ? t('Repositorio oficial de Nodus') : t('Fuente comunitaria · no revisada por Nodus')} · {source.updatedAt ? tx('Actualizado el {date}', { date: new Date(source.updatedAt).toLocaleDateString() }) : t('Sin actualizar')}{source.updatedAt ? ` · ${tx('{n} paquetes', { n: count })}` : ''}{source.errors.length ? ` · ${tx('{count} paquetes no válidos omitidos', { count: source.errors.length })}` : ''}</small></span>
              <button type="button" className="header-balloon-icon-button" disabled={!!busy} aria-label={`${t('Actualizar catálogo')}: ${source.id}`} title={t('Actualizar catálogo')}
                onClick={() => void run(source.id, async () => setState(await window.nodus.updateSkillSource(source.id)), t('Catálogo actualizado. Las skills instaladas no cambian.'))}><Icon name="refresh" size={15} className={busy === source.id ? 'animate-spin' : ''} /></button>
              {!official && <button type="button" className="header-balloon-icon-button" disabled={!!busy} aria-label={`${t('Editar')}: ${source.id}`} title={t('Editar')} onClick={() => setEditing({ id: source.id, url: source.url })}><Icon name="edit" size={15} /></button>}
              {!official && <button type="button" className="header-balloon-icon-button" disabled={!!busy} aria-label={`${t('Quitar fuente')}: ${source.id}`} title={t('Quitar fuente')} onClick={() => setRemoving(source.id)}><Icon name="trash" size={15} /></button>}
            </>}
        </div>;
      })}
    </div>
    {removing && <div className="chat-skill-confirm"><span>{tx('¿Quitar {name}? Las skills instaladas desde él siguen disponibles.', { name: removing })}</span>
      <button type="button" disabled={!!busy} onClick={() => void run(removing, async () => { setState(await window.nodus.removeSkillSource(removing)); setRemoving(null); }, t('Repositorio eliminado. Las skills instaladas siguen disponibles.'))}>{t('Quitar')}</button>
      <button type="button" onClick={() => setRemoving(null)}>{t('Cancelar')}</button></div>}
    <form className="skills-hub-repo-add" onSubmit={event => { event.preventDefault(); void run('add', async () => { setState(await window.nodus.addSkillSource(url.trim())); setUrl(''); }, t('Repositorio añadido. Actualízalo para cargar su catálogo.')); }}>
      <label className="skills-hub-field">{t('Añadir un repositorio')}
        <span><input aria-label={t('URL del repositorio')} type="url" required placeholder="https://github.com/owner/repository" value={url} onChange={event => setUrl(event.target.value)} />
          <button type="submit" className="header-balloon-chip is-on" disabled={!!busy || !url.trim()}><Icon name="plus" size={13} />{t('Añadir')}</button></span>
      </label>
    </form>
    {hasOfficial && <div className="skills-hub-actions">
      <button type="button" disabled={!!busy} onClick={() => void run('catalog', () => window.nodus.refreshCapabilityCatalog(DEFAULT_SKILL_SOURCE), t('Catálogo actualizado.'))}><Icon name="refresh" size={14} />{t('Actualizar extensiones')}</button>
      <button type="button" disabled={!!busy} onClick={() => void run('updates', async () => {
        const results = await window.nodus.checkCapabilityUpdates();
        setNotice(results.some(result => result.state === 'awaiting-approval') ? t('Hay una actualización esperando a que apruebes sus permisos.') : t('Todo está al día.'));
      })}><Icon name="download" size={14} />{t('Buscar actualizaciones')}</button>
    </div>}
    {notice && <p role="status" className="skills-hub-notice">{notice}</p>}
    {error && <p className="chat-skill-error" role="alert">{error}</p>}
  </>;
}

/** Writing a skill: what it is for, how to do it, and what it may use. */
function CreateTab({ library, draft, setDraft, onDone }: { library: Library; draft: ChatSkill; setDraft: (skill: ChatSkill) => void; onDone: () => void }) {
  const { busy, mutate } = library;
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { nameRef.current?.focus(); }, [draft.id]);
  return <form className="chat-skill-editor skills-hub-editor" data-testid="skills-hub-editor" onSubmit={event => { event.preventDefault(); void mutate(() => window.nodus.saveChatSkill(draft)).then(saved => { if (saved) onDone(); }); }}>
    <p className="header-balloon-intro">{draft.id ? t('Cambia su método o su alcance. Se aplica en todos los chats.') : t('Describe el método y el resultado esperado. El modelo decide cuándo aplicarlo.')}</p>
    <label>{t('Nombre de la skill')}<input ref={nameRef} required maxLength={80} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder={t('Mi narrador visual')} /></label>
    <label>{t('Cuándo usarla')}<textarea aria-label={t('Cuándo usarla')} required rows={2} maxLength={500} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} placeholder={t('Usar cuando el usuario necesite…')} /></label>
    <label>{t('Instrucciones')}<textarea aria-label={t('Instrucciones')} required className="chat-skill-prompt" rows={8} maxLength={16000} value={draft.instructions} onChange={event => setDraft({ ...draft, instructions: event.target.value })} placeholder={t('Describe el enfoque, el formato y los criterios de calidad…')} spellCheck={false} /></label>
    <details className="skills-hub-more"><summary>{t('Más opciones')}</summary>
      <div className="skill-author-fields"><label>{t('Nombre de autor')}<input required maxLength={39} value={draft.author ?? 'local'} onChange={e => setDraft({ ...draft, author: e.target.value })} /></label><label>{t('Categoría')}<input required maxLength={60} value={draft.category ?? 'Personal'} onChange={e => setDraft({ ...draft, category: e.target.value })} /></label><label>{t('Versión')}<input required pattern="[0-9]+[.][0-9]+[.][0-9]+" value={draft.version ?? '1.0.0'} onChange={e => setDraft({ ...draft, version: e.target.value })} /></label></div>
      <fieldset><legend>{t('Capacidades nativas')}</legend>{SUPPORTED_SKILL_CAPABILITIES.map(capability => <label key={capability}><input type="checkbox" checked={skillHasCapability(draft, capability)} disabled={draft.builtin ? skillHasCapability(draft, capability) : false} onChange={e => setDraft({ ...draft, capabilities: e.target.checked ? [...(draft.capabilities ?? []), capability] : draft.capabilities?.filter(c => c !== capability) })} />{capability.replace('nodus:', '')}</label>)}</fieldset>
      <details><summary>{tx('Herramientas JavaScript propias ({count})', { count: draft.tools?.length ?? 0 })}</summary><p>{t('Cada entrada es una expresión de función: (input) => resultado JSON. Se ejecuta sin archivos, sin red y sin acceso a la app; cinco segundos como máximo.')}</p>{(draft.tools ?? []).map((tool, index) => <div className="skill-tool-editor" key={index}><label>{t('Identificador de la herramienta')}<input required value={tool.id} onChange={e => setDraft({ ...draft, tools: draft.tools!.map((item, i) => i === index ? { ...item, id: e.target.value } : item) })} /></label><label>{t('Descripción de la herramienta')}<input required maxLength={500} value={tool.description} onChange={e => setDraft({ ...draft, tools: draft.tools!.map((item, i) => i === index ? { ...item, description: e.target.value } : item) })} /></label><label>{t('Función JavaScript')}<textarea aria-label={t('Función JavaScript')} required rows={6} maxLength={64000} spellCheck={false} value={tool.source} onChange={e => setDraft({ ...draft, tools: draft.tools!.map((item, i) => i === index ? { ...item, source: e.target.value } : item) })} /></label><button type="button" onClick={() => setDraft({ ...draft, tools: draft.tools!.filter((_, i) => i !== index) })}>{t('Quitar herramienta')}</button></div>)}<button type="button" disabled={(draft.tools?.length ?? 0) >= 12} onClick={() => setDraft({ ...draft, tools: [...(draft.tools ?? []), { id: `tool-${(draft.tools?.length ?? 0) + 1}`, description: '', source: '(input) => ({ result: input })' }] })}>{t('Añadir herramienta')}</button></details>
    </details>
    <div className="chat-skill-editor-actions">
      {draft.plugin && <button type="button" disabled={busy} onClick={() => void mutate(() => window.nodus.restorePluginSkillAuthorVersion(draft.id)).then(saved => { if (saved) onDone(); })}>{t('Restaurar la versión del autor')}</button>}
      <button type="button" onClick={onDone}>{t('Cancelar')}</button>
      <button className="chat-skill-primary" type="submit" disabled={busy}>{draft.id ? t('Guardar skill') : t('Crear skill')}</button>
    </div>
  </form>;
}
