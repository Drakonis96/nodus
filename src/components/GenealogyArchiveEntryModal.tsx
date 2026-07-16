import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ArchiveFolder, ArchiveIngestSummary, Person, ZoteroAttachmentInfo, ZoteroItem, ZoteroLibrary } from '@shared/types';
import { extractItemYear, getArchiveDocType } from '@shared/archiveDocTypes';
import { DocTypeForm, DocTypeSelect } from './DocTypeForm';
import { SearchableMultiSelect } from './PersonMultiSelect';
import { Icon, Spinner } from './ui';
import { t } from '../i18n';

type SourceMode = 'device' | 'zotero' | 'text';

function fileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

function creatorLabel(item: ZoteroItem): string {
  return item.creators.slice(0, 3).map((creator) => creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(' ')).filter(Boolean).join(', ');
}

function attachmentLabel(attachment: ZoteroAttachmentInfo): string {
  const format = attachment.filename?.split('.').pop()?.toUpperCase() || attachment.contentType || t('Adjunto');
  return `${attachment.title}${format ? ` · ${format}` : ''}`;
}

const sectionClass = 'rounded-xl border border-neutral-200 bg-white/70 p-4 dark:border-neutral-800 dark:bg-neutral-950/25';
const labelClass = 'mb-1.5 block text-xs font-semibold text-neutral-600 dark:text-neutral-400';

export function GenealogyArchiveEntryModal({
  folders,
  persons,
  initialFolderIds = [],
  onClose,
  onSaved,
}: {
  folders: ArchiveFolder[];
  persons: Person[];
  initialFolderIds?: string[];
  onClose: () => void;
  onSaved: (result: ArchiveIngestSummary) => Promise<void> | void;
}) {
  const [mode, setMode] = useState<SourceMode>('device');
  const [paths, setPaths] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [docType, setDocType] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<Record<string, string>>({});
  const [personIds, setPersonIds] = useState<string[]>([]);
  const [folderIds, setFolderIds] = useState<string[]>(initialFolderIds);
  const [source, setSource] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [libraries, setLibraries] = useState<ZoteroLibrary[]>([]);
  const [library, setLibrary] = useState<ZoteroLibrary | null>(null);
  const [query, setQuery] = useState('');
  const [zoteroItems, setZoteroItems] = useState<ZoteroItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<ZoteroItem | null>(null);
  const [attachments, setAttachments] = useState<ZoteroAttachmentInfo[]>([]);
  const [attachmentKey, setAttachmentKey] = useState('');
  const [loadingZotero, setLoadingZotero] = useState(false);

  const tags = useMemo(() => [...new Set(tagsText.split(',').map((tag) => tag.trim()).filter(Boolean))], [tagsText]);
  const derivedYear = extractItemYear(docType, metadata);
  const canSave = mode === 'zotero' ? Boolean(selectedItem && attachmentKey) : Boolean(title.trim() || paths.length || content.trim());

  useEffect(() => {
    if (mode !== 'zotero' || libraries.length) return;
    setLoadingZotero(true);
    void window.nodus.zoteroLibraries().then((next) => {
      setLibraries(next);
      setLibrary(next[0] ?? null);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setLoadingZotero(false));
  }, [mode, libraries.length]);

  useEffect(() => {
    if (mode !== 'zotero' || !library) return;
    let active = true;
    setLoadingZotero(true);
    const timer = window.setTimeout(() => {
      void window.nodus.zoteroSearchItems(library, query).then((next) => {
        if (active) setZoteroItems(next);
      }).catch((cause) => active && setError(cause instanceof Error ? cause.message : String(cause))).finally(() => active && setLoadingZotero(false));
    }, 220);
    return () => { active = false; window.clearTimeout(timer); };
  }, [mode, library?.type, library?.id, query]);

  const selectZoteroItem = async (item: ZoteroItem) => {
    setSelectedItem(item);
    setAttachmentKey('');
    setAttachments([]);
    setLoadingZotero(true);
    if (!title.trim()) setTitle(item.title);
    if (!description.trim() && item.abstract) setDescription(item.abstract);
    if (!source.trim()) setSource(item.url || `Zotero · ${item.title}`);
    if (!tagsText.trim() && item.tags.length) setTagsText(item.tags.join(', '));
    try {
      const next = await window.nodus.zoteroItemAttachments(item.itemKey, item.library);
      setAttachments(next);
      setAttachmentKey((next.find((attachment) => attachment.contentType === 'application/pdf') ?? next[0])?.itemKey ?? '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoadingZotero(false);
    }
  };

  const addPaths = (next: string[]) => {
    const clean = [...new Set([...paths, ...next.filter(Boolean)])];
    setPaths(clean);
    if (!title.trim() && clean.length === 1) setTitle(fileName(clean[0]).replace(/\.[^.]+$/, ''));
  };

  const browse = async () => addPaths(await window.nodus.chooseArchiveEntryFiles());

  const save = async () => {
    if (!canSave || busy) return;
    setBusy(true);
    setError('');
    const common = {
      title: title.trim() || selectedItem?.title || t('Entrada sin título'),
      description: description.trim() || null,
      source: source.trim() || null,
      docType,
      metadata,
      tags,
      folderIds,
      personIds,
      extractedText: content.trim() || null,
    };
    try {
      const result = mode === 'zotero' && selectedItem && library
        ? await window.nodus.importZoteroArchiveEntry({ ...common, library, itemKey: selectedItem.itemKey, attachmentKey })
        : await window.nodus.createArchiveEntry({ ...common, paths: mode === 'device' ? paths : [] });
      await onSaved(result);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const personOptions = persons.map((person) => ({ id: person.personId, label: person.displayName, description: person.birthDate || null }));
  const folderOptions = folders.map((folder) => ({ id: folder.folderId, label: folder.name }));

  return createPortal(
    <div className="fixed inset-0 z-[160] grid place-items-center bg-black/65 p-4" onClick={onClose} data-testid="genealogy-archive-entry-modal">
      <section className="card-modal flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-start gap-3 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-950/35 dark:text-amber-300"><Icon name="plus" size={18} /></span>
          <div className="min-w-0"><h2 className="font-semibold">{t('Añadir entrada al archivo')}</h2><p className="mt-0.5 text-xs text-neutral-500">{t('Registra la fuente, clasifícala y relaciónala con las personas de tu genealogía.')}</p></div>
          <button className="btn btn-ghost ml-auto h-9 w-9 p-0" aria-label={t('Cerrar')} onClick={onClose}><Icon name="x" /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="mb-4 grid grid-cols-3 gap-2 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-900">
            {([
              ['device', 'upload', t('Desde el dispositivo')],
              ['zotero', 'book', t('Desde Zotero')],
              ['text', 'edit', t('Sin archivo')],
            ] as const).map(([value, icon, label]) => <button key={value} className={`btn min-h-10 justify-center ${mode === value ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setMode(value)}><Icon name={icon} size={15} />{label}</button>)}
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)]">
            <div className="space-y-4">
              <section className={sectionClass}>
                <h3 className="mb-3 text-sm font-semibold">{t('1. Información básica')}</h3>
                <label className={labelClass}>{t('Título')}</label>
                <input autoFocus className="input h-9 w-full text-sm" value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t('Título descriptivo de la entrada')} />
                <label className={`${labelClass} mt-3`}>{t('Descripción')}</label>
                <textarea className="input min-h-20 w-full resize-y text-sm" value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t('Qué contiene y por qué es relevante')} />
              </section>

              <section className={sectionClass}>
                <div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">{t('2. Clasificación')}</h3>{derivedYear != null && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">{t('Año')}: {derivedYear}</span>}</div>
                <label className={labelClass}>{t('Tipo de documento')}</label>
                <DocTypeSelect value={docType} onChange={(value) => { setDocType(value); setMetadata({}); }} emptyLabel="Elegir tipo de documento…" genealogyFilter />
                {getArchiveDocType(docType) && <div className="mt-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"><DocTypeForm docType={docType} values={metadata} onChange={(key, value) => setMetadata((current) => ({ ...current, [key]: value }))} /></div>}
              </section>

              <section className={sectionClass}>
                <h3 className="mb-3 text-sm font-semibold">{t('3. Personas y procedencia')}</h3>
                <label className={labelClass}>{t('Personas')}</label>
                <SearchableMultiSelect options={personOptions} selectedIds={personIds} onChange={setPersonIds} placeholder={t('Relacionar personas…')} searchPlaceholder={t('Buscar persona…')} />
                <label className={`${labelClass} mt-3`}>{t('Fuente')}</label>
                <input className="input h-9 w-full text-sm" value={source} onChange={(event) => setSource(event.target.value)} placeholder={t('Archivo, repositorio, cita, URL o procedencia…')} />
              </section>

              <section className={sectionClass}>
                <h3 className="mb-3 text-sm font-semibold">{t('4. Organización')}</h3>
                <label className={labelClass}>{t('Etiquetas')}</label>
                <input className="input h-9 w-full text-sm" value={tagsText} onChange={(event) => setTagsText(event.target.value)} placeholder={t('Separadas por comas')} />
                <label className={`${labelClass} mt-3`}>{t('Carpetas')}</label>
                <SearchableMultiSelect options={folderOptions} selectedIds={folderIds} onChange={setFolderIds} placeholder={t('Elegir carpetas…')} searchPlaceholder={t('Buscar carpeta…')} />
              </section>
            </div>

            <div className="space-y-4">
              <section className={`${sectionClass} min-h-64`}>
                <h3 className="mb-3 text-sm font-semibold">{t('5. Archivo o referencia')}</h3>
                {mode === 'device' && <>
                  <div className={`grid min-h-44 place-items-center rounded-xl border-2 border-dashed p-5 text-center transition-colors ${dragging ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/20' : 'border-neutral-300 dark:border-neutral-700'}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); addPaths(Array.from(event.dataTransfer.files).map((file) => window.nodus.getPathForDroppedFile(file)).filter(Boolean)); }}>
                    <div><Icon name="upload" size={26} className="mx-auto text-amber-500" /><p className="mt-2 text-sm font-medium">{t('Arrastra aquí cualquier tipo de archivo')}</p><p className="mt-1 text-xs text-neutral-500">{t('Documentos, imágenes, audio, vídeo, datos o cualquier otro formato.')}</p><button className="btn btn-ghost mt-3 min-h-9 border border-neutral-300 dark:border-neutral-700" onClick={() => void browse()}>{t('Examinar dispositivo')}</button></div>
                  </div>
                  {paths.length > 0 && <div className="mt-3 space-y-1.5">{paths.map((filePath) => <div key={filePath} className="flex items-center gap-2 rounded-lg bg-neutral-100 px-3 py-2 text-xs dark:bg-neutral-900"><Icon name="folder" size={14} /><span className="min-w-0 flex-1 truncate" title={filePath}>{fileName(filePath)}</span><button className="rounded p-1 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800" aria-label={t('Quitar')} onClick={() => setPaths((current) => current.filter((candidate) => candidate !== filePath))}><Icon name="x" size={12} /></button></div>)}</div>}
                </>}
                {mode === 'text' && <div className="grid min-h-44 place-items-center rounded-xl border border-neutral-200 p-6 text-center dark:border-neutral-800"><div><Icon name="edit" size={26} className="mx-auto text-amber-500" /><p className="mt-2 text-sm font-medium">{t('Entrada sin archivo adjunto')}</p><p className="mt-1 text-xs leading-5 text-neutral-500">{t('Ideal para transcripciones, testimonios, notas de investigación o referencias que todavía no tienen un archivo digital.')}</p></div></div>}
                {mode === 'zotero' && <div className="space-y-3">
                  <div className="flex gap-2"><select className="input min-w-36 text-sm" value={library ? `${library.type}:${library.id}` : ''} onChange={(event) => { setLibrary(libraries.find((candidate) => `${candidate.type}:${candidate.id}` === event.target.value) ?? null); setSelectedItem(null); }}><option value="">{t('Biblioteca')}</option>{libraries.map((candidate) => <option key={`${candidate.type}:${candidate.id}`} value={`${candidate.type}:${candidate.id}`}>{candidate.name}</option>)}</select><input className="input min-w-0 flex-1 text-sm" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Buscar en Zotero…')} /></div>
                  <div className="max-h-48 overflow-y-auto rounded-lg border border-neutral-200 dark:border-neutral-800">{loadingZotero ? <div className="p-6"><Spinner label={t('Buscando en Zotero…')} /></div> : zoteroItems.length ? zoteroItems.map((item) => <button key={item.key} className={`block w-full border-b border-neutral-200 px-3 py-2 text-left last:border-0 dark:border-neutral-800 ${selectedItem?.key === item.key ? 'bg-amber-50 dark:bg-amber-950/20' : 'hover:bg-neutral-50 dark:hover:bg-neutral-900'}`} onClick={() => void selectZoteroItem(item)}><span className="block truncate text-xs font-medium">{item.title}</span><span className="block truncate text-[10px] text-neutral-500">{creatorLabel(item) || t('Autor desconocido')}{item.year ? ` · ${item.year}` : ''}</span></button>) : <p className="p-6 text-center text-xs text-neutral-500">{t('No se encontraron elementos.')}</p>}</div>
                  {selectedItem && <div><label className={labelClass}>{t('Adjunto')}</label>{attachments.length ? <div className="space-y-1.5">{attachments.map((attachment) => <label key={attachment.key} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs ${attachmentKey === attachment.itemKey ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/20' : 'border-neutral-200 dark:border-neutral-800'}`}><input type="radio" name="archive-zotero-attachment" checked={attachmentKey === attachment.itemKey} onChange={() => setAttachmentKey(attachment.itemKey)} /><span className="min-w-0 truncate">{attachmentLabel(attachment)}</span></label>)}</div> : !loadingZotero && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">{t('Este elemento no tiene archivos adjuntos.')}</p>}</div>}
                </div>}
              </section>

              <section className={sectionClass}>
                <h3 className="mb-3 text-sm font-semibold">{t('6. Texto o transcripción')}</h3>
                <textarea className="input min-h-36 w-full resize-y text-sm" value={content} onChange={(event) => setContent(event.target.value)} placeholder={t('Opcional. Añade una transcripción o texto que deba ser buscable e indexado…')} />
                <p className="mt-2 text-[11px] leading-5 text-neutral-500">{t('Si el archivo permite extraer texto automáticamente, Nodus lo hará al guardarlo. Este campo permite añadirlo o sustituirlo manualmente.')}</p>
              </section>
            </div>
          </div>
        </div>

        <footer className="flex min-h-16 items-center gap-3 border-t border-neutral-200 px-5 py-3 dark:border-neutral-800">
          {error && <p className="min-w-0 flex-1 truncate text-xs text-red-500" title={error}>{error}</p>}
          <button className="btn btn-ghost ml-auto min-h-10 min-w-28 justify-center border border-neutral-300 dark:border-neutral-700" onClick={onClose}>{t('Cancelar')}</button>
          <button className="btn btn-primary min-h-10 min-w-28 justify-center" disabled={!canSave || busy} onClick={() => void save()}>{busy ? <Spinner label={t('Guardando…')} /> : t('Guardar entrada')}</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
