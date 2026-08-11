import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { GlobalWorkerOptions, getDocument, TextLayer } from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type {
  LibraryReaderAttachment,
  LibraryReaderAttachmentContent,
  WritingDraftAnnotation,
  WritingDraftAnnotationColor,
  WritingDraftAnnotationInput,
} from '@shared/types';
import { ReaderSelectionActions } from '../ReaderSelectionActions';
import { Icon, Spinner } from '../ui';
import { confirm } from '../feedback';
import { t, tx } from '../../i18n';

GlobalWorkerOptions.workerSrc = pdfWorker;

type AnnotationCreate = Omit<WritingDraftAnnotationInput, 'draftId' | 'scope'>;
interface ViewerProps {
  documentId: string;
  attachment: LibraryReaderAttachment;
  annotations: WritingDraftAnnotation[];
  highlighterColor: WritingDraftAnnotationColor | null;
  onCreate(scope: string, input: AnnotationCreate): Promise<void>;
  onUpdateComment(id: string, comment: string): Promise<void>;
  onDelete(id: string): Promise<void>;
  onError(message: string): void;
  onOpenExternal(): void;
}

function TextSurface({
  scope, contextId, annotations, highlighterColor, onCreate, onUpdateComment, onDelete, onError, children, testId,
}: Pick<ViewerProps, 'annotations' | 'highlighterColor' | 'onCreate' | 'onUpdateComment' | 'onDelete' | 'onError'> & {
  scope: string; contextId: string; children: React.ReactNode; testId: string;
}) {
  const targetRef = useRef<HTMLDivElement | null>(null); const scrollRef = useRef<HTMLElement | null>(null);
  return <main ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto bg-neutral-100 p-5 dark:bg-neutral-950" data-testid={testId}>
    <div ref={targetRef} className="library-attachment-text mx-auto max-w-4xl rounded-2xl bg-white px-8 py-10 text-neutral-900 shadow-xl dark:bg-neutral-900 dark:text-neutral-100">
      {children}
    </div>
    <ReaderSelectionActions
      targetRef={targetRef} scrollRef={scrollRef} contextId={contextId}
      annotations={annotations.filter((entry) => entry.scope === scope)} highlighterColor={highlighterColor}
      onCreateAnnotation={(input) => onCreate(scope, input)} onUpdateComment={onUpdateComment}
      onDeleteAnnotation={onDelete} onAnnotationError={onError}
    />
  </main>;
}

function PdfViewer(props: ViewerProps) {
  const { attachment } = props; const canvasRef = useRef<HTMLCanvasElement | null>(null); const textRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLElement | null>(null); const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1); const [scale, setScale] = useState(1.25); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const scope = `attachment:${attachment.id}:page:${pageNumber}`;
  useEffect(() => {
    if (!attachment.url) return;
    const task = getDocument({ url: attachment.url }); let current: PDFDocumentProxy | null = null; setLoading(true); setError('');
    void task.promise.then((document) => { current = document; setPdf(document); setLoading(false); }).catch((cause) => { setError(cause instanceof Error ? cause.message : String(cause)); setLoading(false); });
    return () => { void task.destroy(); void current?.destroy(); };
  }, [attachment.url]);
  useEffect(() => {
    if (!pdf || !canvasRef.current || !textRef.current) return;
    let canceled = false; let textLayer: TextLayer | null = null;
    void pdf.getPage(pageNumber).then(async (page) => {
      if (canceled || !canvasRef.current || !textRef.current) return;
      const viewport = page.getViewport({ scale }); const ratio = Math.min(window.devicePixelRatio || 1, 2); const canvas = canvasRef.current;
      canvas.width = Math.ceil(viewport.width * ratio); canvas.height = Math.ceil(viewport.height * ratio); canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
      textRef.current.replaceChildren(); textRef.current.style.width = `${viewport.width}px`; textRef.current.style.height = `${viewport.height}px`;
      await page.render({ canvasContext: canvas.getContext('2d')!, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] }).promise;
      if (canceled || !textRef.current) return;
      textLayer = new TextLayer({ textContentSource: await page.getTextContent(), container: textRef.current, viewport }); await textLayer.render();
    }).catch((cause) => { if (!canceled) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { canceled = true; textLayer?.cancel(); };
  }, [pageNumber, pdf, scale]);
  return <section className="flex min-h-0 flex-1 flex-col" data-testid="library-reader-pdf-viewer">
    <div className="flex flex-wrap items-center justify-center gap-2 border-b border-neutral-800 px-3 py-2">
      <button className="btn btn-ghost h-8" disabled={pageNumber <= 1} onClick={() => setPageNumber((value) => Math.max(1, value - 1))}><Icon name="chevronLeft" />{t('Anterior')}</button>
      <label className="flex items-center gap-2 text-xs text-neutral-500">{t('Página')}<input className="input h-8 w-16 text-center" type="number" min="1" max={pdf?.numPages ?? 1} value={pageNumber} onChange={(event) => setPageNumber(Math.min(pdf?.numPages ?? 1, Math.max(1, Number(event.target.value) || 1)))} /></label>
      <span className="text-xs text-neutral-500">/ {pdf?.numPages ?? '—'}</span>
      <button className="btn btn-ghost h-8 w-8 p-0" aria-label={t('Alejar')} onClick={() => setScale((value) => Math.max(.6, value - .15))}>−</button><button className="text-xs text-neutral-500" onClick={() => setScale(1.25)}>{Math.round(scale * 100)}%</button><button className="btn btn-ghost h-8 w-8 p-0" aria-label={t('Acercar')} onClick={() => setScale((value) => Math.min(2.5, value + .15))}>+</button>
      <button data-testid="library-reader-open-external" className="btn btn-ghost h-8" onClick={props.onOpenExternal}><Icon name="external" />{t('Abrir fuera de Nodus')}</button>
    </div>
    <main ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto bg-neutral-200 p-6 dark:bg-black">
      {loading && <Spinner label={t('Cargando documento…')} />}{error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <div className="pdf-annotation-page relative mx-auto w-fit bg-white shadow-2xl"><canvas ref={canvasRef} /><div ref={textRef} className="textLayer" /></div>
      <ReaderSelectionActions targetRef={textRef} scrollRef={scrollRef} contextId={`${props.documentId}:${scope}`} annotations={props.annotations.filter((entry) => entry.scope === scope)} highlighterColor={props.highlighterColor}
        onCreateAnnotation={(input) => props.onCreate(scope, { ...input, target: { type: 'text', attachmentId: attachment.id, page: pageNumber } })}
        onUpdateComment={props.onUpdateComment} onDeleteAnnotation={props.onDelete} onAnnotationError={props.onError} />
    </main>
  </section>;
}

function RichTextViewer(props: ViewerProps) {
  const [content, setContent] = useState<LibraryReaderAttachmentContent | null>(null); const [chapterIndex, setChapterIndex] = useState(0); const [error, setError] = useState('');
  useEffect(() => { let live = true; setError(''); setContent(null); void window.nodus.getLibraryReaderAttachmentContent(props.documentId, props.attachment.id)
    .then((value) => { if (live) setContent(value); }).catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : String(cause)); }); return () => { live = false; }; }, [props.attachment.id, props.documentId]);
  if (error) return <div className="grid flex-1 place-items-center text-sm text-red-400">{error}</div>;
  if (!content) return <div className="grid flex-1 place-items-center"><Spinner label={t('Preparando el adjunto…')} /></div>;
  const chapter = content.chapters[chapterIndex]; const isEpub = content.viewer === 'epub'; const scope = isEpub ? `attachment:${props.attachment.id}:chapter:${chapter?.id}` : `attachment:${props.attachment.id}`;
  return <section className="flex min-h-0 flex-1 flex-col" data-testid={isEpub ? 'library-reader-epub-viewer' : 'library-reader-text-viewer'}>
    <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-3 py-2">
      {isEpub && <><button className="btn btn-ghost h-8" disabled={!chapterIndex} onClick={() => setChapterIndex((value) => Math.max(0, value - 1))}><Icon name="chevronLeft" />{t('Anterior')}</button><select className="input h-8 min-w-48 flex-1" value={chapterIndex} onChange={(event) => setChapterIndex(Number(event.target.value))}>{content.chapters.map((entry, index) => <option key={entry.id} value={index}>{entry.title}</option>)}</select><button className="btn btn-ghost h-8" disabled={chapterIndex >= content.chapters.length - 1} onClick={() => setChapterIndex((value) => Math.min(content.chapters.length - 1, value + 1))}>{t('Siguiente')}<Icon name="chevronRight" /></button></>}
      <button data-testid="library-reader-open-external" className="btn btn-ghost ml-auto h-8" onClick={props.onOpenExternal}><Icon name="external" />{t('Abrir fuera de Nodus')}</button>
    </div>
    <TextSurface scope={scope} contextId={`${props.documentId}:${scope}`} annotations={props.annotations} highlighterColor={props.highlighterColor} onCreate={(nextScope, input) => props.onCreate(nextScope, { ...input, target: { type: 'text', attachmentId: props.attachment.id, ...(chapter ? { chapterId: chapter.id } : {}) } })} onUpdateComment={props.onUpdateComment} onDelete={props.onDelete} onError={props.onError} testId={content.viewer === 'html' ? 'library-reader-html-viewer' : isEpub ? 'library-reader-epub-content' : 'library-reader-text-content'}>
      {(chapter?.html || content.html) ? <article className="prose prose-neutral max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: chapter?.html || content.html || '' }} /> : <pre className="whitespace-pre-wrap font-serif text-base leading-8">{chapter?.text || content.text}</pre>}
    </TextSurface>
  </section>;
}

const REGION_COLORS: Record<WritingDraftAnnotationColor, string> = { yellow: '#facc15', rose: '#fb7185', blue: '#60a5fa', mint: '#4ade80', lavender: '#a78bfa', peach: '#fb923c' };
function ImageViewer(props: ViewerProps) {
  const imageRef = useRef<HTMLImageElement | null>(null); const [drawing, setDrawing] = useState(false); const [start, setStart] = useState<{ x: number; y: number } | null>(null); const [draft, setDraft] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const scope = `attachment:${props.attachment.id}`; const point = (event: ReactPointerEvent) => { const rect = imageRef.current!.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }; };
  const move = (event: ReactPointerEvent) => { if (!start) return; const end = point(event); setDraft({ x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) }); };
  const finish = async () => { if (!draft || draft.width < .005 || draft.height < .005) { setStart(null); setDraft(null); return; } await props.onCreate(scope, { kind: 'highlight', color: props.highlighterColor || 'yellow', startOffset: 0, endOffset: 1, selectedText: '◼', prefix: '', suffix: '', target: { type: 'region', attachmentId: props.attachment.id, ...draft } }); setStart(null); setDraft(null); };
  const regions = props.annotations.filter((entry) => entry.scope === scope && entry.target?.type === 'region');
  return <section className="flex min-h-0 flex-1 flex-col" data-testid="library-reader-image-viewer"><div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2"><button className={`btn h-8 ${drawing ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setDrawing((value) => !value)}><Icon name="highlighter" />{t('Marcar región')}</button><span className="text-[10px] text-neutral-500">{t('Arrastra sobre la imagen para subrayar una zona.')}</span><button data-testid="library-reader-open-external" className="btn btn-ghost ml-auto h-8" onClick={props.onOpenExternal}><Icon name="external" />{t('Abrir fuera de Nodus')}</button></div>
    <main className="min-h-0 flex-1 overflow-auto bg-neutral-200 p-6 dark:bg-black"><div className="relative mx-auto w-fit max-w-full select-none"><img ref={imageRef} src={props.attachment.url || ''} alt={props.attachment.title} draggable={false} className={`max-h-[calc(100vh-15rem)] max-w-full object-contain shadow-2xl ${drawing ? 'cursor-crosshair' : ''}`} onPointerDown={(event) => { if (!drawing) return; event.currentTarget.setPointerCapture(event.pointerId); const value = point(event); setStart(value); setDraft({ ...value, width: 0, height: 0 }); }} onPointerMove={move} onPointerUp={() => void finish()} />
      {regions.map((annotation) => { const target = annotation.target!; if (target.type !== 'region') return null; return <button key={annotation.id} aria-label={t('Eliminar subrayado')} className="absolute border-2 bg-yellow-300/20 hover:bg-red-400/30" style={{ left: `${target.x * 100}%`, top: `${target.y * 100}%`, width: `${target.width * 100}%`, height: `${target.height * 100}%`, borderColor: REGION_COLORS[annotation.color || 'yellow'] }} onClick={() => void confirm({ title: t('Eliminar subrayado'), message: t('¿Eliminar este subrayado?'), confirmLabel: t('Eliminar'), danger: true }).then(async (ok) => { if (ok) await props.onDelete(annotation.id); })} />; })}
      {draft && <span className="pointer-events-none absolute border-2 border-indigo-400 bg-indigo-300/20" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.width * 100}%`, height: `${draft.height * 100}%` }} />}</div></main>
  </section>;
}

export function LibraryAttachmentViewer(props: ViewerProps) {
  if (!props.attachment.available) return <div className="grid flex-1 place-items-center p-8 text-center"><div><Icon name="alert" size={32} className="mx-auto text-amber-400" /><p className="mt-3 text-sm">{t('El archivo no está disponible en este dispositivo.')}</p></div></div>;
  if (props.attachment.viewer === 'pdf') return <PdfViewer {...props} />;
  if (props.attachment.viewer === 'epub' || props.attachment.viewer === 'html' || props.attachment.viewer === 'text') return <RichTextViewer {...props} />;
  if (props.attachment.viewer === 'image') return <ImageViewer {...props} />;
  return <div className="grid flex-1 place-items-center p-8 text-center"><div><Icon name="archive" size={40} className="mx-auto text-neutral-500" /><h2 className="mt-3 font-semibold">{props.attachment.title}</h2><p className="mt-1 max-w-md text-xs text-neutral-500">{tx('Nodus conserva este archivo. Usa la versión limpia para subrayar el texto o ábrelo con su aplicación compatible.', {})}</p><button data-testid="library-reader-open-external" className="btn btn-primary mt-5" onClick={props.onOpenExternal}><Icon name="external" />{t('Abrir fuera de Nodus')}</button></div></div>;
}
