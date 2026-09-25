import { useCallback, useEffect, useMemo, useState, type DragEvent, type ReactNode } from 'react';
import type { ChatConversationSummary, ResearchChatProjectFolder } from '@shared/types';
import { UNFILED_FOLDER, canNestFolder, conversationsInSelection, folderChildren, type ChatFolderSelection } from '@shared/researchChatFolders';
import { ConfirmModal } from './ConfirmModal';
import { FloatingMenu, MenuItem, RenameField } from './ResearchChatHistoryMenu';
import { MarqueeText } from './MarqueeText';
import { Icon } from './ui';
import { t, tx } from '../i18n';

/*
 * The folder tree inside a research chat project. One tree, drawn in two places — under
 * the project's row in the history and on the project's page — from the same rows, with
 * the same selection and the same drag semantics:
 *   · a chat dropped on a folder is filed there (and joins the folder's project);
 *   · a folder dropped on a folder nests inside it, or before/after it near its edges;
 *   · dropped anywhere else in the project (its row, "No folder", the free space), a chat
 *     leaves its folder and a folder goes back to the project's root.
 */

/** A refusal from the main process, in the reader's language when it is one of ours. */
export function historyError(message: string): string {
  if (message.includes('research_chat_pin_limit')) return tx('Solo puedes destacar {n} chats. Quita uno para destacar otro.', { n: 5 });
  if (message.includes('research_chat_folder_cycle')) return t('Una carpeta no puede ir dentro de sí misma ni de sus subcarpetas.');
  if (message.includes('research_chat_folder_wrong_project')) return t('Una carpeta solo puede moverse dentro de su proyecto.');
  if (message.includes('research_chat_folder_not_found')) return t('Esa carpeta ya no existe.');
  return message;
}

/** Selection and expanded folders, owned once and handed to both places. */
export interface ChatFolderTreeState {
  selection: ChatFolderSelection | null;
  select: (selection: ChatFolderSelection | null) => void;
  expanded: ReadonlySet<string>;
  toggle: (folderId: string) => void;
  expand: (folderId: string) => void;
}

export function useChatFolderTreeState(): ChatFolderTreeState {
  const [selection, select] = useState<ChatFolderSelection | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggle = useCallback((folderId: string) => setExpanded(current => {
    const next = new Set(current);
    if (next.has(folderId)) next.delete(folderId); else next.add(folderId);
    return next;
  }), []);
  const expand = useCallback((folderId: string) => setExpanded(current => current.has(folderId) ? current : new Set([...current, folderId])), []);
  return useMemo(() => ({ selection, select, expanded, toggle, expand }), [selection, expanded, toggle, expand]);
}

/** What the tree may change. Every call may reject; the caller shows why. */
export interface ChatFolderActions {
  folders: ResearchChatProjectFolder[];
  onCreateFolder: (projectId: string, parentId: string | null) => Promise<ResearchChatProjectFolder | null>;
  onRenameFolder: (folder: ResearchChatProjectFolder, name: string) => Promise<void>;
  onMoveFolder: (folder: ResearchChatProjectFolder, parentId: string | null, index?: number) => Promise<void>;
  onDeleteFolder: (folder: ResearchChatProjectFolder) => Promise<void>;
  /** A folder files the chat (and moves it to the folder's project); null unfiles it. */
  onFileConversation: (conversation: ChatConversationSummary, folderId: string | null) => Promise<void>;
  onMoveConversation: (conversation: ChatConversationSummary, projectId: string | null) => Promise<void>;
}

export type FolderTreeRow =
  | { kind: 'root'; projectId: string; count: number }
  | { kind: 'folder'; folder: ResearchChatProjectFolder; depth: number; count: number; hasChildren: boolean; expanded: boolean }
  | { kind: 'unfiled'; projectId: string; count: number };

/** A project's tree, flattened in display order. "No folder" closes it once folders exist. */
export function folderTreeRows(projectId: string, folders: ResearchChatProjectFolder[], conversations: ChatConversationSummary[], expanded: ReadonlySet<string>, withRoot = false): FolderTreeRow[] {
  const children = folderChildren(folders, projectId);
  const rows: FolderTreeRow[] = [];
  if (withRoot) rows.push({ kind: 'root', projectId, count: conversationsInSelection(conversations, folders, projectId, null).length });
  const walk = (parentId: string | null, depth: number) => {
    for (const folder of children.get(parentId) ?? []) {
      const hasChildren = !!children.get(folder.id)?.length;
      const open = hasChildren && expanded.has(folder.id);
      rows.push({ kind: 'folder', folder, depth, hasChildren, expanded: open, count: conversationsInSelection(conversations, folders, projectId, folder.id).length });
      if (open) walk(folder.id, depth + 1);
    }
  };
  walk(null, 0);
  if (children.size) rows.push({ kind: 'unfiled', projectId, count: conversationsInSelection(conversations, folders, projectId, UNFILED_FOLDER).length });
  return rows;
}

// ── Dragging ────────────────────────────────────────────────────────────────
// What is being dragged lives here, not in dataTransfer: a dragover cannot read the
// payload, and both places are in one window.
type Dragged = { kind: 'chat'; conversation: ChatConversationSummary } | { kind: 'folder'; folder: ResearchChatProjectFolder };
let dragged: Dragged | null = null;
const DRAG_TYPE = 'application/x-nodus-research-chat';

function beginDrag(event: DragEvent, item: Dragged, label: string) {
  dragged = item;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData(DRAG_TYPE, item.kind);
  event.dataTransfer.setData('text/plain', label);
}
const endDrag = () => { dragged = null; };

/** Drag handlers for a chat row, in the history or on the project's page. */
export function chatDragProps(conversation: ChatConversationSummary) {
  return {
    draggable: true,
    onDragStart: (event: DragEvent) => beginDrag(event, { kind: 'chat', conversation }, conversation.title),
    onDragEnd: endDrag,
  };
}

type Zone = 'before' | 'inside' | 'after';

function siblingsIndex(folders: ResearchChatProjectFolder[], moving: ResearchChatProjectFolder, target: ResearchChatProjectFolder, zone: Zone): number {
  const siblings = (folderChildren(folders, target.projectId).get(target.parentId) ?? []).filter(folder => folder.id !== moving.id);
  return siblings.findIndex(folder => folder.id === target.id) + (zone === 'after' ? 1 : 0);
}

/** Whether the current drag may land on `target` in `zone`. */
function acceptsOnFolder(folders: ResearchChatProjectFolder[], target: ResearchChatProjectFolder, zone: Zone): boolean {
  if (!dragged) return false;
  if (dragged.kind === 'chat') return dragged.conversation.folderId !== target.id;
  const moving = dragged.folder;
  if (moving.id === target.id) return false;
  return canNestFolder(folders, moving, zone === 'inside' ? target.id : target.parentId);
}

/** Whether the current drag may land outside every folder of `projectId` (any project when null). */
function acceptsOutside(projectId: string | null): boolean {
  if (!dragged) return false;
  if (dragged.kind === 'chat') {
    const { conversation } = dragged;
    return (!!projectId && conversation.projectId !== projectId) || !!conversation.folderId;
  }
  return (!projectId || dragged.folder.projectId === projectId) && !!dragged.folder.parentId;
}

async function dropOutside(actions: ChatFolderActions, item: Dragged, projectId: string | null): Promise<void> {
  if (item.kind === 'chat') {
    if (projectId && item.conversation.projectId !== projectId) await actions.onMoveConversation(item.conversation, projectId);
    else if (item.conversation.folderId) await actions.onFileConversation(item.conversation, null);
  } else if (item.folder.parentId) await actions.onMoveFolder(item.folder, null);
}

/**
 * The free space of a project, or of the whole history: whatever is not a folder. A drop
 * there takes a chat out of its folder and a folder back to its project's root; on a
 * project's own row (projectId given) a chat from elsewhere joins that project.
 */
export function outsideDropProps(actions: ChatFolderActions, run: (action: () => Promise<unknown>) => void, projectId: string | null = null) {
  return {
    onDragOver: (event: DragEvent) => {
      if (!dragged || !acceptsOutside(projectId)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
    },
    onDrop: (event: DragEvent) => {
      const item = dragged;
      if (!item || !acceptsOutside(projectId)) return;
      event.preventDefault();
      event.stopPropagation();
      dragged = null;
      run(() => dropOutside(actions, item, projectId));
    },
  };
}

function useFolderDrop(folder: ResearchChatProjectFolder, actions: ChatFolderActions, run: (action: () => Promise<unknown>) => void, expand: (id: string) => void) {
  const [hint, setHint] = useState<Zone | null>(null);
  const zoneOf = (event: DragEvent): Zone => {
    if (dragged?.kind !== 'folder') return 'inside';
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const y = (event.clientY - box.top) / Math.max(1, box.height);
    return y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'inside';
  };
  return {
    hint,
    onDragOver: (event: DragEvent) => {
      if (!dragged) return;
      // A folder answers for itself: a refused drop must not fall through to the free
      // space behind it, which would move the folder to the root instead.
      event.stopPropagation();
      const zone = zoneOf(event);
      if (!acceptsOnFolder(actions.folders, folder, zone)) { setHint(null); return; }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setHint(zone);
    },
    onDragLeave: (event: DragEvent) => {
      if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) setHint(null);
    },
    onDrop: (event: DragEvent) => {
      event.stopPropagation();
      setHint(null);
      const item = dragged;
      if (!item) return;
      const zone = zoneOf(event);
      if (!acceptsOnFolder(actions.folders, folder, zone)) return;
      event.preventDefault();
      dragged = null;
      if (item.kind === 'chat') { run(() => actions.onFileConversation(item.conversation, folder.id)); return; }
      if (zone === 'inside') { expand(folder.id); run(() => actions.onMoveFolder(item.folder, folder.id)); return; }
      run(() => actions.onMoveFolder(item.folder, folder.parentId, siblingsIndex(actions.folders, item.folder, folder, zone)));
    },
  };
}

// ── Per-place interface: renaming, the ⋯ menu and the delete confirmation ──────

export interface FolderTreeUi {
  renaming: string | null;
  setRenaming: (folderId: string | null) => void;
  menuFolderId: string | null;
  openMenu: (folder: ResearchChatProjectFolder, anchor: DOMRect) => void;
  /** Create a folder and name it in place. */
  create: (projectId: string, parentId: string | null) => void;
  overlays: ReactNode;
}

/** Each place keeps its own rename field and menu; the tree's selection is shared. */
export function useFolderTreeUi(actions: ChatFolderActions, tree: ChatFolderTreeState, run: (action: () => Promise<unknown>) => void): FolderTreeUi {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ folder: ResearchChatProjectFolder; anchor: DOMRect } | null>(null);
  const [deleting, setDeleting] = useState<ResearchChatProjectFolder | null>(null);
  const create = (projectId: string, parentId: string | null) => run(async () => {
    const created = await actions.onCreateFolder(projectId, parentId);
    if (!created) return;
    if (parentId) tree.expand(parentId);
    setRenaming(created.id);
  });
  const overlays = <>
    {menu && <FloatingMenu anchor={menu.anchor} label={menu.folder.name} onClose={() => setMenu(null)}>
      <MenuItem icon="edit" label={t('Renombrar')} onSelect={() => { setMenu(null); setRenaming(menu.folder.id); }} />
      <MenuItem icon="folderPlus" label={t('Nueva subcarpeta')} onSelect={() => { setMenu(null); create(menu.folder.projectId, menu.folder.id); }} />
      {menu.folder.parentId && <MenuItem icon="arrowLeft" label={t('Sacar a la raíz del proyecto')} onSelect={() => { const { folder } = menu; setMenu(null); run(() => actions.onMoveFolder(folder, null)); }} />}
      <hr className="research-history-menu-separator" />
      <MenuItem icon="trash" danger label={t('Eliminar carpeta')} onSelect={() => { setMenu(null); setDeleting(menu.folder); }} />
    </FloatingMenu>}
    {deleting && <ConfirmModal
      title={t('Eliminar carpeta')}
      message={tx('Se eliminará «{name}» con sus subcarpetas. Sus chats no se borran: quedan en el proyecto, sin carpeta.', { name: deleting.name })}
      confirmLabel={t('Eliminar')}
      danger
      onConfirm={() => {
        const folder = deleting;
        setDeleting(null);
        if (tree.selection?.folderId === folder.id) tree.select({ projectId: folder.projectId, folderId: null });
        run(() => actions.onDeleteFolder(folder));
      }}
      onCancel={() => setDeleting(null)}
    />}
  </>;
  return { renaming, setRenaming, menuFolderId: menu?.folder.id ?? null, openMenu: (folder, anchor) => setMenu({ folder, anchor }), create, overlays };
}

// ── The row ─────────────────────────────────────────────────────────────────

const INDENT = 14;

/** One row of a project's tree: the project's root, a folder, or "No folder". */
export function FolderTreeRowView({ row, tree, ui, actions, run, baseIndent = 10, rootLabel }: {
  row: FolderTreeRow;
  tree: ChatFolderTreeState;
  ui: FolderTreeUi;
  actions: ChatFolderActions;
  run: (action: () => Promise<unknown>) => void;
  /** Left padding of a top-level folder, so the tree lines up with its surroundings. */
  baseIndent?: number;
  rootLabel?: string;
}) {
  if (row.kind !== 'folder') {
    const folderId = row.kind === 'unfiled' ? UNFILED_FOLDER : null;
    const selected = tree.selection?.projectId === row.projectId && tree.selection.folderId === folderId;
    const label = row.kind === 'unfiled' ? t('Sin carpeta') : rootLabel ?? t('Todos los chats');
    return <div className={`research-history-row research-folder-row ${selected ? 'is-active' : ''}`} style={{ paddingLeft: baseIndent }} data-marquee-host
      data-testid={row.kind === 'unfiled' ? `research-folder-unfiled-${row.projectId}` : `research-folder-root-${row.projectId}`}
      {...outsideDropProps(actions, run, row.projectId)}>
      <span className="research-folder-toggle" aria-hidden="true" />
      <button type="button" className="research-history-main" aria-pressed={selected} title={tx('{n} chat(s)', { n: row.count })}
        onClick={() => tree.select(selected && row.kind === 'unfiled' ? { projectId: row.projectId, folderId: null } : { projectId: row.projectId, folderId })}>
        <span className="shrink-0 text-neutral-500"><Icon name={row.kind === 'unfiled' ? 'inbox' : 'layers'} size={15} /></span>
        <MarqueeText text={label} className="min-w-0 flex-1" />
      </button>
      <span className="research-folder-count">{row.count}</span>
      {/* Where a folder has its ⋯, so every count lines up. */}
      <span className="research-folder-actions-spacer" aria-hidden="true" />
    </div>;
  }
  return <FolderRow row={row} tree={tree} ui={ui} actions={actions} run={run} baseIndent={baseIndent} />;
}

function FolderRow({ row, tree, ui, actions, run, baseIndent }: {
  row: Extract<FolderTreeRow, { kind: 'folder' }>; tree: ChatFolderTreeState; ui: FolderTreeUi; actions: ChatFolderActions;
  run: (action: () => Promise<unknown>) => void; baseIndent: number;
}) {
  const { folder } = row;
  const drop = useFolderDrop(folder, actions, run, tree.expand);
  const selected = tree.selection?.folderId === folder.id;
  const renaming = ui.renaming === folder.id;
  const select = () => tree.select(selected ? { projectId: folder.projectId, folderId: null } : { projectId: folder.projectId, folderId: folder.id });
  return <div className={`research-history-row research-folder-row group ${selected ? 'is-active' : ''} ${ui.menuFolderId === folder.id ? 'is-menu-open' : ''} ${drop.hint ? `is-drop-${drop.hint}` : ''}`}
    style={{ paddingLeft: baseIndent + row.depth * INDENT }} data-marquee-host data-testid={`research-folder-${folder.id}`}
    draggable={!renaming} onDragStart={event => beginDrag(event, { kind: 'folder', folder }, folder.name)} onDragEnd={endDrag}
    onDragOver={drop.onDragOver} onDragLeave={drop.onDragLeave} onDrop={drop.onDrop}>
    <button type="button" className={`research-folder-toggle ${row.expanded ? 'is-open' : ''}`} tabIndex={row.hasChildren ? 0 : -1}
      aria-label={row.expanded ? tx('Contraer {name}', { name: folder.name }) : tx('Desplegar {name}', { name: folder.name })} aria-expanded={row.hasChildren ? row.expanded : undefined}
      style={row.hasChildren ? undefined : { visibility: 'hidden' }} onClick={() => tree.toggle(folder.id)}><Icon name="chevronRight" size={12} /></button>
    {renaming
      ? <><span className="shrink-0 text-neutral-500"><Icon name="folder" size={15} /></span>
        <RenameField value={folder.name} onDone={name => {
          ui.setRenaming(null);
          if (name === null) return;
          // An emptied name is not a refusal: the folder takes the default one.
          const next = name || t('Nueva carpeta');
          if (next !== folder.name) run(() => actions.onRenameFolder(folder, next));
        }} /></>
      : <button type="button" className="research-history-main" aria-pressed={selected} title={tx('{n} chat(s)', { n: row.count })}
        onClick={select} onDoubleClick={() => { tree.select({ projectId: folder.projectId, folderId: folder.id }); ui.setRenaming(folder.id); }}>
        <span className="shrink-0 text-neutral-500"><Icon name="folder" size={15} /></span>
        <MarqueeText text={folder.name} className="min-w-0 flex-1" />
      </button>}
    {!renaming && <span className="research-folder-count">{row.count}</span>}
    <span className="research-history-row-actions">
      <button type="button" className="research-history-action" aria-label={t('Más acciones')} title={t('Más acciones')} aria-haspopup="menu"
        onClick={event => { event.stopPropagation(); ui.openMenu(folder, event.currentTarget.getBoundingClientRect()); }}><Icon name="moreVertical" size={14} /></button>
    </span>
  </div>;
}

// ── The project's page ──────────────────────────────────────────────────────

/** A project's page below its composer: the tree beside the chats of what it selects. */
export function ProjectFolderBrowser({ projectId, conversations, tree, actions, renderList }: {
  projectId: string;
  /** Every chat; the browser keeps the project's own. */
  conversations: ChatConversationSummary[];
  tree: ChatFolderTreeState;
  actions: ChatFolderActions;
  renderList: (conversations: ChatConversationSummary[]) => ReactNode;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const run = (action: () => Promise<unknown>) => {
    setNotice(null);
    void action().catch((reason: unknown) => setNotice(historyError(reason instanceof Error ? reason.message : String(reason))));
  };
  const ui = useFolderTreeUi(actions, tree, run);
  const inProject = useMemo(() => conversations.filter(conversation => conversation.projectId === projectId), [conversations, projectId]);
  const rows = useMemo(() => folderTreeRows(projectId, actions.folders, inProject, tree.expanded, true), [projectId, actions.folders, inProject, tree.expanded]);
  const folderId = tree.selection?.projectId === projectId ? tree.selection.folderId : null;
  const shown = conversationsInSelection(inProject, actions.folders, projectId, folderId);
  const heading = folderId === UNFILED_FOLDER ? t('Sin carpeta') : actions.folders.find(folder => folder.id === folderId)?.name ?? t('Todos los chats');
  // A folder chosen in another project, or one gone with its parent, leaves nothing to show.
  useEffect(() => {
    if (folderId && folderId !== UNFILED_FOLDER && !actions.folders.some(folder => folder.id === folderId)) tree.select({ projectId, folderId: null });
  }, [folderId, actions.folders, projectId, tree]);
  return <div className="research-project-browser" data-testid="research-project-browser" {...outsideDropProps(actions, run, projectId)}>
    <nav className="research-project-tree" aria-label={t('Carpetas')} data-testid="research-project-tree">
      <div className="research-project-tree-head">
        <span>{t('Carpetas')}</span>
        <button type="button" className="research-history-action" data-testid="research-new-folder" aria-label={t('Nueva carpeta')} title={t('Nueva carpeta')}
          onClick={() => ui.create(projectId, null)}><Icon name="folderPlus" size={15} /></button>
      </div>
      {rows.map(row => <FolderTreeRowView key={row.kind === 'folder' ? row.folder.id : row.kind} row={row} tree={tree} ui={ui} actions={actions} run={run} baseIndent={6} />)}
      {rows.length === 1 && <p className="research-project-tree-empty">{t('Crea carpetas para ordenar los chats del proyecto. Arrastra un chat sobre una carpeta para guardarlo en ella.')}</p>}
    </nav>
    <section className="research-project-browser-list" aria-label={heading}>
      <h3 className="research-project-browser-heading"><MarqueeText text={heading} className="min-w-0 flex-1" /></h3>
      {notice && <p role="alert" className="px-3 text-[11px] text-amber-500">{notice}</p>}
      {renderList(shown)}
    </section>
    {ui.overlays}
  </div>;
}
