import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  StudyMaterialImportInput,
  StudyMaterialImportResult,
  ZoteroAttachmentInfo,
  ZoteroItem,
  ZoteroLibrary,
} from '@shared/types';
import { t } from '../i18n';
import { Icon, Spinner } from './ui';

function creatorLabel(item: ZoteroItem): string {
  return item.creators
    .slice(0, 3)
    .map((creator) => creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(' '))
    .filter(Boolean)
    .join(', ');
}

function attachmentLabel(attachment: ZoteroAttachmentInfo): string {
  const format = attachment.filename?.split('.').pop()?.toUpperCase() || attachment.contentType || t('Adjunto');
  return `${attachment.title}${format ? ` · ${format}` : ''}`;
}

export function ZoteroMaterialImportModal({
  placement = {},
  onImported,
  onClose,
}: {
  placement?: StudyMaterialImportInput;
  onImported: (result: StudyMaterialImportResult) => Promise<void> | void;
  onClose: () => void;
}) {
  const [libraries, setLibraries] = useState<ZoteroLibrary[]>([]);
  const [library, setLibrary] = useState<ZoteroLibrary | null>(null);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<ZoteroItem[]>([]);
  const [selected, setSelected] = useState<ZoteroItem | null>(null);
  const [attachments, setAttachments] = useState<ZoteroAttachmentInfo[]>([]);
  const [attachmentKey, setAttachmentKey] = useState('');
  const [mode, setMode] = useState<'import' | 'link'>('import');
  const [loading, setLoading] = useState(true);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void window.nodus.zoteroLibraries().then((next) => {
      if (!active) return;
      setLibraries(next);
      setLibrary(next[0] ?? null);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!library) return;
    let active = true;
    setLoading(true); setError(''); setSelected(null); setAttachments([]); setAttachmentKey('');
    const timer = window.setTimeout(() => {
      void window.nodus.zoteroSearchItems(library, query).then((next) => {
        if (active) setItems(next);
      }).catch((cause) => active && setError(cause instanceof Error ? cause.message : String(cause)))
        .finally(() => active && setLoading(false));
    }, 220);
    return () => { active = false; window.clearTimeout(timer); };
  }, [library?.type, library?.id, query]);

  const selectItem = async (item: ZoteroItem) => {
    setSelected(item); setAttachments([]); setAttachmentKey(''); setLoadingAttachments(true); setError('');
    try {
      const next = await window.nodus.zoteroItemAttachments(item.key, item.library);
      setAttachments(next);
      const preferred = next.find((attachment) => attachment.contentType === 'application/pdf') ?? next[0];
      setAttachmentKey(preferred?.itemKey ?? '');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoadingAttachments(false); }
  };

  const selectedAttachment = useMemo(
    () => attachments.find((attachment) => attachment.itemKey === attachmentKey) ?? null,
    [attachmentKey, attachments],
  );
  const canSubmit = Boolean(selected && (mode === 'link' || selectedAttachment));

  const submit = async () => {
    if (!selected || !library || !canSubmit || busy) return;
    setBusy(true); setError('');
    try {
      const result = await window.nodus.importZoteroStudyMaterial({
        ...placement,
        library,
        itemKey: selected.itemKey,
        attachmentKey: selectedAttachment?.itemKey ?? null,
        mode,
      });
      await onImported(result);
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  return createPortal(
    <div className="fixed inset-0 z-[170] grid place-items-center bg-black/60 p-4" onClick={onClose} data-testid="zotero-material-import-modal">
      <section className="card-modal flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-start gap-3 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-300"><Icon name="book" size={17} /></span>
          <div><h2 className="font-semibold">{t('Importar desde Zotero')}</h2><p className="mt-0.5 text-xs text-neutral-500">{t('Busca en tu biblioteca personal o en una biblioteca de grupo, elige un elemento y uno de sus adjuntos.')}</p></div>
          <button className="btn btn-ghost ml-auto px-2" aria-label={t('Cerrar')} onClick={onClose}><Icon name="x" /></button>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <div className="flex min-h-[32rem] flex-col border-b border-neutral-200 p-5 dark:border-neutral-800 lg:border-b-0 lg:border-r">
            <div className="flex flex-wrap gap-2">
              <select data-testid="zotero-material-library" className="input min-w-52" value={library ? `${library.type}:${library.id}` : ''} onChange={(event) => setLibrary(libraries.find((candidate) => `${candidate.type}:${candidate.id}` === event.target.value) ?? null)}>
                {libraries.map((candidate) => <option key={`${candidate.type}:${candidate.id}`} value={`${candidate.type}:${candidate.id}`}>{candidate.type === 'group' ? `${t('Grupo')}: ` : ''}{candidate.name}</option>)}
              </select>
              <label className="relative min-w-56 flex-1"><Icon name="search" size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" /><input autoFocus data-testid="zotero-material-search" className="input input-with-leading-icon w-full" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Buscar por título, autor o año…')} /></label>
            </div>
            <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
              {loading ? <div className="grid h-full place-items-center"><Spinner label={t('Buscando en Zotero…')} /></div> : items.length === 0 ? <div className="grid h-full place-items-center p-8 text-center text-sm text-neutral-500">{t('No se encontraron elementos en esta biblioteca.')}</div> : items.map((item) => {
                const active = selected?.key === item.key;
                return <button key={item.key} data-testid={`zotero-material-item-${item.itemKey}`} className={`flex w-full items-start gap-3 border-b border-neutral-200 px-3 py-3 text-left last:border-b-0 dark:border-neutral-800 ${active ? 'bg-indigo-50 shadow-[inset_3px_0_0_0_rgb(99_102_241)] dark:bg-indigo-950/25' : 'hover:bg-neutral-50 dark:hover:bg-neutral-900/60'}`} onClick={() => void selectItem(item)}><span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border ${active ? 'border-indigo-500 bg-indigo-500' : 'border-neutral-300 dark:border-neutral-600'}`} /><span className="min-w-0"><span className="block truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{item.title}</span><span className="mt-1 block truncate text-[11px] text-neutral-500">{creatorLabel(item) || t('Autor desconocido')}{item.year ? ` · ${item.year}` : ''} · {item.itemType}</span></span></button>;
              })}
            </div>
          </div>

          <div className="flex min-h-0 flex-col p-5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Elemento y adjunto')}</h3>
            {!selected ? <div className="grid flex-1 place-items-center py-12 text-center text-sm text-neutral-500">{t('Selecciona un elemento de la lista para ver sus adjuntos.')}</div> : <div className="mt-3 flex min-h-0 flex-1 flex-col">
              <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900/40"><p className="text-sm font-medium">{selected.title}</p><p className="mt-1 text-[11px] text-neutral-500">{creatorLabel(selected) || t('Autor desconocido')}{selected.year ? ` · ${selected.year}` : ''}</p></div>
              <div className="mt-4 text-xs font-medium text-neutral-500">{t('Adjunto')}</div>
              {loadingAttachments ? <div className="py-8"><Spinner label={t('Cargando adjuntos…')} /></div> : attachments.length ? <div className="mt-2 space-y-2 overflow-y-auto">{attachments.map((attachment) => <label key={attachment.key} className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-xs ${attachmentKey === attachment.itemKey ? 'border-indigo-400 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-950/25' : 'border-neutral-200 dark:border-neutral-800'}`}><input type="radio" name="zotero-attachment" checked={attachmentKey === attachment.itemKey} onChange={() => setAttachmentKey(attachment.itemKey)} /><span className="min-w-0 flex-1 truncate">{attachmentLabel(attachment)}</span></label>)}</div> : <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">{t('Este elemento no tiene adjuntos. Puedes enlazar el elemento, pero no importarlo como archivo.')}</p>}

              <div className="mt-5 grid gap-2">
                <button data-testid="zotero-material-mode-import" className={`rounded-lg border p-3 text-left ${mode === 'import' ? 'border-indigo-400 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-950/25' : 'border-neutral-200 dark:border-neutral-800'}`} onClick={() => setMode('import')}><span className="text-sm font-medium">{t('Importar el archivo a Nodus')}</span><span className="mt-1 block text-[11px] leading-5 text-neutral-500">{t('Copia el adjunto dentro del vault para leerlo, anotarlo e indexarlo sin depender de Zotero.')}</span></button>
                <button data-testid="zotero-material-mode-link" className={`rounded-lg border p-3 text-left ${mode === 'link' ? 'border-indigo-400 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-950/25' : 'border-neutral-200 dark:border-neutral-800'}`} onClick={() => setMode('link')}><span className="text-sm font-medium">{t('Enlazar con Zotero')}</span><span className="mt-1 block text-[11px] leading-5 text-neutral-500">{t('Guarda la referencia en Nodus y abre el elemento o adjunto desde la aplicación Zotero.')}</span></button>
              </div>
            </div>}
          </div>
        </div>

        <footer className="flex items-center gap-3 border-t border-neutral-200 px-5 py-3 dark:border-neutral-800">
          {error && <p className="min-w-0 flex-1 truncate text-xs text-red-500" title={error}>{error}</p>}
          <button className="btn btn-ghost ml-auto" onClick={onClose}>{t('Cancelar')}</button>
          <button data-testid="zotero-material-import-confirm" className="btn btn-primary" disabled={!canSubmit || busy} onClick={() => void submit()}>{busy ? <Spinner label={t('Importando…')} /> : mode === 'import' ? t('Importar a Nodus') : t('Crear enlace')}</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
