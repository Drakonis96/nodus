import { useEffect, useMemo, useState } from 'react';
import type {
  LibraryDuplicateGroup,
  LibraryItemMetadata,
  LibraryItemRecord,
  LibraryCreator,
  LibraryMetadataBatchProgress,
  LibraryMetadataBatchResult,
  LibraryBibliographyExportRequest,
  LibraryBibliographyFormat,
  LibraryCitationStyle,
  LibraryCitationStyleRecord,
  LibraryCitationStyleRepositoryEntry,
  LibraryMergeImpact,
} from '@shared/libraryTypes';
import { confirm, toast } from '../feedback';
import { Icon, Spinner } from '../ui';
import { t, tx } from '../../i18n';
import { CitationStylePicker, matchesCitationStyleQuery } from './CitationStylePicker';
import {
  detectLibraryMetadataIdentifier,
  LIBRARY_CREATOR_ROLES,
  LIBRARY_ITEM_TYPES,
} from '@shared/libraryBibliography';

function authorText(metadata: LibraryItemMetadata): string {
  return metadata.creators.map((creator) => creator.name || [creator.lastName, creator.firstName].filter(Boolean).join(', ')).filter(Boolean).join('; ');
}

function metadataDraft(metadata: LibraryItemMetadata) {
  const itemType = (metadata.itemType === 'book-section' || metadata.itemType === 'chapter' ? 'book-chapter'
    : metadata.itemType === 'article-journal' ? 'journal-article' : metadata.itemType) as LibraryItemMetadata['itemType'];
  return {
    ...metadata,
    itemType,
    authors: authorText(metadata),
    isbnText: (metadata.isbn ?? []).join('; '), issnText: (metadata.issn ?? []).join('; '), tagsText: (metadata.tags ?? []).join(', '),
  };
}

export function LibraryCreateReferenceDialog({ defaultMode = 'identifier', collectionIds, onClose, onCreated }: {
  defaultMode?: 'identifier' | 'manual';
  collectionIds: string[];
  onClose: () => void;
  onCreated: (item: LibraryItemRecord, openEditor: boolean) => void;
}) {
  const [mode, setMode] = useState<'identifier' | 'manual'>(defaultMode);
  const [rawIdentifier, setRawIdentifier] = useState('');
  const [title, setTitle] = useState('');
  const [itemType, setItemType] = useState<LibraryItemMetadata['itemType']>('journal-article');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const addByIdentifier = async () => {
    const detected = detectLibraryMetadataIdentifier(rawIdentifier);
    if (!detected) { setError(t('No se reconoce el identificador. Usa DOI, ISBN, ISSN, PMID, PMCID o arXiv.')); return; }
    setBusy(true); setError('');
    try {
      const result = await window.nodus.importGlobalLibraryIdentifier(detected.kind, detected.value, collectionIds);
      if (result.fullText.status === 'downloaded') {
        toast(result.created
          ? tx('Referencia y PDF añadidos desde {kind}. Preparando la lectura…', { kind: detected.kind.toUpperCase() })
          : t('La referencia ya existía. Se añadió el PDF que faltaba y se está preparando la lectura.'));
      } else if (result.fullText.status === 'already-present') {
        toast(t('La referencia y su PDF ya estaban en la Biblioteca.'), { tone: 'info' });
      } else if (result.fullText.status === 'failed') {
        toast(t(result.created
          ? 'La referencia se añadió, pero el PDF localizado no pudo descargarse.'
          : 'La referencia ya existía, pero el PDF localizado no pudo descargarse.'), { tone: 'error', duration: 6500 });
      } else {
        toast(t(result.created
          ? 'La referencia se añadió, pero no se encontró un PDF accesible.'
          : 'La referencia ya existía, pero no se encontró un PDF accesible.'), { tone: 'info', duration: 6500 });
      }
      onCreated(result.item, false); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const addManual = async () => {
    if (!title.trim()) return;
    setBusy(true); setError('');
    try {
      const created = await window.nodus.createGlobalLibraryItem({
        title: title.trim(), itemType, creators: [], year: null, isbn: [], issn: [], tags: [],
      }, collectionIds);
      onCreated(created, true); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  return <div className="fixed inset-0 z-[86] grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true" data-testid="library-create-reference-dialog" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="card-modal w-full max-w-xl overflow-hidden rounded-2xl border border-neutral-800 shadow-2xl">
      <header className="flex items-center gap-3 border-b border-neutral-800 px-5 py-4"><span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-500/15 text-indigo-300"><Icon name={mode === 'identifier' ? 'wand' : 'edit'} /></span><div className="min-w-0 flex-1"><h2 className="font-semibold">{t('Añadir referencia')}</h2><p className="mt-1 text-xs text-neutral-500">{t('Crea una ficha automáticamente por identificador o introdúcela manualmente.')}</p></div><button className="btn btn-ghost" aria-label={t('Cerrar')} onClick={onClose}><Icon name="x" /></button></header>
      <div className="border-b border-neutral-800 px-5 pt-3"><div className="flex gap-1" role="tablist"><button role="tab" aria-selected={mode === 'identifier'} className={`rounded-t-lg px-3 py-2 text-xs ${mode === 'identifier' ? 'bg-indigo-500/15 text-indigo-300' : 'text-neutral-500 hover:text-neutral-200'}`} onClick={() => { setMode('identifier'); setError(''); }}><Icon name="wand" size={13} /> {t('Identificador')}</button><button role="tab" aria-selected={mode === 'manual'} className={`rounded-t-lg px-3 py-2 text-xs ${mode === 'manual' ? 'bg-indigo-500/15 text-indigo-300' : 'text-neutral-500 hover:text-neutral-200'}`} onClick={() => { setMode('manual'); setError(''); }}><Icon name="edit" size={13} /> {t('Entrada manual')}</button></div></div>
      <form className="p-5" onSubmit={(event) => { event.preventDefault(); void (mode === 'identifier' ? addByIdentifier() : addManual()); }}>
        {mode === 'identifier' ? <><label className="block text-xs font-medium">{t('DOI, ISBN, ISSN, PMID, PMCID o arXiv')}<input autoFocus data-testid="library-magic-identifier" className="input mt-2 w-full" value={rawIdentifier} onChange={(event) => setRawIdentifier(event.target.value)} placeholder="10.1234/article · 978… · PMID: …" /></label><p className="mt-2 text-[11px] leading-5 text-neutral-500">{t('Nodus recupera la ficha y añade automáticamente el PDF cuando el editor o repositorio ofrece uno accesible.')}</p>{busy && <p role="status" className="mt-3 flex items-center gap-2 text-[11px] text-indigo-300"><Spinner /> {t('Buscando metadatos y texto completo…')}</p>}</> : <div className="grid gap-3 sm:grid-cols-[12rem_1fr]"><label className="block text-xs font-medium">{t('Tipo')}<select data-testid="library-manual-item-type" className="input mt-2 w-full" value={itemType} onChange={(event) => setItemType(event.target.value as LibraryItemMetadata['itemType'])}>{LIBRARY_ITEM_TYPES.map((entry) => <option key={entry.id} value={entry.id}>{t(entry.label)}</option>)}</select></label><label className="block text-xs font-medium">{t('Título')}<input autoFocus data-testid="library-manual-title" className="input mt-2 w-full" value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t('Título de la referencia')} /></label><p className="text-[11px] leading-5 text-neutral-500 sm:col-span-2">{t('Después podrás completar autores, identificadores, publicación, fechas y campos específicos de Zotero.')}</p></div>}
        {error && <p role="alert" className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-300">{error}</p>}
        <div className="mt-5 flex justify-end gap-2"><button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>{t('Cancelar')}</button><button type="submit" data-testid="confirm-create-library-reference" className="btn btn-primary" disabled={busy || (mode === 'identifier' ? !rawIdentifier.trim() : !title.trim())}>{busy ? <Spinner /> : <Icon name={mode === 'identifier' ? 'wand' : 'plus'} />} {t(mode === 'identifier' ? 'Buscar y añadir' : 'Crear y completar')}</button></div>
      </form>
    </section>
  </div>;
}

export function LibraryMetadataEditor({ item, onClose, onSaved }: {
  item: LibraryItemRecord; onClose: () => void; onSaved: (item: LibraryItemRecord) => void;
}) {
  const [draft, setDraft] = useState(() => metadataDraft(item.metadata));
  const [creators, setCreators] = useState<LibraryCreator[]>(item.metadata.creators);
  const [saving, setSaving] = useState(false);
  const [citationKey, setCitationKey] = useState(item.citationKey ?? '');
  const [extraFields, setExtraFields] = useState(() => Object.entries(item.metadata.extra ?? {}).map(([name, value]) => ({ name, value })));
  const [error, setError] = useState('');

  const save = async () => {
    if (!draft.title.trim()) return;
    setSaving(true); setError('');
    try {
      const saved = await window.nodus.updateGlobalLibraryItemMetadata(item.id, {
        title: draft.title.trim(), itemType: draft.itemType, creators, abstract: draft.abstract?.trim() || undefined,
        date: draft.date?.trim() || undefined, year: draft.year == null || !Number.isFinite(Number(draft.year)) ? null : Number(draft.year),
        language: draft.language?.trim() || undefined, publisher: draft.publisher?.trim() || undefined,
        publicationTitle: draft.publicationTitle?.trim() || undefined, volume: draft.volume?.trim() || undefined,
        issue: draft.issue?.trim() || undefined, pages: draft.pages?.trim() || undefined, edition: draft.edition?.trim() || undefined,
        place: draft.place?.trim() || undefined, rights: draft.rights?.trim() || undefined, url: draft.url?.trim() || undefined,
        doi: draft.doi?.trim() || undefined,
        pmid: draft.pmid?.trim() || undefined, pmcid: draft.pmcid?.trim() || undefined, arxiv: draft.arxiv?.trim() || undefined,
        isbn: draft.isbnText.split(/[;,]\s*/).map((value) => value.trim()).filter(Boolean),
        issn: draft.issnText.split(/[;,]\s*/).map((value) => value.trim()).filter(Boolean),
        tags: draft.tagsText.split(',').map((value) => value.trim()).filter(Boolean),
        extra: Object.fromEntries(extraFields.map((entry) => [entry.name.trim(), entry.value.trim()]).filter(([name, value]) => name && value)),
      });
      const final = citationKey.trim() !== (saved.citationKey ?? '')
        ? await window.nodus.updateGlobalLibraryCitationKey(saved.id, citationKey.trim()) : saved;
      toast(t('Metadatos guardados.')); onSaved(final); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  };

  const inputSpan = (span: 1 | 2 | 3 | 4 = 1) => span === 4 ? 'md:col-span-4' : span === 3 ? 'md:col-span-3' : span === 2 ? 'md:col-span-2' : '';
  const input = (key: keyof typeof draft, label: string, options: { span?: 1 | 2 | 3 | 4; textarea?: boolean; type?: string } = {}) => (
    <label className={`block min-w-0 text-[10px] uppercase tracking-wider text-neutral-500 ${inputSpan(options.span)}`}>{t(label)}
      {options.textarea
        ? <textarea className="input mt-1 min-h-20 w-full resize-y normal-case tracking-normal" value={String(draft[key] ?? '')} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} />
        : <input className="input mt-1 h-9 w-full min-w-0 normal-case tracking-normal" type={options.type ?? 'text'} value={String(draft[key] ?? '')} onChange={(event) => setDraft((current) => ({ ...current, [key]: options.type === 'number' ? (event.target.value ? Number(event.target.value) : null) : event.target.value }))} />}
    </label>
  );

  return <div className="fixed inset-0 z-[85] grid place-items-center bg-black/70 p-3 sm:p-5" role="dialog" aria-modal="true" data-testid="library-metadata-editor" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section className="card flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950 shadow-2xl">
      <header className="flex shrink-0 items-center gap-3 border-b border-neutral-800 px-5 py-4 sm:px-6"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-indigo-500/15 text-indigo-300"><Icon name="edit" /></span><div className="min-w-0 flex-1"><h2 className="font-semibold">{t('Editar y completar metadatos')}</h2><p className="mt-1 truncate text-xs text-neutral-500">{item.source === 'nodus' ? t('Ficha propia de Nodus.') : t('Tus cambios se conservan aunque vuelvas a sincronizar el gestor de origen.')}</p></div><button className="btn btn-ghost h-8 w-8 shrink-0 p-0" aria-label={t('Cerrar')} onClick={onClose}><Icon name="x" size={14} /></button></header>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-5 py-5 sm:px-6">
        <div className="grid grid-cols-1 gap-x-3 gap-y-4 md:grid-cols-4">
          {input('title', 'Título', { span: 4 })}
          <fieldset className="min-w-0 rounded-xl border border-neutral-800 bg-neutral-950/25 p-3 md:col-span-4" data-testid="library-creator-editor"><div className="flex items-center justify-between gap-3"><legend className="text-[10px] uppercase tracking-wider text-neutral-500">{t('Autoría y contribuciones')}</legend><button type="button" className="btn btn-ghost h-7 shrink-0 text-[10px]" onClick={() => setCreators((current) => [...current, { creatorType: 'author', firstName: '', lastName: '', fieldMode: 0 }])}><Icon name="plus" size={12} /> {t('Añadir persona')}</button></div>
            {creators.length > 0 && <div className="mt-3 hidden grid-cols-[7rem_7rem_minmax(0,1fr)_minmax(0,1fr)_5.5rem] gap-2 px-2 text-[9px] uppercase tracking-wider text-neutral-600 md:grid"><span>{t('Rol')}</span><span>{t('Tipo de autoría')}</span><span>{t('Nombre')}</span><span>{t('Apellidos')}</span><span className="text-center">{t('Acciones')}</span></div>}
            <div className="mt-1.5 space-y-1.5">{creators.map((creator, index) => <div key={`${index}:${creator.creatorType}`} className="grid min-w-0 grid-cols-2 gap-2 rounded-lg border border-neutral-800 bg-neutral-950/25 p-2 md:grid-cols-[7rem_7rem_minmax(0,1fr)_minmax(0,1fr)_5.5rem]">
              <select aria-label={t('Rol')} className="input h-9 min-w-0 text-xs" value={creator.creatorType} onChange={(event) => setCreators((current) => current.map((entry, position) => position === index ? { ...entry, creatorType: event.target.value } : entry))}>{LIBRARY_CREATOR_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}</select>
              <select aria-label={t('Tipo de autoría')} className="input h-9 min-w-0 text-xs" value={creator.fieldMode === 1 || creator.name ? 'organization' : 'person'} onChange={(event) => setCreators((current) => current.map((entry, position) => position === index ? event.target.value === 'organization' ? { creatorType: entry.creatorType, name: entry.name || [entry.firstName, entry.lastName].filter(Boolean).join(' '), fieldMode: 1 } : { creatorType: entry.creatorType, firstName: '', lastName: entry.name ?? '', fieldMode: 0 } : entry))}><option value="person">{t('Persona')}</option><option value="organization">{t('Institución')}</option></select>
              {creator.fieldMode === 1 || creator.name ? <input aria-label={t('Nombre institucional')} className="input col-span-2 h-9 min-w-0 md:col-span-2" value={creator.name ?? ''} onChange={(event) => setCreators((current) => current.map((entry, position) => position === index ? { ...entry, name: event.target.value, fieldMode: 1 } : entry))} /> : <><input aria-label={t('Nombre')} className="input h-9 min-w-0" value={creator.firstName ?? ''} onChange={(event) => setCreators((current) => current.map((entry, position) => position === index ? { ...entry, firstName: event.target.value } : entry))} /><input aria-label={t('Apellidos')} className="input h-9 min-w-0" value={creator.lastName ?? ''} onChange={(event) => setCreators((current) => current.map((entry, position) => position === index ? { ...entry, lastName: event.target.value } : entry))} /></>}
              <span className="col-span-2 flex h-9 items-center justify-end rounded-lg border border-neutral-800 md:col-span-1 md:justify-center"><button type="button" className="grid h-8 w-7 place-items-center rounded text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-25" aria-label={t('Subir')} disabled={!index} onClick={() => setCreators((current) => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })}><Icon name="chevronUp" size={12} /></button><button type="button" className="grid h-8 w-7 place-items-center rounded text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-25" aria-label={t('Bajar')} disabled={index === creators.length - 1} onClick={() => setCreators((current) => { const next = [...current]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; return next; })}><Icon name="chevronDown" size={12} /></button><button type="button" className="grid h-8 w-7 place-items-center rounded text-red-400 hover:bg-red-500/10" aria-label={t('Eliminar')} onClick={() => setCreators((current) => current.filter((_, position) => position !== index))}><Icon name="trash" size={12} /></button></span>
            </div>)}</div>
          </fieldset>
          <label className="block min-w-0 text-[10px] uppercase tracking-wider text-neutral-500 md:col-span-2">{t('Tipo')}<select data-testid="library-metadata-item-type" className="input mt-1 h-9 w-full min-w-0 normal-case tracking-normal" value={draft.itemType} onChange={(event) => setDraft((current) => ({ ...current, itemType: event.target.value as LibraryItemMetadata['itemType'] }))}>{LIBRARY_ITEM_TYPES.map((entry) => <option key={entry.id} value={entry.id}>{t(entry.label)}</option>)}</select></label>
          {input('year', 'Año', { type: 'number' })}{input('language', 'Idioma')}{input('date', 'Fecha')}{input('publicationTitle', 'Publicación', { span: 3 })}{input('publisher', 'Editorial', { span: 2 })}{input('place', 'Lugar', { span: 2 })}{input('volume', 'Volumen')}{input('issue', 'Número')}{input('pages', 'Páginas')}{input('edition', 'Edición')}{input('doi', 'DOI', { span: 2 })}{input('isbnText', 'ISBN', { span: 2 })}{input('issnText', 'ISSN', { span: 2 })}{input('arxiv', 'arXiv', { span: 2 })}{input('pmid', 'PMID')}{input('pmcid', 'PMCID')}<label className="block min-w-0 text-[10px] uppercase tracking-wider text-neutral-500 md:col-span-2">{t('Clave de cita')}<input data-testid="library-citation-key" className="input mt-1 h-9 w-full min-w-0 normal-case tracking-normal" value={citationKey} onChange={(event) => setCitationKey(event.target.value)} /></label>{input('url', 'URL', { span: 4 })}{input('tagsText', 'Etiquetas', { span: 4 })}{input('abstract', 'Resumen', { span: 4, textarea: true })}
          <fieldset className="min-w-0 rounded-xl border border-neutral-800 bg-neutral-950/25 p-3 md:col-span-4"><div className="flex items-center justify-between gap-3"><legend className="text-[10px] uppercase tracking-wider text-neutral-500">{t('Campos adicionales')}</legend><button type="button" className="btn btn-ghost h-7 shrink-0 text-[10px]" onClick={() => setExtraFields((current) => [...current, { name: '', value: '' }])}><Icon name="plus" size={12} /> {t('Añadir campo')}</button></div><p className="mt-1 text-[10px] text-neutral-600">{t('Conserva campos específicos de Zotero y campos personalizados en importaciones y exportaciones.')}</p><div className="mt-2 space-y-2">{extraFields.map((entry, index) => <div key={index} className="grid min-w-0 grid-cols-[minmax(0,1fr)_2rem] gap-2 sm:grid-cols-[minmax(0,.8fr)_minmax(0,1.4fr)_2rem]"><input aria-label={t('Nombre del campo')} className="input h-9 min-w-0" value={entry.name} onChange={(event) => setExtraFields((current) => current.map((field, position) => position === index ? { ...field, name: event.target.value } : field))} /><input aria-label={t('Valor del campo')} className="input col-start-1 h-9 min-w-0 sm:col-start-2 sm:row-start-1" value={entry.value} onChange={(event) => setExtraFields((current) => current.map((field, position) => position === index ? { ...field, value: event.target.value } : field))} /><button type="button" className="col-start-2 row-span-2 row-start-1 grid h-8 w-8 place-items-center self-center rounded text-red-400 hover:bg-red-500/10 sm:col-start-3 sm:row-span-1" aria-label={t('Eliminar campo')} onClick={() => setExtraFields((current) => current.filter((_, position) => position !== index))}><Icon name="trash" size={12} /></button></div>)}</div></fieldset>
        </div>
      </div>
      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-neutral-800 px-5 py-3.5 sm:px-6">{error ? <p role="alert" className="min-w-0 flex-1 truncate text-xs text-red-400" title={error}>{error}</p> : <span />}<div className="flex shrink-0 items-center gap-2"><button className="btn btn-ghost" onClick={onClose}>{t('Cancelar')}</button><button className="btn btn-primary" disabled={saving || !draft.title.trim()} onClick={() => void save()}>{saving ? <Spinner /> : <Icon name="save" />} {t('Guardar metadatos')}</button></div></footer>
    </section>
  </div>;
}

export function LibraryMetadataBatchDialog({ itemIds, onClose, onApplied }: {
  itemIds: string[]; onClose: () => void; onApplied: () => void;
}) {
  const [requestId] = useState(() => `metadata-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [progress, setProgress] = useState<LibraryMetadataBatchProgress | null>(null);
  const [result, setResult] = useState<LibraryMetadataBatchResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => window.nodus.onGlobalLibraryMetadataBatchProgress((value) => { if (value.requestId === requestId) setProgress(value); }), [requestId]);
  const start = async () => {
    setBusy(true); setError('');
    try { const value = await window.nodus.startGlobalLibraryMetadataBatch(requestId, itemIds); setResult(value); setSelected(new Set(value.entries.filter((entry) => !!entry.candidate).map((entry) => entry.itemId))); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    setBusy(true); try { const value = await window.nodus.applyGlobalLibraryMetadataBatch(requestId, [...selected]); setResult(value); toast(tx('{n} ficha(s) actualizada(s).', { n: value.entries.filter((entry) => entry.applied).length })); onApplied(); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); }
  };
  const close = () => { if (busy) void window.nodus.cancelGlobalLibraryMetadataBatch(requestId); onClose(); };
  return <div className="fixed inset-0 z-[90] grid place-items-center bg-black/70 p-5" role="dialog" aria-modal="true" data-testid="library-metadata-batch-dialog">
    <section className="card flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden"><header className="flex items-center gap-3 border-b border-neutral-800 px-5 py-4"><Icon name="search" className="text-indigo-300" /><div className="min-w-0 flex-1"><h2 className="font-semibold">{t('Completar metadatos en lote')}</h2><p className="text-xs text-neutral-500">{t('Se prepara una vista previa y sólo se aplican las fichas que confirmes.')}</p></div><button className="btn btn-ghost" onClick={close}><Icon name="x" /></button></header>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">{!result && !busy && <div className="rounded-xl border border-neutral-800 p-5 text-center"><p className="text-sm">{tx('{n} referencia(s) con identificadores compatibles', { n: itemIds.length })}</p><p className="mt-2 text-xs leading-5 text-neutral-500">{t('Las consultas se limitan en velocidad y los resultados parciales se conservan si cancelas.')}</p><button data-testid="start-library-metadata-batch" className="btn btn-primary mt-4" onClick={() => void start()}><Icon name="search" /> {t('Crear vista previa')}</button></div>}
        {busy && !result && <div className="py-10"><Spinner label={progress?.message ?? t('Resolviendo metadatos…')} /><div className="mx-auto mt-4 h-1.5 max-w-sm overflow-hidden rounded-full bg-neutral-800"><div className="h-full bg-indigo-500" style={{ width: `${progress?.total ? Math.round(progress.completed / progress.total * 100) : 0}%` }} /></div><p className="mt-2 text-center text-[10px] text-neutral-600">{progress?.completed ?? 0} / {progress?.total ?? itemIds.length}</p><button className="btn btn-ghost mx-auto mt-3 flex" onClick={() => void window.nodus.cancelGlobalLibraryMetadataBatch(requestId)}>{t('Cancelar')}</button></div>}
        {result && <div className="space-y-2">{result.entries.map((entry) => <label key={entry.itemId} className={`flex items-start gap-3 rounded-xl border p-3 ${entry.candidate ? 'border-neutral-800' : 'border-red-500/20'}`}><input type="checkbox" disabled={!entry.candidate || entry.applied} checked={selected.has(entry.itemId)} onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(entry.itemId)) next.delete(entry.itemId); else next.add(entry.itemId); return next; })} /><span className="min-w-0 flex-1"><b className="block text-xs">{entry.candidate?.metadata.title ?? entry.itemId}</b><span className="mt-1 block text-[10px] text-neutral-500">{entry.kind?.toUpperCase() ?? '—'} {entry.value ?? ''}{entry.candidate ? ` · ${entry.candidate.source} · ${Math.round(entry.candidate.confidence * 100)}%` : ''}</span>{entry.error && <span className="mt-1 block text-[10px] text-red-400">{entry.error}</span>}</span></label>)}</div>}
        {error && <p role="alert" className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">{error}</p>}
      </div>{result && <footer className="flex items-center justify-between border-t border-neutral-800 px-5 py-4"><span className="text-xs text-neutral-500">{tx('{n} seleccionada(s)', { n: selected.size })}</span><div className="flex gap-2"><button className="btn btn-ghost" onClick={close}>{t('Cancelar')}</button><button data-testid="apply-library-metadata-batch" className="btn btn-primary" disabled={busy || !selected.size} onClick={() => void apply()}>{busy ? <Spinner /> : <Icon name="save" />} {t('Confirmar cambios')}</button></div></footer>}
    </section>
  </div>;
}

export function LibraryCitationExportDialog({ itemIds, requestScope, initialStyleManagerOpen = false, onClose }: {
  itemIds: string[]; requestScope: Omit<LibraryBibliographyExportRequest, 'format' | 'itemIds'>; initialStyleManagerOpen?: boolean; onClose: () => void;
}) {
  const [style, setStyle] = useState<LibraryCitationStyle>('apa-7'); const [kind, setKind] = useState<'citation' | 'bibliography'>('bibliography');
  const [format, setFormat] = useState<LibraryBibliographyFormat>('ris'); const [preview, setPreview] = useState(''); const [busy, setBusy] = useState(false);
  const [styles, setStyles] = useState<LibraryCitationStyleRecord[]>([]); const [styleSearch, setStyleSearch] = useState(''); const [styleManagerOpen, setStyleManagerOpen] = useState(initialStyleManagerOpen); const [locale, setLocale] = useState('es-ES');
  const [repositoryOpen, setRepositoryOpen] = useState(false); const [repositorySearch, setRepositorySearch] = useState('');
  const [repositoryStyles, setRepositoryStyles] = useState<LibraryCitationStyleRepositoryEntry[]>([]); const [repositoryLoading, setRepositoryLoading] = useState(false);
  const targetIds = itemIds;
  const refreshStyles = async () => { const next = await window.nodus.listGlobalLibraryCitationStyles(); setStyles(next); if (!next.some((entry) => entry.id === style)) setStyle(next[0]?.id ?? 'apa-7'); };
  useEffect(() => { void refreshStyles(); }, []);
  useEffect(() => {
    if (!repositoryOpen) return;
    const timer = window.setTimeout(() => {
      setRepositoryLoading(true);
      void window.nodus.searchGlobalLibraryRepositoryCitationStyles(repositorySearch, 80)
        .then(setRepositoryStyles)
        .catch((cause) => toast(cause instanceof Error ? cause.message : String(cause)))
        .finally(() => setRepositoryLoading(false));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [repositoryOpen, repositorySearch]);
  const copy = async () => { setBusy(true); try { const result = await window.nodus.formatGlobalLibraryCitation(targetIds, style, kind, locale); setPreview(result.text); await refreshStyles(); toast(t('Cita copiada al portapapeles.')); } catch (cause) { toast(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); } };
  const exportFile = async () => { setBusy(true); try { const result = await window.nodus.exportGlobalLibraryBibliography({ ...requestScope, ...(targetIds.length ? { itemIds: targetIds } : {}), format }); if (!result.canceled) toast(tx('{n} referencia(s) exportada(s).', { n: result.exported })); } finally { setBusy(false); } };
  const filteredStyles = styles.filter((entry) => matchesCitationStyleQuery(entry, styleSearch));
  const runImport = async (source: 'file' | 'zotero') => { setBusy(true); try { const result = source === 'file' ? await window.nodus.importGlobalLibraryCitationStyles() : await window.nodus.importZoteroCitationStyles(); setStyles(result.styles); if (result.imported || result.updated) toast(tx('{n} estilo(s) CSL importado(s).', { n: result.imported + result.updated })); else if (result.warnings[0]) toast(result.warnings[0]); } catch (cause) { toast(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); } };
  const installRepository = async (id: string) => { setBusy(true); try { const installed = await window.nodus.installGlobalLibraryRepositoryCitationStyle(id); await refreshStyles(); setStyle(installed.id); toast(t('Estilo CSL instalado.')); } catch (cause) { toast(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); } };
  return <div className="fixed inset-0 z-[90] grid place-items-center bg-black/70 p-5" role="dialog" aria-modal="true" data-testid="library-citation-export-dialog"><section className="card flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden"><header className="flex items-center gap-3 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800"><Icon name="quote" className="text-indigo-500 dark:text-indigo-300" /><div className="flex-1"><h2 className="font-semibold">{t('Citas y exportación')}</h2><p className="text-xs text-neutral-500">{itemIds.length ? tx('{n} referencia(s) seleccionada(s)', { n: itemIds.length }) : t('Colección o búsqueda actual')}</p></div><button className="btn btn-ghost" onClick={onClose}><Icon name="x" /></button></header><div className="min-h-0 flex-1 overflow-y-auto"><div className="grid gap-5 p-5 sm:grid-cols-2"><section><div className="flex items-center justify-between"><h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{t('Copiar cita')}</h3><button className="text-[10px] text-indigo-600 hover:text-indigo-500 dark:text-indigo-300 dark:hover:text-indigo-200" onClick={() => setStyleManagerOpen((value) => !value)}><Icon name="settings" size={11} /> {t('Gestionar estilos')}</button></div><CitationStylePicker styles={styles} value={style} onChange={setStyle} disabled={busy} /><div className="mt-2 grid grid-cols-2 gap-2"><select className="input w-full" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="bibliography">{t('Entrada bibliográfica')}</option><option value="citation">{t('Cita en el texto')}</option></select><select className="input w-full" value={locale} onChange={(event) => setLocale(event.target.value)} aria-label={t('Idioma de la cita')}><option value="es-ES">Español</option><option value="en-US">English</option><option value="fr-FR">Français</option><option value="de-DE">Deutsch</option><option value="nl-NL">Nederlands</option></select></div><button data-testid="copy-library-citation" className="btn btn-primary mt-3 w-full" disabled={busy || !targetIds.length} onClick={() => void copy()}>{busy ? <Spinner /> : <Icon name="copy" />} {t('Copiar')}</button>{preview && <pre className="mt-3 max-h-40 whitespace-pre-wrap rounded-xl bg-neutral-100 p-3 text-[10px] leading-5 text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">{preview}</pre>}</section><section><h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{t('Exportar referencias')}</h3><select data-testid="library-export-format" className="input mt-2 w-full" value={format} onChange={(event) => setFormat(event.target.value as LibraryBibliographyFormat)}>{[['ris', 'RIS'], ['bibtex', 'BibTeX'], ['biblatex', 'BibLaTeX'], ['csl-json', 'CSL-JSON'], ['endnote-xml', 'EndNote XML'], ['zotero-rdf', 'Zotero RDF'], ['csv', 'CSV'], ['markdown', 'Markdown']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><p className="mt-3 text-xs leading-5 text-neutral-500">{t('Los campos desconocidos se conservan para poder volver a importar el archivo sin pérdidas.')}</p><button data-testid="export-library-bibliography" className="btn btn-secondary mt-3 w-full" disabled={busy} onClick={() => void exportFile()}><Icon name="download" /> {t('Exportar…')}</button></section></div>
      {styleManagerOpen && <section data-testid="library-citation-style-manager" className="border-t border-neutral-200 bg-neutral-50/70 p-5 dark:border-neutral-800 dark:bg-neutral-950/25"><div className="flex flex-wrap items-center gap-2"><div className="relative min-w-56 flex-1"><Icon name="search" size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" /><input data-testid="library-installed-style-search" className="input input-with-leading-icon w-full" value={styleSearch} onChange={(event) => setStyleSearch(event.target.value)} placeholder={t('Buscar estilos instalados…')} /></div><button data-testid="import-library-csl" className="btn btn-secondary" disabled={busy} onClick={() => void runImport('file')}><Icon name="upload" />{t('Importar .csl')}</button><button data-testid="import-zotero-csl" className="btn btn-secondary" disabled={busy} onClick={() => void runImport('zotero')}><Icon name="library" />{t('Importar de Zotero')}</button><button data-testid="browse-csl-repository" className="btn btn-secondary" disabled={busy} onClick={() => setRepositoryOpen((value) => !value)}><Icon name="plus" />{t('Añadir más estilos')}</button></div><p className="mt-3 text-[10px] leading-5 text-neutral-500">{t('Los estilos oficiales pertenecen al proyecto CSL y conservan su autoría y licencia CC BY-SA 3.0. Los estilos privados sin licencia permanecen sólo en tu nodus-library.')}</p>
        {repositoryOpen && <div data-testid="library-csl-repository" className="mt-3 rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-950"><div className="relative"><Icon name="search" size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" /><input autoFocus data-testid="library-csl-repository-search" className="input input-with-leading-icon w-full" value={repositorySearch} onChange={(event) => setRepositorySearch(event.target.value)} placeholder={t('Buscar en el repositorio oficial CSL…')} /></div><div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-neutral-200 dark:border-neutral-800">{repositoryLoading ? <div className="p-4"><Spinner label={t('Consultando estilos oficiales…')} /></div> : repositoryStyles.map((entry) => <button key={entry.id} type="button" className="flex w-full items-center justify-between gap-3 border-b border-neutral-200 px-3 py-2 text-left text-xs last:border-0 hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-900" disabled={busy} onClick={() => void installRepository(entry.id)}><span className="min-w-0"><b className="block truncate">{entry.title}</b><span className="block truncate font-mono text-[9px] text-neutral-500">{entry.id}</span></span><Icon name="download" size={13} /></button>)}</div></div>}
        <div data-testid="library-citation-style-list" className="mt-3 max-h-72 overflow-y-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">{filteredStyles.map((entry) => <article key={`${entry.source}:${entry.id}`} className={`flex items-center gap-3 border-b border-neutral-200 p-3 last:border-0 dark:border-neutral-800 ${style === entry.id ? 'bg-indigo-500/5' : ''}`}><button className="min-w-0 flex-1 text-left" onClick={() => setStyle(entry.id)}><b className="block truncate text-xs">{entry.title}</b><span className="mt-1 block truncate font-mono text-[9px] text-neutral-500">{entry.id}</span><span className="mt-1 block text-[9px] text-neutral-500">{t(entry.source === 'bundled' ? 'Incluido' : entry.source === 'zotero' ? 'De Zotero' : entry.source === 'repository' ? 'Repositorio CSL' : 'Archivo local')} · {entry.availableOffline ? t('Disponible sin conexión') : t('Descarga pendiente')}</span>{entry.warning && <span className="mt-2 block text-[9px] leading-4 text-amber-600 dark:text-amber-400">{t(entry.warning)}</span>}</button>{entry.removable && <button className="shrink-0 text-[9px] text-red-500 hover:text-red-400" onClick={async () => { if (await window.nodus.removeGlobalLibraryCitationStyle(entry.id)) { await refreshStyles(); if (style === entry.id) setStyle('apa-7'); } }}><Icon name="trash" size={10} /> {t('Eliminar')}</button>}</article>)}</div></section>}
    </div></section></div>;
}

export function LibraryDuplicatesDialog({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [groups, setGroups] = useState<LibraryDuplicateGroup[]>([]); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState('');
  const [impact, setImpact] = useState<{ groupKey: string; value: LibraryMergeImpact } | null>(null);
  const canonicalDefaults = useMemo(() => Object.fromEntries(groups.map((group) => [group.key, group.items[0]?.id ?? ''])), [groups]);
  const [canonical, setCanonical] = useState<Record<string, string>>({});
  useEffect(() => { void window.nodus.listGlobalLibraryDuplicates().then((values) => { setGroups(values); setCanonical(Object.fromEntries(values.map((group) => [group.key, group.items[0]?.id ?? '']))); }).finally(() => setLoading(false)); }, []);
  const previewMerge = async (group: LibraryDuplicateGroup) => {
    const id = canonical[group.key] || canonicalDefaults[group.key]; if (!id) return;
    setBusy(group.key); try { setImpact({ groupKey: group.key, value: await window.nodus.previewGlobalLibraryMerge(id, group.items.filter((item) => item.id !== id).map((item) => item.id)) }); } finally { setBusy(''); }
  };
  const merge = async (group: LibraryDuplicateGroup) => {
    const id = canonical[group.key] || canonicalDefaults[group.key]; if (!id || impact?.groupKey !== group.key) return;
    if (!(await confirm({ title: t('Fusionar duplicados'), message: t('Se conservarán colecciones, adjuntos, Markdown, anotaciones, chats, notas, aliases y relaciones. Las obras de vault permanecen separadas.'), danger: true, confirmLabel: t('Fusionar') }))) return;
    setBusy(group.key); try { await window.nodus.mergeGlobalLibraryItems(id, group.items.filter((item) => item.id !== id).map((item) => item.id)); setGroups((current) => current.filter((entry) => entry.key !== group.key)); onChanged(); toast(t('Duplicados fusionados.')); } finally { setBusy(''); }
  };
  return <div className="fixed inset-0 z-[85] grid place-items-center bg-black/70 p-5" role="dialog" aria-modal="true" data-testid="library-duplicates-dialog"><section className="card flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden"><header className="flex items-center gap-3 border-b border-neutral-800 px-5 py-4"><Icon name="copy" className="text-indigo-300" /><div className="flex-1"><h2 className="font-semibold">{t('Revisar duplicados')}</h2><p className="text-xs text-neutral-500">{tx('{n} grupos por DOI, ISBN o ficha coincidente', { n: groups.length })}</p></div><button className="btn btn-ghost" onClick={onClose}><Icon name="x" /></button></header><div className="min-h-0 flex-1 overflow-y-auto p-5">{loading ? <Spinner label={t('Buscando duplicados…')} /> : groups.length ? <div className="space-y-4">{groups.map((group) => <article key={group.key} className="rounded-xl border border-neutral-800 p-4"><h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{t('Coincidencia por')} {group.reason.toUpperCase()}</h3><div className="mt-3 space-y-2">{group.items.map((item) => <label key={item.id} className={`flex items-start gap-3 rounded-lg border p-3 ${canonical[group.key] === item.id ? 'border-indigo-500/50 bg-indigo-500/5' : 'border-neutral-800'}`}><input type="radio" name={group.key} checked={canonical[group.key] === item.id} onChange={() => { setCanonical((current) => ({ ...current, [group.key]: item.id })); setImpact(null); }} /><span className="min-w-0 flex-1"><b className="block text-xs">{item.title}</b><span className="mt-1 block text-[10px] text-neutral-500">{item.source} · {item.year ?? '—'} · {item.attachmentCount} {t('adjuntos')}</span></span><span className="text-[10px] text-indigo-300">{canonical[group.key] === item.id ? t('Conservar') : ''}</span></label>)}</div>{impact?.groupKey === group.key && <div data-testid="library-merge-impact" className="mt-3 rounded-xl border border-indigo-500/25 bg-indigo-500/5 p-3 text-[10px] text-neutral-400"><b className="text-indigo-300">{t('Impacto verificado')}</b><p className="mt-1">{impact.value.attachmentCount} {t('adjuntos')} · {impact.value.annotationCount + impact.value.orphanedAnnotationCount} {t('anotaciones')} · {impact.value.chatMessageCount} {t('mensajes')} · {impact.value.noteCount} {t('notas')} · {impact.value.aliasCount} {t('aliases')}</p><p className="mt-1">{tx('{n} obra(s) de vault se conservan sin fusionar.', { n: impact.value.vaultWorksPreserved })}</p></div>}<button className="btn btn-primary mt-3" disabled={busy === group.key} onClick={() => void (impact?.groupKey === group.key ? merge(group) : previewMerge(group))}>{busy === group.key ? <Spinner /> : <Icon name="merge" />} {t(impact?.groupKey === group.key ? 'Confirmar fusión' : 'Revisar impacto')}</button></article>)}</div> : <p className="py-10 text-center text-sm text-neutral-500">{t('No se han detectado duplicados.')}</p>}</div></section></div>;
}
