import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ConfirmModal } from '../ConfirmModal';
import { Icon } from '../ui';
import { t, tx } from '../../i18n';
import atlasCatalogue from '../../../site/data/research-atlas.json';
import type {
  BrowserBookmark,
  BrowserBookmarkCandidate,
  BrowserBookmarkNodeRef,
  BrowserBookmarkStore,
  BrowserBookmarksImportPreview,
} from '@shared/browserBookmarks';
import {
  browserBookmarkChildren,
  browserBookmarkFolderPath,
  browserBookmarksExportFileName,
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
  label: ReactNode; url: string; className?: string; current?: boolean; onOpen?: () => void;
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
  const headerRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [stars, setStars] = useState<string>('·');
  const [downloads, setDownloads] = useState<string>('—');
  useEffect(() => {
    const controller = new AbortController();
    const compact = (value: number) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
    void fetch('https://api.github.com/repos/Drakonis96/nodus', { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((result) => { if (typeof result?.stargazers_count === 'number') setStars(compact(result.stargazers_count)); })
      .catch(() => {});
    void fetch(`${NODUS_SITE}data/github-release-downloads.json`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((result) => { if (typeof result?.total === 'number') setDownloads(compact(result.total)); })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!open) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); toggleRef.current?.focus(); }
    };
    const pointerdown = (event: PointerEvent) => {
      if (event.target instanceof Node && !headerRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('keydown', keydown);
    document.addEventListener('pointerdown', pointerdown);
    return () => {
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('pointerdown', pointerdown);
    };
  }, [open]);
  return <header ref={headerRef} className="nodus-site-header" data-testid="nodus-site-header">
    <button type="button" className="nodus-site-logo" aria-label={t('Nodus Research, inicio')} onClick={() => openSitePage(NODUS_SITE)}><img src={NODUS_LOGO} alt="" /> Nodus Research</button>
    <button ref={toggleRef} type="button" className="nodus-site-nav-toggle" aria-controls="nodus-start-site-links" aria-label={open ? t('Cerrar menú') : t('Abrir menú')} aria-expanded={open} onClick={() => setOpen((value) => !value)}><span /><span /><span /></button>
    <nav id="nodus-start-site-links" className={`nodus-site-links${open ? ' open' : ''}`} aria-label="Nodus Research">
      <SiteLink className="nodus-site-link" label="Home" url={NODUS_SITE} onOpen={close} />
      <SiteLink className="nodus-site-link" label="Bookmarks" url={NODUS_BOOKMARKS_URL} current={page === 'bookmarks'} onOpen={close} />
      <SiteLink className="nodus-site-link" label="Wiki" url={`${NODUS_SITE}wiki/`} onOpen={close} />
      <SiteLink className="nodus-site-link" label="Blog" url={`${NODUS_SITE}blog/`} onOpen={close} />
      <SiteLink className="nodus-site-link" label="Atlas" url={NODUS_RESEARCH_ATLAS_URL} current={page === 'atlas'} onOpen={close} />
      <SiteLink className="nodus-site-link" label="FAQ" url={`${NODUS_SITE}faq/`} onOpen={close} />
      <SiteLink className="nodus-site-link" label="About" url={`${NODUS_SITE}about/`} onOpen={close} />
      <SiteLink className="nodus-site-link" label="Support Nodus" url={`${NODUS_SITE}contribute/`} onOpen={close} />
      <span className="nodus-site-nav-sep" aria-hidden="true" />
      <SiteLink className="nodus-site-badge" label={<><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg><span>Star</span><span className="nodus-site-stars"><Icon name="star" size={12} />{stars}</span></>} url={NODUS_REPOSITORY} onOpen={close} />
      <SiteLink className="nodus-site-badge nodus-site-downloads" label={<><Icon name="download" size={14} /><span>{downloads}</span><span>downloads</span></>} url={`${NODUS_REPOSITORY}/releases`} onOpen={close} />
      <SiteLink className="nodus-site-primary" label="Try the live demo" url={`${NODUS_SITE}demo/`} onOpen={close} />
    </nav>
  </header>;
}

const FOOTER_GROUPS = [
  { title: 'Investigación', links: [['Research Atlas', NODUS_RESEARCH_ATLAS_URL], ['Nodus Bookmarks', NODUS_BOOKMARKS_URL], ['La aplicación Nodus', `${NODUS_SITE}app/`], ['Investigación académica', `${NODUS_SITE}research/`], ['Nodus y Zotero', `${NODUS_SITE}zotero/`]] },
  { title: 'Producto', links: [['Las cuatro bóvedas', `${NODUS_SITE}#vaults`], ['Otras bóvedas', `${NODUS_SITE}#more-vaults`], ['Nodus Toolkit', `${NODUS_SITE}#tools`], ['Demos en vivo', `${NODUS_SITE}demo/`]] },
  { title: 'Aprender', links: [['Wiki', `${NODUS_SITE}wiki/`], ['Blog', `${NODUS_SITE}blog/`], ['FAQ', `${NODUS_SITE}faq/`], ['Tutoriales en vídeo', `${NODUS_SITE}wiki/#videos`]] },
  { title: 'Proyecto', links: [['Colaborar', `${NODUS_SITE}contribute/`], ['GitHub', NODUS_REPOSITORY], ['Versiones', `${NODUS_REPOSITORY}/releases`], ['AGPL-3.0-only', `${NODUS_REPOSITORY}/blob/main/LICENSE`]] },
] as const;

function NodusSiteFooter() {
  return <footer className="nodus-site-footer" data-testid="nodus-site-footer"><div className="nodus-site-wrap">
    <div className="nodus-site-foot-grid">
      <div className="nodus-site-foot-brand"><span className="nodus-site-foot-logo"><img src={NODUS_LOGO} alt="" /> Nodus Research</span><p>{t('Un espacio de investigación gratuito, de código abierto y local para conectar fuentes, ideas y pruebas. Tu corpus permanece en tu máquina.')}</p></div>
      {FOOTER_GROUPS.map((group) => <div className="nodus-site-foot-col" key={group.title}><h3>{t(group.title)}</h3>{group.links.map(([label, url]) => <SiteLink key={label} label={t(label)} url={url} />)}</div>)}
    </div>
    <div className="nodus-site-foot-base"><span>{t('© 2026 Jorge Pérez Burgueño y colaboradores de Nodus.')}</span><SiteLink label={t('Privacidad')} url={`${NODUS_REPOSITORY}/blob/main/PRIVACY.md`} /><SiteLink label={t('Código de conducta')} url={`${NODUS_REPOSITORY}/blob/main/CODE_OF_CONDUCT.md`} /><SiteLink label={t('Seguridad')} url={`${NODUS_REPOSITORY}/blob/main/SECURITY.md`} /></div>
  </div></footer>;
}

function StartShell({ title, copy, query, onQuery, status, children, toolbar }: {
  title: string; copy: string; query: string; onQuery: (value: string) => void;
  status: string; children: React.ReactNode; toolbar?: React.ReactNode;
}) {
  const page = title === 'Nodus Bookmarks' ? 'bookmarks' : 'atlas';
  return (
    <main className={`nodus-start-page atlas-main ${page === 'bookmarks' ? 'bookmarks-main' : 'research-atlas-main'}`}>
      <NodusSiteBackdrop />
      <NodusSiteHeader page={page} />
      <div className="nodus-site-content atlas-shell">
        <div className="atlas-intro">
          <h1 className="atlas-title">{title}</h1>
          <p className="atlas-copy">{copy}</p>
          <div className="atlas-search-wrap">
            <div className={`atlas-searchbar${page === 'bookmarks' ? ' is-bookmarks' : ''}`}>
              {page !== 'bookmarks' && <>
                <div className="atlas-engine-wrap"><span className="atlas-engine flex items-center">Nodus Research</span></div>
                <span className="atlas-search-sep" aria-hidden="true" />
              </>}
              <div className="atlas-input-wrap">
                <Icon name="search" size={19} className="atlas-search-icon" />
                <input
                  className="atlas-search"
                  type="search"
                  value={query}
                  aria-label={tx('Buscar en {title}', { title })}
                  placeholder={title === 'Nodus Bookmarks' ? t('Buscar marcadores…') : t('Buscar en el directorio de investigación…')}
                  onChange={(event) => onQuery(event.target.value)}
                />
                {query && <button className="atlas-clear" type="button" aria-label={t('Borrar búsqueda')} onClick={() => onQuery('')}>×</button>}
              </div>
              <button className="atlas-submit" type="button" aria-label={t('Buscar')}><Icon name="search" size={18} /></button>
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

export function NodusBookmarksPage({ store, onEditBookmark, onNewBookmark, onNewFolder, onNotice }: {
  store: BrowserBookmarkStore;
  onEditBookmark: (bookmark: BrowserBookmark) => void;
  onNewBookmark: (parentId: string | null) => void;
  onNewFolder: (parentId: string | null) => void;
  onNotice: (message: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<BrowserBookmarkNodeRef | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ ref: BrowserBookmarkNodeRef; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<BrowserBookmarksImportPreview | null>(null);
  // ConfirmModal cannot disable its own confirm button, so the dialog is kept
  // from committing twice by a ref rather than by the state it renders from.
  const importBusy = useRef(false);
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
  const missingFaviconKey = bookmarks.filter((entry) => !entry.faviconDataUrl).map((entry) => entry.id).join('\n');
  useEffect(() => {
    if (missingFaviconKey) void window.nodus.resolveBrowserBookmarkFavicons(missingFaviconKey.split('\n'));
  }, [missingFaviconKey]);
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

  // The main process writes its own snapshot of the whole collection, so neither
  // an active search nor the folder on screen can narrow the exported file.
  const exportHtml = async () => {
    if (exporting) return;
    const suggestedName = browserBookmarksExportFileName('html');
    setExporting(true);
    try {
      const result = await window.nodus.exportBrowserBookmarks('html');
      if (result.canceled) {
        onNotice(t('Exportación cancelada.'));
        return;
      }
      onNotice(tx('Se exportaron {bookmarks} marcadores y {folders} carpetas en {file}.', {
        bookmarks: result.bookmarks,
        folders: result.folders,
        file: result.fileName ?? suggestedName,
      }));
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setExporting(false);
    }
  };

  const remove = async () => {
    if (!deleteConfirmation || deleting) return;
    setDeleting(true);
    try {
      await window.nodus.deleteBrowserBookmarkNode(deleteConfirmation.ref);
      setDeleteConfirmation(null);
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDeleting(false);
    }
  };

  // Import reuses the trusted preview/commit pair the manager already uses: the
  // chosen file is parsed and merged to a preview first, and nothing reaches the
  // collection until the summary is confirmed.
  const importFile = async () => {
    if (importBusy.current) return;
    importBusy.current = true;
    setImporting(true);
    try {
      const preview = await window.nodus.previewBrowserBookmarksImport();
      if (!preview) onNotice(t('Importación cancelada.'));
      else setImportPreview(preview);
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      importBusy.current = false;
      setImporting(false);
    }
  };

  const commitImport = async () => {
    if (!importPreview || importBusy.current) return;
    importBusy.current = true;
    setImporting(true);
    try {
      const result = await window.nodus.commitBrowserBookmarksImport(importPreview.token);
      setImportPreview(null);
      onNotice(tx('Se importaron {bookmarks} marcadores y {folders} carpetas. Se omitieron {duplicates} duplicados.', {
        bookmarks: result.summary.bookmarks,
        folders: result.summary.folders,
        duplicates: result.summary.duplicates,
      }));
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      importBusy.current = false;
      setImporting(false);
    }
  };

  return (
    <StartShell
      title="Nodus Bookmarks"
      copy="Your private, local research start page. Organise the websites you save in folders without sending bookmark data anywhere."
      query={query}
      onQuery={setQuery}
      status={query ? tx('{results} resultados · búsqueda global', { results: bookmarks.length }) : tx('{folders} carpetas · {bookmarks} marcadores', { folders: folders.length, bookmarks: bookmarks.length })}
      toolbar={<>
        <div className="atlas-filterbar">
          <button className="atlas-facet-button" type="button" onClick={() => onNewFolder(folderId)}><Icon name="folderPlus" size={13} /> {t('Nueva carpeta')}</button>
          <button className="atlas-facet-button" type="button" onClick={() => onNewBookmark(folderId)}><Icon name="bookmark" size={13} /> {t('Añadir un marcador')}</button>
          <button className="atlas-facet-button" type="button" onClick={() => void window.nodus.openBrowserTab(NODUS_RESEARCH_ATLAS_URL)}><Icon name="globe" size={13} /> Research Atlas</button>
          <button
            className="atlas-facet-button"
            type="button"
            data-testid="browser-bookmarks-export-html"
            title={t('Exportar todos los marcadores como HTML compatible con Chrome, Edge, Firefox, Brave y Opera')}
            aria-label={t('Exportar todos los marcadores como HTML compatible con Chrome, Edge, Firefox, Brave y Opera')}
            aria-busy={exporting}
            disabled={exporting}
            onClick={() => void exportHtml()}
          ><Icon name="download" size={13} /> {exporting ? t('Exportando…') : t('Exportar HTML')}</button>
          <button
            className="atlas-facet-button"
            type="button"
            data-testid="browser-bookmarks-import-html"
            title={t('Importar marcadores desde un archivo HTML de Chrome, Edge, Firefox, Brave u Opera')}
            aria-label={t('Importar marcadores desde un archivo HTML de Chrome, Edge, Firefox, Brave u Opera')}
            aria-busy={importing}
            disabled={importing}
            onClick={() => void importFile()}
          ><Icon name="upload" size={13} /> {importing ? t('Importando…') : t('Importar HTML')}</button>
        </div>
        {!query && <div className="bookmark-breadcrumbs"><button onClick={() => setFolderId(null)}>{t('Marcadores')}</button>{pathFolders.map((entry) => <span key={entry.id}> / <button onClick={() => setFolderId(entry.id)}>{entry.name}</button></span>)}</div>}
      </>}
    >
      {folders.map((entry) => (
        <article
          key={entry.id}
          className={`card lit atlas-card bookmark-card${dropId === entry.id ? ' bookmark-drop' : ''}`}
          draggable
          onClick={(event) => { if (!(event.target as Element).closest('button')) setFolderId(entry.id); }}
          onDragStart={() => setDragging({ kind: 'folder', id: entry.id })}
          onDragOver={(event) => { event.preventDefault(); setDropId(entry.id); }}
          onDragLeave={() => setDropId(null)}
          onDrop={(event) => { event.preventDefault(); void move(entry.id); }}
        >
          <div className="bookmark-heading"><span className="bookmark-folder-icon"><Icon name="folder" size={19} /></span><h2><button type="button" title={entry.name} onClick={() => setFolderId(entry.id)}>{entry.name}</button></h2></div>
          <div className="atlas-geo">{tx('Carpeta · {items} elementos', { items: browserBookmarkChildren(store, entry.id).length })}</div>
          <p className="atlas-description">{t('Abre esta carpeta para explorar los recursos de investigación guardados y las subcarpetas.')}</p>
          <div className="atlas-card-actions"><button className="atlas-open" type="button" onClick={() => setFolderId(entry.id)}>{t('Abrir carpeta')} <Icon name="chevronRight" size={13} /></button><button className="atlas-open bookmark-delete" type="button" data-testid="browser-bookmark-card-delete" onClick={() => setDeleteConfirmation({ ref: { kind: 'folder', id: entry.id }, label: entry.name })}><Icon name="trash" size={13} /> {t('Eliminar')}</button></div>
        </article>
      ))}
      {bookmarks.map((entry) => {
        const location = browserBookmarkFolderPath(store, entry.parentId);
        return (
          <article key={entry.id} className="card lit atlas-card bookmark-card" draggable onClick={(event) => { if (!(event.target as Element).closest('button')) void window.nodus.openBrowserTab(entry.url); }} onDragStart={() => setDragging({ kind: 'bookmark', id: entry.id })}>
            <div className="atlas-card-top"><div className="bookmark-heading">{entry.faviconDataUrl ? <img className="bookmark-favicon" src={entry.faviconDataUrl} alt="" /> : <Icon name="globe" size={22} />}<h2><button type="button" title={entry.title} onClick={() => void window.nodus.openBrowserTab(entry.url)}>{entry.title}</button></h2></div><span className="atlas-access">{t('Guardado')}</span></div>
            <div className="atlas-geo" title={`${new URL(entry.url).hostname}${location.length ? ` · ${location.join(' › ')}` : ''}`}>{new URL(entry.url).hostname}{location.length ? ` · ${location.join(' › ')}` : ''}</div>
            <p className="atlas-description" title={entry.description || t('Una web guardada de forma privada en Nodus Bookmarks.')}>{entry.description || t('Una web guardada de forma privada en Nodus Bookmarks.')}</p>
            <div className="atlas-card-actions">
              <button className="atlas-open" type="button" onClick={() => void window.nodus.openBrowserTab(entry.url)}>{t('Abrir')} <Icon name="external" size={13} /></button>
              <button className="atlas-open" type="button" onClick={() => onEditBookmark(entry)}>{t('Editar')}</button>
              <button className="atlas-open" type="button" onClick={() => void navigator.clipboard.writeText(entry.url)}>{t('Copiar URL')}</button>
              <button className="atlas-open bookmark-delete" type="button" data-testid="browser-bookmark-card-delete" onClick={() => setDeleteConfirmation({ ref: { kind: 'bookmark', id: entry.id }, label: entry.title })}><Icon name="trash" size={13} /> {t('Eliminar')}</button>
            </div>
          </article>
        );
      })}
      {!folders.length && !bookmarks.length && (
        <div className="atlas-empty"><h2>{t(query ? 'No hay marcadores que coincidan' : folder ? 'Esta carpeta está vacía' : 'Aún no hay marcadores.')}</h2><p>{t(query ? 'La búsqueda incluye títulos, direcciones, descripciones y nombres de carpetas.' : 'Guarda webs desde el Navegador de Nodus o el Research Atlas para crear tu página de inicio de investigación personal.')}</p><div className="flex justify-center gap-2"><button className="atlas-open" onClick={() => onNewBookmark(folderId)}>{t('Añadir un marcador')}</button><button className="atlas-open" onClick={() => void window.nodus.openBrowserTab(NODUS_RESEARCH_ATLAS_URL)}>{t('Abrir Research Atlas')}</button></div></div>
      )}
      {importPreview && <ConfirmModal
        title={tx('Vista previa de importación · {fileName}', { fileName: importPreview.fileName })}
        message={<>
          <p>{tx('{bookmarks} marcadores · {folders} carpetas · {duplicates} duplicados · {invalidUrls} URL no válidas omitidas', {
            bookmarks: importPreview.bookmarks,
            folders: importPreview.folders,
            duplicates: importPreview.duplicates,
            invalidUrls: importPreview.invalidUrls,
          })}{importPreview.truncated ? ` · ${t('límites aplicados')}` : ''}</p>
          <p className="mt-2">{t('Ningún marcador guardado se sobrescribe: las direcciones repetidas se omiten.')}</p>
        </>}
        confirmLabel={importing ? t('Importando…') : t('Importar sin sobrescribir')}
        zIndex={160}
        onCancel={() => { if (!importing) setImportPreview(null); }}
        onConfirm={() => void commitImport()}
      />}
      {deleteConfirmation && <ConfirmModal
        title={tx('¿Eliminar «{label}»?', { label: deleteConfirmation.label })}
        message={deleteConfirmation.ref.kind === 'folder'
          ? t('Se eliminará la carpeta y todo su contenido.')
          : t('Este marcador se eliminará de Nodus Bookmarks.')}
        confirmLabel={deleting ? t('Eliminando…') : t('Eliminar')}
        danger
        zIndex={160}
        onCancel={() => { if (!deleting) setDeleteConfirmation(null); }}
        onConfirm={() => void remove()}
      />}
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
    <StartShell title="Research Atlas" copy={t('Explora y filtra un directorio internacional seleccionado de webs de investigación, bibliotecas digitales, archivos, repositorios y colecciones de fuentes primarias.')} query={query} onQuery={setQuery} status={tx('{visible} de {total} recursos', { visible: visible.length, total: resources.length })} toolbar={
      <div className="atlas-filterbar">
        <select className={`atlas-facet-button${area ? ' is-active' : ''}`} value={area} onChange={(event) => setArea(event.target.value)}><option value="">{t('Área de conocimiento')}</option>{areas.map((value) => <option key={value}>{value}</option>)}</select>
        <select className={`atlas-facet-button${kind ? ' is-active' : ''}`} value={kind} onChange={(event) => setKind(event.target.value)}><option value="">{t('Tipo de recurso')}</option>{kinds.map((value) => <option key={value}>{value}</option>)}</select>
        {(area || kind || query) && <button className="atlas-reset" onClick={() => { setArea(''); setKind(''); setQuery(''); }}>{t('Limpiar filtros')}</button>}
        <button className="atlas-facet-button" type="button" onClick={() => void window.nodus.openBrowserTab(NODUS_RESEARCH_ATLAS_URL)}><Icon name="external" size={13} /> {t('Atlas público')}</button>
      </div>}
    >
      {visible.map((entry) => {
        const isSaved = saved.has(canonicalBookmarkUrl(entry.url));
        const geo = [entry.geography?.continent, entry.geography?.country, entry.geography?.region].filter(Boolean).join(' · ');
        return <article key={entry.id} className="card lit atlas-card">
          <div className="atlas-card-top"><h2><button type="button" onClick={() => void window.nodus.openBrowserTab(entry.url)}>{entry.name}</button></h2><span className="atlas-access">{entry.access_model || t('recurso')}</span></div>
          <div className="atlas-geo">{geo}</div><p className="atlas-description">{entry.description}</p>
          <dl className="atlas-meta"><div className="atlas-meta-row"><dt>{t('Conocimiento')}</dt><dd>{entry.knowledge_domains?.join(' · ')}</dd></div><div className="atlas-meta-row"><dt>{t('Uso')}</dt><dd>{entry.type_of_use?.join(' · ')}</dd></div></dl>
          <div className="atlas-card-actions"><button className="atlas-open" onClick={() => void window.nodus.openBrowserTab(entry.url)}>{t('Abrir recurso')} <Icon name="external" size={13} /></button><button className={`atlas-open${isSaved ? ' is-saved' : ''}`} disabled={isSaved} onClick={() => onSave({ title: entry.name, url: entry.url, description: entry.description, faviconDataUrl: null, existingId: null })}><Icon name={isSaved ? 'bookmarkFill' : 'bookmark'} size={13} />{isSaved ? t('Guardado') : t('Guardar')}</button></div>
        </article>;
      })}
      {!visible.length && <div className="atlas-empty">{t('Sin resultados para los filtros actuales.')}</div>}
    </StartShell>
  );
}
