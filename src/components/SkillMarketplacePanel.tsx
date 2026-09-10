import { useEffect, useState } from 'react';
import { BUILTIN_SKILL_PACKAGES, type ChatSkill } from '@shared/chatSkills';
import { unsupportedSkillCapabilities, DEFAULT_SKILL_SOURCE, isOfficialSkillSource, type MarketplaceEntry, type PluginMarketplaceEntry, type SkillManifest, type SkillMarketplace } from '@shared/skillMarketplace';
import type { InboxPluginSummary, InstalledPluginSummary } from '../../skill-capabilities/contracts';
import { marketplaceLogoSvg } from '@shared/marketplaceLogo';

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
  useEffect(() => {
    let alive = true;
    const refresh = () => { void window.nodus.getSkillMarketplace().then(value => { if (alive) setState(value); }).catch(e => { if (alive) setError(String(e)); }); void window.nodus.listInstalledPlugins().then(value => { if (alive) setInstalledPlugins(value); }).catch(() => undefined); void window.nodus.listInboxPlugins().then(value => { if (alive) setInboxPlugins(value); }).catch(() => undefined); };
    refresh(); const off = window.nodus.onChatSkillsChanged(refresh);
    return () => { alive = false; off(); };
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
  const categories = [...new Set(source?.entries.map(e => e.package.manifest.category) ?? [])].sort();
  const entries = (source?.entries ?? []).filter(e => {
    const m = e.package.manifest;
    return (!category || m.category === category) && (filter === 'all' || (filter === 'installed') === !!installedSkills(m).length)
      && `${m.name} ${m.description} ${m.author} ${m.category}`.toLowerCase().includes(query.toLowerCase());
  });
  const installedCount = (source?.entries ?? []).filter(e => installedSkills(e.package.manifest).length).length;
  const counts: Record<InstalledFilter, number> = { all: source?.entries.length ?? 0, installed: installedCount, available: (source?.entries.length ?? 0) - installedCount };
  const manifest = review?.package.manifest;
  const builtin = manifest ? builtinId(manifest) : undefined;
  // A built-in is restored from this build, so a capability no package may declare is never a blocker.
  const unsupported = builtin ? [] : unsupportedSkillCapabilities(manifest?.capabilities ?? []);
  const installed = manifest ? installedSkills(manifest) : [];
  return <div className="skill-marketplace" aria-label="Skill marketplace">
    <div className="skill-marketplace-brand"><img src={`data:image/svg+xml,${encodeURIComponent(marketplaceLogoSvg(accent))}`} data-testid="marketplace-logo" alt="Nodus Marketplace" /><div><b>Discover your next skill</b><p>Methods and tools, made by the community.</p></div></div>
    <label>Repository<select aria-label="Skill repository" value={source?.id ?? ''} disabled={busy} onChange={e => setSourceId(e.target.value)}>{state.sources.map(s => <option key={s.id} value={s.id}>{s.id}</option>)}</select></label>
    {source && <><div className="skill-marketplace-actions"><button type="button" disabled={busy} onClick={() => void run(async () => { setState(await window.nodus.updateSkillSource(source.id)); setNotice('Catalog updated. Installed skills are unchanged.'); })}>{busy ? 'Working…' : 'Update catalog'}</button><button type="button" disabled={busy} onClick={() => void run(async () => { setState(await window.nodus.removeSkillSource(source.id)); setNotice('Repository removed. Installed skills remain available.'); })}>Remove source</button></div>
      <small>{official ? 'Official Nodus repository' : 'Community source · not reviewed by Nodus'}{source.updatedAt ? ` · Updated ${new Date(source.updatedAt).toLocaleString()}` : ' · Update to discover skills'}</small></>}
    <form onSubmit={e => { e.preventDefault(); void run(async () => { const value = await window.nodus.addSkillSource(url); setState(value); setSourceId(value.sources[value.sources.length - 1].id); setUrl(''); }); }} className="skill-marketplace-source"><label>Add a repository<input aria-label="Repository URL" type="url" required placeholder="https://github.com/owner/repository" value={url} onChange={e => setUrl(e.target.value)} /></label><button type="submit" disabled={busy || !url.trim()}>Add source</button></form>
    {pluginReview && source ? <article className="skill-marketplace-review">
      <button type="button" onClick={() => setPluginReview(null)}>← Back to catalog</button><h4>{pluginReview.package.manifest.name}</h4>
      <p>{pluginReview.package.manifest.author} · {pluginReview.package.manifest.version} · {pluginReview.package.manifest.license}</p><p>{pluginReview.package.manifest.description}</p>
      <p><b>Components:</b> {pluginReview.package.manifest.skills.length} skills · {pluginReview.package.manifest.capabilities.length} sandboxed capabilities</p>
      {(() => { const capabilities = pluginReview.package.manifest.capabilities.map(file => JSON.parse(pluginReview.package.files[file])); const networks = capabilities.flatMap(capability => capability.permissions?.network ?? []); const secrets = capabilities.flatMap(capability => capability.permissions?.secrets ?? []); const storage = capabilities.reduce((sum, capability) => sum + (capability.permissions?.storage?.maxBytes ?? 0), 0); return <div><b>Requested permissions</b><ul><li>HTTPS endpoints: {networks.length ? networks.map(endpoint => endpoint.origin).join(', ') : 'none'}</li><li>Secrets: {secrets.length ? secrets.map(secret => secret.label).join(', ') : 'none'}</li><li>Storage: {storage ? `${storage} bytes` : 'none'}</li></ul></div>; })()}
      <small>Capability code runs in an ephemeral Chromium sandbox without Node, filesystem, navigation, WebRTC or direct network access. Only the permissions above are mediated by Nodus.</small>
      {Object.entries(pluginReview.package.files).map(([name, content]) => <details key={name}><summary>{name}</summary><pre>{content}</pre></details>)}
      <button className="chat-skill-primary" type="button" disabled={busy} onClick={() => void run(async () => { await window.nodus.installMarketplacePlugin(source.id, pluginReview.path, source.commit!, true); setPluginReview(null); setInstalledPlugins(await window.nodus.listInstalledPlugins()); setNotice('Plugin installed. New skills start disabled.'); })}>Approve permissions and install</button>
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
      <label>Find a skill<input type="search" aria-label="Search marketplace" placeholder="Name, creator or description" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <label>Category<select aria-label="Marketplace category" value={category} onChange={e => setCategory(e.target.value)}><option value="">All categories</option>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
      <div className="skill-marketplace-filter" role="group" aria-label="Installed filter">{(['all', 'installed', 'available'] as const).map(value =>
        <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'all' ? 'All' : value === 'installed' ? 'Installed' : 'Available'} {counts[value]}</button>)}</div>
      {!entries.length && <p className="chat-skills-empty">{!source?.updatedAt ? 'Update a repository to load its catalog.' : filter === 'installed' ? 'No skills from this repository are installed.' : filter === 'available' ? 'Every skill in this repository is already installed.' : 'No matching skills.'}</p>}
      {categories.filter(c => entries.some(e => e.package.manifest.category === c)).map(c => <section key={c}><h4>{c}</h4>{entries.filter(e => e.package.manifest.category === c).map(entry => {
        const m = entry.package.manifest; const present = installedSkills(m); const included = !!builtinId(m);
        return <article className={`chat-skill-item ${present.length ? 'installed' : ''}`} key={entry.path}><b>{m.name}</b><small>@{m.author} · {m.version}{present.length ? ` · ${included ? 'Included in Nodus' : `Installed ${present[0].origin?.version}`}` : ''}</small><p>{m.description}</p>
          {present.length && removeId === present[0].id
            ? <div className="chat-skill-confirm"><span>{confirmText(m.name, present, included)}</span><button type="button" disabled={busy} onClick={() => void uninstall(present)}>Uninstall</button><button type="button" onClick={() => setRemoveId('')}>Cancel</button></div>
            : <div className="skill-marketplace-entry-actions"><button type="button" disabled={busy} onClick={() => { setRemoveId(''); setReview(entry); }}>{present.length ? (included ? 'Manage skill' : 'Review update') : 'Review skill'}</button>
              {!!present.length && <button type="button" disabled={busy} aria-label={`Uninstall ${m.name}`} onClick={() => setRemoveId(present[0].id)}>Uninstall</button>}</div>}
        </article>;
      })}</section>)}
    </>}
    {!!source?.plugins?.length && <section><h4>Plugins</h4>{source.plugins.map(entry => { const present = installedPlugins.find(plugin => plugin.id === entry.package.manifest.id); return <article className="chat-skill-item" key={entry.path}><b>{entry.package.manifest.name}</b><small>{entry.package.manifest.author} · {entry.package.manifest.version}{present ? ` · Installed ${present.activeVersion || 'pending'}` : ''}</small><p>{entry.package.manifest.description}</p><button type="button" disabled={busy} onClick={() => setPluginReview(entry)}>Review {present ? 'update' : 'plugin'}</button></article>; })}</section>}
    {!!inboxPlugins.length && <section><h4>Waiting for review</h4><small>Dropped into the plugin inbox. Nothing runs until you approve the permissions below.</small>{inboxPlugins.map(plugin => <article className="chat-skill-item" key={plugin.directory}><b>{plugin.name}</b><small>{plugin.author} · {plugin.version}{plugin.installed ? ' · Update to an installed plugin' : ''}</small><p>{plugin.description}</p><ul><li>{plugin.skills} skills · {plugin.capabilities} sandboxed capabilities</li><li>HTTPS endpoints: {plugin.permissions.network?.map(endpoint => endpoint.origin).join(', ') || 'none'}</li><li>Secrets: {plugin.permissions.secrets?.map(secret => secret.label).join(', ') || 'none'}</li><li>Storage: {plugin.permissions.storage?.maxBytes ? `${plugin.permissions.storage.maxBytes} bytes` : 'none'}</li></ul><button className="chat-skill-primary" type="button" disabled={busy} onClick={() => void run(async () => { await window.nodus.approveInboxPlugin(plugin.directory); setInboxPlugins(await window.nodus.listInboxPlugins()); setInstalledPlugins(await window.nodus.listInstalledPlugins()); setNotice('Plugin reviewed. New skills start disabled.'); })}>Review permissions and install</button> <button type="button" disabled={busy} onClick={() => void run(async () => { setInboxPlugins(await window.nodus.discardInboxPlugin(plugin.directory)); })}>Discard</button></article>)}</section>}
    {!!installedPlugins.length && <section><h4>Installed plugins</h4>{installedPlugins.map(plugin => <article className="chat-skill-item" key={plugin.id}><b>{plugin.name}</b><small>{plugin.activeVersion || `Pending ${plugin.pendingVersion}`} · {plugin.sourceId}</small><p>{plugin.pendingReason === 'permissions' ? 'An update is waiting for permission approval.' : plugin.description}</p><label><input type="checkbox" checked={plugin.autoUpdate} onChange={event => void run(async () => { setInstalledPlugins(await window.nodus.setPluginAutoUpdate(plugin.id, event.target.checked)); })} /> Auto-update</label>{plugin.secrets.map(secret => <PluginSecretForm key={`${secret.capabilityId}:${secret.id}`} plugin={plugin} secret={secret} refresh={async () => setInstalledPlugins(await window.nodus.listInstalledPlugins())} />)}{plugin.pendingReason === 'permissions' && <button type="button" disabled={busy} onClick={() => void run(async () => { await window.nodus.approvePlugin(plugin.id); setInstalledPlugins(await window.nodus.listInstalledPlugins()); })}>Review accepted · apply update</button>} {plugin.previousVersion && <button type="button" disabled={busy} onClick={() => void run(async () => { await window.nodus.rollbackPlugin(plugin.id); setInstalledPlugins(await window.nodus.listInstalledPlugins()); })}>Rollback to {plugin.previousVersion}</button>} <button type="button" disabled={busy} onClick={() => void run(async () => { await window.nodus.removePlugin(plugin.id); setInstalledPlugins(await window.nodus.listInstalledPlugins()); })}>Uninstall</button></article>)}</section>}
    {!!source?.errors.length && <details><summary>{source.errors.length} invalid packages skipped</summary>{source.errors.map((e, i) => <p key={i}>{e}</p>)}</details>}
    <p className="skill-marketplace-policy">The official marketplace rejects skills that promote illegal activity, piracy, license circumvention, malware or unauthorized access. Independent sources are maintained by their owners.</p>
    <button type="button" onClick={() => void window.nodus.openExternal(`${DEFAULT_SKILL_SOURCE}/blob/main/CONTRIBUTING.md`)}>Create and submit a skill ↗</button>
    {notice && <p role="status">{notice}</p>}{error && <p className="chat-skill-error" role="alert">{error}</p>}
  </div>;
}
