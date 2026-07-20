// PDF Presenter — the full-screen speaker-notes editor (F1). Left rail of slide
// thumbnails (lazy, memory-bounded via the shared thumb session), a large preview
// of the current slide, and a notes textarea with undo/redo, autosave-on-navigate
// and keyboard navigation. The notes model itself is pure (@shared/presenterTypes
// setNote); this component only drives it and the pdfjs rendering.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Icon } from '../components/ui';
import { t, tx } from '../i18n';
import { setNote, type Presentation } from '@shared/presenterTypes';
import { createThumbSession, type ThumbSession } from '../lib/presenter/thumbSession';

interface Snapshot {
  slide: number;
  text: string;
}

/** Reflect a slide's note presence on its thumbnail dot (thumbnails are imperative DOM). */
function setThumbDot(slide: number, hasNote: boolean): void {
  const dot = document.querySelector<HTMLElement>(`[data-notes-thumb="${slide}"] [data-note-dot]`);
  if (dot) dot.style.display = hasNote ? 'block' : 'none';
}

export function PresenterNotesModal({
  presentation,
  pdfDoc,
  onChange,
  onClose,
}: {
  presentation: Presentation;
  pdfDoc: PDFDocumentProxy;
  /** Persist the updated presentation (notes) to the library. */
  onChange: (next: Presentation) => void;
  onClose: () => void;
}) {
  const [slide, setSlide] = useState(1);
  const [draft, setDraft] = useState(presentation.notes[String(1)] ?? '');

  // Working copy of the notes map — the source of truth while the editor is open.
  const notesRef = useRef<Record<string, string>>({ ...presentation.notes });
  const undoRef = useRef<Snapshot[]>([]);
  const redoRef = useRef<Snapshot[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const thumbsRef = useRef<HTMLDivElement | null>(null);
  const thumbsScrollRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<ThumbSession | null>(null);
  const renderGen = useRef(0);
  const slideRef = useRef(1);
  const draftRef = useRef(draft);
  slideRef.current = slide;
  draftRef.current = draft;

  const persist = useCallback(() => {
    onChange({ ...presentation, notes: { ...notesRef.current } });
  }, [onChange, presentation]);

  /** Apply a notes snapshot (used by undo/redo), updating the map + thumbnail dot. */
  const applySnapshot = useCallback(
    (snap: Snapshot) => {
      const key = String(snap.slide);
      if (snap.text) notesRef.current = { ...notesRef.current, [key]: snap.text };
      else {
        const { [key]: _drop, ...rest } = notesRef.current;
        notesRef.current = rest;
      }
      persist();
      setThumbDot(snap.slide, !!snap.text);
      setSlide(snap.slide);
      setDraft(snap.text);
    },
    [persist],
  );

  /** Fold the current draft into the notes map, recording an undo step. */
  const commitDraft = useCallback(() => {
    const key = String(slideRef.current);
    const prev = notesRef.current[key] ?? '';
    if (draftRef.current === prev) return;
    undoRef.current.push({ slide: slideRef.current, text: prev });
    redoRef.current = [];
    notesRef.current = setNote({ ...presentation, notes: notesRef.current }, slideRef.current, draftRef.current).notes;
    persist();
    setThumbDot(slideRef.current, !!notesRef.current[key]);
  }, [persist, presentation]);

  // ── Slide rendering (with race-cancellation for fast navigation) ─────────────
  const renderSlide = useCallback(
    async (n: number) => {
      const gen = ++renderGen.current;
      const page = await pdfDoc.getPage(n);
      if (gen !== renderGen.current) {
        page.cleanup?.();
        return;
      }
      const canvas = canvasRef.current;
      const wrap = canvasWrapRef.current;
      if (!canvas || !wrap) {
        page.cleanup?.();
        return;
      }
      const maxW = wrap.clientWidth - 8;
      const maxH = wrap.clientHeight - 8;
      const base = page.getViewport({ scale: 1 });
      const dpr = window.devicePixelRatio || 1;
      const scale = Math.min(maxW / base.width, maxH / base.height, 2);
      const viewport = page.getViewport({ scale: scale * dpr });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
      canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) {
        page.cleanup?.();
        return;
      }
      try {
        await page.render({ canvasContext: ctx, viewport }).promise;
      } finally {
        page.cleanup?.();
      }
    },
    [pdfDoc],
  );

  const goto = useCallback(
    (n: number) => {
      const next = Math.min(Math.max(n, 1), pdfDoc.numPages);
      if (next === slideRef.current) return;
      commitDraft();
      setSlide(next);
      setDraft(notesRef.current[String(next)] ?? '');
    },
    [pdfDoc.numPages, commitDraft],
  );

  const undo = useCallback(() => {
    const snap = undoRef.current.pop();
    if (!snap) return;
    const key = String(snap.slide);
    redoRef.current.push({ slide: snap.slide, text: notesRef.current[key] ?? '' });
    applySnapshot(snap);
  }, [applySnapshot]);

  const redo = useCallback(() => {
    const snap = redoRef.current.pop();
    if (!snap) return;
    const key = String(snap.slide);
    undoRef.current.push({ slide: snap.slide, text: notesRef.current[key] ?? '' });
    applySnapshot(snap);
  }, [applySnapshot]);

  const close = useCallback(() => {
    commitDraft();
    onClose();
  }, [commitDraft, onClose]);

  // Build the thumbnail rail once for this deck.
  useEffect(() => {
    if (!thumbsRef.current) return;
    sessionRef.current?.destroy();
    sessionRef.current = createThumbSession({
      container: thumbsRef.current,
      scrollRoot: thumbsScrollRef.current,
      doc: pdfDoc,
      pageCount: pdfDoc.numPages,
      scale: 0.3,
      buildItem: (pageNum) => buildNotesThumb(pageNum, notesRef.current, () => goto(pageNum)),
    });
    return () => {
      sessionRef.current?.destroy();
      sessionRef.current = null;
    };
  }, [pdfDoc]);

  // Render the current slide + keep the active thumbnail highlighted/visible.
  useEffect(() => {
    void renderSlide(slide);
    const container = thumbsRef.current;
    if (container) {
      container.querySelectorAll<HTMLElement>('[data-notes-thumb]').forEach((el) => {
        el.dataset.active = el.dataset.notesThumb === String(slide) ? 'true' : 'false';
      });
      container.querySelector<HTMLElement>(`[data-notes-thumb="${slide}"]`)?.scrollIntoView({ block: 'nearest' });
    }
  }, [slide, renderSlide]);

  // Re-render on window resize (fit-to-container).
  useEffect(() => {
    const onResize = () => void renderSlide(slideRef.current);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [renderSlide]);

  // Keyboard: arrows navigate (unless typing), ⌘/Ctrl+Z undo, +Shift redo, Esc close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (document.activeElement instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        goto(slideRef.current + 1);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        goto(slideRef.current - 1);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [goto, undo, redo, close]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-950/95 text-neutral-100 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Icon name="edit" size={18} className="shrink-0 text-amber-400" />
          <span className="truncate text-sm font-medium">{tx('Notas — {name}', { name: presentation.name })}</span>
        </div>
        <div className="flex items-center gap-1">
          <IconButton title={t('Deshacer')} onClick={undo}>
            <Icon name="undo" size={16} />
          </IconButton>
          <IconButton title={t('Rehacer')} onClick={redo}>
            <Icon name="rotateCw" size={16} />
          </IconButton>
          <span className="mx-2 text-xs text-neutral-400">
            {tx('Diapositiva {n} de {total}', { n: slide, total: pdfDoc.numPages })}
          </span>
          <IconButton title={t('Cerrar')} onClick={close}>
            <Icon name="x" size={18} />
          </IconButton>
        </div>
      </div>

      {/* Body: thumbnails | (slide + notes) */}
      <div className="flex min-h-0 flex-1">
        <div ref={thumbsScrollRef} className="w-32 shrink-0 overflow-y-auto border-r border-white/10 p-2">
          <div ref={thumbsRef} className="flex flex-col gap-2" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div ref={canvasWrapRef} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black/40 p-3">
            <canvas ref={canvasRef} className="max-h-full max-w-full rounded shadow-lg" />
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-white/10 px-3 pt-2 text-xs text-neutral-400">
            <span>{t('Notas del presentador')}</span>
            <span className="flex items-center gap-1 text-neutral-500">
              <Icon name="check" size={12} />
              {t('Se guarda automáticamente')}
            </span>
          </div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            placeholder={tx('Escribe las notas de la diapositiva {n}…', { n: slide })}
            className="h-40 resize-none border-t border-white/10 bg-neutral-900/60 p-3 text-sm text-neutral-100 outline-none placeholder:text-neutral-600"
          />
        </div>
      </div>
    </div>
  );
}

function IconButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-300 transition-colors hover:bg-white/10 hover:text-white"
    >
      {children}
    </button>
  );
}

function buildNotesThumb(pageNum: number, notes: Record<string, string>, onClick: () => void) {
  const element = document.createElement('button');
  element.type = 'button';
  element.dataset.notesThumb = String(pageNum);
  element.className =
    'group relative block w-full overflow-hidden rounded border border-white/10 bg-neutral-900 text-left transition-colors data-[active=true]:border-amber-400 data-[active=true]:ring-1 data-[active=true]:ring-amber-400';
  element.addEventListener('click', onClick);

  const canvas = document.createElement('canvas');
  canvas.className = 'block w-full';

  const label = document.createElement('span');
  label.className = 'absolute bottom-0 left-0 rounded-tr bg-black/70 px-1.5 py-0.5 text-[10px] text-white';
  label.textContent = String(pageNum);

  const dot = document.createElement('span');
  dot.dataset.noteDot = '';
  dot.className = 'absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-400';
  dot.style.display = notes[String(pageNum)] ? 'block' : 'none';

  element.appendChild(canvas);
  element.appendChild(label);
  element.appendChild(dot);
  return { element, canvas };
}
