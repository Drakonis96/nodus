import { useEffect, useState, type CSSProperties } from 'react';
import { BUILTIN_SKILL_PACKAGES, type ChatSkill } from '@shared/chatSkills';
import { unsupportedSkillCapabilities, DEFAULT_SKILL_SOURCE, isOfficialSkillSource, type MarketplaceEntry, type PluginMarketplaceEntry, type SkillManifest, type SkillMarketplace } from '@shared/skillMarketplace';
import { compareSemver } from '../../skill-capabilities/contracts';
import type { InboxPluginSummary, InstalledPluginSummary } from '../../skill-capabilities/contracts';
import { marketplaceLogoSvg } from '@shared/marketplaceLogo';
import { Icon } from './ui';
import { skillGlyph } from './skillGlyph';

type InstalledFilter = 'all' | 'installed' | 'available';

function PluginSecretForm({ plugin, secret, refresh }: { plugin: InstalledPluginSummary; secret: InstalledPluginSummary['secrets'][number]; refresh: () => Promise<void> }) {
  const [value, setValue] = useState('');
  return <form onSubmit={event => { event.preventDefault(); void window.nodus.configurePluginSecret(plugin.id, secret.capabilityId, secret.id, value).then(() => { setValue(''); return refresh(); }); }}><label>{secret.label}{secret.required ? ' (required)' : ''}<input type="password" value={value} placeholder={secret.configured ? 'Configured' : 'Not configured'} onChange={event => setValue(event.target.value)} /></label><button type="submit">{secret.configured ? 'Replace' : 'Save'}</button>{secret.configured && <button type="button" onClick={() => void window.nodus.configurePluginSecret(plugin.id, secret.capabilityId, secret.id, '').then(refresh)}>Clear</button>}</form>;
}

export function SkillMarketplacePanel({ skills, accent }: { skills: ChatSkill[]; accent: string }) {
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
  const [pluginReview, setPluginReview] = useState<PluginMarketplaceEntry | null>(null);
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPluginSummary[]>([]);
  const [inboxPlugins, setInboxPlugins] = useState<InboxPluginSummary[]>([]);
  const [appVersion, setAppVersion] = useState('');
  /** Ids the capability-package panel above owns, so this catalogue does not offer them a
   *  second time. Taken from the package catalogue and from what is installed, because a
   *  profile can hold a package whose catalogue has not been refreshed yet. */
  const [capabilityPackages, setCapabilityPackages] = useState<ReadonlySet<string>>(new Set());
  // One card's details at a time, like the library.
  const [details, setDetails] = useState('');
  useEffect(() => {
    let alive = true;
    const refresh = () => { void window.nodus.getSkillMarketplace().then(value => { if (alive) setState(value); }).catch(e => { if (alive) setError(String(e)); }); void window.nodus.listInstalledPlugins().then(value => { if (alive) setInstalledPlugins(value); }).catch(() => undefined); void window.nodus.listInboxPlugins().then(value => { if (alive) setInboxPlugins(value); }).catch(() => undefined); };
    void window.nodus.getAppInfo().then(info => { if (alive) setAppVersion(info.version); }).catch(() => undefined);
    const refreshPackages = () => void window.nodus.listCapabilities()
      .then(value => { if (alive) setCapabilityPackages(new Set([...(value.catalog?.catalog.plugins ?? []).map(plugin => plugin.id), ...value.plugins.map(plugin => plugin.id)])); })
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
    setNotice(targets.some(skill => skill.builtin) ? 'Skill uninstalled. Its native capabilities stay in Nodus and return with the skill.' : 'Skill uninstalled. Reinstall it here whenever you want.');
  });
  const confirmText = (name: string, targets: ChatSkill[], included: boolean) => included
    ? `Uninstall ${name}${targets.length > 1 ? ` and ${targets.length - 1} copy installed from this repository` : ''}? Its native capabilities stay in Nodus.`
    : `Uninstall ${name} and its local edits?`;
  const install = (entry: MarketplaceEntry) => run(async () => {
    await window.nodus.installMarketplaceSkill(source!.id, entry.path, source!.commit!);
    setReview(null);
    setNotice(builtinId(entry.package.manifest) ? 'Included skill restored. Check its activation in My skills.' : 'Skill installed. Enable it in My skills.');
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
  ].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));

  const categories = [...new Set(source?.entries.map(e => e.package.manifest.category) ?? [])].sort();
  // Alphabetical rather than grouped by category: a catalogue is something you look a name
  // up in, and the category is a filter for when you do not have one.
  // A discipline that ships as a signed capability package is managed in Official packages,
  // which is where its permissions, its settings and its rollback live. Listing it here too
  // gave it a second Install button that could only ever do half the job.
  const catalogued = (source?.entries ?? []).filter(e => !(official && capabilityPackages.has(e.package.manifest.id)));
  const entries = catalogued.filter(e => {
    const m = e.package.manifest;
    return (!category || m.category === category) && (filter === 'all' || (filter === 'installed') === !!installedSkills(m).length)
      && `${m.name} ${m.description} ${m.author} ${m.category}`.toLowerCase().includes(query.toLowerCase());
  }).sort((a, b) => a.package.manifest.name.localeCompare(b.package.manifest.name, undefined, { sensitivity: 'base', numeric: true }));
  const installedCount = catalogued.filter(e => installedSkills(e.package.manifest).length).length;
  const counts: Record<InstalledFilter, number> = { all: catalogued.length, installed: installedCount, available: catalogued.length - installedCount };
  const manifest = review?.package.manifest;
  const builtin = manifest ? builtinId(manifest) : undefined;
  // A built-in is restored from this build, so a capability no package may declare is never a blocker.
  const unsupported = builtin ? [] : unsupportedSkillCapabilities(manifest?.capabilities ?? []);
  const installed = manifest ? installedSkills(manifest) : [];
  return <div className="skill-marketplace" aria-label="Skill marketplace">
    {/* Both variants, swapped by the stylesheet: which theme this panel is in is a CSS
        fact here — it is rendered into a portal that carries the class — and asking
        JavaScript for it would mean re-asking every time the theme changed. */}
    <div className="skill-marketplace-brand">
      <img className="skill-marketplace-logo-dark" src={`data:image/svg+xml,${encodeURIComponent(marketplaceLogoSvg(accent))}`} data-testid="marketplace-logo" alt="Nodus Marketplace" />
      <img className="skill-marketplace-logo-light" src={`data:image/svg+xml,${encodeURIComponent(marketplaceLogoSvg(accent, { plate: false }))}`} alt="" aria-hidden="true" />
      <div><b>Discover your next skill</b><p>Methods and tools, made by the community.</p></div>
    </div>
    {/* Where the skills come from, folded away. It is answered once and then rarely asked
        again, and open by default it put five controls between the reader and the first
        skill. The line stays visible, so which repository this is never becomes a mystery. */}
    <details className="skill-marketplace-sources">
      <summary>
        <span>{official ? 'Official Nodus repository' : 'Community source · not reviewed by Nodus'}{source?.updatedAt ? ` · Updated ${new Date(source.updatedAt).toLocaleDateString()}` : source ? ' · Update to discover skills' : ''}</span>
        <span className="skill-marketplace-sources-hint">Repositories</span>
      </summary>
      <label>Repository<select aria-label="Skill repository" value={source?.id ?? ''} disabled={busy} onChange={e => setSourceId(e.target.value)}>{state.sources.map(s => <option key={s.id} value={s.id}>{s.id}</option>)}</select></label>
      {source && <div className="skill-marketplace-actions"><button type="button" disabled={busy} onClick={() => void run(async () => { setState(await window.nodus.updateSkillSource(source.id)); setNotice('Catalog updated. Installed skills are unchanged.'); })}>{busy ? 'Working…' : 'Update catalog'}</button><button type="button" disabled={busy} onClick={() => void run(async () => { setState(await window.nodus.removeSkillSource(source.id)); setNotice('Repository removed. Installed skills remain available.'); })}>Remove source</button></div>}
      <form onSubmit={e => { e.preventDefault(); void run(async () => { const value = await window.nodus.addSkillSource(url); setState(value); setSourceId(value.sources[value.sources.length - 1].id); setUrl(''); }); }} className="skill-marketplace-source"><label>Add a repository<input aria-label="Repository URL" type="url" required placeholder="https://github.com/owner/repository" value={url} onChange={e => setUrl(e.target.value)} /></label><button type="submit" disabled={busy || !url.trim()}>Add source</button></form>
    </details>
    {pluginReview && source ? <article className="skill-marketplace-review">
      <button type="button" onClick={() => setPluginReview(null)}>← Back to catalog</button><h4>{pluginReview.package.manifest.name}</h4>
      <p>{pluginReview.package.manifest.author} · {pluginReview.package.manifest.version} · {pluginReview.package.manifest.license}</p><p>{pluginReview.package.manifest.description}</p>
      <p><b>Components:</b> {pluginReview.package.manifest.skills.length} skills · {pluginReview.package.manifest.capabilities.length} sandboxed capabilities</p>
      {(() => { const capabilities = pluginReview.package.manifest.capabilities.map(file => JSON.parse(pluginReview.package.files[file])); const networks = capabilities.flatMap(capability => capability.permissions?.network ?? []); const secrets = capabilities.flatMap(capability => capability.permissions?.secrets ?? []); const storage = capabilities.reduce((sum, capability) => sum + (capability.permissions?.storage?.maxBytes ?? 0), 0); return <div><b>Requested permissions</b><ul><li>HTTPS endpoints: {networks.length ? networks.map(endpoint => endpoint.origin).join(', ') : 'none'}</li><li>Secrets: {secrets.length ? secrets.map(secret => secret.label).join(', ') : 'none'}</li><li>Storage: {storage ? `${storage} bytes` : 'none'}</li></ul></div>; })()}
      <small>Capability code runs in an ephemeral Chromium sandbox without Node, filesystem, navigation, WebRTC or direct network access. Only the permissions above are mediated by Nodus.</small>
      {Object.entries(pluginReview.package.files).map(([name, content]) => <details key={name}><summary>{name}</summary><pre>{content}</pre></details>)}
      {(() => {
        // A skill review already warns before install; a plugin can also be refused for
        // being newer than the build, and that must be visible before permissions are given.
        const floor = pluginReview.package.manifest.compatibility.minNodusVersion;
        const tooOld = !!appVersion && compareSemver(appVersion, floor) < 0;
        return <>
          {tooOld && <p role="status">Requires Nodus {floor} or newer; this build is {appVersion}. It can be installed, but it stays inactive until you update.</p>}
          <button className="chat-skill-primary" type="button" disabled={busy} onClick={() => void run(async () => { await window.nodus.installMarketplacePlugin(source.id, pluginReview.path, source.commit!, true); setPluginReview(null); setInstalledPlugins(await window.nodus.listInstalledPlugins()); setNotice(tooOld ? `Plugin saved. It stays inactive until Nodus ${floor}.` : 'Plugin installed. New skills start disabled.'); })}>Approve permissions and install</button>
        </>;
      })()}
    </article> : review && manifest && source ? <article className="skill-marketplace-review">
      <button type="button" onClick={() => { setReview(null); setRemoveId(''); }}>← Back to catalog</button><h4>{manifest.name}</h4><p>@{manifest.author} · {manifest.version} · {manifest.license}</p>
      <p>{manifest.description}</p><p><b>Capabilities:</b> {manifest.capabilities.join(', ') || 'No native capabilities'}{manifest.tools.length ? ` · ${manifest.tools.length} sandboxed JavaScript tools` : ''}</p>
      <small>JavaScript tools cannot access your files, credentials, network or Nodus data. Image generation uses your configured provider and may incur its normal costs.</small>
      {Object.entries(review.package.files).map(([name, content]) => <details key={name}><summary>{name}</summary><pre>{content}</pre></details>)}
      {!!unsupported.length && <p role="status">Requires a compatible Nodus build with native support for: {unsupported.join(', ')}. This build cannot install this skill.</p>}
      <p>{builtin
        ? installed
          ? 'Included in Nodus. Reinstalling restores the instructions and default activation of the version shipped with this build, replacing your local edits.'
          : 'Included in Nodus. Installing restores the version shipped with this build instead of downloading the published copy.'
        : installed ? 'Reinstalling replaces your local edits and disables this skill on both surfaces.' : 'Installed skills start disabled. Enable them in My skills for Assistant or Nodi.'}</p>
      <button className="chat-skill-primary" type="button" disabled={busy || !!unsupported.length} onClick={() => void install(review)}>{installed.length ? (builtin ? 'Reinstall included skill' : 'Replace installed skill') : 'Install skill'}</button>
      {!!installed.length && (removeId === installed[0].id
        ? <div className="chat-skill-confirm"><span>{confirmText(manifest.name, installed, !!builtin)}</span><button type="button" disabled={busy} onClick={() => void uninstall(installed)}>Uninstall</button><button type="button" onClick={() => setRemoveId('')}>Cancel</button></div>
        : <button type="button" onClick={() => setRemoveId(installed[0].id)}>Uninstall skill</button>)}
    </article> : <>
      <div className="chat-skills-search">
        <Icon name="search" size={16} />
        <input type="search" aria-label="Search marketplace" placeholder="Name, creator or description" value={query} onChange={e => setQuery(e.target.value)} autoComplete="off" spellCheck={false} />
        {query && <button type="button" aria-label="Clear marketplace search" title="Clear marketplace search" onClick={() => setQuery('')}><Icon name="x" size={14} /></button>}
      </div>
      <div className="skill-marketplace-filters">
        <label>Category<select aria-label="Marketplace category" value={category} onChange={e => setCategory(e.target.value)}><option value="">All categories</option>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
        <div className="skill-marketplace-filter" role="group" aria-label="Installed filter">{(['all', 'installed', 'available'] as const).map(value =>
          <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'all' ? 'All' : value === 'installed' ? 'Installed' : 'Available'} {counts[value]}</button>)}</div>
      </div>
      {!entries.length && <p className="chat-skills-empty">{!source?.updatedAt ? 'Update a repository to load its catalog.' : filter === 'installed' ? 'No skills from this repository are installed.' : filter === 'available' ? 'Every skill in this repository is already installed.' : 'No matching skills.'}</p>}
      <div className="chat-skills-list">{entries.map(entry => {
        const m = entry.package.manifest; const present = installedSkills(m); const included = !!builtinId(m);
        const glyph = skillGlyph({ packageId: m.id, name: m.name, description: m.description, category: m.category });
        const open = details === entry.path;
        return <article className={`chat-skill-item ${present.length ? 'installed' : ''} ${open ? 'open' : ''}`} key={entry.path} style={{ '--skill-hue': glyph.hue } as CSSProperties}>
          <div className="chat-skill-main">
            <span className="chat-skill-symbol" aria-hidden="true"><Icon name={glyph.icon} size={18} /></span>
            <div className="chat-skill-text">
              <span className="chat-skill-heading"><b>{m.name}</b>{!!present.length && <span className="chat-skill-tool-badge">{included ? 'Included' : 'Installed'}</span>}</span>
              <p>{m.description}</p>
            </div>
            <button type="button" className="chat-skill-details-toggle" aria-expanded={open} aria-label={`${open ? 'Hide details of' : 'Show details of'} ${m.name}`}
              title={open ? 'Hide details' : 'Show details'} onClick={() => setDetails(open ? '' : entry.path)}><Icon name={open ? 'chevronUp' : 'chevronDown'} size={14} /></button>
          </div>

          {open && <div className="chat-skill-details">
            <p>{m.description}</p>
            <small>@{m.author} · {m.version} · {m.category}{present.length ? ` · ${included ? 'Included in Nodus' : `Installed ${present[0].origin?.version}`}` : ''}</small>
            <small>{m.capabilities.length ? `Capabilities: ${m.capabilities.join(', ')}` : 'No native capabilities'}{m.tools.length ? ` · ${m.tools.length} sandboxed tools` : ''}</small>
          </div>}

          {present.length && removeId === present[0].id
            ? <div className="chat-skill-confirm"><span>{confirmText(m.name, present, included)}</span><button type="button" disabled={busy} onClick={() => void uninstall(present)}>Uninstall</button><button type="button" onClick={() => setRemoveId('')}>Cancel</button></div>
            : <div className="skill-marketplace-entry-actions"><button type="button" disabled={busy} onClick={() => { setRemoveId(''); setReview(entry); }}>{present.length ? (included ? 'Manage skill' : 'Review update') : 'Review skill'}</button>
              {!!present.length && <button type="button" className="chat-skill-remove" disabled={busy} aria-label={`Uninstall ${m.name}`} onClick={() => setRemoveId(present[0].id)}>Uninstall</button>}</div>}
        </article>;
      })}</div>
    </>}
    {/* One section, not two. A plugin offered by the repository and the same plugin sitting
        installed are one thing in two states, and listing both put every plugin on the page
        twice, each copy with half the controls. */}
    {!!pluginCards.length && <section><h4>Plugins</h4>{pluginCards.map(card => {
      const present = card.installed;
      const offered = card.entry?.package.manifest;
      const updatable = !!offered && !!present?.activeVersion && compareSemver(offered.version, present.activeVersion) > 0;
      return <article className="chat-skill-item" key={card.id}>
        <b>{card.name}</b>
        <small>{card.by} · {offered?.version ?? present?.activeVersion ?? present?.pendingVersion}{present?.activeVersion && offered && offered.version !== present.activeVersion ? ` · Installed ${present.activeVersion}` : present ? ' · Installed' : ''}</small>
        <p>{present?.pendingReason === 'permissions' ? 'An update is waiting for permission approval.'
          : present?.pendingReason === 'incompatible' ? `Version ${present.pendingVersion} needs a newer Nodus than this build. It stays here, inactive, until you update.`
            : card.description}</p>
        {present && <label><input type="checkbox" checked={present.autoUpdate} onChange={event => void run(async () => { setInstalledPlugins(await window.nodus.setPluginAutoUpdate(present.id, event.target.checked)); })} /> Auto-update</label>}
        {present?.secrets.map(secret => <PluginSecretForm key={`${secret.capabilityId}:${secret.id}`} plugin={present} secret={secret} refresh={async () => setInstalledPlugins(await window.nodus.listInstalledPlugins())} />)}
        <div className="skill-marketplace-entry-actions">
          {card.entry && (!present || updatable) && <button type="button" className="chat-skill-primary" disabled={busy} onClick={() => setPluginReview(card.entry!)}>{present ? 'Review update' : 'Review plugin'}</button>}
          {present?.pendingReason === 'permissions' && <button type="button" disabled={busy} onClick={() => void run(async () => { await window.nodus.approvePlugin(present.id); setInstalledPlugins(await window.nodus.listInstalledPlugins()); })}>Review accepted · apply update</button>}
          {present?.previousVersion && <button type="button" disabled={busy} onClick={() => void run(async () => { await window.nodus.rollbackPlugin(present.id); setInstalledPlugins(await window.nodus.listInstalledPlugins()); })}>Rollback to {present.previousVersion}</button>}
          {present && <button type="button" className="chat-skill-remove" disabled={busy} onClick={() => void run(async () => { await window.nodus.removePlugin(present.id); setInstalledPlugins(await window.nodus.listInstalledPlugins()); setNotice('Plugin uninstalled. The skills it provided are gone with it.'); })}>Uninstall</button>}
        </div>
      </article>;
    })}</section>}
    {!!inboxPlugins.length && <section><h4>Waiting for review</h4><small>Dropped into the plugin inbox. Nothing runs until you approve the permissions below.</small>{inboxPlugins.map(plugin => <article className="chat-skill-item" key={plugin.directory}><b>{plugin.name}</b><small>{plugin.author} · {plugin.version}{plugin.installed ? ' · Update to an installed plugin' : ''}</small><p>{plugin.description}</p><ul><li>{plugin.skills} skills · {plugin.capabilities} sandboxed capabilities</li><li>HTTPS endpoints: {plugin.permissions.network?.map(endpoint => endpoint.origin).join(', ') || 'none'}</li><li>Secrets: {plugin.permissions.secrets?.map(secret => secret.label).join(', ') || 'none'}</li><li>Storage: {plugin.permissions.storage?.maxBytes ? `${plugin.permissions.storage.maxBytes} bytes` : 'none'}</li></ul><button className="chat-skill-primary" type="button" disabled={busy} onClick={() => void run(async () => { await window.nodus.approveInboxPlugin(plugin.directory); setInboxPlugins(await window.nodus.listInboxPlugins()); setInstalledPlugins(await window.nodus.listInstalledPlugins()); setNotice('Plugin reviewed. New skills start disabled.'); })}>Review permissions and install</button> <button type="button" disabled={busy} onClick={() => void run(async () => { setInboxPlugins(await window.nodus.discardInboxPlugin(plugin.directory)); })}>Discard</button></article>)}</section>}
    {!!source?.errors.length && <details><summary>{source.errors.length} invalid packages skipped</summary>{source.errors.map((e, i) => <p key={i}>{e}</p>)}</details>}
    <p className="skill-marketplace-policy">The official marketplace rejects skills that promote illegal activity, piracy, license circumvention, malware or unauthorized access. Independent sources are maintained by their owners.</p>
    <button type="button" onClick={() => void window.nodus.openExternal(`${DEFAULT_SKILL_SOURCE}/blob/main/CONTRIBUTING.md`)}>Create and submit a skill ↗</button>
    {notice && <p role="status">{notice}</p>}{error && <p className="chat-skill-error" role="alert">{error}</p>}
  </div>;
}
