import { useEffect, useState, type DragEvent } from 'react';
import {
  TRANSLATION_LANGUAGES,
  type AppSettings,
  type ModelRef,
  type TranslateHistoryEntry,
  type TranslateInputKind,
  type TranslateJobRequest,
  type TranslateOutputFormat,
  type TranslatePdfMode,
  type ZoteroAttachmentInfo,
  type ZoteroItem,
  type ZoteroLibrary,
} from '@shared/types';
import { isLocalProvider } from '@shared/providers';
import { ModelPicker, SubscriptionQuotaNotice } from '../components/ModelPicker';
import { Icon, Spinner } from '../components/ui';
import { t } from '../i18n';
import {
  TRANSLATE_JOB_KEY,
  clearBackgroundJob,
  getBackgroundJob,
  startTranslateJob,
  subscribeBackgroundJob,
  type ToolkitTranslateJob,
} from '../backgroundJobs';

const INPUT_EXTENSIONS = ['txt', 'md', 'markdown', 'html', 'htm', 'docx', 'epub', 'pdf'];
type TranslateTab = TranslateInputKind | 'history';

function basename(filePath: string): string {
  const index = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return index >= 0 ? filePath.slice(index + 1) : filePath;
}

function creatorLabel(item: ZoteroItem): string {
  const creator = item.creators[0];
  if (!creator) return item.year ? String(item.year) : item.itemType;
  const name = creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(' ');
  return [name, item.year].filter(Boolean).join(' · ');
}

function progressLabel(job: ToolkitTranslateJob): string {
  if (job.status === 'failed') return job.error || 'No se pudo completar la traducción.';
  if (job.status === 'completed') return job.result?.cancelled ? 'Trabajo cancelado.' : 'Traducción completada.';
  return job.progress?.message || 'Preparando la traducción…';
}

export function ToolkitTranslateView({ onBack, settings }: { onBack: () => void; settings: AppSettings | null }) {
  const existing = getBackgroundJob<TranslateJobRequest, ToolkitTranslateJob['progress'], ToolkitTranslateJob['result']>(TRANSLATE_JOB_KEY) as ToolkitTranslateJob | null;
  const [tab, setTab] = useState<TranslateTab>('text');
  const [sourceText, setSourceText] = useState('');
  const [paths, setPaths] = useState<string[]>([]);
  const [targetLanguage, setTargetLanguage] = useState('en');
  const [sourceLanguage, setSourceLanguage] = useState('');
  const [model, setModel] = useState<ModelRef | null>(() => settings?.synthesisModel ?? null);
  const [outputFormat, setOutputFormat] = useState<TranslateOutputFormat>('same');
  const [pdfMode, setPdfMode] = useState<TranslatePdfMode>('facsimile');
  const [translateImageText, setTranslateImageText] = useState(false);
  const [glossary, setGlossary] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [outputDir, setOutputDir] = useState<string | null>(null);
  const [openFolderOnDone, setOpenFolderOnDone] = useState(true);
  const [job, setJob] = useState<ToolkitTranslateJob | null>(existing);
  const [notice, setNotice] = useState<string | null>(null);

  const [libraries, setLibraries] = useState<ZoteroLibrary[]>([]);
  const [library, setLibrary] = useState<ZoteroLibrary | null>(null);
  const [zoteroQuery, setZoteroQuery] = useState('');
  const [zoteroItems, setZoteroItems] = useState<ZoteroItem[]>([]);
  const [zoteroBusy, setZoteroBusy] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ZoteroItem | null>(null);
  const [attachments, setAttachments] = useState<ZoteroAttachmentInfo[]>([]);
  const [selectedAttachment, setSelectedAttachment] = useState<ZoteroAttachmentInfo | null>(null);
  const [zoteroConnecting, setZoteroConnecting] = useState(false);
  const [zoteroSearching, setZoteroSearching] = useState(false);
  const [zoteroError, setZoteroError] = useState<string | null>(null);
  const [zoteroConnectAttempt, setZoteroConnectAttempt] = useState(0);

  const [history, setHistory] = useState<TranslateHistoryEntry[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);

  useEffect(() => subscribeBackgroundJob(TRANSLATE_JOB_KEY, (next) => setJob(next as ToolkitTranslateJob | null)), []);
  useEffect(() => {
    if (!model && settings?.synthesisModel) setModel(settings.synthesisModel);
  }, [settings, model]);

  useEffect(() => {
    if (tab !== 'zotero') return;
    let disposed = false;
    setZoteroConnecting(true);
    setZoteroError(null);
    void window.nodus.zoteroPing().then(async (status) => {
      if (!status.ok) throw new Error(status.message || 'Zotero no está disponible.');
      const next = await window.nodus.zoteroLibraries();
      if (disposed) return;
      setLibraries(next);
      setLibrary((current) => next.find((candidate) => current && candidate.type === current.type && candidate.id === current.id) ?? next[0] ?? null);
      setZoteroError(null);
    }).catch((error) => {
      if (disposed) return;
      setLibraries([]);
      setLibrary(null);
      setZoteroItems([]);
      setZoteroError(error instanceof Error ? error.message : String(error));
    }).finally(() => { if (!disposed) setZoteroConnecting(false); });
    return () => { disposed = true; };
  }, [tab, zoteroConnectAttempt]);

  useEffect(() => {
    if (tab !== 'zotero' || !library) return;
    let disposed = false;
    const timer = window.setTimeout(() => {
      setZoteroSearching(true);
      setZoteroError(null);
      void window.nodus.zoteroSearchItems(library, zoteroQuery)
        .then((next) => { if (!disposed) setZoteroItems(next); })
        .catch((error) => { if (!disposed) setZoteroError(error instanceof Error ? error.message : String(error)); })
        .finally(() => { if (!disposed) setZoteroSearching(false); });
    }, 220);
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [tab, library, zoteroQuery]);

  useEffect(() => {
    if (tab !== 'history') return;
    let disposed = false;
    setHistoryBusy(true);
    void window.nodus.listTranslateHistory()
      .then((next) => { if (!disposed) setHistory(next); })
      .catch((error) => { if (!disposed) setNotice(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (!disposed) setHistoryBusy(false); });
    return () => { disposed = true; };
  }, [tab, job?.status]);

  const chooseItem = async (item: ZoteroItem) => {
    setSelectedItem(item); setSelectedAttachment(null); setAttachments([]); setZoteroBusy(true); setZoteroError(null);
    try {
      const next = await window.nodus.zoteroItemAttachments(item.key, item.library);
      const compatible = next.filter((entry) => {
        if (!entry.available) return false;
        const filename = entry.filename?.toLowerCase() ?? '';
        const compatibleName = INPUT_EXTENSIONS.some((ext) => filename.endsWith(`.${ext}`));
        const compatibleType = entry.contentType === 'application/pdf'
          || entry.contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          || entry.contentType === 'application/epub+zip'
          || entry.contentType === 'text/plain'
          || entry.contentType === 'text/html'
          || entry.contentType === 'text/markdown';
        return compatibleName || compatibleType;
      });
      setAttachments(compatible);
      setSelectedAttachment(compatible[0] ?? null);
      if (!compatible.length) setZoteroError('Este elemento no tiene adjuntos locales compatibles.');
    } catch (error) {
      setZoteroError(error instanceof Error ? error.message : String(error));
    } finally { setZoteroBusy(false); }
  };

  const running = job?.status === 'running';
  const hasPdf = paths.some((file) => /\.pdf$/i.test(file)) || selectedAttachment?.contentType === 'application/pdf';
  const canRun = tab !== 'history' && Boolean(model) && !running && (
    tab === 'text' ? Boolean(sourceText.trim()) : tab === 'files' ? paths.length > 0 : Boolean(selectedAttachment && selectedItem)
  );
  const target = TRANSLATION_LANGUAGES.find((language) => language.code === targetLanguage);
  const cloud = model ? !isLocalProvider(model.provider) && model.provider !== 'nodus' : false;

  const addPaths = (next: string[]) => setPaths((current) => [...new Set([...current, ...next.filter((file) => INPUT_EXTENSIONS.some((ext) => file.toLowerCase().endsWith(`.${ext}`)))])]);
  const pickFiles = async () => addPaths(await window.nodus.pickToolkitFiles(INPUT_EXTENSIONS));
  const drop = (event: DragEvent) => {
    event.preventDefault();
    addPaths([...event.dataTransfer.files].map((file) => window.nodus.getPathForDroppedFile(file)).filter(Boolean));
  };

  const removeHistoryEntry = async (entry: TranslateHistoryEntry, deleteOutput: boolean) => {
    const question = deleteOutput
      ? `¿Mover “${basename(entry.outputPath || entry.sourceLabel)}” a la Papelera y quitarlo del historial?`
      : '¿Quitar esta entrada del historial? El archivo generado no se eliminará.';
    if (!window.confirm(question)) return;
    setHistoryBusy(true);
    try {
      setHistory(await window.nodus.removeTranslateHistory(entry.id, deleteOutput));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setHistoryBusy(false);
    }
  };

  const run = () => {
    if (!canRun) return;
    setNotice(null);
    clearBackgroundJob(TRANSLATE_JOB_KEY);
    const request: TranslateJobRequest = {
      inputKind: tab,
      text: tab === 'text' ? sourceText : undefined,
      inputPaths: tab === 'files' ? paths : undefined,
      zotero: tab === 'zotero' && selectedItem && selectedAttachment ? {
        itemKey: selectedItem.key,
        attachmentKey: selectedAttachment.key,
        libraryType: selectedItem.library.type,
        libraryId: selectedItem.library.id,
        title: selectedItem.title,
      } : undefined,
      sourceLanguage: sourceLanguage.trim() || null,
      targetLanguage,
      model,
      outputFormat: tab === 'text' ? 'txt' : outputFormat,
      pdfMode,
      translateImageText,
      glossary: glossary.trim(),
      outputDir,
      openFolderOnDone,
    };
    setJob(startTranslateJob(request));
  };

  const translatedText = job?.status === 'completed' ? job.result?.translatedText : null;
  const outputs = job?.status === 'completed' ? job.result?.outputs ?? [] : [];
  const progress = Math.round((job?.progress?.pct ?? (job?.status === 'completed' ? 1 : 0)) * 100);

  return <div data-testid="translate-home" className="mx-auto max-w-5xl space-y-5 pb-12">
    <header className="flex items-start gap-3">
      <button data-testid="toolkit-translate-back" type="button" aria-label={t('Volver a Herramientas')} onClick={onBack} className="mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-neutral-300 bg-white text-neutral-600 hover:border-amber-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"><Icon name="chevronLeft" size={17} /></button>
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"><Icon name="languages" size={23} /></span>
      <div><h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Nodus Translate</h1><p className="text-sm text-neutral-500">Traduce texto, documentos o adjuntos de Zotero conservando su estructura y, en PDF, la disposición de cada página.</p></div>
    </header>

    <nav className="grid grid-cols-2 gap-1 rounded-xl bg-neutral-100 p-1 sm:grid-cols-4 dark:bg-neutral-900/60" aria-label="Secciones de traducción">
      {([['text', 'Texto', 'edit'], ['files', 'Documentos', 'file'], ['zotero', 'Zotero', 'book'], ['history', 'Historial', 'clock']] as const).map(([id, label, icon]) => <button key={id} data-testid={`translate-tab-${id}`} type="button" onClick={() => { setNotice(null); setTab(id); }} className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${tab === id ? 'bg-white text-amber-700 shadow-sm dark:bg-neutral-800 dark:text-amber-300' : 'text-neutral-500'}`}><Icon name={icon} size={15} />{label}</button>)}
    </nav>

    {tab === 'text' && <section className="grid gap-6 lg:grid-cols-2">
      <label className="block min-w-0"><span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-neutral-500">Texto original</span><textarea data-testid="translate-source-text" className="input block min-h-72 w-full resize-y leading-6" value={sourceText} onChange={(event) => setSourceText(event.target.value)} placeholder="Escribe o pega aquí el texto que quieres traducir…" /></label>
      <div className="min-w-0"><span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-neutral-500">Traducción</span><div data-testid="translate-result-text" className="min-h-72 whitespace-pre-wrap rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm leading-6 text-neutral-800 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-200">{translatedText || <span className="text-neutral-400">El resultado aparecerá aquí.</span>}</div>{translatedText && <div className="mt-2 flex gap-2"><button className="btn btn-ghost gap-1.5" onClick={() => void navigator.clipboard.writeText(translatedText)}><Icon name="copy" size={14} />Copiar</button><button className="btn btn-ghost gap-1.5" onClick={() => void window.nodus.saveTranslatedText(translatedText, target?.nativeName || targetLanguage)}><Icon name="download" size={14} />Guardar TXT</button></div>}</div>
    </section>}

    {tab === 'files' && <section>
      <button data-testid="translate-file-dropzone" type="button" onClick={() => void pickFiles()} onDragOver={(event) => event.preventDefault()} onDrop={drop} className="flex min-h-36 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-neutral-300 bg-neutral-50 p-7 text-neutral-500 hover:border-amber-400 dark:border-neutral-700 dark:bg-neutral-900/30"><Icon name="upload" size={25} className="text-amber-600" /><strong className="text-sm text-neutral-700 dark:text-neutral-200">Suelta documentos o selecciónalos</strong><span className="text-xs">TXT · Markdown · HTML · DOCX · EPUB · PDF</span></button>
      {!!paths.length && <ul className="mt-3 space-y-1.5">{paths.map((file) => <li key={file} className="flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800"><Icon name="file" size={14} /><span className="min-w-0 flex-1 truncate">{basename(file)}</span><button className="text-neutral-400 hover:text-red-400" onClick={() => setPaths((current) => current.filter((item) => item !== file))}><Icon name="x" size={14} /></button></li>)}</ul>}
    </section>}

    {tab === 'zotero' && <section className="space-y-3">
      <div className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs ${zoteroError ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300' : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-300'}`}>
        <Icon name={zoteroError ? 'alert' : zoteroConnecting ? 'sync' : 'check'} size={14} className={zoteroConnecting ? 'animate-spin' : ''} />
        <span className="min-w-0 flex-1">{zoteroConnecting ? 'Conectando con Zotero…' : zoteroError || `Conectado a Zotero · ${libraries.length} ${libraries.length === 1 ? 'biblioteca' : 'bibliotecas'}`}</span>
        <button data-testid="translate-zotero-reconnect" type="button" className="btn btn-ghost !px-2 !py-1" disabled={zoteroConnecting} onClick={() => setZoteroConnectAttempt((value) => value + 1)}>Reconectar</button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="min-w-0 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <div className="flex flex-col gap-2 sm:flex-row">
            <select data-testid="translate-zotero-library" aria-label="Biblioteca de Zotero" className="input w-full sm:max-w-52" disabled={zoteroConnecting || libraries.length === 0} value={library ? `${library.type}:${library.id}` : ''} onChange={(event) => { const next = libraries.find((entry) => `${entry.type}:${entry.id}` === event.target.value) ?? null; setLibrary(next); setZoteroItems([]); setSelectedItem(null); setAttachments([]); setSelectedAttachment(null); }}><option value="" disabled>{zoteroConnecting ? 'Conectando…' : 'Selecciona biblioteca'}</option>{libraries.map((entry) => <option key={`${entry.type}:${entry.id}`} value={`${entry.type}:${entry.id}`}>{entry.name}</option>)}</select>
            <div className="relative min-w-0 flex-1"><Icon name="search" size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" /><input data-testid="translate-zotero-search" className="input input-with-leading-icon w-full" disabled={!library || zoteroConnecting} value={zoteroQuery} onChange={(event) => setZoteroQuery(event.target.value)} placeholder="Buscar título, autor o año…" /></div>
          </div>
          {zoteroSearching && !zoteroItems.length ? <div className="py-10"><Spinner label="Buscando en Zotero…" /></div> : zoteroItems.length ? <ul data-testid="translate-zotero-results" className="mt-3 max-h-72 space-y-1 overflow-y-auto">{zoteroItems.map((item) => <li key={item.key}><button type="button" onClick={() => void chooseItem(item)} className={`w-full rounded-lg border px-3 py-2 text-left ${selectedItem?.key === item.key ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/20' : 'border-transparent hover:bg-neutral-50 dark:hover:bg-neutral-900'}`}><span className="block truncate text-sm font-medium">{item.title}</span><span className="block truncate text-xs text-neutral-500">{creatorLabel(item)}</span></button></li>)}</ul> : library && !zoteroSearching ? <p className="py-10 text-center text-sm text-neutral-500">No hay resultados para esta búsqueda.</p> : null}
        </div>
        <div className="min-w-0 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"><h2 className="text-sm font-semibold">Adjunto que se traducirá</h2>{zoteroBusy ? <div className="py-8"><Spinner label="Cargando adjuntos…" /></div> : !selectedItem ? <p className="mt-8 text-center text-sm text-neutral-500">Selecciona primero un elemento de Zotero.</p> : !attachments.length ? <p className="mt-8 text-center text-sm text-neutral-500">No hay adjuntos compatibles descargados.</p> : <div className="mt-3 space-y-2">{attachments.map((attachment) => <label key={attachment.key} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 ${selectedAttachment?.key === attachment.key ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/20' : 'border-neutral-200 dark:border-neutral-800'}`}><input type="radio" checked={selectedAttachment?.key === attachment.key} onChange={() => setSelectedAttachment(attachment)} /><Icon name="file" size={16} /><span className="min-w-0"><span className="block truncate text-sm font-medium">{attachment.title}</span><span className="block truncate text-xs text-neutral-500">{attachment.filename || attachment.contentType}</span></span></label>)}</div>}</div>
      </div>
    </section>}

    {tab === 'history' && <section data-testid="translate-history" className="rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900/40">
      <div className="flex items-center gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800"><div className="min-w-0 flex-1"><h2 className="text-sm font-semibold">Documentos procesados</h2><p className="text-xs text-neutral-500">Los archivos se conservan en su carpeta de salida hasta que elijas moverlos a la Papelera.</p></div><button className="btn btn-ghost gap-1.5" disabled={historyBusy} onClick={() => { setHistoryBusy(true); void window.nodus.listTranslateHistory().then(setHistory).catch((error) => setNotice(error instanceof Error ? error.message : String(error))).finally(() => setHistoryBusy(false)); }}><Icon name="sync" size={13} className={historyBusy ? 'animate-spin' : ''} />Actualizar</button></div>
      {historyBusy && !history.length ? <div className="py-14"><Spinner label="Cargando historial…" /></div> : !history.length ? <div className="grid place-items-center gap-2 px-5 py-16 text-center text-neutral-500"><Icon name="clock" size={28} /><p className="text-sm font-medium">Todavía no hay traducciones guardadas.</p><p className="text-xs">Los próximos textos y documentos aparecerán aquí automáticamente.</p></div> : <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">{history.map((entry) => <li key={entry.id} data-testid={`translate-history-entry-${entry.id}`} className="p-4"><div className="flex flex-wrap items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"><Icon name={entry.inputKind === 'text' ? 'edit' : entry.inputKind === 'zotero' ? 'book' : 'file'} size={15} /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{entry.outputPath ? basename(entry.outputPath) : entry.sourceLabel}</p><p className="mt-0.5 text-xs text-neutral-500">{new Date(entry.createdAt).toLocaleString()} · {entry.targetLanguageLabel} · {entry.model.provider} · {entry.model.model}{entry.pdfMode ? ` · ${entry.pdfMode === 'facsimile' ? 'Facsímil' : 'Refluido'}` : ''}</p>{entry.outputPath && !entry.outputExists && <p className="mt-1 text-xs text-amber-600">El archivo ya no está en su ubicación original.</p>}{entry.translatedText && <p className="mt-2 line-clamp-3 whitespace-pre-wrap rounded-lg bg-neutral-50 p-2 text-xs leading-5 text-neutral-600 dark:bg-neutral-950/40 dark:text-neutral-400">{entry.translatedText}</p>}{entry.warnings.length > 0 && <p className="mt-1 text-xs text-amber-600">{entry.warnings.length} aviso{entry.warnings.length === 1 ? '' : 's'} · revisar resultado</p>}</div><div className="flex shrink-0 flex-wrap justify-end gap-1">{entry.outputPath && entry.outputExists && <button className="btn btn-ghost !px-2 !py-1 text-xs" onClick={() => void window.nodus.revealToolkitOutput(entry.outputPath!)}>Mostrar</button>}{entry.translatedText && <button className="btn btn-ghost !px-2 !py-1 text-xs" onClick={() => void navigator.clipboard.writeText(entry.translatedText!)}><Icon name="copy" size={12} />Copiar</button>}<button className="btn btn-ghost !px-2 !py-1 text-xs text-neutral-500" disabled={historyBusy} onClick={() => void removeHistoryEntry(entry, false)}>Quitar</button>{entry.outputPath && entry.outputExists && <button className="btn btn-ghost !px-2 !py-1 text-xs text-red-500" disabled={historyBusy} onClick={() => void removeHistoryEntry(entry, true)}><Icon name="trash" size={12} />Eliminar archivo</button>}</div></div></li>)}</ul>}
    </section>}
    {tab === 'history' && notice && <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300">{notice}</p>}

    {tab !== 'history' && <><section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900/40">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block text-sm"><span className="mb-1 block font-medium">Idioma de destino</span><select data-testid="translate-target-language" className="input" value={targetLanguage} onChange={(event) => setTargetLanguage(event.target.value)}>{TRANSLATION_LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.nativeName} — {language.name}</option>)}</select></label>
        <label className="block text-sm"><span className="mb-1 block font-medium">Modelo de IA</span>{settings ? <ModelPicker settings={settings} value={model} onChange={setModel} allowEmpty={false} emptyLabel="Seleccionar modelo" /> : <Spinner label={t('Cargando…')} />}</label>
      </div>
      <SubscriptionQuotaNotice model={model} />
      {cloud && model && <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200"><Icon name="lock" size={13} className="mr-1 inline" />El contenido se enviará a {model.provider}. Para mantenerlo en el dispositivo, selecciona un modelo local.</p>}

      {tab !== 'text' && <div className="grid gap-4 border-t border-neutral-200 pt-4 md:grid-cols-2 dark:border-neutral-800">
        <label className="block text-sm"><span className="mb-1 block font-medium">Formato de salida</span><select className="input" value={outputFormat} onChange={(event) => { const next = event.target.value as TranslateOutputFormat; setOutputFormat(next); if (next !== 'same' && next !== 'pdf') setPdfMode('reflow'); }}><option value="same">Conservar el formato original</option><option value="pdf">PDF</option><option value="html">HTML</option><option value="md">Markdown</option><option value="txt">Texto</option></select></label>
        <div><span className="mb-1 block text-sm font-medium">Carpeta de salida</span><div className="flex gap-2"><div className="input min-w-0 flex-1 truncate text-sm text-neutral-500">{outputDir || (tab === 'zotero' ? 'Descargas' : 'Junto al original')}</div><button className="btn btn-ghost" onClick={async () => { const picked = await window.nodus.pickToolkitOutputDir(); if (picked) setOutputDir(picked); }}>Elegir…</button></div></div>
      </div>}

      {tab !== 'text' && hasPdf && <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-900/50 dark:bg-indigo-950/15"><div className="grid gap-3 sm:grid-cols-2"><label className={`rounded-lg border p-3 ${outputFormat === 'same' || outputFormat === 'pdf' ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'} ${pdfMode === 'facsimile' ? 'border-indigo-500 bg-white dark:bg-neutral-900' : 'border-transparent'}`}><input className="mr-2" type="radio" disabled={outputFormat !== 'same' && outputFormat !== 'pdf'} checked={pdfMode === 'facsimile'} onChange={() => setPdfMode('facsimile')} /><strong className="text-sm">Facsímil</strong><span className="mt-1 block text-xs text-neutral-500">Conserva visualmente páginas, imágenes, colores y posiciones. El resultado es un PDF rasterizado y su texto no será seleccionable.</span></label><label className={`cursor-pointer rounded-lg border p-3 ${pdfMode === 'reflow' ? 'border-indigo-500 bg-white dark:bg-neutral-900' : 'border-transparent'}`}><input className="mr-2" type="radio" checked={pdfMode === 'reflow'} onChange={() => setPdfMode('reflow')} /><strong className="text-sm">Documento refluido</strong><span className="mt-1 block text-xs text-neutral-500">Prioriza lectura y jerarquía; puede cambiar los saltos de página.</span></label></div><label className="mt-3 flex items-start gap-2 text-sm"><input className="mt-0.5" type="checkbox" checked={translateImageText} onChange={(event) => setTranslateImageText(event.target.checked)} /><span>Traducir también texto integrado en imágenes <small className="block text-xs text-neutral-500">Requiere un modelo con visión y analiza cada página completa.</small></span></label></div>}

      <button className="flex items-center gap-2 text-xs font-semibold text-neutral-500" onClick={() => setAdvanced((value) => !value)}><Icon name="chevronDown" size={13} className={advanced ? 'rotate-180' : ''} />Opciones avanzadas</button>
      {advanced && <div className="grid gap-4 md:grid-cols-2"><label className="block text-sm"><span className="mb-1 block font-medium">Idioma de origen <small className="font-normal text-neutral-500">(vacío = automático)</small></span><input className="input" value={sourceLanguage} onChange={(event) => setSourceLanguage(event.target.value)} placeholder="Ej.: francés" /></label><label className="block text-sm"><span className="mb-1 block font-medium">Glosario <small className="font-normal text-neutral-500">(origen=destino)</small></span><textarea className="input min-h-20 font-mono text-xs" value={glossary} onChange={(event) => setGlossary(event.target.value)} placeholder={'machine learning=aprendizaje automático\nframework=marco'} /></label>{tab !== 'text' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={openFolderOnDone} onChange={(event) => setOpenFolderOnDone(event.target.checked)} />Mostrar el resultado al terminar</label>}</div>}
    </section>

    {notice && <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300">{notice}</p>}

    <div className="flex flex-wrap items-center gap-3">
      <button data-testid="translate-run" className="btn btn-primary min-w-40 gap-2" disabled={!canRun} onClick={run}>{running ? <><Icon name="sync" size={15} className="animate-spin" />Traduciendo…</> : <><Icon name="languages" size={15} />Traducir</>}</button>
      {running && <button className="btn btn-ghost" onClick={() => { if (job?.progress?.jobId) void window.nodus.cancelTranslateJob(job.progress.jobId); }}>Cancelar</button>}
      {!model && <span className="text-xs text-amber-600">Selecciona un modelo para continuar.</span>}
    </div>

    {job && <section data-testid="translate-job-status" className={`rounded-xl border p-4 ${job.status === 'failed' ? 'border-red-300 bg-red-50 dark:border-red-900/60 dark:bg-red-950/20' : 'border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/30'}`}><div className="flex items-center gap-3"><Icon name={job.status === 'failed' ? 'alert' : job.status === 'completed' ? 'check' : 'sync'} size={17} className={job.status === 'running' ? 'animate-spin text-amber-500' : ''} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{progressLabel(job)}</p><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"><div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-teal-500 transition-all" style={{ width: `${progress}%` }} /></div></div><span className="text-xs tabular-nums text-neutral-500">{progress}%</span></div>{job.status !== 'running' && <button className="mt-3 text-xs text-neutral-500 hover:text-neutral-800" onClick={() => { clearBackgroundJob(TRANSLATE_JOB_KEY, job.id); setJob(null); }}>Cerrar estado</button>}</section>}

    {!!outputs.length && <section data-testid="translate-outputs" className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/15"><h2 className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">Archivos traducidos</h2><ul className="mt-2 space-y-2">{outputs.map((output) => <li key={output.outputPath} className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-3 py-2 dark:bg-neutral-900"><Icon name="check" size={14} className="text-emerald-500" /><span className="min-w-0 flex-1 truncate text-sm">{basename(output.outputPath)}</span>{output.overflowPages.length > 0 && <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Revisar págs. {output.overflowPages.join(', ')}</span>}<button className="btn btn-ghost !py-1" onClick={() => void window.nodus.revealToolkitOutput(output.outputPath)}>Mostrar</button></li>)}</ul>{(job?.result?.warnings.length ?? 0) > 0 && <ul className="mt-3 space-y-1 text-xs text-amber-700 dark:text-amber-300">{job?.result?.warnings.map((warning, index) => <li key={index}>• {warning}</li>)}</ul>}</section>}</>}
  </div>;
}
