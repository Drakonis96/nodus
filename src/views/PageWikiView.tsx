import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Page, PageBacklink, PageDocument, PageRevision, PageSearchResult, PageTreeItem } from '@shared/pages';
import { PageBlockEditor } from '../components/pages/PageBlockEditor';
import { PageCommentsPanel } from '../components/pages/PageCommentsPanel';
import { PageAccessPanel } from '../components/pages/PageAccessPanel';
import { confirm, promptText, toast } from '../components/feedback';
import { Icon } from '../components/ui';
import { t, tx } from '../i18n';

type MobilePanel = 'tree' | 'page' | 'context';

function PageCover({ hash, title }: { hash: string; title: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    void window.nodus.getPageAsset(hash).then((bytes) => {
      if (!active || !bytes) return;
      const data = new Uint8Array(bytes);
      const header = new TextDecoder().decode(data.slice(0, 160)).trimStart();
      objectUrl = URL.createObjectURL(new Blob([data], { type: header.startsWith('<svg') ? 'image/svg+xml' : 'application/octet-stream' }));
      setUrl(objectUrl);
    });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [hash]);
  return url ? <img src={url} alt={title} className="h-36 w-full object-cover sm:h-48" /> : <div className="h-36 animate-pulse bg-neutral-100 dark:bg-neutral-900 sm:h-48" />;
}

function PageTree({
  pages, selectedId, onOpen, onMove, onCreateChild,
}: {
  pages: PageTreeItem[];
  selectedId: string | null;
  onOpen: (id: string) => void;
  onMove: (id: string, parentId: string | null) => void;
  onCreateChild: (parentId: string) => void;
}) {
  const known = useMemo(() => new Set(pages.map((page) => page.id)), [pages]);
  const children = useMemo(() => {
    const grouped = new Map<string | null, PageTreeItem[]>();
    for (const page of pages) {
      const parent = page.parentPageId && known.has(page.parentPageId) ? page.parentPageId : null;
      const list = grouped.get(parent) ?? [];
      list.push(page); grouped.set(parent, list);
    }
    return grouped;
  }, [known, pages]);

  const branch = (parentId: string | null, depth: number): React.ReactNode => (children.get(parentId) ?? []).map((page) => (
    <div key={page.id} role="treeitem" aria-selected={selectedId === page.id} aria-level={depth + 1}>
      <div
        className={`group flex min-h-9 items-center rounded-lg pr-1 ${selectedId === page.id ? 'bg-indigo-100 text-indigo-950 dark:bg-indigo-950/50 dark:text-indigo-100' : 'hover:bg-neutral-100 dark:hover:bg-neutral-900'}`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        draggable
        onDragStart={(event) => { event.dataTransfer.setData('application/x-nodus-page', page.id); event.dataTransfer.effectAllowed = 'move'; }}
        onDragOver={(event) => { if (event.dataTransfer.types.includes('application/x-nodus-page')) event.preventDefault(); }}
        onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const id = event.dataTransfer.getData('application/x-nodus-page'); if (id) onMove(id, page.id); }}
      >
        <button className="flex min-w-0 flex-1 items-center gap-2 px-1 py-2 text-left text-sm" onClick={() => onOpen(page.id)} aria-current={selectedId === page.id ? 'page' : undefined}>
          <span aria-hidden="true">{page.icon ?? (page.origin === 'database_row' ? '▦' : '📄')}</span>
          <span className="truncate">{page.title || t('Página sin título')}</span>
          {page.favorite && <span className="ml-auto text-amber-500" title={t('Favorito')}>★</span>}
        </button>
        <button className="grid h-7 w-7 shrink-0 place-items-center rounded opacity-0 hover:bg-neutral-200 focus:opacity-100 group-hover:opacity-100 dark:hover:bg-neutral-800" onClick={() => onCreateChild(page.id)} title={t('Crear subpágina')} aria-label={t('Crear subpágina')}><Icon name="plus" size={12} /></button>
      </div>
      {(children.get(page.id)?.length ?? 0) > 0 && <div role="group">{branch(page.id, depth + 1)}</div>}
    </div>
  ));
  return <div role="tree" className="space-y-0.5">{branch(null, 0)}</div>;
}

function BacklinkList({ links, onOpen }: { links: PageBacklink[]; onOpen: (id: string) => void }) {
  if (!links.length) return <p className="text-xs text-neutral-600 dark:text-neutral-400">{t('Ninguna página enlaza aquí todavía.')}</p>;
  return <div className="space-y-1">{links.map((link) => (
    <button key={link.id} className="w-full rounded-lg border border-neutral-200 p-2 text-left hover:border-indigo-300 dark:border-neutral-800 dark:hover:border-indigo-800" onClick={() => onOpen(link.sourcePageId)}>
      <span className="block truncate text-xs font-medium">{link.sourceTitle}</span>
      <span className="mt-0.5 block truncate text-[11px] text-neutral-600 dark:text-neutral-400">{link.kind === 'mention' ? '@' : link.kind === 'synced_block' ? '↔' : '↳'} {link.label || t('Enlace de página')}</span>
    </button>
  ))}</div>;
}

export function PageWikiView() {
  const [pages, setPages] = useState<PageTreeItem[]>([]);
  const [showTrash, setShowTrash] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [document, setDocument] = useState<PageDocument | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<Page[]>([]);
  const [backlinks, setBacklinks] = useState<PageBacklink[]>([]);
  const [brokenLinks, setBrokenLinks] = useState<PageBacklink[]>([]);
  const [revisions, setRevisions] = useState<PageRevision[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [searchMode, setSearchMode] = useState<'lexical' | 'semantic'>('lexical');
  const [results, setResults] = useState<PageSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('page');
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const openRequestRef = useRef(0);

  const refreshPages = useCallback(async (state = showTrash ? 'trashed' as const : 'active' as const) => {
    const next = await window.nodus.listPages(state);
    setPages(next);
    return next;
  }, [showTrash]);

  const openPage = useCallback(async (id: string) => {
    const request = ++openRequestRef.current;
    setError(null); setOpening(true); setDocument(null); setSelectedId(id); setMobilePanel('page');
    try {
      const [next, crumbs, incoming, broken, history] = await Promise.all([
        window.nodus.getPageDocument(id), window.nodus.listPageBreadcrumbs(id),
        window.nodus.listPageBacklinks(id), window.nodus.listBrokenPageLinks(),
        window.nodus.listPageRevisions(id, null, 20),
      ]);
      if (!next) throw new Error(t('No se encontró la página.'));
      if (request !== openRequestRef.current) return;
      setDocument(next); setBreadcrumbs(crumbs); setBacklinks(incoming); setBrokenLinks(broken);
      setRevisions(history.items); setHistoryCursor(history.nextCursor);
    } catch (cause) {
      if (request !== openRequestRef.current) return;
      setDocument(null); setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (request === openRequestRef.current) setOpening(false);
    }
  }, []);

  useEffect(() => {
    void refreshPages().then((next) => {
      const retained = selectedId && next.some((page) => page.id === selectedId) ? selectedId : next[0]?.id;
      if (retained) void openPage(retained); else { setSelectedId(null); setDocument(null); }
    });
  }, [openPage, refreshPages]);

  const createPage = async (parentPageId: string | null = null) => {
    const title = await promptText({ title: parentPageId ? t('Crear subpágina') : t('Nueva página'), initial: t('Página sin título'), confirmLabel: t('Crear') });
    if (title == null) return;
    const created = await window.nodus.createPage({ title, parentPageId, icon: parentPageId ? '↳' : '📄' });
    await refreshPages('active'); await openPage(created.page.id);
  };

  const movePage = async (id: string, parentId: string | null) => {
    try {
      const page = await window.nodus.getPage(id);
      if (!page) return;
      await window.nodus.movePage(id, parentId, page.revision);
      await refreshPages();
      if (id === selectedId) await openPage(id);
    } catch (cause) { toast(cause instanceof Error ? cause.message : String(cause), { tone: 'error' }); }
  };

  const patchPage = async (patch: Parameters<typeof window.nodus.updatePage>[1]) => {
    if (!document) return;
    try {
      const updated = await window.nodus.updatePage(document.page.id, patch, document.page.revision);
      if (!updated) return;
      await refreshPages(); await openPage(updated.id);
    } catch (cause) { toast(cause instanceof Error ? cause.message : String(cause), { tone: 'error' }); }
  };

  const toggleFavorite = async () => {
    if (!document) return;
    const item = pages.find((page) => page.id === document.page.id);
    await window.nodus.setPageFavorite(document.page.id, !item?.favorite);
    await refreshPages();
  };

  const changeState = async (state: 'active' | 'trashed') => {
    if (!document) return;
    if (state === 'trashed' && !(await confirm({ title: t('Mover a la papelera'), message: t('La página y todas sus subpáginas se podrán restaurar más adelante.'), confirmLabel: t('Mover a la papelera'), danger: true }))) return;
    await window.nodus.setPageState(document.page.id, state, document.page.revision);
    setDocument(null); setSelectedId(null);
    await refreshPages(showTrash ? 'trashed' : 'active');
  };

  const setCover = async () => {
    if (!document) return;
    const asset = await window.nodus.pickPageAsset('image');
    if (asset) await patchPage({ coverBlobHash: asset.blobHash });
  };

  const runSearch = async () => {
    setSearching(true);
    try { setResults(await window.nodus.searchPages(query, searchMode, 60)); setHasSearched(true); }
    finally { setSearching(false); }
  };

  const loadMoreHistory = async () => {
    if (!document || !historyCursor || historyLoading) return;
    setHistoryLoading(true);
    try {
      const page = await window.nodus.listPageRevisions(document.page.id, historyCursor, 20);
      setRevisions((current) => [...current, ...page.items]);
      setHistoryCursor(page.nextCursor);
    } finally { setHistoryLoading(false); }
  };

  const restoreRevision = async (revision: PageRevision) => {
    if (!document) return;
    const accepted = await confirm({
      title: t('Restaurar esta versión'),
      message: t('Se creará una revisión nueva. Las versiones posteriores seguirán disponibles.'),
      confirmLabel: t('Restaurar versión'),
    });
    if (!accepted) return;
    try {
      const restored = await window.nodus.restorePageRevision(
        document.page.id, revision.revision, document.revision, 'local',
      );
      if (!restored.ok) {
        setDocument(restored.conflict.current);
        toast(t('La página cambió mientras restaurabas. Revisa la versión actual.'), { tone: 'error' });
        return;
      }
      await refreshPages();
      await openPage(document.page.id);
      toast(t('Versión restaurada sin borrar el historial posterior.'), { tone: 'success' });
    } catch (cause) { toast(cause instanceof Error ? cause.message : String(cause), { tone: 'error' }); }
  };

  const headings = useMemo(() => (document?.blocks ?? []).filter((block) => block.type.startsWith('heading_')),
    [document?.blocks]);
  const favorites = pages.filter((page) => page.favorite);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100" data-testid="page-wiki-view">
      <header className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
        <div className="flex items-center gap-2"><Icon name="notebook" size={18} className="text-indigo-500" /><h1 className="font-semibold">{t('Páginas y wiki')}</h1></div>
        <div className="flex w-full items-center justify-between gap-1 sm:ml-auto sm:w-auto">
          <button className="btn h-9 min-w-0 flex-1 px-2 text-xs sm:flex-none sm:px-3 lg:hidden" aria-pressed={mobilePanel === 'tree'} onClick={() => setMobilePanel('tree')}>{t('Árbol')}</button>
          <button className="btn h-9 min-w-0 flex-1 px-2 text-xs sm:flex-none sm:px-3 lg:hidden" aria-pressed={mobilePanel === 'page'} onClick={() => setMobilePanel('page')}>{t('Página')}</button>
          <button className="btn h-9 min-w-0 flex-1 px-2 text-xs sm:flex-none sm:px-3 xl:hidden" aria-pressed={mobilePanel === 'context'} onClick={() => setMobilePanel('context')}>{t('Enlaces')}</button>
          <button className="btn btn-primary h-9 w-9 shrink-0 px-0 text-xs sm:w-auto sm:px-3" onClick={() => void createPage()} aria-label={t('Nueva página')} title={t('Nueva página')}><Icon name="plus" size={13} /><span className="hidden sm:inline">{t('Nueva página')}</span></button>
        </div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[230px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_250px]">
        <aside className={`${mobilePanel === 'tree' ? 'flex' : 'hidden'} min-h-0 min-w-0 flex-col border-r border-neutral-200 bg-inherit dark:border-neutral-800 lg:flex`} aria-label={t('Árbol de páginas')}>
          <div className="space-y-2 border-b border-neutral-200 p-3 dark:border-neutral-800">
            <div className="flex gap-1">
              <input className="input h-9 min-w-0 flex-1 text-sm" value={query} onChange={(event) => { setQuery(event.target.value); setHasSearched(false); setResults([]); }} onKeyDown={(event) => { if (event.key === 'Enter') void runSearch(); }} placeholder={t('Buscar páginas, filas y adjuntos')} aria-label={t('Buscar páginas, filas y adjuntos')} />
              <button className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-neutral-300 dark:border-neutral-700" onClick={() => void runSearch()} aria-label={t('Buscar')}><Icon name="search" size={14} /></button>
            </div>
            <div className="grid grid-cols-2 rounded-lg bg-neutral-200/70 p-0.5 text-[11px] dark:bg-neutral-900">
              <button className={`rounded-md py-1.5 ${searchMode === 'lexical' ? 'bg-white shadow-sm dark:bg-neutral-800' : ''}`} onClick={() => setSearchMode('lexical')}>{t('Léxica')}</button>
              <button className={`rounded-md py-1.5 ${searchMode === 'semantic' ? 'bg-white shadow-sm dark:bg-neutral-800' : ''}`} onClick={() => setSearchMode('semantic')}>{t('Semántica local')}</button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const id = event.dataTransfer.getData('application/x-nodus-page'); if (id) void movePage(id, null); }}>
            {query && (searching || hasSearched) ? (
              <section aria-label={t('Resultados de búsqueda')} className="space-y-1">
                <h2 className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400">{searching ? t('Buscando…') : t('Resultados')}</h2>
                {results.map((result) => <button key={`${result.entityType}:${result.entityId}`} className="w-full rounded-lg p-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-900" disabled={!result.pageId} onClick={() => result.pageId && void openPage(result.pageId)}><span className="block truncate text-xs font-medium">{result.title}</span><span className="mt-0.5 block line-clamp-2 text-[11px] text-neutral-600 dark:text-neutral-400">{result.snippet.replace(/<\/?mark>/g, '')}</span></button>)}
                {!searching && results.length === 0 && <p className="p-4 text-center text-xs text-neutral-600 dark:text-neutral-400">{t('Sin resultados.')}</p>}
              </section>
            ) : (
              <>
                {favorites.length > 0 && <section className="mb-3"><h2 className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400">{t('Favoritos')}</h2><PageTree pages={favorites} selectedId={selectedId} onOpen={(id) => void openPage(id)} onMove={(id, parent) => void movePage(id, parent)} onCreateChild={(id) => void createPage(id)} /></section>}
                <section><div className="flex items-center px-2 py-1"><h2 className="text-[10px] font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400">{showTrash ? t('Papelera') : t('Todas las páginas')}</h2><button className="ml-auto min-h-6 rounded px-1 text-[11px] text-neutral-600 hover:bg-neutral-100 hover:text-indigo-700 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-indigo-300" onClick={() => { setShowTrash((value) => !value); setSelectedId(null); setDocument(null); }}>{showTrash ? t('Volver a páginas') : t('Ver papelera')}</button></div>{pages.length ? <PageTree pages={pages} selectedId={selectedId} onOpen={(id) => void openPage(id)} onMove={(id, parent) => void movePage(id, parent)} onCreateChild={(id) => void createPage(id)} /> : <p className="p-4 text-center text-xs text-neutral-600 dark:text-neutral-400">{showTrash ? t('La papelera está vacía.') : t('Crea tu primera página para empezar la wiki.')}</p>}</section>
              </>
            )}
          </div>
        </aside>

        <main className={`${mobilePanel === 'context' ? 'hidden xl:block' : mobilePanel === 'page' ? 'block' : 'hidden lg:block'} min-h-0 min-w-0 overflow-x-hidden overflow-y-auto`} aria-label={t('Página')}>
          {error && <div role="alert" className="m-4 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">{error}</div>}
          {opening ? <div role="status" className="grid min-h-full place-items-center p-8 text-sm text-neutral-600 dark:text-neutral-300">{t('Cargando página…')}</div> : !document ? (error ? null : <div className="grid min-h-full place-items-center p-8 text-center"><div><div className="mb-3 text-4xl">📄</div><h2 className="font-semibold">{t('Tu wiki local')}</h2><p className="mt-1 max-w-sm text-sm text-neutral-600 dark:text-neutral-400">{t('Crea páginas, anídalas y enlázalas con tus bases de datos sin salir del vault.')}</p><button className="btn btn-primary mt-4" onClick={() => void createPage()}>{t('Nueva página')}</button></div></div>) : (
            <article className={`min-w-0 ${document.page.fullWidth ? 'mx-auto w-full' : 'mx-auto max-w-4xl'}`} data-testid="wiki-page">
              {document.page.coverBlobHash && <PageCover hash={document.page.coverBlobHash} title={document.page.title} />}
              <div className="px-4 py-4 sm:px-8 sm:py-6">
                <nav aria-label={t('Migas de pan')} className="mb-4 flex flex-wrap items-center gap-1 text-xs text-neutral-600 dark:text-neutral-400">{breadcrumbs.map((page, index) => <span key={page.id} className="flex items-center gap-1">{index > 0 && <span>/</span>}<button className="min-h-6 rounded px-1 py-0.5 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-900 dark:hover:text-neutral-100" onClick={() => void openPage(page.id)}>{page.icon ?? '📄'} {page.title}</button></span>)}</nav>
                <div className="mb-4 flex flex-wrap items-center gap-1">
                  <button className="btn h-8 px-2 text-xs" onClick={() => void toggleFavorite()}>{pages.find((page) => page.id === document.page.id)?.favorite ? '★' : '☆'} {t('Favorito')}</button>
                  <button className="btn h-8 px-2 text-xs" onClick={() => void patchPage({ locked: !document.page.locked })}><Icon name={document.page.locked ? 'unlock' : 'lock'} size={12} />{document.page.locked ? t('Desbloquear') : t('Bloquear')}</button>
                  <button className="btn h-8 px-2 text-xs" onClick={() => void patchPage({ fullWidth: !document.page.fullWidth })}>{document.page.fullWidth ? t('Ancho normal') : t('Ancho completo')}</button>
                  <button className="btn h-8 px-2 text-xs" onClick={() => void setCover()}><Icon name="image" size={12} />{t('Portada')}</button>
                  <button className="btn h-8 px-2 text-xs" onClick={async () => { const icon = await promptText({ title: t('Icono de página'), initial: document.page.icon ?? '📄' }); if (icon != null) await patchPage({ icon: icon.trim() || null }); }}>{t('Icono')}</button>
                  <button className="btn h-8 px-2 text-xs" onClick={() => void createPage(document.page.id)}><Icon name="plus" size={12} />{t('Subpágina')}</button>
                  <button className="btn ml-auto h-8 px-2 text-xs text-rose-700 dark:text-rose-300" onClick={() => void changeState(showTrash ? 'active' : 'trashed')}><Icon name={showTrash ? 'undo' : 'trash'} size={12} />{showTrash ? t('Restaurar') : t('Papelera')}</button>
                </div>
                <input className="w-full bg-transparent text-3xl font-bold leading-tight outline-none placeholder:text-neutral-300 dark:placeholder:text-neutral-700" aria-label={t('Título de página')} defaultValue={document.page.title} key={`${document.page.id}:${document.page.title}`} disabled={document.page.locked || showTrash} onBlur={(event) => { if (event.target.value.trim() !== document.page.title) void patchPage({ title: event.target.value }); }} />
                {showTrash ? <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">{t('Esta página está en la papelera. Restáurala para volver a editarla.')}</div> : <PageBlockEditor key={`${document.page.id}:${document.page.locked}`} pageId={document.page.id} onNavigatePage={(id) => void openPage(id)} onDocumentChange={setDocument} />}
              </div>
            </article>
          )}
        </main>

        <aside className={`${mobilePanel === 'context' ? 'block' : 'hidden'} min-h-0 min-w-0 overflow-x-hidden overflow-y-auto border-l border-neutral-200 bg-inherit p-3 dark:border-neutral-800 lg:col-start-2 lg:row-start-1 xl:col-start-3 xl:block`} aria-label={t('Contexto de página')}>
          <section className="mb-5"><h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400">{t('Tabla de contenidos')}</h2>{headings.length ? <div className="space-y-1">{headings.map((heading) => <button key={heading.id} className="block w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-900" onClick={() => globalThis.document.getElementById(`page-block-anchor-${heading.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>{String(heading.content.text ?? '')}</button>)}</div> : <p className="text-xs text-neutral-600 dark:text-neutral-400">{t('Añade encabezados para crear el índice.')}</p>}</section>
          <section className="mb-5" data-testid="page-revision-history">
            <div className="mb-2 flex items-center gap-2"><Icon name="clock" size={13} className="text-indigo-500" /><h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400">{t('Historial de versiones')}</h2></div>
            <ol className="space-y-1.5">
              {revisions.map((revision, index) => <li key={revision.id} className="rounded-lg border border-neutral-200 bg-white p-2 dark:border-neutral-800 dark:bg-neutral-900/60">
                <div className="flex min-w-0 items-start gap-2"><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{t(revision.summary || 'Cambio guardado')}{revision.propertyChanges > 0 ? ` · ${revision.propertyChanges === 1 ? t('1 propiedad') : tx('{count} propiedades', { count: revision.propertyChanges })}` : ''}{revision.blockChanges > 0 ? ` · ${revision.blockChanges === 1 ? t('1 bloque') : tx('{count} bloques', { count: revision.blockChanges })}` : ''}</p><p className="mt-0.5 text-[10px] text-neutral-600 dark:text-neutral-400">v{revision.revision} · {new Date(revision.createdAt).toLocaleString()} · {revision.actorId}</p></div>{index === 0 ? <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{t('Actual')}</span> : <button className="min-h-7 rounded-md border border-neutral-300 px-2 text-[10px] font-medium hover:border-indigo-400 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-neutral-700 dark:hover:border-indigo-600 dark:hover:text-indigo-300" onClick={() => void restoreRevision(revision)}>{t('Restaurar')}</button>}</div>
                {revision.restoredFromRevision != null && <p className="mt-1 text-[10px] text-indigo-700 dark:text-indigo-300">{tx('Restaurada desde v{revision}', { revision: revision.restoredFromRevision })}</p>}
              </li>)}
            </ol>
            {!revisions.length && <p className="text-xs text-neutral-600 dark:text-neutral-400">{t('Aún no hay versiones.')}</p>}
            {historyCursor && <button className="mt-2 min-h-8 w-full rounded-lg border border-neutral-300 px-2 text-xs hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900" disabled={historyLoading} onClick={() => void loadMoreHistory()}>{historyLoading ? t('Cargando…') : t('Cargar versiones anteriores')}</button>}
          </section>
          {document && <div className="mb-5"><PageCommentsPanel key={document.page.id} pageId={document.page.id} /></div>}
          {document && <div className="mb-5"><PageAccessPanel key={document.page.id} pageId={document.page.id} /></div>}
          <section className="mb-5"><h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400">{t('Backlinks')}</h2><BacklinkList links={backlinks} onOpen={(id) => void openPage(id)} /></section>
          <section><h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400">{t('Enlaces rotos')}</h2>{brokenLinks.length ? <div className="space-y-1">{brokenLinks.map((link) => <button key={link.id} className="w-full rounded-lg border border-rose-200 p-2 text-left text-xs text-rose-800 dark:border-rose-900 dark:text-rose-200" onClick={() => void openPage(link.sourcePageId)}>{link.sourceTitle} · {link.label || link.targetPageId || link.targetBlockId}</button>)}</div> : <p className="text-xs text-neutral-600 dark:text-neutral-400">{t('No hay enlaces rotos.')}</p>}</section>
        </aside>
      </div>
    </div>
  );
}
