import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { BUILTIN_SKILL_PACKAGES, type ChatSkill } from '@shared/chatSkills';
import { unsupportedSkillCapabilities, DEFAULT_SKILL_SOURCE, isOfficialSkillSource, type MarketplaceEntry, type PluginMarketplaceEntry, type SkillManifest, type SkillMarketplace } from '@shared/skillMarketplace';
import { compareSemver } from '../../skill-capabilities/contracts';
import type { CapabilityPermissionSet, InboxPluginSummary, InstalledPluginSummary } from '../../skill-capabilities/contracts';
import type { CapabilityListPayload, InstalledCapabilityPlugin } from '@shared/capabilities';
import { marketplaceLogoSvg } from '@shared/marketplaceLogo';
import { Icon } from './ui';
import { skillGlyph } from './skillGlyph';
import { MigrationBanner, PackageActions, PackageFacts, PermissionReview, SettingsForm, type PendingReview } from './CapabilityPackagesPanel';
import { getActiveLang, t, tx } from '../i18n';

type InstalledFilter = 'all' | 'installed' | 'available';

function PluginSecretForm({ plugin, secret, refresh }: { plugin: InstalledPluginSummary; secret: InstalledPluginSummary['secrets'][number]; refresh: () => Promise<void> }) {
  const [value, setValue] = useState('');
  return <form onSubmit={event => { event.preventDefault(); void window.nodus.configurePluginSecret(plugin.id, secret.capabilityId, secret.id, value).then(() => { setValue(''); return refresh(); }); }}><label>{secret.label}{secret.required ? ` (${t('Necesaria')})` : ''}<input type="password" value={value} placeholder={secret.configured ? t('Configurada') : t('Sin configurar')} onChange={event => setValue(event.target.value)} /></label><button type="submit">{secret.configured ? t('Sustituir') : t('Guardar')}</button>{secret.configured && <button type="button" onClick={() => void window.nodus.configurePluginSecret(plugin.id, secret.capabilityId, secret.id, '').then(refresh)}>{t('Limpiar')}</button>}</form>;
}

interface PluginPermissionPrompt {
  kind: 'catalog' | 'inbox';
  name: string;
  version: string;
  description: string;
  update: boolean;
  permissions: CapabilityPermissionSet;
  entry?: PluginMarketplaceEntry;
  inbox?: InboxPluginSummary;
}

/** Sandboxed plugins use the same two-step consent contract as signed packages: the
 * catalogue card can explain the item, but only this second modal may grant permissions. */
function PluginPermissionReview({ prompt, busy, onAllow, onClose }: {
  prompt: PluginPermissionPrompt;
  busy: boolean;
  onAllow: () => void;
  onClose: () => void;
}) {
  const networks = prompt.permissions.network ?? [];
  const secrets = prompt.permissions.secrets ?? [];
  const storage = prompt.permissions.storage?.maxBytes ?? 0;
  return <div className="capability-permission-backdrop" role="presentation" onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="capability-permission-review" role="dialog" aria-modal="true" aria-label={tx('Permisos de {name}', { name: prompt.name })}>
      <h4>{prompt.update ? t('Esta actualización pide permisos nuevos') : t('Esta skill necesita permisos')}</h4>
      <p className="capability-packages-muted"><b>{prompt.name}</b> · {prompt.version}</p>
      <p className="capability-packages-muted">{prompt.description}</p>
      <p className="capability-packages-muted">{t('Revisa el acceso de abajo. No se instala ni actualiza nada hasta que lo permitas aquí.')}</p>
      <dl className="capability-permission-list">
        <div><dt>{t('Conexiones HTTPS')}</dt><dd>{networks.length ? networks.map(endpoint => endpoint.origin).join(', ') : t('Ninguno')}</dd></div>
        <div><dt>{t('Credenciales')}</dt><dd>{secrets.length ? secrets.map(secret => secret.label).join(', ') : t('Ninguno')}</dd></div>
        <div><dt>{t('Almacenamiento')}</dt><dd>{storage ? tx('{size} bytes', { size: storage }) : t('Ninguno')}</dd></div>
      </dl>
      <p className="capability-packages-muted">{t('El código de la capacidad se ejecuta en un entorno aislado. Nodus solo intermedia el acceso indicado arriba.')}</p>
      <div className="capability-permission-actions">
        <button className="chat-skill-primary" type="button" disabled={busy} onClick={onAllow}>{prompt.update ? t('Permitir y actualizar') : t('Permitir e instalar')}</button>
        <button type="button" className="chat-skill-secondary" disabled={busy} onClick={onClose}>{t('Cancelar')}</button>
      </div>
    </div>
  </div>;
}

const localized = (text: { en: string; [locale: string]: string }) => text[getActiveLang()] ?? text[getActiveLang().split('-')[0]] ?? text.en;

function pluginPermissions(entry: PluginMarketplaceEntry): CapabilityPermissionSet {
  const capabilities = entry.package.manifest.capabilities.map(file => JSON.parse(entry.package.files[file]));
  return {
    network: capabilities.flatMap(capability => capability.permissions?.network ?? []),
    secrets: capabilities.flatMap(capability => capability.permissions?.secrets ?? []),
    ...(capabilities.some(capability => capability.permissions?.storage)
      ? { storage: { maxBytes: capabilities.reduce((sum, capability) => sum + (capability.permissions?.storage?.maxBytes ?? 0), 0) } }
      : {}),
  };
}

function MarketplaceCard({ cardKey, name, description, author, category, installed, open, onToggle, children }: {
  cardKey: string;
  name: string;
  description: string;
  author: string;
  category: string;
  installed: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const glyph = skillGlyph({ packageId: cardKey, name, description, category });
  return <article className={`chat-skill-item ${installed ? 'installed' : ''} ${open ? 'open' : ''}`} style={{ '--skill-hue': glyph.hue } as CSSProperties}>
    <div className="chat-skill-main">
      <span className="chat-skill-symbol" aria-hidden="true"><Icon name={glyph.icon} size={18} /></span>
      <div className="chat-skill-text">
        <span className="chat-skill-heading"><b>{name}</b>{installed && <span className="chat-skill-tool-badge">{t('Instalada')}</span>}</span>
        <p>{description}</p>
      </div>
      <button type="button" className="chat-skill-details-toggle" aria-expanded={open}
        aria-label={`${t(open ? 'Ocultar detalles de' : 'Ver detalles de')} ${name}`}
        title={t(open ? 'Ocultar detalles' : 'Ver detalles')} onClick={onToggle}>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={14} />
      </button>
    </div>
    {open && <div className="chat-skill-details">
      <p>{description}</p>
      <small>{author} · {category}</small>
    </div>}
    {children}
  </article>;
}

/** `manageSources` false leaves repository management to the Repositories tab: the catalogue
 * only chooses which repository to browse. */
export function SkillMarketplacePanel({ skills, accent, manageSources = true }: { skills: ChatSkill[]; accent: string; manageSources?: boolean }) {
  const [state, setState] = useState<SkillMarketplace>({ version: 1, sources: [] });
  const [sourceId, setSourceId] = useState('');
  const [url, setUrl] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [filter, setFilter] = useState<InstalledFilter>('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [removeId, setRemoveId] = useState('');
  const [review, setReview] = useState<MarketplaceEntry | null>(null);
  const [pluginReview, setPluginReview] = useState<PluginPermissionPrompt | null>(null);
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPluginSummary[]>([]);
  const [inboxPlugins, setInboxPlugins] = useState<InboxPluginSummary[]>([]);
  const [appVersion, setAppVersion] = useState('');
  const [capabilities, setCapabilities] = useState<CapabilityListPayload | null>(null);
  const [capabilityBusy, setCapabilityBusy] = useState('');
  const [capabilityReview, setCapabilityReview] = useState<PendingReview | null>(null);
  // One card's details at a time, like the library.
  const [details, setDetails] = useState('');
  useEffect(() => {
    let alive = true;
    const refresh = () => { void window.nodus.getSkillMarketplace().then(value => { if (alive) setState(value); }).catch(e => { if (alive) setError(String(e)); }); void window.nodus.listInstalledPlugins().then(value => { if (alive) setInstalledPlugins(value); }).catch(() => undefined); void window.nodus.listInboxPlugins().then(value => { if (alive) setInboxPlugins(value); }).catch(() => undefined); };
    void window.nodus.getAppInfo().then(info => { if (alive) setAppVersion(info.version); }).catch(() => undefined);
    const refreshPackages = () => void window.nodus.listCapabilities()
      .then(value => { if (alive) setCapabilities(value); })
      .catch(() => undefined);
    refreshPackages();
    refresh(); const off = window.nodus.onChatSkillsChanged(refresh);
    const offPackages = window.nodus.onCapabilityRegistryChanged(refreshPackages);
    return () => { alive = false; off(); offPackages(); };
  }, []);
  const source = state.sources.find(s => s.id === sourceId) ?? state.sources[0];
  useEffect(() => { setReview(null); setPluginReview(null); setCategory(''); setFilter('all'); setRemoveId(''); }, [source?.id, source?.commit]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const official = !!source && isOfficialSkillSource(source.url);
  // The official catalog publishes this build's own built-ins, so a listed package can already be
  // part of Nodus. A community source reusing the identifier is a different, downloadable skill.
  const builtinId = (manifest: SkillManifest) => official ? BUILTIN_SKILL_PACKAGES[manifest.id] : undefined;
  // A profile from an earlier build can hold both the built-in and a downloaded copy of the same
  // official package, so one catalog entry is uninstalled as a unit rather than one skill at a time.
  const installedSkills = (manifest: SkillManifest) => skills.filter(s => (s.origin?.sourceId === source?.id && s.origin.packageId === manifest.id)
    || (!!builtinId(manifest) && s.id === builtinId(manifest)));
  const uninstall = (targets: ChatSkill[]) => run(async () => {
    for (const skill of targets) await window.nodus.deleteChatSkill(skill.id);
    setRemoveId('');
    setNotice(targets.some(skill => skill.builtin) ? t('Skill desinstalada. Sus capacidades nativas permanecen en Nodus y vuelven con la skill.') : t('Skill desinstalada. Vuelve a instalarla aquí cuando quieras.'));
  });
  const confirmText = (name: string, targets: ChatSkill[], included: boolean) => included
    ? targets.length > 1
      ? tx('¿Desinstalar {name} y {count} copia(s) instalada(s) desde este repositorio? Sus capacidades nativas permanecen en Nodus.', { name, count: targets.length - 1 })
      : tx('¿Desinstalar {name}? Sus capacidades nativas permanecen en Nodus.', { name })
    : tx('¿Desinstalar {name} y sus ediciones locales?', { name });
  const install = (entry: MarketplaceEntry) => run(async () => {
    await window.nodus.installMarketplaceSkill(source!.id, entry.path, source!.commit!);
    setReview(null);
    setNotice(builtinId(entry.package.manifest) ? t('Skill incluida restaurada. Comprueba su activación en Mis skills.') : t('Skill instalada. Actívala en Mis skills.'));
  });
  // A plugin the repository offers and the same plugin already installed are one card in
  // two states. Anything installed that this repository no longer lists still gets a card:
  // it simply has no update to review.
  const pluginCards = [
    ...(source?.plugins ?? []).map(entry => {
      const manifest = entry.package.manifest;
      return { id: manifest.id, name: manifest.name, by: manifest.author, description: manifest.description, entry, installed: installedPlugins.find(plugin => plugin.id === manifest.id) };
    }),
    // Installed but absent from this repository's catalogue: there is no manifest to read an
    // author from, so the card says where it came from instead of inventing one.
    ...installedPlugins
      .filter(plugin => !(source?.plugins ?? []).some(entry => entry.package.manifest.id === plugin.id))
      .map(plugin => ({ id: plugin.id, name: plugin.name, by: plugin.sourceId, description: plugin.description, entry: undefined, installed: plugin })),
  ];

  const capabilityPackageIds = new Set([
    ...(capabilities?.catalog?.catalog.plugins ?? []).map(plugin => plugin.id),
    ...(capabilities?.plugins ?? []).map(plugin => plugin.id),
  ]);
  // The v1 catalogue can still contain the skill half of a signed v2 package. It becomes
  // one unified card below, never a second entry with an Install button that does half a job.
  const catalogued = (source?.entries ?? []).filter(entry => !(official && capabilityPackageIds.has(entry.package.manifest.id)));
  const installedCapabilityPackages = new Map((capabilities?.plugins ?? []).map(plugin => [plugin.id, plugin]));
  const capabilityEntries = capabilities?.catalog?.catalog.plugins ?? [];

  const unifiedCards = [
    ...catalogued.map(entry => {
      const manifest = entry.package.manifest;
      return { kind: 'skill' as const, key: `skill:${entry.path}`, name: manifest.name, description: manifest.description,
        author: manifest.author, category: manifest.category, installed: !!installedSkills(manifest).length, entry };
    }),
    ...pluginCards.map(card => ({ kind: 'plugin' as const, key: `plugin:${card.id}`, name: card.name,
      description: card.description, author: card.by, category: t('Extensiones'), installed: !!card.installed?.activeVersion, card })),
    ...capabilityEntries.map(entry => ({ kind: 'package' as const, key: `package:${entry.id}`, name: entry.name,
      description: localized(entry.description), author: 'NodusResearch', category: t('Extensiones'),
      installed: !!installedCapabilityPackages.get(entry.id)?.active, entry })),
    ...inboxPlugins.map(item => ({ kind: 'inbox' as const, key: `inbox:${item.directory}`, name: item.name,
      description: item.description, author: item.author, category: t('Extensiones'), installed: item.installed, item })),
  ];
  const categories = [...new Set(unifiedCards.map(card => card.category))]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
  const matchingCards = unifiedCards.filter(card => (!category || card.category === category)
    && (filter === 'all' || (filter === 'installed') === card.installed)
    && `${card.name} ${card.description} ${card.author} ${card.category}`.toLowerCase().includes(query.toLowerCase()));
  const entries = matchingCards.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
  const installedCount = unifiedCards.filter(card => card.installed).length;
  const counts: Record<InstalledFilter, number> = { all: unifiedCards.length, installed: installedCount, available: unifiedCards.length - installedCount };
  const manifest = review?.package.manifest;
  const builtin = manifest ? builtinId(manifest) : undefined;
  // A built-in is restored from this build, so a capability no package may declare is never a blocker.
  const unsupported = builtin ? [] : unsupportedSkillCapabilities(manifest?.capabilities ?? []);
  const installed = manifest ? installedSkills(manifest) : [];
  const refreshCapabilities = () => void window.nodus.listCapabilities().then(setCapabilities).catch(value => setError(value instanceof Error ? value.message : String(value)));
  const runCapability = async (id: string, action: () => Promise<unknown>, success = '') => {
    setCapabilityBusy(id); setError(''); setNotice('');
    try { await action(); if (success) setNotice(success); refreshCapabilities(); }
    catch (thrown) { setError(thrown instanceof Error ? thrown.message : String(thrown)); }
    finally { setCapabilityBusy(''); }
  };
  const installCapability = (entry: { id: string; name: string; version: string }, success: string) => runCapability(entry.id, async () => {
    const result = await window.nodus.installCapabilityPlugin(entry.id, false);
    if (result.activated) { setNotice(success); return; }
    if (result.state?.pending?.reason === 'permissions') {
      setCapabilityReview({ id: entry.id, name: entry.name, version: result.state.pending.version,
        update: Boolean(result.state.active), permissions: result.pendingPermissions });
      return;
    }
    setNotice(`${entry.name}: ${result.state?.status ?? ''}`);
  });
  const openCapabilityReview = (entry: { id: string; name: string }, state: InstalledCapabilityPlugin) => setCapabilityReview({
    id: entry.id, name: entry.name, version: state.pending?.version ?? '', update: Boolean(state.active), permissions: state.pendingPermissions ?? null,
  });
  return <div className="skill-marketplace" aria-label={t('Marketplace de Skills')}>
    {/* Both variants, swapped by the stylesheet: which theme this panel is in is a CSS
        fact here — it is rendered into a portal that carries the class — and asking
        JavaScript for it would mean re-asking every time the theme changed. */}
    <div className="skill-marketplace-brand">
      <img className="skill-marketplace-logo-dark" src={`data:image/svg+xml,${encodeURIComponent(marketplaceLogoSvg(accent))}`} data-testid="marketplace-logo" alt={t('Marketplace de Nodus')} />
      <img className="skill-marketplace-logo-light" src={`data:image/svg+xml,${encodeURIComponent(marketplaceLogoSvg(accent, { plate: false }))}`} alt="" aria-hidden="true" />
      <div><b>{t('Descubre tu próxima skill')}</b><p>{t('Métodos y herramientas, hechos por la comunidad.')}</p></div>
    </div>
    {/* Where the skills come from, folded away. It is answered once and then rarely asked
        again, and open by default it put five controls between the reader and the first
        skill. The line stays visible, so which repository this is never becomes a mystery. */}
    {!manageSources && <div className="skill-marketplace-source-pick">
      <span>{official ? t('Repositorio oficial de Nodus') : t('Fuente comunitaria · no revisada por Nodus')}</span>
      {state.sources.length > 1 && <select aria-label={t('Repositorio de skills')} value={source?.id ?? ''} disabled={busy} onChange={e => setSourceId(e.target.value)}>{state.sources.map(s => <option key={s.id} value={s.id}>{s.id}</option>)}</select>}
    </div>}
    {manageSources && <details className="skill-marketplace-sources">
      <summary>
        <span>{official ? t('Repositorio oficial de Nodus') : t('Fuente comunitaria · no revisada por Nodus')}{source?.updatedAt ? tx(' · Actualizado el {date}', { date: new Date(source.updatedAt).toLocaleDateString() }) : source ? t(' · Actualiza para descubrir skills') : ''}</span>
        <span className="skill-marketplace-sources-hint">{t('Repositorios')}</span>
      </summary>
      <label>{t('Repositorio')}<select aria-label={t('Repositorio de skills')} value={source?.id ?? ''} disabled={busy} onChange={e => setSourceId(e.target.value)}>{state.sources.map(s => <option key={s.id} value={s.id}>{s.id}</option>)}</select></label>
      {source && <div className="skill-marketplace-actions"><button type="button" disabled={busy} onClick={() => void run(async () => { setState(await window.nodus.updateSkillSource(source.id)); setNotice(t('Catálogo actualizado. Las skills instaladas no cambian.')); })}>{busy ? t('Trabajando…') : t('Actualizar catálogo')}</button><button type="button" disabled={busy} onClick={() => void run(async () => { setState(await window.nodus.removeSkillSource(source.id)); setNotice(t('Repositorio eliminado. Las skills instaladas siguen disponibles.')); })}>{t('Quitar fuente')}</button></div>}
      {official && <div className="skill-marketplace-actions"><button type="button" disabled={capabilityBusy === 'catalog'} onClick={() => void runCapability('catalog', () => window.nodus.refreshCapabilityCatalog(DEFAULT_SKILL_SOURCE), t('Catálogo actualizado.'))}><Icon name="refresh" size={14} />{t('Actualizar catálogo')}</button><button type="button" disabled={capabilityBusy === 'updates'} onClick={() => void runCapability('updates', async () => {
        const results = await window.nodus.checkCapabilityUpdates();
        const waiting = results.filter(result => result.state === 'awaiting-approval');
        setNotice(waiting.length ? t('Hay una actualización esperando a que apruebes sus permisos.') : t('Todo está al día.'));
      })}><Icon name="download" size={14} />{t('Buscar actualizaciones')}</button></div>}
      <form onSubmit={e => { e.preventDefault(); void run(async () => { const value = await window.nodus.addSkillSource(url); setState(value); setSourceId(value.sources[value.sources.length - 1].id); setUrl(''); }); }} className="skill-marketplace-source"><label>{t('Añadir un repositorio')}<input aria-label={t('URL del repositorio')} type="url" required placeholder="https://github.com/owner/repository" value={url} onChange={e => setUrl(e.target.value)} /></label><button type="submit" disabled={busy || !url.trim()}>{t('Añadir fuente')}</button></form>
    </details>}
    {pluginReview && <PluginPermissionReview prompt={pluginReview} busy={busy}
      onClose={() => setPluginReview(null)}
      onAllow={() => void run(async () => {
        if (pluginReview.kind === 'catalog' && pluginReview.entry && source) {
          const floor = pluginReview.entry.package.manifest.compatibility.minNodusVersion;
          const tooOld = !!appVersion && compareSemver(appVersion, floor) < 0;
          await window.nodus.installMarketplacePlugin(source.id, pluginReview.entry.path, source.commit!, true);
          setNotice(tooOld ? tx('Plugin guardado. Permanece inactivo hasta Nodus {version}.', { version: floor }) : t('Plugin instalado. Las skills nuevas empiezan desactivadas.'));
        } else if (pluginReview.kind === 'inbox' && pluginReview.inbox) {
          await window.nodus.approveInboxPlugin(pluginReview.inbox.directory);
          setInboxPlugins(await window.nodus.listInboxPlugins());
          setNotice(t('Plugin revisado. Las skills nuevas empiezan desactivadas.'));
        }
        setInstalledPlugins(await window.nodus.listInstalledPlugins());
        setPluginReview(null);
      })} />}
    {capabilityReview && <PermissionReview review={capabilityReview} busy={capabilityBusy === capabilityReview.id}
      onAllow={() => void runCapability(capabilityReview.id, async () => {
        await window.nodus.approveCapabilityPlugin(capabilityReview.id);
        setCapabilityReview(null);
      }, capabilityReview.update ? t('Actualización aplicada.') : t('Paquete instalado.'))}
      onRefuse={() => void runCapability(capabilityReview.id, async () => {
        await window.nodus.discardPendingCapabilityPlugin(capabilityReview.id);
        setCapabilityReview(null);
      }, capabilityReview.update ? t('La actualización se ha descartado.') : t('No se ha instalado nada.'))} />}
    {review && manifest && source ? <article className="skill-marketplace-review">
      <button type="button" onClick={() => { setReview(null); setRemoveId(''); }}>{t('← Volver al catálogo')}</button><h4>{manifest.name}</h4><p>@{manifest.author} · {manifest.version} · {manifest.license}</p>
      <p>{manifest.description}</p><p><b>{t('Capabilities')}:</b> {manifest.capabilities.join(', ') || t('Sin capacidades nativas')}{manifest.tools.length ? tx(' · {count} herramientas JavaScript aisladas', { count: manifest.tools.length }) : ''}</p>
      <small>{t('Las herramientas JavaScript no pueden acceder a tus archivos, credenciales, red ni datos de Nodus. La generación de imágenes usa tu proveedor configurado y puede generar sus costes habituales.')}</small>
      {Object.entries(review.package.files).map(([name, content]) => <details key={name}><summary>{name}</summary><pre>{content}</pre></details>)}
      {!!unsupported.length && <p role="status">{tx('Requiere una versión de Nodus compatible con soporte nativo para: {list}. Esta versión no puede instalar esta skill.', { list: unsupported.join(', ') })}</p>}
      <p>{builtin
        ? installed
          ? t('Incluida en Nodus. Reinstalarla restaura las instrucciones y la activación predeterminada de la versión incluida en esta compilación, y reemplaza tus ediciones locales.')
          : t('Incluida en Nodus. Instalarla restaura la versión incluida en esta compilación en lugar de descargar la copia publicada.')
        : installed ? t('Reinstalarla reemplaza tus ediciones locales y desactiva esta skill en las dos superficies.') : t('Las skills instaladas empiezan desactivadas. Actívalas en Mis skills para el Asistente o Nodi.')}</p>
      <button className="chat-skill-primary" type="button" disabled={busy || !!unsupported.length} onClick={() => void install(review)}>{installed.length ? (builtin ? t('Reinstalar skill incluida') : t('Sustituir skill instalada')) : t('Instalar skill')}</button>
      {!!installed.length && (removeId === installed[0].id
        ? <div className="chat-skill-confirm"><span>{confirmText(manifest.name, installed, !!builtin)}</span><button type="button" disabled={busy} onClick={() => void uninstall(installed)}>{t('Desinstalar')}</button><button type="button" onClick={() => setRemoveId('')}>{t('Cancelar')}</button></div>
        : <button type="button" onClick={() => setRemoveId(installed[0].id)}>{t('Desinstalar skill')}</button>)}
    </article> : <>
      <div className="chat-skills-search">
        <Icon name="search" size={16} />
        <input type="search" aria-label={t('Buscar en el Marketplace')} placeholder={t('Nombre, autor o descripción')} value={query} onChange={e => setQuery(e.target.value)} autoComplete="off" spellCheck={false} />
        {query && <button type="button" aria-label={t('Limpiar búsqueda del Marketplace')} title={t('Limpiar búsqueda del Marketplace')} onClick={() => setQuery('')}><Icon name="x" size={14} /></button>}
      </div>
      <div className="skill-marketplace-filters">
        <label>{t('Categoría')}<select aria-label={t('Categoría del Marketplace')} value={category} onChange={e => setCategory(e.target.value)}><option value="">{t('Todas las categorías')}</option>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
        <div className="skill-marketplace-filter" role="group" aria-label={t('Filtro de instalación')}>{(['all', 'installed', 'available'] as const).map(value =>
          <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'all' ? t('Todas') : value === 'installed' ? t('Instaladas') : t('Disponibles')} {counts[value]}</button>)}</div>
      </div>
      {!entries.length && <p className="chat-skills-empty">{!source?.updatedAt && !capabilityEntries.length ? t('Actualiza un repositorio para cargar su catálogo.') : filter === 'installed' ? t('No hay skills instaladas que coincidan.') : filter === 'available' ? t('No hay skills disponibles que coincidan.') : t('No hay skills que coincidan.')}</p>}
      <MigrationBanner onChanged={refreshCapabilities} />
      {capabilities?.problems.map(problem => <p key={problem.pluginId} className="capability-packages-error" role="alert"><b>{problem.pluginId}</b> {problem.detail}</p>)}
      <div className="chat-skills-list">{entries.map(item => {
        const open = details === item.key;
        const shell = (children: ReactNode) => <MarketplaceCard key={item.key} cardKey={item.key} name={item.name}
          description={item.description} author={item.author} category={item.category} installed={item.installed}
          open={open} onToggle={() => setDetails(open ? '' : item.key)}>{children}</MarketplaceCard>;

        if (item.kind === 'skill') {
          const entry = item.entry; const m = entry.package.manifest; const present = installedSkills(m); const included = !!builtinId(m);
          return shell(<>
            {open && <div className="marketplace-card-facts"><small>@{m.author} · {m.version}{present.length ? ` · ${included ? t('Incluida en Nodus') : tx('Instalada {version}', { version: present[0].origin?.version ?? '' })}` : ''}</small><small>{m.capabilities.length ? `${t('Capabilities')}: ${m.capabilities.join(', ')}` : t('Sin capacidades nativas')}{m.tools.length ? tx(' · {count} herramientas aisladas', { count: m.tools.length }) : ''}</small></div>}
            {present.length && removeId === present[0].id
              ? <div className="chat-skill-confirm"><span>{confirmText(m.name, present, included)}</span><button type="button" disabled={busy} onClick={() => void uninstall(present)}>{t('Desinstalar')}</button><button type="button" onClick={() => setRemoveId('')}>{t('Cancelar')}</button></div>
              : <div className="skill-marketplace-entry-actions"><button type="button" disabled={busy} onClick={() => { setRemoveId(''); setReview(entry); }}>{present.length ? (included ? t('Gestionar skill') : t('Revisar actualización')) : t('Revisar skill')}</button>
                {!!present.length && <button type="button" className="chat-skill-remove" disabled={busy} aria-label={tx('Desinstalar {name}', { name: m.name })} onClick={() => setRemoveId(present[0].id)}>{t('Desinstalar')}</button>}</div>}
          </>);
        }

        if (item.kind === 'plugin') {
          const card = item.card; const present = card.installed; const offered = card.entry?.package.manifest;
          const updatable = !!offered && !!present?.activeVersion && compareSemver(offered.version, present.activeVersion) > 0;
          const prompt = card.entry ? { kind: 'catalog' as const, name: card.name, version: offered!.version,
            description: card.description, update: !!present?.activeVersion, permissions: pluginPermissions(card.entry), entry: card.entry } : null;
          return shell(<>
            {open && <div className="marketplace-card-facts">
              <small>{card.by} · {offered?.version ?? present?.activeVersion ?? present?.pendingVersion}{present?.activeVersion && offered && offered.version !== present.activeVersion ? tx(' · Instalada {version}', { version: present.activeVersion }) : ''}</small>
              <small>{present?.pendingReason === 'permissions' ? t('Hay una actualización esperando a que apruebes sus permisos.') : present?.pendingReason === 'incompatible' ? tx('La versión {version} necesita un Nodus más reciente.', { version: present.pendingVersion ?? '' }) : tx('{skills} skills · {capabilities} capacidades', { skills: present?.skills.length ?? offered?.skills.length ?? 0, capabilities: present?.capabilities.length ?? offered?.capabilities.length ?? 0 })}</small>
              {present && <label><input type="checkbox" checked={present.autoUpdate} onChange={event => void run(async () => { setInstalledPlugins(await window.nodus.setPluginAutoUpdate(present.id, event.target.checked)); })} /> {t('Actualización automática')}</label>}
              {present?.secrets.map(secret => <PluginSecretForm key={`${secret.capabilityId}:${secret.id}`} plugin={present} secret={secret} refresh={async () => setInstalledPlugins(await window.nodus.listInstalledPlugins())} />)}
            </div>}
            <div className="skill-marketplace-entry-actions">
              {prompt && (!present || updatable || present.pendingReason === 'permissions') && <button type="button" className="chat-skill-primary" disabled={busy} onClick={() => setPluginReview(prompt)}>{present?.activeVersion ? t('Revisar actualización') : t('Revisar skill')}</button>}
              {present?.pendingReason === 'permissions' && !prompt && <button type="button" disabled title={t('Actualiza su repositorio para revisar los permisos solicitados')}>{t('Revisión de permisos no disponible')}</button>}
              {present?.previousVersion && <button type="button" disabled={busy} onClick={() => void run(async () => { await window.nodus.rollbackPlugin(present.id); setInstalledPlugins(await window.nodus.listInstalledPlugins()); })}>{tx('Volver a la versión {version}', { version: present.previousVersion })}</button>}
              {present && <button type="button" className="chat-skill-remove" disabled={busy} onClick={() => void run(async () => { await window.nodus.removePlugin(present.id); setInstalledPlugins(await window.nodus.listInstalledPlugins()); setNotice(t('Skill desinstalada.')); })}>{t('Desinstalar')}</button>}
            </div>
          </>);
        }

        if (item.kind === 'package') {
          const entry = item.entry; const state = installedCapabilityPackages.get(entry.id);
          const providers = capabilities?.providers.filter(provider => provider.plugin?.id === entry.id) ?? [];
          return shell(<>
            {state?.pending?.reason === 'permissions' && <p className="capability-packages-warning" role="status">{state.active ? t('La actualización pide permisos nuevos. Revísalos y apruébala para instalarla.') : t('Revisa lo que pide. Si lo rechazas, no se instala nada.')}</p>}
            {open && <div className="marketplace-card-facts"><small>NodusResearch · {state?.active && state.active.version !== entry.version ? `${state.active.version} → ${entry.version}` : entry.version} · {t('verificado')}</small><PackageFacts entry={entry} state={state} providers={providers} />{state?.active && <label><input type="checkbox" checked={state.autoUpdate} onChange={event => void runCapability(entry.id, () => window.nodus.setCapabilityAutoUpdate(entry.id, event.target.checked))} /> {t('Actualizar este paquete automáticamente')}</label>}{providers.filter(provider => provider.hasSettings).map(provider => <SettingsForm key={provider.id} capabilityId={provider.id} onChanged={refreshCapabilities} />)}</div>}
            <PackageActions entry={entry} state={state} busy={capabilityBusy} run={runCapability} install={installCapability} onReview={openCapabilityReview} />
          </>);
        }

        const inbox = item.item;
        const prompt: PluginPermissionPrompt = { kind: 'inbox', name: inbox.name, version: inbox.version,
          description: inbox.description, update: inbox.installed, permissions: inbox.permissions, inbox };
        return shell(<>
          {open && <div className="marketplace-card-facts"><small>{inbox.author} · {inbox.version}{inbox.installed ? t(' · Actualización') : ''}</small><small>{tx('{skills} skills · {capabilities} capacidades · pendiente de revisión', { skills: inbox.skills, capabilities: inbox.capabilities })}</small></div>}
          <div className="skill-marketplace-entry-actions"><button className="chat-skill-primary" type="button" disabled={busy} onClick={() => setPluginReview(prompt)}>{t('Revisar permisos')}</button><button type="button" disabled={busy} onClick={() => void run(async () => { setInboxPlugins(await window.nodus.discardInboxPlugin(inbox.directory)); })}>{t('Descartar')}</button></div>
        </>);
      })}</div>
    </>}
    {!!source?.errors.length && <details><summary>{tx('{count} paquetes no válidos omitidos', { count: source.errors.length })}</summary>{source.errors.map((e, i) => <p key={i}>{e}</p>)}</details>}
    <p className="skill-marketplace-policy">{t('El Marketplace oficial rechaza las skills que promueven actividades ilegales, la piratería, la elusión de licencias, el malware o el acceso no autorizado. Las fuentes independientes las mantienen sus propietarios.')}</p>
    <button type="button" onClick={() => void window.nodus.openExternal(`${DEFAULT_SKILL_SOURCE}/blob/main/CONTRIBUTING.md`)}>{t('Crea y envía una skill ↗')}</button>
    {notice && <p role="status">{notice}</p>}{error && <p className="chat-skill-error" role="alert">{error}</p>}
  </div>;
}
