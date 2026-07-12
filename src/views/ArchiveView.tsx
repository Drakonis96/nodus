import { useCallback, useEffect, useState } from 'react';
import type { ArchiveFolder, ArchiveItem, ArchiveItemKind, Person } from '@shared/types';
import { getArchiveDocType } from '@shared/archiveDocTypes';
import { Icon } from '../components/ui';
import { DocTypeForm, DocTypeSelect, docTypeLabel } from '../components/DocTypeForm';
import { PersonLinkPicker } from '../components/PersonLinkPicker';
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

export function ArchiveView({ onOpenLibrary }: { onOpenLibrary?: () => void } = {}) {
  const [folders, setFolders] = useState<ArchiveFolder[]>([]);
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [treePersons, setTreePersons] = useState<Person[]>([]);
  const [folderId, setFolderId] = useState<string>(ALL);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ArchiveItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [addDocType, setAddDocType] = useState<string | null>(null);
  const [textEntry, setTextEntry] = useState(false);

  const reload = useCallback(async () => {
    setFolders(await window.nodus.listArchiveFolders());
    void window.nodus.listPersons().then(setTreePersons);
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
      const result = await window.nodus.pickAndIngestArchive(target, addDocType);
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
          <div className="flex flex-wrap gap-2">
            <input
              className="input h-9 min-w-[12rem] flex-1 text-sm"
              placeholder={t('Buscar en títulos, texto y metadatos…')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <DocTypeSelect
              value={addDocType}
              onChange={setAddDocType}
              emptyLabel="Tipo de documento"
              className="input h-9 w-48 text-sm"
            />
            <button className="btn btn-primary h-9 gap-1.5" disabled={busy} onClick={() => void addFiles()}>
              <Icon name="upload" /> {t('Añadir archivos')}
            </button>
            <button
              className="btn btn-ghost h-9 gap-1.5 border border-neutral-700"
              onClick={() => setTextEntry(true)}
              title={t('Crear una entrada de texto (diario, nota, memorias) sin subir un archivo')}
            >
              <Icon name="edit" /> {t('Nueva entrada')}
            </button>
          </div>
          <p className="text-xs text-neutral-500">
            {t('El Archivo guarda fuentes primarias (documentos, registros, fotografías). La bibliografía académica (libros, artículos, tesis) se gestiona en la Biblioteca importándola desde Zotero.')}
            {onOpenLibrary && (
              <button className="ml-1 text-indigo-400 hover:underline" onClick={onOpenLibrary}>
                {t('Ir a la Biblioteca')}
              </button>
            )}
          </p>
          {message && <p className="text-xs text-neutral-400">{message}</p>}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {items.length === 0 ? (
            <p className="py-10 text-center text-sm text-neutral-500">
              {t('Este archivo está vacío. Añade fotos de registros, CSV/XLSX o escaneos; Nodus extraerá su texto (y una descripción visual de las imágenes) para poder buscarlos y citarlos.')}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[54rem] text-sm">
                <thead>
                  <tr className="border-b border-neutral-800 text-left text-xs font-medium text-neutral-500">
                    <th className="py-2 pr-3">{t('Nombre')}</th>
                    <th className="py-2 pr-3">{t('Tipo')}</th>
                    <th className="py-2 pr-3">{t('Personas')}</th>
                    <th className="py-2 pr-3">{t('Descripción visual')}</th>
                    <th className="py-2 pr-3">{t('Texto detectado')}</th>
                    <th className="py-2 pr-3">{t('Etiquetas')}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr
                      key={it.itemId}
                      onClick={() => setSelected(it)}
                      className="cursor-pointer border-b border-neutral-900 align-top hover:bg-neutral-800/40"
                    >
                      <td className="py-2 pr-3">
                        <div className="flex min-w-[9rem] items-center gap-2">
                          <Icon name={KIND_ICON[it.kind]} size={15} className="shrink-0 text-neutral-400" />
                          <span className="truncate text-neutral-100">{it.title}</span>
                        </div>
                      </td>
                      <td className="py-2 pr-3">
                        {it.docType ? (
                          <span className="whitespace-nowrap rounded-full bg-indigo-950/40 px-2 py-0.5 text-[11px] text-indigo-300">
                            {docTypeLabel(it.docType)}
                          </span>
                        ) : (
                          <span className="text-neutral-700">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <PersonLinkPicker item={it} persons={treePersons} onChanged={reload} />
                      </td>
                      <td className="max-w-[24rem] py-2 pr-3">
                        {it.description ? (
                          <span className="line-clamp-2 text-neutral-400">{it.description}</span>
                        ) : it.kind === 'image' ? (
                          <span className="text-xs italic text-neutral-600">{t('sin analizar')}</span>
                        ) : (
                          <span className="text-neutral-700">—</span>
                        )}
                      </td>
                      <td className="max-w-[20rem] py-2 pr-3">
                        {it.extractedText ? (
                          <span className="line-clamp-2 text-neutral-500">{it.extractedText.slice(0, 160)}</span>
                        ) : (
                          <span className="text-neutral-700">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex flex-wrap gap-1">
                          {it.tags.slice(0, 3).map((tag) => (
                            <span key={tag} className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-400">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
      {textEntry && (
        <TextEntryModal
          folderId={folderId !== ALL && folderId !== UNFILED ? folderId : null}
          onClose={() => setTextEntry(false)}
          onSaved={async () => {
            setTextEntry(false);
            await reload();
          }}
        />
      )}
    </div>
  );
}

/** Create a typed text entry (diary page, note, memoir) with no file. */
function TextEntryModal({
  folderId,
  onClose,
  onSaved,
}: {
  folderId: string | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [docType, setDocType] = useState<string | null>('notes');
  const [content, setContent] = useState('');
  const [metadata, setMetadata] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!title.trim() && !content.trim()) return;
    setBusy(true);
    try {
      await window.nodus.createArchiveTextEntry({
        title: title.trim() || t('Entrada sin título'),
        content,
        folderId,
        docType,
        metadata,
      });
      await onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div className="card flex max-h-[85vh] w-full max-w-lg flex-col gap-3 p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-semibold">{t('Nueva entrada de texto')}</h2>
        <input
          className="input h-9 w-full text-sm"
          placeholder={t('Título')}
          value={title}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
        />
        <DocTypeSelect value={docType} onChange={setDocType} />
        {getArchiveDocType(docType) && (
          <div className="rounded-md border border-neutral-800 p-3">
            <DocTypeForm docType={docType} values={metadata} onChange={(k, v) => setMetadata((m) => ({ ...m, [k]: v }))} />
          </div>
        )}
        <textarea
          className="input min-h-[9rem] w-full flex-1 text-sm"
          placeholder={t('Escribe el contenido (se indexa para búsqueda)…')}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose}>
            {t('Cancelar')}
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            {t('Guardar')}
          </button>
        </div>
      </div>
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
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [description, setDescription] = useState<string | null>(item.description);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeMsg, setAnalyzeMsg] = useState<string | null>(null);
  const [docType, setDocType] = useState<string | null>(item.docType);
  const [metadata, setMetadata] = useState<Record<string, string>>(item.metadata ?? {});
  const [classDirty, setClassDirty] = useState(false);

  const saveClassification = async () => {
    await window.nodus.updateArchiveItem(item.itemId, { docType, metadata });
    setClassDirty(false);
    await onChanged();
  };

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

  const analyze = async () => {
    setAnalyzing(true);
    setAnalyzeMsg(null);
    try {
      const r = await window.nodus.analyzeArchiveItem(item.itemId);
      if (r.unsupported) {
        setAnalyzeMsg(t('Este elemento no es una imagen analizable.'));
      } else {
        setDescription(r.description);
        setAnalyzeMsg(t('Imagen analizada.'));
        await onChanged();
      }
    } catch (err) {
      setAnalyzeMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalyzing(false);
    }
  };

  const scan = async () => {
    setScanning(true);
    setScanMsg(null);
    try {
      const r = await window.nodus.scanArchiveItem(item.itemId);
      if (r.noText) {
        setScanMsg(t('Este elemento no tiene texto extraído para analizar.'));
      } else {
        setScanMsg(
          t('Extraídos: {p} personas, {e} eventos.')
            .replace('{p}', String(r.persons))
            .replace('{e}', String(r.events))
        );
      }
    } catch (err) {
      setScanMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
    }
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

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <p className="text-xs text-neutral-500">
            {item.kind.toUpperCase()}
            {item.fileName ? ` · ${item.fileName}` : ''}
            {item.bytes ? ` · ${(item.bytes / 1024).toFixed(0)} KB` : ''}
          </p>
          {item.kind === 'image' && (
            <button
              className="btn btn-ghost h-7 gap-1.5 border border-neutral-700 px-2 text-xs"
              disabled={analyzing}
              onClick={() => void analyze()}
              title={t('Describir la imagen y transcribir su texto con el modelo de visión')}
            >
              <Icon name="eye" size={13} /> {analyzing ? t('Analizando…') : t('Analizar imagen')}
            </button>
          )}
          {item.extractedText && (
            <button
              className="btn btn-ghost h-7 gap-1.5 border border-neutral-700 px-2 text-xs"
              disabled={scanning}
              onClick={() => void scan()}
              title={t('Extraer personas, lugares y eventos de este documento')}
            >
              <Icon name="users" size={13} /> {scanning ? t('Analizando…') : t('Extraer personas y eventos')}
            </button>
          )}
          {(scanMsg || analyzeMsg) && <span className="text-xs text-neutral-400">{scanMsg ?? analyzeMsg}</span>}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {imageUrl && (
            <img src={imageUrl} alt={item.title} className="mb-3 max-h-80 w-auto rounded-md border border-neutral-800" />
          )}
          {description && (
            <div className="mb-3">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Descripción visual')}</h3>
              <p className="rounded-md bg-neutral-900/60 p-3 text-sm text-neutral-300">{description}</p>
            </div>
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

          <div className="mb-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Clasificación')}</h3>
            <DocTypeSelect
              value={docType}
              onChange={(id) => {
                setDocType(id);
                setClassDirty(true);
              }}
            />
            {getArchiveDocType(docType) && (
              <div className="mt-2 rounded-md border border-neutral-800 p-3">
                <DocTypeForm
                  docType={docType}
                  values={metadata}
                  onChange={(key, value) => {
                    setMetadata((m) => ({ ...m, [key]: value }));
                    setClassDirty(true);
                  }}
                />
              </div>
            )}
            {classDirty && (
              <button className="btn btn-primary mt-2 h-8 text-xs" onClick={() => void saveClassification()}>
                {t('Guardar clasificación')}
              </button>
            )}
          </div>
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
