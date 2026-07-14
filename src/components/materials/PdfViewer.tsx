import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { GlobalWorkerOptions, Util, getDocument } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { StudyMaterialAnnotation, StudyMaterialAnnotationInput, StudyMaterialContent, StudyMaterialDetail, StudyMaterialRect } from '@shared/types';
import { Icon, Spinner } from '../ui';
import { t } from '../../i18n';

GlobalWorkerOptions.workerSrc = pdfWorker;

interface PendingSelection {
  text: string;
  rect: StudyMaterialRect | null;
}

export function PdfViewer({ content, material, onAnnotation, onDeleteAnnotation, onCreateNote }: {
  content: StudyMaterialContent;
  material: StudyMaterialDetail;
  onAnnotation: (input: StudyMaterialAnnotationInput) => Promise<void>;
  onDeleteAnnotation: (id: string) => Promise<void>;
  onCreateNote: (annotationId?: string | null) => Promise<void>;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [note, setNote] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const pageShellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let current: PDFDocumentProxy | null = null;
    setLoading(true); setError('');
    const task = getDocument({ data: new Uint8Array(content.bytes) });
    void task.promise.then((document) => {
      current = document; setPdf(document); setPageNumber(1); setLoading(false);
    }).catch((cause) => { setError(cause instanceof Error ? cause.message : String(cause)); setLoading(false); });
    return () => { void task.destroy(); void current?.destroy(); };
  }, [material.contentHash]);

  useEffect(() => {
    if (!pdf || !canvasRef.current || !textLayerRef.current) return;
    let cancelled = false;
    let page: PDFPageProxy | null = null;
    setLoading(true);
    void pdf.getPage(pageNumber).then(async (nextPage) => {
      page = nextPage;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const layer = textLayerRef.current;
      if (!canvas || !layer || cancelled) return;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * ratio); canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
      layer.style.width = `${viewport.width}px`; layer.style.height = `${viewport.height}px`;
      layer.replaceChildren();
      const context = canvas.getContext('2d');
      if (!context) return;
      await page.render({ canvasContext: context, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] }).promise;
      const text = await page.getTextContent();
      for (const raw of text.items) {
        if (!('str' in raw) || !raw.str) continue;
        const transform = Util.transform(viewport.transform, raw.transform);
        const fontSize = Math.max(6, Math.hypot(transform[2], transform[3]));
        const span = document.createElement('span');
        span.textContent = raw.str;
        span.style.position = 'absolute'; span.style.left = `${transform[4]}px`; span.style.top = `${transform[5] - fontSize}px`;
        span.style.fontSize = `${fontSize}px`; span.style.lineHeight = '1'; span.style.whiteSpace = 'pre';
        span.style.color = 'transparent'; span.style.cursor = 'text'; span.style.transformOrigin = '0 0';
        layer.appendChild(span);
      }
      setLoading(false);
    }).catch((cause) => { if (!cancelled) { setError(cause instanceof Error ? cause.message : String(cause)); setLoading(false); } });
    return () => { cancelled = true; page?.cleanup(); };
  }, [pdf, pageNumber, scale]);

  const captureSelection = () => {
    const selection = window.getSelection();
    const text = selection?.toString().trim() ?? '';
    if (!text || !pageShellRef.current || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    const box = range.getBoundingClientRect();
    const shell = pageShellRef.current.getBoundingClientRect();
    const rect = shell.width && shell.height ? {
      x: Math.max(0, Math.min(1, (box.left - shell.left) / shell.width)),
      y: Math.max(0, Math.min(1, (box.top - shell.top) / shell.height)),
      width: Math.max(0.004, Math.min(1, box.width / shell.width)),
      height: Math.max(0.004, Math.min(1, box.height / shell.height)),
    } : null;
    setPending({ text, rect });
  };

  const saveAnnotation = async () => {
    if (!pending) return;
    await onAnnotation({ pageNumber, rect: pending.rect, selectedText: pending.text, note, color: '#facc15' });
    setPending(null); setNote(''); window.getSelection()?.removeAllRanges();
  };

  const pageAnnotations = material.annotations.filter((annotation) => annotation.pageNumber === pageNumber && annotation.rect);

  return <div className="flex h-full min-h-0 flex-col" data-testid="study-pdf-viewer">
    <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 bg-neutral-950 px-3 py-2">
      <button className="btn btn-ghost px-2" disabled={pageNumber <= 1} onClick={() => setPageNumber((value) => Math.max(1, value - 1))}><Icon name="chevronLeft" /></button>
      <span className="text-xs text-neutral-400">{t('Página')} <input className="input h-7 w-14 text-center" type="number" min="1" max={pdf?.numPages ?? 1} value={pageNumber} onChange={(event) => setPageNumber(Math.max(1, Math.min(pdf?.numPages ?? 1, Number(event.target.value))))} /> / {pdf?.numPages ?? material.pageCount ?? '—'}</span>
      <button className="btn btn-ghost px-2" disabled={!pdf || pageNumber >= pdf.numPages} onClick={() => setPageNumber((value) => Math.min(pdf?.numPages ?? value, value + 1))}><Icon name="chevronRight" /></button>
      <button className="btn btn-ghost ml-2 px-2" onClick={() => setScale((value) => Math.max(0.6, value - 0.15))}>−</button><span className="text-[10px] text-neutral-600">{Math.round(scale * 100)}%</span><button className="btn btn-ghost px-2" onClick={() => setScale((value) => Math.min(2.5, value + 0.15))}>+</button>
      <button className="btn btn-primary ml-auto" onClick={() => void onCreateNote(null)}><Icon name="notebook" size={12} /> {t('Crear apunte de esta fuente')}</button>
    </div>
    <div className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1 overflow-auto bg-neutral-900/40 p-5" onMouseUp={captureSelection}>
        {error && <div className="rounded-xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">{error}</div>}
        <div ref={pageShellRef} className="relative mx-auto w-fit bg-white shadow-2xl">
          <canvas ref={canvasRef} className="block" />
          <div ref={textLayerRef} data-testid="study-pdf-text-layer" className="absolute inset-0 select-text" />
          {pageAnnotations.map((annotation) => <button key={annotation.id} title={annotation.note || annotation.selectedText} className="absolute z-10 border border-amber-500/50 bg-amber-300/30 hover:bg-amber-300/45" style={{ left: `${annotation.rect!.x * 100}%`, top: `${annotation.rect!.y * 100}%`, width: `${annotation.rect!.width * 100}%`, height: `${annotation.rect!.height * 100}%` }} />)}
          {loading && <div className="absolute inset-0 grid place-items-center bg-white/70"><Spinner label={t('Renderizando PDF…')} /></div>}
        </div>
      </div>
      <aside className="w-72 shrink-0 overflow-y-auto border-l border-neutral-800 bg-neutral-950 p-3">
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-600">{t('Subrayados y anotaciones')}</h3>
        {material.annotations.length === 0 ? <p className="text-xs leading-5 text-neutral-600">{t('Selecciona texto del PDF para subrayarlo y convertirlo en apunte.')}</p> : material.annotations.map((annotation) => <AnnotationCard key={annotation.id} annotation={annotation} onOpen={() => annotation.pageNumber && setPageNumber(annotation.pageNumber)} onCreateNote={() => onCreateNote(annotation.id)} onDelete={() => onDeleteAnnotation(annotation.id)} />)}
      </aside>
    </div>
    {pending && <div className="absolute bottom-5 left-1/2 z-30 w-[min(520px,90%)] -translate-x-1/2 rounded-xl border border-amber-800 bg-neutral-950 p-3 shadow-2xl" data-testid="study-pdf-annotation-dialog"><p className="line-clamp-3 border-l-2 border-amber-500 pl-2 text-xs italic text-neutral-400">{pending.text}</p><textarea autoFocus className="input mt-2 min-h-16 w-full" value={note} onChange={(event) => setNote(event.target.value)} placeholder={t('Añade una nota opcional')} /><div className="mt-2 flex justify-end gap-2"><button className="btn btn-ghost" onClick={() => { setPending(null); setNote(''); }}>{t('Cancelar')}</button><button className="btn btn-primary" onClick={() => void saveAnnotation()}>{t('Guardar subrayado')}</button></div></div>}
  </div>;
}

function AnnotationCard({ annotation, onOpen, onCreateNote, onDelete }: { annotation: StudyMaterialAnnotation; onOpen: () => void; onCreateNote: () => Promise<void>; onDelete: () => Promise<void> }) {
  return <div className="mb-2 rounded-lg border border-neutral-800 p-2.5"><button className="w-full text-left" onClick={onOpen}><span className="text-[10px] text-amber-500">{annotation.pageNumber ? `${t('Página')} ${annotation.pageNumber}` : t('Comentario general')}</span>{annotation.selectedText && <p className="mt-1 line-clamp-3 text-xs italic text-neutral-400">“{annotation.selectedText}”</p>}{annotation.note && <p className="mt-1 text-xs leading-5 text-neutral-300">{annotation.note}</p>}</button><div className="mt-2 flex gap-2 text-[10px]"><button className="text-teal-500 hover:text-teal-300" onClick={() => void onCreateNote()}>{t('Crear apunte')}</button><button className="ml-auto text-red-600 hover:text-red-400" onClick={() => void onDelete()}>{t('Eliminar')}</button></div></div>;
}
