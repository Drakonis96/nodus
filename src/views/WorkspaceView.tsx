// El espacio de trabajo de la bóveda académica: notas, ideas y colecciones en una sola
// vista, y el mismo editor que ya usan Estudio y Docencia.
//
// Antes eran tres secciones —Notas, Escritura y Proyectos— que se contaban la misma
// historia por separado: un proyecto era una carpeta de notas con otro nombre, y un
// documento guardado de Escritura era una nota que no se podía editar. Aquí hay una sola
// estructura: COLECCIONES que contienen NOTAS e IDEAS.
//
// La forma es deliberadamente la de la Biblioteca, hasta reutilizar su tira de pestañas,
// su cabecera y sus paneles: las dos vistas hacen lo mismo —recorrer una colección de
// cosas y abrir varias a la vez— y aprenderlas dos veces no aportaba nada.
//
// El almacén es el árbol de notas de siempre (`note_folders` + `notes`), así que todo lo
// que ya colgaba de él —búsqueda global, embeddings, MCP, copias, sincronización— sigue
// funcionando sin enterarse de que la vista cambió.

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppSettings, Note, NoteFolder, NotesTree, WorkspaceLibraryLink } from '@shared/types';
import { MANUAL_IDEA_MARKER } from '@shared/types';
import type { LibraryScope } from '@shared/libraryTypes';
import { Icon, Spinner } from '../components/ui';
import { ConfirmModal } from '../components/ConfirmModal';
import { TextInputModal } from '../components/TextInputModal';
import { WorkspaceTabStrip } from '../components/library/LibraryWorkspaceTabs';
import { noteAsEditorDocument, workspaceNotePort } from '../components/editor/documentPort';
import type { PendingGraphNavigationTarget } from '../navigation';
import { t, tx } from '../i18n';

const StudyEditor = lazy(() => import('../components/editor/StudyEditor').then((module) => ({ default: module.StudyEditor })));

/** Lo que se puede crear aquí. Una idea es una nota que además vive en el grafo. */
type WorkspaceItemKind = 'note' | 'idea';

type Scope = { kind: 'all' } | { kind: 'unfiled' } | { kind: 'collection'; id: string };

const KIND_ICON: Record<WorkspaceItemKind, string> = { note: 'notebook', idea: 'bulb' };

/** Una nota es una idea cuando la escribió el usuario COMO idea y vive en el grafo. */
function itemKind(note: Note): WorkspaceItemKind {
  return note.kind === 'idea' || note.source?.note === MANUAL_IDEA_MARKER ? 'idea' : 'note';
}

function collectionChildren(collections: NoteFolder[]): Map<string | null, NoteFolder[]> {
  const map = new Map<string | null, NoteFolder[]>();
  for (const collection of collections) {
    const bucket = map.get(collection.parentId) ?? [];
    bucket.push(collection);
    map.set(collection.parentId, bucket);
  }
  for (const bucket of map.values()) {
    bucket.sort((a, b) => a.orderIdx - b.orderIdx || a.name.localeCompare(b.name));
  }
  return map;
}

/** Una colección y todo lo que cuelga de ella: lo que se ve al seleccionarla. */
function subtreeIds(collectionId: string, children: Map<string | null, NoteFolder[]>): Set<string> {
  const ids = new Set<string>([collectionId]);
  const pending = [collectionId];
  while (pending.length) {
    for (const child of children.get(pending.pop()!) ?? []) {
      if (ids.has(child.id)) continue;
      ids.add(child.id);
      pending.push(child.id);
    }
  }
  return ids;
}

function formatRelative(iso: string): string {
  const value = new Date(iso).getTime();
  if (!Number.isFinite(value)) return '';
  const minutes = Math.round((Date.now() - value) / 60000);
  if (minutes < 1) return t('ahora');
  if (minutes < 60) return tx('hace {n} min', { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return tx('hace {n} h', { n: hours });
  return new Date(iso).toLocaleDateString();
}

function plainSnippet(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

// ─────────────────────────────────────────────────────────────────────────────
// Enlaces con la biblioteca
// ─────────────────────────────────────────────────────────────────────────────

interface LibraryCandidate {
  id: string;
  title: string;
  subtitle: string;
  scope: LibraryScope;
}

/**
 * Buscador de elementos de la biblioteca, en sus dos ámbitos a la vez.
 *
 * La biblioteca global y la de la bóveda son dos almacenes distintos con dos
 * identificadores distintos, y una nota puede querer citar de cualquiera de los dos. En
 * vez de obligar a elegir ámbito antes de buscar —que es pedir que se sepa la respuesta
 * antes de la pregunta— se consultan los dos y cada resultado dice de dónde viene.
 */
function LibraryLinkPicker({ onClose, onPick }: { onClose: () => void; onPick: (candidate: LibraryCandidate) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LibraryCandidate[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const [vault, global] = await Promise.all([
          window.nodus.listWorksPage({ search: query.trim() || undefined }, { offset: 0, limit: 25 }).catch(() => null),
          window.nodus.listGlobalLibraryItems({ search: query.trim() || undefined, limit: 25, includeFacets: false }).catch(() => null),
        ]);
        if (!alive) return;
        setResults([
          ...(vault?.items ?? []).map((work) => ({
            id: work.nodus_id,
            title: work.title ?? t('Sin título'),
            subtitle: [work.authors.join('; '), work.year ?? ''].filter(Boolean).join(' · '),
            scope: 'vault' as const,
          })),
          ...(global?.items ?? []).map((item) => ({
            id: item.id,
            title: item.title || t('Sin título'),
            subtitle: [item.creators.map((creator) => creator.lastName ?? creator.name ?? '').filter(Boolean).join('; '), item.year ?? ''].filter(Boolean).join(' · '),
            scope: 'global' as const,
          })),
        ]);
      } finally {
        if (alive) setLoading(false);
      }
    }, 220);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [query]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={t('Enlazar con la biblioteca')}>
      <div data-testid="workspace-library-picker" className="flex max-h-[70vh] w-full max-w-xl flex-col rounded-2xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <Icon name="library" size={15} />
          <b className="flex-1 text-sm">{t('Enlazar con la biblioteca')}</b>
          <button className="btn btn-ghost h-8 w-8 p-0" aria-label={t('Cerrar')} onClick={onClose}><Icon name="x" size={14} /></button>
        </div>
        <div className="px-4 py-3">
          <input
            autoFocus
            data-testid="workspace-library-picker-search"
            className="input w-full"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('Buscar por título o autoría…')}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {loading && <p className="px-3 py-4 text-xs text-neutral-500"><Spinner /> {t('Buscando…')}</p>}
          {!loading && results.length === 0 && <p className="px-3 py-4 text-xs text-neutral-500">{t('Ningún elemento coincide.')}</p>}
          {results.map((candidate) => (
            <button
              key={`${candidate.scope}:${candidate.id}`}
              data-testid={`workspace-library-candidate-${candidate.id}`}
              className="flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-900"
              onClick={() => onPick(candidate)}
            >
              <Icon name={candidate.scope === 'global' ? 'library' : 'book'} size={13} className="mt-0.5 shrink-0 text-neutral-500" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{candidate.title}</span>
                {candidate.subtitle && <span className="block truncate text-[11px] text-neutral-500">{candidate.subtitle}</span>}
              </span>
              <span className="shrink-0 text-[10px] uppercase tracking-wider text-neutral-500">
                {t(candidate.scope === 'global' ? 'Global' : 'Este vault')}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Los elementos de biblioteca enlazados con una nota, una idea o una colección. */
function LibraryLinksPanel({
  ownerKind,
  ownerId,
  ownerLabel,
  links,
  onChanged,
}: {
  ownerKind: WorkspaceLibraryLink['ownerKind'];
  ownerId: string;
  ownerLabel: string;
  links: WorkspaceLibraryLink[];
  onChanged: () => Promise<unknown> | void;
}) {
  const [picking, setPicking] = useState(false);
  const mine = links.filter((link) => link.ownerKind === ownerKind && link.ownerId === ownerId);

  return (
    <div data-testid="workspace-library-links" className="border-t border-neutral-200 px-3 py-3 dark:border-neutral-800">
      <div className="flex items-center gap-1">
        <b className="min-w-0 flex-1 text-[10px] uppercase tracking-wider text-neutral-500">{t('Biblioteca enlazada')}</b>
        <button
          data-testid="workspace-add-library-link"
          className="grid h-7 w-7 place-items-center rounded hover:bg-neutral-100 dark:hover:bg-neutral-900"
          title={tx('Enlazar {name} con la biblioteca', { name: ownerLabel })}
          aria-label={tx('Enlazar {name} con la biblioteca', { name: ownerLabel })}
          onClick={() => setPicking(true)}
        ><Icon name="link" size={13} /></button>
      </div>
      {mine.length === 0 && <p className="mt-1 text-[11px] leading-5 text-neutral-500">{t('Sin elementos enlazados todavía.')}</p>}
      <ul className="mt-1 space-y-0.5">
        {mine.map((link) => (
          <li key={`${link.libraryItemId}:${link.scope}`} className="group flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-900">
            <Icon name={link.scope === 'global' ? 'library' : 'book'} size={12} className="shrink-0 text-neutral-500" />
            <span className="min-w-0 flex-1 truncate" title={link.label ?? link.libraryItemId}>{link.label ?? link.libraryItemId}</span>
            <button
              data-testid={`workspace-remove-library-link-${link.libraryItemId}`}
              className="grid h-6 w-6 shrink-0 place-items-center rounded text-neutral-500 opacity-0 hover:text-red-400 group-hover:opacity-100"
              title={t('Quitar enlace')}
              aria-label={tx('Quitar el enlace con {name}', { name: link.label ?? link.libraryItemId })}
              onClick={async () => {
                await window.nodus.removeWorkspaceLibraryLink(ownerKind, ownerId, link.libraryItemId, link.scope);
                await onChanged();
              }}
            ><Icon name="x" size={11} /></button>
          </li>
        ))}
      </ul>
      {picking && (
        <LibraryLinkPicker
          onClose={() => setPicking(false)}
          onPick={async (candidate) => {
            await window.nodus.addWorkspaceLibraryLink({
              ownerKind, ownerId, libraryItemId: candidate.id, scope: candidate.scope, label: candidate.title,
            });
            setPicking(false);
            await onChanged();
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// El árbol de colecciones
// ─────────────────────────────────────────────────────────────────────────────

function CollectionBranch({
  collection,
  children,
  counts,
  selected,
  expanded,
  depth,
  onSelect,
  onToggle,
  onRename,
  onDelete,
  onDropItem,
}: {
  collection: NoteFolder;
  children: Map<string | null, NoteFolder[]>;
  counts: Map<string, number>;
  selected: string | null;
  expanded: Set<string>;
  depth: number;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onRename: (collection: NoteFolder) => void;
  onDelete: (collection: NoteFolder) => void;
  onDropItem: (noteId: string, collectionId: string) => void;
}) {
  const descendants = children.get(collection.id) ?? [];
  const open = expanded.has(collection.id);
  const active = selected === collection.id;
  return (
    <>
      <div
        className="group flex items-center pr-1"
        style={{ paddingLeft: depth * 12 }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('application/x-nodus-workspace-note')) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
        }}
        onDrop={(event) => {
          const noteId = event.dataTransfer.getData('application/x-nodus-workspace-note');
          if (noteId) { event.preventDefault(); onDropItem(noteId, collection.id); }
        }}
      >
        <button
          className={`grid h-7 w-6 shrink-0 place-items-center rounded text-neutral-600 hover:text-neutral-300 ${descendants.length ? '' : 'invisible'}`}
          onClick={() => onToggle(collection.id)}
          aria-label={open ? t('Plegar') : t('Desplegar')}
        ><Icon name="chevronRight" size={12} className={open ? 'rotate-90' : ''} /></button>
        <span className="grid h-7 w-7 shrink-0 place-items-center text-neutral-500"><Icon name="folder" size={13} /></span>
        <button
          data-testid={`workspace-collection-${collection.id}`}
          className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs ${active ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'}`}
          onClick={() => onSelect(collection.id)}
          title={collection.sourceRef ? `${collection.name} · ${t('Procede de una sección anterior')}` : collection.name}
        >
          <span className="min-w-0 flex-1 truncate">{collection.name}</span>
          <span className="text-[10px] tabular-nums opacity-55">{counts.get(collection.id) ?? 0}</span>
        </button>
        <div className={`ml-0.5 flex shrink-0 items-center gap-0.5 transition-opacity ${active ? 'opacity-100' : 'opacity-60 group-hover:opacity-100 group-focus-within:opacity-100'}`}>
          <button
            data-testid={`workspace-collection-rename-${collection.id}`}
            className="grid h-6 w-6 place-items-center rounded text-neutral-600 hover:bg-neutral-900 hover:text-neutral-200"
            onClick={() => onRename(collection)}
            title={t('Renombrar colección')}
            aria-label={tx('Renombrar {name}', { name: collection.name })}
          ><Icon name="edit" size={11} /></button>
          <button
            data-testid={`workspace-collection-delete-${collection.id}`}
            className="grid h-6 w-6 place-items-center rounded text-neutral-600 hover:bg-red-500/10 hover:text-red-400"
            onClick={() => onDelete(collection)}
            title={t('Eliminar colección')}
            aria-label={tx('Eliminar {name}', { name: collection.name })}
          ><Icon name="trash" size={11} /></button>
        </div>
      </div>
      {open && descendants.map((child) => (
        <CollectionBranch
          key={child.id} collection={child} children={children} counts={counts} selected={selected}
          expanded={expanded} depth={depth + 1} onSelect={onSelect} onToggle={onToggle}
          onRename={onRename} onDelete={onDelete} onDropItem={onDropItem}
        />
      ))}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// La vista
// ─────────────────────────────────────────────────────────────────────────────

export function WorkspaceView({
  settings,
  focusNote,
  onOpenGraph,
}: {
  settings: AppSettings;
  /** Una nota que abrir al entrar (búsqueda global, Nodi); el nonce repite el gesto. */
  focusNote?: { id: string; nonce: number } | null;
  onOpenGraph?: (target: PendingGraphNavigationTarget) => void;
}) {
  const [tree, setTree] = useState<NotesTree>({ folders: [], notes: [] });
  const [links, setLinks] = useState<WorkspaceLibraryLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<Scope>({ kind: 'all' });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<'' | WorkspaceItemKind>('');
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<NoteFolder | null>(null);
  const [creatingCollection, setCreatingCollection] = useState(false);
  const [pendingCollectionDelete, setPendingCollectionDelete] = useState<NoteFolder | null>(null);
  const [pendingNoteDelete, setPendingNoteDelete] = useState<Note | null>(null);
  const focusedNonce = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    const [nextTree, nextLinks] = await Promise.all([
      window.nodus.getNotesTree(),
      window.nodus.listAllWorkspaceLibraryLinks(),
    ]);
    setTree(nextTree);
    setLinks(nextLinks);
    setLoading(false);
    return nextTree;
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Entrar desde fuera (búsqueda global, Nodi) abre la nota en su pestaña.
  useEffect(() => {
    if (!focusNote || focusedNonce.current === focusNote.nonce) return;
    focusedNonce.current = focusNote.nonce;
    setOpenIds((current) => current.includes(focusNote.id) ? current : [...current, focusNote.id]);
    setActiveId(focusNote.id);
  }, [focusNote?.id, focusNote?.nonce]);

  const children = useMemo(() => collectionChildren(tree.folders), [tree.folders]);

  /** Cuántas notas hay en cada colección, contando sus subcolecciones. */
  const counts = useMemo(() => {
    const direct = new Map<string, number>();
    for (const note of tree.notes) {
      if (!note.folderId) continue;
      direct.set(note.folderId, (direct.get(note.folderId) ?? 0) + 1);
    }
    const total = new Map<string, number>();
    for (const collection of tree.folders) {
      let sum = 0;
      for (const id of subtreeIds(collection.id, children)) sum += direct.get(id) ?? 0;
      total.set(collection.id, sum);
    }
    return total;
  }, [tree.notes, tree.folders, children]);

  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    const allowed = scope.kind === 'collection' ? subtreeIds(scope.id, children) : null;
    return tree.notes
      .filter((note) => {
        if (scope.kind === 'unfiled' && note.folderId) return false;
        if (allowed && (!note.folderId || !allowed.has(note.folderId))) return false;
        if (kindFilter && itemKind(note) !== kindFilter) return false;
        if (!needle) return true;
        return note.title.toLocaleLowerCase().includes(needle) || note.content.toLocaleLowerCase().includes(needle);
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [tree.notes, scope, children, kindFilter, search]);

  const openTabs = useMemo(
    () => openIds
      .map((id) => tree.notes.find((note) => note.id === id))
      .filter((note): note is Note => Boolean(note)),
    [openIds, tree.notes]
  );
  const active = openTabs.find((note) => note.id === activeId) ?? null;

  const openNote = (id: string) => {
    setOpenIds((current) => current.includes(id) ? current : [...current, id]);
    setActiveId(id);
  };

  const closeNote = (id: string) => {
    setOpenIds((current) => current.filter((candidate) => candidate !== id));
    setActiveId((current) => {
      if (current !== id) return current;
      const remaining = openIds.filter((candidate) => candidate !== id);
      return remaining.at(-1) ?? null;
    });
  };

  /** La colección en la que aterriza lo que se cree ahora mismo. */
  const targetCollectionId = () => (scope.kind === 'collection' ? scope.id : null);

  const createItem = async (kind: WorkspaceItemKind) => {
    const folderId = targetCollectionId();
    const created = kind === 'idea'
      ? (await window.nodus.createManualIdea({ folderId })).note
      : await window.nodus.createNote({ title: t('Nota sin título'), content: '', kind: 'markdown', folderId });
    await refresh();
    openNote(created.id);
  };

  const selectedCollection = scope.kind === 'collection' ? tree.folders.find((folder) => folder.id === scope.id) ?? null : null;

  const editorPane = active && (
    <div className="flex min-h-0 flex-1">
      <div className="min-h-0 min-w-0 flex-1">
        <Suspense fallback={<div className="grid h-full place-items-center"><Spinner label={t('Cargando editor…')} /></div>}>
          <StudyEditor
            key={active.id}
            settings={settings}
            port={workspaceNotePort}
            showTabs={false}
            documentIcon={KIND_ICON[itemKind(active)]}
            documents={[noteAsEditorDocument(active)]}
            activeId={active.id}
            onActivate={openNote}
            onClose={closeNote}
            onSaved={(updated) => {
              setTree((current) => ({
                ...current,
                notes: current.notes.map((note) => note.id === updated.id
                  ? { ...note, title: updated.title, content: updated.contentMarkdown, updatedAt: new Date().toISOString() }
                  : note),
              }));
            }}
            onDuplicate={async () => {
              const copy = await window.nodus.createNote({
                title: `${active.title} (${t('copia')})`,
                content: active.content,
                kind: active.kind === 'idea' ? 'markdown' : active.kind,
                folderId: active.folderId,
              });
              await refresh();
              openNote(copy.id);
            }}
            onTrash={async () => setPendingNoteDelete(active)}
            onOpenLinkedDocument={openNote}
            onOpenRecording={() => undefined}
          />
        </Suspense>
      </div>
      <aside className="library-theme-panel hidden w-[260px] shrink-0 flex-col overflow-y-auto border-l border-neutral-800 bg-neutral-950/80 xl:flex">
        <div className="px-3 py-3">
          <b className="text-[10px] uppercase tracking-wider text-neutral-500">{t('Detalles')}</b>
          <p className="mt-1 truncate text-xs font-medium" title={active.title}>{active.title}</p>
          <p className="mt-0.5 text-[11px] text-neutral-500">
            {t(itemKind(active) === 'idea' ? 'Idea' : 'Nota')}
            {active.folderId ? ` · ${tree.folders.find((folder) => folder.id === active.folderId)?.name ?? ''}` : ` · ${t('Sin colección')}`}
          </p>
        </div>
        <div className="px-3 pb-3">
          <label className="text-[10px] uppercase tracking-wider text-neutral-500" htmlFor="workspace-item-collection">{t('Colección')}</label>
          <select
            id="workspace-item-collection"
            data-testid="workspace-item-collection"
            className="input mt-1 w-full text-xs"
            value={active.folderId ?? ''}
            onChange={async (event) => {
              await window.nodus.moveNote(active.id, event.target.value || null);
              await refresh();
            }}
          >
            <option value="">{t('Sin colección')}</option>
            {tree.folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
          </select>
        </div>
        {itemKind(active) === 'idea' && active.source?.ref && onOpenGraph && (
          <div className="px-3 pb-3">
            <button className="btn btn-ghost w-full text-xs" onClick={() => onOpenGraph({ nodeId: active.source!.ref!, label: active.title })}>
              <Icon name="layers" size={13} /> {t('Ver en el grafo')}
            </button>
          </div>
        )}
        <LibraryLinksPanel ownerKind="note" ownerId={active.id} ownerLabel={active.title} links={links} onChanged={refresh} />
      </aside>
    </div>
  );

  const browser = (
    <div data-testid="workspace-view" className="library-theme-canvas flex h-full min-h-0 flex-col bg-neutral-950">
      <header data-testid="workspace-header" className="library-header-bar min-h-14 shrink-0 border-b border-neutral-800 px-5 py-3">
        <div className="library-header-title min-w-0">
          <h1 className="flex items-center gap-2 text-lg font-semibold"><Icon name="notebook" className="text-indigo-400" /> {t('Espacio de trabajo')}</h1>
          <p className="text-[11px] text-neutral-500">{tx('{n} nota(s) e idea(s) · {c} colección(es)', { n: tree.notes.length, c: tree.folders.length })}</p>
        </div>
        <div className="library-header-actions">
          <button data-testid="workspace-create-idea" className="btn btn-secondary h-8 text-xs" onClick={() => void createItem('idea')}>
            <Icon name="bulb" size={13} /> {t('Idea')}
          </button>
          <button data-testid="workspace-create-note" className="btn btn-primary h-8 text-xs" onClick={() => void createItem('note')}>
            <Icon name="notebook" size={13} /> {t('Nota')}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="library-theme-panel hidden w-[238px] shrink-0 flex-col border-r border-neutral-800 bg-neutral-950/80 lg:flex">
          <div className="flex items-center gap-1 px-3 py-3">
            <b className="min-w-0 flex-1 text-[11px] uppercase tracking-wider text-neutral-500">{t('Colecciones')}</b>
            <button
              data-testid="workspace-create-collection"
              className="grid h-7 w-7 place-items-center rounded hover:bg-neutral-900"
              title={t('Nueva colección')}
              aria-label={t('Nueva colección')}
              onClick={() => setCreatingCollection(true)}
            ><Icon name="folderPlus" size={14} /></button>
          </div>
          <div className="px-2 pb-2">
            <button
              data-testid="workspace-scope-all"
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${scope.kind === 'all' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-900'}`}
              onClick={() => setScope({ kind: 'all' })}
            ><Icon name="library" size={14} /><span className="flex-1">{t('Todo')}</span><span className="text-[10px] opacity-60">{tree.notes.length}</span></button>
          </div>
          <div
            data-testid="workspace-collections-pane"
            className="min-h-0 flex-1 overflow-y-auto px-2 pb-1"
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes('application/x-nodus-workspace-note')) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
            }}
            onDrop={async (event) => {
              const noteId = event.dataTransfer.getData('application/x-nodus-workspace-note');
              if (!noteId) return;
              event.preventDefault();
              await window.nodus.moveNote(noteId, null);
              await refresh();
            }}
          >
            {(children.get(null) ?? []).map((collection) => (
              <CollectionBranch
                key={collection.id}
                collection={collection}
                children={children}
                counts={counts}
                selected={scope.kind === 'collection' ? scope.id : null}
                expanded={expanded}
                depth={0}
                onSelect={(id) => setScope({ kind: 'collection', id })}
                onToggle={(id) => setExpanded((current) => {
                  const next = new Set(current);
                  if (next.has(id)) next.delete(id); else next.add(id);
                  return next;
                })}
                onRename={setRenaming}
                onDelete={setPendingCollectionDelete}
                onDropItem={async (noteId, collectionId) => {
                  await window.nodus.moveNote(noteId, collectionId);
                  await refresh();
                }}
              />
            ))}
            {tree.folders.length === 0 && (
              <p className="px-3 py-4 text-xs leading-5 text-neutral-600">{t('Agrupa tus notas e ideas en colecciones para trabajar por temas o capítulos.')}</p>
            )}
          </div>
          <div className="shrink-0 border-t border-neutral-800 px-2 py-2">
            <button
              data-testid="workspace-scope-unfiled"
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${scope.kind === 'unfiled' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-900'}`}
              onClick={() => setScope({ kind: 'unfiled' })}
            >
              <Icon name="folder" size={14} /><span className="flex-1">{t('Sin colección')}</span>
              <span className="text-[10px] opacity-60">{tree.notes.filter((note) => !note.folderId).length}</span>
            </button>
          </div>
          {selectedCollection && (
            <LibraryLinksPanel
              ownerKind="collection"
              ownerId={selectedCollection.id}
              ownerLabel={selectedCollection.name}
              links={links}
              onChanged={refresh}
            />
          )}
        </aside>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-3 py-2">
            <div className="relative min-w-48 flex-1">
              <Icon name="search" size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" />
              <input
                data-testid="workspace-search"
                className="input h-8 w-full pl-8 text-xs"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('Buscar en notas e ideas…')}
              />
            </div>
            <select
              data-testid="workspace-kind-filter"
              aria-label={t('Tipo')}
              className="input h-8 w-32 text-xs"
              value={kindFilter}
              onChange={(event) => setKindFilter(event.target.value as '' | WorkspaceItemKind)}
            >
              <option value="">{t('Todo')}</option>
              <option value="note">{t('Notas')}</option>
              <option value="idea">{t('Ideas')}</option>
            </select>
          </div>

          <div data-testid="workspace-item-list" className="library-catalog-scroll min-h-0 flex-1 overflow-y-auto">
            {loading && <p className="px-4 py-6 text-xs text-neutral-500"><Spinner /> {t('Cargando…')}</p>}
            {!loading && visible.length === 0 && (
              <p className="px-4 py-6 text-xs leading-5 text-neutral-500">
                {search ? t('Ningún elemento coincide.') : t('Todavía no hay nada aquí. Crea una nota o una idea para empezar.')}
              </p>
            )}
            {visible.map((note) => {
              const kind = itemKind(note);
              const linkCount = links.filter((link) => link.ownerKind === 'note' && link.ownerId === note.id).length;
              return (
                <button
                  key={note.id}
                  data-testid={`workspace-item-${note.id}`}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('application/x-nodus-workspace-note', note.id);
                  }}
                  className={`flex w-full items-start gap-3 border-b border-neutral-900 px-4 py-3 text-left hover:bg-neutral-900/60 ${openIds.includes(note.id) ? 'bg-neutral-900/40' : ''}`}
                  onClick={() => openNote(note.id)}
                >
                  <Icon name={KIND_ICON[kind]} size={14} className={`mt-0.5 shrink-0 ${kind === 'idea' ? 'text-amber-400' : 'text-neutral-500'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{note.title}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-neutral-500">{plainSnippet(note.content) || t('Sin contenido')}</span>
                  </span>
                  {linkCount > 0 && (
                    <span className="mt-0.5 flex shrink-0 items-center gap-1 text-[10px] text-neutral-500" title={tx('{n} elemento(s) de biblioteca enlazado(s)', { n: linkCount })}>
                      <Icon name="link" size={11} />{linkCount}
                    </span>
                  )}
                  <span className="mt-0.5 shrink-0 text-[10px] tabular-nums text-neutral-600">{formatRelative(note.updatedAt)}</span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );

  return (
    <div className="library-theme flex h-full min-h-0 flex-col">
      <WorkspaceTabStrip
        homeLabel={t('Espacio de trabajo')}
        homeIcon="notebook"
        homeTestId="workspace-tab-home"
        tabTestId={(tab) => `workspace-tab-${tab.key}`}
        closeTestId={(tab) => `workspace-tab-close-${tab.key}`}
        tabs={openTabs.map((note) => ({ key: note.id, title: note.title, icon: KIND_ICON[itemKind(note)] }))}
        activeKey={active?.id ?? null}
        onActivateHome={() => setActiveId(null)}
        onActivateTab={setActiveId}
        onCloseTab={closeNote}
      />
      <div className={`min-h-0 flex-1 overflow-hidden ${active ? 'hidden' : ''}`} aria-hidden={active ? true : undefined}>
        {browser}
      </div>
      {editorPane}

      {creatingCollection && (
        <TextInputModal
          title={t('Nueva colección')}
          label={t('Nombre')}
          initialValue=""
          submitLabel={t('Crear')}
          onCancel={() => setCreatingCollection(false)}
          onSubmit={async (name) => {
            const created = await window.nodus.createNoteFolder({ name, parentId: targetCollectionId() });
            setCreatingCollection(false);
            await refresh();
            setScope({ kind: 'collection', id: created.id });
          }}
        />
      )}
      {renaming && (
        <TextInputModal
          title={t('Renombrar colección')}
          label={t('Nombre')}
          initialValue={renaming.name}
          submitLabel={t('Guardar')}
          onCancel={() => setRenaming(null)}
          onSubmit={async (name) => {
            await window.nodus.renameNoteFolder(renaming.id, name);
            setRenaming(null);
            await refresh();
          }}
        />
      )}
      {pendingCollectionDelete && (
        <ConfirmModal
          title={t('Eliminar colección')}
          message={tx('Se eliminará «{name}» con sus subcolecciones y las {n} nota(s) que contiene. No se puede deshacer.', {
            name: pendingCollectionDelete.name,
            n: counts.get(pendingCollectionDelete.id) ?? 0,
          })}
          confirmLabel={t('Eliminar')}
          danger
          onCancel={() => setPendingCollectionDelete(null)}
          onConfirm={async () => {
            const removed = subtreeIds(pendingCollectionDelete.id, children);
            await window.nodus.deleteNoteFolder(pendingCollectionDelete.id);
            setPendingCollectionDelete(null);
            const nextTree = await refresh();
            // Cerrar las pestañas de lo que acaba de dejar de existir.
            setOpenIds((current) => current.filter((id) => nextTree.notes.some((note) => note.id === id)));
            setActiveId((current) => (current && nextTree.notes.some((note) => note.id === current) ? current : null));
            if (scope.kind === 'collection' && removed.has(scope.id)) setScope({ kind: 'all' });
          }}
        />
      )}
      {pendingNoteDelete && (
        <ConfirmModal
          title={t(itemKind(pendingNoteDelete) === 'idea' ? 'Eliminar idea' : 'Eliminar nota')}
          message={tx('Se eliminará «{name}» con su historial y sus comentarios. No se puede deshacer.', { name: pendingNoteDelete.title })}
          confirmLabel={t('Eliminar')}
          danger
          onCancel={() => setPendingNoteDelete(null)}
          onConfirm={async () => {
            const id = pendingNoteDelete.id;
            await window.nodus.deleteNote(id);
            setPendingNoteDelete(null);
            closeNote(id);
            await refresh();
          }}
        />
      )}
    </div>
  );
}
