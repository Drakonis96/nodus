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
import { ConfirmModal } from '../components/ConfirmModal';
import { WorkspaceTabStrip } from '../components/library/LibraryWorkspaceTabs';
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
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [pendingDelete, setPendingDelete] = useState<PrimarySourceResearchNote | null>(null);
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
    setOpenIds((current) => current.includes(note.id) ? current : [...current, note.id]);
    setActiveId(note.id);
    setTitle(note.title);
    setContent(note.content);
    setDirty(false);
    setMessage(null);
  }, []);

  const closeNote = (id: string) => {
    setOpenIds((current) => current.filter((candidate) => candidate !== id));
    setActiveId((current) => {
      if (current !== id) return current;
      return openIds.filter((candidate) => candidate !== id).at(-1) ?? null;
    });
  };

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
    if (!pendingDelete) return;
    await window.nodus.deleteNote(pendingDelete.id);
    closeNote(pendingDelete.id);
    setPendingDelete(null);
    setTitle('');
    setContent('');
    await reload();
  };

  const openLink = (link: PrimarySourceResearchNoteLink) => {
    if (!link.itemId) return;
    onOpenSource({ itemId: link.itemId, excerptId: link.excerptId });
  };

  if (loading) return <div className="library-theme-canvas grid h-full place-items-center text-sm text-neutral-500"><Icon name="sync" className="animate-spin" /></div>;

  const openTabs = openIds
    .map((id) => workspace.notes.find((note) => note.id === id))
    .filter((note): note is PrimarySourceResearchNote => Boolean(note));

  const browser = (
    <div className="library-theme-canvas flex h-full min-h-0 flex-col bg-neutral-950">
      <header data-testid="primary-sources-notes-header" className="library-header-bar min-h-14 shrink-0 border-b border-neutral-800 px-5 py-3">
        <div className="library-header-title min-w-0">
          <h1 className="flex items-center gap-2 text-lg font-semibold"><Icon name="notebook" className="text-indigo-400" />{t('Notas')}</h1>
          <p className="text-[11px] text-neutral-500">{workspace.notes.length} {t('Notas').toLocaleLowerCase()} · {workspace.collections.length} {t('Colecciones').toLocaleLowerCase()}</p>
        </div>
        <div className="library-header-actions">
          <button data-testid="primary-sources-create-note" className="btn btn-primary h-8 gap-1 px-3 text-xs" onClick={() => void create()}><Icon name="notebook" size={13} />{t('Nota')}</button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="library-theme-panel hidden w-[238px] shrink-0 flex-col border-r border-neutral-800 bg-neutral-950/80 lg:flex">
          <div className="px-3 py-3"><b className="text-[11px] uppercase tracking-wider text-neutral-500">{t('Colecciones')}</b></div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            <button
              data-testid="primary-sources-notes-all"
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${!collectionFilter ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-900'}`}
              onClick={() => setCollectionFilter('')}
            ><Icon name="library" size={14} /><span className="flex-1">{t('Todo')}</span><span className="text-[10px] opacity-60">{workspace.notes.length}</span></button>
            <div className="mt-1 space-y-0.5">
              {workspace.collections.map((collection) => (
                <button
                  key={collection}
                  data-testid={`primary-sources-note-collection-${collection}`}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${collectionFilter === collection ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-900'}`}
                  onClick={() => setCollectionFilter(collection)}
                ><Icon name="folder" size={13} /><span className="min-w-0 flex-1 truncate">{collection}</span><span className="text-[10px] opacity-60">{workspace.notes.filter((note) => note.profile.collection === collection).length}</span></button>
              ))}
            </div>
            {workspace.collections.length === 0 && <p className="px-3 py-4 text-xs leading-5 text-neutral-600">{t('Agrupa tus notas e ideas en colecciones para trabajar por temas o capítulos.')}</p>}
          </div>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-3 py-2">
            <div className="relative min-w-48 flex-1">
              <Icon name="search" size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" />
              <input data-testid="primary-sources-notes-search" className="input input-with-leading-icon h-8 w-full text-xs" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Buscar notas…')} />
            </div>
            <select data-testid="primary-sources-notes-type-filter" className="input h-8 w-40 px-2 text-xs" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
              <option value="">{t('Todos los tipos')}</option>
              {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
            </select>
            <select data-testid="primary-sources-notes-status-filter" className="input h-8 w-40 px-2 text-xs" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">{t('Todos los estados')}</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
            </select>
          </div>
          <div data-testid="primary-sources-notes-list" className="library-catalog-scroll min-h-0 flex-1 overflow-y-auto">
            {visible.map((note) => (
              <button key={note.id} data-testid={`primary-sources-note-${note.id}`} className={`flex w-full items-start gap-3 border-b border-neutral-900 px-4 py-3 text-left hover:bg-neutral-900/60 ${openIds.includes(note.id) ? 'bg-neutral-900/40' : ''}`} onClick={() => openNote(note)}>
                <Icon name="notebook" size={14} className="mt-0.5 shrink-0 text-neutral-500" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{note.title}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-neutral-500">{t(TYPE_LABELS[note.profile.noteType])} · {t(STATUS_LABELS[note.profile.status])}{note.profile.collection ? ` · ${note.profile.collection}` : ''}</span>
                </span>
                {(note.links.length > 0 || note.backlinkCount > 0) && <span className="mt-0.5 shrink-0 text-[10px] text-neutral-500">{note.links.length} {t('fuentes')} · {note.backlinkCount} {t('backlinks')}</span>}
              </button>
            ))}
            {visible.length === 0 && <p className="px-4 py-6 text-xs text-neutral-500">{t('No hay notas con estos filtros.')}</p>}
          </div>
        </section>
      </div>
    </div>
  );

  const editorPane = active && (
    <div className="flex min-h-0 flex-1">
      <main className="library-theme-canvas flex min-h-0 min-w-0 flex-1 flex-col bg-neutral-950">
        <header className="library-theme-panel shrink-0 border-b border-neutral-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <input className="min-w-0 flex-1 border-0 bg-transparent text-base font-semibold outline-none" value={title} onChange={(event) => { setTitle(event.target.value); setDirty(true); }} />
            <span className="text-[9px] text-neutral-500">{dirty ? t('Guardando…') : t('Guardada')}</span>
            <button className="btn btn-ghost h-8 px-2 text-[10px] text-red-500" onClick={() => setPendingDelete(active)}>{t('Eliminar')}</button>
            <div className="flex rounded-lg bg-neutral-900 p-0.5">
              <button className={`rounded-md px-2 py-1 text-[10px] ${mode === 'edit' ? 'bg-neutral-800 shadow-sm' : ''}`} onClick={() => setMode('edit')}>{t('Editar')}</button>
              <button className={`rounded-md px-2 py-1 text-[10px] ${mode === 'preview' ? 'bg-neutral-800 shadow-sm' : ''}`} onClick={() => setMode('preview')}>{t('Vista previa')}</button>
            </div>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-5">
            <select className="input h-8 px-2 text-[10px]" value={active.profile.noteType} onChange={(event) => void updateProfile({ noteType: event.target.value as PrimarySourceNoteType })}>{Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select>
            <select className="input h-8 px-2 text-[10px]" value={active.profile.status} onChange={(event) => void updateProfile({ status: event.target.value as PrimarySourceNoteStatus })}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select>
            <input className="input h-8 px-2 text-[10px]" value={active.profile.collection ?? ''} onChange={(event) => void updateProfile({ collection: event.target.value })} placeholder={t('Colección')} list="primary-note-collections" />
            <select className="input h-8 px-2 text-[10px]" value={active.profile.accessStatus} onChange={(event) => void updateProfile({ accessStatus: event.target.value as PrimarySourceAccessStatus })} aria-label={t('Acceso de la nota')}><option value="open">{t('Abierta')}</option><option value="private">{t('Privada')}</option><option value="restricted">{t('Restringida')}</option><option value="embargoed">{t('Embargada')}</option><option value="unknown">{t('Desconocida')}</option></select>
            <select className="input h-8 px-2 text-[10px]" value={active.profile.sensitivity} onChange={(event) => void updateProfile({ sensitivity: event.target.value as PrimarySourceSensitivity })} aria-label={t('Sensibilidad de la nota')}><option value="normal">{t('Normal')}</option><option value="personal">{t('Personal')}</option><option value="sensitive">{t('Sensible')}</option><option value="highly_sensitive">{t('Altamente sensible')}</option></select>
            <datalist id="primary-note-collections">{workspace.collections.map((collection) => <option key={collection} value={collection} />)}</datalist>
          </div>
        </header>
        {message && <p className="shrink-0 border-b border-indigo-900 bg-indigo-950/40 px-4 py-2 text-[10px] text-indigo-200">{message}</p>}
        {mode === 'edit' ? (
          <textarea ref={editorRef} className="min-h-0 flex-1 resize-none border-0 bg-white p-6 font-mono text-sm leading-7 text-neutral-900 outline-none dark:bg-neutral-950 dark:text-neutral-100" value={content} onChange={(event) => { setContent(event.target.value); setDirty(true); }} placeholder={t('Escribe en Markdown. Inserta citas desde el panel de fuentes enlazadas.')} />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto bg-white p-6 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100"><Markdown content={content || `_${t('Nota vacía')}_`} verify={false} /></div>
        )}
      </main>

      <aside className="library-theme-panel hidden w-[320px] shrink-0 overflow-y-auto border-l border-neutral-800 bg-neutral-950/80 xl:block">
        <div className="border-b border-neutral-800 p-4">
          <h2 className="text-xs font-semibold">{t('Fuentes enlazadas')}</h2>
          <p className="mt-1 text-[10px] leading-4 text-neutral-500">{t('Los enlaces tipados no convierten la nota en un hecho. Una cita literal conserva su instantánea y su localizador.')}</p>
        </div>
        <div className="space-y-2 p-3">
          {active.links.map((link) => (
            <article key={link.linkId} className={`rounded-lg border p-3 ${link.citationChanged ? 'border-amber-400 bg-amber-950/20' : 'border-neutral-800'}`}>
              <div className="flex items-start justify-between gap-2"><button className="min-w-0 text-left text-[11px] font-semibold hover:text-indigo-300" onClick={() => openLink(link)}>{link.targetLabel}</button><button aria-label={t('Quitar enlace')} className="text-neutral-500 hover:text-red-500" onClick={() => void removeLink(link.linkId)}><Icon name="x" size={12} /></button></div>
              <p className="mt-1 text-[9px] text-neutral-500">{t(RELATION_LABELS[link.relationKind])}{link.locator ? ` · ${link.locator}` : ''}</p>
              {link.quote && <p className="mt-2 line-clamp-4 border-l-2 border-indigo-500 pl-2 text-[10px] leading-4 text-neutral-400">“{link.quote}”</p>}
              {link.citationChanged && <p className="mt-2 text-[9px] font-medium text-amber-300">{t('La fuente o el texto cambió desde que se insertó esta cita. Revisa la instantánea antes de actualizarla.')}</p>}
            </article>
          ))}
          {active.links.length === 0 && <p className="py-4 text-center text-[10px] text-neutral-500">{t('Todavía no hay fuentes enlazadas.')}</p>}
        </div>
        <div className="border-t border-neutral-800 p-3">
          <label className="text-[10px] font-medium text-neutral-500">{t('Buscar una fuente o entidad')}</label>
          <input className="input mt-1 h-8 w-full px-2 text-[10px]" value={linkQuery} onChange={(event) => setLinkQuery(event.target.value)} placeholder={t('Título, frase, persona, lugar…')} />
          <select className="input mt-2 h-8 w-full px-2 text-[10px]" value={linkRelation} onChange={(event) => setLinkRelation(event.target.value as PrimarySourceNoteRelationKind)}>{Object.entries(RELATION_LABELS).filter(([value]) => value !== 'quotes').map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select>
          <div className="mt-2 max-h-80 space-y-1 overflow-y-auto">
            {linkResults.map((result) => (
              <article key={result.resultId} className="rounded-lg border border-neutral-800 p-2"><p className="truncate text-[10px] font-medium">{result.title}</p><p className="mt-1 line-clamp-2 text-[9px] leading-4 text-neutral-500">{result.matchText}</p><div className="mt-2 flex gap-1"><button className="btn btn-ghost h-7 flex-1 px-1 text-[9px]" onClick={() => void addLink(result, false)}>{t('Enlazar')}</button>{result.excerptId && <button className="btn btn-secondary h-7 flex-1 px-1 text-[9px]" onClick={() => void addLink(result, true)}>{t('Insertar cita')}</button>}</div></article>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );

  return (
    <div data-testid="primary-sources-notes" className="library-theme flex h-full min-h-0 flex-col">
      <WorkspaceTabStrip
        homeLabel={t('Notas')}
        homeIcon="notebook"
        homeTestId="primary-sources-notes-tab-home"
        tabTestId={(tab) => `primary-sources-notes-tab-${tab.key}`}
        closeTestId={(tab) => `primary-sources-notes-tab-close-${tab.key}`}
        tabs={openTabs.map((note) => ({ key: note.id, title: note.title, icon: 'notebook' }))}
        activeKey={active?.id ?? null}
        onActivateHome={() => setActiveId(null)}
        onActivateTab={(id) => {
          const note = workspace.notes.find((candidate) => candidate.id === id);
          if (note) openNote(note);
        }}
        onCloseTab={closeNote}
      />
      <div className={`min-h-0 flex-1 overflow-hidden ${active ? 'hidden' : ''}`} aria-hidden={active ? true : undefined}>{browser}</div>
      {editorPane}
      {pendingDelete && <ConfirmModal title={t('Eliminar nota')} message={t('¿Eliminar esta nota? Los enlaces se quitarán, pero las fuentes no se modificarán.')} confirmLabel={t('Eliminar')} danger onConfirm={() => void deleteActive()} onCancel={() => setPendingDelete(null)} />}
    </div>
  );
}
