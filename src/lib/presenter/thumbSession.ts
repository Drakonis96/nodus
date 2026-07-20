// PDF Presenter — lazy, memory-bounded thumbnail engine, ported from the reference
// app's renderer. It is the reason a 500-slide deck does not collapse the machine
// (audited in F7): pages render only when their tile scrolls near the viewport
// (IntersectionObserver), at most THUMB_RENDER_CONCURRENCY at a time, and each
// canvas is released (sized to 0×0, so its backing store is freed) once it scrolls
// far enough away. Framework-agnostic on purpose — a React view just supplies the
// container and a `buildItem` that returns the tile DOM.
import type { PDFDocumentProxy } from 'pdfjs-dist';

const THUMB_PRELOAD_MARGIN_PX = 600;
const THUMB_RELEASE_MARGIN_PX = 1400;
const THUMB_RENDER_CONCURRENCY = 2;

export interface ThumbItem {
  /** The tile element observed for intersection; gets a `data-page` attribute. */
  element: HTMLElement;
  /** The canvas rendered into (and released) as the tile enters/leaves view. */
  canvas: HTMLCanvasElement;
}

export interface ThumbSession {
  destroy(): void;
}

interface InternalSession {
  cancelled: boolean;
  observer: IntersectionObserver | null;
  queue: number[];
  queued: Set<number>;
  items: Map<number, ThumbItem>;
  rendering: number;
  doc: PDFDocumentProxy;
  scale: number;
  fallbackAspect: number;
}

export interface CreateThumbSessionArgs {
  container: HTMLElement;
  /** Scroll ancestor used as the IntersectionObserver root (null = viewport). */
  scrollRoot?: HTMLElement | null;
  doc: PDFDocumentProxy;
  pageCount: number;
  /** pdfjs render scale — 0.3–0.5 is plenty for a thumbnail. */
  scale: number;
  /** Aspect ratio (w/h) used for the placeholder box before a page is measured. */
  fallbackAspect?: number;
  /** IntersectionObserver rootMargin. Defaults to vertical preloading; pass a
   *  horizontal margin (e.g. `0px 600px`) for a horizontal carousel. */
  rootMargin?: string;
  buildItem: (pageNum: number) => ThumbItem;
}

function releaseThumbCanvas(canvas: HTMLCanvasElement, aspectRatio: number): void {
  canvas.width = 0;
  canvas.height = 0;
  canvas.dataset.rendered = 'false';
  canvas.style.aspectRatio = String(aspectRatio);
}

function shouldReleaseThumb(entry: IntersectionObserverEntry): boolean {
  if (!entry.rootBounds) return false;
  return (
    entry.boundingClientRect.bottom < entry.rootBounds.top - THUMB_RELEASE_MARGIN_PX ||
    entry.boundingClientRect.top > entry.rootBounds.bottom + THUMB_RELEASE_MARGIN_PX
  );
}

function enqueue(session: InternalSession, pageNum: number): void {
  if (session.cancelled || session.queued.has(pageNum)) return;
  const item = session.items.get(pageNum);
  if (!item || item.canvas.dataset.rendered === 'true') return;
  session.queue.push(pageNum);
  session.queued.add(pageNum);
  pump(session);
}

function pump(session: InternalSession): void {
  if (session.cancelled) return;
  while (session.rendering < THUMB_RENDER_CONCURRENCY && session.queue.length > 0) {
    const pageNum = session.queue.shift()!;
    session.queued.delete(pageNum);
    session.rendering += 1;
    void renderPage(session, pageNum).finally(() => {
      session.rendering -= 1;
      pump(session);
    });
  }
}

async function renderPage(session: InternalSession, pageNum: number): Promise<void> {
  const item = session.items.get(pageNum);
  if (!item || session.cancelled || item.canvas.dataset.rendered === 'true') return;

  let page;
  try {
    page = await session.doc.getPage(pageNum);
    if (session.cancelled) return;

    const viewport = page.getViewport({ scale: session.scale });
    item.canvas.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
    item.canvas.width = Math.ceil(viewport.width);
    item.canvas.height = Math.ceil(viewport.height);

    const ctx = item.canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    await page.render({ canvasContext: ctx, viewport }).promise;

    if (!session.cancelled) item.canvas.dataset.rendered = 'true';
  } catch (err) {
    if (!session.cancelled) {
      console.error(`Error rendering thumbnail for slide ${pageNum}:`, err);
      releaseThumbCanvas(item.canvas, session.fallbackAspect);
    }
  } finally {
    // Free pdfjs' per-page operator list; without this a big deck retains every
    // visited page's intermediate structures.
    if (page && typeof page.cleanup === 'function') page.cleanup();
  }
}

export function createThumbSession(args: CreateThumbSessionArgs): ThumbSession {
  const session: InternalSession = {
    cancelled: false,
    observer: null,
    queue: [],
    queued: new Set(),
    items: new Map(),
    rendering: 0,
    doc: args.doc,
    scale: args.scale,
    fallbackAspect: args.fallbackAspect ?? 16 / 9,
  };

  if (typeof IntersectionObserver === 'function') {
    session.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const pageNum = Number((entry.target as HTMLElement).dataset.page);
          if (!pageNum) continue;
          if (entry.isIntersecting) {
            enqueue(session, pageNum);
          } else if (shouldReleaseThumb(entry)) {
            const item = session.items.get(pageNum);
            if (item) releaseThumbCanvas(item.canvas, session.fallbackAspect);
          }
        }
      },
      { root: args.scrollRoot ?? null, rootMargin: args.rootMargin ?? `${THUMB_PRELOAD_MARGIN_PX}px 0px`, threshold: 0.01 },
    );
  }

  args.container.innerHTML = '';
  for (let pageNum = 1; pageNum <= args.pageCount; pageNum += 1) {
    const item = args.buildItem(pageNum);
    item.element.dataset.page = String(pageNum);
    item.canvas.dataset.rendered = 'false';
    item.canvas.style.aspectRatio = String(session.fallbackAspect);
    args.container.appendChild(item.element);
    session.items.set(pageNum, item);
    if (session.observer) session.observer.observe(item.element);
    else enqueue(session, pageNum);
  }

  return {
    destroy() {
      session.cancelled = true;
      session.observer?.disconnect();
      session.queue.length = 0;
      session.queued.clear();
      session.items.forEach(({ canvas }) => releaseThumbCanvas(canvas, session.fallbackAspect));
      session.items.clear();
      args.container.innerHTML = '';
    },
  };
}
