import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  PrimarySourceNoteRelationKind,
  PrimarySourceAccessStatus,
  PrimarySourceNoteStatus,
  PrimarySourceNoteType,
  PrimarySourceNoteWorkspace,
  PrimarySourceResearchNote,
  PrimarySourceResearchNoteLink,
  PrimarySourceSearchResult,
  PrimarySourceSensitivity,
} from '@shared/primarySourcesTypes';
import { Markdown } from '../components/Markdown';
import { Icon } from '../components/ui';
import { t } from '../i18n';
import type { PrimarySourceOpenTarget } from './PrimarySourcesSearchView';

const EMPTY: PrimarySourceNoteWorkspace = { notes: [], collections: [], linkTargets: [] };

const TYPE_LABELS: Record<PrimarySourceNoteType, string> = {
  observation: 'Observación',
  question: 'Pregunta',
  hypothesis: 'Hipótesis',
  comparison: 'Comparación',
  task: 'Tarea',
  method_memo: 'Memo metodológico',
};

const STATUS_LABELS: Record<PrimarySourceNoteStatus, string> = {
  draft: 'Borrador',
  in_review: 'En revisión',
  stable: 'Estable',
  archived: 'Archivada',
};

const RELATION_LABELS: Record<PrimarySourceNoteRelationKind, string> = {
  references: 'Referencia',
  quotes: 'Cita literal',
  interprets: 'Interpreta',
  questions: 'Cuestiona',
  supports: 'Apoya',
  contradicts: 'Contradice',
};

export function PrimarySourcesNotesView({
  focusNote,
  onOpenSource,
}: {
  focusNote?: { id: string; nonce: number } | null;
  onOpenSource: (target: PrimarySourceOpenTarget) => void;
}) {
  const [workspace, setWorkspace] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [collectionFilter, setCollectionFilter] = useState('');
  const [linkQuery, setLinkQuery] = useState('');
  const [linkResults, setLinkResults] = useState<PrimarySourceSearchResult[]>([]);
  const [linkRelation, setLinkRelation] = useState<PrimarySourceNoteRelationKind>('references');
  const [message, setMessage] = useState<string | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const reload = useCallback(async () => {
    const next = await window.nodus.getPrimarySourceNoteWorkspace();
    setWorkspace(next);
    return next;
  }, []);

  useEffect(() => {
    void reload().finally(() => setLoading(false));
  }, [reload]);

  const active = useMemo(
    () => workspace.notes.find((note) => note.id === activeId) ?? null,
    [activeId, workspace.notes]
  );
  const visible = useMemo(() => workspace.notes.filter((note) => {
    const text = `${note.title}\n${note.content}`.toLocaleLowerCase();
    return (!query.trim() || text.includes(query.trim().toLocaleLowerCase()))
      && (!typeFilter || note.profile.noteType === typeFilter)
      && (!statusFilter || note.profile.status === statusFilter)
      && (!collectionFilter || note.profile.collection === collectionFilter);
  }), [collectionFilter, query, statusFilter, typeFilter, workspace.notes]);

  const openNote = useCallback((note: PrimarySourceResearchNote) => {
    setActiveId(note.id);
    setTitle(note.title);
    setContent(note.content);
    setDirty(false);
    setMessage(null);
  }, []);

  useEffect(() => {
    if (!focusNote) return;
    const note = workspace.notes.find((candidate) => candidate.id === focusNote.id);
    if (note) openNote(note);
  }, [focusNote, openNote, workspace.notes]);

  useEffect(() => {
    if (!dirty || !activeId) return;
    const timer = window.setTimeout(() => {
      void window.nodus.updateNote({ id: activeId, title, content }).then((saved) => {
        if (!saved) return;
        setWorkspace((current) => ({
          ...current,
          notes: current.notes.map((note) => note.id === saved.id ? { ...note, ...saved } : note),
        }));
        setDirty(false);
      });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [activeId, content, dirty, title]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (linkQuery.trim().length < 2) {
        setLinkResults([]);
        return;
      }
      void window.nodus.searchPrimarySourceCorpus({
        query: linkQuery,
        limit: 30,
        allowPrivateContent: false,
        allowRestrictedContent: false,
      }).then((response) => setLinkResults(
        response.results.filter((result) => result.targetKind !== 'note')
      ));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [linkQuery]);

  const create = async () => {
    const note = await window.nodus.createPrimarySourceNote({
      title: t('Nota sin título'),
      noteType: 'observation',
      status: 'draft',
    });
    await reload();
    openNote(note);
  };

  const updateProfile = async (
    patch: Parameters<typeof window.nodus.updatePrimarySourceNoteProfile>[1]
  ) => {
    if (!activeId) return;
    const profile = await window.nodus.updatePrimarySourceNoteProfile(activeId, patch);
    setWorkspace((current) => ({
      ...current,
      collections: patch.collection
        ? [...new Set([...current.collections, patch.collection])].sort()
        : current.collections,
      notes: current.notes.map((note) => note.id === activeId ? { ...note, profile } : note),
    }));
  };

  const addLink = async (result: PrimarySourceSearchResult, citation: boolean) => {
    if (!activeId) return;
    if (citation && !result.excerptId) {
      setMessage(t('Solo un fragmento exacto puede insertarse como cita literal.'));
      return;
    }
    if (citation) {
      const insertion = await window.nodus.insertPrimarySourceExcerptCitation({
        noteId: activeId,
        targetKind: result.targetKind,
        targetId: result.targetId,
        excerptId: result.excerptId,
      });
      const textarea = editorRef.current;
      const start = textarea?.selectionStart ?? content.length;
      const end = textarea?.selectionEnd ?? start;
      const spacing = start > 0 && !content.slice(0, start).endsWith('\n\n') ? '\n\n' : '';
      const next = `${content.slice(0, start)}${spacing}${insertion.markdown}\n\n${content.slice(end)}`;
      setContent(next);
      setDirty(true);
      setMessage(t('Cita literal insertada con enlace al fragmento exacto.'));
    } else {
      await window.nodus.addPrimarySourceNoteLink({
        noteId: activeId,
        targetKind: result.targetKind,
        targetId: result.targetId,
        excerptId: result.excerptId,
        relationKind: linkRelation,
      });
      setMessage(t('Enlace documental añadido.'));
    }
    await reload();
  };

  const removeLink = async (linkId: string) => {
    await window.nodus.removePrimarySourceNoteLink(linkId);
    await reload();
  };

  const deleteActive = async () => {
    if (!active || !window.confirm(t('¿Eliminar esta nota? Los enlaces se quitarán, pero las fuentes no se modificarán.'))) return;
    await window.nodus.deleteNote(active.id);
    setActiveId(null);
    setTitle('');
    setContent('');
    await reload();
  };

  const openLink = (link: PrimarySourceResearchNoteLink) => {
    if (!link.itemId) return;
    onOpenSource({ itemId: link.itemId, excerptId: link.excerptId });
  };

  if (loading) return <div className="grid h-full place-items-center bg-neutral-50 text-sm text-neutral-500 dark:bg-neutral-950"><Icon name="sync" className="animate-spin" /></div>;

  return (
    <div className="grid h-full min-h-0 grid-cols-1 bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100 lg:grid-cols-[280px_minmax(0,1fr)_320px]" data-testid="primary-sources-notes">
      <aside className="min-h-0 overflow-y-auto border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div className="sticky top-0 z-10 border-b border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-center justify-between">
            <h1 className="font-semibold">{t('Notas')}</h1>
            <button className="btn btn-primary h-8 gap-1 px-2 text-[10px]" onClick={() => void create()}><Icon name="plus" size={12} />{t('Nueva')}</button>
          </div>
          <div className="relative mt-3">
            <Icon name="search" size={13} className="absolute left-2.5 top-2.5 text-neutral-400" />
            <input className="input h-8 w-full pl-8 text-[11px]" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Buscar notas…')} />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <select className="input h-8 px-2 text-[10px]" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
              <option value="">{t('Todos los tipos')}</option>
              {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
            </select>
            <select className="input h-8 px-2 text-[10px]" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">{t('Todos los estados')}</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
            </select>
          </div>
          {workspace.collections.length > 0 && (
            <select className="input mt-2 h-8 w-full px-2 text-[10px]" value={collectionFilter} onChange={(event) => setCollectionFilter(event.target.value)}>
              <option value="">{t('Todas las colecciones')}</option>
              {workspace.collections.map((collection) => <option key={collection}>{collection}</option>)}
            </select>
          )}
        </div>
        <div className="space-y-1 p-2">
          {visible.map((note) => (
            <button key={note.id} className={`w-full rounded-lg border p-3 text-left ${activeId === note.id ? 'border-indigo-300 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-950/40' : 'border-transparent hover:bg-neutral-100 dark:hover:bg-neutral-800'}`} onClick={() => openNote(note)}>
              <span className="block truncate text-xs font-semibold">{note.title}</span>
              <span className="mt-1 flex items-center gap-1 text-[9px] text-neutral-500">
                {t(TYPE_LABELS[note.profile.noteType])} · {t(STATUS_LABELS[note.profile.status])}
                {note.links.length > 0 && <> · {note.links.length} {t('fuentes')}</>}
                {note.backlinkCount > 0 && <> · {note.backlinkCount} {t('backlinks')}</>}
              </span>
              {note.profile.collection && <span className="mt-1 block truncate text-[9px] text-indigo-600 dark:text-indigo-300">{note.profile.collection}</span>}
            </button>
          ))}
          {visible.length === 0 && <p className="p-6 text-center text-xs text-neutral-500">{t('No hay notas con estos filtros.')}</p>}
        </div>
      </aside>

      <main className="min-h-0 min-w-0 overflow-hidden">
        {!active ? (
          <div className="grid h-full place-items-center p-8 text-center">
            <div>
              <Icon name="notebook" className="mx-auto text-indigo-500" size={30} />
              <h2 className="mt-4 font-semibold">{t('Interpretación separada de la fuente')}</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-neutral-500">{t('Crea una nota, enlaza entidades o fragmentos y conserva siempre visible qué es cita literal y qué es comentario.')}</p>
              <button className="btn btn-primary mt-4 gap-2" onClick={() => void create()}><Icon name="plus" />{t('Crear primera nota')}</button>
            </div>
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            <header className="shrink-0 border-b border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="flex items-center gap-2">
                <input className="min-w-0 flex-1 border-0 bg-transparent text-base font-semibold outline-none" value={title} onChange={(event) => { setTitle(event.target.value); setDirty(true); }} />
                <span className="text-[9px] text-neutral-400">{dirty ? t('Guardando…') : t('Guardada')}</span>
                <button className="btn btn-ghost h-8 px-2 text-[10px] text-red-500" onClick={() => void deleteActive()}>{t('Eliminar')}</button>
                <div className="flex rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800">
                  <button className={`rounded-md px-2 py-1 text-[10px] ${mode === 'edit' ? 'bg-white shadow-sm dark:bg-neutral-700' : ''}`} onClick={() => setMode('edit')}>{t('Editar')}</button>
                  <button className={`rounded-md px-2 py-1 text-[10px] ${mode === 'preview' ? 'bg-white shadow-sm dark:bg-neutral-700' : ''}`} onClick={() => setMode('preview')}>{t('Vista previa')}</button>
                </div>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-5">
                <select className="input h-8 px-2 text-[10px]" value={active.profile.noteType} onChange={(event) => void updateProfile({ noteType: event.target.value as PrimarySourceNoteType })}>
                  {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
                </select>
                <select className="input h-8 px-2 text-[10px]" value={active.profile.status} onChange={(event) => void updateProfile({ status: event.target.value as PrimarySourceNoteStatus })}>
                  {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
                </select>
                <input className="input h-8 px-2 text-[10px]" value={active.profile.collection ?? ''} onChange={(event) => void updateProfile({ collection: event.target.value })} placeholder={t('Colección')} list="primary-note-collections" />
                <select className="input h-8 px-2 text-[10px]" value={active.profile.accessStatus} onChange={(event) => void updateProfile({ accessStatus: event.target.value as PrimarySourceAccessStatus })} aria-label={t('Acceso de la nota')}>
                  <option value="open">{t('Abierta')}</option>
                  <option value="private">{t('Privada')}</option>
                  <option value="restricted">{t('Restringida')}</option>
                  <option value="embargoed">{t('Embargada')}</option>
                  <option value="unknown">{t('Desconocida')}</option>
                </select>
                <select className="input h-8 px-2 text-[10px]" value={active.profile.sensitivity} onChange={(event) => void updateProfile({ sensitivity: event.target.value as PrimarySourceSensitivity })} aria-label={t('Sensibilidad de la nota')}>
                  <option value="normal">{t('Normal')}</option>
                  <option value="personal">{t('Personal')}</option>
                  <option value="sensitive">{t('Sensible')}</option>
                  <option value="highly_sensitive">{t('Altamente sensible')}</option>
                </select>
                <datalist id="primary-note-collections">{workspace.collections.map((collection) => <option key={collection} value={collection} />)}</datalist>
              </div>
            </header>
            {message && <p className="shrink-0 border-b border-indigo-200 bg-indigo-50 px-4 py-2 text-[10px] text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200">{message}</p>}
            {mode === 'edit' ? (
              <textarea ref={editorRef} className="min-h-0 flex-1 resize-none border-0 bg-white p-6 font-mono text-sm leading-7 outline-none dark:bg-neutral-950" value={content} onChange={(event) => { setContent(event.target.value); setDirty(true); }} placeholder={t('Escribe en Markdown. Inserta citas desde el panel de fuentes enlazadas.')} />
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto bg-white p-6 dark:bg-neutral-950">
                <Markdown content={content || `_${t('Nota vacía')}_`} verify={false} />
              </div>
            )}
          </div>
        )}
      </main>

      <aside className="hidden min-h-0 overflow-y-auto border-l border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 lg:block">
        <div className="border-b border-neutral-200 p-4 dark:border-neutral-800">
          <h2 className="text-xs font-semibold">{t('Fuentes enlazadas')}</h2>
          <p className="mt-1 text-[10px] leading-4 text-neutral-500">{t('Los enlaces tipados no convierten la nota en un hecho. Una cita literal conserva su instantánea y su localizador.')}</p>
        </div>
        {active && (
          <>
            <div className="space-y-2 p-3">
              {active.links.map((link) => (
                <article key={link.linkId} className={`rounded-lg border p-3 ${link.citationChanged ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/20' : 'border-neutral-200 dark:border-neutral-800'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <button className="min-w-0 text-left text-[11px] font-semibold hover:text-indigo-600 dark:hover:text-indigo-300" onClick={() => openLink(link)}>{link.targetLabel}</button>
                    <button aria-label={t('Quitar enlace')} className="text-neutral-400 hover:text-red-500" onClick={() => void removeLink(link.linkId)}><Icon name="x" size={12} /></button>
                  </div>
                  <p className="mt-1 text-[9px] text-neutral-500">{t(RELATION_LABELS[link.relationKind])}{link.locator ? ` · ${link.locator}` : ''}</p>
                  {link.quote && <p className="mt-2 line-clamp-4 border-l-2 border-indigo-300 pl-2 text-[10px] leading-4 text-neutral-600 dark:text-neutral-400">“{link.quote}”</p>}
                  {link.citationChanged && <p className="mt-2 text-[9px] font-medium text-amber-700 dark:text-amber-300">{t('La fuente o el texto cambió desde que se insertó esta cita. Revisa la instantánea antes de actualizarla.')}</p>}
                </article>
              ))}
              {active.links.length === 0 && <p className="py-4 text-center text-[10px] text-neutral-500">{t('Todavía no hay fuentes enlazadas.')}</p>}
            </div>
            <div className="border-t border-neutral-200 p-3 dark:border-neutral-800">
              <label className="text-[10px] font-medium text-neutral-500">{t('Buscar una fuente o entidad')}</label>
              <input className="input mt-1 h-8 w-full px-2 text-[10px]" value={linkQuery} onChange={(event) => setLinkQuery(event.target.value)} placeholder={t('Título, frase, persona, lugar…')} />
              <select className="input mt-2 h-8 w-full px-2 text-[10px]" value={linkRelation} onChange={(event) => setLinkRelation(event.target.value as PrimarySourceNoteRelationKind)}>
                {Object.entries(RELATION_LABELS).filter(([value]) => value !== 'quotes').map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
              </select>
              <div className="mt-2 max-h-80 space-y-1 overflow-y-auto">
                {linkResults.map((result) => (
                  <article key={result.resultId} className="rounded-lg border border-neutral-200 p-2 dark:border-neutral-800">
                    <p className="truncate text-[10px] font-medium">{result.title}</p>
                    <p className="mt-1 line-clamp-2 text-[9px] leading-4 text-neutral-500">{result.matchText}</p>
                    <div className="mt-2 flex gap-1">
                      <button className="btn btn-ghost h-7 flex-1 px-1 text-[9px]" onClick={() => void addLink(result, false)}>{t('Enlazar')}</button>
                      {result.excerptId && <button className="btn btn-secondary h-7 flex-1 px-1 text-[9px]" onClick={() => void addLink(result, true)}>{t('Insertar cita')}</button>}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
