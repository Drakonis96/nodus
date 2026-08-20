import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../ui';
import type {
  BrowserBookmark,
  BrowserBookmarkCandidate,
  BrowserBookmarkStore,
} from '@shared/browserBookmarks';
import { browserBookmarkFolderPath, folderDepth } from '@shared/browserBookmarks';

export type BookmarkEditorTarget =
  | { mode: 'create'; candidate: BrowserBookmarkCandidate; parentId?: string | null }
  | { mode: 'edit'; bookmark: BrowserBookmark };

export function BrowserBookmarkModal({ target, store, onClose, onSaved }: {
  target: BookmarkEditorTarget;
  store: BrowserBookmarkStore;
  onClose: () => void;
  onSaved: (store: BrowserBookmarkStore, duplicate: boolean) => void;
}) {
  const source = target.mode === 'edit' ? target.bookmark : target.candidate;
  const [title, setTitle] = useState(source.title);
  const [url, setUrl] = useState(source.url);
  const [description, setDescription] = useState(source.description);
  const [parentId, setParentId] = useState<string | null>(target.mode === 'edit' ? target.bookmark.parentId : target.parentId ?? null);
  const [newFolder, setNewFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void window.nodus.setBrowserOverlayVisible(true);
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('keydown', key); void window.nodus.setBrowserOverlayVisible(false); };
  }, [busy, onClose]);

  const createFolder = async () => {
    if (!newFolder.trim()) return;
    setBusy(true); setError('');
    try {
      const result = await window.nodus.createBrowserBookmarkFolder({ name: newFolder, parentId });
      setParentId(result.folder.id); setNewFolder('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const save = async () => {
    setBusy(true); setError('');
    try {
      if (target.mode === 'edit') {
        const next = await window.nodus.updateBrowserBookmark(target.bookmark.id, { title, url, description, parentId });
        onSaved(next, false);
      } else {
        const result = await window.nodus.createBrowserBookmark({ title, url, description, parentId, faviconDataUrl: target.candidate.faviconDataUrl });
        onSaved(result.store, result.duplicate);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); }
  };

  const folders = [...store.folders].sort((a, b) => browserBookmarkFolderPath(store, a.id).join('/').localeCompare(browserBookmarkFolderPath(store, b.id).join('/')));
  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 p-5" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <form className="card-modal max-h-[90vh] w-full max-w-xl overflow-y-auto p-5" role="dialog" aria-modal="true" data-testid="browser-bookmark-modal" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-500/15 text-indigo-400"><Icon name="bookmark" size={19} /></span><div><h2 className="font-semibold">{target.mode === 'edit' ? 'Edit bookmark' : 'Add bookmark'}</h2><p className="text-xs text-neutral-500">Stored privately in Nodus application data.</p></div></div>
        <label className="mt-5 block text-xs text-neutral-500">Title<input data-testid="bookmark-title" className="input mt-1 w-full" value={title} maxLength={300} disabled={busy} onChange={(event) => setTitle(event.target.value)} /></label>
        <label className="mt-3 block text-xs text-neutral-500">URL<input data-testid="bookmark-url" className="input mt-1 w-full" value={url} maxLength={2048} disabled={busy} onChange={(event) => setUrl(event.target.value)} /></label>
        <label className="mt-3 block text-xs text-neutral-500">Description<textarea data-testid="bookmark-description" className="input mt-1 min-h-20 w-full resize-y" value={description} maxLength={2000} disabled={busy} onChange={(event) => setDescription(event.target.value)} /></label>
        <label className="mt-3 block text-xs text-neutral-500">Folder<select data-testid="bookmark-folder" className="input mt-1 w-full" value={parentId ?? ''} disabled={busy} onChange={(event) => setParentId(event.target.value || null)}><option value="">Bookmarks (root)</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{`${'— '.repeat(Math.max(0, folderDepth(store, folder.id) - 1))}${browserBookmarkFolderPath(store, folder.id).join(' › ')}`}</option>)}</select></label>
        <div className="mt-3 flex gap-2"><input className="input min-w-0 flex-1" placeholder="New folder in selected location" value={newFolder} maxLength={120} disabled={busy} onChange={(event) => setNewFolder(event.target.value)} /><button type="button" className="btn btn-ghost border border-neutral-300 dark:border-neutral-700" disabled={busy || !newFolder.trim()} onClick={() => void createFolder()}><Icon name="folderPlus" size={13} /> New folder</button></div>
        {error && <p className="mt-3 flex gap-2 text-xs text-red-400"><Icon name="alert" size={13} />{error}</p>}
        <div className="mt-5 flex justify-end gap-2"><button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>Cancel</button><button data-testid="bookmark-save" className="btn btn-primary" disabled={busy || !title.trim() || !url.trim()}>{busy ? 'Saving…' : 'Save'}</button></div>
      </form>
    </div>, document.body,
  );
}
