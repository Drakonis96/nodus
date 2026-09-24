import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ChatConversationSummary, ResearchChatProject } from '@shared/types';
import type { ResearchNotebook } from '@shared/researchCorpus';
import { VirtualList } from './VirtualList';
import { ConfirmModal } from './ConfirmModal';
import { Icon } from './ui';
import { useDismissableLayer } from '../hooks';
import { t, tx } from '../i18n';

/** The colours a project can take, plus any custom one. */
export const PROJECT_COLORS = ['#171717', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899'];
/** Icons a project can take. Every name exists in the shared icon set. */
export const PROJECT_ICONS = [
  'folder', 'book', 'bookOpen', 'notebook', 'library', 'bookmark', 'graduation', 'quote', 'edit', 'highlighter',
  'code', 'tools', 'palette', 'image', 'video', 'audio', 'microphone', 'presentation', 'chartBar', 'table',
  'calendar', 'clock', 'flask', 'telescope', 'bulb', 'target', 'compass', 'globe', 'map', 'mapPin',
  'scale', 'network', 'tree', 'users', 'user', 'building', 'home', 'flag', 'star', 'sparkles',
  'archive', 'tag', 'mail', 'chat', 'shield', 'key', 'puzzle', 'cube', 'layers', 'sun',
  'moon', 'bell', 'anchor', 'truck', 'languages', 'rss', 'bug', 'plug', 'inbox', 'ruler',
];

export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return t('ahora');
  if (minutes < 60) return tx('hace {n} min', { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return tx('hace {n} h', { n: hours });
  const days = Math.round(hours / 24);
  if (days < 7) return tx('hace {n} d', { n: days });
  return new Date(iso).toLocaleDateString();
}

const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();

type Row =
  | { kind: 'header'; id: string; label: string }
  | { kind: 'project'; project: ResearchChatProject; expanded: boolean; count: number }
  | { kind: 'chat'; conversation: ChatConversationSummary; nested: boolean }
  | { kind: 'notebook'; notebook: ResearchNotebook }
  | { kind: 'empty'; id: string; label: string };

export interface ResearchChatSidebarProps {
  conversations: ChatConversationSummary[];
  projects: ResearchChatProject[];
  notebooks: ResearchNotebook[];
  /** Projects and pins exist only where the transport stores them. */
  supportsProjects: boolean;
  notebooksOn: boolean;
  activeId: string | null;
  activeProjectId: string | null;
  sending: boolean;
  archivedCount: number;
  showArchived: boolean;
  onToggleArchived: () => void;
  onNewConversation: () => void;
  onNewNotebook: () => void;
  onNewProject: () => Promise<ResearchChatProject | null>;
  onOpenConversation: (id: string) => void;
  onOpenProject: (id: string) => void;
  onSelectNotebook: (id: string) => void;
  onRenameConversation?: (conversation: ChatConversationSummary, title: string) => Promise<void>;
  onPinConversation: (conversation: ChatConversationSummary, pinned: boolean) => Promise<void>;
  onArchiveConversation?: (conversation: ChatConversationSummary) => Promise<void>;
  onDeleteConversation: (conversation: ChatConversationSummary) => void;
  onMoveConversation: (conversation: ChatConversationSummary, projectId: string | null) => Promise<void>;
  onUpdateProject: (project: ResearchChatProject, patch: { name?: string; icon?: string | null; color?: string | null }) => Promise<void>;
  onDeleteProject: (project: ResearchChatProject) => Promise<void>;
}

/** The research chat history: tools, search, then Projects, Pinned and the other chats. */
export function ResearchChatSidebar(props: ResearchChatSidebarProps) {
  const { conversations, projects, notebooks, supportsProjects, notebooksOn, activeId, activeProjectId, sending } = props;
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ kind: 'chat'; conversation: ChatConversationSummary; anchor: DOMRect } | { kind: 'project'; project: ResearchChatProject; anchor: DOMRect } | null>(null);
  const [styling, setStyling] = useState<ResearchChatProject | null>(null);
  const [deletingProject, setDeletingProject] = useState<ResearchChatProject | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const projectById = useMemo(() => new Map(projects.map(project => [project.id, project])), [projects]);

  const rows = useMemo<Row[]>(() => {
    const needle = fold(query.trim());
    if (needle) {
      const out: Row[] = [];
      const matchedProjects = supportsProjects ? projects.filter(project => fold(project.name).includes(needle)) : [];
      const matchedNotebooks = notebooksOn ? notebooks.filter(notebook => fold(notebook.name).includes(needle)) : [];
      const matchedChats = conversations.filter(conversation => fold(conversation.title).includes(needle)
        || (conversation.projectId && fold(projectById.get(conversation.projectId)?.name ?? '').includes(needle)));
      if (matchedProjects.length) out.push({ kind: 'header', id: 'h-projects', label: t('Proyectos') }, ...matchedProjects.map(project => ({ kind: 'project' as const, project, expanded: false, count: 0 })));
      if (matchedNotebooks.length) out.push({ kind: 'header', id: 'h-notebooks', label: t('Cuadernos') }, ...matchedNotebooks.map(notebook => ({ kind: 'notebook' as const, notebook })));
      if (matchedChats.length) out.push({ kind: 'header', id: 'h-chats', label: t('Chats') }, ...matchedChats.map(conversation => ({ kind: 'chat' as const, conversation, nested: false })));
      if (!out.length) out.push({ kind: 'empty', id: 'no-results', label: t('Sin resultados') });
      return out;
    }
    const out: Row[] = [];
    const inProject = new Map<string, ChatConversationSummary[]>();
    if (supportsProjects) for (const conversation of conversations) if (conversation.projectId && projectById.has(conversation.projectId)) {
      inProject.set(conversation.projectId, [...(inProject.get(conversation.projectId) ?? []), conversation]);
    }
    if (supportsProjects && projects.length) {
      out.push({ kind: 'header', id: 'h-projects', label: t('Proyectos') });
      for (const project of projects) {
        const chats = inProject.get(project.id) ?? [];
        const open = expanded.has(project.id);
        out.push({ kind: 'project', project, expanded: open, count: chats.length });
        if (open) out.push(...chats.map(conversation => ({ kind: 'chat' as const, conversation, nested: true })));
      }
    }
    const pinned = supportsProjects ? conversations.filter(conversation => conversation.pinnedAt && !conversation.archived)
      .sort((a, b) => (a.pinnedAt ?? '').localeCompare(b.pinnedAt ?? '')) : [];
    if (pinned.length) out.push({ kind: 'header', id: 'h-pinned', label: t('Chats destacados') }, ...pinned.map(conversation => ({ kind: 'chat' as const, conversation, nested: false })));
    const rest = conversations.filter(conversation => !(supportsProjects && conversation.pinnedAt && !conversation.archived)
      && !(supportsProjects && conversation.projectId && projectById.has(conversation.projectId)));
    if (rest.length) {
      if (out.length) out.push({ kind: 'header', id: 'h-chats', label: t('Chats') });
      out.push(...rest.map(conversation => ({ kind: 'chat' as const, conversation, nested: false })));
    }
    return out;
  }, [query, conversations, projects, notebooks, supportsProjects, notebooksOn, projectById, expanded]);

  const toggleProject = (id: string) => setExpanded(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const run = (action: () => Promise<unknown>) => {
    setNotice(null);
    void action().catch((reason: unknown) => {
      const message = reason instanceof Error ? reason.message : String(reason);
      setNotice(message.includes('research_chat_pin_limit')
        ? tx('Solo puedes destacar {n} chats. Quita uno para destacar otro.', { n: 5 })
        : message);
    });
  };
  const newProject = () => run(async () => {
    const created = await props.onNewProject();
    if (created) { setQuery(''); setRenaming(`project:${created.id}`); }
  });

  return (
    <>
      <div className="research-chat-history-tools">
        <div className="flex items-center gap-1">
          <button type="button" className="research-chat-history-tool" data-testid="research-new-conversation" onClick={props.onNewConversation} disabled={sending} aria-label={t('Nueva conversación')} title={t('Nueva conversación')}><Icon name="plus" size={16} /></button>
          {notebooksOn && <button type="button" className="research-chat-history-tool" data-testid="research-new-notebook" onClick={props.onNewNotebook} aria-label={t('Nuevo cuaderno')} title={t('Nuevo cuaderno')}><Icon name="notebook" size={16} /></button>}
          {supportsProjects && <button type="button" className="research-chat-history-tool" data-testid="research-new-project" onClick={newProject} aria-label={t('Nuevo proyecto')} title={t('Nuevo proyecto')}><Icon name="folderPlus" size={16} /></button>}
        </div>
        <label className="research-chat-search">
          <Icon name="search" size={14} aria-hidden="true" />
          <input data-testid="research-chat-search" type="search" value={query} onChange={event => setQuery(event.target.value)}
            placeholder={t('Buscar…')}
            title={notebooksOn ? t('Buscar chats, proyectos, cuadernos…') : supportsProjects ? t('Buscar chats y proyectos…') : t('Buscar chats…')}
            aria-label={t('Buscar en el historial')} />
        </label>
        {notice && <p role="alert" className="text-[11px] text-amber-500">{notice}</p>}
      </div>
      <VirtualList
        items={rows}
        itemHeight={row => row.kind === 'header' ? 30 : 38}
        getKey={row => row.kind === 'project' ? `p:${row.project.id}` : row.kind === 'chat' ? `c:${row.conversation.id}` : row.kind === 'notebook' ? `n:${row.notebook.id}` : row.id}
        className="flex-1 min-h-0 px-2 pb-2"
        empty={<div className="px-2 py-6 text-center text-xs text-neutral-600">{t('Aún no hay conversaciones. Escribe abajo para empezar.')}</div>}
        renderItem={row => {
          if (row.kind === 'header') return <div className="research-history-heading">{row.label}</div>;
          if (row.kind === 'empty') return <div className="research-history-empty px-2 py-2 text-xs text-neutral-500">{row.label}</div>;
          if (row.kind === 'notebook') return (
            <button type="button" className="research-history-row" data-testid={`research-search-notebook-${row.notebook.id}`} onClick={() => { setQuery(''); props.onSelectNotebook(row.notebook.id); }}>
              <Icon name="notebook" size={14} className="shrink-0 text-neutral-500" />
              <span className="min-w-0 flex-1 truncate text-left">{row.notebook.name}</span>
            </button>
          );
          if (row.kind === 'project') {
            const { project } = row;
            const key = `project:${project.id}`;
            return (
              <div className={`research-history-row group ${activeProjectId === project.id && !activeId ? 'is-active' : ''} ${menu?.kind === 'project' && menu.project.id === project.id ? 'is-menu-open' : ''}`}
                data-testid={`research-project-${project.id}`} role="button" tabIndex={0} aria-expanded={row.expanded}
                onClick={() => { if (renaming !== key) toggleProject(project.id); }}
                onKeyDown={event => { if (renaming !== key && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); toggleProject(project.id); } }}
                title={tx('{n} chat(s)', { n: row.count })}>
                <span className="shrink-0" style={{ color: project.color ?? undefined }}><Icon name={project.icon ?? 'folder'} size={15} /></span>
                {renaming === key
                  ? <RenameField value={project.name} onDone={name => { setRenaming(null); if (name && name !== project.name) run(() => props.onUpdateProject(project, { name })); }} />
                  : <span className="min-w-0 flex-1 truncate">{project.name}</span>}
                <span className="research-history-row-actions">
                  <button type="button" className="research-history-action" aria-label={tx('Abrir {name}', { name: project.name })} title={t('Nuevo chat en el proyecto')}
                    onClick={event => { event.stopPropagation(); props.onOpenProject(project.id); }}><Icon name="edit" size={14} /></button>
                  <button type="button" className="research-history-action" aria-label={t('Más acciones')} title={t('Más acciones')} aria-haspopup="menu"
                    onClick={event => { event.stopPropagation(); setMenu({ kind: 'project', project, anchor: event.currentTarget.getBoundingClientRect() }); }}><Icon name="menu" size={14} /></button>
                </span>
              </div>
            );
          }
          const { conversation } = row;
          const key = `chat:${conversation.id}`;
          const pinned = !!conversation.pinnedAt && !conversation.archived;
          return (
            <div className={`research-history-row group ${row.nested ? 'is-nested' : ''} ${conversation.id === activeId ? 'is-active' : ''} ${pinned ? 'is-pinned' : ''} ${menu?.kind === 'chat' && menu.conversation.id === conversation.id ? 'is-menu-open' : ''}`}
              data-testid={`research-conversation-${conversation.id}`} role="button" tabIndex={0}
              title={`${formatRelative(conversation.updated_at)} · ${tx('{n} mensaje(s)', { n: conversation.messageCount })}`}
              onClick={() => { if (renaming !== key && !sending) props.onOpenConversation(conversation.id); }}
              onKeyDown={event => { if (renaming !== key && !sending && event.key === 'Enter') props.onOpenConversation(conversation.id); }}>
              {renaming === key
                ? <RenameField value={conversation.title} onDone={title => { setRenaming(null); if (title && title !== conversation.title && props.onRenameConversation) run(() => props.onRenameConversation!(conversation, title)); }} />
                : <span className={`min-w-0 flex-1 truncate ${conversation.archived ? 'italic text-neutral-500' : ''}`}>{conversation.title}</span>}
              <span className="research-history-row-actions">
                {supportsProjects && !conversation.archived && <button type="button" className={`research-history-action ${pinned ? 'is-on' : ''}`} aria-pressed={pinned}
                  aria-label={pinned ? t('Quitar de destacados') : t('Destacar chat')} title={pinned ? t('Quitar de destacados') : t('Destacar chat')}
                  onClick={event => { event.stopPropagation(); run(() => props.onPinConversation(conversation, !pinned)); }}><Icon name="pin" size={14} /></button>}
                <button type="button" className="research-history-action" aria-label={t('Más acciones')} title={t('Más acciones')} aria-haspopup="menu"
                  onClick={event => { event.stopPropagation(); setMenu({ kind: 'chat', conversation, anchor: event.currentTarget.getBoundingClientRect() }); }}><Icon name="menu" size={14} /></button>
              </span>
            </div>
          );
        }}
      />
      {props.archivedCount > 0 && (
        <button className="flex items-center gap-1.5 border-t border-neutral-800 px-3 py-2 text-left text-xs text-neutral-500 hover:text-neutral-300" onClick={props.onToggleArchived}>
          <Icon name="archive" size={13} />
          {props.showArchived ? t('Ocultar archivadas') : tx('Ver archivadas ({n})', { n: props.archivedCount })}
        </button>
      )}
      {menu?.kind === 'chat' && <ChatMenu {...props} conversation={menu.conversation} anchor={menu.anchor} onClose={() => setMenu(null)}
        onRename={() => setRenaming(`chat:${menu.conversation.id}`)} run={run} />}
      {menu?.kind === 'project' && <FloatingMenu anchor={menu.anchor} label={menu.project.name} onClose={() => setMenu(null)}>
        <MenuItem icon="edit" label={t('Renombrar')} onSelect={() => { setMenu(null); setRenaming(`project:${menu.project.id}`); }} />
        <MenuItem icon="palette" label={t('Icono y color')} onSelect={() => { setMenu(null); setStyling(menu.project); }} />
        <hr className="research-history-menu-separator" />
        <MenuItem icon="trash" danger label={t('Eliminar proyecto')} onSelect={() => { setMenu(null); setDeletingProject(menu.project); }} />
      </FloatingMenu>}
      {styling && <ProjectStyleDialog project={projectById.get(styling.id) ?? styling} onClose={() => setStyling(null)}
        onChange={patch => run(() => props.onUpdateProject(projectById.get(styling.id) ?? styling, patch))} />}
      {deletingProject && <ConfirmModal
        title={t('Eliminar proyecto')}
        message={tx('Se eliminará «{name}». Sus chats no se borran: vuelven al historial general.', { name: deletingProject.name })}
        confirmLabel={t('Eliminar')}
        danger
        onConfirm={() => { const project = deletingProject; setDeletingProject(null); run(() => props.onDeleteProject(project)); }}
        onCancel={() => setDeletingProject(null)}
      />}
    </>
  );
}

function RenameField({ value, onDone }: { value: string; onDone: (value: string | null) => void }) {
  const [draft, setDraft] = useState(value);
  const done = useRef(false);
  const finish = (next: string | null) => { if (done.current) return; done.current = true; onDone(next); };
  return <input className="research-history-rename" autoFocus value={draft} aria-label={t('Nuevo nombre')}
    onFocus={event => event.currentTarget.select()}
    onClick={event => event.stopPropagation()}
    onChange={event => setDraft(event.target.value)}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Enter') finish(draft.trim() || null);
      if (event.key === 'Escape') finish(null);
    }}
    onBlur={() => finish(draft.trim() || null)} />;
}

function ChatMenu({ conversation, anchor, onClose, onRename, run, projects, supportsProjects, ...props }: ResearchChatSidebarProps & {
  conversation: ChatConversationSummary; anchor: DOMRect; onClose: () => void; onRename: () => void; run: (action: () => Promise<unknown>) => void;
}) {
  const [moving, setMoving] = useState(false);
  const pinned = !!conversation.pinnedAt && !conversation.archived;
  const act = (action: () => Promise<unknown> | void) => { onClose(); run(async () => { await action(); }); };
  return <FloatingMenu anchor={anchor} label={conversation.title} onClose={onClose}>
    {moving ? <>
      <MenuItem icon="arrowLeft" label={t('Mover a proyecto')} onSelect={() => setMoving(false)} />
      <hr className="research-history-menu-separator" />
      {conversation.projectId && <MenuItem icon="x" label={t('Sacar del proyecto')} onSelect={() => act(() => props.onMoveConversation(conversation, null))} />}
      {projects.map(project => <MenuItem key={project.id} icon={project.icon ?? 'folder'} color={project.color} label={project.name} checked={project.id === conversation.projectId}
        onSelect={() => act(() => project.id === conversation.projectId ? undefined : props.onMoveConversation(conversation, project.id))} />)}
      <MenuItem icon="folderPlus" label={t('Nuevo proyecto')} onSelect={() => act(async () => {
        const created = await props.onNewProject();
        if (created) await props.onMoveConversation(conversation, created.id);
      })} />
    </> : <>
      {props.onRenameConversation && <MenuItem icon="edit" label={t('Renombrar')} onSelect={() => { onClose(); onRename(); }} />}
      {props.onRenameConversation && <hr className="research-history-menu-separator" />}
      {supportsProjects && !conversation.archived && <MenuItem icon="pin" label={pinned ? t('Quitar de destacados') : t('Destacar chat')} onSelect={() => act(() => props.onPinConversation(conversation, !pinned))} />}
      {props.onArchiveConversation && <MenuItem icon="archive" label={conversation.archived ? t('Desarchivar') : t('Archivar')} onSelect={() => act(() => props.onArchiveConversation!(conversation))} />}
      <MenuItem icon="trash" danger label={t('Eliminar')} onSelect={() => { onClose(); props.onDeleteConversation(conversation); }} />
      {supportsProjects && <>
        <hr className="research-history-menu-separator" />
        <MenuItem icon="folderMove" label={t('Mover a proyecto')} trailing={<Icon name="chevronRight" size={13} />} keepOpen onSelect={() => setMoving(true)} />
      </>}
    </>}
  </FloatingMenu>;
}

function FloatingMenu({ anchor, label, onClose, children }: { anchor: DOMRect; label: string; onClose: () => void; children: ReactNode }) {
  const ref = useDismissableLayer<HTMLDivElement>({ open: true, onDismiss: onClose, group: 'research-history-menu' });
  const [position, setPosition] = useState({ top: anchor.bottom + 4, left: anchor.left });
  useEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    setPosition({
      top: anchor.bottom + 4 + height > window.innerHeight - 8 ? Math.max(8, anchor.top - height - 4) : anchor.bottom + 4,
      left: Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8)),
    });
    menu.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [anchor, children, ref]);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };
  return createPortal(
    <div ref={ref} role="menu" aria-label={label} className="research-history-menu" style={{ top: position.top, left: position.left }} onKeyDown={onKeyDown}>{children}</div>,
    document.body,
  );
}

function MenuItem({ icon, label, onSelect, danger = false, checked = false, color, trailing, keepOpen = false }: {
  icon: string; label: string; onSelect: () => void; danger?: boolean; checked?: boolean; color?: string | null; trailing?: ReactNode; keepOpen?: boolean;
}) {
  return <button type="button" role="menuitem" data-keep-open={keepOpen || undefined} className={`research-history-menu-item ${danger ? 'is-danger' : ''}`} onClick={onSelect}>
    <span className="shrink-0" style={{ color: color ?? undefined }}><Icon name={icon} size={15} /></span>
    <span className="min-w-0 flex-1 truncate text-left">{label}</span>
    {checked && <Icon name="check" size={13} className="shrink-0" />}
    {trailing}
  </button>;
}

/** Colour and icon of a project; each choice applies at once. */
function ProjectStyleDialog({ project, onClose, onChange }: { project: ResearchChatProject; onClose: () => void; onChange: (patch: { icon?: string; color?: string | null }) => void }) {
  const ref = useDismissableLayer<HTMLDivElement>({ open: true, onDismiss: onClose, group: 'research-project-style' });
  const custom = project.color && !PROJECT_COLORS.includes(project.color);
  return createPortal(
    <div className="research-project-style-backdrop">
      <div ref={ref} role="dialog" aria-modal="true" aria-label={t('Icono y color')} data-testid="research-project-style" className="research-project-style">
        <div className="flex flex-wrap gap-3">
          {PROJECT_COLORS.map(color => <button key={color} type="button" className={`research-project-swatch ${project.color === color ? 'is-selected' : ''}`}
            style={{ backgroundColor: color }} aria-label={color} aria-pressed={project.color === color} onClick={() => onChange({ color })} />)}
          <label className={`research-project-swatch is-custom ${custom ? 'is-selected' : ''}`} title={t('Color personalizado')}>
            <input type="color" value={project.color ?? '#3b82f6'} aria-label={t('Color personalizado')} onChange={event => onChange({ color: event.target.value.toLowerCase() })} />
          </label>
          {project.color && <button type="button" className="research-project-swatch is-none" aria-label={t('Sin color')} title={t('Sin color')} onClick={() => onChange({ color: null })}><Icon name="x" size={14} /></button>}
        </div>
        <hr className="research-history-menu-separator" />
        <div className="research-project-icons">
          {PROJECT_ICONS.map(icon => <button key={icon} type="button" className={`research-project-icon ${(project.icon ?? 'folder') === icon ? 'is-selected' : ''}`}
            aria-label={icon} aria-pressed={(project.icon ?? 'folder') === icon} onClick={() => onChange({ icon })}><Icon name={icon} size={18} /></button>)}
        </div>
        <hr className="research-history-menu-separator" />
        <button type="button" className="research-history-menu-item" onClick={onClose}>{t('Cerrar')}</button>
      </div>
    </div>,
    document.body,
  );
}
