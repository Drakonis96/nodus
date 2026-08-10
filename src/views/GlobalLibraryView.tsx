import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  LibraryCatalogItem,
  LibraryCollectionView,
  LibraryExtractionJob,
  LibraryItemRecord,
  LibraryItemSource,
  LibraryStatus,
  ZoteroImportProgress,
  ZoteroImportSelection,
  ZoteroLibraryPreview,
} from '@shared/libraryTypes';
import { Icon, Spinner } from '../components/ui';
import { LibraryDocumentReader } from './LibraryDocumentReader';
import { VirtualList } from '../components/VirtualList';
import { confirm, promptText, toast } from '../components/feedback';
import { t, tx } from '../i18n';
import type { PendingAssistantNavigationTarget } from '../navigation';

const PAGE_SIZE = 250;

const SOURCE_LABEL: Record<LibraryItemSource, string> = {
  nodus: 'Nodus', zotero: 'Zotero', mendeley: 'Mendeley', ris: 'RIS', bibtex: 'BibTeX',
  'csl-json': 'CSL JSON', legacy: 'Legado',
};

const EXTRACTION_LABEL: Record<LibraryCatalogItem['extractionStatus'], string> = {
  pending: 'Pendiente', processing: 'Procesando…', ready: 'Lista', 'needs-review': 'Revisar', failed: 'Con error', unsupported: 'No compatible',
};

function creatorText(item: LibraryCatalogItem): string {
  return item.creators.map((creator) => creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(' ')).filter(Boolean).join('; ');
}

function collectionChildren(collections: LibraryCollectionView[]): Map<string | null, LibraryCollectionView[]> {
  const map = new Map<string | null, LibraryCollectionView[]>();
  for (const collection of collections) map.set(collection.parentId, [...(map.get(collection.parentId) ?? []), collection]);
  for (const entries of map.values()) entries.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  return map;
}

function CollectionBranch({
  collection,
  children,
  selected,
  expanded,
  onSelect,
  onToggle,
  depth,
}: {
  collection: LibraryCollectionView;
  children: Map<string | null, LibraryCollectionView[]>;
  selected: string | null;
  expanded: Set<string>;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  depth: number;
}) {
  const descendants = children.get(collection.id) ?? [];
  const open = expanded.has(collection.id);
  return (
    <>
      <div className="group flex items-center pr-1" style={{ paddingLeft: depth * 12 }}>
        <button
          className={`grid h-7 w-6 shrink-0 place-items-center rounded text-neutral-600 hover:text-neutral-300 ${descendants.length ? '' : 'invisible'}`}
          onClick={() => onToggle(collection.id)}
          aria-label={open ? t('Plegar') : t('Desplegar')}
        >
          <Icon name="chevronRight" size={12} className={open ? 'rotate-90' : ''} />
        </button>
        <button
          data-testid={`global-library-collection-${collection.id}`}
          className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs ${selected === collection.id ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'}`}
          onClick={() => onSelect(collection.id)}
          title={collection.name}
        >
          <Icon name="folder" size={13} className="shrink-0 opacity-70" />
          <span className="min-w-0 flex-1 truncate">{collection.name}</span>
          <span className="text-[10px] tabular-nums opacity-55">{collection.directItemCount}</span>
        </button>
      </div>
      {open && descendants.map((child) => (
        <CollectionBranch
          key={child.id} collection={child} children={children} selected={selected} expanded={expanded}
          onSelect={onSelect} onToggle={onToggle} depth={depth + 1}
        />
      ))}
    </>
  );
}

function ZoteroImportDialog({ onClose, onFinished }: { onClose: () => void; onFinished: () => void }) {
  const [libraries, setLibraries] = useState<ZoteroLibraryPreview[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ZoteroImportProgress | null>(null);
  const [copyAttachments, setCopyAttachments] = useState(true);
  const [includeUnfiled, setIncludeUnfiled] = useState(true);

  useEffect(() => {
    let alive = true;
    void window.nodus.listZoteroImportLibraries().then((entries) => {
      if (!alive) return;
      setLibraries(entries);
      setSelected(new Set(entries.map((entry) => entry.id)));
    }).catch((nextError) => alive && setError(nextError instanceof Error ? nextError.message : String(nextError))).finally(() => alive && setLoading(false));
    const off = window.nodus.onZoteroImportProgress((value) => {
      if (!requestId || value.requestId === requestId) setProgress(value);
    });
    return () => { alive = false; off(); };
  }, [requestId]);

  const start = async () => {
    const id = crypto.randomUUID();
    setRequestId(id);
    setError(null);
    const selection: ZoteroImportSelection = { libraryIds: [...selected], copyAttachments, includeUnfiled };
    try {
      const report = await window.nodus.importZoteroLibrary(id, selection);
      toast(report.canceled
        ? t('La importación se canceló; el catálogo ya recuperado se conserva.')
        : tx('Importación terminada: {n} documentos.', { n: report.itemsDiscovered }));
      onFinished();
      if (!report.canceled) onClose();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally { setRequestId(null); }
  };

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/65 p-6" onMouseDown={(event) => { if (event.target === event.currentTarget && !requestId) onClose(); }}>
      <section data-testid="zotero-global-import-dialog" className="card flex max-h-[82vh] w-full max-w-xl flex-col overflow-hidden shadow-2xl">
        <header className="flex items-start gap-3 border-b border-neutral-800 px-5 py-4">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-500/15 text-indigo-300"><Icon name="book" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">{t('Importar desde Zotero')}</h2>
            <p className="mt-1 text-xs text-neutral-500">{t('Copia de solo lectura: Nodus nunca modifica Zotero.')}</p>
          </div>
          <button className="btn btn-ghost" onClick={onClose} disabled={!!requestId} aria-label={t('Cerrar')}><Icon name="x" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {loading ? <div className="flex items-center gap-2 py-8 text-sm text-neutral-500"><Spinner /> {t('Buscando bibliotecas…')}</div> : (
            <div className="space-y-2">
              {libraries.map((library) => (
                <label key={library.id} className="flex items-center gap-3 rounded-xl border border-neutral-800 p-3 hover:bg-neutral-900/60">
                  <input type="checkbox" checked={selected.has(library.id)} disabled={!!requestId} onChange={(event) => setSelected((current) => {
                    const next = new Set(current); if (event.target.checked) next.add(library.id); else next.delete(library.id); return next;
                  })} />
                  <Icon name={library.type === 'group' ? 'users' : 'book'} className="text-neutral-500" />
                  <span className="min-w-0 flex-1"><b className="block truncate text-sm">{library.name}</b><span className="text-[11px] text-neutral-500">{library.id}</span></span>
                  <span className={`rounded-full px-2 py-1 text-[10px] ${library.lastImportedVersion === library.version && library.version > 0 ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>
                    {library.lastImportedVersion === library.version && library.version > 0 ? t('Actualizada') : t('Cambios disponibles')}
                  </span>
                </label>
              ))}
            </div>
          )}
          <div className="mt-4 grid gap-2 text-xs text-neutral-400 sm:grid-cols-2">
            <label className="flex items-center gap-2 rounded-lg bg-neutral-900/60 p-2.5"><input type="checkbox" checked={copyAttachments} disabled={!!requestId} onChange={(event) => setCopyAttachments(event.target.checked)} />{t('Copiar todos los adjuntos')}</label>
            <label className="flex items-center gap-2 rounded-lg bg-neutral-900/60 p-2.5"><input type="checkbox" checked={includeUnfiled} disabled={!!requestId} onChange={(event) => setIncludeUnfiled(event.target.checked)} />{t('Incluir documentos sin colección')}</label>
          </div>
          {progress && (
            <div className="mt-5 rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-3">
              <div className="flex items-center justify-between gap-3 text-xs"><span className="truncate text-indigo-200">{progress.message}</span><b className="tabular-nums">{progress.percent}%</b></div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-800"><div className="h-full bg-indigo-500 transition-[width]" style={{ width: `${progress.percent}%` }} /></div>
              <p className="mt-2 text-[10px] text-neutral-500">{progress.processedItems}/{progress.totalItems || '—'} {t('documentos')} · {progress.processedAttachments}/{progress.totalAttachments || '—'} {t('adjuntos')}</p>
            </div>
          )}
          {error && <p role="alert" className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{error}</p>}
        </div>
        <footer className="flex justify-end gap-2 border-t border-neutral-800 px-5 py-4">
          {requestId ? <button className="btn btn-ghost border border-neutral-700" onClick={() => void window.nodus.cancelZoteroLibraryImport(requestId)}><Icon name="x" /> {t('Cancelar')}</button> : (
            <><button className="btn btn-ghost" onClick={onClose}>{t('Cerrar')}</button><button data-testid="start-zotero-global-import" className="btn btn-primary" disabled={loading || selected.size === 0} onClick={() => void start()}><Icon name="download" /> {t('Importar / actualizar')}</button></>
          )}
        </footer>
      </section>
    </div>
  );
}

export function GlobalLibraryView({
  onOpenSettings, onOpenAssistant,
}: {
  onOpenSettings: () => void;
  onOpenAssistant: (target?: PendingAssistantNavigationTarget) => void;
}) {
  const [status, setStatus] = useState<LibraryStatus | null>(null);
  const [collections, setCollections] = useState<LibraryCollectionView[]>([]);
  const [items, setItems] = useState<LibraryCatalogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);
  const [source, setSource] = useState<LibraryItemSource | ''>('');
  const [extraction, setExtraction] = useState<LibraryCatalogItem['extractionStatus'] | ''>('');
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<LibraryItemRecord | null>(null);
  const [jobs, setJobs] = useState<LibraryExtractionJob[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoteroOpen, setZoteroOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [collectionTarget, setCollectionTarget] = useState('');
  const [readerItem, setReaderItem] = useState<LibraryItemRecord | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextStatus, page, nextCollections, nextJobs] = await Promise.all([
        window.nodus.getGlobalLibraryStatus(),
        window.nodus.listGlobalLibraryItems({
          search: search || undefined, collectionId: selectedCollection, source: source || null,
          extractionStatus: extraction || null,
          yearFrom: yearFrom ? Number(yearFrom) : null, yearTo: yearTo ? Number(yearTo) : null,
          limit: PAGE_SIZE, offset,
        }),
        window.nodus.listGlobalLibraryCollections(),
        window.nodus.listLibraryExtractionJobs(),
      ]);
      setStatus(nextStatus); setItems(page.items); setTotal(page.total); setCollections(nextCollections); setJobs(nextJobs); setError(null);
      if (!expanded.size && nextCollections.length) setExpanded(new Set(nextCollections.filter((entry) => !entry.parentId).map((entry) => entry.id)));
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : String(nextError)); }
    finally { setLoading(false); }
  }, [search, selectedCollection, source, extraction, yearFrom, yearTo, offset, expanded.size]);

  useEffect(() => { const timer = window.setTimeout(() => { setOffset(0); setSearch(searchDraft.trim()); }, 220); return () => window.clearTimeout(timer); }, [searchDraft]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const offChanged = window.nodus.onGlobalLibraryChanged(() => void load());
    const offExtraction = window.nodus.onLibraryExtractionProgress((progress) => {
      setJobs((current) => [progress, ...current.filter((job) => job.id !== progress.id)]);
      if (progress.status === 'done' || progress.status === 'failed') void load();
    });
    return () => { offChanged(); offExtraction(); };
  }, [load]);
  useEffect(() => {
    if (!detailId) { setDetail(null); return; }
    void window.nodus.getGlobalLibraryItem(detailId).then(setDetail);
  }, [detailId, status?.lastRebuiltAt]);

  const children = useMemo(() => collectionChildren(collections), [collections]);
  const localCollections = useMemo(() => collections.filter((entry) => entry.source === 'nodus'), [collections]);
  const activeJobs = jobs.filter((job) => ['queued', 'processing'].includes(job.status));

  const createCollection = async () => {
    const name = await promptText({ title: t('Nueva colección'), placeholder: t('Nombre de la colección'), confirmLabel: t('Crear') });
    if (!name?.trim()) return;
    try {
      const created = await window.nodus.createGlobalLibraryCollection(name, selectedCollection);
      setExpanded((current) => new Set([...current, ...(created.parentId ? [created.parentId] : [])]));
      setSelectedCollection(created.id); await load();
    } catch (nextError) { toast(nextError instanceof Error ? nextError.message : String(nextError), { tone: 'error' }); }
  };

  const renameCollection = async () => {
    const current = collections.find((entry) => entry.id === selectedCollection);
    if (!current || current.source !== 'nodus') return;
    const name = await promptText({ title: t('Renombrar colección'), initial: current.name, confirmLabel: t('Guardar') });
    if (!name?.trim()) return;
    await window.nodus.updateGlobalLibraryCollection(current.id, { name }); await load();
  };

  const deleteCollection = async () => {
    const current = collections.find((entry) => entry.id === selectedCollection);
    if (!current || current.source !== 'nodus') return;
    if (!(await confirm({ title: t('Eliminar colección'), message: t('Se eliminará la colección y sus subcolecciones. Los documentos seguirán en la Biblioteca.'), danger: true, confirmLabel: t('Eliminar') }))) return;
    await window.nodus.deleteGlobalLibraryCollection(current.id, false); setSelectedCollection(null); await load();
  };

  const importFiles = async () => {
    try {
      const report = await window.nodus.importGlobalLibraryFiles(selectedCollection);
      if (report.created) toast(tx('{n} documento(s) importado(s); la extracción continúa en segundo plano.', { n: report.created }));
      else if (report.warnings.length) toast(report.warnings[0], { tone: 'info' });
      await load();
    } catch (nextError) { toast(nextError instanceof Error ? nextError.message : String(nextError), { tone: 'error' }); }
  };

  const processSelected = async () => {
    const ids = selected.size ? [...selected] : detailId ? [detailId] : [];
    if (!ids.length) return;
    const result = await window.nodus.enqueueLibraryExtraction(ids, { force: true });
    toast(tx('{n} documento(s) en la cola.', { n: result.queued })); setSelected(new Set()); await load();
  };

  const addSelectedToCollection = async () => {
    if (!selected.size || !collectionTarget) return;
    await window.nodus.patchGlobalLibraryItemCollections([...selected], { add: [collectionTarget] });
    toast(t('Documentos añadidos a la colección.')); setCollectionTarget(''); setSelected(new Set()); await load();
  };

  const deleteSelected = async () => {
    const ids = selected.size ? [...selected] : detailId ? [detailId] : [];
    if (!ids.length || !(await confirm({ title: t('Enviar a la papelera'), message: tx('Se ocultarán {n} documento(s). Los archivos se conservan y pueden restaurarse.', { n: ids.length }), danger: true, confirmLabel: t('Enviar a la papelera') }))) return;
    await window.nodus.setGlobalLibraryItemsDeleted(ids, true); setSelected(new Set()); setDetailId(null); await load();
  };

  const openReader = async (itemId: string) => {
    const item = detail?.id === itemId ? detail : await window.nodus.getGlobalLibraryItem(itemId);
    if (!item?.files?.reader) return;
    setReaderItem(item);
  };

  if (readerItem) {
    return <LibraryDocumentReader
      reference={{
        id: readerItem.id,
        zoteroKey: readerItem.source === 'zotero' ? readerItem.sourceKey ?? null : null,
        title: readerItem.metadata.title,
        authors: readerItem.metadata.creators.map((creator) => creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(' ')).filter(Boolean),
        year: readerItem.metadata.year ?? null,
      }}
      onBack={() => setReaderItem(null)}
      onOpenAssistant={onOpenAssistant}
    />;
  }

  if (loading && !status) return <div className="grid h-full place-items-center text-sm text-neutral-500"><span className="flex items-center gap-2"><Spinner /> {t('Cargando Biblioteca…')}</span></div>;
  if (!status?.configured) return (
    <div className="grid h-full place-items-center p-8">
      <section className="card max-w-lg p-7 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-indigo-500/10 text-indigo-300"><Icon name="book" size={28} /></span>
        <h1 className="mt-4 text-xl font-semibold">{t('Activa la Biblioteca transversal')}</h1>
        <p className="mt-2 text-sm leading-6 text-neutral-500">{t('Elige una carpeta de copias de seguridad. Nodus creará dentro nodus-library para guardar originales, Markdown limpio y recursos.')}</p>
        <button className="btn btn-primary mt-5" onClick={onOpenSettings}><Icon name="settings" /> {t('Configurar copias de seguridad')}</button>
      </section>
    </div>
  );

  return (
    <div data-testid="global-library-view" className="flex h-full min-h-0 flex-col bg-neutral-950">
      <header className="flex flex-wrap items-center gap-3 border-b border-neutral-800 px-5 py-3">
        <div className="min-w-0"><h1 className="flex items-center gap-2 text-lg font-semibold"><Icon name="book" className="text-indigo-400" /> {t('Biblioteca')}</h1><p className="text-[11px] text-neutral-500">{tx('{n} documentos · disponible en todos los vaults', { n: status.items })}</p></div>
        <div className="flex-1" />
        {activeJobs.length > 0 && <span className="flex items-center gap-2 rounded-full bg-indigo-500/10 px-3 py-1.5 text-xs text-indigo-300"><Spinner /> {tx('{n} tarea(s) en segundo plano', { n: activeJobs.length })}</span>}
        <button className="btn btn-ghost border border-neutral-700" onClick={() => void importFiles()}><Icon name="upload" /> {t('Añadir archivos')}</button>
        <button data-testid="open-zotero-global-import" className="btn btn-primary" onClick={() => setZoteroOpen(true)}><Icon name="refresh" /> {t('Zotero')}</button>
      </header>

      {error && <div role="alert" className="border-b border-red-500/30 bg-red-500/10 px-5 py-2 text-xs text-red-300">{error}</div>}
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[238px] shrink-0 flex-col border-r border-neutral-800 bg-neutral-950/80">
          <div className="flex items-center gap-1 px-3 py-3"><b className="min-w-0 flex-1 text-[11px] uppercase tracking-wider text-neutral-500">{t('Colecciones')}</b><button className="grid h-7 w-7 place-items-center rounded hover:bg-neutral-900" title={t('Nueva colección')} onClick={() => void createCollection()}><Icon name="folderPlus" size={14} /></button></div>
          <div className="px-2 pb-2">
            <button className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${selectedCollection === null ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-900'}`} onClick={() => { setSelectedCollection(null); setOffset(0); }}><Icon name="library" size={14} /><span className="flex-1">{t('Todos los documentos')}</span><span className="text-[10px] opacity-60">{status.items}</span></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {(children.get(null) ?? []).map((collection) => <CollectionBranch key={collection.id} collection={collection} children={children} selected={selectedCollection} expanded={expanded} onSelect={(id) => { setSelectedCollection(id); setOffset(0); }} onToggle={(id) => setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })} depth={0} />)}
            {collections.length === 0 && <p className="px-3 py-4 text-xs leading-5 text-neutral-600">{t('Crea colecciones propias o importa la jerarquía completa de Zotero.')}</p>}
          </div>
          {collections.find((entry) => entry.id === selectedCollection)?.source === 'nodus' && <div className="flex gap-1 border-t border-neutral-800 p-2"><button className="btn btn-ghost flex-1 text-xs" onClick={() => void renameCollection()}><Icon name="edit" size={13} /> {t('Renombrar')}</button><button className="btn btn-ghost text-red-400" onClick={() => void deleteCollection()} title={t('Eliminar colección')}><Icon name="trash" size={13} /></button></div>}
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-neutral-800 p-3">
            <div className="flex items-center gap-2">
              <div className="relative min-w-[220px] flex-1"><Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600" /><input data-testid="global-library-search" className="input w-full pl-9" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder={t('Buscar título, autor, etiqueta, DOI, ISBN o ISSN…')} /></div>
              <button className={`btn border border-neutral-700 ${filtersOpen || source || extraction || yearFrom || yearTo ? 'bg-indigo-500/10 text-indigo-300' : 'btn-ghost'}`} onClick={() => setFiltersOpen((value) => !value)}><Icon name="filter" /> {t('Filtros')}</button>
            </div>
            {filtersOpen && <div className="mt-2 grid gap-2 rounded-xl bg-neutral-900/55 p-2 sm:grid-cols-4">
              <select className="input text-xs" value={source} onChange={(event) => { setSource(event.target.value as LibraryItemSource | ''); setOffset(0); }}><option value="">{t('Todos los orígenes')}</option>{Object.entries(SOURCE_LABEL).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
              <select className="input text-xs" value={extraction} onChange={(event) => { setExtraction(event.target.value as typeof extraction); setOffset(0); }}><option value="">{t('Cualquier estado')}</option>{Object.entries(EXTRACTION_LABEL).map(([id, label]) => <option key={id} value={id}>{t(label)}</option>)}</select>
              <input className="input text-xs" type="number" value={yearFrom} onChange={(event) => { setYearFrom(event.target.value); setOffset(0); }} placeholder={t('Año desde')} />
              <input className="input text-xs" type="number" value={yearTo} onChange={(event) => { setYearTo(event.target.value); setOffset(0); }} placeholder={t('Año hasta')} />
            </div>}
          </div>

          {selected.size > 0 && <div data-testid="global-library-bulk-actions" className="flex flex-wrap items-center gap-2 border-b border-indigo-500/20 bg-indigo-500/5 px-3 py-2 text-xs"><b>{tx('{n} seleccionados', { n: selected.size })}</b><select className="input ml-2 h-8 min-w-44 text-xs" value={collectionTarget} onChange={(event) => setCollectionTarget(event.target.value)}><option value="">{t('Añadir a colección…')}</option>{localCollections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}</select><button className="btn btn-ghost h-8" disabled={!collectionTarget} onClick={() => void addSelectedToCollection()}>{t('Aplicar')}</button><button className="btn btn-ghost h-8" onClick={() => void processSelected()}><Icon name="refresh" size={13} /> {t('Procesar de nuevo')}</button><button className="btn btn-ghost h-8 text-red-400" onClick={() => void deleteSelected()}><Icon name="trash" size={13} /> {t('Papelera')}</button><button className="ml-auto text-neutral-500 hover:text-neutral-200" onClick={() => setSelected(new Set())}>{t('Limpiar selección')}</button></div>}

          <div className="grid h-9 grid-cols-[2.2rem_minmax(16rem,2fr)_minmax(9rem,1fr)_4.5rem_7rem_7.5rem] items-center border-b border-neutral-800 px-3 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
            <input type="checkbox" checked={items.length > 0 && items.every((item) => selected.has(item.id))} onChange={(event) => setSelected((current) => { const next = new Set(current); for (const item of items) { if (event.target.checked) next.add(item.id); else next.delete(item.id); } return next; })} aria-label={t('Seleccionar página')} />
            <span>{t('Documento')}</span><span>{t('Autoría')}</span><span>{t('Año')}</span><span>{t('Origen')}</span><span>{t('Estado')}</span>
          </div>
          <VirtualList
            items={items} itemHeight={62} getKey={(item) => item.id} className="min-h-0 flex-1"
            empty={<div className="grid h-full place-items-center p-8 text-center"><div><Icon name="book" size={28} className="mx-auto text-neutral-700" /><p className="mt-3 text-sm text-neutral-400">{t('No hay documentos que coincidan.')}</p><p className="mt-1 text-xs text-neutral-600">{t('Añade archivos o importa una biblioteca de Zotero.')}</p></div></div>}
            renderItem={(item) => {
              const activeJob = jobs.find((job) => job.itemId === item.id && ['queued', 'processing'].includes(job.status));
              return <div data-testid={`global-library-item-${item.id}`} className={`grid h-[62px] grid-cols-[2.2rem_minmax(16rem,2fr)_minmax(9rem,1fr)_4.5rem_7rem_7.5rem] items-center border-b border-neutral-900 px-3 text-xs ${detailId === item.id ? 'bg-indigo-500/10' : 'hover:bg-neutral-900/55'}`} onDoubleClick={() => item.readerAvailable ? void openReader(item.id) : setDetailId(item.id)}>
                <input type="checkbox" checked={selected.has(item.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; })} />
                <button className="min-w-0 pr-4 text-left" onClick={() => setDetailId(item.id)}><b className="block truncate font-medium text-neutral-200">{item.title}</b><span className="mt-1 block truncate text-[10px] text-neutral-600">{item.doi || item.isbn[0] || item.issn[0] || item.sourceKey || item.id}</span></button>
                <span className="truncate pr-3 text-neutral-500">{creatorText(item) || '—'}</span><span className="tabular-nums text-neutral-500">{item.year ?? '—'}</span><span className="w-fit rounded bg-neutral-900 px-2 py-1 text-[10px] text-neutral-400">{SOURCE_LABEL[item.source]}</span>
                <span className={`flex items-center gap-1.5 text-[10px] ${activeJob ? 'text-indigo-300' : item.extractionStatus === 'ready' ? 'text-emerald-400' : item.extractionStatus === 'failed' ? 'text-red-400' : 'text-neutral-500'}`}>{activeJob && <Spinner />} {activeJob ? `${Math.round(activeJob.progress * 100)}%` : t(EXTRACTION_LABEL[item.extractionStatus])}</span>
              </div>;
            }}
          />
          <footer className="flex h-10 items-center border-t border-neutral-800 px-3 text-xs text-neutral-500"><span>{tx('{start}–{end} de {total}', { start: total ? offset + 1 : 0, end: Math.min(offset + items.length, total), total })}</span><div className="flex-1" /><button className="btn btn-ghost h-7" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}><Icon name="chevronLeft" size={13} /></button><button className="btn btn-ghost h-7" disabled={offset + items.length >= total} onClick={() => setOffset(offset + PAGE_SIZE)}><Icon name="chevronRight" size={13} /></button></footer>
        </section>

        {detail && <aside data-testid="global-library-detail" className="flex w-[310px] shrink-0 flex-col border-l border-neutral-800 bg-neutral-950">
          <header className="flex items-center gap-2 border-b border-neutral-800 p-3"><b className="min-w-0 flex-1 truncate text-sm">{t('Detalles')}</b><button className="grid h-7 w-7 place-items-center rounded hover:bg-neutral-900" onClick={() => setDetailId(null)}><Icon name="x" size={14} /></button></header>
          <div className="min-h-0 flex-1 overflow-y-auto p-4"><span className="rounded bg-indigo-500/10 px-2 py-1 text-[10px] font-medium text-indigo-300">{SOURCE_LABEL[detail.source]}</span><h2 className="mt-3 text-base font-semibold leading-6">{detail.metadata.title}</h2><p className="mt-2 text-xs leading-5 text-neutral-500">{detail.metadata.creators.map((creator) => creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(' ')).filter(Boolean).join('; ') || t('Sin autoría')}</p>
            <dl className="mt-5 space-y-3 text-xs">{[
              [t('Tipo'), detail.metadata.itemType], [t('Fecha'), detail.metadata.date || detail.metadata.year], [t('Publicación'), detail.metadata.publicationTitle], [t('Editorial'), detail.metadata.publisher], [t('DOI'), detail.metadata.doi], [t('ISBN'), detail.metadata.isbn?.join('; ')], [t('ISSN'), detail.metadata.issn?.join('; ')], [t('Idioma'), detail.metadata.language], [t('Identificador'), detail.sourceKey || detail.id],
            ].filter(([, value]) => value != null && value !== '').map(([label, value]) => <div key={String(label)}><dt className="text-[10px] uppercase tracking-wider text-neutral-600">{label}</dt><dd className="mt-1 break-words text-neutral-300">{String(value)}</dd></div>)}</dl>
            {detail.metadata.abstract && <div className="mt-5"><h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-600">{t('Resumen')}</h3><p className="mt-2 text-xs leading-5 text-neutral-400">{detail.metadata.abstract}</p></div>}
            {detail.metadata.tags?.length ? <div className="mt-5 flex flex-wrap gap-1">{detail.metadata.tags.map((tag) => <span key={tag} className="rounded-full bg-neutral-900 px-2 py-1 text-[10px] text-neutral-400">{tag}</span>)}</div> : null}
            <div className="mt-5 rounded-xl border border-neutral-800 p-3"><div className="flex items-center justify-between text-xs"><span>{t('Versión limpia')}</span><b className={detail.extraction?.status === 'ready' ? 'text-emerald-400' : 'text-neutral-500'}>{t(EXTRACTION_LABEL[detail.extraction?.status ?? 'pending'])}</b></div>{detail.extraction?.error && <p className="mt-2 text-[10px] text-red-400">{detail.extraction.error}</p>}<p className="mt-2 text-[10px] text-neutral-600">{detail.attachments.length} {t('adjuntos')} · {detail.files?.reader ? t('Markdown disponible') : t('Sin Markdown')}</p></div>
          </div>
          <footer className="grid grid-cols-2 gap-2 border-t border-neutral-800 p-3"><button className="btn btn-primary" disabled={!detail.files?.reader} title={!detail.files?.reader ? t('Procesa el documento primero') : undefined} onClick={() => void openReader(detail.id)}><Icon name="bookOpen" /> {t('Leer')}</button><button className="btn btn-ghost border border-neutral-700" onClick={() => void processSelected()}><Icon name="refresh" /> {t('Procesar')}</button><button className="btn btn-ghost col-span-2 text-red-400" onClick={() => void deleteSelected()}><Icon name="trash" /> {t('Enviar a la papelera')}</button></footer>
        </aside>}
      </div>
      {zoteroOpen && <ZoteroImportDialog onClose={() => setZoteroOpen(false)} onFinished={() => void load()} />}
    </div>
  );
}
