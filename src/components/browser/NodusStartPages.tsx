import { useEffect, useMemo, useState } from 'react';
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
import { NODUS_RESEARCH_ATLAS_URL, NODUS_RESEARCH_ATLAS_START_URL } from '@shared/browser';
import './NodusBookmarks.css';

interface AtlasResource {
  id: string; name: string; url: string; description: string; access_model?: string;
  geography?: { continent?: string | null; country?: string | null; region?: string | null };
  knowledge_domains?: string[]; type_of_use?: string[];
}

function useLightTheme(): boolean {
  const read = () => !document.documentElement.classList.contains('dark');
  const [light, setLight] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setLight(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return light;
}

function StartShell({ title, copy, query, onQuery, status, children, toolbar }: {
  title: string; copy: string; query: string; onQuery: (value: string) => void;
  status: string; children: React.ReactNode; toolbar?: React.ReactNode;
}) {
  const light = useLightTheme();
  return (
    <main className={`nodus-start-page atlas-main${light ? ' nodus-start-light' : ''}`}>
      <div className="atlas-shell">
        <div className="atlas-intro">
          <h1 className="atlas-title">{title}</h1>
          <p className="atlas-copy">{copy}</p>
          <div className="atlas-search-wrap">
            <div className="atlas-searchbar">
              <div className="atlas-engine-wrap"><span className="atlas-engine flex items-center">Nodus</span></div>
              <span className="atlas-search-sep" aria-hidden="true" />
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
          <button className="atlas-facet-button" type="button" onClick={() => void window.nodus.openBrowserTab(NODUS_RESEARCH_ATLAS_START_URL)}><Icon name="globe" size={13} /> Research Atlas</button>
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
        <div className="atlas-empty"><h2>{query ? 'No matching bookmarks' : folder ? 'This folder is empty' : 'No bookmarks yet'}</h2><p>{query ? 'Search includes titles, URLs, descriptions and folder names.' : 'Save websites from Nodus Browser or Research Atlas to build your personal research start page.'}</p><div className="flex justify-center gap-2"><button className="atlas-open" onClick={() => onNewBookmark(folderId)}>Add a bookmark</button><button className="atlas-open" onClick={() => void window.nodus.openBrowserTab(NODUS_RESEARCH_ATLAS_START_URL)}>Open Research Atlas</button></div></div>
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
