import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../ui';
import { getActiveLang, t } from '../../i18n';
import type { BrowserConnectorCapturePreviewItem, BrowserConnectorCaptureRequest, BrowserConnectorSaveResult } from '@shared/browserConnector';
import type { LibraryCollectionView, LibraryItemType, LibraryTagRecord } from '@shared/libraryTypes';
import { filterCollectionRows, normalizeTags } from '../../../browser-extension/lib/collections.js';
import { applyMetadataEdits, formatCreators } from '../../../browser-extension/lib/metadata-form.js';
import { ITEM_TYPES, byline, typeGlyph, typeLabel } from '../../../browser-extension/lib/presentation.js';
import connectorIcon from '../../../browser-extension/icons/icon.svg';

type CapturePreview = BrowserConnectorCaptureRequest & { snapshotAvailable?: boolean };

/**
 * The trusted, built-in adapter for Nodus Connector.
 *
 * The Chrome popup and this dialog intentionally share their presentation and
 * hierarchy modules. Only this React surface can call the Nodus preload: the
 * untrusted website remains in a separate sandboxed WebContents with no preload
 * API and cannot open or submit this dialog.
 */
export function BrowserCaptureModal({
  preview,
  warnings,
  candidates,
  loading = false,
  loadError = null,
  onRetry,
  onClose,
  onSaved,
  onOpenInNodus,
  onOpenSettings,
}: {
  preview: CapturePreview | null;
  warnings: string[];
  candidates?: BrowserConnectorCapturePreviewItem[];
  loading?: boolean;
  loadError?: string | null;
  onRetry?: () => void;
  onClose: () => void;
  onSaved: (result: BrowserConnectorSaveResult) => void;
  onOpenInNodus: (itemId: string) => void;
  onOpenSettings: () => void;
}) {
  const [title, setTitle] = useState('');
  const [creators, setCreators] = useState('');
  const [date, setDate] = useState('');
  const [publicationTitle, setPublicationTitle] = useState('');
  const [doi, setDoi] = useState('');
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [itemType, setItemType] = useState<LibraryItemType>('webpage');
  const [collections, setCollections] = useState<LibraryCollectionView[]>([]);
  const [availableTags, setAvailableTags] = useState<LibraryTagRecord[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [collectionQuery, setCollectionQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagQuery, setTagQuery] = useState('');
  const [selectedAttachments, setSelectedAttachments] = useState<Set<number>>(new Set());
  const [includeSnapshot, setIncludeSnapshot] = useState(false);
  const [busy, setBusy] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<BrowserConnectorSaveResult | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const [selectedCandidates, setSelectedCandidates] = useState<Set<number>>(new Set());
  const collectionWrapRef = useRef<HTMLDivElement | null>(null);
  const tagWrapRef = useRef<HTMLDivElement | null>(null);
  const busyRef = useRef(busy);
  const onCloseRef = useRef(onClose);
  busyRef.current = busy;
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!preview) return;
    setTitle(preview.metadata.title ?? '');
    setCreators(formatCreators(preview.metadata.creators));
    setDate(preview.metadata.date ?? (preview.metadata.year ? String(preview.metadata.year) : ''));
    setPublicationTitle(preview.metadata.publicationTitle ?? '');
    setDoi(preview.metadata.doi ?? '');
    setItemType(preview.metadata.itemType);
    setSelectedTags(candidates?.length
      ? []
      : normalizeTags([...(preview.metadata.tags ?? []), ...(preview.tags ?? [])]));
    setSelectedAttachments(new Set((preview.attachments ?? []).map((_entry, index) => index)));
    setIncludeSnapshot(Boolean(preview.snapshotAvailable && !(preview.attachments?.length ?? 0)));
    setSaved(null);
    setSavedCount(0);
    setError(null);
  }, [candidates?.length, preview]);

  useEffect(() => {
    setSelectedCandidates(new Set((candidates ?? []).map((_entry, index) => index)));
  }, [candidates]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      window.nodus.listGlobalLibraryCollections(),
      window.nodus.listGlobalLibraryTags(),
    ]).then(([nextCollections, nextTags]) => {
      if (cancelled) return;
      const localCollections = nextCollections.filter((entry) => entry.source === 'nodus');
      setCollections(localCollections);
      setAvailableTags(nextTags);
      const remembered = localStorage.getItem('nodus.connector.lastCollectionId');
      setSelectedCollection(localCollections.some((entry) => entry.id === remembered) ? remembered : null);
    }).catch((cause) => {
      if (!cancelled) setCatalogError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { cancelled = true; };
  }, []);

  // The website is a native view painting above HTML. Hiding it here is both a
  // visual requirement and a trust boundary: only Nodus chrome receives clicks.
  useEffect(() => {
    void window.nodus.setBrowserOverlayVisible(true);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) onCloseRef.current();
    };
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (collectionWrapRef.current && !collectionWrapRef.current.contains(target)) setCollectionOpen(false);
      if (tagWrapRef.current && !tagWrapRef.current.contains(target)) setTagQuery('');
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
      void window.nodus.setBrowserOverlayVisible(false);
    };
  }, []);

  const collectionRows = useMemo(
    () => filterCollectionRows(collections, collectionQuery),
    [collectionQuery, collections],
  );
  const currentCollection = collections.find((entry) => entry.id === selectedCollection) ?? null;
  const tagSuggestions = useMemo(() => {
    const query = fold(tagQuery);
    return availableTags.filter((entry) => (
      !selectedTags.some((tag) => fold(tag) === fold(entry.name))
      && (!query || fold(entry.name).includes(query))
    )).slice(0, 8);
  }, [availableTags, selectedTags, tagQuery]);

  const addTag = (raw: string) => {
    setSelectedTags((current) => normalizeTags([...current, raw]));
    setTagQuery('');
  };

  const editedMetadata = useMemo(() => applyMetadataEdits(preview?.metadata ?? {
    title: '', itemType: 'webpage', creators: [], year: null, isbn: [], issn: [], tags: [],
  }, { title, creators, date, publicationTitle, doi }), [creators, date, doi, preview, publicationTitle, title]);

  const save = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const batch = candidates?.length
        ? candidates.filter((_entry, index) => selectedCandidates.has(index))
        : [{ request: preview, warnings }];
      if (!batch.length) throw new Error(t('Selecciona al menos una referencia.'));
      const results: BrowserConnectorSaveResult[] = [];
      for (const [index, entry] of batch.entries()) {
        const request = entry.request;
        const isPrimaryReview = request === preview || index === 0 && request.pageUrl === preview.pageUrl
          && request.metadata.title === preview.metadata.title;
        const requestTags = selectedTags;
        const attachments = isPrimaryReview
          ? (preview.attachments ?? []).filter((_entry, attachmentIndex) => selectedAttachments.has(attachmentIndex))
          : request.attachments ?? [];
        const result = await window.nodus.saveBrowserCapture({
          ...request,
          collectionId: selectedCollection,
          tags: requestTags,
          attachments,
          metadata: isPrimaryReview
            ? { ...editedMetadata, itemType, tags: requestTags }
            : { ...request.metadata, tags: requestTags },
        }, isPrimaryReview && batch.length === 1 && includeSnapshot);
        results.push({ ...result, warnings: [...entry.warnings, ...result.warnings] });
        onSaved(result);
      }
      localStorage.setItem('nodus.connector.lastCollectionId', selectedCollection ?? '');
      const first = results[0];
      setSaved({
        ...first,
        disposition: results.some((result) => result.disposition === 'created')
          ? 'created'
          : results.some((result) => result.disposition === 'updated') ? 'updated' : 'existing',
        deduplicated: results.every((result) => result.deduplicated),
        title: results.length > 1 ? t('{n} referencias').replace('{n}', String(results.length)) : first.title,
        attachmentCount: results.reduce((total, result) => total + result.attachmentCount, 0),
        warnings: results.flatMap((result) => result.warnings),
        pendingUploads: results.flatMap((result) => result.pendingUploads),
      });
      setSavedCount(results.length);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const content = saved ? (
    <div className="flex min-h-[300px] flex-col items-center justify-center px-8 py-10 text-center" data-testid="browser-connector-success">
      <span className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-emerald-500/15 text-2xl font-bold text-emerald-500">✓</span>
      <strong className="text-lg text-neutral-900 dark:text-neutral-100">
        {saved.disposition === 'existing'
          ? t('Ya estaba en Nodus')
          : saved.deduplicated
            ? t('Referencia actualizada')
            : t('Guardado en Nodus')}
      </strong>
      <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
        {saved.disposition === 'existing' && savedCount <= 1
          ? t('No se ha creado ningún duplicado.')
          : savedCount > 1
          ? t('Se han guardado {n} referencias.').replace('{n}', String(savedCount))
          : t('Se han guardado {n} archivo(s).').replace('{n}', String(saved.attachmentCount))}
      </p>
      {saved.warnings.length > 0 && (
        <div className="mt-4 max-h-28 w-full overflow-auto rounded-lg bg-amber-500/10 p-3 text-left text-xs text-amber-700 dark:text-amber-300">
          {saved.warnings.map((warning, index) => <p key={`${warning}-${index}`} className="my-1">{warning}</p>)}
        </div>
      )}
      <div className="mt-5 flex gap-2">
        {savedCount <= 1 && <button type="button" className="btn btn-primary" onClick={() => onOpenInNodus(saved.itemId)}>{t('Abrir en Nodus')}</button>}
        <button type="button" className="btn btn-ghost border border-neutral-300 dark:border-neutral-700" onClick={onClose}>{t('Listo')}</button>
      </div>
    </div>
  ) : loading ? (
    <ConnectorState state="loading" title={t('Detectando este documento…')} detail={t('Leyendo únicamente la pestaña activa después de tu clic.')} />
  ) : loadError || !preview ? (
    <ConnectorState state="error" title={t('No se ha podido leer esta página')} detail={loadError ?? t('Esta página no ofrece nada que se pueda guardar.')} action={onRetry ? { label: t('Reintentar'), run: onRetry } : undefined} />
  ) : (
    <div className="max-h-[min(690px,calc(100vh-9rem))] overflow-y-auto px-4 py-4" data-testid="browser-connector-capture">
      {(candidates?.length ?? 0) > 1 && (
        <section className="mb-3 rounded-xl border border-indigo-200 bg-indigo-500/5 p-2 dark:border-indigo-500/30">
          <div className="mb-1 flex items-center justify-between px-1 text-xs font-semibold text-indigo-700 dark:text-indigo-300">
            <span>{t('{n} referencias detectadas').replace('{n}', String(candidates?.length ?? 0))}</span>
            <span>{selectedCandidates.size}</span>
          </div>
          <div className="max-h-36 overflow-y-auto">
            {candidates?.map((candidate, index) => (
              <label key={`${candidate.request.metadata.doi ?? candidate.request.metadata.title}-${index}`} className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-indigo-500/10">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-indigo-600"
                  checked={selectedCandidates.has(index)}
                  disabled={busy}
                  onChange={(event) => setSelectedCandidates((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(index); else next.delete(index);
                    return next;
                  })}
                />
                <span className="min-w-0"><strong className="block truncate">{candidate.request.metadata.title}</strong><small className="text-neutral-500">{byline(candidate.request.metadata)}</small></span>
              </label>
            ))}
          </div>
        </section>
      )}
      <article className="flex gap-3 rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-indigo-500/10 text-xs font-extrabold text-indigo-600 dark:bg-indigo-400/15 dark:text-indigo-300">
          {typeGlyph(itemType)}
        </div>
        <div className="min-w-0 flex-1">
          <label htmlFor="browser-connector-type" className="block text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-500">{t('Tipo de documento')}</label>
          <select
            id="browser-connector-type"
            data-testid="browser-connector-type"
            value={itemType}
            disabled={busy}
            onChange={(event) => setItemType(event.target.value as LibraryItemType)}
            className="max-w-full bg-transparent text-xs font-semibold text-indigo-600 outline-none dark:text-indigo-300"
          >
            {ITEM_TYPES.map(([value]) => <option key={value} value={value}>{typeLabel(value, getActiveLang() === 'es')}</option>)}
          </select>
          <input
            data-testid="browser-capture-title"
            className="mt-1 block w-full truncate bg-transparent text-sm font-semibold text-neutral-900 outline-none focus:ring-1 focus:ring-indigo-500/40 dark:text-neutral-100"
            value={title}
            disabled={busy}
            onChange={(event) => setTitle(event.target.value)}
            aria-label={t('Título')}
          />
          <p className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">{byline(editedMetadata) || safeHost(preview.pageUrl)}</p>
        </div>
      </article>

      <button
        type="button"
        className="mt-2 flex w-full items-center justify-between rounded-lg px-1 py-1.5 text-left text-xs font-semibold text-indigo-600 hover:bg-indigo-500/5 dark:text-indigo-300"
        aria-expanded={metadataOpen}
        disabled={busy}
        onClick={() => setMetadataOpen((open) => !open)}
      >
        <span>{t('Editar metadatos')}</span>
        <Icon name="chevronDown" size={13} className={metadataOpen ? 'rotate-180' : ''} />
      </button>
      {metadataOpen && (
        <section className="mt-1 grid gap-3 rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900">
          <label className="grid gap-1 text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-500">
            {t('Autores')}
            <textarea
              value={creators}
              disabled={busy}
              rows={Math.min(4, Math.max(2, creators.split(/\r?\n/).length))}
              onChange={(event) => setCreators(event.target.value)}
              placeholder={t('Un autor por línea')}
              className="resize-y rounded-lg border border-neutral-300 bg-transparent px-2 py-1.5 text-xs font-normal normal-case tracking-normal text-neutral-900 outline-none focus:border-indigo-400 dark:border-neutral-700 dark:text-neutral-100"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <MetadataInput label={t('Fecha')} value={date} disabled={busy} onChange={setDate} />
            <MetadataInput label="DOI" value={doi} disabled={busy} onChange={setDoi} />
          </div>
          <MetadataInput label={t('Publicación')} value={publicationTitle} disabled={busy} onChange={setPublicationTitle} />
        </section>
      )}

      <div ref={collectionWrapRef} className="relative mt-4">
        <FieldLabel>{t('Guardar en')}</FieldLabel>
        <button
          type="button"
          data-testid="browser-connector-collection"
          className="flex min-h-10 w-full items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 text-left text-sm text-neutral-800 hover:border-indigo-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
          aria-expanded={collectionOpen}
          disabled={busy}
          onClick={() => setCollectionOpen((open) => !open)}
        >
          <Icon name="folder" size={15} className="text-indigo-500" />
          <span className="min-w-0 flex-1 truncate">{currentCollection?.name ?? t('Raíz de la Biblioteca')}</span>
          <Icon name="chevronDown" size={13} className="text-neutral-500" />
        </button>
        {collectionOpen && (
          <div className="absolute inset-x-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-xl border border-neutral-300 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
            <div className="flex items-center gap-2 border-b border-neutral-200 px-3 dark:border-neutral-700">
              <Icon name="search" size={14} className="text-neutral-500" />
              <input
                autoFocus
                value={collectionQuery}
                onChange={(event) => setCollectionQuery(event.target.value)}
                className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none"
                placeholder={t('Buscar colecciones')}
              />
            </div>
            <div className="max-h-52 overflow-y-auto p-1" role="listbox">
              <CollectionRow label={t('Raíz de la Biblioteca')} selected={selectedCollection === null} onClick={() => { setSelectedCollection(null); setCollectionOpen(false); }} />
              {collectionRows.map((row) => (
                <CollectionRow
                  key={row.collection.id}
                  label={row.collection.name}
                  count={row.collection.directItemCount}
                  color={row.collection.color}
                  selected={selectedCollection === row.collection.id}
                  padding={10 + row.depth * 18}
                  onClick={() => { setSelectedCollection(row.collection.id); setCollectionOpen(false); }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div ref={tagWrapRef} className="relative mt-4">
        <FieldLabel>{t('Etiquetas')}</FieldLabel>
        <div className="flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-2 py-1.5 focus-within:border-indigo-400 dark:border-neutral-700 dark:bg-neutral-900">
          {selectedTags.map((tag) => (
            <span key={tag} className="inline-flex max-w-44 items-center gap-1 rounded-full bg-indigo-500/10 px-2 py-1 text-[11px] text-indigo-600 dark:text-indigo-300">
              <span className="truncate">{tag}</span>
              <button type="button" aria-label={`${t('Eliminar')} ${tag}`} disabled={busy} onClick={() => setSelectedTags((current) => current.filter((entry) => entry !== tag))}>×</button>
            </span>
          ))}
          <input
            data-testid="browser-connector-tags"
            className="min-w-32 flex-1 bg-transparent text-sm outline-none"
            value={tagQuery}
            disabled={busy}
            placeholder={t('Añadir o buscar una etiqueta')}
            onChange={(event) => setTagQuery(event.target.value)}
            onKeyDown={(event) => {
              if ((event.key === 'Enter' || event.key === ',') && tagQuery.trim()) {
                event.preventDefault();
                addTag(tagQuery.replace(/,$/, ''));
              } else if (event.key === 'Backspace' && !tagQuery && selectedTags.length) {
                setSelectedTags((current) => current.slice(0, -1));
              }
            }}
          />
        </div>
        {tagQuery && tagSuggestions.length > 0 && (
          <div className="absolute inset-x-0 top-[calc(100%+4px)] z-20 max-h-36 overflow-auto rounded-lg border border-neutral-300 bg-white p-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
            {tagSuggestions.map((tag) => (
              <button key={tag.name} type="button" className="block w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800" onClick={() => addTag(tag.name)}>
                {tag.name} · {tag.itemCount}
              </button>
            ))}
          </div>
        )}
      </div>

      {(preview.attachments?.length ?? 0) > 0 && (
        <section className="mt-4">
          <FieldLabel>{t('Archivos')}</FieldLabel>
          <div className="overflow-hidden rounded-lg border border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900">
            {preview.attachments?.map((attachment, index) => (
              <label key={`${attachment.url}-${index}`} className="flex items-start gap-2 border-b border-neutral-200 px-3 py-2 last:border-b-0 dark:border-neutral-700">
                <input
                  type="checkbox"
                  className="mt-1 accent-indigo-600"
                  checked={selectedAttachments.has(index)}
                  disabled={busy}
                  onChange={(event) => setSelectedAttachments((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(index); else next.delete(index);
                    return next;
                  })}
                />
                <span className="min-w-0">
                  <strong className="block truncate text-xs text-neutral-800 dark:text-neutral-200">{attachment.title || attachment.fileName || t('Archivo')}</strong>
                  <small className="block truncate text-[10px] text-neutral-500">{[attachment.mimeType, safeHost(attachment.url)].filter(Boolean).join(' · ')}</small>
                </span>
              </label>
            ))}
          </div>
        </section>
      )}

      {preview.snapshotAvailable && (
        <label className="mt-3 flex items-start gap-2 rounded-lg bg-neutral-100 p-2.5 dark:bg-neutral-800/70">
          <input type="checkbox" className="mt-1 accent-indigo-600" checked={includeSnapshot} disabled={busy} onChange={(event) => setIncludeSnapshot(event.target.checked)} />
          <span className="min-w-0">
            <strong className="block text-xs text-neutral-800 dark:text-neutral-200">{t('Copia web legible')}</strong>
            <small className="block text-[10px] text-neutral-500">{t('Conserva una copia local de esta página junto a la referencia.')}</small>
          </span>
        </label>
      )}

      {catalogError && <p className="mt-3 text-xs text-amber-600 dark:text-amber-300">{catalogError}</p>}
      {warnings.length > 0 && <div className="mt-3 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">{warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
      {error && <p className="mt-3 flex items-start gap-2 rounded-lg bg-red-500/10 p-2 text-xs text-red-600 dark:text-red-300"><Icon name="alert" size={13} className="mt-0.5 shrink-0" /><span>{error}</span></p>}

      <button
        type="button"
        data-testid="browser-capture-save"
        className="mt-4 min-h-10 w-full rounded-lg bg-indigo-600 px-4 font-semibold text-white hover:bg-indigo-500 disabled:cursor-progress disabled:opacity-60"
        disabled={busy || Boolean(candidates?.length && !selectedCandidates.size)}
        onClick={() => void save()}
      >
        {busy
          ? t('Guardando…')
          : candidates?.length
            ? t('Guardar {n} referencias').replace('{n}', String(selectedCandidates.size))
            : t('Guardar en Nodus')}
      </button>
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 p-6" onClick={() => !busy && onClose()}>
      <div
        data-testid="browser-capture-modal"
        className="w-full max-w-[460px] overflow-hidden rounded-2xl border border-neutral-300 bg-neutral-50 text-neutral-900 shadow-2xl dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex h-14 items-center justify-between border-b border-neutral-200 px-4 dark:border-neutral-800">
          <div className="flex items-center gap-2.5">
            <img src={connectorIcon} alt="" className="h-8 w-8" />
            <div className="flex flex-col leading-none"><strong className="text-sm">Nodus Research</strong><span className="mt-1 text-[10px] uppercase tracking-[0.12em] text-neutral-500">{t('Conector')}</span></div>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" title={t('Configuración')} aria-label={t('Configuración')} disabled={busy} className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800" onClick={onOpenSettings}><Icon name="settings" size={17} /></button>
            <button type="button" title={t('Cerrar')} aria-label={t('Cerrar')} disabled={busy} className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800" onClick={onClose}><Icon name="x" size={17} /></button>
          </div>
        </header>
        {content}
      </div>
    </div>,
    document.body,
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-500">{children}</span>;
}

function MetadataInput({
  label, value, disabled, onChange,
}: {
  label: string; value: string; disabled: boolean; onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-500">
      {label}
      <input
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-8 rounded-lg border border-neutral-300 bg-transparent px-2 text-xs font-normal normal-case tracking-normal text-neutral-900 outline-none focus:border-indigo-400 dark:border-neutral-700 dark:text-neutral-100"
      />
    </label>
  );
}

function CollectionRow({
  label, count, color, selected, padding = 10, onClick,
}: {
  label: string; count?: number; color?: string | null; selected: boolean; padding?: number; onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className="flex min-h-8 w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-xs hover:bg-neutral-100 aria-selected:bg-indigo-500/10 aria-selected:text-indigo-600 dark:hover:bg-neutral-800 dark:aria-selected:text-indigo-300"
      style={{ paddingLeft: padding }}
      onClick={onClick}
    >
      <span style={color ? { color } : undefined}><Icon name="folder" size={13} /></span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {Boolean(count) && <small className="text-neutral-500">{count}</small>}
    </button>
  );
}

function ConnectorState({
  state, title, detail, action,
}: {
  state: 'loading' | 'error';
  title: string;
  detail: string;
  action?: { label: string; run: () => void };
}) {
  return (
    <div className="flex min-h-[300px] flex-col items-center justify-center px-8 py-10 text-center">
      {state === 'loading'
        ? <span className="mb-5 h-9 w-9 animate-spin rounded-full border-2 border-neutral-300 border-t-indigo-500 dark:border-neutral-700 dark:border-t-indigo-400" />
        : <span className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-red-500/10 text-xl font-bold text-red-500">!</span>}
      <strong className="text-lg">{title}</strong>
      <p className="mt-2 max-w-xs text-sm text-neutral-500 dark:text-neutral-400">{detail}</p>
      {action && <button type="button" className="btn btn-primary mt-4" onClick={action.run}>{action.label}</button>}
    </div>
  );
}

function safeHost(url: string): string {
  try { return new URL(url).hostname; } catch { return ''; }
}

function fold(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();
}
