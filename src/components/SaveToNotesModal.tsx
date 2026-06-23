import { useEffect, useMemo, useState } from 'react';
import type { Note, NoteFolder, NoteKind, NoteSource } from '@shared/types';
import { Icon } from './ui';
import { flattenFolders } from '../notesTree';
import { t } from '../i18n';

/**
 * Reusable "save this content to my notes" dialog. The content is Markdown that may
 * contain `nodus://` citations; those stay clickable once the saved note is opened
 * in the Notes view (same Markdown renderer + source modal). Callers pass the raw
 * Markdown, a default title and the note kind so provenance is preserved.
 */
export function SaveToNotesModal({
  content,
  defaultTitle,
  kind,
  source,
  onClose,
  onSaved,
}: {
  content: string;
  defaultTitle: string;
  kind: NoteKind;
  source?: NoteSource | null;
  onClose: () => void;
  onSaved?: (note: Note) => void;
}) {
  const [folders, setFolders] = useState<NoteFolder[]>([]);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [title, setTitle] = useState(defaultTitle.trim() || t('Nota sin título'));
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    void window.nodus.getNotesTree().then((tree) => {
      if (on) setFolders(tree.folders);
    });
    return () => {
      on = false;
    };
  }, []);

  const flat = useMemo(() => flattenFolders(folders), [folders]);

  const createFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    setCreatingFolder(true);
    setError(null);
    try {
      const created = await window.nodus.createNoteFolder({ name, parentId: folderId });
      setFolders((current) => [...current, created]);
      setFolderId(created.id);
      setNewFolderName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingFolder(false);
    }
  };

  const save = async () => {
    if (saving || !content.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const note = await window.nodus.createNote({
        title,
        content,
        kind,
        folderId,
        source: source ?? { origin: kind },
      });
      setDone(true);
      onSaved?.(note);
      window.setTimeout(onClose, 750);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 p-4 flex items-center justify-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-lg bg-neutral-950 border border-neutral-800 rounded-lg shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-4 py-3 border-b border-neutral-800 flex items-center gap-2">
          <Icon name="notebook" className="text-indigo-300" />
          <span className="font-semibold text-sm">{t('Guardar en notas')}</span>
          <div className="flex-1" />
          <button className="btn btn-ghost" onClick={onClose} title={t('Cerrar')}>
            <Icon name="x" />
          </button>
        </header>

        <div className="p-4 space-y-4">
          <div>
            <label className="text-xs uppercase text-neutral-500">{t('Título')}</label>
            <input
              className="input w-full mt-1"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('Título de la nota')}
            />
          </div>

          <div>
            <label className="text-xs uppercase text-neutral-500">{t('Carpeta')}</label>
            <select
              className="input w-full mt-1"
              value={folderId ?? ''}
              onChange={(e) => setFolderId(e.target.value || null)}
            >
              <option value="">{t('Sin carpeta (raíz)')}</option>
              {flat.map(({ folder, depth }) => (
                <option key={folder.id} value={folder.id}>
                  {`${'  '.repeat(depth)}${depth > 0 ? '↳ ' : ''}${folder.name}`}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="text-xs uppercase text-neutral-500">{t('Nueva carpeta')}</label>
              <input
                className="input w-full mt-1"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder={folderId ? t('Subcarpeta dentro de la seleccionada') : t('Carpeta nueva en la raíz')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void createFolder();
                  }
                }}
              />
            </div>
            <button
              className="btn btn-ghost border border-neutral-700 gap-1.5"
              onClick={() => void createFolder()}
              disabled={creatingFolder || !newFolderName.trim()}
              title={t('Crear carpeta')}
            >
              <Icon name={creatingFolder ? 'sync' : 'folderPlus'} className={creatingFolder ? 'animate-spin' : ''} />
              {t('Crear')}
            </button>
          </div>

          <div className="rounded-md border border-neutral-800 bg-neutral-900/50 p-2 text-xs text-neutral-400">
            <Icon name="info" size={12} className="mr-1 text-neutral-500" />
            {t('Las citas clicables del contenido se conservan al guardar.')}
          </div>

          {error && <div className="text-xs text-red-400">{error}</div>}
        </div>

        <footer className="px-4 py-3 border-t border-neutral-800 flex items-center justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose}>
            {t('Cancelar')}
          </button>
          <button
            className="btn btn-primary gap-1.5"
            onClick={() => void save()}
            disabled={saving || done || !content.trim()}
          >
            <Icon name={done ? 'check' : saving ? 'sync' : 'save'} className={saving ? 'animate-spin' : ''} />
            {done ? t('Guardado') : saving ? t('Guardando…') : t('Guardar nota')}
          </button>
        </footer>
      </div>
    </div>
  );
}
