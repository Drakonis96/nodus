import { useEffect, useState } from 'react';
import type { ChatSkill } from '@shared/chatSkills';
import { unsupportedSkillCapabilities, DEFAULT_SKILL_SOURCE, type MarketplaceEntry, type SkillMarketplace } from '@shared/skillMarketplace';
import { marketplaceLogoSvg } from '@shared/marketplaceLogo';

export function SkillMarketplacePanel({ skills, accent }: { skills: ChatSkill[]; accent: string }) {
  const [state, setState] = useState<SkillMarketplace>({ version: 1, sources: [] });
  const [sourceId, setSourceId] = useState('');
  const [url, setUrl] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [review, setReview] = useState<MarketplaceEntry | null>(null);
  useEffect(() => {
    let alive = true;
    const refresh = () => void window.nodus.getSkillMarketplace().then(value => { if (alive) setState(value); }).catch(e => { if (alive) setError(String(e)); });
    refresh(); const off = window.nodus.onChatSkillsChanged(refresh);
    return () => { alive = false; off(); };
  }, []);
  const source = state.sources.find(s => s.id === sourceId) ?? state.sources[0];
  useEffect(() => { setReview(null); setCategory(''); }, [source?.id, source?.commit]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const categories = [...new Set(source?.entries.map(e => e.package.manifest.category) ?? [])].sort();
  const entries = (source?.entries ?? []).filter(e => {
    const m = e.package.manifest;
    return (!category || m.category === category) && `${m.name} ${m.description} ${m.author} ${m.category}`.toLowerCase().includes(query.toLowerCase());
  });
  const official = source?.url.toLowerCase() === DEFAULT_SKILL_SOURCE.toLowerCase();
  const unsupported = unsupportedSkillCapabilities(review?.package.manifest.capabilities ?? []);
  const installed = review && skills.find(s => s.origin?.sourceId === source?.id && s.origin?.packageId === review.package.manifest.id);
  return <div className="skill-marketplace" aria-label="Skill marketplace">
    <div className="skill-marketplace-brand"><img src={`data:image/svg+xml,${encodeURIComponent(marketplaceLogoSvg(accent))}`} data-testid="marketplace-logo" alt="Nodus Marketplace" /><div><b>Discover your next skill</b><p>Methods and tools, made by the community.</p></div></div>
    <label>Repository<select aria-label="Skill repository" value={source?.id ?? ''} disabled={busy} onChange={e => setSourceId(e.target.value)}>{state.sources.map(s => <option key={s.id} value={s.id}>{s.id}</option>)}</select></label>
    {source && <><div className="skill-marketplace-actions"><button type="button" disabled={busy} onClick={() => void run(async () => { setState(await window.nodus.updateSkillSource(source.id)); setNotice('Catalog updated. Installed skills are unchanged.'); })}>{busy ? 'Working…' : 'Update catalog'}</button><button type="button" disabled={busy} onClick={() => void run(async () => { setState(await window.nodus.removeSkillSource(source.id)); setNotice('Repository removed. Installed skills remain available.'); })}>Remove source</button></div>
      <small>{official ? 'Official Nodus repository' : 'Community source · not reviewed by Nodus'}{source.updatedAt ? ` · Updated ${new Date(source.updatedAt).toLocaleString()}` : ' · Update to discover skills'}</small></>}
    <form onSubmit={e => { e.preventDefault(); void run(async () => { const value = await window.nodus.addSkillSource(url); setState(value); setSourceId(value.sources[value.sources.length - 1].id); setUrl(''); }); }} className="skill-marketplace-source"><label>Add a repository<input aria-label="Repository URL" type="url" required placeholder="https://github.com/owner/repository" value={url} onChange={e => setUrl(e.target.value)} /></label><button type="submit" disabled={busy || !url.trim()}>Add source</button></form>
    {review && source ? <article className="skill-marketplace-review">
      <button type="button" onClick={() => setReview(null)}>← Back to catalog</button><h4>{review.package.manifest.name}</h4><p>@{review.package.manifest.author} · {review.package.manifest.version} · {review.package.manifest.license}</p>
      <p>{review.package.manifest.description}</p><p><b>Capabilities:</b> {review.package.manifest.capabilities.join(', ') || 'No native capabilities'}{review.package.manifest.tools.length ? ` · ${review.package.manifest.tools.length} sandboxed JavaScript tools` : ''}</p>
      <small>JavaScript tools cannot access your files, credentials, network or Nodus data. Image generation uses your configured provider and may incur its normal costs.</small>
      {Object.entries(review.package.files).map(([name, content]) => <details key={name}><summary>{name}</summary><pre>{content}</pre></details>)}
      {!!unsupported.length && <p role="status">Requires a compatible Nodus build with native support for: {unsupported.join(', ')}. This build cannot install this skill.</p>}
      <p>{installed ? 'Reinstalling replaces your local edits and disables this skill on both surfaces.' : 'Installed skills start disabled. Enable them in My skills for Assistant or Nodi.'}</p>
      <button className="chat-skill-primary" type="button" disabled={busy || !!unsupported.length} onClick={() => void run(async () => { await window.nodus.installMarketplaceSkill(source.id, review.path, source.commit!); setReview(null); setNotice('Skill installed. Enable it in My skills.'); })}>{installed ? 'Replace installed skill' : 'Install skill'}</button>
    </article> : <>
      <label>Find a skill<input type="search" aria-label="Search marketplace" placeholder="Name, creator or description" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <label>Category<select aria-label="Marketplace category" value={category} onChange={e => setCategory(e.target.value)}><option value="">All categories</option>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
      {!entries.length && <p className="chat-skills-empty">{source?.updatedAt ? 'No matching skills.' : 'Update a repository to load its catalog.'}</p>}
      {categories.filter(c => entries.some(e => e.package.manifest.category === c)).map(c => <section key={c}><h4>{c}</h4>{entries.filter(e => e.package.manifest.category === c).map(entry => {
        const m = entry.package.manifest; const present = skills.find(s => s.origin?.sourceId === source?.id && s.origin?.packageId === m.id);
        return <article className="chat-skill-item" key={entry.path}><b>{m.name}</b><small>@{m.author} · {m.version}{present ? ` · Installed ${present.origin?.version}` : ''}</small><p>{m.description}</p><button type="button" disabled={busy} onClick={() => setReview(entry)}>Review {present ? 'update' : 'skill'}</button></article>;
      })}</section>)}
    </>}
    {!!source?.errors.length && <details><summary>{source.errors.length} invalid packages skipped</summary>{source.errors.map((e, i) => <p key={i}>{e}</p>)}</details>}
    <p className="skill-marketplace-policy">The official marketplace rejects skills that promote illegal activity, piracy, license circumvention, malware or unauthorized access. Independent sources are maintained by their owners.</p>
    <button type="button" onClick={() => void window.nodus.openExternal(`${DEFAULT_SKILL_SOURCE}/blob/main/CONTRIBUTING.md`)}>Create and submit a skill ↗</button>
    {notice && <p role="status">{notice}</p>}{error && <p className="chat-skill-error" role="alert">{error}</p>}
  </div>;
}
