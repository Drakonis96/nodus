import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
import type {
  LibraryCatalogItem,
  LibraryCollectionView,
  LibraryExtractionJob,
  LibraryItemRecord,
  LibraryItemSource,
  LibraryMigrationPreview,
  LibraryMigrationProgress,
  LibraryMigrationSession,
  LibraryScope,
  LibraryStatus,
  LibraryVaultLink,
  LibrarySavedSearchRecord,
  LibraryCatalogFacets,
  LibraryColumnId,
  LibrarySortField,
  LibraryViewPreferences,
  LibraryItemType,
  ZoteroImportProgress,
  ZoteroImportSelection,
  ZoteroLibraryPreview,
  ZoteroSyncSession,
} from '@shared/libraryTypes';
import type { AppSettings, VaultSummary, VaultType } from '@shared/types';
import { Icon, Spinner } from '../components/ui';
import { LibraryCitationExportDialog, LibraryDuplicatesDialog, LibraryMetadataBatchDialog, LibraryMetadataEditor } from '../components/library/LibraryMetadataDialogs';
import { LibraryItemManager } from '../components/library/LibraryItemManager';
import { LibrarySmartSearchDialog, LibraryTablePreferencesDialog } from '../components/library/LibrarySmartSearchDialog';
import { LibraryRecoveryDialog, LibraryTrashImpactDialog } from '../components/library/LibraryRecoveryDialogs';
import { LibraryDocumentReader } from './LibraryDocumentReader';
import { VirtualList } from '../components/VirtualList';
import { confirm, promptText, toast } from '../components/feedback';
import { t, tx } from '../i18n';
import type { PendingAssistantNavigationTarget } from '../navigation';
import type { PendingLibraryNavigationTarget } from '../navigation';
import type { PendingGraphNavigationTarget } from '../navigation';
import { Library } from './Library';

const PAGE_SIZE = 250;
const TRASH_SEARCH = { id: 'library-trash', mode: 'all' as const, rules: [{ id: 'library-trash-only', field: 'trash' as const, operator: 'is-true' as const, value: true }] };

const SOURCE_LABEL: Record<LibraryItemSource, string> = {
  nodus: 'Nodus', zotero: 'Zotero', mendeley: 'Mendeley', ris: 'RIS', bibtex: 'BibTeX',
  biblatex: 'BibLaTeX', 'csl-json': 'CSL JSON', 'endnote-xml': 'EndNote XML',
  'zotero-rdf': 'Zotero RDF', csv: 'CSV', markdown: 'Markdown', legacy: 'Legado',
};

const EXTRACTION_LABEL: Record<LibraryCatalogItem['extractionStatus'], string> = {
  pending: 'Pendiente', processing: 'Procesando…', ready: 'Lista', 'needs-review': 'Revisar', failed: 'Con error', unsupported: 'No compatible',
};

const REUSE_COMPONENT_LABELS = {
  light: 'Light', deep: 'Deep', summary: 'Resumen', ideas: 'Ideas', passages: 'Pasajes', embeddings: 'Embeddings',
} as const;

const EMPTY_FACETS: LibraryCatalogFacets = { sources: [], itemTypes: [], extraction: [], attachments: [], years: [], tags: [], vaults: [] };
const DEFAULT_VIEW_PREFERENCES: LibraryViewPreferences = {
  visibleColumns: ['title', 'creator', 'year', 'source', 'status'],
  sort: [{ field: 'updatedAt', direction: 'desc' }, { field: 'title', direction: 'asc' }],
};
const COLUMN_LABEL: Record<LibraryColumnId, string> = {
  title: 'Documento', creator: 'Autoría', year: 'Año', source: 'Origen', status: 'Estado',
  attachments: 'Adjuntos', updatedAt: 'Modificado',
};
const COLUMN_WIDTH: Record<LibraryColumnId, string> = {
  title: 'minmax(14rem,2fr)', creator: 'minmax(9rem,1fr)', year: '4.5rem', source: '7rem', status: '7.5rem',
  attachments: '5.5rem', updatedAt: '8.5rem',
};
const COLUMN_SORT: Partial<Record<LibraryColumnId, LibrarySortField>> = {
  title: 'title', creator: 'creator', year: 'year', source: 'source', status: 'extraction', attachments: 'attachments', updatedAt: 'updatedAt',
};

function VaultReuseBadges({ link }: { link: LibraryVaultLink }) {
  if (!link.analysis.reuse) return null;
  return <div data-testid={`vault-reuse-${link.vaultId}`} className="mt-2 grid grid-cols-2 gap-1">
    {Object.entries(link.analysis.reuse).map(([component, status]) => <span
      key={component}
      title={status.reason}
      className={`flex min-w-0 items-center justify-between gap-1 rounded px-1.5 py-1 text-[9px] ${
        status.state === 'reused' || status.state === 'current' ? 'bg-emerald-500/10 text-emerald-300'
          : status.state === 'incompatible' ? 'bg-amber-500/10 text-amber-300'
            : 'bg-neutral-900 text-neutral-500'
      }`}
    ><span className="truncate">{t(REUSE_COMPONENT_LABELS[component as keyof typeof REUSE_COMPONENT_LABELS])}</span><span aria-hidden="true">{status.state === 'reused' ? '↗' : status.state === 'current' ? '✓' : status.state === 'incompatible' ? '!' : '·'}</span></span>)}
  </div>;
}

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
  onDrop,
  depth,
}: {
  collection: LibraryCollectionView;
  children: Map<string | null, LibraryCollectionView[]>;
  selected: string | null;
  expanded: Set<string>;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onDrop: (event: DragEvent, collection: LibraryCollectionView) => void;
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
          draggable={collection.source === 'nodus'}
          onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-nodus-library-collection', collection.id); }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => onDrop(event, collection)}
        >
          <Icon name="folder" size={13} className="shrink-0 opacity-70" />
          <span className="min-w-0 flex-1 truncate">{collection.name}</span>
          {collection.source !== 'nodus' && <Icon name="lock" size={9} className="shrink-0 opacity-45" />}
          <span className="text-[10px] tabular-nums opacity-55">{collection.directItemCount}</span>
        </button>
      </div>
      {open && descendants.map((child) => (
        <CollectionBranch
          key={child.id} collection={child} children={children} selected={selected} expanded={expanded}
          onSelect={onSelect} onToggle={onToggle} depth={depth + 1}
          onDrop={onDrop}
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
  const [sessions, setSessions] = useState<ZoteroSyncSession[]>([]);
  const [lastReport, setLastReport] = useState<ZoteroSyncSession['report']>(null);

  useEffect(() => {
    let alive = true;
    void Promise.allSettled([
      window.nodus.listZoteroImportLibraries(),
      window.nodus.listZoteroSyncSessions(),
    ]).then(([libraryResult, sessionResult]) => {
      if (!alive) return;
      if (libraryResult.status === 'fulfilled') {
        setLibraries(libraryResult.value);
        setSelected(new Set(libraryResult.value.map((entry) => entry.id)));
      } else setError(libraryResult.reason instanceof Error ? libraryResult.reason.message : String(libraryResult.reason));
      if (sessionResult.status === 'fulfilled') setSessions(sessionResult.value);
    }).finally(() => alive && setLoading(false));
    const off = window.nodus.onZoteroImportProgress((value) => {
      if (!requestId || value.requestId === requestId) setProgress(value);
    });
    return () => { alive = false; off(); };
  }, [requestId]);

  const run = async (id: string, selection?: ZoteroImportSelection) => {
    setRequestId(id);
    setError(null);
    setLastReport(null);
    try {
      const report = selection
        ? await window.nodus.importZoteroLibrary(id, selection)
        : await window.nodus.resumeZoteroLibraryImport(id);
      setLastReport(report);
      toast(report.canceled ? t('La importación se canceló; el catálogo ya recuperado se conserva.')
        : report.partial ? t('La sincronización terminó parcialmente; los datos locales se conservan.')
          : tx('Importación terminada: {n} documentos.', { n: report.itemsDiscovered }));
      onFinished();
      if (!report.canceled && !report.partial) onClose();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setRequestId(null);
      void window.nodus.listZoteroSyncSessions().then(setSessions).catch(() => undefined);
    }
  };
  const start = () => run(crypto.randomUUID(), { libraryIds: [...selected], copyAttachments, includeUnfiled });
  const resumable = sessions.find((session) => session.status === 'canceled' || session.status === 'failed');

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
          {resumable && !requestId && (
            <div data-testid="zotero-sync-resume" className="mb-4 flex items-center gap-3 rounded-xl border border-amber-500/35 bg-amber-500/10 p-3">
              <Icon name="refresh" className="shrink-0 text-amber-700 dark:text-amber-300" />
              <div className="min-w-0 flex-1 text-xs"><b className="block text-amber-950 dark:text-amber-100">{t('Sincronización interrumpida')}</b><span className="text-amber-800 dark:text-amber-200/80">{resumable.progress.message}</span></div>
              <button data-testid="resume-zotero-sync" className="btn btn-ghost border border-amber-500/25" onClick={() => void run(resumable.id)}>{t('Reanudar')}</button>
            </div>
          )}
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
          {lastReport?.partial && (
            <div role="status" className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-950 dark:text-amber-100">
              <b>{t('Sincronización parcial')}</b>
              <p className="mt-1">{tx('{n} incidencia(s); {missing} fuente(s) ausente(s); {attachments} adjunto(s) no disponible(s).', {
                n: lastReport.failures.length, missing: lastReport.itemsSourceMissing, attachments: lastReport.attachmentsUnavailable,
              })}</p>
            </div>
          )}
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

function migrationBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function LibraryMigrationDialog({ onClose, onFinished }: { onClose: () => void; onFinished: () => void }) {
  const [preview, setPreview] = useState<LibraryMigrationPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [session, setSession] = useState<LibraryMigrationSession | null>(null);
  const [progress, setProgress] = useState<LibraryMigrationProgress | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void Promise.all([window.nodus.previewLibraryMigration(), window.nodus.listLibraryMigrationSessions()])
      .then(([nextPreview, sessions]) => {
        if (!alive) return;
        setPreview(nextPreview); setSelected(new Set(nextPreview.selectedVaultIds));
        setSession(sessions.find((entry) => entry.status !== 'rolled-back') ?? null);
      })
      .catch((nextError) => alive && setError(nextError instanceof Error ? nextError.message : String(nextError)))
      .finally(() => alive && setBusy(false));
    const off = window.nodus.onLibraryMigrationProgress((next) => {
      setProgress(next);
      setSession((current) => !current || current.id !== next.sessionId ? current : {
        ...current,
        checkpoint: { phase: next.phase, vaultId: next.vaultId, processedItems: next.processedItems, totalItems: next.totalItems, percent: next.percent, recordedAt: new Date().toISOString() },
      });
    });
    return () => { alive = false; off(); };
  }, []);

  const execute = async (resume = false) => {
    if (!preview || busy) return;
    setBusy(true); setError(null);
    try {
      const result = resume && session
        ? await window.nodus.resumeLibraryMigration(session.id)
        : await window.nodus.startLibraryMigration({ preview, selectedVaultIds: [...selected] });
      setSession(result);
      if (result.status === 'completed') {
        toast(tx('Migración verificada: {n} documentos enlazados.', { n: result.report?.vaultLinks ?? 0 }));
        onFinished();
      }
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : String(nextError)); }
    finally { setBusy(false); }
  };

  const rollback = async () => {
    if (!session || busy) return;
    setBusy(true); setError(null);
    try {
      const result = await window.nodus.rollbackLibraryMigration(session.id);
      setSession(result); onFinished();
      toast(result.rollbackConflicts.length
        ? tx('Rollback terminado con {n} conflicto(s) conservado(s).', { n: result.rollbackConflicts.length })
        : t('Rollback terminado sin pérdida de datos.'));
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : String(nextError)); }
    finally { setBusy(false); }
  };

  const active = busy && Boolean(progress?.sessionId) && progress?.phase !== 'complete';
  const shownProgress = progress?.sessionId === session?.id || active ? progress : null;
  return <div className="fixed inset-0 z-[86] grid place-items-center bg-black/65 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !active) onClose(); }}>
    <section data-testid="library-migration-dialog" className="card flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden shadow-2xl">
      <header className="flex items-start gap-3 border-b border-neutral-800 p-5"><span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-500/15 text-indigo-300"><Icon name="vault" /></span><div className="min-w-0 flex-1"><h2 className="font-semibold">{t('Migrar vaults a la Biblioteca global')}</h2><p className="mt-1 text-xs leading-5 text-neutral-500">{t('Simula primero, lee los vaults sin modificarlos y conserva análisis, notas y documentos existentes.')}</p></div><button className="btn btn-ghost" onClick={onClose} disabled={active} aria-label={t('Cerrar')}><Icon name="x" /></button></header>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {busy && !preview ? <div className="flex items-center gap-2 py-8 text-sm text-neutral-500"><Spinner /> {t('Creando inventario de solo lectura…')}</div> : preview && <>
          <div className="grid gap-2 sm:grid-cols-4">
            {[
              [t('Documentos'), preview.vaults.filter((vault) => selected.has(vault.id)).reduce((sum, vault) => sum + vault.itemCount, 0)],
              [t('Colecciones'), preview.vaults.filter((vault) => selected.has(vault.id)).reduce((sum, vault) => sum + vault.collectionCount, 0)],
              [t('Duplicados previstos'), preview.vaults.filter((vault) => selected.has(vault.id)).reduce((sum, vault) => sum + vault.duplicateItems, 0)],
              [t('Espacio estimado'), migrationBytes(preview.vaults.filter((vault) => selected.has(vault.id)).reduce((sum, vault) => sum + vault.estimatedAdditionalBytes, 0))],
            ].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3"><span className="block text-[9px] uppercase tracking-wider text-neutral-600">{label}</span><b className="mt-1 block text-sm tabular-nums">{value}</b></div>)}
          </div>
          <div className="mt-4 space-y-2">{preview.vaults.map((vault) => <label key={vault.id} className={`flex items-center gap-3 rounded-xl border p-3 ${selected.has(vault.id) ? 'border-indigo-500/40 bg-indigo-500/5' : 'border-neutral-800'}`}>
            <input type="checkbox" checked={selected.has(vault.id)} disabled={active || !vault.available} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(vault.id); else next.delete(vault.id); return next; })} />
            <Icon name="vault" size={15} className="text-neutral-500" /><span className="min-w-0 flex-1"><b className="block truncate text-sm font-medium">{vault.name}</b><span className="text-[10px] text-neutral-600">{vault.type} · {vault.origin === 'local' ? t('local') : t('conectado')} · {vault.itemCount} {t('documentos')}</span>{vault.warnings.map((warning) => <span key={warning} className="mt-1 block text-[10px] text-amber-400">{t(warning)}</span>)}</span>
            {vault.defaultSelected && <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[9px] text-emerald-300">{t('Recomendado')}</span>}
          </label>)}</div>
        </>}
        {(shownProgress || session) && <div data-testid="library-migration-progress" className="mt-5 rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4">
          <div className="flex items-center justify-between gap-3 text-xs"><b>{session?.status === 'completed' ? t('Migración verificada') : session?.status === 'rolled-back' ? t('Migración revertida') : session?.status === 'canceled' ? t('Migración pausada de forma segura') : t('Migrando Biblioteca…')}</b><span className="tabular-nums">{shownProgress?.percent ?? session?.checkpoint.percent ?? 0}%</span></div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-800"><div className="h-full bg-indigo-500 transition-[width]" style={{ width: `${shownProgress?.percent ?? session?.checkpoint.percent ?? 0}%` }} /></div>
          <p className="mt-2 text-[10px] text-neutral-500">{shownProgress?.processedItems ?? session?.checkpoint.processedItems ?? 0}/{shownProgress?.totalItems || session?.checkpoint.totalItems || '—'} {t('documentos')} · {t('checkpoint recuperable')}</p>
          {session?.verification && <div className="mt-3 grid grid-cols-2 gap-1 text-[10px] text-emerald-400"><span>✓ {t('Catálogo')}</span><span>✓ {t('Manifiestos')}</span><span>✓ {t('Archivos')}</span><span>✓ {t('Enlaces')}</span></div>}
          {session?.rollbackConflicts.length ? <p className="mt-3 text-[10px] text-amber-300">{tx('{n} registro(s) modificados después de migrar se conservaron para revisión.', { n: session.rollbackConflicts.length })}</p> : null}
        </div>}
        {error && <p role="alert" className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{error}</p>}
      </div>
      <footer className="flex flex-wrap justify-end gap-2 border-t border-neutral-800 p-4">
        {active && progress?.sessionId ? <button className="btn btn-ghost border border-neutral-700" onClick={() => void window.nodus.cancelLibraryMigration(progress.sessionId!)}><Icon name="x" /> {t('Cancelar con seguridad')}</button> : <>
          {session && ['canceled', 'failed'].includes(session.status) && <button className="btn btn-primary" disabled={busy} onClick={() => void execute(true)}><Icon name="refresh" /> {t('Reanudar')}</button>}
          {session && ['completed', 'canceled', 'failed'].includes(session.status) && <button className="btn btn-ghost border border-amber-500/30 text-amber-300" disabled={busy} onClick={() => void rollback()}><Icon name="undo" /> {t('Revertir esta migración')}</button>}
          {session?.status === 'completed' && <button className="btn btn-ghost border border-neutral-700" disabled={busy} onClick={() => { setSession(null); setProgress(null); }}>{t('Nueva simulación')}</button>}
          <button className="btn btn-ghost" disabled={busy} onClick={onClose}>{t('Cerrar')}</button>
          {(!session || session.status === 'rolled-back') && <button data-testid="start-library-migration" className="btn btn-primary" disabled={busy || selected.size === 0} onClick={() => void execute()}><Icon name="check" /> {t('Migrar y verificar')}</button>}
        </>}
      </footer>
    </section>
  </div>;
}

function VaultLinkDialog({ itemIds, onClose, onLinked }: {
  itemIds: string[];
  onClose: () => void;
  onLinked: (links: LibraryVaultLink[]) => void;
}) {
  const [vaults, setVaults] = useState<VaultSummary[]>([]);
  const [vaultId, setVaultId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void window.nodus.listGlobalLibraryVaults().then((entries) => {
      setVaults(entries);
      setVaultId(entries.find((vault) => !(vault.origin === 'connected' && (vault.remote?.role === 'reader' || vault.remote?.state !== 'active')))?.id ?? '');
    }).catch((nextError) => setError(nextError instanceof Error ? nextError.message : String(nextError)));
  }, []);
  const link = async () => {
    if (!vaultId || busy) return;
    setBusy(true); setError(null);
    try {
      const report = await window.nodus.linkGlobalLibraryItemsToVault(itemIds, vaultId);
      toast(report.linked
        ? report.reusedComponents
          ? tx('{n} documento(s) añadidos; {reused} componente(s) reutilizados con huellas exactas.', { n: report.linked, reused: report.reusedComponents })
          : tx('{n} documento(s) añadidos al vault.', { n: report.linked })
        : t('Los documentos ya estaban vinculados a ese vault.'));
      onLinked(report.links);
      onClose();
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : String(nextError)); }
    finally { setBusy(false); }
  };
  return <div className="fixed inset-0 z-[85] grid place-items-center bg-black/65 p-6" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section data-testid="global-library-vault-dialog" className="card w-full max-w-lg overflow-hidden shadow-2xl">
      <header className="flex items-start gap-3 border-b border-neutral-800 p-5"><span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-500/15 text-indigo-300"><Icon name="vault" /></span><div className="min-w-0 flex-1"><h2 className="font-semibold">{t('Añadir al vault')}</h2><p className="mt-1 text-xs leading-5 text-neutral-500">{tx('{n} documento(s) conservarán su copia global; el vault recibirá una referencia analizable al Markdown limpio.', { n: itemIds.length })}</p></div><button className="btn btn-ghost" onClick={onClose} disabled={busy} aria-label={t('Cerrar')}><Icon name="x" /></button></header>
      <div className="space-y-2 p-5">{vaults.map((vault) => {
        const readOnly = vault.origin === 'connected' && (vault.remote?.role === 'reader' || vault.remote?.state !== 'active');
        return <label key={vault.id} className={`flex items-center gap-3 rounded-xl border p-3 ${readOnly ? 'border-neutral-900 opacity-55' : vaultId === vault.id ? 'border-indigo-500/50 bg-indigo-500/5' : 'border-neutral-800 hover:bg-neutral-900/50'}`}><input type="radio" name="library-vault" value={vault.id} checked={vaultId === vault.id} disabled={readOnly || busy} onChange={() => setVaultId(vault.id)} /><Icon name="vault" size={15} className="text-neutral-500" /><span className="min-w-0 flex-1"><b className="block truncate text-sm font-medium">{vault.name}</b><span className="text-[10px] text-neutral-600">{vault.type} · {vault.origin === 'connected' ? `${vault.remote?.role ?? 'reader'} · ${vault.remote?.spaceName ?? ''}` : t('local')}</span></span>{vault.active && <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[9px] text-emerald-300">{t('Activo')}</span>}{readOnly && <span className="text-[9px] text-neutral-600">{t('Solo lectura')}</span>}</label>;
      })}{!vaults.length && !error && <p className="py-5 text-center text-sm text-neutral-500">{t('No hay vaults disponibles.')}</p>}{error && <p role="alert" className="rounded-lg bg-red-500/10 p-3 text-xs text-red-300">{error}</p>}</div>
      <footer className="flex justify-end gap-2 border-t border-neutral-800 p-4"><button className="btn btn-ghost" disabled={busy} onClick={onClose}>{t('Cancelar')}</button><button data-testid="confirm-global-library-vault-link" className="btn btn-primary" disabled={!vaultId || busy} onClick={() => void link()}>{busy ? <Spinner /> : <Icon name="plus" />} {t('Añadir')}</button></footer>
    </section>
  </div>;
}

function GlobalLibraryContent({
  target, onOpenSettings, onOpenAssistant,
}: {
  target?: (PendingLibraryNavigationTarget & { nonce: number }) | null;
  onOpenSettings: () => void;
  onOpenAssistant: (target?: PendingAssistantNavigationTarget) => void;
}) {
  const [status, setStatus] = useState<LibraryStatus | null>(null);
  const [collections, setCollections] = useState<LibraryCollectionView[]>([]);
  const [savedSearches, setSavedSearches] = useState<LibrarySavedSearchRecord[]>([]);
  const [selectedSavedSearch, setSelectedSavedSearch] = useState<string | null>(null);
  const [facets, setFacets] = useState<LibraryCatalogFacets>(EMPTY_FACETS);
  const [viewPreferences, setViewPreferences] = useState<LibraryViewPreferences>(DEFAULT_VIEW_PREFERENCES);
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
  const [itemType, setItemType] = useState<LibraryItemType | ''>('');
  const [facetTag, setFacetTag] = useState('');
  const [facetVault, setFacetVault] = useState('');
  const [attachmentFilter, setAttachmentFilter] = useState<'' | 'with' | 'without'>('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<LibraryItemRecord | null>(null);
  const [jobs, setJobs] = useState<LibraryExtractionJob[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoteroOpen, setZoteroOpen] = useState(false);
  const [migrationOpen, setMigrationOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [collectionTarget, setCollectionTarget] = useState('');
  const [readerItem, setReaderItem] = useState<LibraryItemRecord | null>(null);
  const [metadataItem, setMetadataItem] = useState<LibraryItemRecord | null>(null);
  const [metadataBatchItems, setMetadataBatchItems] = useState<string[] | null>(null);
  const [citationItems, setCitationItems] = useState<string[] | null>(null);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [trashMode, setTrashMode] = useState(false);
  const [trashCount, setTrashCount] = useState(0);
  const [trashImpactItems, setTrashImpactItems] = useState<string[] | null>(null);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [vaultLinkItems, setVaultLinkItems] = useState<string[] | null>(null);
  const [detailLinks, setDetailLinks] = useState<LibraryVaultLink[]>([]);
  const [manager, setManager] = useState<{ item: LibraryItemRecord; tab?: 'attachments' | 'notes' | 'relations' | 'tags' } | null>(null);
  const [bulkTag, setBulkTag] = useState('');
  const [collectionAction, setCollectionAction] = useState<'copy' | 'move' | 'remove'>('copy');
  const [smartSearchEditor, setSmartSearchEditor] = useState<LibrarySavedSearchRecord | 'new' | null>(null);
  const [tablePreferencesOpen, setTablePreferencesOpen] = useState(false);
  const sortKey = JSON.stringify(viewPreferences.sort);

  const load = useCallback(async () => {
    try {
      const [nextStatus, page, nextCollections, nextJobs, nextSavedSearches, nextViewPreferences, trashPage] = await Promise.all([
        window.nodus.getGlobalLibraryStatus(),
        window.nodus.listGlobalLibraryItems({
          search: search || undefined, collectionId: trashMode ? null : selectedCollection, savedSearchId: trashMode ? null : selectedSavedSearch,
          smartSearch: trashMode ? TRASH_SEARCH : null, includeDeleted: trashMode, source: source || null,
          extractionStatus: extraction || null,
          yearFrom: yearFrom ? Number(yearFrom) : null, yearTo: yearTo ? Number(yearTo) : null,
          itemType: itemType || null, tag: facetTag || null, vaultId: facetVault || null,
          hasAttachments: attachmentFilter === 'with' ? true : attachmentFilter === 'without' ? false : null,
          limit: PAGE_SIZE, offset, sort: JSON.parse(sortKey) as LibraryViewPreferences['sort'],
        }),
        window.nodus.listGlobalLibraryCollections(),
        window.nodus.listLibraryExtractionJobs(),
        window.nodus.listGlobalLibrarySavedSearches(),
        window.nodus.getGlobalLibraryViewPreferences(),
        window.nodus.listGlobalLibraryItems({ includeDeleted: true, smartSearch: TRASH_SEARCH, limit: 1, includeFacets: false }),
      ]);
      setStatus(nextStatus); setItems(page.items); setTotal(page.total); setCollections(nextCollections); setJobs(nextJobs);
      setSavedSearches(nextSavedSearches); setFacets(page.facets); setViewPreferences(nextViewPreferences); setError(null);
      setTrashCount(trashPage.total);
      if (!expanded.size && nextCollections.length) setExpanded(new Set(nextCollections.filter((entry) => !entry.parentId).map((entry) => entry.id)));
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : String(nextError)); }
    finally { setLoading(false); }
  }, [search, selectedCollection, selectedSavedSearch, trashMode, source, extraction, yearFrom, yearTo, itemType, facetTag, facetVault, attachmentFilter, offset, expanded.size, sortKey]);

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
    if (!detailId) { setDetail(null); setDetailLinks([]); return; }
    void Promise.all([
      window.nodus.getGlobalLibraryItem(detailId),
      window.nodus.listGlobalLibraryVaultLinks(detailId),
    ]).then(([item, links]) => { setDetail(item); setDetailLinks(links); });
  }, [detailId, status?.lastRebuiltAt]);
  useEffect(() => {
    const itemId = target?.readerItemId;
    if (!itemId) return;
    void window.nodus.getGlobalLibraryItem(itemId).then((item) => {
      if (!item) return;
      if (item.files?.reader) setReaderItem(item);
      else setDetailId(item.id);
    });
  }, [target?.nonce, target?.readerItemId]);

  const children = useMemo(() => collectionChildren(collections), [collections]);
  const localCollections = useMemo(() => collections.filter((entry) => entry.source === 'nodus'), [collections]);
  const activeJobs = jobs.filter((job) => ['queued', 'processing'].includes(job.status));
  const visibleColumns = viewPreferences.visibleColumns;
  const tableGrid = `2.2rem ${visibleColumns.map((column) => COLUMN_WIDTH[column]).join(' ')}`;
  const tableMinWidth = Math.max(560, 160 + visibleColumns.length * 112);

  const createCollection = async () => {
    const name = await promptText({ title: t('Nueva colección'), placeholder: t('Nombre de la colección'), confirmLabel: t('Crear') });
    if (!name?.trim()) return;
    try {
      const selectedParent = collections.find((entry) => entry.id === selectedCollection);
      const created = await window.nodus.createGlobalLibraryCollection(name, selectedParent?.source === 'nodus' ? selectedParent.id : null);
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

  const dropOnCollection = async (event: DragEvent, targetCollection: LibraryCollectionView) => {
    event.preventDefault(); event.stopPropagation();
    try {
      const movedCollectionId = event.dataTransfer.getData('application/x-nodus-library-collection');
      if (movedCollectionId) {
        if (movedCollectionId === targetCollection.id) return;
        if (targetCollection.source !== 'nodus') throw new Error(t('Las colecciones importadas son de solo lectura en Nodus.'));
        const nextParentId = event.shiftKey ? targetCollection.id : targetCollection.parentId;
        const nextPosition = event.shiftKey ? (children.get(targetCollection.id)?.length ?? 0) : targetCollection.position;
        await window.nodus.updateGlobalLibraryCollection(movedCollectionId, { parentId: nextParentId, position: nextPosition });
        setExpanded((current) => new Set([...current, ...(nextParentId ? [nextParentId] : [])])); await load(); return;
      }
      const rawItems = event.dataTransfer.getData('application/x-nodus-library-items');
      if (rawItems) {
        if (targetCollection.source !== 'nodus') throw new Error(t('Las colecciones importadas son de solo lectura en Nodus.'));
        const itemIds = JSON.parse(rawItems) as string[];
        await window.nodus.patchGlobalLibraryItemCollections(itemIds, { add: [targetCollection.id] }); await load();
      }
    } catch (nextError) { toast(nextError instanceof Error ? nextError.message : String(nextError), { tone: 'error' }); }
  };

  const dropCollectionAtRoot = async (event: DragEvent) => {
    event.preventDefault();
    const collectionId = event.dataTransfer.getData('application/x-nodus-library-collection');
    if (!collectionId) return;
    try { await window.nodus.updateGlobalLibraryCollection(collectionId, { parentId: null, position: children.get(null)?.length ?? 0 }); await load(); }
    catch (nextError) { toast(nextError instanceof Error ? nextError.message : String(nextError), { tone: 'error' }); }
  };

  const removeSavedSearch = async (record: LibrarySavedSearchRecord) => {
    if (!(await confirm({ title: t('Eliminar búsqueda inteligente'), message: t('Sólo se elimina la búsqueda; ningún documento cambia.'), danger: true, confirmLabel: t('Eliminar') }))) return;
    await window.nodus.deleteGlobalLibrarySavedSearch(record.id);
    if (selectedSavedSearch === record.id) setSelectedSavedSearch(null);
    await load();
  };

  const sortByColumn = async (field: LibrarySortField, additive: boolean) => {
    const existing = viewPreferences.sort.find((entry) => entry.field === field);
    const nextRule = { field, direction: existing?.direction === 'asc' ? 'desc' as const : 'asc' as const };
    const sort = additive
      ? [...viewPreferences.sort.filter((entry) => entry.field !== field), nextRule].slice(-3)
      : [nextRule];
    const next = { ...viewPreferences, sort };
    setViewPreferences(next); setOffset(0);
    await window.nodus.setGlobalLibraryViewPreferences(next);
  };

  const importFiles = async () => {
    try {
      const report = await window.nodus.importGlobalLibraryFiles(selectedCollection);
      if (report.created) toast(tx('{n} documento(s) importado(s); la extracción continúa en segundo plano.', { n: report.created }));
      else if (report.warnings.length) toast(report.warnings[0], { tone: 'info' });
      await load();
    } catch (nextError) { toast(nextError instanceof Error ? nextError.message : String(nextError), { tone: 'error' }); }
  };

  const importBibliography = async () => {
    try {
      const report = await window.nodus.importGlobalBibliographyFiles(selectedCollection);
      if (report.created) toast(tx('{n} referencia(s) importada(s).', { n: report.created }));
      else if (report.duplicates) toast(tx('{n} referencia(s) ya estaban en la Biblioteca.', { n: report.duplicates }), { tone: 'info' });
      else if (report.warnings.length) toast(report.warnings[0], { tone: 'info' });
      await load();
    } catch (nextError) { toast(nextError instanceof Error ? nextError.message : String(nextError), { tone: 'error' }); }
  };

  const createReference = async () => {
    const title = await promptText({ title: t('Nueva referencia'), placeholder: t('Título de la referencia'), confirmLabel: t('Crear') });
    if (!title?.trim()) return;
    const created = await window.nodus.createGlobalLibraryItem({ title: title.trim(), itemType: 'document', creators: [], year: null, isbn: [], issn: [], tags: [] }, selectedCollection ? [selectedCollection] : []);
    setDetailId(created.id); setDetail(created); setMetadataItem(created); await load();
  };

  const duplicateDetail = async () => {
    if (!detail) return; const created = await window.nodus.duplicateGlobalLibraryItem(detail.id);
    setDetailId(created.id); setDetail(created); toast(t('Se creó una copia independiente de Nodus.')); await load();
  };

  const convertDetail = async () => {
    if (!detail || detail.source === 'nodus') return; const created = await window.nodus.convertGlobalLibraryItemToNodus(detail.id);
    setDetailId(created.id); setDetail(created); toast(t('Se creó una ficha Nodus independiente; el espejo de origen se conserva.')); await load();
  };

  const applyBulkTag = async () => {
    if (!selected.size || !bulkTag.trim()) return;
    await window.nodus.patchGlobalLibraryItemTags([...selected], { add: [bulkTag.trim()] }); setBulkTag(''); await load();
  };

  const processSelected = async () => {
    const ids = selected.size ? [...selected] : detailId ? [detailId] : [];
    if (!ids.length) return;
    const result = await window.nodus.enqueueLibraryExtraction(ids, { force: true });
    toast(tx('{n} documento(s) en la cola.', { n: result.queued })); setSelected(new Set()); await load();
  };

  const addSelectedToCollection = async () => {
    if (!selected.size) return;
    const selectedLocal = collections.find((entry) => entry.id === selectedCollection)?.source === 'nodus' ? selectedCollection : null;
    if (collectionAction === 'remove') {
      if (!selectedLocal) return;
      await window.nodus.patchGlobalLibraryItemCollections([...selected], { remove: [selectedLocal] });
      toast(t('Documentos retirados de la colección.'));
    } else {
      if (!collectionTarget) return;
      await window.nodus.patchGlobalLibraryItemCollections([...selected], {
        add: [collectionTarget], ...(collectionAction === 'move' && selectedLocal ? { remove: [selectedLocal] } : {}),
      });
      toast(t(collectionAction === 'move' && selectedLocal ? 'Documentos movidos a la colección.' : 'Documentos añadidos a la colección.'));
    }
    setCollectionTarget(''); setSelected(new Set()); await load();
  };

  const deleteSelected = async () => {
    const ids = selected.size ? [...selected] : detailId ? [detailId] : [];
    if (!ids.length || !(await confirm({ title: t('Enviar a la papelera'), message: tx('Se ocultarán {n} documento(s). Los archivos se conservan y pueden restaurarse.', { n: ids.length }), danger: true, confirmLabel: t('Enviar a la papelera') }))) return;
    await window.nodus.setGlobalLibraryItemsDeleted(ids, true); setSelected(new Set()); setDetailId(null); await load();
  };

  const restoreSelected = async (only?: string[]) => {
    const ids = only ?? (selected.size ? [...selected] : detailId ? [detailId] : []);
    if (!ids.length) return;
    await window.nodus.setGlobalLibraryItemsDeleted(ids, false); setSelected(new Set()); setDetailId(null);
    toast(tx('{n} elemento(s) restaurado(s).', { n: ids.length })); await load();
  };

  const openTrash = () => {
    setTrashMode(true); setSelectedCollection(null); setSelectedSavedSearch(null); setSelected(new Set()); setDetailId(null); setOffset(0);
  };

  const closeTrash = () => {
    setTrashMode(false); setSelected(new Set()); setDetailId(null); setOffset(0);
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
        <div className="min-w-0"><h1 className="flex items-center gap-2 text-lg font-semibold"><Icon name={trashMode ? 'trash' : 'book'} className={trashMode ? 'text-amber-400' : 'text-indigo-400'} /> {t(trashMode ? 'Papelera' : 'Biblioteca')}</h1><p className="text-[11px] text-neutral-500">{trashMode ? tx('{n} elemento(s) recuperable(s)', { n: trashCount }) : tx('{n} documentos · disponible en todos los vaults', { n: status.items })}</p></div>
        <div className="flex-1" />
        {activeJobs.length > 0 && <span className="flex items-center gap-2 rounded-full bg-indigo-500/10 px-3 py-1.5 text-xs text-indigo-300"><Spinner /> {tx('{n} tarea(s) en segundo plano', { n: activeJobs.length })}</span>}
        {trashMode ? <><button data-testid="close-library-trash" className="btn btn-ghost border border-neutral-700" onClick={closeTrash}><Icon name="chevronLeft" /> {t('Volver a la Biblioteca')}</button><button data-testid="empty-library-trash" className="btn btn-ghost border border-red-500/30 text-red-400" disabled={!trashCount} onClick={() => setTrashImpactItems([])}><Icon name="trash" /> {t('Vaciar papelera')}</button></> : <>
        <button data-testid="create-library-reference" className="btn btn-ghost border border-neutral-700" onClick={() => void createReference()}><Icon name="plus" /> {t('Nueva referencia')}</button>
        <button data-testid="open-library-migration" className="btn btn-ghost border border-neutral-700" onClick={() => setMigrationOpen(true)}><Icon name="vault" /> {t('Migrar vaults')}</button>
        <button data-testid="open-library-duplicates" className="btn btn-ghost border border-neutral-700" onClick={() => setDuplicatesOpen(true)}><Icon name="copy" /> {t('Duplicados')}</button>
        <button data-testid="import-library-bibliography" className="btn btn-ghost border border-neutral-700" onClick={() => void importBibliography()}><Icon name="fileText" /> {t('Importar referencias')}</button>
        <button data-testid="open-library-export" className="btn btn-ghost border border-neutral-700" onClick={() => setCitationItems([])}><Icon name="download" /> {t('Exportar')}</button>
        <button className="btn btn-ghost border border-neutral-700" onClick={() => void importFiles()}><Icon name="upload" /> {t('Añadir archivos')}</button>
        <button data-testid="open-zotero-global-import" className="btn btn-primary" onClick={() => setZoteroOpen(true)}><Icon name="refresh" /> {t('Zotero')}</button>
        <button data-testid="open-library-trash" className="btn btn-ghost border border-neutral-700" onClick={openTrash}><Icon name="trash" /> {t('Papelera')} {trashCount ? <span className="rounded-full bg-neutral-800 px-1.5 text-[10px]">{trashCount}</span> : null}</button>
        <button data-testid="open-library-recovery" className="btn btn-ghost border border-neutral-700" onClick={() => setRecoveryOpen(true)} title={t('Revisión y recuperación')}><Icon name="shield" /></button></>}
      </header>

      {error && <div role="alert" className="border-b border-red-500/30 bg-red-500/10 px-5 py-2 text-xs text-red-300">{error}</div>}
      {(status.conflicts > 0 || status.invalidRecords > 0) && <div data-testid="global-library-integrity-warning" role="status" className="flex items-start gap-2 border-b border-amber-500/30 bg-amber-500/10 px-5 py-2 text-xs text-amber-200"><Icon name="alert" size={14} className="mt-0.5 shrink-0" /><span><b>{t('La Biblioteca necesita revisión.')}</b> {tx('{conflicts} conflicto(s) conservado(s) · {invalid} registro(s) inválido(s) excluido(s). Los originales no se han modificado.', { conflicts: status.conflicts, invalid: status.invalidRecords })}</span></div>}
      <div className="flex min-h-0 flex-1">
        {!trashMode && <aside className="hidden w-[238px] shrink-0 flex-col border-r border-neutral-800 bg-neutral-950/80 lg:flex">
          <div className="flex items-center gap-1 px-3 py-3"><b className="min-w-0 flex-1 text-[11px] uppercase tracking-wider text-neutral-500">{t('Colecciones')}</b><button className="grid h-7 w-7 place-items-center rounded hover:bg-neutral-900" title={t('Nueva colección')} onClick={() => void createCollection()}><Icon name="folderPlus" size={14} /></button></div>
          <div className="px-2 pb-2" onDragOver={(event) => event.preventDefault()} onDrop={(event) => void dropCollectionAtRoot(event)}>
            <button className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${selectedCollection === null && selectedSavedSearch === null ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-900'}`} onClick={() => { setSelectedCollection(null); setSelectedSavedSearch(null); setOffset(0); }}><Icon name="library" size={14} /><span className="flex-1">{t('Todos los documentos')}</span><span className="text-[10px] opacity-60">{status.items}</span></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {(children.get(null) ?? []).map((collection) => <CollectionBranch key={collection.id} collection={collection} children={children} selected={selectedCollection} expanded={expanded} onSelect={(id) => { setSelectedCollection(id); setSelectedSavedSearch(null); setOffset(0); }} onToggle={(id) => setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })} onDrop={(event, entry) => void dropOnCollection(event, entry)} depth={0} />)}
            {collections.length === 0 && <p className="px-3 py-4 text-xs leading-5 text-neutral-600">{t('Crea colecciones propias o importa la jerarquía completa de Zotero.')}</p>}
            <div className="mt-4 flex items-center gap-1 border-t border-neutral-800 px-1 pt-3"><b className="min-w-0 flex-1 text-[10px] uppercase tracking-wider text-neutral-600">{t('Búsquedas inteligentes')}</b><button className="grid h-7 w-7 place-items-center rounded hover:bg-neutral-900" onClick={() => setSmartSearchEditor('new')} title={t('Nueva búsqueda inteligente')}><Icon name="plus" size={13} /></button></div>
            <div className="mt-1 space-y-0.5">{savedSearches.map((record) => <button key={record.id} data-testid={`library-saved-search-${record.id}`} className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${selectedSavedSearch === record.id ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-900'}`} onClick={() => { setSelectedSavedSearch(record.id); setSelectedCollection(null); setOffset(0); }}><Icon name="search" size={12} /><span className="min-w-0 flex-1 truncate">{record.name}</span></button>)}</div>
          </div>
          {collections.find((entry) => entry.id === selectedCollection)?.source === 'nodus' && <div className="flex gap-1 border-t border-neutral-800 p-2"><button className="btn btn-ghost flex-1 text-xs" onClick={() => void renameCollection()}><Icon name="edit" size={13} /> {t('Renombrar')}</button><button className="btn btn-ghost text-red-400" onClick={() => void deleteCollection()} title={t('Eliminar colección')}><Icon name="trash" size={13} /></button></div>}
          {selectedSavedSearch && savedSearches.find((entry) => entry.id === selectedSavedSearch) && <div className="flex gap-1 border-t border-neutral-800 p-2"><button className="btn btn-ghost flex-1 text-xs" onClick={() => setSmartSearchEditor(savedSearches.find((entry) => entry.id === selectedSavedSearch) ?? null)}><Icon name="edit" size={13} /> {t('Editar')}</button><button className="btn btn-ghost text-red-400" onClick={() => { const record = savedSearches.find((entry) => entry.id === selectedSavedSearch); if (record) void removeSavedSearch(record); }} title={t('Eliminar')}><Icon name="trash" size={13} /></button></div>}
        </aside>}

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-neutral-800 p-3">
            <div className="flex items-center gap-2">
              <div className="relative min-w-[220px] flex-1"><Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600" /><input data-testid="global-library-search" className="input w-full pl-9" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder={t('Buscar título, autor, etiqueta, DOI, ISBN o ISSN…')} /></div>
              <button className={`btn border border-neutral-700 ${filtersOpen || source || extraction || yearFrom || yearTo || itemType || facetTag || facetVault || attachmentFilter ? 'bg-indigo-500/10 text-indigo-300' : 'btn-ghost'}`} onClick={() => setFiltersOpen((value) => !value)}><Icon name="filter" /> {t('Filtros')}</button>
              <button data-testid="library-table-settings" className="btn btn-ghost border border-neutral-700" onClick={() => setTablePreferencesOpen(true)} title={t('Columnas y orden')}><Icon name="columns" /></button>
            </div>
            {filtersOpen && <div className="mt-2 rounded-xl bg-neutral-900/55 p-2"><div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
              <select className="input text-xs" value={source} onChange={(event) => { setSource(event.target.value as LibraryItemSource | ''); setOffset(0); }}><option value="">{t('Todos los orígenes')}</option>{Object.entries(SOURCE_LABEL).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
              <select className="input text-xs" value={extraction} onChange={(event) => { setExtraction(event.target.value as typeof extraction); setOffset(0); }}><option value="">{t('Cualquier estado')}</option>{Object.entries(EXTRACTION_LABEL).map(([id, label]) => <option key={id} value={id}>{t(label)}</option>)}</select>
              <select className="input text-xs" value={itemType} onChange={(event) => { setItemType(event.target.value as LibraryItemType | ''); setOffset(0); }}><option value="">{t('Todos los tipos')}</option>{facets.itemTypes.map((entry) => <option key={entry.value} value={entry.value}>{entry.value} ({entry.count})</option>)}</select>
              <select className="input text-xs" value={attachmentFilter} onChange={(event) => { setAttachmentFilter(event.target.value as typeof attachmentFilter); setOffset(0); }}><option value="">{t('Cualquier adjunto')}</option><option value="with">{t('Con adjuntos')}</option><option value="without">{t('Sin adjuntos')}</option></select>
              <input className="input text-xs" type="number" value={yearFrom} onChange={(event) => { setYearFrom(event.target.value); setOffset(0); }} placeholder={t('Año desde')} />
              <input className="input text-xs" type="number" value={yearTo} onChange={(event) => { setYearTo(event.target.value); setOffset(0); }} placeholder={t('Año hasta')} />
            </div><div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]"><span className="text-neutral-600">{t('Etiquetas')}</span>{facets.tags.slice(0, 8).map((entry) => <button key={entry.value} className={`rounded-full px-2 py-1 ${facetTag === entry.value ? 'bg-indigo-600 text-white' : 'bg-neutral-950 text-neutral-500 hover:text-neutral-200'}`} onClick={() => { setFacetTag((current) => current === entry.value ? '' : entry.value); setOffset(0); }}>{entry.value} · {entry.count}</button>)}{facets.vaults.map((entry) => <button key={entry.value} className={`rounded-full px-2 py-1 ${facetVault === entry.value ? 'bg-indigo-600 text-white' : 'bg-neutral-950 text-neutral-500 hover:text-neutral-200'}`} onClick={() => { setFacetVault((current) => current === entry.value ? '' : entry.value); setOffset(0); }}><Icon name="vault" size={9} /> {entry.value} · {entry.count}</button>)}{(source || extraction || yearFrom || yearTo || itemType || facetTag || facetVault || attachmentFilter) && <button className="ml-auto text-indigo-300" onClick={() => { setSource(''); setExtraction(''); setYearFrom(''); setYearTo(''); setItemType(''); setFacetTag(''); setFacetVault(''); setAttachmentFilter(''); setOffset(0); }}>{t('Limpiar filtros')}</button>}</div></div>}
          </div>

          {selected.size > 0 && <div data-testid="global-library-bulk-actions" className="flex flex-wrap items-center gap-2 border-b border-indigo-500/20 bg-indigo-500/5 px-3 py-2 text-xs"><b>{tx('{n} seleccionados', { n: selected.size })}</b>{trashMode ? <><button data-testid="bulk-restore-library-trash" className="btn btn-secondary h-8" onClick={() => void restoreSelected()}><Icon name="refresh" size={13} /> {t('Restaurar')}</button><button data-testid="bulk-purge-library-trash" className="btn btn-ghost h-8 text-red-400" onClick={() => setTrashImpactItems([...selected])}><Icon name="trash" size={13} /> {t('Revisar y vaciar')}</button></> : <><select aria-label={t('Acción de colección')} className="input ml-2 h-8 text-xs" value={collectionAction} onChange={(event) => setCollectionAction(event.target.value as typeof collectionAction)}><option value="copy">{t('Copiar a')}</option><option value="move">{t('Mover a')}</option><option value="remove">{t('Quitar de esta colección')}</option></select>{collectionAction !== 'remove' && <select className="input h-8 min-w-44 text-xs" value={collectionTarget} onChange={(event) => setCollectionTarget(event.target.value)}><option value="">{t('Elegir colección…')}</option>{localCollections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}</select>}<button className="btn btn-ghost h-8" disabled={collectionAction === 'remove' ? collections.find((entry) => entry.id === selectedCollection)?.source !== 'nodus' : !collectionTarget} onClick={() => void addSelectedToCollection()}>{t('Aplicar')}</button><input className="input h-8 w-32 text-xs" value={bulkTag} onChange={(event) => setBulkTag(event.target.value)} placeholder={t('Etiqueta…')} /><button className="btn btn-ghost h-8" disabled={!bulkTag.trim()} onClick={() => void applyBulkTag()}><Icon name="tag" size={13} /> {t('Etiquetar')}</button><button data-testid="bulk-resolve-library-metadata" className="btn btn-ghost h-8" onClick={() => setMetadataBatchItems([...selected])}><Icon name="search" size={13} /> {t('Completar metadatos')}</button><button data-testid="bulk-library-citations" className="btn btn-ghost h-8" onClick={() => setCitationItems([...selected])}><Icon name="quote" size={13} /> {t('Citar / exportar')}</button><button data-testid="bulk-add-library-to-vault" className="btn btn-ghost h-8" onClick={() => setVaultLinkItems([...selected])}><Icon name="vault" size={13} /> {t('Añadir al vault')}</button><button className="btn btn-ghost h-8" onClick={() => void processSelected()}><Icon name="refresh" size={13} /> {t('Procesar de nuevo')}</button><button className="btn btn-ghost h-8 text-red-400" onClick={() => void deleteSelected()}><Icon name="trash" size={13} /> {t('Papelera')}</button></>}<button className="ml-auto text-neutral-500 hover:text-neutral-200" onClick={() => setSelected(new Set())}>{t('Limpiar selección')}</button></div>}

          <div className="min-h-0 flex-1 overflow-x-auto">
          <div className="grid h-9 items-center border-b border-neutral-800 px-3 text-[10px] font-semibold uppercase tracking-wider text-neutral-600" style={{ gridTemplateColumns: tableGrid, minWidth: tableMinWidth }}>
            <input type="checkbox" checked={items.length > 0 && items.every((item) => selected.has(item.id))} onChange={(event) => setSelected((current) => { const next = new Set(current); for (const item of items) { if (event.target.checked) next.add(item.id); else next.delete(item.id); } return next; })} aria-label={t('Seleccionar página')} />
            {visibleColumns.map((column) => { const sortField = COLUMN_SORT[column]; const sortIndex = sortField ? viewPreferences.sort.findIndex((entry) => entry.field === sortField) : -1; const rule = sortIndex >= 0 ? viewPreferences.sort[sortIndex] : null; return <button key={column} className="flex min-w-0 items-center gap-1 text-left hover:text-neutral-300" disabled={!sortField} onClick={(event) => sortField && void sortByColumn(sortField, event.shiftKey)} title={t('Clic para ordenar; Mayús+Clic añade un criterio')}><span className="truncate">{t(COLUMN_LABEL[column])}</span>{rule && <span className="text-indigo-400">{rule.direction === 'asc' ? '↑' : '↓'}{viewPreferences.sort.length > 1 ? sortIndex + 1 : ''}</span>}</button>; })}
          </div>
          <VirtualList
            items={items} itemHeight={62} getKey={(item) => item.id} className="h-[calc(100%-2.25rem)] min-h-0" style={{ minWidth: tableMinWidth }}
            empty={<div className="grid h-full place-items-center p-8 text-center"><div><Icon name={trashMode ? 'trash' : 'book'} size={28} className="mx-auto text-neutral-700" /><p className="mt-3 text-sm text-neutral-400">{t(trashMode ? 'La papelera está vacía.' : 'No hay documentos que coincidan.')}</p><p className="mt-1 text-xs text-neutral-600">{t(trashMode ? 'Los elementos enviados aquí podrán restaurarse antes del vaciado manual.' : 'Añade archivos o importa una biblioteca de Zotero.')}</p></div></div>}
            renderItem={(item) => {
              const activeJob = jobs.find((job) => job.itemId === item.id && ['queued', 'processing'].includes(job.status));
              return <div data-testid={`global-library-item-${item.id}`} draggable className={`grid h-[62px] items-center border-b border-neutral-900 px-3 text-xs ${detailId === item.id ? 'bg-indigo-500/10' : 'hover:bg-neutral-900/55'}`} style={{ gridTemplateColumns: tableGrid }} onDragStart={(event) => { const itemIds = selected.has(item.id) ? [...selected] : [item.id]; event.dataTransfer.effectAllowed = 'copyMove'; event.dataTransfer.setData('application/x-nodus-library-items', JSON.stringify(itemIds)); }} onDoubleClick={() => item.readerAvailable ? void openReader(item.id) : setDetailId(item.id)}>
                <input type="checkbox" checked={selected.has(item.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; })} />
                {visibleColumns.map((column) => {
                  if (column === 'title') return <button key={column} className="min-w-0 pr-4 text-left" onClick={() => setDetailId(item.id)}><b className="flex min-w-0 items-center gap-1.5 font-medium text-neutral-200"><span className="truncate">{item.title}</span>{item.sourceState && item.sourceState !== 'current' && <Icon name="alert" size={11} className="shrink-0 text-amber-400" />}</b><span className="mt-1 block truncate text-[10px] text-neutral-600">{item.doi || item.isbn[0] || item.issn[0] || item.sourceKey || item.id}</span></button>;
                  if (column === 'creator') return <span key={column} className="truncate pr-3 text-neutral-500">{creatorText(item) || '—'}</span>;
                  if (column === 'year') return <span key={column} className="tabular-nums text-neutral-500">{item.year ?? '—'}</span>;
                  if (column === 'source') return <span key={column} className="w-fit rounded bg-neutral-900 px-2 py-1 text-[10px] text-neutral-400">{SOURCE_LABEL[item.source]}</span>;
                  if (column === 'attachments') return <span key={column} className="text-neutral-500">{item.attachmentCount}</span>;
                  if (column === 'updatedAt') return <time key={column} className="text-[10px] text-neutral-500" dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleDateString()}</time>;
                  return <span key={column} className={`flex items-center gap-1.5 text-[10px] ${activeJob ? 'text-indigo-300' : item.extractionStatus === 'ready' ? 'text-emerald-400' : item.extractionStatus === 'failed' ? 'text-red-400' : 'text-neutral-500'}`}>{activeJob && <Spinner />} {activeJob ? `${Math.round(activeJob.progress * 100)}%` : t(EXTRACTION_LABEL[item.extractionStatus])}</span>;
                })}
              </div>;
            }}
          />
          </div>
          <footer className="flex h-10 items-center border-t border-neutral-800 px-3 text-xs text-neutral-500"><span>{tx('{start}–{end} de {total}', { start: total ? offset + 1 : 0, end: Math.min(offset + items.length, total), total })}</span><div className="flex-1" /><button className="btn btn-ghost h-7" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}><Icon name="chevronLeft" size={13} /></button><button className="btn btn-ghost h-7" disabled={offset + items.length >= total} onClick={() => setOffset(offset + PAGE_SIZE)}><Icon name="chevronRight" size={13} /></button></footer>
        </section>

        {detail && <aside data-testid="global-library-detail" className="flex w-[310px] shrink-0 flex-col border-l border-neutral-800 bg-neutral-950">
          <header className="flex items-center gap-2 border-b border-neutral-800 p-3"><b className="min-w-0 flex-1 truncate text-sm">{t('Detalles')}</b><button className="grid h-7 w-7 place-items-center rounded hover:bg-neutral-900" onClick={() => setDetailId(null)}><Icon name="x" size={14} /></button></header>
          <div className="min-h-0 flex-1 overflow-y-auto p-4"><span className="rounded bg-indigo-500/10 px-2 py-1 text-[10px] font-medium text-indigo-300">{SOURCE_LABEL[detail.source]}</span><h2 className="mt-3 text-base font-semibold leading-6">{detail.metadata.title}</h2><p className="mt-2 text-xs leading-5 text-neutral-500">{detail.metadata.creators.map((creator) => creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(' ')).filter(Boolean).join('; ') || t('Sin autoría')}</p>
            {detail.sourceState && detail.sourceState !== 'current' && <div data-testid="library-source-missing" role="status" className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-950 dark:text-amber-100"><b>{t(detail.sourceState === 'library-missing' ? 'Biblioteca de origen no disponible' : 'Elemento ausente en el origen')}</b><p className="mt-1 opacity-80">{t('El contenido de Nodus se conserva y volverá a vincularse si reaparece en Zotero.')}</p></div>}
            <dl className="mt-5 space-y-3 text-xs">{[
              [t('Tipo'), detail.metadata.itemType], [t('Fecha'), detail.metadata.date || detail.metadata.year], [t('Publicación'), detail.metadata.publicationTitle], [t('Editorial'), detail.metadata.publisher], [t('DOI'), detail.metadata.doi], [t('ISBN'), detail.metadata.isbn?.join('; ')], [t('ISSN'), detail.metadata.issn?.join('; ')], [t('PMID'), detail.metadata.pmid], [t('PMCID'), detail.metadata.pmcid], [t('arXiv'), detail.metadata.arxiv], [t('Clave de cita'), detail.citationKey], [t('Idioma'), detail.metadata.language], [t('Identificador'), detail.sourceKey || detail.id],
            ].filter(([, value]) => value != null && value !== '').map(([label, value]) => <div key={String(label)}><dt className="text-[10px] uppercase tracking-wider text-neutral-600">{label}</dt><dd className="mt-1 break-words text-neutral-300">{String(value)}</dd></div>)}</dl>
            {detail.metadata.abstract && <div className="mt-5"><h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-600">{t('Resumen')}</h3><p className="mt-2 text-xs leading-5 text-neutral-400">{detail.metadata.abstract}</p></div>}
            {detail.metadata.tags?.length ? <div className="mt-5 flex flex-wrap gap-1">{detail.metadata.tags.map((tag) => <span key={tag} className="rounded-full bg-neutral-900 px-2 py-1 text-[10px] text-neutral-400">{tag}</span>)}</div> : null}
            <div className="mt-5"><h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-600">{t('Disponible en vaults')}</h3>{detailLinks.length ? <div className="mt-2 space-y-1.5">{detailLinks.map((link) => <div key={`${link.vaultId}:${link.workId}`} className="rounded-lg border border-neutral-800 px-2.5 py-2 text-[10px]"><div className="flex items-center gap-2"><Icon name="vault" size={12} className="text-indigo-400" /><span className="min-w-0 flex-1 truncate text-neutral-400">{link.vaultName}</span><span className="text-neutral-600">{link.analysis.deepStatus === 'done' ? t('analizado') : t('vinculado')}</span></div><VaultReuseBadges link={link} /></div>)}</div> : <p className="mt-2 text-[10px] leading-4 text-neutral-600">{t('Aún no está añadido a ningún vault.')}</p>}</div>
            <div className="mt-5 rounded-xl border border-neutral-800 p-3"><div className="flex items-center justify-between text-xs"><span>{t('Versión limpia')}</span><b className={detail.extraction?.status === 'ready' ? 'text-emerald-400' : 'text-neutral-500'}>{t(EXTRACTION_LABEL[detail.extraction?.status ?? 'pending'])}</b></div>{detail.extraction?.error && <p className="mt-2 text-[10px] text-red-400">{detail.extraction.error}</p>}<p className="mt-2 text-[10px] text-neutral-600">{detail.attachments.length} {t('adjuntos')} · {detail.files?.reader ? t('Markdown disponible') : t('Sin Markdown')}</p></div>
          </div>
          <footer className="grid grid-cols-2 gap-2 border-t border-neutral-800 p-3">{trashMode ? <><button data-testid="restore-library-trash-item" className="btn btn-secondary" onClick={() => void restoreSelected([detail.id])}><Icon name="refresh" /> {t('Restaurar')}</button><button data-testid="review-library-trash-item" className="btn btn-ghost text-red-400" onClick={() => setTrashImpactItems([detail.id])}><Icon name="trash" /> {t('Revisar y vaciar')}</button></> : <><button data-testid="edit-library-metadata" className="btn btn-ghost col-span-2 border border-neutral-700" onClick={() => setMetadataItem(detail)}><Icon name="edit" /> {t('Editar metadatos')}</button><button className="btn btn-ghost border border-neutral-700" onClick={() => setManager({ item: detail, tab: 'attachments' })}><Icon name="file" /> {t('Adjuntos')}</button><button className="btn btn-ghost border border-neutral-700" onClick={() => setManager({ item: detail, tab: 'notes' })}><Icon name="notebook" /> {t('Notas')}</button><button data-testid="cite-library-item" className="btn btn-ghost col-span-2 border border-neutral-700" onClick={() => setCitationItems([detail.id])}><Icon name="quote" /> {t('Citar / exportar')}</button><button data-testid="add-library-item-to-vault" className="btn btn-ghost col-span-2 border border-neutral-700" onClick={() => setVaultLinkItems([detail.id])}><Icon name="vault" /> {t('Añadir al vault')}</button><button className="btn btn-primary" disabled={!detail.files?.reader} title={!detail.files?.reader ? t('Procesa el documento primero') : undefined} onClick={() => void openReader(detail.id)}><Icon name="bookOpen" /> {t('Leer')}</button><button className="btn btn-ghost border border-neutral-700" onClick={() => void processSelected()}><Icon name="refresh" /> {t('Procesar')}</button><button className="btn btn-ghost border border-neutral-700" onClick={() => void duplicateDetail()}><Icon name="copy" /> {t('Duplicar')}</button>{detail.source !== 'nodus' && <button className="btn btn-ghost border border-neutral-700" onClick={() => void convertDetail()}><Icon name="library" /> {t('Copia Nodus')}</button>}<button className="btn btn-ghost col-span-2 text-red-400" onClick={() => void deleteSelected()}><Icon name="trash" /> {t('Enviar a la papelera')}</button></>}</footer>
        </aside>}
      </div>
      {zoteroOpen && <ZoteroImportDialog onClose={() => setZoteroOpen(false)} onFinished={() => void load()} />}
      {migrationOpen && <LibraryMigrationDialog onClose={() => setMigrationOpen(false)} onFinished={() => void load()} />}
      {metadataItem && <LibraryMetadataEditor item={metadataItem} onClose={() => setMetadataItem(null)} onSaved={(saved) => { setDetail(saved); void load(); }} />}
      {metadataBatchItems && <LibraryMetadataBatchDialog itemIds={metadataBatchItems} onClose={() => setMetadataBatchItems(null)} onApplied={() => { setSelected(new Set()); void load(); }} />}
      {citationItems && <LibraryCitationExportDialog itemIds={citationItems} requestScope={{ collectionId: selectedCollection, savedSearchId: selectedSavedSearch, smartSearch: selectedSavedSearch ? savedSearches.find((entry) => entry.id === selectedSavedSearch)?.query ?? null : null }} onClose={() => setCitationItems(null)} />}
      {manager && <LibraryItemManager item={manager.item} initialTab={manager.tab} onClose={() => setManager(null)} onChanged={(saved) => { setManager((value) => value ? { ...value, item: saved } : null); setDetail(saved); void load(); }} />}
      {smartSearchEditor && <LibrarySmartSearchDialog initial={smartSearchEditor === 'new' ? null : smartSearchEditor} onClose={() => setSmartSearchEditor(null)} onSaved={(record) => { setSelectedSavedSearch(record.id); setSelectedCollection(null); void load(); }} />}
      {tablePreferencesOpen && <LibraryTablePreferencesDialog preferences={viewPreferences} onClose={() => setTablePreferencesOpen(false)} onSaved={(preferences) => { setViewPreferences(preferences); setOffset(0); }} />}
      {duplicatesOpen && <LibraryDuplicatesDialog onClose={() => setDuplicatesOpen(false)} onChanged={() => void load()} />}
      {trashImpactItems && <LibraryTrashImpactDialog itemIds={trashImpactItems} onClose={() => setTrashImpactItems(null)} onChanged={() => { setSelected(new Set()); setDetailId(null); void load(); }} />}
      {recoveryOpen && <LibraryRecoveryDialog onClose={() => setRecoveryOpen(false)} onRebuilt={() => void load()} />}
      {vaultLinkItems && <VaultLinkDialog itemIds={vaultLinkItems} onClose={() => setVaultLinkItems(null)} onLinked={(links) => {
        if (detailId && links.some((link) => link.itemId === detailId)) setDetailLinks((current) => [...current.filter((existing) => !links.some((link) => link.itemId === existing.itemId && link.vaultId === existing.vaultId)), ...links.filter((link) => link.itemId === detailId)]);
        setSelected(new Set());
      }} />}
    </div>
  );
}

export function GlobalLibraryView({
  target,
  settings,
  vaultId,
  vaultType,
  onSettingsChange,
  onOpenSettings,
  onOpenCollections,
  onOpenGraph,
  onOpenAssistant,
  onOpenArchive,
}: {
  target?: (PendingLibraryNavigationTarget & { nonce: number }) | null;
  settings: AppSettings;
  vaultId: string | null;
  vaultType?: VaultType;
  onSettingsChange: () => Promise<AppSettings | undefined>;
  onOpenSettings: () => void;
  onOpenCollections: () => void;
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  onOpenAssistant: (target?: PendingAssistantNavigationTarget) => void;
  onOpenArchive?: () => void;
}) {
  const requestedScope = target?.healthBucket ? 'vault' : target?.scope;
  const preferredScope = requestedScope ?? (settings.libraryGlobalEnabled ? settings.libraryScope : 'vault');
  const [scope, setScope] = useState<LibraryScope>(preferredScope);
  const [switching, setSwitching] = useState(false);

  // Contextual entries (Home health buckets and Zotero reader links) choose their
  // scope once. After arrival the user remains free to change the switcher.
  useEffect(() => setScope(preferredScope), [target?.nonce]);

  const chooseScope = async (next: 'global' | 'vault') => {
    if (switching || next === scope) return;
    if (next === 'global' && !settings.libraryGlobalEnabled && !settings.autoBackupFolder.trim()) {
      toast(t('Configura las copias de seguridad para activar Global.'), { tone: 'info' });
      onOpenSettings();
      return;
    }
    setSwitching(true);
    try {
      await window.nodus.updateSettings({
        libraryGlobalEnabled: next === 'global' ? true : settings.libraryGlobalEnabled,
        libraryScope: next,
        libraryScopeOnboardingVersion: next === 'global' ? 1 : settings.libraryScopeOnboardingVersion,
      });
      await onSettingsChange();
      setScope(next);
      if (next === 'global' && !settings.libraryGlobalEnabled) toast(t('Biblioteca global activada.'));
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div data-testid="library-scope-shell" data-library-scope={scope} className="flex h-full min-h-0 flex-col">
      <div data-testid="library-scope-switcher" className="flex min-h-12 shrink-0 items-center gap-3 border-b border-neutral-800 bg-neutral-950 px-5 py-2">
        <span className="hidden text-[10px] font-semibold uppercase tracking-wider text-neutral-600 sm:inline">{t('Ámbito de la Biblioteca')}</span>
        <div className="flex rounded-lg border border-neutral-800 bg-neutral-900/70 p-0.5" role="group" aria-label={t('Ámbito de la Biblioteca')}>
          <button
            data-testid="library-scope-vault"
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${scope === 'vault' ? 'bg-indigo-600 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'}`}
            aria-pressed={scope === 'vault'}
            disabled={switching}
            onClick={() => void chooseScope('vault')}
          >
            <span className="inline-flex items-center gap-1.5"><Icon name="vault" size={13} /> {t('Este vault')}</span>
          </button>
          <button
            data-testid="library-scope-global"
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${scope === 'global' ? 'bg-indigo-600 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'}`}
            aria-pressed={scope === 'global'}
            disabled={switching}
            onClick={() => void chooseScope('global')}
          >
            <span className="inline-flex items-center gap-1.5"><Icon name="library" size={13} /> {settings.libraryGlobalEnabled ? t('Global') : t('Activar Global')}</span>
          </button>
        </div>
        <p className="hidden min-w-0 flex-1 truncate text-[11px] text-neutral-600 lg:block">
          {scope === 'global'
            ? t('Global reúne originales y Markdown limpio para todos tus vaults.')
            : t('Este vault conserva colecciones, scans, resúmenes, embeddings y análisis existentes.')}
        </p>
        {!settings.libraryGlobalEnabled && scope === 'vault' && (
          <span className="ml-auto hidden text-[10px] text-neutral-600 xl:inline">{t('Activa la Biblioteca global cuando quieras; este vault no cambiará.')}</span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {scope === 'vault' ? (
          <Library
            vaultId={vaultId}
            target={target}
            vaultType={vaultType}
            onOpenCollections={onOpenCollections}
            onOpenGraph={onOpenGraph}
            onOpenAssistant={onOpenAssistant}
            onOpenArchive={onOpenArchive}
          />
        ) : (
          <GlobalLibraryContent target={target} onOpenSettings={onOpenSettings} onOpenAssistant={onOpenAssistant} />
        )}
      </div>
    </div>
  );
}
