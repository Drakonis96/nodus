import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Icon, ModalBackdrop } from '../components/ui';
import { FloatingMenu } from '../components/ResearchChatHistoryMenu';
import { t, tx } from '../i18n';
import { folderCount, folderPath, folderSubtreeIds, type Presentation, type PresenterFolder, type PresenterFolderDeleteMode, type PresenterLibrary } from '@shared/presenterTypes';
import { PRESENTER_DRAG_TYPE } from '../lib/presenter/drag';

const FOLDER_ICONS = [
  ['folder', 'Carpeta'], ['archive', 'Archivo'], ['book', 'Libro'], ['graduation', 'Educación'],
  ['presentation', 'Presentación'], ['flask', 'Ciencia'], ['globe', 'Mundo'], ['image', 'Imagen'],
  ['palette', 'Arte'], ['calendar', 'Calendario'], ['star', 'Favoritos'], ['home', 'Inicio'],
] as const;
const COLORS = ['#6366f1', '#8b5cf6', '#2563eb', '#0891b2', '#059669', '#b45309', '#dc2626', '#db2777'];

export function PresenterFolderNavigation({ library, currentId, onNavigate, onCreate, onEdit, onDelete, onMove }: {
  library: PresenterLibrary;
  currentId: string | null;
  onNavigate: (id: string | null) => void;
  onCreate: (parentId: string | null) => void;
  onEdit: (folder: PresenterFolder) => void;
  onDelete: (folder: PresenterFolder) => void;
  onMove: (presentationId: string, folderId: string | null) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ folder: PresenterFolder; anchor: DOMRect } | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string | null } | null>(null);
  const expandTimer = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const cancelExpansion = useCallback(() => {
    if (expandTimer.current) clearTimeout(expandTimer.current.timer);
    expandTimer.current = null;
  }, []);
  useEffect(() => {
    const clear = () => { setDropTarget(null); cancelExpansion(); };
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    return () => { cancelExpansion(); window.removeEventListener('dragend', clear); window.removeEventListener('drop', clear); };
  }, [cancelExpansion]);
  useEffect(() => {
    setExpanded(previous => new Set([...previous, ...folderPath(library, currentId).map(f => f.id)]));
  }, [currentId, library.folders]);
  const children = useMemo(() => {
    const map = new Map<string | null, PresenterFolder[]>();
    for (const folder of library.folders) map.set(folder.parentId, [...map.get(folder.parentId) ?? [], folder]);
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return map;
  }, [library.folders]);
  const dropHandlers = (id: string | null, canExpand = false) => ({
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!event.dataTransfer.types.includes(PRESENTER_DRAG_TYPE)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
      setDropTarget(previous => previous?.id === id ? previous : { id });
      if (canExpand && id && !expanded.has(id) && expandTimer.current?.id !== id) {
        cancelExpansion();
        expandTimer.current = { id, timer: setTimeout(() => {
          setExpanded(previous => new Set([...previous, id]));
          expandTimer.current = null;
        }, 600) };
      }
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
      setDropTarget(previous => previous?.id === id ? null : previous);
      cancelExpansion();
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      if (!event.dataTransfer.types.includes(PRESENTER_DRAG_TYPE)) return;
      event.preventDefault();
      event.stopPropagation();
      setDropTarget(null);
      cancelExpansion();
      const presentationId = event.dataTransfer.getData(PRESENTER_DRAG_TYPE);
      if (library.presentations.some(p => p.id === presentationId)) onMove(presentationId, id);
    },
  });
  const renderFolders = (parentId: string | null): ReactNode => (children.get(parentId) ?? []).map(folder => {
    const hasChildren = Boolean(children.get(folder.id)?.length);
    const open = expanded.has(folder.id);
    return <li key={folder.id}>
      <div className="presenter-folder-row" data-active={currentId === folder.id} data-folder-id={folder.id} data-drop-active={dropTarget?.id === folder.id} {...dropHandlers(folder.id, hasChildren)}>
        {hasChildren ? <button type="button" className="presenter-folder-expand" aria-label={t(open ? 'Contraer carpeta' : 'Expandir carpeta')} aria-expanded={open} onClick={() => setExpanded(previous => { const next = new Set(previous); if (open) next.delete(folder.id); else next.add(folder.id); return next; })}><Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} /></button> : <span className="presenter-folder-expand" />}
        <button type="button" className="presenter-folder-select" data-testid="presenter-folder-nav" aria-current={currentId === folder.id ? 'page' : undefined} onClick={() => onNavigate(folder.id)} title={folder.name}>
          <span style={{ color: folder.color }}><Icon name={folder.icon} size={17} /></span><span className="truncate">{folder.name}</span><span className="presenter-folder-count">{folderCount(library, folder.id, true)}</span>
        </button>
        <button type="button" className="presenter-folder-menu" title={t('Más opciones')} aria-label={tx('Opciones de la carpeta {name}', { name: folder.name })} aria-haspopup="menu" aria-expanded={menu?.folder.id === folder.id} data-testid="presenter-folder-menu" onClick={event => setMenu({ folder, anchor: event.currentTarget.getBoundingClientRect() })}><Icon name="moreVertical" size={15} /></button>
      </div>
      {hasChildren && open && <ul className="presenter-folder-children">{renderFolders(folder.id)}</ul>}
    </li>;
  });
  return <>
    <nav className="presenter-folders" aria-label={t('Carpetas')} data-testid="presenter-folders">
      <button type="button" className="presenter-folder-root" data-active={currentId === null} data-drop-active={dropTarget?.id === null} aria-current={currentId === null ? 'page' : undefined} data-testid="presenter-folder-root" onClick={() => onNavigate(null)} {...dropHandlers(null)}><Icon name="home" size={17} /><span>{t('Biblioteca principal')}</span><span className="presenter-folder-count">{folderCount(library, null)}</span></button>
      <ul>{renderFolders(null)}</ul>
    </nav>
    {menu && <FloatingMenu anchor={menu.anchor} label={t('Más opciones')} onClose={() => setMenu(null)}>
      <button type="button" role="menuitem" className="research-history-menu-item" onClick={() => { onCreate(menu.folder.id); setMenu(null); }}><Icon name="folderPlus" size={16} /><span>{t('Añadir subcarpeta')}</span></button>
      <button type="button" role="menuitem" className="research-history-menu-item" data-testid="presenter-edit-folder" onClick={() => { onEdit(menu.folder); setMenu(null); }}><Icon name="edit" size={16} /><span>{t('Editar carpeta')}</span></button>
      <button type="button" role="menuitem" className="research-history-menu-item is-danger" data-testid="presenter-delete-folder" onClick={() => { onDelete(menu.folder); setMenu(null); }}><Icon name="trash" size={16} /><span>{t('Eliminar carpeta')}</span></button>
    </FloatingMenu>}
  </>;
}

function trapFocus(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== 'Tab') return;
  const elements = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')).filter(el => el.getClientRects().length);
  const first = elements[0], last = elements[elements.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}

function useRestoreFocus() {
  const previous = useRef(document.activeElement);
  useEffect(() => () => { if (previous.current instanceof HTMLElement && previous.current.isConnected) previous.current.focus(); }, []);
}

export function PresenterFolderEditor({ library, folder, parentId, onSave, onClose }: {
  library: PresenterLibrary;
  folder?: PresenterFolder;
  parentId: string | null;
  onSave: (draft: Pick<PresenterFolder, 'name' | 'icon' | 'color' | 'parentId'>) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(folder?.name ?? '');
  const [icon, setIcon] = useState(folder?.icon ?? 'folder');
  const [color, setColor] = useState(folder?.color ?? COLORS[0]);
  const [parent, setParent] = useState(folder?.parentId ?? parentId);
  const excluded = folder ? folderSubtreeIds(library, folder.id) : new Set<string>();
  useRestoreFocus();
  return createPortal(<ModalBackdrop onClose={onClose}>
    <form role="dialog" aria-modal="true" aria-labelledby="presenter-folder-editor-title" data-testid="presenter-folder-editor" className="presenter-workspace presenter-folder-modal card-modal" onKeyDown={trapFocus} onSubmit={event => { event.preventDefault(); if (name.trim()) onSave({ name: name.trim(), icon, color, parentId: parent }); }}>
      <div className="presenter-folder-modal-heading"><span style={{ color }}><Icon name={icon} size={26} /></span><h2 id="presenter-folder-editor-title">{t(folder ? 'Editar carpeta' : 'Nueva carpeta')}</h2></div>
      <label>{t('Nombre de la carpeta')}<input autoFocus value={name} maxLength={160} required onChange={event => setName(event.target.value)} className="input" data-testid="presenter-folder-name" /></label>
      <label>{t('Carpeta principal')}<select value={parent ?? ''} onChange={event => setParent(event.target.value || null)} className="input" data-testid="presenter-folder-parent"><option value="">{t('Biblioteca principal')}</option>{library.folders.filter(f => !excluded.has(f.id)).map(f => <option key={f.id} value={f.id}>{folderPath(library, f.id).map(entry => entry.name).join(' / ')}</option>)}</select></label>
      <fieldset><legend>{t('Icono')}</legend><div className="presenter-folder-icons">{FOLDER_ICONS.map(([value, label]) => <button type="button" key={value} title={t(label)} aria-label={t(label)} aria-pressed={icon === value} onClick={() => setIcon(value)} style={{ color }}><Icon name={value} size={20} /></button>)}</div></fieldset>
      <fieldset><legend>{t('Color')}</legend><div className="presenter-folder-colors">{COLORS.map(value => <button type="button" key={value} title={value} aria-label={value} aria-pressed={color.toLowerCase() === value} onClick={() => setColor(value)} style={{ '--folder-color': value } as CSSProperties}>{color.toLowerCase() === value && <Icon name="check" size={15} />}</button>)}<input type="color" value={color} onChange={event => setColor(event.target.value)} aria-label={t('Color personalizado')} title={t('Color personalizado')} data-testid="presenter-folder-color" /></div></fieldset>
      <div className="presenter-folder-modal-actions"><button type="button" className="presenter-action" onClick={onClose}>{t('Cancelar')}</button><button type="submit" className="presenter-action presenter-action-violet" disabled={!name.trim()} data-testid="presenter-folder-save">{t(folder ? 'Guardar' : 'Crear')}</button></div>
    </form>
  </ModalBackdrop>, document.body);
}

export function PresenterFolderDeleteDialog({ folder, library, busy, onDelete, onClose }: {
  folder: PresenterFolder;
  library: PresenterLibrary;
  busy: boolean;
  onDelete: (mode: PresenterFolderDeleteMode) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<PresenterFolderDeleteMode>('move-to-root');
  const count = folderCount(library, folder.id, true);
  const subfolders = folderSubtreeIds(library, folder.id).size - 1;
  useRestoreFocus();
  return createPortal(<ModalBackdrop onClose={() => { if (!busy) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="presenter-folder-delete-title" data-testid="presenter-delete-folder-modal" className="presenter-workspace presenter-folder-modal card-modal" onKeyDown={trapFocus}>
      <h2 id="presenter-folder-delete-title">{t('Eliminar carpeta')}</h2>
      <p>{tx('Se eliminará la carpeta «{name}» y sus subcarpetas ({n}).', { name: folder.name, n: subfolders })}</p>
      {count > 0 ? <fieldset disabled={busy} className="presenter-folder-delete-options"><legend>{tx('¿Qué quieres hacer con sus {n} presentaciones?', { n: count })}</legend>
        <label><input type="radio" name="presenter-folder-policy" value="move-to-root" checked={mode === 'move-to-root'} onChange={() => setMode('move-to-root')} /><span><strong>{t('Conservar presentaciones')}</strong><small>{t('Moverlas a la biblioteca principal, con sus notas y vídeos.')}</small></span></label>
        <label><input type="radio" name="presenter-folder-policy" value="delete-presentations" checked={mode === 'delete-presentations'} onChange={() => setMode('delete-presentations')} /><span><strong>{t('Eliminar también las presentaciones')}</strong><small>{t('Se eliminarán sus copias de la biblioteca. Los archivos originales se conservarán.')}</small></span></label>
      </fieldset> : <p>{t('Esta carpeta está vacía')}</p>}
      <div className="presenter-folder-modal-actions"><button autoFocus type="button" className="presenter-action" disabled={busy} onClick={onClose}>{t('Cancelar')}</button><button type="button" className="presenter-action presenter-action-danger" disabled={busy} onClick={() => onDelete(mode)} data-testid="presenter-delete-folder-confirm">{busy ? t('Eliminando…') : t(mode === 'delete-presentations' ? 'Eliminar carpeta y presentaciones' : 'Eliminar carpeta')}</button></div>
    </section>
  </ModalBackdrop>, document.body);
}

export function PresenterMoveDialog({ library, presentation, onMove, onClose }: {
  library: PresenterLibrary;
  presentation: Presentation;
  onMove: (folderId: string | null) => void;
  onClose: () => void;
}) {
  const [destination, setDestination] = useState(presentation.folderId ?? '');
  useRestoreFocus();
  return createPortal(<ModalBackdrop onClose={onClose}>
    <form role="dialog" aria-modal="true" aria-labelledby="presenter-move-title" data-testid="presenter-move-dialog" className="presenter-workspace presenter-folder-modal card-modal" onKeyDown={trapFocus} onSubmit={event => { event.preventDefault(); onMove(destination || null); }}>
      <div className="presenter-folder-modal-heading"><Icon name="folder" size={26} /><h2 id="presenter-move-title">{t('Mover a carpeta')}</h2></div>
      <p>{presentation.name}</p>
      <label>{t('Carpeta')}<select autoFocus value={destination} onChange={event => setDestination(event.target.value)} className="input" data-testid="presenter-move-folder-select">
        <option value="">{t('Biblioteca principal')}</option>
        {library.folders.map(folder => <option key={folder.id} value={folder.id}>{folderPath(library, folder.id).map(entry => entry.name).join(' / ')}</option>)}
      </select></label>
      <div className="presenter-folder-modal-actions"><button type="button" className="presenter-action" onClick={onClose}>{t('Cancelar')}</button><button type="submit" className="presenter-action presenter-action-violet" disabled={destination === (presentation.folderId ?? '')} data-testid="presenter-move-confirm">{t('Mover')}</button></div>
    </form>
  </ModalBackdrop>, document.body);
}
