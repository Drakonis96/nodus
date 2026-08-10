import { useCallback, useEffect, useRef, useState } from 'react';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type {
  LibraryReaderDocument,
  LibraryReaderChatMessage,
  LibraryReaderReference,
  WritingDraftAnnotation,
  WritingDraftAnnotationColor,
  WritingDraftAnnotationInput,
} from '@shared/types';
import { ASSISTANT_CONTEXTS, type PendingAssistantNavigationTarget } from '../navigation';
import { FindInPage } from '../components/FindInPage';
import { Markdown } from '../components/Markdown';
import { NodiViewContextSource } from '../components/NodiViewContextSource';
import {
  READER_ANNOTATION_COLORS,
  ReaderHighlighterControl,
  ReaderSelectionActions,
  type ReaderSelectionActionsHandle,
} from '../components/ReaderSelectionActions';
import { HoverLabelButton, Icon, Spinner } from '../components/ui';
import { confirm } from '../components/feedback';
import { t, tx } from '../i18n';

GlobalWorkerOptions.workerSrc = pdfWorker;

function readingPositionKey(storageId: string): string {
  return `nodus.libraryReader.position.${storageId}`;
}

function findTextRange(root: HTMLElement, annotation: WritingDraftAnnotation): Range | null {
  const content = root.textContent || '';
  const candidates: number[] = [];
  let from = 0;
  while (from <= content.length) {
    const index = content.indexOf(annotation.selectedText, from);
    if (index < 0) break;
    candidates.push(index);
    from = index + Math.max(1, annotation.selectedText.length);
  }
  if (!candidates.length) return null;
  const index = candidates.sort((a, b) => {
    const score = (at: number) => {
      let value = -Math.abs(at - annotation.startOffset) / Math.max(1, content.length);
      if (annotation.prefix && content.slice(Math.max(0, at - annotation.prefix.length), at) === annotation.prefix) value += 2;
      if (annotation.suffix && content.slice(at + annotation.selectedText.length, at + annotation.selectedText.length + annotation.suffix.length) === annotation.suffix) value += 2;
      return value;
    };
    return score(b) - score(a);
  })[0];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let offset = 0;
  let started = false;
  let node = walker.nextNode();
  while (node) {
    const text = node as Text;
    const next = offset + text.data.length;
    if (!started && index >= offset && index <= next) {
      range.setStart(text, Math.min(text.data.length, index - offset));
      started = true;
    }
    const end = index + annotation.selectedText.length;
    if (started && end >= offset && end <= next) {
      range.setEnd(text, Math.min(text.data.length, end - offset));
      return range;
    }
    offset = next;
    node = walker.nextNode();
  }
  return null;
}

function anchorForElement(root: HTMLElement, element: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(element);
  const before = document.createRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const selectedText = range.toString();
  const startOffset = before.toString().length;
  const endOffset = startOffset + selectedText.length;
  const content = root.textContent || '';
  return {
    startOffset,
    endOffset,
    selectedText,
    prefix: content.slice(Math.max(0, startOffset - 64), startOffset),
    suffix: content.slice(endOffset, endOffset + 64),
  };
}

function OriginalPagePreview({
  url, initialPage, title, onClose, onOpenFull,
}: {
  url: string; initialPage: number; title: string; onClose: () => void; onOpenFull: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(Math.max(1, initialPage));
  const [scale, setScale] = useState(1.2);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let current: PDFDocumentProxy | null = null;
    const task = getDocument({ url });
    setLoading(true); setError('');
    void task.promise.then((document) => {
      current = document; setPdf(document); setPageNumber((value) => Math.min(document.numPages, Math.max(1, value))); setLoading(false);
    }).catch((cause) => { setError(cause instanceof Error ? cause.message : String(cause)); setLoading(false); });
    return () => { void task.destroy(); void current?.destroy(); };
  }, [url]);

  useEffect(() => { setPageNumber(Math.max(1, initialPage)); }, [initialPage]);
  useEffect(() => {
    if (!pdf || !canvasRef.current) return;
    let canceled = false;
    void pdf.getPage(pageNumber).then(async (page) => {
      if (canceled || !canvasRef.current) return;
      const viewport = page.getViewport({ scale });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = canvasRef.current;
      canvas.width = Math.ceil(viewport.width * ratio); canvas.height = Math.ceil(viewport.height * ratio);
      canvas.style.width = `${Math.ceil(viewport.width)}px`; canvas.style.height = `${Math.ceil(viewport.height)}px`;
      await page.render({ canvasContext: canvas.getContext('2d')!, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] }).promise;
      page.cleanup();
    }).catch((cause) => { if (!canceled) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { canceled = true; };
  }, [pdf, pageNumber, scale]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-black/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={t('Página del original')} data-testid="library-original-preview" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="card mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col overflow-hidden shadow-2xl">
        <header className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-4 py-2.5">
          <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold">{title}</h2><p className="text-[10px] text-neutral-500">{t('Vista temporal del original; no se modifica el archivo.')}</p></div>
          <button className="btn btn-ghost h-8" disabled={pageNumber <= 1} onClick={() => setPageNumber((value) => Math.max(1, value - 1))}><Icon name="chevronLeft" size={13} /> {t('Anterior')}</button>
          <label className="flex items-center gap-1 text-xs text-neutral-500">{t('Página')}<input className="input h-8 w-16 text-center" type="number" min="1" max={pdf?.numPages ?? 1} value={pageNumber} onChange={(event) => setPageNumber(Math.min(pdf?.numPages ?? 1, Math.max(1, Number(event.target.value) || 1)))} /></label>
          <span className="text-xs text-neutral-600">/ {pdf?.numPages ?? '—'}</span>
          <button className="btn btn-ghost h-8 w-8 p-0" aria-label={t('Alejar')} onClick={() => setScale((value) => Math.max(0.55, value - 0.15))}>−</button>
          <button className="text-[11px] text-neutral-500" onClick={() => setScale(1.2)}>{Math.round(scale * 100)}%</button>
          <button className="btn btn-ghost h-8 w-8 p-0" aria-label={t('Acercar')} onClick={() => setScale((value) => Math.min(2.5, value + 0.15))}>+</button>
          <button className="btn btn-ghost h-8 border border-neutral-700" onClick={onOpenFull}><Icon name="external" size={13} /> {t('Abrir completo')}</button>
          <button className="btn btn-ghost h-8 w-8 p-0" onClick={onClose} aria-label={t('Cerrar')}><Icon name="x" size={14} /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto bg-neutral-900/70 p-6 text-center">
          {loading && <div className="grid h-full place-items-center"><Spinner label={t('Cargando página original…')} /></div>}
          {error && <div role="alert" className="mx-auto max-w-lg rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>}
          {!loading && !error && <canvas ref={canvasRef} className="mx-auto bg-white shadow-2xl" data-page={pageNumber} />}
        </div>
      </section>
    </div>
  );
}

export function LibraryDocumentReader({
  reference,
  onBack,
  onOpenAssistant,
}: {
  reference: LibraryReaderReference;
  onBack: () => void;
  onOpenAssistant: (target?: PendingAssistantNavigationTarget) => void;
}) {
  const scrollRef = useRef<HTMLElement | null>(null);
  const documentRef = useRef<HTMLDivElement | null>(null);
  const markActionsRef = useRef<ReaderSelectionActionsHandle | null>(null);
  const bookmarkMenuRef = useRef<HTMLDivElement | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const [reader, setReader] = useState<LibraryReaderDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<WritingDraftAnnotation[]>([]);
  const [annotationError, setAnnotationError] = useState<string | null>(null);
  const [highlighterColor, setHighlighterColor] = useState<WritingDraftAnnotationColor | null>(null);
  const [hasReaderMark, setHasReaderMark] = useState(false);
  const [activeSection, setActiveSection] = useState(0);
  const [progress, setProgress] = useState(0);
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [notesOpen, setNotesOpen] = useState(true);
  const [bookmarkMenuOpen, setBookmarkMenuOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'annotations' | 'metadata' | 'chat'>('annotations');
  const [previewPage, setPreviewPage] = useState<number | null>(null);
  const [chatMessages, setChatMessages] = useState<LibraryReaderChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [chatStreaming, setChatStreaming] = useState('');
  const [chatError, setChatError] = useState<string | null>(null);

  const loadReader = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReader(await window.nodus.getLibraryReaderDocument(reference.id));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      setReader(null);
    } finally {
      setLoading(false);
    }
  }, [reference.id]);

  const refreshAnnotations = useCallback(async () => {
    try {
      setAnnotations(await window.nodus.listLibraryReaderAnnotations(reference.id));
      setAnnotationError(null);
    } catch (nextError) {
      setAnnotationError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }, [reference.id]);

  useEffect(() => { void loadReader(); }, [loadReader]);
  useEffect(() => {
    if (!reader) return;
    let alive = true;
    void window.nodus.listLibraryReaderChatMessages(reference.id)
      .then((messages) => { if (alive) setChatMessages(messages); })
      .catch((nextError) => { if (alive) setChatError(nextError instanceof Error ? nextError.message : String(nextError)); });
    return () => { alive = false; };
  }, [reader, reference.id]);

  useEffect(() => {
    if (sidebarTab === 'chat') chatBottomRef.current?.scrollIntoView({ block: 'end' });
  }, [chatMessages, chatStreaming, sidebarTab]);
  useEffect(() => {
    if (!bookmarkMenuOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (!bookmarkMenuRef.current?.contains(event.target as Node)) setBookmarkMenuOpen(false);
    };
    const dismissWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setBookmarkMenuOpen(false);
    };
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('keydown', dismissWithKeyboard);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('keydown', dismissWithKeyboard);
    };
  }, [bookmarkMenuOpen]);
  useEffect(() => {
    if (!reader) return;
    void refreshAnnotations();
    return window.nodus.onLibraryReaderAnnotationsChanged((nodusId) => {
      if (nodusId === null || nodusId === reference.id) void refreshAnnotations();
    });
  }, [reader, refreshAnnotations, reference.id]);

  const createAnnotation = async (input: Omit<WritingDraftAnnotationInput, 'draftId' | 'scope'>) => {
    const created = await window.nodus.createLibraryReaderAnnotation(reference.id, {
      ...input,
      draftId: reference.id,
      scope: 'source',
    });
    setAnnotations((current) => [...current.filter((item) => item.id !== created.id), created]);
    setAnnotationError(null);
  };

  const updateComment = async (id: string, comment: string) => {
    const updated = await window.nodus.updateLibraryReaderComment(reference.id, id, comment);
    if (!updated) return void refreshAnnotations();
    setAnnotations((current) => current.map((item) => item.id === updated.id ? updated : item));
    setAnnotationError(null);
  };

  const deleteAnnotation = async (id: string) => {
    await window.nodus.deleteLibraryReaderAnnotation(reference.id, id);
    setAnnotations((current) => current.filter((item) => item.id !== id));
    setAnnotationError(null);
  };

  useEffect(() => {
    const root = documentRef.current;
    if (!reader || !root) return;
    const headings = Array.from(root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'));
    headings.forEach((heading, index) => {
      const section = reader.sections[index];
      if (section) heading.id = section.id;
    });
    const scroller = scrollRef.current;
    if (!scroller) return;
    const saved = Number(localStorage.getItem(readingPositionKey(reader.storageId)) || 0);
    requestAnimationFrame(() => { scroller.scrollTop = Number.isFinite(saved) ? Math.max(0, saved) : 0; });
  }, [reader]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!reader || !scroller) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const max = Math.max(1, scroller.scrollHeight - scroller.clientHeight);
      setProgress(Math.min(100, Math.max(0, (scroller.scrollTop / max) * 100)));
      localStorage.setItem(readingPositionKey(reader.storageId), String(Math.round(scroller.scrollTop)));
      const top = scroller.getBoundingClientRect().top + 120;
      const headings = Array.from(documentRef.current?.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6') ?? []);
      let next = 0;
      for (let index = 0; index < headings.length; index += 1) {
        if (headings[index].getBoundingClientRect().top <= top) next = index;
        else break;
      }
      setActiveSection(next);
    };
    const schedule = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    schedule();
    scroller.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [reader]);

  const scrollToSection = (index: number) => {
    const id = reader?.sections[index]?.id;
    if (!id) return;
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const goToAnnotation = (annotation: WritingDraftAnnotation) => {
    const root = documentRef.current;
    if (!root) return;
    const range = findTextRange(root, annotation);
    range?.startContainer.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const markCurrentSection = async () => {
    const root = documentRef.current;
    const section = reader?.sections[activeSection];
    if (!root || !section) return;
    const heading = document.getElementById(section.id);
    if (!(heading instanceof HTMLElement)) return;
    const anchor = anchorForElement(root, heading);
    if (!anchor.selectedText.trim()) return;
    await createAnnotation({ ...anchor, kind: 'bookmark', color: null });
  };

  const openCurrentPage = (page: number | null) => {
    if (reader?.originalMimeType === 'application/pdf' && reader.originalUrl) setPreviewPage(page ?? 1);
    else void window.nodus.openLibraryReaderOriginal(reference.id);
  };

  const openDocumentChat = () => {
    setNotesOpen(true);
    setSidebarTab('chat');
  };

  const openFullAssistant = () => {
    onOpenAssistant({
      title: `${t('Lectura:')} ${reader?.title ?? reference.title}`,
      selection: ASSISTANT_CONTEXTS.reading,
      prompt:
        `${t('Quiero conversar sobre este documento. Prioriza su texto, sus anotaciones y su relación con el resto del corpus.')}`
        + `\n\n${reader?.title ?? reference.title}\n${(reader?.authors ?? reference.authors).join(', ')}`
        + `${reader?.zoteroKey ? `\nZotero: ${reader.zoteroKey}` : ''}`,
    });
  };

  const sendChat = async () => {
    const content = chatInput.trim();
    if (!content || chatSending || !reader) return;
    const user: LibraryReaderChatMessage = {
      id: crypto.randomUUID(), role: 'user', content, createdAt: new Date().toISOString(),
    };
    const requestMessages = [...chatMessages.filter((message) => !message.error), user];
    setChatMessages(requestMessages);
    setChatInput('');
    setChatStreaming('');
    setChatError(null);
    setChatSending(true);
    try {
      const response = await window.nodus.libraryReaderChatStream(
        { documentId: reference.id, messages: requestMessages },
        { onDelta: (delta) => setChatStreaming((current) => current + delta) },
      );
      if (response.answer) setChatMessages((current) => [...current, {
        id: crypto.randomUUID(), role: 'assistant', content: response.answer, createdAt: new Date().toISOString(),
      }]);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      setChatError(message);
      setChatMessages((current) => [...current, {
        id: crypto.randomUUID(), role: 'assistant', content: message, createdAt: new Date().toISOString(), error: true,
      }]);
    } finally {
      setChatSending(false);
      setChatStreaming('');
    }
  };

  const clearChat = async () => {
    if (!chatMessages.length || !(await confirm({
      title: t('Vaciar conversación'),
      message: t('Se eliminará el chat guardado junto a este documento.'),
      confirmLabel: t('Vaciar'), danger: true,
    }))) return;
    await window.nodus.clearLibraryReaderChat(reference.id);
    setChatMessages([]);
    setChatStreaming('');
    setChatError(null);
  };

  if (loading) {
    return <div className="grid h-full place-items-center"><Spinner label={t('Preparando lector…')} /></div>;
  }

  if (!reader) {
    return (
      <div className="flex h-full flex-col">
        <header className="border-b border-neutral-800 px-4 py-2.5">
          <button className="btn btn-ghost gap-1.5" onClick={onBack}><Icon name="chevronLeft" /> {t('Volver a la biblioteca')}</button>
        </header>
        <div className="grid min-h-0 flex-1 place-items-center p-8">
          <div className="max-w-lg rounded-2xl border border-dashed border-neutral-700 bg-neutral-950/30 p-8 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-indigo-950 text-indigo-300"><Icon name="book" size={21} /></span>
            <h2 className="mt-4 text-base font-semibold text-neutral-100">{t('Todavía no hay una versión limpia de esta obra')}</h2>
            <p className="mt-2 text-sm leading-6 text-neutral-500">{error ?? tx('El lector buscará el documento en nodus-library/{id}, conservando su identificador estable.', { id: reference.zoteroKey || reference.id })}</p>
            <div className="mt-5 flex justify-center gap-2">
              {reference.zoteroKey && <button className="btn btn-ghost border border-neutral-700" onClick={() => void window.nodus.openInZotero(reference.zoteroKey!)}><Icon name="external" /> {t('Abrir en Zotero')}</button>}
              <button className="btn btn-primary" onClick={() => void loadReader()}><Icon name="refresh" /> {t('Volver a comprobar')}</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const currentPage = reader.sections[activeSection]?.page ?? null;
  const visibleAnnotations = annotations.filter((annotation) => annotation.scope === 'source');
  const sidebarAnnotations = visibleAnnotations.filter((annotation) => annotation.kind !== 'bookmark');
  const contextMarkdown = reader.markdown.replace(/data:image\/[^;]+;base64,[^)\s]+/g, '[imagen extraída]');

  return (
    <div className="library-document-reader flex h-full min-h-0 flex-col">
      <NodiViewContextSource title={reader.title} text={contextMarkdown} />
      <header className="relative z-40 flex flex-wrap items-center gap-2 border-b border-neutral-800 bg-neutral-950/60 px-4 py-2.5 backdrop-blur">
        <button className="btn btn-ghost gap-1.5" onClick={onBack}><Icon name="chevronLeft" /> {t('Biblioteca')}</button>
        <button
          className={`btn btn-ghost h-9 w-9 shrink-0 p-0 ${outlineOpen ? 'text-indigo-300' : ''}`}
          data-testid="library-reader-outline-toggle"
          onClick={() => setOutlineOpen((value) => !value)}
          aria-controls="library-reader-outline"
          aria-expanded={outlineOpen}
          aria-label={t('Índice')}
          title={t('Índice')}
        ><Icon name="list" /></button>
        <div className="min-w-[12rem] flex-1">
          <h1 className="truncate text-sm font-semibold text-neutral-100" title={reader.title}>{reader.title}</h1>
          <p className="truncate text-[11px] text-neutral-500">
            {reader.authors.join(', ')}{reader.year ? ` · ${reader.year}` : ''} · {reader.wordCount.toLocaleString()} {t('palabras')}
          </p>
        </div>
        <span className="hidden rounded-full border border-emerald-900/70 bg-emerald-950/30 px-2 py-1 text-[10px] font-medium text-emerald-300 md:inline-flex">{t('Markdown limpio')}</span>
        <ReaderHighlighterControl value={highlighterColor} onChange={setHighlighterColor} />
        <div ref={bookmarkMenuRef} className="relative">
          <button
            className={`btn btn-ghost h-9 w-10 gap-0.5 border p-0 ${hasReaderMark ? 'border-amber-700/60 text-amber-300' : 'border-neutral-700'}`}
            data-testid="library-reader-bookmark-menu"
            onClick={() => setBookmarkMenuOpen((value) => !value)}
            aria-haspopup="menu"
            aria-expanded={bookmarkMenuOpen}
            aria-label={t('Marcar esta sección')}
            title={t('Marcar esta sección')}
          ><Icon name={hasReaderMark ? 'bookmarkFill' : 'bookmark'} size={14} /><Icon name="chevronDown" size={10} /></button>
          {bookmarkMenuOpen && <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-xl border border-neutral-700 bg-neutral-950 p-1.5 shadow-2xl" role="menu">
            <button className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-neutral-300 hover:bg-neutral-900" role="menuitem" onClick={() => { setBookmarkMenuOpen(false); void markCurrentSection(); }}>
              <Icon name="bookmark" size={13} /><span>{t('Marcar esta sección')}</span>
            </button>
            <button className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-neutral-300 hover:bg-neutral-900 disabled:cursor-not-allowed disabled:text-neutral-700" role="menuitem" disabled={!hasReaderMark} onClick={() => { setBookmarkMenuOpen(false); markActionsRef.current?.goToMark(); }}>
              <Icon name="bookmarkFill" size={13} /><span>{t('Ir al marcador de lectura')}</span>
            </button>
          </div>}
        </div>
        <HoverLabelButton icon="file" label={currentPage ? tx('Ver página {n}', { n: currentPage }) : t('Ver página original')} onClick={() => openCurrentPage(currentPage)} disabled={!reader.originalAvailable} showLabel={!!currentPage} className="btn-ghost h-9 min-h-9 border border-neutral-700" />
        <HoverLabelButton icon="external" label={t('Abrir original completo')} onClick={() => void window.nodus.openLibraryReaderOriginal(reference.id)} disabled={!reader.originalAvailable} className="btn-ghost h-9 min-h-9 border border-neutral-700" />
        <button className="btn btn-primary h-9 w-9 shrink-0 p-0" data-testid="library-reader-open-chat" onClick={openDocumentChat} aria-label={t('Preguntar al chat')} title={t('Preguntar al chat')}><Icon name="chat" size={14} /></button>
        <button
          className={`btn btn-ghost h-9 w-9 shrink-0 p-0 ${notesOpen ? 'text-indigo-300' : ''}`}
          data-testid="library-reader-sidebar-toggle"
          onClick={() => setNotesOpen((value) => !value)}
          aria-controls="library-reader-sidebar"
          aria-expanded={notesOpen}
          aria-label={t('Anotaciones')}
          title={t('Anotaciones')}
        ><Icon name="columns" /></button>
        <div className="absolute inset-x-0 bottom-0 h-px bg-neutral-800"><div className="h-full bg-indigo-500 transition-[width]" style={{ width: `${progress}%` }} /></div>
      </header>

      {(error || annotationError) && <div className="border-b border-red-900 bg-red-950/30 px-4 py-2 text-xs text-red-200">{error ?? annotationError}</div>}

      <div className="relative flex min-h-0 flex-1">
        {outlineOpen && (
          <aside id="library-reader-outline" className="library-reader-outline w-64 shrink-0 overflow-y-auto border-r border-neutral-800 bg-neutral-950/25 px-3 py-4 max-lg:absolute max-lg:inset-y-[3.75rem] max-lg:left-0 max-lg:z-30 max-lg:shadow-2xl">
            <div className="mb-3 flex items-center justify-between px-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500">{t('En este documento')}</span>
              <span className="ml-auto text-[10px] tabular-nums text-neutral-600">{Math.round(progress)}%</span>
              <button className="ml-1.5 rounded-lg p-1 text-neutral-600 hover:bg-neutral-900 hover:text-neutral-300" onClick={() => setOutlineOpen(false)} aria-label={t('Cerrar')}><Icon name="chevronLeft" size={13} /></button>
            </div>
            <nav className="space-y-0.5">
              {reader.sections.map((section, index) => (
                <div key={section.id} className={`group flex items-center rounded-lg ${index === activeSection ? 'bg-indigo-950/45 text-indigo-200' : 'text-neutral-500 hover:bg-neutral-900 hover:text-neutral-300'}`}>
                  <button className="min-w-0 flex-1 px-2 py-2 text-left text-xs leading-4" style={{ paddingLeft: `${8 + Math.max(0, section.level - 1) * 10}px` }} onClick={() => scrollToSection(index)}>
                    <span className="line-clamp-2">{section.title}</span>
                  </button>
                  {section.page && <button className="mr-1 shrink-0 rounded px-1.5 py-1 text-[9px] tabular-nums text-neutral-600 opacity-0 hover:bg-neutral-800 hover:text-indigo-300 group-hover:opacity-100" title={tx('Abrir página {n} del original', { n: section.page })} onClick={() => openCurrentPage(section.page)}>p. {section.page}</button>}
                </div>
              ))}
            </nav>
            <div className="mt-5 border-t border-neutral-800 px-2 pt-4 text-[10px] leading-5 text-neutral-600">
              <div>{t('Identificador')}: <span className="select-all font-mono text-neutral-500">{reader.storageId}</span></div>
              {reader.pageCount && <div>{reader.pageCount} {t('páginas en el original')}</div>}
            </div>
          </aside>
        )}

        <main ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto bg-neutral-950/10 px-5 py-8 max-md:px-3">
          <article className="library-reader-paper mx-auto max-w-[52rem] rounded-2xl border border-neutral-800/80 bg-neutral-950/35 px-12 py-12 shadow-[0_24px_70px_-40px_rgba(0,0,0,.75)] max-md:rounded-none max-md:border-x-0 max-md:px-5">
            <div ref={documentRef} className="library-reader-document relative" data-testid="library-reader-document">
              <Markdown content={reader.markdown} verify={false} allowDataImages className="text-[16px] leading-[1.85] text-neutral-300" />
            </div>
          </article>
          <div className="mx-auto mt-6 flex max-w-[52rem] items-center justify-between px-2 pb-10 text-[11px] text-neutral-600">
            <span>{reader.citationKey ? `[${reader.citationKey}]` : reader.storageId}</span>
            <span>{t('El original permanece separado y sin modificaciones.')}</span>
          </div>
        </main>

        <ReaderSelectionActions
          ref={markActionsRef}
          targetRef={documentRef}
          scrollRef={scrollRef}
          contextId={`library-reader:${reader.storageId}`}
          annotations={visibleAnnotations}
          highlighterColor={highlighterColor}
          onCreateAnnotation={createAnnotation}
          onUpdateComment={updateComment}
          onDeleteAnnotation={deleteAnnotation}
          onAnnotationError={setAnnotationError}
          onMarkChange={setHasReaderMark}
        />

        {notesOpen && (
          <aside id="library-reader-sidebar" className="library-reader-notes flex w-80 shrink-0 flex-col overflow-hidden border-l border-neutral-800 bg-neutral-950/25 max-xl:absolute max-xl:inset-y-[3.75rem] max-xl:right-0 max-xl:z-30 max-xl:shadow-2xl" data-testid="library-reader-sidebar">
            <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2.5">
              <h2 className="text-xs font-semibold text-neutral-200">{t('Documento')}</h2>
              <button className="rounded-lg p-1.5 text-neutral-600 hover:bg-neutral-900 hover:text-neutral-300" onClick={() => setNotesOpen(false)} aria-label={t('Cerrar')}><Icon name="chevronRight" size={14} /></button>
            </div>
            <div className="flex items-center gap-1 border-b border-neutral-800 p-2" role="tablist">
              {([
                ['annotations', 'notebook', t('Notas')], ['metadata', 'info', t('Info')], ['chat', 'chat', t('Chat')],
              ] as const).map(([id, icon, label]) => {
                const selected = sidebarTab === id;
                return <button
                  key={id}
                  role="tab"
                  aria-selected={selected}
                  aria-label={label}
                  title={label}
                  data-testid={`library-reader-sidebar-tab-${id}`}
                  className={`btn h-8 min-w-0 text-[10px] transition-[width,padding] ${selected ? 'btn-secondary flex-1 px-3' : 'btn-ghost w-8 shrink-0 p-0'}`}
                  onClick={() => setSidebarTab(id)}
                ><Icon name={icon} size={12} />{selected && <span className="truncate">{label}</span>}</button>;
              })}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {sidebarTab === 'annotations' && <div className="space-y-2">
                <p className="mb-3 text-[10px] text-neutral-600">{tx('{n} fragmentos guardados', { n: sidebarAnnotations.length })}</p>
                {sidebarAnnotations.map((annotation) => {
                  const color = READER_ANNOTATION_COLORS.find((item) => item.id === annotation.color)?.hex;
                  return <article key={annotation.id} className="group rounded-xl border border-neutral-800 bg-neutral-950/35 p-3 hover:border-neutral-700">
                    <button className="block w-full text-left" onClick={() => goToAnnotation(annotation)}>
                      <span className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-neutral-600">{color ? <i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} /> : <Icon name="chat" size={11} />}{annotation.kind === 'comment' ? t('Anotación') : t('Subrayado')}</span>
                      <span className="mt-2 line-clamp-3 block border-l-2 border-neutral-700 pl-2 text-[11px] italic leading-5 text-neutral-400">“{annotation.selectedText.replace(/\s+/g, ' ').trim()}”</span>
                      {annotation.comment && <span className="mt-2 line-clamp-4 block text-xs leading-5 text-neutral-300">{annotation.comment}</span>}
                    </button>
                    <div className="mt-2 flex justify-end opacity-0 group-hover:opacity-100"><button className="rounded p-1 text-neutral-600 hover:bg-red-950 hover:text-red-400" aria-label={t('Eliminar')} onClick={async () => {
                      const accepted = await confirm({ title: t('Eliminar'), message: t('¿Eliminar esta anotación? No se puede deshacer.'), confirmLabel: t('Eliminar'), danger: true });
                      if (accepted) await deleteAnnotation(annotation.id);
                    }}><Icon name="trash" size={12} /></button></div>
                  </article>;
                })}
                {!sidebarAnnotations.length && <div className="rounded-xl border border-dashed border-neutral-800 px-4 py-8 text-center text-xs leading-5 text-neutral-600">{t('Selecciona texto para subrayarlo, anotarlo o preguntarle a Nodi.')}</div>}
              </div>}
              {sidebarTab === 'metadata' && <div data-testid="library-reader-metadata" className="space-y-5">
                <div><span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-300">{t('Markdown limpio')}</span><h3 className="mt-3 text-sm font-semibold leading-5">{reader.title}</h3><p className="mt-2 text-xs leading-5 text-neutral-500">{reader.authors.join('; ') || t('Sin autoría')}</p></div>
                <dl className="space-y-3 text-xs">{[
                  [t('Año'), reader.year], [t('Identificador'), reader.storageId], [t('Clave Zotero'), reader.zoteroKey],
                  [t('Clave de cita'), reader.citationKey], [t('Original'), reader.originalFileName], [t('Palabras'), reader.wordCount], [t('Páginas'), reader.pageCount],
                ].filter(([, value]) => value != null && value !== '').map(([label, value]) => <div key={String(label)}><dt className="text-[10px] uppercase tracking-wider text-neutral-600">{label}</dt><dd className="mt-1 break-words text-neutral-300">{String(value)}</dd></div>)}</dl>
                <p className="rounded-xl border border-neutral-800 p-3 text-[10px] leading-5 text-neutral-600">{t('El Markdown, los recursos y las anotaciones se guardan junto al original dentro de nodus-library.')}</p>
              </div>}
              {sidebarTab === 'chat' && <div data-testid="library-reader-chat" className="flex min-h-full flex-col">
                <div className="mb-3 flex items-center gap-2">
                  <span className="grid h-8 w-8 place-items-center rounded-xl bg-indigo-500/15 text-indigo-300"><Icon name="chat" size={14} /></span>
                  <div className="min-w-0 flex-1"><h3 className="text-xs font-semibold">{t('Chat de la lectura')}</h3><p className="truncate text-[9px] text-neutral-600">{t('Texto limpio y anotaciones incluidos')}</p></div>
                  {chatMessages.length > 0 && <button className="rounded p-1.5 text-neutral-600 hover:bg-red-950 hover:text-red-400" aria-label={t('Vaciar conversación')} onClick={() => void clearChat()}><Icon name="trash" size={12} /></button>}
                </div>
                <div className="min-h-0 flex-1 space-y-3" aria-live="polite">
                  {!chatMessages.length && !chatSending && <div className="rounded-xl border border-dashed border-indigo-500/20 bg-indigo-500/5 px-4 py-6 text-center"><p className="text-xs leading-5 text-neutral-500">{t('Pregunta por la tesis, un concepto o la relación entre tus subrayados.')}</p></div>}
                  {chatMessages.map((message) => <article key={message.id} className={message.role === 'user' ? 'ml-5 rounded-xl bg-indigo-600/20 px-3 py-2.5 text-xs leading-5 text-indigo-100' : `mr-1 rounded-xl border px-3 py-2.5 text-xs leading-5 ${message.error ? 'border-red-500/25 bg-red-500/5 text-red-300' : 'border-neutral-800 bg-neutral-950/45 text-neutral-300'}`}>
                    {message.role === 'assistant' && !message.error ? <Markdown content={message.content} verify={false} className="text-xs leading-5" /> : <p className="whitespace-pre-wrap">{message.content}</p>}
                  </article>)}
                  {chatSending && <article data-testid="library-reader-chat-stream" className="mr-1 rounded-xl border border-neutral-800 bg-neutral-950/45 px-3 py-2.5 text-xs leading-5 text-neutral-300">{chatStreaming ? <Markdown content={chatStreaming} verify={false} className="text-xs leading-5" /> : <span className="flex items-center gap-2 text-neutral-500"><Spinner /> {t('Leyendo el documento…')}</span>}</article>}
                  <div ref={chatBottomRef} />
                </div>
                {chatError && <p role="alert" className="mt-2 text-[10px] leading-4 text-red-400">{chatError}</p>}
                <div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-950/55 p-2 focus-within:border-indigo-500/50">
                  <textarea data-testid="library-reader-chat-input" rows={3} className="block w-full resize-none bg-transparent px-1 text-xs leading-5 text-neutral-200 outline-none placeholder:text-neutral-700" value={chatInput} disabled={chatSending} onChange={(event) => setChatInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendChat(); } }} placeholder={t('Pregunta sobre este documento…')} />
                  <div className="mt-2 flex items-center justify-between border-t border-neutral-800 pt-2">
                    <button className="text-[9px] text-neutral-600 hover:text-indigo-300" onClick={openFullAssistant}>{t('Abrir en Asistente')}</button>
                    {chatSending ? <button data-testid="library-reader-chat-stop" className="btn btn-secondary h-7 px-2 text-[10px]" onClick={() => void window.nodus.cancelLibraryReaderChat()}><Icon name="stop" size={11} /> {t('Detener')}</button> : <button data-testid="library-reader-chat-send" className="btn btn-primary h-7 px-2 text-[10px]" disabled={!chatInput.trim()} onClick={() => void sendChat()}><Icon name="arrowUp" size={11} /> {t('Enviar')}</button>}
                  </div>
                </div>
              </div>}
            </div>
          </aside>
        )}
      </div>
      <FindInPage targetRef={scrollRef} />
      {previewPage && reader.originalUrl && <OriginalPagePreview url={reader.originalUrl} initialPage={previewPage} title={reader.title} onClose={() => setPreviewPage(null)} onOpenFull={() => void window.nodus.openLibraryReaderOriginal(reference.id)} />}
    </div>
  );
}
