import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Note, NoteFolder, NoteKind, NotesTree } from '@shared/types';
import { Badge, Icon } from '../components/ui';
import { Markdown, type MarkdownCitation } from '../components/Markdown';
import { SourceCitationModal, type CitationTarget } from '../components/SourceCitationModal';
import { ConfirmModal } from '../components/ConfirmModal';
import { buildNotesTree, countNotesInSubtree, flattenFolders, type FolderNode } from '../notesTree';
import type { PendingGraphNavigationTarget } from '../navigation';
import { t, tx } from '../i18n';

type FolderScope = { kind: 'all' } | { kind: 'unfiled' } | { kind: 'folder'; id: string };

const KIND_LABELS: Record<NoteKind, string> = {
  markdown: 'Nota',
  assistant: 'Asistente',
  writing: 'Escritura',
  debate: 'Debate',
  idea: 'Idea',
};

const KIND_COLORS: Record<NoteKind, 'neutral' | 'indigo' | 'cyan' | 'red' | 'green'> = {
  markdown: 'neutral',
  assistant: 'indigo',
  writing: 'cyan',
  debate: 'red',
  idea: 'green',
};

export function NotesView({ onOpenGraph }: { onOpenGraph?: (target: PendingGraphNavigationTarget) => void }) {
  const [folders, setFolders] = useState<NoteFolder[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<FolderScope>({ kind: 'all' });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const [activeId, setActiveId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [saving, setSaving] = useState(false);

  const [citation, setCitation] = useState<CitationTarget>(null);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [pendingFolderDelete, setPendingFolderDelete] = useState<NoteFolder | null>(null);
  const [pendingNoteDelete, setPendingNoteDelete] = useState<Note | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Mirror editor buffers so the auto-save-before-switch path reads fresh values.
  const bufferRef = useRef({ title: '', content: '', dirty: false, activeId: null as string | null });
  bufferRef.current = { title: editTitle, content: editContent, dirty, activeId };

  const refresh = useCallback(async (): Promise<NotesTree> => {
    const tree = await window.nodus.getNotesTree();
    setFolders(tree.folders);
    setNotes(tree.notes);
    return tree;
  }, []);

  useEffect(() => {
    void refresh().finally(() => setLoading(false));
  }, [refresh]);

  const tree = useMemo(() => buildNotesTree(folders, notes), [folders, notes]);
  const flatFolders = useMemo(() => flattenFolders(folders), [folders]);
  const activeNote = useMemo(() => notes.find((n) => n.id === activeId) ?? null, [notes, activeId]);

  const persistBuffer = useCallback(async () => {
    const { title, content, dirty: isDirty, activeId: id } = bufferRef.current;
    if (!id || !isDirty) return;
    await window.nodus.updateNote({ id, title, content });
    bufferRef.current.dirty = false;
  }, []);

  const openNote = useCallback(
    async (note: Note) => {
      if (note.id === bufferRef.current.activeId) return;
      await persistBuffer();
      setActiveId(note.id);
      setEditTitle(note.title);
      setEditContent(note.content);
      setDirty(false);
      setMode(note.kind === 'markdown' ? 'edit' : 'preview');
      await refresh();
    },
    [persistBuffer, refresh]
  );

  const saveActive = useCallback(async () => {
    if (!activeId || !dirty || saving) return;
    setSaving(true);
    try {
      await window.nodus.updateNote({ id: activeId, title: editTitle, content: editContent });
      bufferRef.current.dirty = false;
      setDirty(false);
      await refresh();
    } finally {
      setSaving(false);
    }
  }, [activeId, dirty, editContent, editTitle, refresh, saving]);

  // Persist the open note when the view unmounts (navigating away).
  useEffect(() => {
    return () => {
      void persistBuffer();
    };
  }, [persistBuffer]);

  const targetFolderId = useCallback((): string | null => {
    if (scope.kind === 'folder') return scope.id;
    return null;
  }, [scope]);

  const createFolder = useCallback(
    async (parentId: string | null) => {
      const created = await window.nodus.createNoteFolder({ name: t('Carpeta nueva'), parentId });
      await refresh();
      if (parentId) setExpanded((prev) => new Set(prev).add(parentId));
      setRenamingFolderId(created.id);
      setRenameValue(created.name);
    },
    [refresh]
  );

  const createNote = useCallback(async () => {
    await persistBuffer();
    const folderId = targetFolderId();
    const note = await window.nodus.createNote({
      title: t('Nota sin título'),
      content: '',
      kind: 'markdown',
      folderId,
    });
    const tree = await refresh();
    const fresh = tree.notes.find((n) => n.id === note.id) ?? note;
    setActiveId(fresh.id);
    setEditTitle(fresh.title);
    setEditContent(fresh.content);
    setDirty(false);
    setMode('edit');
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }, [persistBuffer, refresh, targetFolderId]);

  const commitRename = useCallback(async () => {
    if (!renamingFolderId) return;
    const id = renamingFolderId;
    const value = renameValue;
    setRenamingFolderId(null);
    await window.nodus.renameNoteFolder(id, value);
    await refresh();
  }, [renameValue, renamingFolderId, refresh]);

  const confirmDeleteFolder = useCallback(async () => {
    if (!pendingFolderDelete) return;
    const id = pendingFolderDelete.id;
    setPendingFolderDelete(null);
    await window.nodus.deleteNoteFolder(id);
    if (scope.kind === 'folder' && scope.id === id) setScope({ kind: 'all' });
    await refresh();
  }, [pendingFolderDelete, refresh, scope]);

  const confirmDeleteNote = useCallback(async () => {
    if (!pendingNoteDelete) return;
    const id = pendingNoteDelete.id;
    setPendingNoteDelete(null);
    await window.nodus.deleteNote(id);
    if (activeId === id) {
      setActiveId(null);
      bufferRef.current = { title: '', content: '', dirty: false, activeId: null };
    }
    await refresh();
  }, [activeId, pendingNoteDelete, refresh]);

  const moveActiveToFolder = useCallback(
    async (folderId: string | null) => {
      if (!activeId) return;
      await persistBuffer();
      await window.nodus.moveNote(activeId, folderId);
      await refresh();
    },
    [activeId, persistBuffer, refresh]
  );

  const applyFormat = useCallback(
    (kind: 'bold' | 'italic' | 'heading' | 'list' | 'quote' | 'code' | 'link') => {
      const el = textareaRef.current;
      if (!el) return;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const value = editContent;
      const selected = value.slice(start, end);
      let replacement = selected;
      let caretOffset = 0;
      switch (kind) {
        case 'bold':
          replacement = `**${selected || t('texto')}**`;
          caretOffset = selected ? replacement.length : 2;
          break;
        case 'italic':
          replacement = `*${selected || t('texto')}*`;
          caretOffset = selected ? replacement.length : 1;
          break;
        case 'code':
          replacement = `\`${selected || 'code'}\``;
          caretOffset = selected ? replacement.length : 1;
          break;
        case 'link':
          replacement = `[${selected || t('texto')}](https://)`;
          caretOffset = replacement.length;
          break;
        case 'heading':
          replacement = prefixLines(selected || t('Encabezado'), '## ');
          caretOffset = replacement.length;
          break;
        case 'list':
          replacement = prefixLines(selected || t('elemento'), '- ');
          caretOffset = replacement.length;
          break;
        case 'quote':
          replacement = prefixLines(selected || t('cita'), '> ');
          caretOffset = replacement.length;
          break;
      }
      const next = value.slice(0, start) + replacement + value.slice(end);
      setEditContent(next);
      setDirty(true);
      window.setTimeout(() => {
        el.focus();
        const pos = start + caretOffset;
        el.setSelectionRange(pos, pos);
      }, 0);
    },
    [editContent]
  );

  const scopeTitle = useMemo(() => {
    if (scope.kind === 'all') return t('Todas las notas');
    if (scope.kind === 'unfiled') return t('Sin carpeta');
    return folders.find((f) => f.id === scope.id)?.name ?? t('Carpeta');
  }, [folders, scope]);

  const visibleNotes = useMemo(() => {
    let list: Note[];
    if (scope.kind === 'all') list = notes;
    else if (scope.kind === 'unfiled') list = notes.filter((n) => !n.folderId);
    else list = notes.filter((n) => n.folderId === scope.id);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q));
    return [...list].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  }, [notes, scope, search]);

  return (
    <div className="h-full flex min-h-0">
      {/* Folder tree */}
      <aside className="w-60 shrink-0 border-r border-neutral-800 flex flex-col min-h-0">
        <div className="p-3 border-b border-neutral-800 flex items-center gap-2">
          <Icon name="notebook" className="text-indigo-300" />
          <span className="font-semibold text-sm flex-1">{t('Notas')}</span>
          <button
            className="p-1 rounded text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800"
            title={t('Nueva carpeta')}
            onClick={() => void createFolder(null)}
          >
            <Icon name="folderPlus" size={15} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-0.5">
          <ScopeRow
            active={scope.kind === 'all'}
            icon="notebook"
            label={t('Todas las notas')}
            count={notes.length}
            onClick={() => setScope({ kind: 'all' })}
          />
          {tree.roots.map((node) => (
            <FolderRow
              key={node.folder.id}
              node={node}
              scope={scope}
              expanded={expanded}
              renamingFolderId={renamingFolderId}
              renameValue={renameValue}
              onToggleExpand={(id) =>
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
              onSelect={(id) => setScope({ kind: 'folder', id })}
              onAddSub={(id) => void createFolder(id)}
              onStartRename={(folder) => {
                setRenamingFolderId(folder.id);
                setRenameValue(folder.name);
              }}
              onRenameChange={setRenameValue}
              onRenameCommit={() => void commitRename()}
              onDelete={(folder) => setPendingFolderDelete(folder)}
            />
          ))}
          {tree.unfiled.length > 0 && (
            <ScopeRow
              active={scope.kind === 'unfiled'}
              icon="folder"
              label={t('Sin carpeta')}
              count={tree.unfiled.length}
              onClick={() => setScope({ kind: 'unfiled' })}
            />
          )}
          {loading && <div className="text-xs text-neutral-600 px-2 py-3">{t('Cargando…')}</div>}
          {!loading && folders.length === 0 && (
            <div className="text-xs text-neutral-600 px-2 py-3 leading-relaxed">
              {t('Crea carpetas para organizar tus notas como capítulos y subepígrafes.')}
            </div>
          )}
        </div>
      </aside>

      {/* Note list */}
      <aside className="w-72 shrink-0 border-r border-neutral-800 flex flex-col min-h-0">
        <div className="p-3 border-b border-neutral-800 space-y-2">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm flex-1 truncate" title={scopeTitle}>
              {scopeTitle}
            </span>
            <button className="btn btn-primary text-xs gap-1 py-1" onClick={() => void createNote()}>
              <Icon name="plus" size={13} /> {t('Nota')}
            </button>
          </div>
          <div className="relative">
            <Icon
              name="search"
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none"
            />
            <input
              className="input input-with-leading-icon w-full text-xs py-1.5"
              placeholder={t('Buscar en notas…')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
          {visibleNotes.length === 0 && (
            <div className="text-xs text-neutral-600 text-center py-8 px-3 leading-relaxed">
              {search.trim() ? t('Sin resultados.') : t('No hay notas aquí todavía. Crea una o guarda respuestas del asistente.')}
            </div>
          )}
          {visibleNotes.map((note) => (
            <NoteListItem
              key={note.id}
              note={note}
              active={note.id === activeId}
              onOpen={() => void openNote(note)}
              onDelete={() => setPendingNoteDelete(note)}
            />
          ))}
        </div>
      </aside>

      {/* Editor */}
      <section className="flex-1 min-w-0 flex flex-col min-h-0">
        {!activeNote ? (
          <div className="flex-1 flex items-center justify-center text-neutral-500 text-sm px-8 text-center">
            {t('Selecciona una nota o crea una nueva para empezar a escribir.')}
          </div>
        ) : (
          <>
            <header className="px-4 py-3 border-b border-neutral-800 flex flex-wrap items-center gap-2">
              <Badge color={KIND_COLORS[activeNote.kind]}>{t(KIND_LABELS[activeNote.kind])}</Badge>
              <input
                className="input flex-1 min-w-[180px] font-medium"
                value={editTitle}
                onChange={(e) => {
                  setEditTitle(e.target.value);
                  setDirty(true);
                }}
                placeholder={t('Título de la nota')}
              />
              <select
                className="input text-xs py-1.5 max-w-[180px]"
                title={t('Mover a carpeta')}
                value={activeNote.folderId ?? ''}
                onChange={(e) => void moveActiveToFolder(e.target.value || null)}
              >
                <option value="">{t('Sin carpeta (raíz)')}</option>
                {flatFolders.map(({ folder, depth }) => (
                  <option key={folder.id} value={folder.id}>
                    {`${'  '.repeat(depth)}${depth > 0 ? '↳ ' : ''}${folder.name}`}
                  </option>
                ))}
              </select>
              <div className="flex rounded-md border border-neutral-700 overflow-hidden">
                <button
                  className={`px-2.5 py-1.5 text-xs flex items-center gap-1 ${mode === 'edit' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-800'}`}
                  onClick={() => setMode('edit')}
                >
                  <Icon name="edit" size={12} /> {t('Editar')}
                </button>
                <button
                  className={`px-2.5 py-1.5 text-xs flex items-center gap-1 ${mode === 'preview' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-800'}`}
                  onClick={() => setMode('preview')}
                >
                  <Icon name="eye" size={12} /> {t('Vista')}
                </button>
              </div>
              <button
                className="btn btn-primary gap-1.5"
                onClick={() => void saveActive()}
                disabled={!dirty || saving}
                title={t('Guardar')}
              >
                <Icon name={saving ? 'sync' : dirty ? 'save' : 'check'} className={saving ? 'animate-spin' : ''} />
                {dirty ? t('Guardar') : t('Guardado')}
              </button>
              <button
                className="btn btn-ghost text-neutral-500 hover:text-red-400"
                onClick={() => setPendingNoteDelete(activeNote)}
                title={t('Eliminar nota')}
              >
                <Icon name="trash" />
              </button>
            </header>

            {mode === 'edit' && (
              <div className="px-3 py-2 border-b border-neutral-800 flex items-center gap-1 flex-wrap">
                <ToolbarButton icon="heading" title={t('Encabezado')} onClick={() => applyFormat('heading')} />
                <ToolbarButton icon="bold" title={t('Negrita')} onClick={() => applyFormat('bold')} />
                <ToolbarButton icon="italic" title={t('Cursiva')} onClick={() => applyFormat('italic')} />
                <ToolbarButton icon="list" title={t('Lista')} onClick={() => applyFormat('list')} />
                <ToolbarButton icon="quote" title={t('Cita')} onClick={() => applyFormat('quote')} />
                <ToolbarButton icon="code" title={t('Código')} onClick={() => applyFormat('code')} />
                <ToolbarButton icon="link" title={t('Enlace')} onClick={() => applyFormat('link')} />
              </div>
            )}

            <div className="flex-1 min-h-0 overflow-y-auto">
              {mode === 'edit' ? (
                <textarea
                  ref={textareaRef}
                  className="w-full h-full resize-none bg-transparent px-5 py-4 text-sm leading-relaxed text-neutral-200 outline-none font-mono"
                  value={editContent}
                  spellCheck={false}
                  placeholder={t('Escribe en Markdown… Las citas del asistente (nodus://) se mantienen clicables en la vista.')}
                  onChange={(e) => {
                    setEditContent(e.target.value);
                    setDirty(true);
                  }}
                  onBlur={() => void saveActive()}
                />
              ) : (
                <div className="max-w-3xl mx-auto px-5 py-4">
                  {editContent.trim() ? (
                    <Markdown content={editContent} onCitation={(c: MarkdownCitation) => setCitation(c)} />
                  ) : (
                    <p className="text-sm text-neutral-600">{t('Nota vacía. Cambia a «Editar» para escribir.')}</p>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {citation && (
        <SourceCitationModal
          target={citation}
          onClose={() => setCitation(null)}
          onOpenGraph={
            onOpenGraph
              ? (target) => {
                  setCitation(null);
                  onOpenGraph(target);
                }
              : undefined
          }
        />
      )}

      {pendingFolderDelete && (
        <ConfirmModal
          title={t('Eliminar carpeta')}
          message={
            <>
              {t('Se eliminará')} <span className="text-neutral-200">«{pendingFolderDelete.name}»</span>{' '}
              {t('junto con sus subcarpetas y todas sus notas. Esta acción no se puede deshacer.')}
            </>
          }
          confirmLabel={t('Eliminar')}
          danger
          onConfirm={() => void confirmDeleteFolder()}
          onCancel={() => setPendingFolderDelete(null)}
        />
      )}

      {pendingNoteDelete && (
        <ConfirmModal
          title={t('Eliminar nota')}
          message={
            <>
              {t('Se eliminará')} <span className="text-neutral-200">«{pendingNoteDelete.title}»</span>.{' '}
              {t('Esta acción no se puede deshacer.')}
            </>
          }
          confirmLabel={t('Eliminar')}
          danger
          onConfirm={() => void confirmDeleteNote()}
          onCancel={() => setPendingNoteDelete(null)}
        />
      )}
    </div>
  );
}

function ScopeRow({
  active,
  icon,
  label,
  count,
  onClick,
}: {
  active: boolean;
  icon: string;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left transition-colors ${
        active ? 'bg-indigo-600/15 text-indigo-300' : 'text-neutral-300 hover:bg-neutral-900'
      }`}
      onClick={onClick}
    >
      <Icon name={icon} size={14} className={active ? 'text-indigo-300' : 'text-neutral-500'} />
      <span className="flex-1 truncate">{label}</span>
      <span className="text-[10px] text-neutral-500">{count}</span>
    </button>
  );
}

function FolderRow({
  node,
  scope,
  expanded,
  renamingFolderId,
  renameValue,
  onToggleExpand,
  onSelect,
  onAddSub,
  onStartRename,
  onRenameChange,
  onRenameCommit,
  onDelete,
}: {
  node: FolderNode;
  scope: FolderScope;
  expanded: Set<string>;
  renamingFolderId: string | null;
  renameValue: string;
  onToggleExpand: (id: string) => void;
  onSelect: (id: string) => void;
  onAddSub: (id: string) => void;
  onStartRename: (folder: NoteFolder) => void;
  onRenameChange: (value: string) => void;
  onRenameCommit: () => void;
  onDelete: (folder: NoteFolder) => void;
}) {
  const isOpen = expanded.has(node.folder.id);
  const isActive = scope.kind === 'folder' && scope.id === node.folder.id;
  const hasChildren = node.children.length > 0;
  const isRenaming = renamingFolderId === node.folder.id;
  const total = countNotesInSubtree(node);

  return (
    <div>
      <div
        className={`group flex items-center gap-1 rounded-md pr-1 transition-colors ${
          isActive ? 'bg-indigo-600/15' : 'hover:bg-neutral-900'
        }`}
        style={{ paddingLeft: `${node.depth * 12}px` }}
      >
        <button
          className="p-1 text-neutral-500 hover:text-neutral-200"
          onClick={() => onToggleExpand(node.folder.id)}
          title={isOpen ? t('Contraer') : t('Expandir')}
          style={{ visibility: hasChildren ? 'visible' : 'hidden' }}
        >
          <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={13} />
        </button>
        {isRenaming ? (
          <input
            autoFocus
            className="input text-sm py-0.5 flex-1 min-w-0"
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onBlur={onRenameCommit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onRenameCommit();
              }
            }}
          />
        ) : (
          <button
            className={`flex-1 min-w-0 flex items-center gap-1.5 py-1.5 text-sm text-left ${
              isActive ? 'text-indigo-300' : 'text-neutral-300'
            }`}
            onClick={() => onSelect(node.folder.id)}
            onDoubleClick={() => onStartRename(node.folder)}
          >
            <Icon name="folder" size={14} className={isActive ? 'text-indigo-300' : 'text-neutral-500'} />
            <span className="truncate">{node.folder.name}</span>
            {total > 0 && <span className="text-[10px] text-neutral-500">{total}</span>}
          </button>
        )}
        {!isRenaming && (
          <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              className="p-1 text-neutral-500 hover:text-neutral-200"
              title={t('Nueva subcarpeta')}
              onClick={() => onAddSub(node.folder.id)}
            >
              <Icon name="folderPlus" size={13} />
            </button>
            <button
              className="p-1 text-neutral-500 hover:text-neutral-200"
              title={t('Renombrar')}
              onClick={() => onStartRename(node.folder)}
            >
              <Icon name="edit" size={12} />
            </button>
            <button
              className="p-1 text-neutral-500 hover:text-red-400"
              title={t('Eliminar carpeta')}
              onClick={() => onDelete(node.folder)}
            >
              <Icon name="trash" size={12} />
            </button>
          </div>
        )}
      </div>
      {isOpen &&
        node.children.map((child) => (
          <FolderRow
            key={child.folder.id}
            node={child}
            scope={scope}
            expanded={expanded}
            renamingFolderId={renamingFolderId}
            renameValue={renameValue}
            onToggleExpand={onToggleExpand}
            onSelect={onSelect}
            onAddSub={onAddSub}
            onStartRename={onStartRename}
            onRenameChange={onRenameChange}
            onRenameCommit={onRenameCommit}
            onDelete={onDelete}
          />
        ))}
    </div>
  );
}

function NoteListItem({
  note,
  active,
  onOpen,
  onDelete,
}: {
  note: Note;
  active: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const snippet = useMemo(() => plainSnippet(note.content), [note.content]);
  return (
    <div
      className={`group rounded-md border px-2.5 py-2 cursor-pointer transition-colors ${
        active ? 'bg-indigo-600/15 border-indigo-700' : 'border-transparent hover:bg-neutral-900'
      }`}
      onClick={onOpen}
    >
      <div className="flex items-center gap-1.5">
        <Badge color={KIND_COLORS[note.kind]}>{t(KIND_LABELS[note.kind])}</Badge>
        <span className="flex-1 min-w-0 truncate text-sm font-medium">{note.title}</span>
        <button
          className="p-1 rounded text-neutral-600 hover:text-red-400 hover:bg-neutral-800 opacity-0 group-hover:opacity-100 transition-opacity"
          title={t('Eliminar nota')}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Icon name="trash" size={12} />
        </button>
      </div>
      {snippet && <p className="text-[11px] text-neutral-500 mt-1 line-clamp-2">{snippet}</p>}
      <div className="text-[10px] text-neutral-600 mt-1">{formatRelative(note.updatedAt)}</div>
    </div>
  );
}

function ToolbarButton({ icon, title, onClick }: { icon: string; title: string; onClick: () => void }) {
  return (
    <button
      className="p-1.5 rounded text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800"
      title={title}
      onClick={onClick}
      type="button"
    >
      <Icon name={icon} size={15} />
    </button>
  );
}

function prefixLines(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

function plainSnippet(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diff = Date.now() - then;
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return t('ahora');
  if (minutes < 60) return tx('hace {n} min', { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return tx('hace {n} h', { n: hours });
  const days = Math.round(hours / 24);
  if (days < 7) return tx('hace {n} d', { n: days });
  return new Date(iso).toLocaleDateString();
}
