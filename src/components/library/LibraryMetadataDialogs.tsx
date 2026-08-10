import { useEffect, useMemo, useState } from 'react';
import type {
  LibraryDuplicateGroup,
  LibraryItemMetadata,
  LibraryItemRecord,
  LibraryMetadataCandidate,
  LibraryMetadataIdentifierKind,
} from '@shared/libraryTypes';
import { confirm, toast } from '../feedback';
import { Icon, Spinner } from '../ui';
import { t, tx } from '../../i18n';

function authorText(metadata: LibraryItemMetadata): string {
  return metadata.creators.map((creator) => creator.name || [creator.lastName, creator.firstName].filter(Boolean).join(', ')).filter(Boolean).join('; ');
}

function metadataDraft(metadata: LibraryItemMetadata) {
  return {
    ...metadata,
    authors: authorText(metadata),
    isbnText: (metadata.isbn ?? []).join('; '), issnText: (metadata.issn ?? []).join('; '), tagsText: (metadata.tags ?? []).join(', '),
  };
}

const FIELD_LABELS: Array<[keyof LibraryItemMetadata, string]> = [
  ['title', 'Título'], ['creators', 'Autoría'], ['date', 'Fecha'], ['year', 'Año'], ['publicationTitle', 'Publicación'],
  ['publisher', 'Editorial'], ['volume', 'Volumen'], ['issue', 'Número'], ['pages', 'Páginas'], ['doi', 'DOI'],
  ['isbn', 'ISBN'], ['issn', 'ISSN'], ['language', 'Idioma'], ['abstract', 'Resumen'], ['tags', 'Etiquetas'],
];

function displayValue(metadata: LibraryItemMetadata, key: keyof LibraryItemMetadata): string {
  const value = key === 'creators' ? authorText(metadata) : metadata[key];
  return Array.isArray(value) ? value.join('; ') : value == null ? '' : String(value);
}

export function LibraryMetadataEditor({ item, onClose, onSaved }: {
  item: LibraryItemRecord; onClose: () => void; onSaved: (item: LibraryItemRecord) => void;
}) {
  const [draft, setDraft] = useState(() => metadataDraft(item.metadata));
  const initialKind: LibraryMetadataIdentifierKind = item.metadata.doi ? 'doi' : item.metadata.isbn?.[0] ? 'isbn' : 'issn';
  const [kind, setKind] = useState<LibraryMetadataIdentifierKind>(initialKind);
  const [lookupValue, setLookupValue] = useState(item.metadata[initialKind] instanceof Array ? item.metadata[initialKind]?.[0] ?? '' : String(item.metadata[initialKind] ?? ''));
  const [candidates, setCandidates] = useState<LibraryMetadataCandidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<LibraryMetadataCandidate | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [saving, setSaving] = useState(false);
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
    setDraft(metadataDraft(candidate.metadata)); setSelectedCandidate(candidate);
  };

  const save = async () => {
    if (!draft.title.trim()) return;
    setSaving(true); setError('');
    try {
      const creators = draft.authors.split(';').map((name) => name.trim()).filter(Boolean).map((name) => {
        const comma = /^([^,]+),\s*(.+)$/.exec(name);
        return comma ? { creatorType: 'author', firstName: comma[2], lastName: comma[1] } : { creatorType: 'author', name };
      });
      const saved = await window.nodus.updateGlobalLibraryItemMetadata(item.id, {
        title: draft.title.trim(), itemType: draft.itemType, creators, abstract: draft.abstract?.trim() || undefined,
        date: draft.date?.trim() || undefined, year: draft.year == null || !Number.isFinite(Number(draft.year)) ? null : Number(draft.year),
        language: draft.language?.trim() || undefined, publisher: draft.publisher?.trim() || undefined,
        publicationTitle: draft.publicationTitle?.trim() || undefined, volume: draft.volume?.trim() || undefined,
        issue: draft.issue?.trim() || undefined, pages: draft.pages?.trim() || undefined, edition: draft.edition?.trim() || undefined,
        place: draft.place?.trim() || undefined, rights: draft.rights?.trim() || undefined, url: draft.url?.trim() || undefined,
        doi: draft.doi?.trim() || undefined,
        isbn: draft.isbnText.split(/[;,]\s*/).map((value) => value.trim()).filter(Boolean),
        issn: draft.issnText.split(/[;,]\s*/).map((value) => value.trim()).filter(Boolean),
        tags: draft.tagsText.split(',').map((value) => value.trim()).filter(Boolean),
      });
      toast(t('Metadatos guardados.')); onSaved(saved); onClose();
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
          {input('title', 'Título', { wide: true })}{input('authors', 'Autoría', { wide: true })}
          <label className="block text-[10px] uppercase tracking-wider text-neutral-500">{t('Tipo')}<select className="input mt-1 w-full normal-case tracking-normal" value={draft.itemType} onChange={(event) => setDraft((current) => ({ ...current, itemType: event.target.value as LibraryItemMetadata['itemType'] }))}>{['article-journal', 'book', 'chapter', 'conference-paper', 'thesis', 'report', 'webpage', 'document', 'dataset', 'other'].map((value) => <option key={value}>{value}</option>)}</select></label>
          {input('year', 'Año', { type: 'number' })}{input('date', 'Fecha')}{input('language', 'Idioma')}{input('publicationTitle', 'Publicación', { wide: true })}{input('publisher', 'Editorial')}{input('place', 'Lugar')}{input('volume', 'Volumen')}{input('issue', 'Número')}{input('pages', 'Páginas')}{input('edition', 'Edición')}{input('doi', 'DOI', { wide: true })}{input('isbnText', 'ISBN', { wide: true })}{input('issnText', 'ISSN', { wide: true })}{input('url', 'URL', { wide: true })}{input('tagsText', 'Etiquetas', { wide: true })}{input('abstract', 'Resumen', { wide: true, textarea: true })}
        </div></div>
        <aside className="min-h-0 overflow-y-auto border-l border-neutral-800 bg-neutral-950/35 p-5">
          <h3 className="text-xs font-semibold">{t('Buscar por identificador')}</h3><p className="mt-1 text-[10px] leading-5 text-neutral-600">{t('Consulta Crossref para DOI/ISSN y Open Library para ISBN. Nada se aplica sin tu revisión.')}</p>
          <div className="mt-3 flex gap-2"><select className="input w-24 text-xs uppercase" value={kind} onChange={(event) => { const next = event.target.value as LibraryMetadataIdentifierKind; setKind(next); setLookupValue(next === 'doi' ? draft.doi ?? '' : next === 'isbn' ? draft.isbnText.split(';')[0] : draft.issnText.split(';')[0]); }}>{['doi', 'isbn', 'issn'].map((value) => <option key={value}>{value}</option>)}</select><input className="input min-w-0 flex-1" value={lookupValue} onChange={(event) => setLookupValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void lookup(); }} /><button className="btn btn-primary" disabled={lookingUp || !lookupValue.trim()} onClick={() => void lookup()}>{lookingUp ? <Spinner /> : <Icon name="search" />}</button></div>
          {error && <p role="alert" className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">{error}</p>}
          <div className="mt-4 space-y-2">{candidates.map((candidate) => <button key={candidate.id} className={`block w-full rounded-xl border p-3 text-left ${selectedCandidate?.id === candidate.id ? 'border-indigo-500 bg-indigo-500/10' : 'border-neutral-800 hover:border-neutral-700'}`} onClick={() => setSelectedCandidate(candidate)}><b className="line-clamp-2 text-xs">{candidate.metadata.title}</b><span className="mt-1 block text-[10px] text-neutral-500">{authorText(candidate.metadata) || '—'} · {candidate.metadata.year ?? '—'} · {candidate.source}</span><span className="mt-2 block text-[10px] text-indigo-300">{Math.round(candidate.confidence * 100)}% {t('coincidencia')}</span></button>)}</div>
          {selectedCandidate && <div className="mt-4"><div className="flex items-center justify-between"><h4 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{t('Vista previa de cambios')}</h4><button className="btn btn-secondary h-8 text-xs" onClick={() => applyCandidate(selectedCandidate)}>{t('Usar esta ficha')}</button></div><div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-neutral-800">{FIELD_LABELS.flatMap(([key, label]) => { const before = displayValue(item.metadata, key); const after = displayValue(selectedCandidate.metadata, key); return before === after || !after ? [] : [<div key={key} className="border-b border-neutral-800 p-2 last:border-0"><b className="text-[9px] uppercase tracking-wider text-neutral-600">{t(label)}</b><p className="mt-1 line-clamp-2 text-[10px] text-red-300/70">− {before || '—'}</p><p className="mt-1 line-clamp-2 text-[10px] text-emerald-300">+ {after}</p></div>]; })}</div></div>}
        </aside>
      </div>
      <footer className="flex items-center justify-end gap-2 border-t border-neutral-800 px-5 py-4"><button className="btn btn-ghost" onClick={onClose}>{t('Cancelar')}</button><button className="btn btn-primary" disabled={saving || !draft.title.trim()} onClick={() => void save()}>{saving ? <Spinner /> : <Icon name="save" />} {t('Guardar metadatos')}</button></footer>
    </section>
  </div>;
}

export function LibraryDuplicatesDialog({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [groups, setGroups] = useState<LibraryDuplicateGroup[]>([]); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState('');
  const canonicalDefaults = useMemo(() => Object.fromEntries(groups.map((group) => [group.key, group.items[0]?.id ?? ''])), [groups]);
  const [canonical, setCanonical] = useState<Record<string, string>>({});
  useEffect(() => { void window.nodus.listGlobalLibraryDuplicates().then((values) => { setGroups(values); setCanonical(Object.fromEntries(values.map((group) => [group.key, group.items[0]?.id ?? '']))); }).finally(() => setLoading(false)); }, []);
  const merge = async (group: LibraryDuplicateGroup) => {
    const id = canonical[group.key] || canonicalDefaults[group.key]; if (!id) return;
    if (!(await confirm({ title: t('Fusionar duplicados'), message: t('Se conservarán colecciones, adjuntos, Markdown y anotaciones en el documento elegido. Los demás pasarán a la papelera.'), danger: true, confirmLabel: t('Fusionar') }))) return;
    setBusy(group.key); try { await window.nodus.mergeGlobalLibraryItems(id, group.items.filter((item) => item.id !== id).map((item) => item.id)); setGroups((current) => current.filter((entry) => entry.key !== group.key)); onChanged(); toast(t('Duplicados fusionados.')); } finally { setBusy(''); }
  };
  return <div className="fixed inset-0 z-[85] grid place-items-center bg-black/70 p-5" role="dialog" aria-modal="true" data-testid="library-duplicates-dialog"><section className="card flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden"><header className="flex items-center gap-3 border-b border-neutral-800 px-5 py-4"><Icon name="copy" className="text-indigo-300" /><div className="flex-1"><h2 className="font-semibold">{t('Revisar duplicados')}</h2><p className="text-xs text-neutral-500">{tx('{n} grupos por DOI, ISBN o ficha coincidente', { n: groups.length })}</p></div><button className="btn btn-ghost" onClick={onClose}><Icon name="x" /></button></header><div className="min-h-0 flex-1 overflow-y-auto p-5">{loading ? <Spinner label={t('Buscando duplicados…')} /> : groups.length ? <div className="space-y-4">{groups.map((group) => <article key={group.key} className="rounded-xl border border-neutral-800 p-4"><h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{t('Coincidencia por')} {group.reason.toUpperCase()}</h3><div className="mt-3 space-y-2">{group.items.map((item) => <label key={item.id} className={`flex items-start gap-3 rounded-lg border p-3 ${canonical[group.key] === item.id ? 'border-indigo-500/50 bg-indigo-500/5' : 'border-neutral-800'}`}><input type="radio" name={group.key} checked={canonical[group.key] === item.id} onChange={() => setCanonical((current) => ({ ...current, [group.key]: item.id }))} /><span className="min-w-0 flex-1"><b className="block text-xs">{item.title}</b><span className="mt-1 block text-[10px] text-neutral-500">{item.source} · {item.year ?? '—'} · {item.attachmentCount} {t('adjuntos')}</span></span><span className="text-[10px] text-indigo-300">{canonical[group.key] === item.id ? t('Conservar') : ''}</span></label>)}</div><button className="btn btn-primary mt-3" disabled={busy === group.key} onClick={() => void merge(group)}>{busy === group.key ? <Spinner /> : <Icon name="merge" />} {t('Fusionar grupo')}</button></article>)}</div> : <p className="py-10 text-center text-sm text-neutral-500">{t('No se han detectado duplicados.')}</p>}</div></section></div>;
}
