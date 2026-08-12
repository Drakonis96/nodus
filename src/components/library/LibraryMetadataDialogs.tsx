import { useEffect, useMemo, useState } from 'react';
import type {
  LibraryDuplicateGroup,
  LibraryItemMetadata,
  LibraryItemRecord,
  LibraryCreator,
  LibraryMetadataCandidate,
  LibraryMetadataIdentifierKind,
  LibraryMetadataBatchProgress,
  LibraryMetadataBatchResult,
  LibraryBibliographyExportRequest,
  LibraryBibliographyFormat,
  LibraryCitationStyle,
  LibraryCitationStyleRecord,
  LibraryMergeImpact,
} from '@shared/libraryTypes';
import { confirm, promptText, toast } from '../feedback';
import { Icon, Spinner } from '../ui';
import { t, tx } from '../../i18n';
import { mergeLibraryMetadataCandidate } from '@shared/libraryMetadata';
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

const FIELD_LABELS: Array<[keyof LibraryItemMetadata, string]> = [
  ['title', 'Título'], ['creators', 'Autoría'], ['date', 'Fecha'], ['year', 'Año'], ['publicationTitle', 'Publicación'],
  ['publisher', 'Editorial'], ['volume', 'Volumen'], ['issue', 'Número'], ['pages', 'Páginas'], ['doi', 'DOI'],
  ['isbn', 'ISBN'], ['issn', 'ISSN'], ['language', 'Idioma'], ['abstract', 'Resumen'], ['tags', 'Etiquetas'],
  ['pmid', 'PMID'], ['pmcid', 'PMCID'], ['arxiv', 'arXiv'],
];

function displayValue(metadata: LibraryItemMetadata, key: keyof LibraryItemMetadata): string {
  const value = key === 'creators' ? authorText(metadata) : metadata[key];
  return Array.isArray(value) ? value.join('; ') : value == null ? '' : String(value);
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
  const initialKind: LibraryMetadataIdentifierKind = item.metadata.doi ? 'doi' : item.metadata.pmid ? 'pmid' : item.metadata.pmcid ? 'pmcid' : item.metadata.arxiv ? 'arxiv' : item.metadata.isbn?.[0] ? 'isbn' : 'issn';
  const [kind, setKind] = useState<LibraryMetadataIdentifierKind>(initialKind);
  const [lookupValue, setLookupValue] = useState(item.metadata[initialKind] instanceof Array ? item.metadata[initialKind]?.[0] ?? '' : String(item.metadata[initialKind] ?? ''));
  const [candidates, setCandidates] = useState<LibraryMetadataCandidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<LibraryMetadataCandidate | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [citationKey, setCitationKey] = useState(item.citationKey ?? '');
  const [extraFields, setExtraFields] = useState(() => Object.entries(item.metadata.extra ?? {}).map(([name, value]) => ({ name, value })));
  const [error, setError] = useState('');

  const lookup = async () => {
    if (!lookupValue.trim()) return;
    setLookingUp(true); setError(''); setCandidates([]); setSelectedCandidate(null);
    try {
      const result = await window.nodus.resolveGlobalLibraryMetadata(kind, lookupValue);
      setCandidates(result.candidates); setSelectedCandidate(result.candidates[0] ?? null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLookingUp(false); }
  };

  const applyCandidate = (candidate: LibraryMetadataCandidate) => {
    const merged = mergeLibraryMetadataCandidate(draft, candidate.metadata);
    setDraft(metadataDraft(merged)); setCreators(merged.creators); setSelectedCandidate(candidate);
  };

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

  const input = (key: keyof typeof draft, label: string, options: { wide?: boolean; textarea?: boolean; type?: string } = {}) => (
    <label className={`block text-[10px] uppercase tracking-wider text-neutral-500 ${options.wide ? 'sm:col-span-2' : ''}`}>{t(label)}
      {options.textarea
        ? <textarea className="input mt-1 min-h-24 w-full normal-case tracking-normal" value={String(draft[key] ?? '')} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} />
        : <input className="input mt-1 w-full normal-case tracking-normal" type={options.type ?? 'text'} value={String(draft[key] ?? '')} onChange={(event) => setDraft((current) => ({ ...current, [key]: options.type === 'number' ? (event.target.value ? Number(event.target.value) : null) : event.target.value }))} />}
    </label>
  );

  return <div className="fixed inset-0 z-[85] grid place-items-center bg-black/70 p-5" role="dialog" aria-modal="true" data-testid="library-metadata-editor" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section className="card flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden shadow-2xl">
      <header className="flex items-center gap-3 border-b border-neutral-800 px-5 py-4"><span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-500/15 text-indigo-300"><Icon name="edit" /></span><div className="min-w-0 flex-1"><h2 className="font-semibold">{t('Editar y completar metadatos')}</h2><p className="mt-1 text-xs text-neutral-500">{item.source === 'nodus' ? t('Ficha propia de Nodus.') : t('Tus cambios se conservan aunque vuelvas a sincronizar el gestor de origen.')}</p></div><button className="btn btn-ghost" onClick={onClose}><Icon name="x" /></button></header>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[1.25fr_.9fr]">
        <div className="min-h-0 overflow-y-auto p-5"><div className="grid gap-3 sm:grid-cols-2">
          {input('title', 'Título', { wide: true })}
          <fieldset className="sm:col-span-2" data-testid="library-creator-editor"><div className="flex items-center justify-between"><legend className="text-[10px] uppercase tracking-wider text-neutral-500">{t('Autoría y contribuciones')}</legend><button type="button" className="btn btn-ghost h-7 text-[10px]" onClick={() => setCreators((current) => [...current, { creatorType: 'author', firstName: '', lastName: '', fieldMode: 0 }])}><Icon name="plus" size={12} /> {t('Añadir persona')}</button></div>
            <div className="mt-2 space-y-2">{creators.map((creator, index) => <div key={`${index}:${creator.creatorType}`} className="grid gap-2 rounded-xl border border-neutral-800 p-2 sm:grid-cols-[8rem_7rem_1fr_1fr_auto]">
              <select aria-label={t('Rol')} className="input text-xs" value={creator.creatorType} onChange={(event) => setCreators((current) => current.map((entry, position) => position === index ? { ...entry, creatorType: event.target.value } : entry))}>{LIBRARY_CREATOR_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}</select>
              <select aria-label={t('Tipo de autoría')} className="input text-xs" value={creator.fieldMode === 1 || creator.name ? 'organization' : 'person'} onChange={(event) => setCreators((current) => current.map((entry, position) => position === index ? event.target.value === 'organization' ? { creatorType: entry.creatorType, name: entry.name || [entry.firstName, entry.lastName].filter(Boolean).join(' '), fieldMode: 1 } : { creatorType: entry.creatorType, firstName: '', lastName: entry.name ?? '', fieldMode: 0 } : entry))}><option value="person">{t('Persona')}</option><option value="organization">{t('Institución')}</option></select>
              {creator.fieldMode === 1 || creator.name ? <input aria-label={t('Nombre institucional')} className="input sm:col-span-2" value={creator.name ?? ''} onChange={(event) => setCreators((current) => current.map((entry, position) => position === index ? { ...entry, name: event.target.value, fieldMode: 1 } : entry))} /> : <><input aria-label={t('Nombre')} className="input" value={creator.firstName ?? ''} onChange={(event) => setCreators((current) => current.map((entry, position) => position === index ? { ...entry, firstName: event.target.value } : entry))} /><input aria-label={t('Apellidos')} className="input" value={creator.lastName ?? ''} onChange={(event) => setCreators((current) => current.map((entry, position) => position === index ? { ...entry, lastName: event.target.value } : entry))} /></>}
              <span className="flex items-center"><button type="button" className="grid h-7 w-7 place-items-center" aria-label={t('Subir')} disabled={!index} onClick={() => setCreators((current) => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })}><Icon name="chevronUp" size={12} /></button><button type="button" className="grid h-7 w-7 place-items-center" aria-label={t('Bajar')} disabled={index === creators.length - 1} onClick={() => setCreators((current) => { const next = [...current]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; return next; })}><Icon name="chevronDown" size={12} /></button><button type="button" className="grid h-7 w-7 place-items-center text-red-400" aria-label={t('Eliminar')} onClick={() => setCreators((current) => current.filter((_, position) => position !== index))}><Icon name="trash" size={12} /></button></span>
            </div>)}</div>
          </fieldset>
          <label className="block text-[10px] uppercase tracking-wider text-neutral-500">{t('Tipo')}<select data-testid="library-metadata-item-type" className="input mt-1 w-full normal-case tracking-normal" value={draft.itemType} onChange={(event) => setDraft((current) => ({ ...current, itemType: event.target.value as LibraryItemMetadata['itemType'] }))}>{LIBRARY_ITEM_TYPES.map((entry) => <option key={entry.id} value={entry.id}>{t(entry.label)}</option>)}</select></label>
          {input('year', 'Año', { type: 'number' })}{input('date', 'Fecha')}{input('language', 'Idioma')}{input('publicationTitle', 'Publicación', { wide: true })}{input('publisher', 'Editorial')}{input('place', 'Lugar')}{input('volume', 'Volumen')}{input('issue', 'Número')}{input('pages', 'Páginas')}{input('edition', 'Edición')}{input('doi', 'DOI', { wide: true })}{input('isbnText', 'ISBN', { wide: true })}{input('issnText', 'ISSN', { wide: true })}{input('pmid', 'PMID')}{input('pmcid', 'PMCID')}{input('arxiv', 'arXiv', { wide: true })}<label className="block text-[10px] uppercase tracking-wider text-neutral-500 sm:col-span-2">{t('Clave de cita')}<input data-testid="library-citation-key" className="input mt-1 w-full normal-case tracking-normal" value={citationKey} onChange={(event) => setCitationKey(event.target.value)} /></label>{input('url', 'URL', { wide: true })}{input('tagsText', 'Etiquetas', { wide: true })}{input('abstract', 'Resumen', { wide: true, textarea: true })}
          <fieldset className="sm:col-span-2"><div className="flex items-center justify-between"><legend className="text-[10px] uppercase tracking-wider text-neutral-500">{t('Campos adicionales')}</legend><button type="button" className="btn btn-ghost h-7 text-[10px]" onClick={() => setExtraFields((current) => [...current, { name: '', value: '' }])}><Icon name="plus" size={12} /> {t('Añadir campo')}</button></div><p className="mt-1 text-[10px] text-neutral-600">{t('Conserva campos específicos de Zotero y campos personalizados en importaciones y exportaciones.')}</p><div className="mt-2 space-y-2">{extraFields.map((entry, index) => <div key={index} className="grid grid-cols-[minmax(7rem,.8fr)_minmax(10rem,1.4fr)_auto] gap-2"><input aria-label={t('Nombre del campo')} className="input" value={entry.name} onChange={(event) => setExtraFields((current) => current.map((field, position) => position === index ? { ...field, name: event.target.value } : field))} /><input aria-label={t('Valor del campo')} className="input" value={entry.value} onChange={(event) => setExtraFields((current) => current.map((field, position) => position === index ? { ...field, value: event.target.value } : field))} /><button type="button" className="grid h-8 w-8 place-items-center text-red-400" aria-label={t('Eliminar campo')} onClick={() => setExtraFields((current) => current.filter((_, position) => position !== index))}><Icon name="trash" size={12} /></button></div>)}</div></fieldset>
        </div></div>
        <aside className="min-h-0 overflow-y-auto border-l border-neutral-800 bg-neutral-950/35 p-5">
          <h3 className="text-xs font-semibold">{t('Buscar por identificador')}</h3><p className="mt-1 text-[10px] leading-5 text-neutral-600">{t('Consulta fuentes bibliográficas públicas. Nada se aplica sin tu revisión.')}</p>
          <div className="mt-3 flex gap-2"><select className="input w-24 text-xs uppercase" value={kind} onChange={(event) => { const next = event.target.value as LibraryMetadataIdentifierKind; setKind(next); const value = next === 'isbn' ? draft.isbnText.split(';')[0] : next === 'issn' ? draft.issnText.split(';')[0] : String(draft[next] ?? ''); setLookupValue(value); }}>{['doi', 'isbn', 'issn', 'pmid', 'pmcid', 'arxiv'].map((value) => <option key={value}>{value}</option>)}</select><input className="input min-w-0 flex-1" value={lookupValue} onChange={(event) => setLookupValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void lookup(); }} /><button className="btn btn-primary" disabled={lookingUp || !lookupValue.trim()} onClick={() => void lookup()}>{lookingUp ? <Spinner /> : <Icon name="search" />}</button></div>
          {error && <p role="alert" className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">{error}</p>}
          <div className="mt-4 space-y-2">{candidates.map((candidate) => <button key={candidate.id} className={`block w-full rounded-xl border p-3 text-left ${selectedCandidate?.id === candidate.id ? 'border-indigo-500 bg-indigo-500/10' : 'border-neutral-800 hover:border-neutral-700'}`} onClick={() => setSelectedCandidate(candidate)}><b className="line-clamp-2 text-xs">{candidate.metadata.title}</b><span className="mt-1 block text-[10px] text-neutral-500">{authorText(candidate.metadata) || '—'} · {candidate.metadata.year ?? '—'} · {candidate.source}</span><span className="mt-2 block text-[10px] text-indigo-300">{Math.round(candidate.confidence * 100)}% {t('coincidencia')}</span></button>)}</div>
          {selectedCandidate && <div className="mt-4"><div className="flex items-center justify-between"><h4 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{t('Vista previa de cambios')}</h4><button className="btn btn-secondary h-8 text-xs" onClick={() => applyCandidate(selectedCandidate)}>{t('Usar esta ficha')}</button></div><div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-neutral-800">{FIELD_LABELS.flatMap(([key, label]) => { const before = displayValue(item.metadata, key); const after = displayValue(selectedCandidate.metadata, key); return before === after || !after ? [] : [<div key={key} className="border-b border-neutral-800 p-2 last:border-0"><b className="text-[9px] uppercase tracking-wider text-neutral-600">{t(label)}</b><p className="mt-1 line-clamp-2 text-[10px] text-red-300/70">− {before || '—'}</p><p className="mt-1 line-clamp-2 text-[10px] text-emerald-300">+ {after}</p></div>]; })}</div></div>}
        </aside>
      </div>
      <footer className="flex items-center justify-end gap-2 border-t border-neutral-800 px-5 py-4"><button className="btn btn-ghost" onClick={onClose}>{t('Cancelar')}</button><button className="btn btn-primary" disabled={saving || !draft.title.trim()} onClick={() => void save()}>{saving ? <Spinner /> : <Icon name="save" />} {t('Guardar metadatos')}</button></footer>
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

export function LibraryCitationExportDialog({ itemIds, requestScope, onClose }: {
  itemIds: string[]; requestScope: Omit<LibraryBibliographyExportRequest, 'format' | 'itemIds'>; onClose: () => void;
}) {
  const [style, setStyle] = useState<LibraryCitationStyle>('apa-7'); const [kind, setKind] = useState<'citation' | 'bibliography'>('bibliography');
  const [format, setFormat] = useState<LibraryBibliographyFormat>('ris'); const [preview, setPreview] = useState(''); const [busy, setBusy] = useState(false);
  const [styles, setStyles] = useState<LibraryCitationStyleRecord[]>([]); const [styleSearch, setStyleSearch] = useState(''); const [styleManagerOpen, setStyleManagerOpen] = useState(false); const [locale, setLocale] = useState('es-ES');
  const targetIds = itemIds;
  const refreshStyles = async () => { const next = await window.nodus.listGlobalLibraryCitationStyles(); setStyles(next); if (!next.some((entry) => entry.id === style)) setStyle(next[0]?.id ?? 'apa-7'); };
  useEffect(() => { void refreshStyles(); }, []);
  const copy = async () => { setBusy(true); try { const result = await window.nodus.formatGlobalLibraryCitation(targetIds, style, kind, locale); setPreview(result.text); await refreshStyles(); toast(t('Cita copiada al portapapeles.')); } catch (cause) { toast(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); } };
  const exportFile = async () => { setBusy(true); try { const result = await window.nodus.exportGlobalLibraryBibliography({ ...requestScope, ...(targetIds.length ? { itemIds: targetIds } : {}), format }); if (!result.canceled) toast(tx('{n} referencia(s) exportada(s).', { n: result.exported })); } finally { setBusy(false); } };
  const filteredStyles = styles.filter((entry) => `${entry.title} ${entry.id}`.toLocaleLowerCase().includes(styleSearch.toLocaleLowerCase()));
  const runImport = async (source: 'file' | 'zotero') => { setBusy(true); try { const result = source === 'file' ? await window.nodus.importGlobalLibraryCitationStyles() : await window.nodus.importZoteroCitationStyles(); setStyles(result.styles); if (result.imported || result.updated) toast(tx('{n} estilo(s) CSL importado(s).', { n: result.imported + result.updated })); else if (result.warnings[0]) toast(result.warnings[0]); } catch (cause) { toast(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); } };
  const installRepository = async () => { const id = await promptText({ title: t('Añadir estilo del repositorio'), message: t('Pega el identificador o la URL del estilo en el repositorio de Zotero.'), placeholder: 'casa-de-velazquez' }); if (!id) return; setBusy(true); try { const installed = await window.nodus.installGlobalLibraryRepositoryCitationStyle(id); await refreshStyles(); setStyle(installed.id); toast(t('Estilo CSL instalado.')); } catch (cause) { toast(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); } };
  return <div className="fixed inset-0 z-[90] grid place-items-center bg-black/70 p-5" role="dialog" aria-modal="true" data-testid="library-citation-export-dialog"><section className="card flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden"><header className="flex items-center gap-3 border-b border-neutral-800 px-5 py-4"><Icon name="quote" className="text-indigo-300" /><div className="flex-1"><h2 className="font-semibold">{t('Citas y exportación')}</h2><p className="text-xs text-neutral-500">{itemIds.length ? tx('{n} referencia(s) seleccionada(s)', { n: itemIds.length }) : t('Colección o búsqueda actual')}</p></div><button className="btn btn-ghost" onClick={onClose}><Icon name="x" /></button></header><div className="min-h-0 flex-1 overflow-y-auto"><div className="grid gap-5 p-5 sm:grid-cols-2"><section><div className="flex items-center justify-between"><h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{t('Copiar cita')}</h3><button className="text-[10px] text-indigo-300 hover:text-indigo-200" onClick={() => setStyleManagerOpen((value) => !value)}><Icon name="settings" size={11} /> {t('Gestionar estilos')}</button></div><select data-testid="library-citation-style" className="input mt-2 w-full" value={style} onChange={(event) => setStyle(event.target.value as LibraryCitationStyle)}>{styles.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}{entry.availableOffline ? '' : ` · ${t('se descargará')}`}</option>)}</select><div className="mt-2 grid grid-cols-2 gap-2"><select className="input w-full" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="bibliography">{t('Entrada bibliográfica')}</option><option value="citation">{t('Cita en el texto')}</option></select><select className="input w-full" value={locale} onChange={(event) => setLocale(event.target.value)} aria-label={t('Idioma de la cita')}><option value="es-ES">Español</option><option value="en-US">English</option><option value="fr-FR">Français</option><option value="de-DE">Deutsch</option><option value="nl-NL">Nederlands</option></select></div><button data-testid="copy-library-citation" className="btn btn-primary mt-3 w-full" disabled={busy || !targetIds.length} onClick={() => void copy()}>{busy ? <Spinner /> : <Icon name="copy" />} {t('Copiar')}</button>{preview && <pre className="mt-3 max-h-40 whitespace-pre-wrap rounded-xl bg-neutral-900 p-3 text-[10px] leading-5 text-neutral-400">{preview}</pre>}</section><section><h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{t('Exportar referencias')}</h3><select data-testid="library-export-format" className="input mt-2 w-full" value={format} onChange={(event) => setFormat(event.target.value as LibraryBibliographyFormat)}>{[['ris', 'RIS'], ['bibtex', 'BibTeX'], ['biblatex', 'BibLaTeX'], ['csl-json', 'CSL-JSON'], ['endnote-xml', 'EndNote XML'], ['zotero-rdf', 'Zotero RDF'], ['csv', 'CSV'], ['markdown', 'Markdown']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><p className="mt-3 text-xs leading-5 text-neutral-500">{t('Los campos desconocidos se conservan para poder volver a importar el archivo sin pérdidas.')}</p><button data-testid="export-library-bibliography" className="btn btn-secondary mt-3 w-full" disabled={busy} onClick={() => void exportFile()}><Icon name="download" /> {t('Exportar…')}</button></section></div>
      {styleManagerOpen && <section data-testid="library-citation-style-manager" className="border-t border-neutral-800 bg-neutral-950/25 p-5"><div className="flex flex-wrap items-center gap-2"><div className="relative min-w-56 flex-1"><Icon name="search" size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600" /><input data-testid="library-citation-style-search" className="input w-full pl-9" value={styleSearch} onChange={(event) => setStyleSearch(event.target.value)} placeholder={t('Buscar estilos instalados…')} /></div><button data-testid="import-library-csl" className="btn btn-secondary" disabled={busy} onClick={() => void runImport('file')}><Icon name="upload" />{t('Importar .csl')}</button><button data-testid="import-zotero-csl" className="btn btn-secondary" disabled={busy} onClick={() => void runImport('zotero')}><Icon name="library" />{t('Importar de Zotero')}</button><button data-testid="install-repository-csl" className="btn btn-secondary" disabled={busy} onClick={() => void installRepository()}><Icon name="download" />{t('Repositorio')}</button></div><p className="mt-3 text-[10px] leading-5 text-neutral-500">{t('Los estilos oficiales pertenecen al proyecto CSL y conservan su autoría y licencia CC BY-SA 3.0. Los estilos privados sin licencia permanecen sólo en tu nodus-library.')}</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{filteredStyles.map((entry) => <article key={`${entry.source}:${entry.id}`} className={`rounded-xl border p-3 ${style === entry.id ? 'border-indigo-500/40 bg-indigo-500/5' : 'border-neutral-800'}`}><button className="block w-full text-left" onClick={() => setStyle(entry.id)}><b className="block truncate text-xs">{entry.title}</b><span className="mt-1 block truncate font-mono text-[9px] text-neutral-600">{entry.id}</span><span className="mt-1 block text-[9px] text-neutral-500">{t(entry.source === 'bundled' ? 'Incluido' : entry.source === 'zotero' ? 'De Zotero' : entry.source === 'repository' ? 'Repositorio Zotero' : 'Archivo local')} · {entry.availableOffline ? t('Disponible sin conexión') : t('Descarga pendiente')}</span>{entry.warning && <span className="mt-2 block text-[9px] leading-4 text-amber-400">{t(entry.warning)}</span>}</button>{entry.removable && <button className="mt-2 text-[9px] text-red-400 hover:text-red-300" onClick={async () => { if (await window.nodus.removeGlobalLibraryCitationStyle(entry.id)) { await refreshStyles(); if (style === entry.id) setStyle('apa-7'); } }}><Icon name="trash" size={10} /> {t('Eliminar')}</button>}</article>)}</div></section>}
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
