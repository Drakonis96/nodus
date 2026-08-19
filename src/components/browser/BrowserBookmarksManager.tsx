import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../ui';
import type { BrowserBookmark, BrowserBookmarkNodeRef, BrowserBookmarkStore, BrowserBookmarksImportPreview } from '@shared/browserBookmarks';
import { browserBookmarkChildren, searchBrowserBookmarks } from '@shared/browserBookmarks';

export function BrowserBookmarksManager({ store, onClose, onEdit, onCreate, onNotice }: {
  store: BrowserBookmarkStore;
  onClose: () => void;
  onEdit: (bookmark: BrowserBookmark) => void;
  onCreate: (parentId: string | null) => void;
  onNotice: (message: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(store.folders.map((folder) => folder.id)));
  const [dragging, setDragging] = useState<BrowserBookmarkNodeRef | null>(null);
  const [preview, setPreview] = useState<BrowserBookmarksImportPreview | null>(null);
  const [folderEditor, setFolderEditor] = useState<{ id?: string; parentId: string | null; name: string } | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ ref: BrowserBookmarkNodeRef; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void window.nodus.setBrowserOverlayVisible(true);
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('keydown', key); void window.nodus.setBrowserOverlayVisible(false); };
  }, [busy, onClose]);

  const visibleIds = useMemo(() => new Set(searchBrowserBookmarks(store, query).map((hit) => hit.bookmark.id)), [query, store]);
  const saveFolder = async () => {
    if (!folderEditor?.name.trim()) return;
    setBusy(true);
    try {
      if (folderEditor.id) await window.nodus.updateBrowserBookmarkFolder(folderEditor.id, { name: folderEditor.name });
      else await window.nodus.createBrowserBookmarkFolder({ name: folderEditor.name, parentId: folderEditor.parentId });
      setFolderEditor(null);
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!deleteConfirmation) return;
    setBusy(true);
    try {
      await window.nodus.deleteBrowserBookmarkNode(deleteConfirmation.ref);
      setDeleteConfirmation(null);
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const drop = async (parentId: string | null) => {
    if (!dragging) return;
    try { await window.nodus.moveBrowserBookmarkNode(dragging, parentId, browserBookmarkChildren(store, parentId).length); }
    catch (cause) { onNotice(cause instanceof Error ? cause.message : String(cause)); }
    finally { setDragging(null); }
  };
  const shift = async (ref: BrowserBookmarkNodeRef, parentId: string | null, delta: number) => {
    const siblings = browserBookmarkChildren(store, parentId);
    const current = siblings.findIndex((entry) => entry.kind === ref.kind && entry.id === ref.id);
    if (current < 0) return;
    await window.nodus.moveBrowserBookmarkNode(ref, parentId, Math.max(0, Math.min(siblings.length - 1, current + delta)));
  };

  const render = (parentId: string | null, depth: number): React.ReactNode => browserBookmarkChildren(store, parentId).map((ref) => {
    if (ref.kind === 'folder') {
      const folder = store.folders.find((entry) => entry.id === ref.id)!;
      const open = expanded.has(folder.id) || Boolean(query);
      return <div key={folder.id}>
        <div className="browser-bookmark-row group flex items-center gap-1 rounded-lg py-1 pr-1 hover:bg-neutral-100 dark:hover:bg-neutral-800" style={{ paddingLeft: `${8 + depth * 18}px` }} draggable onDragStart={() => setDragging(ref)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void drop(folder.id); }}>
          <button className="rounded p-1" aria-label={open ? 'Collapse folder' : 'Expand folder'} onClick={() => setExpanded((current) => { const next = new Set(current); if (open) next.delete(folder.id); else next.add(folder.id); return next; })}><Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} /></button><Icon name="folder" size={15} className="text-indigo-400" /><span className="min-w-0 flex-1 truncate text-sm">{folder.name}</span><span className="opacity-0 group-hover:opacity-100"><RowButton icon="chevronUp" label="Move up" onClick={() => void shift(ref, folder.parentId, -1)} /><RowButton icon="chevronDown" label="Move down" onClick={() => void shift(ref, folder.parentId, 1)} /><RowButton icon="plus" label="Add bookmark" onClick={() => onCreate(folder.id)} /><RowButton icon="folderPlus" label="Add subfolder" onClick={() => setFolderEditor({ parentId: folder.id, name: '' })} /><RowButton icon="edit" label="Rename" onClick={() => setFolderEditor({ id: folder.id, parentId: folder.parentId, name: folder.name })} /><RowButton icon="trash" label="Delete" onClick={() => setDeleteConfirmation({ ref, label: folder.name })} /></span>
        </div>{open && render(folder.id, depth + 1)}
      </div>;
    }
    const bookmark = store.bookmarks.find((entry) => entry.id === ref.id)!;
    if (query && !visibleIds.has(bookmark.id)) return null;
    return <div key={bookmark.id} className="browser-bookmark-row group flex items-center gap-2 rounded-lg py-1.5 pr-1 hover:bg-neutral-100 dark:hover:bg-neutral-800" style={{ paddingLeft: `${34 + depth * 18}px` }} draggable onDragStart={() => setDragging(ref)}>
      {bookmark.faviconDataUrl ? <img src={bookmark.faviconDataUrl} className="h-4 w-4" alt="" /> : <Icon name="globe" size={14} className="opacity-50" />}<button className="min-w-0 flex-1 text-left" onClick={() => void window.nodus.openBrowserTab(bookmark.url)}><div className="truncate text-sm">{bookmark.title}</div><div className="truncate text-[11px] text-neutral-500">{bookmark.url}</div></button><span className="opacity-0 group-hover:opacity-100"><RowButton icon="chevronUp" label="Move up" onClick={() => void shift(ref, bookmark.parentId, -1)} /><RowButton icon="chevronDown" label="Move down" onClick={() => void shift(ref, bookmark.parentId, 1)} /><RowButton icon="external" label="Open in new tab" onClick={() => void window.nodus.openBrowserTab(bookmark.url)} /><RowButton icon="edit" label="Edit" onClick={() => onEdit(bookmark)} /><RowButton icon="copy" label="Copy URL" onClick={() => void navigator.clipboard.writeText(bookmark.url)} /><RowButton icon="trash" label="Delete" onClick={() => setDeleteConfirmation({ ref, label: bookmark.title })} /></span>
    </div>;
  });

  const importFile = async () => { setBusy(true); try { setPreview(await window.nodus.previewBrowserBookmarksImport()); } catch (cause) { onNotice(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); } };
  const commit = async () => { if (!preview) return; setBusy(true); try { const result = await window.nodus.commitBrowserBookmarksImport(preview.token); setPreview(null); onNotice(`Imported ${result.summary.bookmarks} bookmarks and ${result.summary.folders} folders. ${result.summary.duplicates} duplicates skipped.`); } catch (cause) { onNotice(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); } };

  return createPortal(<div className="fixed inset-0 z-[145] flex items-center justify-center bg-black/60 p-5" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><section className="card-modal flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden" role="dialog" aria-modal="true" data-testid="browser-bookmarks-manager">
    <header className="flex items-center gap-3 border-b border-neutral-200 p-4 dark:border-neutral-800"><span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-500/15 text-indigo-400"><Icon name="bookmark" size={19} /></span><div className="min-w-0 flex-1"><h2 className="font-semibold">Nodus Bookmarks</h2><p className="text-xs text-neutral-500">{store.bookmarks.length} bookmarks · {store.folders.length} folders · private and local</p></div><button className="rounded p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800" onClick={onClose}><Icon name="x" /></button></header>
    <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 p-3 dark:border-neutral-800"><div className="flex min-w-48 flex-1 items-center gap-2 rounded-lg border border-neutral-300 px-2 dark:border-neutral-700"><Icon name="search" size={14} /><input className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Search bookmarks…" value={query} onChange={(event) => setQuery(event.target.value)} /></div><button className="btn btn-ghost border border-neutral-300 dark:border-neutral-700" onClick={() => onCreate(null)}><Icon name="plus" size={13} /> Bookmark</button><button className="btn btn-ghost border border-neutral-300 dark:border-neutral-700" onClick={() => setFolderEditor({ parentId: null, name: '' })}><Icon name="folderPlus" size={13} /> Folder</button><button className="btn btn-ghost border border-neutral-300 dark:border-neutral-700" disabled={busy} onClick={() => void importFile()}><Icon name="upload" size={13} /> Import</button><button className="btn btn-ghost border border-neutral-300 dark:border-neutral-700" onClick={() => void window.nodus.exportBrowserBookmarks('json')}><Icon name="download" size={13} /> JSON</button><button className="btn btn-ghost border border-neutral-300 dark:border-neutral-700" onClick={() => void window.nodus.exportBrowserBookmarks('html')}><Icon name="download" size={13} /> HTML</button></div>
    {preview && <div className="m-3 rounded-xl border border-indigo-500/40 bg-indigo-500/10 p-3 text-sm"><p className="font-semibold">Import preview · {preview.fileName}</p><p className="mt-1 text-xs text-neutral-500">{preview.bookmarks} bookmarks · {preview.folders} folders · {preview.duplicates} duplicates · {preview.invalidUrls} invalid URLs skipped{preview.truncated ? ' · limits applied' : ''}</p><div className="mt-3 flex gap-2"><button className="btn btn-ghost" onClick={() => setPreview(null)}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={() => void commit()}>Import without overwriting</button></div></div>}
    <div className="browser-bookmarks-tree min-h-60 flex-1 p-3" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { if (event.target === event.currentTarget) { event.preventDefault(); void drop(null); } }}>{render(null, 0)}{store.bookmarks.length === 0 && store.folders.length === 0 && <div className="grid min-h-56 place-items-center text-center text-sm text-neutral-500"><div><Icon name="bookmark" size={28} className="mx-auto mb-3 opacity-40" /><p>No bookmarks yet.</p><button className="btn btn-primary mt-3" onClick={() => onCreate(null)}>Add your first bookmark</button></div></div>}</div>
    {folderEditor && <div className="absolute inset-0 z-10 grid place-items-center bg-black/55 p-5"><form className="card-modal w-full max-w-md p-5" onSubmit={(event) => { event.preventDefault(); void saveFolder(); }}><h3 className="text-lg font-semibold">{folderEditor.id ? 'Rename folder' : 'New folder'}</h3><p className="mt-1 text-xs text-neutral-500">Folders are private Nodus data and may contain nested folders.</p><label className="mt-4 block text-sm font-medium" htmlFor="browser-folder-name">Name</label><input id="browser-folder-name" autoFocus className="input mt-1 w-full" value={folderEditor.name} maxLength={160} onChange={(event) => setFolderEditor({ ...folderEditor, name: event.target.value })} /><div className="mt-5 flex justify-end gap-2"><button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setFolderEditor(null)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy || !folderEditor.name.trim()}>Save</button></div></form></div>}
    {deleteConfirmation && <div className="absolute inset-0 z-10 grid place-items-center bg-black/55 p-5"><section className="card-modal w-full max-w-md p-5" role="alertdialog" aria-modal="true"><h3 className="text-lg font-semibold">Delete “{deleteConfirmation.label}”?</h3><p className="mt-2 text-sm text-neutral-500">{deleteConfirmation.ref.kind === 'folder' ? 'The folder and everything inside it will be deleted.' : 'This bookmark will be removed from Nodus Bookmarks.'}</p><div className="mt-5 flex justify-end gap-2"><button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setDeleteConfirmation(null)}>Cancel</button><button type="button" className="btn btn-danger" disabled={busy} onClick={() => void remove()}>Delete</button></div></section></div>}
  </section></div>, document.body);
}

function RowButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) { return <button type="button" className="rounded p-1 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900 dark:hover:bg-neutral-700 dark:hover:text-white" title={label} aria-label={label} onClick={onClick}><Icon name={icon} size={13} /></button>; }
