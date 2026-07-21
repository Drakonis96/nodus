// Nodus AI OCR (OCR Workspace) — the library workspace plus the page-by-page review.
// Transcribes scanned PDFs and images with the app's vision models, keeping a persistent
// per-document library that survives navigation (processing runs in main; progress
// arrives on aiOcr:event). The library covers upload -> options -> process -> live
// progress; opening a document reveals the review: the original page image beside its
// editable transcription, with per-page reprocess and manual edits saved back.
//
// Design follows the Toolkit conventions (amber accent, back-button header, dashed
// dropzone, NoticeBar) — deliberately NOT the reference app's look.
import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
import type {
  AiOcrExportFormat,
  AppSettings,
  ModelRef,
  OcrDoc,
  OcrDocStatus,
  OcrDocSummary,
  OcrOptions,
  OcrPageState,
  OcrProcessingMode,
} from '@shared/types';
import { isLocalProvider } from '@shared/providers';
import { OCR_CONCURRENCY_OPTIONS } from '@shared/aiOcrTypes';
import { Icon, Spinner, modelLabel } from '../components/ui';
import { ModelPicker, SubscriptionQuotaNotice } from '../components/ModelPicker';
import { ConfirmModal } from '../components/ConfirmModal';
import { t, tx } from '../i18n';

type Notice = { kind: 'ok' | 'error' | 'info'; text: string } | null;

// Literal t() calls (not t(TABLE[status])) so the i18n coverage test collects these
// keys — a dynamic lookup would silently fall back to Spanish for every language.
function statusLabel(status: OcrDocStatus): string {
  switch (status) {
    case 'pending': return t('En cola');
    case 'processing': return t('Procesando');
    case 'done': return t('Hecho');
    case 'error': return t('Con errores');
    case 'cancelled': return t('Cancelado');
  }
}

const STATUS_STYLE: Record<OcrDocStatus, string> = {
  pending: 'bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300',
  processing: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
  done: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  error: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  cancelled: 'bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300',
};

/** A per-page hint badge in the review (error / blank / text-fallback), or none. */
function pageBadge(page: OcrPageState): { label: string; style: string } | null {
  if (page.status === 'error') return { label: t('Error'), style: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' };
  if (page.blankPage) return { label: t('Página en blanco'), style: 'bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300' };
  if (page.mode === 'text') return { label: t('Respaldo de texto'), style: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300' };
  return null;
}

function ocrErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function BackButton({ testid, label, onClick }: { testid: string; label: string; onClick: () => void }) {
  return (
    <button
      data-testid={testid}
      type="button"
      onClick={onClick}
      aria-label={label}
      className="mt-0.5 rounded-lg border border-neutral-200 p-2 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-800"
    >
      <Icon name="arrowLeft" size={18} />
    </button>
  );
}

function Loseta() {
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
      <Icon name="scanText" size={21} />
    </span>
  );
}

function NoticeBar({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  if (!notice) return null;
  const styles = notice.kind === 'error'
    ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200'
    : notice.kind === 'ok'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'
      : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200';
  return (
    <div role={notice.kind === 'error' ? 'alert' : 'status'} className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${styles}`}>
      <span>{notice.text}</span>
      <button type="button" aria-label={t('Cerrar')} onClick={onClose}><Icon name="x" size={15} /></button>
    </div>
  );
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
      <div className="h-full rounded-full bg-amber-500 transition-[width]" style={{ width: `${pct}%` }} />
    </div>
  );
}

// Format names are brand/technical labels, shown verbatim (never through t()).
const EXPORT_FORMATS: AiOcrExportFormat[] = ['md', 'txt', 'html', 'epub', 'pdf'];
const EXPORT_LABEL: Record<AiOcrExportFormat, string> = { md: 'Markdown', txt: 'TXT', html: 'HTML', epub: 'EPUB', pdf: 'PDF' };

function ExportControl({ format, onFormat, onExport, label, busy }: {
  format: AiOcrExportFormat;
  onFormat: (f: AiOcrExportFormat) => void;
  onExport: () => void;
  label: string;
  busy: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-neutral-500">{t('Formato')}</label>
      <select className="input w-auto py-1 text-xs" value={format} onChange={(event) => onFormat(event.target.value as AiOcrExportFormat)}>
        {EXPORT_FORMATS.map((f) => <option key={f} value={f}>{EXPORT_LABEL[f]}</option>)}
      </select>
      <button type="button" disabled={busy} onClick={onExport} className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200">
        <Icon name="download" size={15} />{label}
      </button>
    </div>
  );
}

// Manual-mode prompt presets, persisted in localStorage (no schema, renderer-only).
const PRESETS_KEY = 'nodus.aiOcr.promptPresets';
interface PromptPreset { name: string; prompt: string; }
function loadPresets(): PromptPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((p) => p && typeof p.name === 'string' && typeof p.prompt === 'string') : [];
  } catch { return []; }
}
function savePresetsToStorage(list: PromptPreset[]): void {
  try { localStorage.setItem(PRESETS_KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
}

// Reprocess picks a model in a modal before re-running (so a page/document can be
// retried with a stronger — or a local — model without leaving the workspace).
function ReprocessModelModal({ settings, initial, title, onConfirm, onCancel }: {
  settings: AppSettings;
  initial: ModelRef | null;
  title?: string;
  onConfirm: (model: ModelRef | null) => void;
  onCancel: () => void;
}) {
  const [choice, setChoice] = useState<ModelRef | null>(initial);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <div data-testid="aiocr-reprocess-modal" className="w-full max-w-md space-y-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{title ?? t('Reprocesar documento')}</h3>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('Elige el modelo para volver a procesar.')}</p>
        </div>
        <ModelPicker settings={settings} value={choice} onChange={setChoice} allowEmpty={false} emptyLabel="Seleccionar modelo" />
        <SubscriptionQuotaNotice model={choice} />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200">{t('Cancelar')}</button>
          <button type="button" disabled={!choice} onClick={() => onConfirm(choice)} className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"><Icon name="refresh" size={15} />{t('Reprocesar')}</button>
        </div>
      </div>
    </div>
  );
}

// ── Page-by-page review + editor ───────────────────────────────────────────────

function DocReview({ docId, settings, onBack }: { docId: string; settings: AppSettings | null; onBack: () => void }) {
  const [doc, setDoc] = useState<OcrDoc | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [image, setImage] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [exportFormat, setExportFormat] = useState<AiOcrExportFormat>('md');
  const [exporting, setExporting] = useState(false);
  const [reprocessMode, setReprocessMode] = useState<'page' | 'doc' | null>(null);

  const loadDoc = useCallback(async () => {
    try { setDoc(await window.nodus.getOcrDoc(docId)); }
    catch (error) { setNotice({ kind: 'error', text: ocrErrorText(error) }); }
  }, [docId]);

  useEffect(() => {
    void loadDoc();
    return window.nodus.onOcrEvent((id) => { if (id === docId) void loadDoc(); });
  }, [loadDoc, docId]);

  const total = doc?.pageCount ?? 0;
  const page = doc?.pages.find((p) => p.index === pageIndex) ?? null;
  const active = doc ? doc.status === 'processing' || doc.status === 'pending' : false;
  const updatedAt = doc?.updatedAt ?? 0;
  const pageStatus = page?.status ?? '';

  // Load the current page image + text; reloads when the page's OCR result changes
  // (updatedAt / status), e.g. after a reprocess, and never applies a stale response.
  useEffect(() => {
    if (!doc || total === 0) { setImage(null); setText(''); return undefined; }
    let cancelled = false;
    const idx = Math.min(pageIndex, total - 1);
    void window.nodus.getOcrPageImage(docId, idx).then((img) => { if (!cancelled) setImage(img); });
    void window.nodus.getOcrPageText(docId, idx).then((txt) => { if (!cancelled) { setText(txt); setDirty(false); } });
    return () => { cancelled = true; };
  }, [docId, pageIndex, total, updatedAt, pageStatus, doc]);

  const go = (delta: number) => { if (total > 0) setPageIndex((i) => Math.max(0, Math.min(total - 1, i + delta))); };

  const save = async () => {
    setBusy(true); setNotice(null);
    try { await window.nodus.saveOcrPageEdit(docId, pageIndex, text); setDirty(false); await loadDoc(); setNotice({ kind: 'ok', text: t('Cambios guardados.') }); }
    catch (error) { setNotice({ kind: 'error', text: ocrErrorText(error) }); }
    finally { setBusy(false); }
  };
  const reprocessThisPage = async (model: ModelRef | null) => {
    setReprocessMode(null);
    setBusy(true); setNotice(null);
    try { await window.nodus.reprocessOcrPage(docId, pageIndex, model ? { model } : undefined); await loadDoc(); }
    catch (error) { setNotice({ kind: 'error', text: ocrErrorText(error) }); }
    finally { setBusy(false); }
  };
  const reprocessAll = async (model: ModelRef | null) => {
    setReprocessMode(null);
    setBusy(true); setNotice(null);
    try { await window.nodus.reprocessOcrDocument(docId, model ? { model } : undefined); await loadDoc(); }
    catch (error) { setNotice({ kind: 'error', text: ocrErrorText(error) }); }
    finally { setBusy(false); }
  };
  const copyAll = async () => {
    try { await navigator.clipboard.writeText((await window.nodus.getOcrTranscript(docId)) ?? ''); setNotice({ kind: 'ok', text: t('Transcripción copiada.') }); }
    catch { /* clipboard unavailable */ }
  };
  const doExport = async () => {
    setExporting(true); setNotice(null);
    try {
      const result = await window.nodus.exportOcrDoc(docId, exportFormat);
      if (!result.canceled) setNotice({ kind: 'ok', text: t('Exportación guardada.') });
    } catch (error) { setNotice({ kind: 'error', text: ocrErrorText(error) }); }
    finally { setExporting(false); }
  };
  const saveToVault = async () => {
    setBusy(true); setNotice(null);
    try { await window.nodus.saveOcrToVault(docId); setNotice({ kind: 'ok', text: t('Guardado como nota en esta bóveda.') }); }
    catch (error) { setNotice({ kind: 'error', text: ocrErrorText(error) }); }
    finally { setBusy(false); }
  };

  const badge = page ? pageBadge(page) : null;
  const canExport = doc?.status === 'done' || (doc?.pages.some((p) => p.status === 'done') ?? false);

  return (
    <div data-testid="aiocr-doc" className="mx-auto max-w-6xl space-y-4">
      <header className="flex items-start gap-3">
        <BackButton testid="aiocr-doc-back" label={t('Volver a la biblioteca')} onClick={onBack} />
        <Loseta />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold text-neutral-900 dark:text-neutral-100">{doc?.name ?? t('Cargando…')}</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{doc ? statusLabel(doc.status) : ''}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" disabled={!canExport || busy} title={t('Guardar en la bóveda')} aria-label={t('Guardar en la bóveda')} onClick={() => void saveToVault()} className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100 hover:text-amber-700 disabled:opacity-50 dark:hover:bg-neutral-800"><Icon name="archive" size={16} /></button>
          <button type="button" title={t('Copiar transcripción')} aria-label={t('Copiar transcripción')} onClick={() => void copyAll()} className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100 hover:text-amber-700 dark:hover:bg-neutral-800"><Icon name="copy" size={16} /></button>
          <button type="button" disabled={active || busy} title={t('Reprocesar documento')} aria-label={t('Reprocesar documento')} onClick={() => setReprocessMode('doc')} className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100 hover:text-amber-700 disabled:opacity-50 dark:hover:bg-neutral-800"><Icon name="refresh" size={16} className={busy ? 'animate-spin' : undefined} /></button>
        </div>
      </header>
      <NoticeBar notice={notice} onClose={() => setNotice(null)} />
      {canExport && (
        <div className="flex justify-end">
          <ExportControl format={exportFormat} onFormat={setExportFormat} onExport={() => void doExport()} label={t('Exportar')} busy={exporting} />
        </div>
      )}
      {total === 0 ? (
        <div className="rounded-xl border border-neutral-200 p-8 text-center dark:border-neutral-800"><Spinner label={t('Preparando…')} /></div>
      ) : (
        <>
          <div className="flex items-center justify-center gap-3">
            <button type="button" disabled={pageIndex === 0} onClick={() => go(-1)} className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"><Icon name="chevronLeft" size={15} />{t('Anterior')}</button>
            <span className="text-sm text-neutral-500">{tx('Página {n} de {total}', { n: pageIndex + 1, total })}</span>
            <button type="button" disabled={pageIndex >= total - 1} onClick={() => go(1)} className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200">{t('Siguiente')}<Icon name="chevronRight" size={15} /></button>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="flex min-h-[320px] items-center justify-center overflow-auto rounded-xl bg-neutral-200 p-3 dark:bg-neutral-950">
              {image ? <img src={image} alt="" className="max-h-[70vh] max-w-full rounded-lg bg-white shadow" /> : <Spinner label={t('Cargando…')} />}
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              {(badge || (page?.status === 'error' && page.lastError)) && (
                <div className="flex items-center gap-2">
                  {badge && <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs ${badge.style}`}>{badge.label}</span>}
                  {page?.status === 'error' && page.lastError && <span className="min-w-0 truncate text-xs text-red-600 dark:text-red-300">{page.lastError}</span>}
                </div>
              )}
              <textarea
                data-testid="aiocr-page-editor"
                value={text}
                disabled={active || busy}
                onChange={(event) => { setText(event.target.value); setDirty(true); }}
                placeholder={t('Edita el texto de esta página')}
                className="input min-h-[320px] flex-1 font-mono text-sm leading-6"
              />
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" disabled={!dirty || active || busy} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"><Icon name="check" size={16} />{t('Guardar cambios')}</button>
                <button type="button" disabled={active || busy} onClick={() => setReprocessMode('page')} className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"><Icon name="refresh" size={16} className={busy ? 'animate-spin' : undefined} />{t('Reprocesar página')}</button>
              </div>
            </div>
          </div>
        </>
      )}
      {reprocessMode && settings && (
        <ReprocessModelModal
          settings={settings}
          initial={doc?.model ?? null}
          title={reprocessMode === 'page' ? tx('Reprocesar página {n}', { n: pageIndex + 1 }) : t('Reprocesar documento')}
          onConfirm={(model) => void (reprocessMode === 'page' ? reprocessThisPage(model) : reprocessAll(model))}
          onCancel={() => setReprocessMode(null)}
        />
      )}
    </div>
  );
}

// ── Library ────────────────────────────────────────────────────────────────────

export function ToolkitAiOcrView({ onBack, settings }: { onBack: () => void; settings: AppSettings | null }) {
  const [docs, setDocs] = useState<OcrDocSummary[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<OcrDocSummary | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  // Options.
  const [model, setModel] = useState<ModelRef | null>(null);
  const [mode, setMode] = useState<OcrProcessingMode>('ocr');
  const [targetLanguage, setTargetLanguage] = useState('inglés');
  const [customPrompt, setCustomPrompt] = useState('');
  const [removeReferences, setRemoveReferences] = useState(true);
  const [simpleText, setSimpleText] = useState(false);
  const [splitColumns, setSplitColumns] = useState(false);
  const [pageRange, setPageRange] = useState('');
  const [smallImages, setSmallImages] = useState(false);
  const [concurrency, setConcurrency] = useState(1);
  const [presets, setPresets] = useState<PromptPreset[]>([]);
  const [presetName, setPresetName] = useState('');
  const [libFormat, setLibFormat] = useState<AiOcrExportFormat>('md');
  const [exportingZip, setExportingZip] = useState(false);
  const [query, setQuery] = useState('');
  const [matchIds, setMatchIds] = useState<string[] | null>(null);
  const [reprocessTarget, setReprocessTarget] = useState<OcrDocSummary | null>(null);
  const [tab, setTab] = useState<'new' | 'library'>('new');

  useEffect(() => { setPresets(loadPresets()); }, []);

  // Default to the configured vision model (falling back like the rest of the app).
  const preferredModel = settings ? settings.visionModel ?? settings.extractionModel ?? settings.synthesisModel ?? null : null;
  useEffect(() => {
    if (!model && preferredModel) setModel(preferredModel);
  }, [preferredModel, model]);

  const refresh = useCallback(async () => {
    try {
      setDocs(await window.nodus.listOcrDocs());
    } catch (error) {
      setNotice({ kind: 'error', text: ocrErrorText(error) });
    }
  }, []);

  useEffect(() => {
    void refresh();
    return window.nodus.onOcrEvent((docId, progress) => {
      setDocs((prev) => {
        if (!prev.some((doc) => doc.id === docId)) {
          void refresh();
          return prev;
        }
        return prev.map((doc) => (doc.id === docId
          ? { ...doc, status: progress.status, pageCount: progress.pageCount, doneCount: progress.doneCount, errorCount: progress.errorCount }
          : doc));
      });
    });
  }, [refresh]);

  const cloudModel = model ? !isLocalProvider(model.provider) : false;

  // Concurrency is provider-shaped: local models transcribe one page at a time, so the
  // control locks to 1; cloud providers benefit from parallel requests. Reset to the
  // category's default whenever the model flips between local and cloud.
  useEffect(() => {
    setConcurrency(cloudModel ? 5 : 1);
  }, [cloudModel]);

  // Debounced title+content search over the library (content match happens in main,
  // which has the transcripts). null = no active filter. Re-runs as documents change so
  // freshly-transcribed content becomes searchable.
  useEffect(() => {
    const q = query.trim();
    if (!q) { setMatchIds(null); return undefined; }
    let cancelled = false;
    const timer = setTimeout(() => {
      void window.nodus.searchOcrDocs(q).then((ids) => { if (!cancelled) setMatchIds(ids); });
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, docs]);

  const buildOptions = (): OcrOptions => ({
    outputMode: simpleText ? 'text' : 'structured',
    processingMode: mode,
    targetLanguage: mode === 'translation' ? targetLanguage.trim() : undefined,
    customPrompt: mode === 'manual' ? customPrompt.trim() : undefined,
    removeReferences,
    singleColumn: false,
    splitColumns,
    pageRange: pageRange.trim() || undefined,
    rasterMaxEdge: smallImages ? 1400 : undefined,
    concurrency: cloudModel ? concurrency : 1,
  });

  const savePreset = () => {
    const name = presetName.trim();
    if (!name || !customPrompt.trim()) return;
    const next = [...presets.filter((p) => p.name !== name), { name, prompt: customPrompt }];
    setPresets(next); savePresetsToStorage(next); setPresetName('');
    setNotice({ kind: 'ok', text: t('Preset guardado.') });
  };

  const addFiles = async (paths: string[]) => {
    if (!paths.length) return;
    if (!model) {
      setNotice({ kind: 'error', text: t('Elige un modelo de visión antes de procesar.') });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await window.nodus.createOcrDocs({ sourcePaths: paths, options: buildOptions(), model });
      await refresh();
      setTab('library'); // jump to the library so processing progress is visible
    } catch (error) {
      setNotice({ kind: 'error', text: ocrErrorText(error) });
    } finally {
      setBusy(false);
    }
  };

  const pick = async () => {
    try {
      await addFiles(await window.nodus.pickOcrFiles());
    } catch (error) {
      setNotice({ kind: 'error', text: ocrErrorText(error) });
    }
  };

  const drop = async (event: DragEvent) => {
    event.preventDefault();
    const paths = [...event.dataTransfer.files].map((file) => window.nodus.getPathForDroppedFile(file)).filter(Boolean);
    await addFiles(paths);
  };

  const cancel = async (id: string) => {
    try { await window.nodus.cancelOcrDoc(id); } catch (error) { setNotice({ kind: 'error', text: ocrErrorText(error) }); }
  };
  const confirmReprocess = async (chosen: ModelRef | null) => {
    const target = reprocessTarget;
    setReprocessTarget(null);
    if (!target) return;
    setNotice(null);
    try { await window.nodus.reprocessOcrDocument(target.id, chosen ? { model: chosen } : undefined); await refresh(); }
    catch (error) { setNotice({ kind: 'error', text: ocrErrorText(error) }); }
  };
  const remove = async (doc: OcrDocSummary) => {
    setConfirmDelete(null);
    try {
      await window.nodus.deleteOcrDoc(doc.id);
      if (openId === doc.id) setOpenId(null);
      await refresh();
    } catch (error) { setNotice({ kind: 'error', text: ocrErrorText(error) }); }
  };

  const sortedDocs = useMemo(() => [...docs].sort((a, b) => b.updatedAt - a.updatedAt), [docs]);
  const visibleDocs = useMemo(() => {
    if (matchIds === null) return sortedDocs;
    const set = new Set(matchIds);
    return sortedDocs.filter((doc) => set.has(doc.id));
  }, [sortedDocs, matchIds]);
  const doneIds = useMemo(() => docs.filter((d) => d.status === 'done').map((d) => d.id), [docs]);

  const exportAll = async () => {
    if (doneIds.length === 0) return;
    setExportingZip(true); setNotice(null);
    try {
      const result = await window.nodus.exportOcrDocsZip(doneIds, libFormat);
      if (!result.canceled) setNotice({ kind: 'ok', text: t('Exportación guardada.') });
    } catch (error) { setNotice({ kind: 'error', text: ocrErrorText(error) }); }
    finally { setExportingZip(false); }
  };

  if (openId) {
    return <DocReview docId={openId} settings={settings} onBack={() => { setOpenId(null); void refresh(); }} />;
  }

  return (
    <div data-testid="aiocr-home" className="mx-auto max-w-4xl space-y-6">
      <header className="flex items-start gap-3">
        <BackButton testid="toolkit-aiocr-back" label={t('Volver')} onClick={onBack} />
        <Loseta />
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">OCR Workspace</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {t('Transcribe PDFs e imágenes escaneadas con modelos de visión. El resultado se guarda en tu biblioteca de OCR.')}
          </p>
        </div>
      </header>
      <NoticeBar notice={notice} onClose={() => setNotice(null)} />

      {/* Tabs: process new documents vs. browse the OCR library */}
      <div className="flex gap-1 rounded-lg bg-neutral-100 p-1 dark:bg-neutral-900/60">
        {([['new', t('Nuevo OCR')], ['library', t('Biblioteca')]] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            data-testid={`aiocr-tab-${id}`}
            onClick={() => setTab(id)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === id ? 'bg-white text-amber-700 shadow-sm dark:bg-neutral-800 dark:text-amber-300' : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
            }`}
          >
            {label}
            {id === 'library' && docs.length > 0 ? ` (${docs.length})` : ''}
          </button>
        ))}
      </div>

      {tab === 'new' && <>
      {/* Options */}
      <section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900/40">
        <div className="space-y-2">
          <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-200">{t('Modelo de visión')}</label>
          {settings
            ? <ModelPicker settings={settings} value={model} onChange={setModel} allowEmpty={false} emptyLabel="Seleccionar modelo" />
            : <Spinner label={t('Cargando…')} />}
          <SubscriptionQuotaNotice model={model} />
          {cloudModel && model && (
            <p role="note" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
              <Icon name="lock" size={13} className="mr-1 inline align-[-2px]" />
              {tx('Con un modelo de proveedor las imágenes de cada página se envían a {provider} para transcribirlas. Elige un modelo local (Ollama, LM Studio) si prefieres procesar todo sin conexión.', { provider: model.provider })}
            </p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-neutral-700 dark:text-neutral-200">{t('Modo')}</span>
            <select className="input" value={mode} onChange={(event) => setMode(event.target.value as OcrProcessingMode)}>
              <option value="ocr">{t('Transcribir (idioma original)')}</option>
              <option value="translation">{t('Traducir')}</option>
              <option value="manual">{t('Instrucciones propias')}</option>
            </select>
          </label>
          {mode === 'translation' && (
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-neutral-700 dark:text-neutral-200">{t('Idioma de destino')}</span>
              <input className="input" value={targetLanguage} onChange={(event) => setTargetLanguage(event.target.value)} placeholder={t('Ej.: inglés')} />
            </label>
          )}
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-neutral-700 dark:text-neutral-200">{t('Páginas (solo PDF)')}</span>
            <input className="input w-full" value={pageRange} onChange={(event) => setPageRange(event.target.value)} placeholder={t('Todas · ej.: 1-3,5')} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-neutral-700 dark:text-neutral-200">{t('Páginas en paralelo')}</span>
            <select className="input w-full disabled:opacity-60" value={cloudModel ? concurrency : 1} disabled={!cloudModel} onChange={(event) => setConcurrency(parseInt(event.target.value, 10))}>
              {OCR_CONCURRENCY_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <span className="mt-1 block text-xs text-neutral-500 dark:text-neutral-400">
              {cloudModel ? t('Envía varias páginas a la vez para transcribir más rápido.') : t('Los modelos locales transcriben de una en una.')}
            </span>
          </label>
        </div>

        {mode === 'manual' && (
          <div className="space-y-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-neutral-700 dark:text-neutral-200">{t('Instrucciones adicionales')}</span>
              <textarea className="input w-full min-h-[96px] resize-y" value={customPrompt} onChange={(event) => setCustomPrompt(event.target.value)} placeholder={t('Ej.: transcribe solo las notas al margen')} />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <select className="input w-auto py-1 text-xs" value="" onChange={(event) => { const p = presets.find((x) => x.name === event.target.value); if (p) setCustomPrompt(p.prompt); }}>
                <option value="">{t('Cargar preset…')}</option>
                {presets.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
              <input className="input w-40 py-1 text-xs" value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder={t('Nombre del preset')} />
              <button type="button" onClick={savePreset} className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 bg-white px-3 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200">
                <Icon name="check" size={13} />{t('Guardar preset')}
              </button>
            </div>
          </div>
        )}

        <div className="space-y-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
          <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-200">
            <input type="checkbox" checked={removeReferences} onChange={(event) => setRemoveReferences(event.target.checked)} className="accent-amber-600" />
            {t('Quitar las citas del cuerpo del texto')}
          </label>
          <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-200">
            <input type="checkbox" checked={simpleText} onChange={(event) => setSimpleText(event.target.checked)} className="accent-amber-600" />
            {t('Modo sencillo (solo texto)')}
          </label>
          <p className="pl-6 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
            {t('Extrae el texto sin analizar la maquetación. Útil para modelos locales pequeños que no devuelven un JSON fiable.')}
          </p>
          <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-200">
            <input type="checkbox" checked={splitColumns} onChange={(event) => setSplitColumns(event.target.checked)} className="accent-amber-600" />
            {t('Detectar y separar columnas')}
          </label>
          <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-200">
            <input type="checkbox" checked={smallImages} onChange={(event) => setSmallImages(event.target.checked)} className="accent-amber-600" />
            {t('Imágenes más pequeñas (modelos locales pequeños)')}
          </label>
        </div>
      </section>

      {/* Dropzone */}
      <button
        data-testid="aiocr-dropzone"
        type="button"
        onClick={pick}
        onDragOver={(event) => event.preventDefault()}
        onDrop={drop}
        disabled={busy}
        className="flex min-h-40 w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-neutral-300 bg-neutral-50 p-8 text-neutral-600 hover:border-amber-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900/30 dark:text-neutral-300"
      >
        {busy ? <Spinner label={t('Preparando…')} /> : <>
          <Icon name="upload" size={28} className="text-amber-600" />
          <span className="font-medium">{t('Selecciona o arrastra PDF e imágenes')}</span>
          <span className="text-xs text-neutral-500">PDF, PNG, JPEG, WebP, GIF · {t('se transcriben al soltarlos')}</span>
        </>}
      </button>
      </>}

      {tab === 'library' && (
      /* Library */
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">{t('Tu biblioteca de OCR')}</h2>
          {doneIds.length > 0 && (
            <ExportControl format={libFormat} onFormat={setLibFormat} onExport={() => void exportAll()} label={t('Exportar todo (ZIP)')} busy={exportingZip} />
          )}
        </div>
        {sortedDocs.length > 0 && (
          <div className="relative">
            <Icon name="search" size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              data-testid="aiocr-search"
              type="search"
              className="input input-with-leading-icon w-full"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('Buscar por título o contenido…')}
            />
          </div>
        )}
        {sortedDocs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 dark:border-neutral-700">
            {t('Aún no has transcrito ningún documento. Añade un PDF o una imagen para empezar.')}
          </div>
        ) : visibleDocs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 dark:border-neutral-700">
            {tx('No hay resultados para «{q}».', { q: query.trim() })}
          </div>
        ) : (
          <ul className="divide-y divide-neutral-200 overflow-hidden rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
            {visibleDocs.map((doc) => {
              const active = doc.status === 'processing' || doc.status === 'pending';
              return (
                <li key={doc.id} data-testid={`aiocr-doc-${doc.status}`} className="flex items-center gap-3 bg-white p-3 dark:bg-neutral-900/40">
                  <Icon name="file" size={18} className="shrink-0 text-amber-600" />
                  <button type="button" onClick={() => setOpenId(doc.id)} disabled={doc.pageCount === 0} className="min-w-0 flex-1 space-y-1 text-left disabled:cursor-default">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-800 dark:text-neutral-100">{doc.name}</span>
                      <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs ${STATUS_STYLE[doc.status]}`}>{statusLabel(doc.status)}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-neutral-500">
                      <span className="truncate">{doc.model ? modelLabel(doc.model) : t('sin modelo')}</span>
                      <span>·</span>
                      <span className="shrink-0">
                        {doc.pageCount > 0
                          ? tx('{done}/{total} páginas', { done: doc.doneCount, total: doc.pageCount })
                          : t('Preparando…')}
                        {doc.errorCount > 0 ? ` · ${tx('{count} con error', { count: doc.errorCount })}` : ''}
                      </span>
                    </div>
                    {active && (doc.pageCount > 1
                      ? <ProgressBar done={doc.doneCount} total={doc.pageCount} />
                      : <Icon name="refresh" size={14} className="animate-spin text-amber-600 dark:text-amber-400" />)}
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    {active ? (
                      <button type="button" title={t('Cancelar')} aria-label={t('Cancelar')} onClick={() => void cancel(doc.id)} className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100 hover:text-amber-700 dark:hover:bg-neutral-800"><Icon name="x" size={16} /></button>
                    ) : (
                      <>
                        {doc.pageCount > 0 && <button type="button" title={t('Revisar')} aria-label={t('Revisar')} onClick={() => setOpenId(doc.id)} className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100 hover:text-amber-700 dark:hover:bg-neutral-800"><Icon name="scanText" size={16} /></button>}
                        <button type="button" title={t('Reprocesar')} aria-label={t('Reprocesar')} onClick={() => setReprocessTarget(doc)} className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100 hover:text-amber-700 dark:hover:bg-neutral-800"><Icon name="refresh" size={16} /></button>
                      </>
                    )}
                    <button type="button" title={t('Eliminar')} aria-label={t('Eliminar')} onClick={() => setConfirmDelete(doc)} className="rounded-lg p-2 text-neutral-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"><Icon name="trash" size={16} /></button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      )}

      {reprocessTarget && settings && (
        <ReprocessModelModal
          settings={settings}
          initial={reprocessTarget.model ?? model}
          onConfirm={(chosen) => void confirmReprocess(chosen)}
          onCancel={() => setReprocessTarget(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title={t('Eliminar')}
          message={tx('Se eliminará «{name}» y su transcripción. Esta acción no se puede deshacer.', { name: confirmDelete.name })}
          confirmLabel={t('Eliminar')}
          danger
          onConfirm={() => void remove(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
