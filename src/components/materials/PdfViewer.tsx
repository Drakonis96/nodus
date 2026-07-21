import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { GlobalWorkerOptions, Util, getDocument } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { StudyMaterialAnnotation, StudyMaterialAnnotationInput, StudyMaterialContent, StudyMaterialDetail, StudyMaterialPoint, StudyMaterialRect } from '@shared/types';
import { Icon, Spinner } from '../ui';
import { t } from '../../i18n';

GlobalWorkerOptions.workerSrc = pdfWorker;

type PdfTool = 'none' | 'highlight' | 'underline' | 'brush' | 'sticky' | 'comment';
interface PendingNote { kind: 'sticky' | 'comment'; pageNumber: number; rect: StudyMaterialRect; selectedText: string; rects: StudyMaterialRect[] }
interface PdfSearchResult { pageNumber: number; snippet: string; occurrence: number }
const PASTELS = ['#fde68a', '#fbcfe8', '#bfdbfe', '#bbf7d0', '#ddd6fe', '#fed7aa'];
const INKS = ['#ef4444', '#2563eb', '#111827', '#0f766e', '#9333ea', '#f97316'];

export function PdfViewer({ content, material, onAnnotation, onUpdateAnnotation, onDeleteAnnotation, onCreateNote }: {
  content: StudyMaterialContent;
  material: StudyMaterialDetail;
  onAnnotation: (input: StudyMaterialAnnotationInput) => Promise<void>;
  onUpdateAnnotation: (id: string, patch: Partial<StudyMaterialAnnotationInput>) => Promise<void>;
  onDeleteAnnotation: (id: string) => Promise<void>;
  onCreateNote: (annotationId?: string | null) => Promise<void>;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [jumpPage, setJumpPage] = useState(1);
  const [scale, setScale] = useState(1.25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tool, setTool] = useState<PdfTool>('none');
  const [activeAnnotation, setActiveAnnotation] = useState<StudyMaterialAnnotation | null>(null);
  const [highlightColor, setHighlightColor] = useState(PASTELS[0]);
  const [inkColor, setInkColor] = useState(INKS[0]);
  const [brushThickness, setBrushThickness] = useState(4);
  const [pendingNote, setPendingNote] = useState<PendingNote | null>(null);
  const [note, setNote] = useState('');
  const [sidebarDraft, setSidebarDraft] = useState<PendingNote | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<'thumbnails' | 'search'>('thumbnails');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PdfSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRunRef = useRef(0);
  const pageTextCacheRef = useRef(new Map<number, string>());

  useEffect(() => {
    let current: PDFDocumentProxy | null = null;
    setLoading(true); setError(''); pageTextCacheRef.current.clear(); setSearchQuery(''); setSearchResults([]);
    const task = getDocument({ data: new Uint8Array(content.bytes) });
    void task.promise.then((document) => { current = document; setPdf(document); setJumpPage(1); setLoading(false); }).catch((cause) => { setError(cause instanceof Error ? cause.message : String(cause)); setLoading(false); });
    return () => { void task.destroy(); void current?.destroy(); };
  }, [material.contentHash]);

  const captureSelection = () => {
    if (tool === 'none' || tool === 'brush') return;
    const selection = window.getSelection(); const text = selection?.toString().trim() ?? '';
    if (!text || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    const anchorElement = (selection.anchorNode?.nodeType === Node.ELEMENT_NODE ? selection.anchorNode as Element : selection.anchorNode?.parentElement);
    const pageShell = anchorElement?.closest<HTMLElement>('[data-pdf-page]'); const pageNumber = Number(pageShell?.dataset.pdfPage ?? 0);
    if (!pageShell || !pageNumber) return;
    const shell = pageShell.getBoundingClientRect();
    const rects = Array.from(range.getClientRects()).filter((box) => box.width > 1 && box.height > 1 && box.bottom >= shell.top && box.top <= shell.bottom).map((box) => ({
      x: Math.max(0, Math.min(1, (box.left - shell.left) / shell.width)), y: Math.max(0, Math.min(1, (box.top - shell.top) / shell.height)),
      width: Math.max(0.002, Math.min(1, box.width / shell.width)), height: Math.max(0.002, Math.min(1, box.height / shell.height)),
    }));
    if (!rects.length) return;
    if (tool === 'highlight' || tool === 'underline') {
      void onAnnotation({ kind: tool, pageNumber, rect: rects[0], rects, selectedText: text, color: tool === 'highlight' ? highlightColor : inkColor, thickness: 2 }).then(() => selection.removeAllRanges());
    } else {
      const pending = { kind: tool, pageNumber, rect: rects[0], rects, selectedText: text } as PendingNote;
      if (tool === 'sticky') { setPendingNote(pending); setNote(''); } else { setSidebarDraft(pending); setNote(''); }
      selection.removeAllRanges();
    }
  };

  const startPageNote = (kind: 'sticky' | 'comment', pageNumber: number, rect: StudyMaterialRect) => {
    const pending = { kind, pageNumber, rect, rects: [], selectedText: '' };
    if (kind === 'sticky') { setPendingNote(pending); setNote(''); } else { setSidebarDraft(pending); setNote(''); }
  };
  const savePending = async (pending: PendingNote) => {
    if (!note.trim()) return;
    await onAnnotation({ ...pending, note, color: pending.kind === 'sticky' ? '#fde68a' : '#c7d2fe' });
    setNote(''); setPendingNote(null); setSidebarDraft(null);
  };
  const scrollToPage = (pageNumber: number) => {
    const next = Math.max(1, Math.min(pdf?.numPages ?? 1, pageNumber)); setJumpPage(next);
    scrollRef.current?.querySelector<HTMLElement>(`[data-pdf-page="${next}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  useEffect(() => {
    if (!pdf) return;
    const query = searchQuery.trim().toLocaleLowerCase(); const runId = ++searchRunRef.current;
    if (query.length < 2) { setSearchResults([]); setSearching(false); return; }
    const timer = window.setTimeout(() => { setSearching(true); void (async () => {
      const matches: PdfSearchResult[] = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages && matches.length < 250; pageNumber += 1) {
        if (searchRunRef.current !== runId) return;
        let pageText = pageTextCacheRef.current.get(pageNumber);
        if (pageText == null) { const page = await pdf.getPage(pageNumber); const textContent = await page.getTextContent(); pageText = textContent.items.map((item) => 'str' in item ? item.str : '').join(' ').replace(/\s+/g, ' ').trim(); pageTextCacheRef.current.set(pageNumber, pageText); }
        const normalized = pageText.toLocaleLowerCase(); let from = 0; let occurrence = 0;
        while (matches.length < 250) { const index = normalized.indexOf(query, from); if (index < 0) break; occurrence += 1; const a = Math.max(0, index - 55); const b = Math.min(pageText.length, index + query.length + 85); matches.push({ pageNumber, occurrence, snippet: `${a ? '…' : ''}${pageText.slice(a, b)}${b < pageText.length ? '…' : ''}` }); from = index + Math.max(1, query.length); if (occurrence >= 20) break; }
      }
      if (searchRunRef.current === runId) { setSearchResults(matches); setSearching(false); }
    })().catch(() => { if (searchRunRef.current === runId) { setSearchResults([]); setSearching(false); } }); }, 250);
    return () => { window.clearTimeout(timer); if (searchRunRef.current === runId) searchRunRef.current += 1; };
  }, [pdf, searchQuery]);

  const toolButton = (value: PdfTool, icon: string, label: string) => <span className="group inline-flex" title={t(label)}><button data-testid={`study-pdf-tool-${value}`} className={`btn h-8 min-h-8 justify-center gap-0 px-2 ${tool === value ? 'btn-secondary' : 'btn-ghost'}`} aria-label={t(label)} aria-pressed={tool === value} onClick={() => setTool(value)}><Icon name={icon} size={14} className="shrink-0" /><span className="ml-0 max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 group-hover:ml-1.5 group-hover:max-w-40 group-hover:opacity-100 group-focus-within:ml-1.5 group-focus-within:max-w-40 group-focus-within:opacity-100">{t(label)}</span></button></span>;
  const activeColors = tool === 'highlight' ? PASTELS : INKS;
  const activeColor = tool === 'highlight' ? highlightColor : inkColor;
  return <div className="flex h-full min-h-0 flex-col" data-testid="study-pdf-viewer">
    <div className="flex flex-wrap items-center gap-1.5 border-b border-neutral-200 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-950">
      <span data-testid="study-pdf-continuous-mode" className="rounded-md bg-neutral-100 px-2 py-1 text-xs text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">{t('Vista continua')} · {pdf?.numPages ?? material.pageCount ?? '—'} {t('páginas')}</span>
      {toolButton('none', 'cursor', 'Seleccionar o desplazar')}{toolButton('highlight', 'highlighter', 'Resaltar')}{toolButton('underline', 'minus', 'Subrayar')}{toolButton('brush', 'palette', 'Pincel')}{toolButton('sticky', 'star', 'Sticker con nota')}{toolButton('comment', 'chat', 'Comentario lateral')}
      {tool !== 'none' && <div className="flex items-center gap-1 rounded-lg border border-neutral-200 px-1.5 py-1 dark:border-neutral-800" data-testid="study-pdf-color-picker">{activeColors.map((color) => <button key={color} aria-label={`${t('Color')} ${color}`} className={`h-5 w-5 rounded-full border ${activeColor === color ? 'ring-2 ring-teal-500 ring-offset-1 dark:ring-offset-neutral-950' : 'border-black/10'}`} style={{ backgroundColor: color }} onClick={() => tool === 'highlight' ? setHighlightColor(color) : setInkColor(color)} />)}</div>}
      {tool === 'brush' && <label className="flex items-center gap-2 text-[10px] text-neutral-500">{t('Grosor')}<input data-testid="study-pdf-brush-thickness" type="range" min="1" max="16" value={brushThickness} onChange={(event) => setBrushThickness(Number(event.target.value))} /><span className="w-5 tabular-nums">{brushThickness}</span></label>}
      <span className="mx-1 h-5 w-px bg-neutral-200 dark:bg-neutral-800" />
      <button data-testid="study-pdf-thumbnails-toggle" className={`btn h-8 px-2 ${sidebarOpen && sidebarTab === 'thumbnails' ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => { setSidebarOpen(sidebarTab === 'thumbnails' ? !sidebarOpen : true); setSidebarTab('thumbnails'); }}><Icon name="columns" size={14} /></button>
      <button data-testid="study-pdf-search-toggle" className={`btn h-8 px-2 ${sidebarOpen && sidebarTab === 'search' ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => { setSidebarOpen(sidebarTab === 'search' ? !sidebarOpen : true); setSidebarTab('search'); }}><Icon name="search" size={14} /></button>
      <label className="flex items-center gap-1 text-xs text-neutral-500">{t('Página')}<input className="input h-7 w-14 text-center" type="number" min="1" max={pdf?.numPages ?? 1} value={jumpPage} onChange={(event) => scrollToPage(Number(event.target.value))} /></label>
      <button data-testid="study-pdf-zoom-out" className="btn btn-ghost h-8 px-2" aria-label={t('Alejar')} onClick={() => setScale((value) => Math.max(.6, value - .15))}>−</button><button className="text-[11px] text-neutral-500" onClick={() => setScale(1.25)}>{Math.round(scale * 100)}%</button><button data-testid="study-pdf-zoom-in" className="btn btn-ghost h-8 px-2" aria-label={t('Acercar')} onClick={() => setScale((value) => Math.min(2.5, value + .15))}>+</button>
      <button data-testid="study-material-export-annotated" className="btn btn-primary ml-auto h-8" disabled={exporting} onClick={() => { setExporting(true); setMessage(''); void window.nodus.exportAnnotatedStudyMaterial(material.id).then((result) => { if (result) setMessage(t('Copia anotada guardada')); }).finally(() => setExporting(false)); }}><Icon name="download" size={13} />{exporting ? t('Exportando…') : t('Descargar anotado')}</button>
    </div>
    {message && <p className="border-b border-teal-200 bg-teal-50 px-3 py-1 text-[10px] text-teal-800 dark:border-teal-900 dark:bg-teal-950 dark:text-teal-200">{message}</p>}
    <div className="flex min-h-0 flex-1">
      {sidebarOpen && pdf && <PdfNavigationSidebar pdf={pdf} tab={sidebarTab} onTabChange={setSidebarTab} onClose={() => setSidebarOpen(false)} onOpenPage={scrollToPage} query={searchQuery} onQueryChange={setSearchQuery} results={searchResults} searching={searching} />}
      <div ref={scrollRef} className="min-w-0 flex-1 overflow-auto bg-neutral-100 p-5 dark:bg-neutral-900/40" onMouseUp={captureSelection}>
        {error && <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</div>}
        {loading && <div className="grid h-full place-items-center"><Spinner label={t('Cargando visor PDF…')} /></div>}
        {!loading && pdf && <div className="space-y-5">{Array.from({ length: pdf.numPages }, (_, index) => <PdfPage key={index + 1} pdf={pdf} pageNumber={index + 1} scale={scale} tool={tool} color={tool === 'highlight' ? highlightColor : inkColor} thickness={brushThickness} annotations={material.annotations.filter((annotation) => annotation.pageNumber === index + 1)} onBrush={(path) => onAnnotation({ kind: 'brush', pageNumber: index + 1, path, color: inkColor, thickness: brushThickness })} onPageNote={(rect) => startPageNote(tool as 'sticky' | 'comment', index + 1, rect)} onSelectAnnotation={tool === 'none' ? setActiveAnnotation : undefined} />)}</div>}
      </div>
      <aside className="w-80 shrink-0 overflow-y-auto border-l border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-950" data-testid="study-material-annotations-sidebar">
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">{t('Comentarios y anotaciones')}</h3>
        {sidebarDraft && <div className="mb-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3 dark:border-indigo-900 dark:bg-indigo-950/30" data-testid="study-pdf-inline-comment"><p className="text-xs font-medium text-indigo-800 dark:text-indigo-200">{t('Nuevo comentario lateral')}</p>{sidebarDraft.selectedText && <p className="mt-1 line-clamp-3 text-[11px] italic text-neutral-500">“{sidebarDraft.selectedText}”</p>}<textarea autoFocus className="input mt-2 min-h-20 w-full" value={note} onChange={(event) => setNote(event.target.value)} placeholder={t('Escribe el comentario')} /><div className="mt-2 flex justify-end gap-2"><button className="btn btn-ghost" onClick={() => { setSidebarDraft(null); setNote(''); }}>{t('Cancelar')}</button><button className="btn btn-primary" disabled={!note.trim()} onClick={() => void savePending(sidebarDraft)}>{t('Guardar')}</button></div></div>}
        {!material.annotations.length && !sidebarDraft ? <p className="text-xs leading-5 text-neutral-500">{t('Selecciona texto o usa las herramientas sobre una página.')}</p> : material.annotations.map((annotation) => <AnnotationCard key={annotation.id} annotation={annotation} onOpen={() => annotation.pageNumber && scrollToPage(annotation.pageNumber)} onEdit={() => setActiveAnnotation(annotation)} onCreateNote={() => onCreateNote(annotation.id)} onDelete={() => onDeleteAnnotation(annotation.id)} />)}
      </aside>
    </div>
    {pendingNote && <div className="absolute inset-0 z-50 grid place-items-center bg-black/40 p-6" onClick={() => setPendingNote(null)}><section className="card-modal w-full max-w-sm p-4" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()} data-testid="study-pdf-sticky-dialog"><div className="flex items-center gap-2"><span className="grid h-9 w-9 place-items-center rounded-lg bg-amber-200 text-amber-800">★</span><h3 className="font-semibold">{t('Sticker con nota')}</h3></div>{pendingNote.selectedText && <p className="mt-3 line-clamp-3 text-xs italic text-neutral-500">“{pendingNote.selectedText}”</p>}<textarea autoFocus className="input mt-3 min-h-28 w-full" value={note} onChange={(event) => setNote(event.target.value)} placeholder={t('Escribe una nota')} /><div className="mt-3 flex justify-end gap-2"><button className="btn btn-ghost" onClick={() => setPendingNote(null)}>{t('Cancelar')}</button><button className="btn btn-primary" disabled={!note.trim()} onClick={() => void savePending(pendingNote)}>{t('Guardar sticker')}</button></div></section></div>}
    {activeAnnotation && <AnnotationEditModal annotation={activeAnnotation} onClose={() => setActiveAnnotation(null)} onSave={async (value) => { await onUpdateAnnotation(activeAnnotation.id, { note: value }); setActiveAnnotation(null); }} onDelete={async () => { await onDeleteAnnotation(activeAnnotation.id); setActiveAnnotation(null); }} />}
  </div>;
}

function AnnotationEditModal({ annotation, onSave, onDelete, onClose }: { annotation: StudyMaterialAnnotation; onSave: (note: string) => Promise<void>; onDelete: () => Promise<void>; onClose: () => void }) {
  const [note, setNote] = useState(annotation.note ?? '');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const label = annotation.kind === 'highlight' ? t('Resaltado') : annotation.kind === 'underline' ? t('Subrayado') : annotation.kind === 'brush' ? t('Pincel') : annotation.kind === 'sticky' ? t('Sticker') : t('Comentario');
  return <div className="absolute inset-0 z-50 grid place-items-center bg-black/40 p-6" onClick={onClose}><section className="card-modal w-full max-w-sm p-4" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()} data-testid="study-pdf-annotation-modal">
    <div className="flex items-center gap-2"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ backgroundColor: `${annotation.color}55` }}><i className="h-3 w-3 rounded-full" style={{ backgroundColor: annotation.color }} /></span><div className="min-w-0"><h3 className="font-semibold">{label}</h3>{annotation.pageNumber ? <p className="text-[10px] text-neutral-500">{t('Página')} {annotation.pageNumber}</p> : null}</div></div>
    {annotation.selectedText && <p className="mt-3 line-clamp-3 text-xs italic text-neutral-500">“{annotation.selectedText}”</p>}
    <label className="mt-3 block text-[10px] font-semibold uppercase tracking-wide text-neutral-500">{t('Nota')}<textarea autoFocus className="input mt-1 min-h-24 w-full" value={note} onChange={(event) => setNote(event.target.value)} placeholder={t('Escribe una nota')} /></label>
    {confirming
      ? <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-xs dark:border-red-900 dark:bg-red-950/30" data-testid="study-pdf-annotation-delete-confirm"><p className="text-red-700 dark:text-red-300">{t('¿Eliminar esta anotación? No se puede deshacer.')}</p><div className="mt-2 flex justify-end gap-2"><button className="btn btn-ghost" disabled={busy} onClick={() => setConfirming(false)}>{t('Cancelar')}</button><button className="btn btn-primary bg-red-600 hover:bg-red-500" disabled={busy} onClick={() => { setBusy(true); void onDelete().finally(() => setBusy(false)); }}>{t('Eliminar')}</button></div></div>
      : <div className="mt-4 flex items-center gap-2"><button data-testid="study-pdf-annotation-delete" className="btn btn-ghost text-red-500" disabled={busy} onClick={() => setConfirming(true)}>{t('Eliminar')}</button><button className="btn btn-ghost ml-auto" disabled={busy} onClick={onClose}>{t('Cancelar')}</button><button className="btn btn-primary" disabled={busy} onClick={() => { setBusy(true); void onSave(note).finally(() => setBusy(false)); }}>{busy ? t('Guardando…') : t('Guardar')}</button></div>}
  </section></div>;
}

function PdfNavigationSidebar({ pdf, tab, onTabChange, onClose, onOpenPage, query, onQueryChange, results, searching }: { pdf: PDFDocumentProxy; tab: 'thumbnails' | 'search'; onTabChange: (tab: 'thumbnails' | 'search') => void; onClose: () => void; onOpenPage: (page: number) => void; query: string; onQueryChange: (value: string) => void; results: PdfSearchResult[]; searching: boolean }) {
  return <aside className="flex w-60 shrink-0 flex-col border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950"><div className="flex gap-1 border-b border-neutral-200 p-2 dark:border-neutral-800"><button className={`flex-1 rounded px-2 py-1 text-xs ${tab === 'thumbnails' ? 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200' : 'text-neutral-500'}`} onClick={() => onTabChange('thumbnails')}>{t('Miniaturas')}</button><button className={`flex-1 rounded px-2 py-1 text-xs ${tab === 'search' ? 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200' : 'text-neutral-500'}`} onClick={() => onTabChange('search')}>{t('Buscar')}</button><button onClick={onClose}><Icon name="x" /></button></div>{tab === 'thumbnails' ? <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">{Array.from({ length: pdf.numPages }, (_, index) => <PdfThumbnail key={index + 1} pdf={pdf} pageNumber={index + 1} onOpen={() => onOpenPage(index + 1)} />)}</div> : <div className="min-h-0 flex-1 p-3"><input autoFocus className="input w-full text-xs" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={t('Buscar dentro del PDF…')} /><div className="mt-3">{searching && !results.length ? <Spinner label={t('Buscando en el PDF…')} /> : results.map((result) => <button key={`${result.pageNumber}-${result.occurrence}`} className="mb-2 w-full rounded-lg border border-neutral-200 p-2 text-left dark:border-neutral-800" onClick={() => onOpenPage(result.pageNumber)}><span className="text-[10px] text-teal-700 dark:text-teal-300">{t('Página')} {result.pageNumber}</span><span className="block text-[11px] text-neutral-500">{result.snippet}</span></button>)}</div></div>}</aside>;
}

function PdfThumbnail({ pdf, pageNumber, onOpen }: { pdf: PDFDocumentProxy; pageNumber: number; onOpen: () => void }) {
  const hostRef = useRef<HTMLButtonElement>(null); const canvasRef = useRef<HTMLCanvasElement>(null); const [active, setActive] = useState(false); const [size, setSize] = useState({ width: 140, height: 181 });
  useEffect(() => { const host = hostRef.current; if (!host) return; const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) setActive(true); }, { rootMargin: '500px' }); observer.observe(host); return () => observer.disconnect(); }, []);
  useEffect(() => { let cancelled = false; let page: PDFPageProxy | null = null; if (!active) return; void pdf.getPage(pageNumber).then(async (next) => { page = next; const base = next.getViewport({ scale: 1 }); const viewport = next.getViewport({ scale: Math.min(150 / base.width, 190 / base.height) }); if (cancelled || !canvasRef.current) return; setSize({ width: viewport.width, height: viewport.height }); const canvas = canvasRef.current; const ratio = window.devicePixelRatio || 1; canvas.width = viewport.width * ratio; canvas.height = viewport.height * ratio; canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`; const context = canvas.getContext('2d'); if (context) await next.render({ canvasContext: context, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] }).promise; }).catch(() => undefined); return () => { cancelled = true; page?.cleanup(); }; }, [active, pageNumber, pdf]);
  return <button ref={hostRef} className="mx-auto block rounded-lg p-2 hover:bg-neutral-100 dark:hover:bg-neutral-900" onClick={onOpen}><span className="grid place-items-center bg-white shadow" style={size}><canvas ref={canvasRef} /></span><span className="mt-1 block text-[10px] text-neutral-500">{t('Página')} {pageNumber}</span></button>;
}

function PdfPage({ pdf, pageNumber, scale, annotations, tool, color, thickness, onBrush, onPageNote, onSelectAnnotation }: { pdf: PDFDocumentProxy; pageNumber: number; scale: number; annotations: StudyMaterialAnnotation[]; tool: PdfTool; color: string; thickness: number; onBrush: (path: StudyMaterialPoint[]) => Promise<void>; onPageNote: (rect: StudyMaterialRect) => void; onSelectAnnotation?: (annotation: StudyMaterialAnnotation) => void }) {
  const shellRef = useRef<HTMLDivElement>(null); const canvasRef = useRef<HTMLCanvasElement>(null); const textLayerRef = useRef<HTMLDivElement>(null); const drawingRef = useRef<StudyMaterialPoint[]>([]); const [draft, setDraft] = useState<StudyMaterialPoint[]>([]); const [active, setActive] = useState(false); const [size, setSize] = useState({ width: 612 * scale, height: 792 * scale }); const [rendering, setRendering] = useState(false);
  useEffect(() => { const shell = shellRef.current; if (!shell) return; const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) setActive(true); }, { rootMargin: '1200px' }); observer.observe(shell); return () => observer.disconnect(); }, []);
  useEffect(() => { let cancelled = false; let page: PDFPageProxy | null = null; void pdf.getPage(pageNumber).then(async (next) => { page = next; const viewport = next.getViewport({ scale }); if (cancelled) return; setSize({ width: viewport.width, height: viewport.height }); if (!active || !canvasRef.current || !textLayerRef.current) return; setRendering(true); const canvas = canvasRef.current; const layer = textLayerRef.current; const ratio = window.devicePixelRatio || 1; canvas.width = viewport.width * ratio; canvas.height = viewport.height * ratio; canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`; layer.replaceChildren(); const context = canvas.getContext('2d'); if (!context) return; await next.render({ canvasContext: context, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] }).promise; const text = await next.getTextContent(); if (cancelled) return; for (const raw of text.items) { if (!('str' in raw) || !raw.str) continue; const transform = Util.transform(viewport.transform, raw.transform); const fontSize = Math.max(6, Math.hypot(transform[2], transform[3])); const span = document.createElement('span'); span.textContent = raw.str; Object.assign(span.style, { position: 'absolute', left: `${transform[4]}px`, top: `${transform[5] - fontSize}px`, fontSize: `${fontSize}px`, lineHeight: '1', whiteSpace: 'pre', color: 'transparent', cursor: 'text', transformOrigin: '0 0' }); layer.appendChild(span); } setRendering(false); }).catch(() => setRendering(false)); return () => { cancelled = true; page?.cleanup(); }; }, [active, pageNumber, pdf, scale]);
  const point = (event: React.PointerEvent<SVGSVGElement>) => { const box = event.currentTarget.getBoundingClientRect(); return { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height }; };
  const interaction = tool === 'brush' || tool === 'sticky' || tool === 'comment';
  return <section className="scroll-mt-4"><div ref={shellRef} data-pdf-page={pageNumber} className="relative mx-auto bg-white shadow-xl" style={size}><canvas ref={canvasRef} className="block" /><div ref={textLayerRef} className={`absolute inset-0 select-text ${interaction ? 'pointer-events-none' : ''}`} />{annotations.map((annotation) => <AnnotationOverlay key={annotation.id} annotation={annotation} onSelect={onSelectAnnotation} />)}<svg className={`absolute inset-0 z-20 h-full w-full ${interaction ? tool === 'brush' ? 'cursor-crosshair' : 'cursor-copy' : 'pointer-events-none'}`} viewBox="0 0 1000 1000" preserveAspectRatio="none" onPointerDown={(event) => { if (tool === 'brush') { event.currentTarget.setPointerCapture(event.pointerId); drawingRef.current = [point(event)]; setDraft(drawingRef.current); } }} onPointerMove={(event) => { if (tool === 'brush' && event.currentTarget.hasPointerCapture(event.pointerId)) { drawingRef.current = [...drawingRef.current, point(event)]; setDraft(drawingRef.current); } }} onPointerUp={(event) => { if (tool === 'brush' && drawingRef.current.length > 1) { void onBrush(drawingRef.current); drawingRef.current = []; setDraft([]); } else if (tool === 'sticky' || tool === 'comment') { const p = point(event); onPageNote({ x: p.x, y: p.y, width: .025, height: .025 }); } }}><polyline points={draft.map((p) => `${p.x * 1000},${p.y * 1000}`).join(' ')} fill="none" stroke={color} strokeWidth={thickness * 1.7} strokeLinecap="round" strokeLinejoin="round" /></svg>{rendering && <div className="absolute inset-0 z-30 grid place-items-center bg-white/80"><Spinner label={t('Renderizando PDF…')} /></div>}</div><p className="mt-1 text-center text-[10px] text-neutral-500">{t('Página')} {pageNumber}</p></section>;
}

function AnnotationOverlay({ annotation, onSelect }: { annotation: StudyMaterialAnnotation; onSelect?: (annotation: StudyMaterialAnnotation) => void }) {
  const clickable = Boolean(onSelect);
  const pointer = clickable ? 'pointer-events-auto cursor-pointer' : 'pointer-events-none';
  const editTitle = clickable ? t('Editar o eliminar') : undefined;
  const handleClick = onSelect ? () => onSelect(annotation) : undefined;
  if (annotation.kind === 'brush') return <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full" viewBox="0 0 1000 1000" preserveAspectRatio="none"><polyline points={annotation.path.map((p) => `${p.x * 1000},${p.y * 1000}`).join(' ')} fill="none" stroke={annotation.color} strokeWidth={annotation.thickness * 1.7} strokeLinecap="round" strokeLinejoin="round" opacity=".82" /></svg>;
  if (annotation.kind === 'sticky' || annotation.kind === 'comment') return annotation.rect ? <span onClick={handleClick} title={editTitle} className={`${pointer} absolute z-10 grid h-6 w-6 place-items-center rounded shadow ${annotation.kind === 'sticky' ? 'bg-amber-200 text-amber-900' : 'bg-indigo-200 text-indigo-900'}`} style={{ left: `${annotation.rect.x * 100}%`, top: `${annotation.rect.y * 100}%` }}>{annotation.kind === 'sticky' ? '★' : '💬'}</span> : null;
  const rects = annotation.rects.length ? annotation.rects : annotation.rect ? [annotation.rect] : [];
  return <>{rects.map((rect, index) => <span key={index} onClick={handleClick} title={editTitle} className={`${pointer} absolute z-10`} style={annotation.kind === 'underline' ? { left: `${rect.x * 100}%`, top: `${(rect.y + rect.height) * 100}%`, width: `${rect.width * 100}%`, borderBottom: `${annotation.thickness}px solid ${annotation.color}` } : { left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%`, backgroundColor: annotation.color, opacity: .42, mixBlendMode: 'multiply' }} />)}</>;
}

function AnnotationCard({ annotation, onOpen, onEdit, onCreateNote, onDelete }: { annotation: StudyMaterialAnnotation; onOpen: () => void; onEdit: () => void; onCreateNote: () => Promise<void>; onDelete: () => Promise<void> }) {
  const label = annotation.kind === 'highlight' ? t('Resaltado') : annotation.kind === 'underline' ? t('Subrayado') : annotation.kind === 'brush' ? t('Pincel') : annotation.kind === 'sticky' ? t('Sticker') : t('Comentario');
  return <article className="mb-2 rounded-lg border border-neutral-200 p-2.5 dark:border-neutral-800"><button className="w-full text-left" onClick={onOpen}><span className="flex items-center gap-2 text-[10px] text-neutral-500"><i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: annotation.color }} />{label}{annotation.pageNumber ? ` · ${t('Página')} ${annotation.pageNumber}` : ''}</span>{annotation.selectedText && <p className="mt-1 line-clamp-3 text-xs italic text-neutral-500">“{annotation.selectedText}”</p>}{annotation.note && <p className="mt-1 text-xs leading-5 text-neutral-700 dark:text-neutral-300">{annotation.note}</p>}</button><div className="mt-2 flex items-center gap-3 text-[10px]"><button className="text-neutral-600 hover:text-indigo-500 dark:text-neutral-400" onClick={onEdit}>{t('Editar')}</button><button className="text-teal-600 dark:text-teal-400" onClick={() => void onCreateNote()}>{t('Crear apunte')}</button><button className="ml-auto text-red-600" onClick={() => void onDelete()}>{t('Eliminar')}</button></div></article>;
}
