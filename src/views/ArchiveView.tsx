import { useCallback, useEffect, useState } from 'react';
import type { ArchiveFolder, ArchiveItem, ArchiveItemKind } from '@shared/types';
import { Icon } from '../components/ui';
import { t } from '../i18n';

const KIND_ICON: Record<ArchiveItemKind, string> = {
  image: 'eye',
  csv: 'grid',
  xlsx: 'grid',
  pdf: 'book',
  text: 'notebook',
  other: 'folder',
};

const ALL = '__all__';
const UNFILED = '__unfiled__';

export function ArchiveView() {
  const [folders, setFolders] = useState<ArchiveFolder[]>([]);
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [folderId, setFolderId] = useState<string>(ALL);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ArchiveItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setFolders(await window.nodus.listArchiveFolders());
    const opts: { folderId?: string | null; search?: string } = {};
    if (folderId === UNFILED) opts.folderId = null;
    else if (folderId !== ALL) opts.folderId = folderId;
    if (search.trim()) opts.search = search.trim();
    setItems(await window.nodus.listArchiveItems(opts));
  }, [folderId, search]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const addFiles = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const target = folderId !== ALL && folderId !== UNFILED ? folderId : null;
      const result = await window.nodus.pickAndIngestArchive(target);
      if (result.added || result.duplicates) {
        setMessage(
          t('Añadidos: {a} · duplicados omitidos: {d}')
            .replace('{a}', String(result.added))
            .replace('{d}', String(result.duplicates))
        );
      }
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const newFolder = async () => {
    const name = window.prompt(t('Nombre de la carpeta'));
    if (!name?.trim()) return;
    await window.nodus.createArchiveFolder(name.trim(), null);
    await reload();
  };

  return (
    <div className="h-full flex min-h-0">
      <div className="flex w-60 shrink-0 flex-col border-r border-neutral-800 p-3 min-h-0">
        <div className="mb-3 flex items-center gap-2">
          <Icon name="archive" size={18} className="text-indigo-300" />
          <h1 className="text-sm font-semibold">{t('Archivo')}</h1>
          <button className="btn btn-ghost ml-auto px-1.5 py-1" title={t('Nueva carpeta')} onClick={() => void newFolder()}>
            <Icon name="folderPlus" size={16} />
          </button>
        </div>
        <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto text-sm">
          <FolderRow label={t('Todo')} icon="layers" active={folderId === ALL} onClick={() => setFolderId(ALL)} />
          {folders.map((f) => (
            <FolderRow
              key={f.folderId}
              label={f.name}
              icon="folder"
              active={folderId === f.folderId}
              onClick={() => setFolderId(f.folderId)}
            />
          ))}
          <FolderRow label={t('Sin carpeta')} icon="folder" active={folderId === UNFILED} onClick={() => setFolderId(UNFILED)} />
        </nav>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 space-y-3 border-b border-neutral-800 p-4">
          <div className="flex gap-2">
            <input
              className="input h-9 flex-1 text-sm"
              placeholder={t('Buscar en títulos y texto extraído…')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button className="btn btn-primary h-9 gap-1.5" disabled={busy} onClick={() => void addFiles()}>
              <Icon name="upload" /> {t('Añadir archivos')}
            </button>
          </div>
          {message && <p className="text-xs text-neutral-400">{message}</p>}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {items.length === 0 ? (
            <p className="py-10 text-center text-sm text-neutral-500">
              {t('Este archivo está vacío. Añade fotos de registros, CSV/XLSX o escaneos; Nodus extraerá su texto para poder buscarlos y citarlos.')}
            </p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
              {items.map((it) => (
                <button
                  key={it.itemId}
                  onClick={() => setSelected(it)}
                  className="flex flex-col rounded-lg border border-neutral-800 p-3 text-left transition hover:bg-neutral-800/50"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <Icon name={KIND_ICON[it.kind]} size={16} className="text-neutral-400" />
                    <span className="truncate text-sm font-medium text-neutral-100">{it.title}</span>
                  </div>
                  {it.extractedText ? (
                    <p className="line-clamp-2 text-xs text-neutral-500">{it.extractedText.slice(0, 160)}</p>
                  ) : (
                    <p className="text-xs italic text-neutral-600">{t('sin texto extraído')}</p>
                  )}
                  {it.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {it.tags.slice(0, 4).map((tag) => (
                        <span key={tag} className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-400">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {selected && (
        <ArchiveItemDetail
          item={selected}
          onClose={() => setSelected(null)}
          onChanged={async () => {
            await reload();
          }}
        />
      )}
    </div>
  );
}

function FolderRow({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left ${
        active ? 'bg-indigo-600/20 text-indigo-100' : 'text-neutral-300 hover:bg-neutral-800/60'
      }`}
    >
      <Icon name={icon} size={15} className="shrink-0 opacity-70" />
      <span className="truncate">{label}</span>
    </button>
  );
}

function ArchiveItemDetail({
  item,
  onClose,
  onChanged,
}: {
  item: ArchiveItem;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [tag, setTag] = useState('');
  const [title, setTitle] = useState(item.title);
  const [tags, setTags] = useState<string[]>(item.tags);

  useEffect(() => {
    let revoked: string | null = null;
    if (item.kind === 'image' && item.hasBlob) {
      void window.nodus.getArchiveItemBlob(item.itemId).then((bytes) => {
        if (!bytes) return;
        const blob = new Blob([new Uint8Array(bytes)], { type: item.mimeType ?? 'image/png' });
        const url = URL.createObjectURL(blob);
        revoked = url;
        setImageUrl(url);
      });
    }
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [item.itemId, item.hasBlob, item.kind, item.mimeType]);

  const saveTitle = async () => {
    if (title.trim() && title.trim() !== item.title) {
      await window.nodus.updateArchiveItem(item.itemId, { title: title.trim() });
      await onChanged();
    }
  };

  const addTag = async () => {
    const value = tag.trim();
    if (!value || tags.includes(value)) return;
    await window.nodus.addArchiveTag(item.itemId, value);
    setTags([...tags, value]);
    setTag('');
    await onChanged();
  };

  const removeTag = async (value: string) => {
    await window.nodus.removeArchiveTag(item.itemId, value);
    setTags(tags.filter((x) => x !== value));
    await onChanged();
  };

  const remove = async () => {
    if (!window.confirm(t('¿Eliminar este elemento del archivo?'))) return;
    await window.nodus.deleteArchiveItem(item.itemId);
    onClose();
    await onChanged();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div className="card flex max-h-[85vh] w-full max-w-2xl flex-col p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start gap-2">
          <input
            className="input h-9 flex-1 text-sm font-medium"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => void saveTitle()}
          />
          <button className="btn btn-ghost gap-1.5 text-red-300" onClick={() => void remove()}>
            <Icon name="trash" size={14} />
          </button>
          <button className="btn btn-ghost px-2 py-1" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>

        <p className="mb-3 text-xs text-neutral-500">
          {item.kind.toUpperCase()}
          {item.fileName ? ` · ${item.fileName}` : ''}
          {item.bytes ? ` · ${(item.bytes / 1024).toFixed(0)} KB` : ''}
        </p>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {imageUrl && (
            <img src={imageUrl} alt={item.title} className="mb-3 max-h-80 w-auto rounded-md border border-neutral-800" />
          )}
          {item.extractedText ? (
            <div className="mb-3">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Texto extraído')}</h3>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-neutral-900/60 p-3 text-xs text-neutral-300">
                {item.extractedText}
              </pre>
            </div>
          ) : (
            <p className="mb-3 text-sm italic text-neutral-500">{t('Sin texto extraído.')}</p>
          )}
        </div>

        <div className="mt-2 border-t border-neutral-800 pt-3">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {tags.map((x) => (
              <span key={x} className="flex items-center gap-1 rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300">
                {x}
                <button onClick={() => void removeTag(x)} className="text-neutral-500 hover:text-neutral-200">
                  <Icon name="x" size={11} />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              className="input h-8 flex-1 text-sm"
              placeholder={t('Añadir etiqueta…')}
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void addTag();
              }}
            />
            <button className="btn btn-ghost h-8 border border-neutral-700" onClick={() => void addTag()}>
              <Icon name="tag" size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
