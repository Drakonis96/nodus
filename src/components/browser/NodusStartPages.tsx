import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../ui';
import atlasCatalogue from '../../../site/data/research-atlas.json';
import type {
  BrowserBookmark,
  BrowserBookmarkCandidate,
  BrowserBookmarkNodeRef,
  BrowserBookmarkStore,
} from '@shared/browserBookmarks';
import {
  browserBookmarkChildren,
  browserBookmarkFolderPath,
  canonicalBookmarkUrl,
  searchBrowserBookmarks,
} from '@shared/browserBookmarks';
import {
  NODUS_BOOKMARKS_URL,
  NODUS_RESEARCH_ATLAS_URL,
  NODUS_RESEARCH_ATLAS_START_URL,
} from '@shared/browser';
import './NodusBookmarks.css';

const NODUS_SITE = 'https://nodusresearch.com/';
const NODUS_REPOSITORY = 'https://github.com/Drakonis96/nodus';
const NODUS_LOGO = new URL('../../../site/assets/nodus-logo.svg', import.meta.url).href;
const NODUS_ORGANISM_SCRIPT = new URL('../../../site/assets/js/organism.js', import.meta.url).href;

interface NodusOrganismController {
  start(): void;
  stop(): void;
  resize(): void;
  pointer(x: number, y: number): void;
  pointerOut(): void;
  pulse(x: number, y: number, strength: number): void;
  scrolled(velocity: number): void;
}

declare global {
  interface Window {
    NodusOrganismFactory?: { create(canvas: HTMLCanvasElement): NodusOrganismController | null };
  }
}

interface AtlasResource {
  id: string; name: string; url: string; description: string; access_model?: string;
  geography?: { continent?: string | null; country?: string | null; region?: string | null };
  knowledge_domains?: string[]; type_of_use?: string[];
}

function openSitePage(url: string) {
  if (url === NODUS_RESEARCH_ATLAS_START_URL) {
    void window.nodus.navigateBrowserStartPage('atlas');
    return;
  }
  if (url === NODUS_BOOKMARKS_URL) {
    void window.nodus.navigateBrowserStartPage('bookmarks');
    return;
  }
  void window.nodus.submitBrowserOmnibox(url);
}

function SiteLink({ label, url, className = '', current = false, onOpen }: {
  label: string; url: string; className?: string; current?: boolean; onOpen?: () => void;
}) {
  return <button type="button" className={className} aria-current={current ? 'page' : undefined} onClick={() => { onOpen?.(); openSitePage(url); }}>{label}</button>;
}

function NodusSiteBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let organism: NodusOrganismController | null = null;
    const removers: Array<() => void> = [];
    const listen = (target: EventTarget, type: string, handler: EventListener) => {
      target.addEventListener(type, handler, { passive: true });
      removers.push(() => target.removeEventListener(type, handler));
    };

    const mount = () => {
      if (disposed || organism || !window.NodusOrganismFactory) return;
      organism = window.NodusOrganismFactory.create(canvas);
      if (!organism) {
        canvas.classList.add('organism-unavailable');
        return;
      }
      organism.start();
      requestAnimationFrame(() => { if (!disposed) canvas.classList.add('awake'); });

      const page = canvas.closest<HTMLElement>('.nodus-start-page');
      let previousScroll = page?.scrollTop ?? 0;
      let resizeTimer = 0;
      listen(window, 'resize', (() => {
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(() => organism?.resize(), 140);
      }) as EventListener);
      listen(window, 'pointermove', ((event: PointerEvent) => organism?.pointer(event.clientX, event.clientY)) as EventListener);
      listen(window, 'pointerleave', (() => organism?.pointerOut()) as EventListener);
      listen(window, 'pointerdown', ((event: PointerEvent) => organism?.pulse(event.clientX, event.clientY, 1)) as EventListener);
      if (page) listen(page, 'scroll', (() => {
        const next = page.scrollTop;
        organism?.scrolled(next - previousScroll);
        previousScroll = next;
      }) as EventListener);
      listen(document, 'visibilitychange', (() => {
        if (document.hidden) organism?.stop(); else organism?.start();
      }) as EventListener);
      removers.push(() => window.clearTimeout(resizeTimer));
    };

    if (window.NodusOrganismFactory) mount();
    else {
      const existing = document.querySelector<HTMLScriptElement>('script[data-nodus-organism]');
      const script = existing ?? document.createElement('script');
      const onLoad = () => mount();
      script.addEventListener('load', onLoad, { once: true });
      removers.push(() => script.removeEventListener('load', onLoad));
      if (!existing) {
        script.src = NODUS_ORGANISM_SCRIPT;
        script.dataset.nodusOrganism = 'true';
        document.head.appendChild(script);
      }
    }

    return () => {
      disposed = true;
      for (const remove of removers.splice(0)) remove();
      organism?.stop();
      canvas.classList.remove('awake');
    };
  }, []);

  return <div className="nodus-site-backdrop" aria-hidden="true">
    <canvas ref={canvasRef} className="nodus-site-organism" data-organism-managed="host" />
  </div>;
}

function NodusSiteHeader({ page }: { page: 'atlas' | 'bookmarks' }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return <header className="nodus-site-header" data-testid="nodus-site-header">
    <button type="button" className="nodus-site-logo" aria-label="Nodus Research, home" onClick={() => openSitePage(NODUS_SITE)}><img src={NODUS_LOGO} alt="" /> Nodus</button>
    <button type="button" className="nodus-site-nav-toggle" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen((value) => !value)}><span /><span /><span /></button>
    <nav className={`nodus-site-links${open ? ' open' : ''}`} aria-label="Nodus Research">
      <SiteLink className="nodus-site-link" label="Home" url={NODUS_SITE} onOpen={close} />
      <SiteLink className="nodus-site-link" label="Atlas" url={NODUS_RESEARCH_ATLAS_URL} current={page === 'atlas'} onOpen={close} />
      <SiteLink className="nodus-site-link" label="Bookmarks" url={NODUS_BOOKMARKS_URL} current={page === 'bookmarks'} onOpen={close} />
      <SiteLink className="nodus-site-link" label="Wiki" url={`${NODUS_SITE}wiki/`} onOpen={close} />
      <SiteLink className="nodus-site-link" label="Blog" url={`${NODUS_SITE}blog/`} onOpen={close} />
      <SiteLink className="nodus-site-link" label="Contribute" url={`${NODUS_SITE}contribute/`} onOpen={close} />
      <SiteLink className="nodus-site-link" label="FAQ" url={`${NODUS_SITE}faq/`} onOpen={close} />
      <span className="nodus-site-nav-sep" aria-hidden="true" />
      <SiteLink className="nodus-site-badge" label="Star on GitHub" url={NODUS_REPOSITORY} onOpen={close} />
      <SiteLink className="nodus-site-primary" label="Try the live demo" url={`${NODUS_SITE}demo/`} onOpen={close} />
    </nav>
  </header>;
}

const FOOTER_GROUPS = [
  { title: 'Research', links: [['Research Atlas', NODUS_RESEARCH_ATLAS_URL], ['Nodus Bookmarks', NODUS_BOOKMARKS_URL], ['The Nodus App', `${NODUS_SITE}app/`], ['Academic research', `${NODUS_SITE}research/`], ['Nodus and Zotero', `${NODUS_SITE}zotero/`]] },
  { title: 'Product', links: [['The four vaults', `${NODUS_SITE}#vaults`], ['Other vaults', `${NODUS_SITE}#more-vaults`], ['Nodus Toolkit', `${NODUS_SITE}#tools`], ['Live demos', `${NODUS_SITE}demo/`]] },
  { title: 'Learn', links: [['Wiki', `${NODUS_SITE}wiki/`], ['Blog', `${NODUS_SITE}blog/`], ['FAQ', `${NODUS_SITE}faq/`], ['Video tutorials', `${NODUS_SITE}wiki/#videos`]] },
  { title: 'Project', links: [['Contribute', `${NODUS_SITE}contribute/`], ['GitHub', NODUS_REPOSITORY], ['Releases', `${NODUS_REPOSITORY}/releases`], ['AGPL-3.0-only', `${NODUS_REPOSITORY}/blob/main/LICENSE`]] },
] as const;

function NodusSiteFooter() {
  return <footer className="nodus-site-footer" data-testid="nodus-site-footer"><div className="nodus-site-wrap">
    <div className="nodus-site-foot-grid">
      <div className="nodus-site-foot-brand"><span className="nodus-site-foot-logo"><img src={NODUS_LOGO} alt="" /> Nodus</span><p>A free, open-source, local-first research workspace for connecting sources, ideas and evidence. Your corpus stays on your machine.</p></div>
      {FOOTER_GROUPS.map((group) => <div className="nodus-site-foot-col" key={group.title}><h3>{group.title}</h3>{group.links.map(([label, url]) => <SiteLink key={label} label={label} url={url} />)}</div>)}
    </div>
    <div className="nodus-site-foot-base"><span>© 2026 Jorge Pérez Burgueño and Nodus contributors.</span><SiteLink label="Privacy" url={`${NODUS_REPOSITORY}/blob/main/PRIVACY.md`} /><SiteLink label="Code of conduct" url={`${NODUS_REPOSITORY}/blob/main/CODE_OF_CONDUCT.md`} /><SiteLink label="Security" url={`${NODUS_REPOSITORY}/blob/main/SECURITY.md`} /></div>
  </div></footer>;
}

function StartShell({ title, copy, query, onQuery, status, children, toolbar }: {
  title: string; copy: string; query: string; onQuery: (value: string) => void;
  status: string; children: React.ReactNode; toolbar?: React.ReactNode;
}) {
  const page = title === 'Nodus Bookmarks' ? 'bookmarks' : 'atlas';
  return (
    <main className="nodus-start-page atlas-main">
      <NodusSiteBackdrop />
      <NodusSiteHeader page={page} />
      <div className="nodus-site-content atlas-shell">
        <div className="atlas-intro">
          <h1 className="atlas-title">{title}</h1>
          <p className="atlas-copy">{copy}</p>
          <div className="atlas-search-wrap">
            <div className={`atlas-searchbar${page === 'bookmarks' ? ' is-bookmarks' : ''}`}>
              {page !== 'bookmarks' && <>
                <div className="atlas-engine-wrap"><span className="atlas-engine flex items-center">Nodus</span></div>
                <span className="atlas-search-sep" aria-hidden="true" />
              </>}
              <div className="atlas-input-wrap">
                <Icon name="search" size={19} className="atlas-search-icon" />
                <input
                  className="atlas-search"
                  type="search"
                  value={query}
                  aria-label={`Search ${title}`}
                  placeholder={title === 'Nodus Bookmarks' ? 'Search bookmarks…' : 'Search the research directory…'}
                  onChange={(event) => onQuery(event.target.value)}
                />
                {query && <button className="atlas-clear" type="button" aria-label="Clear search" onClick={() => onQuery('')}>×</button>}
              </div>
              <button className="atlas-submit" type="button" aria-label="Search"><Icon name="search" size={18} /></button>
            </div>
            {toolbar}
            <p className="atlas-status" aria-live="polite">{status}</p>
          </div>
        </div>
        <div className="atlas-grid">{children}</div>
      </div>
      <NodusSiteFooter />
    </main>
  );
}

export function NodusBookmarksPage({ store, onEditBookmark, onNewBookmark, onNewFolder }: {
  store: BrowserBookmarkStore;
  onEditBookmark: (bookmark: BrowserBookmark) => void;
  onNewBookmark: (parentId: string | null) => void;
  onNewFolder: (parentId: string | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<BrowserBookmarkNodeRef | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const folder = store.folders.find((entry) => entry.id === folderId) ?? null;
  useEffect(() => { if (folderId && !folder) setFolderId(null); }, [folder, folderId]);
  useEffect(() => {
    document.querySelector<HTMLElement>('.nodus-start-page')?.scrollTo({ top: 0, left: 0 });
  }, [folderId]);

  const results = useMemo(() => searchBrowserBookmarks(store, query), [query, store]);
  const childRefs = useMemo(() => browserBookmarkChildren(store, folderId), [folderId, store]);
  const folders = query ? [] : childRefs.filter((ref) => ref.kind === 'folder').map((ref) => store.folders.find((entry) => entry.id === ref.id)!).filter(Boolean);
  const bookmarks = query
    ? results.map((entry) => entry.bookmark)
    : childRefs.filter((ref) => ref.kind === 'bookmark').map((ref) => store.bookmarks.find((entry) => entry.id === ref.id)!).filter(Boolean);
  const pathFolders = useMemo(() => {
    const entries = [];
    let cursor = folder;
    while (cursor) {
      entries.unshift(cursor);
      cursor = store.folders.find((entry) => entry.id === cursor?.parentId) ?? null;
    }
    return entries;
  }, [folder, store.folders]);

  const move = async (targetParent: string | null) => {
    if (!dragging) return;
    try {
      const count = browserBookmarkChildren(store, targetParent).length;
      await window.nodus.moveBrowserBookmarkNode(dragging, targetParent, count);
    } finally { setDragging(null); setDropId(null); }
  };

  return (
    <StartShell
      title="Nodus Bookmarks"
      copy="Your private, local research start page. Organise the websites you save in folders without sending bookmark data anywhere."
      query={query}
      onQuery={setQuery}
      status={query ? `${bookmarks.length} results · global search` : `${folders.length} folders · ${bookmarks.length} bookmarks`}
      toolbar={<>
        <div className="atlas-filterbar">
          <button className="atlas-facet-button" type="button" onClick={() => onNewFolder(folderId)}><Icon name="folderPlus" size={13} /> New folder</button>
          <button className="atlas-facet-button" type="button" onClick={() => onNewBookmark(folderId)}><Icon name="bookmark" size={13} /> Add bookmark</button>
          <button className="atlas-facet-button" type="button" onClick={() => void window.nodus.openBrowserTab(NODUS_RESEARCH_ATLAS_URL)}><Icon name="globe" size={13} /> Research Atlas</button>
        </div>
        {!query && <div className="bookmark-breadcrumbs"><button onClick={() => setFolderId(null)}>Bookmarks</button>{pathFolders.map((entry) => <span key={entry.id}> / <button onClick={() => setFolderId(entry.id)}>{entry.name}</button></span>)}</div>}
      </>}
    >
      {folders.map((entry) => (
        <article
          key={entry.id}
          className={`card lit atlas-card${dropId === entry.id ? ' bookmark-drop' : ''}`}
          draggable
          onDragStart={() => setDragging({ kind: 'folder', id: entry.id })}
          onDragOver={(event) => { event.preventDefault(); setDropId(entry.id); }}
          onDragLeave={() => setDropId(null)}
          onDrop={(event) => { event.preventDefault(); void move(entry.id); }}
        >
          <div className="bookmark-heading"><span className="bookmark-folder-icon"><Icon name="folder" size={19} /></span><h2><button type="button" onClick={() => setFolderId(entry.id)}>{entry.name}</button></h2></div>
          <div className="atlas-geo">Folder · {browserBookmarkChildren(store, entry.id).length} items</div>
          <p className="atlas-description">Open this folder to browse its saved research resources and nested folders.</p>
          <div className="atlas-card-actions"><button className="atlas-open" type="button" onClick={() => setFolderId(entry.id)}>Open folder <Icon name="chevronRight" size={13} /></button></div>
        </article>
      ))}
      {bookmarks.map((entry) => {
        const location = browserBookmarkFolderPath(store, entry.parentId);
        return (
          <article key={entry.id} className="card lit atlas-card" draggable onDragStart={() => setDragging({ kind: 'bookmark', id: entry.id })}>
            <div className="atlas-card-top"><div className="bookmark-heading">{entry.faviconDataUrl ? <img className="bookmark-favicon" src={entry.faviconDataUrl} alt="" /> : <Icon name="globe" size={22} />}<h2><button type="button" onClick={() => void window.nodus.openBrowserTab(entry.url)}>{entry.title}</button></h2></div><span className="atlas-access">Saved</span></div>
            <div className="atlas-geo">{new URL(entry.url).hostname}{location.length ? ` · ${location.join(' › ')}` : ''}</div>
            <p className="atlas-description">{entry.description || 'A website saved privately in Nodus Bookmarks.'}</p>
            <div className="atlas-card-actions">
              <button className="atlas-open" type="button" onClick={() => void window.nodus.openBrowserTab(entry.url)}>Open <Icon name="external" size={13} /></button>
              <button className="atlas-open" type="button" onClick={() => onEditBookmark(entry)}>Edit</button>
              <button className="atlas-open" type="button" onClick={() => void navigator.clipboard.writeText(entry.url)}>Copy URL</button>
            </div>
          </article>
        );
      })}
      {!folders.length && !bookmarks.length && (
        <div className="atlas-empty"><h2>{query ? 'No matching bookmarks' : folder ? 'This folder is empty' : 'No bookmarks yet'}</h2><p>{query ? 'Search includes titles, URLs, descriptions and folder names.' : 'Save websites from Nodus Browser or Research Atlas to build your personal research start page.'}</p><div className="flex justify-center gap-2"><button className="atlas-open" onClick={() => onNewBookmark(folderId)}>Add a bookmark</button><button className="atlas-open" onClick={() => void window.nodus.openBrowserTab(NODUS_RESEARCH_ATLAS_URL)}>Open Research Atlas</button></div></div>
      )}
    </StartShell>
  );
}

export function NodusResearchAtlasPage({ store, onSave }: {
  store: BrowserBookmarkStore;
  onSave: (candidate: BrowserBookmarkCandidate) => void;
}) {
  const resources = (atlasCatalogue.resources ?? []) as AtlasResource[];
  const [query, setQuery] = useState('');
  const [area, setArea] = useState('');
  const [kind, setKind] = useState('');
  const areas = useMemo(() => [...new Set(resources.flatMap((entry) => entry.knowledge_domains ?? []))].sort(), [resources]);
  const kinds = useMemo(() => [...new Set(resources.flatMap((entry) => entry.type_of_use ?? []))].sort(), [resources]);
  const saved = useMemo(() => new Set(store.bookmarks.map((entry) => canonicalBookmarkUrl(entry.url)).filter(Boolean)), [store]);
  const visible = useMemo(() => {
    const needle = query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return resources.filter((entry) => {
      const haystack = [entry.name, entry.url, entry.description, ...(entry.knowledge_domains ?? []), ...(entry.type_of_use ?? []), entry.geography?.continent, entry.geography?.country, entry.geography?.region].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      return (!needle || haystack.includes(needle)) && (!area || entry.knowledge_domains?.includes(area)) && (!kind || entry.type_of_use?.includes(kind));
    });
  }, [area, kind, query, resources]);
  return (
    <StartShell title="Research Atlas" copy="Search and filter a curated international directory of research websites, digital libraries, archives, repositories and primary-source collections." query={query} onQuery={setQuery} status={`${visible.length} of ${resources.length} resources`} toolbar={
      <div className="atlas-filterbar">
        <select className={`atlas-facet-button${area ? ' is-active' : ''}`} value={area} onChange={(event) => setArea(event.target.value)}><option value="">Knowledge area</option>{areas.map((value) => <option key={value}>{value}</option>)}</select>
        <select className={`atlas-facet-button${kind ? ' is-active' : ''}`} value={kind} onChange={(event) => setKind(event.target.value)}><option value="">Resource type</option>{kinds.map((value) => <option key={value}>{value}</option>)}</select>
        {(area || kind || query) && <button className="atlas-reset" onClick={() => { setArea(''); setKind(''); setQuery(''); }}>Clear filters</button>}
        <button className="atlas-facet-button" type="button" onClick={() => void window.nodus.openBrowserTab(NODUS_RESEARCH_ATLAS_URL)}><Icon name="external" size={13} /> Public Atlas</button>
      </div>}
    >
      {visible.map((entry) => {
        const isSaved = saved.has(canonicalBookmarkUrl(entry.url));
        const geo = [entry.geography?.continent, entry.geography?.country, entry.geography?.region].filter(Boolean).join(' · ');
        return <article key={entry.id} className="card lit atlas-card">
          <div className="atlas-card-top"><h2><button type="button" onClick={() => void window.nodus.openBrowserTab(entry.url)}>{entry.name}</button></h2><span className="atlas-access">{entry.access_model || 'resource'}</span></div>
          <div className="atlas-geo">{geo}</div><p className="atlas-description">{entry.description}</p>
          <dl className="atlas-meta"><div className="atlas-meta-row"><dt>Knowledge</dt><dd>{entry.knowledge_domains?.join(' · ')}</dd></div><div className="atlas-meta-row"><dt>Use</dt><dd>{entry.type_of_use?.join(' · ')}</dd></div></dl>
          <div className="atlas-card-actions"><button className="atlas-open" onClick={() => void window.nodus.openBrowserTab(entry.url)}>Open resource <Icon name="external" size={13} /></button><button className={`atlas-open${isSaved ? ' is-saved' : ''}`} disabled={isSaved} onClick={() => onSave({ title: entry.name, url: entry.url, description: entry.description, faviconDataUrl: null, existingId: null })}><Icon name={isSaved ? 'bookmarkFill' : 'bookmark'} size={13} />{isSaved ? 'Saved' : 'Save'}</button></div>
        </article>;
      })}
      {!visible.length && <div className="atlas-empty">No resources match the current search and filters.</div>}
    </StartShell>
  );
}
